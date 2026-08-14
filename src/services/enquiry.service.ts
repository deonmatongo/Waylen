/**
 * CRM enquiries (PRD §5.4 — "every enquiry, consultation and student linked
 * together end-to-end").
 */
import type { EnquiryStatus, Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';
import { NotFoundError } from '../utils/errors.js';

export interface CreateEnquiryInput {
  fullName: string;
  email: string;
  phone?: string;
  message?: string;
  source?: string;
  countryOfInterest?: string;
  opportunityId?: string;
}

export const enquiryService = {
  async create(input: CreateEnquiryInput) {
    const enquiry = await prisma.enquiry.create({
      data: {
        fullName: input.fullName,
        email: input.email.toLowerCase(),
        phone: input.phone ?? null,
        message: input.message ?? null,
        source: input.source ?? 'website',
        countryOfInterest: input.countryOfInterest ?? null,
        opportunityId: input.opportunityId ?? null,
        status: 'NEW',
      },
    });

    logger.info({ enquiryId: enquiry.id, source: enquiry.source }, 'Enquiry received');

    // TODO(phase-1): notify the duty counsellor so no enquiry sits unseen.
    return enquiry;
  },

  async list(filters: {
    status?: EnquiryStatus;
    search?: string;
    assignedToId?: string;
    page?: number;
    perPage?: number;
  } = {}) {
    const page = Math.max(1, filters.page ?? 1);
    const perPage = Math.min(100, filters.perPage ?? 25);

    const where: Prisma.EnquiryWhereInput = {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.assignedToId ? { assignedToId: filters.assignedToId } : {}),
      ...(filters.search
        ? {
            OR: [
              { fullName: { contains: filters.search } },
              { email: { contains: filters.search } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.enquiry.findMany({
        where,
        include: {
          opportunity: { select: { title: true, slug: true } },
          studentProfile: { select: { reference: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      prisma.enquiry.count({ where }),
    ]);

    return { items, total, page, perPage, totalPages: Math.ceil(total / perPage) };
  },

  async findById(id: string) {
    const enquiry = await prisma.enquiry.findUnique({
      where: { id },
      include: {
        opportunity: { select: { title: true, slug: true } },
        studentProfile: {
          select: { id: true, reference: true, user: { select: { fullName: true, email: true } } },
        },
      },
    });

    if (!enquiry) throw new NotFoundError('That enquiry could not be found.');
    return enquiry;
  },

  async updateStatus(
    id: string,
    options: { status: EnquiryStatus; staffNotes?: string; actorId: string },
  ) {
    return prisma.enquiry.update({
      where: { id },
      data: {
        status: options.status,
        ...(options.staffNotes ? { staffNotes: options.staffNotes } : {}),
        // Stamp the first time someone actually deals with it.
        ...(options.status !== 'NEW' ? { handledAt: new Date() } : {}),
      },
    });
  },

  async assign(id: string, assignedToId: string | null) {
    return prisma.enquiry.update({ where: { id }, data: { assignedToId } });
  },

  /**
   * Links an enquiry to the student account it became, closing the loop the
   * PRD asks for. Matched on email, which is how the same person shows up
   * twice.
   */
  async linkToStudent(email: string, studentProfileId: string): Promise<void> {
    await prisma.enquiry.updateMany({
      where: { email: email.toLowerCase(), studentProfileId: null },
      data: { studentProfileId, status: 'CONVERTED' },
    });
  },
};
