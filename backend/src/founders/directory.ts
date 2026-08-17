/**
 * The directory derivations — Spec §26.1, §9, §23.1; the 2026-08-16 rebuild.
 *
 * Pure functions over facts the caller loaded, so the directory row and the
 * record header feed the SAME kernels from the same facts and can never
 * disagree about a person's type, lifecycle, or who owes the next step. The
 * suite drives them directly.
 *
 * ── `Proposed` is an absence, not a type ────────────────────────────────────
 * §9 locks Idea or Product at submission and nothing else exists. The
 * directory's third word is the absence of that lock — derived here, present
 * in the filter vocabulary, and deliberately absent from every type register.
 *
 * ── The lifecycle label is a composition, not a 28th state ──────────────────
 * `campaigns.status` stays §23.1's machine value and `CAMPAIGN_STATUS_LABELS`
 * stays total over it. What this file adds is finer words for the pre-claim
 * stretch — where one status (`invited_draft`) genuinely covers four different
 * situations an Admin acts differently on — and the `· Day N` suffix for a
 * live campaign, computed from `campaign_live_at` (never from a row
 * timestamp, §33.12.1). Every branch reads a record; none reads a clock into
 * a rule.
 *
 * ── Two action columns, one severity order ──────────────────────────────────
 * The Admin cell reuses the attention kernel's answer (one thing or nothing,
 * §20's ranking applied to a person). The Founder cell reads the
 * `FOUNDER_NEXT_STEP_LABELS` register plus the pre-claim derivations, refined
 * by finer records where one answers better (a Day 14 review with evidence
 * already submitted stops asking for it). Every no-action state carries its
 * reason (§1.4).
 */

import {
  campaignStatusLabel,
  FOUNDER_NEXT_STEP_LABELS,
  NO_ACCESS_YET_LABEL,
  PROPOSED_TYPE_LABEL,
  WAITING_ON_PROOVD_LABEL,
  type CampaignStatus,
  type DirectoryActionCell,
  type FounderAccountState,
  type FounderDirectoryFilterKey,
} from './logic.js';
import type { FounderAttention } from './types.js';

/** The short chip words. §3.1's substitution, in the reference's chip form. */
const SHORT_TYPE_LABELS: Record<string, string> = {
  pre_build: 'Idea',
  pre_launch: 'Product',
};

/** `No action needed` — restated from shared; drift-tested. */
export const NO_ACTION_CELL_LABEL = 'No action needed';

export interface DirectoryFacts {
  /** The current campaign's §23.1 status, or null when the person has none. */
  status: CampaignStatus | null;
  /** `campaigns.type` — meaningful only once locked. */
  typeRaw: string | null;
  typeLocked: boolean;
  /** Invitation sends for the current draft. */
  sends: number;
  /** Whether the LATEST send was confirmed delivered. Null when none exist. */
  latestSendConfirmed: boolean | null;
  /** How many §9 answers hold content (0–3). */
  vettingAnswered: number;
  claimed: boolean;
  liveAt: Date | null;
  accountState: FounderAccountState;
  attention: FounderAttention;
  preferredName: string;
  /** True when a `day_14_review` campaign already has a submitted receipt. */
  day14EvidenceSubmitted: boolean;
  now: Date;
}

/* ── Type ───────────────────────────────────────────────────────────────────*/

/** `Idea` | `Product` | `Proposed` — the directory chip. */
export function directoryTypeLabel(facts: Pick<DirectoryFacts, 'typeRaw' | 'typeLocked'>): string {
  if (!facts.typeLocked || !facts.typeRaw) return PROPOSED_TYPE_LABEL;
  return SHORT_TYPE_LABELS[facts.typeRaw] ?? facts.typeRaw;
}

/** `Idea · locked` | `Product · locked` | `Proposed` — the record header chip. */
export function typeChipLabel(facts: Pick<DirectoryFacts, 'typeRaw' | 'typeLocked'>): string {
  const label = directoryTypeLabel(facts);
  return label === PROPOSED_TYPE_LABEL ? label : `${label} · locked`;
}

/** Which type-filter buckets a row matches. */
export function matchesTypeFilter(
  facts: Pick<DirectoryFacts, 'typeRaw' | 'typeLocked'>,
  filter: 'all' | 'idea' | 'product' | 'proposed',
): boolean {
  if (filter === 'all') return true;
  const label = directoryTypeLabel(facts);
  if (filter === 'idea') return label === 'Idea';
  if (filter === 'product') return label === 'Product';
  return label === PROPOSED_TYPE_LABEL;
}

/* ── Lifecycle ──────────────────────────────────────────────────────────────*/

/** Day N since `campaign_live_at`, or null before launch. Day 1 is launch day. */
export function campaignDayOf(liveAt: Date | null, now: Date): number | null {
  if (!liveAt || now.getTime() < liveAt.getTime()) return null;
  return Math.floor((now.getTime() - liveAt.getTime()) / 86_400_000) + 1;
}

/**
 * The composed lifecycle label.
 *
 * The pre-claim stretch is derived from the invitation and vetting records
 * because `invited_draft` covers four situations an Admin acts differently
 * on. Everything from the claim onward is the §23.1 label, with `Live` gaining
 * its day count.
 */
export function lifecycleLabel(facts: DirectoryFacts): string {
  const { status } = facts;
  if (status === null) return 'Pre-invite';

  if (status === 'invited_draft') {
    if (facts.vettingAnswered > 0) return 'Founder form draft';
    if (facts.sends === 0) return 'Invite draft';
    if (facts.latestSendConfirmed === false) return 'Invite delivery unconfirmed';
    return 'Invite sent';
  }
  if (status === 'vetting_submitted') return 'Founder form submitted';
  if (status === 'account_claimed') return 'Account claimed';

  if (status === 'live') {
    const day = campaignDayOf(facts.liveAt, facts.now);
    return day === null ? 'Live' : `Live · Day ${day}`;
  }

  return campaignStatusLabel(status);
}

/* ── The two action cells ───────────────────────────────────────────────────*/

/**
 * What the Founder owes next, or the reason nothing is asked of them.
 *
 * Pre-claim derives from the invitation record; post-claim reads the register,
 * refined where a finer record answers better. When the Founder owes nothing
 * and Proovd owes something, the cell says so — `Waiting on Proovd` is the
 * reference's own word for it.
 */
export function founderActionCell(
  facts: DirectoryFacts,
  adminDue: boolean,
): DirectoryActionCell {
  if (facts.accountState === 'Permanently banned' || facts.accountState === 'Access suspended') {
    return { kind: 'none', label: NO_ACTION_CELL_LABEL };
  }

  if (!facts.claimed) {
    if (facts.status === 'vetting_submitted') {
      return { kind: 'due', label: 'Complete the account claim' };
    }
    if (facts.sends === 0) return { kind: 'none', label: NO_ACCESS_YET_LABEL };
    if (facts.latestSendConfirmed === false) {
      return { kind: 'none', label: NO_ACCESS_YET_LABEL };
    }
    if (facts.vettingAnswered > 0) return { kind: 'due', label: 'Finish the setup form' };
    return { kind: 'due', label: 'Accept the private invitation' };
  }

  const byStatus = facts.status ? FOUNDER_NEXT_STEP_LABELS[facts.status] : null;
  const refined =
    facts.status === 'day_14_review' && facts.day14EvidenceSubmitted ? null : byStatus;

  if (refined) return { kind: 'due', label: refined };
  return {
    kind: 'none',
    label: adminDue ? WAITING_ON_PROOVD_LABEL : NO_ACTION_CELL_LABEL,
  };
}

/**
 * What Proovd owes next, or the reason nothing is due.
 *
 * The attention kernel is the authority — one thing or nothing, already
 * ranked. The one genuinely-Admin-owed state it does not see is an invitation
 * composed and never sent, because that is not a fault of any record, just
 * work not done yet. The no-action reason names who does own the next step
 * (§1.4: `No action — …` beats a bare dash).
 */
export function adminActionCell(
  facts: DirectoryFacts,
  founderOwesNext: boolean,
): DirectoryActionCell {
  if (facts.attention.needed) return { kind: 'due', label: facts.attention.text };

  if (!facts.claimed && facts.sends === 0 && facts.accountState === 'Not created yet') {
    return { kind: 'due', label: 'Review and send the invite' };
  }
  if (!facts.claimed && facts.latestSendConfirmed === false) {
    return { kind: 'due', label: 'Confirm invite delivery or send a new one' };
  }

  if (founderOwesNext) {
    return { kind: 'none', label: `No action — ${facts.preferredName} owns the next step` };
  }
  return { kind: 'none', label: 'No action — nothing is blocked' };
}

/**
 * Both cells together, because they read each other's answer: the Founder
 * cell says `Waiting on Proovd` only when the Admin cell is due, and the
 * Admin cell's no-action reason names the Founder only when they owe the
 * next step. Two passes settle it without a cycle.
 */
export function actionCells(facts: DirectoryFacts): {
  adminAction: DirectoryActionCell;
  founderAction: DirectoryActionCell;
} {
  const founderFirstPass = founderActionCell(facts, false);
  const adminAction = adminActionCell(facts, founderFirstPass.kind === 'due');
  const founderAction = founderActionCell(facts, adminAction.kind === 'due');
  return { adminAction, founderAction };
}

/* ── Filter-card membership ─────────────────────────────────────────────────*/

/** The statuses between the claim and launch — the `Onboarding` card. */
const ONBOARDING_STATUSES: ReadonlySet<CampaignStatus> = new Set([
  'account_claimed',
  'stripe_onboarding_pending',
  'listing_fee_pending',
  'affiliate_response_and_build',
  'pending_review',
  'changes_required',
  'approved',
  'creator_prep',
  'creator_replacement',
]);

/**
 * Which filter cards a row belongs to. Cards overlap deliberately — a live
 * campaign can need Admin — which is why they are filters, not a partition.
 */
export function directoryFilters(
  facts: DirectoryFacts,
  adminAction: DirectoryActionCell,
): FounderDirectoryFilterKey[] {
  const keys: FounderDirectoryFilterKey[] = ['all'];
  if (adminAction.kind === 'due') keys.push('needs_admin');
  if (!facts.claimed && facts.sends > 0) keys.push('invited');
  if (!facts.claimed && facts.sends === 0) keys.push('pre_invite');
  if (facts.claimed && facts.status !== null && ONBOARDING_STATUSES.has(facts.status)) {
    keys.push('onboarding');
  }
  if (facts.status === 'live') keys.push('live');
  return keys;
}
