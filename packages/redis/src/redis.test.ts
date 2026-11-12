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
        backend.consume({
          identifier: "shared",
          limit: 5,
          windowMs: 60_000,
          cost: 1,
          now: 50_000,
        }),
      ),
    );
    expect(results.filter((result) => result.success)).toHaveLength(5);
    await connection.del(...(await connection.keys(`${prefix}:rl:*`)));
  });

  it("refuses a cost that does not fit in the remaining quota", async (context) => {
    const connection = requireClient(context);
    const prefix = `gatekit:test:${crypto.randomUUID()}`;
    const backend = redis({
      client: connection as RedisEvalClient,
      keys: [],
      prefix,
    });
    const first = await backend.consume({
      identifier: "cost",
      limit: 5,
      windowMs: 1_000,
      cost: 3,
      now: 10,
    });
    const second = await backend.consume({
      identifier: "cost",
      limit: 5,
      windowMs: 1_000,
      cost: 3,
      now: 20,
    });
    const third = await backend.consume({
      identifier: "cost",
      limit: 5,
      windowMs: 1_000,
      cost: 2,
      now: 30,
    });
    expect(first).toMatchObject({ success: true, remaining: 2 });
    expect(second).toMatchObject({ success: false, remaining: 0 });
    expect(third).toMatchObject({ success: true, remaining: 0 });
    await connection.del(...(await connection.keys(`${prefix}:rl:*`)));
  });
});
