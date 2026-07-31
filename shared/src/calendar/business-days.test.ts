/**
 * §33.12.2 — a business-day deadline is exact, carries its calendar version,
 * and cannot be reset by recomputation (§29.6). Plus the §33.12.1 unit side:
 * each deadline helper is a pure function of exactly its anchor.
 */

import { describe, it, expect } from 'vitest';
import {
  US_FEDERAL_HOLIDAYS,
  isBusinessDay,
  addBusinessDays,
  businessDayDeadline,
  retainDeadline,
  CalendarError,
} from './business-days.js';
import {
  affiliateResponseDeadline,
  founderFreeCancellationDeadline,
  captureRetryDeadline,
  ideaSinglePaymentDue,
  productFirstPaymentDue,
  productRemainingPaymentDue,
  creatorReplacementDeadline,
} from './deadlines.js';

describe('holiday calendar data (§6, tech-stack §4.5)', () => {
  it('is committed, versioned, and timezone-configured', () => {
    expect(US_FEDERAL_HOLIDAYS.version).toBe('us-federal.v1');
    expect(US_FEDERAL_HOLIDAYS.timezone).toBe('America/New_York');
    expect(US_FEDERAL_HOLIDAYS.holidays.length).toBeGreaterThan(40);
  });

  it('lists only weekday dates — observed dates already shifted off weekends', () => {
    for (const h of US_FEDERAL_HOLIDAYS.holidays) {
      expect(h.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const weekday = new Date(`${h.date}T12:00:00Z`).getUTCDay();
      expect(weekday, `${h.name} ${h.date} falls on a weekend`).toBeGreaterThan(0);
      expect(weekday, `${h.name} ${h.date} falls on a weekend`).toBeLessThan(6);
    }
  });
});

describe('business-day arithmetic (§29.6, §33.12.2)', () => {
  it('classifies weekends and holidays as non-business days', () => {
    expect(isBusinessDay(new Date('2026-03-10T15:00:00Z'), US_FEDERAL_HOLIDAYS)).toBe(true); // Tue
    expect(isBusinessDay(new Date('2026-03-14T15:00:00Z'), US_FEDERAL_HOLIDAYS)).toBe(false); // Sat
    expect(isBusinessDay(new Date('2026-07-03T15:00:00Z'), US_FEDERAL_HOLIDAYS)).toBe(false); // observed July 4th
  });

  it('is exact over plain weekdays', () => {
    // Tue 2026-03-10 → Wed, Thu, Fri: due Fri 2026-03-13, same time of day.
    const due = addBusinessDays(new Date('2026-03-10T15:00:00Z'), 3, US_FEDERAL_HOLIDAYS);
    expect(due.toISOString()).toBe('2026-03-13T15:00:00.000Z');
  });

  it('is exact across a weekend plus an observed holiday', () => {
    // Failure recorded Thu 2026-07-02. Fri Jul 3 is Independence Day
    // (observed), then the weekend — the three business days are Mon 6,
    // Tue 7, Wed 8.
    const { dueAt, calendarVersion } = creatorReplacementDeadline(
      new Date('2026-07-02T18:00:00Z'),
    );
    expect(dueAt.toISOString()).toBe('2026-07-08T18:00:00.000Z');
    expect(calendarVersion).toBe('us-federal.v1');
  });

  it('decides the civil date in the configured timezone, not UTC', () => {
    // 2026-07-03T02:00Z is still Thu Jul 2 in New York, so the count starts
    // from the same civil anchor as the previous test and lands on civil
    // Wed Jul 8 (03:00Z next UTC day... i.e. 2026-07-09T02:00Z).
    const due = addBusinessDays(new Date('2026-07-03T02:00:00Z'), 3, US_FEDERAL_HOLIDAYS);
    expect(due.toISOString()).toBe('2026-07-09T02:00:00.000Z');
  });

  it('carries the calendar version with the computed deadline', () => {
    const d = businessDayDeadline(new Date('2026-03-10T15:00:00Z'), 3, US_FEDERAL_HOLIDAYS);
    expect(d.calendarVersion).toBe(US_FEDERAL_HOLIDAYS.version);
  });

  it('cannot be reset by recomputation — retries and edits return the stored value (§29.6)', () => {
    const stored = businessDayDeadline(new Date('2026-03-10T15:00:00Z'), 3, US_FEDERAL_HOLIDAYS);
    // A later recomputation from a different (edited/replayed) anchor.
    const recomputed = businessDayDeadline(
      new Date('2026-03-12T09:00:00Z'),
      3,
      US_FEDERAL_HOLIDAYS,
    );
    expect(retainDeadline(stored, recomputed)).toBe(stored);
    // Only a record with no stored deadline accepts the computed one.
    expect(retainDeadline(null, recomputed)).toBe(recomputed);
  });

  it('fails loud outside calendar coverage instead of treating holidays as workdays', () => {
    expect(() =>
      addBusinessDays(new Date('2028-12-29T15:00:00Z'), 3, US_FEDERAL_HOLIDAYS),
    ).toThrow(CalendarError);
  });

  it('rejects a non-positive day count', () => {
    expect(() => addBusinessDays(new Date('2026-03-10T15:00:00Z'), 0, US_FEDERAL_HOLIDAYS)).toThrow(
      CalendarError,
    );
  });
});

describe('anchor-keyed deadlines (§21, §6, §33.12.1)', () => {
  // Three distinct anchors — each helper must read exactly its own.
  const listingPaidAt = new Date('2026-03-02T10:00:00Z');
  const campaignCloseAt = new Date('2026-03-20T21:00:00Z');
  const firstFailureAt = new Date('2026-03-20T21:05:00Z');

  it('72-hour response and 48-hour cancellation clocks anchor on listing_paid_at', () => {
    expect(affiliateResponseDeadline(listingPaidAt).toISOString()).toBe(
      '2026-03-05T10:00:00.000Z',
    );
    expect(founderFreeCancellationDeadline(listingPaidAt).toISOString()).toBe(
      '2026-03-04T10:00:00.000Z',
    );
  });

  it('Day 3 / Day 14 payments anchor on campaign_close_at', () => {
    expect(ideaSinglePaymentDue(campaignCloseAt).toISOString()).toBe('2026-03-23T21:00:00.000Z');
    expect(productFirstPaymentDue(campaignCloseAt).toISOString()).toBe('2026-03-23T21:00:00.000Z');
    expect(productRemainingPaymentDue(campaignCloseAt).toISOString()).toBe(
      '2026-04-03T21:00:00.000Z',
    );
  });

  it('the 48-hour retry window anchors on the first close-batch failure (§21)', () => {
    expect(captureRetryDeadline(firstFailureAt).toISOString()).toBe('2026-03-22T21:05:00.000Z');
  });
});
