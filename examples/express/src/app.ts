import { createGate } from "@gatekit/core";
import { gate } from "@gatekit/express";
import { memory } from "@gatekit/memory";
import express from "express";

export function createApp(): express.Express {
  const app = express();
  app.use(
    gate(
      createGate({
        backend: memory({
          keys: [{ key: "sk_example", keyId: "key_example" }],
        }),
        rateLimit: { limit: 2, windowMs: 60_000 },
      }),
    ),
  );
  app.get("/", (req, res) => {
    res.json({ keyId: req.gatekit?.identity.keyId });
  });
  return app;
}
