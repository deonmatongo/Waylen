/**
 * Route registration — the map of the whole application.
 *
 * The three mount points mirror the three PRD layers (§3). `loadCurrentUser`
 * runs before all of them so public pages can greet a signed-in visitor while
 * still being reachable anonymously.
 */
import type { Express } from 'express';
import { loadCurrentUser } from '../middleware/auth.js';

import { publicRouter } from './public/index.js';
import { authRouter } from './auth/index.js';
import { portalRouter } from './portal/index.js';
import { adminRouter } from './admin/index.js';
import { webhookRouter } from './webhooks.js';
import { seoRouter } from './seo.js';

export function registerRoutes(app: Express): void {
  // Signature-verified, session-free — mounted before session-dependent routes.
  app.use('/webhooks', webhookRouter);

  app.use(loadCurrentUser);

  // sitemap.xml / robots.txt (PRD §8.1 — SEO-friendly structure)
  app.use(seoRouter);

  // Layer 2 & 3: authenticated surfaces, mounted first so their prefixes win.
  app.use('/portal', portalRouter);
  app.use('/admin', adminRouter);
  app.use(authRouter);

  // Layer 1: the public website, last because it owns the catch-all slugs.
  app.use(publicRouter);
}
