/**
 * The Founder's roster view during the 72-hour clock, and the Founder's side
 * of the proposal flow — Spec §14.5, §14.2, §14.3, §33.2.9, §33.2.10.
 *
 * ── The §11 authorization boundary, restated ────────────────────────────────
 * The card projection never SELECTS the Creator's email, phone, legal name,
 * quality tier, verification evidence, or internal comments — Phase 08a's
 * boundary, unchanged. §14.5's card is handle, channel type, audience metric,
 * niche, short bio, status in the §14.5 vocabulary, the exact deadline, the
 * full-refund outcome, and the pending-proposal note. Proovd owns recruitment
 * follow-up; there is no contact route and no general pool to browse.
 */

import { Router, type RequestHandler } from 'express';
import express from 'express';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { notifyMidCampaignAccepted } from '../affiliates/mid-campaign-notifications.js';
import { notifyProposalAwaitingResponse } from '../notifications/internal-queue.js';
import type { Auth } from '../auth/auth.js';
import { requireRole } from '../auth/guards.js';
import type { AuditWriter } from '../auth/audit.js';
import type { Notifier } from '../notifications/send.js';
import { campaigns, campaignAffiliateAssociations } from '../db/schema/domain.js';
import { affiliateProspects } from '../db/schema/affiliates.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { listingFeePayments } from '../db/schema/listing.js';
import { proposalVersions, associationCompensationAgreements } from '../db/schema/decisions.js';
import {
  respondToProposal,
  offerCreatorBonus,
  type Refused,
} from '../affiliates/decisions.js';
import {
  notifyStandardAcceptance,
  notifyVersionDecision,
  notifyFounderRevision,
  type DecisionNotificationContext,
} from '../affiliates/decision-notifications.js';
import {
  FOUNDER_ROSTER_STATUS_LABELS,
  FIXED_PAYMENT_REQUESTED_LABEL,
  PENDING_PROPOSAL_NOTE,
} from '../affiliates/roster-labels.js';
import { LISTING_REFUND_PROMISE } from '../notifications/templates/listing-fee.js';

export interface FounderRosterDeps {
  db: Database;
  auth: Auth;
  audit: AuditWriter;
  notifier: Notifier;
  context: DecisionNotificationContext;
  /** Phase 22b: §27.6's mid-campaign notice. Unset → it does not send. */
  internalRecipient?: string | undefined;
}

const REFUSAL_STATUS: Record<Refused['code'], number> = {
  not_found: 404,
  not_open: 409,
  deadline_passed: 409,
  confirmations_incomplete: 422,
  policies_unpublished: 409,
  already_accepted: 409,
  proposal_already_open: 409,
  invalid_terms: 422,
  stale_version: 409,
};

function sendRefusal(res: express.Response, refused: Refused): void {
  res.status(REFUSAL_STATUS[refused.code]).json({
    error: refused.code,
    whatHappened: refused.message,
    next: refused.next,
    ...(refused.missing ? { missing: refused.missing } : {}),
  });
}

export function createFounderRosterRouter(deps: FounderRosterDeps): Router {
  const { db, auth, audit, notifier, context } = deps;

  /** §20's mid-campaign notices. See `creator-decisions.ts` for the shape. */
  const midNotify = {
    db,
    notifier,
    context,
    ...(deps.internalRecipient ? { internalRecipient: deps.internalRecipient } : {}),
  };
  const router = Router();
  const founder = requireRole(auth, 'founder');
  const json: RequestHandler = express.json({ limit: '32kb' });

  const userId = (req: express.Request): string => req.authUser?.id ?? '';

  /** The caller's own campaign, or null — §11's boundary in the query. */
  async function ownCampaign(campaignId: string, founderUserId: string) {
    const [row] = await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .innerJoin(founderClaimProfiles, eq(founderClaimProfiles.campaignId, campaigns.id))
      .where(and(eq(campaigns.id, campaignId), eq(founderClaimProfiles.claimedUserId, founderUserId)))
      .limit(1);
    return row ?? null;
  }

  /* ── §14.5: the roster view ─────────────────────────────────────────────── */

  router.get('/api/founder/campaigns/:campaignId/roster', founder, async (req, res) => {
    const campaignId = req.params['campaignId'] as string;
    const own = await ownCampaign(campaignId, userId(req));
    if (!own) {
      res.status(404).json({ error: 'not_found', whatHappened: 'That campaign could not be found.' });
      return;
    }

    const [payment] = await db
      .select({ responseDeadlineAt: listingFeePayments.responseDeadlineAt })
      .from(listingFeePayments)
      .where(eq(listingFeePayments.campaignId, campaignId))
      .limit(1);

    const rows = await db
      .select({
        associationId: campaignAffiliateAssociations.id,
        status: campaignAffiliateAssociations.status,
        publicHandle: affiliateProspects.publicHandle,
        subtype: affiliateProspects.subtype,
        audienceNiche: affiliateProspects.audienceNiche,
        audienceSize: affiliateProspects.audienceSize,
        adminBio: affiliateProspects.adminBio,
      })
      .from(campaignAffiliateAssociations)
      .innerJoin(affiliateProspects, eq(campaignAffiliateAssociations.prospectId, affiliateProspects.id))
      .where(eq(campaignAffiliateAssociations.campaignId, campaignId))
      .orderBy(desc(campaignAffiliateAssociations.createdAt));

    const associationIds = rows.map((r) => r.associationId);
    const openVersions = associationIds.length
      ? await db
          .select({
            associationId: proposalVersions.associationId,
            bidTotalPercent: proposalVersions.bidTotalPercent,
            fixedPaymentRequestCents: proposalVersions.fixedPaymentRequestCents,
            versionNumber: proposalVersions.versionNumber,
            id: proposalVersions.id,
            state: proposalVersions.state,
          })
          .from(proposalVersions)
          .where(
            and(
              inArray(proposalVersions.associationId, associationIds),
              inArray(proposalVersions.state, ['awaiting_founder', 'awaiting_creator']),
            ),
          )
      : [];
    const openByAssociation = new Map(openVersions.map((v) => [v.associationId, v]));

    const agreements = associationIds.length
      ? await db
          .select({
            associationId: associationCompensationAgreements.associationId,
            totalPercent: associationCompensationAgreements.totalPercent,
            fixedPaymentCents: associationCompensationAgreements.fixedPaymentCents,
          })
          .from(associationCompensationAgreements)
          .where(inArray(associationCompensationAgreements.associationId, associationIds))
      : [];
    const agreementByAssociation = new Map(agreements.map((a) => [a.associationId, a]));

    res.json({
      roster: {
        // §14.5: the exact deadline; the surface renders remaining time from
        // it rather than the server claiming a countdown (§30).
        responseDeadlineAt: payment?.responseDeadlineAt.toISOString() ?? null,
        // §14.5: "the full-refund outcome" — A.5's own promise, verbatim.
        fullRefundOutcome: LISTING_REFUND_PROMISE,
        pendingProposalNote: PENDING_PROPOSAL_NOTE,
        creators: rows.map((row) => {
          const open = openByAssociation.get(row.associationId);
          const agreement = agreementByAssociation.get(row.associationId);
          const statusLabel =
            row.status === 'proposal_pending' && open?.fixedPaymentRequestCents
              ? FIXED_PAYMENT_REQUESTED_LABEL
              : (FOUNDER_ROSTER_STATUS_LABELS[row.status] ?? 'Recruited');
          return {
            associationId: row.associationId,
            handle: row.publicHandle,
            channelType: row.subtype,
            audienceMetric: row.audienceSize,
            niche: row.audienceNiche,
            bio: row.adminBio,
            statusLabel,
            openProposal: open
              ? {
                  versionId: open.id,
                  versionNumber: open.versionNumber,
                  awaitingYou: open.state === 'awaiting_founder',
                  bidTotalPercent: open.bidTotalPercent,
                  fixedPaymentRequestCents: open.fixedPaymentRequestCents?.toString() ?? null,
                  note: PENDING_PROPOSAL_NOTE,
                }
              : null,
            lockedTerms: agreement
              ? {
                  totalPercent: agreement.totalPercent,
                  fixedPaymentCents: agreement.fixedPaymentCents?.toString() ?? null,
                }
              : null,
          };
        }),
      },
    });
  });

  /* ── The Founder's response to a version (§14.2) ────────────────────────── */

  router.post('/api/founder/proposals/:versionId/respond', founder, json, async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const action = body['action'];
    if (action !== 'accept' && action !== 'decline' && action !== 'revise') {
      res.status(422).json({ error: 'invalid_action', whatHappened: 'Unknown response action.' });
      return;
    }

    const bid = body['bidTotalPercent'];
    const fixed = body['fixedPaymentRequestCents'];
    const response =
      action === 'accept'
        ? { action: 'accept' as const }
        : action === 'decline'
          ? { action: 'decline' as const }
          : {
              action: 'counter' as const,
              proposal: {
                bidTotalPercent: typeof bid === 'number' ? bid : undefined,
                fixedPaymentRequestCents:
                  typeof fixed === 'string' && /^\d+$/.test(fixed) ? BigInt(fixed) : undefined,
              },
            };

    const result = await respondToProposal(db, { audit }, {
      versionId: req.params['versionId'] as string,
      party: 'founder',
      userId: userId(req),
      response,
      actor: `founder:${userId(req)}`,
    });
    if (!result.ok) {
      sendRefusal(res, result);
      return;
    }

    const associationId = result.version.associationId;
    if (result.outcome === 'locked') {
      await notifyVersionDecision(db, notifier, context, {
        associationId,
        version: result.version,
        decidedBy: 'founder',
        decision: 'accepted',
      });
      // The durable §14.2 confirmation to the Creator whose terms just locked.
      await notifyStandardAcceptance(db, notifier, context, {
        associationId,
        agreement: result.agreement,
      });
      // §20 (Phase 22b). No addition row means an ordinary Creator, and this
      // sends nothing — the check lives in the sender, not in the caller.
      await notifyMidCampaignAccepted(midNotify, { associationId });
      res.json({ response: { outcome: 'locked', totalPercent: result.agreement.totalPercent } });
      return;
    }
    if (result.outcome === 'declined') {
      await notifyVersionDecision(db, notifier, context, {
        associationId,
        version: result.version,
        decidedBy: 'founder',
        decision: 'declined',
      });
      res.json({ response: { outcome: 'declined' } });
      return;
    }
    // §14.2: "A Founder revision creates a new immutable version with
    // `awaiting_creator`; it is not acceptance."
    await notifyFounderRevision(db, notifier, context, {
      associationId,
      version: result.newVersion,
    });
    // §27.6, deduped on the VERSION (Phase 22b). A revision is a new answer
    // owed by the Creator, and §14.6's deadline keeps running through it.
    await notifyProposalAwaitingResponse(midNotify, { versionId: result.newVersion.id });
    res.json({
      response: {
        outcome: 'revised',
        newVersionId: result.newVersion.id,
        newVersionNumber: result.newVersion.versionNumber,
        state: result.newVersion.state,
      },
    });
  });

  /* ── Creator-specific bonuses (§14.3) ───────────────────────────────────── */

  router.post(
    '/api/founder/campaigns/:campaignId/roster/:associationId/bonus',
    founder,
    json,
    async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const triggerUnit = body['triggerUnit'];
      if (triggerUnit !== 'attributed_subtotal_cents' && triggerUnit !== 'unique_attributed_backers') {
        res.status(422).json({ error: 'invalid_terms', whatHappened: 'Unknown bonus trigger unit.' });
        return;
      }
      const threshold = body['threshold'];
      const additionalPercent = body['additionalPercent'];

      const result = await offerCreatorBonus(db, { audit }, {
        campaignId: req.params['campaignId'] as string,
        founderUserId: userId(req),
        associationId: req.params['associationId'] as string,
        triggerUnit,
        threshold: typeof threshold === 'string' && /^\d+$/.test(threshold) ? BigInt(threshold) : -1n,
        additionalPercent: typeof additionalPercent === 'number' ? additionalPercent : -1,
        actor: `founder:${userId(req)}`,
      });
      if (!result.ok) {
        sendRefusal(res, result);
        return;
      }
      res.json({
        bonus: {
          id: result.bonus.id,
          triggerUnit: result.bonus.triggerUnit,
          threshold: result.bonus.threshold.toString(),
          additionalPercent: result.bonus.additionalPercent,
          maxCombinedPercent: result.bonus.maxCombinedPercent,
        },
      });
    },
  );

  return router;
}
