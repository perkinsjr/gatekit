import type { SlidingWindowInput, SlidingWindowState } from "./types.js";

function oldestReset(timestamps: readonly number[], now: number, windowMs: number): number {
  let oldest = timestamps[0];
  if (oldest === undefined) return now + windowMs;
  for (const timestamp of timestamps) {
    if (timestamp < oldest) oldest = timestamp;
  }
  return oldest + windowMs;
}

export function applySlidingWindow(
  timestamps: readonly number[],
  input: SlidingWindowInput,
): SlidingWindowState {
  const cutoff = input.now - input.windowMs;
  const kept: number[] = [];
  for (const timestamp of timestamps) {
    if (timestamp > cutoff) kept.push(timestamp);
  }

  if (kept.length + input.cost <= input.limit) {
    const next = kept.slice();
    for (let i = 0; i < input.cost; i += 1) next.push(input.now);
    return {
      timestamps: next,
      success: true,
      remaining: input.limit - next.length,
      reset: oldestReset(next, input.now, input.windowMs),
    };
  }

  return {
    timestamps: kept,
    success: false,
    remaining: 0,
    reset: oldestReset(kept, input.now, input.windowMs),
  };
}
