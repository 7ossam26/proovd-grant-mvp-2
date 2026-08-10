/**
 * Approximate elapsed time, the way a person says it: `~3 mins`, `~1 hour`,
 * `~2 days`.
 *
 * Display formatting only — nothing here is a deadline, a schedule, or a
 * commercial rule, and no stored instant is derived from it. The one shared
 * time formatter (`formatUtcInstant`) renders absolute instants; this renders
 * the DISTANCE to one, which is a different sentence, not a second copy.
 *
 * Honest by absence (§1.4): an unparseable instant, a missing one, or one in
 * the future returns null and the caller renders nothing — a fabricated
 * "~1 min" would be a claim about a record that does not support it.
 */
export function approxSince(iso: string | null | undefined, now: Date = new Date()): string | null {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;

  const elapsedMs = now.getTime() - then.getTime();
  if (elapsedMs < 0) return null;

  const mins = Math.max(1, Math.round(elapsedMs / 60_000));
  if (mins < 60) return `~${mins} ${mins === 1 ? 'min' : 'mins'}`;

  const hours = Math.round(mins / 60);
  if (hours < 24) return `~${hours} ${hours === 1 ? 'hour' : 'hours'}`;

  const days = Math.round(hours / 24);
  return `~${days} ${days === 1 ? 'day' : 'days'}`;
}
