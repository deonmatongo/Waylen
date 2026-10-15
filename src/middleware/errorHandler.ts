/**
 * Terminal error handling.
 *
 * Internal error detail is never rendered to the browser in production —
 * operators get the stack in the logs, users get a clean page.
 */
import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { env } from '../config/env.js';
import { logger, redactUrl } from '../config/logger.js';
import { captureUnexpectedError } from '../config/sentry.js';
import { safeReferrerPath } from './safeRedirect.js';
import {
  AppError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../utils/errors.js';

export function notFoundHandler(req: Request, res: Response, next: NextFunction): void {
  next(new NotFoundError(`No route matches ${req.method} ${redactUrl(req.path)}`));
}

/**
 * Maps third-party errors onto our own hierarchy.
 *
 * Without this, a rejected CSRF token or a malformed body would be reported as
 * a 500 — telling the user we broke, and burying genuine bugs among expected
 * client errors in the logs.
 */
function normalise(err: unknown): unknown {
  if (err instanceof AppError) return err;

  // A Zod failure that escaped a validator is still a 422, not a 500.
  if (err instanceof ZodError) {
    return new ValidationError(
      'Some of the details provided are not valid.',
      err.flatten().fieldErrors,
    );
  }

  const candidate = err as { code?: string; type?: string; message?: string } | null;

  // csrf-csrf rejection.
  if (candidate?.code === 'EBADCSRFTOKEN') {
    return new ForbiddenError(
      'Your session expired while that form was open. Please reload the page and try again.',
    );
  }

  // Multer upload rejections — all client errors, not server faults.
  if (candidate?.code === 'LIMIT_FILE_SIZE') {
    return new ValidationError('That file is too large. The limit is 15 MB.');
  }
  if (candidate?.code === 'LIMIT_FILE_COUNT' || candidate?.code === 'LIMIT_UNEXPECTED_FILE') {
    return new ValidationError('Too many files, or an unexpected upload field.');
  }

  // body-parser malformed JSON.
  if (candidate?.type === 'entity.parse.failed') {
    return new ValidationError('That request body could not be read.');
  }

  return err;
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) return next(err);

  const normalised = normalise(err);

  const isAppError = normalised instanceof AppError;
  const status = isAppError ? normalised.statusCode : 500;
  const expected = isAppError && normalised.isOperational;

  if (expected) {
    logger.warn({ err: normalised, path: redactUrl(req.path), status }, normalised.message);
  } else {
    logger.error({ err: normalised, path: redactUrl(req.path) }, 'Unhandled error');
    captureUnexpectedError(normalised, { path: redactUrl(req.path), method: req.method, status });
  }

  const message = expected
    ? (normalised).message
    : 'Something went wrong on our side. Please try again.';

  const wantsJson = req.accepts(['html', 'json']) === 'json';

  // A rejected HTML form submission is a user mistake, not a failure: flash
  // the message and send them back to the form (same-origin Referer only)
  // rather than replacing it with the generic error page.
  if (
    !wantsJson &&
    !req.originalUrl.startsWith('/api/') &&
    normalised instanceof ValidationError &&
    req.method !== 'GET' &&
    req.method !== 'HEAD' &&
    typeof req.flash === 'function'
  ) {
    const target = safeReferrerPath(req, '');
    if (target) {
      req.flash('error', message);
      res.redirect(303, target);
      return;
    }
  }

  // API/AJAX callers get JSON, browsers get a rendered page.
  if (wantsJson) {
    res.status(status).json({
      error: { message, ...(isAppError && normalised.details ? { details: normalised.details } : {}) },
    });
    return;
  }

  const template = status === 404 ? 'errors/404' : status === 403 ? 'errors/403' : 'errors/500';

  res.status(status).render(template, {
    title: status === 404 ? 'Page not found' : 'Something went wrong',
    message,
    status,
    stack: env.isProduction ? null : (normalised as Error)?.stack ?? null,
  });
}
