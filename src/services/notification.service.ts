/**
 * Notification dispatch (PRD §5.2).
 *
 * "Email and in-app at launch […] architected to extend to SMS/WhatsApp
 * later." That extension point is `CHANNELS_BY_EVENT`: adding a channel is a
 * change to that table plus a transport, not a change to every call site.
 */
import type { NotificationChannel, Prisma } from '@prisma/client';
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
  | 'enquiry.received'
  | 'document.approved'
  | 'document.needs_correction'
  | 'document.issued'
  | 'contract.issued'
  | 'contract.status_changed'
  | 'application.stage_changed'
  | 'application.offer_received'
  | 'invoice.issued'
  | 'invoice.reminder'
  | 'payment.received'
  | 'payment.proof_rejected'
  | 'message.received'
  | 'support.ticket_created'
  | 'support.ticket_reply'
  | 'support.ticket_resolved';

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
  'enquiry.received': ['IN_APP', 'EMAIL'],
  'document.approved': ['EMAIL', 'IN_APP'],
  'document.needs_correction': ['EMAIL', 'IN_APP'],
  'document.issued': ['EMAIL', 'IN_APP'],
  'contract.issued': ['EMAIL', 'IN_APP'],
  'contract.status_changed': ['IN_APP', 'EMAIL'],
  'application.stage_changed': ['IN_APP', 'EMAIL'],
  'application.offer_received': ['EMAIL', 'IN_APP'],
  'invoice.issued': ['EMAIL', 'IN_APP'],
  'invoice.reminder': ['EMAIL'],
  'payment.received': ['EMAIL', 'IN_APP'],
  'payment.proof_rejected': ['EMAIL', 'IN_APP'],
  'message.received': ['IN_APP', 'EMAIL'],
  'support.ticket_created': ['IN_APP', 'EMAIL'],
  'support.ticket_reply': ['IN_APP', 'EMAIL'],
  'support.ticket_resolved': ['IN_APP', 'EMAIL'],
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

const RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Base backoff: a row is retried no sooner than this * attempts after its last try. */
const RETRY_BACKOFF_MS = 15 * 60 * 1000;

/** Keeps only the JSON-serialisable part of the email data (Dates become ISO strings). */
export function toJsonSafe(data: Record<string, unknown> | undefined): Prisma.InputJsonObject | undefined {
  if (!data) return undefined;
  try {
    return JSON.parse(JSON.stringify(data)) as Prisma.InputJsonObject;
  } catch {
    return undefined;
  }
}

/** True once a row has waited out its backoff (15 min * attempts since lastAttemptAt). */
export function isRetryDue(attempts: number, lastAttemptAt: Date | null, now = Date.now()): boolean {
  if (!lastAttemptAt) return true;
  return now - lastAttemptAt.getTime() >= RETRY_BACKOFF_MS * Math.max(attempts, 1);
}

export const notificationService = {
  /**
   * Re-sends EMAIL rows that failed within the last 24h, using the template and
   * data persisted at dispatch time (generic template if none was stored).
   * Rows are retried at most `maxAttempts` times in total (the first send
   * counts), with a 15 min * attempts backoff from `lastAttemptAt`; a row that
   * exhausts its attempts is marked permanently failed and never picked again.
   * Meant to be called from a cron/job; safe to overlap because each attempt
   * is claimed by compare-and-set on `emailAttempts`.
   * Returns how many rows were sent and how many failed again.
   */
  async retryFailed(limit = 50, maxAttempts = 3): Promise<{ sent: number; failed: number }> {
    const now = Date.now();
    const rows = await prisma.notification.findMany({
      where: {
        channel: 'EMAIL',
        sentAt: null,
        failureReason: { not: null },
        emailAttempts: { lt: maxAttempts },
        createdAt: { gte: new Date(now - RETRY_WINDOW_MS) },
        OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lte: new Date(now - RETRY_BACKOFF_MS) } }],
      },
      orderBy: { createdAt: 'asc' },
      take: limit * 3,
      include: { user: { select: { email: true, fullName: true } } },
    });

    let sent = 0;
    let failed = 0;
    let processed = 0;
    for (const row of rows) {
      if (processed >= limit) break;
      if (row.emailAttempts >= maxAttempts) continue;
      if (!isRetryDue(row.emailAttempts, row.lastAttemptAt, now)) continue;

      // Claim the attempt (compare-and-set on emailAttempts) so overlapping
      // cron runs do not double-send.
      const attempt = row.emailAttempts + 1;
      const claimed = await prisma.notification.updateMany({
        where: { id: row.id, sentAt: null, emailAttempts: row.emailAttempts },
        data: { emailAttempts: attempt, lastAttemptAt: new Date() },
      });
      if (claimed.count === 0) continue;
      processed++;

      const extra =
        row.emailData && typeof row.emailData === 'object' && !Array.isArray(row.emailData)
          ? (row.emailData as Record<string, unknown>)
          : {};

      try {
        await mailService.send({
          to: row.user.email,
          subject: row.title,
          template: row.emailTemplate ?? 'generic',
          data: { fullName: row.user.fullName, title: row.title, body: row.body, actionUrl: row.actionUrl, ...extra },
        });
        await prisma.notification.update({
          where: { id: row.id },
          data: { sentAt: new Date(), failureReason: null },
        });
        sent++;
      } catch (err) {
        failed++;
        logger.error({ err, notificationId: row.id, attempt }, 'Notification email retry failed');
        const reason = err instanceof Error ? err.message : 'Unknown error';
        await prisma.notification.update({
          where: { id: row.id },
          data: {
            failureReason: attempt >= maxAttempts ? `Permanently failed after ${attempt} attempts: ${reason}` : reason,
          },
        });
      }
    }
    return { sent, failed };
  },

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
            // Persisted so retryFailed can re-render the original email.
            ...(channel === 'EMAIL'
              ? { emailTemplate: options.emailTemplate ?? null, emailData: toJsonSafe(options.emailData) }
              : {}),
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
            data: { sentAt: new Date(), emailAttempts: 1, lastAttemptAt: new Date() },
          });
        } catch (err) {
          logger.error({ err, event: options.event }, 'Failed to send notification email');
          await prisma.notification.update({
            where: { id: notification.id },
            data: {
              failureReason: err instanceof Error ? err.message : 'Unknown error',
              emailAttempts: 1,
              lastAttemptAt: new Date(),
            },
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
