import { createGate } from "@gatekit/core";
import { memory } from "@gatekit/memory";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { type GateVariables, gate } from "./index.js";

function appAt(now: () => number) {
  let handled = 0;
  const app = new Hono<{ Variables: GateVariables }>();
  app.use(
    "*",
    gate(
      createGate({
        backend: memory({ keys: [{ key: "sk_test", keyId: "key_test", meta: { plan: "pro" } }] }),
        now,
        rateLimit: { limit: 1, windowMs: 60_000 },
      }),
    ),
  );
  app.get("/", (c) => {
    handled += 1;
    return c.json({
      keyId: c.get("gatekit").identity.keyId,
      plan: c.get("gatekit").identity.meta.plan,
    });
  });
  return { app, handled: () => handled };
}

describe("hono adapter", () => {
  it("rejects a missing key before the handler and lets a valid key through once", async () => {
    let now = 1_000;
    const { app, handled } = appAt(() => now);
    const missing = await app.request("/");
    expect(missing.status).toBe(401);
    expect(missing.headers.get("content-type")).toBe("application/problem+json");
    expect(await missing.json()).toMatchObject({ type: "urn:gatekit:problem:unauthorized" });
    expect(handled()).toBe(0);

    const allowed = await app.request("/", { headers: { authorization: "Bearer sk_test" } });
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ keyId: "key_test", plan: "pro" });
    expect(allowed.headers.get("RateLimit-Policy")).toBe('"default";q=1;w=60');
    expect(allowed.headers.get("RateLimit")).toBe('"default";r=0;t=60');

    const limited = await app.request("/", { headers: { authorization: "Bearer sk_test" } });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
    expect(handled()).toBe(1);

    now = 61_000;
    const again = await app.request("/", { headers: { authorization: "Bearer sk_test" } });
    expect(again.status).toBe(200);
  });
});
