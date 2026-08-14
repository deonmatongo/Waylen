/**
 * Invoices & Payments (PRD §5.2). Phase 2 — behind FEATURE_PAYMENTS.
 */
import type { Request, Response } from 'express';
import { billingService } from '../../services/billing.service.js';
import { findStudentByUserId } from '../../models/student.model.js';
import { NotFoundError } from '../../utils/errors.js';

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
  // TODO(phase-2): create a gateway checkout session and redirect. PRD §8.1
  // requires card, bank transfer, Revolut, SWIFT, Apple Pay and Google Pay;
  // the processor choice (Stripe / Paystack / Flutterwave) is per-region.
  req.flash('info', 'Online payment is not switched on yet. Please use the bank details on your invoice.');
  res.redirect(`/portal/invoices/${req.params.id}`);
}

export async function receipt(req: Request, res: Response): Promise<void> {
  // TODO(phase-2): render the receipt PDF once payments are live.
  req.flash('info', 'Receipts will be available once online payments are switched on.');
  res.redirect(`/portal/invoices/${req.params.id}`);
}
