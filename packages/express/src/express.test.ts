import { createGate } from "@gatekit/core";
import { memory } from "@gatekit/memory";
import express from "express";
import { describe, expect, it } from "vitest";
import { gate } from "./index.js";

async function listen(
  now: () => number,
): Promise<{ url: string; close: () => Promise<void>; handled: () => number }> {
  let handled = 0;
  const app = express();
  app.use(
    gate(
      createGate({
        backend: memory({ keys: [{ key: "sk_test", keyId: "key_test" }] }),
        now,
        rateLimit: { limit: 1, windowMs: 1_000 },
      }),
    ),
  );
  app.get("/", (req, res) => {
    handled += 1;
    res.json({ keyId: req.gatekit?.identity.keyId });
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("missing port");
  return {
    url: `http://127.0.0.1:${address.port}`,
    handled: () => handled,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

describe("express adapter", () => {
  it("serves 401, one allowed request, and 429 on a real socket", async () => {
    let now = 5_000;
    const server = await listen(() => now);
    try {
      const missing = await fetch(`${server.url}/`);
      expect(missing.status).toBe(401);
      expect(missing.headers.get("content-type")).toBe("application/problem+json");
      expect(await missing.json()).toMatchObject({ detail: "API key is missing or invalid." });
      expect(server.handled()).toBe(0);

      const allowed = await fetch(`${server.url}/`, {
        headers: { authorization: "Bearer sk_test" },
      });
      expect(allowed.status).toBe(200);
      expect(await allowed.json()).toEqual({ keyId: "key_test" });
      expect(allowed.headers.get("ratelimit-policy")).toBe('"default";q=1;w=1');

      const limited = await fetch(`${server.url}/`, {
        headers: { authorization: "Bearer sk_test" },
      });
      expect(limited.status).toBe(429);
      expect(limited.headers.get("retry-after")).toBe("1");
      expect(server.handled()).toBe(1);

      now = 6_000;
      const again = await fetch(`${server.url}/`, {
        headers: { authorization: "Bearer sk_test" },
      });
      expect(again.status).toBe(200);
    } finally {
      await server.close();
    }
  });
});
