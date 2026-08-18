/**
 * Staff account management (super admin only).
 */
import type { Request, Response } from 'express';
import { prisma } from '../../config/database.js';
import { UserRole } from '@prisma/client';
import { authService } from '../../services/auth.service.js';
import { auditService } from '../../services/audit.service.js';
import { inviteStaffSchema } from '../../validators/user.validator.js';
import { ValidationError } from '../../utils/errors.js';

const STAFF_ROLE_OPTIONS = Object.values(UserRole).filter((r) => r !== 'STUDENT');

function listStaffUsers() {
  return prisma.user.findMany({
    where: { role: { not: 'STUDENT' } },
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
  const users = await listStaffUsers();

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
      users: await listStaffUsers(),
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

export async function updateRole(req: Request, res: Response): Promise<void> {
  const role = req.body?.role;
  if (!Object.values(UserRole).includes(role)) throw new ValidationError('Select a valid role.');

  // Refuse to remove the last super admin — that would lock everyone out of
  // settings and the audit log.
  if (role !== 'SUPER_ADMIN') {
    const target = await prisma.user.findUnique({
      where: { id: req.params.id as string },
      select: { role: true },
    });
    if (target?.role === 'SUPER_ADMIN') {
      const remaining = await prisma.user.count({
        where: { role: 'SUPER_ADMIN', status: 'ACTIVE', id: { not: req.params.id as string } },
      });
      if (remaining === 0) {
        throw new ValidationError('There must be at least one active super admin.');
      }
    }
  }

  await prisma.user.update({ where: { id: req.params.id as string }, data: { role } });

  await auditService.record({
    actorId: req.currentUser!.id,
    action: 'UPDATE',
    entity: 'User',
    entityId: req.params.id,
    changes: { role: { to: role } },
  });

  req.flash('success', 'Role updated.');
  res.redirect('/admin/users');
}

export async function suspend(req: Request, res: Response): Promise<void> {
  if (req.params.id === req.currentUser!.id) {
    throw new ValidationError('You cannot suspend your own account.');
  }

  await prisma.user.update({
    where: { id: req.params.id as string },
    data: { status: 'SUSPENDED' },
  });

  await auditService.record({
    actorId: req.currentUser!.id,
    action: 'UPDATE',
    entity: 'User',
    entityId: req.params.id,
    changes: { status: { to: 'SUSPENDED' } },
  });

  req.flash('success', 'Account suspended.');
  res.redirect('/admin/users');
}
