/**
 * Contracts & Agreements — the student's side (client navigation feedback).
 */
import type { Request, Response } from 'express';
import { contractService } from '../../services/contract.service.js';
import { findStudentByUserId } from '../../models/student.model.js';
import { CONTRACT_STATUS_LABELS, DOCUMENTS_TABS } from '../../config/constants.js';
import { NotFoundError } from '../../utils/errors.js';

export async function index(req: Request, res: Response): Promise<void> {
  const student = await findStudentByUserId(req.currentUser!.id);
  if (!student) throw new NotFoundError('We could not find your student profile.');

  const contracts = await contractService.listForStudent(student.id);

  res.render('portal/contracts/index', {
    title: 'Contracts & agreements',
    layout: 'layouts/portal',
    contracts,
    statusLabels: CONTRACT_STATUS_LABELS,
    documentsTabs: DOCUMENTS_TABS,
  });
}

export async function download(req: Request, res: Response): Promise<void> {
  const student = await findStudentByUserId(req.currentUser!.id);
  if (!student) throw new NotFoundError('We could not find your student profile.');

  // Ownership check before anything is read from storage.
  const owned = await contractService.listForStudent(student.id);
  if (!owned.some((c) => c.id === req.params.id)) {
    throw new NotFoundError('That contract could not be found.');
  }

  const file = await contractService.retrieve(req.params.id as string);
  // `?download=1` forces a save-as; otherwise the browser is free to render
  // it inline — the "View" and "Download" actions share this one route.
  const disposition = req.query.download === '1' ? 'attachment' : 'inline';

  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(file.filename)}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(file.buffer);
}
