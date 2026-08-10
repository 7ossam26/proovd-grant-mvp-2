/**
 * Connected-account onboarding routes — Spec §13, §11, §5.2, §5.3.
 *
 * Three actors reach onboarding and each does it from their own session:
 * a Founder from the campaign workspace, a Creator from `Finish payout setup`,
 * and an Admin reconciling one that got stuck. There is no token surface here —
 * by this point in both journeys the person has an account.
 *
 * ── What these routes do not do ────────────────────────────────────────────
 * They do not accept a bank account, a tax id, an address, or a document. §11
 * forbids reproducing provider-controlled fields, §5.3 says Proovd stores
 * statuses and IDs and "never full bank details", and §13 forbids storing
 * identity documents. Every route below either issues a link or reads a status,
 * and there is no body shape that could carry one of those values — the absence
 * is the enforcement, as it was for the Creator signup in Phase 08b.
 *
 * ── The return and refresh URLs are Stripe's landing points ────────────────
 * §32.2 names them. Stripe sends the person to `/stripe/return` or
 * `/stripe/refresh` in the browser; the SPA route calls the matching endpoint
 * here, which re-reads the account and answers with the state to render. It
 * re-reads rather than trusting the last webhook because a Founder who finishes
 * and lands back within the second would otherwise see the state from before
 * they started (§13: returning always lands on a human-readable status).
 */

import { Router, type RequestHandler } from 'express';
import express from 'express';
import type { Database } from '../db/client.js';
import type { Auth } from '../auth/auth.js';
import type { AuditWriter } from '../auth/audit.js';
import { requireRole, requireAdmin, requireFreshSession } from '../auth/guards.js';
import { readAdminReauthWindowSeconds } from '../settings/service.js';
import type { StripeGateway } from '../payments/stripe-client.js';
import {
  beginOnboarding,
  readOnboardingState,
  recordOnboardingReturn,
  reconcileAccount,
  type OnboardingContext,
} from '../payments/onboarding.js';
import {
  readTaxAccountability,
  readTaxAccountabilityHistory,
  readTransferGate,
  recordTaxAccountability,
} from '../payments/tax-accountability.js';
import { findAccountByStripeId, readAccountHistory } from '../payments/connected-accounts.js';
import type { ConnectedAccountRole } from '../payments/connected-accounts.js';

export const FOUNDER_PAYOUTS_PATH = '/api/founder/payouts';
export const CREATOR_PAYOUTS_PATH = '/api/creator/payouts';
export const ADMIN_TAX_PATH = '/api/admin/tax-accountability';

export interface PayoutRouterDeps {
  db: Database;
  auth: Auth;
  gateway: StripeGateway;
  audit: AuditWriter;
  returnUrl?: string | undefined;
  refreshUrl?: string | undefined;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function createPayoutRouter({
  db,
  auth,
  gateway,
  audit,
  returnUrl,
  refreshUrl,
}: PayoutRouterDeps): Router {
  const router = Router();
  const founder = requireRole(auth, 'founder');
  const creator = requireRole(auth, 'affiliate');
  const admin = requireAdmin(auth);
  const fresh = requireFreshSession(auth, () => readAdminReauthWindowSeconds(db));
  const json: RequestHandler = express.json({ limit: '64kb' });

  const context: OnboardingContext = { db, gateway, audit, returnUrl, refreshUrl };

  /**
   * One implementation for both actors. §13 and §11 describe the same handoff
   * for two roles, and the only differences — which capability makes an account
   * complete, and which downstream things an incomplete one blocks — are
   * already inside `onboarding.ts`. Two copies here would be two places for
   * those rules to drift.
   */
  function mount(basePath: string, guard: RequestHandler, role: ConnectedAccountRole): void {
    router.get(basePath, guard, async (req, res) => {
      res.json({
        payouts: await readOnboardingState(context, {
          ownerUserId: req.authUser?.id ?? '',
          role,
        }),
      });
    });

    router.post(`${basePath}/link`, guard, json, async (req, res) => {
      const result = await beginOnboarding(context, {
        ownerUserId: req.authUser?.id ?? '',
        role,
        email: req.authUser?.email,
      });

      if (!result.ok) {
        // §27.1: every refusal says what happened and what to do now. A
        // restricted account gets the support path §13 requires and no retry.
        res.status(result.code === 'unavailable' ? 503 : 409).json({
          error: result.code,
          title: 'Payout setup could not be opened',
          whatHappened: result.message,
          next: result.next,
          support: '/support',
        });
        return;
      }

      res.json({
        url: result.url,
        expiresAt: result.expiresAt.toISOString(),
        reused: result.reused,
      });
    });

    /**
     * Stripe's return and refresh landings (§32.2, §13).
     *
     * One route, and the event is a parameter rather than two near-identical
     * handlers — the difference is one word in the history, not a different
     * thing happening.
     */
    router.post(`${basePath}/return`, guard, json, async (req, res) => {
      const event =
        (req.body as Record<string, unknown>)?.['event'] === 'refreshed'
          ? ('refreshed' as const)
          : ('returned' as const);

      res.json({
        payouts: await recordOnboardingReturn(context, {
          ownerUserId: req.authUser?.id ?? '',
          role,
          event,
        }),
      });
    });
  }

  mount(FOUNDER_PAYOUTS_PATH, founder, 'founder_seller');
  mount(CREATOR_PAYOUTS_PATH, creator, 'affiliate_recipient');

  /* ── Admin ──────────────────────────────────────────────────────────────── */

  /**
   * Re-reads one account from Stripe.
   *
   * The reconciliation path, and the reason §13's states are not reachable only
   * by webhook — a dropped delivery would otherwise strand a Founder outside the
   * listing-fee payment they are entitled to reach. Takes the freshness gate:
   * §5.1 puts connected-account actions behind recent reauthentication.
   */
  router.post(
    '/api/admin/connected-accounts/:stripeAccountId/reconcile',
    admin,
    fresh,
    json,
    async (req, res) => {
      const stripeAccountId = String(req.params['stripeAccountId']);
      const view = await reconcileAccount(context, stripeAccountId);

      if (!view) {
        res.status(404).json({
          error: 'not_found',
          title: 'No such connected account',
          whatHappened: 'Proovd has no onboarding record for that account.',
          next: 'Check the account id against the campaign it belongs to.',
        });
        return;
      }

      res.json({ payouts: view });
    },
  );

  /** §13's return and refresh history, for an Admin explaining a stuck one. */
  router.get('/api/admin/connected-accounts/:stripeAccountId', admin, async (req, res) => {
    const account = await findAccountByStripeId(db, String(req.params['stripeAccountId']));
    if (!account) {
      res.status(404).json({ error: 'not_found', title: 'No such connected account' });
      return;
    }
    res.json({ account, history: await readAccountHistory(db, account.id) });
  });

  /* ── The §11 tax-accountability gate ────────────────────────────────────── */

  router.get(ADMIN_TAX_PATH, admin, async (_req, res) => {
    res.json({
      mode: gateway.mode,
      configuration: await readTaxAccountability(db, gateway.mode),
      transferGate: await readTransferGate(db, gateway.mode),
      history: await readTaxAccountabilityHistory(db),
    });
  });

  /**
   * Records the configuration §11 requires before any Affiliate payment.
   *
   * All seven facts are required and none may be blank — a record answering six
   * of §11's seven questions is not the configuration §34 asks to be recorded as
   * complete. Behind the freshness gate for the same reason a settings change
   * is: the record names who approved it, and a stale session makes that name
   * unreliable.
   */
  router.post(ADMIN_TAX_PATH, admin, fresh, json, async (req, res) => {
    const body = req.body as Record<string, unknown>;

    const fields = {
      payer: str(body['payer']),
      filingResponsibility: str(body['filingResponsibility']),
      requiredForm: str(body['requiredForm']),
      requiredData: str(body['requiredData']),
      thresholds: str(body['thresholds']),
      correctionsProcess: str(body['correctionsProcess']),
      reconciliationResponsibility: str(body['reconciliationResponsibility']),
      approvedBy: str(body['approvedBy']),
      evidenceReference: str(body['evidenceReference']),
    };

    const missing = Object.entries(fields)
      .filter(([, value]) => value === null)
      .map(([key]) => key);

    if (missing.length > 0) {
      res.status(400).json({
        error: 'incomplete',
        title: 'That configuration is not complete',
        whatHappened: `§11 names every one of these and these are blank: ${missing.join(', ')}.`,
        next: 'Fill them in and record it again. Nothing has been changed.',
      });
      return;
    }

    try {
      const configuration = await recordTaxAccountability(db, {
        payer: fields.payer!,
        filingResponsibility: fields.filingResponsibility!,
        requiredForm: fields.requiredForm!,
        requiredData: fields.requiredData!,
        thresholds: fields.thresholds!,
        correctionsProcess: fields.correctionsProcess!,
        reconciliationResponsibility: fields.reconciliationResponsibility!,
        approvedBy: fields.approvedBy!,
        evidenceReference: fields.evidenceReference!,
        // The mode the process is running in. An Admin cannot record a live
        // configuration from a test deployment — §34 is about proving the two
        // were never confused.
        mode: gateway.mode,
        actor: `user:${req.authUser?.id ?? 'unknown'}`,
        mfaContext: req.authUser ? 'password_session_admin_role_verified' : null,
        reauthContext: `session:${req.authSession?.id ?? 'unknown'}`,
      });

      res.json({ configuration, transferGate: await readTransferGate(db, gateway.mode) });
    } catch (error) {
      // The database refuses a value shaped like a US taxpayer identification
      // number in these fields (§11: "without duplicating sensitive
      // provider-held data"). Say so rather than showing a constraint name.
      const reason = error instanceof Error ? error.message : String(error);
      res.status(422).json({
        error: 'refused',
        title: 'That configuration could not be recorded',
        whatHappened: reason.includes('tax_accountability_no_tin')
          ? 'One of these fields contains something shaped like a taxpayer identification number. ' +
            'These fields name who is responsible for tax data — they never hold the data itself.'
          : 'The configuration was refused. Nothing has been changed.',
        next: 'Correct it and record it again.',
      });
    }
  });

  return router;
}
