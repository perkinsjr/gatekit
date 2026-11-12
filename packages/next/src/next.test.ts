import { createGate } from "@gatekit/core";
import { memory } from "@gatekit/memory";
import { describe, expect, it } from "vitest";
import { withGate } from "./index.js";

describe("next adapter", () => {
  it("wraps a route handler and forwards the route argument only after the key is allowed", async () => {
    let now = 2_000;
    let handled = 0;
    const GET = withGate<{ id: string }>(
      createGate({
        backend: memory({ keys: [{ key: "sk_test", keyId: "key_test" }] }),
        now: () => now,
        rateLimit: { limit: 1, windowMs: 1_000 },
      }),
      async (_request, context) => {
        handled += 1;
        return Response.json({ keyId: context.identity.keyId, id: context.route?.id });
      },
    );

    const missing = await GET(new Request("http://localhost/items/1"), { id: "1" });
    expect(missing.status).toBe(401);
    expect(handled).toBe(0);

    const allowed = await GET(
      new Request("http://localhost/items/1", { headers: { authorization: "Bearer sk_test" } }),
      {
        id: "1",
      },
    );
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("RateLimit")).toBe('"default";r=0;t=1');
    expect(await allowed.json()).toEqual({ keyId: "key_test", id: "1" });

    const limited = await GET(
      new Request("http://localhost/items/1", { headers: { authorization: "Bearer sk_test" } }),
      {
        id: "1",
      },
    );
    expect(limited.status).toBe(429);
    expect(handled).toBe(1);

    now = 3_000;
    const again = await GET(
      new Request("http://localhost/items/1", { headers: { authorization: "Bearer sk_test" } }),
      {
        id: "1",
      },
    );
    expect(again.status).toBe(200);
  });
});
