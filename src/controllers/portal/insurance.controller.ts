/**
 * Student insurance (PRD §5.2, §6.1).
 *
 * Sold in-portal at launch, migrating to vetted external partners as
 * agreements are finalised — which is why every purchase writes a Referral.
 */
import type { Request, Response } from 'express';
import { findStudentByUserId } from '../../models/student.model.js';
import { listInsurancePoliciesForStudent } from '../../models/insurance.model.js';
import { insuranceService } from '../../services/insurance.service.js';
import { insuranceQuoteSchema } from '../../validators/insurance.validator.js';
import { INSURANCE_COVERAGE_TYPE_LABELS } from '../../config/constants.js';
import { NotFoundError, ValidationError } from '../../utils/errors.js';

export async function index(req: Request, res: Response): Promise<void> {
  const student = await findStudentByUserId(req.currentUser!.id);
  if (!student) throw new NotFoundError('We could not find your student profile.');

  const policies = await listInsurancePoliciesForStudent(student.id);

  res.render('portal/insurance/index', {
    title: 'Student insurance',
    layout: 'layouts/portal',
    policies,
  });
}

export async function quote(req: Request, res: Response): Promise<void> {
  const requested = Object.keys(req.query).length > 0;
  let computedQuote = null;
  let errors: Record<string, string[] | undefined> = {};

  if (requested) {
    const parsed = insuranceQuoteSchema.safeParse(req.query);
    if (parsed.success) {
      computedQuote = insuranceService.quote(parsed.data);
    } else {
      errors = parsed.error.flatten().fieldErrors;
    }
  }

  res.render('portal/insurance/quote', {
    title: 'Insurance quote',
    layout: 'layouts/portal',
    quote: computedQuote,
    coverageTypeLabels: INSURANCE_COVERAGE_TYPE_LABELS,
    values: req.query,
    errors,
  });
}

export async function purchase(req: Request, res: Response): Promise<void> {
  const student = await findStudentByUserId(req.currentUser!.id);
  if (!student) throw new NotFoundError('We could not find your student profile.');

  const parsed = insuranceQuoteSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError('Please check your cover dates.', parsed.error.flatten().fieldErrors);
  }

  const policy = await insuranceService.purchase({
    ...parsed.data,
    studentProfileId: student.id,
    actorId: req.currentUser!.id,
  });

  req.flash('success', `Your ${policy.planName} policy (${policy.policyNumber}) has been set up.`);
  res.redirect('/portal/insurance');
}
