/**
 * Webinar editor validation (PRD §5.4).
 */
import { z } from 'zod';
import { EventFormat, PublishStatus } from '@prisma/client';

/** Blank form fields arrive as `''`, which a bare `.optional()` would still try to coerce. */
const optionalText = (schema: z.ZodTypeAny) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

export const webinarSchema = z
  .object({
    title: z.string().trim().min(2, 'Enter a title').max(160),
    status: z.nativeEnum(PublishStatus),
    format: z.nativeEnum(EventFormat),
    description: optionalText(z.string().trim()),
    startsAt: z.coerce.date({ errorMap: () => ({ message: 'Enter a start date and time' }) }),
    endsAt: z.coerce.date({ errorMap: () => ({ message: 'Enter an end date and time' }) }),
    timezone: z.string().trim().min(1).default('UTC'),
    location: optionalText(z.string().trim().max(300)),
    joinUrl: optionalText(z.string().trim().max(500)),
    coverImagePath: optionalText(z.string().trim().max(500)),
    hostName: optionalText(z.string().trim().max(120)),
    capacity: optionalText(z.coerce.number().int().min(1)),
    recordingUrl: optionalText(z.string().trim().max(500)),
  })
  .refine((data) => data.endsAt > data.startsAt, {
    message: 'The end time must be after the start time',
    path: ['endsAt'],
  });

export type WebinarInput = z.infer<typeof webinarSchema>;
