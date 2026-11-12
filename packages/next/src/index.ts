import type { Gate, Identity, Quota } from "@gatekit/core";
import { toResponse } from "@gatekit/core";

export type GateHandlerContext<Route> = {
  readonly identity: Identity;
  readonly rateLimit?: Quota;
  readonly route: Route | undefined;
};

export function withGate<Route = undefined>(
  instance: Gate,
  handler: (request: Request, context: GateHandlerContext<Route>) => Response | Promise<Response>,
): (request: Request, route?: Route) => Promise<Response> {
  return async (request, route) => {
    const decision = await instance.protect({ headers: request.headers });
    if (decision.kind === "reject") return toResponse(decision);
    const response = await handler(request, {
      identity: decision.identity,
      ...(decision.rateLimit === undefined ? {} : { rateLimit: decision.rateLimit }),
      route,
    });
    const headers = new Headers(response.headers);
    for (const name of Object.keys(decision.headers)) {
      const value = decision.headers[name];
      if (value !== undefined) headers.set(name, value);
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}
