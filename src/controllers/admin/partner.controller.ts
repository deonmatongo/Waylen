/**
 * Partner Directory (PRD §6.2). Phase 3 — behind FEATURE_PARTNER_DIRECTORY.
 */
import type { Request, Response } from 'express';
import slugify from 'slugify';
import { prisma } from '../../config/database.js';
import { PARTNER_CATEGORY_LABELS } from '../../config/constants.js';
import { NotFoundError, ConflictError } from '../../utils/errors.js';
import { partnerSchema } from '../../validators/partner.validator.js';

export async function index(req: Request, res: Response): Promise<void> {
  const { category, status } = req.query;

  const partners = await prisma.partner.findMany({
    where: {
      ...(category ? { category: category as never } : {}),
      ...(status ? { status: status as never } : {}),
    },
    select: {
      id: true,
      slug: true,
      name: true,
      category: true,
      status: true,
      isPubliclyListed: true,
      vettedAt: true,
      countries: { select: { name: true } },
      _count: { select: { referrals: true } },
    },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  });

  res.render('admin/partners/index', {
    title: 'Partner directory',
    layout: 'layouts/admin',
    partners,
    categoryLabels: PARTNER_CATEGORY_LABELS,
    filters: { category, status },
  });
}

export async function create(req: Request, res: Response): Promise<void> {
  const countries = await prisma.country.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  res.render('admin/partners/form', {
    title: 'Add a partner',
    layout: 'layouts/admin',
    partner: null,
    countries,
    categoryLabels: PARTNER_CATEGORY_LABELS,
    values: {},
    errors: {},
  });
}

export async function store(req: Request, res: Response): Promise<void> {
  const countries = await prisma.country.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  const parsed = partnerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).render('admin/partners/form', {
      title: 'Add a partner',
      layout: 'layouts/admin',
      partner: null,
      countries,
      categoryLabels: PARTNER_CATEGORY_LABELS,
      values: req.body,
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const slug = slugify(parsed.data.name, { lower: true, strict: true });
  const existing = await prisma.partner.findUnique({ where: { slug }, select: { id: true } });
  if (existing) throw new ConflictError('A partner with that name already exists.');

  const { countryIds, markVetted, ...data } = parsed.data;

  const partner = await prisma.partner.create({
    data: {
      ...data,
      slug,
      countries: { connect: countryIds.map((id) => ({ id })) },
      vettedAt: markVetted ? new Date() : null,
    },
  });

  req.flash('success', `${partner.name} has been added.`);
  res.redirect('/admin/partners');
}

export async function show(req: Request, res: Response): Promise<void> {
  const partner = await prisma.partner.findUnique({
    where: { id: req.params.id as string },
    include: {
      countries: { select: { name: true } },
      referrals: {
        select: {
          id: true,
          status: true,
          createdAt: true,
          convertedAt: true,
          commissionAmountMinor: true,
          commissionCurrency: true,
          studentProfile: {
            select: { reference: true, user: { select: { fullName: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      },
    },
  });

  if (!partner) throw new NotFoundError('That partner could not be found.');

  res.render('admin/partners/show', {
    title: partner.name,
    layout: 'layouts/admin',
    partner,
    categoryLabels: PARTNER_CATEGORY_LABELS,
  });
}

export async function edit(req: Request, res: Response): Promise<void> {
  const [partner, countries] = await Promise.all([
    prisma.partner.findUnique({
      where: { id: req.params.id as string },
      include: { countries: { select: { id: true } } },
    }),
    prisma.country.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);

  if (!partner) throw new NotFoundError('That partner could not be found.');

  res.render('admin/partners/form', {
    title: `Edit: ${partner.name}`,
    layout: 'layouts/admin',
    partner,
    countries,
    categoryLabels: PARTNER_CATEGORY_LABELS,
    values: partner,
    errors: {},
  });
}

export async function update(req: Request, res: Response): Promise<void> {
  const [partner, countries] = await Promise.all([
    prisma.partner.findUnique({ where: { id: req.params.id as string } }),
    prisma.country.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);
  if (!partner) throw new NotFoundError('That partner could not be found.');

  const parsed = partnerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).render('admin/partners/form', {
      title: `Edit: ${partner.name}`,
      layout: 'layouts/admin',
      partner,
      countries,
      categoryLabels: PARTNER_CATEGORY_LABELS,
      values: { ...req.body, id: partner.id },
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const { countryIds, markVetted, ...data } = parsed.data;

  await prisma.partner.update({
    where: { id: partner.id },
    data: {
      ...data,
      countries: { set: countryIds.map((id) => ({ id })) },
      vettedAt: markVetted ? (partner.vettedAt ?? new Date()) : null,
    },
  });

  req.flash('success', `${parsed.data.name} has been updated.`);
  res.redirect('/admin/partners');
}
