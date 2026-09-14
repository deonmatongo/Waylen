/**
 * Services hub (PRD §5.2) — My Package, Included Services, Additional
 * Services and My Bookings / Service History (client navigation feedback).
 * Career Guidance and Insurance keep their own workspace pages, linked from
 * here rather than duplicated.
 */
import type { Request, Response } from 'express';
import { SERVICE_CATALOGUE } from '../../config/services.js';
import { currentPackageFor } from '../../config/packages.js';
import { findStudentByUserId } from '../../models/student.model.js';
import { listInsurancePoliciesForStudent } from '../../models/insurance.model.js';
import { appointmentService } from '../../services/appointment.service.js';
import { features } from '../../config/env.js';
import { APPOINTMENT_TYPE_LABELS } from '../../config/constants.js';
import { NotFoundError } from '../../utils/errors.js';

/** Where each included service actually lives in the portal. */
const INCLUDED_SERVICE_HREF: Record<string, string> = {
  'university-applications': '/portal/applications',
  'career-guidance': '/portal/career-guidance',
  'consultation-booking': '/portal/appointments/new',
  'document-review': '/portal/documents',
};

export async function index(req: Request, res: Response): Promise<void> {
  const student = await findStudentByUserId(req.currentUser!.id);
  if (!student) throw new NotFoundError('We could not find your student profile.');

  const pkg = currentPackageFor(student);

  const included = SERVICE_CATALOGUE.filter((service) => service.included).map((service) => ({
    ...service,
    href: INCLUDED_SERVICE_HREF[service.slug] ?? '/portal/services',
  }));

  const addOns = SERVICE_CATALOGUE.filter(
    (service) => !service.included && (!service.feature || features[service.feature]),
  );

  const [{ upcoming, past }, insurancePolicies] = await Promise.all([
    appointmentService.listForStudent(student.id),
    listInsurancePoliciesForStudent(student.id),
  ]);

  res.render('portal/services/index', {
    title: 'Services',
    layout: 'layouts/portal',
    pkg,
    included,
    addOns,
    upcomingAppointments: upcoming,
    pastAppointments: past,
    appointmentTypeLabels: APPOINTMENT_TYPE_LABELS,
    insurancePolicies,
  });
}
