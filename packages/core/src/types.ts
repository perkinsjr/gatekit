export type Identity = {
  readonly keyId: string;
  readonly name?: string;
  readonly externalId?: string;
  readonly meta: Readonly<Record<string, unknown>>;
  readonly expiresAt?: number;
  readonly permissions: readonly string[];
};

export type KeyRecord = {
  readonly key: string;
  readonly keyId?: string;
  readonly name?: string;
  readonly externalId?: string;
  readonly meta?: Readonly<Record<string, unknown>>;
  readonly permissions?: readonly string[];
  readonly expiresAt?: number;
  readonly enabled?: boolean;
};

export type Quota = {
  readonly name: string;
  readonly limit: number;
  readonly remaining: number;
  readonly reset: number;
  readonly windowMs: number;
};

export type Admission =
  | { readonly ok: true; readonly identity: Identity; readonly rateLimit?: Quota }
  | { readonly ok: false; readonly reason: "unauthorized" }
  | { readonly ok: false; readonly reason: "rate_limited"; readonly quota: Quota };

export type AdmitRateLimit = {
  readonly name: string;
  readonly limit: number;
  readonly windowMs: number;
  readonly cost: number;
  readonly identify?: (input: {
    readonly identity: Identity;
    readonly headers: Headers;
  }) => string | Promise<string>;
};

export type AdmitInput = {
  readonly key: string;
  readonly now: number;
  readonly headers: Headers;
  readonly rateLimit?: AdmitRateLimit;
};

export type Backend = {
  admit(input: AdmitInput): Promise<Admission>;
};

export type Problem = {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly limit?: number;
  readonly remaining?: number;
  readonly reset?: number;
};

export type AllowDecision = {
  readonly kind: "allow";
  readonly identity: Identity;
  readonly rateLimit?: Quota;
  readonly headers: Readonly<Record<string, string>>;
};

export type RejectDecision = {
  readonly kind: "reject";
  readonly status: 401 | 429 | 503;
  readonly problem: Problem;
  readonly headers: Readonly<Record<string, string>>;
};

export type Decision = AllowDecision | RejectDecision;

export type ProtectInput = {
  readonly headers: Headers;
};

export type Gate = {
  protect(input: ProtectInput): Promise<Decision>;
};

export type RateLimitOptions = {
  readonly limit: number;
  readonly windowMs: number;
  readonly name?: string;
  readonly cost?: number;
  readonly identify?: AdmitRateLimit["identify"];
};

export type KeySourceOptions = {
  readonly header?: string;
  readonly scheme?: string | null;
};

export type GateOptions = {
  readonly backend: Backend;
  readonly keys?: KeySourceOptions;
  readonly rateLimit?: RateLimitOptions;
  readonly now?: () => number;
};

export type SlidingWindowInput = {
  readonly now: number;
  readonly windowMs: number;
  readonly limit: number;
  readonly cost: number;
};

export type SlidingWindowState = {
  readonly timestamps: readonly number[];
  readonly success: boolean;
  readonly remaining: number;
  readonly reset: number;
};
