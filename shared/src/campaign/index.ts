/**
 * Campaign building, roster readiness, and materiality — Spec §14.4, §15
 * (Phase 12b).
 *
 * The pure logic: which §14.4 ingredients a complete build requires, the
 * six-rule §15 launch-readiness decision as a function over a snapshot, and the
 * materiality vocabulary. The backend gathers the snapshots and persists; these
 * functions decide, so §33.3.9/10 and §33.4.2 are assertable as facts rather
 * than as a simulated network — the same arrangement as `decideItems` (§12).
 */

import type { CampaignType } from '../money/compensation.js';

/* ── §14.4: the required build ingredients ─────────────────────────────────── */

/**
 * The shared ingredients §14.4 requires on every campaign, whatever the type.
 * A field is "required" when its absence should hold `campaign_build_status`
 * below `complete`. Reward packages and (per type) the type-specific fields are
 * checked separately.
 */
export const REQUIRED_SHARED_BUILD_FIELDS = [
  'title',
  'founderDisplayName',
  'founderCountry',
  'founderProfileUrl',
  'opensAt',
  'closesAt',
  'brandPerception',
  'brandVoice',
  'heroPreference',
  'publicStory',
] as const;

/** §14.4 Idea-specific required fields. */
export const REQUIRED_IDEA_BUILD_FIELDS = [
  'orderThreshold',
  'deliveryWindow',
  'earlyProductDisclaimer',
  'risksAndChallenges',
] as const;

/**
 * §14.4 Product-specific required fields. The refund policy is required as
 * either exact operative text OR an immutable snapshot (title + source URL +
 * version + effective date) — `buildComplete` checks that disjunction, not a
 * single column.
 */
export const REQUIRED_PRODUCT_BUILD_FIELDS = ['internalTargetCents'] as const;

/** §14.4: the internal momentum target ceiling, in cents (US$50,000, pre-tax). */
export const INTERNAL_TARGET_CAP_CENTS = 5_000_000n;

// §14.4's "default 14-day duration" is already `PRODUCT_DEFAULT_DURATION_DAYS`
// in `money/constants`; the build reads that one rather than declaring a second.

/** Every field a build save may carry a value for. */
export type BuildFieldValue = string | number | bigint | Date | null | undefined;

export interface BuildSnapshot {
  campaignType: CampaignType;
  /** Present-or-absent for each shared/type field, keyed by the names above. */
  fields: Record<string, BuildFieldValue>;
  /** How many reward packages exist. §14.4 requires at least one. */
  rewardPackageCount: number;
  /** Whether the Product refund policy is present in either allowed shape. */
  refundPolicyPresent: boolean;
}

function present(value: BuildFieldValue): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

/**
 * The list of §14.4 ingredients still missing from a build. Empty means the
 * build is complete; `campaign_build_status` is `complete` exactly then,
 * `in_progress` while some (but not all) are present, `not_started` while none
 * are. The server never lets a Founder set the status directly.
 */
export function missingBuildFields(snapshot: BuildSnapshot): string[] {
  const missing: string[] = [];
  for (const key of REQUIRED_SHARED_BUILD_FIELDS) {
    if (!present(snapshot.fields[key])) missing.push(key);
  }
  const typeFields =
    snapshot.campaignType === 'pre_build'
      ? REQUIRED_IDEA_BUILD_FIELDS
      : REQUIRED_PRODUCT_BUILD_FIELDS;
  for (const key of typeFields) {
    if (!present(snapshot.fields[key])) missing.push(key);
  }
  if (snapshot.rewardPackageCount < 1) missing.push('rewardPackages');
  if (snapshot.campaignType === 'pre_launch' && !snapshot.refundPolicyPresent) {
    missing.push('refundPolicy');
  }
  return missing;
}

export type BuildStatus = 'not_started' | 'in_progress' | 'complete';

/** The derived build status for a snapshot (§23.2). */
export function deriveBuildStatus(snapshot: BuildSnapshot): BuildStatus {
  const missing = missingBuildFields(snapshot);
  if (missing.length === 0) return 'complete';
  // Any field present at all (or a reward package) means the build has started.
  const anyPresent =
    snapshot.rewardPackageCount > 0 ||
    Object.values(snapshot.fields).some((v) => present(v));
  return anyPresent ? 'in_progress' : 'not_started';
}

/* ── §15: the six-rule launch readiness ────────────────────────────────────── */

/**
 * One recruited Creator, as the readiness decision sees them. The backend fills
 * this from the association, its agreement, its open proposal versions, its
 * disclosure/tracking/readiness records, and the Admin roster decision.
 */
export interface RosterCandidate {
  associationId: string;
  /** Admin's §15 rule-2/5 closure: has a decision been recorded for them? */
  rosterDecision: 'pending' | 'included' | 'excluded';
  /** §15 rule 5: is this Creator required for planned launch? */
  launchRequired: boolean;
  /** §15 rule 3: have they accepted a locked compensation version? */
  hasLockedAgreement: boolean;
  /** §15 rule 4: any bid/fixed/revision still awaiting a response? */
  hasOpenProposal: boolean;
  /** §15 rule 6: disclosure + tracking + readiness records all present? */
  recordsComplete: boolean;
  /** §15 materiality: a material change awaiting this Creator's reacceptance. */
  reacceptancePending: boolean;
}

export interface RosterReadinessSnapshot {
  /** §15 rule 2: has Admin marked the final initial launch roster? */
  initialRosterFinalized: boolean;
  candidates: readonly RosterCandidate[];
}

export interface RosterReadinessResult {
  ready: boolean;
  /** The rules that are not satisfied, by number, for the surface to explain. */
  unmetRules: number[];
  /** The included, launch-relevant roster the decision was made over. */
  finalRosterAssociationIds: string[];
}

/**
 * §15's six rules, exactly. `launch_ready` only when ALL hold; a
 * declined/removed/non-required Creator (`excluded`, or `included` but not
 * required) does not block once Admin has recorded the decision — §33.3.9.
 *
 * The rule numbers match §15's list so an unmet rule reads back to the Spec.
 */
export function deriveRosterReadiness(
  snapshot: RosterReadinessSnapshot,
): RosterReadinessResult {
  const unmet = new Set<number>();

  // The final roster is the set Admin included.
  const included = snapshot.candidates.filter((c) => c.rosterDecision === 'included');

  // Rule 1: at least one Creator accepted.
  const accepted = snapshot.candidates.filter((c) => c.hasLockedAgreement);
  if (accepted.length < 1) unmet.add(1);

  // Rule 2: Admin marked the final initial launch roster.
  if (!snapshot.initialRosterFinalized) unmet.add(2);

  // Rule 3: every Creator on that roster accepted the final compensation version.
  if (included.some((c) => !c.hasLockedAgreement)) unmet.add(3);

  // Rule 4: every bid/fixed/revision for a rostered Creator is mutually accepted
  // or closed — i.e. no open proposal for anyone on the roster.
  if (included.some((c) => c.hasOpenProposal)) unmet.add(4);

  // Rule 5: no pending Creator is required for planned launch. A required
  // Creator that is unresolved (undecided, not accepted, has an open proposal,
  // or owes a reacceptance) blocks.
  const requiredBlocks = snapshot.candidates.some(
    (c) =>
      c.launchRequired &&
      (c.rosterDecision === 'pending' ||
        !c.hasLockedAgreement ||
        c.hasOpenProposal ||
        c.reacceptancePending),
  );
  if (requiredBlocks) unmet.add(5);

  // Rule 6: agreement, disclosure, tracking, and readiness records exist for
  // every rostered Creator — and no rostered Creator owes a reacceptance
  // (a material change invalidated their readiness, §15).
  if (
    included.some(
      (c) => !c.hasLockedAgreement || !c.recordsComplete || c.reacceptancePending,
    )
  ) {
    unmet.add(6);
  }

  return {
    ready: unmet.size === 0,
    unmetRules: [...unmet].sort((a, b) => a - b),
    finalRosterAssociationIds: included.map((c) => c.associationId),
  };
}

/* ── §15: materiality ──────────────────────────────────────────────────────── */

export type MaterialityClass = 'non_material' | 'material';

/**
 * §15's own two definitions, as data. A change is MATERIAL to Creator terms
 * when it touches any of these dimensions; otherwise it is non-material and
 * preserves Creator readiness. The classification itself is an Admin judgement
 * recorded with its reason (§15) — this list is what the surface offers and
 * what the audit explains, never an automated classifier (§1 rule 6).
 */
export const MATERIAL_DIMENSIONS = [
  'compensation',
  'required_work',
  'dates',
  'rewards_or_prices',
  'approved_claims',
  'delivery_promises',
  'refund_terms',
  'channel_rules',
  'fixed_payment_conditions',
] as const;

export const NON_MATERIAL_DIMENSIONS = [
  'spelling',
  'formatting',
  'accessibility_text',
  'wording_no_meaning_change',
] as const;

export type MaterialDimension = (typeof MATERIAL_DIMENSIONS)[number];
export type NonMaterialDimension = (typeof NON_MATERIAL_DIMENSIONS)[number];

/** §15's two feedback groups, exact labels the surface renders. */
export const FEEDBACK_GROUP_LABELS = {
  required: 'Required before resubmission',
  optional: 'Optional improvements',
} as const;
