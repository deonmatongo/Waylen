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
import { graphFetch, isGraphConfigured } from './graph-client.service.js';

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

interface MeetingProvider {
  createMeeting(request: MeetingRequest): Promise<Meeting>;
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

    const event = await graphFetch<GraphEvent>(`/users/${env.MS_GRAPH_ORGANISER_UPN}/events`, {
      method: 'POST',
      body: JSON.stringify({
        subject: request.subject,
        start: { dateTime: request.startsAt.toISOString(), timeZone: 'UTC' },
        end: { dateTime: endsAt.toISOString(), timeZone: 'UTC' },
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

  async cancelMeeting(providerId) {
    await graphFetch(`/users/${env.MS_GRAPH_ORGANISER_UPN}/events/${providerId}`, { method: 'DELETE' });
  },
};

/** Development stand-in: a deterministic fake link so flows are testable. */
const stubProvider: MeetingProvider = {
  async createMeeting(request) {
    const id = `stub-${request.startsAt.getTime()}`;
    logger.info({ id }, 'Teams stub provider issued a placeholder meeting link');
    return { id, joinUrl: `https://teams.microsoft.com/l/meetup-join/stub/${id}` };
  },
  async cancelMeeting() {
    /* nothing to cancel for a stub link */
  },
};

export const teamsService: MeetingProvider = isGraphConfigured ? graphProvider : stubProvider;
