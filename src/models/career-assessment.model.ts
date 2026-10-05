/**
 * Career assessment result queries (PRD §5.2).
 */
import type { OpportunityCategory } from '@prisma/client';
import { prisma } from '../config/database.js';

export async function createAssessmentResult(input: {
  studentProfileId: string;
  answers: Record<string, string>;
  scores: Record<OpportunityCategory, number>;
  recommendedCategory: OpportunityCategory;
  secondaryCategory: OpportunityCategory | null;
}) {
  return prisma.careerAssessmentResult.create({
    data: {
      studentProfileId: input.studentProfileId,
      answers: input.answers,
      scores: input.scores,
      recommendedCategory: input.recommendedCategory,
      secondaryCategory: input.secondaryCategory ?? undefined,
    },
  });
}

/** Most recent assessment for a student, or null if they haven't taken one. */
export async function findLatestAssessmentResult(studentProfileId: string) {
  return prisma.careerAssessmentResult.findFirst({
    where: { studentProfileId },
    orderBy: { createdAt: 'desc' },
  });
}

/** Scoped to `studentProfileId` so a student can never load another's result. */
export async function findAssessmentResultById(id: string, studentProfileId: string) {
  return prisma.careerAssessmentResult.findFirst({
    where: { id, studentProfileId },
  });
}
