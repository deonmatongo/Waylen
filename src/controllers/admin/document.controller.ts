/**
 * Document review queue (PRD §5.4).
 */
import type { Request, Response } from 'express';
import { prisma } from '../../config/database.js';
import { documentService } from '../../services/document.service.js';
import { assertCanAccessStudent } from '../../middleware/auth.js';
import { DOCUMENT_TYPE_LABELS } from '../../config/constants.js';
import { reviewSchema } from '../../validators/document.validator.js';
import { NotFoundError, ValidationError } from '../../utils/errors.js';
import { sendStoredFile } from '../../utils/fileResponse.js';

export async function queue(req: Request, res: Response): Promise<void> {
  const user = req.currentUser!;

  const documents = await documentService.listReviewQueue({
    counsellorId: user.role === 'COUNSELLOR' ? user.id : undefined,
  });

  res.render('admin/documents/queue', {
    title: 'Document review',
    layout: 'layouts/admin',
    documents,
    typeLabels: DOCUMENT_TYPE_LABELS,
  });
}

export async function view(req: Request, res: Response): Promise<void> {
  const document = await prisma.document.findUnique({
    where: { id: req.params.id as string },
    select: { studentProfileId: true },
  });
  if (!document) throw new NotFoundError('That document could not be found.');
  await assertCanAccessStudent(req, document.studentProfileId);

  const file = await documentService.retrieve(req.params.id as string);

  // Inline (PDF and images only) so reviewers can read without downloading;
  // anything else is forced to a download.
  sendStoredFile(res, file, { inline: true });
}

export async function approve(req: Request, res: Response): Promise<void> {
  const document = await prisma.document.findUnique({
    where: { id: req.params.id as string },
    select: { studentProfileId: true },
  });
  if (!document) throw new NotFoundError('That document could not be found.');
  await assertCanAccessStudent(req, document.studentProfileId);

  await documentService.review({
    documentId: req.params.id as string,
    reviewerId: req.currentUser!.id,
    status: 'APPROVED',
    notes: req.body?.notes || undefined,
  });

  req.flash('success', 'Document approved and the student notified.');
  res.redirect('/admin/documents');
}

export async function reject(req: Request, res: Response): Promise<void> {
  const document = await prisma.document.findUnique({
    where: { id: req.params.id as string },
    select: { studentProfileId: true },
  });
  if (!document) throw new NotFoundError('That document could not be found.');
  await assertCanAccessStudent(req, document.studentProfileId);

  const parsed = reviewSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError('Please explain what needs correcting.', parsed.error.flatten().fieldErrors);
  }

  await documentService.review({
    documentId: req.params.id as string,
    reviewerId: req.currentUser!.id,
    status: 'NEEDS_CORRECTION',
    notes: parsed.data.notes,
  });

  req.flash('success', 'Correction requested and the student notified.');
  res.redirect('/admin/documents');
}

export async function requestResubmission(req: Request, res: Response): Promise<void> {
  // Same outcome as a rejection, kept as a distinct route so the back-office
  // wording can differ without changing the underlying transition.
  const document = await prisma.document.findUnique({
    where: { id: req.params.id as string },
    select: { studentProfileId: true },
  });
  if (!document) throw new NotFoundError('That document could not be found.');
  await assertCanAccessStudent(req, document.studentProfileId);

  const parsed = reviewSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError('Please explain what the student needs to resubmit.');
  }

  await documentService.review({
    documentId: req.params.id as string,
    reviewerId: req.currentUser!.id,
    status: 'NEEDS_CORRECTION',
    notes: parsed.data.notes,
  });

  req.flash('success', 'Resubmission requested.');
  res.redirect('/admin/documents');
}
