/**
 * Back-office routes — PRD §5.4.
 *
 * Counsellors, admin staff and super admins share this router; per-route
 * `requireRole` narrows the sensitive operations. Counsellor visibility is
 * additionally scoped to their assigned students inside the controllers via
 * `assertCanAccessStudent`.
 */
import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { requireAuth, requireStaff, requireRole, requireSuperAdmin } from '../../middleware/auth.js';
import { singleDocument } from '../../middleware/upload.js';
import { audit } from '../../middleware/audit.js';
import { requireFeature } from '../../middleware/feature.js';

import * as overviewController from '../../controllers/admin/overview.controller.js';
import * as studentController from '../../controllers/admin/student.controller.js';
import * as applicationController from '../../controllers/admin/application.controller.js';
import * as documentController from '../../controllers/admin/document.controller.js';
import * as appointmentController from '../../controllers/admin/appointment.controller.js';
import * as invoiceController from '../../controllers/admin/invoice.controller.js';
import * as webinarController from '../../controllers/admin/webinar.controller.js';
import * as contentController from '../../controllers/admin/content.controller.js';
import * as countryController from '../../controllers/admin/country.controller.js';
import * as partnerController from '../../controllers/admin/partner.controller.js';
import * as referralController from '../../controllers/admin/referral.controller.js';
import * as enquiryController from '../../controllers/admin/enquiry.controller.js';
import * as reportController from '../../controllers/admin/report.controller.js';
import * as auditController from '../../controllers/admin/audit.controller.js';
import * as settingsController from '../../controllers/admin/settings.controller.js';
import * as userController from '../../controllers/admin/user.controller.js';

export const adminRouter = Router();

adminRouter.use(requireAuth, requireStaff);

// ── Overview ───────────────────────────────────────────────────────────────
adminRouter.get('/', asyncHandler(overviewController.index));

// ── Student management (PRD §5.4) ──────────────────────────────────────────
adminRouter.get('/students', asyncHandler(studentController.index));
adminRouter.get(
  '/students/:id',
  audit({
    action: 'VIEW',
    entity: 'StudentProfile',
    entityId: (req) => req.params.id,
    studentProfileId: (req) => req.params.id,
  }),
  asyncHandler(studentController.show),
);
adminRouter.post('/students/:id/assign-counsellor', asyncHandler(studentController.assignCounsellor));
adminRouter.post('/students/:id/notes', asyncHandler(studentController.addNote));
adminRouter.post(
  '/students/:id/documents',
  singleDocument,
  audit({
    action: 'CREATE',
    entity: 'Document',
    studentProfileId: (req) => req.params.id,
  }),
  // PRD §5.4 key operational requirement: Bee uploads offer/acceptance letters
  // onto a student's file at any stage, and the student is notified.
  asyncHandler(studentController.issueDocument),
);

// ── Application management (PRD §5.4) ──────────────────────────────────────
adminRouter.get('/applications', asyncHandler(applicationController.index));
adminRouter.get('/applications/:id', asyncHandler(applicationController.show));
adminRouter.post('/applications', asyncHandler(applicationController.store));
adminRouter.post('/applications/:id/stage', asyncHandler(applicationController.updateStage));
adminRouter.post('/applications/:id/outcome', asyncHandler(applicationController.updateOutcome));
adminRouter.post('/applications/:id/submit', asyncHandler(applicationController.submitToInstitution));

// ── Document review (PRD §5.4) ─────────────────────────────────────────────
adminRouter.get('/documents', asyncHandler(documentController.queue));
adminRouter.get(
  '/documents/:id/view',
  audit({ action: 'VIEW', entity: 'Document', entityId: (req) => req.params.id }),
  asyncHandler(documentController.view),
);
adminRouter.post('/documents/:id/approve', asyncHandler(documentController.approve));
adminRouter.post('/documents/:id/reject', asyncHandler(documentController.reject));
adminRouter.post('/documents/:id/request-resubmission', asyncHandler(documentController.requestResubmission));

// ── Appointment management (PRD §5.4) ──────────────────────────────────────
adminRouter.get('/appointments', asyncHandler(appointmentController.index));
adminRouter.post('/appointments/:id/confirm', asyncHandler(appointmentController.confirm));
adminRouter.post('/appointments/:id/reschedule', asyncHandler(appointmentController.reschedule));
adminRouter.post('/appointments/:id/cancel', asyncHandler(appointmentController.cancel));
adminRouter.post('/appointments/:id/complete', asyncHandler(appointmentController.complete));

// ── Payments & invoicing (PRD §5.4) ────────────────────────────────────────
adminRouter.use('/invoices', requireFeature('payments'));
adminRouter.get('/invoices', asyncHandler(invoiceController.index));
adminRouter.get('/invoices/new', asyncHandler(invoiceController.create));
adminRouter.post('/invoices', asyncHandler(invoiceController.store));
adminRouter.get('/invoices/:id', asyncHandler(invoiceController.show));
adminRouter.post('/invoices/:id/send', asyncHandler(invoiceController.send));
adminRouter.post('/invoices/:id/record-payment', asyncHandler(invoiceController.recordPayment));
adminRouter.post('/invoices/:id/remind', asyncHandler(invoiceController.sendReminder));
adminRouter.post('/invoices/:id/void', requireRole('ADMIN_STAFF', 'SUPER_ADMIN'), asyncHandler(invoiceController.voidInvoice));

// ── Webinar management (PRD §5.4) ──────────────────────────────────────────
adminRouter.get('/webinars', asyncHandler(webinarController.index));
adminRouter.get('/webinars/new', asyncHandler(webinarController.create));
adminRouter.post('/webinars', asyncHandler(webinarController.store));
adminRouter.get('/webinars/:id/edit', asyncHandler(webinarController.edit));
adminRouter.post('/webinars/:id', asyncHandler(webinarController.update));
adminRouter.get('/webinars/:id/registrations', asyncHandler(webinarController.registrations));
adminRouter.get('/webinars/:id/attendance', asyncHandler(webinarController.attendanceReport));

// ── Content management (PRD §5.4 — CMS for non-technical staff, §8.1) ───────
adminRouter.get('/content', asyncHandler(contentController.index));
adminRouter.get('/content/resources', asyncHandler(contentController.resources));
adminRouter.get('/content/resources/new', asyncHandler(contentController.createResource));
adminRouter.post('/content/resources', asyncHandler(contentController.storeResource));
adminRouter.get('/content/resources/:id/edit', asyncHandler(contentController.editResource));
adminRouter.post('/content/resources/:id', asyncHandler(contentController.updateResource));
adminRouter.get('/content/opportunities', asyncHandler(contentController.opportunities));
adminRouter.get('/content/opportunities/new', asyncHandler(contentController.createOpportunity));
adminRouter.post('/content/opportunities', asyncHandler(contentController.storeOpportunity));
adminRouter.get('/content/opportunities/:id/edit', asyncHandler(contentController.editOpportunity));
adminRouter.post('/content/opportunities/:id', asyncHandler(contentController.updateOpportunity));
adminRouter.get('/content/faqs', asyncHandler(contentController.faqs));
adminRouter.get('/content/testimonials', asyncHandler(contentController.testimonials));

// ── Country management (PRD §4.3, §5.4) ────────────────────────────────────
adminRouter.get('/countries', asyncHandler(countryController.index));
adminRouter.get('/countries/new', asyncHandler(countryController.create));
adminRouter.post('/countries', asyncHandler(countryController.store));
adminRouter.get('/countries/:id/edit', asyncHandler(countryController.edit));
adminRouter.post('/countries/:id', asyncHandler(countryController.update));

// ── Partner Directory & referrals (PRD §6.2) ───────────────────────────────
adminRouter.use('/partners', requireFeature('partnerDirectory'));
adminRouter.use('/referrals', requireFeature('partnerDirectory'));
adminRouter.get('/partners', asyncHandler(partnerController.index));
adminRouter.get('/partners/new', asyncHandler(partnerController.create));
adminRouter.post('/partners', asyncHandler(partnerController.store));
adminRouter.get('/partners/:id', asyncHandler(partnerController.show));
adminRouter.get('/partners/:id/edit', asyncHandler(partnerController.edit));
adminRouter.post('/partners/:id', asyncHandler(partnerController.update));
adminRouter.get('/referrals', asyncHandler(referralController.index));
adminRouter.post('/referrals', asyncHandler(referralController.store));
adminRouter.post('/referrals/:id/status', asyncHandler(referralController.updateStatus));

// ── CRM (PRD §5.4) ─────────────────────────────────────────────────────────
adminRouter.get('/enquiries', asyncHandler(enquiryController.index));
adminRouter.get('/enquiries/:id', asyncHandler(enquiryController.show));
adminRouter.post('/enquiries/:id/status', asyncHandler(enquiryController.updateStatus));
adminRouter.post('/enquiries/:id/assign', asyncHandler(enquiryController.assign));

// ── Reporting & analytics (PRD §5.4, §10) ──────────────────────────────────
adminRouter.get('/reports', asyncHandler(reportController.index));
adminRouter.get('/reports/students', asyncHandler(reportController.students));
adminRouter.get('/reports/applications', asyncHandler(reportController.applications));
adminRouter.get('/reports/destinations', asyncHandler(reportController.destinations));
adminRouter.get('/reports/revenue', requireRole('ADMIN_STAFF', 'SUPER_ADMIN'), asyncHandler(reportController.revenue));
adminRouter.get(
  '/reports/export',
  requireRole('ADMIN_STAFF', 'SUPER_ADMIN'),
  audit({ action: 'EXPORT', entity: 'Report' }),
  asyncHandler(reportController.exportCsv),
);

// ── Governance (PRD §8.2) ──────────────────────────────────────────────────
adminRouter.get('/audit', requireSuperAdmin, asyncHandler(auditController.index));

// ── Staff & settings ───────────────────────────────────────────────────────
adminRouter.get('/users', requireSuperAdmin, asyncHandler(userController.index));
adminRouter.post('/users', requireSuperAdmin, asyncHandler(userController.store));
adminRouter.post('/users/:id/role', requireSuperAdmin, asyncHandler(userController.updateRole));
adminRouter.post('/users/:id/suspend', requireSuperAdmin, asyncHandler(userController.suspend));

adminRouter.get('/settings', requireSuperAdmin, asyncHandler(settingsController.index));
adminRouter.post('/settings', requireSuperAdmin, asyncHandler(settingsController.update));
