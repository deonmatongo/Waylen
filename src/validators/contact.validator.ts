/**
 * Public form validation (PRD §4.8, §A.13).
 */
import { z } from 'zod';

const fullName = z.string().trim().min(2, 'Enter your full name').max(120);
const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);
// Permissive on format — international numbers vary too much to police here.
const phone = z.string().trim().max(32).optional();

export const contactSchema = z.object({
  fullName,
  email,
  phone,
  message: z
    .string()
    .trim()
    .min(10, 'Please tell us a little more so we can help')
    .max(4000, 'That message is too long'),
  countryOfInterest: z.string().trim().max(80).optional(),
});

export const consultationSchema = z.object({
  fullName,
  email,
  phone,
  type: z
    .enum(['INITIAL_CONSULTATION', 'CAREER_GUIDANCE', 'APPLICATION_REVIEW', 'VISA_CONSULTATION'])
    .default('INITIAL_CONSULTATION'),
  format: z.enum(['ONLINE', 'IN_PERSON']).default('ONLINE'),
  // Datetime-local inputs post without a timezone, so coerce rather than
  // requiring an ISO string with an offset.
  startsAt: z.coerce.date({ errorMap: () => ({ message: 'Choose a date and time' }) }),
  notes: z.string().trim().max(2000).optional(),
  countryOfInterest: z.string().trim().max(80).optional(),
});

export const webinarRegistrationSchema = z.object({
  fullName,
  email,
  phone,
});

export type ContactInput = z.infer<typeof contactSchema>;
export type ConsultationInput = z.infer<typeof consultationSchema>;
