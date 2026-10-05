/**
 * Gateway webhook ledger logic (PRD §8.1, phase 2) — pure and DB-free so it
 * is directly unit-testable.
 *
 * A gateway (Stripe/Paystack/Flutterwave) retries a webhook delivery on
 * anything but a 2xx response, and nothing stops the same event arriving
 * twice even on a 2xx (network retry races, provider-side at-least-once
 * delivery). The only way to make that safe is to key off the Payment's own
 * state rather than trust "this looks like a new event": once a Payment has
 * left PENDING, every subsequent webhook for the same `providerReference` is
 * a no-op.
 */
import type { InvoiceStatus, PaymentStatus } from '@prisma/client';

export interface LedgerPayment {
  status: PaymentStatus;
  amountMinor: number;
}

export interface LedgerInvoice {
  totalMinor: number;
  paidMinor: number;
}

export type GatewayOutcome = 'SUCCEEDED' | 'FAILED';

export interface LedgerUpdate {
  /** False means this event must not be applied — an idempotent replay. */
  apply: boolean;
  paymentStatus: PaymentStatus;
  /** Present only when the invoice balance changes (a SUCCEEDED outcome). */
  invoice?: { paidMinor: number; status: InvoiceStatus; settled: boolean };
}

/**
 * Decides what a verified gateway webhook should do to a Payment/Invoice
 * pair. Handles partial payment (outstanding balance remains, invoice goes
 * PARTIALLY_PAID) vs full settlement (invoice goes PAID), and clamps an
 * outcome that would overpay the invoice rather than throwing — a webhook
 * handler cannot ask the gateway to "try again with a smaller amount", so an
 * overpay (e.g. a manual payment landed concurrently) still settles the
 * invoice at its total rather than recording an impossible balance.
 */
export function computeGatewayLedgerUpdate(
  payment: LedgerPayment,
  invoice: LedgerInvoice,
  outcome: GatewayOutcome,
): LedgerUpdate {
  if (payment.status !== 'PENDING') {
    return { apply: false, paymentStatus: payment.status };
  }

  if (outcome === 'FAILED') {
    return { apply: true, paymentStatus: 'FAILED' };
  }

  const rawPaidMinor = invoice.paidMinor + payment.amountMinor;
  const paidMinor = Math.min(rawPaidMinor, invoice.totalMinor);
  const settled = rawPaidMinor >= invoice.totalMinor;

  return {
    apply: true,
    paymentStatus: 'SUCCEEDED',
    invoice: { paidMinor, status: settled ? 'PAID' : 'PARTIALLY_PAID', settled },
  };
}
