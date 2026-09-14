/**
 * Topbar badge counts that every portal page needs (PRD §5.2) — not just the
 * dashboard — so this runs once per request rather than being threaded
 * through each controller individually.
 */
import type { Request, Response, NextFunction } from 'express';
import { findStudentByUserId } from '../models/student.model.js';
import { countUnreadForStudent } from '../models/message.model.js';

export async function attachPortalBadges(req: Request, res: Response, next: NextFunction): Promise<void> {
  const student = await findStudentByUserId(req.currentUser!.id);
  res.locals.unreadMessageCount = student
    ? await countUnreadForStudent(student.id, req.currentUser!.id)
    : 0;
  next();
}
