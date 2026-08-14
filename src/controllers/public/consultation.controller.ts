/**
 * Public "Book a Free Consultation" flow (PRD §A.13).
 *
 * Reachable before registration, so it creates a guest appointment plus a CRM
 * enquiry rather than requiring an account first.
 */
import type { Request, Response } from 'express';
import { consultationSchema } from '../../validators/contact.validator.js';
import { appointmentService } from '../../services/appointment.service.js';
import { APPOINTMENT_TYPE_LABELS } from '../../config/constants.js';

export async function show(req: Request, res: Response): Promise<void> {
  res.render('public/book-consultation', {
    title: 'Book a free consultation',
    metaDescription:
      'Book a 45-minute consultation with a Waylen counsellor — online or in person — and get a clear view of your options.',
    appointmentTypes: APPOINTMENT_TYPE_LABELS,
    values: {},
    errors: {},
  });
}

export async function submit(req: Request, res: Response): Promise<void> {
  const parsed = consultationSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(422).render('public/book-consultation', {
      title: 'Book a free consultation',
      appointmentTypes: APPOINTMENT_TYPE_LABELS,
      values: req.body,
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  await appointmentService.requestAsGuest(parsed.data);

  req.flash(
    'success',
    'Your consultation request has been received. We will confirm your time by email shortly.',
  );
  res.redirect('/book-consultation');
}
