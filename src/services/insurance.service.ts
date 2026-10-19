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
import type { Invoice, InsurancePolicy } from '@prisma/client';
import { DEFAULT_CURRENCY } from '../config/packages.js';
import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';
import { policyNumber } from '../utils/reference.js';
import { ServiceUnavailableError } from '../utils/errors.js';
import { billingService } from './billing.service.js';
import { referralService } from './referral.service.js';
import { auditService } from './audit.service.js';
import type { InsuranceQuoteInput } from '../validators/insurance.validator.js';

const MS_PER_DAY = 86_400_000;

/** How long a student has to pay the premium invoice. */
const PREMIUM_DUE_DAYS = 7;

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
      currency: DEFAULT_CURRENCY,
    };
  },

  /**
   * Creates the policy PENDING plus an invoice for its premium — cover is
   * never active until that invoice is PAID (`billingService` flips the
   * policy to ACTIVE at settlement, matching on the policy number carried in
   * the invoice description) — and logs a Referral against the active
   * INSURANCE partner on file. There must be one on file — even while fulfilled
   * in-portal, insurance is only ever sold through a partner relationship —
   * so this refuses rather than silently skipping the referral if ops
   * hasn't configured a partner yet.
   */
  async purchase(
    input: InsuranceQuoteInput & { studentProfileId: string; actorId: string },
  ): Promise<{ policy: InsurancePolicy; invoice: Invoice }> {
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
        // Paid-for cover only: stays PENDING until the premium invoice is PAID.
        status: 'PENDING',
      },
    });

    let invoice: Invoice;
    try {
      const draft = await billingService.createInvoice({
        studentProfileId: input.studentProfileId,
        currency: computed.currency,
        description: `Student insurance — policy ${policy.policyNumber}`,
        dueAt: new Date(Date.now() + PREMIUM_DUE_DAYS * MS_PER_DAY),
        lineItems: [
          {
            description: `${computed.planName}, ${computed.days} days (policy ${policy.policyNumber})`,
            quantity: 1,
            unitPriceMinor: computed.premiumMinor,
            category: 'INSURANCE',
          },
        ],
      });
      await billingService.markSent(draft.id, input.actorId);
      invoice = draft;
    } catch (err) {
      // No invoice means no way to pay — don't leave an unpayable policy behind.
      await prisma.insurancePolicy.update({ where: { id: policy.id }, data: { status: 'CANCELLED' } });
      throw err;
    }

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
        invoiceId: invoice.id,
        status: 'PENDING',
      },
    });

    logger.info(
      { policyId: policy.id, referralId: referral.id, partnerId: partner.id, invoiceId: invoice.id },
      'Insurance policy created — awaiting premium payment',
    );

    return { policy, invoice };
  },
};
