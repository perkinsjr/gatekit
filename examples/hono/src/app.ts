import { createGate } from "@gatekit/core";
import { type GateVariables, gate } from "@gatekit/hono";
import { memory } from "@gatekit/memory";
import { Hono } from "hono";

export function createApp(): Hono<{ Variables: GateVariables }> {
  const app = new Hono<{ Variables: GateVariables }>();
  app.use(
    "*",
    gate(
      createGate({
        backend: memory({
          keys: [{ key: "sk_example", keyId: "key_example" }],
        }),
        rateLimit: { limit: 2, windowMs: 60_000 },
      }),
    ),
  );
  app.get("/", (c) => {
    return c.json({ keyId: c.get("gatekit").identity.keyId });
  });
  return app;
}
