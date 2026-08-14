/**
 * Student management (PRD §5.4).
 *
 * Counsellors see only their assigned students; the scoping filter comes from
 * the model layer so it cannot be forgotten here.
 */
import type { Request, Response } from 'express';
import { prisma } from '../../config/database.js';
import {
  listStudents,
  findStudentById,
  listCounsellors,
  staffVisibilityFilter,
} from '../../models/student.model.js';
import { documentService } from '../../services/document.service.js';
import { auditService } from '../../services/audit.service.js';
import { assertCanAccessStudent } from '../../middleware/auth.js';
import { APPLICATION_STAGE_ORDER, APPLICATION_STAGE_LABELS, WAYLEN_ISSUED_DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS } from '../../config/constants.js';
import { issueDocumentSchema } from '../../validators/document.validator.js';
import { NotFoundError, ValidationError } from '../../utils/errors.js';

export async function index(req: Request, res: Response): Promise<void> {
  const user = req.currentUser!;
  const { q, stage, counsellor, page } = req.query;

  const [results, counsellors] = await Promise.all([
    listStudents(staffVisibilityFilter(user.role, user.id), {
      search: typeof q === 'string' ? q : undefined,
      stage: stage as never,
      counsellorId: typeof counsellor === 'string' ? counsellor : undefined,
      page: Number(page) || 1,
    }),
    listCounsellors(),
  ]);

  res.render('admin/students/index', {
    title: 'Students',
    layout: 'layouts/admin',
    results,
    counsellors,
    stages: APPLICATION_STAGE_ORDER.map((s) => ({ value: s, label: APPLICATION_STAGE_LABELS[s] })),
    filters: { q, stage, counsellor },
  });
}

export async function show(req: Request, res: Response): Promise<void> {
  await assertCanAccessStudent(req, req.params.id as string);

  const [student, counsellors, auditTrail] = await Promise.all([
    findStudentById(req.params.id as string),
    listCounsellors(),
    auditService.listForStudent(req.params.id as string, 25),
  ]);

  if (!student) throw new NotFoundError('That student could not be found.');

  res.render('admin/students/show', {
    title: student.user.fullName,
    layout: 'layouts/admin',
    student,
    counsellors,
    auditTrail,
    stageLabels: APPLICATION_STAGE_LABELS,
    issuableTypes: WAYLEN_ISSUED_DOCUMENT_TYPES.map((type) => ({
      value: type,
      label: DOCUMENT_TYPE_LABELS[type],
    })),
  });
}

export async function assignCounsellor(req: Request, res: Response): Promise<void> {
  await assertCanAccessStudent(req, req.params.id as string);

  const counsellorId = typeof req.body?.counsellorId === 'string' ? req.body.counsellorId : null;

  const before = await prisma.studentProfile.findUnique({
    where: { id: req.params.id as string },
    select: { assignedCounsellorId: true },
  });
  if (!before) throw new NotFoundError('That student could not be found.');

  await prisma.studentProfile.update({
    where: { id: req.params.id as string },
    data: { assignedCounsellorId: counsellorId || null },
  });

  await auditService.recordUpdate(
    {
      actorId: req.currentUser!.id,
      entity: 'StudentProfile',
      entityId: req.params.id,
      studentProfileId: req.params.id,
    },
    { assignedCounsellorId: before.assignedCounsellorId },
    { assignedCounsellorId: counsellorId || null },
  );

  req.flash('success', 'Counsellor assignment updated.');
  res.redirect(`/admin/students/${req.params.id}`);
}

export async function addNote(req: Request, res: Response): Promise<void> {
  await assertCanAccessStudent(req, req.params.id as string);

  const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
  if (!body) throw new ValidationError('Please write a note before saving.');

  // Internal notes are stored as staff-only messages so the whole
  // correspondence history for a student lives in one place (PRD §5.4 CRM).
  const thread = await prisma.messageThread.findFirst({
    where: { studentProfileId: req.params.id as string, subject: 'Internal notes' },
    select: { id: true },
  });

  const threadId =
    thread?.id ??
    (
      await prisma.messageThread.create({
        data: { studentProfileId: req.params.id as string, subject: 'Internal notes' },
        select: { id: true },
      })
    ).id;

  await prisma.message.create({
    data: { threadId, senderId: req.currentUser!.id, body, isInternal: true },
  });

  req.flash('success', 'Note added.');
  res.redirect(`/admin/students/${req.params.id}`);
}

export async function issueDocument(req: Request, res: Response): Promise<void> {
  await assertCanAccessStudent(req, req.params.id as string);

  if (!req.file) throw new ValidationError('Please choose a file to upload.');

  const parsed = issueDocumentSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError('Please choose which type of document this is.', parsed.error.flatten().fieldErrors);
  }

  // PRD §5.4: Bee must be able to upload offer and acceptance letters onto a
  // student's file at any stage, with the student notified automatically.
  await documentService.issueToStudent({
    studentProfileId: req.params.id as string,
    issuedById: req.currentUser!.id,
    type: parsed.data.type,
    file: req.file,
    applicationId: parsed.data.applicationId,
    note: parsed.data.note,
  });

  req.flash('success', 'Document added to the student file — they have been notified.');
  res.redirect(`/admin/students/${req.params.id}`);
}
