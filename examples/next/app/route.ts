import { createGate } from "@gatekit/core";
import { memory } from "@gatekit/memory";
import { withGate } from "@gatekit/next";

const gate = createGate({
  backend: memory({
    keys: [{ key: "sk_example", keyId: "key_example" }],
  }),
  rateLimit: { limit: 2, windowMs: 60_000 },
});

export const GET = withGate(gate, async (_request, context) => {
  return Response.json({ keyId: context.identity.keyId });
});
