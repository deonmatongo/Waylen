/**
 * Invoicing and payments (PRD §5.2, §5.4, §8.1). Phase 2.
 *
 * Two money rules hold throughout:
 *   • amounts are integer minor units, never floats;
 *   • invoice numbers are sequential and gap-free, so the sequence is
 *     allocated inside the same transaction as the insert.
 */
import type { InvoiceStatus, PaymentMethod, Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';
import { invoiceNumber } from '../utils/reference.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import { notificationService } from './notification.service.js';
import { auditService } from './audit.service.js';
import { storageService } from './storage.service.js';

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

    return prisma.$transaction(async (tx) => {
      const year = new Date().getFullYear();
      // Counting inside the transaction is what keeps numbering gap-free.
      const issuedThisYear = await tx.invoice.count({
        where: { number: { startsWith: `INV-${year}-` } },
      });

      return tx.invoice.create({
        data: {
          number: invoiceNumber(year, issuedThisYear + 1),
          studentProfileId: input.studentProfileId,
          status: 'DRAFT',
          currency: input.currency ?? 'EUR',
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

  async findForStudent(invoiceId: string, studentProfileId: string) {
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, studentProfileId, status: { not: 'DRAFT' } },
      include: { lineItems: true, payments: { orderBy: { createdAt: 'desc' } } },
    });
    if (!invoice) throw new NotFoundError('That invoice could not be found.');
    return invoice;
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

  async listForStaff(filters: { status?: InvoiceStatus } = {}) {
    const where: Prisma.InvoiceWhereInput = filters.status ? { status: filters.status } : {};

    return prisma.invoice.findMany({
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
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
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

  /** The staff queue of submitted payments awaiting confirmation. */
  async listPendingPayments(options: { counsellorId?: string } = {}) {
    return prisma.payment.findMany({
      where: {
        status: 'PENDING',
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

    const { paidMinor, settled } = computeInvoiceSettlement(payment.invoice, payment.amountMinor);

    await prisma.$transaction([
      prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'SUCCEEDED', recordedById: input.recordedById, paidAt: new Date() },
      }),
      prisma.invoice.update({
        where: { id: payment.invoice.id },
        data: {
          paidMinor,
          status: settled ? 'PAID' : 'PARTIALLY_PAID',
          ...(settled ? { paidAt: new Date() } : {}),
        },
      }),
    ]);

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

  /** Records that an overdue reminder went out, and sends it. */
  async recordReminderSent(invoiceId: string) {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { number: true, studentProfileId: true, studentProfile: { select: { userId: true } } },
    });
    if (!invoice) throw new NotFoundError('That invoice could not be found.');

    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { reminderSentAt: new Date() },
    });

    await notificationService.dispatch({
      userId: invoice.studentProfile.userId,
      event: 'invoice.reminder',
      title: `Reminder: Invoice ${invoice.number} is due`,
      actionUrl: `/portal/invoices/${invoiceId}`,
      emailTemplate: 'invoice-reminder',
      emailData: { invoiceNumber: invoice.number },
    });
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
