/**
 * Student insurance quoting & purchase (PRD §5.2, §6.1).
 *
 * Quotes are computed from a simple day-rate table until a partner's quote
 * API is integrated — the controller's own phase-2 TODO notes quotes are
 * otherwise prepared manually by staff. This keeps the same shape so that
 * integration can replace `quote()` later without touching the purchase
 * flow. Every purchase writes a partner Referral (PRD §6.2): insurance is
 * sold in-portal today but is explicitly scoped to migrate to vetted
 * external partners, and the Referral is what makes that migration not a
 * rebuild.
 */
import type { InsurancePolicy } from '@prisma/client';
import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';
import { policyNumber } from '../utils/reference.js';
import { ServiceUnavailableError } from '../utils/errors.js';
import { referralService } from './referral.service.js';
import { auditService } from './audit.service.js';
import type { InsuranceQuoteInput } from '../validators/insurance.validator.js';

const MS_PER_DAY = 86_400_000;

/** Flat administration fee, in minor units, added to every quote. */
const BASE_FEE_MINOR = 1500;

const DAILY_RATE_MINOR: Record<InsuranceQuoteInput['coverageType'], number> = {
  HEALTH: 250,
  TRAVEL: 150,
  COMBINED: 350,
};

const PLAN_NAMES: Record<InsuranceQuoteInput['coverageType'], string> = {
  HEALTH: 'Student Health Cover',
  TRAVEL: 'Student Travel Cover',
  COMBINED: 'Student Health & Travel Cover',
};

export interface InsuranceQuote {
  planName: string;
  coverageType: InsuranceQuoteInput['coverageType'];
  coverageStartsAt: Date;
  coverageEndsAt: Date;
  days: number;
  premiumMinor: number;
  currency: string;
}

export const insuranceService = {
  /**
   * Pure and deterministic so it is safe to call on a GET to preview a
   * price, and recomputed server-side on purchase rather than trusted from
   * the form — the premium a student purchases is never client-supplied.
   */
  quote(input: InsuranceQuoteInput): InsuranceQuote {
    const days = Math.max(
      1,
      Math.ceil((input.coverageEndsAt.getTime() - input.coverageStartsAt.getTime()) / MS_PER_DAY),
    );
    const premiumMinor = BASE_FEE_MINOR + days * DAILY_RATE_MINOR[input.coverageType];

    return {
      planName: PLAN_NAMES[input.coverageType],
      coverageType: input.coverageType,
      coverageStartsAt: input.coverageStartsAt,
      coverageEndsAt: input.coverageEndsAt,
      days,
      premiumMinor,
      currency: 'EUR',
    };
  },

  /**
   * Creates the policy and logs a Referral against the active INSURANCE
   * partner on file. There must be one on file — even while fulfilled
   * in-portal, insurance is only ever sold through a partner relationship —
   * so this refuses rather than silently skipping the referral if ops
   * hasn't configured a partner yet.
   */
  async purchase(
    input: InsuranceQuoteInput & { studentProfileId: string; actorId: string },
  ): Promise<InsurancePolicy> {
    const partner = await prisma.partner.findFirst({
      where: { category: 'INSURANCE', status: 'ACTIVE' },
      orderBy: { displayOrder: 'asc' },
      select: { id: true, name: true },
    });

    if (!partner) {
      throw new ServiceUnavailableError(
        'Insurance purchases are temporarily unavailable — no insurance partner is configured yet. Please contact your counsellor.',
      );
    }

    const computed = this.quote(input);
    const now = new Date();

    const policy = await prisma.insurancePolicy.create({
      data: {
        studentProfileId: input.studentProfileId,
        partnerId: partner.id,
        planName: computed.planName,
        policyNumber: policyNumber(),
        coverageType: computed.coverageType,
        coverageStartsAt: computed.coverageStartsAt,
        coverageEndsAt: computed.coverageEndsAt,
        premiumMinor: computed.premiumMinor,
        currency: computed.currency,
        // Cover that hasn't started yet is PENDING rather than ACTIVE.
        status: computed.coverageStartsAt > now ? 'PENDING' : 'ACTIVE',
      },
    });

    const referral = await referralService.create({
      studentProfileId: input.studentProfileId,
      partnerId: partner.id,
      sourceContext: 'portal.insurance',
      notes: `Policy ${policy.policyNumber} (${policy.planName}) purchased in-portal.`,
      createdById: input.actorId,
    });

    await auditService.record({
      actorId: input.actorId,
      action: 'CREATE',
      entity: 'InsurancePolicy',
      entityId: policy.id,
      studentProfileId: input.studentProfileId,
      changes: {
        partnerId: partner.id,
        premiumMinor: policy.premiumMinor,
        currency: policy.currency,
        referralId: referral.id,
      },
    });

    logger.info(
      { policyId: policy.id, referralId: referral.id, partnerId: partner.id },
      'Insurance policy purchased',
    );

    return policy;
  },
};
