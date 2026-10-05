/**
 * Error reporting (Sentry) — wired, but inactive without a real DSN.
 *
 * `SENTRY_DSN` is unset in every environment this runs in today (see
 * `docs/architecture.md`). `initSentry()` and `captureUnexpectedError()` are
 * both deliberate no-ops in that case: they must never throw, and must never
 * attempt a network call, since there is nowhere to send it. Only genuinely
 * unexpected (non-operational, 500-class) errors are reported — the same
 * `expected`/`!isOperational` split `errorHandler.ts` and `routes/api/index.ts`
 * already use to decide what gets logged at `error` level.
 */
import * as Sentry from '@sentry/node';
import { env } from './env.js';

let initialized = false;

/**
 * Call once, as early as possible in the process lifecycle (see
 * `src/server.ts`). Safe to call even when `SENTRY_DSN` is unset or empty —
 * it simply does nothing, so every environment without a configured Sentry
 * project boots exactly as it did before this module existed.
 */
export function initSentry(): void {
  if (!env.SENTRY_DSN || initialized) return;

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    // Error reporting only — no performance tracing/tracking.
    tracesSampleRate: 0,
  });
  initialized = true;
}

/** Test/inspection hook. */
export function isSentryInitialized(): boolean {
  return initialized;
}

export interface UnexpectedErrorContext {
  /** Route path, e.g. `req.path` — never a full URL with a query string. */
  path?: string;
  method?: string;
  status?: number;
  /** Where this was captured from, when it isn't a request at all. */
  source?: string;
}

/**
 * Reports a genuinely unexpected error to Sentry with minimal, non-sensitive
 * context. Never pass request bodies, headers, cookies, or tokens here —
 * only the kind of metadata `logger.error` already attaches (path, method,
 * status). No-ops when Sentry was never initialized (no DSN configured).
 */
export function captureUnexpectedError(err: unknown, context: UnexpectedErrorContext = {}): void {
  if (!initialized) return;

  const tags: Record<string, string> = {};
  if (context.path) tags.path = context.path;
  if (context.method) tags.method = context.method;
  if (context.source) tags.source = context.source;

  Sentry.captureException(err, {
    tags,
    extra: context.status !== undefined ? { status: context.status } : {},
  });
}
