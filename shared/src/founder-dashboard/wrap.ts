/**
 * Chapter 4, Wrap, and the Backers page — Founder Dashboard Session F.
 *
 * `docs/phases/founder-dashboard.md` F1–F5. Everything after the money is out:
 * §22.8's completion findings, §22.9's work-again ask, §22.10's two gates,
 * §31.8's progression, §22.11's resolution — plus the two things §19 and §20
 * require and no Founder route has ever served: the operational share, and the
 * export.
 *
 * ── This chapter closes three compliance gaps, and none of them is new rule ──
 * The brief's own finding, and it is what most changes this session's
 * character. §19 makes the operational share MANDATORY and disclosed before
 * consent; `founder_operational_shares` has been written by five services and
 * read by no Founder route since Phase 15a. §20's Explore section 10 requires a
 * Founder export and the payload has shipped `available: []` since Phase 17a,
 * honestly declaring its own absence. §22.10's panel has existed as
 * `NextCampaign.tsx` since Phase 21b and is routed nowhere.
 *
 * ── The export is a register, and there is no override parameter ────────────
 * §25.7 draws two lines for a Founder — aggregates, immediate Backer email and
 * purchase details for fulfillment/support only, and identifiable
 * survey/marketing fields only under §19 step 7's specific consent. The first
 * two are what the columns below carry. The third is REFUSED for a file, and
 * the reason is recorded on the Admin ledger register already: *"identifiable
 * survey responses need the specific optional consent, and an export cannot
 * carry that condition with it."* A CSV opened in a spreadsheet six months from
 * now carries no consent state; the surface that CAN carry it is §20's Explore
 * `survey_answers` section, which is consent-gated at the query and renders the
 * answers beside the count that produced them.
 *
 * So the Founder export never carries a survey answer, names it among the
 * withheld columns with that exact reason, and points at where the answers DO
 * appear. `exportBackerRows` reads this register and nothing else — 16a's rule:
 * a limit the requester can widen is not a limit.
 *
 * ── The data request grants nothing, and that is a mechanism ────────────────
 * `exportBackerRows` takes no purpose, no request id, and no approval flag, so
 * there is no argument an approved request could arrive as. What an Admin does
 * with an approved request is §26.7's support case — a person, with the record
 * in front of them — which is §1.3's manual-but-recorded path rather than a
 * column that widens a file.
 */

/* ── The export (F3, §20 Explore 10, §25.7) ──────────────────────────────── */

export interface FounderExportColumn {
  /** The key on the composed row. Never a database column name. */
  readonly key: string;
  /** The CSV header a person reads. */
  readonly header: string;
  /** What this column IS — §20's own rule, applied to a file. */
  readonly definition: string;
}

/**
 * Every column a Founder export may carry, and nothing else.
 *
 * `Pre-order`, never `Pledge`. §3.2 replaces the word, and this is the worst
 * placement it could have: an export file outlives the session and is opened
 * somewhere Proovd cannot correct it. The reference's header row reads
 * `['Name','Pledge','Source','Checkout comment']` and two of those four are
 * refused — see `FOUNDER_EXPORT_WITHHELD`.
 */
export const FOUNDER_EXPORT_COLUMNS = [
  {
    key: 'preorderReference',
    header: 'Pre-order',
    definition: 'The pre-order this row is about. Quote it when you contact support.',
  },
  {
    key: 'backerEmail',
    header: 'Backer email',
    definition:
      '§19 shares this with you for fulfillment and support. It is not a marketing list (§25.7).',
  },
  {
    key: 'rewardSku',
    header: 'Reward SKU',
    definition: 'The reward they chose, as it appears on your build.',
  },
  {
    key: 'rewardTitle',
    header: 'Reward',
    definition: 'The reward title the Backer saw at checkout.',
  },
  {
    key: 'fulfillmentState',
    header: 'Fulfillment',
    definition: 'Whether you owe this person a reward right now, or must not send one.',
  },
  {
    key: 'progressionStep',
    header: 'Where they are',
    definition: '§31.8: the step this pre-order has actually reached. Never a predicted one.',
  },
  {
    key: 'sharedAt',
    header: 'Shared with you',
    definition: 'When §19 shared this pre-order with you. Stored in UTC.',
  },
] as const satisfies readonly FounderExportColumn[];

export type FounderExportColumnKey = (typeof FOUNDER_EXPORT_COLUMNS)[number]['key'];

export interface FounderExportWithheld {
  readonly header: string;
  readonly reason: string;
}

/**
 * Named before the button is pressed, which is what §20's Explore section 10
 * already does and what 16a's ledger export established. A withheld column
 * discovered by its absence in a downloaded file is a limit nobody was told
 * about.
 */
export const FOUNDER_EXPORT_WITHHELD = [
  {
    header: 'Checkout comment / survey answers',
    reason:
      '§25.7: identifiable survey answers need the specific optional consent from §19 step 7, and an export cannot carry that condition with it. They appear on Explore, where each answer sits beside the consent that permits it.',
  },
  {
    header: 'Backer name',
    reason:
      '§19 shares the email and the purchase details fulfillment needs. No name is collected at checkout, so there is none to share.',
  },
  {
    header: 'Billing address, phone, card details',
    reason:
      '§25.7 restricts these to Admin. Proovd never holds a card number at all (§32.4), and a delivery address is the Founder’s own to ask for.',
  },
  {
    header: 'Attribution source',
    reason:
      '§18 records which tracking link a pre-order came through. It belongs to the Creator’s compensation record, and per-Backer attribution is not a fulfillment fact.',
  },
] as const satisfies readonly FounderExportWithheld[];

/** Pinned: the whole reason a survey answer is not a column. */
export const EXPORT_CANNOT_CARRY_A_CONSENT_CONDITION =
  'A downloaded file carries no consent state with it. Answers people agreed to share stay on Explore, where the consent that permits each one is shown beside it.';

/** Pinned beside the download control. §19's own sentence, restated. */
export const EXPORT_IS_FOR_FULFILLMENT =
  'These details were shared with you so you can deliver and support what people pre-ordered. §19 says this is not marketing consent.';

/* ── The §19 operational share (F2) ──────────────────────────────────────── */

/**
 * `do_not_fulfill_at` is stamped when a pre-order stops being a pre-order — a
 * Backer cancellation, a §26.7 kill, a threshold miss, a dropped capture. The
 * share row SURVIVES so the Founder can see it happened; what changes is what
 * they owe.
 *
 * Pinned because the failure mode is silent: a row presented as deliverable
 * when the money never moved is a Founder shipping a product to somebody who
 * was never charged, and neither party finds out until it arrives.
 */
export const DO_NOT_FULFILL_LABEL = 'canceled / no charge — do not fulfill';

export const DO_NOT_FULFILL_NOTE =
  'Nothing was charged for this pre-order, so nothing is owed. It stays on this list because it was shared with you and then withdrawn.';

/* ── The Backer data request (F4, §25.7, §19 step 7) ─────────────────────── */

export interface BackerDataPurpose {
  readonly key: string;
  readonly label: string;
  /** What §25.7 says about this purpose. */
  readonly basis: string;
}

/**
 * §25.7's Founder line names exactly one permitted use of identifiable Backer
 * detail: *"Immediate Backer email/purchase details only for
 * fulfillment/support."* Both halves of that sentence are here and nothing
 * else is.
 */
export const BACKER_DATA_PURPOSES = [
  {
    key: 'fulfillment',
    label: 'Delivering what somebody pre-ordered',
    basis: '§25.7 permits Backer email and purchase details for fulfillment.',
  },
  {
    key: 'support',
    label: 'Answering a support question about a pre-order',
    basis: '§25.7 permits Backer email and purchase details for support.',
  },
] as const satisfies readonly BackerDataPurpose[];

export type BackerDataPurposeKey = (typeof BACKER_DATA_PURPOSES)[number]['key'];

export function isBackerDataPurpose(value: unknown): value is BackerDataPurposeKey {
  return (
    typeof value === 'string' &&
    BACKER_DATA_PURPOSES.some((purpose) => purpose.key === value)
  );
}

export interface RefusedBackerDataPurpose {
  readonly key: string;
  readonly label: string;
  readonly refusedBecause: string;
}

/**
 * The reference offers three purposes and two of them are refused. It is worth
 * being exact about why, because "marketing" reads as the obvious one and
 * "add to community" reads as harmless — and the second is the one that would
 * actually happen, because a Founder with a Discord and a list of emails will
 * simply add them.
 *
 * Rendered on the screen where the control is, so a later session that wants
 * one back has to delete the sentence refusing it.
 */
export const REFUSED_BACKER_DATA_PURPOSES = [
  {
    key: 'marketing',
    label: 'Marketing follow-up',
    refusedBecause:
      '§25.7 permits identifiable marketing fields only under the specific optional consent §19 step 7 collects, and §19 states the mandatory share "is not marketing consent". Where a Backer gave that consent, their answers are already on Explore. There is nothing here to request.',
  },
  {
    key: 'community',
    label: 'Adding backers to your community',
    refusedBecause:
      '§25.7 does not permit it, and §31.8 requires that nothing coerces a newsletter consent — which is enforced by there being nowhere to record one. Your community link is on your campaign page and on every Backer’s own pre-order page; people join it because they chose to.',
  },
] as const satisfies readonly RefusedBackerDataPurpose[];

/**
 * Pinned on the request form. §25.7 already gives a Founder the email and
 * purchase details for these two purposes — the mandatory §19 share is on the
 * page behind this control — so the ask is for detail BEYOND that, and it is
 * answered by a person rather than by a flag that widens a file.
 */
export const BACKER_DATA_REQUEST_GRANTS_NO_ACCESS =
  'This records what you need and why. It does not unlock anything by itself and it does not change what you can download — a person at Proovd reads it and answers you.';

export const BACKER_DATA_REQUEST_DECISIONS = ['approved', 'declined'] as const;
export type BackerDataRequestDecision = (typeof BACKER_DATA_REQUEST_DECISIONS)[number];

export const BACKER_DATA_REQUEST_STATUSES = ['open', ...BACKER_DATA_REQUEST_DECISIONS] as const;
export type BackerDataRequestStatus = (typeof BACKER_DATA_REQUEST_STATUSES)[number];

/* ── §22.11's resolution, as a Founder reads it ──────────────────────────── */

/**
 * §22.11's five areas are named against §21's nine reconciliation item keys —
 * `batch_completeness`, `provisional_vs_earned`, `founder_share_w9`. Those are
 * Admin vocabulary and §3.1's risk is precisely an internal name reaching a
 * customer, so a Founder reads whether the campaign is resolved and when, and
 * never the item key that is outstanding.
 *
 * That is not a summary standing in for detail: which item an Admin still has
 * to verify is not a thing a Founder can act on, and §27.1's "who owns the next
 * step" is answered by naming Proovd.
 */
export const RESOLUTION_IS_PROOVDS_WORK =
  'Proovd checks every part of the money against its own records before a campaign is closed out. Nothing here is waiting on you.';

/* ── What the reference draws that the Spec forbids (F5) ─────────────────── */

export interface WrapAbsence {
  readonly id: string;
  readonly control: string;
  /** Rendered where the control would have been. */
  readonly absentBecause: string;
}

/**
 * `OPERATIONS_ABSENCES` applied to Chapter 4 and the Backers page. Every entry
 * is a control the supplied reference actually draws.
 */
export const WRAP_ABSENCES = [
  {
    id: 'creator_podium',
    control: 'A top-three podium with rank badges, sorted by backers',
    absentBecause:
      '§30 defers public leaderboards, and the reference ranks Creators four ways at once — a numbered badge, a first-place tile, a "who you’d work with again" heading, and a sort by backer count. The order IS the claim, so this list is ordered by handle and says so, with each number’s definition beside it. Session D made the same call on the live Creator list.',
  },
  {
    id: 'work_again_top_three',
    control: 'Offering the work-again request to the three Creators who sold the most',
    absentBecause:
      '§22.9 makes the ask available for a Creator whose completion status is `successfully_completed`, which is §22.8’s five recorded criteria and contains no sales term at all (§33.10.6). Offering it to a ranked three would make a §22.8 decision out of a revenue figure.',
  },
  {
    id: 'marketing_purpose',
    control: 'Requesting Backer details for marketing follow-up or to add people to a community',
    absentBecause:
      '§25.7 permits identifiable Backer detail for fulfillment and support only, and §19 states the mandatory share is not marketing consent. Both purposes are named on the form with their own reason rather than quietly dropped.',
  },
  {
    id: 'export_names_and_comments',
    control: 'An export carrying Backer names and their checkout comments',
    absentBecause:
      '§3.2 fixes what a money column is called and this file uses that word, not the crowdfunding one. No name is collected at checkout, so there is none to export; a checkout comment is an identifiable survey answer whose consent condition cannot travel with a file (§25.7).',
  },
  {
    id: 'threshold_in_dollars',
    control: 'The threshold stated as a dollar amount raised against a dollar target',
    absentBecause:
      '§4.1 makes an Idea threshold a number of Backers, not a dollar amount, and §3.2 fixes what it may be called in every audience including identifiers — which is why nothing on this chapter, down to a property name, uses the word the reference does.',
  },
  {
    id: 'delete_account_destructive',
    control: 'A "Delete account" control that describes itself as destructive and immediate',
    absentBecause:
      '§25.8’s retention obligations outlive the account, so a deletion request records an ask and deletes nothing. It is §5.2’s panel and belongs to Session G, on the same `founder_deletion_requests` record Admin already writes.',
  },
  {
    id: 'auto_wrap_advance',
    control: 'A wrap-up sequence that plays through the campaign story on its own',
    absentBecause:
      'A recap the Founder starts is fine; one that advances by itself is a screen that moves on without you. No timer callback navigates anywhere in this chapter, which is the rule the Founder Flow reconciliation set and every session since has held.',
  },
] as const satisfies readonly WrapAbsence[];

export type WrapAbsenceId = (typeof WRAP_ABSENCES)[number]['id'];

export function wrapAbsence(id: WrapAbsenceId): WrapAbsence {
  const found = WRAP_ABSENCES.find((absence) => absence.id === id);
  if (!found) throw new Error(`no wrap absence '${id}'`);
  return found;
}

/* ── The Backers page's own address ──────────────────────────────────────── */

/**
 * A page rather than a chapter, which is the reference's own architecture: a
 * chapter's home is a hub, and the list of people behind the numbers is its own
 * page reached by a link and left by a back control. It is linked from Chapter
 * 2 (a live campaign has Backers to support) and from Chapter 4 (a finished one
 * has rewards to deliver), so it belongs to neither.
 */
export function founderBackersPath(campaignId: string): string {
  return `/campaigns/${encodeURIComponent(campaignId)}/backers`;
}
