import type { Backend, KeyRecord, RateLimitResult } from "@gatekit/core";
import { applySlidingWindow, createLocalVerifier } from "@gatekit/core";

export function memory(options: { readonly keys: readonly KeyRecord[] }): Backend {
  const verifier = createLocalVerifier(options.keys);
  const buckets = new Map<string, readonly number[]>();
  const tails = new Map<string, Promise<void>>();

  return {
    async verifyKey({ key, now }) {
      return verifier.verify(key, now);
    },
    consume(input) {
      return exclusive(tails, input.identifier, () => {
        const current = buckets.get(input.identifier) ?? [];
        const next = applySlidingWindow(current, input);
        buckets.set(input.identifier, next.timestamps);
        const result: RateLimitResult = {
          success: next.success,
          limit: input.limit,
          remaining: next.remaining,
          reset: next.reset,
        };
        return result;
      });
    },
  };
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
