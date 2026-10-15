/**
 * Authentication routes — PRD §5.1.
 *
 * All write endpoints are behind `authRateLimiter`; registration and login are
 * the two most attacked surfaces on the platform.
 */
import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import {
  authRateLimiter,
  strictAuthRateLimiter,
  emailRateLimiter,
} from '../../middleware/rateLimit.js';
import { requireAuth, requireGuest, requireSession, requireStaff } from '../../middleware/auth.js';

import * as registerController from '../../controllers/auth/register.controller.js';
import * as loginController from '../../controllers/auth/login.controller.js';
import * as verificationController from '../../controllers/auth/verification.controller.js';
import * as accountController from '../../controllers/auth/account.controller.js';
import * as mfaController from '../../controllers/auth/mfa.controller.js';
import * as passwordController from '../../controllers/auth/password.controller.js';

export const authRouter = Router();

// ── Register ───────────────────────────────────────────────────────────────
authRouter.get('/register', requireGuest, asyncHandler(registerController.show));
authRouter.post(
  '/register',
  requireGuest,
  strictAuthRateLimiter,
  asyncHandler(registerController.submit),
);

// ── Login / logout ─────────────────────────────────────────────────────────
authRouter.get('/login', requireGuest, asyncHandler(loginController.show));
authRouter.post('/login', requireGuest, authRateLimiter, asyncHandler(loginController.submit));
authRouter.get('/login/mfa', requireGuest, asyncHandler(mfaController.showChallenge));
authRouter.post(
  '/login/mfa',
  requireGuest,
  strictAuthRateLimiter,
  asyncHandler(mfaController.submitChallenge),
);
authRouter.post('/logout', asyncHandler(loginController.logout));

// ── Email verification (required before portal access) ─────────────────────
authRouter.get('/verify-email/pending', requireSession, asyncHandler(verificationController.pending));
authRouter.post(
  '/verify-email/resend',
  strictAuthRateLimiter,
  emailRateLimiter,
  asyncHandler(verificationController.resend),
);
// GET only shows a confirm button; the POST consumes the token (scanner-safe).
authRouter.get('/verify-email/:token', asyncHandler(verificationController.confirm));
authRouter.post(
  '/verify-email/:token',
  authRateLimiter,
  asyncHandler(verificationController.verify),
);

// ── Password reset ─────────────────────────────────────────────────────────
authRouter.get('/forgot-password', requireGuest, asyncHandler(passwordController.showForgot));
authRouter.post(
  '/forgot-password',
  requireGuest,
  strictAuthRateLimiter,
  emailRateLimiter,
  asyncHandler(passwordController.submitForgot),
);
authRouter.get('/reset-password/:token', requireGuest, asyncHandler(passwordController.showReset));
authRouter.post(
  '/reset-password/:token',
  requireGuest,
  authRateLimiter,
  asyncHandler(passwordController.submitReset),
);

// ── Staff self-service password change ─────────────────────────────────────
authRouter.get(
  '/account/password',
  requireAuth,
  requireStaff,
  asyncHandler(accountController.showChangePassword),
);
authRouter.post(
  '/account/password',
  requireAuth,
  requireStaff,
  authRateLimiter,
  asyncHandler(accountController.submitChangePassword),
);

// ── Staff two-factor enrolment ─────────────────────────────────────────────
authRouter.get(
  '/account/security',
  requireAuth,
  requireStaff,
  asyncHandler(mfaController.showSecurity),
);
authRouter.post(
  '/account/security',
  requireAuth,
  requireStaff,
  authRateLimiter,
  asyncHandler(mfaController.submitSecurity),
);
