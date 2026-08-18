/**
 * Invoices & Payments (PRD §5.2). Behind FEATURE_PAYMENTS.
 */
import type { Request, Response } from 'express';
import { billingService } from '../../services/billing.service.js';
import { storageService } from '../../services/storage.service.js';
import { findStudentByUserId } from '../../models/student.model.js';
import { submitProofOfPaymentSchema } from '../../validators/billing.validator.js';
import { NotFoundError, ValidationError } from '../../utils/errors.js';

export async function index(req: Request, res: Response): Promise<void> {
  const student = await findStudentByUserId(req.currentUser!.id);
  if (!student) throw new NotFoundError('We could not find your student profile.');

  const invoices = await billingService.listForStudent(student.id);

  res.render('portal/invoices/index', {
    title: 'Invoices & payments',
    layout: 'layouts/portal',
    invoices,
  });
}

export async function show(req: Request, res: Response): Promise<void> {
  const student = await findStudentByUserId(req.currentUser!.id);
  if (!student) throw new NotFoundError('We could not find your student profile.');

  const invoice = await billingService.findForStudent(req.params.id as string, student.id);

  res.render('portal/invoices/show', {
    title: `Invoice ${invoice.number}`,
    layout: 'layouts/portal',
    invoice,
  });
}

export async function startPayment(req: Request, res: Response): Promise<void> {
  // TODO(phase-3): create a gateway checkout session and redirect. PRD §8.1
  // requires card, Apple Pay and Google Pay; the processor choice (Stripe /
  // Paystack / Flutterwave) is per-region. Bank transfer, SWIFT, Revolut and
  // cash are already handled via the proof-of-payment upload below.
  req.flash('info', 'Online card payment is not switched on yet. Please use the bank details on your invoice.');
  res.redirect(`/portal/invoices/${req.params.id}`);
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
