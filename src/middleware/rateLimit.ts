/**
 * Rate limits. Auth and upload endpoints are held to tighter budgets than
 * ordinary page views.
 *
 * NOTE: the default store is per-process. Before running more than one
 * instance, swap in a shared store (Redis) so limits are enforced globally.
 */
import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

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
