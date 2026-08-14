/**
 * Structured logging.
 *
 * Redaction is deliberately broad: this platform handles identity documents
 * and payment data (PRD §8.2), so nothing sensitive should ever reach a log
 * sink even by accident.
 */
import pino from 'pino';
import { env } from './env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  transport: env.isDevelopment
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
    : undefined,
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
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
