/**
 * Partner Directory (PRD §6.2). Phase 3 — behind FEATURE_PARTNER_DIRECTORY.
 */
import type { Request, Response } from 'express';
import { prisma } from '../../config/database.js';
import { PARTNER_CATEGORY_LABELS } from '../../config/constants.js';
import { NotFoundError } from '../../utils/errors.js';

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
  // TODO(phase-3): validate with partnerSchema and persist, including contract
  // and commission terms (admin-only, never public).
  req.flash('info', 'Partner records are wired up in Phase 3.');
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
  // TODO(phase-3): validate and persist the edit.
  req.flash('info', 'Partner editing is wired up in Phase 3.');
  res.redirect('/admin/partners');
}
