import type { AdmitInput, Backend, Identity, KeyRecord, Quota } from "@gatekit/core";
import { applySlidingWindow, createLocalVerifier } from "@gatekit/core";

export function memory(options: { readonly keys: readonly KeyRecord[] }): Backend {
  const verifier = createLocalVerifier(options.keys);
  const buckets = new Map<string, readonly number[]>();
  const tails = new Map<string, Promise<void>>();

  return {
    async admit(input) {
      const verified = verifier.verify(input.key, input.now);
      if (!verified.ok) return verified;
      const rateLimit = input.rateLimit;
      if (rateLimit === undefined) return { ok: true, identity: verified.identity };

      const identifier = await resolveIdentifier(input, verified.identity);
      const next = await exclusive(tails, identifier, () => {
        const current = buckets.get(identifier) ?? [];
        const applied = applySlidingWindow(current, {
          now: input.now,
          windowMs: rateLimit.windowMs,
          limit: rateLimit.limit,
          cost: rateLimit.cost,
        });
        buckets.set(identifier, applied.timestamps);
        return applied;
      });
      const quota: Quota = {
        name: rateLimit.name,
        limit: rateLimit.limit,
        remaining: next.remaining,
        reset: next.reset,
        windowMs: rateLimit.windowMs,
      };
      if (!next.success) return { ok: false, reason: "rate_limited", quota };
      return { ok: true, identity: verified.identity, rateLimit: quota };
    },
  };
}

async function resolveIdentifier(input: AdmitInput, identity: Identity): Promise<string> {
  const rateLimit = input.rateLimit;
  const identifier = rateLimit?.identify
    ? await rateLimit.identify({ identity, headers: input.headers })
    : identity.keyId;
  if (typeof identifier !== "string" || identifier.length === 0) {
    throw new Error("rate limit identifier must be a non-empty string");
  }
  return identifier;
}

function exclusive<T>(tails: Map<string, Promise<void>>, key: string, fn: () => T): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  tails.set(key, tail);
  const run = previous.then(fn, fn);
  void run.then(
    () => release(),
    () => release(),
  );
  return run;
}
