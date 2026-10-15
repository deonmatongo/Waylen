import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: {
    appointment: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    user: { findMany: vi.fn(), findFirst: vi.fn() },
    studentProfile: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
  teams: { createMeeting: vi.fn(), updateMeeting: vi.fn(), cancelMeeting: vi.fn() },
  notify: vi.fn(),
  mail: vi.fn(),
  audit: vi.fn(),
}));

vi.mock('../../src/config/database.js', () => ({ prisma: mocks.prisma }));
vi.mock('../../src/services/teams.service.js', () => ({ teamsService: mocks.teams }));
vi.mock('../../src/services/notification.service.js', () => ({
  notificationService: { dispatch: mocks.notify },
}));
vi.mock('../../src/services/mail.service.js', () => ({ mailService: { send: mocks.mail } }));
vi.mock('../../src/services/audit.service.js', () => ({ auditService: { record: mocks.audit } }));

import {
  appointmentService,
  GUEST_BOOKING_ACTOR,
  STUDENT_RESCHEDULE_MIN_NOTICE_HOURS,
} from '../../src/services/appointment.service.js';

const hours = (n: number) => new Date(Date.now() + n * 3_600_000);

const base = {
  id: 'apt1',
  reference: 'APT-1',
  status: 'CONFIRMED',
  type: 'INITIAL_CONSULTATION',
  format: 'ONLINE',
  startsAt: hours(72),
  durationMinutes: 45,
  counsellorId: null,
  meetingProviderId: 'evt1',
  guestEmail: null,
  guestName: null,
  studentProfile: { userId: 'u1', user: { email: 's@x.test', fullName: 'Stu Dent' } },
};

beforeEach(() => {
  vi.clearAllMocks();
  // Run transaction callbacks against the same mock client.
  mocks.prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(mocks.prisma));
  mocks.prisma.appointment.findFirst.mockResolvedValue(base);
  mocks.prisma.appointment.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.user.findMany.mockResolvedValue([{ id: 'staff1' }]);
  mocks.notify.mockResolvedValue(undefined);
  mocks.audit.mockResolvedValue(undefined);
});

describe('appointmentService.reschedule', () => {
  it('moves the stored Graph event and the local row', async () => {
    // Clash lookup (first findFirst call is the appointment, the second the clash check).
    mocks.prisma.appointment.findFirst.mockResolvedValueOnce(base).mockResolvedValueOnce(null);
    const startsAt = hours(100);

    await appointmentService.reschedule('apt1', { actorId: 'u1', startsAt, studentProfileId: 'sp1' });

    expect(mocks.teams.updateMeeting).toHaveBeenCalledWith('evt1', { startsAt, durationMinutes: 45 });
    expect(mocks.prisma.appointment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { startsAt, reminderSentAt: null } }),
    );
  });

  it('keeps the new time and flags staff when Graph fails', async () => {
    mocks.prisma.appointment.findFirst.mockResolvedValueOnce(base).mockResolvedValueOnce(null);
    mocks.teams.updateMeeting.mockRejectedValue(new Error('graph down'));

    await expect(
      appointmentService.reschedule('apt1', { actorId: 'staff1', startsAt: hours(100) }),
    ).resolves.toBeDefined();

    expect(mocks.prisma.appointment.updateMany).toHaveBeenCalled();
    expect(mocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'staff1', title: expect.stringContaining('Outlook event not moved') }),
    );
  });

  it('refuses a student move inside the minimum notice window', async () => {
    mocks.prisma.appointment.findFirst.mockResolvedValueOnce({
      ...base,
      startsAt: hours(STUDENT_RESCHEDULE_MIN_NOTICE_HOURS - 1),
    });

    await expect(
      appointmentService.reschedule('apt1', { actorId: 'u1', startsAt: hours(100), studentProfileId: 'sp1' }),
    ).rejects.toThrow(/at least 24 hours/);
    expect(mocks.prisma.appointment.updateMany).not.toHaveBeenCalled();
  });

  it('scopes the lookup to the student (ownership check)', async () => {
    mocks.prisma.appointment.findFirst.mockResolvedValueOnce(null);

    await expect(
      appointmentService.reschedule('apt1', { actorId: 'u1', startsAt: hours(100), studentProfileId: 'other' }),
    ).rejects.toThrow(/could not be found/);
    expect(mocks.prisma.appointment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'apt1', studentProfileId: 'other' } }),
    );
  });

  it('rejects completed appointments', async () => {
    mocks.prisma.appointment.findFirst.mockResolvedValueOnce({ ...base, status: 'COMPLETED' });
    await expect(
      appointmentService.reschedule('apt1', { actorId: 'staff1', startsAt: hours(100) }),
    ).rejects.toThrow(/no longer be rescheduled/);
  });
});

describe('appointmentService.cancel', () => {
  it('deletes the Graph event and does not fail when that errors', async () => {
    mocks.prisma.appointment.findFirst.mockResolvedValueOnce({
      reference: 'APT-1',
      startsAt: hours(72),
      meetingProviderId: 'evt1',
      counsellorId: null,
    });
    mocks.teams.cancelMeeting.mockRejectedValue(new Error('graph down'));

    await expect(appointmentService.cancel('apt1', { actorId: 'staff1' })).resolves.toBeUndefined();

    expect(mocks.teams.cancelMeeting).toHaveBeenCalledWith('evt1');
    expect(mocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining('Outlook event not removed') }),
    );
  });

  it('never writes the guest-booking actor string to the audit FK column', async () => {
    mocks.prisma.appointment.findFirst.mockResolvedValueOnce({
      reference: 'APT-1',
      startsAt: hours(72),
      meetingProviderId: null,
      counsellorId: null,
    });

    await appointmentService.cancel('apt1', { actorId: GUEST_BOOKING_ACTOR });

    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ actorId: null }));
  });
});

describe('booking transaction', () => {
  const input = { fullName: 'G', email: 'g@x.test', startsAt: hours(72) };

  it('uses Serializable isolation', async () => {
    mocks.prisma.appointment.findFirst.mockResolvedValue(null);
    mocks.prisma.appointment.create.mockResolvedValue({ id: 'a' });
    (mocks.prisma as unknown as { enquiry: unknown }).enquiry = { create: vi.fn() };

    await appointmentService.requestAsGuest(input);

    expect(mocks.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it('retries once on a serialization failure', async () => {
    mocks.prisma.$transaction
      .mockRejectedValueOnce(Object.assign(new Error('conflict'), { code: 'P2034' }))
      .mockResolvedValueOnce({ id: 'a' });

    await expect(appointmentService.requestAsGuest(input)).resolves.toEqual({ id: 'a' });
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('reports "slot just taken" when the conflict persists', async () => {
    mocks.prisma.$transaction.mockRejectedValue(Object.assign(new Error('conflict'), { code: 'P2034' }));

    await expect(appointmentService.requestAsGuest(input)).rejects.toThrow(/just been taken/);
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('rejects an overlapping local booking inside the transaction', async () => {
    mocks.prisma.appointment.findFirst.mockResolvedValue({ id: 'other' });

    await expect(appointmentService.requestAsGuest(input)).rejects.toThrow(/just been taken/);
    expect(mocks.prisma.appointment.create).not.toHaveBeenCalled();
  });
});

describe('appointmentService.confirm', () => {
  const requested = { ...base, status: 'REQUESTED', meetingProviderId: undefined };

  it('confirms without a link, flags staff and tells the attendee it will follow', async () => {
    mocks.prisma.appointment.findUnique.mockResolvedValue(requested);
    mocks.prisma.appointment.update.mockResolvedValue({ id: 'apt1' });
    mocks.teams.createMeeting.mockRejectedValue(new Error('graph down'));

    await appointmentService.confirm('apt1', { actorId: GUEST_BOOKING_ACTOR });

    expect(mocks.prisma.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CONFIRMED', meetingUrl: null }) }),
    );
    expect(mocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'staff1', title: expect.stringContaining('Meeting link needed') }),
    );
    expect(mocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        emailData: expect.objectContaining({ meetingLinkPending: true }),
      }),
    );
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ actorId: null }));
  });

  it('treats an empty join URL as a missing link', async () => {
    mocks.prisma.appointment.findUnique.mockResolvedValue(requested);
    mocks.prisma.appointment.update.mockResolvedValue({ id: 'apt1' });
    mocks.teams.createMeeting.mockResolvedValue({ id: 'evt9', joinUrl: '' });

    await appointmentService.confirm('apt1', { actorId: 'staff1' });

    expect(mocks.prisma.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ meetingUrl: null, meetingProviderId: 'evt9' }) }),
    );
  });

  it('only confirms REQUESTED appointments', async () => {
    mocks.prisma.appointment.findUnique.mockResolvedValue(base);
    await expect(appointmentService.confirm('apt1', { actorId: 'staff1' })).rejects.toThrow(/Only a requested/);
    expect(mocks.teams.createMeeting).not.toHaveBeenCalled();
  });

  it('rejects a counsellorId that is not an active counsellor', async () => {
    mocks.prisma.user.findFirst.mockResolvedValue(null);
    await expect(
      appointmentService.confirm('apt1', { actorId: 'staff1', counsellorId: 'notacounsellor' }),
    ).rejects.toThrow(/active counsellor/);
  });
});
