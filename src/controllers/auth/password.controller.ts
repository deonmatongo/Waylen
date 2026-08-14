/**
 * Password reset (PRD §5.1).
 */
import type { Request, Response } from 'express';
import { authService } from '../../services/auth.service.js';
import { forgotPasswordSchema, resetPasswordSchema } from '../../validators/auth.validator.js';

export async function showForgot(req: Request, res: Response): Promise<void> {
  res.render('auth/forgot-password', {
    title: 'Reset your password',
    layout: 'layouts/auth',
    values: {},
    errors: {},
  });
}

export async function submitForgot(req: Request, res: Response): Promise<void> {
  const parsed = forgotPasswordSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(422).render('auth/forgot-password', {
      title: 'Reset your password',
      layout: 'layouts/auth',
      values: req.body,
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  await authService.requestPasswordReset(parsed.data.email);

  // Always the same confirmation, whether or not the account exists.
  res.render('auth/forgot-password-sent', {
    title: 'Check your email',
    layout: 'layouts/auth',
    email: parsed.data.email,
  });
}

export async function showReset(req: Request, res: Response): Promise<void> {
  res.render('auth/reset-password', {
    title: 'Choose a new password',
    layout: 'layouts/auth',
    token: req.params.token,
    errors: {},
  });
}

export async function submitReset(req: Request, res: Response): Promise<void> {
  const parsed = resetPasswordSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(422).render('auth/reset-password', {
      title: 'Choose a new password',
      layout: 'layouts/auth',
      token: req.params.token,
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    await authService.resetPassword(req.params.token as string, parsed.data.password);
    req.flash('success', 'Your password has been changed. Please sign in.');
    res.redirect('/login');
  } catch (err) {
    res.status(422).render('auth/reset-password', {
      title: 'Choose a new password',
      layout: 'layouts/auth',
      token: req.params.token,
      errors: { form: [(err as Error).message] },
    });
  }
}
