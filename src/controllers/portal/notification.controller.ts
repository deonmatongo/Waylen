/**
 * In-app notifications (PRD §5.2).
 */
import type { Request, Response } from 'express';
import { notificationService } from '../../services/notification.service.js';

export async function index(req: Request, res: Response): Promise<void> {
  const notifications = await notificationService.listForUser(req.currentUser!.id);

  res.render('portal/notifications/index', {
    title: 'Notifications',
    layout: 'layouts/portal',
    notifications,
  });
}

export async function markRead(req: Request, res: Response): Promise<void> {
  await notificationService.markRead(req.params.id as string, req.currentUser!.id);
  res.redirect('back');
}

export async function markAllRead(req: Request, res: Response): Promise<void> {
  await notificationService.markAllRead(req.currentUser!.id);
  req.flash('success', 'All notifications marked as read.');
  res.redirect('/portal/notifications');
}
