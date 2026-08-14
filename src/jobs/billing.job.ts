/**
 * Billing sweeps (PRD §5.4 — invoice reminders).
 */
import { logger } from '../config/logger.js';
import { billingService } from '../services/billing.service.js';
import { features } from '../config/env.js';

export async function flagOverdueInvoices(): Promise<void> {
  if (!features.payments) return;

  const count = await billingService.markOverdue();
  if (count > 0) logger.info({ count }, 'Invoices marked overdue');

  // TODO(phase-2): send the reminder emails for newly overdue invoices.
}
