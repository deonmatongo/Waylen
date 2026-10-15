/**
 * Topbar badge counts that every portal page needs (PRD §5.2) — not just the
 * dashboard — so this runs once per request rather than being threaded
 * through each controller individually.
 */
import type { Request, Response, NextFunction } from 'express';
import { findStudentByUserId } from '../models/student.model.js';
import { countUnreadForStudent } from '../models/message.model.js';
import { prisma } from '../config/database.js';

export async function attachPortalBadges(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = req.currentUser!.id;
  const student = await findStudentByUserId(userId);
  const [unreadMessages, unreadNotifications] = await Promise.all([
    student ? countUnreadForStudent(student.id, userId) : 0,
    prisma.notification.count({ where: { userId, channel: 'IN_APP', readAt: null } }),
  ]);
  res.locals.unreadMessageCount = unreadMessages;
  res.locals.unreadNotificationCount = unreadNotifications;
  next();
}
