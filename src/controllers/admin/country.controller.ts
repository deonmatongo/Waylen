/**
 * Country management (PRD §4.3 — "managed by the Waylen team through the
 * admin dashboard and expandable over time", §5.4).
 */
import type { Request, Response } from 'express';
import slugify from 'slugify';
import { PublishStatus } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { countrySchema } from '../../validators/country.validator.js';
import { NotFoundError, ConflictError } from '../../utils/errors.js';

export async function index(req: Request, res: Response): Promise<void> {
  const countries = await prisma.country.findMany({
    select: {
      id: true,
      slug: true,
      name: true,
      isoCode: true,
      status: true,
      isFeatured: true,
      displayOrder: true,
      _count: { select: { opportunities: true, studentsTargeting: true } },
    },
    orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
  });

  res.render('admin/countries/index', {
    title: 'Countries',
    layout: 'layouts/admin',
    countries,
  });
}

export async function create(req: Request, res: Response): Promise<void> {
  res.render('admin/countries/form', {
    title: 'Add a country',
    layout: 'layouts/admin',
    country: null,
    statuses: Object.values(PublishStatus),
    values: {},
    errors: {},
  });
}

export async function store(req: Request, res: Response): Promise<void> {
  const parsed = countrySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).render('admin/countries/form', {
      title: 'Add a country',
      layout: 'layouts/admin',
      country: null,
      statuses: Object.values(PublishStatus),
      values: req.body,
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const slug = slugify(parsed.data.name, { lower: true, strict: true });

  const existing = await prisma.country.findFirst({
    where: { OR: [{ slug }, { isoCode: parsed.data.isoCode }] },
    select: { id: true },
  });
  if (existing) {
    throw new ConflictError('A country with that name or ISO code already exists.');
  }

  const country = await prisma.country.create({ data: { ...parsed.data, slug } });

  req.flash('success', `${country.name} has been added.`);
  res.redirect('/admin/countries');
}

export async function edit(req: Request, res: Response): Promise<void> {
  const country = await prisma.country.findUnique({ where: { id: req.params.id as string } });
  if (!country) throw new NotFoundError('That country could not be found.');

  res.render('admin/countries/form', {
    title: `Edit: ${country.name}`,
    layout: 'layouts/admin',
    country,
    statuses: Object.values(PublishStatus),
    values: country,
    errors: {},
  });
}

export async function update(req: Request, res: Response): Promise<void> {
  const country = await prisma.country.findUnique({ where: { id: req.params.id as string } });
  if (!country) throw new NotFoundError('That country could not be found.');

  const parsed = countrySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).render('admin/countries/form', {
      title: `Edit: ${country.name}`,
      layout: 'layouts/admin',
      country,
      statuses: Object.values(PublishStatus),
      values: { ...req.body, id: country.id },
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  // Renaming a published country would break existing links, so the slug is
  // fixed at creation — only the isoCode uniqueness can still be violated.
  if (parsed.data.isoCode !== country.isoCode) {
    const existing = await prisma.country.findUnique({
      where: { isoCode: parsed.data.isoCode },
      select: { id: true },
    });
    if (existing) throw new ConflictError('Another country already uses that ISO code.');
  }

  await prisma.country.update({ where: { id: country.id }, data: parsed.data });

  req.flash('success', `${parsed.data.name} has been updated.`);
  res.redirect('/admin/countries');
}
