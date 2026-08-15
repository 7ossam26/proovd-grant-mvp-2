/**
 * The Campaigns workspace vocabulary, restated for the backend.
 *
 * `shared/src/admin/campaign-workspace.ts` is the source of truth. The backend
 * cannot import it — it compiles under `rootDir: src` and ships only
 * `backend/dist`, so a cross-package import does not resolve at runtime. The
 * answer this repo has used since Phase 01 for the state enums, and since 06a
 * for the §6 settings, is to restate the data here and fail the suite if the
 * two ever disagree: `tests/campaign-workspace-registers.test.ts` compares
 * every register below against `@proovd/shared`.
 *
 * ── What is deliberately NOT restated ───────────────────────────────────────
 * §23.1's 27 lifecycle labels and §3.1's two type labels. `founders/logic.ts`
 * already carries them and this module imports from there — a second copy of
 * §3.1's substitutions is a second place for `pre_build` to escape.
 */

/* ── The state pill (§23.1) ────────────────────────────────────────────────*/

export const CAMPAIGN_STATE_KINDS = ['risk', 'waiting', 'live', 'closed'] as const;
export type CampaignStateKind = (typeof CAMPAIGN_STATE_KINDS)[number];

export const CLOSED_CAMPAIGN_STATUSES: readonly string[] = [
  'closed_pending_capture',
  'capture_retry_window',
  'closed_reconciling',
  'captured_pending_w9',
  'single_payment_released',
  'first_payment_released',
  'day_14_review',
  'remaining_payment_released',
  'fulfilled',
  'closed_resolved',
  'ended_no_charge',
  'refunded_no_creator',
  'killed',
  'banned_founder',
];

export const AT_RISK_CAMPAIGN_STATUSES: readonly string[] = [
  'suspended',
  'changes_required',
  'creator_replacement',
  'capture_retry_window',
];

/**
 * The one derivation of a campaign's tone.
 *
 * `blocked` is whether a NAMED party owes the next step — `system` never
 * counts, because a live campaign that is simply running is not in trouble.
 */
export function campaignStateKind(input: {
  status: string;
  blocked: boolean;
}): CampaignStateKind {
  if (AT_RISK_CAMPAIGN_STATUSES.includes(input.status)) return 'risk';
  if (CLOSED_CAMPAIGN_STATUSES.includes(input.status)) return 'closed';
  if (input.blocked) return 'risk';
  if (input.status === 'live') return 'live';
  return 'waiting';
}

/* ── Who owes the next step ────────────────────────────────────────────────*/

export const CAMPAIGN_BLOCKER_OWNERS = [
  'founder',
  'creator',
  'proovd_review',
  'proovd_support',
  'proovd_operations',
  'system',
] as const;
export type CampaignBlockerOwner = (typeof CAMPAIGN_BLOCKER_OWNERS)[number];

export const CAMPAIGN_BLOCKER_OWNER_LABELS: Record<CampaignBlockerOwner, string> = {
  founder: 'Founder',
  creator: 'Creator',
  proovd_review: 'Proovd — campaign review',
  proovd_support: 'Proovd — support',
  proovd_operations: 'Proovd — campaign operations',
  system: 'System',
};

export const NO_BLOCKER_LABEL = 'Nothing is holding it up';
export const NO_PERSON_NEEDED_LABEL = 'No person needed';

export function ownerNeedsRouting(owner: CampaignBlockerOwner): boolean {
  return owner !== 'system';
}

/* ── Destinations ─────────────────────────────────────────────────────────*/

export interface CampaignDestination {
  key: string;
  label: string;
  mark: string;
  built: boolean;
  absentBecause?: string;
}

export const CAMPAIGN_DESTINATIONS: readonly CampaignDestination[] = [
  { key: 'founder_admin', label: 'Founder Admin', mark: 'F', built: true },
  { key: 'affiliate_admin', label: 'Affiliate Admin', mark: 'A', built: true },
  { key: 'support_admin', label: 'Support Admin', mark: 'S', built: true },
  /* Built 2026-08-15. The link lands on the Backers workspace already filtered
     to this campaign; a pre-order still has no address of its own, which is the
     Backers reference's own promise rather than a gap. */
  { key: 'backer_admin', label: 'Backer Admin', mark: 'B', built: true },
  {
    key: 'money_admin',
    label: 'Money & Fulfillment',
    mark: '$',
    built: false,
    absentBecause: 'Money console not built yet — the amounts here come from its records.',
  },
  {
    key: 'tasks',
    label: 'Tasks',
    mark: 'T',
    built: false,
    absentBecause: 'No task queue — work is recorded on the record it belongs to.',
  },
];

export type CampaignDestinationKey =
  | 'founder_admin'
  | 'affiliate_admin'
  | 'support_admin'
  | 'backer_admin'
  | 'money_admin'
  | 'tasks';

export function campaignDestination(key: CampaignDestinationKey): CampaignDestination {
  const found = CAMPAIGN_DESTINATIONS.find((d) => d.key === key);
  if (!found) throw new Error(`unknown campaign destination: ${key}`);
  return found;
}

/* ── Filters ──────────────────────────────────────────────────────────────*/

export const CAMPAIGN_FILTERS = [
  'all',
  'needs',
  'waiting',
  'live',
  'closed',
  'idea',
  'product',
] as const;
export type CampaignFilter = (typeof CAMPAIGN_FILTERS)[number];
export type CampaignGroup = Exclude<CampaignFilter, 'all'>;

export const CAMPAIGN_GROUPS = CAMPAIGN_FILTERS.filter(
  (key) => key !== 'all',
) as readonly CampaignGroup[];

/* ── Stages ───────────────────────────────────────────────────────────────*/

export const CAMPAIGN_STAGES = [
  'founder_setup',
  'campaign_review',
  'affiliate_work',
  'launch_set',
  'live',
  'closed',
] as const;
export type CampaignStage = (typeof CAMPAIGN_STAGES)[number];

export const CAMPAIGN_STAGE_LABELS: Record<CampaignStage, string> = {
  founder_setup: 'Founder setup',
  campaign_review: 'Campaign review',
  affiliate_work: 'Affiliate work',
  launch_set: 'Launch set',
  live: 'Live',
  closed: 'Closed',
};

export type CampaignStageState = 'done' | 'current' | 'upcoming';

/* ── Tabs ─────────────────────────────────────────────────────────────────*/

export const CAMPAIGN_RECORD_TABS = ['overview', 'live', 'close', 'history'] as const;
export type CampaignRecordTab = (typeof CAMPAIGN_RECORD_TABS)[number];

/* ── The public page (§18) ────────────────────────────────────────────────*/

export const CAMPAIGN_PUBLIC_STATES = [
  'private_draft',
  'known_link_only',
  'public',
  'ended_page',
] as const;
export type CampaignPublicState = (typeof CAMPAIGN_PUBLIC_STATES)[number];

export const CAMPAIGN_PUBLIC_STATE_LABELS: Record<CampaignPublicState, string> = {
  private_draft: 'Not public',
  known_link_only: 'Public by link only',
  public: 'Public',
  ended_page: 'Ended page',
};

export const KNOWN_LINK_ONLY_NOTE =
  'Live and reachable by anyone holding a link. Proovd browse and search indexing open on Day 8.';

/* ── History ──────────────────────────────────────────────────────────────*/

export const CAMPAIGN_HISTORY_SOURCES = [
  'campaign_status_history',
  'campaign_reviews',
  'association_status_history',
  'listing_fee_payments',
  'campaign_payment_flags',
  'campaign_close_batches',
  'campaign_enforcement_actions',
  'support_cases',
  'campaign_updates',
  'campaign_fulfillment',
] as const;
export type CampaignHistorySource = (typeof CAMPAIGN_HISTORY_SOURCES)[number];

export const CAMPAIGN_HISTORY_TAGS = [
  'Founder Admin',
  'Affiliate Admin',
  'Support Admin',
  'Money',
  'Proovd',
] as const;
export type CampaignHistoryTag = (typeof CAMPAIGN_HISTORY_TAGS)[number];

/* ── Pinned copy ──────────────────────────────────────────────────────────*/

export const CAMPAIGNS_IS_READ_ONLY =
  'This page shows where a campaign stands. Every decision — review, Creator work, launch, money, refunds, and support — is made in the admin page that owns it, and this links you there.';

export const THRESHOLD_NOT_SET_NOTE =
  'No Backer threshold has been set in the campaign build yet, so there is nothing to measure progress against.';

export const PROOVD_DECISION_HAS_NO_SCREEN =
  'The Admin screen for this decision is not built yet — it is made through the API and appears here once it is recorded.';

export const FRESHNESS_PREFIX = 'Checked';

/* ── Display identity ─────────────────────────────────────────────────────*/

export function campaignDisplayId(campaignId: string): string {
  const compact = campaignId.replace(/-/g, '').toUpperCase();
  return `CP-${compact.slice(0, 6)}`;
}

export function campaignInitials(name: string): string {
  const words = name
    .split(/\s+/)
    .map((word) => word.replace(/[^A-Za-z0-9]/g, ''))
    .filter((word) => word.length > 0);
  if (words.length === 0) return '—';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return `${words[0]![0]!}${words[1]![0]!}`.toUpperCase();
}
