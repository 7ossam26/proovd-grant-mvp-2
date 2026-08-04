/**
 * Live campaign operations — Spec §20, DNA §5.2, §5.3, §5.6 (Phase 17a).
 *
 * The Founder's campaign home is three altitudes, and §20 states each of them as
 * a list. A list in prose is a list nobody can test, so each is a register here —
 * the five Act ranks, the eleven Explore sections, the four milestones — the
 * backend restates them and drift-tests, and the acceptance suite asserts against
 * the register rather than against a screenshot. §33.6.7 ("one correctly ranked
 * real action") and §33.6.8 ("complete data without a widget grid") are both
 * claims about a list, and this is the list.
 *
 * ── Everything here is pure ─────────────────────────────────────────────────
 * Ranking, count reconciliation, threshold crossing, and milestone derivation
 * are functions over a gathered snapshot, the way §15's roster readiness is. That
 * is what lets §33.6.9 and §33.6.10 be asserted as facts about a function instead
 * of being simulated through a network.
 *
 * ── The copy is a constant, and a bracket left in it throws ──────────────────
 * §20 fixes several sentences word for word — `You're all caught up. Results land
 * [local close].` most of all, which DNA §5.4 calls a designed done-moment. They
 * are constants with resolvers that refuse a rendered string still carrying a
 * bracket, exactly as Appendix A.5's listing consent and A.3/A.4's pre-order
 * consents do. A paraphrase of a done-moment is a softer promise.
 *
 * ── Never "real time" ───────────────────────────────────────────────────────
 * §20 says freshness reads `Updated 3:40 PM` and "never say real time"; §30 bans
 * the claim outright. `BANNED_FRESHNESS_TERMS` is scanned by test across every
 * Phase 17 file, because the word is one autocomplete away in any label.
 */

/* ── §20 Act: the five ranked actions ──────────────────────────────────────── */

/**
 * §20: "Show one real primary action, ranked." The rank numbers are the Spec's
 * own ordering, and they are data rather than the order of a switch statement so
 * that a sixth candidate cannot be added without a §20 line behind it.
 *
 * `requiresRealRecord` states the thing that makes §33.6.7 meaningful: each kind
 * names the record that has to exist before the action may be shown. There is no
 * kind whose source is a timer or a heuristic — DNA §5.4 and §20's own "show no
 * manufactured CTA" mean an action with no record behind it is not an action.
 */
export interface ActRankDefinition {
  rank: 1 | 2 | 3 | 4 | 5;
  kind: ActActionKind;
  /** What the Founder is being asked to do. Customer-facing (§3.1). */
  label: string;
  /** The record that must exist for this candidate to be real. */
  requiresRealRecord: string;
  specRef: string;
}

export const ACT_ACTION_KINDS = [
  'safety_compliance_blocker',
  'delivery_refund_date_review',
  'unanswered_backer_question',
  'required_campaign_update',
  'optional_milestone_update',
] as const;
export type ActActionKind = (typeof ACT_ACTION_KINDS)[number];

export const ACT_RANKS: readonly ActRankDefinition[] = [
  {
    rank: 1,
    kind: 'safety_compliance_blocker',
    label: 'Resolve a safety or compliance block',
    requiresRealRecord: 'an active suspension or a recorded blocking compliance gap',
    specRef: '§20 Act 1',
  },
  {
    rank: 2,
    kind: 'delivery_refund_date_review',
    label: 'Review a delivery, refund, or date change',
    requiresRealRecord: 'an open review round or a pending classified change to those terms',
    specRef: '§20 Act 2',
  },
  {
    rank: 3,
    kind: 'unanswered_backer_question',
    label: 'Answer a Backer question',
    requiresRealRecord: 'a support case awaiting the Founder with an unanswered inbound message',
    specRef: '§20 Act 3',
  },
  {
    rank: 4,
    kind: 'required_campaign_update',
    label: 'Post the required campaign update',
    requiresRealRecord: 'a recorded material delivery change with no update pairing it yet',
    specRef: '§20 Act 4',
  },
  {
    rank: 5,
    kind: 'optional_milestone_update',
    label: 'Share a milestone update',
    requiresRealRecord: 'an unacknowledged milestone that actually occurred',
    specRef: '§20 Act 5',
  },
] as const;

const RANK_BY_KIND = new Map<ActActionKind, ActRankDefinition>(
  ACT_RANKS.map((definition) => [definition.kind, definition]),
);

export function actRankFor(kind: ActActionKind): ActRankDefinition {
  const definition = RANK_BY_KIND.get(kind);
  if (!definition) throw new LiveRuleError(`no §20 Act rank is registered for "${kind}"`);
  return definition;
}

export class LiveRuleError extends Error {
  override readonly name = 'LiveRuleError';
}

/* ── Ranking ───────────────────────────────────────────────────────────────── */

/** One real candidate, gathered from the record that makes it real. */
export interface ActCandidate {
  kind: ActActionKind;
  /** The record this candidate was derived from — id and table, for the audit. */
  sourceTable: string;
  sourceId: string;
  /** What the Founder reads. Composed from the record, never a template default. */
  detail: string;
  /** Where the action is performed. */
  href: string;
  /** When the underlying record appeared — the tiebreak inside one rank. */
  occurredAt: Date;
}

/**
 * §20: "A documented safety override may change ranking."
 *
 * Documented is the operative word, so the type makes it documented: a reason and
 * an actor are required fields, not optional ones. An override with no reason is
 * a reordering nobody can review, which is the thing §20 asks to be stored with
 * "prior rank, reason, actor, and time".
 */
export interface ActSafetyOverride {
  promoteKind: ActActionKind;
  reason: string;
  actor: string;
  recordedAt: Date;
}

export type ActDecision =
  | {
      state: 'action';
      action: ActCandidate;
      rank: number;
      /** True when a documented safety override chose this over the natural rank. */
      overridden: boolean;
      /** Everything else that was real, in rank order. Explore renders these. */
      deferred: readonly ActCandidate[];
    }
  | { state: 'caught_up'; sentence: string };

/**
 * Picks the one primary action, or the caught-up ending.
 *
 * §20 and DNA §5.6 both give this moment one hero. When nothing real is
 * outstanding the answer is the done-moment sentence, never a manufactured CTA —
 * which is why this function has no fallback branch that invents one. An empty
 * candidate list is a designed state, not a gap to fill.
 */
export function decideAct(
  candidates: readonly ActCandidate[],
  input: { localCloseLabel: string; override?: ActSafetyOverride | undefined },
): ActDecision {
  if (candidates.length === 0) {
    return { state: 'caught_up', sentence: resolveCaughtUp(input.localCloseLabel) };
  }

  const ordered = [...candidates].sort((a, b) => {
    const byRank = actRankFor(a.kind).rank - actRankFor(b.kind).rank;
    if (byRank !== 0) return byRank;
    // Inside one rank the older record is the one that has waited longest.
    return a.occurredAt.getTime() - b.occurredAt.getTime();
  });

  const override = input.override;
  if (override) {
    if (!override.reason.trim()) {
      throw new LiveRuleError('a safety override must carry a reason (§20)');
    }
    if (!override.actor.trim()) {
      throw new LiveRuleError('a safety override must name its actor (§20)');
    }
    const promoted = ordered.find((candidate) => candidate.kind === override.promoteKind);
    // An override that names a kind with no real candidate promotes nothing. It
    // cannot manufacture an action — that is the one thing §20 forbids outright.
    if (promoted) {
      return {
        state: 'action',
        action: promoted,
        rank: actRankFor(promoted.kind).rank,
        overridden: promoted !== ordered[0],
        deferred: ordered.filter((candidate) => candidate !== promoted),
      };
    }
  }

  const [first, ...rest] = ordered;
  return {
    state: 'action',
    action: first!,
    rank: actRankFor(first!.kind).rank,
    overridden: false,
    deferred: rest,
  };
}

/* ── §20 Act: what a later correction stores ───────────────────────────────── */

/**
 * §20: "Store every later correction/dismissal/reclassification of the ranked
 * action with prior rank, reason, actor, and time." Three kinds, because §20
 * names three and they mean different things — a dismissal says this was not
 * worth showing, a reclassification says it was the wrong rank, a correction says
 * the record behind it was wrong. §31.9 counts them as the next-action correction
 * rate, so collapsing them into one would destroy the metric.
 */
export const ACT_CORRECTION_KINDS = [
  'correction',
  'dismissal',
  'reclassification',
  'safety_override',
] as const;
export type ActCorrectionKind = (typeof ACT_CORRECTION_KINDS)[number];

/* ── §20 Glance: the copy ──────────────────────────────────────────────────── */

/**
 * §20 states these word for word. They are constants for the same reason
 * Appendix A.1's trust strip and A.5's consent are: a sentence a surface composes
 * inline is a sentence that drifts between two surfaces, and the caught-up
 * ending is a designed done-moment rather than an empty state (DNA §5.4).
 */
export const GLANCE_DELTA_INCREASE = '+[N] since [DATE]';
export const GLANCE_DELTA_NO_CHANGE = 'No change since [DATE]';
export const GLANCE_IDEA_PROGRESS = '[N] to go · ends [LOCAL CLOSE]';
export const GLANCE_PRODUCT_PROGRESS = 'Campaign ends [LOCAL CLOSE]';
export const GLANCE_FRESHNESS = 'Updated [TIME]';
export const ACT_CAUGHT_UP = "You're all caught up. Results land [LOCAL CLOSE].";

/**
 * §20: "Permanent clarification that these people selected an offer and agreed to
 * charge rules but have not yet been charged."
 *
 * Permanent means it is not dismissible and not a tooltip. It is the sentence
 * standing between a Founder reading an active pre-order count and believing it
 * is money they have — §30 bans anything that "confuses a saved card with a
 * charge", and a large number with no qualifier is exactly that confusion.
 */
export const GLANCE_NOT_YET_CHARGED =
  'These people selected an offer and agreed to the charge rules. ' +
  'They have not been charged yet.';

/** §20/§30: freshness is stated as a time. Never as a claim about immediacy. */
export const BANNED_FRESHNESS_TERMS = [
  'real time',
  'real-time',
  'realtime',
  'live data',
  'live count',
  'streaming',
  'up to the second',
  'up-to-the-second',
] as const;

/** Throws if a rendered string still carries a bracketed marker (§7/§8's gate). */
function assertResolved(rendered: string, template: string): string {
  if (/\[[^\]]+\]/.test(rendered)) {
    throw new LiveRuleError(
      `a §20 sentence rendered with an unfilled marker: "${rendered}" (from "${template}")`,
    );
  }
  return rendered;
}

function assertFilled(value: string, what: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new LiveRuleError(`${what} is required to render a §20 sentence`);
  return trimmed;
}

export function resolveCaughtUp(localCloseLabel: string): string {
  return assertResolved(
    ACT_CAUGHT_UP.replace('[LOCAL CLOSE]', assertFilled(localCloseLabel, 'the local close time')),
    ACT_CAUGHT_UP,
  );
}

/**
 * §20's last-visit delta. `delta` of 0 renders the truthful no-change sentence —
 * "+0 since" would be a change that did not happen.
 */
export function resolveDelta(delta: number, sinceLabel: string): string {
  if (!Number.isInteger(delta) || delta < 0) {
    throw new LiveRuleError(`a Glance delta must be a non-negative integer, got ${String(delta)}`);
  }
  const since = assertFilled(sinceLabel, 'the last-visit date');
  return delta === 0
    ? assertResolved(GLANCE_DELTA_NO_CHANGE.replace('[DATE]', since), GLANCE_DELTA_NO_CHANGE)
    : assertResolved(
        GLANCE_DELTA_INCREASE.replace('[N]', String(delta)).replace('[DATE]', since),
        GLANCE_DELTA_INCREASE,
      );
}

/**
 * §20's two progress lines. An Idea campaign counts down to its threshold; a
 * Product campaign has no public funding gate (§14.4) and so states only the
 * close. Passing a threshold for a Product campaign is refused rather than
 * ignored — it would be a public funding gate arriving by accident.
 */
export function resolveProgress(input: {
  model: 'idea' | 'product';
  localCloseLabel: string;
  remainingToThreshold?: number | undefined;
}): string {
  const close = assertFilled(input.localCloseLabel, 'the local close time');
  if (input.model === 'product') {
    if (input.remainingToThreshold !== undefined) {
      throw new LiveRuleError(
        'a Product campaign has no public funding gate (§14.4) — it states no threshold remainder',
      );
    }
    return assertResolved(
      GLANCE_PRODUCT_PROGRESS.replace('[LOCAL CLOSE]', close),
      GLANCE_PRODUCT_PROGRESS,
    );
  }
  const remaining = input.remainingToThreshold;
  if (remaining === undefined || !Number.isInteger(remaining) || remaining < 0) {
    throw new LiveRuleError(
      `an Idea campaign states how many are left to go, got ${String(remaining)}`,
    );
  }
  return assertResolved(
    GLANCE_IDEA_PROGRESS.replace('[N]', String(remaining)).replace('[LOCAL CLOSE]', close),
    GLANCE_IDEA_PROGRESS,
  );
}

export function resolveFreshness(timeLabel: string): string {
  return assertResolved(
    GLANCE_FRESHNESS.replace('[TIME]', assertFilled(timeLabel, 'the freshness time')),
    GLANCE_FRESHNESS,
  );
}

/* ── §20: new, canceled, and net counts ────────────────────────────────────── */

/**
 * §20: "Store new pre-orders, cancellations, and net change separately."
 *
 * `otherExits` is the fourth number and it is not decoration: a reservation can
 * leave the active set without being a cancellation — a kill closes it
 * `killed_no_charge` (§23.5, §26.7). Folding those into cancellations would
 * misreport how many people changed their own minds, and leaving them out
 * entirely would make the identity below fail on any campaign that was ever
 * suspended. §33.6.9 is exactly this identity holding.
 */
export interface PreorderCounts {
  newCount: number;
  canceledCount: number;
  otherExits: number;
  activeCount: number;
  netChange: number;
}

export function reconcileCounts(input: {
  newCount: number;
  canceledCount: number;
  otherExits: number;
  activeCount: number;
}): PreorderCounts {
  for (const [name, value] of Object.entries(input)) {
    if (!Number.isInteger(value) || value < 0) {
      throw new LiveRuleError(`${name} must be a non-negative integer, got ${String(value)}`);
    }
  }
  const netChange = input.newCount - input.canceledCount;
  const expectedActive = input.newCount - input.canceledCount - input.otherExits;
  if (expectedActive !== input.activeCount) {
    throw new LiveRuleError(
      `pre-order counts do not reconcile: ${input.newCount} new − ${input.canceledCount} canceled ` +
        `− ${input.otherExits} other = ${expectedActive}, but ${input.activeCount} are active (§33.6.9)`,
    );
  }
  return { ...input, netChange };
}

/* ── §20: threshold crossings ──────────────────────────────────────────────── */

export const THRESHOLD_STATES = ['reached', 'below'] as const;
export type ThresholdState = (typeof THRESHOLD_STATES)[number];

export const THRESHOLD_CROSSINGS = ['reached', 'lost'] as const;
export type ThresholdCrossing = (typeof THRESHOLD_CROSSINGS)[number];

export function thresholdStateFor(uniqueActiveBackers: number, threshold: number): ThresholdState {
  if (!Number.isInteger(threshold) || threshold < 1) {
    throw new LiveRuleError(`an Idea threshold is a positive integer, got ${String(threshold)}`);
  }
  if (!Number.isInteger(uniqueActiveBackers) || uniqueActiveBackers < 0) {
    throw new LiveRuleError(
      `a unique active Backer count is a non-negative integer, got ${String(uniqueActiveBackers)}`,
    );
  }
  return uniqueActiveBackers >= threshold ? 'reached' : 'below';
}

/**
 * §20: "Each crossing is its own event and notification, deduplicated by state
 * transition."
 *
 * Deduplicated by *transition*, not by day and not by count — so this compares
 * the current state against the last crossing that was actually recorded, and a
 * campaign that crosses up, down, and up again emits three events. Two
 * evaluations with no crossing between them emit nothing, which is what makes
 * calling this on every pre-order and every cancellation safe.
 *
 * A campaign that has never crossed and is below threshold emits nothing: there
 * was no `reached` for it to have lost.
 */
export function crossingFor(
  lastRecorded: ThresholdCrossing | null,
  current: ThresholdState,
): ThresholdCrossing | null {
  if (current === 'reached') return lastRecorded === 'reached' ? null : 'reached';
  return lastRecorded === 'reached' ? 'lost' : null;
}

/* ── §20: milestones ───────────────────────────────────────────────────────── */

/**
 * §20: "First pre-order, halfway, threshold met, and campaign ended may appear
 * once as a milestone then move to history."
 *
 * `halfway` and `threshold_met` are Idea-only. §14.4 gives a Product campaign an
 * *internal* momentum target and states "No public funding gate", so a Product
 * halfway milestone would be a public gate arriving through the back door, and
 * showing the Founder progress against an internal target is not what §20's
 * milestone list is about.
 */
export const MILESTONE_KINDS = [
  'first_preorder',
  'halfway',
  'threshold_met',
  'campaign_ended',
] as const;
export type MilestoneKind = (typeof MILESTONE_KINDS)[number];

export const MILESTONE_LABELS: Readonly<Record<MilestoneKind, string>> = {
  first_preorder: 'Your first pre-order',
  halfway: 'Halfway to your order threshold',
  threshold_met: 'Your order threshold is met',
  campaign_ended: 'Your campaign ended',
};

export function reachedMilestones(input: {
  model: 'idea' | 'product';
  everHadPreorder: boolean;
  uniqueActiveBackers: number;
  threshold?: number | undefined;
  ended: boolean;
}): MilestoneKind[] {
  const reached: MilestoneKind[] = [];
  if (input.everHadPreorder) reached.push('first_preorder');
  if (input.model === 'idea' && input.threshold !== undefined) {
    const state = thresholdStateFor(input.uniqueActiveBackers, input.threshold);
    // Halfway is a fact about having got there, so `threshold met` implies it.
    if (input.uniqueActiveBackers * 2 >= input.threshold) reached.push('halfway');
    if (state === 'reached') reached.push('threshold_met');
  }
  if (input.ended) reached.push('campaign_ended');
  return reached;
}

/* ── §20 Explore: the eleven sections ──────────────────────────────────────── */

/**
 * §20's Explore list, one record per bullet.
 *
 * DNA §5.2: "moving something to Explore is not hiding it" — Explore is a
 * first-class space, so §33.6.8's test is that every one of these is present with
 * its freshness stated. The `definition` field is §20's own last bullet ("Data
 * definitions and freshness") made structural: a number whose definition is not
 * on the page is a number two people will read differently.
 */
export interface ExploreSectionDefinition {
  key: ExploreSectionKey;
  title: string;
  /** §20's last bullet: what this number counts, in the Founder's words. */
  definition: string;
  specRef: string;
}

export const EXPLORE_SECTION_KEYS = [
  'clicks',
  'preorder_counts',
  'reserved_totals',
  'conversion_and_time',
  'creator_results',
  'survey_answers',
  'funnel',
  'attribution_breakdown',
  'comments_and_updates',
  'exports',
  'definitions_and_freshness',
] as const;
export type ExploreSectionKey = (typeof EXPLORE_SECTION_KEYS)[number];

export const EXPLORE_SECTIONS: readonly ExploreSectionDefinition[] = [
  {
    key: 'clicks',
    title: 'Clicks',
    definition:
      'Every recorded click on a Creator tracking link for this campaign, including the ones that earned nothing and the reason each did not.',
    specRef: '§20 Explore 1',
  },
  {
    key: 'preorder_counts',
    title: 'Active, new, and canceled pre-orders',
    definition:
      'New counts every pre-order ever placed, canceled counts every one the Backer ended, and net change is new minus canceled.',
    specRef: '§20 Explore 2',
  },
  {
    key: 'reserved_totals',
    title: 'Reserved totals',
    definition:
      'Pre-tax reserved subtotal, estimated sales tax, and the exact totals Backers authorized. Nothing here has been charged.',
    specRef: '§20 Explore 3',
  },
  {
    key: 'conversion_and_time',
    title: 'Conversion and time remaining',
    definition:
      'Conversion is active pre-orders divided by recorded clicks. Days remaining counts to the close time on your campaign record.',
    specRef: '§20 Explore 4',
  },
  {
    key: 'creator_results',
    title: 'Creator results',
    definition:
      'Each Creator on this campaign, whether their link is activated, and whether their first post was verified.',
    specRef: '§20 Explore 5',
  },
  {
    key: 'survey_answers',
    title: 'Backer answers',
    definition:
      'The demand-survey answers Backers gave, shown only where the Backer consented to share them with you.',
    specRef: '§20 Explore 6',
  },
  {
    key: 'funnel',
    title: 'Funnel and drop-off',
    definition:
      'How many recorded clicks reached a pre-order, and where the rest stopped.',
    specRef: '§20 Explore 7',
  },
  {
    key: 'attribution_breakdown',
    title: 'Where pre-orders came from',
    definition:
      'Direct, organic, Proovd-house, and Creator-attributed pre-orders, decided by the attribution recorded at the time of each pre-order.',
    specRef: '§20 Explore 8',
  },
  {
    key: 'comments_and_updates',
    title: 'Comments and updates',
    definition: 'The updates you have posted and the comments on this campaign.',
    specRef: '§20 Explore 9',
  },
  {
    key: 'exports',
    title: 'Exports',
    definition:
      'What you may download, and which columns are withheld from it before you press the button.',
    specRef: '§20 Explore 10',
  },
  {
    key: 'definitions_and_freshness',
    title: 'Definitions and freshness',
    definition:
      'What every number on this page counts, and the time the page last read them. This page refreshes when you load it.',
    specRef: '§20 Explore 11',
  },
] as const;

/**
 * §20 Explore 8's four sources. `house` is Proovd's own promotion, which §18
 * distinguishes from organic discovery — collapsing them would make the Day 8
 * switch unreadable in the numbers.
 */
export const ATTRIBUTION_BREAKDOWN_SOURCES = ['direct', 'organic', 'house', 'creator'] as const;
export type AttributionBreakdownSource = (typeof ATTRIBUTION_BREAKDOWN_SOURCES)[number];
