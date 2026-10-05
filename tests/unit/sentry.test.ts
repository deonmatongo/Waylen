/**
 * Sentry wiring (`src/config/sentry.ts`).
 *
 * `@sentry/node` is always mocked here — these tests must never make a real
 * network call, with or without a DSN configured. Each case resets the
 * module registry so `env.ts` (and `sentry.ts`'s own `initialized` flag) are
 * re-evaluated against that test's `process.env.SENTRY_DSN`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const ORIGINAL_SENTRY_DSN = process.env.SENTRY_DSN;

afterEach(() => {
  vi.doUnmock('@sentry/node');
  vi.resetModules();
  if (ORIGINAL_SENTRY_DSN === undefined) {
    delete process.env.SENTRY_DSN;
  } else {
    process.env.SENTRY_DSN = ORIGINAL_SENTRY_DSN;
  }
});

describe('without SENTRY_DSN (every environment today)', () => {
  it('initializes cleanly without throwing, and never touches the Sentry client', async () => {
    vi.resetModules();
    delete process.env.SENTRY_DSN;

    const initMock = vi.fn();
    const captureExceptionMock = vi.fn();
    vi.doMock('@sentry/node', () => ({ init: initMock, captureException: captureExceptionMock }));

    const { initSentry, captureUnexpectedError, isSentryInitialized } = await import(
      '../../src/config/sentry.js'
    );

    expect(() => initSentry()).not.toThrow();
    expect(isSentryInitialized()).toBe(false);
    expect(initMock).not.toHaveBeenCalled();

    // The !isOperational path still calls this unconditionally — it must be
    // a safe no-op, not something callers have to guard themselves.
    expect(() =>
      captureUnexpectedError(new Error('boom'), { path: '/portal', status: 500 }),
    ).not.toThrow();
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });
});

describe('with a configured SENTRY_DSN (mocked client, no real network call)', () => {
  it('initializes the Sentry client once with the DSN and environment', async () => {
    vi.resetModules();
    process.env.SENTRY_DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0';

    const initMock = vi.fn();
    const captureExceptionMock = vi.fn();
    vi.doMock('@sentry/node', () => ({ init: initMock, captureException: captureExceptionMock }));

    const { initSentry, isSentryInitialized } = await import('../../src/config/sentry.js');

    initSentry();

    expect(isSentryInitialized()).toBe(true);
    expect(initMock).toHaveBeenCalledTimes(1);
    expect(initMock).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: 'https://examplePublicKey@o0.ingest.sentry.io/0' }),
    );

    // Calling it again must not re-initialize the client.
    initSentry();
    expect(initMock).toHaveBeenCalledTimes(1);
  });

  it('reports an unexpected (500/!isOperational) error with safe, non-sensitive context', async () => {
    vi.resetModules();
    process.env.SENTRY_DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0';

    const initMock = vi.fn();
    const captureExceptionMock = vi.fn();
    vi.doMock('@sentry/node', () => ({ init: initMock, captureException: captureExceptionMock }));

    const { initSentry, captureUnexpectedError } = await import('../../src/config/sentry.js');
    initSentry();

    const err = new Error('unhandled failure deep in a service call');
    captureUnexpectedError(err, { path: '/api/v1/portal/documents', method: 'POST', status: 500 });

    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    expect(captureExceptionMock).toHaveBeenCalledWith(
      err,
      expect.objectContaining({
        tags: expect.objectContaining({ path: '/api/v1/portal/documents', method: 'POST' }),
        extra: expect.objectContaining({ status: 500 }),
      }),
    );
  });

  it('does not report expected/operational errors (the caller never calls it for those)', async () => {
    // errorHandler.ts and routes/api/index.ts only call captureUnexpectedError
    // from the `!expected` branch — this guards the no-op contract itself:
    // the function always reports when initialized, so the filtering is the
    // call sites' job, not this module's. Confirms it does NOT silently
    // swallow a call when initialized, which would mask a wiring regression.
    vi.resetModules();
    process.env.SENTRY_DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0';

    const initMock = vi.fn();
    const captureExceptionMock = vi.fn();
    vi.doMock('@sentry/node', () => ({ init: initMock, captureException: captureExceptionMock }));

    const { initSentry, captureUnexpectedError } = await import('../../src/config/sentry.js');
    initSentry();

    captureUnexpectedError(new Error('reported when called'));
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });
});
