/**
 * Rendering helpers for the Admin Founders panel.
 *
 * Deliberately tiny. The server composes every label, state and amount this
 * panel shows; what is left in the browser is turning an ISO instant into the
 * reference's own "6 minutes ago", which is a fact about the reader's clock and
 * therefore cannot be composed server-side.
 *
 * §27.1 wants local time with UTC available as secondary detail, which is what
 * `absoluteTime` returns for anything a person might need to quote.
 */

const UNITS: [limitSeconds: number, perUnit: number, name: string][] = [
  [60, 1, 'second'],
  [3600, 60, 'minute'],
  [86_400, 3600, 'hour'],
  [604_800, 86_400, 'day'],
  [2_629_800, 604_800, 'week'],
  [31_557_600, 2_629_800, 'month'],
  [Infinity, 31_557_600, 'year'],
];

/** "6 minutes ago" — the reference's own Last-active wording. */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';

  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 45) return 'just now';

  for (const [limit, per, name] of UNITS) {
    if (Math.abs(seconds) < limit) {
      const value = Math.round(seconds / per);
      return `${value} ${name}${value === 1 ? '' : 's'} ago`;
    }
  }
  return '—';
}

/** Local time primary, UTC secondary — §27.1's rule for a quotable instant. */
export function absoluteTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const local = d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const utc = d.toLocaleString(undefined, {
    timeZone: 'UTC',
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${local} · ${utc} UTC`;
}
