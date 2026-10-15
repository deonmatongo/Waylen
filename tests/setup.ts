/**
 * Test bootstrap.
 *
 * Integration tests need a real PostgreSQL database — point TEST_DATABASE_URL
 * at a throwaway one, never at development or production data.
 */
import 'dotenv/config';

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.MAIL_DRIVER = 'console';

// Deterministic, obviously-fake secrets so tests never depend on a real .env.
process.env.SESSION_SECRET ??= 'test-session-secret-at-least-32-characters-long';
process.env.CSRF_SECRET ??= 'test-csrf-secret-at-least-32-characters-long!!';
process.env.JWT_SECRET ??= 'test-jwt-secret-at-least-32-characters-long!!!!';
process.env.DOCUMENT_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
process.env.APP_URL ??= 'http://localhost:3000';
process.env.MAIL_FROM_ADDRESS ??= 'test@waylen.test';

// Integration tests need a real database; unit tests only need `env` to parse
// without exiting. TEST_DATABASE_URL wins when set, otherwise a DATABASE_URL
// from .env is used ONLY if it points at this machine — a hosted database
// (e.g. Supabase) is never touched by a bare `npm test`. With neither, an
// unreachable placeholder is used so a stray connection fails loudly.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'postgres']);

function isLocalDatabase(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

const envDatabaseUrl = process.env.DATABASE_URL;
if (!process.env.TEST_DATABASE_URL && envDatabaseUrl && !isLocalDatabase(envDatabaseUrl)) {
  // Don't throw: unit tests don't need a database. Discard the remote URL so
  // nothing can reach it; integration tests then fail to connect, loudly.
  console.warn(
    '[tests/setup] DATABASE_URL points at a non-local host and TEST_DATABASE_URL is unset — ignoring it. ' +
      'Set TEST_DATABASE_URL to a throwaway local database to run integration tests.',
  );
  delete process.env.DATABASE_URL;
}

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://waylen:waylen@127.0.0.1:5432/waylen_test?schema=public';

// A TEST_DATABASE_URL that is remote must look like a test database.
if (!isLocalDatabase(process.env.DATABASE_URL) && !/test/i.test(new URL(process.env.DATABASE_URL).pathname)) {
  throw new Error(
    'Refusing to run tests: TEST_DATABASE_URL is remote and its database name does not contain "test".',
  );
}

// `env.ts` requires DIRECT_URL; keep it in lockstep with DATABASE_URL so a stale
// value from .env can never point at another database.
process.env.DIRECT_URL = process.env.DATABASE_URL;
