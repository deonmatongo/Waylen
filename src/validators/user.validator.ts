/**
 * Staff invitation validation (PRD §5.4).
 */
import { z } from 'zod';
import { UserRole } from '@prisma/client';

const optionalText = (schema: z.ZodTypeAny) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

export const inviteStaffSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter their full name').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  role: z.nativeEnum(UserRole).refine((role) => role !== 'STUDENT', {
    message: 'Choose a staff role',
  }),
  jobTitle: optionalText(z.string().trim().max(120)),
});

export type InviteStaffInput = z.infer<typeof inviteStaffSchema>;
