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
 * `tokens.claimDraft` settles the race between requests holding a legacy live
 * invite. In the verified flow the invitation was already consumed when the
 * independent flow session was established, so the account transaction relies
 * on the same idempotency key and conditional campaign move instead.
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

import { randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import type { Auth } from '../auth/auth.js';
import type { TokenService } from '../auth/token-service.js';
import { campaigns, campaignStatusHistory } from '../db/schema/domain.js';
import { campaignDrafts, founderProspects } from '../db/schema/invitations.js';
import { campaignBuild } from '../db/schema/build.js';
import {
  campaignVetting,
  founderClaimProfiles,
  policyConsents,
  type FounderClaimProfile,
} from '../db/schema/vetting.js';
import { policyVersions } from '../db/schema/policies.js';
import { auditEvents, idempotencyKeys } from '../db/schema/integrity.js';
import { user as userTable } from '../db/schema/auth.js';

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
  /**
   * §5.2. Derived from how the address ARRIVED — never asserted.
   *
   * `code_verified` is the one state that is evidence rather than provenance:
   * a code we sent to that exact address came back (Founder Flow v2 Session C,
   * a recorded §1 rule 6 deviation). It is granted by one path and survives
   * only while the address does — editing it re-derives from the new value.
   */
  emailOwnership:
    | 'invited_link'
    | 'google_oauth'
    | 'self_supplied_unverified'
    | 'code_verified'
    | null;
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
  const username = row.prospect.username;

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
      username,
      usernamePrefilled: username,
      usernameSupplier: username === null ? null : 'proovd',
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
    /*
     * §5.2: the invitation establishes ownership of the address it was sent
     * to, and of no other. An address the Founder typed is recorded as
     * unverified, because it is.
     *
     * It is re-derived only when the value actually CHANGES (Founder Flow v2
     * Session C). Recomputing on every save was harmless while the three
     * states were all provenance — the answer never differed — and stopped
     * being harmless the moment `code_verified` existed: a Founder who
     * verified their address and then typed the same address again would have
     * silently dropped back to `invited_link`, and would be asked to verify
     * something they had just verified. Changing the address DOES re-derive,
     * which is the half that must not be lost: a verified state may never
     * outlive the address it was granted for, and the code itself agrees —
     * its hash binds the address, so the old code stops working too.
     */
    if (next !== f.email.value) {
      patch['emailOwnership'] =
        next === null
          ? null
          : next === f.email.prefilled
            ? 'invited_link'
            : 'self_supplied_unverified';
      patch['emailEditedAt'] = now;
    }
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
  /** Email verification may already have consumed the initial-access invite. */
  inviteAlreadyConsumed?: boolean;
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
  // Submission can be reached without opening the profile screens first (for
  // example after a resumed or older invitation journey). Account creation must
  // not depend on a prior GET having performed this lazy initialization.
  const profile = await ensureClaimProfile(db, input.draftId, input.actor);
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
      next: 'Finish the setup questions first. Everything you have entered here is saved.',
    };
  }

  // Simplified flow (2026-08-10, product direction): the possible-creator
  // result no longer gates the claim. Submitting the answers lands the Founder
  // directly here; the Admin assessment remains a recordable fact in the
  // workspace, it just does not stand between a person and their account.

  /*
    ── RECORDED DEVIATION (2026-08-20, product direction) ────────────────────

    §10 lists nine things before account creation: legal name, email, date of
    birth, country, state/region, business/sole-proprietor status, three
    US/18+/sanctions representations, and three policy acceptances. Eight of
    them no longer gate this function, and the reason for each was given
    explicitly rather than inferred:

      legal name      Stripe collects it at §13 payout onboarding, and that is
                      the copy that identifies the seller of record. Asking for
                      it twice makes two answers to one question.
      date of birth   The same — Stripe Connect asks for it directly.
      country         Fixed to `US`. §11 is US-only, so there was never a
                      second answer for this field to hold.
      state/region    Comes from the Admin workspace instead.
      sole proprietor The same.
      3 representations   Removed outright.
      3 policy consents   Removed outright.

    **This is a deviation from the Spec, not a defect to "fix" by reinstating
    the gates in a later session without the same instruction.** It is the same
    class of decision as the 2026-08-10 Admin-MFA removal and the
    `campaign_followers` record, and it is written here so it reads as settled
    rather than as something somebody forgot.

    What did NOT change, and must not:

      - Every column is still there, still nullable, still provenanced, and
        still swept by §25.8. Nothing was dropped from the schema, so an Admin
        recording a state/region or a sole-proprietor answer later writes the
        same field this function stopped demanding. No migration was needed.
      - The three representation columns are still `NOT NULL DEFAULT false`
        and are still three separate columns (§28.4). Nothing sets them true.
        A record that says somebody confirmed something they were never asked
        would be worse than a record that says they were never asked.
      - `policy_consents` still refuses to cite an unpublished version (the
        0003 trigger), and §29.8's reacceptance gate is untouched. What went is
        the demand at THIS door; the machine behind it is intact.
      - Email still gates, because it is the account identity. It arrives
        prefilled from the §7 prospect and is verified by the six-digit code.

    A later phase asked to read the absent representations as if they were
    answered — or to treat an unsigned Terms as accepted — is asking for
    something this deviation does not license.
  */
  if (!profile.fields.email.value) {
    return {
      ok: false,
      code: 'profile_incomplete',
      message: 'We do not have an email address for this invitation.',
      next: 'Go back to the email step and add one. Everything else you have entered is saved.',
      missing: ['email'],
    };
  }

  /*
    ── The identity, and why a password is now optional ──────────────────────

    Part of the same 2026-08-20 deviation. The password moved to the END of the
    onboarding flow, after `/setup/live`, so between submitting the answers and
    reaching that screen a Founder has an account and no credential of their
    own — which is a state Better Auth already has a shape for, because that is
    every OAuth-only user.

    `setFounderPassword` is what fills it in, and until it does:

      - There is NO `credential` account row, so `sign-in/email` cannot match
        anything. An account with no password is not an account with a guessable
        one, and there is no placeholder hash sitting in the table.
      - The session is minted here, by the same act that creates the user, and
        it is the only way in. Nothing is left lying around for somebody else.

    Google still works exactly as it did: an identity that already exists is
    bound, and it is taken from a real session rather than from a request body.
  */
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
    .select({
      prospectId: campaignDrafts.prospectId,
      brandVoice1: campaignDrafts.prefillBrandVoice1,
      brandVoice2: campaignDrafts.prefillBrandVoice2,
    })
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

    // An address that already has an account is refused rather than bound to.
    // Binding would let anybody holding a draft link attach that campaign to
    // somebody else's Founder account by typing their address — the identity
    // mistake `routes/vetting.ts` records for the Google path, arriving through
    // the other door.
    const taken = await ctx.internalAdapter.findUserByEmail(email);
    if (taken) {
      return {
        ok: false,
        code: 'credentials_missing',
        message: 'There is already a Proovd account for that email address.',
        next: 'Nothing was created. Sign in with it, or use a different address on the email step.',
      };
    }

    const created = await ctx.internalAdapter.createUser({
      email,
      /*
        §10's legal name is Stripe's to collect now, so it is usually absent
        here and this falls through to the address. A `name` is a display
        label; the seller of record is established at §13 onboarding, and the
        Admin workspace reads `founder_claim_profiles.legal_name` rather than
        this column, so an address standing in changes nothing downstream.
      */
      name:
        profile.fields.preferredName.value ?? profile.fields.legalName.value ?? email,
      role: 'founder',
      // §5.2, §33.1.8: collected and explicitly unverified. There is no
      // parameter here that could mark it otherwise, and the database rejects
      // the attempt regardless.
      phone: profile.fields.phone.value,
      phoneVerified: false,
      emailVerified: false,
    });

    // No password yet is no `credential` row at all — see the note above.
    if (input.password !== undefined) {
      const hash = await ctx.password.hash(input.password);
      await ctx.internalAdapter.linkAccount({
        userId: created.id,
        providerId: 'credential',
        accountId: created.id,
        password: hash,
      });
    }
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

      // Email verification consumes the invitation used for initial access.
      // Admin may have resent another invitation while this independent flow
      // session stayed active, so account claim also closes any remaining live
      // invitation for the draft without touching the flow session itself.
      // Legacy/direct submissions still claim the presented live invite.
      if (input.inviteAlreadyConsumed) {
        await tokens.revokeDraftTokens(input.draftId, 'claimed', tx);
      } else {
        const claimed = await tokens.claimDraft(input.tokenId, tx);
        if (!claimed.ok) throw new ClaimConflict();
      }

      const moved = await tx
        .update(campaigns)
        // Account creation is the durable handoff from the token-addressed
        // invitation into the authenticated onboarding workflow. Keeping the
        // workflow marker at `invite` makes the Admin panel show the wrong
        // stage and prevents the optional Application Review gate from opening.
        .set({ status: 'account_claimed', workflowStageReached: 'onboarding' })
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

      /* The two Admin descriptors are the starting value for the later brand
         voice editor. They become one ordinary build value, so the Founder can
         replace either word, add context, or clear the suggestion using the
         same controls as any other brand voice. */
      const brandVoice = [draftRow.brandVoice1, draftRow.brandVoice2]
        .map((value) => value?.trim() ?? '')
        .filter(Boolean)
        .join(', ');
      if (brandVoice) {
        await tx
          .insert(campaignBuild)
          .values({
            campaignId: profile.campaignId,
            brandVoice,
            updatedBy: `admin-prefill:${input.draftId}`,
          })
          .onConflictDoNothing({ target: campaignBuild.campaignId });
      }

      await tx
        .update(founderClaimProfiles)
        .set({
          claimedAt: now,
          claimedUserId: userId,
          updatedBy: `user:${userId}`,
          /*
            §11 is US-only, so the country was never a question with a second
            answer — the screen that asked it offered one value. It is written
            here rather than left null so §24.3's tax handling and every read
            that expects a country find one, and its supplier says `proovd`
            because Proovd is what decided it, not the Founder (§9's rule that
            provenance follows the actor).
          */
          country: 'US',
          countrySupplier: 'proovd',
        })
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

      /*
        No `policy_consents` rows are written here any more (2026-08-20, and
        the deviation is stated in full above).

        The absence is the honest record: nobody was shown the agreements and
        nobody accepted them, so a row saying otherwise would be a consent
        record that is simply untrue — and consent records are the one kind of
        row this product may later have to stand behind. §29.8's reacceptance
        machinery is untouched and still works from `policy_consents`; when a
        published version is put in front of a Founder and accepted, that is
        what writes the row.
      */

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
          workflowStageReached: 'onboarding',
          founderUserId: userId,
          draftId: input.draftId,
          emailOwnership: profile.emailOwnership,
          /*
            Both absences are recorded rather than left to be inferred from a
            missing key. `acceptedPolicies: []` says the claim asked for none —
            which is a fact about how this account was made, and the one an
            auditor reading the row a year from now needs. `credentialSet`
            says whether a password exists yet; `setFounderPassword` writes its
            own audit row when it does.
          */
          acceptedPolicies: [],
          policyConsentCollected: false,
          representationsCollected: false,
          credentialSet: input.password !== undefined || input.googleUserId !== undefined,
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

/* ── The account, created by submission (2026-08-20, product direction) ───── */

/**
 * Submit the answers, get an account and a session — no password asked for.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * The password moved to the END of the onboarding flow, after `/setup/live`.
 * Everything between submission and that screen is behind
 * `requireRole('founder')`, and §13's Stripe account is keyed to a real
 * `ownerUserId`, so the account cannot wait for the credential: a Founder needs
 * to BE somebody before they can be paid.
 *
 * So the account is created at submission and the credential is chosen at the
 * end. Those were one act in §10 and are two here, which is the deviation
 * `completeClaim` records in full.
 *
 * ── The temporary password never leaves this function ───────────────────────
 * Better Auth's session cookie is SIGNED with the app secret, and the only
 * documented way to mint one is to go through an endpoint that does it —
 * `setSessionCookie` wants a `GenericEndpointContext`, which an Express route
 * does not have. Hand-rolling the signature would mean re-deriving a security
 * primitive from a dependency's internals, and it would break silently on a
 * minor upgrade.
 *
 * So the account is created with 32 random bytes as its password and signed in
 * through `auth.api.signInEmail` — the real route, its real hashing, its real
 * cookie. The value is generated here, used once, and goes out of scope; it is
 * never returned, never stored in plaintext, never logged, and never sent to a
 * client. `setFounderPassword` replaces it at the end of the flow.
 *
 * It is a real credential in the meantime, which is the honest description: an
 * account whose password nobody knows, reachable only through the session this
 * mints. That is strictly better than a placeholder hash somebody could
 * recognise, and better than leaving the account with no credential at all —
 * which would make `sign-in/email` the wrong error for a Founder who tried it.
 */
export async function claimAndSignIn(
  db: Database,
  auth: Auth,
  tokens: TokenService,
  input: { draftId: string; tokenId: string; actor: string; inviteAlreadyConsumed?: boolean },
): Promise<
  | { ok: true; campaignId: string; userId: string; setCookie: string[] }
  | { ok: false; code: ClaimRefusal; message: string; next: string; missing?: string[] }
> {
  const profile = await ensureClaimProfile(db, input.draftId, input.actor);
  const email = profile?.fields.email.value?.toLowerCase();
  if (!email) {
    return {
      ok: false,
      code: 'profile_incomplete',
      message: 'We do not have an email address for this invitation.',
      next: 'Go back to the email step and add one. Everything else you have entered is saved.',
      missing: ['email'],
    };
  }

  const temporary = randomBytes(32).toString('hex');

  const claimed = await completeClaim(db, auth, tokens, {
    draftId: input.draftId,
    tokenId: input.tokenId,
    ...(input.inviteAlreadyConsumed ? { inviteAlreadyConsumed: true } : {}),
    password: temporary,
    // Nothing was shown and nothing was accepted, and the empty list says so
    // rather than a caller quietly passing the slugs anyway.
    acceptedPolicySlugs: [],
    actor: input.actor,
  });
  if (!claimed.ok) return claimed;

  /*
    A sign-in failure is NOT a claim failure. The account exists, the campaign
    moved, and the draft is claimed — all committed. Reporting an error here
    would tell somebody their account was not created when it was, and there is
    no second attempt at a claim to make (the idempotency key saw to that).
    So the cookies come back empty and the caller says what actually happened.
  */
  let setCookie: string[] = [];
  try {
    const response = await auth.api.signInEmail({
      body: { email, password: temporary },
      asResponse: true,
    });
    setCookie =
      typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : [response.headers.get('set-cookie') ?? ''].filter((value) => value !== '');
  } catch {
    setCookie = [];
  }

  return { ok: true, campaignId: claimed.campaignId, userId: claimed.userId, setCookie };
}

/**
 * Choose a password, at the end of the flow.
 *
 * `updatePassword` rather than Better Auth's `changePassword`, because there is
 * no current password to present: the one this account has is the 32 random
 * bytes `claimAndSignIn` generated and discarded. That is exactly the shape
 * `updatePassword` exists for, and it is the same call the library's own reset
 * flow makes.
 *
 * The caller is already authenticated — this route is behind
 * `requireRole('founder')` — so the session IS the proof of identity, which is
 * a stronger one than a password somebody may have chosen ten seconds ago.
 */
export async function setFounderPassword(
  db: Database,
  auth: Auth,
  input: { userId: string; campaignId: string; password: string },
): Promise<{ ok: true } | { ok: false; message: string; next: string }> {
  if (input.password.length < 12) {
    return {
      ok: false,
      message: 'That password is too short. Use at least 12 characters.',
      next: 'Try a longer one. Nothing else about your campaign changed.',
    };
  }

  const ctx = await auth.$context;
  const hash = await ctx.password.hash(input.password);
  await ctx.internalAdapter.updatePassword(input.userId, hash);

  await db.insert(auditEvents).values({
    actor: `user:${input.userId}`,
    targetType: 'campaign',
    targetId: input.campaignId,
    action: 'founder.password_set',
    internalReason:
      'Founder chose their password at the end of the onboarding flow, replacing the credential minted at submission (2026-08-20 deviation).',
    customerExplanation: 'You set your Proovd password.',
    priorValue: { credentialChosenByFounder: false },
    newValue: { credentialChosenByFounder: true },
  });

  return { ok: true };
}
