/**
 * The §15 six-rule initial-roster readiness — Spec §15, §23.2, §33.3.9,
 * §33.3.10.
 *
 * `affiliate_roster_status = launch_ready` only when all six §15 rules hold.
 * The decision itself is the pure `deriveRosterReadiness` (shared); this module
 * gathers the snapshot it decides over and mirrors the result onto the campaign
 * — never storing `launch_ready` as a truth that could drift from its inputs
 * (§33.3.10's rule about `review_ready`, applied one level down).
 *
 * ── `failed` is never overwritten ───────────────────────────────────────────
 * §14.6's deadline evaluation sets `affiliate_roster_status = failed` and
 * §14.6 forbids a late response reviving it. So this evaluation moves the
 * status between `forming` and `launch_ready` only; a `failed` roster stays
 * failed, and a readiness recompute on it is a no-op.
 */

import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns, campaignAffiliateAssociations } from '../db/schema/domain.js';
import {
  campaignReadiness,
  associationReadiness,
  type AssociationReadiness,
} from '../db/schema/build.js';
import {
  associationCompensationAgreements,
  associationAcceptanceConfirmations,
  trackingLinks,
  proposalVersions,
} from '../db/schema/decisions.js';
import { materialChangeReacceptances } from '../db/schema/build.js';
import {
  deriveRosterReadiness,
  type RosterReadinessResult,
  type RosterCandidate,
} from './logic.js';
import type { AuditWriter } from '../auth/audit.js';

type Executor = Pick<Database, 'select' | 'insert' | 'update' | 'execute'>;

/* ── Gathering the snapshot ────────────────────────────────────────────────── */

/** Every recruited Creator on a campaign, as the §15 decision sees them. */
export async function gatherRosterCandidates(
  db: Executor,
  campaignId: string,
): Promise<RosterCandidate[]> {
  const associations = await db
    .select({
      associationId: campaignAffiliateAssociations.id,
      status: campaignAffiliateAssociations.status,
    })
    .from(campaignAffiliateAssociations)
    .where(eq(campaignAffiliateAssociations.campaignId, campaignId));

  const ids = associations.map((a) => a.associationId);
  if (ids.length === 0) return [];

  const agreements = await db
    .select({ associationId: associationCompensationAgreements.associationId })
    .from(associationCompensationAgreements)
    .where(inArray(associationCompensationAgreements.associationId, ids));
  const hasAgreement = new Set(agreements.map((a) => a.associationId));

  const openVersions = await db
    .select({ associationId: proposalVersions.associationId })
    .from(proposalVersions)
    .where(
      and(
        inArray(proposalVersions.associationId, ids),
        inArray(proposalVersions.state, ['awaiting_founder', 'awaiting_creator']),
      ),
    );
  const hasOpen = new Set(openVersions.map((v) => v.associationId));

  const disclosures = await db
    .select({ associationId: associationAcceptanceConfirmations.associationId })
    .from(associationAcceptanceConfirmations)
    .where(inArray(associationAcceptanceConfirmations.associationId, ids));
  const hasDisclosure = new Set(disclosures.map((d) => d.associationId));

  const links = await db
    .select({ associationId: trackingLinks.associationId })
    .from(trackingLinks)
    .where(inArray(trackingLinks.associationId, ids));
  const hasTracking = new Set(links.map((l) => l.associationId));

  const readinessRows = await db
    .select()
    .from(associationReadiness)
    .where(inArray(associationReadiness.associationId, ids));
  const readinessByAssociation = new Map<string, AssociationReadiness>(
    readinessRows.map((r) => [r.associationId, r]),
  );

  const pendingReacc = await db
    .select({ associationId: materialChangeReacceptances.associationId })
    .from(materialChangeReacceptances)
    .where(
      and(
        inArray(materialChangeReacceptances.associationId, ids),
        eq(materialChangeReacceptances.decision, 'pending'),
      ),
    );
  const hasPendingReacc = new Set(pendingReacc.map((r) => r.associationId));

  return associations.map((a) => {
    const readiness = readinessByAssociation.get(a.associationId);
    const recordsComplete =
      hasAgreement.has(a.associationId) &&
      hasDisclosure.has(a.associationId) &&
      hasTracking.has(a.associationId) &&
      readiness?.readinessConfirmedAt != null;
    return {
      associationId: a.associationId,
      rosterDecision: readiness?.rosterDecision ?? 'pending',
      launchRequired: readiness?.launchRequired ?? false,
      hasLockedAgreement: hasAgreement.has(a.associationId),
      hasOpenProposal: hasOpen.has(a.associationId),
      recordsComplete,
      reacceptancePending:
        hasPendingReacc.has(a.associationId) || (readiness?.reacceptanceRequired ?? false),
    } satisfies RosterCandidate;
  });
}

/* ── Evaluation ────────────────────────────────────────────────────────────── */

export interface RosterReadinessReport extends RosterReadinessResult {
  rosterStatus: 'forming' | 'launch_ready' | 'failed';
  candidates: RosterCandidate[];
}

/**
 * Re-derives readiness and mirrors it onto `affiliate_roster_status`. Returns
 * the report the surface renders. A `failed` roster is left untouched (§14.6).
 */
export async function evaluateRosterReadiness(
  db: Database,
  campaignId: string,
): Promise<RosterReadinessReport> {
  return db.transaction(async (tx) => {
    const [campaign] = await tx
      .select({ status: campaigns.affiliateRosterStatus })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .for('update')
      .limit(1);

    const [readiness] = await tx
      .select({ finalizedAt: campaignReadiness.initialRosterFinalizedAt })
      .from(campaignReadiness)
      .where(eq(campaignReadiness.campaignId, campaignId))
      .limit(1);

    const candidates = await gatherRosterCandidates(tx, campaignId);
    const result = deriveRosterReadiness({
      initialRosterFinalized: readiness?.finalizedAt != null,
      candidates,
    });

    // §14.6: a failed roster is never revived by a readiness recompute.
    if (campaign?.status === 'failed') {
      return { ...result, rosterStatus: 'failed', candidates };
    }

    const next: 'forming' | 'launch_ready' = result.ready ? 'launch_ready' : 'forming';
    if (campaign && campaign.status !== next) {
      await tx
        .update(campaigns)
        .set({ affiliateRosterStatus: next, updatedAt: new Date() })
        .where(eq(campaigns.id, campaignId));
    }

    return { ...result, rosterStatus: next, candidates };
  });
}

/* ── Admin actions (§15 rules 2, 5, 6) ─────────────────────────────────────── */

/** §15 rule 2: Admin marks the final initial launch roster for the campaign. */
export async function finalizeInitialRoster(
  db: Database,
  deps: { audit: AuditWriter },
  input: { campaignId: string; actor: string },
): Promise<RosterReadinessReport> {
  await db
    .insert(campaignReadiness)
    .values({
      campaignId: input.campaignId,
      initialRosterFinalizedAt: new Date(),
      initialRosterFinalizedBy: input.actor,
    })
    .onConflictDoUpdate({
      target: campaignReadiness.campaignId,
      set: {
        initialRosterFinalizedAt: new Date(),
        initialRosterFinalizedBy: input.actor,
        updatedAt: new Date(),
      },
    });

  await deps.audit({
    action: 'roster.initial_finalized',
    targetType: 'campaign',
    targetId: input.campaignId,
    internalReason: 'Admin marked the final initial launch roster (§15 rule 2)',
    actorId: input.actor,
  });

  return evaluateRosterReadiness(db, input.campaignId);
}

/**
 * §15 rules 5 & 6: Admin records a per-Creator roster decision — whether the
 * Creator is on the final roster, whether they are required for launch, and
 * whether their agreement/disclosure/tracking readiness is confirmed. A
 * declined/removed/non-required Creator recorded as `excluded` stops blocking
 * readiness (§33.3.9).
 */
export async function recordAssociationRosterDecision(
  db: Database,
  deps: { audit: AuditWriter },
  input: {
    campaignId: string;
    associationId: string;
    rosterDecision: 'included' | 'excluded';
    launchRequired: boolean;
    readinessConfirmed: boolean;
    actor: string;
  },
): Promise<RosterReadinessReport> {
  const now = new Date();
  await db
    .insert(associationReadiness)
    .values({
      associationId: input.associationId,
      campaignId: input.campaignId,
      rosterDecision: input.rosterDecision,
      launchRequired: input.launchRequired,
      readinessConfirmedAt: input.readinessConfirmed ? now : null,
      decidedBy: input.actor,
      decidedAt: now,
    })
    .onConflictDoUpdate({
      target: associationReadiness.associationId,
      set: {
        rosterDecision: input.rosterDecision,
        launchRequired: input.launchRequired,
        readinessConfirmedAt: input.readinessConfirmed ? now : null,
        decidedBy: input.actor,
        decidedAt: now,
        updatedAt: now,
      },
    });

  await deps.audit({
    action: 'roster.association_decision',
    targetType: 'campaign_affiliate_association',
    targetId: input.associationId,
    internalReason:
      `Admin roster decision: ${input.rosterDecision}, ` +
      `${input.launchRequired ? 'required' : 'not required'} for launch, ` +
      `readiness ${input.readinessConfirmed ? 'confirmed' : 'not confirmed'} (§15)`,
    actorId: input.actor,
  });

  return evaluateRosterReadiness(db, input.campaignId);
}

/** The readiness row for one association, or null. */
export async function findAssociationReadiness(
  db: Executor,
  associationId: string,
): Promise<AssociationReadiness | null> {
  const [row] = await db
    .select()
    .from(associationReadiness)
    .where(eq(associationReadiness.associationId, associationId))
    .limit(1);
  return row ?? null;
}
