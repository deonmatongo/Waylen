/**
 * Appointments (PRD §5.2, §5.4).
 *
 * Two entry points by design: registered students book from the portal, while
 * the public "Book a Free Consultation" flow (PRD §A.13) creates a guest
 * booking plus a CRM enquiry so no lead is lost before registration.
 */
import type { AppointmentStatus, AppointmentType } from '@prisma/client';
import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';
import { APPOINTMENT_DURATION_MINUTES, APPOINTMENT_TYPE_LABELS } from '../config/constants.js';
import { appointmentReference } from '../utils/reference.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import { notificationService } from './notification.service.js';
import { teamsService } from './teams.service.js';
import { auditService } from './audit.service.js';

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
    await this.assertSlotIsBookable(input.startsAt);

    const appointment = await prisma.$transaction(async (tx) => {
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

  async requestAsStudent(input: {
    studentProfileId: string;
    userId: string;
    type: AppointmentType;
    startsAt: Date;
    format?: 'ONLINE' | 'IN_PERSON';
    notes?: string;
  }) {
    await this.assertSlotIsBookable(input.startsAt);

    // Route to the student's own counsellor where one is assigned.
    const student = await prisma.studentProfile.findUnique({
      where: { id: input.studentProfileId },
      select: { assignedCounsellorId: true },
    });

    const appointment = await prisma.appointment.create({
      data: {
        reference: appointmentReference(),
        studentProfileId: input.studentProfileId,
        counsellorId: student?.assignedCounsellorId ?? null,
        type: input.type,
        status: 'REQUESTED',
        format: input.format ?? 'ONLINE',
        startsAt: input.startsAt,
        durationMinutes: APPOINTMENT_DURATION_MINUTES,
        studentNotes: input.notes ?? null,
      },
    });

    await notificationService.dispatch({
      userId: input.userId,
      event: 'appointment.booked',
      title: `${APPOINTMENT_TYPE_LABELS[input.type]} requested`,
      body: 'We have received your request and will confirm the time shortly.',
      actionUrl: '/portal/appointments',
      emailTemplate: 'appointment-requested',
      emailData: { reference: appointment.reference, startsAt: appointment.startsAt },
    });

    return appointment;
  },

  /**
   * Confirms a booking and creates the Teams meeting (PRD §5.2, §8.1).
   *
   * A Graph failure does not block confirmation — the appointment still stands
   * and staff can add a link manually.
   */
  async confirm(appointmentId: string, options: { actorId: string; counsellorId?: string }) {
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        id: true,
        reference: true,
        type: true,
        format: true,
        startsAt: true,
        durationMinutes: true,
        guestEmail: true,
        guestName: true,
        studentProfile: { select: { userId: true, user: { select: { email: true, fullName: true } } } },
      },
    });

    if (!appointment) throw new NotFoundError('That appointment could not be found.');

    let meetingUrl: string | null = null;
    let meetingProviderId: string | null = null;

    if (appointment.format === 'ONLINE') {
      try {
        const meeting = await teamsService.createMeeting({
          subject: `Waylen — ${APPOINTMENT_TYPE_LABELS[appointment.type]} (${appointment.reference})`,
          startsAt: appointment.startsAt,
          durationMinutes: appointment.durationMinutes,
          attendeeEmail:
            appointment.studentProfile?.user.email ?? appointment.guestEmail ?? undefined,
        });
        meetingUrl = meeting.joinUrl;
        meetingProviderId = meeting.id;
      } catch (err) {
        logger.error({ err, appointmentId }, 'Teams meeting creation failed — confirming without a link');
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

    if (appointment.studentProfile) {
      await notificationService.dispatch({
        userId: appointment.studentProfile.userId,
        event: 'appointment.confirmed',
        title: `${APPOINTMENT_TYPE_LABELS[appointment.type]} confirmed`,
        body: meetingUrl ? 'Your meeting link is ready.' : undefined,
        actionUrl: '/portal/appointments',
        emailTemplate: 'appointment-confirmed',
        emailData: {
          reference: appointment.reference,
          startsAt: appointment.startsAt,
          meetingUrl,
        },
      });
    }
    // TODO(phase-1): email guest bookings directly, since they have no account
    // and therefore no in-app notification target.

    return updated;
  },

  async reschedule(appointmentId: string, options: { actorId: string; startsAt: Date }) {
    await this.assertSlotIsBookable(options.startsAt, appointmentId);

    const updated = await prisma.appointment.update({
      where: { id: appointmentId },
      data: { startsAt: options.startsAt, status: 'CONFIRMED', reminderSentAt: null },
      select: { id: true, reference: true, studentProfile: { select: { userId: true } } },
    });

    if (updated.studentProfile) {
      await notificationService.dispatch({
        userId: updated.studentProfile.userId,
        event: 'appointment.confirmed',
        title: 'Your appointment has been rescheduled',
        actionUrl: '/portal/appointments',
        emailTemplate: 'appointment-confirmed',
        emailData: { reference: updated.reference, startsAt: options.startsAt },
      });
    }

    return updated;
  },

  /**
   * Cancels a booking. When `studentProfileId` is supplied the update is scoped
   * to that student, so a student cannot cancel someone else's appointment.
   */
  async cancel(
    appointmentId: string,
    options: { actorId: string; studentProfileId?: string },
  ) {
    const result = await prisma.appointment.updateMany({
      where: {
        id: appointmentId,
        ...(options.studentProfileId ? { studentProfileId: options.studentProfileId } : {}),
        status: { in: ['REQUESTED', 'CONFIRMED'] },
      },
      data: { status: 'CANCELLED' },
    });

    if (result.count === 0) {
      throw new NotFoundError('That appointment could not be found or is already closed.');
    }

    await auditService.record({
      actorId: options.actorId,
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

  async listForStudent(studentProfileId: string) {
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

    const [upcoming, past] = await Promise.all([
      prisma.appointment.findMany({
        where: { studentProfileId, startsAt: { gte: now }, status: { notIn: ['CANCELLED'] } },
        select,
        orderBy: { startsAt: 'asc' },
      }),
      prisma.appointment.findMany({
        where: { studentProfileId, OR: [{ startsAt: { lt: now } }, { status: 'CANCELLED' }] },
        select,
        orderBy: { startsAt: 'desc' },
        take: 20,
      }),
    ]);

    return { upcoming, past };
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
   * Candidate slots for the booking form: weekdays, 09:00–16:15, for the next
   * three weeks, minus anything already taken.
   *
   * TODO(phase-2): replace with real counsellor availability read from the
   * Microsoft Graph calendar rather than a fixed working pattern.
   */
  async availableSlots(daysAhead = 21): Promise<Date[]> {
    const now = new Date();
    const horizon = new Date(now.getTime() + daysAhead * 86_400_000);

    const taken = await prisma.appointment.findMany({
      where: {
        startsAt: { gte: now, lte: horizon },
        status: { in: ['REQUESTED', 'CONFIRMED'] },
      },
      select: { startsAt: true },
    });
    const takenTimes = new Set(taken.map((a) => a.startsAt.getTime()));

    const slots: Date[] = [];
    const cursor = new Date(now);
    cursor.setMinutes(0, 0, 0);
    cursor.setDate(cursor.getDate() + 1);

    while (cursor < horizon) {
      const weekday = cursor.getDay();
      // Skip weekends.
      if (weekday !== 0 && weekday !== 6) {
        for (let minutes = 9 * 60; minutes + APPOINTMENT_DURATION_MINUTES <= 17 * 60; minutes += APPOINTMENT_DURATION_MINUTES) {
          const slot = new Date(cursor);
          slot.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
          if (slot > now && !takenTimes.has(slot.getTime())) slots.push(slot);
        }
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    return slots;
  },

  /** Rejects past times and double bookings. */
  async assertSlotIsBookable(startsAt: Date, excludeAppointmentId?: string): Promise<void> {
    if (Number.isNaN(startsAt.getTime())) {
      throw new ValidationError('Please choose a valid date and time.');
    }
    if (startsAt <= new Date()) {
      throw new ValidationError('Please choose a time in the future.');
    }

    const clash = await prisma.appointment.findFirst({
      where: {
        startsAt,
        status: { in: ['REQUESTED', 'CONFIRMED'] },
        ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
      },
      select: { id: true },
    });

    if (clash) {
      throw new ValidationError('That time has just been taken. Please choose another slot.');
    }
  },
};
