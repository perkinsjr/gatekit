import type { Quota } from "./types.js";

export function quoteStructuredField(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function windowSeconds(windowMs: number): number {
  return Math.max(1, Math.ceil(windowMs / 1000));
}

export function secondsUntil(resetMs: number, now: number): number {
  const delta = resetMs - now;
  if (delta <= 0) return 0;
  return Math.ceil(delta / 1000);
}

export function rateLimitHeaders(
  quota: Quota,
  now: number,
  denied: boolean,
): Record<string, string> {
  const name = quoteStructuredField(quota.name);
  const headers: Record<string, string> = {
    "RateLimit-Policy": `${name};q=${quota.limit};w=${windowSeconds(quota.windowMs)}`,
    RateLimit: `${name};r=${quota.remaining};t=${secondsUntil(quota.reset, now)}`,
  };
  if (denied) headers["Retry-After"] = String(secondsUntil(quota.reset, now));
  return headers;
}
