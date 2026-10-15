/**
 * Secure messaging over the JSON API. Internal staff notes never appear.
 */
import type { Request, Response } from 'express';
import { prisma } from '../../config/database.js';
import { countUnreadForStudent } from '../../models/message.model.js';
import { messageSchema, newThreadSchema } from '../../validators/message.validator.js';
import { idParamSchema } from '../../validators/api.validator.js';
import { NotFoundError } from '../../utils/errors.js';
import { parse, parsePagination, requireStudent } from './helpers.js';

/** GET /messages/threads */
export async function listThreads(req: Request, res: Response): Promise<void> {
  const student = await requireStudent(req);
  const { page, perPage } = parsePagination(req);
  const where = { studentProfileId: student.id };

  const [items, total] = await Promise.all([
    prisma.messageThread.findMany({
      where,
      select: {
        id: true,
        subject: true,
        isClosed: true,
        lastMessageAt: true,
        _count: { select: { messages: { where: { isInternal: false } } } },
      },
      orderBy: { lastMessageAt: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.messageThread.count({ where }),
  ]);

  res.json({ items, page, perPage, total });
}

/** GET /messages/threads/:id — also marks incoming staff messages read, as on the web. */
export async function showThread(req: Request, res: Response): Promise<void> {
  const student = await requireStudent(req);
  const { id } = parse(idParamSchema, req.params);

  const thread = await prisma.messageThread.findFirst({
    where: { id, studentProfileId: student.id },
    include: {
      messages: {
        where: { isInternal: false },
        select: {
          id: true,
          body: true,
          createdAt: true,
          readAt: true,
          senderId: true,
          sender: { select: { fullName: true, role: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (!thread) throw new NotFoundError('That conversation could not be found.');

  await prisma.message.updateMany({
    where: { threadId: thread.id, senderId: { not: req.currentUser!.id }, readAt: null },
    data: { readAt: new Date() },
  });

  res.json({
    id: thread.id,
    subject: thread.subject,
    isClosed: thread.isClosed,
    lastMessageAt: thread.lastMessageAt,
    messages: thread.messages,
  });
}

/** POST /messages/threads */
export async function createThread(req: Request, res: Response): Promise<void> {
  const student = await requireStudent(req);
  const input = parse(newThreadSchema, req.body, 'Please add a subject and a message.');

  const thread = await prisma.messageThread.create({
    data: {
      studentProfileId: student.id,
      subject: input.subject,
      messages: { create: { senderId: req.currentUser!.id, body: input.body } },
    },
    select: { id: true, subject: true, lastMessageAt: true },
  });

  res.status(201).json(thread);
}

/** POST /messages/threads/:id/reply */
export async function reply(req: Request, res: Response): Promise<void> {
  const student = await requireStudent(req);
  const { id } = parse(idParamSchema, req.params);
  const input = parse(messageSchema, req.body, 'Please write a message before sending.');

  const thread = await prisma.messageThread.findFirst({
    where: { id, studentProfileId: student.id, isClosed: false },
    select: { id: true },
  });
  if (!thread) throw new NotFoundError('That conversation could not be found or is closed.');

  const [message] = await prisma.$transaction([
    prisma.message.create({
      data: { threadId: thread.id, senderId: req.currentUser!.id, body: input.body },
      select: { id: true, body: true, createdAt: true, senderId: true },
    }),
    prisma.messageThread.update({ where: { id: thread.id }, data: { lastMessageAt: new Date() } }),
  ]);

  res.status(201).json(message);
}

/** GET /messages/unread-count */
export async function unreadCount(req: Request, res: Response): Promise<void> {
  const student = await requireStudent(req);
  res.json({ unread: await countUnreadForStudent(student.id, req.currentUser!.id) });
}
