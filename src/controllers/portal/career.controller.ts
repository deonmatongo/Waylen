/**
 * Career Guidance (PRD §5.2) — paid one-on-one sessions, assessments and
 * personalised recommendations. Phase 2.
 */
import type { Request, Response } from 'express';
import { APPOINTMENT_TYPE_LABELS } from '../../config/constants.js';

export async function index(req: Request, res: Response): Promise<void> {
  res.render('portal/career-guidance/index', {
    title: 'Career guidance',
    layout: 'layouts/portal',
    typeLabels: APPOINTMENT_TYPE_LABELS,
  });
}

export async function assessment(req: Request, res: Response): Promise<void> {
  // TODO(phase-2): load the assessment question set from the CMS so staff can
  // revise it without a deploy.
  res.render('portal/career-guidance/assessment', {
    title: 'Career assessment',
    layout: 'layouts/portal',
    questions: [],
  });
}

export async function submitAssessment(req: Request, res: Response): Promise<void> {
  // TODO(phase-2): score the assessment and generate the recommendations the
  // PRD describes in §5.2.
  req.flash('info', 'Career assessments are coming soon.');
  res.redirect('/portal/career-guidance');
}
