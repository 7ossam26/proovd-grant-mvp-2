/**
 * US business-day arithmetic — Spec §6, §29.6; tech-stack §4.5.
 *
 * Reads the committed, versioned holiday JSON. No library that fetches
 * holidays at runtime. When a business-day deadline is computed, the calendar
 * version string is returned with the timestamp so the caller stores both on
 * the record — and `retainDeadline` makes a recomputation unable to silently
 * reset a deadline that was already stored (§29.6).
 *
 * A "business day" is a Monday–Friday, in the calendar's configured timezone,
 * that is not a listed holiday. Deadlines advance in whole 24-hour steps from
 * the anchor, so the UTC time-of-day is preserved; the civil date each step
 * lands on decides whether it counts.
 */

import holidaysJson from './us-federal-holidays.v1.json' with { type: 'json' };

export class CalendarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalendarError';
  }
}

export interface HolidayCalendar {
  version: string;
  timezone: string;
  coverage: { from: string; to: string };
  holidays: ReadonlyArray<{ date: string; name: string }>;
}

/** The committed calendar (§6: "US business-day calendar ... holiday version"). */
export const US_FEDERAL_HOLIDAYS: HolidayCalendar = holidaysJson;

export interface BusinessDayDeadline {
  dueAt: Date;
  calendarVersion: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function civilDateInTz(instant: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

function weekdayInTz(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(instant);
}

export function isBusinessDay(instant: Date, calendar: HolidayCalendar): boolean {
  const civil = civilDateInTz(instant, calendar.timezone);
  if (civil > calendar.coverage.to || civil < calendar.coverage.from) {
    throw new CalendarError(
      `date ${civil} is outside calendar ${calendar.version} coverage ` +
        `(${calendar.coverage.from}–${calendar.coverage.to}) — commit a newer calendar version`,
    );
  }
  const weekday = weekdayInTz(instant, calendar.timezone);
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  return !calendar.holidays.some((h) => h.date === civil);
}

/**
 * The instant `days` business days after `from`: step forward in 24-hour
 * increments, counting only steps that land on a business day.
 */
export function addBusinessDays(from: Date, days: number, calendar: HolidayCalendar): Date {
  if (!Number.isInteger(days) || days < 1) {
    throw new CalendarError(`business-day count must be a positive integer, got ${days}`);
  }
  let cursor = from;
  for (let counted = 0; counted < days; ) {
    cursor = new Date(cursor.getTime() + DAY_MS);
    if (isBusinessDay(cursor, calendar)) counted += 1;
  }
  return cursor;
}

/**
 * Computes a business-day deadline and pairs it with the calendar version the
 * caller must store beside it (§6, §29.6, tech-stack §4.5).
 */
export function businessDayDeadline(
  anchor: Date,
  days: number,
  calendar: HolidayCalendar,
): BusinessDayDeadline {
  return { dueAt: addBusinessDays(anchor, days, calendar), calendarVersion: calendar.version };
}

/**
 * §29.6: a deadline is calculated ONCE. If a stored deadline exists, every
 * recomputation — retry, edit, replay — returns the stored value unchanged.
 */
export function retainDeadline(
  existing: BusinessDayDeadline | null | undefined,
  computed: BusinessDayDeadline,
): BusinessDayDeadline {
  return existing ?? computed;
}
