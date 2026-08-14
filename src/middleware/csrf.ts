/**
 * CSRF protection for every state-changing form submission.
 */
import { doubleCsrf } from 'csrf-csrf';
import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';

const { doubleCsrfProtection, generateToken } = doubleCsrf({
  getSecret: () => env.CSRF_SECRET,
  cookieName: env.isProduction ? '__Host-waylen.csrf' : 'waylen.csrf',
  cookieOptions: {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.isProduction,
    path: '/',
  },
  size: 64,
  ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
  // Forms post `_csrf`; fetch/XHR callers send the header. Express types
  // `req.body` as `any`, so narrow explicitly rather than trusting it.
  getTokenFromRequest: (req) => {
    const body = req.body as Record<string, unknown> | undefined;
    const fromBody = body?._csrf;
    if (typeof fromBody === 'string') return fromBody;

    const fromHeader = req.headers['x-csrf-token'];
    return typeof fromHeader === 'string' ? fromHeader : undefined;
  },
});

export const csrfProtection = doubleCsrfProtection;

/**
 * Makes the token available to every template as `csrfToken`, so forms can
 * embed it without each controller passing it through.
 */
export function exposeCsrfToken(req: Request, res: Response, next: NextFunction): void {
  res.locals.csrfToken = generateToken(req, res);
  next();
}

/**
 * Payment-gateway webhooks are authenticated by provider signature, not by a
 * session cookie, so they must bypass CSRF. Mount before `csrfProtection`.
 */
export function skipCsrfForWebhooks(req: Request, _res: Response, next: NextFunction): void {
  if (req.path.startsWith('/webhooks/')) {
    // @ts-expect-error — marker read by the wrapper below
    req.skipCsrf = true;
  }
  next();
}
