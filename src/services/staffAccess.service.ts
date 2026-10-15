/**
 * Staff-targeting checks shared by the back-office assignment actions.
 *
 * An assignment id comes straight from a form field, so it must be confirmed
 * to be a real, active member of staff before it is stored — otherwise a
 * forged id could park work on a student, a suspended account or nobody.
 */
import type { Prisma, UserRole } from '@prisma/client';
import { prisma } from '../config/database.js';
import { ValidationError } from '../utils/errors.js';

const ASSIGNABLE_STAFF_ROLES: UserRole[] = ['COUNSELLOR', 'ADMIN_STAFF', 'SUPER_ADMIN'];

/** The slice of `req.currentUser` the scoping helpers need. */
export interface StaffViewer {
  id: string;
  role: UserRole;
}

/** Throws unless `userId` is an ACTIVE counsellor, admin staff or super admin. */
export async function assertActiveStaff(userId: string): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { id: userId, status: 'ACTIVE', role: { in: ASSIGNABLE_STAFF_ROLES } },
    select: { id: true },
  });
  if (!user) throw new ValidationError('Choose an active member of staff.');
}

/** Throws unless `userId` is an ACTIVE counsellor. */
export async function assertActiveCounsellor(userId: string): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { id: userId, status: 'ACTIVE', role: 'COUNSELLOR' },
    select: { id: true },
  });
  if (!user) throw new ValidationError('Choose an active counsellor.');
}

/** Normalises a form field to a non-empty string id, or null for "unassign". */
export function parseAssigneeId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Which enquiries / tickets a staff member may see: admins everything; a
 * counsellor only those assigned to them or belonging to one of their
 * assigned students. Any other role matches nothing.
 */
export function assignedOrOwnStudentScope(viewer: StaffViewer): {
  unrestricted: boolean;
  where: Prisma.EnquiryWhereInput & Prisma.SupportTicketWhereInput;
} {
  if (viewer.role === 'ADMIN_STAFF' || viewer.role === 'SUPER_ADMIN') {
    return { unrestricted: true, where: {} };
  }
  if (viewer.role === 'COUNSELLOR') {
    return {
      unrestricted: false,
      where: {
        OR: [{ assignedToId: viewer.id }, { studentProfile: { assignedCounsellorId: viewer.id } }],
      },
    };
  }
  return { unrestricted: false, where: { id: '__none__' } };
}
