/**
 * The Creator's formal decision — Spec §14.1, §14.2, §33.2.6–§33.2.10.
 *
 * Mounted under `/api/creator` beside Phase 08c's kit routes and behind the
 * same guard: `requireRole(auth, 'affiliate')`, every read and write scoped to
 * the session's user INSIDE the service query. Someone else's association
 * answers `not_found`, the same as one that does not exist.
 *
 * All three §14.2 outcomes have a route — accept, decline, propose — and none
 * is privileged over the others here; presentation is the surface's concern,
 * hiding is nobody's (§14.2: "none of the outcomes may be hidden").
 */

import { Router, type RequestHandler } from 'express';
import express from 'express';
import type { Database } from '../db/client.js';
import { notifyMidCampaignAccepted } from '../affiliates/mid-campaign-notifications.js';
import { notifyProposalAwaitingResponse } from '../notifications/internal-queue.js';
import { notifyDisclosureAvailable } from '../notifications/customer-remaining.js';
import type { Auth } from '../auth/auth.js';
import { requireRole } from '../auth/guards.js';
import type { AuditWriter } from '../auth/audit.js';
import type { Notifier } from '../notifications/send.js';
import { readPitch } from '../affiliates/creator-pitches.js';
import {
  acceptStandardTerms,
  declineOpportunity,
  submitProposal,
  respondToProposal,
  CREATOR_DISCLOSURE_TEXT,
  type AcceptanceConfirmations,
  type Refused,
} from '../affiliates/decisions.js';
import {
  notifyStandardAcceptance,
  notifyDecline,
  notifyProposalSubmitted,
  notifyVersionDecision,
  type DecisionNotificationContext,
} from '../affiliates/decision-notifications.js';

export interface CreatorDecisionDeps {
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

function confirmationsFrom(body: unknown): AcceptanceConfirmations {
  const b = (body ?? {}) as Record<string, unknown>;
  // §28.4: four separate facts from four separate controls. Anything that is
  // not literally true is not a confirmation.
  return {
    compensationTerms: b['compensationTerms'] === true,
    ipAgreement: b['ipAgreement'] === true,
    ftcDisclosure: b['ftcDisclosure'] === true,
    termsAup: b['termsAup'] === true,
  };
}

export function createCreatorDecisionRouter(deps: CreatorDecisionDeps): Router {
  const { db, auth, audit, notifier, context } = deps;

  /**
   * §20's mid-campaign notices. `DecisionNotificationContext` is structurally
   * the same three fields as `LaunchNotificationContext`, and the sender no-ops
   * for an ordinary Creator — so this adds no branch to the accept path.
   */
  const midNotify = {
    db,
    notifier,
    context,
    ...(deps.internalRecipient ? { internalRecipient: deps.internalRecipient } : {}),
  };
  /** §27.6's queue notices. Same three fields; same no-op without an inbox. */
  const internalDeps = () => midNotify;
  const router = Router();
  const creator = requireRole(auth, 'affiliate');
  const json: RequestHandler = express.json({ limit: '32kb' });

  const userId = (req: express.Request): string => req.authUser?.id ?? '';
  const actor = (req: express.Request): string => `affiliate:${userId(req)}`;

  /* ── The formal opportunity (§14.1) ─────────────────────────────────────── */

  /*
   * Session E: the response gained `content`, and the SERVICE did not change.
   *
   * `readPitch` calls `readFormalOpportunity` verbatim — including its §14.5
   * side effect of recording `reviewing` on first read, because opening a
   * pitch is the read that observes it — and composes §14.1's material beside
   * the decision facts. §33.2.6–§33.2.13 drive the service directly and pass
   * unchanged, which is the whole of what "no decision service was touched"
   * can be proved by.
   */
  router.get('/api/creator/campaigns/:associationId/opportunity', creator, async (req, res) => {
    const result = await readPitch(
      db,
      { appBaseUrl: context.appBaseUrl },
      {
        associationId: req.params['associationId'] as string,
        affiliateUserId: userId(req),
        actor: actor(req),
      },
    );
    if (!('opportunity' in result)) {
      sendRefusal(res, result);
      return;
    }
    res.json({ opportunity: result.opportunity, content: result.content });
  });

  /* ── Accept standard terms (§14.2) ──────────────────────────────────────── */

  router.post(
    '/api/creator/campaigns/:associationId/accept',
    creator,
    json,
    async (req, res) => {
      const result = await acceptStandardTerms(db, { audit }, {
        associationId: req.params['associationId'] as string,
        affiliateUserId: userId(req),
        confirmations: confirmationsFrom(req.body),
        actor: actor(req),
      });
      if (!result.ok) {
        sendRefusal(res, result);
        return;
      }

      // The durable §14.2 confirmation, after the decision committed.
      const confirmation = await notifyStandardAcceptance(db, notifier, context, {
        associationId: req.params['associationId'] as string,
        agreement: result.agreement,
      });
      // §20 (Phase 22b): if this Creator joined MID-campaign, the Founder and
      // Admin are owed the frozen-terms acceptance notice. No addition row means
      // an ordinary Creator, and this sends nothing.
      await notifyMidCampaignAccepted(midNotify, {
        associationId: req.params['associationId'] as string,
      });
      // §27.4 (Phase 22b): the link exists now, inactive, and the disclosure is
      // required from the first post that carries it. Deduped on the
      // association — one link, minted once.
      if (result.trackingLink) {
        await notifyDisclosureAvailable(
          { db, notifier, context },
          {
            associationId: req.params['associationId'] as string,
            campaignId: result.agreement.campaignId,
            trackingUrl: `${context.appBaseUrl}/c/${result.trackingLink.code}`,
            disclosureText: CREATOR_DISCLOSURE_TEXT,
          },
        );
      }

      res.json({
        accepted: {
          totalPercent: result.agreement.totalPercent,
          trackingLink: result.trackingLink
            ? {
                url: `${context.appBaseUrl}/c/${result.trackingLink.code}`,
                active: result.trackingLink.active,
              }
            : null,
          confirmationEmail: confirmation,
        },
      });
    },
  );

  /* ── Decline (§14.2: optional reason, no penalty) ───────────────────────── */

  router.post(
    '/api/creator/campaigns/:associationId/decline',
    creator,
    json,
    async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const reason = typeof body['reason'] === 'string' ? body['reason'].slice(0, 2000) : undefined;

      const result = await declineOpportunity(db, { audit }, {
        associationId: req.params['associationId'] as string,
        affiliateUserId: userId(req),
        reason,
        actor: actor(req),
      });
      if (!result.ok) {
        sendRefusal(res, result);
        return;
      }

      const confirmation = await notifyDecline(db, notifier, context, {
        associationId: req.params['associationId'] as string,
      });

      res.json({
        declined: {
          recordedAt: result.declinedAt.toISOString(),
          // §14.2: the confirmation says the decline was recorded and does not
          // harm standing. The surface renders the same sentence.
          confirmationEmail: confirmation,
        },
      });
    },
  );

  /* ── Propose terms (§14.2, §33.2.8) ─────────────────────────────────────── */

  router.post(
    '/api/creator/campaigns/:associationId/proposals',
    creator,
    json,
    async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const bid = body['bidTotalPercent'];
      const fixed = body['fixedPaymentRequestCents'];

      const result = await submitProposal(db, { audit }, {
        associationId: req.params['associationId'] as string,
        affiliateUserId: userId(req),
        proposal: {
          bidTotalPercent: typeof bid === 'number' ? bid : undefined,
          fixedPaymentRequestCents:
            typeof fixed === 'string' && /^\d+$/.test(fixed) ? BigInt(fixed) : undefined,
        },
        actor: actor(req),
      });
      if (!result.ok) {
        sendRefusal(res, result);
        return;
      }

      await notifyProposalSubmitted(db, notifier, context, {
        associationId: req.params['associationId'] as string,
        version: result.version,
        isCounter: false,
      });
      // §27.6, deduped on the VERSION (Phase 22b): a counter is a genuinely new
      // answer owed, so every negotiation round is announced and none repeats.
      await notifyProposalAwaitingResponse(internalDeps(), { versionId: result.version.id });

      res.json({
        proposal: {
          versionId: result.version.id,
          versionNumber: result.version.versionNumber,
          state: result.version.state,
        },
      });
    },
  );

  /* ── Responding to a Founder revision (§14.2, §33.2.9, §33.2.10) ────────── */

  router.post(
    '/api/creator/proposals/:versionId/respond',
    creator,
    json,
    async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const action = body['action'];
      if (action !== 'accept' && action !== 'decline' && action !== 'counter') {
        res.status(422).json({ error: 'invalid_action', whatHappened: 'Unknown response action.' });
        return;
      }

      const bid = body['bidTotalPercent'];
      const fixed = body['fixedPaymentRequestCents'];
      const response =
        action === 'accept'
          ? { action: 'accept' as const, confirmations: confirmationsFrom(body) }
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
        party: 'affiliate',
        userId: userId(req),
        response,
        actor: actor(req),
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
          decidedBy: 'affiliate',
          decision: 'accepted',
        });
        await notifyStandardAcceptance(db, notifier, context, {
          associationId,
          agreement: result.agreement,
        });
        await notifyMidCampaignAccepted(midNotify, { associationId });
        res.json({ response: { outcome: 'locked', totalPercent: result.agreement.totalPercent } });
        return;
      }
      if (result.outcome === 'declined') {
        await notifyVersionDecision(db, notifier, context, {
          associationId,
          version: result.version,
          decidedBy: 'affiliate',
          decision: 'declined',
        });
        res.json({ response: { outcome: 'declined' } });
        return;
      }
      await notifyProposalSubmitted(db, notifier, context, {
        associationId,
        version: result.newVersion,
        isCounter: true,
      });
      await notifyProposalAwaitingResponse(internalDeps(), { versionId: result.newVersion.id });
      res.json({
        response: {
          outcome: 'countered',
          newVersionId: result.newVersion.id,
          newVersionNumber: result.newVersion.versionNumber,
        },
      });
    },
  );

  return router;
}
