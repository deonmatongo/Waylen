/**
 * Notification dispatch (PRD §5.2).
 *
 * "Email and in-app at launch […] architected to extend to SMS/WhatsApp
 * later." That extension point is `CHANNELS_BY_EVENT`: adding a channel is a
 * change to that table plus a transport, not a change to every call site.
 */
import type { NotificationChannel } from '@prisma/client';
import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';
import { mailService } from './mail.service.js';

/** Event keys, matching the triggers named in PRD §5.2. */
export type NotificationEvent =
  | 'account.created'
  | 'account.verified'
  | 'appointment.booked'
  | 'appointment.confirmed'
  | 'appointment.reminder'
  | 'appointment.cancelled'
  | 'webinar.registered'
  | 'webinar.reminder'
  | 'document.approved'
  | 'document.needs_correction'
  | 'document.issued'
  | 'application.stage_changed'
  | 'application.offer_received'
  | 'invoice.issued'
  | 'invoice.reminder'
  | 'payment.received'
  | 'message.received';

/**
 * Which channels each event uses. SMS and WHATSAPP are intentionally listed
 * nowhere yet — the enum and this table are ready, the transports are not.
 */
const CHANNELS_BY_EVENT: Record<NotificationEvent, NotificationChannel[]> = {
  'account.created': ['EMAIL'],
  'account.verified': ['EMAIL', 'IN_APP'],
  'appointment.booked': ['EMAIL', 'IN_APP'],
  'appointment.confirmed': ['EMAIL', 'IN_APP'],
  'appointment.reminder': ['EMAIL', 'IN_APP'],
  'appointment.cancelled': ['EMAIL', 'IN_APP'],
  'webinar.registered': ['EMAIL', 'IN_APP'],
  'webinar.reminder': ['EMAIL'],
  'document.approved': ['EMAIL', 'IN_APP'],
  'document.needs_correction': ['EMAIL', 'IN_APP'],
  'document.issued': ['EMAIL', 'IN_APP'],
  'application.stage_changed': ['IN_APP', 'EMAIL'],
  'application.offer_received': ['EMAIL', 'IN_APP'],
  'invoice.issued': ['EMAIL', 'IN_APP'],
  'invoice.reminder': ['EMAIL'],
  'payment.received': ['EMAIL', 'IN_APP'],
  'message.received': ['IN_APP', 'EMAIL'],
};

export interface DispatchOptions {
  userId: string;
  event: NotificationEvent;
  title: string;
  body?: string;
  actionUrl?: string;
  /** Template name under `src/views/emails`, when the event sends email. */
  emailTemplate?: string;
  emailData?: Record<string, unknown>;
}

export const notificationService = {
  /**
   * Fans an event out across its configured channels. Individual channel
   * failures are logged and recorded on the row — one failing transport must
   * not prevent the others, nor fail the caller's request.
   */
  async dispatch(options: DispatchOptions): Promise<void> {
    const channels = CHANNELS_BY_EVENT[options.event] ?? ['IN_APP'];

    const user = await prisma.user.findUnique({
      where: { id: options.userId },
      select: { email: true, fullName: true },
    });

    if (!user) {
      logger.warn({ userId: options.userId, event: options.event }, 'Notification target not found');
      return;
    }

    await Promise.allSettled(
      channels.map(async (channel) => {
        const notification = await prisma.notification.create({
          data: {
            userId: options.userId,
            channel,
            eventKey: options.event,
            title: options.title,
            body: options.body ?? null,
            actionUrl: options.actionUrl ?? null,
            // In-app notifications are "sent" the moment they are stored.
            sentAt: channel === 'IN_APP' ? new Date() : null,
          },
        });

        if (channel !== 'EMAIL') return;

        try {
          await mailService.send({
            to: user.email,
            subject: options.title,
            template: options.emailTemplate ?? 'generic',
            data: {
              fullName: user.fullName,
              title: options.title,
              body: options.body,
              actionUrl: options.actionUrl,
              ...options.emailData,
            },
          });
          await prisma.notification.update({
            where: { id: notification.id },
            data: { sentAt: new Date() },
          });
        } catch (err) {
          logger.error({ err, event: options.event }, 'Failed to send notification email');
          await prisma.notification.update({
            where: { id: notification.id },
            data: { failureReason: err instanceof Error ? err.message : 'Unknown error' },
          });
        }
      }),
    );
  },

  async listForUser(userId: string, options: { unreadOnly?: boolean; limit?: number } = {}) {
    return prisma.notification.findMany({
      where: {
        userId,
        channel: 'IN_APP',
        ...(options.unreadOnly ? { readAt: null } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: options.limit ?? 50,
    });
  },

  async countUnread(userId: string): Promise<number> {
    return prisma.notification.count({
      where: { userId, channel: 'IN_APP', readAt: null },
    });
  },

  /** Scoped by userId so one user cannot mark another's notification read. */
  async markRead(notificationId: string, userId: string): Promise<void> {
    await prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { readAt: new Date() },
    });
  },

  async markAllRead(userId: string): Promise<void> {
    await prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  },
};
