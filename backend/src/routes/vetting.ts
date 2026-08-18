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
 * The claim route re-checks submission, the representations, and the policy
 * acceptances even though the surface will not offer the button without them.
 * §1.1 requires server-side authorization; a hidden or disabled control is
 * not one.
 */

import { Router, type RequestHandler } from 'express';
import express from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import type { Database } from '../db/client.js';
import type { Auth } from '../auth/auth.js';
import type { TokenService } from '../auth/token-service.js';
import {
  requireDraftToken,
  createTokenVerifyLimiter,
  createTokenResendLimiter,
} from '../auth/token-middleware.js';
import {
  TOKEN_REJECTION_STATUS,
  TOKEN_REJECTION_BODY,
  sendTokenRejection,
} from '../auth/token-rejection.js';
import { DRAFT_TOKEN_PATH, TOKEN_PARAM } from '../auth/token-routes.js';
import {
  ensureVetting,
  saveVetting,
  submitVetting,
  readPossibleCreatorSignal,
  viewCreatorSignal,
  type VettingResumePosition,
  type CampaignTypeValue,
} from '../vetting/service.js';
import {
  ensureClaimProfile,
  saveClaimProfile,
  completeClaim,
  FOUNDER_CLAIM_POLICY_SLUGS,
} from '../vetting/claim.js';
import {
  EMAIL_CODE_ACK,
  requestFounderEmailCode,
  verifyFounderEmailCode,
  type EmailCodeDeps,
} from '../vetting/email-code.js';
import {
  unconfiguredTranscription,
  TRANSCRIPTION_UNAVAILABLE,
  type Transcription,
} from '../transcription/index.js';
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
    /**
     * The six-digit email code's sender (Founder Flow v2 Session C).
     *
     * Optional, and absent means the route still answers its frozen ack and
     * sends nothing — the same shape every notifier-less context in this
     * product takes. What it must never do is answer differently.
     */
    emailCode?: (EmailCodeDeps & {
      audit: (event: {
        action: string;
        targetType: 'campaign_draft';
        targetId: string;
        internalReason: string;
      }) => Promise<void>;
    }) | undefined;
    /**
     * Dictation (deviation 2). Defaults to the port that refuses loudly, so a
     * deployment with no provider says so rather than reporting a recording
     * as transcribed when nothing left the browser (§1.4).
     */
    transcription?: Transcription | undefined;
    /**
     * How many code requests one address may make per hour.
     *
     * Its own option because it is its own kind of traffic: this route SENDS
     * MAIL, so the production default is the tight resend limit rather than
     * the verify one — five an hour covers a person whose first mail landed in
     * spam and does not cover a script. The suite raises it, and drives the
     * limiter itself on a harness that leaves it alone.
     */
    emailCodeLimit?: number | undefined;
  } = {},
): Router {
  const handoff = options.handoff;
  const internalRecipient = options.internalRecipient;
  const emailCode = options.emailCode;
  const transcription = options.transcription ?? unconfiguredTranscription;
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
    /*
     * The dictation port travels with the read, and the reason is the
     * Affiliate evidence uploader's: a 503 at the point of use arrives after
     * somebody has already pressed record. Carrying `available: false` here
     * lets the screen render the absence with its reason instead of a
     * microphone that refuses (§1.4). It is a fact about the deployment
     * rather than about this draft, which is why it is a sibling of the
     * state and not a field on it.
     */
    res.json({
      ...state,
      transcription: transcription.configured
        ? { available: true as const }
        : { available: false as const, absentBecause: TRANSCRIPTION_UNAVAILABLE },
    });
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
      ...(str('problem') !== undefined ? { problem: str('problem') } : {}),
      ...(str('solution') !== undefined ? { solution: str('solution') } : {}),
      ...(str('competition') !== undefined ? { competition: str('competition') } : {}),
      // §9 step 1 is the Founder's own again (2026-08-18). Admin's route stays
      // beside it; whichever writes last is what submission locks, and the
      // history records each with the supplier that actually wrote it.
      ...(str('selectedType') !== undefined
        ? { selectedType: str('selectedType') as CampaignTypeValue | null }
        : {}),
      ...(typeof body['resumeStep'] === 'string'
        ? { resumeStep: body['resumeStep'] as VettingResumePosition }
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

  /* ── §5.2 — the six-digit email code (Founder Flow v2, Session C) ──────── */

  /**
   * A RECORDED §1 rule 6 deviation. `shared/src/vetting/email-code.ts` is the
   * record, `vetting/email-code.ts` the service.
   *
   * ── Ask for a code ────────────────────────────────────────────────────────
   * Answers `EMAIL_CODE_ACK` for every outcome — an address on the profile, no
   * address, a provider that refuses, and a caller over the limit — and answers
   * it BEFORE doing the work, because minting-and-sending against returning
   * immediately is measurable even when the bodies match. `magic-link-reissue`
   * is the worked example and this is the same shape.
   *
   * 202, never a 429. Phase 04's rule, and the one that most often gets
   * "corrected" by somebody who thinks a limiter should announce itself: a 429
   * on the fifth try tells the caller the first four were interesting.
   */
  router.post(
    `${base}/email-code`,
    /*
     * The RESEND limiter, not the verify one: this route sends mail, so an
     * unthrottled one is a way to use Proovd to flood an inbox — §5.5’s own
     * reasoning, and the same limiter the magic-link resend takes. A person
     * legitimately asks twice (the first landed in spam, or they fixed a typo
     * in the address), and five an hour covers that without covering a script.
     *
     * Its handler answers the ordinary ack at 202 rather than the token
     * rejection, because on this route the ack IS the ordinary answer.
     */
    createTokenResendLimiter({
      ...(options.emailCodeLimit !== undefined ? { limit: options.emailCodeLimit } : {}),
      handler: (_req, res) => {
        res.status(202).json(EMAIL_CODE_ACK);
      },
    }),
    draft,
    json,
    async (req, res) => {
      const draftId = draftIdOf(req, res);
      if (!draftId) return;

      const state = await ensureVetting(db, draftId, actorOf(draftId));
      if (!state) {
        res.status(TOKEN_REJECTION_STATUS).json(TOKEN_REJECTION_BODY);
        return;
      }

      // Answer first. Everything below is what a hit does and a miss does not.
      res.status(202).json(EMAIL_CODE_ACK);

      if (!emailCode) return;
      try {
        await requestFounderEmailCode(emailCode, {
          draftId,
          campaignId: state.campaignId,
        });
      } catch (error) {
        // The response is already out, so this can only be recorded. It must
        // not surface: an error path that behaved differently would be the
        // oracle the route is built to avoid.
        await emailCode.audit({
          action: 'founder.email_code_send_failed',
          targetType: 'campaign_draft',
          targetId: draftId,
          internalReason: `§5.2 email code send failed: ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        });
      }
    },
  );

  /**
   * Check a code.
   *
   * One rejection for wrong, expired, already-used, locked-out, never-requested
   * and requested-for-a-different-address — the frozen `TOKEN_REJECTION_BODY`
   * at `TOKEN_REJECTION_STATUS`, padded to the same floor so the modes are not
   * separable by a stopwatch either. The limiter answers that same body at that
   * same status: 202 would be the ask route's answer, and a 202 here would tell
   * a caller their code had been accepted.
   */
  router.post(
    `${base}/email-code/verify`,
    // Deliberately tighter than the ask. This is the route a guessing attack
    // uses, and `failed_attempts` on the row is the other half of the answer.
    createTokenVerifyLimiter({ limit: options.verifyLimit ?? 20, windowMs: 15 * 60 * 1000 }),
    draft,
    json,
    async (req, res) => {
      const startedAt = Date.now();
      const draftId = draftIdOf(req, res);
      if (!draftId) return;

      const body = (req.body ?? {}) as Record<string, unknown>;
      const code = typeof body['code'] === 'string' ? body['code'] : '';

      const result = await verifyFounderEmailCode({ db, tokens }, { draftId, code });
      if (!result.ok) {
        await sendTokenRejection(res, startedAt);
        return;
      }

      // The whole of what a success returns. No session, no account, no token —
      // the surface re-reads the claim profile and finds `code_verified` there.
      res.json({ verified: true });
    },
  );

  /* ── §12 — dictation (Founder Flow v2 deviation 2, Session C) ──────────── */

  /**
   * Turns a recording into text, and does nothing else.
   *
   * The configured check runs BEFORE any body parser, so an unconfigured
   * deployment refuses without buffering the audio it is about to refuse. The
   * refusal is the port's own sentence — one constant, so the reason on the
   * screen and the reason in the log cannot disagree.
   *
   * Nothing here writes the audio anywhere. There is no column for it, no
   * bucket key, and no job: §25.8 defines seven retention windows and none
   * covers a dictation recording, so the honest answer is to have nowhere to
   * put it rather than to invent a window (§1 rule 6, in the other direction).
   * The transcript goes back in the response and lands in the Founder's own
   * textarea as ordinary editable text with supplier `founder` — which is what
   * keeps §9's "never represented as AI-generated" true on the Positioning
   * step, because nothing generated it.
   */
  router.post(
    `${base}/transcribe`,
    openLimiter,
    draft,
    (_req, res, next) => {
      if (transcription.configured) return next();
      res.status(503).json({
        error: 'transcription_unavailable',
        title: 'Dictation is not available',
        whatHappened: TRANSCRIPTION_UNAVAILABLE,
        next: 'Type your answer in the box. It is the same box either way, and it saves as you go.',
        owner: 'Proovd',
      });
    },
    express.raw({ type: ['audio/*'], limit: '10mb' }),
    async (req, res) => {
      const draftId = draftIdOf(req, res);
      if (!draftId) return;

      const audio = Buffer.isBuffer(req.body) ? req.body : null;
      if (!audio || audio.length === 0) {
        res.status(400).json({
          error: 'no_audio',
          title: 'We did not receive a recording',
          whatHappened: 'The request carried no audio, so there was nothing to turn into text.',
          next: 'Record again, or type your answer instead.',
        });
        return;
      }

      const result = await transcription.transcribe({
        audio,
        contentType: req.headers['content-type'] ?? 'audio/webm',
      });
      // The transcript, and nothing derived from it. There is no summary field
      // here and no route that would produce one (§12, §30).
      res.json({ text: result.text });
    },
  );

  /* ── §10 — the possible-creator result ─────────────────────────────────── */

  /**
   * Restored 2026-08-18 with the rest of the §9/§10 reversion.
   *
   * §10 places it "immediately after valid vetting and before account creation",
   * which is where the flow puts the screen — and it does NOT gate the claim,
   * so nothing downstream reads this route's answer. A Founder whose result is
   * unrecorded proceeds; they simply do not see the screen.
   *
   * `viewCreatorSignal` collapses zero and unrecorded into one answer before
   * anything is serialized, so there is no branch here that could tell them
   * apart and no field in the response that varies between them.
   */
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
        next: 'Finish the three questions first.',
      });
      return;
    }

    res.json(
      viewCreatorSignal(
        // §31.9's "possible-creator rendering" stamp: this is one of the two
        // Founder-facing reads that may set it, because this is the Founder
        // actually being shown the number.
        await readPossibleCreatorSignal(db, state.campaignId, { stampRendered: true }),
      ),
    );
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

    /**
     * The Google identity comes from the SESSION, never from the body.
     *
     * This route used to read `body.googleUserId` and pass it straight to
     * `completeClaim`, which then bound the draft — and the campaign — to
     * whatever user id it was handed. A caller holding a draft link could
     * therefore attach that campaign to somebody else's Founder account by
     * typing their id into the request: the server took a user id as PROOF of
     * an identity, which is the one thing a request body can never be.
     *
     * Nothing shipped used it. No Proovd surface renders a Google button and
     * no test exercised the branch, so it was reachable only by calling the
     * API directly — which is exactly the case that has to hold.
     *
     * Now the caller proves it: they must be carrying a real Better Auth
     * session, and the id used is the one on that session. `getSession` fails
     * closed — an unreadable session yields no id, and the claim then falls
     * through to the password path and refuses if no password was supplied.
     */
    let sessionUserId: string | null = null;
    if (body['useGoogle'] === true || typeof body['googleUserId'] === 'string') {
      try {
        const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
        sessionUserId = session?.user?.id ?? null;
      } catch {
        sessionUserId = null;
      }
    }

    const result = await completeClaim(db, auth, tokens, {
      draftId,
      tokenId,
      ...(typeof body['password'] === 'string' ? { password: body['password'] } : {}),
      ...(sessionUserId ? { googleUserId: sessionUserId } : {}),
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
