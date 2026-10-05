/**
 * Mobile refresh-token flow (security audit follow-up).
 *
 * Access JWTs (utils/jwt.ts) are now short-lived (env.ACCESS_TOKEN_TTL_MINUTES)
 * so a leaked one expires quickly on its own. A refresh token trades for a new
 * access token — and a new refresh token, since every use rotates it. Only
 * the token's SHA-256 is ever stored (see the model doc in schema.prisma for
 * why a fast hash, not argon2, is the right call here).
 *
 * Reuse detection: rotating a token revokes it and records what replaced it.
 * If that same (now-revoked) token is presented again — a stale copy an
 * attacker captured mid-chain, replayed after the genuine client already
 * rotated past it — every token in its family is revoked immediately. A
 * single still-valid token being used twice is otherwise indistinguishable
 * from a compromise, so the whole chain is treated as burned rather than
 * trying to guess which copy is legitimate.
 */
import crypto from 'node:crypto';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { sha256, generateToken } from '../utils/crypto.js';
import { UnauthorizedError } from '../utils/errors.js';

export interface RefreshRequestMeta {
  userAgent?: string | null;
  ipAddress?: string | null;
}

export interface IssuedRefreshToken {
  token: string;
  expiresAt: Date;
}

export interface RotatedRefreshToken extends IssuedRefreshToken {
  userId: string;
}

function hashToken(token: string): string {
  return sha256(Buffer.from(token, 'utf8'));
}

function nextExpiry(): Date {
  return new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
}

export const refreshTokenService = {
  /** Issues the first token of a brand-new chain — i.e. a fresh login. */
  async issue(userId: string, meta: RefreshRequestMeta = {}): Promise<IssuedRefreshToken> {
    const token = generateToken();
    const expiresAt = nextExpiry();

    await prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        familyId: crypto.randomUUID(),
        userAgent: meta.userAgent ?? null,
        ipAddress: meta.ipAddress ?? null,
        expiresAt,
      },
    });

    return { token, expiresAt };
  },

  /**
   * Validates a presented refresh token and rotates it. Throws
   * UnauthorizedError for anything unknown, expired, or already-used; in the
   * already-used case the entire family is revoked first as a compromise
   * signal.
   */
  async rotate(presentedToken: string, meta: RefreshRequestMeta = {}): Promise<RotatedRefreshToken> {
    const tokenHash = hashToken(presentedToken);
    const row = await prisma.refreshToken.findUnique({ where: { tokenHash } });

    const invalid = new UnauthorizedError(
      'Your session has expired or was signed out elsewhere. Please sign in again.',
    );

    if (!row) throw invalid;

    if (row.revokedAt) {
      // Reuse of a token that was already rotated away (or already logged
      // out) — assume the chain is compromised and burn all of it, not just
      // this one token.
      await prisma.refreshToken.updateMany({
        where: { familyId: row.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw invalid;
    }

    if (row.expiresAt.getTime() < Date.now()) throw invalid;

    const newToken = generateToken();
    const newHash = hashToken(newToken);
    const expiresAt = nextExpiry();

    await prisma.$transaction([
      prisma.refreshToken.update({
        where: { id: row.id },
        data: { revokedAt: new Date(), replacedByHash: newHash },
      }),
      prisma.refreshToken.create({
        data: {
          userId: row.userId,
          tokenHash: newHash,
          familyId: row.familyId,
          userAgent: meta.userAgent ?? null,
          ipAddress: meta.ipAddress ?? null,
          expiresAt,
        },
      }),
    ]);

    return { userId: row.userId, token: newToken, expiresAt };
  },

  /** Logout: revokes the whole chain the presented token belongs to. Idempotent. */
  async revokeByToken(presentedToken: string): Promise<void> {
    const tokenHash = hashToken(presentedToken);
    const row = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: { familyId: true },
    });
    if (!row) return;

    await prisma.refreshToken.updateMany({
      where: { familyId: row.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  },

  /** Stretch goal: "sign out all other devices" — revokes every chain for this user. */
  async revokeAllForUser(userId: string): Promise<void> {
    await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  },
};
