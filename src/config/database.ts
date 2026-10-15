/**
 * Prisma client singleton.
 *
 * A single instance per process, cached on `globalThis` in every environment:
 * `tsx watch` reloads in development, and warm serverless instances (Vercel)
 * re-evaluating this module, must not each open a new connection pool.
 *
 * NOTE (serverless): DATABASE_URL should be the pooled (pgbouncer) URL and
 * include `connection_limit=1`, e.g. `...?pgbouncer=true&connection_limit=1`,
 * so each function instance holds a single connection.
 */
import { PrismaClient } from '@prisma/client';
import { env } from './env.js';
import { logger } from './logger.js';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.isDevelopment
      ? [
          { emit: 'event', level: 'query' },
          { emit: 'stdout', level: 'warn' },
          { emit: 'stdout', level: 'error' },
        ]
      : [{ emit: 'stdout', level: 'error' }],
  });

globalForPrisma.prisma = prisma;

if (env.isDevelopment) {
  // @ts-expect-error — the `query` event only exists when configured above
  prisma.$on('query', (e: { query: string; duration: number }) => {
    if (e.duration > 200) {
      logger.warn({ durationMs: e.duration, query: e.query }, 'Slow query');
    }
  });
}

export async function connectDatabase(): Promise<void> {
  await prisma.$connect();
  logger.info('Database connected');
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
  logger.info('Database disconnected');
}
