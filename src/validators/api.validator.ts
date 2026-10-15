/**
 * Mobile JSON API validation. Body schemas for endpoints that mirror a web
 * form reuse the web validator, so the two surfaces cannot drift; this file
 * only holds what is API-specific (pagination, params, partial profile
 * updates).
 */
import { z } from 'zod';
import { ResourceType } from '@prisma/client';

export const API_MAX_PER_PAGE = 50;
export const API_DEFAULT_PER_PAGE = 20;

/** `perPage` above the cap is clamped rather than rejected. */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  perPage: z.coerce
    .number()
    .int()
    .min(1)
    .default(API_DEFAULT_PER_PAGE)
    .transform((n) => Math.min(n, API_MAX_PER_PAGE)),
});

export const idParamSchema = z.object({ id: z.string().trim().min(1).max(64) });
export const slugParamSchema = z.object({ slug: z.string().trim().min(1).max(200) });

export const resourcesQuerySchema = paginationQuerySchema.extend({
  type: z.nativeEnum(ResourceType).optional(),
});

export const downloadQuerySchema = z.object({ download: z.enum(['0', '1']).optional() });

const stringList = z.array(z.string().trim().min(1).max(120)).max(20);

/**
 * PATCH /profile — an allow-list: anything not named here (email, role,
 * stage, counsellor...) is stripped, never written. `.strict()` is avoided on
 * purpose so a newer client sending extra keys is not rejected outright, but
 * an empty patch is.
 */
export const profilePatchSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Enter your full name').max(120),
    phone: z.string().trim().max(32).nullable(),
    city: z.string().trim().max(80).nullable(),
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
      .nullable(),
    preferredCourses: stringList,
    /** Country slugs. */
    preferredDestinations: stringList,
  })
  .partial()
  .refine((patch) => Object.values(patch).some((v) => v !== undefined), {
    message: 'Provide at least one field to update.',
  });

export type ProfilePatchInput = z.infer<typeof profilePatchSchema>;
