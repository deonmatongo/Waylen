/**
 * Retention sweep and data-subject tooling, against an in-memory Prisma fake.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

type Row = Record<string, unknown> & { id: string };
const db: Record<string, Row[]> = {};

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

function match(row: Row, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as Record<string, unknown>[]).some((w) => match(row, w));
    const value = row[key];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as { in?: unknown[]; lt?: Date; not?: unknown };
      if (c.in) return c.in.includes(value);
      if ('not' in c && c.not === null && value === null) return false;
      if (c.lt) return value instanceof Date && value < c.lt;
      return true;
    }
    return value === cond;
  });
}

function delegate(name: string) {
  return {
    findMany: vi.fn(({ where, take }: { where?: Record<string, unknown>; take?: number }) =>
      Promise.resolve(db[name]!.filter((r) => match(r, where)).slice(0, take)),
    ),
    deleteMany: vi.fn(({ where }: { where?: Record<string, unknown> }) => {
      const before = db[name]!.length;
      db[name] = db[name]!.filter((r) => !match(r, where));
      return Promise.resolve({ count: before - db[name].length });
    }),
    updateMany: vi.fn(({ where, data }: { where?: Record<string, unknown>; data: Record<string, unknown> }) => {
      const rows = db[name]!.filter((r) => match(r, where));
      rows.forEach((r) => Object.assign(r, data));
      return Promise.resolve({ count: rows.length });
    }),
  };
}

vi.mock('../../src/config/database.js', () => {
  const prisma = {
    session: delegate('session'),
    refreshToken: delegate('refreshToken'),
    user: delegate('user'),
    notification: delegate('notification'),
    auditLog: delegate('auditLog'),
  };
  return { prisma };
});
vi.mock('../../src/config/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { runRetention, resolveAuditRetentionDays } from '../../src/jobs/retention.job.js';

beforeEach(() => {
  delete process.env.RETENTION_AUDIT_DAYS;
  db.session = [
    { id: 's-old-expired', expiresAt: ago(40), revokedAt: null },
    { id: 's-old-revoked', expiresAt: ago(-10), revokedAt: ago(31) },
    { id: 's-recent-expired', expiresAt: ago(5), revokedAt: null },
    { id: 's-live', expiresAt: ago(-10), revokedAt: null },
  ];
  db.refreshToken = [
    { id: 'r-old', expiresAt: ago(60), revokedAt: null },
    { id: 'r-live', expiresAt: ago(-10), revokedAt: null },
  ];
  db.user = [
    { id: 'u1', verificationToken: 'x', verificationExpiresAt: ago(1), passwordResetToken: 'y', passwordResetExpiresAt: ago(1) },
    { id: 'u2', verificationToken: 'x2', verificationExpiresAt: ago(-1), passwordResetToken: null, passwordResetExpiresAt: null },
  ];
  db.notification = [
    { id: 'n-old-read', readAt: ago(200) },
    { id: 'n-old-unread', readAt: null },
    { id: 'n-new-read', readAt: ago(1) },
  ];
  db.auditLog = [
    { id: 'a-old', createdAt: ago(800) },
    { id: 'a-new', createdAt: ago(10) },
  ];
});

describe('runRetention', () => {
  it('deletes only rows past their cutoff and reports counts', async () => {
    const result = await runRetention();

    expect(result).toEqual({
      sessions: 2,
      refreshTokens: 1,
      verificationTokens: 1,
      passwordResetTokens: 1,
      notifications: 1,
      auditLogs: 1,
    });
    expect(db.session!.map((r) => r.id).sort()).toEqual(['s-live', 's-recent-expired']);
    expect(db.refreshToken!.map((r) => r.id)).toEqual(['r-live']);
    expect(db.notification!.map((r) => r.id).sort()).toEqual(['n-new-read', 'n-old-unread']);
    expect(db.auditLog!.map((r) => r.id)).toEqual(['a-new']);
    expect(db.user!.find((u) => u.id === 'u1')).toMatchObject({ verificationToken: null, passwordResetToken: null });
    expect(db.user!.find((u) => u.id === 'u2')).toMatchObject({ verificationToken: 'x2' });
  });

  it('is idempotent', async () => {
    await runRetention();
    const second = await runRetention();
    expect(Object.values(second).every((n) => n === 0)).toBe(true);
  });

  it('honours RETENTION_AUDIT_DAYS', async () => {
    process.env.RETENTION_AUDIT_DAYS = '5';
    const result = await runRetention();
    expect(result.auditLogs).toBe(2);
  });

  it('processes more than one batch', async () => {
    db.notification = Array.from({ length: 2500 }, (_, i) => ({ id: `n${i}`, readAt: ago(400) }));
    const result = await runRetention();
    expect(result.notifications).toBe(2500);
  });
});

describe('resolveAuditRetentionDays', () => {
  it('falls back to 730 for missing or invalid values', () => {
    expect(resolveAuditRetentionDays(undefined)).toBe(730);
    expect(resolveAuditRetentionDays('abc')).toBe(730);
    expect(resolveAuditRetentionDays('0')).toBe(730);
    expect(resolveAuditRetentionDays('90')).toBe(90);
  });
});
