import { createGate } from "@gatekit/core";
import { describe, expect, it } from "vitest";
import { memory } from "./index.js";

const keys = [
  {
    key: "sk_live",
    keyId: "key_live",
    name: "live",
    meta: { plan: "pro" },
    permissions: ["read"],
    externalId: "user_1",
  },
  { key: "sk_old", keyId: "key_old", expiresAt: 500 },
  { key: "sk_off", keyId: "key_off", enabled: false },
];

describe("memory backend", () => {
  it("verifies a configured key and rejects expired or disabled keys with the same 401", async () => {
    const gate = createGate({
      backend: memory({ keys }),
      now: () => 500,
      rateLimit: { limit: 2, windowMs: 1_000 },
    });
    const allowed = await gate.protect({
      headers: new Headers({ authorization: "Bearer sk_live" }),
    });
    const expired = await gate.protect({
      headers: new Headers({ authorization: "Bearer sk_old" }),
    });
    const disabled = await gate.protect({
      headers: new Headers({ authorization: "Bearer sk_off" }),
    });
    const unknown = await gate.protect({
      headers: new Headers({ authorization: "Bearer sk_missing" }),
    });

    expect(allowed).toMatchObject({
      kind: "allow",
      identity: {
        keyId: "key_live",
        name: "live",
        externalId: "user_1",
        meta: { plan: "pro" },
        permissions: ["read"],
      },
    });
    for (const decision of [expired, disabled, unknown]) {
      expect(decision).toMatchObject({
        kind: "reject",
        status: 401,
        problem: { detail: "API key is missing or invalid." },
      });
    }
  });

  it("allows a key again at the exact end of the window", async () => {
    let now = 900;
    const gate = createGate({
      backend: memory({ keys: [{ key: "sk_live", keyId: "key_live" }] }),
      now: () => now,
      rateLimit: { limit: 1, windowMs: 1_000 },
    });
    const headers = new Headers({ authorization: "Bearer sk_live" });
    expect((await gate.protect({ headers })).kind).toBe("allow");
    now = 1000;
    expect((await gate.protect({ headers })).kind).toBe("reject");
    now = 1900;
    const again = await gate.protect({ headers });
    expect(again.kind).toBe("allow");
  });

  it("lets only the limit through when many checks run at once", async () => {
    const backend = memory({ keys: [{ key: "sk_live", keyId: "key_live" }] });
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        backend.consume({
          identifier: "key_live",
          limit: 5,
          windowMs: 60_000,
          cost: 1,
          now: 10_000,
        }),
      ),
    );
    expect(results.filter((result) => result.success)).toHaveLength(5);
    expect(
      results.filter((result) => !result.success).every((result) => result.remaining === 0),
    ).toBe(true);
  });

  it("keeps separate buckets per key", async () => {
    const gate = createGate({
      backend: memory({
        keys: [
          { key: "sk_a", keyId: "key_a" },
          { key: "sk_b", keyId: "key_b" },
        ],
      }),
      now: () => 1,
      rateLimit: { limit: 1, windowMs: 1_000 },
    });
    expect(
      (await gate.protect({ headers: new Headers({ authorization: "Bearer sk_a" }) })).kind,
    ).toBe("allow");
    expect(
      (await gate.protect({ headers: new Headers({ authorization: "Bearer sk_a" }) })).kind,
    ).toBe("reject");
    expect(
      (await gate.protect({ headers: new Headers({ authorization: "Bearer sk_b" }) })).kind,
    ).toBe("allow");
  });

  it("rejects a duplicate key at startup", () => {
    expect(() => memory({ keys: [{ key: "sk_live" }, { key: "sk_live" }] })).toThrow(
      /duplicate key/,
    );
  });
});
