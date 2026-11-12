# gatekit

gatekit checks API keys and applies a sliding-window rate limit in front of an HTTP API. The storage backend is an argument. Memory and Redis run without an Unkey account. The Unkey backend calls Unkey's public API for verification and rate limits, so moving a service there is a one-line change.

## Quickstart

```bash
pnpm add @gatekit/core @gatekit/memory @gatekit/hono hono
```

```ts
import { createGate } from "@gatekit/core";
import { gate } from "@gatekit/hono";
import { memory } from "@gatekit/memory";
import { Hono } from "hono";

const app = new Hono();

app.use(
  "*",
  gate(
    createGate({
      backend: memory({
        keys: [{ key: "sk_local_dev", keyId: "key_local" }],
      }),
      rateLimit: { limit: 10, windowMs: 60_000 },
    }),
  ),
);

app.get("/", (c) => c.json({ ok: true }));
```

A request without `Authorization: Bearer <key>` gets `401` and this body.

```json
{
  "type": "urn:gatekit:problem:unauthorized",
  "title": "Unauthorized",
  "status": 401,
  "detail": "API key is missing or invalid."
}
```

The same body is returned for an unknown, disabled, or expired key. After a valid key is over its limit, the response is `429` with `Retry-After`, `RateLimit`, and `RateLimit-Policy`.

Express uses `gate` from `@gatekit/express` and reads `req.gatekit.identity`. Next.js route handlers use `withGate` from `@gatekit/next`. See `examples/` for a runnable server of each.

## Switch the backend to Unkey

Keep `createGate` and change the backend argument.

```ts
import { unkey } from "@gatekit/unkey";

const gate = createGate({
  backend: unkey({ rootKey: process.env.UNKEY_ROOT_KEY ?? "" }),
  rateLimit: { limit: 10, windowMs: 60_000 },
});
```

`UNKEY_ROOT_KEY` needs permission to verify keys and to call `ratelimit.limit` in the `gatekit` namespace. Pass `namespace` if you already have one. The limit in `rateLimit` is sent on each `ratelimit.limit` call. A key that Unkey itself marks `RATE_LIMITED` during verification returns `429` and does not consume the gate limit again. A failed call to Unkey returns `503` and is not retried inside the middleware.

## Redis

Redis stores the sliding window. Key records stay in the process, same as the memory backend.

```ts
import { redis } from "@gatekit/redis";
import { Redis } from "ioredis";

const backend = redis({
  client: new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379"),
  keys: [{ key: "sk_local_dev", keyId: "key_local" }],
});
```

The client must implement `eval(script, numkeys, ...args)`. That is the ioredis signature.

## Packages

| Package            | Role                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| `@gatekit/core`    | `createGate`, the sliding window, problem bodies, and rate-limit headers. No framework imports. |
| `@gatekit/memory`  | Keys and windows in the process.                                                                |
| `@gatekit/redis`   | Keys in the process, windows in Redis.                                                          |
| `@gatekit/unkey`   | Verify and rate limit through `@unkey/api`.                                                     |
| `@gatekit/hono`    | Hono middleware. Sets `c.get("gatekit")`.                                                       |
| `@gatekit/express` | Express middleware. Sets `req.gatekit`.                                                         |
| `@gatekit/next`    | `withGate` for App Router route handlers.                                                       |

## Window

`limit` requests are allowed in the trailing `windowMs` milliseconds. An event recorded at time T still counts while `now - T < windowMs`. It stops counting when `now - T == windowMs`. A request whose `cost` does not fit is rejected and is not recorded. The default cost is 1.

`RateLimit` and `RateLimit-Policy` follow draft-ietf-httpapi-ratelimit-headers-11. `w` and `t` are whole seconds, rounded up. The counters use milliseconds.

```
RateLimit-Policy: "default";q=10;w=60
RateLimit: "default";r=7;t=30
```

## Errors

| Status | `type`                                    | When                                                                                               |
| ------ | ----------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 401    | `urn:gatekit:problem:unauthorized`        | The key is missing or rejected.                                                                    |
| 429    | `urn:gatekit:problem:rate-limited`        | The window is full. The body adds `limit`, `remaining`, and `reset`. `reset` is unix milliseconds. |
| 503    | `urn:gatekit:problem:backend-unavailable` | The backend threw.                                                                                 |

`Content-Type` is `application/problem+json`.

## Configuration

`keys.header` defaults to `authorization`. `keys.scheme` defaults to `bearer`. Set `scheme` to `null` to use the raw header value, which is what you want for `x-api-key`.

`rateLimit.identify` replaces the default bucket id, which is `identity.keyId`. The string you return is the Redis key suffix and the Unkey identifier. Invalid keys do not consume a bucket.

`now` injects the clock. Tests use it. Production can leave it unset.

## Development

Node 22 and pnpm 10.

```bash
pnpm install
pnpm test
pnpm lint
pnpm build
pnpm examples
```

Redis tests run against `REDIS_URL` or `redis://127.0.0.1:6379`. They fail when `REDIS_URL` is set and Redis is down. They are skipped when `REDIS_URL` is unset and nothing is listening. Unkey tests mock HTTP.

A Go `net/http` adapter is not included. The contract for it is in `adapters/go/README.md`.
