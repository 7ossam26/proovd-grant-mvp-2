/**
 * The signed-in Founder's workspace — Spec §12, §5.2, §33.3.1–4.
 *
 * The first session-bearing routes for a Founder. Everything before this phase
 * happened behind a draft token, with no account; §10's claim created one, and
 * from here a Founder arrives with a session.
 *
 * ── Every route is scoped by the session, not by the parameter ──────────────
 * `requireRole(auth, 'founder')` establishes who is asking, and
 * `findFounderCampaign` re-derives the campaign from the caller's own claim
 * profile inside the query. A campaign belonging to someone else answers 404 —
 * the same answer as one that does not exist — so nothing can be enumerated.
 * That check runs on every route including the reads, because §1.1 requires
 * server-side authorization on every surface and a read of another Founder's
 * unreleased product information is the same breach as a write.
 *
 * ── No second factor ───────────────────────────────────────────────────────
 * §5.2 gives the Founder "email + password or Google sign-in". Requiring a
 * factor the Spec does not ask for would lock out every Founder who claimed an
 * account in Phase 07, and inventing an authentication policy is as much a §1
 * rule 6 violation as inventing a commercial one.
 *
 * §5.1 used to make one Admin's rule; that layer was removed on 2026-08-10 by
 * product direction (see `auth/auth.ts`). Nothing here changes — this route
 * never had one.
 *
 * What this prefix DOES carry, mounted in `app.ts` ahead of every route below:
 * the §29.8 policy-reacceptance gate and the §26.7/§22.7 standing gate, both
 * decided per request so a suspension or a ban reaches a session that already
 * exists rather than waiting for it to expire.
 *
 * ── What is deliberately absent ────────────────────────────────────────────
 * There is no route that sets an item complete, no route that sets the fee, and
 * no route that accepts a file body. The first two are the §12 trap — an item
 * that completes because the Founder clicked "done" defeats the discount — and
 * the third is tech-stack §9: the browser PUTs to R2, and nothing in this
 * process ever holds the bytes.
 */

import { Router } from 'express';
import express from 'express';
import type { Database } from '../db/client.js';
import type { Auth } from '../auth/auth.js';
import type { AuditWriter } from '../auth/audit.js';
import { requireRole } from '../auth/guards.js';
import { readOpenness, recordOpenness } from '../campaign/openness.js';
import {
  readFounderDetails,
  saveFounderDetails,
  type FounderDetailsPatch,
} from '../vetting/details.js';
import type { ObjectStorage } from '../storage/object-storage.js';
import type { Scheduler } from '../interviews/calcom.js';
import { interviewReference } from '../interviews/reference.js';
import {
  notifyInterview,
  type InterviewNotificationContext,
} from '../interviews/notifications.js';
import { notifyInterviewChanged } from '../notifications/internal-queue.js';
import type { Notifier } from '../notifications/send.js';
import {
  ensureWorkspace,
  findFounderCampaign,
  listFounderCampaigns,
  saveWorkspace,
  evaluateWorkspace,
  type WorkspacePatch,
} from '../workspace/service.js';
import { readFounderWorkspace } from '../workspace/projection.js';
import { requestUpload, verifyUpload, setAssetApproval, removeAsset } from '../workspace/uploads.js';
import {
  addSocialProfile,
  recheckSocialProfile,
  removeSocialProfile,
  setSocialControlConfirmation,
} from '../workspace/socials.js';
import {
  recordBooking,
  confirmBooking,
  rescheduleBooking,
  cancelBooking,
} from '../workspace/interview.js';
import { MEETING_PROVIDERS, type MeetingProvider } from '../workspace/registry.js';
import {
  unconfiguredTranscription,
  TRANSCRIPTION_UNAVAILABLE,
  type Transcription,
} from '../transcription/index.js';

export const FOUNDER_PATH = '/api/founder';

export interface FounderRouterConfig {
  db: Database;
  auth: Auth;
  /** Defaults to the transport that refuses loudly (Track A4 is open). */
  storage: ObjectStorage;
  /** §12's booking provider. Also refuses loudly while unconfigured. */
  scheduler: Scheduler;
  notifier: Notifier;
  context: InterviewNotificationContext;
  /**
   * Keys the campaign reference the embed carries. `BETTER_AUTH_SECRET`,
   * domain-separated — see `interviews/reference.ts`.
   */
  referenceSecret: string;
  /**
   * §27.6's internal interview notice needs an Admin link and an inbox, and
   * `InterviewNotificationContext` is the Founder's context, which carries
   * neither (Phase 22b). Both optional: without them the Founder still gets
   * their own message and the change stays visible in the workspace.
   */
  appBaseUrl?: string | undefined;
  internalRecipient?: string | undefined;
  /**
   * Dictation on the Story step (Founder Flow v2 deviation 2, Session D).
   * Defaults to the port that refuses loudly, so a deployment with no
   * provider says so rather than reporting a recording as transcribed when
   * nothing left the browser.
   */
  transcription?: Transcription | undefined;
  /**
   * §25.6's writer, for the one write in this router that records a decision
   * rather than a draft (Session F's fixed-payment openness). Optional so the
   * suites that build this router for the §12 workspace alone need no change;
   * without it the openness route records the row and no audit event, which is
   * a deployment that cannot happen rather than a default to tune.
   */
  audit?: AuditWriter | undefined;
}

/**
 * The audit writer this router falls back to.
 *
 * It THROWS rather than swallowing: §1.3 makes manual work valid only when the
 * app records it, and a decision recorded with no audit event is exactly the
 * hole that rule exists to close. A deployment that wired this router without a
 * writer fails on the first openness answer instead of quietly losing every
 * one of them — the `unconfiguredTransport` posture, applied to §25.6.
 */
const noopAudit: AuditWriter = () => {
  throw new Error('the Founder router was built without an audit writer (§25.6)');
};

/** §27.1: a refusal says what happened and what to do next. */
function notFound(res: express.Response): void {
  res.status(404).json({
    error: 'not_found',
    title: 'Campaign not found',
    whatHappened: 'We could not find that campaign on your account.',
    next: 'Go back to your campaigns. If you think this is wrong, contact support.',
    support: '/support',
  });
}

export function createFounderRouter(config: FounderRouterConfig): Router {
  const { db, auth, storage, scheduler, notifier, context, referenceSecret } = config;
  const audit = config.audit ?? noopAudit;
  const router = Router();
  const founder = requireRole(auth, 'founder');
  const json = express.json({ limit: '256kb' });
  const transcription = config.transcription ?? unconfiguredTranscription;

  const actorId = (req: express.Request) => `user:${req.authUser?.id ?? ''}`;

  /**
   * §27.6's internal interview notice, deduped on the event row (Phase 22b).
   * Sends nothing where §27.6 has no inbox configured.
   */
  async function noticeInterviewChange(eventId: string | undefined): Promise<void> {
    if (!eventId || !config.appBaseUrl || !config.internalRecipient) return;
    await notifyInterviewChanged(
      {
        db,
        notifier,
        context: { ...context, appBaseUrl: config.appBaseUrl },
        internalRecipient: config.internalRecipient,
      },
      { eventId },
    );
  }

  /**
   * Resolves the campaign or answers 404, and guarantees the workspace exists.
   *
   * Every route calls it, and the campaign id it returns is the one used
   * downstream — never the raw parameter, so a route cannot act on an unchecked
   * id. `ensureWorkspace` is here rather than in each handler because every
   * route below ends in an evaluation, and an evaluation with no rows to
   * evaluate is a 500 where a Founder expected a saved file. It is idempotent,
   * so calling it on every request costs one conflicting insert.
   */
  async function resolve(
    req: express.Request,
    res: express.Response,
  ): Promise<string | null> {
    const campaign = await findFounderCampaign(db, {
      campaignId: String(req.params['campaignId'] ?? ''),
      founderUserId: req.authUser?.id ?? '',
    });
    if (!campaign) {
      notFound(res);
      return null;
    }
    await ensureWorkspace(db, { campaignId: campaign.campaignId, actor: actorId(req) });
    return campaign.campaignId;
  }

  async function respond(res: express.Response, campaignId: string): Promise<void> {
    const view = await readFounderWorkspace(db, {
      campaignId,
      uploadsAvailable: storage.configured,
      transcriptionAvailable: transcription.configured,
      // The reference is minted per response and handed only to the
      // authenticated Founder of this campaign. It binds whatever they book to
      // this campaign and nothing else — see `interviews/reference.ts`.
      ...(scheduler.configured
        ? {
            interviewEmbed: {
              eventTypeLink: scheduler.eventTypeLink,
              reference: interviewReference(campaignId, referenceSecret),
            },
          }
        : {}),
    });
    res.json({ workspace: view });
  }

  /* ── The fixed-payment openness (screen 18, Session F) ─────────────────── */

  /**
   * §14.3's two base percentages and the live answer, or the reason there is
   * none to give.
   *
   * The percentages are read from the §6 settings on every request rather than
   * carried in the register: Phase 06's rule is that a hardcoded number is a bug
   * even when it is right, and these two are the whole subject of the screen.
   */
  router.get(
    `${FOUNDER_PATH}/campaigns/:campaignId/fixed-payment-openness`,
    founder,
    async (req, res) => {
      const campaignId = await resolve(req, res);
      if (!campaignId) return;

      const view = await readOpenness(db, campaignId);
      if (!view) {
        // §9 locks the type at submission, and a campaign that has not reached
        // that point has nothing to be open about. Saying which is §1.4's job.
        res.status(409).json({
          error: 'type_not_locked',
          title: 'Your campaign type is not settled yet',
          whatHappened:
            'This question only applies once your campaign type is locked, which happens when you submit your answers.',
          next: 'Finish your answers first. Nothing here is lost.',
        });
        return;
      }
      res.json({ openness: view });
    },
  );

  /**
   * Records the answer, and records nothing else.
   *
   * No amount, no percentage, no proposal version — the table has no column for
   * any of them, and §16 makes the terms the Creator's to propose and both
   * sides' to accept. An Idea campaign is refused by name here and by CHECK and
   * trigger regardless (§14.3).
   *
   * Registered in §33.12.5's `UNGATED_ADMIN_WRITES`? No — this is a FOUNDER
   * route, and that register is about `/api/admin`. It sits behind the Founder
   * guard, the §29.8 reacceptance gate and the §26.7 standing gate, like every
   * other write in this router.
   */
  router.put(
    `${FOUNDER_PATH}/campaigns/:campaignId/fixed-payment-openness`,
    founder,
    json,
    async (req, res) => {
      const campaignId = await resolve(req, res);
      if (!campaignId) return;

      const result = await recordOpenness(db, audit, {
        campaignId,
        stance: String((req.body as Record<string, unknown>)?.['stance'] ?? ''),
        actor: actorId(req),
      });

      if (!result.ok) {
        res.status(result.code === 'not_found' ? 404 : 422).json({
          error: result.code,
          title: 'That answer could not be recorded',
          whatHappened: result.message,
          next: 'Nothing about your campaign has changed.',
        });
        return;
      }
      res.json({ openness: result.view });
    },
  );

  /* ── Dictation on the Story step (deviation 2, Session D) ──────────────── */

  /**
   * The same port, the same refusal, behind the Founder guard instead.
   *
   * `POST /api/draft/:token/transcribe` (Session C) is the Positioning step's,
   * and it cannot serve this one: §10's claim invalidated that token on the way
   * here, so by the time a Founder reaches the Story step there is no draft
   * address left. The alternative — keeping the draft token alive past the
   * claim so one route could serve both — would undo §10's own guarantee for
   * the convenience of one microphone.
   *
   * Everything that keeps deviation 2 narrow is unchanged, because it is a
   * property of the PORT rather than of either route: one method, no generate,
   * no summarize, no rewrite, no suggest; and the audio is not kept — there is
   * no column for it, no bucket key, and no job, because §25.8 defines seven
   * retention windows and none covers a dictation recording.
   *
   * The configured check runs BEFORE the body parser, so an unconfigured
   * deployment refuses without first buffering the ten megabytes it is about to
   * refuse — `unconfiguredStorage` and `unconfiguredScheduler`'s posture,
   * applied to a request that is large by nature.
   */
  router.post(
    `${FOUNDER_PATH}/campaigns/:campaignId/transcribe`,
    founder,
    (_req, res, next) => {
      if (transcription.configured) return next();
      res.status(503).json({
        error: 'transcription_unavailable',
        title: 'Dictation is not available',
        whatHappened: TRANSCRIPTION_UNAVAILABLE,
        next: 'Type your story in the box. It is the same box either way, and it saves as you go.',
        owner: 'Proovd',
      });
    },
    express.raw({ type: ['audio/*'], limit: '10mb' }),
    async (req, res) => {
      const campaignId = await resolve(req, res);
      if (!campaignId) return;

      const audio = Buffer.isBuffer(req.body) ? req.body : null;
      if (!audio || audio.length === 0) {
        res.status(400).json({
          error: 'no_audio',
          title: 'We did not receive a recording',
          whatHappened: 'The request carried no audio, so there was nothing to turn into text.',
          next: 'Record again, or type your story instead.',
        });
        return;
      }

      const result = await transcription.transcribe({
        audio,
        contentType: req.headers['content-type'] ?? 'audio/webm',
      });
      // The transcript, and nothing derived from it (§12, §30). §12 also makes
      // the Founder's APPROVAL the completing act for Story, so this text lands
      // in the box as an unapproved draft exactly like typing would — which is
      // what "a transcript does not count" means in practice.
      res.json({ text: result.text });
    },
  );

  /* ── The Founder's campaigns ────────────────────────────────────────────── */

  router.get(`${FOUNDER_PATH}/campaigns`, founder, async (req, res) => {
    const rows = await listFounderCampaigns(db, req.authUser?.id ?? '');
    res.json({
      campaigns: rows.map((row) => ({
        campaignId: row.campaignId,
        status: row.status,
        type: row.type,
        listingPaid: row.listingPaidAt !== null,
        highEffort: row.highEffort,
      })),
    });
  });

  /* ── Your details (screen 16) ───────────────────────────────────────────── */

  /**
   * The three facts the reference's `[data-hello]` page shows and collects.
   *
   * A read of its own rather than three more fields on the workspace: the
   * workspace read is §12's campaign record and this is the Founder's own
   * account record, and folding a person's phone number and date of birth into
   * the payload five other pages already fetch would put them on the wire on
   * every autosave (§25.5).
   */
  router.get(`${FOUNDER_PATH}/campaigns/:campaignId/details`, founder, async (req, res) => {
    const campaignId = await resolve(req, res);
    if (!campaignId) return;
    const details = await readFounderDetails(db, { campaignId });
    if (!details) {
      notFound(res);
      return;
    }
    res.json({ details });
  });

  /**
   * Autosave, on §9's rule: a key absent from the body writes nothing, so
   * saving a phone number cannot blank a date of birth given on another visit.
   */
  router.patch(
    `${FOUNDER_PATH}/campaigns/:campaignId/details`,
    founder,
    json,
    async (req, res) => {
      const campaignId = await resolve(req, res);
      if (!campaignId) return;

      const body = req.body as Record<string, unknown>;
      const patch: { phone?: string | null; dateOfBirth?: string | null } = {};
      const text = (key: string) =>
        typeof body[key] === 'string' || body[key] === null
          ? (body[key] as string | null)
          : undefined;

      const phone = text('phone');
      if (phone !== undefined) patch.phone = phone;
      const dob = text('dateOfBirth');
      if (dob !== undefined) patch.dateOfBirth = dob;

      const result = await saveFounderDetails(db, {
        campaignId,
        actor: actorId(req),
        patch: patch as FounderDetailsPatch,
      });
      if (!result.ok) {
        res
          .status(result.code === 'not_found' ? 404 : 400)
          .json({ title: 'We could not save that', whatHappened: result.message });
        return;
      }
      res.json({ details: result.details });
    },
  );

  /* ── The workspace ──────────────────────────────────────────────────────── */

  /**
   * Opening the workspace creates it. Idempotent, and the first evaluation runs
   * here so the fee preview has a calculation to show on the first visit rather
   * than appearing only after the first edit.
   */
  router.get(`${FOUNDER_PATH}/campaigns/:campaignId/workspace`, founder, async (req, res) => {
    const campaignId = await resolve(req, res);
    if (!campaignId) return;

    await ensureWorkspace(db, { campaignId, actor: actorId(req) });
    await evaluateWorkspace(db, {
      campaignId,
      actor: actorId(req),
      trigger: 'workspace_opened',
    });
    await respond(res, campaignId);
  });

  /**
   * Autosave. §12: "autosave, save recovery".
   *
   * The patch carries only the keys the request sent; `undefined` means "not in
   * this request" (§9's rule, restated in `saveWorkspace`). Nothing here can set
   * an item complete — the evaluation that runs inside the same transaction
   * decides that from the content.
   */
  router.patch(
    `${FOUNDER_PATH}/campaigns/:campaignId/workspace`,
    founder,
    json,
    async (req, res) => {
      const campaignId = await resolve(req, res);
      if (!campaignId) return;

      const body = req.body as Record<string, unknown>;
      const patch: WorkspacePatch = {};
      const text = (key: string) =>
        typeof body[key] === 'string' || body[key] === null
          ? (body[key] as string | null)
          : undefined;

      const colors = text('brandColors');
      if (colors !== undefined) patch.brandColors = colors;
      const typography = text('brandTypography');
      if (typography !== undefined) patch.brandTypography = typography;
      const notes = text('brandNotes');
      if (notes !== undefined) patch.brandNotes = notes;
      const story = text('storyText');
      if (story !== undefined) patch.storyText = story;
      if (typeof body['resumeStep'] === 'string') patch.resumeStep = body['resumeStep'];
      if (typeof body['brandApproved'] === 'boolean') patch.brandApproved = body['brandApproved'];
      if (typeof body['storyApproved'] === 'boolean') patch.storyApproved = body['storyApproved'];

      await ensureWorkspace(db, { campaignId, actor: actorId(req) });
      await saveWorkspace(db, { campaignId, actor: actorId(req), patch });
      await respond(res, campaignId);
    },
  );

  /* ── Uploads (tech-stack §9) ────────────────────────────────────────────── */

  /**
   * Issues a presigned PUT for exactly one object.
   *
   * The response is a URL and the headers the browser must send. There is no
   * upload endpoint here and no multipart parser mounted anywhere: the bytes go
   * from the browser to R2 and this process never sees them.
   */
  router.post(
    `${FOUNDER_PATH}/campaigns/:campaignId/uploads`,
    founder,
    json,
    async (req, res) => {
      const campaignId = await resolve(req, res);
      if (!campaignId) return;

      const body = req.body as Record<string, unknown>;
      const purpose = body['purpose'] === 'logo' ? 'logo' : 'visual';

      const result = await requestUpload(db, storage, {
        campaignId,
        purpose,
        contentType: String(body['contentType'] ?? ''),
        byteSize: Number(body['byteSize'] ?? 0),
        checksumSha256: String(body['checksumSha256'] ?? ''),
        ...(typeof body['filename'] === 'string' ? { originalFilename: body['filename'] } : {}),
        actor: actorId(req),
      });

      if (!result.ok) {
        res.status(result.code === 'storage_unavailable' ? 503 : 422).json({
          error: result.code,
          title: 'That file cannot be uploaded',
          whatHappened: result.message,
          next: 'Nothing else on this page has changed. Try a different file.',
        });
        return;
      }

      res.json({
        assetId: result.assetId,
        url: result.url,
        requiredHeaders: result.requiredHeaders,
        expiresAt: result.expiresAt.toISOString(),
      });
    },
  );

  /**
   * Reads the object back and decides what it is (§12's objective check).
   *
   * Called by the browser once its PUT completes. It is not the browser's word
   * that matters — the server fetches the object itself — so a Founder who
   * skips this call simply leaves the asset `pending`, which completes nothing.
   */
  router.post(
    `${FOUNDER_PATH}/campaigns/:campaignId/uploads/:assetId/verify`,
    founder,
    json,
    async (req, res) => {
      const campaignId = await resolve(req, res);
      if (!campaignId) return;

      const result = await verifyUpload(db, storage, {
        assetId: String(req.params['assetId']),
        campaignId,
        actor: actorId(req),
      });

      if (!result) {
        notFound(res);
        return;
      }

      await evaluateWorkspace(db, {
        campaignId,
        actor: actorId(req),
        trigger: 'upload_verified',
      });
      await respond(res, campaignId);
    },
  );

  /** §12: "Founder-approved for campaign use." Its own act, its own route. */
  router.post(
    `${FOUNDER_PATH}/campaigns/:campaignId/uploads/:assetId/approval`,
    founder,
    json,
    async (req, res) => {
      const campaignId = await resolve(req, res);
      if (!campaignId) return;

      const approved = (req.body as Record<string, unknown>)['approved'] === true;
      const ok = await setAssetApproval(db, {
        assetId: String(req.params['assetId']),
        campaignId,
        approved,
        actor: actorId(req),
      });

      if (!ok) {
        notFound(res);
        return;
      }

      await evaluateWorkspace(db, {
        campaignId,
        actor: actorId(req),
        trigger: approved ? 'asset_approved' : 'asset_unapproved',
      });
      await respond(res, campaignId);
    },
  );

  router.delete(
    `${FOUNDER_PATH}/campaigns/:campaignId/uploads/:assetId`,
    founder,
    async (req, res) => {
      const campaignId = await resolve(req, res);
      if (!campaignId) return;

      const ok = await removeAsset(db, {
        assetId: String(req.params['assetId']),
        campaignId,
        actor: actorId(req),
      });
      if (!ok) {
        notFound(res);
        return;
      }

      await evaluateWorkspace(db, { campaignId, actor: actorId(req), trigger: 'asset_removed' });
      await respond(res, campaignId);
    },
  );

  /* ── Socials ────────────────────────────────────────────────────────────── */

  router.post(`${FOUNDER_PATH}/campaigns/:campaignId/socials`, founder, json, async (req, res) => {
    const campaignId = await resolve(req, res);
    if (!campaignId) return;

    const body = req.body as Record<string, unknown>;
    const result = await addSocialProfile(db, {
      campaignId,
      url: String(body['url'] ?? ''),
      controlsConfirmed: body['controlsConfirmed'] === true,
      actor: actorId(req),
    });

    if (!result.ok) {
      res.status(422).json({
        error: result.code,
        title: 'That address cannot be added',
        whatHappened: result.message,
        next: 'Check the address and try again. Nothing else on this page has changed.',
      });
      return;
    }

    await evaluateWorkspace(db, { campaignId, actor: actorId(req), trigger: 'social_added' });
    await respond(res, campaignId);
  });

  router.post(
    `${FOUNDER_PATH}/campaigns/:campaignId/socials/:socialId/recheck`,
    founder,
    json,
    async (req, res) => {
      const campaignId = await resolve(req, res);
      if (!campaignId) return;

      const check = await recheckSocialProfile(db, {
        id: String(req.params['socialId']),
        campaignId,
      });
      if (!check) {
        notFound(res);
        return;
      }

      await evaluateWorkspace(db, { campaignId, actor: actorId(req), trigger: 'social_rechecked' });
      await respond(res, campaignId);
    },
  );

  /**
   * The Founder's own statement that they control the profile.
   *
   * §12 asks for a profile "controlled by the Founder" and Proovd cannot prove
   * it. Recorded as a statement, shown to Admin as a statement (§1.4), and its
   * own control because §28.4 forbids bundling a confirmation into something
   * else.
   */
  router.post(
    `${FOUNDER_PATH}/campaigns/:campaignId/socials/:socialId/control`,
    founder,
    json,
    async (req, res) => {
      const campaignId = await resolve(req, res);
      if (!campaignId) return;

      const ok = await setSocialControlConfirmation(db, {
        id: String(req.params['socialId']),
        campaignId,
        confirmed: (req.body as Record<string, unknown>)['confirmed'] === true,
      });
      if (!ok) {
        notFound(res);
        return;
      }

      await evaluateWorkspace(db, { campaignId, actor: actorId(req), trigger: 'social_confirmed' });
      await respond(res, campaignId);
    },
  );

  router.delete(
    `${FOUNDER_PATH}/campaigns/:campaignId/socials/:socialId`,
    founder,
    async (req, res) => {
      const campaignId = await resolve(req, res);
      if (!campaignId) return;

      const ok = await removeSocialProfile(db, {
        id: String(req.params['socialId']),
        campaignId,
        actor: actorId(req),
      });
      if (!ok) {
        notFound(res);
        return;
      }

      await evaluateWorkspace(db, { campaignId, actor: actorId(req), trigger: 'social_removed' });
      await respond(res, campaignId);
    },
  );

  /* ── The interview ──────────────────────────────────────────────────────── */

  router.post(`${FOUNDER_PATH}/campaigns/:campaignId/interview`, founder, json, async (req, res) => {
    const campaignId = await resolve(req, res);
    if (!campaignId) return;

    const body = req.body as Record<string, unknown>;
    const provider = String(body['meetingProvider'] ?? '');
    const scheduledAt = new Date(String(body['scheduledAt'] ?? ''));

    if (!(MEETING_PROVIDERS as readonly string[]).includes(provider) || Number.isNaN(scheduledAt.getTime())) {
      res.status(422).json({
        error: 'invalid_booking',
        title: 'That booking could not be recorded',
        whatHappened: 'A booking needs a valid time and one of the meeting providers Proovd uses.',
        next: 'Pick a time and try again.',
      });
      return;
    }

    const result = await recordBooking(db, {
      campaignId,
      scheduledAt,
      founderTimezone: String(body['timezone'] ?? 'UTC'),
      meetingProvider: provider as MeetingProvider,
      actor: actorId(req),
      source: 'founder',
    });

    if (!result.ok) {
      res.status(result.code === 'not_bookable' ? 503 : 409).json({
        error: result.code,
        title: 'That booking could not be made',
        whatHappened: result.message,
        next: result.next ?? 'Nothing else on this page has changed.',
        support: '/support',
      });
      return;
    }

    await respond(res, campaignId);
  });

  router.post(
    `${FOUNDER_PATH}/campaigns/:campaignId/interview/:bookingId/reschedule`,
    founder,
    json,
    async (req, res) => {
      const campaignId = await resolve(req, res);
      if (!campaignId) return;

      const body = req.body as Record<string, unknown>;
      const scheduledAt = new Date(String(body['scheduledAt'] ?? ''));
      if (Number.isNaN(scheduledAt.getTime())) {
        res.status(422).json({
          error: 'invalid_booking',
          title: 'That time could not be read',
          whatHappened: 'A reschedule needs a valid time.',
          next: 'Pick a time and try again.',
        });
        return;
      }

      const result = await rescheduleBooking(db, {
        bookingId: String(req.params['bookingId']),
        campaignId,
        scheduledAt,
        actor: actorId(req),
        source: 'founder',
        ...(typeof body['reason'] === 'string' ? { reason: body['reason'] } : {}),
      });

      if (!result.ok) {
        notFound(res);
        return;
      }

      // §12's reschedule notification, after the transaction committed. Keyed
      // on the booking AND the new time, so every move sends and none repeats.
      await notifyInterview(db, notifier, context, {
        bookingId: result.bookingId,
        kind: 'rescheduled',
      });
      await noticeInterviewChange(result.eventId);
      await respond(res, campaignId);
    },
  );

  /**
   * §33.3.3. Cancelling recalculates before payment and cannot after it.
   *
   * Both directions run through `cancelBooking`, which always re-evaluates;
   * §12's lock is what makes the second direction true. There is no branch here
   * that checks whether the fee has been paid, and there must not be — a rule
   * written in a route is a rule the next route forgets.
   */
  router.post(
    `${FOUNDER_PATH}/campaigns/:campaignId/interview/:bookingId/cancel`,
    founder,
    json,
    async (req, res) => {
      const campaignId = await resolve(req, res);
      if (!campaignId) return;

      const reason = String((req.body as Record<string, unknown>)['reason'] ?? '').trim();
      const result = await cancelBooking(db, {
        bookingId: String(req.params['bookingId']),
        campaignId,
        actor: actorId(req),
        source: 'founder',
        reason: reason || 'Canceled by the Founder',
      });

      if (!result.ok) {
        notFound(res);
        return;
      }

      // §12's cancellation notification. The email says whether the listing fee
      // moved, which is a fact only the campaign's state knows — see
      // `interviews/notifications.ts`.
      await notifyInterview(db, notifier, context, {
        bookingId: result.bookingId,
        kind: 'canceled',
      });
      await noticeInterviewChange(result.eventId);
      await respond(res, campaignId);
    },
  );

  /**
   * Confirming a booking. Present because §12's `confirmed` state must be
   * reachable without a webhook — Phase 09's trap about Cal.com being a source
   * of events rather than truth. 09b adds the webhook that calls the same
   * service; this is the path that survives a missed delivery.
   */
  router.post(
    `${FOUNDER_PATH}/campaigns/:campaignId/interview/:bookingId/confirm`,
    founder,
    json,
    async (req, res) => {
      const campaignId = await resolve(req, res);
      if (!campaignId) return;

      const body = req.body as Record<string, unknown>;
      const result = await confirmBooking(db, {
        bookingId: String(req.params['bookingId']),
        campaignId,
        actor: actorId(req),
        source: 'founder',
        ...(typeof body['meetingLink'] === 'string' ? { meetingLink: body['meetingLink'] } : {}),
        ...(typeof body['interviewer'] === 'string' ? { interviewer: body['interviewer'] } : {}),
      });

      if (!result.ok) {
        res.status(result.code === 'incomplete' ? 422 : 404).json({
          error: result.code,
          title: 'That booking could not be confirmed',
          whatHappened: result.message,
          next: 'Contact support and we will finish it with you.',
          support: '/support',
        });
        return;
      }

      await notifyInterview(db, notifier, context, {
        bookingId: result.bookingId,
        kind: 'confirmed',
      });
      await respond(res, campaignId);
    },
  );

  return router;
}
