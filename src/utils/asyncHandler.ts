/**
 * Wraps an async controller so a rejected promise reaches the Express error
 * handler instead of becoming an unhandled rejection.
 *
 *   router.get('/', asyncHandler(homeController.index));
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';

type AsyncRequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<unknown>;

export function asyncHandler(fn: AsyncRequestHandler): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(fn(req, res, next)).catch(next);
  };
}
