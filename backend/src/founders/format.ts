/**
 * Rendering helpers for the Founder Admin workspace — Spec §26.1, §27.1.
 *
 * ── Why the server formats, and why in UTC ──────────────────────────────────
 * `types.ts` is explicit that nothing on the surface derives a fact the server
 * did not send: a value the browser computed is a value with no `prior_value`
 * to override against (§26.2). Dates are facts, so they are formatted here.
 *
 * §27.1 asks for a local rendering with UTC secondary, and a server that has
 * never been told the viewer's timezone cannot produce the local half. Silently
 * formatting in the container's timezone would be worse than useless — it would
 * be a wrong local time with no marker saying so — so every instant here is
 * rendered in UTC and *says* UTC. The client owns the local half if it wants
 * one; the instant rides alongside on every history entry for exactly that.
 *
 * ── Actor names ─────────────────────────────────────────────────────────────
 * Records store `user:<id>`, `system:<job>`, `provider:stripe`. An Admin
 * reading "Maya changed the legal business name" needs the name, not the id, so
 * the ids are resolved once per payload rather than per row. An id with no user
 * behind it renders as the raw actor string: an actor we cannot name is a fact,
 * and inventing "Proovd" for it would attribute somebody's act to nobody.
 */

import { inArray } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { user } from '../db/schema/auth.js';

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** `Aug 8, 2026` — a day with no time, for a date nobody needs to the minute. */
export function formatDay(at: Date | null | undefined): string | null {
  if (!at || Number.isNaN(at.getTime())) return null;
  return `${MONTHS[at.getUTCMonth()]} ${at.getUTCDate()}, ${at.getUTCFullYear()}`;
}

/** `Aug 8, 2026 · 3:15 PM UTC`. */
export function formatInstant(at: Date | null | undefined): string | null {
  const day = formatDay(at);
  if (!day || !at) return null;
  const hours24 = at.getUTCHours();
  const hours = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const minutes = at.getUTCMinutes().toString().padStart(2, '0');
  return `${day} · ${hours}:${minutes} ${hours24 < 12 ? 'AM' : 'PM'} UTC`;
}

/** The ISO instant a client may sort on without re-parsing a rendered date. */
export function isoOf(at: Date | null | undefined): string | null {
  if (!at || Number.isNaN(at.getTime())) return null;
  return at.toISOString();
}

/**
 * Whole days from `from` to `to`, rounded up, or null when it is already past.
 *
 * Used for "48 days remaining" on the §22.10 cooldown. Rounded up because a
 * wait with eleven hours left is a day away in every sense a Founder means.
 */
export function daysUntil(to: Date | null, from: Date): number | null {
  if (!to) return null;
  const ms = to.getTime() - from.getTime();
  if (ms <= 0) return null;
  return Math.ceil(ms / 86_400_000);
}

/**
 * `user:<id>` → the person's name, for every actor string in one payload.
 *
 * One query per payload rather than one per row. Anything that is not a
 * `user:` actor is left alone by the caller.
 */
export async function resolveActorNames(
  db: Database,
  actors: readonly (string | null | undefined)[],
): Promise<Map<string, string>> {
  const ids = new Set<string>();
  for (const actor of actors) {
    if (typeof actor === 'string' && actor.startsWith('user:')) ids.add(actor.slice(5));
  }
  if (ids.size === 0) return new Map();

  const rows = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(inArray(user.id, [...ids]));

  const names = new Map<string, string>();
  for (const row of rows) names.set(`user:${row.id}`, row.name);
  return names;
}

/** The resolved name, or the raw actor when nobody is behind it. */
export function actorName(
  names: ReadonlyMap<string, string>,
  actor: string | null | undefined,
): string | null {
  if (!actor) return null;
  return names.get(actor) ?? actor;
}
