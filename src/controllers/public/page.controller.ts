/**
 * Static-ish trust pages (PRD §4.8, §4.9).
 *
 * Institutions and partners evaluate Waylen through these pages, so they are
 * first-class rather than an afterthought.
 */
import type { Request, Response } from 'express';
import { listDisplayPartnerLogos, listFeaturedTestimonials } from '../../models/content.model.js';

export async function about(req: Request, res: Response): Promise<void> {
  const [partnerLogos, testimonials] = await Promise.all([
    listDisplayPartnerLogos(32),
    listFeaturedTestimonials(9),
  ]);

  res.render('public/about', {
    title: 'About Waylen',
    metaDescription:
      'Waylen is a trusted guide for people building international lives — our mission, our team, our partners and our standards.',
    partnerLogos,
    testimonials,
  });
}

export async function forInstitutions(req: Request, res: Response): Promise<void> {
  res.render('public/for-institutions', {
    title: 'For institutions',
    metaDescription:
      'How Waylen operates as a regional representative: a vetted candidate pipeline, standardised documentation, one accountable point of contact and transparent application tracking.',
  });
}

export async function forPartners(req: Request, res: Response): Promise<void> {
  res.render('public/for-partners', {
    title: 'For partners',
    metaDescription:
      'Partner with Waylen: documented vetting criteria, structured referral tracking, and one platform where students, alumni, institutions and partners intersect.',
  });
}

export async function privacyPolicy(req: Request, res: Response): Promise<void> {
  res.render('public/privacy-policy', {
    title: 'Privacy policy',
    metaDescription:
      'How Waylen collects, stores and protects your personal data and identity documents.',
  });
}

export async function terms(req: Request, res: Response): Promise<void> {
  res.render('public/terms', {
    title: 'Terms of service',
    metaDescription: 'The terms governing your use of the Waylen platform.',
  });
}
