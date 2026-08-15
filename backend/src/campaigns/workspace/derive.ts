/**
 * What a campaign's state MEANS — Spec §23.1, §23.2, §26.1, §27.1.
 *
 * Every value the Campaigns hub renders that is not a stored column is decided
 * here, once, and read by both the directory and the record. Two composers
 * deriving "is this blocked" separately is exactly how a list and a detail page
 * come to disagree about the same campaign.
 *
 * ── Nothing in this file invents a rule (§1 rule 6) ─────────────────────────
 * Every blocker names a RECORD: a review outcome, an enforcement action's own
 * customer explanation, a count of associations sitting in a §14.2 decision
 * state, an open support case, a missing listing payment, the §29.6 stored
 * deadline. There is no branch that produces a blocker from a date, a duration,
 * or an absence — which is §33.6.11's rule applied to an Admin surface, and the
 * reason this page can never become the check-in queue §30 forbids.
 *
 * ── The pill says the lifecycle; the tone says the trouble ──────────────────
 * The reference's `state` mixes the two — sometimes "Live", sometimes "Support
 * case open". Doing that in production would give the product a second
 * campaign-state vocabulary beside §23.1's 27, which is precisely what
 * `campaigns.status` is the single authority for. So the pill's text is always
 * `campaignStatusLabel(status)` and only its tone moves.
 */

import { campaignStatusLabel, campaignTypeLabel } from '../../founders/logic.js';
import { formatDay, formatInstant } from '../../founders/format.js';
import {
  CAMPAIGN_STAGE_LABELS,
  CAMPAIGN_STAGES,
  CAMPAIGN_BLOCKER_OWNER_LABELS,
  CLOSED_CAMPAIGN_STATUSES,
  KNOWN_LINK_ONLY_NOTE,
  NO_BLOCKER_LABEL,
  campaignStateKind,
  type CampaignBlockerOwner,
  type CampaignGroup,
  type CampaignPublicState,
  type CampaignStage,
  type CampaignStageState,
  type CampaignStateKind,
} from './logic.js';
import type { CampaignFacts } from './facts.js';

/**
 * The §23.1 statuses that come BEFORE the campaign has ever been public.
 *
 * A membership register rather than a keyword test, for §33.12.3's reason: the
 * checkable form of "is this campaign still being prepared" is a list somebody
 * decided, not a string that happens to contain a word. `suspended` is
 * deliberately absent from all three sets — a suspended campaign is neither
 * being prepared, nor live, nor finished, and forcing it into one would make
 * the filter bar tell an operator something untrue.
 */
export const PRE_LIVE_CAMPAIGN_STATUSES: readonly string[] = [
  'invited_draft',
  'vetting_submitted',
  'account_claimed',
  'stripe_onboarding_pending',
  'listing_fee_pending',
  'affiliate_response_and_build',
  'pending_review',
  'changes_required',
  'approved',
  'creator_prep',
  'creator_replacement',
];

/** §23.4 states in which a Creator still owes a §14.2 decision. */
const AWAITING_CREATOR_DECISION: readonly string[] = [
  'formal_decision_open',
  'reviewing',
  'proposal_pending',
];

/** §23.4 states that occupy a live slot, for the roster summary. */
const ACTIVE_ROSTER_STATUSES: readonly string[] = ['active', 'paused'];

/* ── The blocker ───────────────────────────────────────────────────────────*/

export interface DerivedBlocker {
  /** True when a NAMED party owes the next step. `system` is never blocked. */
  blocked: boolean;
  /** False when the text is genuinely `NO_BLOCKER_LABEL` — the band's "On track". */
  clear: boolean;
  text: string;
  owner: CampaignBlockerOwner;
  ownerLabel: string;
  due: string;
}

function blocker(
  owner: CampaignBlockerOwner,
  text: string,
  due: string,
): DerivedBlocker {
  return {
    blocked: owner !== 'system',
    clear: text === NO_BLOCKER_LABEL,
    text,
    owner,
    ownerLabel: CAMPAIGN_BLOCKER_OWNER_LABELS[owner],
    due,
  };
}

/**
 * The one thing standing in this campaign's way, or nothing.
 *
 * ── The order is severity for the CAMPAIGN, and it is not arbitrary ─────────
 * A suspension stops everything, so it outranks every clock. §29.6's
 * replacement window is next because missing it refunds the listing fee and
 * ends the campaign outright. The retry window follows because real money is in
 * flight. Then support — §27.8's one-business-day promise is the tightest clock
 * in the product and a person is waiting on the other end of it. Only then the
 * lifecycle's own waiting states.
 *
 * ── `system` is a real answer, not a fallback ───────────────────────────────
 * A live campaign that is simply running and a finished one with nothing
 * outstanding both return `system`, and `system` is what suppresses the routing
 * control. A page that offered "Open System" would be manufacturing an action,
 * which §20's caught-up ending and DNA §5.4 both refuse.
 */
export function deriveBlocker(facts: CampaignFacts, now: Date): DerivedBlocker {
  const campaign = facts.campaign;
  const status = campaign.status;

  /* 1 — §26.7 suspension. The recorded CUSTOMER explanation, never the internal
     reason: §25.6 keeps them in two columns precisely so an Admin surface an
     operator reads aloud cannot carry the internal one. */
  if (status === 'suspended') {
    return blocker(
      'proovd_operations',
      facts.enforcement?.customerExplanation ??
        'This campaign is suspended and waiting for a Proovd decision.',
      'Waiting for a Proovd decision to reinstate or stop the campaign',
    );
  }

  /* 2 — §29.6's replacement window. The STORED deadline is read; 14a's whole
     guarantee is that a retry or an edit cannot reset it. */
  if (status === 'creator_replacement') {
    const failure = facts.creatorFailure;
    const due = failure
      ? failure.replacementDueAt.getTime() <= now.getTime()
        ? `Replacement window closed ${formatInstant(failure.replacementDueAt)}`
        : `Replacement due by ${formatInstant(failure.replacementDueAt)}`
      : 'A replacement Creator has not been recorded yet';
    return blocker(
      'proovd_operations',
      'A required Creator did not deliver, and a replacement has not been made ready.',
      due,
    );
  }

  /* 3 — §21's retry window. Nobody at Proovd owes anything: the Backer updates
     a card and the sweep closes the window, so the owner is `system` and there
     is no routing control. It still reads as a blocker sentence because a
     campaign with cards failing is not "on track". */
  if (status === 'capture_retry_window') {
    const deadline = facts.closeBatch?.retryDeadlineAt ?? null;
    return blocker(
      'system',
      'Some card charges failed and the retry window is open.',
      deadline
        ? `Window closes ${formatInstant(deadline)}`
        : 'The window closes automatically',
    );
  }

  /* 4 — §27.8's promise. One business day, every case, and a person is waiting. */
  if (facts.openSupportCases > 0) {
    const many = facts.openSupportCases !== 1;
    return blocker(
      'proovd_support',
      `${facts.openSupportCases} support ${many ? 'cases are' : 'case is'} open on this campaign.`,
      'Proovd answers every case within one business day',
    );
  }

  /* 5 — §15: the Founder owes the requested changes. */
  if (status === 'changes_required') {
    return blocker(
      'founder',
      'Proovd requested changes before this campaign can be approved.',
      'Waiting for the Founder to resubmit',
    );
  }

  /* 6 — §15: Proovd owes the review. */
  if (status === 'pending_review') {
    return blocker(
      'proovd_review',
      'This campaign is waiting for a Proovd review decision.',
      'Waiting for a Proovd reviewer',
    );
  }

  /* 7 — the lifecycle's own waiting states. Each names what the record says is
     missing; none of them invents a deadline, because §6 fixes none for these. */
  switch (status) {
    case 'invited_draft':
      return blocker('founder', 'The Founder has not started campaign setup.', 'No deadline is set');
    case 'vetting_submitted':
      return blocker(
        'founder',
        'Setup answers are in and the Founder account has not been created yet.',
        'No deadline is set',
      );
    case 'account_claimed':
    case 'stripe_onboarding_pending':
      return blocker(
        'founder',
        'The Founder has not finished payment setup with Stripe.',
        'No deadline is set',
      );
    case 'listing_fee_pending':
      return blocker(
        'founder',
        'The Founder has not paid the listing fee.',
        'The campaign cannot be built until it is paid',
      );
    case 'affiliate_response_and_build': {
      const pending = AWAITING_CREATOR_DECISION.reduce(
        (total, key) => total + (facts.associationCounts.get(key) ?? 0),
        0,
      );
      if (pending > 0) {
        const many = pending !== 1;
        return blocker(
          'creator',
          `${pending} Creator ${many ? 'proposals are' : 'proposal is'} still waiting for a decision.`,
          'The response deadline is evaluated automatically',
        );
      }
      if (campaign.campaignBuildStatus !== 'complete') {
        return blocker(
          'founder',
          'The campaign build is not finished, so it cannot be submitted for review.',
          'No deadline is set',
        );
      }
      return blocker(
        'founder',
        'The campaign is built and has not been submitted for review.',
        'No deadline is set',
      );
    }
    case 'approved':
      return campaign.campaignLiveAt
        ? blocker('system', NO_BLOCKER_LABEL, `Launches ${formatInstant(campaign.campaignLiveAt)}`)
        : blocker(
            'proovd_operations',
            'The campaign is approved and no launch date has been set.',
            'Waiting for Proovd to schedule the launch',
          );
    case 'creator_prep':
      return campaign.campaignLiveAt
        ? blocker('system', NO_BLOCKER_LABEL, `Launches ${formatInstant(campaign.campaignLiveAt)}`)
        : blocker(
            'proovd_operations',
            'Creators are preparing and no launch date has been set.',
            'Waiting for Proovd to schedule the launch',
          );
    case 'live':
      return blocker(
        'system',
        NO_BLOCKER_LABEL,
        campaign.campaignCloseAt
          ? `Closes ${formatInstant(campaign.campaignCloseAt)}`
          : 'Running',
      );
    case 'closed_pending_capture':
      return blocker('system', 'Backer cards are being charged.', 'Charging runs automatically');
    case 'closed_reconciling':
      return blocker(
        'system',
        facts.resultsPreparedAt
          ? NO_BLOCKER_LABEL
          : 'Charges are final and results have not been prepared yet.',
        facts.resultsPreparedAt ? 'Results are ready' : 'Waiting for Proovd reconciliation',
      );
    case 'captured_pending_w9':
      return blocker(
        'founder',
        'The Founder payment is waiting on a verified W-9.',
        'Nothing is released until the form is verified',
      );
    case 'day_14_review':
      return blocker(
        'proovd_operations',
        'The Day 14 progress check has not been decided.',
        'Waiting for a Proovd decision',
      );
    default:
      break;
  }

  /* 8 — finished, and nothing outstanding. */
  return blocker(
    'system',
    NO_BLOCKER_LABEL,
    CLOSED_CAMPAIGN_STATUSES.includes(status) ? 'All jobs finished' : 'Running',
  );
}

/* ── Filter membership ─────────────────────────────────────────────────────*/

/**
 * Which filters a row answers to. Deliberately NOT exclusive.
 *
 * The reference's own data has one campaign in `needs`, `waiting` and `idea` at
 * once, and that is right: "blocked" and "Idea" answer different questions. The
 * one place this diverges from the prototype is that a pre-live campaign always
 * carries `waiting` — the prototype gave it to one blocked draft and not
 * another, which is a data inconsistency rather than a rule.
 */
export function deriveGroups(facts: CampaignFacts, blockerResult: DerivedBlocker): CampaignGroup[] {
  const groups: CampaignGroup[] = [];
  const status = facts.campaign.status;

  if (blockerResult.blocked) groups.push('needs');
  if (PRE_LIVE_CAMPAIGN_STATUSES.includes(status)) groups.push('waiting');
  if (status === 'live') groups.push('live');
  if (CLOSED_CAMPAIGN_STATUSES.includes(status)) groups.push('closed');
  if (facts.campaign.type === 'pre_build') groups.push('idea');
  if (facts.campaign.type === 'pre_launch') groups.push('product');

  return groups;
}

export function deriveStateKind(
  facts: CampaignFacts,
  blockerResult: DerivedBlocker,
): CampaignStateKind {
  return campaignStateKind({ status: facts.campaign.status, blocked: blockerResult.blocked });
}

/* ── The contextual date column ────────────────────────────────────────────*/

/**
 * The reference's "Launch or close" cell: whichever date this campaign is
 * actually about right now.
 *
 * Read from the three §21 anchor columns and nothing else — never from
 * `created_at`/`updated_at`, which §33.12.1's scan forbids for exactly the
 * reason it matters here: a campaign's dates are promises, and a row timestamp
 * is not one.
 */
export function deriveDateLabel(facts: CampaignFacts): string {
  const campaign = facts.campaign;
  const status = campaign.status;

  if (status === 'suspended') return 'Paused';
  if (CLOSED_CAMPAIGN_STATUSES.includes(status)) {
    const closed = formatDay(campaign.campaignCloseAt);
    return closed ? `Closed ${closed}` : 'Ended';
  }
  if (status === 'live') {
    const closes = formatDay(campaign.campaignCloseAt);
    return closes ? `Close ${closes}` : 'Live';
  }
  const launch = formatDay(campaign.campaignLiveAt);
  return launch ? `Launch ${launch}` : 'Launch not set';
}

/* ── The public page (§18) ─────────────────────────────────────────────────*/

export interface DerivedPublic {
  state: CampaignPublicState;
  /** Null for every campaign that has never gone live. There is no address. */
  url: string | null;
  unavailableBecause: string | null;
  note: string | null;
}

/**
 * Where — and whether — this campaign exists publicly.
 *
 * The brief's §9: nothing unpublished may become publicly reachable through
 * this tab. The enforcement is structural rather than a disabled control:
 * `url` is null for every pre-live status, so there is no address for a copy or
 * an open control to use. `/api/campaign/:id` answers 404 for those campaigns
 * anyway (§18), so a link would be a broken promise as well as a leak.
 */
export function derivePublic(facts: CampaignFacts, appBaseUrl: string): DerivedPublic {
  const campaign = facts.campaign;
  const status = campaign.status;

  if (PRE_LIVE_CAMPAIGN_STATUSES.includes(status)) {
    return {
      state: 'private_draft',
      url: null,
      unavailableBecause:
        'This campaign has never been public, so it has no public address. A campaign page exists from launch.',
      note: null,
    };
  }

  const url = `${appBaseUrl}/campaign/${campaign.id}`;

  if (status === 'live') {
    return campaign.discoveryOpenedAt
      ? { state: 'public', url, unavailableBecause: null, note: null }
      : {
          state: 'known_link_only',
          url,
          unavailableBecause: null,
          note: KNOWN_LINK_ONLY_NOTE,
        };
  }

  if (status === 'suspended') {
    return {
      state: 'public',
      url,
      unavailableBecause: null,
      note: 'The page is still reachable while the campaign is suspended.',
    };
  }

  return { state: 'ended_page', url, unavailableBecause: null, note: null };
}

/* ── The six-stage strip ───────────────────────────────────────────────────*/

export interface DerivedStage {
  key: CampaignStage;
  label: string;
  state: CampaignStageState;
  caption: string;
}

/**
 * The reference's six stages, read off §23.2's two tracks and §21's anchors.
 *
 * Not a seventh state machine: `Campaign review` and `Affiliate work` are the
 * build and roster columns, and the two genuinely do run at once from
 * `listing_paid_at`, which is why each is marked from its own record rather
 * than as a step in a line. `current` is the first stage that is not done —
 * exactly the reference's own `findIndex`.
 */
export function deriveStages(facts: CampaignFacts): DerivedStage[] {
  const campaign = facts.campaign;
  const status = campaign.status;
  const closed = CLOSED_CAMPAIGN_STATUSES.includes(status);
  const wentLive = campaign.campaignLiveAt !== null || status === 'live' || closed;

  const reviewApproved =
    facts.review?.outcome === 'approved' ||
    ['approved', 'creator_prep', 'creator_replacement', 'live', 'suspended'].includes(status) ||
    closed;

  const rosterReady = campaign.affiliateRosterStatus === 'launch_ready' || wentLive;

  const done: Record<CampaignStage, boolean> = {
    founder_setup: campaign.listingPaidAt !== null,
    campaign_review: reviewApproved,
    affiliate_work: rosterReady,
    launch_set: campaign.campaignLiveAt !== null,
    live: wentLive,
    closed,
  };

  const captions: Record<CampaignStage, string> = {
    founder_setup: campaign.listingPaidAt
      ? 'Listing fee paid'
      : campaignStatusLabel(status),
    campaign_review: reviewApproved
      ? 'Approved'
      : facts.review
        ? facts.review.outcome === 'changes_required'
          ? 'Changes needed'
          : 'In review'
        : 'Not submitted',
    affiliate_work: rosterReady
      ? campaign.affiliateRosterStatus === 'failed'
        ? 'No Creator accepted'
        : 'Creator work complete'
      : facts.associationTotal === 0
        ? 'Not started'
        : `${facts.associationTotal} recruited`,
    launch_set: formatDay(campaign.campaignLiveAt) ?? 'Not set',
    live: closed ? 'Finished' : status === 'live' ? 'Now' : 'Not yet',
    closed: closed ? (formatDay(campaign.campaignCloseAt) ?? 'Ended') : 'Not yet',
  };

  const firstOpen = CAMPAIGN_STAGES.findIndex((key) => !done[key]);

  return CAMPAIGN_STAGES.map((key, index) => ({
    key,
    label: CAMPAIGN_STAGE_LABELS[key],
    state: done[key] ? 'done' : index === firstOpen ? 'current' : 'upcoming',
    caption: captions[key],
  }));
}

/* ── Cross-domain summaries the reference shows as one line each ───────────*/

/** §15's own review vocabulary. Never a word this file invented. */
export function reviewSummary(facts: CampaignFacts): string {
  if (!facts.review) return 'Not submitted';
  if (facts.review.outcome === 'approved') return 'Approved';
  if (facts.review.outcome === 'changes_required') return 'Changes needed';
  return `In review — round ${facts.review.round}`;
}

/** The roster in one line, from §23.4 counts rather than a stored summary. */
export function affiliateSummary(facts: CampaignFacts): string {
  if (facts.campaign.affiliateRosterStatus === 'failed') return 'No Creator accepted';
  const active = ACTIVE_ROSTER_STATUSES.reduce(
    (total, key) => total + (facts.associationCounts.get(key) ?? 0),
    0,
  );
  if (active > 0) return `${active} active`;
  if (facts.campaign.affiliateRosterStatus === 'launch_ready') return 'Creator work complete';
  const pending = AWAITING_CREATOR_DECISION.reduce(
    (total, key) => total + (facts.associationCounts.get(key) ?? 0),
    0,
  );
  if (pending > 0) return 'Waiting for replies';
  if (facts.associationTotal === 0) return 'Not started';
  return `${facts.associationTotal} recruited`;
}

export function supportSummary(facts: CampaignFacts): string {
  return `${facts.openSupportCases} open`;
}

/** The campaign's own name — §14.4's build title, or the product it came from. */
export function campaignNameOf(facts: CampaignFacts): string {
  return facts.buildTitle ?? facts.productName ?? 'Untitled campaign';
}

export function typeLabelOf(facts: CampaignFacts): string | null {
  return campaignTypeLabel(facts.campaign.type);
}
