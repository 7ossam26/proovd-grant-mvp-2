/**
 * The formal decision vocabulary — Spec §14.2, §14.5, §3 (Phase 12a).
 *
 * §14.5 fixes the status words a Founder may see on a roster card: "recruited,
 * invited, signed up, waiting for Founder, preparing, reviewing, accepted,
 * declined, proposal pending, fixed payment requested, active, ended." The map
 * below is the only place an internal §23.4 status becomes one of those words —
 * a second copy in a surface is how `expired_no_acceptance` ends up on a
 * Founder's screen (§3.1's exact leak).
 *
 * "Fixed payment requested" is deliberately NOT in this map: it is a display
 * status derived from `proposal_pending` plus what the open version actually
 * requests, so the roster projection decides it where the version is in hand.
 *
 * The backend restates what its emails need in `affiliates/roster-labels.ts`
 * (it cannot import this package at runtime) and the suite drift-tests the two.
 */

import type { AssociationStatus } from '../states/association.js';

/** §14.5's Founder-facing word for each internal §23.4 status. */
export const FOUNDER_ROSTER_STATUS_LABELS: Record<AssociationStatus, string> = {
  prospect: 'Recruited',
  invited: 'Invited',
  signup_started: 'Signed up',
  signed_up_waiting_for_founder: 'Signed up',
  preparing: 'Preparing',
  // Decision open and actively reading are one word to the Founder: the
  // Creator is reviewing. §14.5 names no finer distinction.
  formal_decision_open: 'Reviewing',
  reviewing: 'Reviewing',
  proposal_pending: 'Proposal pending',
  accepted: 'Accepted',
  declined: 'Declined',
  // §14.6's expiry and §29.5's removal both read as the relationship having
  // ended; the internal distinction is Admin's, never the Founder's (§3.1).
  expired_no_acceptance: 'Ended',
  readiness_blocked: 'Accepted',
  ready: 'Accepted',
  active: 'Active',
  paused: 'Paused',
  ended: 'Ended',
  removed: 'Ended',
  successfully_completed: 'Ended',
  completion_disqualified: 'Ended',
};

/** §14.5: the display status when the open version requests a fixed payment. */
export const FIXED_PAYMENT_REQUESTED_LABEL = 'Fixed payment requested';

/* ── §27.3's roster update: which of nineteen states is worth an email ─────── */

/**
 * §27.3 asks for "roster updates" and names no list, which is the whole
 * difficulty: the association machine has nineteen states and announcing every
 * transition would be the engagement stream §30 forbids, while announcing none
 * would drop a §27.3 bullet. So the answer is derived from something that
 * already exists rather than chosen.
 *
 * **A Founder is owed a message when the word on their roster card changes.**
 * `FOUNDER_ROSTER_STATUS_LABELS` above is §14.5's own list of what a Founder
 * may see, and it is deliberately lossy — `formal_decision_open` and
 * `reviewing` are both "Reviewing", `readiness_blocked` and `ready` are both
 * "Accepted". Those collapses are not an accident of the map; they are §14.5
 * declining to show a Founder the difference. An email announcing a change the
 * roster does not display would be a notification with no consequence behind
 * it, which is exactly what this phase's scope §6 forbids.
 *
 * That single rule silences the noisiest transitions for free: readiness
 * churning between `readiness_blocked` and `ready` while a Creator finishes
 * onboarding is invisible, and it is the one loop that could fire repeatedly
 * for one Creator on one campaign.
 *
 * The second filter is below: a word-change that a campaign-wide message
 * already announces is not owed a second, per-Creator copy.
 */

/**
 * Transitions whose word-change is already announced by a more specific §27.3
 * message. Listed as PAIRS, because the destination alone is not enough — a
 * Creator arriving at `active` from `ready` is the coordinated launch, and one
 * arriving from `paused` is a suspension being lifted, which nothing else
 * reports.
 *
 * `'*'` means any origin.
 */
export const ROSTER_UPDATES_COVERED_ELSEWHERE = [
  {
    from: 'preparing',
    to: 'formal_decision_open',
    coveredBy: 'founder_response_window_started',
    why: '§14.1 opens the formal window for the whole roster at listing payment, and that message names it.',
  },
  {
    from: '*',
    to: 'proposal_pending',
    coveredBy: 'founder_creator_proposal_received',
    why: '§14.2. The proposal message carries the terms; a status line saying "Proposal pending" adds nothing and arrives beside it.',
  },
  {
    from: '*',
    to: 'accepted',
    coveredBy: 'founder_creator_proposal_decision',
    why: '§14.2. The decision message is the decision.',
  },
  {
    from: '*',
    to: 'declined',
    coveredBy: 'founder_creator_proposal_decision',
    why: '§14.2. Same message, other outcome.',
  },
  {
    from: 'ready',
    to: 'active',
    coveredBy: 'founder_campaign_live',
    why: '§17 activates every ready Creator in one launch. Per-Creator copies would multiply one event by the size of the roster.',
  },
  {
    from: '*',
    to: 'ended',
    coveredBy: 'founder_campaign_ended',
    why: '§21 ends every active association at close. Same multiplication.',
  },
] as const satisfies ReadonlyArray<{
  from: AssociationStatus | '*';
  to: AssociationStatus;
  coveredBy: string;
  why: string;
}>;

export type RosterUpdateDecision =
  | { announce: true; priorLabel: string; newLabel: string }
  | { announce: false; reason: 'no_change_in_founder_facing_status' }
  | { announce: false; reason: 'covered_by'; coveredBy: string };

/**
 * Whether §27.3 owes the Founder a roster message for one transition.
 *
 * Pure over the two statuses, so "which of nineteen" is a table a test can walk
 * rather than a judgement inside a service.
 */
export function rosterUpdateFor(
  from: AssociationStatus,
  to: AssociationStatus,
): RosterUpdateDecision {
  const priorLabel = FOUNDER_ROSTER_STATUS_LABELS[from];
  const newLabel = FOUNDER_ROSTER_STATUS_LABELS[to];
  if (priorLabel === newLabel) {
    return { announce: false, reason: 'no_change_in_founder_facing_status' };
  }
  const covered = ROSTER_UPDATES_COVERED_ELSEWHERE.find(
    (rule) => rule.to === to && (rule.from === '*' || rule.from === from),
  );
  if (covered) return { announce: false, reason: 'covered_by', coveredBy: covered.coveredBy };
  return { announce: true, priorLabel, newLabel };
}

// §14.5's "explicit note that a pending proposal is interest, not acceptance"
// is Phase 11's `PENDING_PROPOSAL_NOTE` in `checkout/consent.ts` — one
// sentence, one constant, already rendered on the pre-payment surface and in
// the receipt. The roster surface imports that one; a second wording here
// would be two versions of the same promise.

/**
 * §14.2: the durable acceptance confirmation must state "that first-post
 * verification releases no fixed-payment money." A paraphrase is a softer
 * promise; one constant, rendered wherever the fact is stated.
 */
export const NO_FIXED_MONEY_AT_FIRST_POST =
  'First-post verification releases no fixed-payment money.';

/**
 * §8's decline promise, restated at the formal decision (§14.2: "declining
 * does not reduce standing", and the confirmation says so).
 */
export const DECLINE_NO_PENALTY_NOTE =
  'Your decline was recorded. Declining does not harm your standing with Proovd in any way.';

/**
 * §14.1: "A safe link-test action must not contaminate production attribution
 * or conversion metrics." The marker a link-test URL carries; Phase 14's
 * attribution ingest excludes any visit bearing it. One constant so the
 * surface that appends it and the ingest that excludes it cannot drift.
 */
export const LINK_TEST_MARKER = 'proovd_link_test';
