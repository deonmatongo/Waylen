/**
 * Resource Library (PRD §5.2) — country packs, visa checklists, recorded
 * webinars and templates for registered students.
 */
import type { Request, Response } from 'express';
import { listPublicResources, findResourceBySlug } from '../../models/content.model.js';
import { prisma } from '../../config/database.js';
import { NotFoundError } from '../../utils/errors.js';
import { buildPageMeta, parsePage } from '../../utils/pagination.js';

export async function index(req: Request, res: Response): Promise<void> {
  const { type } = req.query;
  const pageReq = parsePage(req.query, { perPage: 24 });
  const portalWhere = { status: 'PUBLISHED' as const, requiresAuth: true };

  // Registered students see both public and portal-only resources. Both
  // lists share the `page` parameter; the pager follows the longer one.
  const [publicItems, portalOnly, portalTotal] = await Promise.all([
    listPublicResources({ type: type as string | undefined, page: pageReq.page, perPage: pageReq.perPage }),
    prisma.resource.findMany({
      where: portalWhere,
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
      skip: pageReq.skip,
      take: pageReq.take,
    }),
    prisma.resource.count({ where: portalWhere }),
  ]);
  const portalMeta = buildPageMeta(pageReq, portalTotal);
  const publicMeta = buildPageMeta(pageReq, publicItems.total);
  const pageMeta = portalMeta.pages >= publicMeta.pages ? portalMeta : publicMeta;

  res.render('portal/resources/index', {
    title: 'Resource library',
    layout: 'layouts/portal',
    results: publicItems,
    portalOnly,
    pageMeta,
    pageQuery: typeof type === 'string' && type ? { type } : {},
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
