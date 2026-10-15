/**
 * Shared helpers for the mobile JSON API controllers.
 */
import type { Request, Response } from 'express';
import type { ZodTypeAny, z } from 'zod';
import multer from 'multer';
import { findStudentByUserId } from '../../models/student.model.js';
import { singleDocument } from '../../middleware/upload.js';
import { NotFoundError, ValidationError } from '../../utils/errors.js';
import { env } from '../../config/env.js';
import { paginationQuerySchema } from '../../validators/api.validator.js';

export interface Page<T> {
  items: T[];
  page: number;
  perPage: number;
  total: number;
}

/** Slices an already-loaded list into the standard pagination envelope. */
export function paginate<T>(all: T[], { page, perPage }: { page: number; perPage: number }): Page<T> {
  const start = (page - 1) * perPage;
  return { items: all.slice(start, start + perPage), page, perPage, total: all.length };
}

/** Validates `data` against `schema`, turning failures into a 400 with field errors. */
export function parse<S extends ZodTypeAny>(schema: S, data: unknown, message?: string): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError(
      message ?? 'Some of the details provided are not valid.',
      result.error.flatten().fieldErrors,
    );
  }
  return result.data as z.output<S>;
}

export function parsePagination(req: Request): { page: number; perPage: number } {
  return parse(paginationQuerySchema, req.query);
}

/** The signed-in student's profile; every endpoint is scoped through its id. */
export async function requireStudent(req: Request) {
  const student = await findStudentByUserId(req.currentUser!.id);
  if (!student) throw new NotFoundError('Student profile not found.');
  return student;
}

/**
 * Sends a stored file as a private, uncacheable download (PRD §8.2) — the same
 * headers the web portal uses.
 */
export function sendFile(
  res: Response,
  file: { mimeType: string; filename: string; buffer: Buffer },
  disposition: 'attachment' | 'inline' = 'attachment',
): void {
  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(file.filename)}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(file.buffer);
}

/**
 * The web upload middleware, adapted for the JSON API: multer reports its own
 * errors (oversize file, too many files) as plain errors, which the API error
 * handler would turn into a 500.
 */
export function apiSingleDocument(req: Request, res: Response, next: (err?: unknown) => void): void {
  singleDocument(req, res, (err?: unknown) => {
    if (err instanceof multer.MulterError) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? `That file is too large. The limit is ${Math.floor(env.maxUploadBytes / (1024 * 1024))} MB.`
          : 'That upload could not be processed. Send one file in the "document" field.';
      return next(new ValidationError(message));
    }
    next(err);
  });
}
