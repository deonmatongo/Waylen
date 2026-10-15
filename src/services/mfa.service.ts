/**
 * Staff TOTP two-factor: enrolment, login challenge, disable, admin reset.
 * State lives in User.mfaEnabled + the encrypted blob in User.mfaSecret
 * (utils/mfaBlob.ts). Every blob write is a compare-and-swap on the stored
 * ciphertext, so two concurrent submissions can't both consume the same
 * code / attempt slot.
 */
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import {
  MAX_PENDING_ATTEMPTS,
  checkCode,
  generateRecoveryCodes,
  openBlob,
  sealBlob,
  type MfaBlob,
} from '../utils/mfaBlob.js';
import { MFA_PENDING_TTL_MS, newNonce } from '../utils/mfaPending.js';
import { generateTotpSecret, otpauthUri } from '../utils/totp.js';
import { sessionService } from './session.service.js';
import { refreshTokenService } from './refreshToken.service.js';

/** Returns the newly stored ciphertext, or null if the row changed underneath us. */
async function cas(
  userId: string,
  oldStored: string | null,
  blob: MfaBlob,
  enable?: boolean,
): Promise<string | null> {
  const sealed = sealBlob(blob);
  const res = await prisma.user.updateMany({
    where: { id: userId, mfaSecret: oldStored },
    data: { mfaSecret: sealed, ...(enable === undefined ? {} : { mfaEnabled: enable }) },
  });
  return res.count === 1 ? sealed : null;
}

export type ChallengeResult =
  | { ok: true; kind: 'totp' | 'recovery' }
  | { ok: false; reason: 'invalid' | 'locked' | 'expired' };

export const mfaService = {
  async getState(userId: string) {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { mfaEnabled: true, mfaSecret: true, email: true, passwordHash: true },
    });
    return u;
  },

  /** Starts (or restarts) enrolment: a fresh seed, not yet enabled. */
  async beginEnrolment(userId: string, email: string) {
    const secret = generateTotpSecret();
    await prisma.user.update({
      where: { id: userId },
      data: { mfaSecret: sealBlob({ secret, recoveryHashes: [], lastCounter: null }) },
    });
    return { secret, uri: otpauthUri({ secret, account: email, issuer: env.APP_NAME }) };
  },

  /** Returns the pending seed for re-display (enrolment not yet confirmed). */
  pendingSecret(stored: string | null, email: string) {
    const blob = openBlob(stored);
    if (!blob) return null;
    return { secret: blob.secret, uri: otpauthUri({ secret: blob.secret, account: email, issuer: env.APP_NAME }) };
  },

  /** Confirms enrolment with a code; returns the one-time recovery codes. */
  async confirmEnrolment(userId: string, code: string): Promise<string[] | null> {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { mfaEnabled: true, mfaSecret: true },
    });
    if (!u || u.mfaEnabled) return null;
    const blob = openBlob(u.mfaSecret);
    if (!blob) return null;
    const check = checkCode({ ...blob, recoveryHashes: [] }, code);
    if (!check.ok || check.kind !== 'totp') return null;

    const { codes, hashes } = generateRecoveryCodes();
    const ok = await cas(userId, u.mfaSecret, { ...check.blob, recoveryHashes: hashes }, true);
    return ok !== null ? codes : null;
  },

  /** Disables MFA after the caller has verified the password; needs a valid code. */
  async disable(userId: string, code: string): Promise<boolean> {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { mfaEnabled: true, mfaSecret: true },
    });
    const blob = u?.mfaEnabled ? openBlob(u.mfaSecret) : null;
    if (!u || !blob || !checkCode(blob, code).ok) return false;
    const res = await prisma.user.updateMany({
      where: { id: userId, mfaSecret: u.mfaSecret },
      data: { mfaEnabled: false, mfaSecret: null },
    });
    return res.count === 1;
  },

  /** Super-admin reset for a locked-out member: clears MFA, signs them out everywhere. */
  async adminReset(userId: string): Promise<void> {
    await prisma.user.update({ where: { id: userId }, data: { mfaEnabled: false, mfaSecret: null } });
    await sessionService.revokeAllForUser(userId);
    await refreshTokenService.revokeAllForUser(userId);
  },

  /** Opens a login challenge; returns the nonce for the pending cookie. */
  async startChallenge(userId: string): Promise<{ nonce: string; expiresAt: number } | null> {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { mfaEnabled: true, mfaSecret: true },
    });
    const blob = u?.mfaEnabled ? openBlob(u.mfaSecret) : null;
    if (!u || !blob) return null;
    const nonce = newNonce();
    const expiresAt = Date.now() + MFA_PENDING_TTL_MS;
    const ok = await cas(userId, u.mfaSecret, { ...blob, pending: { nonce, attempts: 0, expiresAt } });
    return ok !== null ? { nonce, expiresAt } : null;
  },

  /**
   * Counts the attempt first (so parallel guesses can't dodge the cap), then
   * verifies. Success clears the challenge, making the cookie single-use.
   */
  async verifyChallenge(userId: string, nonce: string, code: string): Promise<ChallengeResult> {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { mfaEnabled: true, mfaSecret: true },
    });
    const blob = u?.mfaEnabled ? openBlob(u.mfaSecret) : null;
    const p = blob?.pending;
    if (!u || !blob || !p || p.nonce !== nonce || p.expiresAt <= Date.now()) {
      return { ok: false, reason: 'expired' };
    }
    if (p.attempts >= MAX_PENDING_ATTEMPTS) return { ok: false, reason: 'locked' };

    const counted: MfaBlob = { ...blob, pending: { ...p, attempts: p.attempts + 1 } };
    const countedStored = await cas(userId, u.mfaSecret, counted);
    if (countedStored === null) return { ok: false, reason: 'invalid' };

    const check = checkCode(blob, code);
    if (!check.ok) return { ok: false, reason: 'invalid' };

    const done = await cas(userId, countedStored, { ...check.blob, pending: null });
    return done !== null ? { ok: true, kind: check.kind } : { ok: false, reason: 'invalid' };
  },
};
