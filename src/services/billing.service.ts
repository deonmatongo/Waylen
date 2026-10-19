/**
 * Invoicing and payments (PRD §5.2, §5.4, §8.1). Phase 2.
 *
 * Two money rules hold throughout:
 *   • amounts are integer minor units, never floats;
 *   • invoice numbers are sequential and gap-free, so the sequence is
 *     allocated inside the same transaction as the insert.
 */
import type { InvoiceStatus, PaymentMethod, Prisma } from '@prisma/client';
import { DEFAULT_CURRENCY } from '../config/packages.js';
import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';
import { formatMoney } from '../utils/format.js';
import { invoiceNumber } from '../utils/reference.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/errors.js';
import { notificationService } from './notification.service.js';
import { auditService } from './audit.service.js';
import { storageService } from './storage.service.js';
import { computeGatewayLedgerUpdate, type GatewayOutcome } from './payments/ledger.js';
import { refundGatewayPayment } from './payments/gateway.service.js';

export interface LineItemInput {
  description: string;
  quantity: number;
  unitPriceMinor: number;
  category?: string;
}

/**
 * The settle-math shared by every path that applies a successful payment to
 * an invoice — manual reconciliation and confirming a student-submitted
 * proof of payment both need the same paidMinor/status transition.
 */
function computeInvoiceSettlement(
  invoice: { totalMinor: number; paidMinor: number },
  amountMinor: number,
): { paidMinor: number; settled: boolean } {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new ValidationError('Enter a valid payment amount.');
  }

  const paidMinor = invoice.paidMinor + amountMinor;
  if (paidMinor > invoice.totalMinor) {
    throw new ValidationError('That payment exceeds the outstanding balance on this invoice.');
  }

  return { paidMinor, settled: paidMinor >= invoice.totalMinor };
}

/** Receipt number for one payment: the invoice number plus a short, stable suffix of the payment id. */
export function receiptNumber(invoiceNumberValue: string, paymentId: string): string {
  return `RCT-${invoiceNumberValue}-${paymentId.slice(-6).toUpperCase()}`;
}

/** failureReason stamped on a gateway checkout nobody completed — see expireStalePendingPayments. */
const ABANDONED_REASON = 'Checkout abandoned — expired without a gateway confirmation.';
const INVOICE_NUMBER_ATTEMPTS = 3;
/** A gateway checkout this young is assumed to still be open in the student's browser. */
const ACTIVE_CHECKOUT_WINDOW_MS = 60 * 60 * 1000;
const POLICY_NUMBER_PATTERN = /WYL-INS-[A-Z0-9]{6}/;

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002';
}

/** Highest sequence already issued this year — not a count, so deleted/skipped rows cannot cause a clash. */
async function lastInvoiceSequence(tx: Prisma.TransactionClient, year: number): Promise<number> {
  const prefix = `INV-${year}-`;
  const last = await tx.invoice.findFirst({
    where: { number: { startsWith: prefix } },
    orderBy: { number: 'desc' },
    select: { number: true },
  });
  const sequence = last ? Number.parseInt(last.number.slice(prefix.length), 10) : 0;
  return Number.isFinite(sequence) ? sequence : 0;
}

/**
 * Insurance is sold as an invoice (category INSURANCE) whose description
 * carries the policy number; the policy sits PENDING until that invoice is
 * PAID and is cancelled again if the payment is refunded. Failures here are
 * logged, never thrown — they must not fail a webhook or the money movement
 * that has already happened.
 */
async function syncInsuranceForInvoice(invoiceId: string, to: 'ACTIVE' | 'CANCELLED'): Promise<void> {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        description: true,
        studentProfileId: true,
        lineItems: { select: { category: true } },
      },
    });
    if (!invoice || !invoice.lineItems.some((item) => item.category === 'INSURANCE')) return;
    const policyNumber = invoice.description?.match(POLICY_NUMBER_PATTERN)?.[0];
    if (!policyNumber) return;

    const result = await prisma.insurancePolicy.updateMany({
      where: {
        policyNumber,
        studentProfileId: invoice.studentProfileId,
        status: to === 'ACTIVE' ? 'PENDING' : { in: ['PENDING', 'ACTIVE'] },
      },
      data: { status: to },
    });
    if (result.count === 0) return;

    await auditService.record({
      actorId: null,
      action: 'UPDATE',
      entity: 'InsurancePolicy',
      entityId: policyNumber,
      studentProfileId: invoice.studentProfileId,
      changes: { status: { to }, invoiceId },
    });
    logger.info({ invoiceId, policyNumber, to }, 'Insurance policy status synced from invoice');
  } catch (err) {
    logger.error({ err, invoiceId }, 'Failed to sync insurance policy with invoice payment');
  }
}

/** An overpay is money we cannot silently absorb — tell every active admin. */
async function notifyStaffOfOverpayment(details: {
  invoiceNumber: string;
  invoiceId: string;
  overpaidMinor: number;
  currency: string;
}): Promise<void> {
  try {
    const staff = await prisma.user.findMany({
      where: { role: { in: ['ADMIN_STAFF', 'SUPER_ADMIN'] }, status: 'ACTIVE' },
      select: { id: true },
    });
    await Promise.allSettled(
      staff.map((member) =>
        notificationService.dispatch({
          userId: member.id,
          event: 'payment.received',
          title: `Overpayment on invoice ${details.invoiceNumber}`,
          body: `A gateway payment exceeded the invoice total by ${details.overpaidMinor} minor units (${details.currency}). Review and refund the excess.`,
          actionUrl: `/admin/invoices/${details.invoiceId}`,
        }),
      ),
    );
  } catch (err) {
    logger.error({ err, invoiceId: details.invoiceId }, 'Failed to notify staff of overpayment');
  }
}

export const billingService = {
  async createInvoice(input: {
    studentProfileId: string;
    lineItems: LineItemInput[];
    currency?: string;
    description?: string;
    dueAt?: Date;
    taxMinor?: number;
  }) {
    if (input.lineItems.length === 0) {
      throw new ValidationError('An invoice needs at least one line item.');
    }
    if (input.lineItems.some((i) => i.unitPriceMinor < 0 || i.quantity < 1)) {
      throw new ValidationError('Line item quantities and prices must be positive.');
    }

    const subtotalMinor = input.lineItems.reduce(
      (sum, item) => sum + item.unitPriceMinor * item.quantity,
      0,
    );
    const taxMinor = input.taxMinor ?? 0;

    const create = () =>
      prisma.$transaction(async (tx) => {
        const year = new Date().getFullYear();
        // Sequence is derived inside the transaction; the unique index on
        // `number` is the real guard, so a concurrent allocator that wins
        // the race surfaces as P2002 and is retried below.
        const sequence = (await lastInvoiceSequence(tx, year)) + 1;

        return tx.invoice.create({
          data: {
            number: invoiceNumber(year, sequence),
            studentProfileId: input.studentProfileId,
            status: 'DRAFT',
            currency: input.currency ?? DEFAULT_CURRENCY,
            subtotalMinor,
            taxMinor,
            totalMinor: subtotalMinor + taxMinor,
            description: input.description ?? null,
            dueAt: input.dueAt ?? null,
            lineItems: {
              create: input.lineItems.map((item) => ({
                description: item.description,
                quantity: item.quantity,
                unitPriceMinor: item.unitPriceMinor,
                totalMinor: item.unitPriceMinor * item.quantity,
                category: item.category ?? null,
              })),
            },
          },
          include: { lineItems: true },
        });
      });

    for (let attempt = 1; ; attempt++) {
      try {
        return await create();
      } catch (err) {
        if (!isUniqueViolation(err) || attempt >= INVOICE_NUMBER_ATTEMPTS) throw err;
        logger.warn({ attempt }, 'Invoice number collision — retrying allocation');
      }
    }
  },

  /**
   * Records a payment reconciled by hand — bank transfer, SWIFT, Revolut and
   * cash never arrive through a gateway webhook (PRD §8.1).
   */
  async recordManualPayment(input: {
    invoiceId: string;
    recordedById: string;
    method: PaymentMethod;
    amountMinor: number;
    manualReference?: string;
  }) {
    const invoice = await prisma.invoice.findUnique({
      where: { id: input.invoiceId },
      select: {
        id: true,
        totalMinor: true,
        paidMinor: true,
        currency: true,
        studentProfileId: true,
        studentProfile: { select: { userId: true } },
      },
    });
    if (!invoice) throw new NotFoundError('That invoice could not be found.');

    const { paidMinor, settled } = computeInvoiceSettlement(invoice, input.amountMinor);

    await prisma.$transaction([
      prisma.payment.create({
        data: {
          invoiceId: invoice.id,
          method: input.method,
          status: 'SUCCEEDED',
          amountMinor: input.amountMinor,
          currency: invoice.currency,
          manualReference: input.manualReference ?? null,
          recordedById: input.recordedById,
          paidAt: new Date(),
        },
      }),
      prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          paidMinor,
          status: settled ? 'PAID' : 'PARTIALLY_PAID',
          ...(settled ? { paidAt: new Date() } : {}),
        },
      }),
    ]);

    await auditService.record({
      actorId: input.recordedById,
      action: 'CREATE',
      entity: 'Payment',
      entityId: invoice.id,
      studentProfileId: invoice.studentProfileId,
      changes: { amountMinor: input.amountMinor, method: input.method },
    });

    if (settled) await syncInsuranceForInvoice(invoice.id, 'ACTIVE');

    await notificationService.dispatch({
      userId: invoice.studentProfile.userId,
      event: 'payment.received',
      title: settled ? 'Your invoice is paid in full' : 'We have received your payment',
      actionUrl: `/portal/invoices/${invoice.id}`,
      emailTemplate: 'payment-received',
      emailData: { amountMinor: input.amountMinor, currency: invoice.currency },
    });

    logger.info({ invoiceId: invoice.id, settled }, 'Manual payment recorded');
  },

  async listForStudent(studentProfileId: string) {
    return prisma.invoice.findMany({
      where: { studentProfileId, status: { not: 'DRAFT' } },
      include: { lineItems: true, payments: { orderBy: { createdAt: 'desc' } } },
      orderBy: { createdAt: 'desc' },
    });
  },

  /**
   * One page of a student's invoices (newest first) plus the open balance
   * across ALL their invoices, per currency — a page-local sum would
   * under-report once the list spans more than one page.
   */
  async listPageForStudent(studentProfileId: string, options: { page?: number; perPage?: number } = {}) {
    const perPage = Math.min(100, Math.max(1, options.perPage ?? 20));
    const where: Prisma.InvoiceWhereInput = { studentProfileId, status: { not: 'DRAFT' } };
    const total = await prisma.invoice.count({ where });
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    const page = Math.min(totalPages, Math.max(1, Math.floor(options.page ?? 1) || 1));

    const [items, open] = await Promise.all([
      prisma.invoice.findMany({
        where,
        include: { lineItems: true, payments: { orderBy: { createdAt: 'desc' } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      prisma.invoice.findMany({
        where: { studentProfileId, status: { in: ['SENT', 'PARTIALLY_PAID', 'OVERDUE'] } },
        select: { totalMinor: true, paidMinor: true, currency: true, status: true },
      }),
    ]);

    const byCurrency = new Map<string, number>();
    for (const invoice of open) {
      byCurrency.set(
        invoice.currency,
        (byCurrency.get(invoice.currency) ?? 0) + (invoice.totalMinor - invoice.paidMinor),
      );
    }

    return {
      items,
      total,
      page,
      perPage,
      totalPages,
      outstanding: [...byCurrency].map(([currency, amountMinor]) => ({ currency, amountMinor })),
      overdueCount: open.filter((invoice) => invoice.status === 'OVERDUE').length,
    };
  },

  async findForStudent(invoiceId: string, studentProfileId: string) {
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, studentProfileId, status: { not: 'DRAFT' } },
      include: { lineItems: true, payments: { orderBy: { createdAt: 'desc' } } },
    });
    if (!invoice) throw new NotFoundError('That invoice could not be found.');
    return invoice;
  },

  /**
   * A single confirmed payment for its owner's receipt. Ownership is part of
   * the query (payment -> invoice -> student), so another student's payment
   * id is indistinguishable from a missing one.
   */
  async findReceiptForStudent(invoiceId: string, paymentId: string, studentProfileId: string) {
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, studentProfileId, status: { not: 'DRAFT' } },
      include: { payments: { where: { status: 'SUCCEEDED' }, orderBy: { createdAt: 'asc' } } },
    });
    const payment = invoice?.payments.find((p) => p.id === paymentId);
    if (!invoice || !payment) throw new NotFoundError('That receipt could not be found.');

    // Balance as it stood once this payment landed: everything confirmed up to and including it.
    const index = invoice.payments.findIndex((p) => p.id === paymentId);
    const paidToDate = invoice.payments
      .slice(0, index + 1)
      .reduce((sum, p) => sum + p.amountMinor - p.refundedMinor, 0);

    return {
      invoice,
      payment,
      receiptNumber: receiptNumber(invoice.number, payment.id),
      balanceAfterMinor: Math.max(0, invoice.totalMinor - paidToDate),
    };
  },

  async findById(invoiceId: string) {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        lineItems: true,
        payments: { orderBy: { createdAt: 'desc' } },
        studentProfile: {
          select: { id: true, reference: true, user: { select: { fullName: true, email: true } } },
        },
      },
    });
    if (!invoice) throw new NotFoundError('That invoice could not be found.');
    return invoice;
  },

  /** One page (25 by default) of invoices for staff, newest first, with the total for pagination. */
  async listForStaff(filters: { status?: InvoiceStatus; page?: number; perPage?: number } = {}) {
    const where: Prisma.InvoiceWhereInput = filters.status ? { status: filters.status } : {};
    const perPage = Math.min(100, Math.max(1, filters.perPage ?? 25));
    const total = await prisma.invoice.count({ where });
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    const page = Math.min(totalPages, Math.max(1, Math.floor(filters.page ?? 1) || 1));

    const items = await prisma.invoice.findMany({
      where,
      select: {
        id: true,
        number: true,
        status: true,
        currency: true,
        totalMinor: true,
        paidMinor: true,
        issuedAt: true,
        dueAt: true,
        studentProfile: {
          select: { id: true, reference: true, user: { select: { fullName: true } } },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * perPage,
      take: perPage,
    });
    return { items, total, page, perPage, totalPages };
  },

  async voidInvoice(invoiceId: string, actorId: string) {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { paidMinor: true, studentProfileId: true },
    });
    if (!invoice) throw new NotFoundError('That invoice could not be found.');
    if (invoice.paidMinor > 0) {
      // Voiding a part-paid invoice would orphan the payment record.
      throw new ValidationError('This invoice has payments against it and must be refunded, not voided.');
    }

    await prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'VOID' } });

    await auditService.record({
      actorId,
      action: 'UPDATE',
      entity: 'Invoice',
      entityId: invoiceId,
      studentProfileId: invoice.studentProfileId,
      changes: { status: { to: 'VOID' } },
    });
  },

  /** Flags invoices past their due date, for the nightly reminder job. */
  async markOverdue(): Promise<number> {
    const result = await prisma.invoice.updateMany({
      where: {
        status: { in: ['SENT', 'PARTIALLY_PAID'] },
        dueAt: { lt: new Date() },
      },
      data: { status: 'OVERDUE' },
    });
    return result.count;
  },

  /**
   * Student-submitted claim of a bank transfer/SWIFT/Revolut/cash payment,
   * with a receipt attached. Lands as PENDING — it does not touch the
   * invoice balance until staff confirm it (PRD §8.1).
   */
  async submitProofOfPayment(input: {
    invoiceId: string;
    studentProfileId: string;
    method: PaymentMethod;
    amountMinor: number;
    manualReference?: string;
    storageKey: string;
    receiptChecksum: string;
  }) {
    if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
      throw new ValidationError('Enter how much you paid.');
    }

    const invoice = await prisma.invoice.findFirst({
      where: { id: input.invoiceId, studentProfileId: input.studentProfileId },
      select: { id: true, status: true, currency: true },
    });
    if (!invoice) throw new NotFoundError('That invoice could not be found.');
    if (!['SENT', 'PARTIALLY_PAID', 'OVERDUE'].includes(invoice.status)) {
      throw new ValidationError('This invoice is not open for payment.');
    }

    const payment = await prisma.payment.create({
      data: {
        invoiceId: invoice.id,
        method: input.method,
        status: 'PENDING',
        amountMinor: input.amountMinor,
        currency: invoice.currency,
        manualReference: input.manualReference ?? null,
        receiptPath: input.storageKey,
        receiptChecksum: input.receiptChecksum,
      },
    });

    logger.info({ invoiceId: invoice.id, paymentId: payment.id }, 'Proof of payment submitted');
    return payment;
  },

  /**
   * Opens a Payment row the moment a gateway checkout session is created.
   * The webhook that eventually arrives — success or failure, possibly more
   * than once — is matched back to it by `providerReference` (PRD §8.1,
   * phase 3).
   */
  async createPendingGatewayPayment(input: {
    invoiceId: string;
    method: PaymentMethod;
    provider: string;
    providerReference: string;
    amountMinor: number;
    currency: string;
  }) {
    return prisma.payment.create({
      data: {
        invoiceId: input.invoiceId,
        method: input.method,
        status: 'PENDING',
        amountMinor: input.amountMinor,
        currency: input.currency,
        provider: input.provider,
        providerReference: input.providerReference,
      },
    });
  },

  /** The staff queue of submitted payments awaiting confirmation. */
  async listPendingPayments(options: { counsellorId?: string } = {}) {
    return prisma.payment.findMany({
      where: {
        status: 'PENDING',
        // Gateway checkouts settle themselves via webhook (or expire) —
        // only proof-of-payment rows (no provider) await staff review.
        provider: null,
        ...(options.counsellorId
          ? { invoice: { studentProfile: { assignedCounsellorId: options.counsellorId } } }
          : {}),
      },
      select: {
        id: true,
        method: true,
        amountMinor: true,
        currency: true,
        manualReference: true,
        createdAt: true,
        invoice: {
          select: {
            id: true,
            number: true,
            studentProfile: {
              select: { id: true, reference: true, user: { select: { fullName: true } } },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  },

  /**
   * Decrypts the receipt attached to a submitted payment. Access must
   * already have been checked by the caller via `assertCanAccessStudent`.
   */
  async retrieveProofOfPayment(paymentId: string): Promise<Buffer> {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      select: { receiptPath: true, receiptChecksum: true },
    });
    if (!payment?.receiptPath) throw new NotFoundError('That receipt could not be found.');

    return storageService.retrieve(payment.receiptPath, payment.receiptChecksum);
  },

  /** Staff confirms a submitted payment — settles the invoice (PRD §8.1). */
  async confirmPendingPayment(input: { paymentId: string; recordedById: string }) {
    const payment = await prisma.payment.findUnique({
      where: { id: input.paymentId },
      select: {
        id: true,
        status: true,
        amountMinor: true,
        invoice: {
          select: {
            id: true,
            totalMinor: true,
            paidMinor: true,
            currency: true,
            studentProfileId: true,
            studentProfile: { select: { userId: true } },
          },
        },
      },
    });
    if (!payment) throw new NotFoundError('That payment could not be found.');
    if (payment.status !== 'PENDING') {
      throw new ValidationError('That payment has already been reviewed.');
    }

    // The PENDING -> SUCCEEDED claim and the invoice increment share one
    // transaction: `updateMany` with a status guard is an atomic
    // compare-and-set, so two concurrent confirmations cannot both apply
    // `paidMinor`. The invoice is re-read inside the transaction for the same
    // reason — the read above may be stale by now.
    const { settled } = await prisma.$transaction(async (tx) => {
      const claimed = await tx.payment.updateMany({
        where: { id: payment.id, status: 'PENDING' },
        data: { status: 'SUCCEEDED', recordedById: input.recordedById, paidAt: new Date() },
      });
      if (claimed.count !== 1) {
        throw new ValidationError('That payment has already been reviewed.');
      }

      const invoice = await tx.invoice.findUniqueOrThrow({
        where: { id: payment.invoice.id },
        select: { totalMinor: true, paidMinor: true },
      });
      const result = computeInvoiceSettlement(invoice, payment.amountMinor);
      await tx.invoice.update({
        where: { id: payment.invoice.id },
        data: {
          paidMinor: result.paidMinor,
          status: result.settled ? 'PAID' : 'PARTIALLY_PAID',
          ...(result.settled ? { paidAt: new Date() } : {}),
        },
      });
      return result;
    });

    await auditService.record({
      actorId: input.recordedById,
      action: 'UPDATE',
      entity: 'Payment',
      entityId: payment.id,
      studentProfileId: payment.invoice.studentProfileId,
      changes: { status: { from: 'PENDING', to: 'SUCCEEDED' } },
    });

    await notificationService.dispatch({
      userId: payment.invoice.studentProfile.userId,
      event: 'payment.received',
      title: settled ? 'Your invoice is paid in full' : 'We have received your payment',
      actionUrl: `/portal/invoices/${payment.invoice.id}`,
      emailTemplate: 'payment-received',
      emailData: { amountMinor: payment.amountMinor, currency: payment.invoice.currency },
    });

    if (settled) await syncInsuranceForInvoice(payment.invoice.id, 'ACTIVE');

    logger.info({ paymentId: payment.id, settled }, 'Pending payment confirmed');
  },

  /** Staff rejects a submitted payment — the invoice balance is untouched. */
  async rejectPendingPayment(input: { paymentId: string; recordedById: string; reason: string }) {
    const payment = await prisma.payment.findUnique({
      where: { id: input.paymentId },
      select: {
        id: true,
        status: true,
        invoice: {
          select: { id: true, studentProfileId: true, studentProfile: { select: { userId: true } } },
        },
      },
    });
    if (!payment) throw new NotFoundError('That payment could not be found.');
    if (payment.status !== 'PENDING') {
      throw new ValidationError('That payment has already been reviewed.');
    }

    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'FAILED', failureReason: input.reason, recordedById: input.recordedById },
    });

    await auditService.record({
      actorId: input.recordedById,
      action: 'UPDATE',
      entity: 'Payment',
      entityId: payment.id,
      studentProfileId: payment.invoice.studentProfileId,
      changes: { status: { from: 'PENDING', to: 'FAILED' }, reason: input.reason },
    });

    await notificationService.dispatch({
      userId: payment.invoice.studentProfile.userId,
      event: 'payment.proof_rejected',
      title: 'We could not confirm your payment',
      body: input.reason,
      actionUrl: `/portal/invoices/${payment.invoice.id}`,
      emailTemplate: 'payment-proof-rejected',
      emailData: { reason: input.reason },
    });

    logger.info({ paymentId: payment.id }, 'Pending payment rejected');
  },

  /**
   * Applies a verified gateway webhook outcome to the Payment it matches by
   * `providerReference`, and on success settles the invoice (PRD §8.1,
   * phase 2). Idempotent: `computeGatewayLedgerUpdate` refuses to re-apply a
   * Payment that has already left PENDING, so a replayed webhook is a no-op
   * rather than a double credit or a second notification.
   */
  async applyGatewayPaymentOutcome(input: {
    providerReference: string;
    outcome: GatewayOutcome;
    /**
     * What the gateway says was charged (minor units + ISO currency). When
     * given, a SUCCEEDED outcome is refused — and the payment flagged for
     * review — unless it matches the Payment row exactly.
     */
    gatewayReported?: { amountMinor: number; currency: string };
  }) {
    const payment = await prisma.payment.findUnique({
      where: { providerReference: input.providerReference },
      select: {
        id: true,
        status: true,
        amountMinor: true,
        currency: true,
        failureReason: true,
        invoice: {
          select: {
            id: true,
            number: true,
            totalMinor: true,
            paidMinor: true,
            currency: true,
            studentProfileId: true,
            studentProfile: { select: { userId: true } },
          },
        },
      },
    });

    if (!payment) {
      logger.warn({ providerReference: input.providerReference }, 'Webhook for unknown payment reference');
      return { applied: false as const };
    }

    // A checkout we expired as abandoned can still be paid late. Real money
    // beats our bookkeeping: a SUCCEEDED webhook reopens it rather than being
    // dropped as a replay of an already-finished payment.
    const reopen =
      input.outcome === 'SUCCEEDED' &&
      payment.status === 'FAILED' &&
      payment.failureReason === ABANDONED_REASON;
    const claimFrom = reopen
      ? ({ status: 'FAILED', failureReason: ABANDONED_REASON } as const)
      : ({ status: 'PENDING' } as const);

    const update = computeGatewayLedgerUpdate(
      reopen ? { ...payment, status: 'PENDING' } : payment,
      payment.invoice,
      input.outcome,
    );

    if (!update.apply) {
      logger.info(
        { paymentId: payment.id, status: payment.status },
        'Gateway webhook ignored — payment already settled (idempotent replay)',
      );
      return { applied: false as const };
    }

    if (
      input.outcome === 'SUCCEEDED' &&
      input.gatewayReported &&
      (input.gatewayReported.amountMinor !== payment.amountMinor ||
        input.gatewayReported.currency.toUpperCase() !== payment.currency.toUpperCase())
    ) {
      logger.error(
        {
          paymentId: payment.id,
          expected: { amountMinor: payment.amountMinor, currency: payment.currency },
          reported: input.gatewayReported,
        },
        'Gateway amount/currency mismatch — payment NOT settled, flagged for review',
      );
      await prisma.payment.updateMany({
        where: { id: payment.id, ...claimFrom },
        data: { failureReason: 'Gateway reported an amount or currency that does not match — needs manual review.' },
      });
      await auditService.record({
        actorId: null,
        action: 'UPDATE',
        entity: 'Payment',
        entityId: payment.id,
        studentProfileId: payment.invoice.studentProfileId,
        changes: { flagged: { from: null, to: 'gateway_amount_mismatch' } },
      });
      return { applied: false as const, flagged: true as const };
    }

    // Atomic claim: the status guard on `updateMany` means that of any number
    // of concurrent redeliveries only one sees count === 1, and only that one
    // touches the invoice or notifies. The invoice is re-read inside the
    // transaction so the increment is not computed from a stale snapshot.
    const claimed = await prisma.$transaction(async (tx) => {
      const result = await tx.payment.updateMany({
        where: { id: payment.id, ...claimFrom },
        data: {
          status: update.paymentStatus,
          ...(update.paymentStatus === 'SUCCEEDED' ? { paidAt: new Date(), failureReason: null } : {}),
          ...(update.paymentStatus === 'FAILED'
            ? { failureReason: 'Declined by the payment gateway.' }
            : {}),
        },
      });
      if (result.count !== 1) return null;
      if (update.paymentStatus !== 'SUCCEEDED') return { settled: false, overpaidMinor: 0 };

      const invoice = await tx.invoice.findUniqueOrThrow({
        where: { id: payment.invoice.id },
        select: { totalMinor: true, paidMinor: true },
      });
      const fresh = computeGatewayLedgerUpdate(
        { status: 'PENDING', amountMinor: payment.amountMinor },
        invoice,
        'SUCCEEDED',
      ).invoice;
      if (!fresh) return { settled: false, overpaidMinor: 0 };
      await tx.invoice.update({
        where: { id: payment.invoice.id },
        data: {
          paidMinor: fresh.paidMinor,
          status: fresh.status,
          ...(fresh.settled ? { paidAt: new Date() } : {}),
        },
      });

      // The ledger clamps paidMinor at the invoice total; the excess is real
      // money that must be refunded or credited, so it is recorded on the
      // payment instead of vanishing into the clamp.
      const overpaidMinor = Math.max(0, invoice.paidMinor + payment.amountMinor - invoice.totalMinor);
      if (overpaidMinor > 0) {
        await tx.payment.updateMany({
          where: { id: payment.id },
          data: { failureReason: `Overpaid by ${overpaidMinor} minor units — refund or credit required.` },
        });
      }
      return { settled: fresh.settled, overpaidMinor };
    });

    if (!claimed) {
      logger.info(
        { paymentId: payment.id },
        'Gateway webhook ignored — payment claimed by a concurrent delivery (idempotent replay)',
      );
      return { applied: false as const };
    }

    // actorId is null — this change was made by the gateway's webhook, not a
    // signed-in user, and AuditLog.actorId is nullable for exactly this case.
    await auditService.record({
      actorId: null,
      action: 'UPDATE',
      entity: 'Payment',
      entityId: payment.id,
      studentProfileId: payment.invoice.studentProfileId,
      changes: { status: { from: 'PENDING', to: update.paymentStatus } },
    });

    if (claimed.overpaidMinor > 0) {
      logger.error(
        {
          paymentId: payment.id,
          invoiceId: payment.invoice.id,
          overpaidMinor: claimed.overpaidMinor,
          currency: payment.invoice.currency,
        },
        'Gateway payment exceeds the invoice total — overpayment recorded, needs refund or credit',
      );
      await auditService.record({
        actorId: null,
        action: 'UPDATE',
        entity: 'Payment',
        entityId: payment.id,
        studentProfileId: payment.invoice.studentProfileId,
        changes: { flagged: { from: null, to: 'overpaid' }, overpaidMinor: claimed.overpaidMinor },
      });
      await notifyStaffOfOverpayment({
        invoiceNumber: payment.invoice.number,
        invoiceId: payment.invoice.id,
        overpaidMinor: claimed.overpaidMinor,
        currency: payment.invoice.currency,
      });
    }

    if (update.paymentStatus === 'SUCCEEDED') {
      if (claimed.settled) await syncInsuranceForInvoice(payment.invoice.id, 'ACTIVE');

      await notificationService.dispatch({
        userId: payment.invoice.studentProfile.userId,
        event: 'payment.received',
        title: claimed.settled ? 'Your invoice is paid in full' : 'We have received your payment',
        actionUrl: `/portal/invoices/${payment.invoice.id}`,
        emailTemplate: 'payment-received',
        emailData: { amountMinor: payment.amountMinor, currency: payment.invoice.currency },
      });
    } else {
      await notificationService.dispatch({
        userId: payment.invoice.studentProfile.userId,
        event: 'payment.proof_rejected',
        title: 'We could not confirm your payment',
        body: 'Your card payment was declined by the payment provider. Please try again or use the bank details on your invoice.',
        actionUrl: `/portal/invoices/${payment.invoice.id}`,
        emailTemplate: 'payment-proof-rejected',
        emailData: { reason: 'Your card payment was declined by the payment provider.' },
      });
    }

    logger.info(
      { paymentId: payment.id, outcome: input.outcome, settled: claimed.settled },
      'Gateway payment outcome applied',
    );

    return { applied: true as const, paymentId: payment.id };
  },

  /**
   * True while a gateway checkout opened in the last hour is still PENDING —
   * the student is presumably mid-payment, and a second session would let
   * them pay the same balance twice. The hosted-page URL is not stored, so
   * it cannot be re-shown; the caller tells the student to wait instead.
   */
  async hasActiveGatewayCheckout(invoiceId: string): Promise<boolean> {
    const count = await prisma.payment.count({
      where: {
        invoiceId,
        status: 'PENDING',
        provider: { not: null },
        createdAt: { gt: new Date(Date.now() - ACTIVE_CHECKOUT_WINDOW_MS) },
      },
    });
    return count > 0;
  },

  /**
   * Fails gateway checkouts nobody completed so they stop cluttering the
   * invoice. Proof-of-payment rows (no `provider`) wait on staff review and
   * are never touched. A late success webhook can still reopen one — see
   * `applyGatewayPaymentOutcome`.
   */
  async expireStalePendingPayments(olderThanHours = 48): Promise<number> {
    const result = await prisma.payment.updateMany({
      where: {
        status: 'PENDING',
        provider: { not: null },
        createdAt: { lt: new Date(Date.now() - olderThanHours * 3_600_000) },
      },
      data: { status: 'FAILED', failureReason: ABANDONED_REASON },
    });
    return result.count;
  },

  /**
   * Refunds a gateway payment (in full, or any number of partial amounts up to what is still refundable) through the
   * provider that took it, then books it: Payment -> REFUNDED, invoice
   * balance recomputed from the payments that still stand. ADMIN_STAFF and
   * SUPER_ADMIN only — enforced here as well as on the route.
   *
   * The Payment is claimed before the gateway is called so a double click
   * cannot refund twice; if the gateway refuses, the claim is rolled back.
   */
  async refundPayment(paymentId: string, actorId: string, amountMinor?: number) {
    const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { role: true } });
    if (!actor || (actor.role !== 'ADMIN_STAFF' && actor.role !== 'SUPER_ADMIN')) {
      throw new ForbiddenError('Only administrators can issue refunds.');
    }

    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        status: true,
        amountMinor: true,
        refundedMinor: true,
        currency: true,
        provider: true,
        providerReference: true,
        invoice: {
          select: {
            id: true,
            totalMinor: true,
            dueAt: true,
            studentProfileId: true,
            studentProfile: { select: { userId: true } },
          },
        },
      },
    });
    if (!payment) throw new NotFoundError('That payment could not be found.');
    if (payment.status !== 'SUCCEEDED') {
      throw new ValidationError('Only a successful payment can be refunded.');
    }
    if (!payment.provider || !payment.providerReference) {
      throw new ValidationError(
        'Only online card payments can be refunded here. Refund bank transfers outside the platform.',
      );
    }

    const refundableMinor = payment.amountMinor - payment.refundedMinor;
    const refundMinor = amountMinor ?? refundableMinor;
    if (!Number.isInteger(refundMinor) || refundMinor <= 0 || refundMinor > refundableMinor) {
      throw new ValidationError(
        refundableMinor > 0
          ? `Enter a refund amount between 1 and ${refundableMinor} (the amount still refundable).`
          : 'This payment has already been refunded in full.',
      );
    }
    const full = refundMinor === refundableMinor;

    // Optimistic claim on exactly the refundedMinor that was read — a
    // concurrent refund changes it, so refundedMinor can never pass amountMinor.
    const claimed = await prisma.payment.updateMany({
      where: { id: payment.id, status: 'SUCCEEDED', refundedMinor: payment.refundedMinor },
      data: { refundedMinor: { increment: refundMinor }, ...(full ? { status: 'REFUNDED' as const } : {}) },
    });
    if (claimed.count !== 1) {
      throw new ValidationError('That payment is already being refunded.');
    }

    let refundReference: string | undefined;
    try {
      ({ refundReference } = await refundGatewayPayment({
        provider: payment.provider,
        providerReference: payment.providerReference,
        amountMinor: refundMinor,
        currency: payment.currency,
        // Includes what was already refunded so two equal partials do not collide.
        idempotencyKey: `refund-${payment.id}-${payment.refundedMinor}-${refundMinor}`,
      }));
    } catch (err) {
      await prisma.payment.updateMany({
        where: { id: payment.id },
        data: { status: 'SUCCEEDED', refundedMinor: { decrement: refundMinor } },
      });
      throw err;
    }

    const invoice = await prisma.$transaction(async (tx) => {
      // What still stands: successful payments net of anything refunded from them.
      const remaining = await tx.payment.aggregate({
        where: { invoiceId: payment.invoice.id, status: 'SUCCEEDED' },
        _sum: { amountMinor: true, refundedMinor: true },
      });
      const stillPaid = (remaining._sum.amountMinor ?? 0) - (remaining._sum.refundedMinor ?? 0);
      const paidMinor = Math.min(payment.invoice.totalMinor, Math.max(0, stillPaid));
      const pastDue = payment.invoice.dueAt !== null && payment.invoice.dueAt < new Date();
      const status: InvoiceStatus =
        paidMinor === 0
          ? 'REFUNDED'
          : paidMinor < payment.invoice.totalMinor
            ? pastDue
              ? 'OVERDUE'
              : 'PARTIALLY_PAID'
            : 'PAID';

      await tx.invoice.update({
        where: { id: payment.invoice.id },
        data: { paidMinor, status, ...(status === 'PAID' ? {} : { paidAt: null }) },
      });
      return { paidMinor, status };
    });

    await auditService.record({
      actorId,
      action: 'UPDATE',
      entity: 'Payment',
      entityId: payment.id,
      studentProfileId: payment.invoice.studentProfileId,
      changes: {
        status: { from: 'SUCCEEDED', to: full ? 'REFUNDED' : 'SUCCEEDED (partial refund)' },
        refundedMinor: refundMinor,
        totalRefundedMinor: payment.refundedMinor + refundMinor,
        provider: payment.provider,
        refundReference: refundReference ?? null,
        invoiceStatus: invoice.status,
      },
    });

    if (invoice.status !== 'PAID') await syncInsuranceForInvoice(payment.invoice.id, 'CANCELLED');

    await notificationService.dispatch({
      userId: payment.invoice.studentProfile.userId,
      event: 'payment.received',
      title: 'A refund has been issued',
      body: `We have refunded ${formatMoney(refundMinor, payment.currency)} to your original payment method. It can take a few days to appear.`,
      actionUrl: `/portal/invoices/${payment.invoice.id}`,
    });

    logger.info({ paymentId: payment.id, refundMinor, full, actorId }, 'Payment refunded');
    return { refundedMinor: refundMinor, full, invoiceStatus: invoice.status };
  },

  /** Marks a draft invoice SENT and notifies the student it is ready. */
  async markSent(invoiceId: string, actorId: string) {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        status: true,
        number: true,
        studentProfileId: true,
        studentProfile: { select: { userId: true } },
      },
    });
    if (!invoice) throw new NotFoundError('That invoice could not be found.');
    if (invoice.status !== 'DRAFT') {
      throw new ValidationError('Only a draft invoice can be sent.');
    }

    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: 'SENT', issuedAt: new Date() },
    });

    await auditService.record({
      actorId,
      action: 'UPDATE',
      entity: 'Invoice',
      entityId: invoiceId,
      studentProfileId: invoice.studentProfileId,
      changes: { status: { from: 'DRAFT', to: 'SENT' } },
    });

    await notificationService.dispatch({
      userId: invoice.studentProfile.userId,
      event: 'invoice.issued',
      title: `Invoice ${invoice.number} is ready`,
      actionUrl: `/portal/invoices/${invoiceId}`,
      emailTemplate: 'invoice-issued',
      emailData: { invoiceNumber: invoice.number },
    });
  },

  /**
   * Records that an overdue reminder went out, and sends it. With
   * `minIntervalDays` the stamp is claimed atomically and nothing is sent if
   * a reminder already went out inside that window, so overlapping or
   * repeated job runs never re-email the same invoice. Returns whether a
   * reminder was sent.
   */
  async recordReminderSent(
    invoiceId: string,
    options: { minIntervalDays?: number } = {},
  ): Promise<boolean> {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        number: true,
        studentProfileId: true,
        studentProfile: { select: { userId: true } },
      },
    });
    if (!invoice) throw new NotFoundError('That invoice could not be found.');

    if (options.minIntervalDays !== undefined) {
      const cutoff = new Date(Date.now() - options.minIntervalDays * 86_400_000);
      const claimed = await prisma.invoice.updateMany({
        where: {
          id: invoiceId,
          status: { in: ['OVERDUE', 'PARTIALLY_PAID'] },
          OR: [{ reminderSentAt: null }, { reminderSentAt: { lt: cutoff } }],
        },
        data: { reminderSentAt: new Date() },
      });
      if (claimed.count !== 1) return false;
    } else {
      await prisma.invoice.update({
        where: { id: invoiceId },
        data: { reminderSentAt: new Date() },
      });
    }

    await notificationService.dispatch({
      userId: invoice.studentProfile.userId,
      event: 'invoice.reminder',
      title: `Reminder: Invoice ${invoice.number} is due`,
      actionUrl: `/portal/invoices/${invoiceId}`,
      emailTemplate: 'invoice-reminder',
      emailData: { invoiceNumber: invoice.number },
    });
    return true;
  },

  /** Overdue invoices not reminded within `minIntervalDays` (oldest reminder first). */
  async listReminderCandidates(minIntervalDays = 3, limit = 200): Promise<string[]> {
    const cutoff = new Date(Date.now() - minIntervalDays * 86_400_000);
    const rows = await prisma.invoice.findMany({
      where: {
        status: 'OVERDUE',
        OR: [{ reminderSentAt: null }, { reminderSentAt: { lt: cutoff } }],
      },
      select: { id: true },
      orderBy: { reminderSentAt: { sort: 'asc', nulls: 'first' } },
      take: limit,
    });
    return rows.map((row) => row.id);
  },

  /** Total outstanding across a student's open invoices, for the dashboard. */
  async outstandingBalance(studentProfileId: string) {
    const invoices = await prisma.invoice.findMany({
      where: { studentProfileId, status: { in: ['SENT', 'PARTIALLY_PAID', 'OVERDUE'] } },
      select: { totalMinor: true, paidMinor: true, currency: true, dueAt: true },
    });
    if (!invoices.length) return null;

    const totalOutstandingMinor = invoices.reduce(
      (sum, invoice) => sum + (invoice.totalMinor - invoice.paidMinor),
      0,
    );
    const nextDueAt =
      invoices
        .map((invoice) => invoice.dueAt)
        .filter((date): date is Date => date !== null)
        .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

    return { totalOutstandingMinor, currency: invoices[0]!.currency, nextDueAt };
  },
};
