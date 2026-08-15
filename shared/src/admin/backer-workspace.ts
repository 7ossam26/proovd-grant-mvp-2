/**
 * The Backers Admin workspace registers — Spec §26.1, §26.5, §25.7, §19, §28.4.
 *
 * Built from the supplied Backers reference (`docs/design-refrence/
 * Proovd-Backers-Admin.html`) over the reservation domain Phase 15 shipped. The
 * reference is a layout, information-architecture and copy guide; it is not the
 * schema, and where the two disagree the Spec wins (§1.8).
 *
 * ── This section is READ-ONLY, like the Campaigns hub ───────────────────────
 * The prototype contains no mutating control at all: its only interactions are
 * switching views, filtering, searching, and drilling from an Affiliate row
 * into the Backer list. Every operation a pre-order needs already lives in a
 * router another workspace owns — §20's cancellation, §21's close batch and
 * retry, §24.8's refunds, §24.11's disputes, §26.7's suspend/kill, §4.1's
 * duplicate queue. A second door into any of those is the failure this section
 * is shaped to avoid, so this file defines no action and no eligibility rule.
 *
 * ── Three places the reference and this product genuinely disagree ──────────
 * All three are about Backer data, which makes them worth stating in full
 * rather than resolving quietly in a query.
 *
 * 1. THE REFERENCE'S SHARING CONSENT DOES NOT EXIST, because the choice it
 *    describes does not exist. Its checkout question is "Share name and email
 *    with the Founder?" with answers "Yes — share my name and email" / "No —
 *    keep my details private". In this product §19 shares the Backer's email
 *    and purchase details with the Founder IMMEDIATELY and MANDATORILY, and
 *    Appendix A.3/A.4 says so to the Backer in the consent they authorize:
 *    "cancellation cannot retract information already shared." There is no
 *    private state a Backer can be in, so rendering that question would tell an
 *    Admin the Backer had a choice they were never offered (§1.4).
 *
 *    The real optional consent is `reservations.founder_marketing_consent`
 *    (§28.4, Appendix A.3/A.4), and it governs something narrower and different:
 *    Founder marketing/research/survey CONTACT, and the Founder seeing
 *    IDENTIFIABLE SURVEY ANSWERS. That is the consent this workspace surfaces,
 *    under its own name, with `CONSENT_GOVERNS` stating the boundary.
 *
 * 2. THE REFERENCE DEFAULTS AN ABSENT CONSENT TO PERMISSIVE, and the product
 *    must not. Its `b.share || 'Yes — share my name and email'` turns a missing
 *    answer into a granted one. Here the column is NOT NULL DEFAULT false, so
 *    absence is already "not granted" at the database, and
 *    `CONSENT_ABSENT_IS_NOT_GRANTED` states why nothing may soften it.
 *
 * 3. THERE IS NO BACKER NAME, anywhere in the product. §5.4/§28.1 give a Backer
 *    no account; §19's pre-order collects email, phone, and billing address and
 *    never a name; §28.3 keeps the cardholder name at the provider. The
 *    reference's "name over email" person cell therefore renders the email as
 *    the identity, with §18's per-campaign `Backer ###` beside it where the
 *    Backer has one. Inventing a name — from the email's local part, or from
 *    billing — would be manufacturing an identity the Backer never gave, and
 *    §18 already refuses the email local part as a display handle by name.
 *
 * ── The survey is two fixed questions, not three per-campaign ones ──────────
 * §19 step 2 is a FIXED demand survey and `shared/src/reservation/survey.ts`
 * owns its two questions. The reference's "How clear was the campaign?" does
 * not exist. The register below derives its question text from that module
 * rather than restating it, so the column renders whatever §19 actually asked
 * and a later change to the survey cannot leave this surface quoting a question
 * nobody was asked.
 */

import {
  SURVEY_RECOMMEND_MAX,
  SURVEY_RECOMMEND_MIN,
  SURVEY_RECOMMEND_QUESTION,
  SURVEY_WHY_QUESTION,
} from '../reservation/survey.js';

/* ── The posture (§1.4, §26.1) ─────────────────────────────────────────────*/

/**
 * Pinned, and it rides the page header rather than sitting in a footer.
 *
 * An Admin who believes a pre-order can be changed from here will look for the
 * control, not find it, and conclude the page is broken. Saying what the page
 * IS costs one sentence and answers that before it is asked (§27.1).
 */
export const BACKERS_IS_READ_ONLY =
  'This page reads the record. Cancelling, refunding, and charging a pre-order stay in the admin page that owns each one.';

/**
 * The reference's own line, kept verbatim: "One row per Backer. No extra record
 * page." It is a promise about the information architecture — everything a
 * Backer row holds is on the row — and it is why no route below addresses a
 * single Backer.
 */
export const BACKERS_NO_RECORD_PAGE = 'One row per Backer. No extra record page.';

/* ── Consent (§28.4, §25.7, §19) ───────────────────────────────────────────*/

/**
 * What the optional consent actually governs, stated where an Admin decides
 * whether they may pass an answer on to a Founder.
 *
 * Both halves matter and they are commonly confused. The Founder ALREADY has
 * the Backer's email — §19 shares it at reservation, mandatorily, and the
 * Backer was told so. What the consent adds is contact for purposes not
 * required to fulfill, and the Founder seeing the survey answer WITH the
 * identity attached. An Admin who reads this as "may I tell the Founder who
 * this is" will withhold something the Founder is already entitled to; one who
 * reads it as "may I forward this answer" gets the right answer.
 */
export const CONSENT_GOVERNS =
  'Founder marketing, research, and survey contact, and the Founder seeing this Backer’s survey answers with their identity attached. The Founder already has the email — §19 shares it at pre-order and cannot retract it.';

/**
 * §28.4 + §1.4, and the single most important sentence in this workspace.
 *
 * The reference defaults a missing answer to the permissive one. Here the
 * column is NOT NULL DEFAULT false, so there is no missing state to default —
 * but the sentence stays, because the next reader to add an optional consent
 * will reach for a nullable column and this is where they will be told not to.
 */
export const CONSENT_ABSENT_IS_NOT_GRANTED =
  'No answer is not consent. An unchecked optional consent is recorded as not granted and is never read as granted.';

/** The three states an Admin can be looking at, and what each permits. */
export type BackerConsentState = 'granted' | 'not_granted';

export interface BackerConsentDisclosure {
  readonly state: BackerConsentState;
  /** The words on the badge. Never "yes"/"no" — a badge is read out of context. */
  readonly label: string;
  /** What an Admin may do with the answers beside it. */
  readonly permits: string;
}

export const BACKER_CONSENT_DISCLOSURES: Readonly<
  Record<BackerConsentState, BackerConsentDisclosure>
> = {
  granted: {
    state: 'granted',
    label: 'Founder contact allowed',
    permits:
      'The Founder may contact this Backer beyond fulfillment and may see these answers with the Backer’s identity attached.',
  },
  not_granted: {
    state: 'not_granted',
    label: 'Founder contact not allowed',
    permits:
      'Do not forward these answers to the Founder with the identity attached, and do not add this Backer to Founder marketing. Fulfillment and purchase support are unaffected.',
  },
};

export function backerConsentDisclosure(granted: boolean): BackerConsentDisclosure {
  return BACKER_CONSENT_DISCLOSURES[granted ? 'granted' : 'not_granted'];
}

/**
 * §25.7's line, applied to this surface.
 *
 * The §26.5 ledger register already classes `surveyWhy` and `surveyRecommend`
 * `restricted`: visible to Admin on screen for support and risk work, never
 * written into an export. This workspace inherits that exactly — it renders
 * them and ships no export route, which is the strongest form of the rule.
 */
export const BACKER_ANSWERS_ARE_NOT_EXPORTABLE =
  'Survey answers and Backer contact details are visible here for support and risk work. §25.7 keeps them out of every export, and this page has no export.';

/* ── The survey (§19 step 2) ───────────────────────────────────────────────*/

export interface BackerSurveyQuestion {
  readonly key: 'why' | 'recommend';
  readonly question: string;
  /** What an unanswered one says. Never a fabricated default (§1.4). */
  readonly unanswered: string;
}

/**
 * §19's two questions, derived from the module that owns them.
 *
 * `unanswered` exists because a reservation can legitimately carry no survey:
 * the columns are nullable and a row can reach this surface from a path that
 * never completed step 2. The reference would have rendered a default; §1.4
 * requires the absence to be visible as an absence.
 */
export const BACKER_SURVEY_QUESTIONS: readonly BackerSurveyQuestion[] = [
  { key: 'why', question: SURVEY_WHY_QUESTION, unanswered: 'Not answered' },
  {
    key: 'recommend',
    question: SURVEY_RECOMMEND_QUESTION,
    unanswered: 'Not answered',
  },
] as const;

/** `8` → `8 out of 10`. The scale is part of the answer; a bare `8` is not. */
export function formatRecommendAnswer(score: number): string {
  return `${score} out of ${SURVEY_RECOMMEND_MAX}`;
}

export { SURVEY_RECOMMEND_MIN, SURVEY_RECOMMEND_MAX };

/* ── Attribution (§18) ─────────────────────────────────────────────────────*/

/**
 * The reference's `Organic` is a sentinel for ABSENT attribution, not an
 * Affiliate named Organic — its own data uses the string `'Organic'` in the
 * same field that holds real Affiliate names, which is a collision waiting for
 * the first Creator who picks that handle.
 *
 * Here attribution is a nullable association id, so absence is absence. The
 * label is a constant so the surface and the filter agree, and the filter value
 * is `organic` (lowercase, never a display string) so no handle can collide
 * with it whatever an Affiliate calls themselves.
 */
export const UNATTRIBUTED_LABEL = 'Organic';
export const UNATTRIBUTED_FILTER_VALUE = 'organic';

/**
 * §18 gives a click four outcomes and a reservation four attribution statuses;
 * what this surface needs is only whether a Creator is credited, so the label
 * carries the status rather than the surface re-deriving it.
 */
export const ATTRIBUTION_STATUS_LABELS: Readonly<Record<string, string>> = {
  verified: 'Verified',
  provisional: 'Provisional',
  blocked: 'Blocked',
  none: 'None',
};

export function attributionStatusLabel(status: string | null): string {
  if (!status) return ATTRIBUTION_STATUS_LABELS['none'] as string;
  return ATTRIBUTION_STATUS_LABELS[status] ?? status;
}

/* ── The time window (§5.3 of the brief, §18, §21) ─────────────────────────*/

/**
 * The reference's Time filter is fabricated and must not be copied: it
 * prorates the stored totals arithmetically (`backers × min(1, 7 / days)`)
 * rather than querying a window, which invents numbers no record supports.
 *
 * Here each window is a real bound on `reservations.reserved_at`.
 *
 * ── The anchor is the CAMPAIGN's launch, not the relationship's ────────────
 * Both were available and the choice changes what the number means. A window
 * anchored on each Affiliate's own `activated_at` would compare every Creator's
 * first seven days against every other's, which is the fairer question about a
 * CREATOR — but it makes the column incomparable across a row set, because two
 * rows would then cover two different weeks of the same campaign, and their
 * Backers would not sum to anything. §17's coordinated launch activates the
 * whole initial roster at `campaign_live_at`, so for that roster the two
 * anchors are the same instant anyway; they diverge only for a §20 mid-campaign
 * addition, whose own `activated_at` is deliberately later.
 *
 * So the anchor is `campaigns.campaign_live_at` and the label says so, which is
 * what keeps it unambiguous. A campaign that never went live has no anchor and
 * therefore no window — the read reports that rather than falling back to
 * `created_at`, which §33.12.1 forbids reading as a campaign anchor at all.
 */
export interface BackerTimeWindow {
  readonly key: string;
  readonly label: string;
  /** Days from the anchor, or null for the whole lifetime. */
  readonly days: number | null;
  /** Rendered where the filter is, so the anchor is never guessed. */
  readonly anchorNote: string;
}

export const BACKER_TIME_WINDOWS: readonly BackerTimeWindow[] = [
  {
    key: 'lifetime',
    label: 'Campaign lifetime',
    days: null,
    anchorNote: 'Every pre-order, whenever it arrived.',
  },
  {
    key: 'first_7',
    label: 'First 7 days',
    days: 7,
    anchorNote: 'Pre-orders in the 7 days after the campaign went live.',
  },
  {
    key: 'first_14',
    label: 'First 14 days',
    days: 14,
    anchorNote: 'Pre-orders in the 14 days after the campaign went live.',
  },
] as const;

export type BackerTimeWindowKey = (typeof BACKER_TIME_WINDOWS)[number]['key'];

export function backerTimeWindow(key: string): BackerTimeWindow {
  const found = BACKER_TIME_WINDOWS.find((w) => w.key === key);
  return found ?? (BACKER_TIME_WINDOWS[0] as BackerTimeWindow);
}

/** Said where a campaign has no launch instant to measure from (§1.4). */
export const NO_LAUNCH_ANCHOR_NOTE =
  'This campaign has not gone live, so there is no launch date to measure a window from. Showing every pre-order.';

/* ── What counts (§23.5, §26.5) ────────────────────────────────────────────*/

/**
 * Which reservation states are a Backer this surface counts, and why the list
 * is not "everything".
 *
 * §23.5's eleven states include three that mean the pre-order never became one:
 * `reserved_canceled` (the Backer withdrew), `killed_no_charge` (§26.7 closed
 * it), and `threshold_not_met_no_charge` (§21's Idea miss). Counting those as
 * Backers would inflate every Affiliate's total with people who are not
 * Backers, and `capture_failed_dropped` with people who never paid.
 *
 * So the counted set is "reserved and still standing, or ever captured" —
 * `reserved_active` plus the capture path, including the money-back states,
 * because a refund does not un-Backer somebody who was charged (§24.8). The
 * label on the totals says "Backers", and this is what it means.
 */
export const COUNTED_BACKER_STATUSES: readonly string[] = [
  'reserved_active',
  'pending_capture',
  'capture_failed_retrying',
  'captured',
  'refunded',
  'reversed',
  'disputed',
] as const;

/**
 * The preorderValue total is the pre-tax reward subtotal, never the authorized total.
 *
 * §24.3 excludes sales tax from every percentage, from the Idea threshold, and
 * from the cap; a "preorderValue" figure that included tax would not reconcile with
 * any other money number in the product, and would vary by the Backer's state
 * rather than by what they bought.
 */
export const PREORDER_VALUE_IS_PRE_TAX =
  'Pre-order value is the pre-tax reward subtotal (§24.3). Sales tax is excluded, as it is from every other percentage in the product.';

/* ── The header totals (§5.1 of the brief) ─────────────────────────────────*/

/**
 * The reference's three totals sum the AFFILIATE rows only — they exclude
 * unattributed Backers, even though those Backers appear in the Backer view.
 * That is a real and defensible definition (the strip sits above a view whose
 * whole subject is "what every Affiliate brought in"), and the labels carry it:
 * "Affiliate Backers", not "Backers".
 *
 * Keeping the definition means keeping the labels exact, so they are constants
 * here rather than strings in a component, and the read returns the organic
 * count separately so the surface can say what the totals leave out instead of
 * leaving an Admin to notice the two views disagree.
 */
export const BACKER_TOTAL_LABELS = {
  attributedBackers: 'Affiliate Backers',
  attributedValue: 'Affiliate pre-order value',
  affiliates: 'Affiliates',
} as const;

export const TOTALS_EXCLUDE_ORGANIC =
  'These three count Creator-attributed pre-orders only. Organic pre-orders appear in Every Backer and are not in these totals.';

/* ── Empty states (§1.1, §27.1) ────────────────────────────────────────────*/

/** The reference's own two, kept verbatim. */
export const NO_AFFILIATE_RESULTS = 'No Affiliate results match.';
export const NO_BACKERS_MATCH = 'No Backers match.';

/**
 * The third state, which the reference has no copy for because its fixture data
 * cannot produce it: a campaign with real Backers and no Creator attribution at
 * all. The Affiliate view is then legitimately empty while the Backer view is
 * full, and an Admin reading "No Affiliate results match." would go looking for
 * a broken filter.
 */
export const NO_ATTRIBUTION_YET =
  'No pre-order on this campaign came through a Creator link yet. Every Backer arrived organically — see Every Backer.';
