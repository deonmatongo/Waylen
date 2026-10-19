/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let rows: Array<Record<string, any>>;
const { send } = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    notification: {
      findMany: vi.fn(() => Promise.resolve(rows.map((r) => ({ ...r, user: { email: 'u@x.com', fullName: 'U' } })))),
      updateMany: vi.fn(({ where, data }: any) => {
        const r = rows.find((x) => x.id === where.id)!;
        if (r.emailAttempts !== where.emailAttempts || r.sentAt) return Promise.resolve({ count: 0 });
        Object.assign(r, data);
        return Promise.resolve({ count: 1 });
      }),
      update: vi.fn(({ where, data }: any) => {
        Object.assign(rows.find((x) => x.id === where.id)!, data);
        return Promise.resolve({});
      }),
    },
  },
}));
vi.mock('../../src/services/mail.service.js', () => ({ mailService: { send } }));

import { notificationService, isRetryDue, toJsonSafe } from '../../src/services/notification.service.js';

const HOUR_AGO = () => new Date(Date.now() - 3_600_000);

beforeEach(() => {
  send.mockReset();
  rows = [
    {
      id: 'n1', title: 'T', body: null, actionUrl: null, sentAt: null, failureReason: 'SMTP down',
      emailAttempts: 1, lastAttemptAt: HOUR_AGO(), emailTemplate: 'offer-letter', emailData: { school: 'UCL' },
    },
    {
      id: 'n2', title: 'T', body: null, actionUrl: null, sentAt: null, failureReason: 'SMTP down',
      emailAttempts: 3, lastAttemptAt: HOUR_AGO(), emailTemplate: null, emailData: null,
    },
    {
      id: 'n3', title: 'T', body: null, actionUrl: null, sentAt: null, failureReason: 'SMTP down',
      emailAttempts: 1, lastAttemptAt: new Date(), emailTemplate: null, emailData: null,
    },
  ];
});

describe('retryFailed', () => {
  it('computes backoff from attempts and lastAttemptAt', () => {
    const now = Date.now();
    expect(isRetryDue(1, null, now)).toBe(true);
    expect(isRetryDue(1, new Date(now - 14 * 60_000), now)).toBe(false);
    expect(isRetryDue(2, new Date(now - 20 * 60_000), now)).toBe(false);
    expect(isRetryDue(2, new Date(now - 31 * 60_000), now)).toBe(true);
  });

  it('serialises email data to JSON-safe form', () => {
    expect(toJsonSafe(undefined)).toBeUndefined();
    expect(toJsonSafe({ a: 1, d: new Date(0), f: () => 1 })).toEqual({ a: 1, d: '1970-01-01T00:00:00.000Z' });
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(toJsonSafe(circular)).toBeUndefined();
  });

  it('re-sends with the persisted template and data, skipping exhausted and backing-off rows', async () => {
    send.mockResolvedValue(undefined);
    const res = await notificationService.retryFailed(10, 3);
    expect(res).toEqual({ sent: 1, failed: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toMatchObject({ template: 'offer-letter', data: { school: 'UCL', fullName: 'U' } });
    expect(rows[0]!.sentAt).toBeInstanceOf(Date);
    expect(rows[0]!.failureReason).toBeNull();
    expect(rows[0]!.emailAttempts).toBe(2);
    expect(rows[1]!.emailAttempts).toBe(3);
  });

  it('falls back to the generic template when none was persisted', async () => {
    rows = [{ ...rows[1]!, emailAttempts: 1 }];
    send.mockResolvedValue(undefined);
    await notificationService.retryFailed(10, 3);
    expect(send.mock.calls[0]![0].template).toBe('generic');
  });

  it('increments attempts when the retry fails again, then marks permanent at the cap', async () => {
    send.mockRejectedValue(new Error('still down'));
    expect(await notificationService.retryFailed(10, 3)).toEqual({ sent: 0, failed: 1 });
    expect(rows[0]!.emailAttempts).toBe(2);
    expect(rows[0]!.failureReason).toBe('still down');

    rows[0]!.lastAttemptAt = HOUR_AGO();
    await notificationService.retryFailed(10, 3);
    expect(rows[0]!.emailAttempts).toBe(3);
    expect(rows[0]!.failureReason).toBe('Permanently failed after 3 attempts: still down');
  });

  it('does not double-send when the claim is lost', async () => {
    send.mockResolvedValue(undefined);
    rows = [{ ...rows[0]!, emailAttempts: 1 }];
    const first = notificationService.retryFailed(10, 3);
    const second = notificationService.retryFailed(10, 3);
    await Promise.all([first, second]);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
