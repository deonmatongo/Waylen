/**
 * Resource Library editor validation (PRD §5.2, §8.1).
 */
import { z } from 'zod';
import { ResourceType, PublishStatus } from '@prisma/client';

/** Blank form fields arrive as `''`, which a bare `.optional()` would still try to coerce. */
const optionalText = (schema: z.ZodTypeAny) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

const checkbox = z.preprocess((value) => value === 'on' || value === true, z.boolean());

export const resourceSchema = z.object({
  title: z.string().trim().min(2, 'Enter a title').max(160),
  type: z.nativeEnum(ResourceType),
  status: z.nativeEnum(PublishStatus),
  requiresAuth: checkbox.default(false),

  excerpt: optionalText(z.string().trim().max(300)),
  body: optionalText(z.string().trim()),
  coverImagePath: optionalText(z.string().trim().max(500)),
  filePath: optionalText(z.string().trim().max(500)),
  externalUrl: optionalText(z.string().trim().max(500)),
  readMinutes: optionalText(z.coerce.number().int().min(1)),

  /** Submitted as a comma-separated string, stored as a JSON array. */
  tags: z.preprocess((value) => {
    if (typeof value !== 'string' || !value.trim()) return '[]';
    return JSON.stringify(
      value
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    );
  }, z.string()),

  metaTitle: optionalText(z.string().trim().max(70)),
  metaDescription: optionalText(z.string().trim().max(160)),
});

export type ResourceInput = z.infer<typeof resourceSchema>;
