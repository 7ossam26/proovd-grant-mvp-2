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
 *  - No SMS, no phone OTP, no phone-based recovery (§5.2, §33.1.8). There is no
 *    second-factor mechanism of any kind here — see the note below.
 *
 * ── The second factor was removed, deliberately (2026-08-10) ────────────────
 * §5.1 and §28.2 make Admin MFA mandatory, and this codebase enforced it with
 * Better Auth's TOTP plugin plus a `requireAdmin` refusal. The product owner
 * directed its removal, so the plugin, the `two_factor` table, the
 * `user.two_factor_enabled` column, and every enrolment path are gone.
 *
 * This is a recorded deviation from the Spec, not a defect to "fix" by
 * reinstating it in a later session without the same instruction. What did NOT
 * change, and must not: the Admin still authenticates with a real credential,
 * `requireAdmin` still refuses every non-`admin` role server-side, and
 * `requireFreshSession` still gates every high-impact action on a recent
 * sign-in. Removing a factor is not the same as removing a boundary, and no
 * bypass, dev shortcut, or hardcoded Admin was added in its place.
 *
 * §34's live-mode condition 8 was restated to describe the controls that now
 * exist rather than the one that does not (`shared/src/live-mode/index.ts`).
 */

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
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
   * §6 Admin setting: the reauthentication window. The Spec names the setting
   * but fixes no number, so this has no default anywhere in the codebase — the
   * operator supplies it and the app fails closed without it (§1 rule 6:
   * invent no value the Spec does not state).
   *
   * Phase 06 builds the Admin settings surface that owns this; until then it
   * comes from the environment under the same name.
   */
  adminReauthWindowSeconds: number;
  /**
   * Whether this deployment is served over https, which decides `Secure` on
   * the session cookie.
   *
   * Better Auth derives this from `baseURL` on its own; it is stated
   * explicitly because a session cookie's `Secure` attribute is a security
   * control, and a control that is correct by inference is one nobody can
   * check. `app.ts` passes `appBaseUrl.startsWith('https://')` — the same test
   * it uses for the attribution cookie, so the two can never disagree.
   */
  useSecureCookies: boolean;
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
           * §33.2.1: "No public signup", for any role.
           *
           * `emailAndPassword.disableSignUp` above does NOT cover this, and
           * that is not obvious — it reads like one switch for the whole app.
           * Better Auth checks the two independently: `sign-up.mjs` reads
           * `options.emailAndPassword.disableSignUp`, while the OAuth callback
           * (`api/routes/callback.mjs`) reads only the PROVIDER's own
           * `disableSignUp`. With this flag absent, `oauth2/link-account.mjs`
           * creates a user for any Google identity it has never seen — so
           * anyone with a Google account could mint a Proovd account by
           * calling `/api/auth/sign-in/social` directly, and
           * `mapProfileToUser` below would stamp it `founder`. No invitation,
           * no draft token, no Admin.
           *
           * It was never exploitable in a deployment that left
           * `GOOGLE_CLIENT_ID` unset (the whole provider is omitted then), and
           * no Proovd surface renders a Google button — but "the frontend does
           * not offer it" is not a control, and the env vars are one edit away
           * from being filled in.
           *
           * With this true, Google signs in an account that ALREADY exists and
           * creates none. That is §5.2 read as written: Founders arrive by
           * private invitation, and Google is how an invited Founder logs in
           * afterwards — not how one comes into existence.
           */
          disableSignUp: true,
          /**
           * §5.2 gives Google sign-in to Founders. §5.1 seeds Admins directly
           * and §5.3 admits Affiliates only through a private campaign-specific
           * invitation — neither has an OAuth route. So an account that first
           * appears through Google is a Founder by construction, and saying so
           * here means the role can never be absent or attacker-chosen.
           *
           * Kept even though `disableSignUp` now means no account first
           * appears this way: the two guarantees are independent, and a later
           * phase re-opening social sign-up must not find the role unset.
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
       *
       * With the second factor removed this is the ONLY thing standing between
       * a long-lived stolen session and a money-moving action, so it is the one
       * control in this file that must never be loosened casually.
       */
      freshAge: config.adminReauthWindowSeconds,
    },

    advanced: {
      /**
       * `Secure` on the session cookie, stated rather than inferred. False on
       * a local http origin so the dev server and the loopback integration
       * suite still receive the cookie; true on any https deployment.
       *
       * `httpOnly` and `sameSite: 'lax'` are Better Auth's own defaults for
       * the session cookie and are deliberately not restated: overriding
       * `defaultCookieAttributes` here would also silently re-attribute every
       * other cookie the library sets, which is a larger change than the one
       * being made.
       */
      useSecureCookies: config.useSecureCookies,
    },

    /**
     * No plugins. The two-factor plugin was removed on 2026-08-10 by product
     * direction — see the file header. Adding a plugin here widens the
     * `/api/auth/*` surface, so anything added later needs its endpoints
     * checked against §5's "no public signup" and §28.1's non-enumeration
     * rules before it ships.
     */
    plugins: [],
  });
}

export type Auth = ReturnType<typeof createAuth>;
