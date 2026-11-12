import { createGate } from "@gatekit/core";
import { HTTPClient } from "@unkey/api";
import { describe, expect, it } from "vitest";
import { type UnkeyClient, unkey } from "./index.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const verified = {
  meta: { requestId: "req_verify" },
  data: {
    valid: true,
    code: "VALID",
    keyId: "key_123",
    name: "primary",
    meta: { plan: "pro" },
    permissions: ["read"],
    expires: 9_000,
    identity: { id: "id_1", externalId: "user_9" },
    ratelimits: [
      {
        id: "rl_1",
        name: "default",
        limit: 10,
        remaining: 8,
        reset: 30_000,
        duration: 60_000,
        exceeded: false,
        autoApply: false,
      },
    ],
  },
};

describe("unkey backend", () => {
  it("sends one verifyKey request with the gate ratelimit", async () => {
    const seen: Array<{ url: string; authorization: string | null; body: unknown }> = [];
    const httpClient = new HTTPClient({
      fetcher: async (input, init) => {
        const request = new Request(input, init);
        const text = await request.text();
        seen.push({
          url: request.url,
          authorization: request.headers.get("authorization"),
          body: JSON.parse(text) as unknown,
        });
        return json(verified);
      },
    });

    const decision = await createGate({
      backend: unkey({ rootKey: "root_test", httpClient }),
      now: () => 1_000,
      rateLimit: { limit: 10, windowMs: 60_000, cost: 2, name: "default" },
    }).protect({ headers: new Headers({ authorization: "Bearer sk_incoming" }) });

    expect(seen.map((call) => call.url)).toEqual(["https://api.unkey.com/v2/keys.verifyKey"]);
    expect(seen[0]?.authorization).toBe("Bearer root_test");
    expect(seen[0]?.body).toEqual({
      key: "sk_incoming",
      ratelimits: [{ name: "default", limit: 10, duration: 60_000, cost: 2 }],
    });
    expect(decision).toMatchObject({
      kind: "allow",
      identity: { keyId: "key_123", externalId: "user_9" },
      rateLimit: { name: "default", limit: 10, remaining: 8, reset: 31_000 },
      headers: { "RateLimit-Policy": '"default";q=10;w=60', RateLimit: '"default";r=8;t=30' },
    });
  });

  it("verifies without a ratelimits override when the gate has no limit", async () => {
    const seen: unknown[] = [];
    const httpClient = new HTTPClient({
      fetcher: async (input, init) => {
        const request = new Request(input, init);
        seen.push(JSON.parse(await request.text()) as unknown);
        return json({
          meta: { requestId: "req_verify" },
          data: { valid: true, code: "VALID", keyId: "key_123" },
        });
      },
    });
    const decision = await createGate({
      backend: unkey({ rootKey: "root_test", httpClient }),
      now: () => 1,
    }).protect({ headers: new Headers({ authorization: "Bearer sk_incoming" }) });
    expect(seen).toEqual([{ key: "sk_incoming" }]);
    expect(decision).toMatchObject({ kind: "allow", headers: {} });
  });

  it("maps RATE_LIMITED from verifyKey to 429", async () => {
    const httpClient = new HTTPClient({
      fetcher: async () =>
        json({
          meta: { requestId: "req_verify" },
          data: {
            valid: false,
            code: "RATE_LIMITED",
            keyId: "key_123",
            ratelimits: [
              {
                id: "rl_tokens",
                name: "tokens",
                limit: 4,
                remaining: 0,
                reset: 500,
                duration: 5_000,
                exceeded: true,
                autoApply: true,
              },
            ],
          },
        }),
    });
    const decision = await createGate({
      backend: unkey({ rootKey: "root_test", httpClient }),
      now: () => 1_000,
      rateLimit: { limit: 10, windowMs: 1_000, name: "tokens" },
    }).protect({ headers: new Headers({ authorization: "Bearer sk_incoming" }) });
    expect(decision).toMatchObject({
      kind: "reject",
      status: 429,
      problem: { limit: 4, remaining: 0, reset: 1_500 },
      headers: { "Retry-After": "1", "RateLimit-Policy": '"tokens";q=4;w=5' },
    });
  });

  it("collapses invalid key codes to the same unauthorized result", async () => {
    for (const code of ["NOT_FOUND", "DISABLED", "EXPIRED", "FORBIDDEN", "USAGE_EXCEEDED"]) {
      const client: UnkeyClient = {
        keys: {
          async verifyKey() {
            return { data: { valid: false, code } };
          },
        },
      };
      const decision = await createGate({
        backend: unkey({ rootKey: "root_test", client }),
        now: () => 1,
      }).protect({ headers: new Headers({ authorization: "Bearer sk_incoming" }) });
      expect(decision).toMatchObject({
        kind: "reject",
        status: 401,
        problem: { detail: "API key is missing or invalid." },
      });
    }
  });

  it("returns 503 when the HTTP call fails", async () => {
    const httpClient = new HTTPClient({
      fetcher: async () => json({ meta: { requestId: "req" }, error: "nope" }, 500),
    });
    const decision = await createGate({
      backend: unkey({ rootKey: "root_test", httpClient }),
      now: () => 1,
    }).protect({ headers: new Headers({ authorization: "Bearer sk_incoming" }) });
    expect(decision).toMatchObject({ kind: "reject", status: 503 });
  });
});
