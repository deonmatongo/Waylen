/**
 * Content management (PRD §5.4, §8.1 — a CMS for non-technical staff).
 */
import type { Request, Response } from 'express';
import slugify from 'slugify';
import { prisma } from '../../config/database.js';
import { OPPORTUNITY_CATEGORY_LABELS } from '../../config/constants.js';
import { NotFoundError, ConflictError } from '../../utils/errors.js';
import { resourceSchema } from '../../validators/resource.validator.js';
import { opportunitySchema } from '../../validators/opportunity.validator.js';
import { faqSchema, testimonialSchema, TESTIMONIAL_SOURCES } from '../../validators/content.validator.js';
import { PublishStatus } from '@prisma/client';

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
  const parsed = resourceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).render('admin/content/resource-form', {
      title: 'New resource',
      layout: 'layouts/admin',
      resource: null,
      values: req.body,
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const slug = slugify(parsed.data.title, { lower: true, strict: true });
  const existing = await prisma.resource.findUnique({ where: { slug }, select: { id: true } });
  if (existing) throw new ConflictError('A resource with that title already exists.');

  const resource = await prisma.resource.create({
    data: {
      ...parsed.data,
      slug,
      publishedAt: parsed.data.status === 'PUBLISHED' ? new Date() : null,
    },
  });

  req.flash('success', `${resource.title} has been created.`);
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
  const resource = await prisma.resource.findUnique({ where: { id: req.params.id as string } });
  if (!resource) throw new NotFoundError('That resource could not be found.');

  const parsed = resourceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).render('admin/content/resource-form', {
      title: `Edit: ${resource.title}`,
      layout: 'layouts/admin',
      resource,
      values: { ...req.body, id: resource.id },
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const justPublished = parsed.data.status === 'PUBLISHED' && !resource.publishedAt;

  await prisma.resource.update({
    where: { id: resource.id },
    data: {
      ...parsed.data,
      ...(justPublished ? { publishedAt: new Date() } : {}),
    },
  });

  req.flash('success', `${parsed.data.title} has been updated.`);
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
  const [countries, institutions] = await Promise.all([
    prisma.country.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.partner.findMany({
      where: { category: 'INSTITUTION' },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  const parsed = opportunitySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).render('admin/content/opportunity-form', {
      title: 'New opportunity',
      layout: 'layouts/admin',
      opportunity: null,
      countries,
      institutions,
      categoryLabels: OPPORTUNITY_CATEGORY_LABELS,
      values: req.body,
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const slug = slugify(parsed.data.title, { lower: true, strict: true });
  const existing = await prisma.opportunity.findUnique({ where: { slug }, select: { id: true } });
  if (existing) throw new ConflictError('An opportunity with that title already exists.');

  const opportunity = await prisma.opportunity.create({ data: { ...parsed.data, slug } });

  req.flash('success', `${opportunity.title} has been created.`);
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
  const opportunity = await prisma.opportunity.findUnique({ where: { id: req.params.id as string } });
  if (!opportunity) throw new NotFoundError('That opportunity could not be found.');

  const [countries, institutions] = await Promise.all([
    prisma.country.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.partner.findMany({
      where: { category: 'INSTITUTION' },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  const parsed = opportunitySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).render('admin/content/opportunity-form', {
      title: `Edit: ${opportunity.title}`,
      layout: 'layouts/admin',
      opportunity,
      countries,
      institutions,
      categoryLabels: OPPORTUNITY_CATEGORY_LABELS,
      values: { ...req.body, id: opportunity.id },
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  await prisma.opportunity.update({ where: { id: opportunity.id }, data: parsed.data });

  req.flash('success', `${parsed.data.title} has been updated.`);
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

// ── FAQs ─────────────────────────────────────────────────────────────────────

const faqCountries = () =>
  prisma.country.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });

export async function createFaq(req: Request, res: Response): Promise<void> {
  res.render('admin/content/faq-form', {
    title: 'New FAQ',
    layout: 'layouts/admin',
    faq: null,
    countries: await faqCountries(),
    statuses: Object.values(PublishStatus),
    values: { status: PublishStatus.PUBLISHED },
    errors: {},
  });
}

export async function storeFaq(req: Request, res: Response): Promise<void> {
  const parsed = faqSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).render('admin/content/faq-form', {
      title: 'New FAQ',
      layout: 'layouts/admin',
      faq: null,
      countries: await faqCountries(),
      statuses: Object.values(PublishStatus),
      values: req.body,
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  await prisma.faq.create({ data: parsed.data });

  req.flash('success', 'The FAQ has been created.');
  res.redirect('/admin/content/faqs');
}

export async function editFaq(req: Request, res: Response): Promise<void> {
  const faq = await prisma.faq.findUnique({ where: { id: req.params.id as string } });
  if (!faq) throw new NotFoundError('That FAQ could not be found.');

  res.render('admin/content/faq-form', {
    title: 'Edit FAQ',
    layout: 'layouts/admin',
    faq,
    countries: await faqCountries(),
    statuses: Object.values(PublishStatus),
    values: faq,
    errors: {},
  });
}

export async function updateFaq(req: Request, res: Response): Promise<void> {
  const faq = await prisma.faq.findUnique({ where: { id: req.params.id as string } });
  if (!faq) throw new NotFoundError('That FAQ could not be found.');

  const parsed = faqSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).render('admin/content/faq-form', {
      title: 'Edit FAQ',
      layout: 'layouts/admin',
      faq,
      countries: await faqCountries(),
      statuses: Object.values(PublishStatus),
      values: { ...req.body, id: faq.id },
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  // An omitted country means "general" — clear any previous scoping.
  await prisma.faq.update({
    where: { id: faq.id },
    data: { ...parsed.data, countryId: parsed.data.countryId ?? null },
  });

  req.flash('success', 'The FAQ has been updated.');
  res.redirect('/admin/content/faqs');
}

// ── Testimonials ─────────────────────────────────────────────────────────────

const testimonialFormLocals = {
  layout: 'layouts/admin',
  statuses: Object.values(PublishStatus),
  sources: TESTIMONIAL_SOURCES,
};

export async function createTestimonial(req: Request, res: Response): Promise<void> {
  res.render('admin/content/testimonial-form', {
    title: 'New testimonial',
    ...testimonialFormLocals,
    testimonial: null,
    values: { status: PublishStatus.DRAFT, source: 'STUDENT' },
    errors: {},
  });
}

export async function storeTestimonial(req: Request, res: Response): Promise<void> {
  const parsed = testimonialSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).render('admin/content/testimonial-form', {
      title: 'New testimonial',
      ...testimonialFormLocals,
      testimonial: null,
      values: req.body,
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  await prisma.testimonial.create({ data: parsed.data });

  req.flash('success', 'The testimonial has been created.');
  res.redirect('/admin/content/testimonials');
}

export async function editTestimonial(req: Request, res: Response): Promise<void> {
  const testimonial = await prisma.testimonial.findUnique({ where: { id: req.params.id as string } });
  if (!testimonial) throw new NotFoundError('That testimonial could not be found.');

  res.render('admin/content/testimonial-form', {
    title: `Edit: ${testimonial.authorName}`,
    ...testimonialFormLocals,
    testimonial,
    values: testimonial,
    errors: {},
  });
}

export async function updateTestimonial(req: Request, res: Response): Promise<void> {
  const testimonial = await prisma.testimonial.findUnique({ where: { id: req.params.id as string } });
  if (!testimonial) throw new NotFoundError('That testimonial could not be found.');

  const parsed = testimonialSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).render('admin/content/testimonial-form', {
      title: `Edit: ${testimonial.authorName}`,
      ...testimonialFormLocals,
      testimonial,
      values: { ...req.body, id: testimonial.id },
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  // Cleared optional fields are written as null rather than left unchanged.
  const { authorRole, countryName, rating, avatarPath, ...rest } = parsed.data;
  await prisma.testimonial.update({
    where: { id: testimonial.id },
    data: {
      ...rest,
      authorRole: authorRole ?? null,
      countryName: countryName ?? null,
      rating: rating ?? null,
      avatarPath: avatarPath ?? null,
    },
  });

  req.flash('success', 'The testimonial has been updated.');
  res.redirect('/admin/content/testimonials');
}
