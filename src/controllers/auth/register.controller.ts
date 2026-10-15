/**
 * Student registration (PRD §5.1).
 */
import type { Request, Response } from 'express';
import { authService } from '../../services/auth.service.js';
import { registerSchema } from '../../validators/auth.validator.js';
import { listPublishedCountries, listAllCountries } from '../../models/content.model.js';
import { ValidationError } from '../../utils/errors.js';
import { logger } from '../../config/logger.js';

export async function show(_req: Request, res: Response): Promise<void> {
  const [originCountries, destinationCountries] = await Promise.all([
    listAllCountries(),
    listPublishedCountries(),
  ]);

  res.render('auth/register', {
    title: 'Create your account',
    layout: 'layouts/auth',
    originCountries,
    destinationCountries,
    values: {},
    errors: {},
  });
}

export async function submit(req: Request, res: Response): Promise<void> {
  const parsed = registerSchema.safeParse(req.body);

  if (!parsed.success) {
    // Re-render with the submitted values so nothing has to be retyped.
    const [originCountries, destinationCountries] = await Promise.all([
      listAllCountries(),
      listPublishedCountries(),
    ]);
    res.status(422).render('auth/register', {
      title: 'Create your account',
      layout: 'layouts/auth',
      originCountries,
      destinationCountries,
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

    // Identical response whether the address was new or already registered
    // (the owner of an existing one gets an email instead) — no enumeration.
    req.flash(
      'success',
      'Your account has been created. Please check your email for a confirmation link.',
    );
    res.redirect('/verify-email/pending');
  } catch (err) {
    // Only validation-type failures are the user's to fix; anything else is
    // unexpected and must not be dressed up as a form error.
    if (!(err instanceof ValidationError)) {
      logger.error({ err }, 'Registration failed');
      throw err;
    }
    const [originCountries, destinationCountries] = await Promise.all([
      listAllCountries(),
      listPublishedCountries(),
    ]);
    res.status(422).render('auth/register', {
      title: 'Create your account',
      layout: 'layouts/auth',
      originCountries,
      destinationCountries,
      values: req.body,
      errors: { email: [(err as Error).message] },
    });
  }
}
