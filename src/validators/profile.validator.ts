/**
 * Student profile validation (PRD §5.1).
 */
import { z } from 'zod';

/** Checkbox groups post a string for one selection, an array for several. */
const stringArray = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]))
  .pipe(z.array(z.string().trim().min(1)).max(20));

export const profileSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name').max(120),
  phone: z.string().trim().max(32).optional(),
  city: z.string().trim().max(80).optional(),
  preferredStudyLevel: z
    .enum([
      'UNDERGRADUATE',
      'POSTGRADUATE',
      'DOCTORATE',
      'DIPLOMA',
      'CERTIFICATION',
      'VOCATIONAL',
      'LANGUAGE',
      'EXECUTIVE',
    ])
    .optional(),
  preferredCourses: stringArray,
  preferredDestinations: stringArray,
});
