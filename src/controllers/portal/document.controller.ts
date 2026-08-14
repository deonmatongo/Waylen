/**
 * Document Centre — the student's side (PRD §5.2).
 */
import type { Request, Response } from 'express';
import { documentService } from '../../services/document.service.js';
import { findStudentByUserId } from '../../models/student.model.js';
import { documentUploadSchema } from '../../validators/document.validator.js';
import { DOCUMENT_TYPE_LABELS, STUDENT_UPLOAD_DOCUMENT_TYPES } from '../../config/constants.js';
import { NotFoundError, ValidationError } from '../../utils/errors.js';

export async function index(req: Request, res: Response): Promise<void> {
  const student = await findStudentByUserId(req.currentUser!.id);
  if (!student) throw new NotFoundError('We could not find your student profile.');

  const [documents, outstanding] = await Promise.all([
    documentService.listForStudent(student.id, { issuedByWaylen: false }),
    documentService.outstandingRequirements(student.id),
  ]);

  res.render('portal/documents/index', {
    title: 'Document centre',
    layout: 'layouts/portal',
    documents,
    outstanding: outstanding.map((type) => ({ type, label: DOCUMENT_TYPE_LABELS[type] })),
    uploadableTypes: STUDENT_UPLOAD_DOCUMENT_TYPES.map((type) => ({
      value: type,
      label: DOCUMENT_TYPE_LABELS[type],
    })),
  });
}

export async function upload(req: Request, res: Response): Promise<void> {
  const student = await findStudentByUserId(req.currentUser!.id);
  if (!student) throw new NotFoundError('We could not find your student profile.');
  if (!req.file) throw new ValidationError('Please choose a file to upload.');

  const parsed = documentUploadSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError('Please choose which type of document this is.');
  }

  await documentService.uploadForStudent({
    studentProfileId: student.id,
    uploadedById: req.currentUser!.id,
    type: parsed.data.type,
    file: req.file,
    applicationId: parsed.data.applicationId,
  });

  req.flash('success', 'Your document has been uploaded and is now under review.');
  res.redirect('/portal/documents');
}

export async function download(req: Request, res: Response): Promise<void> {
  const student = await findStudentByUserId(req.currentUser!.id);
  if (!student) throw new NotFoundError('We could not find your student profile.');

  // Ownership check before anything is read from storage.
  const owned = await documentService.listForStudent(student.id);
  if (!owned.some((d) => d.id === req.params.id)) {
    throw new NotFoundError('That document could not be found.');
  }

  const file = await documentService.retrieve(req.params.id as string);

  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.filename)}"`);
  // Confidential — never cached by an intermediary (PRD §8.2).
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(file.buffer);
}

export async function replace(req: Request, res: Response): Promise<void> {
  const student = await findStudentByUserId(req.currentUser!.id);
  if (!student) throw new NotFoundError('We could not find your student profile.');
  if (!req.file) throw new ValidationError('Please choose a file to upload.');

  // A correction is a delete-then-upload so the review trail stays clean.
  const existing = await documentService.listForStudent(student.id, { issuedByWaylen: false });
  const target = existing.find((d) => d.id === req.params.id);
  if (!target) throw new NotFoundError('That document could not be found.');

  await documentService.deleteForStudent(target.id, student.id);
  await documentService.uploadForStudent({
    studentProfileId: student.id,
    uploadedById: req.currentUser!.id,
    type: target.type,
    file: req.file,
  });

  req.flash('success', 'Your corrected document has been uploaded and is under review.');
  res.redirect('/portal/documents');
}

export async function destroy(req: Request, res: Response): Promise<void> {
  const student = await findStudentByUserId(req.currentUser!.id);
  if (!student) throw new NotFoundError('We could not find your student profile.');

  await documentService.deleteForStudent(req.params.id as string, student.id);

  req.flash('success', 'That document has been removed.');
  res.redirect('/portal/documents');
}
