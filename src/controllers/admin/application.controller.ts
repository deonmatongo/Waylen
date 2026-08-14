/**
 * Application management (PRD §5.4).
 */
import type { Request, Response } from 'express';
import { prisma } from '../../config/database.js';
import { applicationService } from '../../services/application.service.js';
import { staffVisibilityFilter } from '../../models/student.model.js';
import { assertCanAccessStudent } from '../../middleware/auth.js';
import { APPLICATION_STAGE_ORDER, APPLICATION_STAGE_LABELS } from '../../config/constants.js';
import { NotFoundError, ValidationError } from '../../utils/errors.js';

export async function index(req: Request, res: Response): Promise<void> {
  const user = req.currentUser!;
  const { stage, outcome } = req.query;

  const applications = await prisma.application.findMany({
    where: {
      studentProfile: staffVisibilityFilter(user.role, user.id),
      ...(stage ? { stage: stage as never } : {}),
      ...(outcome ? { outcome: outcome as never } : {}),
    },
    select: {
      id: true,
      reference: true,
      programmeName: true,
      stage: true,
      outcome: true,
      submittedAt: true,
      applicationDeadline: true,
      country: { select: { name: true } },
      studentProfile: {
        select: { id: true, reference: true, user: { select: { fullName: true } } },
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: 200,
  });

  res.render('admin/applications/index', {
    title: 'Applications',
    layout: 'layouts/admin',
    applications,
    stages: APPLICATION_STAGE_ORDER.map((s) => ({ value: s, label: APPLICATION_STAGE_LABELS[s] })),
    filters: { stage, outcome },
  });
}

export async function show(req: Request, res: Response): Promise<void> {
  const application = await prisma.application.findUnique({
    where: { id: req.params.id as string },
    include: {
      studentProfile: {
        select: { id: true, reference: true, user: { select: { fullName: true, email: true } } },
      },
      country: { select: { name: true } },
      institution: { select: { name: true, contactEmail: true } },
      opportunity: { select: { title: true } },
      events: { orderBy: { createdAt: 'desc' } },
      documents: { select: { id: true, type: true, status: true, originalFilename: true } },
    },
  });

  if (!application) throw new NotFoundError('That application could not be found.');
  await assertCanAccessStudent(req, application.studentProfile.id);

  const progress = await applicationService.buildProgress(application.id);

  res.render('admin/applications/show', {
    title: application.reference,
    layout: 'layouts/admin',
    application,
    progress,
    stages: APPLICATION_STAGE_ORDER.map((s) => ({ value: s, label: APPLICATION_STAGE_LABELS[s] })),
  });
}

export async function store(req: Request, res: Response): Promise<void> {
  const studentProfileId = typeof req.body?.studentProfileId === 'string' ? req.body.studentProfileId : '';
  if (!studentProfileId) throw new ValidationError('Select a student for this application.');

  await assertCanAccessStudent(req, studentProfileId);

  const application = await applicationService.create({
    studentProfileId,
    opportunityId: req.body?.opportunityId || undefined,
    countryId: req.body?.countryId || undefined,
    institutionId: req.body?.institutionId || undefined,
    programmeName: req.body?.programmeName || undefined,
    studyLevel: req.body?.studyLevel || undefined,
    intakePeriod: req.body?.intakePeriod || undefined,
    createdById: req.currentUser!.id,
  });

  req.flash('success', `Application ${application.reference} created.`);
  res.redirect(`/admin/applications/${application.id}`);
}

export async function updateStage(req: Request, res: Response): Promise<void> {
  const application = await prisma.application.findUnique({
    where: { id: req.params.id as string },
    select: { studentProfileId: true },
  });
  if (!application) throw new NotFoundError('That application could not be found.');
  await assertCanAccessStudent(req, application.studentProfileId);

  const stage = req.body?.stage;
  if (!APPLICATION_STAGE_ORDER.includes(stage)) throw new ValidationError('Select a valid stage.');

  await applicationService.changeStage(req.params.id as string, stage, {
    actorId: req.currentUser!.id,
    note: req.body?.note || undefined,
  });

  req.flash('success', 'Application stage updated and the student notified.');
  res.redirect(`/admin/applications/${req.params.id}`);
}

export async function updateOutcome(req: Request, res: Response): Promise<void> {
  const application = await prisma.application.findUnique({
    where: { id: req.params.id as string },
    select: { studentProfileId: true },
  });
  if (!application) throw new NotFoundError('That application could not be found.');
  await assertCanAccessStudent(req, application.studentProfileId);

  await applicationService.setOutcome(req.params.id as string, req.body?.outcome, {
    actorId: req.currentUser!.id,
    institutionNotes: req.body?.institutionNotes || undefined,
  });

  req.flash('success', 'Application outcome recorded.');
  res.redirect(`/admin/applications/${req.params.id}`);
}

export async function submitToInstitution(req: Request, res: Response): Promise<void> {
  const application = await prisma.application.findUnique({
    where: { id: req.params.id as string },
    select: {
      studentProfileId: true,
      documents: { select: { status: true } },
    },
  });
  if (!application) throw new NotFoundError('That application could not be found.');
  await assertCanAccessStudent(req, application.studentProfileId);

  // PRD §2.6 — documentation is standardised and verified before any
  // application reaches an institution.
  applicationService.assertReadyToSubmit(application.documents);

  await applicationService.changeStage(req.params.id as string, 'APPLICATION_SUBMITTED', {
    actorId: req.currentUser!.id,
    note: req.body?.note || 'Submitted to the institution',
  });

  req.flash('success', 'Marked as submitted to the institution.');
  res.redirect(`/admin/applications/${req.params.id}`);
}
