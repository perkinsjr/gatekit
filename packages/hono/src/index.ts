import type { Gate, Identity, Quota } from "@gatekit/core";
import { toResponse } from "@gatekit/core";
import type { MiddlewareHandler } from "hono";

export type GateVariables = {
  gatekit: {
    identity: Identity;
    rateLimit?: Quota;
  };
};

export function gate(instance: Gate): MiddlewareHandler<{ Variables: GateVariables }> {
  return async (c, next) => {
    const decision = await instance.protect({ headers: c.req.raw.headers });
    if (decision.kind === "reject") return toResponse(decision);
    c.set("gatekit", {
      identity: decision.identity,
      ...(decision.rateLimit === undefined ? {} : { rateLimit: decision.rateLimit }),
    });
    for (const name of Object.keys(decision.headers)) {
      const value = decision.headers[name];
      if (value !== undefined) c.header(name, value);
    }
    await next();
  };
}
