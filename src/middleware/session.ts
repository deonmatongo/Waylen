/**
 * Sessions, signed into the cookie itself rather than kept server-side.
 *
 * This app's database is SQLite with no shared, persistent store available
 * across instances (the same reason migrations/seed re-run on every cold
 * start) — a server-side session store (in-memory or SQLite-backed) would
 * only be visible to whichever single instance wrote it, so a request
 * landed on a different instance would look logged out. A signed cookie
 * carries the session with it, so it works the same regardless of which
 * instance handles the request. `cookie-session` signs (HMAC via `keys`)
 * so a client cannot forge or edit `role` etc. without knowing
 * SESSION_SECRET, but does not encrypt the payload — nothing sensitive
 * (passwords, tokens) belongs in session data, only the fields already
 * used here.
 */
import cookieSession from 'cookie-session';
import type { RequestHandler } from 'express';
import type { UserRole } from '@prisma/client';
import { env } from '../config/env.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace CookieSessionInterfaces {
    interface CookieSessionObject {
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
}

export function sessionMiddleware(): RequestHandler {
  return cookieSession({
    name: 'waylen.sid',
    keys: [env.SESSION_SECRET],
    maxAge: env.SESSION_TTL_HOURS * 60 * 60 * 1000,
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'lax',
    path: '/',
  });
}
