import { createHash, timingSafeEqual } from "node:crypto";
import type { Identity, KeyRecord, VerifyResult } from "./types.js";

type StoredKey = {
  readonly hash: Buffer;
  readonly identity: Identity;
  readonly enabled: boolean;
};

function hashKey(key: string): Buffer {
  return createHash("sha256").update(key).digest();
}

function assertPlainObject(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a plain object`);
  }
  return value as Record<string, unknown>;
}

export function createLocalVerifier(records: readonly KeyRecord[]): {
  verify(key: string, now: number): VerifyResult;
} {
  const stored: StoredKey[] = [];
  const seenIds = new Set<string>();
  const seenHashes = new Set<string>();

  for (const record of records) {
    if (typeof record.key !== "string" || record.key.length === 0) {
      throw new Error("key must be a non-empty string");
    }
    const hash = hashKey(record.key);
    const hashHex = hash.toString("hex");
    if (seenHashes.has(hashHex)) throw new Error("duplicate key");
    seenHashes.add(hashHex);

    const keyId = record.keyId ?? `key_${hashHex.slice(0, 16)}`;
    if (keyId.length === 0) throw new Error("keyId must be a non-empty string");
    if (seenIds.has(keyId)) throw new Error(`duplicate keyId ${keyId}`);
    seenIds.add(keyId);

    if (record.expiresAt !== undefined && !Number.isFinite(record.expiresAt)) {
      throw new Error("expiresAt must be a finite number");
    }
    if (record.enabled !== undefined && typeof record.enabled !== "boolean") {
      throw new Error("enabled must be a boolean");
    }

    const permissions: string[] = [];
    for (const permission of record.permissions ?? []) {
      if (typeof permission !== "string") throw new Error("permissions must be strings");
      permissions.push(permission);
    }
    if (record.name !== undefined && typeof record.name !== "string") {
      throw new Error("name must be a string");
    }
    if (record.externalId !== undefined && typeof record.externalId !== "string") {
      throw new Error("externalId must be a string");
    }

    const identity: Identity = {
      keyId,
      meta: record.meta === undefined ? {} : { ...assertPlainObject(record.meta, "meta") },
      permissions,
      ...(typeof record.name === "string" ? { name: record.name } : {}),
      ...(typeof record.externalId === "string" ? { externalId: record.externalId } : {}),
      ...(record.expiresAt !== undefined ? { expiresAt: record.expiresAt } : {}),
    };

    stored.push({
      hash,
      identity,
      enabled: record.enabled ?? true,
    });
  }

  return {
    verify(key: string, now: number): VerifyResult {
      const incoming = hashKey(key);
      let match: StoredKey | undefined;
      for (const candidate of stored) {
        if (timingSafeEqual(incoming, candidate.hash)) match = candidate;
      }
      if (match === undefined || !match.enabled) return { ok: false, reason: "unauthorized" };
      if (match.identity.expiresAt !== undefined && match.identity.expiresAt <= now) {
        return { ok: false, reason: "unauthorized" };
      }
      return {
        ok: true,
        identity: {
          ...match.identity,
          meta: { ...match.identity.meta },
          permissions: [...match.identity.permissions],
        },
      };
    },
  };
}
