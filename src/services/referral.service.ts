/**
 * Partner referrals (PRD §6.2, §6.3).
 *
 * Present from day one even though most partner categories launch in Phase 3 —
 * the PRD is explicit that Partner and Referral must not be bolted on later.
 */
import type { ReferralStatus, Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';
import { auditService } from './audit.service.js';

export const referralService = {
  /**
   * Logs a referral against the student's file. `sourceContext` records where
   * in the product it originated (e.g. "portal.insurance") so conversion can be
   * attributed per surface.
   */
  async create(input: {
    studentProfileId: string;
    partnerId: string;
    sourceContext?: string;
    notes?: string;
    createdById?: string;
  }) {
    const referral = await prisma.referral.create({
      data: {
        studentProfileId: input.studentProfileId,
        partnerId: input.partnerId,
        sourceContext: input.sourceContext ?? null,
        notes: input.notes ?? null,
        createdById: input.createdById ?? null,
        status: 'INITIATED',
      },
    });

    await auditService.record({
      actorId: input.createdById ?? null,
      action: 'CREATE',
      entity: 'Referral',
      entityId: referral.id,
      studentProfileId: input.studentProfileId,
      changes: { partnerId: input.partnerId, sourceContext: input.sourceContext },
    });

    logger.info({ referralId: referral.id, partnerId: input.partnerId }, 'Referral created');
    return referral;
  },

  async updateStatus(
    id: string,
    options: {
      status: ReferralStatus;
      actorId: string;
      commissionAmountMinor?: number;
      commissionCurrency?: string;
    },
  ) {
    const converted = options.status === 'CONVERTED';

    const referral = await prisma.referral.update({
      where: { id },
      data: {
        status: options.status,
        ...(converted ? { convertedAt: new Date() } : {}),
        ...(options.commissionAmountMinor !== undefined
          ? {
              commissionAmountMinor: options.commissionAmountMinor,
              commissionCurrency: options.commissionCurrency ?? 'EUR',
            }
          : {}),
      },
      select: { id: true, studentProfileId: true, status: true },
    });

    await auditService.record({
      actorId: options.actorId,
      action: 'UPDATE',
      entity: 'Referral',
      entityId: id,
      studentProfileId: referral.studentProfileId,
      changes: { status: { to: options.status } },
    });

    return referral;
  },

  async list(filters: {
    status?: ReferralStatus;
    partnerId?: string;
    studentProfileId?: string;
    page?: number;
    perPage?: number;
  } = {}) {
    const page = Math.max(1, filters.page ?? 1);
    const perPage = Math.min(100, filters.perPage ?? 25);

    const where: Prisma.ReferralWhereInput = {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.partnerId ? { partnerId: filters.partnerId } : {}),
      ...(filters.studentProfileId ? { studentProfileId: filters.studentProfileId } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.referral.findMany({
        where,
        include: {
          partner: { select: { name: true, category: true } },
          studentProfile: {
            select: { id: true, reference: true, user: { select: { fullName: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      prisma.referral.count({ where }),
    ]);

    return { items, total, page, perPage, totalPages: Math.ceil(total / perPage) };
  },

  /** PRD §10 — active partner referrals per month, and category coverage. */
  async monthlyActivity(months = 6) {
    const since = new Date();
    since.setMonth(since.getMonth() - months);

    return prisma.referral.groupBy({
      by: ['status'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { commissionAmountMinor: true },
    });
  },
};
