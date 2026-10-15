/**
 * Resource library and webinars over the JSON API.
 */
import type { Request, Response } from 'express';
import { prisma } from '../../config/database.js';
import { findResourceBySlug } from '../../models/content.model.js';
import { listUpcomingWebinars, listPastWebinarsWithRecordings } from '../../models/webinar.model.js';
import { webinarService } from '../../services/webinar.service.js';
import { idParamSchema, resourcesQuerySchema, slugParamSchema } from '../../validators/api.validator.js';
import { NotFoundError } from '../../utils/errors.js';
import { paginate, parse, requireStudent } from './helpers.js';

/** GET /resources — public and portal-only items together, as students see on the web. */
export async function listResources(req: Request, res: Response): Promise<void> {
  const { page, perPage, type } = parse(resourcesQuerySchema, req.query);
  const where = { status: 'PUBLISHED' as const, ...(type ? { type } : {}) };

  const [rows, total] = await Promise.all([
    prisma.resource.findMany({
      where,
      select: {
        slug: true,
        title: true,
        type: true,
        excerpt: true,
        coverImagePath: true,
        readMinutes: true,
        tags: true,
        publishedAt: true,
        requiresAuth: true,
      },
      orderBy: { publishedAt: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.resource.count({ where }),
  ]);

  res.json({
    items: rows.map((r) => ({ ...r, tags: JSON.parse(r.tags) as string[] })),
    page,
    perPage,
    total,
  });
}

/** GET /resources/:slug */
export async function showResource(req: Request, res: Response): Promise<void> {
  const { slug } = parse(slugParamSchema, req.params);
  const resource = await findResourceBySlug(slug, true);
  if (!resource) throw new NotFoundError('That resource could not be found.');
  res.json(resource);
}

/** GET /webinars — `items` is the paginated upcoming list; recordings come alongside. */
export async function listWebinars(req: Request, res: Response): Promise<void> {
  const pagination = parse(resourcesQuerySchema.pick({ page: true, perPage: true }), req.query);
  const [upcoming, recordings] = await Promise.all([
    listUpcomingWebinars(200),
    listPastWebinarsWithRecordings(24),
  ]);

  res.json({ ...paginate(upcoming, pagination), upcoming, recordings });
}

/** POST /webinars/:id/register */
export async function registerWebinar(req: Request, res: Response): Promise<void> {
  const student = await requireStudent(req);
  const { id } = parse(idParamSchema, req.params);

  await webinarService.registerStudent(id, { studentProfileId: student.id, userId: req.currentUser!.id });
  res.json({ ok: true });
}
