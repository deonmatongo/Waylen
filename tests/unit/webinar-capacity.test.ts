/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const regs: Array<Record<string, any>> = [];
let webinar: Record<string, any>;

vi.mock('../../src/config/database.js', () => {
  // Serialises transactions, which is what Serializable guarantees.
  let chain: Promise<unknown> = Promise.resolve();
  const registrationApi = {
    findUnique: vi.fn(({ where }: any) => {
      const k = where.webinarId_email;
      return Promise.resolve(regs.find((r) => r.webinarId === k.webinarId && r.email === k.email) ?? null);
    }),
    count: vi.fn(({ where }: any) => Promise.resolve(regs.filter((r) => r.webinarId === where.webinarId).length)),
    create: vi.fn(async ({ data }: any) => {
      await new Promise((r) => setTimeout(r, 1));
      const row = { id: `r${regs.length + 1}`, confirmationSentAt: null, ...data };
      regs.push(row);
      return row;
    }),
    update: vi.fn(() => Promise.resolve({})),
  };
  return {
    prisma: {
      webinar: { findFirst: vi.fn(() => Promise.resolve(webinar)) },
      webinarRegistration: registrationApi,
      $transaction: (fn: (tx: unknown) => Promise<unknown>) => {
        const run = chain.then(() => fn({ webinarRegistration: registrationApi }));
        chain = run.catch(() => undefined);
        return run;
      },
    },
  };
});
vi.mock('../../src/services/mail.service.js', () => ({ mailService: { send: vi.fn() } }));
vi.mock('../../src/services/notification.service.js', () => ({ notificationService: { dispatch: vi.fn() } }));

import { webinarService } from '../../src/services/webinar.service.js';

beforeEach(() => {
  regs.length = 0;
  webinar = { id: 'w1', title: 'T', startsAt: new Date(), joinUrl: null, location: null, capacity: 2 };
});

describe('webinar capacity', () => {
  it('does not overbook under concurrent sign-ups', async () => {
    const results = await Promise.allSettled(
      ['a', 'b', 'c', 'd', 'e'].map((n) =>
        webinarService.registerGuest('s', { fullName: n, email: `${n}@x.com` }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect(regs).toHaveLength(2);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason.statusCode).toBe(422);
  });

  it('is idempotent for the same email, even when full', async () => {
    await webinarService.registerGuest('s', { fullName: 'a', email: 'a@x.com' });
    await webinarService.registerGuest('s', { fullName: 'b', email: 'b@x.com' });
    const again = await webinarService.registerGuest('s', { fullName: 'a', email: 'A@x.com' });
    expect(again.email).toBe('a@x.com');
    expect(regs).toHaveLength(2);
  });
});
