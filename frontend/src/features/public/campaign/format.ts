/**
 * Date rendering for campaign surfaces — Spec §27.1.
 *
 * "Dates are local time primary with canonical UTC secondary." The local half
 * uses the reader's own locale; the UTC half is built by hand rather than by
 * `Intl`, because Appendix A's consent copy embeds `[CLOSE DATE — UTC]` in a
 * sentence a Backer legally agrees to, and that string must read the same for
 * every reader, in every environment, in every test run.
 */

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

/** `2026-09-30T23:00:00Z` → `30 September 2026, 23:00 UTC`. Locale-independent. */
export function formatUtcInstant(instant: Date): string {
  const day = instant.getUTCDate();
  const month = MONTHS[instant.getUTCMonth()];
  const year = instant.getUTCFullYear();
  return `${day} ${month} ${year}, ${pad(instant.getUTCHours())}:${pad(
    instant.getUTCMinutes(),
  )} UTC`;
}

/** The reader's local rendering — the primary half of §27.1's pairing. */
export function formatLocalInstant(instant: Date): string {
  return instant.toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' });
}

/** `2026-08-01` → `1 August 2026`. A calendar date, never shifted by timezone. */
export function formatCalendarDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number) as [number, number, number];
  return `${day} ${MONTHS[month - 1]} ${year}`;
}
