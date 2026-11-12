import { describe, expect, it } from "vitest";
import { applySlidingWindow } from "./window.js";

describe("applySlidingWindow", () => {
  it("drops an event once the window has fully elapsed", () => {
    const first = applySlidingWindow([], { now: 900, windowMs: 1000, limit: 1, cost: 1 });
    expect(first.success).toBe(true);
    expect(first.remaining).toBe(0);
    expect(first.reset).toBe(1900);

    const stillInside = applySlidingWindow(first.timestamps, {
      now: 1899,
      windowMs: 1000,
      limit: 1,
      cost: 1,
    });
    expect(stillInside.success).toBe(false);
    expect(stillInside.remaining).toBe(0);
    expect(stillInside.reset).toBe(1900);

    const onTheBoundary = applySlidingWindow(stillInside.timestamps, {
      now: 1900,
      windowMs: 1000,
      limit: 1,
      cost: 1,
    });
    expect(onTheBoundary.success).toBe(true);
    expect(onTheBoundary.remaining).toBe(0);
    expect(onTheBoundary.reset).toBe(2900);
  });

  it("keeps the earlier event when a fixed window would already have reset", () => {
    const first = applySlidingWindow([], { now: 900, windowMs: 1000, limit: 1, cost: 1 });
    const atNextBucket = applySlidingWindow(first.timestamps, {
      now: 1000,
      windowMs: 1000,
      limit: 1,
      cost: 1,
    });
    expect(atNextBucket.success).toBe(false);
    expect(atNextBucket.reset).toBe(1900);
  });

  it("does not record a partial cost", () => {
    const first = applySlidingWindow([], { now: 0, windowMs: 1000, limit: 5, cost: 3 });
    expect(first.success).toBe(true);
    expect(first.remaining).toBe(2);

    const second = applySlidingWindow(first.timestamps, {
      now: 10,
      windowMs: 1000,
      limit: 5,
      cost: 3,
    });
    expect(second.success).toBe(false);
    expect(second.remaining).toBe(0);
    expect(second.timestamps).toEqual(first.timestamps);

    const after = applySlidingWindow(second.timestamps, {
      now: 20,
      windowMs: 1000,
      limit: 5,
      cost: 2,
    });
    expect(after.success).toBe(true);
    expect(after.remaining).toBe(0);
  });

  it("denies every event when the limit is zero", () => {
    const denied = applySlidingWindow([], { now: 50, windowMs: 1000, limit: 0, cost: 1 });
    expect(denied.success).toBe(false);
    expect(denied.remaining).toBe(0);
    expect(denied.timestamps).toEqual([]);
    expect(denied.reset).toBe(1050);
  });

  it("never accepts more than the limit inside any window", () => {
    let timestamps: readonly number[] = [];
    const accepted: number[] = [];
    const limit = 3;
    const windowMs = 10;
    for (let now = 0; now < 100; now += 1) {
      const next = applySlidingWindow(timestamps, { now, windowMs, limit, cost: 1 });
      timestamps = next.timestamps;
      if (next.success) accepted.push(now);
    }
    for (const now of accepted) {
      const inWindow = accepted.filter((earlier) => earlier <= now && now - earlier < windowMs);
      expect(inWindow.length).toBeLessThanOrEqual(limit);
    }
    expect(accepted.length).toBeGreaterThan(limit);
  });
});
