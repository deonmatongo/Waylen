/**
 * Real counsellor availability via Microsoft Graph (PRD §5.2 phase-2).
 *
 * `appointmentService.availableSlots()` still owns the working-hours pattern
 * and local double-booking check; this only answers "what does the organiser's
 * actual Outlook calendar say is busy in this window?" so the two can be
 * combined without either one knowing about the other's data source.
 */
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { APPOINTMENT_DURATION_MINUTES } from '../config/constants.js';
import {
  createZonedFormatter,
  getZonedParts,
  isValidTimeZone,
  toLocalIso,
  zonedTimeToUtc,
} from '../utils/timezone.js';
import { graphFetch, isGraphConfigured } from './graph-client.service.js';

/** Working hours, in the business timezone: weekdays 09:00 to 17:00. */
export const WORKING_DAY_START_MINUTES = 9 * 60;
export const WORKING_DAY_END_MINUTES = 17 * 60;

/** The configured business timezone, falling back to UTC if it is not a valid IANA name. */
export function getBusinessTimeZone(): string {
  const configured = env.MS_GRAPH_TIMEZONE;
  if (isValidTimeZone(configured)) return configured;
  logger.warn({ configured }, 'MS_GRAPH_TIMEZONE is not a valid IANA timezone — using UTC');
  return 'UTC';
}

/** Display formatter bound to the business timezone, for views and emails. */
export function businessFormatter() {
  return createZonedFormatter(getBusinessTimeZone());
}

/**
 * Candidate slots for the working-hours pattern, as UTC instants.
 *
 * Days and hours are walked in `timeZone` (not server-local time), so 09:00
 * stays 09:00 for the business across DST changes. Pure: callers supply the
 * already-taken times and calendar-busy blocks.
 */
export function generateSlots(options: {
  now: Date;
  horizon: Date;
  timeZone: string;
  takenTimes?: Set<number>;
  busyBlocks?: BusyBlock[];
  durationMinutes?: number;
}): Date[] {
  const { now, horizon, timeZone, takenTimes = new Set(), busyBlocks = [] } = options;
  const duration = options.durationMinutes ?? APPOINTMENT_DURATION_MINUTES;

  const today = getZonedParts(now, timeZone);
  const slots: Date[] = [];

  // Start tomorrow (business-local) and walk calendar days. Date.UTC is used
  // purely as a calendar: day-of-week of a Y-M-D does not depend on any zone.
  for (let offset = 1; ; offset += 1) {
    const calendar = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
    const weekday = calendar.getUTCDay();
    const year = calendar.getUTCFullYear();
    const month = calendar.getUTCMonth() + 1;
    const day = calendar.getUTCDate();

    const dayStart = zonedTimeToUtc({ year, month, day }, timeZone);
    if (offset > 400 || (dayStart && dayStart >= horizon)) break; // 400: never loop forever

    if (weekday === 0 || weekday === 6) continue;

    for (
      let minutes = WORKING_DAY_START_MINUTES;
      minutes + duration <= WORKING_DAY_END_MINUTES;
      minutes += duration
    ) {
      const slot = zonedTimeToUtc(
        { year, month, day, hour: Math.floor(minutes / 60), minute: minutes % 60 },
        timeZone,
      );
      if (!slot) continue; // wall time skipped by a DST change
      const slotEnd = new Date(slot.getTime() + duration * 60_000);
      if (
        slot > now &&
        slot < horizon &&
        !takenTimes.has(slot.getTime()) &&
        !overlapsAnyBlock(slot, slotEnd, busyBlocks)
      ) {
        slots.push(slot);
      }
    }
  }

  return slots;
}

/**
 * Parses a Graph `dateTime` (no offset suffix, up to 7 fractional digits) that
 * Graph expressed in `timeZone`.
 */
export function parseGraphDateTime(dateTime: string, timeZone: string): Date {
  const trimmed = dateTime.slice(0, 19);
  if (timeZone.toUpperCase() === 'UTC' || !isValidTimeZone(timeZone)) {
    return new Date(`${trimmed}Z`);
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(trimmed);
  if (!match) return new Date(NaN);
  const [, y, mo, d, h, mi, s] = match;
  return (
    zonedTimeToUtc(
      { year: +y!, month: +mo!, day: +d!, hour: +h!, minute: +mi!, second: +s! },
      timeZone,
    ) ?? new Date(NaN)
  );
}

export interface BusyBlock {
  start: Date;
  end: Date;
}

interface ScheduleItem {
  status: 'free' | 'tentative' | 'busy' | 'oof' | 'workingElsewhere';
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
}

interface GetScheduleResponse {
  value: Array<{ scheduleItems?: ScheduleItem[] }>;
}

/**
 * Busy blocks for the organiser's mailbox between `rangeStart` and `rangeEnd`.
 * Returns an empty array (meaning "no extra constraints beyond local
 * bookings") when Graph is not configured, so callers never need to branch.
 */
export async function getBusyBlocks(rangeStart: Date, rangeEnd: Date): Promise<BusyBlock[]> {
  if (!isGraphConfigured) return [];

  const timeZone = getBusinessTimeZone();

  try {
    const response = await graphFetch<GetScheduleResponse>(
      `/users/${env.MS_GRAPH_ORGANISER_UPN}/calendar/getSchedule`,
      {
        method: 'POST',
        body: JSON.stringify({
          schedules: [env.MS_GRAPH_ORGANISER_UPN],
          startTime: { dateTime: toLocalIso(rangeStart, timeZone), timeZone },
          endTime: { dateTime: toLocalIso(rangeEnd, timeZone), timeZone },
          availabilityViewInterval: 30,
        }),
      },
    );

    const items = response.value[0]?.scheduleItems ?? [];
    return items
      .filter((item) => item.status !== 'free')
      .map((item) => ({
        // Graph echoes times back in the zone we asked for, with no offset
        // suffix and up to 7 fractional-second digits.
        start: parseGraphDateTime(item.start.dateTime, item.start.timeZone || timeZone),
        end: parseGraphDateTime(item.end.dateTime, item.end.timeZone || timeZone),
      }));
  } catch (err) {
    // Availability is an enhancement, not a hard dependency — a Graph outage
    // should degrade to "trust the local booking table", not break the page.
    logger.error({ err }, 'Could not read Outlook calendar availability — falling back to local data only');
    return [];
  }
}

export function overlapsAnyBlock(start: Date, end: Date, blocks: BusyBlock[]): boolean {
  return blocks.some((block) => start < block.end && end > block.start);
}
