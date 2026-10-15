import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn(),
  update: vi.fn(),
  dispatch: vi.fn(),
  send: vi.fn(),
}));

vi.mock('../../src/config/database.js', () => ({
  prisma: { appointment: { findMany: mocks.findMany, updateMany: mocks.updateMany, update: mocks.update } },
}));
vi.mock('../../src/services/notification.service.js', () => ({
  notificationService: { dispatch: mocks.dispatch },
}));
vi.mock('../../src/services/mail.service.js', () => ({ mailService: { send: mocks.send } }));

import {
  APPOINTMENT_REMINDER_LOOKAHEAD_HOURS,
  sendAppointmentReminders,
} from '../../src/jobs/reminders.job.js';

const appt = (id: string, extra = {}) => ({
  id,
  reference: id,
  type: 'INITIAL_CONSULTATION',
  format: 'ONLINE',
  startsAt: new Date('2026-10-17T09:00:00Z'),
  meetingUrl: null,
  location: null,
  guestName: 'Guest',
  guestEmail: 'g@x.test',
  studentProfile: null,
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.update.mockResolvedValue({});
  mocks.send.mockResolvedValue(undefined);
});

describe('sendAppointmentReminders', () => {
  it('looks 48h ahead so a daily cron cannot miss anything between runs', async () => {
    mocks.findMany.mockResolvedValue([]);
    const now = new Date('2026-10-15T06:00:00Z');

    await sendAppointmentReminders({ now });

    const where = mocks.findMany.mock.calls[0]![0].where;
    expect(APPOINTMENT_REMINDER_LOOKAHEAD_HOURS).toBe(48);
    expect(where.status).toBe('CONFIRMED');
    expect(where.reminderSentAt).toBeNull();
    expect(where.startsAt.gte).toEqual(now);
    expect(where.startsAt.lte).toEqual(new Date('2026-10-17T06:00:00Z'));
    // Consecutive daily runs overlap, so nothing starting between them is skipped.
    const nextRun = new Date('2026-10-16T06:00:00Z');
    expect(where.startsAt.lte.getTime()).toBeGreaterThan(nextRun.getTime());
  });

  it('claims each appointment before sending and skips ones already claimed', async () => {
    mocks.findMany.mockResolvedValue([appt('a1'), appt('a2')]);
    mocks.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    await sendAppointmentReminders();

    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: 'a1', reminderSentAt: null },
      data: { reminderSentAt: expect.any(Date) },
    });
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it('releases the claim when sending fails so the next run retries', async () => {
    mocks.findMany.mockResolvedValue([appt('a1'), appt('a2')]);
    mocks.send.mockRejectedValueOnce(new Error('smtp')).mockResolvedValueOnce(undefined);

    await sendAppointmentReminders();

    expect(mocks.update).toHaveBeenCalledWith({ where: { id: 'a1' }, data: { reminderSentAt: null } });
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });
});
