import type { Admission, Backend, Identity, Quota } from "@gatekit/core";
import { type HTTPClient, Unkey } from "@unkey/api";

export type UnkeyVerifyRequest = {
  key: string;
  ratelimits?: Array<{
    name: string;
    limit?: number;
    duration?: number;
    cost?: number;
  }>;
};

export type UnkeyClient = {
  keys: {
    verifyKey(request: UnkeyVerifyRequest): Promise<unknown>;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dataOf(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("unkey response was not an object");
  if (isRecord(value.data)) return value.data;
  return value;
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringList(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("unkey permissions must be an array of strings");
  const permissions: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") throw new Error("unkey permissions must be an array of strings");
    permissions.push(item);
  }
  return permissions;
}

function pickRatelimit(
  data: Record<string, unknown>,
  preferredName: string | undefined,
): Record<string, unknown> | undefined {
  const entries = data.ratelimits;
  if (!Array.isArray(entries)) return undefined;
  const records = entries.filter(isRecord);
  if (preferredName !== undefined) {
    const named = records.find((entry) => entry.name === preferredName);
    if (named !== undefined) return named;
  }
  return records.find((entry) => entry.exceeded === true) ?? records[0];
}

function quotaFromEntry(entry: Record<string, unknown>, now: number): Quota | undefined {
  const limit = numberField(entry, "limit");
  const remaining = numberField(entry, "remaining");
  const duration = numberField(entry, "duration");
  const reset = numberField(entry, "reset");
  if (
    limit === undefined ||
    remaining === undefined ||
    duration === undefined ||
    reset === undefined ||
    typeof entry.name !== "string" ||
    entry.name.length === 0
  ) {
    return undefined;
  }
  return {
    name: entry.name,
    limit,
    remaining,
    reset: now + reset,
    windowMs: Math.max(1, duration),
  };
}

function readIdentity(data: Record<string, unknown>): Identity {
  if (typeof data.keyId !== "string" || data.keyId.length === 0) {
    throw new Error("unkey verify response is missing keyId");
  }
  const identityRecord = data.identity;
  const externalId =
    isRecord(identityRecord) && typeof identityRecord.externalId === "string"
      ? identityRecord.externalId
      : undefined;
  return {
    keyId: data.keyId,
    meta: isRecord(data.meta) ? { ...data.meta } : {},
    permissions: stringList(data.permissions),
    ...(typeof data.name === "string" ? { name: data.name } : {}),
    ...(typeof data.expires === "number" ? { expiresAt: data.expires } : {}),
    ...(externalId !== undefined ? { externalId } : {}),
  };
}

function parseVerifyResponse(
  value: unknown,
  now: number,
  preferredName: string | undefined,
): Admission {
  const data = dataOf(value);
  if (typeof data.code !== "string" || typeof data.valid !== "boolean") {
    throw new Error("unkey verify response is missing valid or code");
  }
  const entry = pickRatelimit(data, preferredName);
  const quota = entry === undefined ? undefined : quotaFromEntry(entry, now);
  if (data.code === "RATE_LIMITED") {
    if (quota === undefined) throw new Error("unkey rate limit response is incomplete");
    return { ok: false, reason: "rate_limited", quota };
  }
  if (!data.valid || data.code !== "VALID") return { ok: false, reason: "unauthorized" };
  const identity = readIdentity(data);
  if (quota === undefined) return { ok: true, identity };
  return { ok: true, identity, rateLimit: quota };
}

function sdkClient(rootKey: string, httpClient?: HTTPClient): UnkeyClient {
  const sdk = new Unkey({
    rootKey,
    retryConfig: { strategy: "none" },
    ...(httpClient === undefined ? {} : { httpClient }),
  });
  return {
    keys: {
      verifyKey: (request) => sdk.keys.verifyKey(request),
    },
  };
}

export function unkey(options: {
  readonly rootKey: string;
  readonly client?: UnkeyClient;
  readonly httpClient?: HTTPClient;
}): Backend {
  if (options.rootKey.length === 0) throw new Error("rootKey must be a non-empty string");
  const client = options.client ?? sdkClient(options.rootKey, options.httpClient);

  return {
    async admit(input) {
      const rateLimit = input.rateLimit;
      const request: UnkeyVerifyRequest =
        rateLimit === undefined
          ? { key: input.key }
          : {
              key: input.key,
              ratelimits: [
                {
                  name: rateLimit.name,
                  limit: rateLimit.limit,
                  duration: rateLimit.windowMs,
                  cost: rateLimit.cost,
                },
              ],
            };
      return parseVerifyResponse(await client.keys.verifyKey(request), input.now, rateLimit?.name);
    },
  };
}
