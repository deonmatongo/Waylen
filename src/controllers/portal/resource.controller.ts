/**
 * Resource Library (PRD §5.2) — country packs, visa checklists, recorded
 * webinars and templates for registered students.
 */
import type { Request, Response } from 'express';
import { listPublicResources, findResourceBySlug } from '../../models/content.model.js';
import { prisma } from '../../config/database.js';
import { NotFoundError } from '../../utils/errors.js';

export async function index(req: Request, res: Response): Promise<void> {
  const { type, page } = req.query;

  // Registered students see both public and portal-only resources.
  const [publicItems, portalOnly] = await Promise.all([
    listPublicResources({ type: type as string | undefined, page: Number(page) || 1, perPage: 24 }),
    prisma.resource.findMany({
      where: { status: 'PUBLISHED', requiresAuth: true },
      select: {
        slug: true,
        title: true,
        type: true,
        excerpt: true,
        coverImagePath: true,
        readMinutes: true,
        tags: true,
        publishedAt: true,
      },
      orderBy: { publishedAt: 'desc' },
    }),
  ]);

  res.render('portal/resources/index', {
    title: 'Resource library',
    layout: 'layouts/portal',
    results: publicItems,
    portalOnly,
    filters: { type },
  });
}

export async function show(req: Request, res: Response): Promise<void> {
  const resource = await findResourceBySlug(req.params.slug as string, true);
  if (!resource) throw new NotFoundError('That resource could not be found.');

  res.render('portal/resources/show', {
    title: resource.title,
    layout: 'layouts/portal',
    resource,
  });
}
