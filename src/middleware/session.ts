/**
 * Server-side sessions backed by PostgreSQL.
 *
 * Sessions live in the database rather than memory so the app can run more
 * than one instance and survive restarts without logging students out.
 */
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import type { RequestHandler } from 'express';
import type { UserRole } from '@prisma/client';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

const PgStore = connectPgSimple(session);

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    role?: UserRole;
    fullName?: string;
    /** Set after email verification so guarded routes can check cheaply. */
    emailVerified?: boolean;
    /** Where to send the user after a successful login. */
    returnTo?: string;
    flash?: { type: 'success' | 'error' | 'info' | 'warning'; message: string }[];
  }
}

export function sessionMiddleware(): RequestHandler {
  const isSqlite = env.DATABASE_URL.startsWith('file:');

  const store = isSqlite
    ? undefined
    : (() => {
        const s = new PgStore({
          conString: env.DATABASE_URL,
          tableName: 'user_sessions',
          createTableIfMissing: true,
          pruneSessionInterval: 60 * 15,
          errorLog: (...args: unknown[]) => logger.error({ args }, 'Session store error'),
        });
        s.on('error', (err: Error) => logger.error({ err }, 'Session store error'));
        return s;
      })();

  return session({
    name: 'waylen.sid',
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    store,
    cookie: {
      httpOnly: true,
      secure: env.isProduction,
      sameSite: 'lax',
      maxAge: env.SESSION_TTL_HOURS * 60 * 60 * 1000,
      path: '/',
    },
  });
}
