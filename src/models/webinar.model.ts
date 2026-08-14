/**
 * Webinar and event queries (PRD §4.5, §5.2).
 */
import { prisma } from '../config/database.js';

export async function listUpcomingWebinars(limit = 6) {
  return prisma.webinar.findMany({
    where: { status: 'PUBLISHED', startsAt: { gte: new Date() } },
    select: {
      id: true,
      slug: true,
      title: true,
      description: true,
      format: true,
      startsAt: true,
      endsAt: true,
      timezone: true,
      location: true,
      coverImagePath: true,
      hostName: true,
      capacity: true,
      _count: { select: { registrations: true } },
    },
    orderBy: { startsAt: 'asc' },
    take: limit,
  });
}

export async function listPastWebinarsWithRecordings(limit = 12) {
  return prisma.webinar.findMany({
    where: {
      status: 'PUBLISHED',
      startsAt: { lt: new Date() },
      recordingUrl: { not: null },
    },
    select: {
      slug: true,
      title: true,
      startsAt: true,
      coverImagePath: true,
      recordingUrl: true,
    },
    orderBy: { startsAt: 'desc' },
    take: limit,
  });
}

export async function findWebinarBySlug(slug: string) {
  return prisma.webinar.findFirst({
    where: { slug, status: 'PUBLISHED' },
    include: { _count: { select: { registrations: true } } },
  });
}

/**
 * Seats remaining, or null when the webinar is uncapped.
 */
export async function remainingCapacity(webinarId: string): Promise<number | null> {
  const webinar = await prisma.webinar.findUnique({
    where: { id: webinarId },
    select: { capacity: true, _count: { select: { registrations: true } } },
  });
  if (!webinar?.capacity) return null;
  return Math.max(0, webinar.capacity - webinar._count.registrations);
}
