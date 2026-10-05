/**
 * Career Guidance self-assessment (PRD §5.2) — question set + scoring.
 *
 * Phase-2 note: the question set is static/code-defined rather than loaded
 * from a CMS (see career.controller.ts TODO this file replaces). That is a
 * deliberate scope cut for this pass — see the handover notes for why.
 *
 * Deliberately has no Prisma import: this module is pure data + pure
 * functions, so the scoring logic (the part most worth testing precisely) can
 * be unit tested without a database. Persistence lives in
 * `models/career-assessment.model.ts`; orchestration (validate → score →
 * persist → recommend) lives in `career-assessment-recommendation.service.ts`.
 */
import type { OpportunityCategory } from '@prisma/client';

export interface AssessmentOption {
  id: string;
  label: string;
  /** Points this option contributes toward each OpportunityCategory. */
  weights: Partial<Record<OpportunityCategory, number>>;
}

export interface AssessmentQuestion {
  id: string;
  prompt: string;
  options: AssessmentOption[];
}

/** Every OpportunityCategory, in schema declaration order — used to seed a
 * zeroed scoreboard and to break ties deterministically. */
export const ASSESSMENT_CATEGORIES: OpportunityCategory[] = [
  'UNIVERSITY_POSTGRADUATE',
  'LANGUAGE_SCHOOL',
  'CULINARY_SCHOOL',
  'AVIATION_TRAINING',
  'HEALTHCARE_NURSING',
  'HOSPITALITY_TOURISM',
  'BUSINESS_MANAGEMENT',
  'INFORMATION_TECHNOLOGY',
  'PROFESSIONAL_CERTIFICATION',
  'VOCATIONAL_EXECUTIVE',
  'EXCHANGE_SUMMER',
];

/**
 * The assessment (PRD §5.2 — "complete assessments and receive personalised
 * recommendations"). ~12 questions covering interests, work style, preferred
 * learning format and environment; every OpportunityCategory can be reached
 * by more than one question so no track depends on a single answer.
 *
 * Judgment call: this set is a reasonable first pass, not a validated
 * psychometric instrument — see the handover notes for what a human should
 * sanity-check before this ships broadly.
 */
export const CAREER_ASSESSMENT_QUESTIONS: AssessmentQuestion[] = [
  {
    id: 'q1',
    prompt: 'Which of these appeals to you most as a long-term career?',
    options: [
      { id: 'a', label: 'Teaching, research, or leading a specialist project', weights: { UNIVERSITY_POSTGRADUATE: 3 } },
      { id: 'b', label: 'Designing software, or working with data and systems', weights: { INFORMATION_TECHNOLOGY: 3 } },
      { id: 'c', label: 'Caring for patients in a hospital or clinic', weights: { HEALTHCARE_NURSING: 3 } },
      { id: 'd', label: 'Leading a team or growing a business', weights: { BUSINESS_MANAGEMENT: 3 } },
      { id: 'e', label: 'Flying, or working around aircraft', weights: { AVIATION_TRAINING: 3 } },
    ],
  },
  {
    id: 'q2',
    prompt: 'Which work environment would you choose?',
    options: [
      { id: 'a', label: 'A hotel, resort, or travel company', weights: { HOSPITALITY_TOURISM: 3 } },
      { id: 'b', label: 'A commercial kitchen or restaurant', weights: { CULINARY_SCHOOL: 3 } },
      { id: 'c', label: 'An office with structured processes and a clear chain of command', weights: { BUSINESS_MANAGEMENT: 2, PROFESSIONAL_CERTIFICATION: 1 } },
      { id: 'd', label: 'A workshop or hands-on technical site', weights: { VOCATIONAL_EXECUTIVE: 3 } },
      { id: 'e', label: 'Somewhere new every few months', weights: { EXCHANGE_SUMMER: 3 } },
    ],
  },
  {
    id: 'q3',
    prompt: "What's your strongest subject or skill?",
    options: [
      { id: 'a', label: 'Maths and analytical reasoning', weights: { INFORMATION_TECHNOLOGY: 2, BUSINESS_MANAGEMENT: 1 } },
      { id: 'b', label: 'Biology and health sciences', weights: { HEALTHCARE_NURSING: 3 } },
      { id: 'c', label: 'Languages and communication', weights: { LANGUAGE_SCHOOL: 3 } },
      { id: 'd', label: 'Creative or practical skills — cooking, craft, design', weights: { CULINARY_SCHOOL: 2, VOCATIONAL_EXECUTIVE: 1 } },
      { id: 'e', label: 'Research and academic writing', weights: { UNIVERSITY_POSTGRADUATE: 3 } },
    ],
  },
  {
    id: 'q4',
    prompt: 'How do you prefer to learn?',
    options: [
      { id: 'a', label: 'Deep, theory-first study over several years', weights: { UNIVERSITY_POSTGRADUATE: 2 } },
      { id: 'b', label: 'Short, intensive, practical courses', weights: { PROFESSIONAL_CERTIFICATION: 3 } },
      { id: 'c', label: 'On-the-job, apprenticeship-style training', weights: { VOCATIONAL_EXECUTIVE: 2, AVIATION_TRAINING: 1 } },
      { id: 'd', label: 'Immersion — living the language and culture', weights: { LANGUAGE_SCHOOL: 3 } },
    ],
  },
  {
    id: 'q5',
    prompt: 'What first attracted you to studying abroad?',
    options: [
      { id: 'a', label: "A specific qualification my home country doesn't offer well", weights: { UNIVERSITY_POSTGRADUATE: 2, PROFESSIONAL_CERTIFICATION: 1 } },
      { id: 'b', label: 'Experiencing another culture and improving a language', weights: { LANGUAGE_SCHOOL: 2, EXCHANGE_SUMMER: 2 } },
      { id: 'c', label: 'A faster route into a well-paid, in-demand career', weights: { HEALTHCARE_NURSING: 1, INFORMATION_TECHNOLOGY: 1, AVIATION_TRAINING: 1 } },
      { id: 'd', label: 'Building toward owning or running something of my own', weights: { BUSINESS_MANAGEMENT: 2, CULINARY_SCHOOL: 1 } },
    ],
  },
  {
    id: 'q6',
    prompt: "Pick the task you'd enjoy most this week.",
    options: [
      { id: 'a', label: 'Debugging code or building a small app', weights: { INFORMATION_TECHNOLOGY: 3 } },
      { id: 'b', label: "Practicing a recipe until it's perfect", weights: { CULINARY_SCHOOL: 3 } },
      { id: 'c', label: 'Helping someone through a difficult health issue', weights: { HEALTHCARE_NURSING: 3 } },
      { id: 'd', label: 'Planning an itinerary or event for a group of guests', weights: { HOSPITALITY_TOURISM: 3 } },
      { id: 'e', label: 'Studying flight manuals or aircraft systems', weights: { AVIATION_TRAINING: 3 } },
    ],
  },
  {
    id: 'q7',
    prompt: "How important is earning a professional licence or certification (e.g. nursing registration, pilot's licence, IT certification)?",
    options: [
      { id: 'a', label: "Essential — it's the whole point", weights: { PROFESSIONAL_CERTIFICATION: 2, HEALTHCARE_NURSING: 1, AVIATION_TRAINING: 1 } },
      { id: 'b', label: 'Nice to have, but not the main goal', weights: { BUSINESS_MANAGEMENT: 1 } },
      { id: 'c', label: 'Not really a factor for me', weights: { UNIVERSITY_POSTGRADUATE: 1, EXCHANGE_SUMMER: 1 } },
    ],
  },
  {
    id: 'q8',
    prompt: 'What timeframe feels right for your next step?',
    options: [
      { id: 'a', label: 'A few weeks to a few months', weights: { EXCHANGE_SUMMER: 3 } },
      { id: 'b', label: '6–18 months, practical and fast-moving', weights: { PROFESSIONAL_CERTIFICATION: 2, VOCATIONAL_EXECUTIVE: 1 } },
      { id: 'c', label: '1–2 years of focused training', weights: { CULINARY_SCHOOL: 1, AVIATION_TRAINING: 1, HOSPITALITY_TOURISM: 1 } },
      { id: 'd', label: '2+ years, building a long academic qualification', weights: { UNIVERSITY_POSTGRADUATE: 3 } },
    ],
  },
  {
    id: 'q9',
    prompt: 'Which best describes your ideal role on a team?',
    options: [
      { id: 'a', label: 'The person others come to for expert technical answers', weights: { INFORMATION_TECHNOLOGY: 2, HEALTHCARE_NURSING: 1 } },
      { id: 'b', label: 'The person organising, leading, deciding', weights: { BUSINESS_MANAGEMENT: 3 } },
      { id: 'c', label: 'The person making sure guests or customers leave happy', weights: { HOSPITALITY_TOURISM: 2, CULINARY_SCHOOL: 1 } },
      { id: 'd', label: 'The person others trust with something high-stakes — safety, health', weights: { AVIATION_TRAINING: 2, HEALTHCARE_NURSING: 2 } },
    ],
  },
  {
    id: 'q10',
    prompt: 'Which statement is most true for you right now?',
    options: [
      { id: 'a', label: 'I want a qualification recognised across many countries', weights: { PROFESSIONAL_CERTIFICATION: 2, UNIVERSITY_POSTGRADUATE: 1 } },
      { id: 'b', label: 'I want to improve my English or another language first', weights: { LANGUAGE_SCHOOL: 3 } },
      { id: 'c', label: "I'd rather train directly in the trade I'll work in", weights: { VOCATIONAL_EXECUTIVE: 3 } },
      { id: 'd', label: 'I want to try living abroad before committing long-term', weights: { EXCHANGE_SUMMER: 2, LANGUAGE_SCHOOL: 1 } },
    ],
  },
  {
    id: 'q11',
    prompt: 'Which of these matters most in a future job?',
    options: [
      { id: 'a', label: 'Stability and a clear career ladder', weights: { BUSINESS_MANAGEMENT: 1, PROFESSIONAL_CERTIFICATION: 1 } },
      { id: 'b', label: 'Variety and travel', weights: { HOSPITALITY_TOURISM: 2, AVIATION_TRAINING: 1 } },
      { id: 'c', label: 'Helping or caring for people directly', weights: { HEALTHCARE_NURSING: 3 } },
      { id: 'd', label: 'Working with the latest technology', weights: { INFORMATION_TECHNOLOGY: 3 } },
    ],
  },
  {
    id: 'q12',
    prompt: 'If money and time were no object, which short course would you take this year?',
    options: [
      { id: 'a', label: 'An advanced culinary techniques course', weights: { CULINARY_SCHOOL: 3 } },
      { id: 'b', label: 'A private pilot ground-school course', weights: { AVIATION_TRAINING: 3 } },
      { id: 'c', label: 'An intensive language-immersion programme', weights: { LANGUAGE_SCHOOL: 3 } },
      { id: 'd', label: 'A postgraduate research methods course', weights: { UNIVERSITY_POSTGRADUATE: 3 } },
      { id: 'e', label: 'A vocational trade certification', weights: { VOCATIONAL_EXECUTIVE: 3 } },
    ],
  },
];

const QUESTIONS_BY_ID = new Map(CAREER_ASSESSMENT_QUESTIONS.map((q) => [q.id, q]));

/** `{ [questionId]: optionId }`, as submitted by the assessment form. */
export type AssessmentAnswers = Record<string, string>;

export interface AssessmentScore {
  scores: Record<OpportunityCategory, number>;
  recommendedCategory: OpportunityCategory;
  secondaryCategory: OpportunityCategory | null;
}

/**
 * Scores a completed assessment. Unknown questions/options are ignored
 * defensively (the validator should already have rejected them) rather than
 * thrown — this function is meant to be safe to call with any string map.
 *
 * Ties are broken by `ASSESSMENT_CATEGORIES` order, so results are
 * deterministic and reproducible for the same answers.
 */
export function scoreAssessment(answers: AssessmentAnswers): AssessmentScore {
  const scores = Object.fromEntries(
    ASSESSMENT_CATEGORIES.map((category) => [category, 0]),
  ) as Record<OpportunityCategory, number>;

  for (const question of CAREER_ASSESSMENT_QUESTIONS) {
    const chosenOptionId = answers[question.id];
    if (!chosenOptionId) continue;

    const option = question.options.find((o) => o.id === chosenOptionId);
    if (!option) continue;

    for (const [category, weight] of Object.entries(option.weights) as [OpportunityCategory, number][]) {
      scores[category] += weight;
    }
  }

  const ranked = ASSESSMENT_CATEGORIES.slice().sort((a, b) => scores[b] - scores[a]);
  // ASSESSMENT_CATEGORIES is a fixed, non-empty list, so `ranked[0]` always exists.
  const recommendedCategory = ranked[0] as OpportunityCategory;
  const secondaryCandidate = ranked.find((c) => c !== recommendedCategory && scores[c] > 0) ?? null;

  return { scores, recommendedCategory, secondaryCategory: secondaryCandidate };
}

/** True when every question has a recognised answer — used by the validator. */
export function isCompleteAnswerSet(answers: AssessmentAnswers): boolean {
  return CAREER_ASSESSMENT_QUESTIONS.every((q) => {
    const chosen = answers[q.id];
    return typeof chosen === 'string' && q.options.some((o) => o.id === chosen);
  });
}

export function findQuestion(id: string): AssessmentQuestion | undefined {
  return QUESTIONS_BY_ID.get(id);
}
