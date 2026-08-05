/**
 * The two Stripe webhook endpoints — Spec §32.3, §28.3, §24.1.
 *
 * §32.3 splits the event sets between a platform endpoint and a Connect
 * endpoint, each with its own signing secret. §24.1 splits the money the same
 * way: the listing fee is Proovd's own Checkout transaction, campaign charges
 * belong to the Founder's connected account. Two routes, two secrets, two
 * handler maps — a Connect delivery cannot reach a platform-side effect even if
 * Stripe were configured to send it there.
 *
 * ── Raw body before any JSON parser ────────────────────────────────────────
 * Phase 10's first trap, and the one the brief calls "the single most common
 * Stripe integration failure": a global `express.json()` consumes the stream
 * and signature verification then fails in a way that reads as a Stripe
 * configuration problem. `express.raw()` is mounted on these two paths only, and
 * `app.ts` still mounts no global parser — the comment there has said so since
 * Phase 01, for this exact moment.
 *
 * ── Verify, then parse, then ingest ────────────────────────────────────────
 * §28.3: "Webhook signature verification." An unverified body is refused before
 * anything reads it, and the refusal is a bare 401 with no detail — a caller
 * probing an endpoint learns whether it exists and nothing else. The real
 * reason goes to the audit log, which is the same split §5.5 makes for token
 * rejections.
 *
 * ── 2xx once verified, even when nothing happened ──────────────────────────
 * Stripe retries a non-2xx for days. An event with no handler registered, or one
 * whose handler refused because the account is unknown, is not a delivery
 * problem — retrying it would build a queue of identical failures instead of the
 * one audit row an Admin needs. A handler that *threw* is different: that is
 * answered 500 so Stripe retries it, and the claim in `provider_events` stays
 * unprocessed so the retry is visible as a retry.
 */

import { Router } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import type { Database } from '../db/client.js';
import type { AuditWriter } from '../auth/audit.js';
import type { Notifier } from '../notifications/send.js';
import type { StripeGateway, WebhookEndpoint } from '../payments/stripe-client.js';
import { ingestStripeEvent } from '../payments/webhook-handlers.js';
import type { ListingNotificationContext } from '../payments/listing-notifications.js';
import type { TokenService } from '../auth/token-service.js';

export const STRIPE_PLATFORM_WEBHOOK_PATH = '/api/webhooks/stripe/platform';
export const STRIPE_CONNECT_WEBHOOK_PATH = '/api/webhooks/stripe/connect';

/** Stripe's signature header. Same name on both endpoints. */
export const STRIPE_SIGNATURE_HEADER = 'stripe-signature';

export interface StripeWebhookDeps {
  db: Database;
  gateway: StripeGateway;
  audit: AuditWriter;
  /** §13's effect 7 — Phase 11's payment handler sends through these. */
  notifier?: Notifier;
  notificationContext?: ListingNotificationContext;
  /** Phase 22b: §27.6's funding notices. Unset → they do not send. */
  internalRecipient?: string | undefined;
  /** Phase 18a: the Backer receipt/recovery messages carry a magic link. */
  tokens?: TokenService;
  /** Raised only by the integration suite, which drives many deliveries. */
  limit?: number;
}

export function createStripeWebhookRouter({
  db,
  gateway,
  audit,
  notifier,
  notificationContext,
  internalRecipient,
  tokens,
  limit,
}: StripeWebhookDeps): Router {
  const router = Router();

  const limiter = rateLimit({
    windowMs: 60_000,
    limit: limit ?? 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  });

  // 1 MB. A dispute payload with evidence metadata is the largest thing Stripe
  // sends here and is well inside it; an unbounded raw parser on an
  // unauthenticated route is a way to be exhausted by a body nobody reads.
  const raw = express.raw({ type: '*/*', limit: '1mb' });

  function mount(path: string, endpoint: WebhookEndpoint): void {
    router.post(path, limiter, raw, async (req, res) => {
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
      const signature = req.header(STRIPE_SIGNATURE_HEADER) ?? undefined;

      const event = gateway.verifyEvent(endpoint, rawBody, signature);

      if (!event) {
        // Missing secret, wrong secret, wrong signature, and a replay outside
        // the tolerance are one answer. A deployment that has not been given a
        // secret must not be one that accepts anything.
        await audit({
          action: 'stripe.webhook_rejected',
          targetType: 'provider_event',
          targetId: null,
          internalReason: gateway.hasSecretFor(endpoint)
            ? `a delivery to the ${endpoint} endpoint failed signature verification`
            : `a delivery arrived at the ${endpoint} endpoint but no signing secret is configured`,
        });
        res.status(401).json({ error: 'signature_invalid' });
        return;
      }

      const outcome = await ingestStripeEvent(
        { db, gateway, audit, notifier, notificationContext, internalRecipient, tokens },
        event,
      );

      if (outcome.status === 'failed') {
        // Stripe should retry this one. The claim stays unprocessed, so the
        // retry is visible as a retry rather than as a fresh delivery.
        res.status(500).json({ error: 'handler_failed' });
        return;
      }

      res.status(200).json({ received: true, outcome: outcome.status });
    });
  }

  mount(STRIPE_PLATFORM_WEBHOOK_PATH, 'platform');
  mount(STRIPE_CONNECT_WEBHOOK_PATH, 'connect');

  return router;
}
