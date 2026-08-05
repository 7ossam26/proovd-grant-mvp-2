/**
 * The Backer magic-link routes — Spec §19, §20, §33.5.13, §33.7 (Phase 15b).
 *
 * All mounted under `/api/link/:token` behind `requireMagicLinkToken`, so the
 * raw token is redacted in logs (`token-routes.ts`) and every route reads the
 * campaign and Backer identity from the verified subject — never from a body a
 * caller could forge. A Backer has no account (§5.4); this link is the whole of
 * their authenticated surface.
 *
 * `GET  …/page`                          the campaign + this Backer's transactions
 * `POST …/reservations/:id/cancel`       §20 cancellation (one action, no cost)
 * `POST …/reservations/:id/change-reward`§19 Idea reward change (replacement-first)
 * `POST …/reservations/:id/update-card`  §21's B.5 recovery (Phase 18b): save a
 *                                        new card, retry once under the next
 *                                        stable attempt key (§33.7.9)
 * `GET  …/support`                       §29.9/§29.10 (Phase 20b): this Backer's
 *                                        cases with the escalation facts
 * `POST …/support`                       open a case carrying full context
 * `POST …/support/:caseId/escalate`      the §29.10 escalation to Proovd
 */

import { Router, json } from 'express';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import type { StripeGateway } from '../payments/stripe-client.js';
import type { AuditWriter } from '../auth/audit.js';
import type { TokenService } from '../auth/token-service.js';
import type { Notifier } from '../notifications/send.js';
import { MAGIC_LINK_TOKEN_PATH, TOKEN_PARAM } from '../auth/token-routes.js';
import { requireMagicLinkToken } from '../auth/token-middleware.js';
import { campaignBuild } from '../db/schema/build.js';
import { readBackerPage } from '../reservations/magic-link-read.js';
import { readDigestPreference, setDigestPreference } from '../notifications/preferences.js';
import { cancelReservation } from '../reservations/cancellation.js';
import { replaceIdeaReward } from '../reservations/preorder.js';
import { updateCardAndRetry } from '../close/retry.js';
import {
  escalateBackerCase,
  openBackerSupportCase,
  readBackerSupport,
} from '../support/backer-support.js';
import type { SupportTopic } from '../support/logic.js';
import { findCampaignFounderUserId } from '../reservations/context.js';
import { findAccountForOwner } from '../payments/connected-accounts.js';
import { evaluateAndNotifyThreshold } from '../live/thresholds.js';
import type { LaunchNotificationContext } from '../launch/notifications.js';
import rateLimit from 'express-rate-limit';
import {
  MAGIC_LINK_REISSUE_ACK,
  reissueMagicLink,
} from '../reservations/magic-link-reissue.js';

export interface BackerRouterDeps {
  db: Database;
  tokens: TokenService;
  gateway: StripeGateway;
  audit: AuditWriter;
  notifier: Notifier;
  secret: string;
  appBaseUrl: string;
  fromAddress: string;
  /** §20's threshold notices. Absent in tests that do not assert on them. */
  notificationContext?: LaunchNotificationContext | undefined;
}

/**
 * §20's crossing evaluation after a Backer action changed the active count.
 *
 * Never fails the request that triggered it. A cancellation that succeeded must
 * not be reported as failed because a notice could not be sent — the failure is
 * recorded and the reconciliation sweep retries it.
 */
async function evaluateThreshold(
  deps: BackerRouterDeps,
  campaignId: string,
  actor: string,
): Promise<void> {
  try {
    await evaluateAndNotifyThreshold(
      deps.db,
      {
        audit: deps.audit,
        notifier: deps.notifier,
        ...(deps.notificationContext ? { context: deps.notificationContext } : {}),
      },
      { campaignId, actor },
    );
  } catch (error) {
    await deps.audit({
      action: 'live.threshold_evaluation_failed',
      targetType: 'campaign',
      targetId: campaignId,
      internalReason: `§20 threshold evaluation failed after ${actor}: ${
        error instanceof Error ? error.message : String(error)
      }. The reconciliation sweep will retry it.`,
    });
  }
}

async function connectedAccountFor(
  db: Database,
  gateway: StripeGateway,
  campaignId: string,
): Promise<string | undefined> {
  const founderUserId = await findCampaignFounderUserId(db, campaignId);
  if (!founderUserId) return undefined;
  const account = await findAccountForOwner(db, {
    ownerUserId: founderUserId,
    role: 'founder_seller',
    mode: gateway.mode,
  });
  return account?.stripeAccountId;
}

async function campaignTitleFor(db: Database, campaignId: string): Promise<string> {
  const [row] = await db
    .select({ title: campaignBuild.title })
    .from(campaignBuild)
    .where(eq(campaignBuild.campaignId, campaignId))
    .limit(1);
  return row?.title ?? 'your campaign';
}

export function createBackerRouter(deps: BackerRouterDeps): Router {
  const router = Router();
  router.use(json());
  const base = `${MAGIC_LINK_TOKEN_PATH}/:${TOKEN_PARAM}`;
  const guard = requireMagicLinkToken(deps.tokens);

  /* ── §5.5's ask: "send me my link again" (Phase 22b) ───────────────────── */

  /**
   * The only route in this file with NO token in front of it, because it is
   * the route for someone whose token no longer works.
   *
   * Every branch answers `MAGIC_LINK_REISSUE_ACK` — hit, miss, nonexistent
   * campaign, malformed address, and over the limit. See
   * `reservations/magic-link-reissue.ts` for why the rate-limit case is not an
   * exception: a 429 on the fifth try tells you the first four were
   * interesting, which is Phase 04's reasoning about token rejections applied
   * to the one public route that takes an email address.
   *
   * The limiter is deliberately generous per window and low per address-shaped
   * body — this is a route a locked-out person may legitimately hit twice.
   */
  router.post(
    `${MAGIC_LINK_TOKEN_PATH}/request`,
    rateLimit({
      windowMs: 15 * 60_000,
      limit: 20,
      standardHeaders: false,
      legacyHeaders: false,
      // Not a 429. The same body, the same status, the same everything.
      handler: (_req, res) => {
        res.status(202).json(MAGIC_LINK_REISSUE_ACK);
      },
    }),
    async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const email = typeof body['email'] === 'string' ? body['email'] : '';
      const campaignId = typeof body['campaignId'] === 'string' ? body['campaignId'] : '';

      // Answer FIRST. A hit mints a token and sends an email while a miss
      // returns immediately, and that difference is measurable even when the
      // bodies match. The result of this request arrives by email, so
      // responding before the work is honest rather than a claim of completion.
      res.status(202).json(MAGIC_LINK_REISSUE_ACK);

      if (!email || !campaignId) return;

      try {
        await reissueMagicLink(
          {
            db: deps.db,
            tokenService: deps.tokens,
            notifier: deps.notifier,
            appBaseUrl: deps.appBaseUrl,
            fromAddress: deps.fromAddress,
            supportEmail: deps.notificationContext?.supportEmail ?? deps.fromAddress,
            secret: deps.secret,
          },
          { email, campaignId },
        );
      } catch (error) {
        // The response is already sent, so this can only be recorded. It must
        // not surface: an error path that behaved differently would be the
        // oracle the whole route is built to avoid.
        await deps.audit({
          action: 'backer.magic_link_reissue_failed',
          targetType: 'campaign',
          targetId: campaignId,
          internalReason: `§27.5 magic-link reissue failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
    },
  );

  router.get(`${base}/page`, guard, async (req, res) => {
    const subject = req.magicLinkSubject!;
    const page = await readBackerPage(deps.db, {
      campaignId: subject.campaignId,
      backerIdentityId: subject.backerIdentityId,
    });
    res.json(page);
  });

  /*
   * §27.7's digest preference, "at first magic-link visit".
   *
   * There is no first-visit marker anywhere in the product to hang this on —
   * `secure_tokens.last_used_at` is a *last*-seen and rotation destroys it —
   * so "first visit" is the absence of a preference row, and the page renders
   * the question while `chosen` is false. See `notifications/preferences.ts`.
   *
   * The subject comes from the verified token, never from the body: a Backer
   * has no account, so the token IS the identity, and a route that took an
   * identity id would let anyone holding one link set anyone else's preference.
   */
  router.get(`${base}/digest-preference`, guard, async (req, res) => {
    const subject = req.magicLinkSubject!;
    const preference = await readDigestPreference(deps.db, {
      audience: 'backer',
      backerIdentityId: subject.backerIdentityId,
    });
    res.json({ preference });
  });

  router.put(`${base}/digest-preference`, guard, async (req, res) => {
    const subject = req.magicLinkSubject!;
    const frequency = String((req.body as { frequency?: unknown } | undefined)?.frequency ?? '');
    const result = await setDigestPreference(
      deps.db,
      { audience: 'backer', backerIdentityId: subject.backerIdentityId },
      frequency,
    );
    if (result.status === 'invalid_frequency') {
      res.status(400).json({
        error: 'invalid_frequency',
        title: 'That is not one of the choices',
        whatHappened: `A summary preference must be one of: ${result.permitted.join(', ')}.`,
        next: 'Pick one of the options shown and try again.',
        support: '/support',
        permitted: result.permitted,
      });
      return;
    }
    await deps.audit({
      action: 'notification.digest_preference_set',
      targetType: 'digest_preference',
      targetId: subject.backerIdentityId,
      internalReason: `backer chose digest frequency ${result.frequency}`,
      newValue: { frequency: result.frequency },
    });
    const preference = await readDigestPreference(deps.db, {
      audience: 'backer',
      backerIdentityId: subject.backerIdentityId,
    });
    res.json({ preference });
  });

  router.post(`${base}/reservations/:reservationId/cancel`, guard, async (req, res) => {
    const subject = req.magicLinkSubject!;
    const reservationId = String(req.params.reservationId);
    const connectedAccountId = await connectedAccountFor(deps.db, deps.gateway, subject.campaignId);
    const campaignTitle = await campaignTitleFor(deps.db, subject.campaignId);

    const outcome = await cancelReservation(
      {
        db: deps.db,
        gateway: deps.gateway,
        audit: deps.audit,
        notifier: deps.notifier,
        fromAddress: deps.fromAddress,
        ...(connectedAccountId ? { connectedAccountId } : {}),
      },
      { reservationId, backerIdentityId: subject.backerIdentityId, actor: `backer:${subject.backerIdentityId}`, campaignTitle },
    );

    if (outcome.status === 'not_found') {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    if (outcome.status === 'not_cancelable') {
      res.status(409).json({ error: 'not_cancelable', current: outcome.current });
      return;
    }
    // §20: a cancellation can take an Idea campaign back below its threshold, and
    // that crossing notifies once. Deduplicated by state transition, so a
    // duplicate cancel evaluates and emits nothing.
    if (outcome.status === 'canceled') {
      await evaluateThreshold(deps, subject.campaignId, 'system:cancellation');
    }

    // `canceled` and `already_canceled` both report success — a duplicate cancel
    // is harmless (§33.7.3).
    res.json({ status: outcome.status, amountCharged: 'US$0' });
  });

  router.post(`${base}/reservations/:reservationId/change-reward`, guard, async (req, res) => {
    const subject = req.magicLinkSubject!;
    const b = req.body as Record<string, unknown>;
    const billing = (b['billing'] ?? {}) as Record<string, unknown>;
    if (
      typeof b['newRewardSku'] !== 'string' ||
      typeof billing['country'] !== 'string' ||
      typeof billing['postalCode'] !== 'string' ||
      typeof b['paymentMethodId'] !== 'string'
    ) {
      res.status(422).json({ error: { code: 'invalid_request', message: 'Missing required fields.' } });
      return;
    }

    const result = await replaceIdeaReward(
      {
        db: deps.db,
        gateway: deps.gateway,
        audit: deps.audit,
        tokenService: deps.tokens,
        notifier: deps.notifier,
        secret: deps.secret,
        appBaseUrl: deps.appBaseUrl,
        emailFrom: deps.fromAddress,
      },
      {
        campaignId: subject.campaignId,
        backerIdentityId: subject.backerIdentityId,
        newRewardSku: b['newRewardSku'],
        billing: {
          country: billing['country'] as string,
          postalCode: billing['postalCode'] as string,
          ...(typeof billing['state'] === 'string' ? { state: billing['state'] } : {}),
          ...(typeof billing['city'] === 'string' ? { city: billing['city'] } : {}),
          ...(typeof billing['line1'] === 'string' ? { line1: billing['line1'] } : {}),
        },
        paymentMethodId: b['paymentMethodId'] as string,
      },
    );

    if (!result.ok) {
      res.status(result.refusal.code === 'setup_failed' ? 402 : 409).json({ error: result.refusal });
      return;
    }

    // A reward replacement cancels one active reservation and creates another,
    // so the unique-Backer count is usually unchanged — but "usually" is not a
    // guarantee, and the evaluation is deduplicated by transition, so running it
    // costs a read and closes the case where it did move.
    await evaluateThreshold(deps, subject.campaignId, 'system:reward-replacement');

    res.status(201).json(result.success);
  });

  /**
   * §21's B.5 recovery (Phase 18b, §33.7.9): save a new card and retry once
   * under the next stable attempt key. The response never carries a provider
   * code (§33.9.11) — the neutral outcome is the message, and the raw code
   * stays on the attempt row for support.
   */
  router.post(`${base}/reservations/:reservationId/update-card`, guard, async (req, res) => {
    const subject = req.magicLinkSubject!;
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (typeof b['paymentMethodId'] !== 'string' || !b['paymentMethodId'].trim()) {
      res.status(422).json({ error: { code: 'invalid_request', message: 'Missing payment method.' } });
      return;
    }

    const outcome = await updateCardAndRetry(
      {
        db: deps.db,
        gateway: deps.gateway,
        audit: deps.audit,
        notifier: deps.notifier,
        ...(deps.notificationContext ? { context: deps.notificationContext } : {}),
        tokens: deps.tokens,
      },
      {
        reservationId: String(req.params.reservationId),
        backerIdentityId: subject.backerIdentityId,
        paymentMethodId: b['paymentMethodId'],
        ...(typeof b['requestId'] === 'string' ? { requestId: b['requestId'] } : {}),
        actor: `backer:${subject.backerIdentityId}`,
      },
    );

    switch (outcome.status) {
      case 'captured':
        res.json({
          status: 'captured',
          message: 'Your updated card completed this pre-order charge. Nothing more is needed.',
        });
        return;
      case 'already_captured':
        // A double submit after success is harmless (§33.7.9).
        res.json({
          status: 'already_captured',
          message: 'This pre-order charge is already complete. Nothing more is needed.',
        });
        return;
      case 'requires_action':
        // §21: routed to a customer-action surface, never silent.
        res.json({
          status: 'requires_action',
          clientSecret: outcome.clientSecret,
          message:
            'Your bank asks you to confirm this charge. Complete the confirmation to finish — nothing has been charged yet.',
        });
        return;
      case 'failed_again':
        res.status(402).json({
          status: 'failed_again',
          message:
            'This charge could not be completed with that card. No money has moved — you can try a different card before the update deadline.',
        });
        return;
      case 'setup_failed':
        res.status(402).json({
          status: 'setup_failed',
          message: 'That card could not be saved. No money has moved — you can try another card.',
        });
        return;
      case 'retry_window_closed':
        res.status(409).json({
          status: 'retry_window_closed',
          deadline: outcome.deadline.toISOString(),
          message:
            'The update window for this pre-order has ended, so the card can no longer be updated here. No money has moved.',
        });
        return;
      case 'not_recoverable':
        res.status(409).json({ status: 'not_recoverable', current: outcome.current });
        return;
      case 'provider_error':
        res.status(503).json({
          status: 'provider_error',
          message:
            'We could not reach the payment provider. Nothing was charged twice — trying again is safe.',
        });
        return;
      default:
        res.status(404).json({ error: 'not_found' });
    }
  });

  /* ── §29.9/§29.10: the Backer support path (Phase 20b) ─────────────────── */

  router.get(`${base}/support`, guard, async (req, res) => {
    const subject = req.magicLinkSubject!;
    const view = await readBackerSupport(deps.db, {
      campaignId: subject.campaignId,
      backerIdentityId: subject.backerIdentityId,
    });
    res.json(view);
  });

  router.post(`${base}/support`, guard, async (req, res) => {
    const subject = req.magicLinkSubject!;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const outcome = await openBackerSupportCase(
      {
        db: deps.db,
        audit: deps.audit,
        notifier: deps.notifier,
        ...(deps.notificationContext ? { context: deps.notificationContext } : {}),
      },
      {
        campaignId: subject.campaignId,
        backerIdentityId: subject.backerIdentityId,
        topic: (typeof b['topic'] === 'string' ? b['topic'] : '') as SupportTopic,
        message: typeof b['message'] === 'string' ? b['message'] : '',
        reservationId: typeof b['reservationId'] === 'string' ? b['reservationId'] : null,
      },
    );
    if (!outcome.ok) {
      res
        .status(outcome.code === 'not_found' ? 404 : 422)
        .json({ error: outcome.code, message: outcome.message });
      return;
    }
    // §27.8's five facts plus the B.8 acknowledgement — the same string the
    // confirmation email carries (§33.11.5).
    res.status(201).json({
      reference: outcome.result.reference,
      topic: outcome.result.topic,
      owner: outcome.result.owner,
      humanResponseDueAt: outcome.result.humanResponseDueAt.toISOString(),
      founderFollowupDueAt: outcome.result.founderFollowupDueAt?.toISOString() ?? null,
      acknowledgement: outcome.result.acknowledgement,
      issuerRights: outcome.issuerRights,
    });
  });

  router.post(`${base}/support/:caseId/escalate`, guard, async (req, res) => {
    const subject = req.magicLinkSubject!;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const outcome = await escalateBackerCase(
      { db: deps.db, audit: deps.audit },
      {
        campaignId: subject.campaignId,
        backerIdentityId: subject.backerIdentityId,
        caseId: String(req.params.caseId),
        reason: typeof b['reason'] === 'string' ? b['reason'] : '',
      },
    );
    if (!outcome.ok) {
      res.status(outcome.code === 'not_found' ? 404 : 422).json({
        error: outcome.code,
        message: outcome.message,
        ...(outcome.opensAt ? { opensAt: outcome.opensAt } : {}),
      });
      return;
    }
    res.status(201).json(outcome);
  });

  return router;
}
