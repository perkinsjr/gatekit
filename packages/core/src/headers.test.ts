import { describe, expect, it } from "vitest";
import { rateLimitHeaders } from "./headers.js";
import { rateLimitedDecision, toResponse, unauthorizedDecision } from "./problem.js";
import type { Quota } from "./types.js";

const quota: Quota = {
  name: "default",
  limit: 10,
  remaining: 7,
  reset: 1_000_000,
  windowMs: 60_000,
};

describe("rate limit headers", () => {
  it("writes the draft policy and remaining quota in whole seconds", () => {
    const headers = rateLimitHeaders(quota, 970_000, false);
    expect(headers["RateLimit-Policy"]).toBe('"default";q=10;w=60');
    expect(headers.RateLimit).toBe('"default";r=7;t=30');
    expect(headers["Retry-After"]).toBeUndefined();
  });

  it("rounds a partial second up and adds Retry-After when denied", () => {
    const headers = rateLimitHeaders({ ...quota, reset: 971_001, remaining: 0 }, 970_000, true);
    expect(headers.RateLimit).toBe('"default";r=0;t=2');
    expect(headers["Retry-After"]).toBe("2");
  });

  it("quotes a policy name that contains a double quote", () => {
    const headers = rateLimitHeaders({ ...quota, name: 'say "hi"' }, 970_000, false);
    expect(headers["RateLimit-Policy"]).toBe('"say \\"hi\\"";q=10;w=60');
  });

  it("rounds a sub-second window up to one second in the policy", () => {
    const headers = rateLimitHeaders({ ...quota, windowMs: 500 }, 970_000, false);
    expect(headers["RateLimit-Policy"]).toBe('"default";q=10;w=1');
  });
});

describe("problem responses", () => {
  it("returns the same 401 body for a rejection", async () => {
    const response = toResponse(unauthorizedDecision());
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    expect(await response.json()).toEqual({
      type: "urn:gatekit:problem:unauthorized",
      title: "Unauthorized",
      status: 401,
      detail: "API key is missing or invalid.",
    });
  });

  it("returns a 429 problem with quota fields and headers", async () => {
    const decision = rateLimitedDecision({ ...quota, remaining: 0, reset: 1_030_000 }, 1_000_000);
    const response = toResponse(decision);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("30");
    expect(response.headers.get("RateLimit")).toBe('"default";r=0;t=30');
    expect(await response.json()).toMatchObject({
      type: "urn:gatekit:problem:rate-limited",
      status: 429,
      limit: 10,
      remaining: 0,
      reset: 1_030_000,
    });
  });
});
