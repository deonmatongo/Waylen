/**
 * Message thread queries (PRD §5.2).
 */
import { prisma } from '../config/database.js';

/**
 * Unread staff messages across every thread for a student — used on the
 * dashboard and as the topbar Messages badge (PRD §5.2).
 */
export async function countUnreadForStudent(studentProfileId: string, userId: string): Promise<number> {
  return prisma.message.count({
    where: {
      thread: { studentProfileId },
      readAt: null,
      isInternal: false,
      // Only count messages from staff, not the student's own.
      senderId: { not: userId },
    },
  });
}
