/**
 * FAQ and testimonial editor validation (PRD §4.1, §4.9, §5.4).
 */
import { z } from 'zod';
import { PublishStatus } from '@prisma/client';
import { sanitizeRichText } from '../utils/sanitize.js';
import { httpUrlOrSitePath } from './url.js';

/** Blank form fields arrive as `''`, which a bare `.optional()` would still try to coerce. */
const optionalText = (schema: z.ZodTypeAny) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

const checkbox = z.preprocess((value) => value === 'on' || value === true, z.boolean());

export const faqSchema = z.object({
  question: z.string().trim().min(5, 'Enter the question').max(300),
  // Rendered unescaped on the public site, so reduced to the CMS allow-list.
  answer: z.string().trim().min(2, 'Enter the answer').transform(sanitizeRichText),
  topic: z
    .string()
    .trim()
    .toLowerCase()
    .min(2, 'Enter a topic, e.g. visas')
    .max(60),
  status: z.nativeEnum(PublishStatus),
  displayOrder: z.coerce.number().int().default(0),
  countryId: optionalText(z.string().cuid()),
});

export const TESTIMONIAL_SOURCES = ['STUDENT', 'INSTITUTION', 'PARTNER'] as const;

export const testimonialSchema = z.object({
  authorName: z.string().trim().min(2, 'Enter the author name').max(120),
  authorRole: optionalText(z.string().trim().max(160)),
  countryName: optionalText(z.string().trim().max(100)),
  // Plain text — always escaped on output.
  quote: z.string().trim().min(10, 'Enter the quote').max(2000),
  rating: optionalText(z.coerce.number().int().min(1).max(5)),
  avatarPath: optionalText(httpUrlOrSitePath()),
  source: z.enum(TESTIMONIAL_SOURCES),
  status: z.nativeEnum(PublishStatus),
  isFeatured: checkbox.default(false),
  displayOrder: z.coerce.number().int().default(0),
});

export type FaqInput = z.infer<typeof faqSchema>;
export type TestimonialInput = z.infer<typeof testimonialSchema>;
