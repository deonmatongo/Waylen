/**
 * Help & Support (client navigation feedback §10) — FAQs plus a simple
 * ticket system for operational/technical issues. Ordinary adviser
 * communication stays under Messages.
 */
import type { Request, Response } from 'express';
import { listAllFaqs } from '../../models/content.model.js';
import { findStudentByUserId } from '../../models/student.model.js';
import { supportService } from '../../services/support.service.js';
import { newTicketSchema, ticketReplySchema } from '../../validators/support.validator.js';
import { SUPPORT_TABS, SUPPORT_TICKET_CATEGORY_LABELS, SUPPORT_TICKET_STATUS_LABELS } from '../../config/constants.js';
import { NotFoundError, ValidationError } from '../../utils/errors.js';

export async function index(req: Request, res: Response): Promise<void> {
  const faqs = await listAllFaqs();

  const groups = new Map<string, typeof faqs>();
  for (const faq of faqs) {
    const group = groups.get(faq.topic) ?? [];
    group.push(faq);
    groups.set(faq.topic, group);
  }

  res.render('portal/support/index', {
    title: 'Help & support',
    layout: 'layouts/portal',
    faqGroups: Array.from(groups.entries()).map(([topic, items]) => ({ topic, items })),
    supportTabs: SUPPORT_TABS,
  });
}

export async function tickets(req: Request, res: Response): Promise<void> {
  const student = await findStudentByUserId(req.currentUser!.id);
  if (!student) throw new NotFoundError('We could not find your student profile.');

  const items = await supportService.listForStudent(student.id);

  res.render('portal/support/tickets', {
    title: 'My tickets',
    layout: 'layouts/portal',
    tickets: items,
    supportTabs: SUPPORT_TABS,
    categoryLabels: SUPPORT_TICKET_CATEGORY_LABELS,
    statusLabels: SUPPORT_TICKET_STATUS_LABELS,
  });
}

export async function newTicket(req: Request, res: Response): Promise<void> {
  res.render('portal/support/new-ticket', {
    title: 'New ticket',
    layout: 'layouts/portal',
    categoryLabels: SUPPORT_TICKET_CATEGORY_LABELS,
  });
}

export async function createTicket(req: Request, res: Response): Promise<void> {
  const student = await findStudentByUserId(req.currentUser!.id);
  if (!student) throw new NotFoundError('We could not find your student profile.');

  const parsed = newTicketSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError('Please fill in every field.', parsed.error.flatten().fieldErrors);
  }

  const ticket = await supportService.createTicket({
    studentProfileId: student.id,
    senderId: req.currentUser!.id,
    category: parsed.data.category,
    subject: parsed.data.subject,
    body: parsed.data.body,
  });

  req.flash('success', 'Your ticket has been raised. The team will get back to you soon.');
  res.redirect(`/portal/support/tickets/${ticket.id}`);
}

export async function showTicket(req: Request, res: Response): Promise<void> {
  const student = await findStudentByUserId(req.currentUser!.id);
  if (!student) throw new NotFoundError('We could not find your student profile.');

  const ticket = await supportService.findForStudent(req.params.ticketId as string, student.id, req.currentUser!.id);

  res.render('portal/support/ticket', {
    title: ticket.subject,
    layout: 'layouts/portal',
    ticket,
    categoryLabels: SUPPORT_TICKET_CATEGORY_LABELS,
    statusLabels: SUPPORT_TICKET_STATUS_LABELS,
  });
}

export async function replyTicket(req: Request, res: Response): Promise<void> {
  const student = await findStudentByUserId(req.currentUser!.id);
  if (!student) throw new NotFoundError('We could not find your student profile.');

  const parsed = ticketReplySchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Please write a message before sending.');

  await supportService.replyAsStudent(req.params.ticketId as string, student.id, req.currentUser!.id, parsed.data.body);
  res.redirect(`/portal/support/tickets/${req.params.ticketId}`);
}
