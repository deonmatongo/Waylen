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
        if (r.failureReason !== where.failureReason || r.sentAt) return Promise.resolve({ count: 0 });
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

import { notificationService, parseRetryCount, withRetryCount } from '../../src/services/notification.service.js';

beforeEach(() => {
  send.mockReset();
  rows = [
    { id: 'n1', title: 'T', body: null, actionUrl: null, sentAt: null, failureReason: 'SMTP down' },
    { id: 'n2', title: 'T', body: null, actionUrl: null, sentAt: null, failureReason: 'SMTP down [retry:3]' },
  ];
});

describe('retryFailed', () => {
  it('parses and writes the retry suffix', () => {
    expect(parseRetryCount('x [retry:2]')).toBe(2);
    expect(parseRetryCount(null)).toBe(0);
    expect(withRetryCount('x [retry:1]', 2)).toBe('x [retry:2]');
  });

  it('re-sends eligible rows, skips exhausted ones, clears failure on success', async () => {
    send.mockResolvedValue(undefined);
    const res = await notificationService.retryFailed(10, 3);
    expect(res).toEqual({ sent: 1, failed: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(rows[0]!.sentAt).toBeInstanceOf(Date);
    expect(rows[0]!.failureReason).toBeNull();
  });

  it('increments the counter when the retry fails again', async () => {
    send.mockRejectedValue(new Error('still down'));
    const res = await notificationService.retryFailed(10, 3);
    expect(res).toEqual({ sent: 0, failed: 1 });
    expect(rows[0]!.failureReason).toBe('still down [retry:1]');
  });
});
