/**
 * Email verification (PRD §5.1 — required before portal access).
 */
import type { Request, Response } from 'express';
import { authService } from '../../services/auth.service.js';
import { STAFF_ROLES } from '../../config/constants.js';

export async function pending(req: Request, res: Response): Promise<void> {
  res.render('auth/verify-pending', {
    title: 'Confirm your email',
    layout: 'layouts/auth',
    email: req.currentUser?.email,
  });
}

export async function verify(req: Request, res: Response): Promise<void> {
  try {
    const user = await authService.verifyEmail(req.params.token as string);

    // Sign the user straight in — they have just proved control of the inbox.
    req.session!.userId = user.id;
    req.session!.role = user.role;
    req.session!.fullName = user.fullName;
    req.session!.emailVerified = true;

    req.flash('success', 'Your email is confirmed. Welcome to Waylen.');
    res.redirect(STAFF_ROLES.includes(user.role) ? '/admin' : '/portal');
  } catch (err) {
    res.status(422).render('auth/verify-failed', {
      title: 'Verification failed',
      layout: 'layouts/auth',
      message: (err as Error).message,
    });
  }
}

export async function resend(req: Request, res: Response): Promise<void> {
  const email = typeof req.body?.email === 'string' ? req.body.email : req.currentUser?.email;

  if (email) await authService.resendVerification(email);

  // Same response either way — no account-enumeration signal.
  req.flash('info', 'If that address needs confirming, a new link is on its way.');
  res.redirect('/verify-email/pending');
}
