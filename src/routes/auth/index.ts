/**
 * Authentication routes — PRD §5.1.
 *
 * All write endpoints are behind `authRateLimiter`; registration and login are
 * the two most attacked surfaces on the platform.
 */
import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { authRateLimiter } from '../../middleware/rateLimit.js';
import { requireAuth, requireGuest } from '../../middleware/auth.js';

import * as registerController from '../../controllers/auth/register.controller.js';
import * as loginController from '../../controllers/auth/login.controller.js';
import * as verificationController from '../../controllers/auth/verification.controller.js';
import * as passwordController from '../../controllers/auth/password.controller.js';

export const authRouter = Router();

// ── Register ───────────────────────────────────────────────────────────────
authRouter.get('/register', requireGuest, asyncHandler(registerController.show));
authRouter.post(
  '/register',
  requireGuest,
  authRateLimiter,
  asyncHandler(registerController.submit),
);

// ── Login / logout ─────────────────────────────────────────────────────────
authRouter.get('/login', requireGuest, asyncHandler(loginController.show));
authRouter.post('/login', requireGuest, authRateLimiter, asyncHandler(loginController.submit));
authRouter.post('/logout', asyncHandler(loginController.logout));

// ── Email verification (required before portal access) ─────────────────────
authRouter.get('/verify-email/pending', requireAuth, asyncHandler(verificationController.pending));
authRouter.get('/verify-email/:token', asyncHandler(verificationController.verify));
authRouter.post(
  '/verify-email/resend',
  authRateLimiter,
  asyncHandler(verificationController.resend),
);

// ── Password reset ─────────────────────────────────────────────────────────
authRouter.get('/forgot-password', requireGuest, asyncHandler(passwordController.showForgot));
authRouter.post(
  '/forgot-password',
  requireGuest,
  authRateLimiter,
  asyncHandler(passwordController.submitForgot),
);
authRouter.get('/reset-password/:token', requireGuest, asyncHandler(passwordController.showReset));
authRouter.post(
  '/reset-password/:token',
  requireGuest,
  authRateLimiter,
  asyncHandler(passwordController.submitReset),
);
