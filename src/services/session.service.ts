/**
 * Server-side session records behind the signed session cookie.
 *
 * The cookie (middleware/session.ts) still carries the session payload
 * directly, so most of it is read with no DB round trip. It also carries a
 * `sessionId`, which loadCurrentUser (middleware/auth.ts) checks against this
 * table on every authenticated request (piggy-backing on the DB round trip
 * that already happens there to load the user) — that is what lets logout
 * revoke one specific session without affecting the user's other devices,
 * which a global mechanism like User.passwordChangedAt cannot do.
 */
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';

export interface SessionMeta {
  userId: string;
  userAgent?: string | null;
  ipAddress?: string | null;
}

export interface SessionRecordCheck {
  userId: string;
  revokedAt: Date | null;
  expiresAt: Date;
}

/** True only for a row that exists, belongs to this user, and is neither revoked nor expired. */
export function isSessionRecordActive(
  row: SessionRecordCheck | null,
  userId: string,
): boolean {
  if (!row) return false;
  if (row.userId !== userId) return false;
  if (row.revokedAt) return false;
  if (row.expiresAt.getTime() < Date.now()) return false;
  return true;
}

export const sessionService = {
  /** Creates the server-side record for a new login; returns its id for the cookie. */
  async create(meta: SessionMeta): Promise<{ id: string }> {
    const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 3600_000);
    return prisma.session.create({
      data: {
        userId: meta.userId,
        userAgent: meta.userAgent ?? null,
        ipAddress: meta.ipAddress ?? null,
        expiresAt,
      },
      select: { id: true },
    });
  },

  /** Fetches just the fields loadCurrentUser needs to decide whether a session is still good. */
  async find(sessionId: string): Promise<SessionRecordCheck | null> {
    return prisma.session.findUnique({
      where: { id: sessionId },
      select: { userId: true, revokedAt: true, expiresAt: true },
    });
  },

  /** Logout: revokes exactly this one session. Idempotent — a second call is a no-op. */
  async revoke(sessionId: string): Promise<void> {
    await prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  },

  /**
   * Stretch goal: "sign out all other devices." Revokes every active session
   * for this user except (optionally) the current one.
   */
  async revokeAllForUser(userId: string, exceptSessionId?: string): Promise<void> {
    await prisma.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revokedAt: new Date() },
    });
  },
};
