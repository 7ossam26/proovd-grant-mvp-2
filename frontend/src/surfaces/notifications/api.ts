/**
 * The §27.7 client — the digest preference and the notification history.
 *
 * One module for both authenticated roles. The base path is the only
 * difference, and it is bound by the caller rather than read from a parameter,
 * for the same reason the router binds the audience at construction: a path
 * chosen at call time is a path a bug can choose wrongly.
 */

import type { DigestFrequency, DigestPreferenceView } from './DigestPreference.js';
import type { HistoryEntry } from './NotificationHistory.js';

export type NotificationsRole = 'founder' | 'creator';

const BASE: Record<NotificationsRole, string> = {
  founder: '/api/founder',
  creator: '/api/creator',
};

export class NotificationsRequestError extends Error {}

async function readJson(response: Response): Promise<unknown> {
  if (response.ok) return response.json();
  let message = 'We could not reach the server. Nothing changed — try again.';
  try {
    const body = (await response.json()) as { whatHappened?: string; error?: string };
    message = body.whatHappened ?? body.error ?? message;
  } catch {
    /* A non-JSON failure keeps the generic sentence, which names the state. */
  }
  throw new NotificationsRequestError(message);
}

export async function fetchDigestPreference(
  role: NotificationsRole,
): Promise<DigestPreferenceView> {
  const body = (await readJson(
    await fetch(`${BASE[role]}/notifications/preferences`, { credentials: 'include' }),
  )) as { preference: DigestPreferenceView };
  return body.preference;
}

export async function saveDigestPreference(
  role: NotificationsRole,
  frequency: DigestFrequency,
): Promise<DigestPreferenceView> {
  const body = (await readJson(
    await fetch(`${BASE[role]}/notifications/preferences`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ frequency }),
    }),
  )) as { preference: DigestPreferenceView };
  return body.preference;
}

export interface HistoryPage {
  entries: HistoryEntry[];
  nextCursor: string | null;
}

export async function fetchNotificationHistory(
  role: NotificationsRole,
  before?: string,
): Promise<HistoryPage> {
  const query = before ? `?before=${encodeURIComponent(before)}` : '';
  const body = (await readJson(
    await fetch(`${BASE[role]}/notifications/history${query}`, { credentials: 'include' }),
  )) as { history: HistoryPage };
  return body.history;
}
