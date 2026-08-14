/**
 * Process entry point: boots the HTTP server and owns the lifecycle.
 */
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { startScheduledJobs, stopScheduledJobs } from './jobs/index.js';

async function main(): Promise<void> {
  await connectDatabase();

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
