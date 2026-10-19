/**
 * Payments & invoicing (PRD §5.4). Behind FEATURE_PAYMENTS.
 */
import type { Request, Response } from 'express';
import { prisma } from '../../config/database.js';
import { billingService } from '../../services/billing.service.js';
import { listStudents, staffVisibilityFilter } from '../../models/student.model.js';
import { assertCanAccessStudent } from '../../middleware/auth.js';
import {
  createInvoiceSchema,
  refundPaymentSchema,
  rejectPaymentSchema,
} from '../../validators/billing.validator.js';
import { NotFoundError, ValidationError } from '../../utils/errors.js';
import { PaymentMethod } from '@prisma/client';

export async function index(req: Request, res: Response): Promise<void> {
  const { status } = req.query;
  const requestedPage = Number.parseInt(typeof req.query.page === 'string' ? req.query.page : '1', 10);
  const [results, pendingPayments] = await Promise.all([
    billingService.listForStaff({
      status: status as never,
      page: Number.isFinite(requestedPage) ? requestedPage : 1,
      perPage: 25,
    }),
    billingService.listPendingPayments({
      counsellorId: req.currentUser!.role === 'COUNSELLOR' ? req.currentUser!.id : undefined,
    }),
  ]);

  res.render('admin/invoices/index', {
    title: 'Invoices',
    layout: 'layouts/admin',
    invoices: results.items,
    results,
    baseUrl: '/admin/invoices',
    // Only the filter survives into pagination links; `page` is set by the partial.
    query: typeof status === 'string' && status ? { status } : {},
    pendingCount: pendingPayments.length,
    filters: { status },
  });
}

export async function create(req: Request, res: Response): Promise<void> {
  const user = req.currentUser!;
  const students = await listStudents(staffVisibilityFilter(user.role, user.id), { perPage: 100 });

  res.render('admin/invoices/new', {
    title: 'New invoice',
    layout: 'layouts/admin',
    students: students.items,
    values: {},
    errors: {},
  });
}

/**
 * The line-item table posts parallel `name="field[]"` arrays rather than
 * nested `lineItems[0][field]` keys — the app's body parser runs in
 * `extended: false` mode, which has no notion of bracket-indexed objects.
 */
function parseLineItemRows(body: Record<string, string | string[] | undefined>) {
  const toArray = (value: string | string[] | undefined): string[] =>
    Array.isArray(value) ? value : value !== undefined ? [value] : [];

  const descriptions = toArray(body['description[]']);
  const quantities = toArray(body['quantity[]']);
  const unitPrices = toArray(body['unitPriceMinor[]']);
  const categories = toArray(body['category[]']);

  return descriptions
    .map((description, i) => ({
      description,
      quantity: quantities[i],
      unitPriceMinor: unitPrices[i],
      category: categories[i],
    }))
    // Blank optional rows submit as empty strings — drop them before validating.
    .filter((item) => item.description.trim());
}

export async function store(req: Request, res: Response): Promise<void> {
  const user = req.currentUser!;
  const students = await listStudents(staffVisibilityFilter(user.role, user.id), { perPage: 100 });

  const parsed = createInvoiceSchema.safeParse({
    ...req.body,
    lineItems: parseLineItemRows(req.body ?? {}),
  });
  if (!parsed.success) {
    res.status(422).render('admin/invoices/new', {
      title: 'New invoice',
      layout: 'layouts/admin',
      students: students.items,
      values: req.body,
      errors: parsed.error.flatten().fieldErrors,
      });
    return;
  }

  await assertCanAccessStudent(req, parsed.data.studentProfileId);
  const invoice = await billingService.createInvoice(parsed.data);

  req.flash('success', 'Invoice created as a draft. Send it when you are ready.');
  res.redirect(`/admin/invoices/${invoice.id}`);
}

export async function show(req: Request, res: Response): Promise<void> {
  const invoice = await billingService.findById(req.params.id as string);
  await assertCanAccessStudent(req, invoice.studentProfileId);

  res.render('admin/invoices/show', {
    title: `Invoice ${invoice.number}`,
    layout: 'layouts/admin',
    invoice,
    paymentMethods: Object.values(PaymentMethod),
  });
}

export async function send(req: Request, res: Response): Promise<void> {
  await assertCanAccessStudent(req, await loadInvoiceStudentProfileId(req.params.id as string));

  await billingService.markSent(req.params.id as string, req.currentUser!.id);

  req.flash('success', 'Invoice sent to the student.');
  res.redirect(`/admin/invoices/${req.params.id}`);
}

export async function recordPayment(req: Request, res: Response): Promise<void> {
  await assertCanAccessStudent(req, await loadInvoiceStudentProfileId(req.params.id as string));

  // Manual reconciliation for bank transfer, SWIFT and Revolut — these never
  // arrive through a gateway webhook, so staff record them here (PRD §8.1).
  await billingService.recordManualPayment({
    invoiceId: req.params.id as string,
    recordedById: req.currentUser!.id,
    method: req.body?.method,
    amountMinor: Number(req.body?.amountMinor),
    manualReference: req.body?.manualReference || undefined,
  });

  req.flash('success', 'Payment recorded.');
  res.redirect(`/admin/invoices/${req.params.id}`);
}

export async function sendReminder(req: Request, res: Response): Promise<void> {
  await assertCanAccessStudent(req, await loadInvoiceStudentProfileId(req.params.id as string));

  await billingService.recordReminderSent(req.params.id as string);

  req.flash('success', 'Reminder sent.');
  res.redirect(`/admin/invoices/${req.params.id}`);
}

export async function voidInvoice(req: Request, res: Response): Promise<void> {
  await billingService.voidInvoice(req.params.id as string, req.currentUser!.id);

  req.flash('success', 'Invoice voided.');
  res.redirect('/admin/invoices');
}

/** Payments submitted with proof, awaiting staff confirmation (PRD §8.1). */
export async function pendingQueue(req: Request, res: Response): Promise<void> {
  const user = req.currentUser!;

  const payments = await billingService.listPendingPayments({
    counsellorId: user.role === 'COUNSELLOR' ? user.id : undefined,
  });

  res.render('admin/invoices/pending', {
    title: 'Payments awaiting confirmation',
    layout: 'layouts/admin',
    payments,
  });
}

async function loadInvoiceStudentProfileId(invoiceId: string): Promise<string> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { studentProfileId: true },
  });
  if (!invoice) throw new NotFoundError('That invoice could not be found.');
  return invoice.studentProfileId;
}

async function loadPaymentStudentProfileId(paymentId: string): Promise<string> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { invoice: { select: { studentProfileId: true } } },
  });
  if (!payment) throw new NotFoundError('That payment could not be found.');
  return payment.invoice.studentProfileId;
}

export async function viewProofOfPayment(req: Request, res: Response): Promise<void> {
  await assertCanAccessStudent(req, await loadPaymentStudentProfileId(req.params.id as string));

  const buffer = await billingService.retrieveProofOfPayment(req.params.id as string);

  // Inline so reviewers can read without downloading to disk.
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(buffer);
}

export async function confirmPayment(req: Request, res: Response): Promise<void> {
  await assertCanAccessStudent(req, await loadPaymentStudentProfileId(req.params.id as string));

  await billingService.confirmPendingPayment({
    paymentId: req.params.id as string,
    recordedById: req.currentUser!.id,
  });

  req.flash('success', 'Payment confirmed and the student notified.');
  res.redirect('/admin/invoices/pending');
}

export async function rejectPayment(req: Request, res: Response): Promise<void> {
  await assertCanAccessStudent(req, await loadPaymentStudentProfileId(req.params.id as string));

  const parsed = rejectPaymentSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError('Please explain why this payment could not be confirmed.');
  }

  await billingService.rejectPendingPayment({
    paymentId: req.params.id as string,
    recordedById: req.currentUser!.id,
    reason: parsed.data.reason,
  });

  req.flash('success', 'Payment rejected and the student notified.');
  res.redirect('/admin/invoices/pending');
}

/**
 * Refunds a gateway payment (full, or partial when `amountMinor` is given).
 * Route: adminOnly (ADMIN_STAFF / SUPER_ADMIN); the service re-checks the role.
 */
export async function refundPayment(req: Request, res: Response): Promise<void> {
  const invoiceStudentProfileId = await loadPaymentStudentProfileId(req.params.id as string);
  await assertCanAccessStudent(req, invoiceStudentProfileId);

  const parsed = refundPaymentSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError('Enter a valid refund amount.', parsed.error.flatten().fieldErrors);
  }

  const result = await billingService.refundPayment(
    req.params.id as string,
    req.currentUser!.id,
    parsed.data.amountMinor as number | undefined,
  );

  const payment = await prisma.payment.findUnique({
    where: { id: req.params.id as string },
    select: { invoiceId: true },
  });

  req.flash('success', result.full ? 'Payment refunded in full.' : 'Partial refund issued.');
  res.redirect(payment ? `/admin/invoices/${payment.invoiceId}` : '/admin/invoices');
}
