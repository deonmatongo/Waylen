/**
 * Auth input validation (PRD §5.1).
 *
 * Every controller validates at the boundary; nothing downstream re-checks
 * shape, so these schemas are the contract.
 */
import { z } from 'zod';

/**
 * Minimum 10 characters with mixed character classes. Length is weighted over
 * exotic composition rules — long passphrases beat short complex strings, and
 * students are entrusting identity documents to this account.
 */
const password = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password is too long')
  .refine((v) => /[a-z]/.test(v), 'Include at least one lowercase letter')
  .refine((v) => /[A-Z]/.test(v), 'Include at least one uppercase letter')
  .refine((v) => /[0-9]/.test(v), 'Include at least one number');

const email = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address')
  .max(254);

/** Checkbox groups arrive as a string when one box is ticked, an array when several. */
const stringArray = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]))
  .pipe(z.array(z.string().trim().min(1)).max(20));

export const registerSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(2, 'Enter your full name')
      .max(120, 'That name is too long'),
    email,
    password,
    passwordConfirmation: z.string(),
    // PRD §5.1 sign-up fields
    countryOfOrigin: z
      .string()
      .trim()
      .length(2, 'Select your country of origin')
      .optional(),
    // Feeds counsellor recommendations
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
    acceptTerms: z.literal('on', {
      errorMap: () => ({ message: 'Please accept the terms and privacy policy' }),
    }),
  })
  .refine((data) => data.password === data.passwordConfirmation, {
    message: 'Passwords do not match',
    path: ['passwordConfirmation'],
  });

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password'),
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z
  .object({
    password,
    passwordConfirmation: z.string(),
  })
  .refine((data) => data.password === data.passwordConfirmation, {
    message: 'Passwords do not match',
    path: ['passwordConfirmation'],
  });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    password,
    passwordConfirmation: z.string(),
  })
  .refine((data) => data.password === data.passwordConfirmation, {
    message: 'Passwords do not match',
    path: ['passwordConfirmation'],
  });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
