/**
 * Services (PRD §4.7) — the full breadth of support, including the partner
 * categories set out in §6.1.
 */
import type { Request, Response } from 'express';
import { SERVICE_CATALOGUE } from '../../config/services.js';
import { NotFoundError } from '../../utils/errors.js';

export async function index(req: Request, res: Response): Promise<void> {
  res.render('public/services/index', {
    title: 'Our services',
    metaDescription:
      'Education, career, wealth-building, relocation, legal and financial support — guidance across the whole international journey, not just admissions.',
    services: SERVICE_CATALOGUE,
  });
}

export async function show(req: Request, res: Response): Promise<void> {
  const service = SERVICE_CATALOGUE.find((s) => s.slug === req.params.slug);
  if (!service) throw new NotFoundError('That service could not be found.');

  res.render('public/services/show', {
    title: service.name,
    metaDescription: service.summary,
    service,
  });
}
