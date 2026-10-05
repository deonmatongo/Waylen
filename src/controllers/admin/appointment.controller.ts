/**
 * Appointment management across consultation types and counsellors
 * (PRD §5.4).
 */
import type { Request, Response } from 'express';
import { prisma } from '../../config/database.js';
import { appointmentService } from '../../services/appointment.service.js';
import { listCounsellors } from '../../models/student.model.js';
import { APPOINTMENT_TYPE_LABELS } from '../../config/constants.js';
import { ForbiddenError, NotFoundError } from '../../utils/errors.js';

/**
 * A counsellor may act on an appointment only if it isn't assigned to a
 * different counsellor — mirroring how `index()` already scopes the listing
 * by `Appointment.counsellorId`, not by the student's general assigned
 * counsellor (a student's own counsellor and the one hosting a given
 * consultation are not necessarily the same person). `counsellorId` is null
 * on a freshly requested, not-yet-confirmed slot, so any counsellor may
 * still pick it up — confirming is what assigns it to them.
 */
async function assertCanActOnAppointment(req: Request, appointmentId: string): Promise<void> {
  const user = req.currentUser!;
  if (user.role !== 'COUNSELLOR') return;

  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: { counsellorId: true },
  });
  if (!appointment) throw new NotFoundError('That appointment could not be found.');
  if (appointment.counsellorId && appointment.counsellorId !== user.id) {
    throw new ForbiddenError('This appointment is assigned to another counsellor.');
  }
}

export async function index(req: Request, res: Response): Promise<void> {
  const user = req.currentUser!;
  const { status, from } = req.query;

  const [appointments, counsellors] = await Promise.all([
    appointmentService.listForStaff({
      counsellorId: user.role === 'COUNSELLOR' ? user.id : undefined,
      status: status as never,
      from: typeof from === 'string' ? new Date(from) : undefined,
    }),
    listCounsellors(),
  ]);

  res.render('admin/appointments/index', {
    title: 'Appointments',
    layout: 'layouts/admin',
    appointments,
    counsellors,
    typeLabels: APPOINTMENT_TYPE_LABELS,
    filters: { status, from },
  });
}

export async function confirm(req: Request, res: Response): Promise<void> {
  await assertCanActOnAppointment(req, req.params.id as string);

  await appointmentService.confirm(req.params.id as string, {
    actorId: req.currentUser!.id,
    counsellorId: req.body?.counsellorId || req.currentUser!.id,
  });

  req.flash('success', 'Appointment confirmed and the attendee notified.');
  res.redirect('/admin/appointments');
}

export async function reschedule(req: Request, res: Response): Promise<void> {
  await assertCanActOnAppointment(req, req.params.id as string);

  await appointmentService.reschedule(req.params.id as string, {
    actorId: req.currentUser!.id,
    startsAt: new Date(req.body?.startsAt),
  });

  req.flash('success', 'Appointment rescheduled and the attendee notified.');
  res.redirect('/admin/appointments');
}

export async function cancel(req: Request, res: Response): Promise<void> {
  await assertCanActOnAppointment(req, req.params.id as string);

  await appointmentService.cancel(req.params.id as string, { actorId: req.currentUser!.id });

  req.flash('success', 'Appointment cancelled.');
  res.redirect('/admin/appointments');
}

export async function complete(req: Request, res: Response): Promise<void> {
  await assertCanActOnAppointment(req, req.params.id as string);

  await appointmentService.complete(req.params.id as string, {
    actorId: req.currentUser!.id,
    staffNotes: req.body?.staffNotes || undefined,
  });

  req.flash('success', 'Appointment marked as completed.');
  res.redirect('/admin/appointments');
}
