/**
 * Back-office overview (PRD §5.4, §10).
 *
 * The numbers here are the operational KPIs in §10, so the analytics the PRD
 * asks for are present from the first build rather than retrofitted.
 */
import type { Request, Response } from 'express';
import { prisma } from '../../config/database.js';
import { staffVisibilityFilter, countStudentsByStage } from '../../models/student.model.js';
import { documentService } from '../../services/document.service.js';
import {
  APPLICATION_STAGE_ORDER,
  APPLICATION_STAGE_LABELS,
  APPOINTMENT_TYPE_LABELS,
} from '../../config/constants.js';
import type { AppointmentType } from '@prisma/client';

export async function index(req: Request, res: Response): Promise<void> {
  const user = req.currentUser!;
  const scope = staffVisibilityFilter(user.role, user.id);
  const isCounsellor = user.role === 'COUNSELLOR';

  const [studentCount, stageCounts, reviewQueue, upcomingAppointments, newEnquiries] =
    await Promise.all([
      prisma.studentProfile.count({ where: scope }),
      countStudentsByStage(scope),
      documentService.listReviewQueue({
        counsellorId: isCounsellor ? user.id : undefined,
        limit: 10,
      }),
      prisma.appointment.findMany({
        where: {
          status: { in: ['REQUESTED', 'CONFIRMED'] },
          startsAt: { gte: new Date() },
          ...(isCounsellor ? { counsellorId: user.id } : {}),
        },
        select: {
          id: true,
          reference: true,
          type: true,
          status: true,
          startsAt: true,
          guestName: true,
          studentProfile: { select: { user: { select: { fullName: true } } } },
        },
        orderBy: { startsAt: 'asc' },
        take: 8,
      }),
      prisma.enquiry.count({ where: { status: 'NEW' } }),
    ]);

  const appointmentTypeCounts = new Map<AppointmentType, number>();
  for (const appointment of upcomingAppointments) {
    appointmentTypeCounts.set(appointment.type, (appointmentTypeCounts.get(appointment.type) ?? 0) + 1);
  }

  res.render('admin/overview', {
    title: 'Overview',
    layout: 'layouts/admin',
    studentCount,
    pipeline: APPLICATION_STAGE_ORDER.map((stage) => ({
      stage,
      label: APPLICATION_STAGE_LABELS[stage],
      count: stageCounts.get(stage) ?? 0,
    })),
    // Nominal categorical (type doesn't imply order) — a donut is fine at n=4.
    appointmentsByType: (Object.keys(APPOINTMENT_TYPE_LABELS) as AppointmentType[])
      .map((type) => ({ type, label: APPOINTMENT_TYPE_LABELS[type], count: appointmentTypeCounts.get(type) ?? 0 }))
      .filter((entry) => entry.count > 0),
    reviewQueue,
    upcomingAppointments,
    newEnquiries,
  });
}
