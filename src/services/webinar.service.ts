/**
 * Webinar registration (PRD §4.5, §5.2).
 *
 * Registering twice with the same email is treated as a no-op success
 * (idempotent), not an error — a visitor who double-submits or a student who
 * registered publicly before signing in should never see a confusing
 * "already registered" failure.
 */
import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';
import { mailService } from './mail.service.js';
import { notificationService } from './notification.service.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';

export interface RegisterGuestInput {
  fullName: string;
  email: string;
  phone?: string;
}

type RegistrationData = Parameters<typeof prisma.webinarRegistration.create>[0]['data'];

const MAX_TX_ATTEMPTS = 4;

function prismaCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null ? (err as { code?: string }).code : undefined;
}

/**
 * Capacity check and insert in one Serializable transaction, so two
 * concurrent sign-ups for the last seat cannot both pass the count. A
 * serialization conflict (P2034) is retried; a unique violation (P2002, the
 * same email racing itself) resolves to the row that won, keeping
 * registration idempotent. `created` tells callers whether to send confirmation.
 */
async function createWithCapacity(webinarId: string, email: string, capacity: number | null, data: RegistrationData) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const existing = await tx.webinarRegistration.findUnique({
            where: { webinarId_email: { webinarId, email } },
          });
          if (existing) return { registration: existing, created: false };

          if (capacity != null) {
            const count = await tx.webinarRegistration.count({ where: { webinarId } });
            if (count >= capacity) {
              throw new ValidationError('That webinar is fully booked. Please check back for future sessions.');
            }
          }
          return { registration: await tx.webinarRegistration.create({ data }), created: true };
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (err) {
      const code = prismaCode(err);
      if (code === 'P2002') {
        const winner = await prisma.webinarRegistration.findUnique({
          where: { webinarId_email: { webinarId, email } },
        });
        if (winner) return { registration: winner, created: false };
      }
      if (code === 'P2034' && attempt < MAX_TX_ATTEMPTS) continue;
      throw err;
    }
  }
}

export const webinarService = {
  /** Public registration — no account required. */
  async registerGuest(slug: string, input: RegisterGuestInput) {
    const webinar = await prisma.webinar.findFirst({
      where: { slug, status: 'PUBLISHED' },
      select: { id: true, title: true, startsAt: true, joinUrl: true, location: true, capacity: true },
    });
    if (!webinar) throw new NotFoundError('That webinar could not be found.');

    const email = input.email.trim().toLowerCase();

    const existing = await prisma.webinarRegistration.findUnique({
      where: { webinarId_email: { webinarId: webinar.id, email } },
    });
    if (existing) return existing;

    const { registration, created } = await createWithCapacity(webinar.id, email, webinar.capacity, {
      webinarId: webinar.id,
      fullName: input.fullName.trim(),
      email,
      phone: input.phone ?? null,
    });
    if (!created) return registration;

    try {
      await mailService.send({
        to: email,
        subject: `You're registered: ${webinar.title}`,
        template: 'webinar-registered',
        data: {
          fullName: input.fullName,
          webinarTitle: webinar.title,
          startsAt: webinar.startsAt,
          joinUrl: webinar.joinUrl,
          location: webinar.location,
        },
      });
      await prisma.webinarRegistration.update({
        where: { id: registration.id },
        data: { confirmationSentAt: new Date() },
      });
    } catch (err) {
      // The registration itself succeeded — a failed confirmation email must
      // not roll that back or fail the caller's request.
      logger.error({ err, registrationId: registration.id }, 'Webinar confirmation email failed');
    }

    logger.info({ webinarId: webinar.id, registrationId: registration.id }, 'Guest registered for webinar');
    return registration;
  },

  /** Registration for an already-authenticated student. */
  async registerStudent(webinarId: string, options: { studentProfileId: string; userId: string }) {
    const webinar = await prisma.webinar.findFirst({
      where: { id: webinarId, status: 'PUBLISHED' },
      select: { id: true, title: true, startsAt: true, joinUrl: true, location: true, capacity: true },
    });
    if (!webinar) throw new NotFoundError('That webinar could not be found.');

    const student = await prisma.studentProfile.findUnique({
      where: { id: options.studentProfileId },
      select: { user: { select: { fullName: true, email: true } } },
    });
    if (!student) throw new NotFoundError('We could not find your student profile.');

    const email = student.user.email.toLowerCase();

    const existing = await prisma.webinarRegistration.findUnique({
      where: { webinarId_email: { webinarId, email } },
    });
    if (existing) return existing;

    const { registration, created } = await createWithCapacity(webinarId, email, webinar.capacity, {
      webinarId,
      studentProfileId: options.studentProfileId,
      fullName: student.user.fullName,
      email,
    });
    if (!created) return registration;

    try {
      await notificationService.dispatch({
        userId: options.userId,
        event: 'webinar.registered',
        title: `You're registered: ${webinar.title}`,
        actionUrl: '/portal/webinars',
        emailTemplate: 'webinar-registered',
        emailData: {
          webinarTitle: webinar.title,
          startsAt: webinar.startsAt,
          joinUrl: webinar.joinUrl,
          location: webinar.location,
        },
      });
      await prisma.webinarRegistration.update({
        where: { id: registration.id },
        data: { confirmationSentAt: new Date() },
      });
    } catch (err) {
      logger.error({ err, registrationId: registration.id }, 'Webinar confirmation notification failed');
    }

    logger.info({ webinarId, registrationId: registration.id }, 'Student registered for webinar');
    return registration;
  },
};
