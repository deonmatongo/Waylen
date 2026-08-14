/**
 * Student insurance (PRD §5.2, §6.1).
 *
 * Sold in-portal at launch, migrating to vetted external partners as
 * agreements are finalised — which is why every purchase writes a Referral.
 */
import type { Request, Response } from 'express';
import { findStudentByUserId } from '../../models/student.model.js';
import { NotFoundError } from '../../utils/errors.js';

export async function index(req: Request, res: Response): Promise<void> {
  const student = await findStudentByUserId(req.currentUser!.id);
  if (!student) throw new NotFoundError('We could not find your student profile.');

  res.render('portal/insurance/index', {
    title: 'Student insurance',
    layout: 'layouts/portal',
    policies: [],
  });
}

export async function quote(req: Request, res: Response): Promise<void> {
  // TODO(phase-2): call the insurance partner's quote API. Until a partner is
  // contracted, quotes are prepared manually by staff.
  res.render('portal/insurance/quote', {
    title: 'Insurance quote',
    layout: 'layouts/portal',
    quote: null,
  });
}

export async function purchase(req: Request, res: Response): Promise<void> {
  // TODO(phase-2): take payment, store the policy, write the partner Referral
  // (PRD §6.2) and file the certificate in the Document Centre.
  req.flash('info', 'Insurance purchase is not switched on yet — a counsellor will arrange your cover.');
  res.redirect('/portal/insurance');
}
