/**
 * §14.5's Founder-facing status vocabulary, restated — Spec §14.5, §3.
 *
 * `shared/src/affiliates/decisions.ts` is the register; the backend cannot
 * import it at runtime (rootDir), so what the roster projection and the
 * decision emails render is restated here and drift-tested by the suite —
 * the same arrangement as `notifications/events.ts` and the state enums.
 *
 * §3.1 is why this map exists at all: `expired_no_acceptance` or
 * `signed_up_waiting_for_founder` on a Founder's screen is an internal name
 * leaking, which §3.1 treats as a real risk rather than a style preference.
 */

export const FOUNDER_ROSTER_STATUS_LABELS: Record<string, string> = {
  prospect: 'Recruited',
  invited: 'Invited',
  signup_started: 'Signed up',
  signed_up_waiting_for_founder: 'Signed up',
  preparing: 'Preparing',
  formal_decision_open: 'Reviewing',
  reviewing: 'Reviewing',
  proposal_pending: 'Proposal pending',
  accepted: 'Accepted',
  declined: 'Declined',
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

/* ── §27.3's roster update, restated (Phase 22b) ──────────────────────────── */

/**
 * Which transitions a Founder is owed a message about. Restated from
 * `shared/src/affiliates/decisions.ts` and drift-tested; see that file for why
 * the rule is "the word on the roster card changed" rather than a chosen list.
 */
export const ROSTER_UPDATES_COVERED_ELSEWHERE: ReadonlyArray<{
  from: string;
  to: string;
  coveredBy: string;
}> = [
  { from: 'preparing', to: 'formal_decision_open', coveredBy: 'founder_response_window_started' },
  { from: '*', to: 'proposal_pending', coveredBy: 'founder_creator_proposal_received' },
  { from: '*', to: 'accepted', coveredBy: 'founder_creator_proposal_decision' },
  { from: '*', to: 'declined', coveredBy: 'founder_creator_proposal_decision' },
  { from: 'ready', to: 'active', coveredBy: 'founder_campaign_live' },
  { from: '*', to: 'ended', coveredBy: 'founder_campaign_ended' },
];

export type RosterUpdateDecision =
  | { announce: true; priorLabel: string; newLabel: string }
  | { announce: false; reason: 'no_change_in_founder_facing_status' }
  | { announce: false; reason: 'covered_by'; coveredBy: string };

export function rosterUpdateFor(from: string, to: string): RosterUpdateDecision {
  const priorLabel = FOUNDER_ROSTER_STATUS_LABELS[from];
  const newLabel = FOUNDER_ROSTER_STATUS_LABELS[to];
  if (priorLabel === undefined || newLabel === undefined) {
    // An unknown status is not silently announced: a label we cannot render is
    // an internal name one step from a Founder's screen (§3.1).
    return { announce: false, reason: 'no_change_in_founder_facing_status' };
  }
  if (priorLabel === newLabel) {
    return { announce: false, reason: 'no_change_in_founder_facing_status' };
  }
  const covered = ROSTER_UPDATES_COVERED_ELSEWHERE.find(
    (rule) => rule.to === to && (rule.from === '*' || rule.from === from),
  );
  if (covered) return { announce: false, reason: 'covered_by', coveredBy: covered.coveredBy };
  return { announce: true, priorLabel, newLabel };
}

/**
 * §14.5: "a pending proposal is interest, not acceptance." Restates Phase 11's
 * shared `PENDING_PROPOSAL_NOTE` (`shared/src/checkout/consent.ts`), which the
 * pre-payment surface and the receipt already render; drift-tested.
 */
export const PENDING_PROPOSAL_NOTE =
  'A pending proposal is not acceptance and does not pause or extend the 72-hour deadline.';

/** §14.2: stated in every durable acceptance confirmation. */
export const NO_FIXED_MONEY_AT_FIRST_POST =
  'First-post verification releases no fixed-payment money.';

/** §14.2: the decline confirmation's promise. */
export const DECLINE_NO_PENALTY_NOTE =
  'Your decline was recorded. Declining does not harm your standing with Proovd in any way.';

/**
 * §14.1: the link-test marker. A visit carrying this query parameter is a
 * test and must never contaminate production attribution or conversion
 * metrics — Phase 14's attribution ingest excludes it by this exact name.
 */
export const LINK_TEST_MARKER = 'proovd_link_test';
