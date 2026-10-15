/**
 * When MFA_REQUIRED_FOR_STAFF is on, staff without TOTP enrolled are sent to
 * /account/security (outside /admin, so no redirect loop) until they enrol.
 */
import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';

export function requireMfaEnrolled(req: Request, res: Response, next: NextFunction): void {
  if (env.MFA_REQUIRED_FOR_STAFF && req.currentUser && !req.currentUser.mfaEnabled) {
    req.flash('warning', 'Two-factor authentication is required for staff. Please set it up to continue.');
    res.redirect('/account/security');
    return;
  }
  next();
}
