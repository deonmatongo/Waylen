/**
 * Career assessment submission validation (PRD §5.2).
 *
 * Built from the live question set rather than duplicating question/option
 * ids here, so the two can never drift out of sync.
 */
import { z } from 'zod';
import { CAREER_ASSESSMENT_QUESTIONS } from '../services/career-assessment.service.js';

const shape = Object.fromEntries(
  CAREER_ASSESSMENT_QUESTIONS.map((question) => {
    const optionIds = question.options.map((o) => o.id) as [string, ...string[]];
    return [question.id, z.enum(optionIds, { errorMap: () => ({ message: 'Please answer every question' }) })];
  }),
);

export const careerAssessmentAnswersSchema = z.object(shape);

export type CareerAssessmentAnswersInput = z.infer<typeof careerAssessmentAnswersSchema>;
