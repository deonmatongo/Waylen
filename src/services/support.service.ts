/**
 * Help & Support tickets (client navigation feedback §10) — operational and
 * technical issues, kept distinct from adviser Messages.
 */
import type { SupportTicketCategory, SupportTicketStatus, Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';
import { notificationService } from './notification.service.js';
import { ticketReference } from '../utils/reference.js';
import { NotFoundError } from '../utils/errors.js';

const MESSAGE_SENDER_SELECT = { select: { fullName: true, role: true } } as const;

export const supportService = {
  async createTicket(input: {
    studentProfileId: string;
    senderId: string;
    category: SupportTicketCategory;
    subject: string;
    body: string;
  }) {
    const ticket = await prisma.supportTicket.create({
      data: {
        reference: ticketReference(),
        studentProfileId: input.studentProfileId,
        category: input.category,
        subject: input.subject,
        messages: { create: { senderId: input.senderId, body: input.body } },
      },
    });

    const student = await prisma.studentProfile.findUnique({
      where: { id: input.studentProfileId },
      select: { assignedCounsellorId: true, user: { select: { fullName: true } } },
    });

    if (student?.assignedCounsellorId) {
      await notificationService.dispatch({
        userId: student.assignedCounsellorId,
        event: 'support.ticket_created',
        title: `New support ticket from ${student.user.fullName}`,
        body: input.subject,
        actionUrl: `/admin/support/${ticket.id}`,
      });
    } else {
      // TODO(phase-1): route to a duty-staff queue once one exists — for now
      // unassigned students' tickets only surface in the admin ticket list.
      logger.info({ ticketId: ticket.id }, 'Support ticket created with no counsellor to notify');
    }

    return ticket;
  },

  async listForStudent(studentProfileId: string) {
    return prisma.supportTicket.findMany({
      where: { studentProfileId },
      include: { _count: { select: { messages: true } } },
      orderBy: { createdAt: 'desc' },
    });
  },

  async findForStudent(id: string, studentProfileId: string, studentUserId: string) {
    const ticket = await prisma.supportTicket.findFirst({
      where: { id, studentProfileId },
      include: {
        messages: {
          where: { isInternal: false },
          include: { sender: MESSAGE_SENDER_SELECT },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!ticket) throw new NotFoundError('That ticket could not be found.');

    // Mark incoming staff messages as read.
    await prisma.supportTicketMessage.updateMany({
      where: { ticketId: ticket.id, senderId: { not: studentUserId }, readAt: null },
      data: { readAt: new Date() },
    });

    return ticket;
  },

  async replyAsStudent(id: string, studentProfileId: string, senderId: string, body: string) {
    const ticket = await prisma.supportTicket.findFirst({
      where: { id, studentProfileId },
      select: { id: true, status: true },
    });
    if (!ticket) throw new NotFoundError('That ticket could not be found.');

    await prisma.$transaction([
      prisma.supportTicketMessage.create({ data: { ticketId: ticket.id, senderId, body } }),
      // A student who replies to a resolved ticket is reopening it; other
      // status transitions stay a staff decision.
      ...(ticket.status === 'RESOLVED'
        ? [prisma.supportTicket.update({ where: { id: ticket.id }, data: { status: 'OPEN' as const, resolvedAt: null } })]
        : []),
    ]);

    return ticket;
  },

  async list(filters: {
    status?: SupportTicketStatus;
    category?: SupportTicketCategory;
    search?: string;
    assignedToId?: string;
    page?: number;
    perPage?: number;
  } = {}) {
    const page = Math.max(1, filters.page ?? 1);
    const perPage = Math.min(100, filters.perPage ?? 25);

    const where: Prisma.SupportTicketWhereInput = {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.category ? { category: filters.category } : {}),
      ...(filters.assignedToId ? { assignedToId: filters.assignedToId } : {}),
      ...(filters.search
        ? {
            OR: [
              { subject: { contains: filters.search } },
              { reference: { contains: filters.search } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.supportTicket.findMany({
        where,
        include: {
          studentProfile: { select: { reference: true, user: { select: { fullName: true } } } },
          assignedTo: { select: { fullName: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      prisma.supportTicket.count({ where }),
    ]);

    return { items, total, page, perPage, totalPages: Math.ceil(total / perPage) };
  },

  async findById(id: string) {
    const ticket = await prisma.supportTicket.findUnique({
      where: { id },
      include: {
        studentProfile: { select: { id: true, reference: true, user: { select: { fullName: true, email: true } } } },
        assignedTo: { select: { id: true, fullName: true } },
        messages: {
          include: { sender: MESSAGE_SENDER_SELECT },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!ticket) throw new NotFoundError('That ticket could not be found.');
    return ticket;
  },

  async replyAsStaff(id: string, senderId: string, body: string, isInternal: boolean) {
    const ticket = await prisma.supportTicket.findUnique({
      where: { id },
      select: { id: true, subject: true, studentProfile: { select: { userId: true } } },
    });
    if (!ticket) throw new NotFoundError('That ticket could not be found.');

    await prisma.supportTicketMessage.create({ data: { ticketId: ticket.id, senderId, body, isInternal } });

    if (!isInternal) {
      await notificationService.dispatch({
        userId: ticket.studentProfile.userId,
        event: 'support.ticket_reply',
        title: `Update on your ticket: ${ticket.subject}`,
        body,
        actionUrl: `/portal/support/tickets/${ticket.id}`,
      });
    }

    return ticket;
  },

  async updateStatus(id: string, status: SupportTicketStatus) {
    const ticket = await prisma.supportTicket.update({
      where: { id },
      data: { status, resolvedAt: status === 'RESOLVED' ? new Date() : null },
      select: { id: true, subject: true, studentProfile: { select: { userId: true } } },
    });

    if (status === 'RESOLVED') {
      await notificationService.dispatch({
        userId: ticket.studentProfile.userId,
        event: 'support.ticket_resolved',
        title: `Your ticket has been resolved: ${ticket.subject}`,
        actionUrl: `/portal/support/tickets/${ticket.id}`,
      });
    }

    return ticket;
  },

  async assign(id: string, assignedToId: string | null) {
    return prisma.supportTicket.update({ where: { id }, data: { assignedToId } });
  },
};
