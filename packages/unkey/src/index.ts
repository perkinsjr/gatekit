import type { Backend, Identity, Quota, RateLimitResult, VerifyResult } from "@gatekit/core";
import { type HTTPClient, Unkey } from "@unkey/api";

export type UnkeyClient = {
  keys: {
    verifyKey(request: { key: string }): Promise<unknown>;
  };
  ratelimit: {
    limit(request: {
      namespace: string;
      identifier: string;
      limit: number;
      duration: number;
      cost?: number;
    }): Promise<unknown>;
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

function absoluteReset(reset: number, now: number): number {
  if (reset > 1_000_000_000_000) return reset;
  return now + reset;
}

function quotaFromVerify(data: Record<string, unknown>, now: number): Quota {
  const entries = data.ratelimits;
  const first = Array.isArray(entries) ? entries.find(isRecord) : undefined;
  if (first === undefined) {
    return { name: "default", limit: 0, remaining: 0, reset: now, windowMs: 1000 };
  }
  const duration = numberField(first, "duration") ?? 1000;
  const resetField = numberField(first, "reset");
  return {
    name: typeof first.name === "string" && first.name.length > 0 ? first.name : "default",
    limit: numberField(first, "limit") ?? 0,
    remaining: numberField(first, "remaining") ?? 0,
    reset: resetField === undefined ? now + duration : absoluteReset(resetField, now),
    windowMs: Math.max(1, duration),
  };
}

function parseVerifyResponse(value: unknown, now: number): VerifyResult {
  const data = dataOf(value);
  if (typeof data.code !== "string" || typeof data.valid !== "boolean") {
    throw new Error("unkey verify response is missing valid or code");
  }
  if (data.code === "RATE_LIMITED") {
    return { ok: false, reason: "rate_limited", quota: quotaFromVerify(data, now) };
  }
  if (!data.valid || data.code !== "VALID") return { ok: false, reason: "unauthorized" };
  if (typeof data.keyId !== "string" || data.keyId.length === 0) {
    throw new Error("unkey verify response is missing keyId");
  }
  const identityRecord = data.identity;
  const externalId =
    isRecord(identityRecord) && typeof identityRecord.externalId === "string"
      ? identityRecord.externalId
      : undefined;
  const identity: Identity = {
    keyId: data.keyId,
    meta: isRecord(data.meta) ? { ...data.meta } : {},
    permissions: stringList(data.permissions),
    ...(typeof data.name === "string" ? { name: data.name } : {}),
    ...(typeof data.expires === "number" ? { expiresAt: data.expires } : {}),
    ...(externalId !== undefined ? { externalId } : {}),
  };
  return { ok: true, identity };
}

function parseLimitResponse(value: unknown): RateLimitResult {
  const data = dataOf(value);
  const limit = numberField(data, "limit");
  const remaining = numberField(data, "remaining");
  const reset = numberField(data, "reset");
  if (
    typeof data.success !== "boolean" ||
    limit === undefined ||
    remaining === undefined ||
    reset === undefined
  ) {
    throw new Error("unkey ratelimit response is incomplete");
  }
  return { success: data.success, limit, remaining, reset };
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
    ratelimit: {
      limit: (request) => sdk.ratelimit.limit(request),
    },
  };
}

export function unkey(options: {
  readonly rootKey: string;
  readonly namespace?: string;
  readonly client?: UnkeyClient;
  readonly httpClient?: HTTPClient;
}): Backend {
  if (options.rootKey.length === 0) throw new Error("rootKey must be a non-empty string");
  const namespace = options.namespace ?? "gatekit";
  if (namespace.length === 0) throw new Error("namespace must be a non-empty string");
  const client = options.client ?? sdkClient(options.rootKey, options.httpClient);

  return {
    async verifyKey({ key, now }) {
      return parseVerifyResponse(await client.keys.verifyKey({ key }), now);
    },
    async consume(input) {
      return parseLimitResponse(
        await client.ratelimit.limit({
          namespace,
          identifier: input.identifier,
          limit: input.limit,
          duration: input.windowMs,
          cost: input.cost,
        }),
      );
    },
  };
}
