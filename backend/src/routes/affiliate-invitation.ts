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
 * true rather than a promise.
 *
 * §33.2.2 also tested "no tour", and Creator Flow v2's deviation 1 is what
 * departs from that half by explicit product direction — see
 * `docs/phases/creator-flow-v2.md`. What did NOT change is everything this
 * paragraph is about: the two actions are still two, and the absence of a
 * banking route is still the enforcement.
 *
 * ── Two writes Session C added, and no upload route ─────────────────────────
 * `PUT …/voice` and `PUT …/metrics` record screens 4 and 6 into 0055's two
 * insert-only tables. Neither is a primary action — both are the same autosave
 * the PATCH above is, addressed separately because they write append-only rows
 * rather than columns.
 *
 * There is deliberately no presign and no upload route for the photo or the
 * evidence screenshots: §12's object storage is Track A4, `unconfiguredStorage`
 * throws rather than pretending, and the GET below reports `available: false`
 * so the surface renders a named absence instead of a dead control (§1.4).
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
import {
  readCreatorVoice,
  readCreatorMetrics,
  recordCreatorVoice,
  recordCreatorMetrics,
  permittedMetricsFor,
} from '../affiliates/creator-profile.js';
import { sendSignupConfirmation } from '../affiliates/signup-notification.js';
import { unconfiguredStorage, type ObjectStorage } from '../storage/object-storage.js';
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
  /**
   * Track A4. Read for its `configured` flag and for nothing else — there is
   * no upload route here to presign against, and adding one is what would make
   * screen 5's and screen 6's named absences into dead controls.
   */
  objectStorage?: ObjectStorage;
}

export function createAffiliateInvitationRouter({
  db,
  auth,
  tokens,
  notifier,
  context,
  verifyLimit,
  internalRecipient,
  objectStorage,
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
  const storage = objectStorage ?? unconfiguredStorage;

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

    // 0055's two insert-only records. Read in the same call as everything
    // else, because five screens each fetching their own slice would be five
    // shapes of one record and the first field two of them both render is the
    // first place they disagree.
    const [voice, metrics] = await Promise.all([
      readCreatorVoice(db, associationId),
      readCreatorMetrics(db, associationId),
    ]);

    res.json({
      landing,
      profile,
      conditional,
      policies,
      voice,
      metrics,
      /**
       * Which of the nine §5.3 figures this Creator's own channel is asked
       * for. Sent rather than derived in the browser so the question a Creator
       * answers and the set the write accepts come from one place.
       */
      metricsAsked: permittedMetricsFor(profile.channelSubtype ?? ''),
      /**
       * Track A4, stated rather than implied. The surface renders the reason
       * where an upload control would be; a `false` here with no route behind
       * it is the honest shape (§1.4).
       */
      uploads: { available: storage.configured },
    });
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
      channelType: str('channelType'),
      audienceNiche: str('audienceNiche'),
      audienceSize: str('audienceSize'),
      nicheDescription: str('nicheDescription'),
      outreachPlan: str('outreachPlan'),
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

  /**
   * Screen 4's tone set (0055).
   *
   * A PUT rather than a PATCH because the SET is the answer: dropping a chip is
   * expressed by sending the remaining ones, and a merge would make removal
   * unrepresentable. The record supersedes rather than edits, so each PUT is a
   * new row and the previous answer survives.
   */
  router.put(`${base}/voice`, ...guard, json, async (req, res) => {
    const associationId = req.affiliateInvitationSubject?.associationId;
    if (!associationId) {
      res.status(TOKEN_REJECTION_STATUS).json(TOKEN_REJECTION_BODY);
      return;
    }

    const body = req.body as Record<string, unknown>;
    const strings = (key: string): string[] =>
      Array.isArray(body[key])
        ? (body[key] as unknown[]).filter((v): v is string => typeof v === 'string')
        : [];

    const result = await recordCreatorVoice(db, associationId, {
      tones: strings('tones'),
      customTones: strings('customTones'),
      flexible: body['flexible'] === true,
      actor: 'affiliate:invited',
    });

    if (!result.ok) {
      res.status(400).json({
        error: 'voice_refused',
        title: 'That could not be saved',
        whatHappened: result.message,
        next: result.next,
      });
      return;
    }
    res.json({ voice: await readCreatorVoice(db, associationId) });
  });

  /**
   * Screen 6's channel figures (0055).
   *
   * One row per metric, so a blank value RETIRES that metric's row and inserts
   * nothing — 0055 requires a non-blank value, and "I would rather not say" is
   * the absence of a live row rather than an empty one (§16a).
   */
  router.put(`${base}/metrics`, ...guard, json, async (req, res) => {
    const associationId = req.affiliateInvitationSubject?.associationId;
    if (!associationId) {
      res.status(TOKEN_REJECTION_STATUS).json(TOKEN_REJECTION_BODY);
      return;
    }

    const raw = (req.body as Record<string, unknown>)['values'];
    const values: Record<string, string> = {};
    if (raw && typeof raw === 'object') {
      for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof value === 'string') values[key] = value;
      }
    }

    const result = await recordCreatorMetrics(db, associationId, {
      values,
      actor: 'affiliate:invited',
    });

    if (!result.ok) {
      res.status(400).json({
        error: 'metrics_refused',
        title: 'That could not be saved',
        whatHappened: result.message,
        next: result.next,
      });
      return;
    }
    res.json({ metrics: await readCreatorMetrics(db, associationId) });
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
