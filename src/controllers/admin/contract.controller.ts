/**
 * Contracts & Agreements — staff side (client navigation feedback).
 */
import type { Request, Response } from 'express';
import { prisma } from '../../config/database.js';
import { contractService } from '../../services/contract.service.js';
import { assertCanAccessStudent } from '../../middleware/auth.js';
import { issueContractSchema, contractStatusSchema } from '../../validators/contract.validator.js';
import { NotFoundError, ValidationError } from '../../utils/errors.js';

export async function issue(req: Request, res: Response): Promise<void> {
  await assertCanAccessStudent(req, req.params.id as string);

  if (!req.file) throw new ValidationError('Please choose a file to upload.');

  const parsed = issueContractSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError('Please give this agreement a title.', parsed.error.flatten().fieldErrors);
  }

  await contractService.issueToStudent({
    studentProfileId: req.params.id as string,
    createdById: req.currentUser!.id,
    title: parsed.data.title,
    file: req.file,
  });

  req.flash('success', 'Agreement added to the student file — they have been notified.');
  res.redirect(`/admin/students/${req.params.id}`);
}

export async function view(req: Request, res: Response): Promise<void> {
  const contract = await prisma.contract.findUnique({
    where: { id: req.params.id as string },
    select: { studentProfileId: true },
  });
  if (!contract) throw new NotFoundError('That agreement could not be found.');
  await assertCanAccessStudent(req, contract.studentProfileId);

  const file = await contractService.retrieve(req.params.id as string);

  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.filename)}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(file.buffer);
}

export async function updateStatus(req: Request, res: Response): Promise<void> {
  const contract = await prisma.contract.findUnique({
    where: { id: req.params.id as string },
    select: { studentProfileId: true },
  });
  if (!contract) throw new NotFoundError('That agreement could not be found.');
  await assertCanAccessStudent(req, contract.studentProfileId);

  const parsed = contractStatusSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Choose a valid status.');

  await contractService.updateStatus({
    contractId: req.params.id as string,
    status: parsed.data.status,
    actorId: req.currentUser!.id,
  });

  req.flash('success', 'Agreement status updated.');
  res.redirect('back');
}
