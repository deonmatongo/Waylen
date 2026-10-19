/**
 * Webinar access for registered students (PRD §5.2).
 */
import type { Request, Response } from 'express';
import { countUpcomingWebinars, listUpcomingWebinars, listPastWebinarsWithRecordings } from '../../models/webinar.model.js';
import { findStudentByUserId } from '../../models/student.model.js';
import { webinarService } from '../../services/webinar.service.js';
import { NotFoundError, ValidationError } from '../../utils/errors.js';
import { buildPageMeta, parsePage } from '../../utils/pagination.js';

export async function index(req: Request, res: Response): Promise<void> {
  const student = await findStudentByUserId(req.currentUser!.id);
  if (!student) throw new NotFoundError('We could not find your student profile.');

  // Upcoming sessions are paged; the recordings shelf stays a "most recent" list.
  const pageReq = parsePage(req.query, { perPage: 12 });
  const [upcoming, upcomingTotal, recordings] = await Promise.all([
    listUpcomingWebinars(pageReq.take, pageReq.skip),
    countUpcomingWebinars(),
    listPastWebinarsWithRecordings(12),
  ]);

  res.render('portal/webinars/index', {
    title: 'Webinars',
    layout: 'layouts/portal',
    upcoming,
    recordings,
    pageMeta: buildPageMeta(pageReq, upcomingTotal),
  });
}

export async function register(req: Request, res: Response): Promise<void> {
  const student = await findStudentByUserId(req.currentUser!.id);
  if (!student) throw new NotFoundError('We could not find your student profile.');

  try {
    await webinarService.registerStudent(req.params.id as string, {
      studentProfileId: student.id,
      userId: req.currentUser!.id,
    });
    req.flash('success', 'You are registered for that webinar.');
  } catch (err) {
    if (err instanceof ValidationError || err instanceof NotFoundError) {
      req.flash('error', err.message);
      res.redirect('/portal/webinars');
      return;
    }
    throw err;
  }

  res.redirect('/portal/webinars');
}
