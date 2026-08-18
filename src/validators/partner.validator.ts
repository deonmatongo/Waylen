/**
 * Partner directory editor validation (PRD §6.2, §8.1). Contract and
 * commission terms are admin-only fields and must never be exposed publicly.
 */
import { z } from 'zod';
import { PartnerCategory, PartnerStatus } from '@prisma/client';

/** Blank form fields arrive as `''`, which a bare `.optional()` would still try to coerce. */
const optionalText = (schema: z.ZodTypeAny) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

const checkbox = z.preprocess((value) => value === 'on' || value === true, z.boolean());

/** Checkbox groups arrive as a string when one box is ticked, an array when several. */
const stringArray = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]));

export const partnerSchema = z.object({
  name: z.string().trim().min(2, 'Enter the partner name').max(160),
  category: z.nativeEnum(PartnerCategory),
  status: z.nativeEnum(PartnerStatus),

  description: optionalText(z.string().trim()),
  logoPath: optionalText(z.string().trim().max(500)),
  websiteUrl: optionalText(z.string().trim().max(500)),

  contactName: optionalText(z.string().trim().max(160)),
  contactEmail: optionalText(z.string().trim().email().max(200)),
  contactPhone: optionalText(z.string().trim().max(50)),

  countryIds: stringArray.pipe(z.array(z.string().cuid())),

  contractReference: optionalText(z.string().trim().max(100)),
  contractStartsAt: optionalText(z.coerce.date()),
  contractEndsAt: optionalText(z.coerce.date()),
  commissionTerms: optionalText(z.string().trim()),
  commissionRateBps: optionalText(z.coerce.number().int().min(0).max(10000)),

  isPubliclyListed: checkbox.default(false),
  isDisplayLogoOnly: checkbox.default(false),
  isFeatured: checkbox.default(false),
  displayOrder: z.coerce.number().int().default(0),

  vettingNotes: optionalText(z.string().trim()),
  markVetted: checkbox.default(false),
});

export type PartnerInput = z.infer<typeof partnerSchema>;
