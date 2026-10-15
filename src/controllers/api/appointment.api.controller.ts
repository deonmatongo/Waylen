/**
 * Appointments over the JSON API.
 */
import type { Request, Response } from 'express';
import { appointmentService } from '../../services/appointment.service.js';
import { appointmentSchema } from '../../validators/appointment.validator.js';
import { idParamSchema } from '../../validators/api.validator.js';
import { APPOINTMENT_DURATION_MINUTES } from '../../config/constants.js';
import { paginate, parse, parsePagination, requireStudent } from './helpers.js';

/** GET /appointments — legacy `upcoming`/`past` keys plus a paginated `items` list (upcoming first). */
export async function list(req: Request, res: Response): Promise<void> {
  const student = await requireStudent(req);
  const { upcoming, past } = await appointmentService.listForStudent(student.id);
  res.json({ ...paginate([...upcoming, ...past], parsePagination(req)), upcoming, past });
}

/** GET /appointments/slots — open booking times (45-minute sessions). */
export async function slots(_req: Request, res: Response): Promise<void> {
  res.json({ durationMinutes: APPOINTMENT_DURATION_MINUTES, slots: await appointmentService.availableSlots() });
}

/** POST /appointments */
export async function book(req: Request, res: Response): Promise<void> {
  const student = await requireStudent(req);
  const input = parse(appointmentSchema, req.body, 'Please check the appointment details.');

  const appointment = await appointmentService.requestAsStudent({
    studentProfileId: student.id,
    userId: req.currentUser!.id,
    ...input,
  });

  res.status(201).json({
    id: appointment.id,
    reference: appointment.reference,
    type: appointment.type,
    status: appointment.status,
    format: appointment.format,
    startsAt: appointment.startsAt,
    durationMinutes: appointment.durationMinutes,
  });
}

/** POST /appointments/:id/cancel */
export async function cancel(req: Request, res: Response): Promise<void> {
  const student = await requireStudent(req);
  const { id } = parse(idParamSchema, req.params);

  await appointmentService.cancel(id, { studentProfileId: student.id, actorId: req.currentUser!.id });
  res.json({ ok: true });
}
