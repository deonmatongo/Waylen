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
import { ServiceUnavailableError } from '../utils/errors.js';

export interface MeetingRequest {
  subject: string;
  startsAt: Date;
  durationMinutes: number;
  attendeeEmail?: string;
}

export interface Meeting {
  id: string;
  joinUrl: string;
}

interface MeetingProvider {
  createMeeting(request: MeetingRequest): Promise<Meeting>;
  cancelMeeting(providerId: string): Promise<void>;
}

const isConfigured = Boolean(
  env.MS_GRAPH_TENANT_ID && env.MS_GRAPH_CLIENT_ID && env.MS_GRAPH_CLIENT_SECRET,
);

const graphProvider: MeetingProvider = {
  async createMeeting(request) {
    // TODO(phase-2): client-credentials token from
    // https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token, then
    // POST /users/{organiser}/onlineMeetings with startDateTime, endDateTime
    // and subject. Cache the token until it expires rather than re-fetching
    // per meeting.
    logger.warn({ subject: request.subject }, 'Graph provider not implemented — no meeting created');
    throw new ServiceUnavailableError('Microsoft Teams integration is not configured yet.');
  },

  async cancelMeeting(providerId) {
    logger.warn({ providerId }, 'Graph provider not implemented — no meeting cancelled');
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

export const teamsService: MeetingProvider = isConfigured ? graphProvider : stubProvider;
