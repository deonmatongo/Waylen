/**
 * Populates the view locals every template depends on, so no controller has to
 * remember to pass navigation, branding or feature flags.
 */
import type { Request, Response, NextFunction } from 'express';
import { env, features } from '../config/env.js';
import { ADMIN_NAV, PORTAL_NAV, PUBLIC_NAV } from '../config/constants.js';

export function attachLocals(req: Request, res: Response, next: NextFunction): void {
  // EJS runs templates in a `with` scope, so referencing an unset local throws
  // a ReferenceError rather than yielding undefined. Every optional local a
  // shared partial touches must therefore be defaulted here.
  // `loadCurrentUser` overwrites this when a session exists.
  res.locals.currentUser = null;

  res.locals.appName = env.APP_NAME;
  res.locals.appUrl = env.APP_URL;
  res.locals.currentYear = new Date().getFullYear();
  res.locals.currentPath = req.path;
  res.locals.features = features;
  res.locals.isProduction = env.isProduction;

  res.locals.publicNav = PUBLIC_NAV;
  // Feature-gated items are filtered here so views stay declarative.
  res.locals.portalNav = PORTAL_NAV.filter(
    (item) => !('feature' in item) || features[item.feature as keyof typeof features],
  );
  res.locals.adminNav = ADMIN_NAV.filter(
    (item) => !('feature' in item) || features[item.feature as keyof typeof features],
  );

  // Overridden per-page by controllers.
  res.locals.title = env.APP_NAME;
  res.locals.metaDescription =
    'Waylen is a trusted guide for people building international lives — education, career, wealth-building and life guidance from first enquiry through to thriving abroad.';
  res.locals.canonicalUrl = `${env.APP_URL}${req.path}`;

  next();
}
