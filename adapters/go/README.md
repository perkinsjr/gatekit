# Go net/http adapter

This directory is the place for a later `net/http` adapter. It is not implemented.

The adapter should be a middleware with this shape.

```go
func Gate(g *gatekit.Gate) func(http.Handler) http.Handler
```

`Gate` reads the same header rules as `@gatekit/core`. On success it stores the identity where the next handler can read it. On failure it writes the response itself and does not call the next handler.

The response contract matches the TypeScript packages.

- `401` with `Content-Type: application/problem+json` and `type` `urn:gatekit:problem:unauthorized` when the key is missing or rejected.
- `429` with `urn:gatekit:problem:rate-limited`, `Retry-After`, `RateLimit`, and `RateLimit-Policy` when the sliding window is full.
- `503` with `urn:gatekit:problem:backend-unavailable` when the backend returns an error.
- `RateLimit` and `RateLimit-Policy` on allowed responses when a limit is configured.

The window rule is the same one documented in the root README. An event at time T counts while `now - T < window`, and it no longer counts when `now - T == window`.
