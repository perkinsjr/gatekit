import { describe, expect, it } from "vitest";
import { createGate } from "./gate.js";
import type { AdmitInput, Backend, Identity } from "./types.js";

const identity: Identity = {
  keyId: "key_1",
  name: "local",
  meta: { plan: "pro" },
  permissions: ["read"],
};

function countingBackend(limit: number): Backend & { calls: AdmitInput[]; identifiers: string[] } {
  const calls: AdmitInput[] = [];
  const identifiers: string[] = [];
  let used = 0;
  return {
    calls,
    identifiers,
    async admit(input) {
      calls.push(input);
      if (input.key !== "sk_test") return { ok: false, reason: "unauthorized" };
      const rateLimit = input.rateLimit;
      if (rateLimit === undefined) return { ok: true, identity };
      const identifier = rateLimit.identify
        ? await rateLimit.identify({ identity, headers: input.headers })
        : identity.keyId;
      identifiers.push(identifier);
      used += rateLimit.cost;
      const success = used <= limit;
      if (!success) used -= rateLimit.cost;
      const quota = {
        name: rateLimit.name,
        limit,
        remaining: Math.max(0, limit - used),
        reset: input.now + rateLimit.windowMs,
        windowMs: rateLimit.windowMs,
      };
      if (!success) return { ok: false, reason: "rate_limited", quota };
      return { ok: true, identity, rateLimit: quota };
    },
  };
}

function protect(headers: Headers, backend: Backend, now = 1_000) {
  return createGate({
    backend,
    now: () => now,
    rateLimit: { limit: 2, windowMs: 60_000, name: "api" },
  }).protect({ headers });
}

describe("createGate", () => {
  it("rejects a missing key and a rejected key with the same problem", async () => {
    const backend = countingBackend(2);
    const missing = await protect(new Headers(), backend);
    const rejected = await protect(new Headers({ authorization: "Bearer wrong" }), backend);
    expect(missing).toMatchObject({
      kind: "reject",
      status: 401,
      problem: {
        type: "urn:gatekit:problem:unauthorized",
        detail: "API key is missing or invalid.",
      },
    });
    expect(rejected.kind === "reject" && missing.kind === "reject" ? rejected.problem : {}).toEqual(
      missing.kind === "reject" ? missing.problem : {},
    );
    expect(backend.calls).toHaveLength(1);
    expect(backend.calls[0]?.key).toBe("wrong");
  });

  it("accepts a bearer token in any scheme case and attaches the identity", async () => {
    const backend = countingBackend(2);
    const decision = await protect(new Headers({ authorization: "bEaReR sk_test" }), backend);
    expect(decision.kind).toBe("allow");
    if (decision.kind !== "allow") return;
    expect(decision.identity).toEqual(identity);
    expect(decision.rateLimit).toMatchObject({ name: "api", limit: 2, remaining: 1 });
    expect(decision.headers["RateLimit-Policy"]).toBe('"api";q=2;w=60');
    expect(decision.headers.RateLimit).toBe('"api";r=1;t=60');
    expect(decision.headers["Retry-After"]).toBeUndefined();
  });

  it("reads a raw key from a configured header", async () => {
    const backend = countingBackend(2);
    const decision = await createGate({
      backend,
      now: () => 1_000,
      keys: { header: "x-api-key", scheme: null },
    }).protect({ headers: new Headers({ "x-api-key": "sk_test" }) });
    expect(decision.kind).toBe("allow");
  });

  it("returns 429 once the backend reports the limit is full", async () => {
    const backend = countingBackend(1);
    const headers = new Headers({ authorization: "Bearer sk_test" });
    const first = await protect(headers, backend);
    const second = await protect(headers, backend);
    expect(first.kind).toBe("allow");
    expect(second).toMatchObject({
      kind: "reject",
      status: 429,
      problem: { type: "urn:gatekit:problem:rate-limited", remaining: 0, limit: 1 },
      headers: { "Retry-After": "60", RateLimit: '"api";r=0;t=60' },
    });
    expect(backend.calls).toHaveLength(2);
  });

  it("uses the identifier function for the bucket", async () => {
    const backend = countingBackend(1);
    const gate = createGate({
      backend,
      now: () => 5_000,
      rateLimit: {
        limit: 1,
        windowMs: 1_000,
        identify: ({ identity: current }) => `user:${current.keyId}`,
      },
    });
    await gate.protect({ headers: new Headers({ authorization: "Bearer sk_test" }) });
    expect(backend.identifiers[0]).toBe("user:key_1");
  });

  it("turns a backend failure into 503 without a rate limit header", async () => {
    const backend: Backend = {
      async admit() {
        throw new Error("redis down");
      },
    };
    const decision = await protect(new Headers({ authorization: "Bearer sk_test" }), backend);
    expect(decision).toMatchObject({
      kind: "reject",
      status: 503,
      headers: {},
      problem: {
        type: "urn:gatekit:problem:backend-unavailable",
        detail: "The auth backend could not complete the request.",
      },
    });
  });

  it("passes a rate limit from the backend through as 429", async () => {
    const backend: Backend = {
      async admit() {
        return {
          ok: false,
          reason: "rate_limited",
          quota: { name: "tokens", limit: 4, remaining: 0, reset: 9_000, windowMs: 5_000 },
        };
      },
    };
    const decision = await protect(
      new Headers({ authorization: "Bearer sk_test" }),
      backend,
      8_000,
    );
    expect(decision).toMatchObject({
      kind: "reject",
      status: 429,
      headers: { "Retry-After": "1", "RateLimit-Policy": '"tokens";q=4;w=5' },
    });
  });

  it("skips rate limit headers when no limit is configured", async () => {
    const backend = countingBackend(2);
    const decision = await createGate({ backend, now: () => 1 }).protect({
      headers: new Headers({ authorization: "Bearer sk_test" }),
    });
    expect(decision).toMatchObject({ kind: "allow", headers: {} });
    expect(backend.calls).toHaveLength(1);
    expect(backend.calls[0]?.rateLimit).toBeUndefined();
  });
});
