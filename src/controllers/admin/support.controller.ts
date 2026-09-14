/**
 * Help & Support ticket queue — the staff side (client navigation
 * feedback §10).
 */
import type { Request, Response } from 'express';
import { supportService } from '../../services/support.service.js';
import { listCounsellors } from '../../models/student.model.js';
import { ticketReplySchema, ticketStatusSchema } from '../../validators/support.validator.js';
import { ValidationError } from '../../utils/errors.js';

export async function index(req: Request, res: Response): Promise<void> {
  const { status, category, q } = req.query;

  const [results, counsellors] = await Promise.all([
    supportService.list({
      status: status as never,
      category: category as never,
      search: typeof q === 'string' ? q : undefined,
    }),
    listCounsellors(),
  ]);

  res.render('admin/support/index', {
    title: 'Help & support tickets',
    layout: 'layouts/admin',
    results,
    counsellors,
    filters: { status, category, q },
  });
}

export async function show(req: Request, res: Response): Promise<void> {
  const [ticket, counsellors] = await Promise.all([
    supportService.findById(req.params.id as string),
    listCounsellors(),
  ]);

  res.render('admin/support/show', {
    title: `Ticket — ${ticket.subject}`,
    layout: 'layouts/admin',
    ticket,
    counsellors,
  });
}

export async function reply(req: Request, res: Response): Promise<void> {
  const parsed = ticketReplySchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Please write a message before sending.');

  await supportService.replyAsStaff(req.params.id as string, req.currentUser!.id, parsed.data.body, req.body?.isInternal === '1');

  req.flash('success', 'Reply sent.');
  res.redirect(`/admin/support/${req.params.id}`);
}

export async function updateStatus(req: Request, res: Response): Promise<void> {
  const parsed = ticketStatusSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Choose a valid status.');

  await supportService.updateStatus(req.params.id as string, parsed.data.status);

  req.flash('success', 'Ticket status updated.');
  res.redirect(`/admin/support/${req.params.id}`);
}

export async function assign(req: Request, res: Response): Promise<void> {
  await supportService.assign(req.params.id as string, req.body?.assignedToId || null);

  req.flash('success', 'Ticket reassigned.');
  res.redirect(`/admin/support/${req.params.id}`);
}
