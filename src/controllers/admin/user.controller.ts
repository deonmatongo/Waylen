/**
 * Staff account management (super admin only).
 */
import type { Request, Response } from 'express';
import { prisma } from '../../config/database.js';
import { authService, isPendingInvite } from '../../services/auth.service.js';
import { auditService } from '../../services/audit.service.js';
import { mfaService } from '../../services/mfa.service.js';
import { sessionService } from '../../services/session.service.js';
import { refreshTokenService } from '../../services/refreshToken.service.js';
import { STAFF_ROLES } from '../../config/constants.js';
import { inviteStaffSchema } from '../../validators/user.validator.js';
import { ValidationError } from '../../utils/errors.js';

const STAFF_ROLE_OPTIONS = STAFF_ROLES;

function listStaffUsers() {
  return prisma.user.findMany({
    where: { role: { in: STAFF_ROLES } },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      status: true,
      lastLoginAt: true,
      createdAt: true,
      staffProfile: { select: { jobTitle: true, regions: true } },
    },
    orderBy: [{ role: 'asc' }, { fullName: 'asc' }],
  });
}

export async function index(req: Request, res: Response): Promise<void> {
  const users = (await listStaffUsers()).map((u) => ({ ...u, pendingInvite: isPendingInvite(u) }));

  res.render('admin/users/index', {
    title: 'Staff accounts',
    layout: 'layouts/admin',
    users,
    roles: STAFF_ROLE_OPTIONS,
    values: {},
    errors: {},
  });
}

export async function store(req: Request, res: Response): Promise<void> {
  const parsed = inviteStaffSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).render('admin/users/index', {
      title: 'Staff accounts',
      layout: 'layouts/admin',
      users: (await listStaffUsers()).map((u) => ({ ...u, pendingInvite: isPendingInvite(u) })),
      roles: STAFF_ROLE_OPTIONS,
      values: req.body,
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const user = await authService.inviteStaff(parsed.data);

  await auditService.record({
    actorId: req.currentUser!.id,
    action: 'CREATE',
    entity: 'User',
    entityId: user.id,
    changes: { email: user.email, role: user.role },
  });

  req.flash('success', `Invited ${user.fullName} — they'll get an email to set up their account.`);
  res.redirect('/admin/users');
}

/** Signs a user out of every browser session and mobile refresh token. */
async function revokeAllAccess(userId: string): Promise<void> {
  await Promise.all([
    sessionService.revokeAllForUser(userId),
    refreshTokenService.revokeAllForUser(userId),
  ]);
}

export async function updateRole(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const role = req.body?.role;

  // This screen manages staff only: STUDENT / AGENT / PARTNER accounts are
  // never created or converted here, in either direction.
  if (!STAFF_ROLES.includes(role)) throw new ValidationError('Select a valid staff role.');

  const target = await prisma.user.findUnique({ where: { id }, select: { role: true } });
  if (!target) throw new ValidationError('That user could not be found.');
  if (!STAFF_ROLES.includes(target.role)) {
    throw new ValidationError('Only staff accounts can have their role changed here.');
  }
  if (target.role === role) {
    req.flash('info', 'That is already their role.');
    res.redirect('/admin/users');
    return;
  }

  // Refuse to remove the last super admin — that would lock everyone out of
  // settings and the audit log.
  if (target.role === 'SUPER_ADMIN') {
    const remaining = await prisma.user.count({
      where: { role: 'SUPER_ADMIN', status: 'ACTIVE', id: { not: id } },
    });
    if (remaining === 0) {
      throw new ValidationError('There must be at least one active super admin.');
    }
  }

  await prisma.user.update({ where: { id }, data: { role } });

  // Existing sessions and refresh tokens were issued under the old role —
  // force a fresh sign-in so nothing lingers with stale privileges.
  await revokeAllAccess(id);

  await auditService.record({
    actorId: req.currentUser!.id,
    action: 'UPDATE',
    entity: 'User',
    entityId: id,
    changes: { role: { from: target.role, to: role } },
  });

  req.flash('success', 'Role updated. They have been signed out and must sign in again.');
  res.redirect('/admin/users');
}

export async function suspend(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  if (id === req.currentUser!.id) {
    throw new ValidationError('You cannot suspend your own account.');
  }

  const target = await prisma.user.findUnique({ where: { id }, select: { role: true } });
  if (!target || !STAFF_ROLES.includes(target.role)) {
    throw new ValidationError('Only staff accounts can be suspended here.');
  }

  // Same lock-out guard as a demotion: never suspend the last super admin.
  if (target.role === 'SUPER_ADMIN') {
    const remaining = await prisma.user.count({
      where: { role: 'SUPER_ADMIN', status: 'ACTIVE', id: { not: id } },
    });
    if (remaining === 0) {
      throw new ValidationError('There must be at least one active super admin.');
    }
  }

  await prisma.user.update({ where: { id }, data: { status: 'SUSPENDED' } });
  await revokeAllAccess(id);

  await auditService.record({
    actorId: req.currentUser!.id,
    action: 'UPDATE',
    entity: 'User',
    entityId: id,
    changes: { status: { to: 'SUSPENDED' } },
  });

  req.flash('success', 'Account suspended and signed out everywhere.');
  res.redirect('/admin/users');
}

export async function unsuspend(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;

  const target = await prisma.user.findUnique({ where: { id }, select: { role: true, status: true } });
  if (!target || !STAFF_ROLES.includes(target.role)) {
    throw new ValidationError('Only staff accounts can be reactivated here.');
  }
  if (target.status !== 'SUSPENDED') throw new ValidationError('That account is not suspended.');

  await authService.unsuspend(id);

  await auditService.record({
    actorId: req.currentUser!.id,
    action: 'UPDATE',
    entity: 'User',
    entityId: id,
    changes: { status: { from: 'SUSPENDED', to: 'ACTIVE' } },
  });

  req.flash('success', 'Account reactivated.');
  res.redirect('/admin/users');
}

export async function resetMfa(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;

  const target = await prisma.user.findUnique({ where: { id }, select: { role: true } });
  if (!target || !STAFF_ROLES.includes(target.role)) {
    throw new ValidationError('Only staff accounts can have MFA reset here.');
  }

  await mfaService.adminReset(id);

  await auditService.record({
    actorId: req.currentUser!.id,
    action: 'UPDATE',
    entity: 'User',
    entityId: id,
    changes: { mfaReset: true },
    ipAddress: req.ip ?? null,
  });

  req.flash('success', 'Two-factor authentication reset; the user was signed out everywhere.');
  res.redirect('/admin/users');
}

export async function resendInvite(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;

  const { email } = await authService.resendStaffInvite(id, STAFF_ROLES);

  await auditService.record({
    actorId: req.currentUser!.id,
    action: 'UPDATE',
    entity: 'User',
    entityId: id,
    changes: { inviteResent: true },
    ipAddress: req.ip ?? null,
  });

  req.flash('success', `A fresh invite was sent to ${email}.`);
  res.redirect('/admin/users');
}
