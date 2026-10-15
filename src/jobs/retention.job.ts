/**
 * Data retention sweep (PRD §8.2).
 *
 * Idempotent: every pass only touches rows past a cutoff, so re-running (or a
 * Vercel retry) is harmless. Deletes are batched — find up to BATCH_SIZE ids,
 * delete them, repeat — so one run never holds a long lock or exceeds a
 * serverless time limit; MAX_BATCHES caps the work per table per run and the
 * next scheduled run picks up the remainder.
 *
 * `RETENTION_AUDIT_DAYS` is read straight from process.env (default 730)
 * because config/env.ts does not declare it yet.
 */
import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';

const DAY = 86_400_000;
const BATCH_SIZE = 1000;
const MAX_BATCHES = 50;

const SESSION_GRACE_DAYS = 30;
const READ_NOTIFICATION_DAYS = 180;
const DEFAULT_AUDIT_DAYS = 730;

export interface RetentionResult {
  sessions: number;
  refreshTokens: number;
  verificationTokens: number;
  passwordResetTokens: number;
  notifications: number;
  auditLogs: number;
}

/** Parses RETENTION_AUDIT_DAYS; anything missing, non-numeric or < 1 falls back to the default. */
export function resolveAuditRetentionDays(raw: string | undefined = process.env.RETENTION_AUDIT_DAYS): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : DEFAULT_AUDIT_DAYS;
}

async function batched(
  label: string,
  find: (take: number) => Promise<{ id: string }[]>,
  apply: (ids: string[]) => Promise<{ count: number }>,
): Promise<number> {
  let total = 0;
  for (let i = 0; i < MAX_BATCHES; i += 1) {
    const rows = await find(BATCH_SIZE);
    if (rows.length === 0) return total;

    const { count } = await apply(rows.map((r) => r.id));
    total += count;
    if (rows.length < BATCH_SIZE) return total;
  }
  logger.warn({ table: label, total }, 'Retention batch cap reached; remainder deferred to next run');
  return total;
}

export async function runRetention(now: Date = new Date()): Promise<RetentionResult> {
  const sessionCutoff = new Date(now.getTime() - SESSION_GRACE_DAYS * DAY);
  const notificationCutoff = new Date(now.getTime() - READ_NOTIFICATION_DAYS * DAY);
  const auditCutoff = new Date(now.getTime() - resolveAuditRetentionDays() * DAY);

  const stale = { OR: [{ expiresAt: { lt: sessionCutoff } }, { revokedAt: { lt: sessionCutoff } }] };

  const sessions = await batched(
    'sessions',
    (take) => prisma.session.findMany({ where: stale, select: { id: true }, take }),
    (ids) => prisma.session.deleteMany({ where: { id: { in: ids } } }),
  );

  const refreshTokens = await batched(
    'refreshTokens',
    (take) => prisma.refreshToken.findMany({ where: stale, select: { id: true }, take }),
    (ids) => prisma.refreshToken.deleteMany({ where: { id: { in: ids } } }),
  );

  // Expired single-use tokens: clear the token and its expiry. Clearing makes
  // the row drop out of the filter, so the loop terminates.
  const verificationTokens = await batched(
    'verificationTokens',
    (take) =>
      prisma.user.findMany({
        where: { verificationToken: { not: null }, verificationExpiresAt: { lt: now } },
        select: { id: true },
        take,
      }),
    (ids) =>
      prisma.user.updateMany({
        where: { id: { in: ids } },
        data: { verificationToken: null, verificationExpiresAt: null },
      }),
  );

  const passwordResetTokens = await batched(
    'passwordResetTokens',
    (take) =>
      prisma.user.findMany({
        where: { passwordResetToken: { not: null }, passwordResetExpiresAt: { lt: now } },
        select: { id: true },
        take,
      }),
    (ids) =>
      prisma.user.updateMany({
        where: { id: { in: ids } },
        data: { passwordResetToken: null, passwordResetExpiresAt: null },
      }),
  );

  const notifications = await batched(
    'notifications',
    (take) =>
      prisma.notification.findMany({
        where: { readAt: { not: null, lt: notificationCutoff } },
        select: { id: true },
        take,
      }),
    (ids) => prisma.notification.deleteMany({ where: { id: { in: ids } } }),
  );

  const auditLogs = await batched(
    'auditLogs',
    (take) => prisma.auditLog.findMany({ where: { createdAt: { lt: auditCutoff } }, select: { id: true }, take }),
    (ids) => prisma.auditLog.deleteMany({ where: { id: { in: ids } } }),
  );

  const result: RetentionResult = {
    sessions,
    refreshTokens,
    verificationTokens,
    passwordResetTokens,
    notifications,
    auditLogs,
  };
  logger.info(result, 'Retention sweep complete');
  return result;
}
