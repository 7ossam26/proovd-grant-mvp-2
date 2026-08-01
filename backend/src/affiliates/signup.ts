/**
 * The Creator's compact signup — Spec §11, §5.3, §28.4, §33.2.2, §33.2.3.
 *
 * §11: "The Proovd portion is one compact account-and-profile flow with one
 * primary action: `Confirm and create account`." One flow, one action, and
 * after it exactly one more — `Finish payout setup`, which is a handoff to
 * Stripe rather than a form Proovd owns.
 *
 * ── Two primary actions, and no third (§33.2.2) ─────────────────────────────
 * §11 names them and forbids the alternatives outright: "There is no welcome
 * tour, multi-page education sequence, separate banking page, or public
 * Affiliate signup." So this module exposes exactly two things a Creator can
 * do — save what is in front of them, and complete the claim — plus a read of
 * the payout state. There is no `startTour`, no step sequence, and no route
 * that collects a bank or identity field, because §11 says Proovd "must not
 * reproduce provider-controlled banking or identity fields in a custom form."
 *
 * ── A save writes only the keys it was given ────────────────────────────────
 * `undefined` means "not in this request", exactly as in the vetting and
 * Founder-claim saves. The typed value never comes back from the server, so
 * nothing the server says can empty a box — the clear-on-error-and-refetch bug
 * is unreachable from here.
 *
 * ── The claim is one transaction anchored by two mechanisms ─────────────────
 * `idempotency_keys` on `affiliate_signup_complete:<associationId>` makes the
 * event singular under retry; `tokens.claimAffiliateInvitation` — 08a's
 * conditional UPDATE, run inside the transaction — settles two requests holding
 * the same link. Better Auth's account creation happens BEFORE the transaction
 * on purpose: a leftover account with no claim is recoverable by clicking the
 * link again, while a claimed invitation with no account strands someone behind
 * a dead link. §10's claim made the same trade for the same reason.
 *
 * ── A draft policy blocks the claim, in the open ────────────────────────────
 * §11 requires "Terms and Affiliate AUP acceptance", and a `policy_consents`
 * row may cite only a `published` version — a trigger, not a service rule. Both
 * documents are drafts while Track A2 is with the lawyers, so this refuses with
 * `policies_unpublished` and the surface renders the reason. Do not soften it,
 * do not stub a consent, do not accept a draft.
 */

import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import type { Auth } from '../auth/auth.js';
import type { TokenService } from '../auth/token-service.js';
import { campaigns, campaignAffiliateAssociations } from '../db/schema/domain.js';
import { affiliateProspects } from '../db/schema/affiliates.js';
import {
  affiliateSignupProfiles,
  type AffiliateSignupProfile,
} from '../db/schema/affiliate-signup.js';
import { policyVersions } from '../db/schema/policies.js';
import { policyConsents } from '../db/schema/vetting.js';
import { auditEvents, idempotencyKeys } from '../db/schema/integrity.js';
import { user as userTable } from '../db/schema/auth.js';
import { readSignupComplete } from '../vetting/claim.js';
import { transitionAssociation } from './recruitment.js';

/**
 * The domain event §11's signup produces, counted once per association.
 *
 * Not a notification key: `affiliate_signup_confirmed` is the message a Creator
 * receives, this is the fact that happened. Naming the fact after the message
 * would make "happened once" mean "emailed once", which is weaker.
 */
export const AFFILIATE_SIGNUP_COMPLETE = 'affiliate_signup_complete' as const;

export function affiliateSignupCompleteKey(associationId: string): string {
  return `${AFFILIATE_SIGNUP_COMPLETE}:${associationId}`;
}

/**
 * §11: "Terms and Affiliate AUP acceptance."
 *
 * Exactly two. §10's Founder claim additionally takes `privacy` because §10's
 * own list names it; §11's does not, and collecting an acceptance the Spec does
 * not ask for is as wrong as skipping one it does. `ip-agreement` is §31.5's
 * per-campaign agreement and is required before *work*, not before an account —
 * §10's handoff says so explicitly, and it belongs to the phase that opens work.
 */
export const AFFILIATE_CLAIM_POLICY_SLUGS = ['terms', 'affiliate-aup'] as const;

/* ── The profile ──────────────────────────────────────────────────────────── */

export interface SignupFieldState {
  value: string | null;
  /** §11's "source label": who supplied the value now in the box. */
  supplier: 'proovd' | 'affiliate' | null;
  /** What the §8 recruitment record supplied. Frozen at creation. */
  prefilled: string | null;
  editedAt: string | null;
}

export interface SignupProfileState {
  associationId: string;
  campaignId: string;
  fields: {
    legalName: SignupFieldState;
    publicHandle: SignupFieldState;
    email: SignupFieldState;
    phone: SignupFieldState;
    channelReference: SignupFieldState;
    audienceNiche: SignupFieldState;
    audienceSize: SignupFieldState;
    bio: SignupFieldState;
    dateOfBirth: SignupFieldState;
    country: SignupFieldState;
    stateRegion: SignupFieldState;
  };
  /** §5.3's classification. Read-only here — see the schema note. */
  channelSubtype: string | null;
  /** §5.2/§33.1.8: always false, and there is no route that changes it. */
  phoneVerified: false;
  confirmations: {
    age18Plus: boolean;
    usBased: boolean;
    actualOperator: boolean;
    noDuplicateAccounts: boolean;
    sanctionsEligible: boolean;
  };
  payout: {
    status: string;
    connectedAccountId: string | null;
    requirements: unknown;
    updatedAt: string | null;
  };
  lastSavedAt: string | null;
  claimedAt: string | null;
}

const iso = (v: Date | null | undefined): string | null => v?.toISOString() ?? null;

function field(
  value: string | null,
  supplier: 'proovd' | 'affiliate' | null,
  prefilled: string | null,
  editedAt: Date | null,
): SignupFieldState {
  return { value, supplier, prefilled, editedAt: iso(editedAt) };
}

function toState(row: AffiliateSignupProfile, channelSubtype: string | null): SignupProfileState {
  return {
    associationId: row.associationId,
    campaignId: '',
    fields: {
      legalName: field(row.legalName, row.legalNameSupplier, row.legalNamePrefilled, row.legalNameEditedAt),
      publicHandle: field(row.publicHandle, row.publicHandleSupplier, row.publicHandlePrefilled, row.publicHandleEditedAt),
      email: field(row.email, row.emailSupplier, row.emailPrefilled, row.emailEditedAt),
      phone: field(row.phone, row.phoneSupplier, row.phonePrefilled, row.phoneEditedAt),
      channelReference: field(row.channelReference, row.channelReferenceSupplier, row.channelReferencePrefilled, row.channelReferenceEditedAt),
      audienceNiche: field(row.audienceNiche, row.audienceNicheSupplier, row.audienceNichePrefilled, row.audienceNicheEditedAt),
      audienceSize: field(row.audienceSize, row.audienceSizeSupplier, row.audienceSizePrefilled, row.audienceSizeEditedAt),
      bio: field(row.bio, row.bioSupplier, row.bioPrefilled, row.bioEditedAt),
      // Never prefilled — Proovd does not learn these at recruitment, so
      // `prefilled` is honestly null rather than a copy of what they typed.
      dateOfBirth: field(row.dateOfBirth, row.dateOfBirth === null ? null : 'affiliate', null, null),
      country: field(row.country, row.country === null ? null : 'affiliate', null, null),
      stateRegion: field(row.stateRegion, row.stateRegion === null ? null : 'affiliate', null, null),
    },
    channelSubtype,
    phoneVerified: false,
    confirmations: {
      age18Plus: row.confirmAge18Plus,
      usBased: row.confirmUsBased,
      actualOperator: row.confirmActualOperator,
      noDuplicateAccounts: row.confirmNoDuplicateAccounts,
      sanctionsEligible: row.confirmSanctionsEligible,
    },
    payout: {
      status: row.payoutStatus,
      connectedAccountId: row.connectedAccountId,
      requirements: row.payoutRequirements,
      updatedAt: iso(row.payoutStatusUpdatedAt),
    },
    lastSavedAt: iso(row.lastSavedAt),
    claimedAt: iso(row.claimedAt),
  };
}

/**
 * Creates the profile from the §8 recruitment record on first read.
 *
 * The prefill snapshot is written once, here, and never again — that is what
 * lets the surface still say "Proovd wrote this" after the Creator has replaced
 * it, which is §11's "source label for prefilled public information."
 */
export async function ensureSignupProfile(
  db: Database,
  associationId: string,
  actor: string,
): Promise<SignupProfileState | null> {
  const [row] = await db
    .select({ association: campaignAffiliateAssociations, prospect: affiliateProspects })
    .from(campaignAffiliateAssociations)
    .innerJoin(
      affiliateProspects,
      eq(campaignAffiliateAssociations.prospectId, affiliateProspects.id),
    )
    .where(eq(campaignAffiliateAssociations.id, associationId))
    .limit(1);

  if (!row) return null;

  const p = row.prospect;
  const supplied = (value: string | null) => (value === null ? null : ('proovd' as const));

  await db
    .insert(affiliateSignupProfiles)
    .values({
      prospectId: p.id,
      associationId,
      legalName: p.legalName,
      legalNamePrefilled: p.legalName,
      legalNameSupplier: supplied(p.legalName),
      publicHandle: p.publicHandle,
      publicHandlePrefilled: p.publicHandle,
      publicHandleSupplier: supplied(p.publicHandle),
      email: p.email,
      emailPrefilled: p.email,
      emailSupplier: supplied(p.email),
      phone: p.phone,
      phonePrefilled: p.phone,
      phoneSupplier: supplied(p.phone),
      channelReference: p.channelReference,
      channelReferencePrefilled: p.channelReference,
      channelReferenceSupplier: supplied(p.channelReference),
      audienceNiche: p.audienceNiche,
      audienceNichePrefilled: p.audienceNiche,
      audienceNicheSupplier: supplied(p.audienceNiche),
      audienceSize: p.audienceSize,
      audienceSizePrefilled: p.audienceSize,
      audienceSizeSupplier: supplied(p.audienceSize),
      bio: p.adminBio,
      bioPrefilled: p.adminBio,
      bioSupplier: supplied(p.adminBio),
      updatedBy: actor,
    })
    .onConflictDoNothing({ target: affiliateSignupProfiles.associationId });

  return readSignupProfile(db, associationId);
}

export async function readSignupProfile(
  db: Database,
  associationId: string,
): Promise<SignupProfileState | null> {
  const [row] = await db
    .select({
      profile: affiliateSignupProfiles,
      subtype: affiliateProspects.subtype,
      campaignId: campaignAffiliateAssociations.campaignId,
    })
    .from(affiliateSignupProfiles)
    .innerJoin(affiliateProspects, eq(affiliateSignupProfiles.prospectId, affiliateProspects.id))
    .innerJoin(
      campaignAffiliateAssociations,
      eq(affiliateSignupProfiles.associationId, campaignAffiliateAssociations.id),
    )
    .where(eq(affiliateSignupProfiles.associationId, associationId))
    .limit(1);

  if (!row) return null;
  return { ...toState(row.profile, row.subtype), campaignId: row.campaignId };
}

/* ── Saving (§11, DNA §5.12) ──────────────────────────────────────────────── */

export interface SaveSignupInput {
  legalName?: string | null;
  publicHandle?: string | null;
  email?: string | null;
  phone?: string | null;
  channelReference?: string | null;
  audienceNiche?: string | null;
  audienceSize?: string | null;
  bio?: string | null;
  dateOfBirth?: string | null;
  country?: string | null;
  stateRegion?: string | null;
  confirmAge18Plus?: boolean;
  confirmUsBased?: boolean;
  confirmActualOperator?: boolean;
  confirmNoDuplicateAccounts?: boolean;
  confirmSanctionsEligible?: boolean;
  actor: string;
}

export type SaveSignupResult =
  | { ok: true; state: SignupProfileState }
  | { ok: false; message: string; next: string };

function normalise(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** `YYYY-MM-DD`, and a real date. Nothing here computes an age (§11, §5.3). */
function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export async function saveSignupProfile(
  db: Database,
  associationId: string,
  input: SaveSignupInput,
): Promise<SaveSignupResult> {
  // Create-if-absent: the first thing that happens on this surface may be a
  // keystroke rather than a read.
  const current = await ensureSignupProfile(db, associationId, input.actor);
  if (!current) {
    return { ok: false, message: 'This invitation is no longer available.', next: 'Nothing was saved.' };
  }
  if (current.claimedAt) {
    return {
      ok: false,
      message: 'This invitation has already been used and is now an account.',
      next: 'Sign in instead. Nothing was changed.',
    };
  }

  if (input.dateOfBirth !== undefined && input.dateOfBirth !== null) {
    const value = normalise(input.dateOfBirth);
    if (value !== null && !validDate(value)) {
      return {
        ok: false,
        message: 'That date of birth is not a real date.',
        next: 'Use the format YYYY-MM-DD. Everything else you have entered is still saved.',
      };
    }
  }

  const now = new Date();
  const patch: Record<string, unknown> = { lastSavedAt: now, updatedBy: input.actor, updatedAt: now };

  const text = (
    key: keyof SaveSignupInput,
    column: string,
    supplierColumn: string | null,
    editedColumn: string | null,
    prefilled: string | null,
    currentValue: string | null,
  ): void => {
    const incoming = input[key] as string | null | undefined;
    if (incoming === undefined) return;
    const next = normalise(incoming);
    patch[column] = next;
    if (supplierColumn) {
      // §11's source label: back to `proovd` if they restored what Proovd wrote,
      // theirs otherwise. The label describes the value, not the last actor.
      patch[supplierColumn] = next === null ? null : next === prefilled ? 'proovd' : 'affiliate';
    }
    if (editedColumn && next !== currentValue) patch[editedColumn] = now;
  };

  const f = current.fields;
  text('legalName', 'legalName', 'legalNameSupplier', 'legalNameEditedAt', f.legalName.prefilled, f.legalName.value);
  text('publicHandle', 'publicHandle', 'publicHandleSupplier', 'publicHandleEditedAt', f.publicHandle.prefilled, f.publicHandle.value);
  text('phone', 'phone', 'phoneSupplier', 'phoneEditedAt', f.phone.prefilled, f.phone.value);
  text('channelReference', 'channelReference', 'channelReferenceSupplier', 'channelReferenceEditedAt', f.channelReference.prefilled, f.channelReference.value);
  text('audienceNiche', 'audienceNiche', 'audienceNicheSupplier', 'audienceNicheEditedAt', f.audienceNiche.prefilled, f.audienceNiche.value);
  text('audienceSize', 'audienceSize', 'audienceSizeSupplier', 'audienceSizeEditedAt', f.audienceSize.prefilled, f.audienceSize.value);
  text('bio', 'bio', 'bioSupplier', 'bioEditedAt', f.bio.prefilled, f.bio.value);
  text('dateOfBirth', 'dateOfBirth', null, null, null, f.dateOfBirth.value);
  text('country', 'country', null, null, null, f.country.value);
  text('stateRegion', 'stateRegion', null, null, null, f.stateRegion.value);

  if (input.email !== undefined) {
    const next = normalise(input.email)?.toLowerCase() ?? null;
    patch['email'] = next;
    patch['emailSupplier'] = next === null ? null : next === f.email.prefilled ? 'proovd' : 'affiliate';
    if (next !== f.email.value) patch['emailEditedAt'] = now;
  }

  // §28.4: each confirmation is its own unchecked control and its own column.
  // Nothing here can set more than one from a single flag.
  if (input.confirmAge18Plus !== undefined) patch['confirmAge18Plus'] = input.confirmAge18Plus === true;
  if (input.confirmUsBased !== undefined) patch['confirmUsBased'] = input.confirmUsBased === true;
  if (input.confirmActualOperator !== undefined) patch['confirmActualOperator'] = input.confirmActualOperator === true;
  if (input.confirmNoDuplicateAccounts !== undefined) patch['confirmNoDuplicateAccounts'] = input.confirmNoDuplicateAccounts === true;
  if (input.confirmSanctionsEligible !== undefined) patch['confirmSanctionsEligible'] = input.confirmSanctionsEligible === true;

  await db
    .update(affiliateSignupProfiles)
    .set(patch)
    .where(eq(affiliateSignupProfiles.associationId, associationId));

  // §23.4: opening the invitation and typing into it is `signup_started`. The
  // conditional UPDATE means only the first save transitions; later saves match
  // nothing and write no second history row.
  await transitionAssociation(associationId, 'invited', 'signup_started', input.actor, db);

  const state = await readSignupProfile(db, associationId);
  return state
    ? { ok: true, state }
    : { ok: false, message: 'This invitation is no longer available.', next: 'Nothing was saved.' };
}

/* ── Completing the claim (§11) ───────────────────────────────────────────── */

export interface CompleteSignupInput {
  associationId: string;
  tokenId: string;
  password: string;
  /** Each acceptance arrives from its own unchecked control (§28.4). */
  acceptedPolicySlugs: readonly string[];
  actor: string;
}

export type SignupRefusal =
  | 'unavailable'
  | 'profile_incomplete'
  | 'confirmations_missing'
  | 'consent_missing'
  | 'policies_unpublished'
  | 'credentials_missing'
  | 'already_claimed';

export type CompleteSignupResult =
  | { ok: true; userId: string; associationId: string; campaignId: string }
  | { ok: false; code: SignupRefusal; message: string; next: string; missing?: string[] };

export async function completeAffiliateSignup(
  db: Database,
  auth: Auth,
  tokens: TokenService,
  input: CompleteSignupInput,
): Promise<CompleteSignupResult> {
  const profile = await readSignupProfile(db, input.associationId);
  if (!profile) {
    return {
      ok: false,
      code: 'unavailable',
      message: 'This invitation is no longer available.',
      next: 'Nothing was created. Reply to your invitation email and we will help.',
    };
  }
  if (profile.claimedAt) {
    return {
      ok: false,
      code: 'already_claimed',
      message: 'This invitation has already been used.',
      next: 'Sign in with the account it created.',
    };
  }

  /* ── The gates §11 puts before account creation ────────────────────────── */

  const missing: string[] = [];
  if (!profile.fields.legalName.value) missing.push('legalName');
  if (!profile.fields.publicHandle.value) missing.push('publicHandle');
  if (!profile.fields.email.value) missing.push('email');
  if (!profile.fields.dateOfBirth.value) missing.push('dateOfBirth');
  if (!profile.fields.country.value) missing.push('country');
  if (!profile.fields.stateRegion.value) missing.push('stateRegion');
  if (missing.length > 0) {
    return {
      ok: false,
      code: 'profile_incomplete',
      message: 'Some details are still needed before an account can be created.',
      next: 'Fill them in. Everything else you have entered is saved.',
      missing,
    };
  }

  // §11's five, each its own column, all required. §28.4 forbids bundling them,
  // so they are checked as five facts rather than as one.
  const c = profile.confirmations;
  const unconfirmed = [
    !c.age18Plus ? 'age18Plus' : null,
    !c.usBased ? 'usBased' : null,
    !c.actualOperator ? 'actualOperator' : null,
    !c.noDuplicateAccounts ? 'noDuplicateAccounts' : null,
    !c.sanctionsEligible ? 'sanctionsEligible' : null,
  ].filter((v): v is string => v !== null);

  if (unconfirmed.length > 0) {
    return {
      ok: false,
      code: 'confirmations_missing',
      message: 'All five confirmations are required before an account can be created.',
      next: 'Nothing was created and nothing you entered was lost.',
      missing: unconfirmed,
    };
  }

  /* ── Policy acceptance (§11, §29.8, §31.4) ─────────────────────────────── */

  const required = await db
    .select({
      id: policyVersions.id,
      slug: policyVersions.slug,
      version: policyVersions.version,
      status: policyVersions.status,
    })
    .from(policyVersions);

  const byS = new Map(required.map((row) => [row.slug, row]));
  const unpublished = AFFILIATE_CLAIM_POLICY_SLUGS.filter(
    (slug) => byS.get(slug)?.status !== 'published',
  );

  if (unpublished.length > 0) {
    // Not a soft failure and not something to route around. §31.4 forbids
    // shipping a placeholder or a summary as the document; §1 rule 6 forbids
    // writing the real text. The honest answer is that the account cannot be
    // created yet, and why.
    return {
      ok: false,
      code: 'policies_unpublished',
      message:
        'We cannot create your account yet: the agreements you would be accepting are still with our lawyers, and we will not ask you to sign something that is not final.',
      next: 'Nothing was created and nothing you entered was lost. We will email you the moment this opens — there is nothing for you to do.',
      missing: [...unpublished],
    };
  }

  const accepted = new Set(input.acceptedPolicySlugs);
  const notAccepted = AFFILIATE_CLAIM_POLICY_SLUGS.filter((slug) => !accepted.has(slug));
  if (notAccepted.length > 0) {
    return {
      ok: false,
      code: 'consent_missing',
      message: 'Each agreement has to be accepted before an account can be created.',
      next: 'Nothing was created and nothing you entered was lost.',
      missing: [...notAccepted],
    };
  }

  /* ── The identity (§5.3: email + password, invitation only) ────────────── */

  if (!input.password) {
    return {
      ok: false,
      code: 'credentials_missing',
      message: 'Choose a password.',
      next: 'Nothing was created and nothing you entered was lost.',
    };
  }
  if (input.password.length < 12) {
    return {
      ok: false,
      code: 'credentials_missing',
      message: 'That password is too short. Use at least 12 characters.',
      next: 'Nothing was created and nothing you entered was lost.',
    };
  }

  const email = profile.fields.email.value!.toLowerCase();

  const [prospectRow] = await db
    .select({ prospectId: affiliateSignupProfiles.prospectId })
    .from(affiliateSignupProfiles)
    .where(eq(affiliateSignupProfiles.associationId, input.associationId))
    .limit(1);

  if (!prospectRow) {
    return {
      ok: false,
      code: 'unavailable',
      message: 'This invitation is no longer available.',
      next: 'Nothing was created.',
    };
  }

  // Outside the transaction, deliberately — see the file header.
  const ctx = await auth.$context;
  const created = await ctx.internalAdapter.createUser({
    email,
    name: profile.fields.publicHandle.value ?? profile.fields.legalName.value!,
    // §5.3 admits Affiliates by private invitation only, and §5.1's rule that
    // `role` has no database default means every creation path states it.
    role: 'affiliate',
    // §5.3, §33.1.8: collected and explicitly unverified. There is no parameter
    // here that could mark it otherwise, and the database rejects the attempt.
    phone: profile.fields.phone.value,
    phoneVerified: false,
    emailVerified: false,
  });
  const hash = await ctx.password.hash(input.password);
  await ctx.internalAdapter.linkAccount({
    userId: created.id,
    providerId: 'credential',
    accountId: created.id,
    password: hash,
  });
  const userId = created.id;

  /* ── The claim itself: one transaction (§11, §33.2.1) ──────────────────── */

  const now = new Date();

  try {
    await db.transaction(async (tx) => {
      // The exactly-once pivot, inserted first so everything after it is
      // protected by the same unique index.
      await tx.insert(idempotencyKeys).values({
        key: affiliateSignupCompleteKey(input.associationId),
        purpose: AFFILIATE_SIGNUP_COMPLETE,
        completedAt: now,
        result: {
          associationId: input.associationId,
          campaignId: profile.campaignId,
          affiliateUserId: userId,
        },
      });

      // 08a's conditional UPDATE, scoped to `affiliate_invitation` so a Founder
      // draft token can never be burned here. Two concurrent claims: one wins.
      const claimed = await tokens.claimAffiliateInvitation(input.tokenId, tx);
      if (!claimed.ok) throw new SignupConflict();

      const moved = await tx
        .update(affiliateSignupProfiles)
        .set({ claimedAt: now, claimedUserId: userId, updatedBy: `user:${userId}`, updatedAt: now })
        .where(
          and(
            eq(affiliateSignupProfiles.associationId, input.associationId),
            isNull(affiliateSignupProfiles.claimedAt),
          ),
        )
        .returning({ id: affiliateSignupProfiles.id });

      if (moved.length !== 1) throw new SignupConflict();

      await tx
        .update(affiliateProspects)
        .set({ claimedUserId: userId, claimedAt: now, updatedAt: now })
        .where(eq(affiliateProspects.id, prospectRow.prospectId));

      await tx
        .update(campaignAffiliateAssociations)
        .set({ invitationStatus: 'claimed', updatedAt: now })
        .where(eq(campaignAffiliateAssociations.id, input.associationId));

      // §23.4: whichever state the association is in, it ends at
      // `signed_up_waiting_for_founder`. A Creator who claimed without saving
      // first is still `invited`, so both hops run and both history rows land —
      // skipping the intermediate one would misreport the path they took.
      await transitionAssociation(input.associationId, 'invited', 'signup_started', `user:${userId}`, tx);
      const arrived = await transitionAssociation(
        input.associationId,
        'signup_started',
        'signed_up_waiting_for_founder',
        `user:${userId}`,
        tx,
      );
      if (!arrived) throw new SignupConflict();

      for (const slug of AFFILIATE_CLAIM_POLICY_SLUGS) {
        const version = byS.get(slug)!;
        await tx.insert(policyConsents).values({
          subjectType: 'user',
          subjectId: userId,
          policyVersionId: version.id,
          slug: version.slug,
          version: version.version,
          acceptedVia: 'affiliate_account_claim',
        });
      }

      await tx.insert(auditEvents).values({
        actor: `user:${userId}`,
        targetType: 'affiliate_association',
        targetId: input.associationId,
        action: AFFILIATE_SIGNUP_COMPLETE,
        internalReason:
          'Creator account created from the campaign-specific invitation; invitation token invalidated; association → signed_up_waiting_for_founder (§11)',
        customerExplanation: 'Your Proovd account is set up.',
        priorValue: { claimed: false },
        newValue: {
          affiliateUserId: userId,
          associationId: input.associationId,
          campaignId: profile.campaignId,
          acceptedPolicies: AFFILIATE_CLAIM_POLICY_SLUGS.map((slug) => {
            const v = byS.get(slug)!;
            return `${v.slug}@${v.version}`;
          }),
          corrections: correctedFields(profile),
        },
      });
    });
  } catch (error) {
    if (error instanceof SignupConflict || isUniqueViolation(error)) {
      return {
        ok: false,
        code: 'already_claimed',
        message: 'This invitation has already been used.',
        next: 'Sign in with the account it created.',
      };
    }
    throw error;
  }

  return { ok: true, userId, associationId: input.associationId, campaignId: profile.campaignId };
}

class SignupConflict extends Error {}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505'
  );
}

/** §11: Admin sees "corrections to prefilled fields". */
function correctedFields(profile: SignupProfileState): string[] {
  return Object.entries(profile.fields)
    .filter(([, state]) => state.supplier === 'affiliate' && state.prefilled !== null)
    .map(([key]) => key);
}

/* ── §11's conditional states ─────────────────────────────────────────────── */

/**
 * Which of §11's conditional states this Creator is in.
 *
 * §11 lists five. Two of them belong to later phases and this resolver says so
 * rather than pretending: `listing_paid` is Phase 12's formal decision, and the
 * Stripe-onboarding branches are Phase 10's once a connected account can exist.
 * What Phase 08b can answer truthfully is which of the first two applies.
 *
 * `preparing` is deliberately reported but NOT rendered as a reviewable
 * campaign in this phase. §10's handoff — the campaign appearing exactly once
 * with a `Review campaign` action and the Campaign kit behind it — is Phase
 * 08c's, and a surface that offered the action before the kit existed would
 * claim a capability the product does not have (§1.4).
 */
export type SignupConditionalState =
  | 'not_signed_up'
  /** §11: "Founder not claimed" — the named waiting state §33.2.3 is about. */
  | 'awaiting_founder'
  /** §11: "Founder claimed, listing unpaid". The kit arrives in Phase 08c. */
  | 'preparing'
  /** §11: "Listing paid" — Phase 12's formal decision state. */
  | 'formal_decision_open';

export interface SignupConditionalView {
  state: SignupConditionalState;
  campaignId: string;
  /** The product this invitation was for. §11: the waiting state names it. */
  productName: string | null;
  founderClaimedAt: string | null;
  listingPaidAt: string | null;
  payoutStatus: string;
  /** True while the Campaign kit is not yet buildable (Phase 08c). */
  reviewAvailable: false;
}

export async function readConditionalState(
  db: Database,
  associationId: string,
  productName: string | null,
): Promise<SignupConditionalView | null> {
  const [row] = await db
    .select({
      campaignId: campaignAffiliateAssociations.campaignId,
      listingPaidAt: campaigns.listingPaidAt,
      claimedAt: affiliateSignupProfiles.claimedAt,
      payoutStatus: affiliateSignupProfiles.payoutStatus,
    })
    .from(campaignAffiliateAssociations)
    .innerJoin(campaigns, eq(campaignAffiliateAssociations.campaignId, campaigns.id))
    .leftJoin(
      affiliateSignupProfiles,
      eq(affiliateSignupProfiles.associationId, campaignAffiliateAssociations.id),
    )
    .where(eq(campaignAffiliateAssociations.id, associationId))
    .limit(1);

  if (!row) return null;

  const signupComplete = await readSignupComplete(db, row.campaignId);

  const state: SignupConditionalState = !row.claimedAt
    ? 'not_signed_up'
    : row.listingPaidAt
      ? 'formal_decision_open'
      : signupComplete
        ? 'preparing'
        : 'awaiting_founder';

  return {
    state,
    campaignId: row.campaignId,
    productName,
    founderClaimedAt: signupComplete?.occurredAt ?? null,
    listingPaidAt: iso(row.listingPaidAt),
    payoutStatus: row.payoutStatus ?? 'not_started',
    reviewAvailable: false,
  };
}
