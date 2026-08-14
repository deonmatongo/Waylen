import type { Request, Response, NextFunction } from 'express';
import { Router } from 'express';
import { authApiRouter } from './auth.routes.js';
import { portalApiRouter } from './portal.routes.js';
import { AppError } from '../../utils/errors.js';
import { logger } from '../../config/logger.js';
import { env } from '../../config/env.js';

export const apiRouter = Router();

apiRouter.use('/auth', authApiRouter);
apiRouter.use('/portal', portalApiRouter);

// Catch-all for unmatched API paths
apiRouter.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'API endpoint not found.' });
});

// JSON error handler — must be 4-param for Express to recognise it as error middleware
// eslint-disable-next-line @typescript-eslint/no-unused-vars
apiRouter.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const isAppError = err instanceof AppError;
  const status = isAppError ? err.statusCode : 500;
  const expected = isAppError && err.isOperational;

  if (expected) {
    logger.warn({ err, status }, (err as AppError).message);
  } else {
    logger.error({ err }, 'Unhandled API error');
  }

  const message = expected
    ? (err as AppError).message
    : 'Something went wrong on our side. Please try again.';

  res.status(status).json({
    error: message,
    ...(isAppError && err.details ? { details: err.details } : {}),
    ...(!env.isProduction && !expected ? { stack: (err as Error)?.stack } : {}),
  });
});
