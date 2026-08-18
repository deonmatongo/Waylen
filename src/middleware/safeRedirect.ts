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
