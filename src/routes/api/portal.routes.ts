import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { requireJwt, requireJwtStudent } from '../../middleware/apiAuth.js';
import { findStudentByUserId } from '../../models/student.model.js';
import { countUnreadForStudent } from '../../models/message.model.js';
import { applicationService } from '../../services/application.service.js';
import { documentService } from '../../services/document.service.js';
import { requireFeature } from '../../middleware/feature.js';
import { uploadRateLimiter } from '../../middleware/rateLimit.js';
import { apiSingleDocument, paginate, parsePagination } from '../../controllers/api/helpers.js';
import * as documents from '../../controllers/api/document.api.controller.js';
import * as appointments from '../../controllers/api/appointment.api.controller.js';
import * as invoices from '../../controllers/api/invoice.api.controller.js';
import * as messages from '../../controllers/api/message.api.controller.js';
import * as support from '../../controllers/api/support.api.controller.js';
import * as services from '../../controllers/api/service.api.controller.js';
import * as content from '../../controllers/api/content.api.controller.js';
import * as profileApi from '../../controllers/api/profile.api.controller.js';
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
        countUnreadForStudent(student.id, req.currentUser!.id),
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
          ? { name: student.assignedCounsellor.fullName }
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
    const labelled = applications.map((a) => ({
      ...a,
      stageLabel: APPLICATION_STAGE_LABELS[a.stage],
    }));

    // Bare array (the original shape) unless `page`/`perPage` opts in to the envelope.
    res.setHeader('X-Total-Count', String(labelled.length));
    res.json(
      req.query.page !== undefined || req.query.perPage !== undefined
        ? paginate(labelled, parsePagination(req))
        : labelled,
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
portalApiRouter.get('/documents', asyncHandler(documents.list));

/** POST /api/v1/portal/documents (multipart) */
portalApiRouter.post('/documents', uploadRateLimiter, apiSingleDocument, asyncHandler(documents.upload));

/** GET /api/v1/portal/documents/:id/download */
portalApiRouter.get('/documents/:id/download', asyncHandler(documents.download));

/** GET /api/v1/portal/appointments */
portalApiRouter.get('/appointments', asyncHandler(appointments.list));
portalApiRouter.get('/appointments/slots', asyncHandler(appointments.slots));
portalApiRouter.post('/appointments', asyncHandler(appointments.book));
portalApiRouter.post('/appointments/:id/cancel', asyncHandler(appointments.cancel));

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

/** PATCH /api/v1/portal/profile */
portalApiRouter.patch('/profile', asyncHandler(profileApi.update));

/** Notifications */
portalApiRouter.get('/notifications', asyncHandler(profileApi.listNotifications));
portalApiRouter.post('/notifications/read-all', asyncHandler(profileApi.markAllRead));
portalApiRouter.post('/notifications/:id/read', asyncHandler(profileApi.markRead));

/** Invoices & payments — behind FEATURE_PAYMENTS, like the web portal. */
portalApiRouter.get('/invoices', requireFeature('payments'), asyncHandler(invoices.list));
portalApiRouter.get('/invoices/:id', requireFeature('payments'), asyncHandler(invoices.show));
portalApiRouter.post('/invoices/:id/pay', requireFeature('payments'), asyncHandler(invoices.pay));

/** Messages */
portalApiRouter.get('/messages/unread-count', asyncHandler(messages.unreadCount));
portalApiRouter.get('/messages/threads', asyncHandler(messages.listThreads));
portalApiRouter.post('/messages/threads', asyncHandler(messages.createThread));
portalApiRouter.get('/messages/threads/:id', asyncHandler(messages.showThread));
portalApiRouter.post('/messages/threads/:id/reply', asyncHandler(messages.reply));

/** Support tickets */
portalApiRouter.get('/support/tickets', asyncHandler(support.list));
portalApiRouter.post('/support/tickets', asyncHandler(support.create));
portalApiRouter.get('/support/tickets/:id', asyncHandler(support.show));
portalApiRouter.post('/support/tickets/:id/reply', asyncHandler(support.reply));

/** Services, contracts, Waylen-issued downloads */
portalApiRouter.get('/services', asyncHandler(services.index));
portalApiRouter.get('/contracts', asyncHandler(documents.listContracts));
portalApiRouter.get('/contracts/:id/download', asyncHandler(documents.downloadContract));
portalApiRouter.get('/downloads', asyncHandler(documents.listDownloads));
portalApiRouter.get('/downloads/:id/download', asyncHandler(documents.downloadIssued));

/** Resources & webinars */
portalApiRouter.get('/resources', asyncHandler(content.listResources));
portalApiRouter.get('/resources/:slug', asyncHandler(content.showResource));
portalApiRouter.get('/webinars', asyncHandler(content.listWebinars));
portalApiRouter.post('/webinars/:id/register', asyncHandler(content.registerWebinar));
