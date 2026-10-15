/**
 * Vercel's edge network upgrades an ambiguous `302` response to a
 * method-preserving `307`/`308` when the original request was not GET/HEAD —
 * confirmed by comparing this app's own handler run directly (always 302)
 * against the same code served through Vercel (307). A controller that does
 * `res.redirect(url)` after handling a POST (the standard Post/Redirect/Get
 * pattern used throughout this app) then has its redirect followed as a POST
 * to the target route, which usually has no such route registered.
 *
 * `303 See Other` is the status HTTP defines specifically for "redirect a
 * POST to a GET" and is never upgraded, so it sidesteps the platform
 * behaviour entirely rather than requiring every controller to opt in.
 */
import type { Request, Response, NextFunction } from 'express';

export function safeRedirects(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD') {
    next();
    return;
  }

  const originalRedirect = res.redirect.bind(res);
  res.redirect = ((...args: [string] | [number, string]) => {
    if (args.length === 1) {
      return originalRedirect(303, args[0]);
    }
    return originalRedirect(...args);
  }) as typeof res.redirect;

  next();
}

/**
 * Where to send the user "back": the path of the Referer, but only when it is
 * same-origin. Express's `res.redirect('back')` trusts the header verbatim,
 * which lets a crafted cross-site request bounce a user to any URL. Anything
 * that is missing, malformed or foreign falls back to `fallback`.
 *
 * Only the path and query are returned (never an absolute URL), and any
 * `_csrf` query value is dropped so a token is never re-emitted.
 */
export function safeReferrerPath(req: Request, fallback: string): string {
  const referer = req.get('referer');
  const host = req.get('host');
  if (!referer || !host) return fallback;

  try {
    const url = new URL(referer);
    if (url.host !== host) return fallback;
    url.searchParams.delete('_csrf');
    const path = `${url.pathname}${url.search}`;
    // `//evil.com` and `/\evil.com` are protocol-relative in some browsers.
    if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return fallback;
    return path;
  } catch {
    return fallback;
  }
}
