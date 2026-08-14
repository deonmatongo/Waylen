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
process.env.DOCUMENT_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
process.env.APP_URL ??= 'http://localhost:3000';
process.env.MAIL_FROM_ADDRESS ??= 'test@waylen.test';

// Integration tests need a real database; unit tests only need `env` to parse
// without exiting. TEST_DATABASE_URL wins when set, then any DATABASE_URL from
// .env, then an unreachable placeholder — a unit test that accidentally opens a
// connection fails loudly instead of touching development data.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://waylen:waylen@127.0.0.1:5432/waylen_test?schema=public';
