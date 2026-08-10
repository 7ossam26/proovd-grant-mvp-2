/**
 * Public Founder signup — an operator decision, recorded here in full.
 *
 * ── What this changes, and what it deliberately does not ────────────────────
 * Spec §5.2 admits Founders "by private invitation", and until now the product
 * had no open door for any role. The operator has decided to add one for
 * FOUNDERS. That is a commercial decision about who may hold a Founder account;
 * it is not licence to widen anything else, so this file is written to keep
 * every neighbouring guarantee exactly where it was:
 *
 *  - Better Auth's own `/api/auth/sign-up/email` stays CLOSED (`disableSignUp:
 *    true` in `auth.ts`). This is not redundancy. That route takes whatever the
 *    body carries and has no idea what a policy consent is, so opening it would
 *    create accounts with no accepted agreements and, the day a role ever
 *    became an input, no controlled role either. §33.2.1's first two assertions
 *    continue to pass unchanged, and they should.
 *  - The role is the string literal `'founder'` below. It is not a parameter,
 *    not a field on the request body, and not defaulted — there is no
 *    expression anywhere in this file that could evaluate to another role. An
 *    Admin still requires `seedAccount` plus a TOTP enrolment (§5.1), and a
 *    Creator still requires a campaign-scoped Admin invitation (§5.3, §33.2.1).
 *    Those two refusals are what §33.2.1 is actually named for, and they are
 *    untouched.
 *  - Nothing here writes an `affiliate_prospects` row, an association, or an
 *    invitation token. A Founder account is the whole of what this mints.
 *
 * ── The account still cannot exist without accepted agreements (§10) ────────
 * §10 requires Terms, the Founder AUP, and the privacy policy before a Founder
 * account exists, and a `policy_consents` row may cite only a PUBLISHED version
 * — a database trigger, not a convention. That rule is not relaxed for this
 * door: while any of the three is a draft, this refuses in the open with
 * `policies_unpublished` and says nothing was created, exactly as the
 * invitation claim does. Asking someone to accept text Proovd's own lawyers
 * have not agreed records agreement to nothing.
 *
 * ── Ordering, and which half is the recoverable one ─────────────────────────
 * `claim.ts` creates the account BEFORE its transaction, deliberately: an
 * account with no consent row is recoverable by signing in and accepting,
 * while a consent row pointing at no account strands a person behind a
 * credential that does not exist. Same order here, same reason.
 */

import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import type { Auth } from './auth.js';
import type { AuditWriter } from './audit.js';
import { seedAccount } from './seed.js';
import { user as userTable } from '../db/schema/auth.js';
import { policyConsents } from '../db/schema/vetting.js';
import { policyVersions } from '../db/schema/policies.js';

/**
 * §10's three documents, in §10's own order. Deliberately NOT
 * `REQUIRED_POLICY_SLUGS` (all eight, which is §34's live-mode gate) and not
 * the Creator's two — collecting an acceptance the Spec does not ask for is as
 * wrong as skipping one it does.
 */
export const FOUNDER_SIGNUP_POLICY_SLUGS = ['terms', 'aup', 'privacy'] as const;

/**
 * §10's claim uses the same floor. Stated here rather than imported so the two
 * doors cannot silently drift to different rules for the same account kind —
 * a test compares them.
 */
export const MIN_PASSWORD_LENGTH = 12;

export interface PublicSignupInput {
  email: string;
  password: string;
  name: string;
  /**
   * §28.4 forbids bundling optional consent, so the surface renders one
   * control per document and this carries the slugs that were actually ticked.
   * A single `acceptedAll: true` would be exactly the bundling §28.4 refuses.
   */
  acceptedPolicySlugs: readonly string[];
}

export type PublicSignupResult =
  | { ok: true; userId: string; email: string }
  | {
      ok: false;
      code:
        | 'invalid_email'
        | 'invalid_name'
        | 'credentials_missing'
        | 'policies_unpublished'
        | 'consent_missing'
        | 'email_taken';
      message: string;
      next: string;
      missing?: string[];
    };

/** Deliberately conservative. The authority on deliverability is the inbox. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const NOTHING_LOST = 'Nothing was created and nothing you entered was lost.';

export async function createFounderAccountPublicly(
  db: Database,
  auth: Auth,
  audit: AuditWriter,
  input: PublicSignupInput,
): Promise<PublicSignupResult> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();

  if (!EMAIL_SHAPE.test(email)) {
    return {
      ok: false,
      code: 'invalid_email',
      message: 'That does not look like an email address.',
      next: NOTHING_LOST,
    };
  }

  if (name.length < 2) {
    return {
      ok: false,
      code: 'invalid_name',
      message: 'Tell us the name you want on your account.',
      next: NOTHING_LOST,
    };
  }

  if (!input.password || input.password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      code: 'credentials_missing',
      message: `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
      next: NOTHING_LOST,
    };
  }

  /* ── The agreements (§10, §29.8, §31.4) ─────────────────────────────────── */

  const rows = await db
    .select({
      id: policyVersions.id,
      slug: policyVersions.slug,
      version: policyVersions.version,
      status: policyVersions.status,
    })
    .from(policyVersions)
    .where(inArray(policyVersions.slug, [...FOUNDER_SIGNUP_POLICY_SLUGS]));

  const byslug = new Map(rows.map((r) => [r.slug, r]));

  const unpublished = FOUNDER_SIGNUP_POLICY_SLUGS.filter(
    (slug) => byslug.get(slug)?.status !== 'published',
  );

  if (unpublished.length > 0) {
    // §31.4 forbids shipping a placeholder or a summary as the document, and
    // §1 rule 6 forbids writing the real text. The honest answer is that the
    // account cannot be created yet, and why. Do not soften this and do not
    // stub a consent to get past it.
    return {
      ok: false,
      code: 'policies_unpublished',
      message:
        'We cannot create your account yet: the agreements you would be accepting are still with our lawyers, and we will not ask you to sign something that is not final.',
      next: `${NOTHING_LOST} We will open signups the moment this is settled.`,
      missing: [...unpublished],
    };
  }

  const accepted = new Set(input.acceptedPolicySlugs);
  const notAccepted = FOUNDER_SIGNUP_POLICY_SLUGS.filter((slug) => !accepted.has(slug));
  if (notAccepted.length > 0) {
    return {
      ok: false,
      code: 'consent_missing',
      message: 'Each agreement has to be accepted before an account can be created.',
      next: NOTHING_LOST,
      missing: [...notAccepted],
    };
  }

  /* ── The identity ───────────────────────────────────────────────────────── */

  const [existing] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.email, email))
    .limit(1);

  if (existing) {
    // ── A signup form is an account-existence oracle, and this one says so ──
    // §5.5's non-enumeration rule governs TOKEN routes and the sign-in and
    // reset surfaces, which is why those three answer identically whatever
    // they find. A signup cannot: the address is either free or it is not, and
    // a form that claimed success and created nothing would leave somebody
    // waiting for an account that is never coming (§1.4) — the failure §1.4
    // exists to prevent, traded for a fact an attacker can obtain by pressing
    // "reset my password" anyway.
    //
    // The honest mitigation is the rate limiter on the route, which bounds how
    // fast a list can be tested, and the deliberate absence of any hint about
    // WHICH kind of account holds the address.
    return {
      ok: false,
      code: 'email_taken',
      message: 'That email address already has a Proovd account.',
      next: 'Sign in instead, or reset your password if you cannot remember it.',
    };
  }

  const account = await seedAccount(auth, audit, {
    email,
    password: input.password,
    name,
    // Not a parameter. See this file's header — the one role this door mints.
    role: 'founder',
    actor: 'public-signup',
  });

  /* ── The consent rows (§10, §25.6) ──────────────────────────────────────── */

  await db.transaction(async (tx) => {
    for (const slug of FOUNDER_SIGNUP_POLICY_SLUGS) {
      const version = byslug.get(slug)!;
      await tx.insert(policyConsents).values({
        subjectType: 'user',
        subjectId: account.id,
        policyVersionId: version.id,
        slug: version.slug,
        version: version.version,
        // Distinct from `founder_account_claim` on purpose: which door an
        // account came through is a fact support and §25.6 both need, and one
        // shared value would make the two indistinguishable forever.
        acceptedVia: 'founder_public_signup',
      });
    }
  });

  await audit({
    // The bare id — `createAuditWriter` is what prefixes `user:`. Passing an
    // already-prefixed value here writes `user:user:<id>`.
    actorId: account.id,
    action: 'account.public_signup',
    targetType: 'user',
    targetId: account.id,
    internalReason:
      'Founder account created through the public signup route (operator decision; §5.2 otherwise admits Founders by private invitation)',
    customerExplanation: 'Your Proovd account was created.',
    newValue: {
      role: 'founder',
      email,
      acceptedPolicies: FOUNDER_SIGNUP_POLICY_SLUGS.map((slug) => {
        const v = byslug.get(slug)!;
        return `${v.slug}@${v.version}`;
      }),
    },
  });

  return { ok: true, userId: account.id, email };
}

/**
 * Whether the public door can currently mint an account at all.
 *
 * The surface reads this BEFORE rendering a form, so a visitor meets the
 * closed state as a state — with an owner and a next update (§27.1) — rather
 * than by filling in four fields and a password and then being refused. The
 * route re-decides independently; a form that rendered is not authorisation
 * (§1.1).
 */
export async function readSignupAvailability(
  db: Database,
): Promise<{ open: true } | { open: false; reason: 'policies_unpublished'; missing: string[] }> {
  const rows = await db
    .select({ slug: policyVersions.slug, status: policyVersions.status })
    .from(policyVersions)
    .where(
      and(
        inArray(policyVersions.slug, [...FOUNDER_SIGNUP_POLICY_SLUGS]),
        eq(policyVersions.status, 'published'),
      ),
    );

  const published = new Set(rows.map((r) => r.slug));
  const missing = FOUNDER_SIGNUP_POLICY_SLUGS.filter((slug) => !published.has(slug));

  return missing.length === 0
    ? { open: true }
    : { open: false, reason: 'policies_unpublished', missing: [...missing] };
}
