/**
 * Downloads — documents Waylen has issued to the student (PRD §5.2).
 */
import type { Request, Response } from 'express';
import { documentService } from '../../services/document.service.js';
import { findStudentByUserId } from '../../models/student.model.js';
import { DOCUMENT_TYPE_LABELS } from '../../config/constants.js';
import { NotFoundError } from '../../utils/errors.js';

export async function index(req: Request, res: Response): Promise<void> {
  const student = await findStudentByUserId(req.currentUser!.id);
  if (!student) throw new NotFoundError('We could not find your student profile.');

  const documents = await documentService.listForStudent(student.id, { issuedByWaylen: true });

  res.render('portal/downloads/index', {
    title: 'Downloads',
    layout: 'layouts/portal',
    documents,
    typeLabels: DOCUMENT_TYPE_LABELS,
  });
}

export async function download(req: Request, res: Response): Promise<void> {
  const student = await findStudentByUserId(req.currentUser!.id);
  if (!student) throw new NotFoundError('We could not find your student profile.');

  const issued = await documentService.listForStudent(student.id, { issuedByWaylen: true });
  if (!issued.some((d) => d.id === req.params.id)) {
    throw new NotFoundError('That document could not be found.');
  }

  const file = await documentService.retrieve(req.params.id as string);

  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.filename)}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(file.buffer);
}
