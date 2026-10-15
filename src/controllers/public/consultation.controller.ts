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
import { businessFormatter } from '../../services/availability.service.js';
import type { ZonedFormatter } from '../../utils/timezone.js';

/** Groups flat slots into per-business-day buckets for the picker, in display order. */
function groupSlotsByDay(
  slots: Date[],
  zoned: ZonedFormatter,
): Array<{ dateLabel: string; slots: Date[] }> {
  const days = new Map<string, Date[]>();
  for (const slot of slots) {
    const key = zoned.dayKey(slot);
    if (!days.has(key)) days.set(key, []);
    days.get(key)!.push(slot);
  }
  return Array.from(days.entries()).map(([dateLabel, daySlots]) => ({ dateLabel, slots: daySlots }));
}

export async function show(req: Request, res: Response): Promise<void> {
  const slots = await appointmentService.availableSlots();
  const zoned = businessFormatter();

  res.render('public/book-consultation', {
    title: 'Book a free consultation',
    metaDescription:
      'Book a 45-minute consultation with a Waylen counsellor — online or in person — and get a clear view of your options.',
    appointmentTypes: APPOINTMENT_TYPE_LABELS,
    slotDays: groupSlotsByDay(slots, zoned),
    zoned,
    liveAvailability: isGraphConfigured,
    values: {},
    errors: {},
  });
}

export async function submit(req: Request, res: Response): Promise<void> {
  const parsed = consultationSchema.safeParse(req.body);

  if (!parsed.success) {
    const slots = await appointmentService.availableSlots();
    const zoned = businessFormatter();
    res.status(422).render('public/book-consultation', {
      title: 'Book a free consultation',
      appointmentTypes: APPOINTMENT_TYPE_LABELS,
      slotDays: groupSlotsByDay(slots, zoned),
      zoned,
      liveAvailability: isGraphConfigured,
      values: req.body,
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const { autoConfirmed, meetingLinkPending } = await appointmentService.bookGuestConsultation(parsed.data);

  let message =
    'Your consultation request has been received. We will confirm your time by email shortly.';
  if (autoConfirmed) {
    message = meetingLinkPending
      ? "You're booked. Your Teams link isn't ready yet — we'll email it to you before your session."
      : "You're booked. We've sent a calendar invite with your Teams link to your email.";
  }
  req.flash('success', message);
  res.redirect('/book-consultation');
}
