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

const futureDate = (message: string) =>
  z.date({ errorMap: () => ({ message }) }).refine((date) => date.getTime() > Date.now(), {
    message: 'Please choose a time in the future.',
  });

/** Student reschedule: the slot value comes from the picker, so it is an ISO instant. */
export const studentRescheduleSchema = z.object({
  startsAt: z.coerce.date({ errorMap: () => ({ message: 'Choose a new time' }) }),
});

/**
 * Admin reschedule. The browser posts an offset-less `datetime-local` value,
 * which is read as wall time in the business timezone (`timeZone`), not the
 * server's. An invalid value fails validation rather than becoming an Invalid
 * Date downstream.
 */
export function adminRescheduleSchema(parse: (value: string) => Date) {
  return z.object({
    startsAt: z
      .string({ required_error: 'Choose a date and time', invalid_type_error: 'Choose a date and time' })
      .trim()
      .min(1, 'Choose a date and time')
      .transform((value) => parse(value))
      .pipe(futureDate('Choose a valid date and time')),
  });
}

/** Admin confirm: an optional counsellor, which the service checks is an active COUNSELLOR. */
export const adminConfirmSchema = z.object({
  counsellorId: z
    .string()
    .trim()
    .max(64)
    .optional()
    .transform((value) => value || undefined),
});
