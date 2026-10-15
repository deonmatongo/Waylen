/**
 * CRM (PRD §5.4) — every enquiry, consultation and student linked
 * end-to-end.
 */
import type { Request, Response } from 'express';
import { enquiryService } from '../../services/enquiry.service.js';
import { parseAssigneeId } from '../../services/staffAccess.service.js';
import { EnquiryStatus } from '@prisma/client';
import { ValidationError } from '../../utils/errors.js';
import { listCounsellors } from '../../models/student.model.js';

export async function index(req: Request, res: Response): Promise<void> {
  const { status, q } = req.query;

  const [results, counsellors] = await Promise.all([
    enquiryService.list({
      status: status as never,
      search: typeof q === 'string' ? q : undefined,
      viewer: req.currentUser!,
    }),
    listCounsellors(),
  ]);

  res.render('admin/enquiries/index', {
    title: 'CRM — enquiries',
    layout: 'layouts/admin',
    results,
    counsellors,
    filters: { status, q },
  });
}

export async function show(req: Request, res: Response): Promise<void> {
  const enquiry = await enquiryService.findById(req.params.id as string, req.currentUser);
  const counsellors = await listCounsellors();

  res.render('admin/enquiries/show', {
    title: `Enquiry from ${enquiry.fullName}`,
    layout: 'layouts/admin',
    enquiry,
    counsellors,
  });
}

export async function updateStatus(req: Request, res: Response): Promise<void> {
  await enquiryService.assertCanAccess(req.params.id as string, req.currentUser!);

  const status = req.body?.status;
  if (!Object.values(EnquiryStatus).includes(status)) throw new ValidationError('Choose a valid status.');

  await enquiryService.updateStatus(req.params.id as string, {
    status,
    staffNotes: req.body?.staffNotes || undefined,
    actorId: req.currentUser!.id,
  });

  req.flash('success', 'Enquiry updated.');
  res.redirect(`/admin/enquiries/${req.params.id}`);
}

export async function assign(req: Request, res: Response): Promise<void> {
  await enquiryService.assertCanAccess(req.params.id as string, req.currentUser!);
  await enquiryService.assign(req.params.id as string, parseAssigneeId(req.body?.assignedToId));

  req.flash('success', 'Enquiry reassigned.');
  res.redirect(`/admin/enquiries/${req.params.id}`);
}
