/**
 * Student registration (PRD §5.1).
 */
import type { Request, Response } from 'express';
import { authService } from '../../services/auth.service.js';
import { registerSchema } from '../../validators/auth.validator.js';
import { listPublishedCountries } from '../../models/content.model.js';
import { ValidationError } from '../../utils/errors.js';

export async function show(_req: Request, res: Response): Promise<void> {
  const countries = await listPublishedCountries();

  res.render('auth/register', {
    title: 'Create your account',
    layout: 'layouts/auth',
    countries,
    values: {},
    errors: {},
  });
}

export async function submit(req: Request, res: Response): Promise<void> {
  const parsed = registerSchema.safeParse(req.body);

  if (!parsed.success) {
    // Re-render with the submitted values so nothing has to be retyped.
    const countries = await listPublishedCountries();
    res.status(422).render('auth/register', {
      title: 'Create your account',
      layout: 'layouts/auth',
      countries,
      values: req.body,
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    await authService.register({
      fullName: parsed.data.fullName,
      email: parsed.data.email,
      password: parsed.data.password,
      countryOfOriginIso: parsed.data.countryOfOrigin,
      preferredStudyLevel: parsed.data.preferredStudyLevel,
      preferredCourses: parsed.data.preferredCourses,
      preferredDestinationSlugs: parsed.data.preferredDestinations,
    });

    req.flash(
      'success',
      'Your account has been created. Please check your email for a confirmation link.',
    );
    res.redirect('/verify-email/pending');
  } catch (err) {
    // A duplicate email is expected user error, not a failure worth a 500 page.
    const countries = await listPublishedCountries();
    res.status(err instanceof ValidationError ? 422 : 409).render('auth/register', {
      title: 'Create your account',
      layout: 'layouts/auth',
      countries,
      values: req.body,
      errors: { email: [(err as Error).message] },
    });
  }
}
