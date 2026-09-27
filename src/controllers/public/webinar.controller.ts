/**
 * Webinars and events (PRD §4.5).
 */
import type { Request, Response } from 'express';
import { listUpcomingWebinars, listPastWebinarsWithRecordings, findWebinarBySlug, remainingCapacity } from '../../models/webinar.model.js';
import { webinarService } from '../../services/webinar.service.js';
import { webinarRegistrationSchema } from '../../validators/contact.validator.js';
import { NotFoundError, ValidationError } from '../../utils/errors.js';

export async function index(req: Request, res: Response): Promise<void> {
  const [upcoming, recordings] = await Promise.all([
    listUpcomingWebinars(24),
    listPastWebinarsWithRecordings(12),
  ]);

  res.render('public/webinars/index', {
    title: 'Webinars & events',
    metaDescription:
      'Join live sessions on studying abroad, scholarships and visas — or watch a recording of a session you missed.',
    upcoming,
    recordings,
  });
}

export async function show(req: Request, res: Response): Promise<void> {
  const webinar = await findWebinarBySlug(req.params.slug as string);
  if (!webinar) throw new NotFoundError('That webinar could not be found.');

  const seatsLeft = await remainingCapacity(webinar.id);

  res.render('public/webinars/show', {
    title: webinar.title,
    metaDescription: webinar.description?.slice(0, 160),
    webinar,
    seatsLeft,
  });
}

export async function register(req: Request, res: Response): Promise<void> {
  const slug = req.params.slug as string;
  const parsed = webinarRegistrationSchema.safeParse(req.body);

  if (!parsed.success) {
    req.flash('error', 'Please enter your name and a valid email address.');
    res.redirect(`/webinars/${slug}`);
    return;
  }

  try {
    await webinarService.registerGuest(slug, parsed.data);
    req.flash('success', 'You are registered. A confirmation email is on its way.');
  } catch (err) {
    if (err instanceof ValidationError || err instanceof NotFoundError) {
      req.flash('error', err.message);
      res.redirect(`/webinars/${slug}`);
      return;
    }
    throw err;
  }

  res.redirect(`/webinars/${slug}`);
}
