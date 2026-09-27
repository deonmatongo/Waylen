/**
 * Vercel Cron entry points.
 *
 * `src/jobs/index.ts` drives these same job functions with `setInterval` for
 * a traditional long-running host, but that never runs on Vercel (see
 * `server.ts`'s `process.env.VERCEL` guard) — a serverless container isn't
 * kept alive between requests, so an in-process timer has no host to tick
 * on. Vercel Cron instead calls these routes directly on the schedule
 * configured in `vercel.json`'s `crons` array.
 *
 * Mounted before session/CSRF middleware, like `webhookRouter`: the caller is
 * Vercel's scheduler, not a browser with a cookie.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { sendAppointmentReminders, sendWebinarReminders } from '../jobs/reminders.job.js';
import { flagOverdueInvoices } from '../jobs/billing.job.js';

export const cronRouter = Router();

/**
 * Vercel injects `Authorization: Bearer $CRON_SECRET` on its own cron
 * requests once that env var is set on the project. Without a configured
 * secret we refuse every request rather than run these jobs unauthenticated.
 */
function requireCronSecret(req: Request, res: Response, next: NextFunction): void {
  const expected = env.CRON_SECRET;
  const provided = req.get('authorization');

  if (!expected || provided !== `Bearer ${expected}`) {
    logger.warn({ path: req.path }, 'Rejected unauthenticated cron request');
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}

cronRouter.use(requireCronSecret);

cronRouter.get(
  '/appointment-reminders',
  asyncHandler(async (_req, res) => {
    await sendAppointmentReminders();
    res.status(200).json({ ok: true });
  }),
);

cronRouter.get(
  '/webinar-reminders',
  asyncHandler(async (_req, res) => {
    await sendWebinarReminders();
    res.status(200).json({ ok: true });
  }),
);

cronRouter.get(
  '/overdue-invoices',
  asyncHandler(async (_req, res) => {
    await flagOverdueInvoices();
    res.status(200).json({ ok: true });
  }),
);
