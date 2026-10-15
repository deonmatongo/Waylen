/**
 * Profile updates and notifications over the JSON API.
 */
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { notificationService } from '../../services/notification.service.js';
import { profilePatchSchema } from '../../validators/api.validator.js';
import { paginationQuerySchema } from '../../validators/api.validator.js';
import { parse, requireStudent } from './helpers.js';

/** PATCH /profile — only the allow-listed fields; omitted fields are left alone. */
export async function update(req: Request, res: Response): Promise<void> {
  const student = await requireStudent(req);
  const patch = parse(profilePatchSchema, req.body, 'Please check your details.');

  const userData: Prisma.UserUpdateInput = {};
  if (patch.fullName !== undefined) userData.fullName = patch.fullName;
  if (patch.phone !== undefined) userData.phone = patch.phone;

  const profileData: Prisma.StudentProfileUpdateInput = {};
  if (patch.city !== undefined) profileData.city = patch.city;
  if (patch.preferredStudyLevel !== undefined) profileData.preferredStudyLevel = patch.preferredStudyLevel;
  if (patch.preferredCourses !== undefined) profileData.preferredCourses = JSON.stringify(patch.preferredCourses);
  if (patch.preferredDestinations !== undefined) {
    const destinations = patch.preferredDestinations.length
      ? await prisma.country.findMany({
          where: { slug: { in: patch.preferredDestinations } },
          select: { id: true },
        })
      : [];
    // `set` replaces the whole list rather than appending to it.
    profileData.preferredDestinations = { set: destinations.map((d) => ({ id: d.id })) };
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id: req.currentUser!.id }, data: userData }),
    prisma.studentProfile.update({ where: { id: student.id }, data: profileData }),
  ]);

  const user = await prisma.user.findUnique({
    where: { id: req.currentUser!.id },
    select: {
      id: true, email: true, fullName: true, phone: true,
      studentProfile: {
        select: {
          id: true, reference: true, city: true,
          preferredStudyLevel: true, preferredCourses: true,
          preferredDestinations: { select: { slug: true, name: true } },
        },
      },
    },
  });
  res.json(user);
}

/**
 * GET /notifications — a bare array (the original shape) unless `page` or
 * `perPage` is sent, which opts in to the `{items,page,perPage,total}`
 * envelope. The total is always in `X-Total-Count`.
 */
export async function listNotifications(req: Request, res: Response): Promise<void> {
  const wantsEnvelope = req.query.page !== undefined || req.query.perPage !== undefined;
  const { page, perPage } = parse(paginationQuerySchema, req.query);
  const where = { userId: req.currentUser!.id, channel: 'IN_APP' as const };

  const [items, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      // The legacy response was the latest 30.
      skip: wantsEnvelope ? (page - 1) * perPage : 0,
      take: wantsEnvelope ? perPage : 30,
    }),
    prisma.notification.count({ where }),
  ]);

  res.setHeader('X-Total-Count', String(total));
  res.json(wantsEnvelope ? { items, page, perPage, total } : items);
}

/** POST /notifications/read-all */
export async function markAllRead(req: Request, res: Response): Promise<void> {
  await notificationService.markAllRead(req.currentUser!.id);
  res.json({ ok: true });
}

/** POST /notifications/:id/read */
export async function markRead(req: Request, res: Response): Promise<void> {
  await notificationService.markRead(req.params.id as string, req.currentUser!.id);
  res.json({ ok: true });
}
