/**
 * Webinar access for registered students (PRD §5.2).
 */
import type { Request, Response } from 'express';
import { listUpcomingWebinars, listPastWebinarsWithRecordings } from '../../models/webinar.model.js';
import { findStudentByUserId } from '../../models/student.model.js';
import { webinarService } from '../../services/webinar.service.js';
import { NotFoundError, ValidationError } from '../../utils/errors.js';

export async function index(req: Request, res: Response): Promise<void> {
  const student = await findStudentByUserId(req.currentUser!.id);
  if (!student) throw new NotFoundError('We could not find your student profile.');

  const [upcoming, recordings] = await Promise.all([
    listUpcomingWebinars(24),
    listPastWebinarsWithRecordings(24),
  ]);

  res.render('portal/webinars/index', {
    title: 'Webinars',
    layout: 'layouts/portal',
    upcoming,
    recordings,
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
