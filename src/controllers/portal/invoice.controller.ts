/**
 * Invoices & Payments (PRD §5.2). Behind FEATURE_PAYMENTS.
 */
import type { Request, Response } from 'express';
import { billingService } from '../../services/billing.service.js';
import { storageService } from '../../services/storage.service.js';
import { createCheckoutSession } from '../../services/payments/gateway.service.js';
import { findStudentByUserId } from '../../models/student.model.js';
import { submitProofOfPaymentSchema } from '../../validators/billing.validator.js';
import { NotFoundError, ValidationError } from '../../utils/errors.js';

export async function index(req: Request, res: Response): Promise<void> {
  const student = await findStudentByUserId(req.currentUser!.id);
  if (!student) throw new NotFoundError('We could not find your student profile.');

  const requestedPage = Number.parseInt(typeof req.query.page === 'string' ? req.query.page : '1', 10);
  const results = await billingService.listPageForStudent(student.id, {
    page: Number.isFinite(requestedPage) ? requestedPage : 1,
    perPage: 20,
  });

  res.render('portal/invoices/index', {
    title: 'Invoices & payments',
    layout: 'layouts/portal',
    invoices: results.items,
    results,
    baseUrl: '/portal/invoices',
  });
}

export async function show(req: Request, res: Response): Promise<void> {
  const student = await findStudentByUserId(req.currentUser!.id);
  if (!student) throw new NotFoundError('We could not find your student profile.');

  const invoice = await billingService.findForStudent(req.params.id as string, student.id);

  // Gateways bounce the student back with ?payment=… before (or without) the
  // webhook having settled the invoice, so say so rather than show a stale
  // balance with no explanation. Rendered inline: a flash would only appear
  // on the *next* request.
  const returned = req.query.payment;
  const paymentNotice =
    returned === 'return' || returned === 'success'
      ? invoice.status === 'PAID'
        ? { type: 'success', message: 'Payment received — thank you. This invoice is paid in full.' }
        : {
            type: 'info',
            message:
              'Payment received — we are confirming it with the payment provider. This invoice will update shortly.',
          }
      : returned === 'cancelled'
        ? { type: 'info', message: 'Your card payment was cancelled and you have not been charged.' }
        : null;

  res.render('portal/invoices/show', {
    title: `Invoice ${invoice.number}`,
    layout: 'layouts/portal',
    invoice,
    paymentNotice,
  });
}

/**
 * Creates a gateway checkout session and redirects the student to it (PRD
 * §8.1, phase 3). Bank transfer, SWIFT, Revolut and cash are handled
 * separately via the proof-of-payment upload below.
 *
 * Which gateway is used is decided by `createCheckoutSession` from the
 * invoice's currency — see `src/services/payments/gateway.service.ts` for the
 * reasoning. If that gateway's secret key is not configured, the session is
 * `null` and the student sees the same "not switched on yet" message as
 * before, scoped to that invoice's gateway rather than every online payment.
 */
export async function startPayment(req: Request, res: Response): Promise<void> {
  const student = await findStudentByUserId(req.currentUser!.id);
  if (!student) throw new NotFoundError('We could not find your student profile.');

  const invoice = await billingService.findForStudent(req.params.id as string, student.id);

  if (!['SENT', 'PARTIALLY_PAID', 'OVERDUE'].includes(invoice.status)) {
    throw new ValidationError('This invoice is not open for payment.');
  }

  const outstandingMinor = invoice.totalMinor - invoice.paidMinor;
  if (outstandingMinor <= 0) {
    req.flash('info', 'This invoice is already paid in full.');
    res.redirect(`/portal/invoices/${invoice.id}`);
    return;
  }

  // A second session while one is open lets the student pay the same balance
  // twice. The hosted-page URL is not stored, so tell them to wait/check.
  if (await billingService.hasActiveGatewayCheckout(invoice.id)) {
    req.flash(
      'info',
      'A card payment for this invoice is already in progress. If you have just paid, it is being confirmed — please check back shortly. Otherwise you can try again in about an hour.',
    );
    res.redirect(`/portal/invoices/${invoice.id}`);
    return;
  }

  const session = await createCheckoutSession({
    invoiceId: invoice.id,
    invoiceNumber: invoice.number,
    amountMinor: outstandingMinor,
    currency: invoice.currency,
    studentEmail: req.currentUser!.email,
    studentName: req.currentUser!.fullName,
  });

  if (!session) {
    req.flash('info', 'Online card payment is not switched on yet. Please use the bank details on your invoice.');
    res.redirect(`/portal/invoices/${req.params.id}`);
    return;
  }

  await billingService.createPendingGatewayPayment({
    invoiceId: invoice.id,
    method: session.method,
    provider: session.provider,
    providerReference: session.providerReference,
    amountMinor: outstandingMinor,
    currency: invoice.currency,
  });

  res.redirect(session.checkoutUrl);
}

export async function uploadProof(req: Request, res: Response): Promise<void> {
  const student = await findStudentByUserId(req.currentUser!.id);
  if (!student) throw new NotFoundError('We could not find your student profile.');
  if (!req.file) throw new ValidationError('Please attach a copy of your receipt or transfer confirmation.');

  const parsed = submitProofOfPaymentSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError(
      'Please tell us how much you paid and by which method.',
      parsed.error.flatten().fieldErrors,
    );
  }

  // Ownership + status check before anything is written to storage.
  await billingService.findForStudent(req.params.id as string, student.id);

  const stored = await storageService.store(req.file.buffer, {
    studentProfileId: student.id,
    originalFilename: req.file.originalname,
  });

  await billingService.submitProofOfPayment({
    invoiceId: req.params.id as string,
    studentProfileId: student.id,
    method: parsed.data.method,
    amountMinor: parsed.data.amountMinor,
    manualReference: parsed.data.manualReference,
    storageKey: stored.storageKey,
    receiptChecksum: stored.checksumSha256,
  });

  req.flash('success', 'Thanks — we have your proof of payment and will confirm it shortly.');
  res.redirect(`/portal/invoices/${req.params.id}`);
}

/** Renders the invoice ready to print/save as a PDF via the browser. */
export async function receipt(req: Request, res: Response): Promise<void> {
  const student = await findStudentByUserId(req.currentUser!.id);
  if (!student) throw new NotFoundError('We could not find your student profile.');

  const invoice = await billingService.findForStudent(req.params.id as string, student.id);
  if (!invoice.payments.some((payment) => payment.status === 'SUCCEEDED')) {
    req.flash('info', 'A receipt is available once at least one payment has been confirmed.');
    res.redirect(`/portal/invoices/${req.params.id}`);
    return;
  }

  res.render('portal/invoices/show', {
    title: `Invoice ${invoice.number}`,
    layout: 'layouts/portal',
    invoice,
    autoPrint: true,
  });
}

/** Printable receipt for a single confirmed payment. */
export async function paymentReceipt(req: Request, res: Response): Promise<void> {
  const student = await findStudentByUserId(req.currentUser!.id);
  if (!student) throw new NotFoundError('We could not find your student profile.');

  const receipt = await billingService.findReceiptForStudent(
    req.params.id as string,
    req.params.paymentId as string,
    student.id,
  );

  res.render('portal/invoices/payment-receipt', {
    title: `Receipt ${receipt.receiptNumber}`,
    layout: 'layouts/portal',
    ...receipt,
    student: { fullName: req.currentUser!.fullName },
    autoPrint: true,
  });
}
