/**
 * Appointment booking validation (PRD §5.2).
 */
import { z } from 'zod';

export const appointmentSchema = z.object({
  type: z.enum([
    'INITIAL_CONSULTATION',
    'CAREER_GUIDANCE',
    'APPLICATION_REVIEW',
    'VISA_CONSULTATION',
  ]),
  startsAt: z.coerce.date({ errorMap: () => ({ message: 'Choose a date and time' }) }),
  format: z.enum(['ONLINE', 'IN_PERSON']).default('ONLINE'),
  notes: z.string().trim().max(2000).optional(),
});
