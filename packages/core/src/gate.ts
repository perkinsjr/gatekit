import { rateLimitHeaders } from "./headers.js";
import { rateLimitedDecision, unauthorizedDecision, unavailableDecision } from "./problem.js";
import type {
  Backend,
  ConsumeInput,
  Decision,
  Gate,
  GateOptions,
  Quota,
  RateLimitOptions,
  RateLimitResult,
  VerifyResult,
} from "./types.js";

const HEADER_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function assertInteger(value: number, label: string, min: number): void {
  if (!Number.isSafeInteger(value) || value < min) {
    throw new Error(`${label} must be an integer greater than or equal to ${min}`);
  }
}

function assertRateLimit(options: RateLimitOptions): void {
  assertInteger(options.limit, "limit", 0);
  assertInteger(options.windowMs, "windowMs", 1);
  assertInteger(options.cost ?? 1, "cost", 1);
  const name = options.name ?? "default";
  if (name.length === 0 || hasControlCharacter(name)) {
    throw new Error("rate limit name must be a non-empty string without control characters");
  }
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function readKey(headers: Headers, headerName: string, scheme: string | null): string | undefined {
  const raw = headers.get(headerName);
  if (raw === null) return undefined;
  const value = raw.trim();
  if (value.length === 0 || value.includes("\n") || value.includes("\r")) return undefined;
  if (scheme === null) return value;
  const prefix = `${scheme.toLowerCase()} `;
  if (!value.toLowerCase().startsWith(prefix)) return undefined;
  const token = value.slice(scheme.length).trim();
  if (token.length === 0) return undefined;
  return token;
}

async function readVerify(
  backend: Backend,
  key: string,
  now: number,
): Promise<VerifyResult | Decision> {
  try {
    return await backend.verifyKey({ key, now });
  } catch {
    return unavailableDecision();
  }
}

async function readConsume(
  backend: Backend,
  input: ConsumeInput,
): Promise<RateLimitResult | Decision> {
  try {
    return await backend.consume(input);
  } catch {
    return unavailableDecision();
  }
}

function isDecision(value: VerifyResult | RateLimitResult | Decision): value is Decision {
  return "kind" in value;
}

export function createGate(options: GateOptions): Gate {
  const headerName = (options.keys?.header ?? "authorization").trim().toLowerCase();
  if (!HEADER_TOKEN.test(headerName)) throw new Error("header name is not a valid token");
  const schemeOption = options.keys?.scheme;
  const scheme = schemeOption === undefined ? "bearer" : schemeOption;
  if (scheme !== null && (scheme.length === 0 || /\s/.test(scheme))) {
    throw new Error("scheme must be null or a single token");
  }
  if (options.rateLimit) assertRateLimit(options.rateLimit);
  const nowFn = options.now ?? Date.now;
  const policyName = options.rateLimit?.name ?? "default";
  const cost = options.rateLimit?.cost ?? 1;

  return {
    async protect({ headers }): Promise<Decision> {
      const now = nowFn();
      const key = readKey(headers, headerName, scheme);
      if (key === undefined) return unauthorizedDecision();

      const verified = await readVerify(options.backend, key, now);
      if (isDecision(verified)) return verified;
      if (!verified.ok) {
        if (verified.reason === "rate_limited") return rateLimitedDecision(verified.quota, now);
        return unauthorizedDecision();
      }

      const rateLimit = options.rateLimit;
      if (rateLimit === undefined) {
        return { kind: "allow", identity: verified.identity, headers: {} };
      }

      const identifier = rateLimit.identify
        ? await rateLimit.identify({ identity: verified.identity, headers })
        : verified.identity.keyId;
      if (typeof identifier !== "string" || identifier.length === 0) {
        throw new Error("rate limit identifier must be a non-empty string");
      }

      const result = await readConsume(options.backend, {
        identifier,
        limit: rateLimit.limit,
        windowMs: rateLimit.windowMs,
        cost,
        now,
      });
      if (isDecision(result)) return result;

      const quota: Quota = {
        name: policyName,
        limit: result.limit,
        remaining: result.remaining,
        reset: result.reset,
        windowMs: rateLimit.windowMs,
      };
      if (!result.success) return rateLimitedDecision(quota, now);
      return {
        kind: "allow",
        identity: verified.identity,
        rateLimit: quota,
        headers: rateLimitHeaders(quota, now, false),
      };
    },
  };
}
