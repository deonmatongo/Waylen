/**
 * Process entry point: boots the HTTP server and owns the lifecycle.
 */
import { execSync } from 'node:child_process';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { connectDatabase, disconnectDatabase, prisma } from './config/database.js';
import { startScheduledJobs, stopScheduledJobs } from './jobs/index.js';
import argon2 from 'argon2';

async function applyMigrationsAndSeed(): Promise<void> {
  // Run migrations so tables exist (critical for ephemeral SQLite on Vercel).
  try {
    execSync('npx prisma migrate deploy --skip-generate', {
      stdio: 'pipe',
      env: { ...process.env },
    });
    logger.info('Database migrations applied');
  } catch (err) {
    logger.warn({ err }, 'prisma migrate deploy failed — tables may already exist');
  }

  // Upsert demo accounts so demo credentials always work after a cold start.
  const passwordHash = await argon2.hash('123456789', { type: argon2.argon2id });
  const demoUsers = [
    { email: 'admin@waylen.com', fullName: 'Admin User', role: 'SUPER_ADMIN' as const, jobTitle: 'Administrator' },
    { email: 'counselor@waylen.com', fullName: 'Counselor User', role: 'COUNSELLOR' as const, jobTitle: 'Education Counsellor' },
  ];
  for (const u of demoUsers) {
    try {
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
    } catch { /* ignore — table may not exist if migration failed */ }
  }
  try {
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
  } catch { /* ignore */ }
  logger.info('Demo accounts ready');
}

async function main(): Promise<void> {
  await connectDatabase();
  await applyMigrationsAndSeed();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`${env.APP_NAME} listening on ${env.APP_URL} (${env.NODE_ENV})`);
  });

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

void main().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
