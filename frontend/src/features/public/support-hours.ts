/**
 * Staffed-hours arithmetic for the live-chat widget — Spec §31.4, §27.8.
 *
 * §31.4: "Tawk.to live chat may appear where actually staffed/implemented
 * during stated US business hours; never promise unstaffed chat." §30 lists
 * "live chat without staffing" as a pattern that weakens trust. So the widget
 * is gated on hours, and the gate fails closed in every direction: any missing
 * configuration, any unparseable value, any date the committed calendar does
 * not cover, and the answer is "not staffed" and nothing renders.
 *
 * The Spec names the setting and fixes no number — exactly like
 * `ADMIN_REAUTH_WINDOW_SECONDS` in §6 — so there is no default here. An
 * operator states the hours or there is no chat. Inventing an opening time
 * would be inventing a service commitment.
 *
 * The day rule is not invented either: §27.8's published commitment is
 * "Monday–Friday, excluding U.S. federal holidays", and that is precisely what
 * the committed, versioned calendar in `shared/calendar` computes.
 */

import { isBusinessDay, US_FEDERAL_HOLIDAYS } from '@proovd/shared';

export interface SupportChatConfig {
  propertyId: string;
  widgetId: string;
  /** IANA zone the hours below are stated in. */
  timeZone: string;
  /** Minutes after local midnight. */
  openMinute: number;
  closeMinute: number;
}

/** `"09:00-17:00"` → minute pair. Returns null on anything else. */
export function parseHours(value: string): { openMinute: number; closeMinute: number } | null {
  const match = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [openHour, openMin, closeHour, closeMin] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
  ];
  if (openHour > 23 || closeHour > 23 || openMin > 59 || closeMin > 59) return null;
  const openMinute = openHour * 60 + openMin;
  const closeMinute = closeHour * 60 + closeMin;
  // An overnight window would be a claim about staffing we have no basis for.
  if (closeMinute <= openMinute) return null;
  return { openMinute, closeMinute };
}

export interface RawSupportChatEnv {
  propertyId?: string | undefined;
  widgetId?: string | undefined;
  timeZone?: string | undefined;
  hours?: string | undefined;
}

/**
 * Every field or nothing. A property ID without hours would render a widget
 * that is always visible; hours without a property ID render nothing anyway.
 * Half a configuration is a misconfiguration, and it fails closed.
 */
export function readSupportChatConfig(env: RawSupportChatEnv): SupportChatConfig | null {
  const propertyId = env.propertyId?.trim();
  const widgetId = env.widgetId?.trim();
  const timeZone = env.timeZone?.trim();
  const hours = env.hours?.trim();
  if (!propertyId || !widgetId || !timeZone || !hours) return null;

  const parsed = parseHours(hours);
  if (!parsed) return null;

  // An invalid IANA zone throws here rather than silently resolving to UTC and
  // opening the chat at the wrong time of day in the wrong country.
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date(0));
  } catch {
    return null;
  }

  return { propertyId, widgetId, timeZone, ...parsed };
}

function minutesSinceMidnight(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(instant);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? NaN);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? NaN);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return NaN;
  return (hour % 24) * 60 + minute;
}

/**
 * True only inside a business day, inside the configured window. Any error —
 * including a date beyond the committed calendar's coverage — is "closed".
 */
export function isStaffed(now: Date, config: SupportChatConfig): boolean {
  let businessDay: boolean;
  try {
    // The calendar decides which civil date this instant falls on, in the
    // calendar's own timezone — that is the definition of a U.S. federal
    // business day and it is not the operator's to restate.
    businessDay = isBusinessDay(now, US_FEDERAL_HOLIDAYS);
  } catch {
    return false;
  }
  if (!businessDay) return false;

  const minute = minutesSinceMidnight(now, config.timeZone);
  if (!Number.isFinite(minute)) return false;
  return minute >= config.openMinute && minute < config.closeMinute;
}
