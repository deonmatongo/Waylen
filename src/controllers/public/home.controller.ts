/**
 * Home page (PRD §4.1, Appendix A).
 *
 * Leads with the mission rather than "study abroad", per §4.1. Every panel is
 * data-driven so the marketing page needs no code change as content is added
 * through the admin dashboard.
 */
import type { Request, Response } from 'express';
import {
  listPublishedCountries,
  listPublishedOpportunities,
  listPublicResources,
  listFeaturedTestimonials,
  listDisplayPartnerLogos,
} from '../../models/content.model.js';
import { listUpcomingWebinars } from '../../models/webinar.model.js';

export async function index(_req: Request, res: Response): Promise<void> {
  // Independent reads — fetched concurrently so the landing page stays fast
  // (PRD §7 — accessible and fast-loading).
  const [countries, featuredOpportunities, articles, testimonials, partnerLogos, webinars] =
    await Promise.all([
      listPublishedCountries({ featuredOnly: false }),
      listPublishedOpportunities({ perPage: 6 }),
      listPublicResources({ perPage: 3 }),
      listFeaturedTestimonials(6),
      listDisplayPartnerLogos(16),
      listUpcomingWebinars(3),
    ]);

  res.render('public/home', {
    title: 'Waylen — Build your international future',
    metaDescription:
      'Waylen helps ambitious people build international futures through guidance, community and global opportunity — from first enquiry to thriving abroad.',
    countries: countries.slice(0, 7),
    featuredOpportunities: featuredOpportunities.items,
    articles: articles.items,
    testimonials,
    partnerLogos,
    webinars,
  });
}
