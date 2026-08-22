/**
 * The eleven campaign stages — the reference's own workflow menu.
 *
 * ── Why this is a register ──────────────────────────────────────────────────
 * Three things have to agree about a stage: the workflow menu (which is
 * current, which are reachable, which are inactive), the workspace (which
 * screen renders), and the record bar (what it says the Founder is doing).
 * Three hand-written lists is two chances to disagree, and the disagreement
 * shows up as a menu entry that opens nothing.
 *
 * ── Reachability is derived from the record, never from a query parameter ───
 * The reference drives its own state from mock flags. Here the stage a
 * campaign is IN comes from `campaigns.status` by way of the workspace
 * payload's composed labels, and a stage the record has not reached is
 * `locked` — the reference's own word for it. A value a caller can set is a
 * value a caller can lie about, which on this panel would hand somebody the
 * Listing-fee screen of a campaign that never paid one.
 */

export const FOUNDER_STAGE_IDS = [
  'invite',
  'onboarding',
  'application-review',
  'listing-fee',
  'matching',
  'campaign-setup',
  'ready-to-launch',
  'live',
  'campaign-ended',
  'delivery',
  'complete',
] as const;

export type FounderStageId = (typeof FOUNDER_STAGE_IDS)[number];

export interface FounderStage {
  readonly id: FounderStageId;
  /** The workflow menu's own word for it. */
  readonly label: string;
  /**
   * The campaign lifecycle states that put a record AT this stage. Read from
   * `campaigns.status`, which §23.1 makes lifecycle-only — no payment flag
   * ever appears in it, so this mapping cannot drift into money.
   */
  readonly statuses: readonly string[];
}

export const FOUNDER_STAGES: readonly FounderStage[] = [
  { id: 'invite', label: 'Invite', statuses: ['invited_draft'] },
  {
    id: 'onboarding',
    label: 'Onboarding',
    statuses: ['vetting_submitted', 'account_claimed', 'stripe_onboarding_pending'],
  },
  { id: 'application-review', label: 'Application review', statuses: [] },
  { id: 'listing-fee', label: 'Listing fee', statuses: ['listing_fee_pending'] },
  { id: 'matching', label: 'Matching', statuses: ['affiliate_response_and_build'] },
  {
    id: 'campaign-setup',
    label: 'Campaign setup',
    statuses: ['pending_review', 'changes_required'],
  },
  {
    id: 'ready-to-launch',
    label: 'Ready to launch',
    statuses: ['approved', 'creator_prep', 'creator_replacement'],
  },
  { id: 'live', label: 'Live', statuses: ['live'] },
  {
    id: 'campaign-ended',
    label: 'Campaign ended',
    statuses: [
      'closed_pending_capture',
      'capture_retry_window',
      'closed_reconciling',
      'ended_no_charge',
    ],
  },
  {
    id: 'delivery',
    label: 'Delivery and payments',
    statuses: [
      'captured_pending_w9',
      'single_payment_released',
      'first_payment_released',
      'day_14_review',
      'remaining_payment_released',
    ],
  },
  { id: 'complete', label: 'Complete', statuses: ['fulfilled', 'closed_resolved'] },
];

export function stageById(id: string): FounderStage | undefined {
  return FOUNDER_STAGES.find((s) => s.id === id);
}

/**
 * Which stage a campaign is currently at.
 *
 * Falls back to `invite` rather than guessing: a record with no campaign, or
 * one in a state this register does not name (`suspended`, `killed`,
 * `banned_founder`, `refunded_no_creator`), is not mid-workflow, and putting it
 * at a later stage would be the panel inventing a position (§1.4).
 */
export function currentStage(rawStatus: string | null | undefined): FounderStageId {
  if (!rawStatus) return 'invite';
  const found = FOUNDER_STAGES.find((s) => s.statuses.includes(rawStatus));
  return found?.id ?? 'invite';
}

/** Everything up to and including the current stage is reachable. */
export function stageIsAvailable(id: FounderStageId, current: FounderStageId): boolean {
  return FOUNDER_STAGE_IDS.indexOf(id) <= FOUNDER_STAGE_IDS.indexOf(current);
}
