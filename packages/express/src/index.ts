import type { Gate, Identity, Quota } from "@gatekit/core";
import type { NextFunction, Request, RequestHandler, Response } from "express";

declare global {
  namespace Express {
    interface Request {
      gatekit?: {
        identity: Identity;
        rateLimit?: Quota;
      };
    }
  }
}

function headersFrom(req: Request): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(name, value);
    else if (Array.isArray(value)) {
      const first = value[0];
      if (first !== undefined) headers.set(name, first);
    }
  }
  return headers;
}

export function gate(instance: Gate): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    void handle(instance, req, res, next);
  };
}

async function handle(
  instance: Gate,
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const decision = await instance.protect({ headers: headersFrom(req) });
    for (const name of Object.keys(decision.headers)) {
      const value = decision.headers[name];
      if (value !== undefined) res.setHeader(name, value);
    }
    if (decision.kind === "reject") {
      res.status(decision.status);
      res.setHeader("content-type", "application/problem+json");
      res.end(JSON.stringify(decision.problem));
      return;
    }
    req.gatekit = {
      identity: decision.identity,
      ...(decision.rateLimit === undefined ? {} : { rateLimit: decision.rateLimit }),
    };
    next();
  } catch (error) {
    next(error);
  }
}
