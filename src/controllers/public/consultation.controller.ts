/**
 * Public "Book a Free Consultation" flow (PRD §A.13).
 *
 * Reachable before registration, so it creates a guest appointment plus a CRM
 * enquiry rather than requiring an account first.
 */
import type { Request, Response } from 'express';
import { consultationSchema } from '../../validators/contact.validator.js';
import { appointmentService } from '../../services/appointment.service.js';
import { isGraphConfigured } from '../../services/graph-client.service.js';
import { APPOINTMENT_TYPE_LABELS } from '../../config/constants.js';

/** Groups flat slots into per-day buckets for the picker, in display order. */
function groupSlotsByDay(slots: Date[]): Array<{ dateLabel: string; slots: Date[] }> {
  const days = new Map<string, Date[]>();
  for (const slot of slots) {
    const key = slot.toDateString();
    if (!days.has(key)) days.set(key, []);
    days.get(key)!.push(slot);
  }
  return Array.from(days.entries()).map(([dateLabel, daySlots]) => ({ dateLabel, slots: daySlots }));
}

export async function show(req: Request, res: Response): Promise<void> {
  const slots = await appointmentService.availableSlots();

  res.render('public/book-consultation', {
    title: 'Book a free consultation',
    metaDescription:
      'Book a 45-minute consultation with a Waylen counsellor — online or in person — and get a clear view of your options.',
    appointmentTypes: APPOINTMENT_TYPE_LABELS,
    slotDays: groupSlotsByDay(slots),
    liveAvailability: isGraphConfigured,
    values: {},
    errors: {},
  });
}

export async function submit(req: Request, res: Response): Promise<void> {
  const parsed = consultationSchema.safeParse(req.body);

  if (!parsed.success) {
    const slots = await appointmentService.availableSlots();
    res.status(422).render('public/book-consultation', {
      title: 'Book a free consultation',
      appointmentTypes: APPOINTMENT_TYPE_LABELS,
      slotDays: groupSlotsByDay(slots),
      liveAvailability: isGraphConfigured,
      values: req.body,
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const { autoConfirmed } = await appointmentService.bookGuestConsultation(parsed.data);

  req.flash(
    'success',
    autoConfirmed
      ? "You're booked. We've sent a calendar invite with your Teams link to your email."
      : 'Your consultation request has been received. We will confirm your time by email shortly.',
  );
  res.redirect('/book-consultation');
}
