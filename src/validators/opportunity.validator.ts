/**
 * Opportunity listing editor validation (PRD §4.2, §8.1).
 */
import { z } from 'zod';
import { DEFAULT_CURRENCY } from '../config/packages.js';
import { sanitizeRichText } from '../utils/sanitize.js';
import { OpportunityCategory, StudyLevel, PublishStatus } from '@prisma/client';

/** Blank form fields arrive as `''`, which a bare `.optional()` would still try to coerce. */
/** Trimmed rich text, reduced to the CMS allow-list before it is stored. */
const richText = z.string().trim().transform(sanitizeRichText);

const optionalText = (schema: z.ZodTypeAny) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

const checkbox = z.preprocess((value) => value === 'on' || value === true, z.boolean());

export const opportunitySchema = z.object({
  title: z.string().trim().min(2, 'Enter a title').max(160),
  category: z.nativeEnum(OpportunityCategory),
  status: z.nativeEnum(PublishStatus),
  countryId: z.string().cuid('Choose a country'),
  institutionId: optionalText(z.string().cuid()),

  description: z.string().trim().min(10, 'Describe the programme').transform(sanitizeRichText),
  entryRequirements: optionalText(richText),
  studyLevel: optionalText(z.nativeEnum(StudyLevel)),
  duration: optionalText(z.string().trim().max(50)),

  /** Submitted as a comma-separated string, stored as a JSON array. */
  intakePeriods: z.preprocess((value) => {
    if (typeof value !== 'string' || !value.trim()) return '[]';
    return JSON.stringify(
      value
        .split(',')
        .map((period) => period.trim())
        .filter(Boolean),
    );
  }, z.string()),

  indicativeTuitionMin: optionalText(z.coerce.number().int().min(0)),
  indicativeTuitionMax: optionalText(z.coerce.number().int().min(0)),
  currency: z.string().trim().toUpperCase().length(3).default(DEFAULT_CURRENCY),

  scholarshipAvailable: checkbox.default(false),
  scholarshipDetails: optionalText(richText),
  isFeatured: checkbox.default(false),

  metaTitle: optionalText(z.string().trim().max(70)),
  metaDescription: optionalText(z.string().trim().max(160)),
});

/** The public "Enquire about this programme" form. */
export const opportunityEnquirySchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email address').max(254),
  message: optionalText(z.string().trim().max(4000)),
});

export type OpportunityInput = z.infer<typeof opportunitySchema>;
