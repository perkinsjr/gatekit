import { rateLimitHeaders } from "./headers.js";
import type { Decision, Quota, RejectDecision } from "./types.js";

export const PROBLEM_UNAUTHORIZED = "urn:gatekit:problem:unauthorized";
export const PROBLEM_RATE_LIMITED = "urn:gatekit:problem:rate-limited";
export const PROBLEM_UNAVAILABLE = "urn:gatekit:problem:backend-unavailable";

export function unauthorizedDecision(): RejectDecision {
  return {
    kind: "reject",
    status: 401,
    headers: {},
    problem: {
      type: PROBLEM_UNAUTHORIZED,
      title: "Unauthorized",
      status: 401,
      detail: "API key is missing or invalid.",
    },
  };
}

export function rateLimitedDecision(quota: Quota, now: number): RejectDecision {
  return {
    kind: "reject",
    status: 429,
    headers: rateLimitHeaders(quota, now, true),
    problem: {
      type: PROBLEM_RATE_LIMITED,
      title: "Too Many Requests",
      status: 429,
      detail: "Rate limit exceeded.",
      limit: quota.limit,
      remaining: quota.remaining,
      reset: quota.reset,
    },
  };
}

export function unavailableDecision(): RejectDecision {
  return {
    kind: "reject",
    status: 503,
    headers: {},
    problem: {
      type: PROBLEM_UNAVAILABLE,
      title: "Backend unavailable",
      status: 503,
      detail: "The auth backend could not complete the request.",
    },
  };
}

export function toResponse(decision: Extract<Decision, { kind: "reject" }>): Response {
  const headers = new Headers();
  for (const [name, value] of Object.entries(decision.headers)) {
    headers.set(name, value);
  }
  headers.set("content-type", "application/problem+json");
  return new Response(JSON.stringify(decision.problem), {
    status: decision.status,
    headers,
  });
}
