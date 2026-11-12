import { randomUUID } from "node:crypto";
import type { AdmitInput, Backend, Identity, KeyRecord, Quota } from "@gatekit/core";
import { createLocalVerifier } from "@gatekit/core";

export type RedisEvalClient = {
  eval(script: string, numkeys: number, ...args: Array<string | number>): Promise<unknown>;
};

const SLIDING_WINDOW = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])
local member = ARGV[5]

redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
local count = redis.call('ZCARD', key)

local function oldest_reset()
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  if oldest[2] == nil then
    return now + window
  end
  return tonumber(oldest[2]) + window
end

local function expire_at(reset)
  redis.call('PEXPIRE', key, math.max(1, reset - now))
end

if count + cost <= limit then
  for i = 1, cost do
    redis.call('ZADD', key, now, member .. ':' .. i)
  end
  local reset = oldest_reset()
  expire_at(reset)
  return {1, limit, limit - (count + cost), reset}
end

local reset = oldest_reset()
expire_at(reset)
return {0, limit, 0, reset}
`;

function readReply(value: unknown): {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
} {
  if (!Array.isArray(value) || value.length !== 4) throw new Error("unexpected redis reply");
  const numbers = value.map((part) => Number(part));
  const success = numbers[0];
  const limit = numbers[1];
  const remaining = numbers[2];
  const reset = numbers[3];
  if (
    success === undefined ||
    limit === undefined ||
    remaining === undefined ||
    reset === undefined ||
    !Number.isFinite(success) ||
    !Number.isFinite(limit) ||
    !Number.isFinite(remaining) ||
    !Number.isFinite(reset)
  ) {
    throw new Error("unexpected redis reply");
  }
  return { success: success === 1, limit, remaining, reset };
}

export function redis(options: {
  readonly client: RedisEvalClient;
  readonly keys: readonly KeyRecord[];
  readonly prefix?: string;
}): Backend {
  const verifier = createLocalVerifier(options.keys);
  const prefix = options.prefix ?? "gatekit";
  if (prefix.length === 0) throw new Error("prefix must be a non-empty string");

  return {
    async admit(input) {
      const verified = verifier.verify(input.key, input.now);
      if (!verified.ok) return verified;
      const rateLimit = input.rateLimit;
      if (rateLimit === undefined) return { ok: true, identity: verified.identity };

      const identifier = await resolveIdentifier(input, verified.identity);
      const reply = await options.client.eval(
        SLIDING_WINDOW,
        1,
        `${prefix}:rl:${identifier}`,
        String(input.now),
        String(rateLimit.windowMs),
        String(rateLimit.limit),
        String(rateLimit.cost),
        randomUUID(),
      );
      const result = readReply(reply);
      const quota: Quota = {
        name: rateLimit.name,
        limit: result.limit,
        remaining: result.remaining,
        reset: result.reset,
        windowMs: rateLimit.windowMs,
      };
      if (!result.success) return { ok: false, reason: "rate_limited", quota };
      return { ok: true, identity: verified.identity, rateLimit: quota };
    },
  };
}

async function resolveIdentifier(input: AdmitInput, identity: Identity): Promise<string> {
  const identifier = input.rateLimit?.identify
    ? await input.rateLimit.identify({ identity, headers: input.headers })
    : identity.keyId;
  if (typeof identifier !== "string" || identifier.length === 0) {
    throw new Error("rate limit identifier must be a non-empty string");
  }
  return identifier;
}
