/**
 * Invoices & payments over the JSON API. Mounted behind FEATURE_PAYMENTS.
 */
import type { Request, Response } from 'express';
import { billingService } from '../../services/billing.service.js';
import { createCheckoutSession } from '../../services/payments/gateway.service.js';
import { idParamSchema } from '../../validators/api.validator.js';
import { ServiceUnavailableError, ValidationError } from '../../utils/errors.js';
import { paginate, parse, parsePagination, requireStudent } from './helpers.js';

type InvoiceWithRelations = Awaited<ReturnType<typeof billingService.findForStudent>>;

/**
 * Public shape of an invoice. Payments are trimmed to what a student needs —
 * receipt paths/checksums, gateway references and the recording admin's id
 * stay server-side.
 */
export function serializeInvoice(invoice: InvoiceWithRelations) {
  return {
    id: invoice.id,
    number: invoice.number,
    status: invoice.status,
    currency: invoice.currency,
    subtotalMinor: invoice.subtotalMinor,
    taxMinor: invoice.taxMinor,
    totalMinor: invoice.totalMinor,
    paidMinor: invoice.paidMinor,
    outstandingMinor: Math.max(0, invoice.totalMinor - invoice.paidMinor),
    description: invoice.description,
    issuedAt: invoice.issuedAt,
    dueAt: invoice.dueAt,
    paidAt: invoice.paidAt,
    lineItems: invoice.lineItems,
    payments: invoice.payments.map((p) => ({
      id: p.id,
      method: p.method,
      status: p.status,
      amountMinor: p.amountMinor,
      currency: p.currency,
      paidAt: p.paidAt,
      failureReason: p.failureReason,
      createdAt: p.createdAt,
    })),
  };
}

/** GET /invoices */
export async function list(req: Request, res: Response): Promise<void> {
  const student = await requireStudent(req);
  const [invoices, summary] = await Promise.all([
    billingService.listForStudent(student.id),
    billingService.outstandingBalance(student.id),
  ]);

  res.json({ ...paginate(invoices.map(serializeInvoice), parsePagination(req)), summary });
}

/** GET /invoices/:id */
export async function show(req: Request, res: Response): Promise<void> {
  const student = await requireStudent(req);
  const { id } = parse(idParamSchema, req.params);
  res.json(serializeInvoice(await billingService.findForStudent(id, student.id)));
}

/**
 * POST /invoices/:id/pay — same steps as the web `startPayment`, answering
 * with the hosted checkout URL instead of a redirect.
 */
export async function pay(req: Request, res: Response): Promise<void> {
  const student = await requireStudent(req);
  const { id } = parse(idParamSchema, req.params);
  const invoice = await billingService.findForStudent(id, student.id);

  if (!['SENT', 'PARTIALLY_PAID', 'OVERDUE'].includes(invoice.status)) {
    throw new ValidationError('This invoice is not open for payment.');
  }

  const outstandingMinor = invoice.totalMinor - invoice.paidMinor;
  if (outstandingMinor <= 0) throw new ValidationError('This invoice is already paid in full.');

  const session = await createCheckoutSession({
    invoiceId: invoice.id,
    invoiceNumber: invoice.number,
    amountMinor: outstandingMinor,
    currency: invoice.currency,
    studentEmail: req.currentUser!.email,
    studentName: req.currentUser!.fullName,
  });

  if (!session) {
    throw new ServiceUnavailableError(
      'Online card payment is not switched on yet. Please use the bank details on your invoice.',
    );
  }

  await billingService.createPendingGatewayPayment({
    invoiceId: invoice.id,
    method: session.method,
    provider: session.provider,
    providerReference: session.providerReference,
    amountMinor: outstandingMinor,
    currency: invoice.currency,
  });

  res.json({ checkoutUrl: session.checkoutUrl, amountMinor: outstandingMinor, currency: invoice.currency });
}
