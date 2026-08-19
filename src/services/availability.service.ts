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
import { graphFetch, isGraphConfigured } from './graph-client.service.js';

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

  try {
    const response = await graphFetch<GetScheduleResponse>(
      `/users/${env.MS_GRAPH_ORGANISER_UPN}/calendar/getSchedule`,
      {
        method: 'POST',
        body: JSON.stringify({
          schedules: [env.MS_GRAPH_ORGANISER_UPN],
          startTime: { dateTime: rangeStart.toISOString(), timeZone: 'UTC' },
          endTime: { dateTime: rangeEnd.toISOString(), timeZone: 'UTC' },
          availabilityViewInterval: 30,
        }),
      },
    );

    const items = response.value[0]?.scheduleItems ?? [];
    return items
      .filter((item) => item.status !== 'free')
      .map((item) => ({
        // Graph echoes back UTC here (we asked in UTC) but with no offset
        // suffix and up to 7 fractional-second digits — trim to millisecond
        // precision before appending Z so every JS engine parses it the same way.
        start: new Date(`${item.start.dateTime.slice(0, 23)}Z`),
        end: new Date(`${item.end.dateTime.slice(0, 23)}Z`),
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
