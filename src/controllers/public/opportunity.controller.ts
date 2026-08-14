/**
 * Opportunities listing and detail (PRD §4.2).
 *
 * Institution names are deliberately absent from every response here — the
 * model layer excludes them so the trusted-intermediary position holds.
 */
import type { Request, Response } from 'express';
import { listPublishedOpportunities, findOpportunityBySlug, countOpportunitiesByCategory, listPublishedCountries } from '../../models/content.model.js';
import { OPPORTUNITY_CATEGORY_LABELS } from '../../config/constants.js';
import { NotFoundError } from '../../utils/errors.js';

export async function index(req: Request, res: Response): Promise<void> {
  const { category, country, level, scholarships, q, page } = req.query;

  const [results, categoryCounts, countries] = await Promise.all([
    listPublishedOpportunities({
      category: category as never,
      countrySlug: country as string | undefined,
      studyLevel: level as string | undefined,
      scholarshipOnly: scholarships === 'on',
      search: typeof q === 'string' ? q : undefined,
      page: Number(page) || 1,
    }),
    countOpportunitiesByCategory(),
    listPublishedCountries(),
  ]);

  res.render('public/opportunities/index', {
    title: 'Opportunities',
    metaDescription:
      'Explore universities, postgraduate programmes, professional certifications, vocational training and more across our partner destinations.',
    results,
    countries,
    categoryLabels: OPPORTUNITY_CATEGORY_LABELS,
    categoryCounts,
    filters: { category, country, level, scholarships, q },
  });
}

export async function show(req: Request, res: Response): Promise<void> {
  const opportunity = await findOpportunityBySlug(req.params.slug as string);
  if (!opportunity) throw new NotFoundError('That opportunity is no longer listed.');

  res.render('public/opportunities/show', {
    title: opportunity.metaTitle ?? opportunity.title,
    metaDescription: opportunity.metaDescription ?? opportunity.description.slice(0, 160),
    opportunity,
    categoryLabel: OPPORTUNITY_CATEGORY_LABELS[opportunity.category],
  });
}

export async function enquire(req: Request, res: Response): Promise<void> {
  // TODO(phase-1): persist via enquiryService so the enquiry lands in the CRM
  // (PRD §5.4) and triggers staff notification.
  req.flash('success', 'Thank you — a counsellor will be in touch shortly.');
  res.redirect(`/opportunities/${req.params.slug}`);
}
