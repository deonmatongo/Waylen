import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { requireJwt, requireJwtStudent } from '../../middleware/apiAuth.js';
import { findStudentByUserId } from '../../models/student.model.js';
import { applicationService } from '../../services/application.service.js';
import { documentService } from '../../services/document.service.js';
import { appointmentService } from '../../services/appointment.service.js';
import { notificationService } from '../../services/notification.service.js';
import { prisma } from '../../config/database.js';
import { APPLICATION_STAGE_LABELS, DOCUMENT_TYPE_LABELS } from '../../config/constants.js';
import { NotFoundError } from '../../utils/errors.js';

export const portalApiRouter = Router();

// All portal API routes require a valid JWT for a student account
portalApiRouter.use(requireJwt, requireJwtStudent);

/** GET /api/v1/portal/dashboard */
portalApiRouter.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const student = await findStudentByUserId(req.currentUser!.id);
    if (!student) throw new NotFoundError('Student profile not found.');

    const [applications, outstandingTypes, notifications, appointments, unreadMessages] =
      await Promise.all([
        applicationService.listForStudent(student.id),
        documentService.outstandingRequirements(student.id),
        notificationService.listForUser(req.currentUser!.id, { limit: 5 }),
        prisma.appointment.findMany({
          where: {
            studentProfileId: student.id,
            status: { in: ['REQUESTED', 'CONFIRMED'] },
            startsAt: { gte: new Date() },
          },
          select: {
            id: true, reference: true, type: true, status: true,
            format: true, startsAt: true, durationMinutes: true,
            meetingUrl: true, location: true,
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
            senderId: { not: req.currentUser!.id },
          },
        }),
      ]);

    const primaryApplication = applications[0] ?? null;
    const progress = primaryApplication
      ? await applicationService.buildProgress(primaryApplication.id)
      : null;

    res.json({
      student: {
        id: student.id,
        reference: student.reference,
        currentStage: student.currentStage,
        currentStageLabel: APPLICATION_STAGE_LABELS[student.currentStage],
        assignedCounsellor: student.assignedCounsellor
          ? { name: (student.assignedCounsellor as any).fullName }
          : null,
      },
      stats: {
        applications: applications.length,
        documents: await prisma.document.count({ where: { studentProfileId: student.id, isIssuedByWaylen: false } }),
        unreadMessages,
        upcomingAppointments: appointments.length,
      },
      primaryApplication: primaryApplication
        ? {
            id: primaryApplication.id,
            reference: primaryApplication.reference,
            programmeName: primaryApplication.programmeName,
            stage: primaryApplication.stage,
            stageLabel: APPLICATION_STAGE_LABELS[primaryApplication.stage],
            country: primaryApplication.country,
          }
        : null,
      progress: progress ?? [],
      outstandingDocuments: outstandingTypes.map((type) => ({
        type,
        label: DOCUMENT_TYPE_LABELS[type],
      })),
      upcomingAppointments: appointments,
      notifications: notifications.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        actionUrl: n.actionUrl,
        readAt: n.readAt,
        createdAt: n.createdAt,
      })),
    });
  }),
);

/** GET /api/v1/portal/applications */
portalApiRouter.get(
  '/applications',
  asyncHandler(async (req, res) => {
    const student = await findStudentByUserId(req.currentUser!.id);
    if (!student) throw new NotFoundError('Student profile not found.');

    const applications = await applicationService.listForStudent(student.id);

    res.json(
      applications.map((a) => ({
        ...a,
        stageLabel: APPLICATION_STAGE_LABELS[a.stage],
      })),
    );
  }),
);

/** GET /api/v1/portal/applications/:id */
portalApiRouter.get(
  '/applications/:id',
  asyncHandler(async (req, res) => {
    const student = await findStudentByUserId(req.currentUser!.id);
    if (!student) throw new NotFoundError('Student profile not found.');

    const application = await applicationService.findForStudent(req.params.id as string, student.id);
    const progress = await applicationService.buildProgress(application.id);

    res.json({ ...application, stageLabel: APPLICATION_STAGE_LABELS[application.stage], progress });
  }),
);

/** GET /api/v1/portal/documents */
portalApiRouter.get(
  '/documents',
  asyncHandler(async (req, res) => {
    const student = await findStudentByUserId(req.currentUser!.id);
    if (!student) throw new NotFoundError('Student profile not found.');

    const [documents, outstanding] = await Promise.all([
      documentService.listForStudent(student.id, { issuedByWaylen: false }),
      documentService.outstandingRequirements(student.id),
    ]);

    res.json({
      documents: documents.map((d) => ({
        ...d,
        typeLabel: DOCUMENT_TYPE_LABELS[d.type],
      })),
      outstanding: outstanding.map((type) => ({ type, label: DOCUMENT_TYPE_LABELS[type] })),
    });
  }),
);

/** GET /api/v1/portal/appointments */
portalApiRouter.get(
  '/appointments',
  asyncHandler(async (req, res) => {
    const student = await findStudentByUserId(req.currentUser!.id);
    if (!student) throw new NotFoundError('Student profile not found.');

    const { upcoming, past } = await appointmentService.listForStudent(student.id);
    res.json({ upcoming, past });
  }),
);

/** GET /api/v1/portal/profile */
portalApiRouter.get(
  '/profile',
  asyncHandler(async (req, res) => {
    const u = req.currentUser!;
    const student = await findStudentByUserId(u.id);
    if (!student) throw new NotFoundError('Student profile not found.');

    const user = await prisma.user.findUnique({
      where: { id: u.id },
      select: {
        id: true, email: true, fullName: true, role: true,
        phone: true, lastLoginAt: true,
        studentProfile: {
          select: {
            id: true, reference: true, currentStage: true,
            dateOfBirth: true, city: true,
            preferredStudyLevel: true, preferredCourses: true,
            countryOfOrigin: { select: { name: true, isoCode: true } },
            assignedCounsellor: { select: { fullName: true, email: true } },
          },
        },
      },
    });

    res.json(user);
  }),
);

/** GET /api/v1/portal/notifications */
portalApiRouter.get(
  '/notifications',
  asyncHandler(async (req, res) => {
    const notifications = await notificationService.listForUser(req.currentUser!.id, { limit: 30 });
    res.json(notifications);
  }),
);

/** POST /api/v1/portal/notifications/:id/read */
portalApiRouter.post(
  '/notifications/:id/read',
  asyncHandler(async (req, res) => {
    await prisma.notification.updateMany({
      where: { id: req.params.id as string, userId: req.currentUser!.id },
      data: { readAt: new Date() },
    });
    res.json({ ok: true });
  }),
);
