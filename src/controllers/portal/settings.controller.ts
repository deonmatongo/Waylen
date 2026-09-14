/**
 * Account settings — password change and account info, split out of the
 * profile page per the client's navigation feedback (Profile is personal
 * details; Settings is the account/security area).
 */
import type { Request, Response } from 'express';
import { findStudentByUserId } from '../../models/student.model.js';
import { NotFoundError } from '../../utils/errors.js';

export async function show(req: Request, res: Response): Promise<void> {
  const student = await findStudentByUserId(req.currentUser!.id);
  if (!student) throw new NotFoundError('We could not find your student profile.');

  res.render('portal/settings', {
    title: 'Settings',
    layout: 'layouts/portal',
    student,
  });
}
