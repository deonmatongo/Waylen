/**
 * One-shot flash messages carried across a redirect in the session.
 */
import type { Request, Response, NextFunction } from 'express';

export type FlashType = 'success' | 'error' | 'info' | 'warning';

export function flashMiddleware(req: Request, res: Response, next: NextFunction): void {
  req.flash = (type: FlashType, message: string): void => {
    if (!req.session) return;
    req.session.flash ??= [];
    req.session.flash.push({ type, message });
  };

  // Read and clear in one pass so a message is never shown twice.
  const pending = req.session?.flash;
  res.locals.flashMessages = pending ?? [];
  if (pending && pending.length > 0 && req.session) {
    delete req.session.flash;
  }

  next();
}
