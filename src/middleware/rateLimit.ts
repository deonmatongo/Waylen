/**
 * Rate limits. Auth and upload endpoints are held to tighter budgets than
 * ordinary page views.
 *
 * STORE: when `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` are
 * configured, every limiter below shares a single Upstash Redis-backed store
 * (see upstashRateLimitStore.ts) so limits are enforced globally across all
 * concurrent instances. When those env vars are unset — the case for this
 * environment, and for anyone who hasn't provisioned Upstash yet — each
 * limiter falls back to express-rate-limit's default per-process in-memory
 * store, exactly as before: a configured "10 attempts per 15 minutes" is then
 * "10 per instance per 15 minutes" on platforms like Vercel where each
 * concurrent serverless instance counts independently. Provision Upstash and
 * set both env vars to close that gap in production.
 */
import rateLimit from 'express-rate-limit';
import type { Request, Response } from 'express';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { createUpstashStore, isUpstashConfigured } from './upstashRateLimitStore.js';

/**
 * express-rate-limit's default handler sends `message` via `res.send`, which
 * renders as HTML for a browser form post. The JSON mobile API (POST
 * /api/v1/auth/login) shares this limiter, so a rejected request there must
 * still come back as JSON rather than a stray HTML body.
 */
function rateLimitHandler(message: string) {
  return (req: Request, res: Response): void => {
    if (req.accepts(['html', 'json']) === 'json') {
      res.status(429).json({ error: message });
      return;
    }
    res.status(429).send(message);
  };
}

if (env.isProduction && !isUpstashConfigured) {
  logger.warn(
    'Rate limiting has no UPSTASH_REDIS_REST_URL/TOKEN configured in production — ' +
      'falling back to the in-memory per-process store, so limits are enforced per ' +
      'instance, not globally. See src/middleware/rateLimit.ts.',
  );
}

const skipInTest = () => env.isTest;

export const globalRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: skipInTest,
  store: isUpstashConfigured ? createUpstashStore('rl:global:') : undefined,
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
  handler: rateLimitHandler('Too many attempts. Please wait a few minutes and try again.'),
  store: isUpstashConfigured ? createUpstashStore('rl:auth:') : undefined,
});

/** Public forms — contact, enquiry, webinar registration. */
export const formRateLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 15,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: skipInTest,
  message: 'You have submitted this form several times. Please try again later.',
  store: isUpstashConfigured ? createUpstashStore('rl:form:') : undefined,
});

export const uploadRateLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 40,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: skipInTest,
  message: 'Upload limit reached for now. Please try again shortly.',
  store: isUpstashConfigured ? createUpstashStore('rl:upload:') : undefined,
});
