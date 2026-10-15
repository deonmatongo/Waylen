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
import { businessFormatter } from '../services/availability.service.js';

/**
 * How far ahead appointment reminders look. Vercel Cron runs the sweep once a
 * day, so the window must span a full day between runs: with a 48h look-ahead
 * every appointment is first seen 24-48h before it starts (a 24h window would
 * miss anything that starts between one run's cutoff and the next run), and
 * `reminderSentAt` stops it being sent again on later runs. Appointments booked
 * with less notice are caught on the next run while still in the future.
 */
export const APPOINTMENT_REMINDER_LOOKAHEAD_HOURS = 48;

/** Reminds attendees of appointments starting within the look-ahead window, once each. */
export async function sendAppointmentReminders(
  options: { now?: Date; lookaheadHours?: number } = {},
): Promise<void> {
  const now = options.now ?? new Date();
  const windowEnd = new Date(
    now.getTime() + (options.lookaheadHours ?? APPOINTMENT_REMINDER_LOOKAHEAD_HOURS) * 3_600_000,
  );
  const formatter = businessFormatter();

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
      format: true,
      startsAt: true,
      meetingUrl: true,
      location: true,
      guestName: true,
      guestEmail: true,
      studentProfile: { select: { userId: true } },
    },
  });

  let sent = 0;
  for (const appointment of appointments) {
    // Claim the row before sending so two overlapping runs cannot both remind.
    const claim = await prisma.appointment.updateMany({
      where: { id: appointment.id, reminderSentAt: null },
      data: { reminderSentAt: new Date() },
    });
    if (claim.count === 0) continue;

    const data = {
      reference: appointment.reference,
      startsAt: appointment.startsAt,
      startsAtLabel: formatter.dateTimeWithZone(appointment.startsAt),
      meetingUrl: appointment.meetingUrl,
      meetingLinkPending: appointment.format === 'ONLINE' && !appointment.meetingUrl,
      location: appointment.location,
    };

    try {
      if (appointment.studentProfile) {
        await notificationService.dispatch({
          userId: appointment.studentProfile.userId,
          event: 'appointment.reminder',
          title: `Reminder: ${APPOINTMENT_TYPE_LABELS[appointment.type]} on ${formatter.longDate(appointment.startsAt)}`,
          actionUrl: '/portal/appointments',
          emailTemplate: 'appointment-reminder',
          emailData: data,
        });
      } else if (appointment.guestEmail) {
        // Guest bookings have no account, so they are emailed directly.
        await mailService.send({
          to: appointment.guestEmail,
          subject: `Reminder: your Waylen consultation on ${formatter.longDate(appointment.startsAt)}`,
          template: 'appointment-reminder',
          data: { fullName: appointment.guestName, ...data },
        });
      }
      sent += 1;
    } catch (err) {
      // Release the claim so the next run retries; one failure must not stop the batch.
      logger.error({ err, appointmentId: appointment.id }, 'Appointment reminder failed');
      await prisma.appointment
        .update({ where: { id: appointment.id }, data: { reminderSentAt: null } })
        .catch((releaseErr) => logger.error({ err: releaseErr }, 'Could not release reminder claim'));
    }
  }

  if (sent > 0) {
    logger.info({ count: sent }, 'Appointment reminders processed');
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
