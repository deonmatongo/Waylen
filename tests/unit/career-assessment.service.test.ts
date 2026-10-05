import { describe, it, expect } from 'vitest';
import {
  CAREER_ASSESSMENT_QUESTIONS,
  ASSESSMENT_CATEGORIES,
  scoreAssessment,
  isCompleteAnswerSet,
  findQuestion,
  type AssessmentAnswers,
} from '../../src/services/career-assessment.service.js';
import { careerAssessmentAnswersSchema } from '../../src/validators/career-assessment.validator.js';

/** Picks the Nth option (wrapping) of every question, by index. */
function answersFromOptionIndex(index: number): AssessmentAnswers {
  return Object.fromEntries(
    CAREER_ASSESSMENT_QUESTIONS.map((q) => [q.id, q.options[index % q.options.length]!.id]),
  );
}

describe('CAREER_ASSESSMENT_QUESTIONS', () => {
  it('has a sensible number of questions, each with at least two options', () => {
    expect(CAREER_ASSESSMENT_QUESTIONS.length).toBeGreaterThanOrEqual(8);
    expect(CAREER_ASSESSMENT_QUESTIONS.length).toBeLessThanOrEqual(15);
    for (const question of CAREER_ASSESSMENT_QUESTIONS) {
      expect(question.options.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('gives every OpportunityCategory at least one way to score points', () => {
    const reachable = new Set<string>();
    for (const question of CAREER_ASSESSMENT_QUESTIONS) {
      for (const option of question.options) {
        for (const category of Object.keys(option.weights)) reachable.add(category);
      }
    }
    for (const category of ASSESSMENT_CATEGORIES) {
      expect(reachable.has(category)).toBe(true);
    }
  });

  it('has unique question ids and unique option ids within each question', () => {
    const ids = CAREER_ASSESSMENT_QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const question of CAREER_ASSESSMENT_QUESTIONS) {
      const optionIds = question.options.map((o) => o.id);
      expect(new Set(optionIds).size).toBe(optionIds.length);
    }
  });
});

describe('findQuestion', () => {
  it('finds a known question and returns undefined for an unknown one', () => {
    expect(findQuestion('q1')?.id).toBe('q1');
    expect(findQuestion('does-not-exist')).toBeUndefined();
  });
});

describe('scoreAssessment', () => {
  it('sums weights per category across all answered questions', () => {
    const answers = answersFromOptionIndex(0); // the "a" option on every question
    const { scores, recommendedCategory, secondaryCategory } = scoreAssessment(answers);

    expect(scores.UNIVERSITY_POSTGRADUATE).toBe(8);
    expect(scores.INFORMATION_TECHNOLOGY).toBe(7);
    expect(recommendedCategory).toBe('UNIVERSITY_POSTGRADUATE');
    expect(secondaryCategory).toBe('INFORMATION_TECHNOLOGY');
  });

  it('is deterministic — the same answers always produce the same result', () => {
    const answers = answersFromOptionIndex(2);
    const first = scoreAssessment(answers);
    const second = scoreAssessment(answers);
    expect(second).toEqual(first);
  });

  it('breaks ties using ASSESSMENT_CATEGORIES order, and reports no secondary when nothing else scored', () => {
    const { scores, recommendedCategory, secondaryCategory } = scoreAssessment({});

    for (const category of ASSESSMENT_CATEGORIES) {
      expect(scores[category]).toBe(0);
    }
    expect(recommendedCategory).toBe(ASSESSMENT_CATEGORIES[0]);
    expect(secondaryCategory).toBeNull();
  });

  it('ignores unknown questions and unknown options defensively', () => {
    const withGarbage: AssessmentAnswers = {
      ...answersFromOptionIndex(0),
      'not-a-real-question': 'a',
      q1: 'not-a-real-option',
    };
    const clean = answersFromOptionIndex(0);
    delete (clean as Record<string, string>).q1;

    expect(scoreAssessment(withGarbage)).toEqual(scoreAssessment(clean));
  });
});

describe('isCompleteAnswerSet', () => {
  it('is true once every question has a recognised answer', () => {
    expect(isCompleteAnswerSet(answersFromOptionIndex(0))).toBe(true);
  });

  it('is false when a question is missing', () => {
    const answers = answersFromOptionIndex(0);
    delete (answers as Record<string, string>)[CAREER_ASSESSMENT_QUESTIONS[0]!.id];
    expect(isCompleteAnswerSet(answers)).toBe(false);
  });

  it('is false when an answer references an option that does not belong to that question', () => {
    const answers = answersFromOptionIndex(0);
    answers[CAREER_ASSESSMENT_QUESTIONS[0]!.id] = 'bogus-option';
    expect(isCompleteAnswerSet(answers)).toBe(false);
  });
});

describe('careerAssessmentAnswersSchema', () => {
  it('accepts one valid option per question', () => {
    const result = careerAssessmentAnswersSchema.safeParse(answersFromOptionIndex(1));
    expect(result.success).toBe(true);
  });

  it('rejects a submission missing a question', () => {
    const answers = answersFromOptionIndex(1);
    delete (answers as Record<string, string>)[CAREER_ASSESSMENT_QUESTIONS[0]!.id];
    expect(careerAssessmentAnswersSchema.safeParse(answers).success).toBe(false);
  });

  it('rejects an option id that is not one of that question\'s choices', () => {
    const answers = answersFromOptionIndex(1);
    answers[CAREER_ASSESSMENT_QUESTIONS[0]!.id] = 'z';
    expect(careerAssessmentAnswersSchema.safeParse(answers).success).toBe(false);
  });
});
