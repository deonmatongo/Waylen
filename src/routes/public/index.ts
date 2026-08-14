/**
 * Public website routes — PRD §4.
 *
 * Everything here is anonymous-accessible and indexable. Slug routes come last
 * within each group so `/countries/compare` is never swallowed by
 * `/countries/:slug`.
 */
import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { formRateLimiter } from '../../middleware/rateLimit.js';

import * as homeController from '../../controllers/public/home.controller.js';
import * as opportunityController from '../../controllers/public/opportunity.controller.js';
import * as countryController from '../../controllers/public/country.controller.js';
import * as learningHubController from '../../controllers/public/learningHub.controller.js';
import * as webinarController from '../../controllers/public/webinar.controller.js';
import * as serviceController from '../../controllers/public/service.controller.js';
import * as communityController from '../../controllers/public/community.controller.js';
import * as pageController from '../../controllers/public/page.controller.js';
import * as contactController from '../../controllers/public/contact.controller.js';
import * as consultationController from '../../controllers/public/consultation.controller.js';

export const publicRouter = Router();

// ── Home (PRD §4.1) ────────────────────────────────────────────────────────
publicRouter.get('/', asyncHandler(homeController.index));

// ── Opportunities (PRD §4.2) ───────────────────────────────────────────────
publicRouter.get('/opportunities', asyncHandler(opportunityController.index));
publicRouter.get('/opportunities/:slug', asyncHandler(opportunityController.show));
publicRouter.post(
  '/opportunities/:slug/enquire',
  formRateLimiter,
  asyncHandler(opportunityController.enquire),
);

// ── Countries (PRD §4.3) ───────────────────────────────────────────────────
publicRouter.get('/countries', asyncHandler(countryController.index));
publicRouter.get('/countries/:slug', asyncHandler(countryController.show));

// ── Learning Hub (PRD §4.4) ────────────────────────────────────────────────
publicRouter.get('/learning-hub', asyncHandler(learningHubController.index));
publicRouter.get('/learning-hub/:slug', asyncHandler(learningHubController.show));

// ── Webinars & Events (PRD §4.5) ───────────────────────────────────────────
publicRouter.get('/webinars', asyncHandler(webinarController.index));
publicRouter.get('/webinars/:slug', asyncHandler(webinarController.show));
publicRouter.post(
  '/webinars/:slug/register',
  formRateLimiter,
  asyncHandler(webinarController.register),
);

// ── Services (PRD §4.7) ────────────────────────────────────────────────────
publicRouter.get('/services', asyncHandler(serviceController.index));
publicRouter.get('/services/:slug', asyncHandler(serviceController.show));

// ── Community & Professional Network (PRD §4.6) ────────────────────────────
publicRouter.get('/community', asyncHandler(communityController.index));

// ── Trust pages (PRD §4.9) ─────────────────────────────────────────────────
publicRouter.get('/about', asyncHandler(pageController.about));
publicRouter.get('/for-institutions', asyncHandler(pageController.forInstitutions));
publicRouter.get('/for-partners', asyncHandler(pageController.forPartners));
publicRouter.get('/privacy-policy', asyncHandler(pageController.privacyPolicy));
publicRouter.get('/terms', asyncHandler(pageController.terms));

// ── Contact & consultation (PRD §4.8, §A.13) ───────────────────────────────
publicRouter.get('/contact', asyncHandler(contactController.show));
publicRouter.post('/contact', formRateLimiter, asyncHandler(contactController.submit));

publicRouter.get('/book-consultation', asyncHandler(consultationController.show));
publicRouter.post(
  '/book-consultation',
  formRateLimiter,
  asyncHandler(consultationController.submit),
);
