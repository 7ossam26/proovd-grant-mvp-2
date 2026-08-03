/**
 * The public pre-order endpoints — Spec §19, §33.5 (Phase 15).
 *
 * `POST /api/campaign/:id/checkout/quote` returns the exact amounts, trigger,
 * delivery, seller, descriptor, cancel path, and sharing disclosure §33.5.2
 * requires — before any card is entered.
 * `POST /api/campaign/:id/preorder` runs the full §19 flow and, only on
 * SetupIntent success, creates the reservation.
 *
 * Both are public and session-less: a Backer has no account (§5.4). Card data
 * never reaches this server — the client tokenizes it with Stripe Elements and
 * sends only a PaymentMethod id (§28.3). Device and IP are hashed for the §4.1
 * risk record; the raw values are never stored.
 */

import { createHmac } from 'node:crypto';
import { Router, json } from 'express';
import type { Database } from '../db/client.js';
import type { StripeGateway } from '../payments/stripe-client.js';
import type { AuditWriter } from '../auth/audit.js';
import type { TokenService } from '../auth/token-service.js';
import type { Notifier } from '../notifications/send.js';
import { createPreorder, quotePreorder, type PreorderRefusalCode } from '../reservations/preorder.js';

export interface BackerPreorderRouterDeps {
  db: Database;
  gateway: StripeGateway;
  audit: AuditWriter;
  tokenService: TokenService;
  notifier: Notifier;
  /** BETTER_AUTH_SECRET — dedup HMAC, attribution cookie, and risk hashing. */
  secret: string;
  appBaseUrl: string;
  fromAddress: string;
}

const UUID = /^[0-9a-fA-F-]{36}$/;

/** Refusals that are the caller's fault (400) vs a state/availability (409/404). */
const STATUS_FOR: Record<PreorderRefusalCode, number> = {
  not_found: 404,
  not_live: 409,
  no_build: 409,
  seller_unavailable: 409,
  reward_not_found: 404,
  reward_sold_out: 409,
  non_us_billing: 422,
  age_not_confirmed: 422,
  operational_ack_required: 422,
  survey_invalid: 422,
  payment_method_required: 422,
  tax_unavailable: 503,
  cap_exceeded: 409,
  setup_failed: 402,
  idea_already_active: 409,
  provider_error: 502,
};

export function createBackerPreorderRouter(deps: BackerPreorderRouterDeps): Router {
  const router = Router();
  router.use(json());

  const hash = (value: string | undefined): string | null =>
    value ? createHmac('sha256', deps.secret).update(value).digest('hex') : null;

  router.post('/api/campaign/:campaignId/checkout/quote', async (req, res) => {
    const campaignId = req.params.campaignId;
    if (!UUID.test(campaignId)) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const body = req.body as {
      rewardSku?: unknown;
      billing?: { country?: unknown; postalCode?: unknown; state?: unknown; city?: unknown; line1?: unknown };
    };
    if (typeof body.rewardSku !== 'string' || !body.billing || typeof body.billing.postalCode !== 'string') {
      res.status(422).json({ error: 'invalid_request' });
      return;
    }

    const result = await quotePreorder(
      { db: deps.db, gateway: deps.gateway },
      {
        campaignId,
        rewardSku: body.rewardSku,
        billing: {
          country: str(body.billing.country) ?? 'US',
          postalCode: body.billing.postalCode,
          ...(str(body.billing.state) ? { state: str(body.billing.state) } : {}),
          ...(str(body.billing.city) ? { city: str(body.billing.city) } : {}),
          ...(str(body.billing.line1) ? { line1: str(body.billing.line1) } : {}),
        },
      },
    );

    if (!result.ok) {
      res.status(STATUS_FOR[result.refusal.code] ?? 400).json({ error: result.refusal });
      return;
    }
    res.json(result.quote);
  });

  router.post('/api/campaign/:campaignId/preorder', async (req, res) => {
    const campaignId = req.params.campaignId;
    if (!UUID.test(campaignId)) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const b = req.body as Record<string, unknown>;
    const contact = (b['contact'] ?? {}) as Record<string, unknown>;
    const billing = (b['billing'] ?? {}) as Record<string, unknown>;
    const survey = (b['survey'] ?? {}) as Record<string, unknown>;

    if (
      typeof b['rewardSku'] !== 'string' ||
      typeof contact['email'] !== 'string' ||
      typeof contact['phone'] !== 'string' ||
      typeof billing['country'] !== 'string' ||
      typeof billing['postalCode'] !== 'string' ||
      typeof b['paymentMethodId'] !== 'string'
    ) {
      res.status(422).json({ error: { code: 'invalid_request', message: 'Missing required fields.' } });
      return;
    }

    const result = await createPreorder(
      {
        db: deps.db,
        gateway: deps.gateway,
        audit: deps.audit,
        tokenService: deps.tokenService,
        notifier: deps.notifier,
        secret: deps.secret,
        appBaseUrl: deps.appBaseUrl,
        emailFrom: deps.fromAddress,
      },
      {
        campaignId,
        rewardSku: b['rewardSku'],
        contact: { email: contact['email'] as string, phone: contact['phone'] as string },
        billing: {
          country: billing['country'] as string,
          postalCode: billing['postalCode'] as string,
          ...(str(billing['state']) ? { state: str(billing['state']) } : {}),
          ...(str(billing['city']) ? { city: str(billing['city']) } : {}),
          ...(str(billing['line1']) ? { line1: str(billing['line1']) } : {}),
        },
        ageConfirmed: b['ageConfirmed'] === true,
        survey: { why: survey['why'], recommend: survey['recommend'] },
        operationalSharingAck: b['operationalSharingAck'] === true,
        founderMarketingConsent: b['founderMarketingConsent'] === true,
        newsletterConsent: b['newsletterConsent'] === true,
        paymentMethodId: b['paymentMethodId'] as string,
        ...(str(b['requestId']) ? { requestId: str(b['requestId']) } : {}),
        ...(req.headers.cookie ? { attributionCookieHeader: req.headers.cookie } : {}),
        ipHash: hash(req.ip),
        deviceHash: hash(req.headers['user-agent']),
      },
    );

    if (!result.ok) {
      res.status(STATUS_FOR[result.refusal.code] ?? 400).json({ error: result.refusal });
      return;
    }
    res.status(201).json(result.success);
  });

  return router;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}
