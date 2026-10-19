/**
 * Partner referrals (PRD §6.2, §6.3).
 *
 * Present from day one even though most partner categories launch in Phase 3 —
 * the PRD is explicit that Partner and Referral must not be bolted on later.
 *
 * Also holds friend-referral attribution (/register?ref=<student reference>),
 * which is unrelated to the partner `Referral` model.
 */
import type { ReferralStatus, Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';
import { DEFAULT_CURRENCY } from '../config/packages.js';
import { auditService } from './audit.service.js';

/** Matches studentReference() in utils/reference.ts (no 0/O/1/I). */
export const STUDENT_REFERENCE_PATTERN = /^WYL-STU-[A-HJ-NP-Z2-9]{6}$/;

/** Normalises a user-supplied reference; undefined when it is not well-formed. */
export function normaliseReferralRef(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const ref = raw.trim().toUpperCase();
  return ref.length <= 40 && STUDENT_REFERENCE_PATTERN.test(ref) ? ref : undefined;
}

export const referralService = {
  /**
   * Resolves a friend-referral reference to the referrer's profile id.
   * Returns null for an unknown reference, an inactive owner, or when the
   * referrer is the person signing up — callers ignore it silently so the
   * response never reveals whether a reference exists.
   */
  async resolveReferrer(rawRef: unknown, newUserEmail: string): Promise<string | null> {
    const ref = normaliseReferralRef(rawRef);
    if (!ref) return null;

    const profile = await prisma.studentProfile.findUnique({
      where: { reference: ref },
      select: { id: true, user: { select: { email: true, status: true } } },
    });
    if (!profile) return null;
    if (profile.user.status === 'SUSPENDED' || profile.user.status === 'ARCHIVED') return null;
    if (profile.user.email.toLowerCase() === newUserEmail.trim().toLowerCase()) return null;
    return profile.id;
  },

  /** How many students signed up through this student's referral link. */
  countReferredBy(studentProfileId: string): Promise<number> {
    return prisma.studentProfile.count({ where: { referredByStudentId: studentProfileId } });
  },

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
              commissionCurrency: options.commissionCurrency ?? DEFAULT_CURRENCY,
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
