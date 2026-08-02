/**
 * Admin's view of the two parallel tracks — Spec §14 "Admin", §14.2, §26.
 *
 * "Admin sees both parallel tracks, the exact deadline, every proposal
 * version, recruitment status, campaign completeness, high-effort rules,
 * compensation ceiling, and any overdue customer update."
 *
 * The one write here is mediation's reject (§14.2). There is deliberately no
 * accept route: Admin cannot substitute for either party's acceptance, and the
 * absence of the route is the enforcement — the same posture as the missing
 * bank-field routes in Phase 10b.
 */

import { Router, type RequestHandler } from 'express';
import express from 'express';
import { desc, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import type { Auth } from '../auth/auth.js';
import { requireAdmin, requireFreshSession } from '../auth/guards.js';
import type { AuditWriter } from '../auth/audit.js';
import { readAdminReauthWindowSeconds } from '../settings/service.js';
import { campaigns, campaignAffiliateAssociations } from '../db/schema/domain.js';
import {
  proposalVersions,
  associationCompensationAgreements,
  responseDeadlineEvaluations,
  creatorBonuses,
} from '../db/schema/decisions.js';
import { listingFeePayments } from '../db/schema/listing.js';
import { affiliateProspects } from '../db/schema/affiliates.js';
import { adminRejectVersion, readCompensationSettings } from '../affiliates/decisions.js';

export interface AdminDecisionDeps {
  db: Database;
  auth: Auth;
  audit: AuditWriter;
}

export function createAdminDecisionRouter(deps: AdminDecisionDeps): Router {
  const { db, auth, audit } = deps;
  const router = Router();
  const admin = requireAdmin(auth);
  const fresh = requireFreshSession(auth, () => readAdminReauthWindowSeconds(db));
  const json: RequestHandler = express.json({ limit: '32kb' });

  router.get('/api/admin/campaigns/:campaignId/decisions', admin, async (req, res) => {
    const campaignId = req.params['campaignId'] as string;

    const [campaign] = await db
      .select({
        id: campaigns.id,
        status: campaigns.status,
        type: campaigns.type,
        highEffort: campaigns.highEffort,
        affiliateRosterStatus: campaigns.affiliateRosterStatus,
        campaignBuildStatus: campaigns.campaignBuildStatus,
      })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1);
    if (!campaign) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    const [payment] = await db
      .select({
        responseDeadlineAt: listingFeePayments.responseDeadlineAt,
        paidAt: listingFeePayments.paidAt,
      })
      .from(listingFeePayments)
      .where(eq(listingFeePayments.campaignId, campaignId))
      .limit(1);

    const associations = await db
      .select({
        associationId: campaignAffiliateAssociations.id,
        status: campaignAffiliateAssociations.status,
        formalOpenedAt: campaignAffiliateAssociations.formalOpenedAt,
        declinedAt: campaignAffiliateAssociations.declinedAt,
        declineReason: campaignAffiliateAssociations.declineReason,
        handle: affiliateProspects.publicHandle,
      })
      .from(campaignAffiliateAssociations)
      .leftJoin(affiliateProspects, eq(campaignAffiliateAssociations.prospectId, affiliateProspects.id))
      .where(eq(campaignAffiliateAssociations.campaignId, campaignId));

    const versions = await db
      .select()
      .from(proposalVersions)
      .where(eq(proposalVersions.campaignId, campaignId))
      .orderBy(proposalVersions.associationId, proposalVersions.versionNumber);

    const agreements = await db
      .select()
      .from(associationCompensationAgreements)
      .where(eq(associationCompensationAgreements.campaignId, campaignId));

    const bonuses = await db
      .select()
      .from(creatorBonuses)
      .where(eq(creatorBonuses.campaignId, campaignId));

    const [evaluation] = await db
      .select()
      .from(responseDeadlineEvaluations)
      .where(eq(responseDeadlineEvaluations.campaignId, campaignId))
      .orderBy(desc(responseDeadlineEvaluations.evaluatedAt))
      .limit(1);

    const settings = await readCompensationSettings(db).catch(() => null);

    res.json({
      decisions: {
        campaign: {
          status: campaign.status,
          type: campaign.type,
          highEffort: campaign.highEffort,
          affiliateRosterStatus: campaign.affiliateRosterStatus,
          campaignBuildStatus: campaign.campaignBuildStatus,
        },
        deadline: payment
          ? { paidAt: payment.paidAt.toISOString(), responseDeadlineAt: payment.responseDeadlineAt.toISOString() }
          : null,
        ceilingPercent: settings?.ceilingPercent ?? null,
        associations: associations.map((a) => ({
          associationId: a.associationId,
          handle: a.handle,
          status: a.status,
          formalOpenedAt: a.formalOpenedAt?.toISOString() ?? null,
          declinedAt: a.declinedAt?.toISOString() ?? null,
          declineReason: a.declineReason,
        })),
        versions: versions.map((v) => ({
          id: v.id,
          associationId: v.associationId,
          versionNumber: v.versionNumber,
          proposedBy: v.proposedBy,
          bidTotalPercent: v.bidTotalPercent,
          fixedPaymentRequestCents: v.fixedPaymentRequestCents?.toString() ?? null,
          state: v.state,
          affiliateDecision: v.affiliateDecision,
          affiliateDecidedAt: v.affiliateDecidedAt?.toISOString() ?? null,
          founderDecision: v.founderDecision,
          founderDecidedAt: v.founderDecidedAt?.toISOString() ?? null,
          supersededByVersionId: v.supersededByVersionId,
          lockedAt: v.lockedAt?.toISOString() ?? null,
        })),
        agreements: agreements.map((a) => ({
          associationId: a.associationId,
          source: a.source,
          basePercent: a.basePercent,
          bidIncreasePercent: a.bidIncreasePercent,
          totalPercent: a.totalPercent,
          fixedPaymentCents: a.fixedPaymentCents?.toString() ?? null,
        })),
        bonuses: bonuses.map((b) => ({
          associationId: b.associationId,
          triggerUnit: b.triggerUnit,
          threshold: b.threshold.toString(),
          additionalPercent: b.additionalPercent,
          maxCombinedPercent: b.maxCombinedPercent,
        })),
        deadlineEvaluation: evaluation
          ? {
              outcome: evaluation.outcome,
              evaluatedAt: evaluation.evaluatedAt.toISOString(),
              lockedAcceptanceCount: evaluation.lockedAcceptanceCount,
              expiredAssociationCount: evaluation.expiredAssociationCount,
              refundId: evaluation.refundId,
            }
          : null,
      },
    });
  });

  /* §14.2: mediation's one write. Rejection, never acceptance. */
  router.post('/api/admin/proposals/:versionId/reject', admin, fresh, json, async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const internalReason = typeof body['internalReason'] === 'string' ? body['internalReason'].trim() : '';
    const customerExplanation =
      typeof body['customerExplanation'] === 'string' ? body['customerExplanation'].trim() : '';
    if (!internalReason || !customerExplanation) {
      res.status(422).json({
        error: 'reason_required',
        whatHappened: 'A rejection records an internal reason and a customer-facing explanation (§25.6).',
      });
      return;
    }

    const result = await adminRejectVersion(db, { audit }, {
      versionId: req.params['versionId'] as string,
      actor: `admin:${req.authUser?.id ?? ''}`,
      internalReason,
      customerExplanation,
    });
    if (!result.ok) {
      res.status(result.code === 'not_found' ? 404 : 409).json({
        error: result.code,
        whatHappened: result.message,
        next: result.next,
      });
      return;
    }
    res.json({ rejected: { versionId: result.version.id, state: result.version.state } });
  });

  return router;
}
