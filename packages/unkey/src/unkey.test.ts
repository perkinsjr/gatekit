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

describe("unkey backend", () => {
  it("maps a valid key and a denied limit from mocked HTTP responses", async () => {
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
        if (request.url.endsWith("/v2/keys.verifyKey")) {
          return json({
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
            },
          });
        }
        return json({
          meta: { requestId: "req_limit" },
          data: { success: false, limit: 10, remaining: 0, reset: 1_700_000_000_000 },
        });
      },
    });

    const gate = createGate({
      backend: unkey({ rootKey: "root_test", namespace: "api.requests", httpClient }),
      now: () => 1_000,
      rateLimit: { limit: 10, windowMs: 60_000, cost: 2 },
    });
    const decision = await gate.protect({
      headers: new Headers({ authorization: "Bearer sk_incoming" }),
    });

    expect(seen.map((call) => call.url)).toEqual([
      "https://api.unkey.com/v2/keys.verifyKey",
      "https://api.unkey.com/v2/ratelimit.limit",
    ]);
    expect(seen.every((call) => call.authorization === "Bearer root_test")).toBe(true);
    expect(seen[0]?.body).toEqual({ key: "sk_incoming" });
    expect(seen[1]?.body).toEqual({
      namespace: "api.requests",
      identifier: "key_123",
      limit: 10,
      duration: 60_000,
      cost: 2,
    });
    expect(decision).toMatchObject({
      kind: "reject",
      status: 429,
      problem: { limit: 10, remaining: 0, reset: 1_700_000_000_000 },
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
        ratelimit: {
          async limit() {
            throw new Error("limit should not run");
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

  it("turns a key-level RATE_LIMITED response into 429 and skips the second call", async () => {
    let limited = false;
    const client: UnkeyClient = {
      keys: {
        async verifyKey() {
          return {
            data: {
              valid: false,
              code: "RATE_LIMITED",
              ratelimits: [
                {
                  name: "tokens",
                  limit: 4,
                  remaining: 0,
                  reset: 500,
                  duration: 5_000,
                  exceeded: true,
                },
              ],
            },
          };
        },
      },
      ratelimit: {
        async limit() {
          limited = true;
          throw new Error("limit should not run");
        },
      },
    };
    const decision = await createGate({
      backend: unkey({ rootKey: "root_test", client }),
      now: () => 1_000,
      rateLimit: { limit: 10, windowMs: 1_000 },
    }).protect({ headers: new Headers({ authorization: "Bearer sk_incoming" }) });
    expect(limited).toBe(false);
    expect(decision).toMatchObject({
      kind: "reject",
      status: 429,
      problem: { limit: 4, remaining: 0, reset: 1_500 },
      headers: { "RateLimit-Policy": '"tokens";q=4;w=5' },
    });
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
