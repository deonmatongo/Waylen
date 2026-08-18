/**
 * Webinar management (PRD §5.4).
 */
import type { Request, Response } from 'express';
import slugify from 'slugify';
import { prisma } from '../../config/database.js';
import { NotFoundError, ConflictError } from '../../utils/errors.js';
import { webinarSchema } from '../../validators/webinar.validator.js';

export async function index(req: Request, res: Response): Promise<void> {
  const webinars = await prisma.webinar.findMany({
    select: {
      id: true,
      slug: true,
      title: true,
      status: true,
      format: true,
      startsAt: true,
      capacity: true,
      recordingUrl: true,
      _count: { select: { registrations: true } },
    },
    orderBy: { startsAt: 'desc' },
  });

  res.render('admin/webinars/index', {
    title: 'Webinars',
    layout: 'layouts/admin',
    webinars,
  });
}

export async function create(req: Request, res: Response): Promise<void> {
  res.render('admin/webinars/form', {
    title: 'New webinar',
    layout: 'layouts/admin',
    webinar: null,
    values: {},
    errors: {},
  });
}

export async function store(req: Request, res: Response): Promise<void> {
  const parsed = webinarSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).render('admin/webinars/form', {
      title: 'New webinar',
      layout: 'layouts/admin',
      webinar: null,
      values: req.body,
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const slug = slugify(parsed.data.title, { lower: true, strict: true });
  const existing = await prisma.webinar.findUnique({ where: { slug }, select: { id: true } });
  if (existing) throw new ConflictError('A webinar with that title already exists.');

  const webinar = await prisma.webinar.create({ data: { ...parsed.data, slug } });

  req.flash('success', `${webinar.title} has been created.`);
  res.redirect('/admin/webinars');
}

export async function edit(req: Request, res: Response): Promise<void> {
  const webinar = await prisma.webinar.findUnique({ where: { id: req.params.id as string } });
  if (!webinar) throw new NotFoundError('That webinar could not be found.');

  res.render('admin/webinars/form', {
    title: `Edit: ${webinar.title}`,
    layout: 'layouts/admin',
    webinar,
    values: webinar,
    errors: {},
  });
}

export async function update(req: Request, res: Response): Promise<void> {
  const webinar = await prisma.webinar.findUnique({ where: { id: req.params.id as string } });
  if (!webinar) throw new NotFoundError('That webinar could not be found.');

  const parsed = webinarSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).render('admin/webinars/form', {
      title: `Edit: ${webinar.title}`,
      layout: 'layouts/admin',
      webinar,
      values: { ...req.body, id: webinar.id },
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  await prisma.webinar.update({ where: { id: webinar.id }, data: parsed.data });

  req.flash('success', `${parsed.data.title} has been updated.`);
  res.redirect('/admin/webinars');
}

export async function registrations(req: Request, res: Response): Promise<void> {
  const registrations = await prisma.webinarRegistration.findMany({
    where: { webinarId: req.params.id as string },
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      attended: true,
      createdAt: true,
      studentProfile: { select: { reference: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  res.render('admin/webinars/registrations', {
    title: 'Registrations',
    layout: 'layouts/admin',
    registrations,
  });
}

export async function attendanceReport(req: Request, res: Response): Promise<void> {
  const [webinar, total, attended] = await Promise.all([
    prisma.webinar.findUnique({
      where: { id: req.params.id as string },
      select: { title: true, startsAt: true, capacity: true },
    }),
    prisma.webinarRegistration.count({ where: { webinarId: req.params.id as string } }),
    prisma.webinarRegistration.count({
      where: { webinarId: req.params.id as string, attended: true },
    }),
  ]);

  if (!webinar) throw new NotFoundError('That webinar could not be found.');

  res.render('admin/webinars/attendance', {
    title: 'Attendance report',
    layout: 'layouts/admin',
    webinar,
    total,
    attended,
    attendanceRate: total > 0 ? Math.round((attended / total) * 100) : 0,
  });
}
