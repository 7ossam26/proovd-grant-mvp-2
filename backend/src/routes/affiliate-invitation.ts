/**
 * The Creator's invitation route — Spec §11, §33.2.1, §33.2.2, §33.2.3.
 *
 * The only route a Creator reaches without an account, and the second half of
 * §33.2.1: "an invitation claims only that Affiliate's account/association."
 *
 * ── The route never takes an association id ─────────────────────────────────
 * It takes a token and learns the association id from the *verified subject*.
 * There is no id in the request to change, no second Creator the route could be
 * argued into serving, and no way to enumerate invitations. 08a's
 * `requireAffiliateInvitationToken` establishes the shape; this is its first
 * real use, and the scope-binding CHECK (migration 0009) is what guarantees the
 * association names exactly one campaign and one prospect.
 *
 * ── Every failure is the same failure ───────────────────────────────────────
 * Altered, cross-scope, replayed, expired, revoked, superseded by a resend,
 * never issued, malformed, rate-limited: one status, one body, byte-identical.
 * Including a revoked invitation, whose token would still verify in the window
 * between the two if `readInvitationLanding` did not refuse it.
 *
 * ── Exactly two primary actions, and no third (§33.2.2) ─────────────────────
 * `POST …/claim` is `Confirm and create account`. `GET …/payout` reports the
 * status behind `Finish payout setup`. There is no route here that collects a
 * bank account, a tax id, or an identity document — §11 forbids reproducing
 * provider-controlled fields, and the absence of the route is what makes that
 * true rather than a promise. There is no tour route and no step sequence.
 */

import { Router, type RequestHandler } from 'express';
import express from 'express';
import type { Database } from '../db/client.js';
import { notifyInvitationClaimed } from '../notifications/operational.js';
import type { Auth } from '../auth/auth.js';
import type { TokenService } from '../auth/token-service.js';
import type { Notifier } from '../notifications/send.js';
import {
  requireAffiliateInvitationToken,
  createTokenVerifyLimiter,
} from '../auth/token-middleware.js';
import { TOKEN_REJECTION_STATUS, TOKEN_REJECTION_BODY } from '../auth/token-rejection.js';
import { AFFILIATE_INVITATION_TOKEN_PATH, TOKEN_PARAM } from '../auth/token-routes.js';
import { readInvitationLanding } from '../affiliates/invitation.js';
import {
  ensureSignupProfile,
  readSignupProfile,
  saveSignupProfile,
  completeAffiliateSignup,
  readConditionalState,
  AFFILIATE_CLAIM_POLICY_SLUGS,
} from '../affiliates/signup.js';
import { sendSignupConfirmation } from '../affiliates/signup-notification.js';
import { policyVersions } from '../db/schema/policies.js';
import { inArray } from 'drizzle-orm';

export const AFFILIATE_INVITATION_VERIFY_LIMIT = 20;

export interface AffiliateInvitationDeps {
  db: Database;
  auth: Auth;
  tokens: TokenService;
  notifier: Notifier;
  context: { appBaseUrl: string; supportEmail: string; fromAddress: string };
  verifyLimit?: number;
  /** Phase 22b: §27.6's new-account notice. Unset → it does not send. */
  internalRecipient?: string | undefined;
}

export function createAffiliateInvitationRouter({
  db,
  auth,
  tokens,
  notifier,
  context,
  verifyLimit,
  internalRecipient,
}: AffiliateInvitationDeps): Router {
  const router = Router();
  const json: RequestHandler = express.json({ limit: '64kb' });

  const guard = [
    createTokenVerifyLimiter({
      limit: verifyLimit ?? AFFILIATE_INVITATION_VERIFY_LIMIT,
      windowMs: 15 * 60 * 1000,
    }),
    requireAffiliateInvitationToken(tokens),
  ];

  const base = `${AFFILIATE_INVITATION_TOKEN_PATH}/:${TOKEN_PARAM}`;

  /** Everything the surface needs to render, for a verified invitation. */
  router.get(base, ...guard, async (req, res) => {
    const associationId = req.affiliateInvitationSubject?.associationId;
    if (!associationId) {
      res.status(TOKEN_REJECTION_STATUS).json(TOKEN_REJECTION_BODY);
      return;
    }

    // Refuses a revoked invitation, with the same answer as every other
    // failure — the caller learns nothing about which.
    const landing = await readInvitationLanding(db, associationId);
    if (!landing) {
      res.status(TOKEN_REJECTION_STATUS).json(TOKEN_REJECTION_BODY);
      return;
    }

    const profile = await ensureSignupProfile(db, associationId, 'affiliate:invited');
    if (!profile) {
      res.status(TOKEN_REJECTION_STATUS).json(TOKEN_REJECTION_BODY);
      return;
    }

    const conditional = await readConditionalState(db, associationId, landing.productName);

    // §11 requires Terms and Affiliate AUP acceptance, and a consent may cite
    // only a published version. The surface renders the real status, so a draft
    // document produces an honest refusal rather than a checkbox that leads
    // nowhere.
    const policies = await db
      .select({
        slug: policyVersions.slug,
        title: policyVersions.title,
        version: policyVersions.version,
        status: policyVersions.status,
        route: policyVersions.route,
      })
      .from(policyVersions)
      .where(inArray(policyVersions.slug, [...AFFILIATE_CLAIM_POLICY_SLUGS]));

    res.json({ landing, profile, conditional, policies });
  });

  /** Autosave. A save writes only the keys it was given (§11). */
  router.patch(base, ...guard, json, async (req, res) => {
    const associationId = req.affiliateInvitationSubject?.associationId;
    if (!associationId) {
      res.status(TOKEN_REJECTION_STATUS).json(TOKEN_REJECTION_BODY);
      return;
    }

    const body = req.body as Record<string, unknown>;
    const str = (key: string) =>
      key in body ? (typeof body[key] === 'string' ? (body[key] as string) : null) : undefined;
    const bool = (key: string) => (key in body ? body[key] === true : undefined);

    const result = await saveSignupProfile(db, associationId, {
      legalName: str('legalName'),
      publicHandle: str('publicHandle'),
      email: str('email'),
      phone: str('phone'),
      channelReference: str('channelReference'),
      audienceNiche: str('audienceNiche'),
      audienceSize: str('audienceSize'),
      bio: str('bio'),
      dateOfBirth: str('dateOfBirth'),
      country: str('country'),
      stateRegion: str('stateRegion'),
      confirmAge18Plus: bool('confirmAge18Plus'),
      confirmUsBased: bool('confirmUsBased'),
      confirmActualOperator: bool('confirmActualOperator'),
      confirmNoDuplicateAccounts: bool('confirmNoDuplicateAccounts'),
      confirmSanctionsEligible: bool('confirmSanctionsEligible'),
      actor: 'affiliate:invited',
    });

    if (!result.ok) {
      res.status(400).json({
        error: 'save_refused',
        title: 'That could not be saved',
        whatHappened: result.message,
        next: result.next,
      });
      return;
    }
    res.json({ profile: result.state });
  });

  /** §11's one primary action: `Confirm and create account`. */
  router.post(`${base}/claim`, ...guard, json, async (req, res) => {
    const associationId = req.affiliateInvitationSubject?.associationId;
    const tokenId = req.secureToken?.id;
    if (!associationId || !tokenId) {
      res.status(TOKEN_REJECTION_STATUS).json(TOKEN_REJECTION_BODY);
      return;
    }

    const body = req.body as Record<string, unknown>;
    const accepted = Array.isArray(body['acceptedPolicySlugs'])
      ? (body['acceptedPolicySlugs'] as unknown[]).filter((v): v is string => typeof v === 'string')
      : [];

    const result = await completeAffiliateSignup(db, auth, tokens, {
      associationId,
      tokenId,
      password: typeof body['password'] === 'string' ? (body['password'] as string) : '',
      acceptedPolicySlugs: accepted,
      actor: 'affiliate:invited',
    });

    if (!result.ok) {
      res.status(result.code === 'already_claimed' ? 409 : 400).json({
        error: result.code,
        title: 'Your account was not created',
        whatHappened: result.message,
        next: result.next,
        missing: result.missing ?? [],
      });
      return;
    }

    // §27.4's signup confirmation. Sent after the transaction commits: a
    // message about an account that does not exist is worse than a missing one,
    // and the dedup key makes a retry safe rather than duplicating it.
    await sendSignupConfirmation({ db, notifier, context }, result.associationId);

    // §27.6 (Phase 22b). Admin learns a new Creator account exists; the claim
    // is idempotent and the delivery dedups on the association, so a retry of
    // the whole route sends nothing twice.
    await notifyInvitationClaimed(
      {
        db,
        notifier,
        context,
        ...(internalRecipient ? { internalRecipient } : {}),
      },
      {
        role: 'creator',
        entityType: 'affiliate_association',
        entityId: result.associationId,
        displayName: result.associationId,
      },
    );

    res.status(201).json({
      userId: result.userId,
      campaignId: result.campaignId,
      associationId: result.associationId,
    });
  });

  /**
   * The state behind `Finish payout setup` (§11).
   *
   * A status report and a handoff, never a form. Stripe's hosted onboarding is
   * Phase 10 (§32.1 orders signup first), so today this says `not_started` and
   * says plainly that the step is not open yet — which is true. It does not
   * offer a control that would do nothing, and it does not collect a single
   * banking or identity field.
   */
  router.get(`${base}/payout`, ...guard, async (req, res) => {
    const associationId = req.affiliateInvitationSubject?.associationId;
    if (!associationId) {
      res.status(TOKEN_REJECTION_STATUS).json(TOKEN_REJECTION_BODY);
      return;
    }

    // Ensure rather than read: a Creator who opens the payout panel before
    // touching the form has no profile row yet, and answering that with the
    // token rejection would say "this link is broken" about a link that is
    // fine. The two failures must stay distinguishable to the product even
    // though they are indistinguishable to a caller holding a bad token.
    const profile = await ensureSignupProfile(db, associationId, 'affiliate:invited');
    if (!profile) {
      res.status(TOKEN_REJECTION_STATUS).json(TOKEN_REJECTION_BODY);
      return;
    }

    res.json({
      status: profile.payout.status,
      connectedAccountId: profile.payout.connectedAccountId,
      requirements: profile.payout.requirements,
      updatedAt: profile.payout.updatedAt,
      /** Phase 10 opens this. §1.4: say so rather than render a dead control. */
      onboardingAvailable: false,
    });
  });

  return router;
}
