/**
 * Career Guidance (PRD §5.2) — paid one-on-one sessions, assessments and
 * personalised recommendations.
 */
import type { Request, Response } from 'express';
import { APPOINTMENT_TYPE_LABELS, OPPORTUNITY_CATEGORY_LABELS } from '../../config/constants.js';
import { findStudentByUserId } from '../../models/student.model.js';
import {
  createAssessmentResult,
  findAssessmentResultById,
  findLatestAssessmentResult,
} from '../../models/career-assessment.model.js';
import { listPublishedOpportunities } from '../../models/content.model.js';
import { CAREER_ASSESSMENT_QUESTIONS, scoreAssessment } from '../../services/career-assessment.service.js';
import { careerAssessmentAnswersSchema } from '../../validators/career-assessment.validator.js';
import { NotFoundError, ValidationError } from '../../utils/errors.js';

export async function index(req: Request, res: Response): Promise<void> {
  const student = await findStudentByUserId(req.currentUser!.id);
  if (!student) throw new NotFoundError('We could not find your student profile.');

  const latestResult = await findLatestAssessmentResult(student.id);

  res.render('portal/career-guidance/index', {
    title: 'Career guidance',
    layout: 'layouts/portal',
    typeLabels: APPOINTMENT_TYPE_LABELS,
    categoryLabels: OPPORTUNITY_CATEGORY_LABELS,
    latestResult,
  });
}

export async function assessment(req: Request, res: Response): Promise<void> {
  res.render('portal/career-guidance/assessment', {
    title: 'Career assessment',
    layout: 'layouts/portal',
    questions: CAREER_ASSESSMENT_QUESTIONS,
  });
}

/**
 * Scores the submitted assessment, persists the result (PRD §5.2) and sends
 * the student straight to their personalised recommendations.
 */
export async function submitAssessment(req: Request, res: Response): Promise<void> {
  const student = await findStudentByUserId(req.currentUser!.id);
  if (!student) throw new NotFoundError('We could not find your student profile.');

  const parsed = careerAssessmentAnswersSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError(
      'Please answer every question before submitting.',
      parsed.error.flatten().fieldErrors,
    );
  }

  const { scores, recommendedCategory, secondaryCategory } = scoreAssessment(parsed.data);

  const result = await createAssessmentResult({
    studentProfileId: student.id,
    answers: parsed.data,
    scores,
    recommendedCategory,
    secondaryCategory,
  });

  req.flash('success', 'Your assessment is complete — here are your recommendations.');
  res.redirect(`/portal/career-guidance/results/${result.id}`);
}

export async function results(req: Request, res: Response): Promise<void> {
  const student = await findStudentByUserId(req.currentUser!.id);
  if (!student) throw new NotFoundError('We could not find your student profile.');

  const result = await findAssessmentResultById(req.params.id as string, student.id);
  if (!result) throw new NotFoundError('We could not find that assessment result.');

  // Prefer opportunities in a country the student has already expressed
  // interest in, but never hide the category's other options if none match.
  const preferredSlugs = new Set((student.preferredDestinations ?? []).map((c) => c.slug));
  const matches = await listPublishedOpportunities({
    category: result.recommendedCategory,
    perPage: 12,
  });
  const recommendedOpportunities = matches.items
    .slice()
    .sort((a, b) => Number(preferredSlugs.has(b.country.slug)) - Number(preferredSlugs.has(a.country.slug)))
    .slice(0, 4);

  res.render('portal/career-guidance/results', {
    title: 'Your career assessment results',
    layout: 'layouts/portal',
    result,
    categoryLabels: OPPORTUNITY_CATEGORY_LABELS,
    recommendedOpportunities,
  });
}
