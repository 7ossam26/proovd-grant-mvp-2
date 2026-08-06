/**
 * The Founder account claim — Spec §10, §5.2, §25.5, §28.4, §33.1.8, §33.1.9.
 *
 * The moment a draft becomes a person with an account. §10 lists five things a
 * successful claim does and the word it uses is "Successful claim:" — one
 * outcome, not five that might each land:
 *
 *   creates the Founder account, invalidates the draft token, preserves the
 *   draft and its provenance in the account/campaign record, emits
 *   `founder_signup_complete` exactly once, and moves the campaign to
 *   `account_claimed`.
 *
 * ── Exactly once, under retry and under concurrency (§33.1.9) ───────────────
 * Two mechanisms, because they fail differently.
 *
 * `idempotency_keys` carries `founder_signup_complete:<campaignId>` and is
 * inserted inside the claim transaction. Its unique index is what makes the
 * event singular: a second claim — a retry, a double-submit, a resend-then-claim
 * against a fresh token — hits the constraint and the whole transaction rolls
 * back, so there is no second account either.
 *
 * `tokens.claimDraft` is Phase 04's conditional UPDATE and settles the race
 * between two requests holding the *same* link. It runs inside the same
 * transaction, so a claim that fails after it cannot leave a token burned with
 * no account behind it.
 *
 * The event itself is the idempotency row plus the audit row. Phase 08 consumes
 * it to reveal the preparing campaign to recruited Affiliates; §10's Affiliate
 * handoff is deliberately not here, because no Affiliate exists to reveal it to
 * and a handler with nothing to handle is a claim that a feature exists (§1.4).
 *
 * ── Why a draft policy blocks the claim ─────────────────────────────────────
 * §10 requires "Terms, Founder AUP, privacy, and applicable policy acceptance",
 * and a consent record may cite only a published version — enforced by trigger,
 * not by this file. All eight §31.4 documents are currently drafts pending legal
 * review, so this refuses, in the open, with the reason. Accepting a document
 * that Proovd's own lawyers have not signed off records agreement to nothing,
 * and §1 rule 6 forbids inventing the text that would fix it. The prerequisites
 * panel already blocks on the same fact.
 *
 * ── Phone (§33.1.8) ─────────────────────────────────────────────────────────
 * Collected, stored, never verified. There is no code path here that sends a
 * code, and `user.phone_verified` is CHECK-pinned false in the database.
 */

import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import type { Auth } from '../auth/auth.js';
import type { TokenService } from '../auth/token-service.js';
import { campaigns, campaignStatusHistory } from '../db/schema/domain.js';
import { campaignDrafts, founderProspects } from '../db/schema/invitations.js';
import {
  campaignVetting,
  founderClaimProfiles,
  policyConsents,
  type FounderClaimProfile,
} from '../db/schema/vetting.js';
import { policyVersions } from '../db/schema/policies.js';
import { auditEvents, idempotencyKeys } from '../db/schema/integrity.js';
import { user as userTable } from '../db/schema/auth.js';
import { readPossibleCreatorSignal, viewCreatorSignal } from './service.js';

/**
 * The domain event §10 names and §33.1.9 counts.
 *
 * Not a notification key. §27.4's `affiliate_founder_signup_completed` is the
 * message an Affiliate receives when Phase 08 consumes this; this is the fact
 * that happened. Naming the fact after the message would make "emitted once"
 * mean "emailed once", which is a different and weaker guarantee.
 */
export const FOUNDER_SIGNUP_COMPLETE = 'founder_signup_complete' as const;

export function founderSignupCompleteKey(campaignId: string): string {
  return `${FOUNDER_SIGNUP_COMPLETE}:${campaignId}`;
}

/**
 * The §31.4 documents a Founder accepts at claim, from §10's own list:
 * "Terms, Founder AUP, privacy, and applicable policy acceptance."
 *
 * `affiliate-aup` and `ip-agreement` are Creator-only (§31.5). `refunds` and
 * `fulfillment` are disclosed per campaign and per checkout and are accepted
 * there, not here. `cookies` is a notice, not an agreement. Adding one of those
 * to this list would collect an acceptance the Spec does not ask for; leaving
 * one of these three out would skip one it does.
 */
export const FOUNDER_CLAIM_POLICY_SLUGS = ['terms', 'aup', 'privacy'] as const;

/* ── The prefilled, editable profile (§10) ────────────────────────────────── */

export interface ClaimFieldState {
  value: string | null;
  /** §10: whether Proovd or the Founder supplied the value now in the box. */
  supplier: 'proovd' | 'founder' | null;
  /** What the invitation and discovery supplied. Frozen at creation. */
  prefilled: string | null;
  editedAt: string | null;
}

export interface ClaimProfileState {
  draftId: string;
  campaignId: string;
  fields: {
    legalName: ClaimFieldState;
    preferredName: ClaimFieldState;
    email: ClaimFieldState;
    phone: ClaimFieldState;
    dateOfBirth: ClaimFieldState;
    country: ClaimFieldState;
    stateRegion: ClaimFieldState;
    businessName: ClaimFieldState;
    businessEntityType: ClaimFieldState;
  };
  soleProprietor: boolean | null;
  /** §5.2. Derived from how the address arrived; never asserted as verified. */
  emailOwnership: 'invited_link' | 'google_oauth' | 'self_supplied_unverified' | null;
  /** §5.2/§33.1.8: always false, and there is no route that changes it. */
  phoneVerified: false;
  representations: {
    usPerson: boolean;
    age18Plus: boolean;
    sanctions: boolean;
  };
  lastSavedAt: string | null;
  claimedAt: string | null;
}

const iso = (v: Date | null | undefined): string | null => v?.toISOString() ?? null;

function field(
  value: string | null,
  supplier: 'proovd' | 'founder' | null,
  prefilled: string | null,
  editedAt: Date | null,
): ClaimFieldState {
  return { value, supplier, prefilled, editedAt: iso(editedAt) };
}

function toClaimState(row: FounderClaimProfile): ClaimProfileState {
  return {
    draftId: row.draftId,
    campaignId: row.campaignId,
    fields: {
      legalName: field(row.legalName, row.legalNameSupplier, row.legalNamePrefilled, row.legalNameEditedAt),
      preferredName: field(
        row.preferredName,
        row.preferredNameSupplier,
        row.preferredNamePrefilled,
        row.preferredNameEditedAt,
      ),
      email: field(row.email, row.emailSupplier, row.emailPrefilled, row.emailEditedAt),
      phone: field(row.phone, row.phoneSupplier, row.phonePrefilled, row.phoneEditedAt),
      // Date of birth, country, state, and business details are never prefilled
      // — Proovd does not learn them at discovery. Their supplier is therefore
      // always the Founder, and `prefilled` is honestly null rather than a copy
      // of what they typed.
      dateOfBirth: field(row.dateOfBirth, row.dateOfBirthSupplier, null, row.dateOfBirthEditedAt),
      country: field(row.country, row.countrySupplier, null, row.countryEditedAt),
      stateRegion: field(row.stateRegion, row.stateRegionSupplier, null, row.stateRegionEditedAt),
      businessName: field(row.businessName, row.businessSupplier, null, row.businessEditedAt),
      businessEntityType: field(
        row.businessEntityType,
        row.businessSupplier,
        null,
        row.businessEditedAt,
      ),
    },
    soleProprietor: row.soleProprietor,
    emailOwnership: row.emailOwnership,
    phoneVerified: false,
    representations: {
      usPerson: row.representationUsPerson,
      age18Plus: row.representationAge18Plus,
      sanctions: row.representationSanctions,
    },
    lastSavedAt: iso(row.lastSavedAt),
    claimedAt: iso(row.claimedAt),
  };
}

/**
 * Creates the profile from the invitation and discovery record on first read.
 *
 * §10: "The account is prefilled from invitation/discovery and every prefilled
 * field is editable." The prefill snapshot is written once, here, and never
 * again — that is what lets the surface still say "Proovd suggested X" after
 * the Founder has replaced it with Y.
 */
export async function ensureClaimProfile(
  db: Database,
  draftId: string,
  actor: string,
): Promise<ClaimProfileState | null> {
  const [row] = await db
    .select({
      draft: campaignDrafts,
      prospect: founderProspects,
    })
    .from(campaignDrafts)
    .innerJoin(founderProspects, eq(campaignDrafts.prospectId, founderProspects.id))
    .where(eq(campaignDrafts.id, draftId))
    .limit(1);

  if (!row || row.draft.anonymisedAt) return null;

  const legalName = row.prospect.legalName;
  const preferredName = row.prospect.preferredName;
  const email = row.prospect.email;
  const phone = row.prospect.phone;

  await db
    .insert(founderClaimProfiles)
    .values({
      draftId,
      prospectId: row.prospect.id,
      campaignId: row.draft.campaignId,
      legalName,
      legalNamePrefilled: legalName,
      legalNameSupplier: legalName === null ? null : 'proovd',
      preferredName,
      preferredNamePrefilled: preferredName,
      preferredNameSupplier: preferredName === null ? null : 'proovd',
      email,
      emailPrefilled: email,
      emailSupplier: email === null ? null : 'proovd',
      // §5.2: "A private invitation or Google sign-in may establish invited-email
      // ownership." The address arrived on the invitation, so it is owned until
      // the Founder replaces it with one nobody has verified.
      emailOwnership: email === null ? null : 'invited_link',
      phone,
      phonePrefilled: phone,
      phoneSupplier: phone === null ? null : 'proovd',
      updatedBy: actor,
    })
    .onConflictDoNothing({ target: founderClaimProfiles.draftId });

  return readClaimProfile(db, draftId);
}

export async function readClaimProfile(
  db: Database,
  draftId: string,
): Promise<ClaimProfileState | null> {
  const [row] = await db
    .select()
    .from(founderClaimProfiles)
    .where(eq(founderClaimProfiles.draftId, draftId))
    .limit(1);

  if (!row || row.anonymisedAt) return null;
  return toClaimState(row);
}

/* ── Autosave (§10 fields, DNA §5.12) ─────────────────────────────────────── */

export interface SaveClaimInput {
  legalName?: string | null;
  preferredName?: string | null;
  email?: string | null;
  phone?: string | null;
  dateOfBirth?: string | null;
  country?: string | null;
  stateRegion?: string | null;
  soleProprietor?: boolean | null;
  businessName?: string | null;
  businessEntityType?: string | null;
  representationUsPerson?: boolean;
  representationAge18Plus?: boolean;
  representationSanctions?: boolean;
  actor: string;
}

export type SaveClaimResult =
  | { ok: true; state: ClaimProfileState }
  | { ok: false; message: string; next: string };

function normalise(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** `YYYY-MM-DD`, and a real date. Nothing here computes an age (§10, §5.2). */
function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export async function saveClaimProfile(
  db: Database,
  draftId: string,
  input: SaveClaimInput,
): Promise<SaveClaimResult> {
  // Create-if-absent, for the same reason `saveVetting` does: the first thing
  // that happens on this surface may be a keystroke, not a read.
  const current = await ensureClaimProfile(db, draftId, input.actor);
  if (!current) {
    return { ok: false, message: 'This draft is no longer available.', next: 'Nothing was saved.' };
  }
  if (current.claimedAt) {
    return {
      ok: false,
      message: 'This invitation has already been claimed and is now an account.',
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
  const patch: Record<string, unknown> = { lastSavedAt: now, updatedBy: input.actor };

  const text = (
    key: keyof SaveClaimInput,
    column: string,
    supplierColumn: string | null,
    editedColumn: string,
    prefilled: string | null,
    currentValue: string | null,
  ): void => {
    const incoming = input[key] as string | null | undefined;
    if (incoming === undefined) return;
    const next = normalise(incoming);
    patch[column] = next;
    if (supplierColumn) {
      patch[supplierColumn] =
        next === null ? null : next === prefilled ? 'proovd' : 'founder';
    }
    if (next !== currentValue) patch[editedColumn] = now;
  };

  const f = current.fields;
  text('legalName', 'legalName', 'legalNameSupplier', 'legalNameEditedAt', f.legalName.prefilled, f.legalName.value);
  text('preferredName', 'preferredName', 'preferredNameSupplier', 'preferredNameEditedAt', f.preferredName.prefilled, f.preferredName.value);
  text('phone', 'phone', 'phoneSupplier', 'phoneEditedAt', f.phone.prefilled, f.phone.value);
  text('dateOfBirth', 'dateOfBirth', 'dateOfBirthSupplier', 'dateOfBirthEditedAt', null, f.dateOfBirth.value);
  text('country', 'country', 'countrySupplier', 'countryEditedAt', null, f.country.value);
  text('stateRegion', 'stateRegion', 'stateRegionSupplier', 'stateRegionEditedAt', null, f.stateRegion.value);

  if (input.email !== undefined) {
    const next = normalise(input.email)?.toLowerCase() ?? null;
    patch['email'] = next;
    patch['emailSupplier'] = next === null ? null : next === f.email.prefilled ? 'proovd' : 'founder';
    // §5.2: the invitation establishes ownership of the address it was sent to,
    // and of no other. An address the Founder typed is recorded as unverified,
    // because it is — there is no email-verification route yet, and pretending
    // otherwise would be the §1.4 failure in one enum value.
    patch['emailOwnership'] =
      next === null ? null : next === f.email.prefilled ? 'invited_link' : 'self_supplied_unverified';
    if (next !== f.email.value) patch['emailEditedAt'] = now;
  }

  if (
    input.businessName !== undefined ||
    input.businessEntityType !== undefined ||
    input.soleProprietor !== undefined
  ) {
    if (input.soleProprietor !== undefined) patch['soleProprietor'] = input.soleProprietor;
    if (input.businessName !== undefined) patch['businessName'] = normalise(input.businessName);
    if (input.businessEntityType !== undefined) {
      patch['businessEntityType'] = normalise(input.businessEntityType);
    }
    patch['businessSupplier'] = 'founder';
    patch['businessEditedAt'] = now;
  }

  // §28.4: each representation is its own unchecked control and its own column.
  // Nothing here can set more than one from a single flag.
  if (input.representationUsPerson !== undefined) {
    patch['representationUsPerson'] = input.representationUsPerson === true;
  }
  if (input.representationAge18Plus !== undefined) {
    patch['representationAge18Plus'] = input.representationAge18Plus === true;
  }
  if (input.representationSanctions !== undefined) {
    patch['representationSanctions'] = input.representationSanctions === true;
  }

  await db.update(founderClaimProfiles).set(patch).where(eq(founderClaimProfiles.draftId, draftId));

  const state = await readClaimProfile(db, draftId);
  return state
    ? { ok: true, state }
    : { ok: false, message: 'This draft is no longer available.', next: 'Nothing was saved.' };
}

/* ── Completing the claim (§10) ───────────────────────────────────────────── */

export interface CompleteClaimInput {
  draftId: string;
  tokenId: string;
  /** §10: "Password creation or Google sign-in." */
  password?: string;
  /** An already-authenticated Founder, when they arrived through Google (§5.2). */
  googleUserId?: string;
  /** §10: the acceptances. Each arrives from its own unchecked control (§28.4). */
  acceptedPolicySlugs: readonly string[];
  actor: string;
}

export type CompleteClaimResult =
  | { ok: true; userId: string; campaignId: string; alreadyClaimed?: false }
  | { ok: false; code: ClaimRefusal; message: string; next: string; missing?: string[] };

export type ClaimRefusal =
  | 'unavailable'
  | 'vetting_incomplete'
  | 'creator_signal_pending'
  | 'profile_incomplete'
  | 'representations_missing'
  | 'consent_missing'
  | 'policies_unpublished'
  | 'credentials_missing'
  | 'already_claimed';

/**
 * §10's "Successful claim", as one transaction.
 *
 * The order below is deliberate: everything that can refuse runs before
 * anything is created, and everything that is created lands together. The one
 * step outside the transaction is Better Auth's account creation, because it
 * owns its own writes — so it happens first, and if the transaction then fails,
 * what is left is an account with no claim, which the same person can complete
 * by clicking the link again. The reverse — a claimed draft with no account —
 * would strand them behind a dead link with no way back.
 */
export async function completeClaim(
  db: Database,
  auth: Auth,
  tokens: TokenService,
  input: CompleteClaimInput,
): Promise<CompleteClaimResult> {
  const profile = await readClaimProfile(db, input.draftId);
  if (!profile) {
    return {
      ok: false,
      code: 'unavailable',
      message: 'This draft is no longer available.',
      next: 'Nothing was created. Reply to your invitation email and we will help.',
    };
  }
  if (profile.claimedAt) {
    return {
      ok: false,
      code: 'already_claimed',
      message: 'This invitation has already been claimed.',
      next: 'Sign in with the account it created.',
    };
  }

  /* ── The gates §10 puts before account creation ────────────────────────── */

  const [vetting] = await db
    .select({ submittedAt: campaignVetting.submittedAt })
    .from(campaignVetting)
    .where(eq(campaignVetting.draftId, input.draftId))
    .limit(1);

  if (!vetting?.submittedAt) {
    return {
      ok: false,
      code: 'vetting_incomplete',
      message: 'Your answers have not been submitted yet.',
      next: 'Finish the four questions first. Everything you have entered here is saved.',
    };
  }

  // §10: the possible-creator result is shown "before account creation", and a
  // zero routes to Admin "before the Founder proceeds". The surface already
  // enforces the order; this enforces it again on the server, because §1.1
  // requires server-side authorization and a hidden button is not one.
  const signal = viewCreatorSignal(await readPossibleCreatorSignal(db, profile.campaignId, { stampRendered: true }));
  if (signal.status !== 'available') {
    return {
      ok: false,
      code: 'creator_signal_pending',
      message: 'We are still reviewing your submission before this step opens.',
      next: 'Nothing was created. We will email you when it is ready — there is nothing for you to do.',
    };
  }

  const missing: string[] = [];
  if (!profile.fields.legalName.value) missing.push('legalName');
  if (!profile.fields.email.value) missing.push('email');
  if (!profile.fields.dateOfBirth.value) missing.push('dateOfBirth');
  if (!profile.fields.country.value) missing.push('country');
  if (!profile.fields.stateRegion.value) missing.push('stateRegion');
  if (profile.soleProprietor === null) missing.push('soleProprietor');
  if (profile.soleProprietor === false && !profile.fields.businessName.value) {
    missing.push('businessName');
  }
  if (missing.length > 0) {
    return {
      ok: false,
      code: 'profile_incomplete',
      message: 'Some details are still needed before an account can be created.',
      next: 'Fill them in. Everything else you have entered is saved.',
      missing,
    };
  }

  const r = profile.representations;
  if (!r.usPerson || !r.age18Plus || !r.sanctions) {
    return {
      ok: false,
      code: 'representations_missing',
      message: 'All three confirmations are required before an account can be created.',
      next: 'Nothing was created and nothing you entered was lost.',
    };
  }

  /* ── Policy acceptance (§10, §29.8, §31.4) ─────────────────────────────── */

  const required = await db
    .select({
      id: policyVersions.id,
      slug: policyVersions.slug,
      version: policyVersions.version,
      status: policyVersions.status,
    })
    .from(policyVersions);

  const byS = new Map(required.map((row) => [row.slug, row]));
  const unpublished = FOUNDER_CLAIM_POLICY_SLUGS.filter(
    (slug) => byS.get(slug)?.status !== 'published',
  );

  if (unpublished.length > 0) {
    // Not a soft failure and not something to route around. §31.4 forbids
    // shipping a placeholder or a summary as the document; §1 rule 6 forbids
    // writing the real text here. So the honest answer is that the account
    // cannot be created yet, and why.
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
  const notAccepted = FOUNDER_CLAIM_POLICY_SLUGS.filter((slug) => !accepted.has(slug));
  if (notAccepted.length > 0) {
    return {
      ok: false,
      code: 'consent_missing',
      message: 'Each agreement has to be accepted before an account can be created.',
      next: 'Nothing was created and nothing you entered was lost.',
      missing: [...notAccepted],
    };
  }

  /* ── The identity (§5.2: password or Google) ───────────────────────────── */

  if (!input.password && !input.googleUserId) {
    return {
      ok: false,
      code: 'credentials_missing',
      message: 'Choose a password, or continue with Google.',
      next: 'Nothing was created and nothing you entered was lost.',
    };
  }
  if (input.password !== undefined && input.password.length < 12) {
    return {
      ok: false,
      code: 'credentials_missing',
      message: 'That password is too short. Use at least 12 characters.',
      next: 'Nothing was created and nothing you entered was lost.',
    };
  }

  const email = profile.fields.email.value!.toLowerCase();

  const [draftRow] = await db
    .select({ prospectId: campaignDrafts.prospectId })
    .from(campaignDrafts)
    .where(eq(campaignDrafts.id, input.draftId))
    .limit(1);

  if (!draftRow) {
    return {
      ok: false,
      code: 'unavailable',
      message: 'This draft is no longer available.',
      next: 'Nothing was created.',
    };
  }

  let userId: string;

  if (input.googleUserId) {
    // The account already exists: Better Auth created it during the Google
    // round trip and `mapProfileToUser` fixed its role to `founder` (§5.2). All
    // that remains is to bind it to this draft.
    const [existing] = await db
      .select({ id: userTable.id, role: userTable.role })
      .from(userTable)
      .where(eq(userTable.id, input.googleUserId))
      .limit(1);

    if (!existing || existing.role !== 'founder') {
      return {
        ok: false,
        code: 'credentials_missing',
        message: 'That Google sign-in could not be matched to this invitation.',
        next: 'Nothing was created. Try again, or set a password instead.',
      };
    }
    userId = existing.id;
  } else {
    const ctx = await auth.$context;
    const created = await ctx.internalAdapter.createUser({
      email,
      name: profile.fields.preferredName.value ?? profile.fields.legalName.value!,
      role: 'founder',
      // §5.2, §33.1.8: collected and explicitly unverified. There is no
      // parameter here that could mark it otherwise, and the database rejects
      // the attempt regardless.
      phone: profile.fields.phone.value,
      phoneVerified: false,
      emailVerified: false,
    });
    const hash = await ctx.password.hash(input.password!);
    await ctx.internalAdapter.linkAccount({
      userId: created.id,
      providerId: 'credential',
      accountId: created.id,
      password: hash,
    });
    userId = created.id;
  }

  /* ── The claim itself: one transaction (§10, §33.1.9) ──────────────────── */

  const now = new Date();

  try {
    await db.transaction(async (tx) => {
      // The exactly-once pivot. Inserted first so that everything after it is
      // protected by the same unique index, and a duplicate aborts the whole
      // transaction rather than the last statement of it.
      await tx.insert(idempotencyKeys).values({
        key: founderSignupCompleteKey(profile.campaignId),
        purpose: FOUNDER_SIGNUP_COMPLETE,
        completedAt: now,
        result: { campaignId: profile.campaignId, founderUserId: userId, draftId: input.draftId },
      });

      // §10: "Invalidates the draft token." Phase 04's conditional UPDATE, run
      // inside this transaction so a later failure cannot leave a burned token
      // beside a claim that never happened.
      const claimed = await tokens.claimDraft(input.tokenId, tx);
      if (!claimed.ok) throw new ClaimConflict();

      const moved = await tx
        .update(campaigns)
        .set({ status: 'account_claimed' })
        .where(
          and(eq(campaigns.id, profile.campaignId), eq(campaigns.status, 'vetting_submitted')),
        )
        .returning({ id: campaigns.id });

      if (moved.length !== 1) throw new ClaimConflict();

      await tx.insert(campaignStatusHistory).values({
        campaignId: profile.campaignId,
        fromStatus: 'vetting_submitted',
        toStatus: 'account_claimed',
        actor: `user:${userId}`,
      });

      await tx
        .update(founderClaimProfiles)
        .set({ claimedAt: now, claimedUserId: userId, updatedBy: `user:${userId}` })
        .where(
          and(
            eq(founderClaimProfiles.draftId, input.draftId),
            isNull(founderClaimProfiles.claimedAt),
          ),
        );

      // §10: "Preserves the draft and provenance in the account/campaign
      // record." The draft, the vetting answers, and every `draft_field_edits`
      // row stay exactly where they are and become part of the Founder record
      // (§25.5: "invitation/draft IDs, field provenance"). This is also what
      // takes the record out of the §25.8 sweep — `findDueDrafts` filters on
      // both of these, deliberately redundantly.
      await tx
        .update(founderProspects)
        .set({ claimedUserId: userId, claimedAt: now })
        .where(eq(founderProspects.id, draftRow.prospectId));

      await tx
        .update(campaignDrafts)
        .set({ status: 'claimed' })
        .where(eq(campaignDrafts.id, input.draftId));

      for (const slug of FOUNDER_CLAIM_POLICY_SLUGS) {
        const version = byS.get(slug)!;
        await tx.insert(policyConsents).values({
          subjectType: 'user',
          subjectId: userId,
          policyVersionId: version.id,
          slug: version.slug,
          version: version.version,
          acceptedVia: 'founder_account_claim',
        });
      }

      await tx.insert(auditEvents).values({
        actor: `user:${userId}`,
        targetType: 'campaign',
        targetId: profile.campaignId,
        action: FOUNDER_SIGNUP_COMPLETE,
        internalReason:
          'Founder account claimed from the invited draft; draft token invalidated; status vetting_submitted → account_claimed (§10)',
        customerExplanation: 'Your Proovd account is set up.',
        priorValue: { status: 'vetting_submitted', claimed: false },
        newValue: {
          status: 'account_claimed',
          founderUserId: userId,
          draftId: input.draftId,
          emailOwnership: profile.emailOwnership,
          acceptedPolicies: FOUNDER_CLAIM_POLICY_SLUGS.map((slug) => {
            const v = byS.get(slug)!;
            return `${v.slug}@${v.version}`;
          }),
        },
      });
    });
  } catch (error) {
    if (error instanceof ClaimConflict || isUniqueViolation(error)) {
      return {
        ok: false,
        code: 'already_claimed',
        message: 'This invitation has already been claimed.',
        next: 'Sign in with the account it created.',
      };
    }
    throw error;
  }

  return { ok: true, userId, campaignId: profile.campaignId };
}

class ClaimConflict extends Error {}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === '23505'
  );
}

/**
 * Whether `founder_signup_complete` has been emitted for a campaign.
 *
 * Phase 08 reads this to reveal the preparing campaign to recruited Affiliates.
 * It is a query rather than a subscription because the row is the event: there
 * is nothing to miss and nothing to replay wrongly.
 */
export async function readSignupComplete(
  db: Database,
  campaignId: string,
): Promise<{ campaignId: string; founderUserId: string; occurredAt: string } | null> {
  const [row] = await db
    .select()
    .from(idempotencyKeys)
    .where(eq(idempotencyKeys.key, founderSignupCompleteKey(campaignId)))
    .limit(1);

  if (!row) return null;
  const result = row.result as { founderUserId?: string } | null;
  return {
    campaignId,
    founderUserId: result?.founderUserId ?? '',
    occurredAt: (row.completedAt ?? row.createdAt).toISOString(),
  };
}
