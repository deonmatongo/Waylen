/**
 * Automated reminders (PRD §4.5, §5.2 — "automatic reminders").
 *
 * Both sweeps are idempotent: the `reminderSentAt` stamp is what prevents a
 * second send, so a re-run after a crash cannot spam anyone.
 */
import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';
import { notificationService } from '../services/notification.service.js';
import { mailService } from '../services/mail.service.js';
import { APPOINTMENT_TYPE_LABELS } from '../config/constants.js';

/** Reminds attendees 24 hours ahead. */
export async function sendAppointmentReminders(): Promise<void> {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + 24 * 3_600_000);

  const appointments = await prisma.appointment.findMany({
    where: {
      status: 'CONFIRMED',
      startsAt: { gte: now, lte: windowEnd },
      reminderSentAt: null,
    },
    select: {
      id: true,
      reference: true,
      type: true,
      startsAt: true,
      meetingUrl: true,
      location: true,
      guestName: true,
      guestEmail: true,
      studentProfile: { select: { userId: true } },
    },
  });

  for (const appointment of appointments) {
    try {
      if (appointment.studentProfile) {
        await notificationService.dispatch({
          userId: appointment.studentProfile.userId,
          event: 'appointment.reminder',
          title: `Reminder: ${APPOINTMENT_TYPE_LABELS[appointment.type]} tomorrow`,
          actionUrl: '/portal/appointments',
          emailTemplate: 'appointment-reminder',
          emailData: {
            reference: appointment.reference,
            startsAt: appointment.startsAt,
            meetingUrl: appointment.meetingUrl,
            location: appointment.location,
          },
        });
      } else if (appointment.guestEmail) {
        // Guest bookings have no account, so they are emailed directly.
        await mailService.send({
          to: appointment.guestEmail,
          subject: 'Your Waylen consultation is tomorrow',
          template: 'appointment-reminder',
          data: {
            fullName: appointment.guestName,
            reference: appointment.reference,
            startsAt: appointment.startsAt,
            meetingUrl: appointment.meetingUrl,
            location: appointment.location,
          },
        });
      }

      await prisma.appointment.update({
        where: { id: appointment.id },
        data: { reminderSentAt: new Date() },
      });
    } catch (err) {
      // One failure must not stop the rest of the batch.
      logger.error({ err, appointmentId: appointment.id }, 'Appointment reminder failed');
    }
  }

  if (appointments.length > 0) {
    logger.info({ count: appointments.length }, 'Appointment reminders processed');
  }
}

/** Reminds webinar registrants 24 hours ahead (PRD §4.5). */
export async function sendWebinarReminders(): Promise<void> {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + 24 * 3_600_000);

  const registrations = await prisma.webinarRegistration.findMany({
    where: {
      reminderSentAt: null,
      webinar: { status: 'PUBLISHED', startsAt: { gte: now, lte: windowEnd } },
    },
    select: {
      id: true,
      fullName: true,
      email: true,
      webinar: { select: { title: true, startsAt: true, joinUrl: true, location: true } },
    },
  });

  for (const registration of registrations) {
    try {
      await mailService.send({
        to: registration.email,
        subject: `Reminder: ${registration.webinar.title} is tomorrow`,
        template: 'webinar-reminder',
        data: {
          fullName: registration.fullName,
          webinarTitle: registration.webinar.title,
          startsAt: registration.webinar.startsAt,
          joinUrl: registration.webinar.joinUrl,
          location: registration.webinar.location,
        },
      });

      await prisma.webinarRegistration.update({
        where: { id: registration.id },
        data: { reminderSentAt: new Date() },
      });
    } catch (err) {
      logger.error({ err, registrationId: registration.id }, 'Webinar reminder failed');
    }
  }

  if (registrations.length > 0) {
    logger.info({ count: registrations.length }, 'Webinar reminders processed');
  }
}
