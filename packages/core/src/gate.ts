import { rateLimitHeaders } from "./headers.js";
import { rateLimitedDecision, unauthorizedDecision, unavailableDecision } from "./problem.js";
import type { Admission, Backend, Decision, Gate, GateOptions, RateLimitOptions } from "./types.js";

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

async function readAdmission(
  backend: Backend,
  input: Parameters<Backend["admit"]>[0],
): Promise<Admission | Decision> {
  try {
    return await backend.admit(input);
  } catch {
    return unavailableDecision();
  }
}

function isDecision(value: Admission | Decision): value is Decision {
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
  const rateLimit = options.rateLimit;

  return {
    async protect({ headers }): Promise<Decision> {
      const now = nowFn();
      const key = readKey(headers, headerName, scheme);
      if (key === undefined) return unauthorizedDecision();

      const admission = await readAdmission(options.backend, {
        key,
        now,
        headers,
        ...(rateLimit === undefined
          ? {}
          : {
              rateLimit: {
                name: rateLimit.name ?? "default",
                limit: rateLimit.limit,
                windowMs: rateLimit.windowMs,
                cost: rateLimit.cost ?? 1,
                ...(rateLimit.identify === undefined ? {} : { identify: rateLimit.identify }),
              },
            }),
      });
      if (isDecision(admission)) return admission;
      if (!admission.ok) {
        if (admission.reason === "rate_limited") return rateLimitedDecision(admission.quota, now);
        return unauthorizedDecision();
      }
      if (admission.rateLimit === undefined) {
        return { kind: "allow", identity: admission.identity, headers: {} };
      }
      return {
        kind: "allow",
        identity: admission.identity,
        rateLimit: admission.rateLimit,
        headers: rateLimitHeaders(admission.rateLimit, now, false),
      };
    },
  };
}
