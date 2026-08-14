/**
 * Staff account management (super admin only).
 */
import type { Request, Response } from 'express';
import { prisma } from '../../config/database.js';
import { UserRole } from '@prisma/client';
import { auditService } from '../../services/audit.service.js';
import { ValidationError } from '../../utils/errors.js';

export async function index(req: Request, res: Response): Promise<void> {
  const users = await prisma.user.findMany({
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

  res.render('admin/users/index', {
    title: 'Staff accounts',
    layout: 'layouts/admin',
    users,
    roles: Object.values(UserRole).filter((r) => r !== 'STUDENT'),
  });
}

export async function store(req: Request, res: Response): Promise<void> {
  // TODO(phase-1): invite a staff member by email rather than setting a
  // password on their behalf.
  req.flash('info', 'Staff invitations are wired up in Phase 1.');
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
