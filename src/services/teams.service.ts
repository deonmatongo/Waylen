/**
 * Microsoft Teams meeting creation via Microsoft Graph (PRD §5.2, §8.1 —
 * "video/calendar integration for appointments, starting with Microsoft
 * Teams").
 *
 * Deliberately behind a narrow interface: appointments only need "give me a
 * join URL". Swapping to Zoom or Google Meet later means one new implementation
 * of `MeetingProvider`, not a change to the appointment flow.
 */
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { toLocalIso } from '../utils/timezone.js';
import { graphFetch, GraphRequestError, isGraphConfigured } from './graph-client.service.js';
import { getBusinessTimeZone } from './availability.service.js';

export interface MeetingRequest {
  subject: string;
  startsAt: Date;
  durationMinutes: number;
  attendeeEmail?: string;
  attendeeName?: string;
}

export interface Meeting {
  id: string;
  joinUrl: string;
}

export interface MeetingUpdate {
  startsAt: Date;
  durationMinutes: number;
}

interface MeetingProvider {
  createMeeting(request: MeetingRequest): Promise<Meeting>;
  /** Moves an existing meeting; the join link is unchanged. */
  updateMeeting(providerId: string, update: MeetingUpdate): Promise<void>;
  cancelMeeting(providerId: string): Promise<void>;
}

interface GraphEvent {
  id: string;
  onlineMeeting?: { joinUrl: string } | null;
}

const graphProvider: MeetingProvider = {
  // Booking as a calendar event (rather than a bare /onlineMeetings resource)
  // blocks the organiser's real calendar for the slot, emails the guest a
  // native Outlook invite, and still returns a Teams join link in one call.
  async createMeeting(request) {
    const endsAt = new Date(request.startsAt.getTime() + request.durationMinutes * 60_000);
    const timeZone = getBusinessTimeZone();

    const event = await graphFetch<GraphEvent>(`/users/${env.MS_GRAPH_ORGANISER_UPN}/events`, {
      method: 'POST',
      body: JSON.stringify({
        subject: request.subject,
        start: { dateTime: toLocalIso(request.startsAt, timeZone), timeZone },
        end: { dateTime: toLocalIso(endsAt, timeZone), timeZone },
        isOnlineMeeting: true,
        onlineMeetingProvider: 'teamsForBusiness',
        attendees: request.attendeeEmail
          ? [
              {
                type: 'required',
                emailAddress: { address: request.attendeeEmail, name: request.attendeeName ?? request.attendeeEmail },
              },
            ]
          : [],
      }),
    });

    if (!event.onlineMeeting?.joinUrl) {
      logger.warn({ eventId: event.id }, 'Graph event created without a Teams join link');
    }

    return { id: event.id, joinUrl: event.onlineMeeting?.joinUrl ?? '' };
  },

  async updateMeeting(providerId, update) {
    const endsAt = new Date(update.startsAt.getTime() + update.durationMinutes * 60_000);
    const timeZone = getBusinessTimeZone();

    await graphFetch(`/users/${env.MS_GRAPH_ORGANISER_UPN}/events/${encodeURIComponent(providerId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        start: { dateTime: toLocalIso(update.startsAt, timeZone), timeZone },
        end: { dateTime: toLocalIso(endsAt, timeZone), timeZone },
      }),
    });
  },

  async cancelMeeting(providerId) {
    try {
      // Deleting an event that has attendees makes Outlook send them a cancellation.
      await graphFetch(`/users/${env.MS_GRAPH_ORGANISER_UPN}/events/${encodeURIComponent(providerId)}`, {
        method: 'DELETE',
      });
    } catch (err) {
      // Already deleted from Outlook: the outcome we wanted.
      if (err instanceof GraphRequestError && err.graphStatus === 404) return;
      throw err;
    }
  },
};

/** Development stand-in: a deterministic fake link so flows are testable. */
const stubProvider: MeetingProvider = {
  async createMeeting(request) {
    const id = `stub-${request.startsAt.getTime()}`;
    logger.info({ id }, 'Teams stub provider issued a placeholder meeting link');
    return { id, joinUrl: `https://teams.microsoft.com/l/meetup-join/stub/${id}` };
  },
  async updateMeeting() {
    /* a stub link is not tied to a time */
  },
  async cancelMeeting() {
    /* nothing to cancel for a stub link */
  },
};

export const teamsService: MeetingProvider = isGraphConfigured ? graphProvider : stubProvider;
