/**
 * Country editor validation (PRD §4.3, §8.1 — adding a destination must
 * never require a code change).
 */
import { z } from 'zod';
import { PublishStatus } from '@prisma/client';

/** Blank form fields arrive as `''`, which a bare `.optional()` would still try to coerce. */
const optionalText = (schema: z.ZodTypeAny) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

/** Unchecked checkboxes are simply absent from the body, not `false`. */
const checkbox = z.preprocess((value) => value === 'on' || value === true, z.boolean());

export const countrySchema = z.object({
  name: z.string().trim().min(2, 'Enter the country name').max(100),
  isoCode: z
    .string()
    .trim()
    .toUpperCase()
    .length(2, 'Use the 2-letter ISO 3166-1 code, e.g. PL'),
  status: z.nativeEnum(PublishStatus),
  displayOrder: z.coerce.number().int().default(0),
  isFeatured: checkbox.default(false),

  summary: optionalText(z.string().trim().max(500)),
  heroImagePath: optionalText(z.string().trim().max(500)),
  flagImagePath: optionalText(z.string().trim().max(500)),

  // The mini-encyclopaedia sections (PRD §4.3) — long-form, all optional so a
  // country can be created before every section is written.
  educationOverview: optionalText(z.string().trim()),
  costOfLiving: optionalText(z.string().trim()),
  accommodation: optionalText(z.string().trim()),
  healthcare: optionalText(z.string().trim()),
  banking: optionalText(z.string().trim()),
  transportation: optionalText(z.string().trim()),
  studentLife: optionalText(z.string().trim()),
  workingWhileStudying: optionalText(z.string().trim()),
  careerOpportunities: optionalText(z.string().trim()),
  visaInformation: optionalText(z.string().trim()),
  popularProgrammes: optionalText(z.string().trim()),

  indicativeTuitionMin: optionalText(z.coerce.number().int().min(0)),
  indicativeTuitionMax: optionalText(z.coerce.number().int().min(0)),
  costOfLivingMonthly: optionalText(z.coerce.number().int().min(0)),
  currency: z.string().trim().toUpperCase().length(3).default('EUR'),

  metaTitle: optionalText(z.string().trim().max(70)),
  metaDescription: optionalText(z.string().trim().max(160)),
});

export type CountryInput = z.infer<typeof countrySchema>;
