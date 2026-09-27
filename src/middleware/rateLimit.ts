/**
 * Rate limits. Auth and upload endpoints are held to tighter budgets than
 * ordinary page views.
 *
 * KNOWN GAP: the store is per-process (express-rate-limit's in-memory
 * default). On Vercel, each concurrent instance/container counts
 * independently, so a configured "10 attempts per 15 minutes" is actually
 * "10 per instance per 15 minutes" — the effective ceiling scales with
 * however many instances are warm, not a hard global limit. This is a known,
 * accepted gap, not an oversight: closing it needs a shared store (e.g.
 * Upstash Redis, since Vercel functions can't hold a pooled TCP connection
 * to a traditional Redis) via `rate-limit-redis` or similar, which requires
 * provisioning that service first. Revisit before this app is a real target
 * for credential-stuffing or scraping at meaningful traffic.
 */
import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

if (env.isProduction) {
  logger.warn(
    'Rate limiting is using the in-memory per-process store in production — ' +
      'limits are enforced per instance, not globally. See src/middleware/rateLimit.ts.',
  );
}

const skipInTest = () => env.isTest;

export const globalRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: skipInTest,
});

/** Login, register, password reset — brute-force resistance. */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  skip: skipInTest,
  message: 'Too many attempts. Please wait a few minutes and try again.',
});

/** Public forms — contact, enquiry, webinar registration. */
export const formRateLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 15,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: skipInTest,
  message: 'You have submitted this form several times. Please try again later.',
});

export const uploadRateLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 40,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: skipInTest,
  message: 'Upload limit reached for now. Please try again shortly.',
});
