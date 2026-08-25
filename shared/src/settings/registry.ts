/**
 * The §6 operating-constant register — Spec §6 (Phase 0, global configuration).
 *
 * Same shape as the policy register in `shared/src/policies/documents.ts`, and
 * for the same reason: one declaration, mirrored row-for-row by a backend table,
 * with a drift test that fails the suite if the two ever disagree.
 *
 * ── Why a register and not a settings table alone ───────────────────────────
 * §6 names roughly thirty constants and fixes a value for most of them. A bare
 * key/value table cannot say which keys §6 requires, what unit each carries,
 * which ones §6 deliberately leaves to the operator, or which ones are not the
 * operator's to set at all. Without that, "the settings surface" degenerates
 * into a page of free-text boxes where a typo silently rewrites a commercial
 * rule. So the register is the schema and the table is the state.
 *
 * ── The three provenance kinds ──────────────────────────────────────────────
 * `specified`   §6 states the value. It seeds the setting and Admin may change
 *               it, because §6 calls it a setting rather than a constant.
 * `operator`    §6 names the setting and fixes NO value — approved campaign
 *               min/max duration, the interview roster, the Admin
 *               reauthentication window. There is no default anywhere: §1
 *               rule 6 forbids inventing a commercial value, so the setting
 *               ships unset and an unset required setting BLOCKS (see
 *               `missingRequiredSettings`). This is the same rule that keeps
 *               `ADMIN_REAUTH_WINDOW_SECONDS` and `VITE_SUPPORT_CHAT_*`
 *               without defaults.
 * `derived`     The value comes from a committed artifact, not from an
 *               operator. The holiday-calendar version and its timezone are
 *               the whole set. §29.6 requires the calendar version to be
 *               stored alongside every computed deadline and forbids an edit
 *               silently resetting one; a text box that repoints the calendar
 *               would do exactly that. The surface shows these with their
 *               provenance and no input.
 *
 * ── Values are text ─────────────────────────────────────────────────────────
 * Every value serialises to a string, because the backing table is one column
 * and a versioned history row has to compare old against new without knowing
 * the type. `kind` says how to read it back; `parseSettingValue` is the only
 * reader. Money is integer cents in the string, never a decimal dollar amount
 * (money rule: integer cents, never floats).
 */

import {
  LISTING_FEE_BASE_CENTS,
  LISTING_FEE_ITEM_DISCOUNT_CENTS,
  LISTING_FEE_MAX_DISCOUNT_CENTS,
  LISTING_FEE_MIN_CENTS,
  PLATFORM_FEE_PERCENT,
  AFFILIATE_BASE_PERCENT_STANDARD,
  AFFILIATE_BASE_PERCENT_WITH_FIXED,
  PERCENTAGE_CEILING,
  CAMPAIGN_CAP_CENTS,
  PRODUCT_DEFAULT_DURATION_DAYS,
  CAPTURE_RETRY_WINDOW_HOURS,
  AFFILIATE_RESPONSE_WINDOW_HOURS,
  FOUNDER_FREE_CANCELLATION_WINDOW_HOURS,
  CREATOR_REPLACEMENT_WINDOW_BUSINESS_DAYS,
  IDEA_SINGLE_PAYMENT_DAY,
  PRODUCT_FIRST_PAYMENT_DAY,
  PRODUCT_FIRST_PAYMENT_PERCENT,
  PRODUCT_REMAINING_PAYMENT_DAY,
  PRODUCT_REMAINING_PAYMENT_PERCENT,
  REQUIRED_PROMOTIONAL_POSTS,
} from '../money/constants.js';
import { US_FEDERAL_HOLIDAYS } from '../calendar/business-days.js';

/* ── Kinds ────────────────────────────────────────────────────────────────── */

export type SettingKind =
  /** Integer cents, in a `bigint`-safe decimal string. Never dollars. */
  | 'money_cents'
  /** Integer 0–100. */
  | 'percent'
  /** Non-negative integer with no time unit — a count of things. */
  | 'count'
  /** Positive integer, calendar days. */
  | 'calendar_days'
  /** Positive integer, US business days from the committed calendar. */
  | 'business_days'
  /** Positive integer, hours. */
  | 'hours'
  /** Positive integer, seconds. */
  | 'seconds'
  /** Positive integer, calendar months. */
  | 'months'
  | 'boolean'
  /** Newline-separated list. Empty lines are dropped on parse. */
  | 'text_list'
  | 'text';

export type SettingProvenance = 'specified' | 'operator' | 'derived';

export type SettingGroup =
  | 'listing_fee'
  | 'platform_and_compensation'
  | 'campaign_limits'
  | 'deadlines'
  | 'calendar'
  | 'founder_payments'
  | 'creator_work'
  | 'interviews'
  | 'support'
  | 'admin_security';

export interface SettingDefinition {
  /** Stable key. The backing table's primary identity; never renamed. */
  key: string;
  /** Admin-facing name. Customer-facing vocabulary — Creator, never affiliate. */
  label: string;
  group: SettingGroup;
  kind: SettingKind;
  provenance: SettingProvenance;
  /** The §6 line this implements. */
  specRef: string;
  /**
   * The seeded value, as text. `null` exactly when `provenance` is `operator`:
   * §6 names the setting and fixes no value, so nothing here may invent one.
   */
  defaultValue: string | null;
  /** What the number means and what reads it. Rendered as the field hint. */
  help: string;
  /**
   * A floor §6 states in words rather than as the value itself — "at least
   * three months". Validation enforces it; the operator may go higher.
   */
  minimum?: number;
  maximum?: number;
}

/* ── The register ─────────────────────────────────────────────────────────── */

/**
 * Every constant §6 names, in the order §6 names them. Adding a row here is
 * adding a commercial rule: §1 rule 6 forbids that unless the Spec states it.
 */
export const SETTING_DEFINITIONS: readonly SettingDefinition[] = [
  /* ── Listing fee ────────────────────────────────────────────────────────── */
  {
    key: 'listing_fee_base_cents',
    label: 'Listing fee — base',
    group: 'listing_fee',
    kind: 'money_cents',
    provenance: 'specified',
    specRef: '§6 · Listing-fee base: US$35',
    defaultValue: String(LISTING_FEE_BASE_CENTS),
    help: 'The starting listing fee before optional-item discounts. Read by the listing-fee calculation and by the Founder’s fee preview.',
    minimum: 0,
  },
  {
    key: 'listing_fee_item_discount_cents',
    label: 'Listing fee — discount per completed optional item',
    group: 'listing_fee',
    kind: 'money_cents',
    provenance: 'specified',
    specRef: '§6 · US$2 per completed Visuals, Branding, confirmed Founder interview, Story, Socials',
    defaultValue: String(LISTING_FEE_ITEM_DISCOUNT_CENTS),
    help: 'Applied once for each of the five completed optional items.',
    minimum: 0,
  },
  {
    key: 'listing_fee_max_discount_cents',
    label: 'Listing fee — maximum total discount',
    group: 'listing_fee',
    kind: 'money_cents',
    provenance: 'specified',
    specRef: '§6 · Maximum discount: US$10',
    defaultValue: String(LISTING_FEE_MAX_DISCOUNT_CENTS),
    help: 'The discount ceiling, applied before the minimum fee floor.',
    minimum: 0,
  },
  {
    key: 'listing_fee_min_cents',
    label: 'Listing fee — minimum',
    group: 'listing_fee',
    kind: 'money_cents',
    provenance: 'specified',
    specRef: '§6 · Minimum listing fee: US$25',
    defaultValue: String(LISTING_FEE_MIN_CENTS),
    help: 'The floor no combination of discounts may go below.',
    minimum: 0,
  },

  /* ── Platform fee and Creator compensation ──────────────────────────────── */
  {
    key: 'platform_fee_percent',
    label: 'Proovd platform fee',
    group: 'platform_and_compensation',
    kind: 'percent',
    provenance: 'specified',
    specRef: '§6 · Platform fee: 5% of captured pre-tax reward subtotal',
    defaultValue: String(PLATFORM_FEE_PERCENT),
    help: 'Taken from the captured pre-tax reward subtotal. Sales tax is excluded from this base (§24.3).',
    minimum: 0,
    maximum: 100,
  },
  {
    key: 'affiliate_base_percent_standard',
    label: 'Creator base percentage — standard',
    group: 'platform_and_compensation',
    kind: 'percent',
    provenance: 'specified',
    specRef: '§6 · Base Affiliate percentages: 30%',
    defaultValue: String(AFFILIATE_BASE_PERCENT_STANDARD),
    help: 'The Creator’s base share of an attributed captured charge, pre-tax.',
    minimum: 0,
    maximum: 100,
  },
  {
    key: 'affiliate_base_percent_with_fixed',
    label: 'Creator base percentage — where an accepted fixed payment exists',
    group: 'platform_and_compensation',
    kind: 'percent',
    provenance: 'specified',
    specRef: '§6 · 20% when an accepted Product-Campaign fixed Creator payment exists',
    defaultValue: String(AFFILIATE_BASE_PERCENT_WITH_FIXED),
    help: 'Applies only on a Product Campaign where a fixed Creator payment was accepted.',
    minimum: 0,
    maximum: 100,
  },
  {
    key: 'affiliate_percentage_ceiling',
    label: 'Creator percentage ceiling',
    group: 'platform_and_compensation',
    kind: 'percent',
    provenance: 'specified',
    specRef: '§6 · Percentage compensation ceiling: 50% per attributed captured charge',
    defaultValue: String(PERCENTAGE_CEILING),
    help: 'Base plus bid plus bonus, per attributed captured charge. Never exceeded (§33.2.12).',
    minimum: 0,
    maximum: 100,
  },
  {
    key: 'high_effort_inputs',
    label: 'High-effort inputs',
    group: 'platform_and_compensation',
    kind: 'text_list',
    provenance: 'specified',
    specRef: '§6 · High-effort inputs: no Visuals, no Branding, no confirmed/scheduled Founder interview',
    defaultValue: ['visuals_absent', 'branding_absent', 'founder_interview_absent'].join('\n'),
    help: 'The three absences that make a campaign high-effort. §6 fixes this list; changing it changes what a Creator is being asked to take on.',
  },

  /* ── Campaign limits and duration ───────────────────────────────────────── */
  {
    key: 'campaign_cap_cents',
    label: 'Campaign cap',
    group: 'campaign_limits',
    kind: 'money_cents',
    provenance: 'specified',
    specRef: '§6 · Campaign cap: US$50,000 aggregate pre-tax active-pre-order value',
    defaultValue: String(CAMPAIGN_CAP_CENTS),
    help: 'Aggregate pre-tax value of active pre-orders on one campaign. Sales tax is excluded from the cap (§24.3).',
    minimum: 0,
  },
  {
    key: 'product_default_duration_days',
    label: 'Product Campaign — default duration',
    group: 'campaign_limits',
    kind: 'calendar_days',
    provenance: 'specified',
    specRef: '§6 · Product Campaign default duration: 14 days',
    defaultValue: String(PRODUCT_DEFAULT_DURATION_DAYS),
    help: 'Pre-filled when a Founder sets a Product Campaign close date.',
    minimum: 1,
  },
  {
    key: 'product_min_duration_days',
    label: 'Product Campaign — approved minimum duration',
    group: 'campaign_limits',
    kind: 'calendar_days',
    provenance: 'operator',
    specRef: '§6 · approved min/max duration',
    defaultValue: null,
    help: 'The shortest Product Campaign Proovd will approve. §6 names this setting and fixes no number, so it ships unset and blocks until you state one.',
    minimum: 1,
  },
  {
    key: 'product_max_duration_days',
    label: 'Product Campaign — approved maximum duration',
    group: 'campaign_limits',
    kind: 'calendar_days',
    provenance: 'operator',
    specRef: '§6 · approved min/max duration',
    defaultValue: null,
    help: 'The longest Product Campaign Proovd will approve. §6 names this setting and fixes no number, so it ships unset and blocks until you state one.',
    minimum: 1,
  },

  /* ── Deadlines and windows ──────────────────────────────────────────────── */
  {
    key: 'capture_retry_window_hours',
    label: 'Failed-payment retry window',
    group: 'deadlines',
    kind: 'hours',
    provenance: 'specified',
    specRef: '§6 · Failed-payment retry window: fixed 48 hours',
    defaultValue: String(CAPTURE_RETRY_WINDOW_HOURS),
    help: 'How long a Backer has to fix a card after a failed charge before the payment is dropped.',
    minimum: 1,
  },
  {
    key: 'precharge_reminder_lead_hours',
    label: 'Pre-charge reminder lead time',
    group: 'deadlines',
    kind: 'hours',
    provenance: 'specified',
    specRef: '§6 · Pre-charge reminder: approximately 24 hours before trigger',
    defaultValue: '24',
    help: 'How far ahead of the charge the Backer reminder is sent. §6 says approximately — this is the target, not a guarantee, and the email says so.',
    minimum: 1,
  },
  {
    key: 'affiliate_response_window_hours',
    label: 'Creator formal-response window',
    group: 'deadlines',
    kind: 'hours',
    provenance: 'specified',
    specRef: '§6 · Affiliate formal-response window: fixed 72 hours from listing_paid_at',
    defaultValue: String(AFFILIATE_RESPONSE_WINDOW_HOURS),
    help: 'Measured from listing_paid_at, which is a dedicated column and never inferred from created_at (§21).',
    minimum: 1,
  },
  {
    key: 'founder_free_cancellation_window_hours',
    label: 'Founder free-cancellation window',
    group: 'deadlines',
    kind: 'hours',
    provenance: 'specified',
    specRef: '§6 · Founder free-cancellation window: 48 hours from listing_paid_at, only while not live',
    defaultValue: String(FOUNDER_FREE_CANCELLATION_WINDOW_HOURS),
    help: 'Measured from listing_paid_at, and available only while the campaign is not live.',
    minimum: 1,
  },
  {
    key: 'creator_replacement_window_business_days',
    label: 'Creator replacement window',
    group: 'deadlines',
    kind: 'business_days',
    provenance: 'specified',
    specRef: '§6 · Creator replacement window: three US business days from creator_failure_recorded_at',
    defaultValue: String(CREATOR_REPLACEMENT_WINDOW_BUSINESS_DAYS),
    help: 'Counted in US business days against the committed holiday calendar. The calendar version is stored with the computed deadline so a retry cannot silently reset it (§29.6).',
    minimum: 1,
  },
  {
    key: 'founder_cooldown_months',
    label: 'Founder repeat-campaign cooldown',
    group: 'deadlines',
    kind: 'months',
    provenance: 'specified',
    specRef: '§6 · Founder repeat-campaign cooldown: at least three months',
    defaultValue: '3',
    help: 'The wait before a Founder may run another campaign. §6 states a floor of three months rather than an exact figure, so this may be raised but never lowered below three.',
    minimum: 3,
  },

  /* ── Calendar (derived from the committed artifact) ─────────────────────── */
  {
    key: 'business_day_calendar_version',
    label: 'US business-day calendar version',
    group: 'calendar',
    kind: 'text',
    provenance: 'derived',
    specRef: '§6 · US business-day calendar, timezone, holiday version',
    defaultValue: US_FEDERAL_HOLIDAYS.version,
    help: 'Comes from the committed holiday calendar in shared/calendar and is recorded alongside every computed deadline. A new calendar is a new committed version and a new deployment — never a settings edit, because an edit here would silently move deadlines that were already promised (§29.6).',
  },
  {
    key: 'business_day_time_zone',
    label: 'US business-day timezone',
    group: 'calendar',
    kind: 'text',
    provenance: 'derived',
    specRef: '§6 · US business-day calendar, timezone, holiday version',
    defaultValue: US_FEDERAL_HOLIDAYS.timezone,
    help: 'The civil timezone the committed calendar resolves business days in. Changes with the calendar, not independently of it.',
  },

  /* ── Founder payment schedules ──────────────────────────────────────────── */
  {
    key: 'idea_single_payment_day',
    label: 'Idea Campaign — single payment day',
    group: 'founder_payments',
    kind: 'calendar_days',
    provenance: 'specified',
    specRef: '§6 · Founder payment schedules: Idea 100% Day 3',
    defaultValue: String(IDEA_SINGLE_PAYMENT_DAY),
    help: 'Days after campaign close that the single Founder payment is released.',
    minimum: 0,
  },
  {
    key: 'idea_single_payment_percent',
    label: 'Idea Campaign — single payment share',
    group: 'founder_payments',
    kind: 'percent',
    provenance: 'specified',
    specRef: '§6 · Founder payment schedules: Idea 100% Day 3',
    defaultValue: '100',
    help: 'An Idea Campaign releases the Founder’s share in one payment.',
    minimum: 0,
    maximum: 100,
  },
  {
    key: 'product_first_payment_day',
    label: 'Product Campaign — first payment day',
    group: 'founder_payments',
    kind: 'calendar_days',
    provenance: 'specified',
    specRef: '§6 · Founder payment schedules: Product 40% Day 3 / 60% Day 14',
    defaultValue: String(PRODUCT_FIRST_PAYMENT_DAY),
    help: 'Days after campaign close that the first payment is released.',
    minimum: 0,
  },
  {
    key: 'product_first_payment_percent',
    label: 'Product Campaign — first payment share',
    group: 'founder_payments',
    kind: 'percent',
    provenance: 'specified',
    specRef: '§6 · Founder payment schedules: Product 40% Day 3 / 60% Day 14',
    defaultValue: String(PRODUCT_FIRST_PAYMENT_PERCENT),
    help: 'Share of the Founder’s net released in the first payment.',
    minimum: 0,
    maximum: 100,
  },
  {
    key: 'product_remaining_payment_day',
    label: 'Product Campaign — remaining payment day',
    group: 'founder_payments',
    kind: 'calendar_days',
    provenance: 'specified',
    specRef: '§6 · Founder payment schedules: Product 40% Day 3 / 60% Day 14',
    defaultValue: String(PRODUCT_REMAINING_PAYMENT_DAY),
    help: 'Days after campaign close that the remaining payment is released, subject to the Day 14 review.',
    minimum: 0,
  },
  {
    key: 'product_remaining_payment_percent',
    label: 'Product Campaign — remaining payment share',
    group: 'founder_payments',
    kind: 'percent',
    provenance: 'specified',
    specRef: '§6 · Founder payment schedules: Product 40% Day 3 / 60% Day 14',
    defaultValue: String(PRODUCT_REMAINING_PAYMENT_PERCENT),
    help: 'Share of the Founder’s net released in the remaining payment.',
    minimum: 0,
    maximum: 100,
  },
  {
    key: 'product_early_remaining_payment_enabled',
    label: 'Product Campaign — early remaining payment',
    group: 'founder_payments',
    kind: 'boolean',
    provenance: 'specified',
    specRef: '§6 · Product early-remaining-payment control, disabled by default and evidence-gated',
    defaultValue: 'false',
    help: 'Disabled by default. Enabling it does not release anything on its own — each request is still evidence-gated and decided by an Admin.',
  },

  /* ── Creator work ───────────────────────────────────────────────────────── */
  {
    key: 'required_promotional_posts',
    label: 'Required promotional posts',
    group: 'creator_work',
    kind: 'count',
    provenance: 'specified',
    specRef: '§6 · Default required promotional post count: three',
    defaultValue: String(REQUIRED_PROMOTIONAL_POSTS),
    help: 'The default deliverable count on a campaign association, before any agreed adjustment.',
    minimum: 1,
  },

  /* ── Interviews ─────────────────────────────────────────────────────────── */
  {
    key: 'interview_providers',
    label: 'Interview providers',
    group: 'interviews',
    kind: 'text_list',
    provenance: 'operator',
    specRef: '§6 · Interview providers',
    defaultValue: null,
    help: 'One provider per line — the scheduling or conferencing services interviews actually run on. §6 names the setting and fixes no list, so it ships unset and blocks until you state one.',
  },
  {
    key: 'interview_availability',
    label: 'Interview availability',
    group: 'interviews',
    kind: 'text',
    provenance: 'operator',
    specRef: '§6 · interview availability',
    defaultValue: null,
    help: 'The hours interviews can actually be booked into, stated with a timezone. Never a wider window than someone is available for — an offered slot no one attends is the automation-that-does-not-exist failure (§1.4).',
  },
  {
    key: 'interviewers',
    label: 'Interviewers',
    group: 'interviews',
    kind: 'text_list',
    provenance: 'operator',
    specRef: '§6 · interviewers',
    defaultValue: null,
    help: 'One named interviewer per line. §7 requires a named Proovd sender and reply route; an interview invitation from nobody in particular is the same failure.',
  },
  {
    key: 'interview_reminder_lead_hours',
    label: 'Interview reminder lead time',
    group: 'interviews',
    kind: 'hours',
    provenance: 'operator',
    specRef: '§6 · reminder lead times',
    defaultValue: null,
    help: 'How far ahead of an interview the reminder is sent. §6 names the setting and fixes no number.',
    minimum: 1,
  },

  /* ── Support ────────────────────────────────────────────────────────────── */
  {
    key: 'support_sla_business_days',
    label: 'Support SLA',
    group: 'support',
    kind: 'business_days',
    provenance: 'specified',
    specRef: '§6 · Support SLA: one business day, Monday–Friday excluding US federal holidays',
    defaultValue: '1',
    help: 'The published response commitment. §27.8 renders it verbatim in the public footer, so raising this number changes a public promise.',
    minimum: 1,
  },

  /* ── Admin security ─────────────────────────────────────────────────────── */
  /*
   * `admin_mfa_required` used to sit here, seeded 'true'. The Admin second
   * factor was removed by product direction on 2026-08-10, and migration 0041
   * deletes the row — a setting whose value asserts a control that no longer
   * exists is a false statement in the one surface an operator consults to
   * learn what is in force (§1.4).
   *
   * It was deleted rather than flipped to 'false': flipping it would record a
   * decision to DISABLE MFA that nobody took. The requirement was not turned
   * off; the mechanism was removed. Reinstating the factor means reinstating
   * the plugin, the table, the enrolment path, and this entry together.
   */
  {
    key: 'admin_reauth_window_seconds',
    label: 'Admin reauthentication window',
    group: 'admin_security',
    kind: 'seconds',
    provenance: 'operator',
    specRef: '§6 · Admin MFA and reauthentication window',
    defaultValue: null,
    help: 'How recently an Admin must have signed in before a money-moving or campaign-killing action is allowed. §6 names the setting and fixes no number. On first boot this is seeded from ADMIN_REAUTH_WINDOW_SECONDS; after that the setting is authoritative and takes effect on the next request. With the Admin second factor removed this is the only freshness control on a high-impact action, so raising it widens the window a stolen session stays useful in.',
    minimum: 1,
  },
] as const;

export const SETTING_KEYS: readonly string[] = SETTING_DEFINITIONS.map((s) => s.key);

export function findSetting(key: string): SettingDefinition | undefined {
  return SETTING_DEFINITIONS.find((s) => s.key === key);
}

export function settingsInGroup(group: SettingGroup): readonly SettingDefinition[] {
  return SETTING_DEFINITIONS.filter((s) => s.group === group);
}

/** Group order and headings for the Admin surface. */
export const SETTING_GROUPS: readonly { group: SettingGroup; heading: string }[] = [
  { group: 'listing_fee', heading: 'Listing fee' },
  { group: 'platform_and_compensation', heading: 'Platform fee and Creator compensation' },
  { group: 'campaign_limits', heading: 'Campaign limits and duration' },
  { group: 'deadlines', heading: 'Deadlines and windows' },
  { group: 'calendar', heading: 'Business-day calendar' },
  { group: 'founder_payments', heading: 'Founder payment schedules' },
  { group: 'creator_work', heading: 'Creator work' },
  { group: 'interviews', heading: 'Interviews' },
  { group: 'support', heading: 'Support' },
  { group: 'admin_security', heading: 'Admin security' },
];

/* ── Parsing and validation ───────────────────────────────────────────────── */

export type SettingValue = bigint | number | boolean | string | readonly string[];

export interface SettingParseError {
  ok: false;
  /** Admin-facing. This surface is not the token surface; say what is wrong. */
  message: string;
}

export type SettingParseResult =
  | { ok: true; value: SettingValue }
  | SettingParseError;

const INTEGER_KINDS: readonly SettingKind[] = [
  'percent',
  'count',
  'calendar_days',
  'business_days',
  'hours',
  'seconds',
  'months',
];

/**
 * Reads a stored string back into its typed value, or explains the refusal.
 *
 * Strict on purpose. `parseInt('48 hours')` is 48, and a settings surface that
 * accepts that has quietly agreed to store whatever the operator typed and
 * hope the next reader agrees with it.
 */
export function parseSettingValue(
  definition: SettingDefinition,
  raw: string,
): SettingParseResult {
  const text = raw.trim();

  if (definition.kind === 'text') {
    if (!text) return { ok: false, message: 'This setting cannot be empty.' };
    return { ok: true, value: text };
  }

  if (definition.kind === 'text_list') {
    const entries = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (entries.length === 0) {
      return { ok: false, message: 'Enter at least one entry, one per line.' };
    }
    return { ok: true, value: entries };
  }

  if (definition.kind === 'boolean') {
    if (text === 'true') return { ok: true, value: true };
    if (text === 'false') return { ok: true, value: false };
    return { ok: false, message: 'Enter true or false.' };
  }

  if (!/^\d+$/.test(text)) {
    return {
      ok: false,
      message:
        definition.kind === 'money_cents'
          ? 'Enter a whole number of cents — 3500 for $35.00. Money is never a decimal here.'
          : 'Enter a whole number with no units or separators.',
    };
  }

  if (definition.kind === 'money_cents') {
    const value = BigInt(text);
    const floorFail = checkBounds(definition, Number(value));
    if (floorFail) return floorFail;
    return { ok: true, value };
  }

  if (INTEGER_KINDS.includes(definition.kind)) {
    const value = Number(text);
    if (!Number.isSafeInteger(value)) {
      return { ok: false, message: 'That number is too large.' };
    }
    const boundsFail = checkBounds(definition, value);
    if (boundsFail) return boundsFail;
    return { ok: true, value };
  }

  return { ok: false, message: 'Unrecognised setting type.' };
}

function checkBounds(
  definition: SettingDefinition,
  value: number,
): SettingParseError | null {
  if (definition.minimum !== undefined && value < definition.minimum) {
    return {
      ok: false,
      message: `${definition.specRef} sets a floor of ${definition.minimum}. This may be raised, never lowered below it.`,
    };
  }
  if (definition.maximum !== undefined && value > definition.maximum) {
    return {
      ok: false,
      message: `This value cannot exceed ${definition.maximum}.`,
    };
  }
  return null;
}

/* ── The fail-closed question ─────────────────────────────────────────────── */

export interface SettingState {
  key: string;
  /** `null` while an `operator` setting has never been given a value. */
  value: string | null;
}

/**
 * The keys §6 requires a value for and that have none.
 *
 * §6: "Incomplete prerequisites fail closed." An `operator` setting ships with
 * no default precisely so that this list is non-empty until someone states a
 * value — which is what blocks the dependent action rather than warning beside
 * an enabled button.
 */
export function missingRequiredSettings(
  state: readonly SettingState[],
): readonly string[] {
  const byKey = new Map(state.map((s) => [s.key, s.value]));
  return SETTING_DEFINITIONS.filter((definition) => {
    const value = byKey.get(definition.key);
    return value === undefined || value === null || value.trim() === '';
  }).map((definition) => definition.key);
}

/** True when a setting is Admin-editable at all. `derived` values are not. */
export function isEditableSetting(definition: SettingDefinition): boolean {
  return definition.provenance !== 'derived';
}
