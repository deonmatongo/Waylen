/**
 * The MFA state kept, encrypted as one JSON blob, in User.mfaSecret (no
 * schema change needed): the TOTP seed, SHA-256 hashes of the unused
 * recovery codes, the last accepted TOTP counter (replay protection) and,
 * during a login, the pending-challenge nonce + attempt counter.
 *
 * Pure (no DB) so it is unit-testable; mfa.service.ts persists it.
 */
import crypto from 'node:crypto';
import { encryptSecret, decryptSecret } from './crypto.js';
import { verifyTotp } from './totp.js';

export const RECOVERY_CODE_COUNT = 10;
export const MAX_PENDING_ATTEMPTS = 5;

export interface MfaBlob {
  secret: string;
  recoveryHashes: string[];
  lastCounter: number | null;
  pending?: { nonce: string; attempts: number; expiresAt: number } | null;
}

export function sealBlob(blob: MfaBlob): string {
  return encryptSecret(JSON.stringify(blob));
}

/** Null when absent, tampered with, or not a valid blob. */
export function openBlob(stored: string | null | undefined): MfaBlob | null {
  if (!stored) return null;
  try {
    const b = JSON.parse(decryptSecret(stored)) as Partial<MfaBlob>;
    if (typeof b.secret !== 'string' || !Array.isArray(b.recoveryHashes)) return null;
    return {
      secret: b.secret,
      recoveryHashes: b.recoveryHashes.filter((h): h is string => typeof h === 'string'),
      lastCounter: typeof b.lastCounter === 'number' ? b.lastCounter : null,
      pending: b.pending ?? null,
    };
  } catch {
    return null;
  }
}

const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function normaliseRecoveryCode(code: string): string {
  return code.toLowerCase().replace(/[\s-]/g, '');
}

export function hashRecoveryCode(code: string): string {
  return crypto.createHash('sha256').update(normaliseRecoveryCode(code)).digest('hex');
}

/** Ten `xxxxx-xxxxx` codes (~49 bits each) plus the hashes to store. */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): {
  codes: string[];
  hashes: string[];
} {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    let raw = '';
    for (let j = 0; j < 10; j++) raw += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return { codes, hashes: codes.map(hashRecoveryCode) };
}

/** Returns the blob without the matching code (single use), or null if none match. */
export function consumeRecoveryCode(blob: MfaBlob, code: string): MfaBlob | null {
  const given = Buffer.from(hashRecoveryCode(code));
  let index = -1;
  blob.recoveryHashes.forEach((h, i) => {
    const hb = Buffer.from(h);
    if (hb.length === given.length && crypto.timingSafeEqual(hb, given)) index = i;
  });
  if (index < 0) return null;
  return { ...blob, recoveryHashes: blob.recoveryHashes.filter((_, i) => i !== index) };
}

export type CodeCheck =
  | { ok: true; kind: 'totp' | 'recovery'; blob: MfaBlob }
  | { ok: false };

/** Accepts a TOTP code (with replay protection) or a recovery code (consumed). */
export function checkCode(blob: MfaBlob, code: string, nowMs = Date.now()): CodeCheck {
  const counter = verifyTotp(blob.secret, code, { nowMs, lastUsedCounter: blob.lastCounter });
  if (counter !== null) return { ok: true, kind: 'totp', blob: { ...blob, lastCounter: counter } };

  const consumed = consumeRecoveryCode(blob, code);
  if (consumed) return { ok: true, kind: 'recovery', blob: consumed };
  return { ok: false };
}
