/**
 * Student profile queries (PRD §5.1, §5.4).
 *
 * The counsellor scoping rule lives here: `staffVisibilityFilter` is the single
 * definition of "which students may this staff member see", so no controller
 * has to re-derive it.
 */
import type { ApplicationStage, Prisma, UserRole } from '@prisma/client';
import { prisma } from '../config/database.js';

/**
 * PRD §5.4 — admin staff and super admins see everyone; a counsellor sees only
 * students assigned to them.
 */
export function staffVisibilityFilter(
  role: UserRole,
  userId: string,
): Prisma.StudentProfileWhereInput {
  if (role === 'ADMIN_STAFF' || role === 'SUPER_ADMIN') return {};
  if (role === 'COUNSELLOR') return { assignedCounsellorId: userId };
  // Any other role has no business in the back-office; match nothing.
  return { id: '__none__' };
}

export async function findStudentByUserId(userId: string) {
  return prisma.studentProfile.findUnique({
    where: { userId },
    include: {
      user: { select: { id: true, email: true, fullName: true, phone: true } },
      countryOfOrigin: { select: { name: true, isoCode: true } },
      preferredDestinations: { select: { slug: true, name: true, isoCode: true } },
      assignedCounsellor: {
        select: {
          fullName: true,
          email: true,
          staffProfile: { select: { jobTitle: true, avatarPath: true } },
        },
      },
    },
  });
}

export async function findStudentById(id: string) {
  const student = await prisma.studentProfile.findUnique({
    where: { id },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          fullName: true,
          phone: true,
          status: true,
          emailVerifiedAt: true,
          lastLoginAt: true,
        },
      },
      countryOfOrigin: { select: { name: true, isoCode: true } },
      preferredDestinations: { select: { name: true, isoCode: true } },
      assignedCounsellor: { select: { id: true, fullName: true, email: true } },
      applications: {
        select: {
          id: true,
          reference: true,
          programmeName: true,
          stage: true,
          outcome: true,
          createdAt: true,
          country: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
      },
      documents: {
        select: {
          id: true,
          type: true,
          status: true,
          originalFilename: true,
          sizeBytes: true,
          createdAt: true,
          reviewNotes: true,
          isIssuedByWaylen: true,
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  });
  if (!student) return null;
  return { ...student, preferredCourses: JSON.parse(student.preferredCourses as string) as string[] };
}

export interface StudentListFilters {
  search?: string;
  stage?: ApplicationStage;
  counsellorId?: string;
  countryId?: string;
  page?: number;
  perPage?: number;
}

/**
 * Back-office student list (PRD §5.4 — view, search, filter, status at a
 * glance). `scope` must come from `staffVisibilityFilter`.
 */
export async function listStudents(
  scope: Prisma.StudentProfileWhereInput,
  filters: StudentListFilters = {},
) {
  const page = Math.max(1, filters.page ?? 1);
  const perPage = Math.min(100, filters.perPage ?? 25);

  const where: Prisma.StudentProfileWhereInput = {
    ...scope,
    ...(filters.stage ? { currentStage: filters.stage } : {}),
    ...(filters.counsellorId ? { assignedCounsellorId: filters.counsellorId } : {}),
    ...(filters.countryId ? { countryOfOriginId: filters.countryId } : {}),
    ...(filters.search
      ? {
          OR: [
            { reference: { contains: filters.search } },
            { user: { fullName: { contains: filters.search } } },
            { user: { email: { contains: filters.search } } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.studentProfile.findMany({
      where,
      select: {
        id: true,
        reference: true,
        currentStage: true,
        createdAt: true,
        user: { select: { fullName: true, email: true, status: true } },
        countryOfOrigin: { select: { name: true, isoCode: true } },
        assignedCounsellor: { select: { fullName: true } },
        _count: { select: { applications: true, documents: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.studentProfile.count({ where }),
  ]);

  return { items, total, page, perPage, totalPages: Math.ceil(total / perPage) };
}

/** Counts per stage, for the back-office pipeline summary (PRD §10). */
export async function countStudentsByStage(scope: Prisma.StudentProfileWhereInput = {}) {
  const rows = await prisma.studentProfile.groupBy({
    by: ['currentStage'],
    where: scope,
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.currentStage, r._count._all]));
}

export async function listCounsellors() {
  return prisma.user.findMany({
    where: { role: 'COUNSELLOR', status: 'ACTIVE' },
    select: {
      id: true,
      fullName: true,
      email: true,
      _count: { select: { counselledStudents: true } },
    },
    orderBy: { fullName: 'asc' },
  });
}
