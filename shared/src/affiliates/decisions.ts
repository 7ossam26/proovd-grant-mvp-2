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
