/**
 * Portal dashboard (PRD §5.2).
 *
 * "Welcome, current application stage, outstanding actions, notifications,
 * upcoming appointments" — assembled here, so the view stays presentational.
 */
import type { Request, Response } from 'express';
import { prisma } from '../../config/database.js';
import { findStudentByUserId } from '../../models/student.model.js';
import { applicationService } from '../../services/application.service.js';
import { documentService } from '../../services/document.service.js';
import { notificationService } from '../../services/notification.service.js';
import { DOCUMENT_TYPE_LABELS, APPLICATION_STAGE_LABELS } from '../../config/constants.js';
import { NotFoundError } from '../../utils/errors.js';

export async function index(req: Request, res: Response): Promise<void> {
  const userId = req.currentUser!.id;

  const student = await findStudentByUserId(userId);
  if (!student) throw new NotFoundError('We could not find your student profile.');

  const [applications, outstandingTypes, notifications, appointments, unreadMessages] =
    await Promise.all([
      applicationService.listForStudent(student.id),
      documentService.outstandingRequirements(student.id),
      notificationService.listForUser(userId, { limit: 5 }),
      prisma.appointment.findMany({
        where: {
          studentProfileId: student.id,
          status: { in: ['REQUESTED', 'CONFIRMED'] },
          startsAt: { gte: new Date() },
        },
        select: {
          id: true,
          reference: true,
          type: true,
          status: true,
          format: true,
          startsAt: true,
          durationMinutes: true,
          meetingUrl: true,
          location: true,
          counsellor: { select: { fullName: true } },
        },
        orderBy: { startsAt: 'asc' },
        take: 3,
      }),
      prisma.message.count({
        where: {
          thread: { studentProfileId: student.id },
          readAt: null,
          isInternal: false,
          // Only count messages from staff, not the student's own.
          senderId: { not: userId },
        },
      }),
    ]);

  // The tracker shown on the dashboard follows the most recent application;
  // a student with none yet sees the profile-creation step only.
  const primaryApplication = applications[0];
  const progress = primaryApplication
    ? await applicationService.buildProgress(primaryApplication.id)
    : null;

  res.render('portal/dashboard', {
    title: 'Dashboard',
    layout: 'layouts/portal',
    student,
    applications,
    primaryApplication,
    progress,
    outstandingDocuments: outstandingTypes.map((type) => ({
      type,
      label: DOCUMENT_TYPE_LABELS[type],
    })),
    notifications,
    appointments,
    unreadMessages,
    stageLabel: APPLICATION_STAGE_LABELS[student.currentStage],
  });
}
