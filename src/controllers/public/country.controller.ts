/**
 * Country pages (PRD §4.3) — the destination-first mini-encyclopaedia.
 */
import type { Request, Response } from 'express';
import { listPublishedCountries, findCountryBySlug } from '../../models/content.model.js';
import { NotFoundError } from '../../utils/errors.js';

export async function index(req: Request, res: Response): Promise<void> {
  const countries = await listPublishedCountries();

  res.render('public/countries/index', {
    title: 'Study destinations',
    metaDescription:
      'Detailed guides to living, studying and building a career in each of our destination countries — costs, visas, healthcare, banking and student life.',
    countries,
  });
}

export async function show(req: Request, res: Response): Promise<void> {
  const country = await findCountryBySlug(req.params.slug as string);
  if (!country) throw new NotFoundError('We do not have a guide for that country yet.');

  res.render('public/countries/show', {
    title: country.metaTitle ?? `Study in ${country.name}`,
    metaDescription:
      country.metaDescription ??
      `Everything you need to know about studying and living in ${country.name} — costs, visas, healthcare, accommodation and career opportunities.`,
    country,
  });
}
