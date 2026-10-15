/**
 * Documents, Waylen-issued downloads and contracts over the JSON API.
 * Every read checks ownership against the student's own list before anything
 * is fetched from storage, exactly as the web portal does.
 */
import type { Request, Response } from 'express';
import { documentService } from '../../services/document.service.js';
import { contractService } from '../../services/contract.service.js';
import { documentUploadSchema } from '../../validators/document.validator.js';
import { downloadQuerySchema, idParamSchema } from '../../validators/api.validator.js';
import { CONTRACT_STATUS_LABELS, DOCUMENT_TYPE_LABELS } from '../../config/constants.js';
import { NotFoundError, ValidationError } from '../../utils/errors.js';
import { paginate, parse, parsePagination, requireStudent, sendFile } from './helpers.js';

/** GET /documents — legacy `documents`/`outstanding` keys plus the pagination envelope. */
export async function list(req: Request, res: Response): Promise<void> {
  const student = await requireStudent(req);
  const [documents, outstanding] = await Promise.all([
    documentService.listForStudent(student.id, { issuedByWaylen: false }),
    documentService.outstandingRequirements(student.id),
  ]);

  const labelled = documents.map((d) => ({ ...d, typeLabel: DOCUMENT_TYPE_LABELS[d.type] }));
  res.json({
    ...paginate(labelled, parsePagination(req)),
    documents: labelled,
    outstanding: outstanding.map((type) => ({ type, label: DOCUMENT_TYPE_LABELS[type] })),
  });
}

/** POST /documents (multipart: `document` file + `type`, optional `applicationId`) */
export async function upload(req: Request, res: Response): Promise<void> {
  const student = await requireStudent(req);
  if (!req.file) throw new ValidationError('Please choose a file to upload.');
  const input = parse(documentUploadSchema, req.body, 'Please choose which type of document this is.');

  const document = await documentService.uploadForStudent({
    studentProfileId: student.id,
    uploadedById: req.currentUser!.id,
    type: input.type,
    file: req.file,
    applicationId: input.applicationId,
  });

  res.status(201).json({
    id: document.id,
    type: document.type,
    typeLabel: DOCUMENT_TYPE_LABELS[document.type],
    status: document.status,
    originalFilename: document.originalFilename,
    createdAt: document.createdAt,
  });
}

/** GET /documents/:id/download */
export async function download(req: Request, res: Response): Promise<void> {
  const student = await requireStudent(req);
  const { id } = parse(idParamSchema, req.params);

  const owned = await documentService.listForStudent(student.id);
  if (!owned.some((d) => d.id === id)) throw new NotFoundError('That document could not be found.');

  sendFile(res, await documentService.retrieve(id));
}

/** GET /downloads — documents Waylen has issued to the student. */
export async function listDownloads(req: Request, res: Response): Promise<void> {
  const student = await requireStudent(req);
  const documents = await documentService.listForStudent(student.id, { issuedByWaylen: true });
  res.json(paginate(documents.map((d) => ({ ...d, typeLabel: DOCUMENT_TYPE_LABELS[d.type] })), parsePagination(req)));
}

/** GET /downloads/:id/download */
export async function downloadIssued(req: Request, res: Response): Promise<void> {
  const student = await requireStudent(req);
  const { id } = parse(idParamSchema, req.params);

  const issued = await documentService.listForStudent(student.id, { issuedByWaylen: true });
  if (!issued.some((d) => d.id === id)) throw new NotFoundError('That document could not be found.');

  sendFile(res, await documentService.retrieve(id));
}

/** GET /contracts */
export async function listContracts(req: Request, res: Response): Promise<void> {
  const student = await requireStudent(req);
  const contracts = await contractService.listForStudent(student.id);
  res.json(
    paginate(
      contracts.map((c) => ({ ...c, statusLabel: CONTRACT_STATUS_LABELS[c.status] })),
      parsePagination(req),
    ),
  );
}

/** GET /contracts/:id/download — `?download=1` forces a save-as, otherwise inline. */
export async function downloadContract(req: Request, res: Response): Promise<void> {
  const student = await requireStudent(req);
  const { id } = parse(idParamSchema, req.params);
  const query = parse(downloadQuerySchema, req.query);

  const owned = await contractService.listForStudent(student.id);
  if (!owned.some((c) => c.id === id)) throw new NotFoundError('That contract could not be found.');

  sendFile(res, await contractService.retrieve(id), query.download === '1' ? 'attachment' : 'inline');
}
