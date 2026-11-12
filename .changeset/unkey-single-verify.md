---
"@gatekit/core": minor
"@gatekit/memory": patch
"@gatekit/redis": patch
"@gatekit/unkey": minor
---

Verify and rate limit through one backend step. The Unkey backend sends that limit on keys.verifyKey and no longer calls ratelimit.limit.
