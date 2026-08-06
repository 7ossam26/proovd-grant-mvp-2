/**
 * Better Auth configuration — the three *account* actors (§5.1, §5.2, §5.3).
 *
 * Four actors, two mechanisms. Backers are not here and never will be: §5.4
 * makes them guest-only with no password account, and §19 scopes their access
 * to one campaign, which an account session cannot express. They are served by
 * `token-service.ts`. Better Auth's magic-link plugin is deliberately not
 * installed — see the header of `db/schema/tokens.ts`.
 *
 * ── What this file refuses to do ────────────────────────────────────────────
 *  - No public signup, for any role. §5.1 seeds Admins directly, §5.2 admits
 *    Founders by private invitation, and §5.3 is explicit that Affiliates have
 *    "no open public signup". `disableSignUp` closes the HTTP route entirely,
 *    which is the mechanism §33.2.1 checks.
 *  - No SMS, no phone OTP, no phone-based recovery (§5.2, §33.1.8). The second
 *    factor is TOTP and nothing else.
 */

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { twoFactor } from 'better-auth/plugins/two-factor';
import type { Database } from '../db/client.js';
import { betterAuthSchema } from '../db/schema/auth.js';

/**
 * Delivery of the reset link. §5.5 gives Founder, Affiliate, and Admin an
 * email-link password reset; the transport is Resend, which arrives in a later
 * phase, so it is injected rather than stubbed. A stub here would be a silent
 * failure the day it shipped.
 *
 * Note the shape of what is passed on: a URL and an address. The reset token
 * itself is inside the URL and must not be pulled out, logged, or stored
 * (§28.1).
 */
export type SendResetPassword = (input: {
  user: { id: string; email: string; name: string };
  url: string;
}) => Promise<void>;

export interface AuthConfig {
  db: Database;
  baseUrl: string;
  secret: string;
  /**
   * §6 Admin setting: "Admin MFA and reauthentication window". The Spec names
   * the setting but fixes no number, so this has no default anywhere in the
   * codebase — the operator supplies it and the app fails closed without it
   * (§1 rule 6: invent no value the Spec does not state).
   *
   * Phase 06 builds the Admin settings surface that owns this; until then it
   * comes from the environment under the same name.
   */
  adminReauthWindowSeconds: number;
  sendResetPassword: SendResetPassword;
  /** Founder-only Google sign-in (§5.2). Omitted entirely when unconfigured. */
  google?: { clientId: string; clientSecret: string };
  /**
   * Origins Better Auth accepts on a cookie-bearing or Origin-header-carrying
   * request (its own CSRF check, independent of Express's CORS middleware).
   * Defaults to `[baseUrl]` — Better Auth's own default — when omitted. `app.ts`
   * passes the same list it built for CORS, so the two never disagree about
   * which origins the app trusts in a given environment.
   */
  trustedOrigins?: string[];
}

export function createAuth(config: AuthConfig) {
  const socialProviders = config.google
    ? {
        google: {
          clientId: config.google.clientId,
          clientSecret: config.google.clientSecret,
          /**
           * §5.2 gives Google sign-in to Founders. §5.1 seeds Admins directly
           * and §5.3 admits Affiliates only through a private campaign-specific
           * invitation — neither has an OAuth route. So an account that first
           * appears through Google is a Founder by construction, and saying so
           * here means the role can never be absent or attacker-chosen.
           */
          mapProfileToUser: () => ({ role: 'founder' as const }),
        },
      }
    : undefined;

  return betterAuth({
    appName: 'Proovd',
    baseURL: config.baseUrl,
    secret: config.secret,
    ...(config.trustedOrigins ? { trustedOrigins: config.trustedOrigins } : {}),

    database: drizzleAdapter(config.db, {
      provider: 'pg',
      schema: betterAuthSchema,
    }),

    emailAndPassword: {
      enabled: true,
      /**
       * §5.3: "No open public signup." §5.1: Admins are seeded, with "no signup
       * or public invitation". §5.2: Founders arrive by private invitation.
       * There is no role for which a public signup route is correct, so the
       * route does not exist. Accounts are created by the invitation-claim and
       * seeding paths in later phases. §33.2.1.
       */
      disableSignUp: true,
      sendResetPassword: async ({ user, url }) => {
        await config.sendResetPassword({
          user: { id: user.id, email: user.email, name: user.name },
          url,
        });
      },
    },

    ...(socialProviders ? { socialProviders } : {}),

    user: {
      additionalFields: {
        role: { type: 'string', required: true, input: false },
        /** §5.2/§5.3: collected, and stored as explicitly unverified. */
        phone: { type: 'string', required: false, input: true },
        phoneVerified: { type: 'boolean', required: false, input: false, defaultValue: false },
      },
    },

    session: {
      /**
       * §5.1/§28.2: money movement, refunds, connected-account actions, and
       * campaign kill/suspend require recent reauthentication. This is Better
       * Auth's own freshness window, which governs its built-in sensitive
       * endpoints; `requireFreshSession` in `guards.ts` applies the same window
       * to ours.
       */
      freshAge: config.adminReauthWindowSeconds,
    },

    plugins: [
      /**
       * TOTP. §5.1 and §28.2: MFA is required for Admin. The plugin makes the
       * factor possible; `requireAdmin` is what makes it mandatory, by refusing
       * an Admin whose factor is not registered.
       *
       * No `otpOptions` — the OTP-over-email/SMS provider stays off. §33.1.8
       * requires that no SMS OTP path exists anywhere.
       */
      twoFactor({ issuer: 'Proovd' }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
