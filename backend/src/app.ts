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
import { createAccountRouter } from './routes/account.js';
import { policyReacceptanceGate } from './enforcement/reacceptance.js';
import { crossOriginWriteGuard } from './auth/origin-guard.js';
import { creatorStandingGate, founderStandingGate } from './enforcement/standing.js';
import { createAdminFoundersRouter } from './routes/admin-founders.js';
import { createAdminFounderPanelRouter } from './routes/admin-founder-panel.js';
import { createAdminAffiliatesRouter } from './routes/admin-affiliates.js';
import { createAdminCreatorsRouter } from './routes/admin-creators.js';
import { createAdminCampaignsRouter } from './routes/admin-campaigns.js';
import { createAdminBackersRouter } from './routes/admin-backers.js';
import { createAdminTasksRouter } from './routes/admin-tasks.js';
import { createAdminCloseRouter } from './routes/admin-close.js';
import { createAffiliateInvitationRouter } from './routes/affiliate-invitation.js';
import { createDraftRouter } from './routes/draft.js';
import { createVettingRouter } from './routes/vetting.js';
import { createCreatorRouter } from './routes/creator.js';
import { createFounderRouter } from './routes/founder.js';
import { createAdminWorkspaceRouter } from './routes/admin-workspace.js';
import { unconfiguredStorage, type ObjectStorage } from './storage/object-storage.js';
import { unconfiguredScheduler, type Scheduler } from './interviews/calcom.js';
import type { Transcription } from './transcription/index.js';
import { createCalcomWebhookRouter } from './routes/calcom-webhook.js';
import { createStripeWebhookRouter } from './routes/stripe-webhooks.js';
import { createPayoutRouter } from './routes/payouts.js';
import { createFounderListingRouter } from './routes/founder-listing.js';
import { createAdminListingRouter } from './routes/admin-listing.js';
import { createCreatorDecisionRouter } from './routes/creator-decisions.js';
import { createAttributionRouter } from './routes/attribution.js';
import { createPublicCampaignRouter } from './routes/public-campaign.js';
import { createFollowRouter } from './routes/follow.js';
import { createBackerPreorderRouter } from './routes/backer-preorder.js';
import { createBackerRouter } from './routes/backer.js';
import { createAdminLiveModeRouter } from './routes/admin-live-mode.js';
import {
  createFounderFulfillmentRouter,
  createAdminFulfillmentRouter,
  FOUNDER_FULFILLMENT_BASE_PATH,
  ADMIN_FULFILLMENT_BASE_PATH,
} from './routes/fulfillment.js';
import { createAdminDisputesRouter } from './routes/admin-disputes.js';
import { createAdminRefundsRouter } from './routes/admin-refunds.js';
import {
  createAdminCompletionRouter,
  createFounderCompletionRouter,
  createCreatorCompletionRouter,
} from './routes/completion.js';
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
import { createFounderSettingsRouter } from './routes/founder-settings.js';
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
import type { LiveModeEnvironment } from './live-mode/gate.js';
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
  /**
   * How many reverse proxies sit in front of this process, or 0 for none.
   *
   * This is a security control, which is why it has no clever default.
   *
   *  - Set too LOW (0 behind a proxy, the state this app shipped in): every
   *    request keys to the proxy's own address, so `express-rate-limit`'s
   *    per-address limits become one shared global bucket. §28.1's 30
   *    attempts per quarter-hour on `/api/auth` then means thirty for
   *    *everybody*, which is simultaneously useless against a distributed
   *    guesser and a way for one client to lock every real person out of
   *    signing in.
   *  - Set too HIGH (or `true`), every client can spoof `X-Forwarded-For` and
   *    mint a fresh rate-limit bucket per request, which removes the limit
   *    entirely.
   *
   * There is no value that is right without knowing the deployment, so the
   * operator states it (`TRUST_PROXY_HOPS`) and the unset case keeps the
   * over-restrictive behaviour rather than the spoofable one — wrong in the
   * direction that fails closed.
   */
  trustProxyHops: number;
  /** Observable facts the §34 live-mode gate reads about this deployment. */
  liveModeEnvironment: LiveModeEnvironment;
  /**
   * Observable facts for the §6 prerequisites panel.
   *
   * A superset of `liveModeEnvironment` — it additionally carries whether a
   * transactional email provider is configured, which §6 blocks on and §34
   * does not name. Both are produced by one `prerequisiteFacts(env)` call, so
   * the panel and the gate can never disagree about the deployment they are
   * both describing.
   */
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
   * Dictation (Founder Flow v2 deviation 2). Defaults to the port that
   * refuses loudly, exactly as storage and scheduling do: it transcribes and
   * does nothing else, and an unconfigured deployment renders the absence
   * rather than reporting speech as transcribed (§1.4, §12, §30).
   */
  transcription?: Transcription;
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
   * The email code's own hourly allowance (Founder Flow v2 Session C).
   *
   * Separate from `draftVerifyLimit` because this route sends mail, so its
   * production default is the tight resend limit. The suite raises it, except
   * in the one test that drives the limiter.
   */
  emailCodeLimit?: number;
  /**
   * LOCAL DEVELOPMENT ONLY — `INVITATION_LINKS_REUSABLE`, refused at boot in
   * production. Lets a CLAIMED Founder-draft or Creator-invitation link keep
   * opening, so the flow can be walked and re-walked without minting a fresh
   * invitation for every attempt. See `TokenServiceDeps` for exactly what it
   * relaxes, which is two guards and nothing else.
   */
  invitationLinksReusable?: boolean;
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

  // ── Proxy trust (§28.1) ────────────────────────────────────────────────────
  // Set before anything that reads `req.ip` — which is every rate limiter
  // below. Express's own semantics: a NUMBER means "trust exactly this many
  // hops", so a client cannot lengthen the chain by adding its own
  // `X-Forwarded-For` entries. `0` leaves `req.ip` as the socket address,
  // which is correct when nothing is in front of this process.
  //
  // Deliberately never `true`. `trust proxy: true` accepts the left-most
  // forwarded address whoever wrote it, which hands every caller its own
  // rate-limit bucket.
  app.set('trust proxy', config.trustProxyHops);

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
  // Computed here (rather than beside the CORS middleware below) because
  // Better Auth's own origin/CSRF check — independent of Express's CORS
  // middleware — needs the identical list. `http://localhost:5173` is the Vite
  // dev server's origin (vite.config.ts proxies /api to this server), added
  // only outside production for the same reason CORS already special-cases it.
  const corsOrigins: string[] =
    config.nodeEnv === 'development'
      ? [config.appBaseUrl, 'http://localhost:5173']
      : [config.appBaseUrl];

  const auth = createAuth({
    db,
    baseUrl: config.appBaseUrl,
    secret: config.authSecret,
    adminReauthWindowSeconds: config.adminReauthWindowSeconds,
    trustedOrigins: corsOrigins,
    // The same test the attribution cookie uses (`cookiesSecure` below), so
    // the session cookie and the attribution cookie can never disagree about
    // whether this deployment is https.
    useSecureCookies: config.appBaseUrl.startsWith('https://'),
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
  const tokens = createTokenService({
    db,
    audit,
    secret: config.authSecret,
    allowClaimedInvitationReuse: config.invitationLinksReusable ?? false,
  });

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
  //
  // Note what this does NOT do: `cors()` decides which response headers to set,
  // and blocks nothing. A cross-site POST still reaches the handler, and one
  // whose response the attacker never reads is a CSRF that succeeded. The guard
  // below is what refuses it.
  app.use(cors({ origin: corsOrigins, credentials: true }));

  // ── CSRF, second layer (§28.2) ─────────────────────────────────────────────
  // `SameSite=Lax` on the session cookie is the first, and is what actually
  // stops a malicious page attaching it. This refuses a state-changing request
  // whose Origin is present and untrusted — the same idea Better Auth already
  // applies to `/api/auth/*`, extended to the rest of the API. A missing Origin
  // passes: that is a non-browser caller with no ambient cookie to borrow,
  // which includes both signed webhook endpoints. See `auth/origin-guard.ts`.
  app.use(crossOriginWriteGuard(corsOrigins));

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
  // §26.7, §22.7. Account standing decided per request, beside the §29.8
  // reacceptance gate and for the same reason: a suspension or a ban that only
  // changes what the Admin workspace SAYS is not enforcement. Before this, an
  // existing session kept full Founder access until it expired on its own.
  //
  // Mounted AFTER the reacceptance gate so a suspended person who also owes an
  // acceptance is told about the suspension — the one that is not theirs to
  // resolve — rather than being sent to a consent page that would not restore
  // access. Unauthenticated and wrong-role requests pass through untouched.
  app.use('/api/founder', founderStandingGate(db, auth));
  // The same gate for a Creator, added 2026-08-11 by product direction and
  // recorded as a deviation in `enforcement/standing.ts`. It is a reversible
  // standing review and never a ban: §29's association-scoped enforcement is
  // untouched, and there is no permanent Creator sanction in the Spec.
  app.use('/api/creator', creatorStandingGate(db, auth));
  // §5, §1.1. "Who is this session?" — the one read that lets a sign-in form
  // send somebody somewhere without asking them which role they hold. Mounted
  // beside the reacceptance routes and outside both gated prefixes above, for
  // the reason `routes/account.ts` records: a person who owes an acceptance
  // must still be able to reach the surface that takes it.
  app.use(createAccountRouter(auth));
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
  /*
   * The campaign follow (campaign-page-v2 Session C) — a RECORDED DEVIATION
   * from §1 rule 6, built by explicit product direction. Public, like the two
   * routers above it: the ask answers one frozen body for every outcome, and
   * confirm and unfollow are POSTs behind a page so no email scanner can
   * complete a double opt-in or unsubscribe somebody who never clicked.
   */
  app.use(
    createFollowRouter({
      db,
      tokens,
      notifier,
      appBaseUrl: config.appBaseUrl,
      fromAddress: config.invitationContext.fromAddress,
      supportEmail: config.invitationContext.supportEmail,
      audit: (event) => audit({ ...event, targetId: event.targetId }),
    }),
  );
  // Phase 06 (§6, §26). The first product routes any guard is mounted on:
  // everything under /api/admin requires a session and the admin role, and
  // every write additionally requires a recent sign-in.
  app.use(createAdminRouter({ db, auth, environment: config.prerequisiteEnvironment }));
  // Phase 24 (§34, Appendix C). The live-mode gate: the eleven conditions with
  // their filed evidence, the one named pilot enablement and its rollback, the
  // three pre-first-reservation confirmations, and the recorded Appendix C
  // walks. There is no override on it and nowhere to add one — `enablePilot`
  // reads the gate itself, so no request body opens live mode.
  app.use(
    createAdminLiveModeRouter({
      db,
      auth,
      audit,
      environment: config.liveModeEnvironment,
    }),
  );
  // Phase 16a (§26.5, §26.6, §31.7, §33.12.4) and Phase 23b (§31.9). The §26.5
  // ledger with its eleven filters and §25.7 export, the §26.6 nine money-control
  // lines, the ten §31.7 risk signals, the §31.9 first-cohort scoreboard, and the
  // general high-impact/override machine: preview the customer consequences,
  // consume the preview exactly once, and record the override against the prior
  // value read from the row itself.
  //
  // Every read is `admin`; the seller-tax record, the preview, and the execution
  // take the freshness gate, because all three are §5.1 high-impact actions.
  //
  // `mode` is what makes risk and seller-tax readiness mode-scoped (§32.2). It
  // falls back to `test` rather than to the live side: a deployment with no
  // gateway has not configured live money, and the readiness record that gates
  // live tax collection must never be read out of the wrong mode.
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
  // The Founder Admin workspace (§26.1, §26.2) and §7's invitation. The
  // workspace is keyed on the PERSON, so a Founder whose campaign was
  // archived-and-restarted appears once; the §7 invitation routes stay keyed on
  // the draft, because one invitation is a different subject from the person
  // who received it.
  //
  // The Stripe onboarding context is passed only when this deployment has a
  // client. Without it the money pane says Stripe is not configured rather than
  // making a claim about the Founder's payment setup (§1.4, §32.2).
  app.use(
    createAdminFoundersRouter({
      db,
      auth,
      audit,
      tokens,
      notifier,
      context: config.invitationContext,
      ...(config.stripeGateway
        ? {
            onboarding: {
              db,
              gateway: config.stripeGateway,
              audit,
              ...(config.stripeConnectUrls ?? {}),
            },
          }
        : {}),
    }),
  );
  // The Admin Founder panel's own records (migration 0059) — the eleven-stage
  // workflow position, the application-review decision §9 defines no lifecycle
  // state for, the Admin offers §14.2 keeps out of `proposal_versions`, the
  // internal notes, the invitation prefills, and the one route that changes a
  // saved campaign value directly with its prior value read under lock.
  //
  // Mounted AFTER the workspace router on purpose: its `GET /founder-panel/:id`
  // is a supplement to that read, not a replacement for it, and its two
  // `/api/admin/founders/...` writes are distinct path segments that the
  // workspace router does not claim.
  app.use(
    createAdminFounderPanelRouter({
      db,
      auth,
      notifier,
      notificationContext: launchContext,
      ...(config.internalRecipient ? { internalRecipient: config.internalRecipient } : {}),
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
  // The Creator Admin workspace (§26.1). Keyed on the PERSON — the router above
  // is keyed on one campaign relationship, and both are mounted because they
  // answer different questions. Nothing here reimplements recruitment,
  // verification, or the invitation: the surface calls both routers.
  app.use(
    createAdminCreatorsRouter({
      db,
      auth,
      appBaseUrl: config.invitationContext.appBaseUrl,
      ...(config.stripeGateway
        ? { stripeMode: config.stripeGateway.mode, stripeGateway: config.stripeGateway }
        : {}),
      // Session B (2026-08-17): the evidence-picture store, and the §27 sender
      // for the two asks. Both refuse honestly when unconfigured.
      storage: config.objectStorage ?? unconfiguredStorage,
      notifier,
      askContext: {
        appBaseUrl: config.invitationContext.appBaseUrl,
        supportEmail: config.invitationContext.supportEmail,
        fromAddress: config.invitationContext.fromAddress,
      },
    }),
  );
  // The Campaigns Admin hub (§26.1), built 2026-08-15. Two GETs and nothing
  // else: it summarises five domains and links into the workspaces that own
  // them. Every campaign operation already has a router — §15's review, §16's
  // readiness, §17's launch, §20's live edits, §21's close, §22.1's earnings,
  // §24.8's refunds, §26.7's suspend/kill — and a duplicate control here would
  // be a second door into rules those encode. `requireAdmin` only: there is no
  // write for a freshness gate to protect, and §33.12.5's write partition is
  // untouched because this router contributes none.
  app.use(
    createAdminCampaignsRouter({
      db,
      auth,
      appBaseUrl: config.invitationContext.appBaseUrl,
    }),
  );
  // §26.1, §26.5, §25.7, §28.4 — the Backers workspace, built 2026-08-15. Also
  // read-only, and for a second reason on top of the Campaigns one: this is the
  // only route in the product that returns a Backer's survey answer beside
  // their email, so it carries no write AND no export. §25.7 keeps those two
  // fields on screen and out of every file, and the absence of the route is
  // what enforces it. `requireAdmin` refuses a Founder and a Creator by role
  // before any query runs.
  app.use(createAdminBackersRouter({ db, auth, audit }));
  // The Admin Tasks panel, built 2026-08-16. §26 names no task list and this
  // adds none of §1 rule 6's seven inventions: a private note an operator
  // writes to themselves, pointed at the record it belongs to. No assignee
  // (that is `support_cases`), no notification key, no job, and a due date the
  // server never interprets — §30 is why it is a note that waits rather than a
  // queue that chases. `requireAdmin` on everything; every write is registered
  // in §33.12.5's `UNGATED_ADMIN_WRITES` with the sensitive property it lacks.
  app.use(createAdminTasksRouter({ db, auth }));
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
      // Read for `configured` alone. Creator Flow v2 Session C's screens 5 and
      // 6 render a named absence while R2 is unset (Track A4); there is no
      // presign or upload route on this router to reach it with.
      objectStorage: config.objectStorage ?? unconfiguredStorage,
      ...(config.draftVerifyLimit !== undefined
        ? { verifyLimit: config.draftVerifyLimit }
        : {}),
    }),
  );
  // Phase 06b (§7, §33.1.1). The one route a Founder reaches with no account.
  // It takes a token, never a draft id, so there is nothing in the request to
  // substitute — see `routes/draft.ts`.
  app.use(
    createDraftRouter(db, auth, tokens, {
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
      // The code verifies an email and establishes only the draft-scoped flow
      // session. Account creation and `founder_signup_complete` stay at submit.
      emailCode: {
        db,
        tokens,
        notifier,
        fromAddress: config.invitationContext.fromAddress,
        supportEmail: config.invitationContext.supportEmail,
        audit,
      },
      useSecureCookies: config.appBaseUrl.startsWith('https://'),
      // Deviation 2. Unset everywhere today, so the port refuses loudly and
      // the Positioning screen renders the absence (Track A).
      ...(config.transcription ? { transcription: config.transcription } : {}),
      ...(config.emailCodeLimit !== undefined ? { emailCodeLimit: config.emailCodeLimit } : {}),
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
      // Creator Flow v2 Session F: the work surface renders a named absence
      // rather than a dead download control while R2 is unconfigured.
      storageConfigured: (config.objectStorage ?? unconfiguredStorage).configured,
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
      // Founder Flow v2 Session D: the same port the draft route uses, so
      // one deployment decision governs dictation on both steps.
      ...(config.transcription ? { transcription: config.transcription } : {}),
      // Session F (§25.6): the openness answer is a recorded decision, so it
      // needs the same writer every other decision in the product uses.
      audit,
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
  // Session G (§5.2). The Founder's own settings, account-level rather than
  // campaign-scoped: `founder_claim_profiles` is unique per campaign, so a
  // Founder with two campaigns would otherwise have two settings pages. It
  // absorbs Phase 22c's `/settings/notifications`, whose header has said since
  // it shipped that a second account-level setting joins that page.
  app.use(createFounderSettingsRouter({ db, auth, audit }));
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
  /*
    Phase 21a (§22.4–§22.7). The Admin half of the same records, restored
    2026-08-19 with the console that operates it.

    §22.4 requires the Founder and the Admin to see the SAME checklist and the
    same evidence list, and both routers call one `day14Checklist(campaignType)`
    — which is why they live in one module and why deleting one half left the
    guarantee half-proved. Every decision takes the freshness gate: the Day 14
    outcome blocks a remaining payment, a delivery approval moves a promise, and
    the ban is permanent.
  */
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
  // Phase 21b (§22.8–§22.11, §31.8, §33.10.5–10). The last of the lifecycle:
  // the Creator's completion status against its five criteria, the work-again
  // request that creates nothing, the Founder's two independent next-campaign
  // gates, and §22.11 resolution — which stays distinct from `fulfilled`.
  {
    const completionDeps = {
      db,
      auth,
      audit,
      notify: {
        notifier,
        context: launchContext,
        ...(config.internalRecipient ? { internalRecipient: config.internalRecipient } : {}),
      },
    };
    app.use(createAdminCompletionRouter(completionDeps));
    app.use(createFounderCompletionRouter(completionDeps));
    app.use(createCreatorCompletionRouter(completionDeps));
  }
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
    /*
      Phase 18b/19a/19b (§21, §22.1, §22.2, §22.3) and Phase 20a (§24.8, §24.9).
      The close and refund consoles' routers, restored 2026-08-19 with the
      Money & Fulfillment screens that operate them.

      They were deleted with the old dashboard (`2f7aeed`) and that contradicted
      this repository's own rule — a deleted screen keeps its backend, because
      the backend encodes acceptance-tested machinery. One route came back early
      because §33.8.13 drives it; the rest waited here, as CLAUDE.md said they
      would, because a mounted money-moving route nobody can see is worse than
      an absent one. There is now a surface for every one of them.

      Inside the gateway block, beside disputes, because the money acts they
      perform — the §21 capture retry, the §22.1 Transfer, the §24.8 Refund —
      are provider calls. A deployment with no gateway has no close operations
      to run rather than a console that would fail at the last step.
    */
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
  }

  // ── SPA fallback ──────────────────────────────────────────────────────────
  // /api/* routes go above. Everything else returns index.html so the SPA
  // router handles it. In development the Vite dev server serves instead;
  // in production the built frontend is at backend/public/.
  app.use(express.static(config.publicDir));

  // A path whose last segment carries a file extension is asking for a FILE.
  // express.static above has already answered every file that exists, so
  // arriving here means it does not — and the only honest answer is 404.
  //
  // Falling through to index.html instead is how a missing asset stops looking
  // like a missing asset. `/fonts/Satoshi-Variable.woff2` answered 200 with
  // `<!doctype html>` as its body, and the browser reported
  //
  //     OTS parsing error: invalid sfntVersion: 1008821359
  //
  // — which is 0x3C21646F, the ASCII for `<!do`. That reads as a corrupt font
  // rather than an absent one, and it sent the investigation at the font
  // binary instead of at the deploy. The same disguise applies to a missing
  // JS chunk (surfacing as a MIME-type refusal) and a missing image. §1.4: a
  // failure presents as what it is, and 404 is what this one is.
  //
  // Nothing the SPA router owns is caught by this: no path in either route
  // inventory — `features/public/site.ts` or `routes.tsx` — ends in a
  // dot-extension, and a query string is not part of `req.path`.
  const ASSET_SHAPED_PATH = /\.[a-z0-9]{1,8}$/i;

  app.use((req, res) => {
    if (ASSET_SHAPED_PATH.test(req.path)) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const indexPath = path.join(config.publicDir, 'index.html');
    res.sendFile(indexPath, (err) => {
      if (err) {
        res.status(404).json({ error: 'Not found' });
      }
    });
  });

  // ── The last-resort error handler ─────────────────────────────────────────
  //
  // Until now there was none, so an unhandled throw anywhere in a route fell
  // through to Express's built-in handler. That has two consequences worth
  // stating separately, because only one of them is cosmetic:
  //
  //  1. Outside production, Express's default writes the STACK TRACE into the
  //     response body. File paths, function names, and the shape of the query
  //     that failed all go to the browser. §28.2 says no sensitive value
  //     reaches a log; a stack in an HTTP body is worse than a log, because
  //     the person reading it is whoever made the request.
  //
  //  2. In every environment the body is HTML. Both API clients decide by
  //     parsing JSON, so an HTML 500 became `opaqueFailure(500)` — "The server
  //     answered 500 with no explanation, so it is not certain whether the
  //     change was applied." The client was telling the truth: the server had
  //     explained nothing. That is §30's forbidden generic error, and on an
  //     Admin money surface "it is not certain whether the change was applied"
  //     is the worst sentence the product can produce.
  //
  // So: log the real error on the server, where support can read it, and
  // answer with a fixed, deterministic, JSON body that says exactly what is
  // and is not known. It carries no message from the exception — an error
  // string is written by whoever threw it and may quote a row, a token, or a
  // provider payload.
  //
  // Mounted last. Express selects an error handler by arity, so all four
  // parameters are required even though `next` is unused.
  app.use(
    (
      err: unknown,
      req: express.Request,
      res: express.Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction,
    ) => {
      // `redactTokenUrl` is not reached here: the path may itself carry a raw
      // token (§28.1), so only the method and the route SHAPE are recorded.
      console.error('[unhandled]', req.method, req.path.replace(/\/[^/]{16,}/g, '/[redacted]'), err);

      if (res.headersSent) {
        // A stream that already started cannot be given a JSON body. Ending it
        // is the honest outcome; pretending to answer would append garbage to
        // a half-written response.
        res.end();
        return;
      }

      res.status(500).json({
        error: 'server_error',
        title: 'Something went wrong at our end',
        whatHappened:
          'The request reached Proovd and did not complete. It is not known whether the ' +
          'change was applied, so nothing about it should be assumed either way.',
        next:
          'Reload this page to see the current stored values before trying again. If it ' +
          'keeps happening, contact support and quote the time.',
        support: '/support',
      });
    },
  );

  return { app, auth, tokens, notifier };
}
