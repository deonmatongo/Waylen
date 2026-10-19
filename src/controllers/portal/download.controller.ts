/**
 * Downloads — documents Waylen has issued to the student (PRD §5.2).
 */
import type { Request, Response } from 'express';
import { documentService } from '../../services/document.service.js';
import { findStudentByUserId } from '../../models/student.model.js';
import { DOCUMENT_TYPE_LABELS, DOCUMENTS_TABS } from '../../config/constants.js';
import { NotFoundError } from '../../utils/errors.js';
import { sendStoredFile } from '../../utils/fileResponse.js';
import { buildPageMeta, parsePage } from '../../utils/pagination.js';

export async function index(req: Request, res: Response): Promise<void> {
  const student = await findStudentByUserId(req.currentUser!.id);
  if (!student) throw new NotFoundError('We could not find your student profile.');

  const pageReq = parsePage(req.query, { perPage: 20 });
  const { items: documents, total } = await documentService.listPageForStudent(student.id, {
    issuedByWaylen: true,
    skip: pageReq.skip,
    take: pageReq.take,
  });

  res.render('portal/downloads/index', {
    title: 'Waylen documents',
    layout: 'layouts/portal',
    documents,
    pageMeta: buildPageMeta(pageReq, total),
    typeLabels: DOCUMENT_TYPE_LABELS,
    documentsTabs: DOCUMENTS_TABS,
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

  sendStoredFile(res, file);
}
