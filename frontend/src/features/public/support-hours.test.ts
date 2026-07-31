/**
 * The live-chat staffed-hours gate — Spec §31.4, §30.
 *
 * "Never promise unstaffed chat" and "live chat without staffing" is on §30's
 * forbidden list, so the interesting cases here are all the ones where the gate
 * has to say no: no configuration, half a configuration, a nonsense window, a
 * weekend, a federal holiday, and a date the committed calendar does not cover.
 */

import { describe, it, expect } from 'vitest';
import { isStaffed, parseHours, readSupportChatConfig } from './support-hours.js';

const COMPLETE = {
  propertyId: 'prop_test',
  widgetId: 'widget_test',
  timeZone: 'America/New_York',
  hours: '09:00-17:00',
};

describe('configuration fails closed (§31.4)', () => {
  it('accepts a complete configuration', () => {
    const config = readSupportChatConfig(COMPLETE);
    expect(config).toEqual({
      propertyId: 'prop_test',
      widgetId: 'widget_test',
      timeZone: 'America/New_York',
      openMinute: 9 * 60,
      closeMinute: 17 * 60,
    });
  });

  it('refuses an empty configuration — there is no default opening time', () => {
    expect(readSupportChatConfig({})).toBeNull();
  });

  it.each(['propertyId', 'widgetId', 'timeZone', 'hours'] as const)(
    'refuses a configuration missing %s',
    (field) => {
      const partial = { ...COMPLETE, [field]: undefined };
      expect(readSupportChatConfig(partial)).toBeNull();
    },
  );

  it('refuses an unparseable window', () => {
    for (const hours of ['9-5', '09:00', '09:00–17:00', '25:00-26:00', 'always']) {
      expect(readSupportChatConfig({ ...COMPLETE, hours }), hours).toBeNull();
    }
  });

  it('refuses a window that does not close after it opens', () => {
    expect(parseHours('17:00-09:00')).toBeNull();
    expect(parseHours('09:00-09:00')).toBeNull();
  });

  it('refuses an invalid timezone rather than silently using UTC', () => {
    expect(readSupportChatConfig({ ...COMPLETE, timeZone: 'Mars/Olympus' })).toBeNull();
  });
});

describe('the widget shows only inside staffed hours', () => {
  const config = readSupportChatConfig(COMPLETE);
  if (!config) throw new Error('fixture configuration should parse');

  it('is staffed mid-morning on a business day', () => {
    // Wednesday 2026-09-16, 14:00 UTC = 10:00 America/New_York (EDT).
    expect(isStaffed(new Date('2026-09-16T14:00:00Z'), config)).toBe(true);
  });

  it('is closed before opening and after closing on a business day', () => {
    // 12:00 UTC = 08:00 local; 22:00 UTC = 18:00 local.
    expect(isStaffed(new Date('2026-09-16T12:00:00Z'), config)).toBe(false);
    expect(isStaffed(new Date('2026-09-16T22:00:00Z'), config)).toBe(false);
  });

  it('closes exactly at the closing minute, not a minute after', () => {
    // 21:00 UTC = 17:00 local.
    expect(isStaffed(new Date('2026-09-16T20:59:00Z'), config)).toBe(true);
    expect(isStaffed(new Date('2026-09-16T21:00:00Z'), config)).toBe(false);
  });

  it('is closed at the weekend', () => {
    // Saturday 2026-09-19 and Sunday 2026-09-20, both mid-morning local.
    expect(isStaffed(new Date('2026-09-19T14:00:00Z'), config)).toBe(false);
    expect(isStaffed(new Date('2026-09-20T14:00:00Z'), config)).toBe(false);
  });

  it('is closed on a U.S. federal holiday', () => {
    // Thanksgiving 2026-11-26. 15:00 UTC = 10:00 America/New_York (EST).
    expect(isStaffed(new Date('2026-11-26T15:00:00Z'), config)).toBe(false);
  });

  it('is closed on a date the committed calendar does not cover', () => {
    // The calendar runs to 2028-12-31; beyond it the answer is not "probably
    // a weekday", it is "we do not know", which means no chat.
    expect(isStaffed(new Date('2031-06-04T14:00:00Z'), config)).toBe(false);
  });
});
