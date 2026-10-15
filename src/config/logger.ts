/**
 * Structured logging.
 *
 * Redaction is deliberately broad: this platform handles identity documents
 * and payment data (PRD §8.2), so nothing sensitive should ever reach a log
 * sink even by accident.
 */
import pino from 'pino';
import { env } from './env.js';

/**
 * Masks single-use secrets that travel in a URL — the reset/verify tokens in
 * the path and the CSRF token that multipart forms carry in the query string —
 * so they never reach a log sink. Everything else in the URL is left intact.
 */
export function redactUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  return url
    .replace(/^(\/(?:reset-password|verify-email)\/)(?!pending(?:[/?#]|$))[^/?#]+/i, '$1[redacted]')
    .replace(/([?&]_csrf=)[^&#]*/gi, '$1[redacted]');
}

/** pino-http `req` serializer: the standard shape, with the URL redacted. */
export function serializeRequest(req: Parameters<typeof pino.stdSerializers.req>[0]) {
  const serialized = pino.stdSerializers.req(req);
  return { ...serialized, url: redactUrl(serialized.url) };
}

export const logger = pino({
  level: env.LOG_LEVEL,
  transport: env.isDevelopment
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
    : undefined,
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'req.headers["x-csrf-token"]',
      'req.body._csrf',
      'req.body.password',
      'req.body.passwordConfirmation',
      'req.body.currentPassword',
      'req.body.cardNumber',
      'req.body.cvc',
      'res.headers["set-cookie"]',
      '*.passwordHash',
      '*.mfaSecret',
      '*.verificationToken',
      '*.passwordResetToken',
      '*.storageKey',
      '*.encryptionIv',
    ],
    censor: '[redacted]',
  },
  base: { service: 'waylen-platform', env: env.NODE_ENV },
});

export type Logger = typeof logger;
