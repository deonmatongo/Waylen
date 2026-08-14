/**
 * CRM (PRD §5.4) — every enquiry, consultation and student linked
 * end-to-end.
 */
import type { Request, Response } from 'express';
import { enquiryService } from '../../services/enquiry.service.js';
import { listCounsellors } from '../../models/student.model.js';

export async function index(req: Request, res: Response): Promise<void> {
  const { status, q } = req.query;

  const [results, counsellors] = await Promise.all([
    enquiryService.list({
      status: status as never,
      search: typeof q === 'string' ? q : undefined,
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
  const enquiry = await enquiryService.findById(req.params.id as string);
  const counsellors = await listCounsellors();

  res.render('admin/enquiries/show', {
    title: `Enquiry from ${enquiry.fullName}`,
    layout: 'layouts/admin',
    enquiry,
    counsellors,
  });
}

export async function updateStatus(req: Request, res: Response): Promise<void> {
  await enquiryService.updateStatus(req.params.id as string, {
    status: req.body?.status,
    staffNotes: req.body?.staffNotes || undefined,
    actorId: req.currentUser!.id,
  });

  req.flash('success', 'Enquiry updated.');
  res.redirect(`/admin/enquiries/${req.params.id}`);
}

export async function assign(req: Request, res: Response): Promise<void> {
  await enquiryService.assign(req.params.id as string, req.body?.assignedToId || null);

  req.flash('success', 'Enquiry reassigned.');
  res.redirect(`/admin/enquiries/${req.params.id}`);
}
