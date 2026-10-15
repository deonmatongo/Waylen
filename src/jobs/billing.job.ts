/**
 * Billing sweeps (PRD §5.4 — invoice reminders).
 */
import { logger } from '../config/logger.js';
import { billingService } from '../services/billing.service.js';
import { features } from '../config/env.js';

/** An overdue invoice is re-reminded at most this often. */
const REMINDER_INTERVAL_DAYS = 3;
/** Gateway checkouts older than this are treated as abandoned. */
const STALE_CHECKOUT_HOURS = 48;

export async function flagOverdueInvoices(): Promise<void> {
  if (!features.payments) return;

  const count = await billingService.markOverdue();
  if (count > 0) logger.info({ count }, 'Invoices marked overdue');

  // Each invoice is claimed atomically inside `recordReminderSent`, so a
  // repeated or overlapping run skips anything reminded within the interval.
  let reminded = 0;
  for (const invoiceId of await billingService.listReminderCandidates(REMINDER_INTERVAL_DAYS)) {
    try {
      if (await billingService.recordReminderSent(invoiceId, { minIntervalDays: REMINDER_INTERVAL_DAYS })) {
        reminded += 1;
      }
    } catch (err) {
      logger.error({ err, invoiceId }, 'Failed to send overdue invoice reminder');
    }
  }
  if (reminded > 0) logger.info({ count: reminded }, 'Overdue invoice reminders sent');

  try {
    const expired = await billingService.expireStalePendingPayments(STALE_CHECKOUT_HOURS);
    if (expired > 0) logger.info({ count: expired }, 'Abandoned gateway checkouts expired');
  } catch (err) {
    logger.error({ err }, 'Failed to expire abandoned gateway checkouts');
  }
}
