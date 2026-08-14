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

export interface LineItemInput {
  description: string;
  quantity: number;
  unitPriceMinor: number;
  category?: string;
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
    if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
      throw new ValidationError('Enter a valid payment amount.');
    }

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

    const paidMinor = invoice.paidMinor + input.amountMinor;
    if (paidMinor > invoice.totalMinor) {
      throw new ValidationError('That payment exceeds the outstanding balance on this invoice.');
    }

    const settled = paidMinor >= invoice.totalMinor;

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
};
