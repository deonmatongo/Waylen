/**
 * Help & Support ticket validation (client navigation feedback §10).
 */
import { z } from 'zod';

const TICKET_CATEGORIES = ['APPLICATION', 'DOCUMENTS', 'PAYMENT', 'APPOINTMENT', 'TECHNICAL_ISSUE', 'OTHER'] as const;

export const newTicketSchema = z.object({
  category: z.enum(TICKET_CATEGORIES, { errorMap: () => ({ message: 'Choose a category' }) }),
  subject: z.string().trim().min(3, 'Add a subject').max(160),
  body: z.string().trim().min(1, 'Describe the issue before submitting').max(10_000),
});

export const ticketReplySchema = z.object({
  body: z.string().trim().min(1, 'Write a message before sending').max(10_000),
});

export const ticketStatusSchema = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'AWAITING_STUDENT', 'RESOLVED']),
});
