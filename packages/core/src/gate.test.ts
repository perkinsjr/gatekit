import { describe, expect, it } from "vitest";
import { createGate } from "./gate.js";
import type { Backend, ConsumeInput, Identity, RateLimitResult } from "./types.js";

const identity: Identity = {
  keyId: "key_1",
  name: "local",
  meta: { plan: "pro" },
  permissions: ["read"],
};

function countingBackend(limit: number): Backend & { calls: ConsumeInput[] } {
  const calls: ConsumeInput[] = [];
  let used = 0;
  return {
    calls,
    async verifyKey({ key }) {
      if (key !== "sk_test") return { ok: false, reason: "unauthorized" };
      return { ok: true, identity };
    },
    async consume(input) {
      calls.push(input);
      used += input.cost;
      const success = used <= limit;
      if (!success) used -= input.cost;
      const result: RateLimitResult = {
        success,
        limit,
        remaining: Math.max(0, limit - used),
        reset: input.now + input.windowMs,
      };
      return result;
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
    expect(backend.calls).toHaveLength(0);
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

  it("returns 429 from the backend result and does not call the handler quota twice", async () => {
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
    expect(backend.calls[0]?.identifier).toBe("user:key_1");
  });

  it("turns a backend failure into 503 without a rate limit header", async () => {
    const backend: Backend = {
      async verifyKey() {
        throw new Error("redis down");
      },
      async consume() {
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

  it("passes a key rate limit from verification through as 429", async () => {
    const backend: Backend = {
      async verifyKey() {
        return {
          ok: false as const,
          reason: "rate_limited" as const,
          quota: { name: "tokens", limit: 4, remaining: 0, reset: 9_000, windowMs: 5_000 },
        };
      },
      async consume() {
        throw new Error("consume should not run");
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
    expect(backend.calls).toHaveLength(0);
  });
});
