/**
 * Scheduled background work.
 *
 * Deliberately `setInterval` rather than a queue: the current jobs are a
 * handful of idempotent sweeps, and a queue would be infrastructure without a
 * problem to solve. When jobs need retries, concurrency or a dead-letter queue,
 * move to BullMQ — the job bodies below are already written as pure functions
 * so they can be lifted straight into workers.
 *
 * IMPORTANT before scaling out: these run in-process, so N app instances means
 * N executions. Add an advisory-lock guard (or a real scheduler) before running
 * more than one instance.
 */
import { logger } from '../config/logger.js';
import { sendAppointmentReminders, sendWebinarReminders } from './reminders.job.js';
import { flagOverdueInvoices } from './billing.job.js';

interface ScheduledJob {
  name: string;
  everyMs: number;
  run: () => Promise<void>;
}

const HOUR = 3_600_000;

const JOBS: ScheduledJob[] = [
  { name: 'appointment-reminders', everyMs: HOUR, run: sendAppointmentReminders },
  { name: 'webinar-reminders', everyMs: HOUR, run: sendWebinarReminders },
  { name: 'overdue-invoices', everyMs: 12 * HOUR, run: flagOverdueInvoices },
];

const timers: NodeJS.Timeout[] = [];

export function startScheduledJobs(): void {
  for (const job of JOBS) {
    const tick = async (): Promise<void> => {
      try {
        await job.run();
      } catch (err) {
        // A failing job must never take the process down.
        logger.error({ err, job: job.name }, 'Scheduled job failed');
      }
    };

    const timer = setInterval(() => void tick(), job.everyMs);
    // Do not hold the event loop open on shutdown.
    timer.unref();
    timers.push(timer);

    logger.info({ job: job.name, everyMinutes: job.everyMs / 60_000 }, 'Scheduled job registered');
  }
}

export function stopScheduledJobs(): void {
  for (const timer of timers) clearInterval(timer);
  timers.length = 0;
}
