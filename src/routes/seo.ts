/**
 * robots.txt and sitemap.xml (PRD §8.1 — SEO-friendly structure, especially
 * for Country and Learning Hub content).
 */
import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { env } from '../config/env.js';
import { prisma } from '../config/database.js';

export const seoRouter = Router();

seoRouter.get('/robots.txt', (_req, res) => {
  const lines = env.isProduction
    ? [
        'User-agent: *',
        'Allow: /',
        // Authenticated surfaces must never be indexed.
        'Disallow: /portal',
        'Disallow: /admin',
        'Disallow: /login',
        'Disallow: /register',
        'Disallow: /verify-email',
        'Disallow: /reset-password',
        '',
        `Sitemap: ${env.APP_URL}/sitemap.xml`,
      ]
    : ['User-agent: *', 'Disallow: /'];

  res.type('text/plain').send(lines.join('\n'));
});

seoRouter.get(
  '/sitemap.xml',
  asyncHandler(async (_req, res) => {
    const [countries, opportunities, resources, webinars] = await Promise.all([
      prisma.country.findMany({
        where: { status: 'PUBLISHED' },
        select: { slug: true, updatedAt: true },
      }),
      prisma.opportunity.findMany({
        where: { status: 'PUBLISHED' },
        select: { slug: true, updatedAt: true },
      }),
      prisma.resource.findMany({
        where: { status: 'PUBLISHED', requiresAuth: false },
        select: { slug: true, updatedAt: true },
      }),
      prisma.webinar.findMany({
        where: { status: 'PUBLISHED' },
        select: { slug: true, updatedAt: true },
      }),
    ]);

    const staticPaths = [
      { path: '/', priority: '1.0', changefreq: 'weekly' },
      { path: '/services', priority: '0.9', changefreq: 'monthly' },
      { path: '/opportunities', priority: '0.9', changefreq: 'weekly' },
      { path: '/countries', priority: '0.9', changefreq: 'weekly' },
      { path: '/learning-hub', priority: '0.8', changefreq: 'weekly' },
      { path: '/webinars', priority: '0.8', changefreq: 'weekly' },
      { path: '/community', priority: '0.7', changefreq: 'monthly' },
      { path: '/about', priority: '0.7', changefreq: 'monthly' },
      { path: '/for-institutions', priority: '0.7', changefreq: 'monthly' },
      { path: '/for-partners', priority: '0.7', changefreq: 'monthly' },
      { path: '/contact', priority: '0.6', changefreq: 'yearly' },
      { path: '/book-consultation', priority: '0.8', changefreq: 'monthly' },
    ];

    const entry = (loc: string, lastmod?: Date, priority = '0.7', changefreq = 'monthly') =>
      [
        '  <url>',
        `    <loc>${env.APP_URL}${loc}</loc>`,
        lastmod ? `    <lastmod>${lastmod.toISOString().split('T')[0]}</lastmod>` : '',
        `    <changefreq>${changefreq}</changefreq>`,
        `    <priority>${priority}</priority>`,
        '  </url>',
      ]
        .filter(Boolean)
        .join('\n');

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...staticPaths.map((p) => entry(p.path, undefined, p.priority, p.changefreq)),
      ...countries.map((c) => entry(`/countries/${c.slug}`, c.updatedAt, '0.8', 'monthly')),
      ...opportunities.map((o) => entry(`/opportunities/${o.slug}`, o.updatedAt, '0.7', 'weekly')),
      ...resources.map((r) => entry(`/learning-hub/${r.slug}`, r.updatedAt, '0.7', 'monthly')),
      ...webinars.map((w) => entry(`/webinars/${w.slug}`, w.updatedAt, '0.6', 'weekly')),
      '</urlset>',
    ].join('\n');

    res.type('application/xml').send(xml);
  }),
);
