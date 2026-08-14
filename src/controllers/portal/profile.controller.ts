/**
 * Student profile and account settings.
 */
import type { Request, Response } from 'express';
import { prisma } from '../../config/database.js';
import { findStudentByUserId, } from '../../models/student.model.js';
import { listPublishedCountries } from '../../models/content.model.js';
import { authService } from '../../services/auth.service.js';
import { profileSchema } from '../../validators/profile.validator.js';
import { changePasswordSchema } from '../../validators/auth.validator.js';
import { NotFoundError, ValidationError } from '../../utils/errors.js';

export async function show(req: Request, res: Response): Promise<void> {
  const [student, countries] = await Promise.all([
    findStudentByUserId(req.currentUser!.id),
    listPublishedCountries(),
  ]);
  if (!student) throw new NotFoundError('We could not find your student profile.');

  res.render('portal/profile', {
    title: 'My profile',
    layout: 'layouts/portal',
    student,
    countries,
    errors: {},
  });
}

export async function update(req: Request, res: Response): Promise<void> {
  const student = await findStudentByUserId(req.currentUser!.id);
  if (!student) throw new NotFoundError('We could not find your student profile.');

  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError('Please check your details.', parsed.error.flatten().fieldErrors);
  }

  const destinations = parsed.data.preferredDestinations.length
    ? await prisma.country.findMany({
        where: { slug: { in: parsed.data.preferredDestinations } },
        select: { id: true },
      })
    : [];

  await prisma.$transaction([
    prisma.user.update({
      where: { id: req.currentUser!.id },
      data: { fullName: parsed.data.fullName, phone: parsed.data.phone ?? null },
    }),
    prisma.studentProfile.update({
      where: { id: student.id },
      data: {
        city: parsed.data.city ?? null,
        preferredStudyLevel: (parsed.data.preferredStudyLevel as never) ?? null,
        preferredCourses: JSON.stringify(parsed.data.preferredCourses),
        // `set` replaces the whole list rather than appending to it.
        preferredDestinations: { set: destinations.map((d) => ({ id: d.id })) },
      },
    }),
  ]);

  req.flash('success', 'Your profile has been updated.');
  res.redirect('/portal/profile');
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError('Please check the passwords you entered.', parsed.error.flatten().fieldErrors);
  }

  await authService.changePassword(
    req.currentUser!.id,
    parsed.data.currentPassword,
    parsed.data.password,
  );

  req.flash('success', 'Your password has been changed.');
  res.redirect('/portal/profile');
}
