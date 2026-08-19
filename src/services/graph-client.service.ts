/**
 * Shared Microsoft Graph app-only client (PRD §5.2, §8.1).
 *
 * One tenant-wide token acquired via the client-credentials flow, cached until
 * shortly before it expires. Every Graph-backed feature (Teams meeting
 * creation, real calendar availability) goes through `graphFetch` so there is
 * exactly one place that knows how to authenticate.
 */
import { env } from '../config/env.js';
import { ServiceUnavailableError } from '../utils/errors.js';

export const isGraphConfigured = Boolean(
  env.MS_GRAPH_TENANT_ID &&
    env.MS_GRAPH_CLIENT_ID &&
    env.MS_GRAPH_CLIENT_SECRET &&
    env.MS_GRAPH_ORGANISER_UPN,
);

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }

  const tokenUrl = `https://login.microsoftonline.com/${env.MS_GRAPH_TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: env.MS_GRAPH_CLIENT_ID ?? '',
    client_secret: env.MS_GRAPH_CLIENT_SECRET ?? '',
    scope: 'https://graph.microsoft.com/.default',
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    throw new ServiceUnavailableError('Could not authenticate with Microsoft Graph.');
  }

  const json = (await response.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return cachedToken.value;
}

/** Authenticated fetch against the Graph v1.0 API. Path must start with `/`. */
export async function graphFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();

  const response = await fetch(`${GRAPH_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new ServiceUnavailableError(`Microsoft Graph request failed (${response.status}): ${detail}`);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
