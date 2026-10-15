/**
 * Services hub over the JSON API — package, included and additional
 * services, as on the web Services page.
 */
import type { Request, Response } from 'express';
import { SERVICE_CATALOGUE } from '../../config/services.js';
import { currentPackageFor } from '../../config/packages.js';
import { features } from '../../config/env.js';
import { requireStudent } from './helpers.js';

/** GET /services */
export async function index(req: Request, res: Response): Promise<void> {
  const student = await requireStudent(req);

  res.json({
    package: currentPackageFor(student),
    included: SERVICE_CATALOGUE.filter((s) => s.included),
    additional: SERVICE_CATALOGUE.filter((s) => !s.included && (!s.feature || features[s.feature])),
  });
}
