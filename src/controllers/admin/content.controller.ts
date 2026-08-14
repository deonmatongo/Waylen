/**
 * Content management (PRD §5.4, §8.1 — a CMS for non-technical staff).
 */
import type { Request, Response } from 'express';
import { prisma } from '../../config/database.js';
import { OPPORTUNITY_CATEGORY_LABELS } from '../../config/constants.js';
import { NotFoundError } from '../../utils/errors.js';

export async function index(req: Request, res: Response): Promise<void> {
  const [resourceCount, opportunityCount, faqCount, testimonialCount] = await Promise.all([
    prisma.resource.count(),
    prisma.opportunity.count(),
    prisma.faq.count(),
    prisma.testimonial.count(),
  ]);

  res.render('admin/content/index', {
    title: 'Content',
    layout: 'layouts/admin',
    counts: { resourceCount, opportunityCount, faqCount, testimonialCount },
  });
}

export async function resources(req: Request, res: Response): Promise<void> {
  const resources = await prisma.resource.findMany({
    select: {
      id: true,
      slug: true,
      title: true,
      type: true,
      status: true,
      requiresAuth: true,
      publishedAt: true,
      viewCount: true,
    },
    orderBy: { updatedAt: 'desc' },
  });

  res.render('admin/content/resources', {
    title: 'Learning Hub content',
    layout: 'layouts/admin',
    resources,
  });
}

export async function createResource(req: Request, res: Response): Promise<void> {
  res.render('admin/content/resource-form', {
    title: 'New resource',
    layout: 'layouts/admin',
    resource: null,
    values: {},
    errors: {},
  });
}

export async function storeResource(req: Request, res: Response): Promise<void> {
  // TODO(phase-1): validate with resourceSchema, slugify the title and persist.
  req.flash('info', 'Resource authoring is wired up in Phase 1.');
  res.redirect('/admin/content/resources');
}

export async function editResource(req: Request, res: Response): Promise<void> {
  const resource = await prisma.resource.findUnique({ where: { id: req.params.id as string } });
  if (!resource) throw new NotFoundError('That resource could not be found.');

  res.render('admin/content/resource-form', {
    title: `Edit: ${resource.title}`,
    layout: 'layouts/admin',
    resource,
    values: resource,
    errors: {},
  });
}

export async function updateResource(req: Request, res: Response): Promise<void> {
  // TODO(phase-1): validate and persist the edit.
  req.flash('info', 'Resource editing is wired up in Phase 1.');
  res.redirect('/admin/content/resources');
}

export async function opportunities(req: Request, res: Response): Promise<void> {
  const opportunities = await prisma.opportunity.findMany({
    select: {
      id: true,
      slug: true,
      title: true,
      category: true,
      status: true,
      isFeatured: true,
      country: { select: { name: true } },
      // Staff-only: the institution behind the listing (PRD §4.2).
      institution: { select: { name: true } },
    },
    orderBy: { updatedAt: 'desc' },
  });

  res.render('admin/content/opportunities', {
    title: 'Opportunity listings',
    layout: 'layouts/admin',
    opportunities,
    categoryLabels: OPPORTUNITY_CATEGORY_LABELS,
  });
}

export async function createOpportunity(req: Request, res: Response): Promise<void> {
  const [countries, institutions] = await Promise.all([
    prisma.country.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.partner.findMany({
      where: { category: 'INSTITUTION' },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  res.render('admin/content/opportunity-form', {
    title: 'New opportunity',
    layout: 'layouts/admin',
    opportunity: null,
    countries,
    institutions,
    categoryLabels: OPPORTUNITY_CATEGORY_LABELS,
    values: {},
    errors: {},
  });
}

export async function storeOpportunity(req: Request, res: Response): Promise<void> {
  // TODO(phase-1): validate with opportunitySchema and persist.
  req.flash('info', 'Opportunity authoring is wired up in Phase 1.');
  res.redirect('/admin/content/opportunities');
}

export async function editOpportunity(req: Request, res: Response): Promise<void> {
  const [opportunity, countries, institutions] = await Promise.all([
    prisma.opportunity.findUnique({ where: { id: req.params.id as string } }),
    prisma.country.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.partner.findMany({
      where: { category: 'INSTITUTION' },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  if (!opportunity) throw new NotFoundError('That opportunity could not be found.');

  res.render('admin/content/opportunity-form', {
    title: `Edit: ${opportunity.title}`,
    layout: 'layouts/admin',
    opportunity,
    countries,
    institutions,
    categoryLabels: OPPORTUNITY_CATEGORY_LABELS,
    values: opportunity,
    errors: {},
  });
}

export async function updateOpportunity(req: Request, res: Response): Promise<void> {
  // TODO(phase-1): validate and persist the edit.
  req.flash('info', 'Opportunity editing is wired up in Phase 1.');
  res.redirect('/admin/content/opportunities');
}

export async function faqs(req: Request, res: Response): Promise<void> {
  const faqs = await prisma.faq.findMany({
    select: {
      id: true,
      question: true,
      topic: true,
      status: true,
      displayOrder: true,
      country: { select: { name: true } },
    },
    orderBy: [{ topic: 'asc' }, { displayOrder: 'asc' }],
  });

  res.render('admin/content/faqs', {
    title: 'FAQs',
    layout: 'layouts/admin',
    faqs,
  });
}

export async function testimonials(req: Request, res: Response): Promise<void> {
  const testimonials = await prisma.testimonial.findMany({
    orderBy: [{ displayOrder: 'asc' }, { createdAt: 'desc' }],
  });

  res.render('admin/content/testimonials', {
    title: 'Testimonials',
    layout: 'layouts/admin',
    testimonials,
  });
}
