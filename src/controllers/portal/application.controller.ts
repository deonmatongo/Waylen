/**
 * My Applications and the Progress Tracker (PRD §5.2, §5.3).
 */
import type { Request, Response } from 'express';
import { applicationService } from '../../services/application.service.js';
import { findStudentByUserId } from '../../models/student.model.js';
import { APPLICATION_STAGE_LABELS } from '../../config/constants.js';
import { NotFoundError } from '../../utils/errors.js';

export async function index(req: Request, res: Response): Promise<void> {
  const student = await findStudentByUserId(req.currentUser!.id);
  if (!student) throw new NotFoundError('We could not find your student profile.');

  const applications = await applicationService.listForStudent(student.id);

  res.render('portal/applications/index', {
    title: 'My applications',
    layout: 'layouts/portal',
    applications,
    stageLabels: APPLICATION_STAGE_LABELS,
  });
}

export async function show(req: Request, res: Response): Promise<void> {
  const student = await findStudentByUserId(req.currentUser!.id);
  if (!student) throw new NotFoundError('We could not find your student profile.');

  // Scoped by student id, so one student cannot read another's application.
  const application = await applicationService.findForStudent(req.params.id as string, student.id);
  const progress = await applicationService.buildProgress(application.id);

  res.render('portal/applications/show', {
    title: application.programmeName ?? application.reference,
    layout: 'layouts/portal',
    application,
    progress,
    stageLabels: APPLICATION_STAGE_LABELS,
  });
}
