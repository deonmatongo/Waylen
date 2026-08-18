/**
 * Educational Portal routes — PRD §5.2.
 *
 * The whole router sits behind `requireAuth` + `requireStudent`: there is no
 * anonymously reachable path under `/portal`.
 */
import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { requireAuth, requireStudent } from '../../middleware/auth.js';
import { uploadRateLimiter } from '../../middleware/rateLimit.js';
import { singleDocument } from '../../middleware/upload.js';
import { audit } from '../../middleware/audit.js';
import { requireFeature } from '../../middleware/feature.js';

import * as dashboardController from '../../controllers/portal/dashboard.controller.js';
import * as applicationController from '../../controllers/portal/application.controller.js';
import * as documentController from '../../controllers/portal/document.controller.js';
import * as downloadController from '../../controllers/portal/download.controller.js';
import * as invoiceController from '../../controllers/portal/invoice.controller.js';
import * as appointmentController from '../../controllers/portal/appointment.controller.js';
import * as careerController from '../../controllers/portal/career.controller.js';
import * as insuranceController from '../../controllers/portal/insurance.controller.js';
import * as webinarController from '../../controllers/portal/webinar.controller.js';
import * as messageController from '../../controllers/portal/message.controller.js';
import * as notificationController from '../../controllers/portal/notification.controller.js';
import * as resourceController from '../../controllers/portal/resource.controller.js';
import * as profileController from '../../controllers/portal/profile.controller.js';

export const portalRouter = Router();

portalRouter.use(requireAuth, requireStudent);

// ── Dashboard (PRD §5.2) ───────────────────────────────────────────────────
portalRouter.get('/', asyncHandler(dashboardController.index));

// ── My Applications & Progress Tracker (PRD §5.2, §5.3) ────────────────────
portalRouter.get('/applications', asyncHandler(applicationController.index));
portalRouter.get('/applications/:id', asyncHandler(applicationController.show));

// ── Document Centre (PRD §5.2) ─────────────────────────────────────────────
portalRouter.get('/documents', asyncHandler(documentController.index));
portalRouter.post(
  '/documents',
  uploadRateLimiter,
  singleDocument,
  audit({ action: 'CREATE', entity: 'Document' }),
  asyncHandler(documentController.upload),
);
// Streamed through a controller, never from a static directory (PRD §8.2).
portalRouter.get(
  '/documents/:id/download',
  audit({ action: 'DOWNLOAD', entity: 'Document', entityId: (req) => req.params.id }),
  asyncHandler(documentController.download),
);
portalRouter.post('/documents/:id/replace', uploadRateLimiter, singleDocument, asyncHandler(documentController.replace));
portalRouter.post('/documents/:id/delete', asyncHandler(documentController.destroy));

// ── Downloads — documents Waylen issued (PRD §5.2) ─────────────────────────
portalRouter.get('/downloads', asyncHandler(downloadController.index));
portalRouter.get(
  '/downloads/:id',
  audit({ action: 'DOWNLOAD', entity: 'Document', entityId: (req) => req.params.id }),
  asyncHandler(downloadController.download),
);

// ── Invoices & Payments (PRD §5.2) ─────────────────────────────────────────
portalRouter.get('/invoices', requireFeature('payments'), asyncHandler(invoiceController.index));
portalRouter.get('/invoices/:id', requireFeature('payments'), asyncHandler(invoiceController.show));
portalRouter.post(
  '/invoices/:id/pay',
  requireFeature('payments'),
  asyncHandler(invoiceController.startPayment),
);
portalRouter.post(
  '/invoices/:id/proof-of-payment',
  requireFeature('payments'),
  uploadRateLimiter,
  singleDocument,
  audit({ action: 'CREATE', entity: 'Payment', entityId: (req) => req.params.id }),
  asyncHandler(invoiceController.uploadProof),
);
portalRouter.get('/invoices/:id/receipt', requireFeature('payments'), asyncHandler(invoiceController.receipt));

// ── Appointments (PRD §5.2 — 45 min, Teams) ────────────────────────────────
portalRouter.get('/appointments', asyncHandler(appointmentController.index));
portalRouter.get('/appointments/new', asyncHandler(appointmentController.create));
portalRouter.post('/appointments', asyncHandler(appointmentController.store));
portalRouter.post('/appointments/:id/cancel', asyncHandler(appointmentController.cancel));

// ── Career Guidance (PRD §5.2) ─────────────────────────────────────────────
portalRouter.get('/career-guidance', asyncHandler(careerController.index));
portalRouter.get('/career-guidance/assessment', asyncHandler(careerController.assessment));
portalRouter.post('/career-guidance/assessment', asyncHandler(careerController.submitAssessment));

// ── Insurance (PRD §5.2, §6.1) ─────────────────────────────────────────────
portalRouter.get('/insurance', requireFeature('insurance'), asyncHandler(insuranceController.index));
portalRouter.get('/insurance/quote', requireFeature('insurance'), asyncHandler(insuranceController.quote));
portalRouter.post('/insurance/purchase', requireFeature('insurance'), asyncHandler(insuranceController.purchase));

// ── Webinar access (PRD §5.2) ──────────────────────────────────────────────
portalRouter.get('/webinars', asyncHandler(webinarController.index));
portalRouter.post('/webinars/:id/register', asyncHandler(webinarController.register));

// ── Messages (PRD §5.2 — secure, logged) ───────────────────────────────────
portalRouter.get('/messages', asyncHandler(messageController.index));
portalRouter.get('/messages/:threadId', asyncHandler(messageController.show));
portalRouter.post('/messages/:threadId/reply', asyncHandler(messageController.reply));
portalRouter.post('/messages', asyncHandler(messageController.createThread));

// ── Notifications (PRD §5.2) ───────────────────────────────────────────────
portalRouter.get('/notifications', asyncHandler(notificationController.index));
portalRouter.post('/notifications/:id/read', asyncHandler(notificationController.markRead));
portalRouter.post('/notifications/read-all', asyncHandler(notificationController.markAllRead));

// ── Resource Library (PRD §5.2) ────────────────────────────────────────────
portalRouter.get('/resources', asyncHandler(resourceController.index));
portalRouter.get('/resources/:slug', asyncHandler(resourceController.show));

// ── Profile & account ──────────────────────────────────────────────────────
portalRouter.get('/profile', asyncHandler(profileController.show));
portalRouter.post('/profile', asyncHandler(profileController.update));
portalRouter.post('/profile/password', asyncHandler(profileController.changePassword));
