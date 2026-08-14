/**
 * Country management (PRD §4.3 — "managed by the Waylen team through the
 * admin dashboard and expandable over time", §5.4).
 */
import type { Request, Response } from 'express';
import { prisma } from '../../config/database.js';
import { NotFoundError } from '../../utils/errors.js';

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
    values: {},
    errors: {},
  });
}

export async function store(req: Request, res: Response): Promise<void> {
  // TODO(phase-1): validate with countrySchema and persist. Adding a country
  // must never require a code change (PRD §8.1 — scalable without a rebuild).
  req.flash('info', 'Country authoring is wired up in Phase 1.');
  res.redirect('/admin/countries');
}

export async function edit(req: Request, res: Response): Promise<void> {
  const country = await prisma.country.findUnique({ where: { id: req.params.id as string } });
  if (!country) throw new NotFoundError('That country could not be found.');

  res.render('admin/countries/form', {
    title: `Edit: ${country.name}`,
    layout: 'layouts/admin',
    country,
    values: country,
    errors: {},
  });
}

export async function update(req: Request, res: Response): Promise<void> {
  // TODO(phase-1): validate and persist the edit.
  req.flash('info', 'Country editing is wired up in Phase 1.');
  res.redirect('/admin/countries');
}
