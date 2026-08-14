/**
 * Payments & invoicing (PRD §5.4). Phase 2 — behind FEATURE_PAYMENTS.
 */
import type { Request, Response } from 'express';
import { billingService } from '../../services/billing.service.js';
import { listStudents, staffVisibilityFilter } from '../../models/student.model.js';
import { PaymentMethod } from '@prisma/client';

export async function index(req: Request, res: Response): Promise<void> {
  const { status } = req.query;
  const invoices = await billingService.listForStaff({ status: status as never });

  res.render('admin/invoices/index', {
    title: 'Invoices',
    layout: 'layouts/admin',
    invoices,
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

export async function store(req: Request, res: Response): Promise<void> {
  // TODO(phase-2): build the invoice from posted line items via
  // billingService.createInvoice, which allocates the sequential number inside
  // the insert transaction so numbering has no gaps.
  req.flash('info', 'Invoice creation is part of Phase 2.');
  res.redirect('/admin/invoices');
}

export async function show(req: Request, res: Response): Promise<void> {
  const invoice = await billingService.findById(req.params.id as string);

  res.render('admin/invoices/show', {
    title: `Invoice ${invoice.number}`,
    layout: 'layouts/admin',
    invoice,
    paymentMethods: Object.values(PaymentMethod),
  });
}

export async function send(req: Request, res: Response): Promise<void> {
  // TODO(phase-2): mark SENT and email the invoice to the student.
  req.flash('info', 'Sending invoices is part of Phase 2.');
  res.redirect(`/admin/invoices/${req.params.id}`);
}

export async function recordPayment(req: Request, res: Response): Promise<void> {
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
  // TODO(phase-2): send the overdue reminder email.
  req.flash('info', 'Payment reminders are part of Phase 2.');
  res.redirect(`/admin/invoices/${req.params.id}`);
}

export async function voidInvoice(req: Request, res: Response): Promise<void> {
  await billingService.voidInvoice(req.params.id as string, req.currentUser!.id);

  req.flash('success', 'Invoice voided.');
  res.redirect('/admin/invoices');
}
