/**
 * JWT-based auth for the mobile API. Reads Authorization: Bearer <token>,
 * verifies it, and populates req.currentUser — same shape as session auth.
 */
import type { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt.js';
import { prisma } from '../config/database.js';
import { UnauthorizedError, ForbiddenError } from '../utils/errors.js';

export async function requireJwt(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return next(new UnauthorizedError('No token provided.'));

  const token = auth.slice(7);
  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return next(new UnauthorizedError('Token is invalid or expired.'));
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: {
      id: true, email: true, fullName: true, role: true,
      status: true, emailVerifiedAt: true,
      studentProfile: { select: { id: true, reference: true, currentStage: true } },
    },
  });

  if (!user || user.status === 'SUSPENDED' || user.status === 'ARCHIVED') {
    return next(new UnauthorizedError('That account is not active.'));
  }

  req.currentUser = user;
  next();
}

export function requireJwtStudent(req: Request, _res: Response, next: NextFunction): void {
  if (req.currentUser?.role !== 'STUDENT') {
    return next(new ForbiddenError('This endpoint is for students only.'));
  }
  next();
}
