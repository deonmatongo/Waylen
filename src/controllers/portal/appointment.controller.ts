/**
 * Appointments (PRD §5.2) — 45-minute sessions, online or in person.
 */
import type { Request, Response } from 'express';
import { appointmentService } from '../../services/appointment.service.js';
import { findStudentByUserId } from '../../models/student.model.js';
import { APPOINTMENT_TYPE_LABELS, APPOINTMENT_DURATION_MINUTES } from '../../config/constants.js';
import { appointmentSchema, studentRescheduleSchema } from '../../validators/appointment.validator.js';
import { businessFormatter } from '../../services/availability.service.js';
import { NotFoundError, ValidationError } from '../../utils/errors.js';

export async function index(req: Request, res: Response): Promise<void> {
  const student = await findStudentByUserId(req.currentUser!.id);
  if (!student) throw new NotFoundError('We could not find your student profile.');

  const rawPage = typeof req.query.page === 'string' ? req.query.page : '1';
  const page = Number.parseInt(rawPage, 10);
  const { upcoming, past, pagination } = await appointmentService.listForStudent(student.id, {
    page: Number.isFinite(page) ? page : 1,
  });

  res.render('portal/appointments/index', {
    title: 'Appointments',
    layout: 'layouts/portal',
    upcoming,
    past,
    pagination,
    zoned: businessFormatter(),
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
    zoned: businessFormatter(),
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

export async function rescheduleForm(req: Request, res: Response): Promise<void> {
  const student = await findStudentByUserId(req.currentUser!.id);
  if (!student) throw new NotFoundError('We could not find your student profile.');

  const appointment = await appointmentService.getReschedulable(req.params.id as string, student.id);
  const slots = await appointmentService.availableSlots();

  res.render('portal/appointments/reschedule', {
    title: 'Reschedule appointment',
    layout: 'layouts/portal',
    appointment,
    typeLabels: APPOINTMENT_TYPE_LABELS,
    durationMinutes: APPOINTMENT_DURATION_MINUTES,
    slots,
    zoned: businessFormatter(),
  });
}

export async function reschedule(req: Request, res: Response): Promise<void> {
  const student = await findStudentByUserId(req.currentUser!.id);
  if (!student) throw new NotFoundError('We could not find your student profile.');

  const parsed = studentRescheduleSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError('Please choose a new time.', parsed.error.flatten().fieldErrors);
  }

  await appointmentService.reschedule(req.params.id as string, {
    actorId: req.currentUser!.id,
    studentProfileId: student.id,
    startsAt: parsed.data.startsAt,
  });

  req.flash('success', 'Your appointment has been rescheduled.');
  res.redirect('/portal/appointments');
}
