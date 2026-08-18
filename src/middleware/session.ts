/**
 * Sessions, signed into a single cookie rather than kept server-side.
 *
 * This app's database is SQLite with no shared, persistent store available
 * across instances (the same reason migrations/seed re-run on every cold
 * start) — a server-side session store (in-memory or SQLite-backed) would
 * only be visible to whichever single instance wrote it, so a request
 * landed on a different instance would look logged out.
 *
 * This started out on the `cookie-session` package, which signs via a
 * second `<name>.sig` cookie (the `cookies`/Keygrip convention). On Vercel
 * that produced *intermittent* verification failures under real traffic —
 * confirmed not to be a bug in the signing logic itself (two independent
 * local processes cross-verified each other's cookies over the same
 * secret without issue), which points at the two-cookie split not
 * surviving Vercel's HTTP/2 edge → Node bridge consistently on every
 * request. Folding the signature into the *same* cookie value removes
 * that dependency entirely — there is now exactly one cookie to receive
 * intact, not two that both need to arrive paired.
 *
 * Only signed (HMAC via SESSION_SECRET), not encrypted — nothing sensitive
 * (passwords, tokens) belongs in session data, only the fields already
 * used here.
 */
import crypto from 'node:crypto';
import { parse as parseCookie, serialize as serializeCookie } from 'cookie';
import onHeaders from 'on-headers';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { UserRole } from '@prisma/client';
import { env } from '../config/env.js';

export interface SessionData {
  userId?: string;
  role?: UserRole;
  fullName?: string;
  /** Set after email verification so guarded routes can check cheaply. */
  emailVerified?: boolean;
  /** Where to send the user after a successful login. */
  returnTo?: string;
  flash?: { type: 'success' | 'error' | 'info' | 'warning'; message: string }[];
}

const COOKIE_NAME = 'waylen.sid';

function sign(payload: string): string {
  return crypto.createHmac('sha256', env.SESSION_SECRET).update(payload).digest('base64url');
}

function encode(data: SessionData): string {
  const payload = Buffer.from(JSON.stringify(data), 'utf8').toString('base64url');
  return `${payload}.${sign(payload)}`;
}

/** Returns null for anything missing, malformed, or tampered with. */
function decode(cookieValue: string): SessionData | null {
  const separator = cookieValue.lastIndexOf('.');
  if (separator < 0) return null;

  const payload = cookieValue.slice(0, separator);
  const signature = cookieValue.slice(separator + 1);
  const expected = sign(payload);

  const actualBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (actualBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(actualBuf, expectedBuf)) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SessionData;
  } catch {
    return null;
  }
}

export function sessionMiddleware(): RequestHandler {
  const maxAge = env.SESSION_TTL_HOURS * 60 * 60 * 1000;

  return (req: Request, res: Response, next: NextFunction): void => {
    const cookies = parseCookie(req.headers.cookie ?? '');
    const raw = cookies[COOKIE_NAME];
    req.session = raw ? decode(raw) : {};
    if (req.session === null) req.session = {};
    const before = JSON.stringify(req.session);

    // Deferred to just before headers flush, so it sees whatever the route
    // handler left in req.session, however late that happens.
    onHeaders(res, () => {
      if (req.session === null) {
        res.appendHeader(
          'Set-Cookie',
          serializeCookie(COOKIE_NAME, '', { path: '/', maxAge: 0 }),
        );
        return;
      }

      if (JSON.stringify(req.session) === before) return;

      res.appendHeader(
        'Set-Cookie',
        serializeCookie(COOKIE_NAME, encode(req.session), {
          path: '/',
          maxAge: maxAge / 1000,
          httpOnly: true,
          secure: env.isProduction,
          sameSite: 'lax',
        }),
      );
    });

    next();
  };
}
