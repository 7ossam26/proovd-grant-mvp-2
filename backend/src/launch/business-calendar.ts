/**
 * The US business-day calendar, restated for the backend — Spec §6, §29.6,
 * tech-stack §4.5.
 *
 * `shared/src/calendar` is the source of truth: the committed holiday JSON and
 * the business-day arithmetic. The backend cannot import `@proovd/shared` at
 * runtime (it compiles under `rootDir: src` and the production image ships only
 * `backend/dist`), and Phase 14a is the first backend code to need business-day
 * math — the earlier deadlines were all fixed-hour. So the calendar is restated
 * here and `launch.test.ts` drift-tests both the holiday data and the computed
 * deadlines against the shared module: any divergence fails the suite, the same
 * arrangement the state enums, the §6 settings, and the notification keys use.
 *
 * §29.6: when a deadline is computed, its calendar version is returned with the
 * timestamp so the caller stores both; `retainDeadline` makes a recomputation
 * unable to silently reset a deadline already stored and promised.
 */

/** §6: three US business days for the required-Creator replacement window. */
export const CREATOR_REPLACEMENT_WINDOW_BUSINESS_DAYS = 3;

export interface HolidayCalendar {
  version: string;
  timezone: string;
  coverage: { from: string; to: string };
  holidays: ReadonlyArray<{ date: string; name: string }>;
}

/** A verbatim copy of the committed `us-federal.v1` calendar; drift-tested. */
export const US_FEDERAL_HOLIDAYS: HolidayCalendar = {
  version: 'us-federal.v1',
  timezone: 'America/New_York',
  coverage: { from: '2025-01-01', to: '2028-12-31' },
  holidays: [
    { date: '2025-01-01', name: "New Year's Day" },
    { date: '2025-01-20', name: 'Birthday of Martin Luther King, Jr.' },
    { date: '2025-02-17', name: "Washington's Birthday" },
    { date: '2025-05-26', name: 'Memorial Day' },
    { date: '2025-06-19', name: 'Juneteenth National Independence Day' },
    { date: '2025-07-04', name: 'Independence Day' },
    { date: '2025-09-01', name: 'Labor Day' },
    { date: '2025-10-13', name: 'Columbus Day' },
    { date: '2025-11-11', name: 'Veterans Day' },
    { date: '2025-11-27', name: 'Thanksgiving Day' },
    { date: '2025-12-25', name: 'Christmas Day' },
    { date: '2026-01-01', name: "New Year's Day" },
    { date: '2026-01-19', name: 'Birthday of Martin Luther King, Jr.' },
    { date: '2026-02-16', name: "Washington's Birthday" },
    { date: '2026-05-25', name: 'Memorial Day' },
    { date: '2026-06-19', name: 'Juneteenth National Independence Day' },
    { date: '2026-07-03', name: 'Independence Day (observed)' },
    { date: '2026-09-07', name: 'Labor Day' },
    { date: '2026-10-12', name: 'Columbus Day' },
    { date: '2026-11-11', name: 'Veterans Day' },
    { date: '2026-11-26', name: 'Thanksgiving Day' },
    { date: '2026-12-25', name: 'Christmas Day' },
    { date: '2027-01-01', name: "New Year's Day" },
    { date: '2027-01-18', name: 'Birthday of Martin Luther King, Jr.' },
    { date: '2027-02-15', name: "Washington's Birthday" },
    { date: '2027-05-31', name: 'Memorial Day' },
    { date: '2027-06-18', name: 'Juneteenth National Independence Day (observed)' },
    { date: '2027-07-05', name: 'Independence Day (observed)' },
    { date: '2027-09-06', name: 'Labor Day' },
    { date: '2027-10-11', name: 'Columbus Day' },
    { date: '2027-11-11', name: 'Veterans Day' },
    { date: '2027-11-25', name: 'Thanksgiving Day' },
    { date: '2027-12-24', name: 'Christmas Day (observed)' },
    { date: '2027-12-31', name: "New Year's Day 2028 (observed)" },
    { date: '2028-01-17', name: 'Birthday of Martin Luther King, Jr.' },
    { date: '2028-02-21', name: "Washington's Birthday" },
    { date: '2028-05-29', name: 'Memorial Day' },
    { date: '2028-06-19', name: 'Juneteenth National Independence Day' },
    { date: '2028-07-04', name: 'Independence Day' },
    { date: '2028-09-04', name: 'Labor Day' },
    { date: '2028-10-09', name: 'Columbus Day' },
    { date: '2028-11-10', name: 'Veterans Day (observed)' },
    { date: '2028-11-23', name: 'Thanksgiving Day' },
    { date: '2028-12-25', name: 'Christmas Day' },
  ],
};

export class CalendarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalendarError';
  }
}

export interface BusinessDayDeadline {
  dueAt: Date;
  calendarVersion: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function civilDateInTz(instant: Date, timeZone: string): string {
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

export function isBusinessDay(instant: Date, calendar: HolidayCalendar = US_FEDERAL_HOLIDAYS): boolean {
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

export function addBusinessDays(
  from: Date,
  days: number,
  calendar: HolidayCalendar = US_FEDERAL_HOLIDAYS,
): Date {
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

export function businessDayDeadline(
  anchor: Date,
  days: number,
  calendar: HolidayCalendar = US_FEDERAL_HOLIDAYS,
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

/**
 * §29.6/§6: three US business days from `creator_failure_recorded_at`,
 * calendar-versioned. Store the returned version with the timestamp; use
 * `retainDeadline` so recomputation can never reset it.
 */
export function creatorReplacementDeadline(
  creatorFailureRecordedAt: Date,
  calendar: HolidayCalendar = US_FEDERAL_HOLIDAYS,
): BusinessDayDeadline {
  return businessDayDeadline(creatorFailureRecordedAt, CREATOR_REPLACEMENT_WINDOW_BUSINESS_DAYS, calendar);
}
