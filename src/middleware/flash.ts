/**
 * One-shot flash messages carried across a redirect in the session.
 */
import type { Request, Response, NextFunction } from 'express';

export type FlashType = 'success' | 'error' | 'info' | 'warning';

export function flashMiddleware(req: Request, res: Response, next: NextFunction): void {
  req.flash = (type: FlashType, message: string): void => {
    req.session.flash ??= [];
    req.session.flash.push({ type, message });
  };

  // Read and clear in one pass so a message is never shown twice.
  //
  // The guard matters: assigning unconditionally would mark the session dirty
  // on every request, defeating `saveUninitialized: false` and writing a
  // session row to the database for every anonymous visitor to the public
  // site. Only touch the session when there is actually something to clear.
  const pending = req.session.flash;
  res.locals.flashMessages = pending ?? [];
  if (pending && pending.length > 0) {
    delete req.session.flash;
  }

  next();
}
