/**
 * Help & Support tickets over the JSON API.
 */
import type { Request, Response } from 'express';
import { supportService } from '../../services/support.service.js';
import { newTicketSchema, ticketReplySchema } from '../../validators/support.validator.js';
import { idParamSchema } from '../../validators/api.validator.js';
import { paginate, parse, parsePagination, requireStudent } from './helpers.js';

/** GET /support/tickets */
export async function list(req: Request, res: Response): Promise<void> {
  const student = await requireStudent(req);
  const tickets = await supportService.listForStudent(student.id);
  res.json(paginate(tickets, parsePagination(req)));
}

/** POST /support/tickets */
export async function create(req: Request, res: Response): Promise<void> {
  const student = await requireStudent(req);
  const input = parse(newTicketSchema, req.body, 'Please fill in every field.');

  const ticket = await supportService.createTicket({
    studentProfileId: student.id,
    senderId: req.currentUser!.id,
    category: input.category,
    subject: input.subject,
    body: input.body,
  });

  res.status(201).json(ticket);
}

/** GET /support/tickets/:id */
export async function show(req: Request, res: Response): Promise<void> {
  const student = await requireStudent(req);
  const { id } = parse(idParamSchema, req.params);
  res.json(await supportService.findForStudent(id, student.id, req.currentUser!.id));
}

/** POST /support/tickets/:id/reply */
export async function reply(req: Request, res: Response): Promise<void> {
  const student = await requireStudent(req);
  const { id } = parse(idParamSchema, req.params);
  const input = parse(ticketReplySchema, req.body, 'Please write a message before sending.');

  await supportService.replyAsStudent(id, student.id, req.currentUser!.id, input.body);
  res.status(201).json({ ok: true });
}
