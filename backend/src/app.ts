import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import path from 'node:path';
import type { Database } from './db/client.js';
import { createHealthRouter } from './routes/health.js';
import { createAuthRouter } from './routes/auth.js';
import { createAdminRouter } from './routes/admin.js';
import { createAdminFoundersRouter } from './routes/admin-founders.js';
import { createAdminAffiliatesRouter } from './routes/admin-affiliates.js';
import { createDraftRouter } from './routes/draft.js';
import { createVettingRouter } from './routes/vetting.js';
import { createAuth, type Auth, type SendResetPassword } from './auth/auth.js';
import { createAuditWriter } from './auth/audit.js';
import { createTokenService, type TokenService } from './auth/token-service.js';
import { createNotifier, type EmailTransport, type Notifier } from './notifications/send.js';
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
  /** §7 / §27.8 addresses and origins the invitation is built from. */
  invitationContext: InvitationContext;
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
  /** §5.5 email-link password reset. Injected; the transport arrives later. */
  sendResetPassword: SendResetPassword;
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
  const auth = createAuth({
    db,
    baseUrl: config.appBaseUrl,
    secret: config.authSecret,
    adminReauthWindowSeconds: config.adminReauthWindowSeconds,
    sendResetPassword: config.sendResetPassword,
    ...(config.google ? { google: config.google } : {}),
  });
  const tokens = createTokenService({ db, audit });
  const notifier = createNotifier({
    db,
    transport: config.emailTransport ?? unconfiguredTransport,
    audit: (event) => audit({ ...event, targetId: event.targetId }),
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

  app.use(createAuthRouter(auth));
  app.use(createHealthRouter(db));
  // Phase 06 (§6, §26). The first product routes any guard is mounted on:
  // everything under /api/admin requires a session, the admin role, and a
  // registered TOTP factor, and every write additionally requires a recent
  // sign-in.
  app.use(createAdminRouter({ db, auth, environment: config.prerequisiteEnvironment }));
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
    }),
  );

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
