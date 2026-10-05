/**
 * Student insurance quote/purchase validation (PRD §5.2, §6.1).
 */
import { z } from 'zod';

export const INSURANCE_COVERAGE_TYPES = ['HEALTH', 'TRAVEL', 'COMBINED'] as const;

export const insuranceQuoteSchema = z
  .object({
    coverageType: z.enum(INSURANCE_COVERAGE_TYPES).default('COMBINED'),
    coverageStartsAt: z.coerce.date({ errorMap: () => ({ message: 'Choose a cover start date' }) }),
    coverageEndsAt: z.coerce.date({ errorMap: () => ({ message: 'Choose a cover end date' }) }),
  })
  .refine((data) => data.coverageEndsAt > data.coverageStartsAt, {
    message: 'Cover end date must be after the start date',
    path: ['coverageEndsAt'],
  });

export type InsuranceQuoteInput = z.infer<typeof insuranceQuoteSchema>;
