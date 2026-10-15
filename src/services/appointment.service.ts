/**
 * Appointments (PRD §5.2, §5.4).
 *
 * Two entry points by design: registered students book from the portal, while
 * the public "Book a Free Consultation" flow (PRD §A.13) creates a guest
 * booking plus a CRM enquiry so no lead is lost before registration.
 */
import type { AppointmentStatus, AppointmentType, Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';
import { APPOINTMENT_DURATION_MINUTES, APPOINTMENT_TYPE_LABELS } from '../config/constants.js';
import { appointmentReference } from '../utils/reference.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import { notificationService, type NotificationEvent } from './notification.service.js';
import { mailService } from './mail.service.js';
import { teamsService } from './teams.service.js';
import { auditService } from './audit.service.js';
import {
  businessFormatter,
  generateSlots,
  getBusinessTimeZone,
  getBusyBlocks,
  overlapsAnyBlock,
} from './availability.service.js';
import { isGraphConfigured } from './graph-client.service.js';

/** Students may only move an appointment at least this far ahead of its start. */
export const STUDENT_RESCHEDULE_MIN_NOTICE_HOURS = 24;

/**
 * Actor label for the public instant-booking flow. It is not a User id, so it
 * must never be written to a foreign-key column — use `actorUserId()` for that.
 */
export const GUEST_BOOKING_ACTOR = 'guest-instant-booking';

const SLOT_TAKEN_MESSAGE = 'That time has just been taken. Please choose another slot.';
const PAST_PAGE_SIZE = 20;

/** The actor as a User id for FK columns (audit log), or null for system actors. */
function actorUserId(actorId: string): string | null {
  return actorId === GUEST_BOOKING_ACTOR ? null : actorId;
}

/** Prisma's "transaction failed due to a write conflict or a deadlock" code. */
function isSerializationFailure(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2034';
}

/**
 * Runs the check-then-write for a booking atomically. Serializable isolation
 * makes two concurrent bookings of one slot conflict instead of both passing
 * the clash check; the loser is retried once (and then sees the winner's row),
 * after which a persistent conflict is reported as "slot just taken".
 */
async function runBookingTransaction<T>(
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await prisma.$transaction(work, { isolationLevel: 'Serializable' });
    } catch (err) {
      if (!isSerializationFailure(err)) throw err;
      if (attempt >= 2) throw new ValidationError(SLOT_TAKEN_MESSAGE);
      logger.warn('Booking transaction hit a serialization conflict — retrying once');
    }
  }
}

function assertSlotInFuture(startsAt: Date): void {
  if (Number.isNaN(startsAt.getTime())) {
    throw new ValidationError('Please choose a valid date and time.');
  }
  if (startsAt <= new Date()) {
    throw new ValidationError('Please choose a time in the future.');
  }
}

/** Re-checks the live Outlook calendar (outside any DB transaction: it is a network call). */
async function assertCalendarFree(startsAt: Date): Promise<void> {
  const endsAt = new Date(startsAt.getTime() + APPOINTMENT_DURATION_MINUTES * 60_000);
  const busyBlocks = await getBusyBlocks(startsAt, endsAt);
  if (overlapsAnyBlock(startsAt, endsAt, busyBlocks)) {
    throw new ValidationError(SLOT_TAKEN_MESSAGE);
  }
}

/** Rejects a slot that overlaps another live local booking. */
async function assertNoLocalClash(
  db: Prisma.TransactionClient | typeof prisma,
  startsAt: Date,
  excludeAppointmentId?: string,
): Promise<void> {
  const windowMs = APPOINTMENT_DURATION_MINUTES * 60_000;
  const clash = await db.appointment.findFirst({
    where: {
      startsAt: {
        gt: new Date(startsAt.getTime() - windowMs),
        lt: new Date(startsAt.getTime() + windowMs),
      },
      status: { in: ['REQUESTED', 'CONFIRMED'] },
      ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
    },
    select: { id: true },
  });
  if (clash) throw new ValidationError(SLOT_TAKEN_MESSAGE);
}

async function assertActiveCounsellor(counsellorId: string): Promise<void> {
  const counsellor = await prisma.user.findFirst({
    where: { id: counsellorId, role: 'COUNSELLOR', status: 'ACTIVE' },
    select: { id: true },
  });
  if (!counsellor) throw new ValidationError('Please choose an active counsellor.');
}

/**
 * Tells staff something needs manual attention (e.g. a Teams link that could
 * not be created or a Graph event that could not be moved). Never throws: the
 * local state change that triggered it must stand regardless.
 */
async function notifyStaff(options: { title: string; body: string; counsellorId?: string | null }) {
  try {
    const staff = await prisma.user.findMany({
      where: { role: { in: ['ADMIN_STAFF', 'SUPER_ADMIN'] }, status: 'ACTIVE' },
      select: { id: true },
    });
    const recipients = new Set(staff.map((member) => member.id));
    if (options.counsellorId) recipients.add(options.counsellorId);

    await Promise.allSettled(
      [...recipients].map((userId) =>
        notificationService.dispatch({
          userId,
          event: 'appointment.booked',
          title: options.title,
          body: options.body,
          actionUrl: '/admin/appointments',
        }),
      ),
    );
  } catch (err) {
    logger.error({ err }, 'Could not notify staff about an appointment problem');
  }
}

interface Attendee {
  studentProfile: { userId: string } | null;
  guestEmail: string | null;
  guestName: string | null;
}

/**
 * Notifies whoever the appointment belongs to: in-app plus email for a
 * student, a direct email for a guest (who has no account). Failures are logged.
 */
async function notifyAttendee(
  appointment: Attendee,
  message: {
    event: NotificationEvent;
    title: string;
    body?: string;
    template: string;
    data: Record<string, unknown>;
  },
): Promise<void> {
  if (appointment.studentProfile) {
    await notificationService.dispatch({
      userId: appointment.studentProfile.userId,
      event: message.event,
      title: message.title,
      body: message.body,
      actionUrl: '/portal/appointments',
      emailTemplate: message.template,
      emailData: message.data,
    });
  } else if (appointment.guestEmail) {
    try {
      await mailService.send({
        to: appointment.guestEmail,
        subject: message.title,
        template: message.template,
        data: { fullName: appointment.guestName, ...message.data },
      });
    } catch (err) {
      logger.error({ err, template: message.template }, 'Guest appointment email failed');
    }
  }
}

/** Status and (for students) minimum-notice rules for moving an appointment. */
function assertCanMove(
  appointment: { status: AppointmentStatus; startsAt: Date },
  studentScoped: boolean,
): void {
  if (appointment.status !== 'REQUESTED' && appointment.status !== 'CONFIRMED') {
    throw new ValidationError('That appointment can no longer be rescheduled.');
  }
  if (studentScoped) {
    const earliest = Date.now() + STUDENT_RESCHEDULE_MIN_NOTICE_HOURS * 3_600_000;
    if (appointment.startsAt.getTime() < earliest) {
      throw new ValidationError(
        `Appointments can only be rescheduled at least ${STUDENT_RESCHEDULE_MIN_NOTICE_HOURS} hours ahead. Please contact us instead.`,
      );
    }
  }
}

/** Date label in the business timezone for emails (the templates fall back to UTC without it). */
function whenLabel(startsAt: Date): string {
  return businessFormatter().dateTimeWithZone(startsAt);
}

export interface GuestConsultationInput {
  fullName: string;
  email: string;
  phone?: string;
  type?: AppointmentType;
  startsAt: Date;
  format?: 'ONLINE' | 'IN_PERSON';
  notes?: string;
  countryOfInterest?: string;
}

export const appointmentService = {
  /** Public consultation request — no account required. */
  async requestAsGuest(input: GuestConsultationInput) {
    assertSlotInFuture(input.startsAt);
    await assertCalendarFree(input.startsAt);

    const appointment = await runBookingTransaction(async (tx) => {
      await assertNoLocalClash(tx, input.startsAt);

      const created = await tx.appointment.create({
        data: {
          reference: appointmentReference(),
          guestName: input.fullName,
          guestEmail: input.email.toLowerCase(),
          guestPhone: input.phone ?? null,
          type: input.type ?? 'INITIAL_CONSULTATION',
          status: 'REQUESTED',
          format: input.format ?? 'ONLINE',
          startsAt: input.startsAt,
          durationMinutes: APPOINTMENT_DURATION_MINUTES,
          timezone: getBusinessTimeZone(),
          studentNotes: input.notes ?? null,
        },
      });

      // Every consultation is also a CRM enquiry (PRD §5.4).
      await tx.enquiry.create({
        data: {
          fullName: input.fullName,
          email: input.email.toLowerCase(),
          phone: input.phone ?? null,
          message: input.notes ?? null,
          source: 'book-consultation',
          countryOfInterest: input.countryOfInterest ?? null,
          status: 'NEW',
        },
      });

      return created;
    });

    logger.info({ appointmentId: appointment.id }, 'Guest consultation requested');
    return appointment;
  },

  /**
   * Public "Book a Free Consultation" flow, upgraded for real Outlook
   * availability (PRD §5.2 phase-2): when Microsoft Graph is configured the
   * slots offered are genuinely open on the organiser's calendar, so the
   * guest is booked and confirmed immediately rather than waiting on staff
   * review. Falls back to the original request-then-confirm behaviour when
   * Graph isn't configured (dev, or before the Azure app is set up).
   */
  async bookGuestConsultation(input: GuestConsultationInput) {
    const appointment = await this.requestAsGuest(input);

    if (!isGraphConfigured) {
      return { appointment, autoConfirmed: false, meetingLinkPending: false };
    }

    const confirmed = await this.confirm(appointment.id, { actorId: GUEST_BOOKING_ACTOR });
    return {
      appointment: confirmed,
      autoConfirmed: true,
      meetingLinkPending: confirmed.format === 'ONLINE' && !confirmed.meetingUrl,
    };
  },

  async requestAsStudent(input: {
    studentProfileId: string;
    userId: string;
    type: AppointmentType;
    startsAt: Date;
    format?: 'ONLINE' | 'IN_PERSON';
    notes?: string;
  }) {
    assertSlotInFuture(input.startsAt);
    await assertCalendarFree(input.startsAt);

    // Route to the student's own counsellor where one is assigned.
    const student = await prisma.studentProfile.findUnique({
      where: { id: input.studentProfileId },
      select: { assignedCounsellorId: true },
    });

    const appointment = await runBookingTransaction(async (tx) => {
      await assertNoLocalClash(tx, input.startsAt);

      return tx.appointment.create({
        data: {
          reference: appointmentReference(),
          studentProfileId: input.studentProfileId,
          counsellorId: student?.assignedCounsellorId ?? null,
          type: input.type,
          status: 'REQUESTED',
          format: input.format ?? 'ONLINE',
          startsAt: input.startsAt,
          durationMinutes: APPOINTMENT_DURATION_MINUTES,
          timezone: getBusinessTimeZone(),
          studentNotes: input.notes ?? null,
        },
      });
    });

    await notificationService.dispatch({
      userId: input.userId,
      event: 'appointment.booked',
      title: `${APPOINTMENT_TYPE_LABELS[input.type]} requested`,
      body: 'We have received your request and will confirm the time shortly.',
      actionUrl: '/portal/appointments',
      emailTemplate: 'appointment-requested',
      emailData: {
        reference: appointment.reference,
        startsAt: appointment.startsAt,
        startsAtLabel: whenLabel(appointment.startsAt),
      },
    });

    return appointment;
  },

  /**
   * Confirms a booking and creates the Teams meeting (PRD §5.2, §8.1).
   *
   * A Graph failure does not block confirmation — the appointment still stands,
   * staff are told to add a link manually, and the attendee is told it will follow.
   */
  async confirm(appointmentId: string, options: { actorId: string; counsellorId?: string }) {
    if (options.counsellorId) await assertActiveCounsellor(options.counsellorId);

    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        id: true,
        reference: true,
        status: true,
        type: true,
        format: true,
        startsAt: true,
        durationMinutes: true,
        counsellorId: true,
        guestEmail: true,
        guestName: true,
        studentProfile: { select: { userId: true, user: { select: { email: true, fullName: true } } } },
      },
    });

    if (!appointment) throw new NotFoundError('That appointment could not be found.');
    if (appointment.status !== 'REQUESTED') {
      throw new ValidationError('Only a requested appointment can be confirmed.');
    }

    let meetingUrl: string | null = null;
    let meetingProviderId: string | null = null;
    let linkProblem: string | null = null;

    if (appointment.format === 'ONLINE') {
      try {
        const meeting = await teamsService.createMeeting({
          subject: `Waylen — ${APPOINTMENT_TYPE_LABELS[appointment.type]} (${appointment.reference})`,
          startsAt: appointment.startsAt,
          durationMinutes: appointment.durationMinutes,
          attendeeEmail:
            appointment.studentProfile?.user.email ?? appointment.guestEmail ?? undefined,
          attendeeName:
            appointment.studentProfile?.user.fullName ?? appointment.guestName ?? undefined,
        });
        meetingUrl = meeting.joinUrl || null;
        meetingProviderId = meeting.id;
        if (!meetingUrl) linkProblem = 'Graph created the event but returned no Teams join link.';
      } catch (err) {
        logger.error({ err, appointmentId }, 'Teams meeting creation failed — confirming without a link');
        linkProblem = 'The Teams meeting could not be created.';
      }
    }

    const updated = await prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        status: 'CONFIRMED',
        counsellorId: options.counsellorId ?? undefined,
        meetingUrl,
        meetingProviderId,
      },
    });

    await auditService.record({
      actorId: actorUserId(options.actorId),
      action: 'UPDATE',
      entity: 'Appointment',
      entityId: appointmentId,
      changes: { status: { from: 'REQUESTED', to: 'CONFIRMED' } },
    });

    const linkPending = appointment.format === 'ONLINE' && !meetingUrl;
    if (linkPending) {
      await notifyStaff({
        title: `Meeting link needed: ${appointment.reference}`,
        body: `${linkProblem ?? 'No meeting link.'} Add a link for the ${whenLabel(appointment.startsAt)} session; the attendee has been told it will follow.`,
        counsellorId: options.counsellorId ?? appointment.counsellorId,
      });
    }

    await notifyAttendee(appointment, {
      event: 'appointment.confirmed',
      title: `${APPOINTMENT_TYPE_LABELS[appointment.type]} confirmed`,
      body: meetingUrl
        ? 'Your meeting link is ready.'
        : linkPending
          ? 'Your meeting link will follow shortly.'
          : undefined,
      template: 'appointment-confirmed',
      data: {
        reference: appointment.reference,
        startsAt: appointment.startsAt,
        startsAtLabel: whenLabel(appointment.startsAt),
        meetingUrl,
        meetingLinkPending: linkPending,
      },
    });

    return updated;
  },

  /** A student's own appointment that may still be moved; throws otherwise. Backs the reschedule form. */
  async getReschedulable(appointmentId: string, studentProfileId: string) {
    const appointment = await prisma.appointment.findFirst({
      where: { id: appointmentId, studentProfileId },
      select: { id: true, reference: true, type: true, status: true, format: true, startsAt: true },
    });
    if (!appointment) throw new NotFoundError('That appointment could not be found.');
    assertCanMove(appointment, true);
    return appointment;
  },

  /**
   * Moves a REQUESTED or CONFIRMED appointment. When `studentProfileId` is
   * supplied the move is scoped to that student and must respect the minimum
   * notice; staff may move any open appointment. The stored Outlook event is
   * moved too, but a Graph failure only flags staff — the new time stands.
   */
  async reschedule(
    appointmentId: string,
    options: { actorId: string; startsAt: Date; studentProfileId?: string },
  ) {
    assertSlotInFuture(options.startsAt);

    const appointment = await prisma.appointment.findFirst({
      where: {
        id: appointmentId,
        ...(options.studentProfileId ? { studentProfileId: options.studentProfileId } : {}),
      },
      select: {
        id: true,
        reference: true,
        status: true,
        type: true,
        format: true,
        startsAt: true,
        durationMinutes: true,
        counsellorId: true,
        meetingProviderId: true,
        guestEmail: true,
        guestName: true,
        studentProfile: { select: { userId: true, user: { select: { email: true, fullName: true } } } },
      },
    });

    if (!appointment) throw new NotFoundError('That appointment could not be found.');
    assertCanMove(appointment, Boolean(options.studentProfileId));

    await assertCalendarFree(options.startsAt);

    const moved = await runBookingTransaction(async (tx) => {
      await assertNoLocalClash(tx, options.startsAt, appointmentId);
      return tx.appointment.updateMany({
        where: { id: appointmentId, status: { in: ['REQUESTED', 'CONFIRMED'] } },
        data: { startsAt: options.startsAt, reminderSentAt: null },
      });
    });
    if (moved.count === 0) {
      throw new ValidationError('That appointment can no longer be rescheduled.');
    }

    await auditService.record({
      actorId: actorUserId(options.actorId),
      action: 'UPDATE',
      entity: 'Appointment',
      entityId: appointmentId,
      changes: { startsAt: { from: appointment.startsAt.toISOString(), to: options.startsAt.toISOString() } },
    });

    let linkPending = false;
    if (appointment.format === 'ONLINE' && appointment.status === 'CONFIRMED') {
      if (appointment.meetingProviderId) {
        try {
          await teamsService.updateMeeting(appointment.meetingProviderId, {
            startsAt: options.startsAt,
            durationMinutes: appointment.durationMinutes,
          });
        } catch (err) {
          logger.error({ err, appointmentId }, 'Could not move the Outlook event — rescheduled locally only');
          await notifyStaff({
            title: `Outlook event not moved: ${appointment.reference}`,
            body: `The appointment is now ${whenLabel(options.startsAt)} but its Outlook/Teams event could not be updated. Please move it manually.`,
            counsellorId: appointment.counsellorId,
          });
        }
      } else {
        // Confirmed earlier without a Graph event: try to create one now.
        try {
          const meeting = await teamsService.createMeeting({
            subject: `Waylen — ${APPOINTMENT_TYPE_LABELS[appointment.type]} (${appointment.reference})`,
            startsAt: options.startsAt,
            durationMinutes: appointment.durationMinutes,
            attendeeEmail: appointment.studentProfile?.user.email ?? appointment.guestEmail ?? undefined,
            attendeeName: appointment.studentProfile?.user.fullName ?? appointment.guestName ?? undefined,
          });
          await prisma.appointment.update({
            where: { id: appointmentId },
            data: { meetingUrl: meeting.joinUrl || null, meetingProviderId: meeting.id },
          });
          linkPending = !meeting.joinUrl;
        } catch (err) {
          logger.error({ err, appointmentId }, 'Teams meeting creation failed during reschedule');
          linkPending = true;
        }
        if (linkPending) {
          await notifyStaff({
            title: `Meeting link needed: ${appointment.reference}`,
            body: `The appointment moved to ${whenLabel(options.startsAt)} and still has no Teams link. Please add one.`,
            counsellorId: appointment.counsellorId,
          });
        }
      }
    }

    const confirmed = appointment.status === 'CONFIRMED';
    await notifyAttendee(appointment, {
      event: confirmed ? 'appointment.confirmed' : 'appointment.booked',
      title: confirmed
        ? 'Your appointment has been rescheduled'
        : 'Your appointment request has been moved',
      template: confirmed ? 'appointment-confirmed' : 'appointment-requested',
      data: {
        reference: appointment.reference,
        startsAt: options.startsAt,
        startsAtLabel: whenLabel(options.startsAt),
        meetingLinkPending: linkPending,
      },
    });

    return { id: appointment.id, reference: appointment.reference, startsAt: options.startsAt };
  },

  /**
   * Cancels a booking. When `studentProfileId` is supplied the update is scoped
   * to that student, so a student cannot cancel someone else's appointment.
   * The Outlook event is deleted too; a Graph failure only flags staff.
   */
  async cancel(
    appointmentId: string,
    options: { actorId: string; studentProfileId?: string },
  ) {
    const where = {
      id: appointmentId,
      ...(options.studentProfileId ? { studentProfileId: options.studentProfileId } : {}),
    };

    const existing = await prisma.appointment.findFirst({
      where,
      select: { reference: true, startsAt: true, meetingProviderId: true, counsellorId: true },
    });

    const result = await prisma.appointment.updateMany({
      where: { ...where, status: { in: ['REQUESTED', 'CONFIRMED'] } },
      data: { status: 'CANCELLED' },
    });

    if (!existing || result.count === 0) {
      throw new NotFoundError('That appointment could not be found or is already closed.');
    }

    if (existing.meetingProviderId) {
      try {
        await teamsService.cancelMeeting(existing.meetingProviderId);
      } catch (err) {
        logger.error({ err, appointmentId }, 'Could not delete the Outlook event — cancelled locally only');
        await notifyStaff({
          title: `Outlook event not removed: ${existing.reference}`,
          body: `The ${whenLabel(existing.startsAt)} appointment is cancelled but its Outlook/Teams event could not be deleted. Please remove it manually.`,
          counsellorId: existing.counsellorId,
        });
      }
    }

    await auditService.record({
      actorId: actorUserId(options.actorId),
      action: 'UPDATE',
      entity: 'Appointment',
      entityId: appointmentId,
      changes: { status: { to: 'CANCELLED' } },
    });
  },

  async complete(appointmentId: string, options: { actorId: string; staffNotes?: string }) {
    return prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        status: 'COMPLETED',
        ...(options.staffNotes ? { staffNotes: options.staffNotes } : {}),
      },
    });
  },

  /**
   * Upcoming appointments (all of them, soonest first) plus past/cancelled ones
   * 20 per page, so history is never silently truncated.
   */
  async listForStudent(studentProfileId: string, options: { page?: number } = {}) {
    const now = new Date();

    const select = {
      id: true,
      reference: true,
      type: true,
      status: true,
      format: true,
      startsAt: true,
      durationMinutes: true,
      meetingUrl: true,
      location: true,
      studentNotes: true,
      counsellor: { select: { fullName: true } },
    } as const;

    const pastWhere = {
      studentProfileId,
      OR: [{ startsAt: { lt: now } }, { status: 'CANCELLED' as const }],
    };

    const [upcomingRows, pastTotal] = await Promise.all([
      prisma.appointment.findMany({
        where: { studentProfileId, startsAt: { gte: now }, status: { notIn: ['CANCELLED'] } },
        select,
        orderBy: { startsAt: 'asc' },
        take: 100,
      }),
      prisma.appointment.count({ where: pastWhere }),
    ]);

    const totalPages = Math.max(1, Math.ceil(pastTotal / PAST_PAGE_SIZE));
    const page = Math.min(Math.max(1, Math.floor(options.page ?? 1) || 1), totalPages);

    const past = await prisma.appointment.findMany({
      where: pastWhere,
      select,
      orderBy: { startsAt: 'desc' },
      skip: (page - 1) * PAST_PAGE_SIZE,
      take: PAST_PAGE_SIZE,
    });

    const earliestMovable = now.getTime() + STUDENT_RESCHEDULE_MIN_NOTICE_HOURS * 3_600_000;
    const upcoming = upcomingRows.map((appointment) => ({
      ...appointment,
      canReschedule:
        (appointment.status === 'REQUESTED' || appointment.status === 'CONFIRMED') &&
        appointment.startsAt.getTime() >= earliestMovable,
    }));

    return { upcoming, past, pagination: { page, perPage: PAST_PAGE_SIZE, total: pastTotal, totalPages } };
  },

  async listForStaff(filters: {
    counsellorId?: string;
    status?: AppointmentStatus;
    from?: Date;
  } = {}) {
    return prisma.appointment.findMany({
      where: {
        ...(filters.counsellorId ? { counsellorId: filters.counsellorId } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        startsAt: { gte: filters.from ?? new Date(Date.now() - 7 * 86_400_000) },
      },
      select: {
        id: true,
        reference: true,
        type: true,
        status: true,
        format: true,
        startsAt: true,
        durationMinutes: true,
        meetingUrl: true,
        guestName: true,
        guestEmail: true,
        studentNotes: true,
        counsellor: { select: { id: true, fullName: true } },
        studentProfile: {
          select: { id: true, reference: true, user: { select: { fullName: true, email: true } } },
        },
      },
      orderBy: { startsAt: 'asc' },
      take: 200,
    });
  },

  /**
   * Candidate slots for the booking form: weekdays, 09:00–16:15 in the business
   * timezone, for the next three weeks, minus anything already taken locally
   * and — when Microsoft Graph is configured (PRD §5.2 phase-2) — minus
   * whatever the organiser's real Outlook calendar shows as busy.
   */
  async availableSlots(daysAhead = 21): Promise<Date[]> {
    const now = new Date();
    const horizon = new Date(now.getTime() + daysAhead * 86_400_000);

    const [taken, busyBlocks] = await Promise.all([
      prisma.appointment.findMany({
        where: {
          startsAt: { gte: now, lte: horizon },
          status: { in: ['REQUESTED', 'CONFIRMED'] },
        },
        select: { startsAt: true },
      }),
      getBusyBlocks(now, horizon),
    ]);

    return generateSlots({
      now,
      horizon,
      timeZone: getBusinessTimeZone(),
      takenTimes: new Set(taken.map((a) => a.startsAt.getTime())),
      busyBlocks,
    });
  },

  /** Rejects past times and double bookings (read-only check; bookings re-check inside their transaction). */
  async assertSlotIsBookable(startsAt: Date, excludeAppointmentId?: string): Promise<void> {
    assertSlotInFuture(startsAt);
    await assertNoLocalClash(prisma, startsAt, excludeAppointmentId);
    await assertCalendarFree(startsAt);
  },
};
