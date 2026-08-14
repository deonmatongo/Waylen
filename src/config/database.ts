/**
 * Prisma client singleton.
 *
 * A single instance per process; in development the instance is cached on
 * `globalThis` so `tsx watch` reloads do not exhaust the connection pool.
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

if (env.isDevelopment) {
  globalForPrisma.prisma = prisma;

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
