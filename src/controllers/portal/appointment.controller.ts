/**
 * Appointments (PRD §5.2) — 45-minute sessions, online or in person.
 */
import type { Request, Response } from 'express';
import { appointmentService } from '../../services/appointment.service.js';
import { findStudentByUserId } from '../../models/student.model.js';
import { APPOINTMENT_TYPE_LABELS, APPOINTMENT_DURATION_MINUTES } from '../../config/constants.js';
import { appointmentSchema } from '../../validators/appointment.validator.js';
import { NotFoundError, ValidationError } from '../../utils/errors.js';

export async function index(req: Request, res: Response): Promise<void> {
  const student = await findStudentByUserId(req.currentUser!.id);
  if (!student) throw new NotFoundError('We could not find your student profile.');

  const { upcoming, past } = await appointmentService.listForStudent(student.id);

  res.render('portal/appointments/index', {
    title: 'Appointments',
    layout: 'layouts/portal',
    upcoming,
    past,
    typeLabels: APPOINTMENT_TYPE_LABELS,
  });
}

export async function create(req: Request, res: Response): Promise<void> {
  const student = await findStudentByUserId(req.currentUser!.id);
  if (!student) throw new NotFoundError('We could not find your student profile.');

  const slots = await appointmentService.availableSlots();

  res.render('portal/appointments/new', {
    title: 'Book an appointment',
    layout: 'layouts/portal',
    typeLabels: APPOINTMENT_TYPE_LABELS,
    durationMinutes: APPOINTMENT_DURATION_MINUTES,
    slots,
    counsellor: student.assignedCounsellor,
    values: {},
    errors: {},
  });
}

export async function store(req: Request, res: Response): Promise<void> {
  const student = await findStudentByUserId(req.currentUser!.id);
  if (!student) throw new NotFoundError('We could not find your student profile.');

  const parsed = appointmentSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError('Please check the appointment details.', parsed.error.flatten().fieldErrors);
  }

  await appointmentService.requestAsStudent({
    studentProfileId: student.id,
    userId: req.currentUser!.id,
    ...parsed.data,
  });

  req.flash('success', 'Your appointment request has been sent. We will confirm the time shortly.');
  res.redirect('/portal/appointments');
}

export async function cancel(req: Request, res: Response): Promise<void> {
  const student = await findStudentByUserId(req.currentUser!.id);
  if (!student) throw new NotFoundError('We could not find your student profile.');

  await appointmentService.cancel(req.params.id as string, {
    studentProfileId: student.id,
    actorId: req.currentUser!.id,
  });

  req.flash('success', 'That appointment has been cancelled.');
  res.redirect('/portal/appointments');
}
