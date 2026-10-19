/**
 * Secure messaging between student and the Waylen team (PRD §5.2).
 *
 * Internal staff notes are filtered out of every student-facing read.
 */
import type { Request, Response } from 'express';
import { prisma } from '../../config/database.js';
import { findStudentByUserId } from '../../models/student.model.js';
import { messageSchema, newThreadSchema } from '../../validators/message.validator.js';
import { NotFoundError, ValidationError } from '../../utils/errors.js';
import { buildPageMeta, parsePage } from '../../utils/pagination.js';

export async function index(req: Request, res: Response): Promise<void> {
  const student = await findStudentByUserId(req.currentUser!.id);
  if (!student) throw new NotFoundError('We could not find your student profile.');

  const pageReq = parsePage(req.query, { perPage: 25 });
  const where = { studentProfileId: student.id };
  const [threads, total] = await Promise.all([
    prisma.messageThread.findMany({
    where,
    select: {
      id: true,
      subject: true,
      isClosed: true,
      lastMessageAt: true,
      _count: { select: { messages: true } },
    },
    orderBy: { lastMessageAt: 'desc' },
    skip: pageReq.skip,
    take: pageReq.take,
    }),
    prisma.messageThread.count({ where }),
  ]);

  res.render('portal/messages/index', {
    title: 'Messages',
    layout: 'layouts/portal',
    threads,
    pageMeta: buildPageMeta(pageReq, total),
  });
}

export async function show(req: Request, res: Response): Promise<void> {
  const student = await findStudentByUserId(req.currentUser!.id);
  if (!student) throw new NotFoundError('We could not find your student profile.');

  const thread = await prisma.messageThread.findFirst({
    where: { id: req.params.threadId, studentProfileId: student.id },
    include: {
      messages: {
        // Internal notes stay internal.
        where: { isInternal: false },
        include: { sender: { select: { fullName: true, role: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!thread) throw new NotFoundError('That conversation could not be found.');

  // Mark incoming staff messages as read.
  await prisma.message.updateMany({
    where: { threadId: thread.id, senderId: { not: req.currentUser!.id }, readAt: null },
    data: { readAt: new Date() },
  });

  res.render('portal/messages/show', {
    title: thread.subject,
    layout: 'layouts/portal',
    thread,
  });
}

export async function reply(req: Request, res: Response): Promise<void> {
  const student = await findStudentByUserId(req.currentUser!.id);
  if (!student) throw new NotFoundError('We could not find your student profile.');

  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Please write a message before sending.');

  const thread = await prisma.messageThread.findFirst({
    where: { id: req.params.threadId, studentProfileId: student.id, isClosed: false },
    select: { id: true },
  });
  if (!thread) throw new NotFoundError('That conversation could not be found or is closed.');

  await prisma.$transaction([
    prisma.message.create({
      data: { threadId: thread.id, senderId: req.currentUser!.id, body: parsed.data.body },
    }),
    prisma.messageThread.update({
      where: { id: thread.id },
      data: { lastMessageAt: new Date() },
    }),
  ]);

  res.redirect(`/portal/messages/${thread.id}`);
}

export async function createThread(req: Request, res: Response): Promise<void> {
  const student = await findStudentByUserId(req.currentUser!.id);
  if (!student) throw new NotFoundError('We could not find your student profile.');

  const parsed = newThreadSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError('Please add a subject and a message.', parsed.error.flatten().fieldErrors);
  }

  const thread = await prisma.messageThread.create({
    data: {
      studentProfileId: student.id,
      subject: parsed.data.subject,
      messages: { create: { senderId: req.currentUser!.id, body: parsed.data.body } },
    },
  });

  req.flash('success', 'Your message has been sent to the Waylen team.');
  res.redirect(`/portal/messages/${thread.id}`);
}
