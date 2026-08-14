/**
 * Feature-flag gating, aligned with the PRD phasing (§9).
 *
 * Phase 2 and 3 surfaces are built behind flags so they can be merged and
 * deployed before they are switched on for students.
 */
import type { RequestHandler } from 'express';
import { features, type Features } from '../config/env.js';
import { NotFoundError } from '../utils/errors.js';

export function requireFeature(name: keyof Features): RequestHandler {
  return (_req, _res, next) => {
    // A disabled feature returns 404 rather than 403 — it should be
    // indistinguishable from a route that does not exist yet.
    if (!features[name]) return next(new NotFoundError());
    next();
  };
}
