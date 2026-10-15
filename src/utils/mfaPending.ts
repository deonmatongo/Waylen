/**
 * Short-lived "password verified, second factor outstanding" cookie.
 *
 * HMAC-signed (SESSION_SECRET, domain-separated from the session cookie) and
 * carries only userId + expiry + nonce. It grants nothing on its own: the
 * matching nonce/attempt counter lives in the user's encrypted MFA blob
 * (mfa.service.ts), which is what makes it single-use and attempt-limited.
 */
import crypto from 'node:crypto';
import { env } from '../config/env.js';

export const MFA_PENDING_COOKIE = 'waylen.mfa';
export const MFA_PENDING_TTL_MS = 5 * 60 * 1000;

export interface MfaPending {
  userId: string;
  expiresAt: number;
  nonce: string;
}

function sign(payload: string): string {
  return crypto
    .createHmac('sha256', env.SESSION_SECRET)
    .update(`mfa-pending:${payload}`)
    .digest('base64url');
}

export function newNonce(): string {
  return crypto.randomBytes(16).toString('base64url');
}

export function signPending(p: MfaPending): string {
  const payload = Buffer.from(JSON.stringify({ u: p.userId, e: p.expiresAt, n: p.nonce })).toString(
    'base64url',
  );
  return `${payload}.${sign(payload)}`;
}

/** Null for anything missing, malformed, tampered with, or expired. */
export function verifyPending(value: string | undefined, nowMs = Date.now()): MfaPending | null {
  if (!value) return null;
  const i = value.lastIndexOf('.');
  if (i < 0) return null;
  const payload = value.slice(0, i);
  const a = Buffer.from(value.slice(i + 1));
  const b = Buffer.from(sign(payload));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const d = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      u?: unknown;
      e?: unknown;
      n?: unknown;
    };
    if (typeof d.u !== 'string' || typeof d.e !== 'number' || typeof d.n !== 'string') return null;
    if (d.e <= nowMs) return null;
    return { userId: d.u, expiresAt: d.e, nonce: d.n };
  } catch {
    return null;
  }
}

export const mfaPendingCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: env.isProduction,
  path: '/',
  maxAge: MFA_PENDING_TTL_MS,
};
