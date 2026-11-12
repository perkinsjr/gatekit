import { createGate } from "@gatekit/core";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type RedisEvalClient, redis } from "./index.js";

const url = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

describe("redis backend", () => {
  let client: Redis | undefined;
  let skip = false;

  beforeAll(async () => {
    const candidate = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 1000,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });
    try {
      await candidate.connect();
      const pong = await candidate.ping();
      if (pong !== "PONG") throw new Error(`unexpected ping reply ${pong}`);
      client = candidate;
    } catch (error) {
      candidate.disconnect();
      if (process.env.REDIS_URL) throw error;
      skip = true;
    }
  });

  afterAll(async () => {
    if (client) await client.quit();
  });

  function requireClient(context: { skip: () => void }): Redis {
    if (skip || client === undefined) {
      context.skip();
      throw new Error("redis skipped");
    }
    return client;
  }

  it("enforces the same boundary as the in-process window", async (context) => {
    const connection = requireClient(context);
    const prefix = `gatekit:test:${crypto.randomUUID()}`;
    const backend = redis({
      client: connection as RedisEvalClient,
      keys: [{ key: "sk_live", keyId: "key_live" }],
      prefix,
    });
    const gate = createGate({
      backend,
      now: () => 900,
      rateLimit: { limit: 1, windowMs: 1_000 },
    });
    const headers = new Headers({ authorization: "Bearer sk_live" });
    expect((await gate.protect({ headers })).kind).toBe("allow");

    const atFixedBoundary = createGate({
      backend,
      now: () => 1000,
      rateLimit: { limit: 1, windowMs: 1_000 },
    });
    const blocked = await atFixedBoundary.protect({ headers });
    expect(blocked).toMatchObject({
      kind: "reject",
      status: 429,
      headers: { "Retry-After": "1" },
    });

    const released = createGate({
      backend,
      now: () => 1900,
      rateLimit: { limit: 1, windowMs: 1_000 },
    });
    expect((await released.protect({ headers })).kind).toBe("allow");
    await connection.del(...(await connection.keys(`${prefix}:rl:*`)));
  });

  it("allows only the limit under concurrent evals", async (context) => {
    const connection = requireClient(context);
    const prefix = `gatekit:test:${crypto.randomUUID()}`;
    const backend = redis({
      client: connection as RedisEvalClient,
      keys: [{ key: "sk_live", keyId: "key_live" }],
      prefix,
    });
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        backend.admit({
          key: "sk_live",
          now: 50_000,
          headers: new Headers(),
          rateLimit: { name: "default", limit: 5, windowMs: 60_000, cost: 1 },
        }),
      ),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(5);
    await connection.del(...(await connection.keys(`${prefix}:rl:*`)));
  });

  it("refuses a cost that does not fit in the remaining quota", async (context) => {
    const connection = requireClient(context);
    const prefix = `gatekit:test:${crypto.randomUUID()}`;
    const backend = redis({
      client: connection as RedisEvalClient,
      keys: [{ key: "sk_cost", keyId: "key_cost" }],
      prefix,
    });
    const admit = (now: number, cost: number) =>
      backend.admit({
        key: "sk_cost",
        now,
        headers: new Headers(),
        rateLimit: { name: "default", limit: 5, windowMs: 1_000, cost },
      });
    const first = await admit(10, 3);
    const second = await admit(20, 3);
    const third = await admit(30, 2);
    expect(first).toMatchObject({ ok: true, rateLimit: { remaining: 2 } });
    expect(second).toMatchObject({ ok: false, reason: "rate_limited", quota: { remaining: 0 } });
    expect(third).toMatchObject({ ok: true, rateLimit: { remaining: 0 } });
    await connection.del(...(await connection.keys(`${prefix}:rl:*`)));
  });
});
