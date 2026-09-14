/**
 * Refer a friend (new — client navigation feedback). A shareable signup link
 * only; reward/status tracking is a later phase (the existing `Referral`
 * model is for partner/commission referrals and is unrelated).
 */
import type { Request, Response } from 'express';
import { env } from '../../config/env.js';
import { findStudentByUserId } from '../../models/student.model.js';
import { NotFoundError } from '../../utils/errors.js';

export async function show(req: Request, res: Response): Promise<void> {
  const student = await findStudentByUserId(req.currentUser!.id);
  if (!student) throw new NotFoundError('We could not find your student profile.');

  res.render('portal/refer', {
    title: 'Refer a friend',
    layout: 'layouts/portal',
    referralLink: `${env.APP_URL}/register?ref=${student.reference}`,
  });
}
