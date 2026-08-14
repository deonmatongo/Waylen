/**
 * Secure messaging validation (PRD §5.2).
 */
import { z } from 'zod';

export const messageSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Write a message before sending')
    .max(10_000, 'That message is too long'),
});

export const newThreadSchema = messageSchema.extend({
  subject: z.string().trim().min(3, 'Add a subject').max(160),
});
