/**
 * Webinars and events (PRD §4.5).
 */
import type { Request, Response } from 'express';
import { listUpcomingWebinars, listPastWebinarsWithRecordings, findWebinarBySlug, remainingCapacity } from '../../models/webinar.model.js';
import { NotFoundError } from '../../utils/errors.js';

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
  // TODO(phase-1): persist the registration and send the confirmation +
  // reminder emails described in PRD §4.5 via webinarService.
  req.flash('success', 'You are registered. A confirmation email is on its way.');
  res.redirect(`/webinars/${req.params.slug}`);
}
