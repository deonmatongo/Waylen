/**
 * Staff self-service password change. Students have their own form under
 * /portal/settings; staff had no way to rotate a password short of the
 * forgot-password flow.
 */
import type { Request, Response } from 'express';
import { authService } from '../../services/auth.service.js';
import { sessionService } from '../../services/session.service.js';
import { changePasswordSchema } from '../../validators/auth.validator.js';
import { ValidationError } from '../../utils/errors.js';

function renderForm(res: Response, errors: Record<string, string[] | undefined>, status = 200): void {
  res.status(status).render('auth/change-password', {
    title: 'Change password',
    layout: 'layouts/admin',
    errors,
  });
}

export async function showChangePassword(_req: Request, res: Response): Promise<void> {
  renderForm(res, {});
}

export async function submitChangePassword(req: Request, res: Response): Promise<void> {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    renderForm(res, parsed.error.flatten().fieldErrors, 422);
    return;
  }

  try {
    await authService.changePassword(
      req.currentUser!.id,
      parsed.data.currentPassword,
      parsed.data.password,
    );
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    renderForm(res, { currentPassword: [err.message] }, 422);
    return;
  }

  // changePassword signs the user out everywhere, this browser included —
  // clear the cookie and send them to sign in with the new password.
  const sessionId = req.session?.sessionId;
  if (sessionId) await sessionService.revoke(sessionId);
  // A fresh, empty session carries only the flash message to the login page.
  req.session = {};
  req.flash('success', 'Your password has been changed. Please sign in again.');
  res.redirect('/login');
}
