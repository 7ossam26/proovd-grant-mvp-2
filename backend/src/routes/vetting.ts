/**
 * The Founder's vetting and account-claim routes — Spec §9, §10, §28.1.
 *
 * Every route here is reached with a draft token and nothing else. The draft id
 * comes from the *verified subject*, never from the request, so there is no id
 * to substitute and no second Founder's record these routes could be argued
 * into serving (§33.1.1). That is the same shape `routes/draft.ts` established;
 * this file extends it from reading to writing.
 *
 * ── Two limiters, because the two shapes of traffic are different ───────────
 * §28.1 requires rate limiting on token verification, and every request below
 * verifies. But a person filling in a form autosaves far more often than a
 * person opens a link, and one limit for both would either let a keyspace sweep
 * through or cut a Founder off mid-sentence — which §9 explicitly forbids
 * ("a failed save never clears valid fields" is not much comfort if the save
 * can never succeed again). So the autosave routes get their own, higher limit,
 * and both answer with the ordinary token rejection rather than a 429: a
 * limiter that announces itself is the same enumeration oracle in a hat.
 *
 * ── The server re-decides everything the surface decided ────────────────────
 * The claim route re-checks submission, the possible-creator gate, the
 * representations, and the policy acceptances even though the surface will not
 * offer the button without them. §1.1 requires server-side authorization; a
 * hidden or disabled control is not one.
 */

import { Router, type RequestHandler } from 'express';
import express from 'express';
import type { Database } from '../db/client.js';
import type { Auth } from '../auth/auth.js';
import type { TokenService } from '../auth/token-service.js';
import { requireDraftToken, createTokenVerifyLimiter } from '../auth/token-middleware.js';
import { TOKEN_REJECTION_STATUS, TOKEN_REJECTION_BODY } from '../auth/token-rejection.js';
import { DRAFT_TOKEN_PATH, TOKEN_PARAM } from '../auth/token-routes.js';
import {
  ensureVetting,
  saveVetting,
  submitVetting,
  readPossibleCreatorSignal,
  viewCreatorSignal,
  type CampaignTypeValue,
  type VettingStep,
} from '../vetting/service.js';
import {
  ensureClaimProfile,
  saveClaimProfile,
  completeClaim,
  FOUNDER_CLAIM_POLICY_SLUGS,
} from '../vetting/claim.js';
import { policyVersions } from '../db/schema/policies.js';
import { inArray } from 'drizzle-orm';
import { revealPreparingCampaign, type HandoffDeps } from '../affiliates/handoff.js';
import { notifyInvitationClaimed } from '../notifications/operational.js';

/**
 * The autosave allowance. Generous for a person typing into a debounced form
 * over an hour, still bounded — and it is per address, so it never becomes a
 * way to keep a token alive by hammering it (`verify` counts failures itself).
 */
export const DRAFT_SAVE_LIMIT = 600;

export function createVettingRouter(
  db: Database,
  auth: Auth,
  tokens: TokenService,
  options: {
    verifyLimit?: number;
    saveLimit?: number;
    /**
     * §10's Affiliate handoff, run after a successful claim. Optional so the
     * router can be built without a notifier in contexts that never claim —
     * absent means the reveal is Admin's to trigger, which it is anyway.
     */
    handoff?: HandoffDeps;
    /** Phase 22b: §27.6's new-account notice. Unset → it does not send. */
    internalRecipient?: string | undefined;
  } = {},
): Router {
  const handoff = options.handoff;
  const internalRecipient = options.internalRecipient;
  const router = Router();
  const json: RequestHandler = express.json({ limit: '128kb' });

  const openLimiter = createTokenVerifyLimiter({
    limit: options.verifyLimit ?? 20,
    windowMs: 15 * 60 * 1000,
  });
  const saveLimiter = createTokenVerifyLimiter({
    limit: options.saveLimit ?? DRAFT_SAVE_LIMIT,
    windowMs: 15 * 60 * 1000,
  });

  const draft = requireDraftToken(tokens);
  const base = `${DRAFT_TOKEN_PATH}/:${TOKEN_PARAM}`;

  /** The draft id, or the standard rejection. Never an id from the request. */
  function draftIdOf(req: express.Request, res: express.Response): string | null {
    const id = req.draftSubject?.campaignDraftId;
    if (!id) {
      res.status(TOKEN_REJECTION_STATUS).json(TOKEN_REJECTION_BODY);
      return null;
    }
    return id;
  }

  /**
   * The actor for everything a draft holder does.
   *
   * There is no account yet, so the honest answer is "whoever holds this
   * draft's link". Writing an invented user id here would put a person into the
   * audit trail who does not exist.
   */
  const actorOf = (draftId: string): string => `draft:${draftId}`;

  /* ── §9 — the vetting sequence ─────────────────────────────────────────── */

  router.get(`${base}/vetting`, openLimiter, draft, async (req, res) => {
    const draftId = draftIdOf(req, res);
    if (!draftId) return;

    const state = await ensureVetting(db, draftId, actorOf(draftId));
    if (!state) {
      res.status(TOKEN_REJECTION_STATUS).json(TOKEN_REJECTION_BODY);
      return;
    }
    res.json(state);
  });

  router.patch(`${base}/vetting`, saveLimiter, draft, json, async (req, res) => {
    const draftId = draftIdOf(req, res);
    if (!draftId) return;

    const body = req.body as Record<string, unknown>;
    const str = (key: string): string | null | undefined =>
      key in body
        ? typeof body[key] === 'string'
          ? (body[key] as string)
          : body[key] === null
            ? null
            : undefined
        : undefined;

    const result = await saveVetting(db, draftId, {
      ...(('selectedType' in body)
        ? { selectedType: (body['selectedType'] as CampaignTypeValue | null) ?? null }
        : {}),
      ...(str('problem') !== undefined ? { problem: str('problem') } : {}),
      ...(str('solution') !== undefined ? { solution: str('solution') } : {}),
      ...(str('competition') !== undefined ? { competition: str('competition') } : {}),
      ...(typeof body['resumeStep'] === 'string'
        ? { resumeStep: body['resumeStep'] as VettingStep }
        : {}),
      actor: actorOf(draftId),
    });

    if (!result.ok) {
      // 422, never 5xx: the server read the request and decided. The autosave
      // vocabulary treats a decision as a stop, not as something to retry —
      // saying `retrying` over a refusal would be §1.4 in miniature.
      res.status(422).json({
        error: 'save_rejected',
        title: 'That was not saved',
        whatHappened: result.message,
        next: result.next,
      });
      return;
    }

    res.json(result.state);
  });

  router.post(`${base}/vetting/submit`, saveLimiter, draft, json, async (req, res) => {
    const draftId = draftIdOf(req, res);
    if (!draftId) return;

    const result = await submitVetting(db, draftId, actorOf(draftId));
    if (!result.ok) {
      res.status(422).json({
        error: 'submit_rejected',
        title: 'That was not submitted',
        whatHappened: result.message,
        next: result.next,
        ...(result.missing ? { missing: result.missing } : {}),
      });
      return;
    }

    res.status(201).json(result.state);
  });

  /* ── §10 — the possible-creator result ─────────────────────────────────── */

  router.get(`${base}/creator-signal`, openLimiter, draft, async (req, res) => {
    const draftId = draftIdOf(req, res);
    if (!draftId) return;

    const state = await ensureVetting(db, draftId, actorOf(draftId));
    if (!state) {
      res.status(TOKEN_REJECTION_STATUS).json(TOKEN_REJECTION_BODY);
      return;
    }

    // §10 puts this after valid vetting. Before that there is nothing to be a
    // signal about, and answering anyway would leak the shape of the record.
    if (!state.submittedAt) {
      res.status(409).json({
        error: 'vetting_not_submitted',
        title: 'This step is not open yet',
        whatHappened: 'Your answers have not been submitted.',
        next: 'Finish the four questions first.',
      });
      return;
    }

    const view = viewCreatorSignal(await readPossibleCreatorSignal(db, state.campaignId));

    // The count and nothing else. Never the basis, never who recorded it, never
    // a Creator — §10: "It names no Creator." The basis is Proovd's internal
    // reasoning and belongs in Admin.
    res.json({
      status: view.status,
      count: view.count,
      recordedAt: view.recordedAt,
      submittedAt: state.submittedAt,
    });
  });

  /* ── §10 — the account claim ───────────────────────────────────────────── */

  router.get(`${base}/claim`, openLimiter, draft, async (req, res) => {
    const draftId = draftIdOf(req, res);
    if (!draftId) return;

    const profile = await ensureClaimProfile(db, draftId, actorOf(draftId));
    if (!profile) {
      res.status(TOKEN_REJECTION_STATUS).json(TOKEN_REJECTION_BODY);
      return;
    }

    const versions = await db
      .select({
        slug: policyVersions.slug,
        route: policyVersions.route,
        title: policyVersions.title,
        version: policyVersions.version,
        status: policyVersions.status,
      })
      .from(policyVersions)
      .where(inArray(policyVersions.slug, [...FOUNDER_CLAIM_POLICY_SLUGS]));

    res.json({
      profile,
      // §10's acceptances, with the version each would cite. A document still in
      // draft is reported as such rather than hidden: the Founder is entitled to
      // know why the button is not there (§27.1).
      policies: FOUNDER_CLAIM_POLICY_SLUGS.map((slug) => {
        const row = versions.find((v) => v.slug === slug);
        return {
          slug,
          route: row?.route ?? null,
          title: row?.title ?? slug,
          version: row?.version ?? null,
          status: row?.status ?? 'missing',
        };
      }),
    });
  });

  router.patch(`${base}/claim`, saveLimiter, draft, json, async (req, res) => {
    const draftId = draftIdOf(req, res);
    if (!draftId) return;

    const body = req.body as Record<string, unknown>;
    const has = (key: string) => key in body;
    const str = (key: string) =>
      typeof body[key] === 'string' ? (body[key] as string) : null;
    const bool = (key: string) => body[key] === true;

    const result = await saveClaimProfile(db, draftId, {
      ...(has('legalName') ? { legalName: str('legalName') } : {}),
      ...(has('preferredName') ? { preferredName: str('preferredName') } : {}),
      ...(has('email') ? { email: str('email') } : {}),
      ...(has('phone') ? { phone: str('phone') } : {}),
      ...(has('dateOfBirth') ? { dateOfBirth: str('dateOfBirth') } : {}),
      ...(has('country') ? { country: str('country') } : {}),
      ...(has('stateRegion') ? { stateRegion: str('stateRegion') } : {}),
      ...(has('soleProprietor')
        ? { soleProprietor: body['soleProprietor'] === null ? null : bool('soleProprietor') }
        : {}),
      ...(has('businessName') ? { businessName: str('businessName') } : {}),
      ...(has('businessEntityType') ? { businessEntityType: str('businessEntityType') } : {}),
      ...(has('representationUsPerson') ? { representationUsPerson: bool('representationUsPerson') } : {}),
      ...(has('representationAge18Plus') ? { representationAge18Plus: bool('representationAge18Plus') } : {}),
      ...(has('representationSanctions') ? { representationSanctions: bool('representationSanctions') } : {}),
      actor: actorOf(draftId),
    });

    if (!result.ok) {
      res.status(422).json({
        error: 'save_rejected',
        title: 'That was not saved',
        whatHappened: result.message,
        next: result.next,
      });
      return;
    }

    res.json(result.state);
  });

  router.post(`${base}/claim`, saveLimiter, draft, json, async (req, res) => {
    const draftId = draftIdOf(req, res);
    if (!draftId) return;

    const tokenId = req.secureToken?.id;
    if (!tokenId) {
      res.status(TOKEN_REJECTION_STATUS).json(TOKEN_REJECTION_BODY);
      return;
    }

    const body = req.body as Record<string, unknown>;
    const accepted = Array.isArray(body['acceptedPolicySlugs'])
      ? (body['acceptedPolicySlugs'] as unknown[]).filter((v): v is string => typeof v === 'string')
      : [];

    const result = await completeClaim(db, auth, tokens, {
      draftId,
      tokenId,
      ...(typeof body['password'] === 'string' ? { password: body['password'] } : {}),
      ...(typeof body['googleUserId'] === 'string'
        ? { googleUserId: body['googleUserId'] }
        : {}),
      acceptedPolicySlugs: accepted,
      actor: actorOf(draftId),
    });

    if (!result.ok) {
      res.status(422).json({
        error: result.code,
        title: 'Your account was not created',
        whatHappened: result.message,
        next: result.next,
        ...(result.missing ? { missing: result.missing } : {}),
      });
      return;
    }

    // §10's Affiliate handoff. Runs after the claim transaction commits, for
    // the same reason the signup confirmation does: revealing a campaign whose
    // Founder account did not actually get created would grant access on the
    // strength of an event that did not happen.
    //
    // It is idempotent by construction, so a crash between the commit and this
    // line costs nothing — Admin can run it again and every Creator already
    // revealed is skipped by their idempotency key. That is why this is not
    // inside the transaction: holding a row lock across an email provider call
    // would be a much more expensive way to be no safer.
    // §27.6 (Phase 22b). The same after-the-transaction posture: the claim has
    // committed, the delivery dedups on the draft, and a failure here is not
    // allowed to turn a successful claim into an error the Founder sees.
    if (handoff) {
      try {
        await notifyInvitationClaimed(
          {
            db,
            notifier: handoff.notifier,
            context: handoff.context,
            ...(internalRecipient ? { internalRecipient } : {}),
          },
          {
            role: 'founder',
            // The campaign, which is claimed exactly once (the idempotency key
            // and the conditional draft claim both guarantee it) and is what
            // the result carries.
            entityType: 'campaign_draft',
            entityId: result.campaignId,
            displayName: result.campaignId,
          },
        );
      } catch {
        /* An internal queue notice must never break a customer's claim. */
      }
    }
    if (handoff) {
      try {
        await revealPreparingCampaign(handoff, result.campaignId);
      } catch {
        // The Founder's account exists and their claim succeeded. A handoff
        // failure is Admin's to retry, and must not turn a successful claim
        // into an error the Founder sees.
      }
    }

    // The raw token is now dead (§10: "invalidates the draft token"). The
    // response says so, so the surface stops offering to reload a link that
    // will render the unusable-link page from here on.
    res.status(201).json({ ok: true, campaignId: result.campaignId });
  });

  return router;
}
