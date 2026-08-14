/**
 * Authentication and role-based access control (PRD §8.1).
 *
 * Every guard here fails closed: an unknown role or a missing session results
 * in denial, never in a permissive fallthrough.
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { UserRole } from '@prisma/client';
import { prisma } from '../config/database.js';
import { STAFF_ROLES } from '../config/constants.js';
import { ForbiddenError, UnauthorizedError } from '../utils/errors.js';

/**
 * Loads the current user onto the request when a session exists. Never
 * rejects — routes decide whether authentication is required.
 */
export async function loadCurrentUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.session.userId) return next();

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.session.userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        status: true,
        emailVerifiedAt: true,
        studentProfile: { select: { id: true, reference: true, currentStage: true } },
      },
    });

    // Session outlived the account, or the account was suspended.
    if (!user || user.status === 'SUSPENDED' || user.status === 'ARCHIVED') {
      req.session.destroy(() => undefined);
      return next();
    }

    req.currentUser = user;
    res.locals.currentUser = user;
    next();
  } catch (err) {
    next(err);
  }
}

/** Requires a signed-in, email-verified account. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.currentUser) {
    req.session.returnTo = req.originalUrl;
    res.redirect('/login');
    return;
  }
  // PRD §5.1 — email verification gates portal access.
  if (!req.currentUser.emailVerifiedAt) {
    res.redirect('/verify-email/pending');
    return;
  }
  next();
}

/** Restricts a route to an explicit allow-list of roles. */
export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.currentUser) return next(new UnauthorizedError());
    if (!roles.includes(req.currentUser.role)) {
      return next(new ForbiddenError('Your account does not have access to this area.'));
    }
    next();
  };
}

export const requireStudent = requireRole('STUDENT');
export const requireStaff = requireRole(...STAFF_ROLES);
export const requireSuperAdmin = requireRole('SUPER_ADMIN');

/** Blocks signed-in users from login/register pages. */
export function requireGuest(req: Request, res: Response, next: NextFunction): void {
  if (req.currentUser) {
    res.redirect(req.currentUser.role === 'STUDENT' ? '/portal' : '/admin');
    return;
  }
  next();
}

/**
 * Confirms the signed-in user may act on a given student's record: the student
 * themselves, their assigned counsellor, or admin staff. Counsellors must not
 * see students who are not theirs.
 */
export async function assertCanAccessStudent(
  req: Request,
  studentProfileId: string,
): Promise<void> {
  const user = req.currentUser;
  if (!user) throw new UnauthorizedError();

  if (user.role === 'ADMIN_STAFF' || user.role === 'SUPER_ADMIN') return;

  if (user.role === 'STUDENT') {
    if (user.studentProfile?.id === studentProfileId) return;
    throw new ForbiddenError();
  }

  if (user.role === 'COUNSELLOR') {
    const match = await prisma.studentProfile.findFirst({
      where: { id: studentProfileId, assignedCounsellorId: user.id },
      select: { id: true },
    });
    if (match) return;
    throw new ForbiddenError('This student is not assigned to you.');
  }

  throw new ForbiddenError();
}
