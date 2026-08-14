/**
 * Learning Hub (PRD §4.4) — the platform's biggest long-term content asset.
 */
import type { Request, Response } from 'express';
import { listPublicResources, findResourceBySlug } from '../../models/content.model.js';
import { NotFoundError } from '../../utils/errors.js';

export async function index(req: Request, res: Response): Promise<void> {
  const { type, tag, page } = req.query;

  const results = await listPublicResources({
    type: type as string | undefined,
    tag: tag as string | undefined,
    page: Number(page) || 1,
  });

  res.render('public/learning-hub/index', {
    title: 'Learning Hub',
    metaDescription:
      'Guides, checklists and articles on choosing a programme, scholarships, visas, budgeting, motivation letters, CVs and building a career abroad.',
    results,
    filters: { type, tag },
  });
}

export async function show(req: Request, res: Response): Promise<void> {
  const resource = await findResourceBySlug(req.params.slug as string);
  if (!resource) throw new NotFoundError('That article could not be found.');

  res.render('public/learning-hub/show', {
    title: resource.metaTitle ?? resource.title,
    metaDescription: resource.metaDescription ?? resource.excerpt ?? undefined,
    resource,
  });
}
