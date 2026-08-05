import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import path from 'node:path';
import type { Database } from './db/client.js';
import { createHealthRouter } from './routes/health.js';
import { createAuthRouter } from './routes/auth.js';
import { createAdminRouter } from './routes/admin.js';
import { createAdminOperationsRouter } from './routes/admin-operations.js';
import { createAdminSupportRouter } from './routes/admin-support.js';
import { notifyEnforcementRoles } from './support/enforcement-notifications.js';
import { findCampaignFounderUserId } from './reservations/context.js';
import { findAccountForOwner } from './payments/connected-accounts.js';
import { createEnforcementRouter } from './routes/enforcement.js';
import { policyReacceptanceGate } from './enforcement/reacceptance.js';
import { createAdminFoundersRouter } from './routes/admin-founders.js';
import { createAdminAffiliatesRouter } from './routes/admin-affiliates.js';
import { createAffiliateInvitationRouter } from './routes/affiliate-invitation.js';
import { createDraftRouter } from './routes/draft.js';
import { createVettingRouter } from './routes/vetting.js';
import { createCreatorRouter } from './routes/creator.js';
import { createFounderRouter } from './routes/founder.js';
import { createAdminWorkspaceRouter } from './routes/admin-workspace.js';
import { unconfiguredStorage, type ObjectStorage } from './storage/object-storage.js';
import { unconfiguredScheduler, type Scheduler } from './interviews/calcom.js';
import { createCalcomWebhookRouter } from './routes/calcom-webhook.js';
import { createStripeWebhookRouter } from './routes/stripe-webhooks.js';
import { createPayoutRouter } from './routes/payouts.js';
import { createFounderListingRouter } from './routes/founder-listing.js';
import { createAdminListingRouter } from './routes/admin-listing.js';
import { createCreatorDecisionRouter } from './routes/creator-decisions.js';
import { createAttributionRouter } from './routes/attribution.js';
import { createPublicCampaignRouter } from './routes/public-campaign.js';
import { createBackerPreorderRouter } from './routes/backer-preorder.js';
import { createBackerRouter } from './routes/backer.js';
import { createAdminCloseRouter } from './routes/admin-close.js';
import { createAdminRefundsRouter } from './routes/admin-refunds.js';
import {
  createFounderFulfillmentRouter,
  createAdminFulfillmentRouter,
  FOUNDER_FULFILLMENT_BASE_PATH,
  ADMIN_FULFILLMENT_BASE_PATH,
} from './routes/fulfillment.js';
import { createAdminDisputesRouter } from './routes/admin-disputes.js';
import { createFounderRosterRouter } from './routes/founder-roster.js';
import { createAdminDecisionRouter } from './routes/admin-decisions.js';
import {
  createFounderBuildRouter,
  createCreatorReacceptanceRouter,
} from './routes/founder-build.js';
import { createAdminReviewRouter } from './routes/admin-review.js';
import { createAdminLaunchRouter } from './routes/admin-launch.js';
import { createFounderCreatorPaymentRouter } from './routes/founder-creator-payment.js';
import { createAdminCreatorReadinessRouter } from './routes/admin-creator-readiness.js';
import { createFounderHomeRouter } from './routes/founder-home.js';
import { createNotificationsRouter } from './routes/notifications.js';
import {
  createFounderLiveEditRouter,
  createBackerCommentRouter,
  createAdminLiveOpsRouter,
} from './routes/live-editing.js';
import type { StripeGateway } from './payments/stripe-client.js';
import { createAuth, type Auth, type SendResetPassword } from './auth/auth.js';
import { createAuditWriter } from './auth/audit.js';
import { createTokenService, type TokenService } from './auth/token-service.js';
import { createNotifier, type EmailTransport, type Notifier } from './notifications/send.js';
import { sendPasswordReset } from './notifications/customer-remaining.js';
import { unconfiguredTransport } from './notifications/resend-transport.js';
import type { PrerequisiteEnvironment } from './admin/prerequisites.js';
import type { InvitationContext } from './invitations/service.js';

export interface AppConfig {
  appBaseUrl: string;
  nodeEnv: string;
  /** Absolute path to the directory that holds the SPA build. */
  publicDir: string;
  /** Signs Better Auth sessions and reset links. */
  authSecret: string;
  /**
   * §6 Admin setting — reauthentication window. No default anywhere.
   *
   * Better Auth fixes its own `freshAge` at construction, so this is the value
   * it uses for the lifetime of the process. Proovd's own `requireFreshSession`
   * reads `app_settings` per request instead, so an Admin who changes the
   * window sees it apply immediately to Proovd's sensitive actions and on the
   * next restart to Better Auth's. The settings surface says so.
   */
  adminReauthWindowSeconds: number;
  /** Observable facts for the §6 prerequisites panel. */
  prerequisiteEnvironment: PrerequisiteEnvironment;
  /**
   * §27.2 transactional email. Defaults to the transport that refuses loudly:
   * an unconfigured deployment must fail visibly rather than report an
   * invitation as sent when nothing left the building (§1.4).
   */
  emailTransport?: EmailTransport;
  /**
   * §12 uploads (tech-stack §9). Defaults to the port that refuses loudly, for
   * the same reason `emailTransport` does: R2 is Track A4 and is not
   * provisioned, and a no-op would let a Founder see "visual uploaded" while no
   * bucket exists — earning a US$2 discount for a file that is not there (§1.4).
   */
  objectStorage?: ObjectStorage;
  /**
   * §12's booking provider (tech-stack §12). Defaults to the port that refuses
   * loudly: Cal.com is Track A4, and an unconfigured deployment must render no
   * embed rather than an empty frame, and must accept no webhook rather than
   * any webhook (§1.4).
   */
  interviewScheduler?: Scheduler;
  /**
   * §32.2's Stripe client. Unlike the other three ports this has no
   * "unconfigured" default — `env.ts` has always required the keys, so a running
   * process always has one. The suite injects its own to drive signatures, mode
   * separation, and idempotent replay without a network.
   */
  stripeGateway?: StripeGateway;
  /**
   * §32.2's Connect return/refresh URLs. Absent means hosted onboarding cannot
   * be offered, and the surfaces say so rather than issuing a link Stripe would
   * bounce (§1.4).
   */
  stripeConnectUrls?: { returnUrl: string; refreshUrl: string };
  /** §7 / §27.8 addresses and origins the invitation is built from. */
  invitationContext: InvitationContext;
  /**
   * §27.6's staffed inbox. Deliberately NOT `invitationContext.supportEmail` —
   * that is the customer-facing address in §27.8's published block, and an
   * internal queue notice naming `reservation` or a decline code belongs
   * nowhere near it (§3.1, §25.6). Unset means the §27.6 notices do not send
   * and the Admin queue stays the place the work is visible, which is the
   * honest state rather than a silent no-op (§1.4).
   */
  internalRecipient?: string | undefined;
  /**
   * §28.1 draft-token verification limit. Defaults to the production value;
   * the integration suite raises it because it issues far more verifications
   * from one loopback address than any person would.
   */
  draftVerifyLimit?: number;
  /**
   * The blanket per-address request limit. Defaults to the production value.
   *
   * Configurable only because the integration suite drives an entire Founder
   * journey — dozens of autosaves per person — from one loopback address, and a
   * suite that tripped this would turn unrelated assertions into limiter tests.
   * Nothing in production overrides it.
   */
  globalRateLimit?: number;
  /**
   * §28.1's per-address limit on the credential endpoints (`/api/auth`).
   * Configurable for exactly the same reason as `globalRateLimit`, and set by
   * nothing but the integration suite.
   */
  authRouteLimit?: number;
  /** §5.5 email-link password reset. Injected; the transport arrives later. */
  /**
   * §5.5. Optional since Phase 22b: without one,  sends the reset
   * through the notifier like every other message. The suite supplies one to
   * capture the link without a transport.
   */
  sendResetPassword?: SendResetPassword | undefined;
  /** Founder-only Google sign-in (§5.2). Omitted when unconfigured. */
  google?: { clientId: string; clientSecret: string };
}

export interface ProovdApp {
  app: express.Express;
  auth: Auth;
  tokens: TokenService;
  notifier: Notifier;
}

export function createApp(db: Database, config: AppConfig): ProovdApp {
  const app = express();

  // ── Auth (§5) ──────────────────────────────────────────────────────────────
  // Three account roles through Better Auth; the two account-less surfaces
  // through the token service. Both write to the same immutable audit table.
  const audit = createAuditWriter(db);
  // The notifier is built BEFORE auth (Phase 22b) because §5.5's reset email is
  // the one Better Auth message Proovd sends itself, and it needs a notifier to
  // send through — the dedup, the audit row, and the §27.2 template all live
  // there. `config.sendResetPassword` still wins where it is supplied, which is
  // how the suite captures the link without a transport.
  const notifier = createNotifier({
    db,
    transport: config.emailTransport ?? unconfiguredTransport,
    audit: (event) => audit({ ...event, targetId: event.targetId }),
  });
  const auth = createAuth({
    db,
    baseUrl: config.appBaseUrl,
    secret: config.authSecret,
    adminReauthWindowSeconds: config.adminReauthWindowSeconds,
    sendResetPassword:
      config.sendResetPassword ??
      (async ({ user, url }) => {
        await sendPasswordReset(
          {
            db,
            notifier,
            context: {
              appBaseUrl: config.appBaseUrl,
              supportEmail: config.invitationContext.supportEmail,
              fromAddress: config.invitationContext.fromAddress,
            },
            authSecret: config.authSecret,
          },
          { email: user.email, name: user.name, url },
        );
      }),
    ...(config.google ? { google: config.google } : {}),
  });
  const tokens = createTokenService({ db, audit });

  // ── Security headers ───────────────────────────────────────────────────────
  app.use(helmet());

  // ── Rate limiting ──────────────────────────────────────────────────────────
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: config.globalRateLimit ?? 200,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
    }),
  );

  // ── CORS ───────────────────────────────────────────────────────────────────
  const corsOrigins: string[] =
    config.nodeEnv === 'development'
      ? [config.appBaseUrl, 'http://localhost:5173']
      : [config.appBaseUrl];

  app.use(cors({ origin: corsOrigins, credentials: true }));

  // ── Routes (per-router body parsing — no global express.json()) ────────────
  //
  // DO NOT add app.use(express.json()) here. Phase 10 mounts Stripe webhook
  // routes that need the raw body for signature verification, and Better
  // Auth's handler reads the request stream itself. A global JSON parser
  // consumes the raw body first and breaks both — as a signature failure that
  // looks like a Stripe configuration problem, and as sign-in requests that
  // hang. Each router adds its own body parsing at the correct scope.

  app.use(
    createAuthRouter(auth, {
      ...(config.authRouteLimit !== undefined ? { limit: config.authRouteLimit } : {}),
    }),
  );
  app.use(createHealthRouter(db));
  // Phase 20b (§29.8). "Continued use is suspended until accepted": an
  // authenticated Founder/Creator with an outstanding material policy update
  // answers 403 on their own API prefix, naming the document and where to
  // accept it. Unauthenticated requests pass through unanswered — the routers'
  // own guards fail closed exactly as before — and the acceptance routes live
  // at /api/account/policy-reacceptance, outside both gated prefixes.
  app.use('/api/founder', policyReacceptanceGate(db, auth, 'founder'));
  app.use('/api/creator', policyReacceptanceGate(db, auth, 'affiliate'));
  // Phase 14b (§18, §33.6). Two public, session-less routes: `/c/:code` records
  // a tracking-link click, sets the per-browser attribution cookie, and
  // redirects to the live page; `/api/campaign/:id` returns the Backer-facing
  // view and the attribution the cookie resolves to. Mounted early, before every
  // guarded router and the SPA fallback, because a visitor arriving through a
  // Creator's link carries no session — whoever clicks is a visitor, not an
  // account. The `Secure` cookie attribute is set only on an https origin, so
  // the loopback integration suite still receives the cookies it carries.
  const cookiesSecure = config.appBaseUrl.startsWith('https://');
  app.use(createAttributionRouter({ db, secret: config.authSecret, secure: cookiesSecure }));
  app.use(createPublicCampaignRouter({ db, secret: config.authSecret }));
  // Phase 06 (§6, §26). The first product routes any guard is mounted on:
  // everything under /api/admin requires a session, the admin role, and a
  // registered TOTP factor, and every write additionally requires a recent
  // sign-in.
  app.use(createAdminRouter({ db, auth, environment: config.prerequisiteEnvironment }));
  // Phase 16a (§26.5, §26.6, §31.7, §33.12.4). The reservation and charge
  // ledger with §25.7's permitted export, the money controls read against the
  // Phase 03 ledger columns, the ten §31.7 risk signals, and the general
  // high-impact/override machine Phases 18–20 reuse. Reads are `admin`; the
  // seller-tax-readiness record and every override additionally take the
  // freshness gate, because both are §5.1 high-impact actions.
  app.use(
    createAdminOperationsRouter({
      db,
      auth,
      mode: config.stripeGateway?.mode ?? 'test',
    }),
  );
  // Phase 16b (§26.7, §26.8, §27.8). Support cases with their business-day
  // response promise and daily due/overdue queue, the four-field handoff note,
  // suspend/kill with its complete behaviour, and the read-only timeline
  // composed from records that already exist. Kill/suspend and the
  // relationship-touch log take the freshness gate; the queue and the timeline
  // do not — support is daily work, and a gate on looking teaches an Admin to
  // reauthenticate reflexively.
  //
  // Phase 20b closed 16b's two wiring gaps: the detach account is resolved PER
  // CAMPAIGN (the Founder's own seller account, §24.1 — a static id would
  // detach one Founder's cards against another's account), and §26.7's
  // "notify affected roles" finally has a real sender.
  const launchContext = {
    appBaseUrl: config.appBaseUrl,
    supportEmail: config.invitationContext.supportEmail,
    fromAddress: config.invitationContext.fromAddress,
  };
  app.use(
    createAdminSupportRouter({
      db,
      auth,
      ...(config.stripeGateway
        ? {
            detachPaymentMethod: (input) => config.stripeGateway!.detachPaymentMethod(input),
            resolveConnectedAccount: async (campaignId: string) => {
              const founderUserId = await findCampaignFounderUserId(db, campaignId);
              if (!founderUserId) return null;
              const account = await findAccountForOwner(db, {
                ownerUserId: founderUserId,
                role: 'founder_seller',
                mode: config.stripeGateway!.mode,
              });
              return account?.stripeAccountId ?? null;
            },
          }
        : {}),
      notifyRoles: (input) =>
        notifyEnforcementRoles({ db, notifier, context: launchContext }, input),
      notifier,
      notificationContext: launchContext,
    }),
  );
  // Phase 20b (§29.1–§29.5, §29.8). The affiliate enforcement action with its
  // five-field customer statement and computed appeal deadline, the write-once
  // appeal decision, the §29.1/§29.2 disclosures, the Creator's own view and
  // appeal, and the §29.8 reacceptance requirement + acceptance routes.
  app.use(
    createEnforcementRouter({
      db,
      auth,
      audit,
      notifier,
      notificationContext: launchContext,
    }),
  );
  app.use(
    createAdminFoundersRouter({
      db,
      auth,
      tokens,
      notifier,
      context: config.invitationContext,
    }),
  );
  // Phase 08a (§8, §5.3, §25.4, §33.2.1). Campaign-specific Creator
  // recruitment and the private invitation. Behind the same guards: §33.2.1's
  // "no public signup" is partly the fact that every route that can create an
  // Affiliate is under /api/admin.
  app.use(
    createAdminAffiliatesRouter({
      db,
      auth,
      tokens,
      notifier,
      context: config.invitationContext,
    }),
  );
  // Phase 08b (§11, §33.2.1–33.2.3). The one route a Creator reaches with no
  // account. It takes a token, never an association id, so there is nothing in
  // the request to substitute — see `routes/affiliate-invitation.ts`.
  app.use(
    createAffiliateInvitationRouter({
      db,
      auth,
      tokens,
      notifier,
      context: config.invitationContext,
      ...(config.draftVerifyLimit !== undefined
        ? { verifyLimit: config.draftVerifyLimit }
        : {}),
    }),
  );
  // Phase 06b (§7, §33.1.1). The one route a Founder reaches with no account.
  // It takes a token, never a draft id, so there is nothing in the request to
  // substitute — see `routes/draft.ts`.
  app.use(
    createDraftRouter(db, tokens, {
      ...(config.draftVerifyLimit !== undefined
        ? { verifyLimit: config.draftVerifyLimit }
        : {}),
    }),
  );
  // Phase 07 (§9, §10). The vetting sequence, the possible-creator result, and
  // the account claim — all behind the same draft token, all learning the draft
  // id from the verified subject rather than from the request.
  app.use(
    createVettingRouter(db, auth, tokens, {
      ...(config.draftVerifyLimit !== undefined
        ? { verifyLimit: config.draftVerifyLimit, saveLimit: config.draftVerifyLimit }
        : {}),
      // Phase 08c (§10, §33.1.9). The account claim is the event; this is its
      // consumer. Idempotent, so a failed run costs nothing but a retry.
      handoff: { db, notifier, context: config.invitationContext },
    }),
  );
  // Phase 08c (§10, §31.5, §33.2.4). The signed-in Creator: their campaigns and
  // the preparing Campaign kit, every read of it logged and revocable. Phase 14a
  // adds the §17 first-post URL submission, scoped by session.
  app.use(
    createCreatorRouter(db, auth, audit, config.appBaseUrl, {
      // Phase 22b (§27.6): the first-post submission tells Admin the
      // verification work has arrived. Deduped on the submission row.
      notifier,
      context: launchContext,
      ...(config.internalRecipient ? { internalRecipient: config.internalRecipient } : {}),
    }),
  );
  // Phase 09a (§12, §33.3.1–4). The signed-in Founder's campaign workspace: the
  // five optional items, the evidence that completes them, the interview
  // booking, and the itemised listing fee. First session-bearing Founder
  // routes; every one re-derives the campaign from the caller's own claim.
  const interviewScheduler = config.interviewScheduler ?? unconfiguredScheduler;
  const interviewContext = {
    supportEmail: config.invitationContext.supportEmail,
    fromAddress: config.invitationContext.fromAddress,
  };

  app.use(
    createFounderRouter({
      db,
      auth,
      storage: config.objectStorage ?? unconfiguredStorage,
      scheduler: interviewScheduler,
      notifier,
      context: interviewContext,
      referenceSecret: config.authSecret,
      // Phase 22b (§27.6): the internal counterpart to §12's four Founder
      // messages, which this router has sent since 09b.
      appBaseUrl: config.appBaseUrl,
      ...(config.internalRecipient ? { internalRecipient: config.internalRecipient } : {}),
    }),
  );
  // Phase 09b (§12, tech-stack §12). The booking provider's webhook. Mounts its
  // own raw-body parser, because the signature covers the exact bytes that were
  // sent — the same constraint Phase 10's Stripe endpoints have, and the reason
  // there is still no global `express.json()` above.
  app.use(
    createCalcomWebhookRouter({
      db,
      scheduler: interviewScheduler,
      notifier,
      audit: (event) => audit({ ...event, targetId: event.targetId }),
      context: interviewContext,
      referenceSecret: config.authSecret,
      // Phase 22b (§27.6): a provider-driven reschedule or cancellation moves a
      // US$2 credit and one third of the high-effort classification, and this
      // is the path nobody is watching — the change came from Cal.com and was
      // noticed by a webhook rather than by a person.
      appBaseUrl: config.appBaseUrl,
      ...(config.internalRecipient ? { internalRecipient: config.internalRecipient } : {}),
      ...(config.globalRateLimit !== undefined ? { limit: config.globalRateLimit } : {}),
    }),
  );
  // Phase 09a (§12 Admin, §25.6). Every item, its evidence, the discount line,
  // the high-effort inputs, the fee, interview state, invalidation history, and
  // the recorded override.
  app.use(createAdminWorkspaceRouter({ db, auth }));
  // Phase 12b (§14.4, §15). The Founder's parallel campaign build, the review
  // submission gated on derived `review_ready`, the preview that collects no
  // payment, and the Creator's materiality reacceptance; Admin's review,
  // roster finalization, and the general materiality machine. No Stripe
  // dependency, so mounted with the other session routes.
  // Phase 22b: §15's review round finally speaks. All four messages dedup on
  // the review ROW, so a resubmission is owed its own receipt.
  const reviewNotify = {
    notifier,
    notificationContext: launchContext,
    ...(config.internalRecipient ? { internalRecipient: config.internalRecipient } : {}),
  };
  app.use(createFounderBuildRouter({ db, auth, audit, ...reviewNotify }));
  app.use(createCreatorReacceptanceRouter({ db, auth, audit }));
  app.use(createAdminReviewRouter({ db, auth, audit, ...reviewNotify }));
  // Phase 14a (§17, §29.6, §33.4.5–9). The coordinated launch (page → links),
  // Admin first-post verification with its three outcomes, and the required-
  // Creator-failure replacement window. No Stripe dependency for the launch or
  // the verification; the §29.6 miss-path refund runs in the scheduled sweep,
  // which has the gateway. Mounted with the other session routes.
  app.use(createAdminLaunchRouter({ db, auth, audit, notifier, context: launchContext }));
  // Phase 17a (§20, §33.6.6–8). The Founder's chronological campaign home:
  // Glance, one ranked Act, and Explore. `GET .../home` advances nothing;
  // `POST .../home/seen` is the acknowledgement that moves last-seen, which is
  // §20's "only after the rendered state is successfully delivered". No Stripe
  // dependency — it reads records every earlier phase already wrote.
  app.use(
    createFounderHomeRouter({ db, auth, audit, notifier, notificationContext: launchContext }),
  );
  // Phase 17b (§20, §15, §33.6.12). One Founder edit route, and §20's tier
  // register decides what it does: written now with version history, routed to
  // Admin as a change request, or refused outright. A route per tier would let a
  // caller pick which rules apply by picking a URL.
  app.use(createFounderLiveEditRouter({ db, auth, audit }));
  // Phase 22c (§27.7). The digest preference and the notification history, one
  // router mounted three times with the audience bound at construction — an
  // `?audience=` parameter would let a Creator ask for the Founder view. The
  // Admin mount additionally carries §27.2's preview, which reports rather than
  // refuses (see `notifications/preview.ts`). None of them writes a read-state:
  // §27.7 forbids the history becoming a dashboard, and a read receipt is the
  // first thing an unread badge would be computed from.
  app.use(createNotificationsRouter({ db, auth, audit }, 'founder'));
  app.use(createNotificationsRouter({ db, auth, audit }, 'affiliate'));
  app.use(createNotificationsRouter({ db, auth, audit }, 'admin'));
  // Phase 17b (§20, §18, §33.6.13). Admin decides change requests and comment
  // flags, and adds a Creator mid-campaign. Writes take the freshness gate.
  app.use(
    createAdminLiveOpsRouter({
      db,
      auth,
      audit,
      // Phase 22b: §20's ten mid-campaign notices.
      notifier,
      notificationContext: launchContext,
      ...(config.internalRecipient ? { internalRecipient: config.internalRecipient } : {}),
    }),
  );
  // Phase 21a (§22.4–§22.7). Fulfillment and its four obligations, the two
  // §22.6 delivery-change paths, the Day 14 Progress Check, and the one-strike
  // ghost ban. The Founder and Admin read the SAME §22.4 checklist — one
  // function, two routes — and every Admin decision takes the freshness gate.
  app.use(
    FOUNDER_FULFILLMENT_BASE_PATH,
    createFounderFulfillmentRouter({
      db,
      auth,
      audit,
      notifier,
      notificationContext: launchContext,
      tokens,
    }),
  );
  app.use(
    ADMIN_FULFILLMENT_BASE_PATH,
    createAdminFulfillmentRouter({
      db,
      auth,
      audit,
      notifier,
      notificationContext: launchContext,
      tokens,
    }),
  );
  // Phase 10a (§32.3, §28.3). Two Stripe endpoints with two signing secrets —
  // platform for Proovd's own listing money, Connect for the Founder's campaign
  // money (§24.1). Both mount raw-body parsing themselves, for the reason the
  // note above this block has stated since Phase 01.
  if (config.stripeGateway) {
    // Phase 11 (§13, §24.6). The listing notifications ride the platform
    // webhook: effect 7 sends after the seven-effect transaction commits.
    const listingContext = {
      appBaseUrl: config.appBaseUrl,
      supportEmail: config.invitationContext.supportEmail,
      fromAddress: config.invitationContext.fromAddress,
    };
    app.use(
      createStripeWebhookRouter({
        db,
        gateway: config.stripeGateway,
        audit: (event) => audit({ ...event, targetId: event.targetId }),
        notifier,
        notificationContext: listingContext,
        // Phase 22b: §27.6's funding notices go to the staffed inbox, never to
        // the published support address (§3.1).
        ...(config.internalRecipient ? { internalRecipient: config.internalRecipient } : {}),
        // Phase 18a: the payment_intent.* handlers mint the Backer magic link
        // for the receipt/recovery messages.
        tokens,
        ...(config.globalRateLimit !== undefined ? { limit: config.globalRateLimit } : {}),
      }),
    );
    // Phase 11 (§13, §31.6, §33.3.5, §33.3.11). The Founder's listing payment:
    // the pre-payment state, the Checkout session for the consented A.5 total,
    // and the cancellation decision.
    app.use(
      createFounderListingRouter({
        db,
        auth,
        gateway: config.stripeGateway,
        audit: (event) => audit({ ...event, targetId: event.targetId }),
        notifier,
        context: listingContext,
        ...(config.stripeConnectUrls ? { connectUrls: config.stripeConnectUrls } : {}),
      }),
    );
    // Phase 11 (§13 Admin, §33.3.6, §33.3.8). Listing reconciliation, the exact
    // clocks, the idempotent direct refund, and cancellation decisions — reads
    // behind requireAdmin, money and decisions behind requireFreshSession.
    app.use(
      createAdminListingRouter({
        db,
        auth,
        gateway: config.stripeGateway,
        audit: (event) => audit({ ...event, targetId: event.targetId }),
        notifier,
        context: listingContext,
      }),
    );
    // Phase 10b (§13, §11). Stripe-hosted onboarding for both roles, the return
    // and refresh landings, Admin reconciliation, and the §11 tax-accountability
    // record that gates Phase 19's Transfers. No route here accepts a bank, tax,
    // or identity field — the absence is the enforcement.
    app.use(
      createPayoutRouter({
        db,
        auth,
        gateway: config.stripeGateway,
        audit: (event) => audit({ ...event, targetId: event.targetId }),
        ...(config.stripeConnectUrls ?? {}),
      }),
    );
    // Phase 12a (§14.2, §14.5, §33.2.5–13). The Creator's three formal
    // decisions and the immutable proposal versions; the Founder's roster view
    // and response; Admin's overview and mediation reject. Behind the same
    // role guards as their Phase 08c/09a/06a siblings.
    app.use(
      createCreatorDecisionRouter({
        db,
        auth,
        audit,
        notifier,
        context: listingContext,
      }),
    );
    app.use(
      createFounderRosterRouter({
        db,
        auth,
        audit,
        notifier,
        context: listingContext,
      }),
    );
    app.use(createAdminDecisionRouter({ db, auth, audit }));
    // Phase 13 (§16, §24.7, §33.4.3, §33.4.4). The optional fixed Creator
    // payment as a fourth money stream — the Founder funds the exact accepted
    // amount, and no Creator begins work until every applicable §16 readiness
    // item is complete. Admin verifies each item, sets the funding deadline,
    // and schedules the one campaign_live_at. Behind the Stripe gateway because
    // the connected-account readiness item and the funding Checkout both need it.
    app.use(
      createFounderCreatorPaymentRouter({
        db,
        auth,
        gateway: config.stripeGateway,
        audit: (event) => audit({ ...event, targetId: event.targetId }),
        appBaseUrl: config.appBaseUrl,
      }),
    );
    app.use(
      createAdminCreatorReadinessRouter({
        db,
        auth,
        gateway: config.stripeGateway,
        audit: (event) => audit({ ...event, targetId: event.targetId }),
        // Phase 22b: §27.3's funding request, sent when the deadline is set.
        notifier,
        notificationContext: launchContext,
        ...(config.internalRecipient ? { internalRecipient: config.internalRecipient } : {}),
      }),
    );
    // Phase 15 (§19, §33.5). The public Backer pre-order: a card save that
    // charges nothing, the atomic §2.2 cap, reservation-time tax, and the
    // magic-link confirmation. Public and session-less (§5.4) — mounted with the
    // Stripe gateway because the SetupIntent, Customer, and tax all need it.
    app.use(
      createBackerPreorderRouter({
        db,
        gateway: config.stripeGateway,
        audit,
        tokenService: tokens,
        notifier,
        secret: config.authSecret,
        appBaseUrl: config.appBaseUrl,
        fromAddress: config.invitationContext.fromAddress,
        // Phase 17a: §20's threshold crossing is evaluated on every pre-order,
        // because each crossing notifies once and a sweep alone would miss a
        // cross-and-recross between two runs.
        notificationContext: launchContext,
      }),
    );
    // Phase 15b (§19, §20, §33.7). The Backer magic-link surface: the page data,
    // §20 cancellation with reference-safe detach, and the §19 Idea reward change.
    // Behind requireMagicLinkToken; the raw token is redacted in logs.
    app.use(
      createBackerRouter({
        db,
        tokens,
        gateway: config.stripeGateway,
        audit,
        notifier,
        secret: config.authSecret,
        appBaseUrl: config.appBaseUrl,
        fromAddress: config.invitationContext.fromAddress,
        // Phase 17a: a cancellation can take an Idea campaign back below its
        // threshold, and §20 makes that its own notified crossing.
        notificationContext: launchContext,
      }),
    );
    // Phase 17b (§18). The comment thread — the last piece of §18, and it waited
    // for the Backer identity and magic-link session Phase 15 mints. Behind the
    // same token guard; the campaign comes from the token subject, never the
    // body, so a link for one campaign cannot post to another.
    app.use(createBackerCommentRouter({ db, tokens, audit }));
    // Phase 18b (§21, §33.7.12). Admin's close operations: the visibly
    // recoverable batch queue, resume (the same idempotent machine the sweep
    // runs), §21 reconciliation records, and results preparation — the one
    // sender of `Results ready` (§33.7.11). Reads are `admin`; resume,
    // reconciliation, and results take the freshness gate.
    app.use(
      createAdminCloseRouter({
        db,
        auth,
        audit,
        gateway: config.stripeGateway,
        notifier,
        notificationContext: launchContext,
        tokens,
      }),
    );
    // Phase 20a (§24.8, §24.9, §33.9.2–6). Admin's refund operations: the case
    // queue with the Founder-issued refunds awaiting classification, recording
    // the §24.8 cause allocation, the §26.6 customer-consequence preview, and
    // the execution under the stable per-case key. Reads are `admin`; the
    // money decisions take the freshness gate.
    app.use(
      createAdminRefundsRouter({
        db,
        auth,
        audit,
        gateway: config.stripeGateway,
        notifier,
        notificationContext: launchContext,
        tokens,
      }),
    );
    // Phase 20b (§24.11, §33.9.7). Admin's dispute operations: the queue with
    // its overdue 24-hour tasks first, the assembled evidence packet, the
    // recorded assembly, and the §24.8 classification through 20a's register.
    app.use(
      createAdminDisputesRouter({
        db,
        auth,
        audit,
        gateway: config.stripeGateway,
        notifier,
        notificationContext: launchContext,
      }),
    );
  }

  // ── SPA fallback ──────────────────────────────────────────────────────────
  // /api/* routes go above. Everything else returns index.html so the SPA
  // router handles it. In development the Vite dev server serves instead;
  // in production the built frontend is at backend/public/.
  app.use(express.static(config.publicDir));

  app.use((_req, res) => {
    const indexPath = path.join(config.publicDir, 'index.html');
    res.sendFile(indexPath, (err) => {
      if (err) {
        res.status(404).json({ error: 'Not found' });
      }
    });
  });

  return { app, auth, tokens, notifier };
}
