/**
 * The backend's runtime copy of the Backers registers — Spec §26.1, §25.7, §19.
 *
 * `shared/` exports TypeScript source and the backend compiles under
 * `rootDir: src`, so nothing here can import it at runtime. The answer is the
 * one the state enums, the §6 settings, and the other three workspaces already
 * use: restate the data, drift-test it against `@proovd/shared`, never import
 * across the boundary. `tests/backer-workspace.test.ts` compares every constant
 * below against the shared register and fails if either side moves.
 *
 * What is deliberately NOT restated is the prose — `CONSENT_GOVERNS`,
 * `BACKERS_IS_READ_ONLY`, the disclosure sentences, the anchor notes. Those are
 * rendered by the browser, which imports the shared module directly through
 * Vite, so a fourth copy would be a fourth thing to drift. Only the values the
 * QUERY needs are here.
 */

/**
 * §28.4's two consent states.
 *
 * Two, not three: the column is NOT NULL DEFAULT false, so there is no
 * "unknown" a row can be in. That is the point — the reference's third state
 * was a missing answer, and it defaulted it to the permissive one.
 */
export type BackerConsentState = 'granted' | 'not_granted';

/**
 * §23.5 states that count as a Backer on this surface.
 *
 * The three no-charge exits (`reserved_canceled`, `killed_no_charge`,
 * `threshold_not_met_no_charge`) and `capture_failed_dropped` are absent
 * deliberately: counting them would put people who are not Backers into a
 * number labelled "Backers". A refund does not un-Backer somebody who was
 * charged (§24.8), so the money-back states stay in.
 *
 * Deliberately NOT annotated `readonly string[]`: the literal types are what
 * let Drizzle check each value against the `reservation_status` enum at compile
 * time, so a typo here is a build failure rather than a filter that silently
 * matches nothing. A widening annotation would turn this register into one
 * nobody checks.
 */
export const COUNTED_BACKER_STATUSES = [
  'reserved_active',
  'pending_capture',
  'capture_failed_retrying',
  'captured',
  'refunded',
  'reversed',
  'disputed',
] as const;

/** Days from `campaign_live_at`, or null for the whole lifetime. */
export const TIME_WINDOW_DAYS: Readonly<Record<string, number | null>> = {
  lifetime: null,
  first_7: 7,
  first_14: 14,
};

export function windowDays(key: string): number | null {
  return Object.prototype.hasOwnProperty.call(TIME_WINDOW_DAYS, key)
    ? (TIME_WINDOW_DAYS[key] as number | null)
    : null;
}

/**
 * The filter value for absent attribution.
 *
 * Lowercase and never a display string, so no Affiliate handle can collide with
 * it — the reference used the literal `'Organic'` in the same field that holds
 * real names, which breaks for the first Creator who picks that handle.
 */
export const UNATTRIBUTED_FILTER_VALUE = 'organic';

/** §19's two survey questions, restated for the search index. */
export const SURVEY_WHY_QUESTION = 'Why do you want this product?';
export const SURVEY_RECOMMEND_QUESTION = 'How likely are you to recommend this to someone?';
export const SURVEY_RECOMMEND_MAX = 10;

/** `8` → `8 out of 10`. The scale is part of the answer. */
export function formatRecommendAnswer(score: number): string {
  return `${score} out of ${SURVEY_RECOMMEND_MAX}`;
}

/**
 * §26.5's page size for the highest-cardinality table in the Admin.
 *
 * The reference paginates nothing because it renders fourteen rows. A real
 * campaign has thousands, and an unbounded query here would both fall over and
 * ship every Backer's email to the browser — which is the privacy failure, not
 * merely a performance one, because what the table displays and what the
 * response contains would then be different things.
 */
export const BACKER_PAGE_SIZE = 50;

/** A hard ceiling on what one request can ask for, so a caller cannot widen it. */
export const BACKER_PAGE_SIZE_MAX = 100;

export function clampPageSize(requested: number | undefined): number {
  if (!requested || !Number.isFinite(requested) || requested < 1) return BACKER_PAGE_SIZE;
  return Math.min(Math.trunc(requested), BACKER_PAGE_SIZE_MAX);
}
