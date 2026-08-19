/**
 * The Campaigns Admin workspace registers — Spec §26.1, §23.1, §23.2, §3.1.
 *
 * Built from the supplied Campaigns reference (`docs/design-refrence/
 * Proovd-Campaigns-Admin_2.html`) over the campaign domain the product already
 * has. The reference is a layout, information-architecture and copy guide; it
 * is not the schema, and where the two disagree the Spec wins (§1.8).
 *
 * ── This section is a HUB, and that is its whole design ─────────────────────
 * The reference says so five times in its own copy — "the details and action
 * stay in the admin page that owns this work", "totals only", "detailed work
 * stays in the admin page where it happened" — and its prototype contains no
 * mutating control at all. Every operation a campaign needs already exists in
 * a router that another workspace owns: §15's review rounds, §16's readiness
 * and funding deadline, §17's launch, §20's live edits, §21's close batch,
 * §22.1's earnings, §24.8's refunds, §26.7's suspend/kill.
 *
 * So this file defines no action, no decision, and no eligibility rule. It
 * defines the words a READ uses. `CAMPAIGNS_IS_READ_ONLY` states the posture
 * where somebody would otherwise go looking for a button, and a test asserts
 * the router mounts no write.
 *
 * ── Nothing here restates a register another file owns ──────────────────────
 * `CAMPAIGN_STATUSES` (§23.1's 27 values) and `CAMPAIGN_STATUS_LABELS` stay in
 * `founder-workspace.ts`, and `CAMPAIGN_TYPE_LABELS` with them. A second copy
 * of §3.1's substitutions is a second place for `pre_build` to escape.
 */

import { CAMPAIGN_STATUSES, type CampaignStatus } from '../states/campaign.js';

/* ── The posture (§1.4, §26.1) ─────────────────────────────────────────────*/

/**
 * Pinned, and it rides the record header rather than sitting in a footer.
 *
 * An Admin who believes a campaign can be changed from here will look for the
 * control, not find it, and conclude the page is broken. Saying what the page
 * IS costs one sentence and answers that before it is asked (§27.1).
 */
export const CAMPAIGNS_IS_READ_ONLY =
  'This page shows where a campaign stands. Every decision — review, Creator work, launch, money, refunds, and support — is made in the admin page that owns it, and this links you there.';

/** The reference's own line above the routing list on the Close tab. */
export const OPEN_THE_PAGE_THAT_OWNS_IT = 'Open the admin page that owns the job.';

/* ── Display identity ──────────────────────────────────────────────────────*/

/**
 * A short, readable rendering of `campaigns.id`. NOT a stored reference.
 *
 * §27.8's support case has a real `reference` column because a customer quotes
 * it back on the phone; a campaign has no such column and inventing one would
 * be a schema change for a cosmetic id (§1 rule 6, and the brief's §10). So
 * this is a pure function of the UUID the record is actually addressed by, the
 * search matches BOTH forms, and the full id travels on the payload so nothing
 * downstream has to reverse this.
 */
export function campaignDisplayId(campaignId: string): string {
  const compact = campaignId.replace(/-/g, '').toUpperCase();
  return `CP-${compact.slice(0, 6)}`;
}

/** The two-letter mark on a directory row. Derived from the name, never stored. */
export function campaignInitials(name: string): string {
  const words = name
    .split(/\s+/)
    .map((word) => word.replace(/[^A-Za-z0-9]/g, ''))
    .filter((word) => word.length > 0);
  if (words.length === 0) return '—';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return `${words[0]![0]!}${words[1]![0]!}`.toUpperCase();
}

/* ── The state pill (§23.1) ────────────────────────────────────────────────*/

/**
 * The severity a row's pill reads at. Four tones, the reference's own.
 *
 * ── The pill says the LIFECYCLE, and the tone says the trouble ─────────────
 * The reference's `state` is a mix: sometimes the lifecycle ("Live", "Closed")
 * and sometimes the blocker ("Support case open", "Listing fee unpaid"). Doing
 * that in production would give the product a second campaign-state vocabulary
 * beside §23.1's 27 — which is exactly what `campaigns.status` is the single
 * authority for, and what §3.1's label register exists to render.
 *
 * So the pill's TEXT is always `campaignStatusLabel(status)` and this decides
 * only its tone. A live campaign with an open support case reads `Live` in the
 * risk tone beside "A support case is waiting for a decision" — which is both
 * facts, where the reference showed one of them twice.
 */
export const CAMPAIGN_STATE_KINDS = ['risk', 'waiting', 'live', 'closed'] as const;
export type CampaignStateKind = (typeof CAMPAIGN_STATE_KINDS)[number];

/**
 * Statuses that mean the campaign is over, however it ended.
 *
 * A superset of `classifyLifecycle`'s ended group: `refunded_no_creator` never
 * went public and is still finished, and `banned_founder` is only reachable
 * from `killed`. Membership, not a keyword scan — §33.12.3's lesson.
 */
export const CLOSED_CAMPAIGN_STATUSES: readonly CampaignStatus[] = [
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

/**
 * Statuses that are trouble on their own, whatever else is true.
 *
 * `suspended` is here and `killed` is not: a kill is a finished campaign and
 * belongs in `closed`, while a suspension is a live campaign under review and
 * is the thing an Admin has to come back to.
 */
export const AT_RISK_CAMPAIGN_STATUSES: readonly CampaignStatus[] = [
  'suspended',
  'changes_required',
  'creator_replacement',
  'capture_retry_window',
];

export interface CampaignStateInput {
  readonly status: CampaignStatus;
  /** True when something is genuinely waiting on a named party (not `system`). */
  readonly blocked: boolean;
}

/**
 * The one derivation of a campaign's tone. Pure, and read by the list and the
 * record alike so the two can never disagree about the same campaign.
 */
export function campaignStateKind(input: CampaignStateInput): CampaignStateKind {
  if (AT_RISK_CAMPAIGN_STATUSES.includes(input.status)) return 'risk';
  if (CLOSED_CAMPAIGN_STATUSES.includes(input.status)) return 'closed';
  if (input.blocked) return 'risk';
  if (input.status === 'live') return 'live';
  return 'waiting';
}

/* ── Who owes the next step (§27.1's "who owns it") ────────────────────────*/

/**
 * The party a campaign is waiting on.
 *
 * `system` is the reference's own "No person needed" — a live campaign that is
 * simply running, or a finished one with nothing outstanding — and it is the
 * value that SUPPRESSES the routing control. A page that offered "Open System"
 * would be manufacturing an action, which §20's caught-up ending and DNA §5.4
 * both refuse.
 */
export const CAMPAIGN_BLOCKER_OWNERS = [
  'founder',
  'creator',
  'proovd_review',
  'proovd_support',
  'proovd_operations',
  'system',
] as const;
export type CampaignBlockerOwner = (typeof CAMPAIGN_BLOCKER_OWNERS)[number];

export const CAMPAIGN_BLOCKER_OWNER_LABELS: Readonly<Record<CampaignBlockerOwner, string>> = {
  founder: 'Founder',
  creator: 'Creator',
  proovd_review: 'Proovd — campaign review',
  proovd_support: 'Proovd — support',
  proovd_operations: 'Proovd — campaign operations',
  system: 'System',
};

export const NO_BLOCKER_LABEL = 'Nothing is holding it up';
export const NO_PERSON_NEEDED_LABEL = 'No person needed';
export const ON_TRACK_LABEL = 'On track';
export const CURRENT_BLOCKER_LABEL = 'Current blocker';

/** Whether this owner should be offered a routing control at all. */
export function ownerNeedsRouting(owner: CampaignBlockerOwner): boolean {
  return owner !== 'system';
}

/* ── The six destinations the reference links to (§7 of the brief) ─────────*/

/**
 * Every admin page a campaign routes to, and whether it exists.
 *
 * Three do and three do not, and the split is checked rather than remembered:
 * `absentBecause` is required on exactly the ones with no route, so a
 * destination cannot be quietly added to the list without somebody deciding
 * which side it is on. `RecordLink`'s shown-but-unavailable treatment — the one
 * the Support workspace introduced on 2026-08-13 — renders the reason.
 *
 * §1.4's two honest options are to hide a control or to name what it is.
 * Hiding would make Campaigns describe a smaller product than the one being
 * built, so all six are shown and three say what they are waiting for.
 */
export interface CampaignDestination {
  readonly key: string;
  readonly label: string;
  /** The one-letter mark on the link row, from the reference. */
  readonly mark: string;
  readonly built: boolean;
  /** Required when `built` is false; forbidden when it is true. */
  readonly absentBecause?: string;
}

export const CAMPAIGN_DESTINATIONS = [
  { key: 'founder_admin', label: 'Founder Admin', mark: 'F', built: true },
  { key: 'affiliate_admin', label: 'Affiliate Admin', mark: 'A', built: true },
  { key: 'support_admin', label: 'Support Admin', mark: 'S', built: true },
  /*
    The three sentences below are read by an operator on screen, so they carry
    no Spec citations. An earlier draft rendered "§26.5 reservation ledger" and
    "§30 forbids a scheduled queue" into the routing list, which is an internal
    reference reaching a surface — the same class of leak §3.1 is about, and the
    screenshot pass is what caught it. The reasoning stays in the comments.
  */
  {
    key: 'backer_admin',
    label: 'Backer Admin',
    mark: 'B',
    /* Built 2026-08-15. It lands on the Backers workspace filtered to this
       campaign — the deep link is `/admin/backers?view=backers&campaignId=…`,
       which is a real position rather than an unfiltered list an Admin then has
       to narrow by hand.

       A pre-order still has no address of its OWN, and that is the Backers
       reference's own promise ("One row per Backer. No extra record page."),
       not a gap: everything a pre-order holds is on its row. */
    built: true,
  },
  {
    key: 'money_admin',
    label: 'Money & Fulfillment',
    mark: '$',
    /* Built 2026-08-19. This entry carried "Money console not built yet — the
       amounts here come from its records" from the day the hub shipped, and
       that sentence was the promise the console was written to keep: every
       amount there is READ from the record the service wrote, so the hub and
       the console cannot disagree. The link lands on this campaign's own money
       record. */
    built: true,
  },
  {
    key: 'tasks',
    label: 'Tasks',
    mark: 'T',
    /* Built 2026-08-16. The old reasoning here was right and still is: §30
       forbids a scheduled queue that chases anybody, and nothing built one.
       What shipped is not a queue — nobody is assigned, nothing is scheduled,
       and no message is sent; it is a note panel whose due date drives a
       read-side pill and nothing else, with each of those absences asserted
       by test. Tasks is a panel rather than an address, so the destination is
       the campaign's own record with `?tasks=new`, which opens the panel with
       this campaign already chosen as the reference. */
    built: true,
  },
] as const satisfies readonly CampaignDestination[];

export type CampaignDestinationKey = (typeof CAMPAIGN_DESTINATIONS)[number]['key'];

export function campaignDestination(key: CampaignDestinationKey): CampaignDestination {
  const found = CAMPAIGN_DESTINATIONS.find((d) => d.key === key);
  if (!found) throw new Error(`unknown campaign destination: ${key}`);
  return found;
}

/* ── The directory filters ─────────────────────────────────────────────────*/

/**
 * The reference's seven filters — and they are deliberately NOT exclusive.
 *
 * One campaign in the prototype sits in `needs`, `waiting` and `idea` at once,
 * and the bar mixes lifecycle with campaign type. That is correct for an
 * operations screen: "blocked" and "Idea" answer different questions. So a row
 * carries a derived `groups` array and a filter is membership in it.
 *
 * Nothing is stored. A `group` column would be a fifth campaign-state store
 * that drifts from `campaigns.status`, which is the mistake §26.8's timeline
 * trap names in a different phase.
 */
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

/** Every filter except the `all` pseudo-filter — what a row may actually carry. */
export type CampaignGroup = Exclude<CampaignFilter, 'all'>;

export const CAMPAIGN_GROUPS = CAMPAIGN_FILTERS.filter(
  (key) => key !== 'all',
) as readonly CampaignGroup[];

export interface CampaignFilterDefinition {
  readonly key: CampaignFilter;
  readonly label: string;
  /** Ships beside the count, for §20's reason: an undefined metric is the one
      two people argue about. */
  readonly counts: string;
}

export const CAMPAIGN_FILTER_DEFINITIONS: readonly CampaignFilterDefinition[] = [
  { key: 'all', label: 'All', counts: 'Every campaign on the record, at any stage.' },
  {
    key: 'needs',
    label: 'Blocked',
    counts: 'Campaigns where a named person owes the next step. Nothing moves until they act.',
  },
  {
    key: 'waiting',
    label: 'Waiting',
    counts: 'Campaigns still being set up or prepared for launch, blocked or not.',
  },
  { key: 'live', label: 'Live', counts: 'Campaigns taking pre-orders right now.' },
  { key: 'closed', label: 'Closed', counts: 'Campaigns that have ended, however they ended.' },
  { key: 'idea', label: 'Idea', counts: 'Idea Campaigns — the model with a Backer threshold at close.' },
  { key: 'product', label: 'Product', counts: 'Product Campaigns — every valid pre-order is charged at close.' },
];

/** The hero count's caption and label. A derived number, never a stored one. */
export const BLOCKED_COUNT_CAPTION = 'Campaigns waiting for someone to finish a job';
export const BLOCKED_COUNT_LABEL = 'blocked';

/* ── The six-stage strip (§23.1, §23.2) ────────────────────────────────────*/

/**
 * The reference's six stages, in its order.
 *
 * They are a READING of §23.2's two parallel tracks plus the three §21 anchors
 * — not a seventh state machine. `Campaign review` and `Affiliate work` are the
 * build and roster columns respectively, and the two genuinely do run at once
 * from `listing_paid_at`, which is why the strip marks them independently
 * rather than as steps in a line.
 */
export const CAMPAIGN_STAGES = [
  'founder_setup',
  'campaign_review',
  'affiliate_work',
  'launch_set',
  'live',
  'closed',
] as const;
export type CampaignStage = (typeof CAMPAIGN_STAGES)[number];

export const CAMPAIGN_STAGE_LABELS: Readonly<Record<CampaignStage, string>> = {
  founder_setup: 'Founder setup',
  campaign_review: 'Campaign review',
  affiliate_work: 'Affiliate work',
  launch_set: 'Launch set',
  live: 'Live',
  closed: 'Closed',
};

export type CampaignStageState = 'done' | 'current' | 'upcoming';

export interface CampaignStageView {
  readonly key: CampaignStage;
  readonly label: string;
  readonly state: CampaignStageState;
  /** The caption under the stage — what it is waiting on, or what happened. */
  readonly caption: string;
}

/* ── The record's four tabs ────────────────────────────────────────────────*/

export const CAMPAIGN_RECORD_TABS = ['overview', 'live', 'close', 'history'] as const;
export type CampaignRecordTab = (typeof CAMPAIGN_RECORD_TABS)[number];

export const CAMPAIGN_RECORD_TAB_LABELS: Readonly<Record<CampaignRecordTab, string>> = {
  overview: 'Overview',
  live: 'Live',
  close: 'Close',
  history: 'History',
};

/* ── The public page (§18) ─────────────────────────────────────────────────*/

/**
 * What the campaign's public address currently is.
 *
 * `private_draft` is the state that matters: a campaign that has never gone
 * live has NO public page, `/api/campaign/:id` answers 404 for it, and the
 * record must therefore offer no link. The brief's §9 names this exactly —
 * nothing unpublished may become publicly reachable through this tab — and the
 * enforcement is that the payload carries `publicUrl: null`, so there is no
 * address for a control to open.
 */
export const CAMPAIGN_PUBLIC_STATES = [
  'private_draft',
  'known_link_only',
  'public',
  'ended_page',
] as const;
export type CampaignPublicState = (typeof CAMPAIGN_PUBLIC_STATES)[number];

export const CAMPAIGN_PUBLIC_STATE_LABELS: Readonly<Record<CampaignPublicState, string>> = {
  private_draft: 'Not public',
  known_link_only: 'Public by link only',
  public: 'Public',
  ended_page: 'Ended page',
};

/**
 * §18's Days 1–7 rule, stated where an Admin would otherwise read
 * "Public by link only" as a defect.
 */
export const KNOWN_LINK_ONLY_NOTE =
  'Live and reachable by anyone holding a link. Proovd browse and search indexing open on Day 8.';

/* ── The composed history (§26.8) ──────────────────────────────────────────*/

/**
 * Where a history entry was READ FROM.
 *
 * There is no `campaign_events` table and there must never be one — §26.8's
 * trap is that a second event store which drifts from the first is worse than
 * no timeline, and this page reads five domains at once, which is exactly the
 * condition under which somebody proposes caching them. Every entry names its
 * source table, so the claim that this composes rather than duplicates is
 * checkable from the response.
 */
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

/**
 * The admin page a history entry came FROM — the reference's own source tag.
 *
 * A separate axis from the source table on purpose: three tables' events all
 * happened in the Founder workspace, and the tag answers "where would I go to
 * see more", which is the question a hub exists to answer.
 */
export const CAMPAIGN_HISTORY_TAGS = [
  'Founder Admin',
  'Affiliate Admin',
  'Support Admin',
  'Money',
  'Proovd',
] as const;
export type CampaignHistoryTag = (typeof CAMPAIGN_HISTORY_TAGS)[number];

/* ── Copy the reference pins, kept as constants ────────────────────────────*/

export const CAMPAIGN_COPY = {
  directoryEyebrow: 'Campaigns',
  directoryTitle: 'All campaigns',
  directoryLede: 'See where every campaign stands and who owns the next step.',
  emptyTitle: 'No campaigns found',
  emptyBody: 'Try another filter or search.',
  blockerDetail: 'The details and action stay in the admin page that owns this work.',
  liveTotalsLede: 'Totals only. Open the linked admin page for individual records or actions.',
  closeLede:
    'This page shows the result. Charges, payments, refunds, and delivery stay in their own admin pages.',
  historyLede: 'Detailed work stays in the admin page where it happened.',
  notLiveTitle: 'This campaign is not live',
  notLiveBody: 'Live totals will appear here after launch.',
  routeNoteTitle: 'Need to do something?',
} as const;

/**
 * The Idea progress bar's denominator is `campaign_build.order_threshold`, and
 * when it is unset there is NO bar.
 *
 * The prototype hardcodes 120. A hardcoded denominator would render every Idea
 * campaign against a number nobody agreed to, and §14.4 makes the threshold the
 * Founder's own build value — so an unset one is a fact to state, not a default
 * to invent (§1 rule 6, §1.4).
 */
export const THRESHOLD_NOT_SET_NOTE =
  'No Backer threshold has been set in the campaign build yet, so there is nothing to measure progress against.';

/* ── The one gap the destination register cannot express (§1.4) ────────────*/

/**
 * Why a blocker Proovd itself owes sometimes offers no destination.
 *
 * Five decisions land on `proovd_review` / `proovd_operations` — §15's review
 * rounds, §16/§17's launch scheduling, §26.7's suspension, §29.6's replacement,
 * and §22.4's Day 14 check. Every one has a router and none has a screen: the
 * old Admin dashboard was replaced and those surfaces are supplied separately.
 * So such a campaign has a real owner and nowhere to send an operator, and the
 * honest answer is to say so rather than to route them somewhere plausible.
 * Sending them to the Founder workspace would be a wrong destination presented
 * as a right one, which is worse than none.
 *
 * The sentence names the CLASS rather than listing the five, because a sixth
 * would otherwise make it quietly wrong — an earlier draft said "campaign
 * review and scheduling" and was already inaccurate for the other three.
 *
 * There is deliberately no general "parked messages" register beside this one:
 * the three unbuilt destinations already carry `absentBecause` on
 * `CAMPAIGN_DESTINATIONS`, and a second copy of those sentences is a second
 * place for them to drift.
 */
export const PROOVD_DECISION_HAS_NO_SCREEN =
  'The Admin screen for this decision is not built yet — it is made through the API and appears here once it is recorded.';

/* ── What this workspace refuses to become (§30, §3.1, §3.2) ───────────────*/

/**
 * Words no Campaigns surface may carry, checked by test.
 *
 * The first group is §3.1's internal vocabulary, which this page is unusually
 * exposed to because it reads five domains that all use it. The rest is §3.2's
 * universally banned list plus §30's engagement machinery — a hub that starts
 * ranking campaigns is a leaderboard, and one that starts counting down is
 * pressure.
 */
export const CAMPAIGN_BANNED_TERMS = [
  'pre_build',
  'pre-build',
  'pre_launch',
  'pre-launch',
  'reservation',
  'pledge',
  'donate',
  'escrow',
  'all-or-nothing',
  'leaderboard',
  'real time',
  'real-time',
] as const;

/** §30: refresh-based data never claims to be live. The reference's own stamp. */
export const FRESHNESS_PREFIX = 'Checked';

/* ── Guard used by the backend restatement's drift test ────────────────────*/

export function isCampaignStatusValue(value: string): value is CampaignStatus {
  return (CAMPAIGN_STATUSES as readonly string[]).includes(value);
}
