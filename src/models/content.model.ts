/**
 * Public content queries — countries, opportunities, resources, testimonials.
 *
 * PRD §4.2: `institutionId` must never reach a public view, so the public
 * selectors below enumerate fields explicitly rather than returning whole rows.
 */
import type { OpportunityCategory, Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';

// ── Countries (PRD §4.3) ───────────────────────────────────────────────────

/** Card fields for the destinations grid. */
const countryCardSelect = {
  id: true,
  slug: true,
  name: true,
  isoCode: true,
  summary: true,
  heroImagePath: true,
  flagImagePath: true,
  indicativeTuitionMin: true,
  indicativeTuitionMax: true,
  costOfLivingMonthly: true,
  currency: true,
} satisfies Prisma.CountrySelect;

export async function listPublishedCountries(options: { featuredOnly?: boolean } = {}) {
  return prisma.country.findMany({
    where: {
      status: 'PUBLISHED',
      ...(options.featuredOnly ? { isFeatured: true } : {}),
    },
    select: countryCardSelect,
    orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
  });
}

export async function findCountryBySlug(slug: string) {
  const country = await prisma.country.findFirst({
    where: { slug, status: 'PUBLISHED' },
    include: {
      faqs: {
        where: { status: 'PUBLISHED' },
        orderBy: { displayOrder: 'asc' },
      },
      opportunities: {
        where: { status: 'PUBLISHED' },
        select: opportunityCardSelect,
        take: 12,
        orderBy: [{ isFeatured: 'desc' }, { title: 'asc' }],
      },
    },
  });
  if (!country) return null;
  return {
    ...country,
    opportunities: country.opportunities.map((o) => ({
      ...o,
      intakePeriods: JSON.parse(o.intakePeriods as string) as string[],
    })),
  };
}

// ── Opportunities (PRD §4.2) ───────────────────────────────────────────────

/**
 * Public card fields. Note the deliberate omission of `institutionId` and
 * `institution` — see PRD §4.2.
 */
const opportunityCardSelect = {
  id: true,
  slug: true,
  title: true,
  category: true,
  description: true,
  studyLevel: true,
  duration: true,
  intakePeriods: true,
  indicativeTuitionMin: true,
  indicativeTuitionMax: true,
  currency: true,
  scholarshipAvailable: true,
  isFeatured: true,
  country: { select: { slug: true, name: true, isoCode: true } },
} satisfies Prisma.OpportunitySelect;

export interface OpportunityFilters {
  category?: OpportunityCategory;
  countrySlug?: string;
  studyLevel?: string;
  scholarshipOnly?: boolean;
  search?: string;
  page?: number;
  perPage?: number;
}

export async function listPublishedOpportunities(filters: OpportunityFilters = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const perPage = Math.min(48, filters.perPage ?? 12);

  const where: Prisma.OpportunityWhereInput = {
    status: 'PUBLISHED',
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.countrySlug ? { country: { slug: filters.countrySlug } } : {}),
    ...(filters.scholarshipOnly ? { scholarshipAvailable: true } : {}),
    ...(filters.search
      ? {
          OR: [
            { title: { contains: filters.search } },
            { description: { contains: filters.search } },
          ],
        }
      : {}),
  };

  const [rawItems, total] = await Promise.all([
    prisma.opportunity.findMany({
      where,
      select: opportunityCardSelect,
      orderBy: [{ isFeatured: 'desc' }, { title: 'asc' }],
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.opportunity.count({ where }),
  ]);

  const items = rawItems.map((o) => ({ ...o, intakePeriods: JSON.parse(o.intakePeriods as string) as string[] }));
  return { items, total, page, perPage, totalPages: Math.ceil(total / perPage) };
}

export async function findOpportunityBySlug(slug: string) {
  const opp = await prisma.opportunity.findFirst({
    where: { slug, status: 'PUBLISHED' },
    select: {
      ...opportunityCardSelect,
      entryRequirements: true,
      scholarshipDetails: true,
      metaTitle: true,
      metaDescription: true,
    },
  });
  if (!opp) return null;
  return { ...opp, intakePeriods: JSON.parse(opp.intakePeriods as string) as string[] };
}

export async function countOpportunitiesByCategory() {
  const rows = await prisma.opportunity.groupBy({
    by: ['category'],
    where: { status: 'PUBLISHED' },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.category, r._count._all]));
}

// ── Learning Hub (PRD §4.4) ────────────────────────────────────────────────

export async function listPublicResources(options: {
  type?: string;
  tag?: string;
  page?: number;
  perPage?: number;
} = {}) {
  const page = Math.max(1, options.page ?? 1);
  const perPage = Math.min(36, options.perPage ?? 12);

  const where: Prisma.ResourceWhereInput = {
    status: 'PUBLISHED',
    // Resource Library items are portal-only (PRD §5.2).
    requiresAuth: false,
    ...(options.type ? { type: options.type as never } : {}),
    ...(options.tag ? { tags: { contains: `"${options.tag}"` } } : {}),
  };

  const [rawItems, total] = await Promise.all([
    prisma.resource.findMany({
      where,
      select: {
        slug: true,
        title: true,
        type: true,
        excerpt: true,
        coverImagePath: true,
        readMinutes: true,
        tags: true,
        publishedAt: true,
      },
      orderBy: { publishedAt: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.resource.count({ where }),
  ]);

  const items = rawItems.map((r) => ({ ...r, tags: JSON.parse(r.tags as string) as string[] }));
  return { items, total, page, perPage, totalPages: Math.ceil(total / perPage) };
}

export async function findResourceBySlug(slug: string, includeAuthOnly = false) {
  const resource = await prisma.resource.findFirst({
    where: {
      slug,
      status: 'PUBLISHED',
      ...(includeAuthOnly ? {} : { requiresAuth: false }),
    },
  });
  if (!resource) return null;
  return { ...resource, tags: JSON.parse(resource.tags as string) as string[] };
}

// ── Testimonials & trust signals (PRD §4.1, §4.9) ──────────────────────────

export async function listFeaturedTestimonials(limit = 6) {
  return prisma.testimonial.findMany({
    where: { status: 'PUBLISHED', isFeatured: true },
    orderBy: { displayOrder: 'asc' },
    take: limit,
  });
}

/**
 * Sponsor and partner logos for the homepage carousel and About page. PRD §6.1
 * limits institutions to display-only logos, so nothing here exposes a
 * programme-level link.
 */
export async function listDisplayPartnerLogos(limit = 24) {
  return prisma.partner.findMany({
    where: {
      status: 'ACTIVE',
      OR: [{ isPubliclyListed: true }, { isDisplayLogoOnly: true }],
      logoPath: { not: null },
    },
    select: { name: true, logoPath: true, websiteUrl: true, category: true },
    orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    take: limit,
  });
}

export async function listFaqsByTopic(topic: string) {
  return prisma.faq.findMany({
    where: { topic, status: 'PUBLISHED' },
    orderBy: { displayOrder: 'asc' },
  });
}
