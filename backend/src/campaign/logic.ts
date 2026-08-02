/**
 * The §14.4/§15 pure decision logic, restated for the backend runtime.
 *
 * `shared/src/build/index.ts` is the register and the reference: the frontend
 * imports it through Vite, and `src/tests/campaign-build.test.ts` drift-tests
 * this against it. The backend cannot import `@proovd/shared` at runtime
 * (rootDir; the production image ships only `backend/dist`), so the build
 * completeness and the six-rule roster readiness are restated here — the same
 * arrangement `db/schema/domain.ts`, `notifications/events.ts`, and
 * `affiliates/roster-labels.ts` document.
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

export const REQUIRED_IDEA_BUILD_FIELDS = [
  'orderThreshold',
  'deliveryWindow',
  'earlyProductDisclaimer',
  'risksAndChallenges',
] as const;

export const REQUIRED_PRODUCT_BUILD_FIELDS = ['internalTargetCents'] as const;

export const INTERNAL_TARGET_CAP_CENTS = 5_000_000n;

export type BuildFieldValue = string | number | bigint | Date | null | undefined;

export interface BuildSnapshot {
  campaignType: 'pre_build' | 'pre_launch';
  fields: Record<string, BuildFieldValue>;
  rewardPackageCount: number;
  refundPolicyPresent: boolean;
}

function present(value: BuildFieldValue): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

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

export function deriveBuildStatus(snapshot: BuildSnapshot): BuildStatus {
  const missing = missingBuildFields(snapshot);
  if (missing.length === 0) return 'complete';
  const anyPresent =
    snapshot.rewardPackageCount > 0 || Object.values(snapshot.fields).some((v) => present(v));
  return anyPresent ? 'in_progress' : 'not_started';
}

/* ── §15 roster readiness ──────────────────────────────────────────────────── */

export interface RosterCandidate {
  associationId: string;
  rosterDecision: 'pending' | 'included' | 'excluded';
  launchRequired: boolean;
  hasLockedAgreement: boolean;
  hasOpenProposal: boolean;
  recordsComplete: boolean;
  reacceptancePending: boolean;
}

export interface RosterReadinessSnapshot {
  initialRosterFinalized: boolean;
  candidates: readonly RosterCandidate[];
}

export interface RosterReadinessResult {
  ready: boolean;
  unmetRules: number[];
  finalRosterAssociationIds: string[];
}

export function deriveRosterReadiness(snapshot: RosterReadinessSnapshot): RosterReadinessResult {
  const unmet = new Set<number>();
  const included = snapshot.candidates.filter((c) => c.rosterDecision === 'included');

  if (snapshot.candidates.filter((c) => c.hasLockedAgreement).length < 1) unmet.add(1);
  if (!snapshot.initialRosterFinalized) unmet.add(2);
  if (included.some((c) => !c.hasLockedAgreement)) unmet.add(3);
  if (included.some((c) => c.hasOpenProposal)) unmet.add(4);

  const requiredBlocks = snapshot.candidates.some(
    (c) =>
      c.launchRequired &&
      (c.rosterDecision === 'pending' ||
        !c.hasLockedAgreement ||
        c.hasOpenProposal ||
        c.reacceptancePending),
  );
  if (requiredBlocks) unmet.add(5);

  if (included.some((c) => !c.hasLockedAgreement || !c.recordsComplete || c.reacceptancePending)) {
    unmet.add(6);
  }

  return {
    ready: unmet.size === 0,
    unmetRules: [...unmet].sort((a, b) => a - b),
    finalRosterAssociationIds: included.map((c) => c.associationId),
  };
}

/* ── §23.2 review readiness ────────────────────────────────────────────────── */

/** §23.2: derived, never stored. True only for launch_ready + complete. */
export function deriveReviewReady(
  rosterStatus: 'forming' | 'launch_ready' | 'failed',
  buildStatus: BuildStatus,
): boolean {
  return rosterStatus === 'launch_ready' && buildStatus === 'complete';
}
