/**
 * Process entry point.
 *
 * On a traditional host this boots a long-running HTTP server and owns its
 * lifecycle. On Vercel there is no process to keep alive — the platform
 * invokes the default export directly, once per request, potentially against
 * a fresh container each time. `process.env.VERCEL` (set automatically by
 * the platform) is what tells this file which mode it's in; `getApp()` does
 * the one-time async setup (DB connect, migrate, seed) either way, memoized
 * so a warm serverless container does not repeat it per request.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { connectDatabase, disconnectDatabase, prisma } from './config/database.js';
import { startScheduledJobs, stopScheduledJobs } from './jobs/index.js';
import argon2 from 'argon2';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function applyMigrationsAndSeed(): Promise<void> {
  // Apply migration SQL directly — no CLI needed, no network access required.
  // Critical for Vercel's ephemeral /tmp SQLite where tables are gone on every cold start.
  try {
    const migrationsDir = path.join(__dirname, '..', 'prisma', 'migrations');
    if (fs.existsSync(migrationsDir)) {
      const dirs = fs.readdirSync(migrationsDir)
        .filter((f) => fs.statSync(path.join(migrationsDir, f)).isDirectory())
        .sort();

      for (const dir of dirs) {
        const sqlFile = path.join(migrationsDir, dir, 'migration.sql');
        if (!fs.existsSync(sqlFile)) continue;
        const sql = fs.readFileSync(sqlFile, 'utf-8');
        // Strip line comments then split on semicolons.
        const statements = sql
          .replace(/--[^\n]*/g, '')
          .split(';')
          .map((s) => s.trim())
          .filter(Boolean);
        for (const stmt of statements) {
          try {
            await prisma.$executeRawUnsafe(stmt);
          } catch {
            // Ignore "already exists" — db may already be set up on a warm instance.
          }
        }
      }
      logger.info('Database migrations applied');
    }
  } catch (err) {
    logger.warn({ err }, 'Migration step failed');
  }

  // Upsert demo accounts so demo credentials always work after a cold start.
  try {
    const passwordHash = await argon2.hash('123456789', { type: argon2.argon2id });
    const demoUsers = [
      { email: 'admin@waylen.com', fullName: 'Admin User', role: 'SUPER_ADMIN' as const, jobTitle: 'Administrator' },
      { email: 'counselor@waylen.com', fullName: 'Counselor User', role: 'COUNSELLOR' as const, jobTitle: 'Education Counsellor' },
    ];
    for (const u of demoUsers) {
      await prisma.user.upsert({
        where: { email: u.email },
        update: { passwordHash, status: 'ACTIVE', emailVerifiedAt: new Date() },
        create: {
          email: u.email,
          fullName: u.fullName,
          passwordHash,
          role: u.role,
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
          staffProfile: { create: { jobTitle: u.jobTitle, regions: '[]' } },
        },
      });
    }
    await prisma.user.upsert({
      where: { email: 'student@waylen.com' },
      update: { passwordHash, status: 'ACTIVE', emailVerifiedAt: new Date() },
      create: {
        email: 'student@waylen.com',
        fullName: 'Student User',
        passwordHash,
        role: 'STUDENT',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        studentProfile: { create: { reference: 'WYL-STU-DEMO001' } },
      },
    });
    logger.info('Demo accounts ready');
  } catch (err) {
    logger.warn({ err }, 'Demo seed failed');
  }
}

type ExpressApp = ReturnType<typeof createApp>;

let appPromise: Promise<ExpressApp> | null = null;

/** One-time setup, memoized — safe to call on every request. */
function getApp(): Promise<ExpressApp> {
  if (!appPromise) {
    appPromise = (async () => {
      await connectDatabase();
      await applyMigrationsAndSeed();
      return createApp();
    })();
  }
  return appPromise;
}

/**
 * Vercel's Node runtime invokes this directly per request; a traditional
 * host never calls it (it calls `main()` below instead).
 */
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const app = await getApp();
  app(req, res);
}

// Registered unconditionally (main()'s copies below only run on a
// traditional host) — without this, an unhandled rejection anywhere in a
// request has no listener, and modern Node's default response is to crash
// the process outright with nothing logged. On Vercel that kills the warm
// container the next request lands on, surfacing as an unexplained 500.
// Logging and carrying on is deliberate here: there is no server to drain
// and no signal to forward, and killing the process mid-request is worse
// than leaving the container up for the next invocation.
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});
process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught exception');
});

async function main(): Promise<void> {
  const app = await getApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`${env.APP_NAME} listening on ${env.APP_URL} (${env.NODE_ENV})`);
  });

  // In-process `setInterval` jobs assume a long-lived process — meaningless
  // on serverless, where `main()` never runs at all (see below).
  startScheduledJobs();

  // Graceful shutdown: stop accepting connections, drain, then close the pool.
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');

    stopScheduledJobs();

    // Backstop: if in-flight requests never drain, exit anyway rather than
    // leaving the orchestrator waiting on a hung process.
    const forceExit = setTimeout(() => {
      logger.error('Forced exit after 15s shutdown timeout');
      process.exit(1);
    }, 15_000);
    forceExit.unref();

    server.close((closeErr) => {
      if (closeErr) logger.error({ err: closeErr }, 'Error closing HTTP server');

      void disconnectDatabase()
        .catch((dbErr: unknown) => logger.error({ err: dbErr }, 'Error closing database pool'))
        .finally(() => process.exit(closeErr ? 1 : 0));
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, 'Unhandled promise rejection');
    shutdown('unhandledRejection');
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception');
    shutdown('uncaughtException');
  });
}

// Vercel imports this module for its default export and never runs it as a
// script — calling `main()` there would start a server that immediately gets
// discarded, and register signal handlers a serverless container never fires.
if (!process.env.VERCEL) {
  void main().catch((err) => {
    logger.fatal({ err }, 'Failed to start server');
    process.exit(1);
  });
}
