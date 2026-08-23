import { describe, expect, it } from 'vitest';
import {
  isAtLeastFounderAge,
  isCalendarDate,
  latestBirthdateForAge,
} from '../vetting/age.js';

describe('Founder minimum age', () => {
  const today = new Date('2026-08-23T12:00:00.000Z');

  it('accepts the eighteenth birthday and rejects the following day', () => {
    expect(latestBirthdateForAge(18, today)).toBe('2008-08-23');
    expect(isAtLeastFounderAge('2008-08-23', today)).toBe(true);
    expect(isAtLeastFounderAge('2008-08-24', today)).toBe(false);
  });

  it('rejects impossible calendar dates', () => {
    expect(isCalendarDate('2000-02-29')).toBe(true);
    expect(isCalendarDate('2001-02-29')).toBe(false);
  });

  it('uses the last real day for a leap-day cutoff', () => {
    const leapDay = new Date('2024-02-29T12:00:00.000Z');
    expect(latestBirthdateForAge(18, leapDay)).toBe('2006-02-28');
  });
});
