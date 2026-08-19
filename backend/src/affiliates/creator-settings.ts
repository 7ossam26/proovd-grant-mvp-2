/**
 * The Creator's own settings — Creator Flow v2, Session F, 2026-08-20.
 *
 * ═══ NOT A DEVIATION. THIS IS §5.3 AS WRITTEN, AND IT CLOSES A REAL GAP ═════
 *
 * §5.3 lists, verbatim: *"Affiliate settings: name, email, phone, password,
 * channel type/handles, audience metrics, niche, bio,
 * connected-account/transfer/tax/payout status, notification preferences, and
 * delete-account request."*
 *
 * None of it has been editable after the claim. `affiliate_signup_profiles` has
 * exactly three writers — `saveSignupProfile`, which hard-refuses once
 * `claimed_at` is set; the claim itself; and Admin's
 * `correctAffiliateAccountField` — and no session-authenticated Creator route
 * writes the table at all. The gap has a visible consequence:
 * `requestAffiliateCorrection` (2026-08-17) emails a Creator the
 * `affiliate_correction_request` key, its own parameter doc reading *"the field
 * the Affiliate should review"*, **asking them to correct something they have
 * no route to correct.**
 *
 * ── This is NOT a relaxation of `saveSignupProfile`'s refusal ──────────────
 * That refusal is load-bearing for onboarding screens 1–8 and is untouched.
 * This is a different act with its own discipline, inherited from the Admin
 * correction path rather than from the draft-editing one, because the two are
 * different: pre-claim a keystroke is a draft; post-claim it rewrites the
 * record a Founder reads and the address every transactional message goes to.
 *
 *   * a **reason** is required (0055's CHECK, and refused by name here first);
 *   * the **prior value is read `FOR UPDATE` inside the transaction that
 *     changes it** (§33.12.4 — a caller that supplies both halves can supply a
 *     flattering pair);
 *   * an **`audit_events` row in the same transaction**, because this table has
 *     no history table and `date_of_birth`, `country`, `state_region` and the
 *     five confirmations carry no provenance columns at all;
 *   * the **supplier triple is recomputed** on the prefillable fields, so §11's
 *     source label stays true after a Creator edits their own record.
 *
 * ── The field id is a register entry, never a column name ──────────────────
 * 16a's overridable-field reasoning: a route accepting any string would
 * happily record a correction of something that does not exist, and the trail
 * would look complete while pointing at nothing. `CREATOR_SETTINGS_FIELDS` and
 * `CREATOR_SETTINGS_GUARDED` are the whole vocabulary and 0055 CHECKs the same
 * ten ids.
 *
 * ── What is NOT writable here, and why each is absent ──────────────────────
 * The channel **subtype** (Admin's §5.3 classification, and the evidence on
 * file was recorded against it — a Creator flipping it silently invalidates a
 * verification); the **five confirmations** (§11 representations made at the
 * claim, and a representation somebody can quietly toggle later is not one);
 * the **payout status columns** (Stripe's, §13); and `date_of_birth`,
 * `country`, `state_region` (collected once as part of those representations).
 * None has a branch in this file — the absence is the enforcement.
 */

import { and, eq } from 'drizzle-orm';
import {
  DELETION_RECEIVED_VIA,
  SETTINGS_FIELD_IDS,
  SETTINGS_GUARDED_IDS,
} from '../creator-flow/logic.js';
import type { Database } from '../db/client.js';
import { affiliateProspects } from '../db/schema/affiliates.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import { affiliateProfileCorrections } from '../db/schema/creator-flow.js';
import { policyConsents } from '../db/schema/vetting.js';
import { stripeConnectedAccounts } from '../db/schema/payments.js';
import { auditEvents } from '../db/schema/integrity.js';
import { recordCreatorDeletionRequest } from './workspace/mutations.js';
import { affiliateDeletionRequests } from '../db/schema/creator-workspace.js';

const EDITABLE_IDS = new Set<string>(SETTINGS_FIELD_IDS);
const GUARDED_IDS = new Set<string>(SETTINGS_GUARDED_IDS);

/**
 * field id → the Drizzle property, and whether §11's supplier triple applies.
 *
 * Named rather than derived. `niche_description` and `outreach_plan` are the
 * two 0055 added and they carry no triple — they were never prefilled by
 * Proovd, so there is no source label for a Creator's edit to change.
 */
const FIELDS: Record<string, { property: string; triple: boolean; label: string }> = {
  public_handle: { property: 'publicHandle', triple: true, label: 'Public handle' },
  phone: { property: 'phone', triple: true, label: 'Phone' },
  channel_reference: { property: 'channelReference', triple: true, label: 'Channel link or handle' },
  audience_niche: { property: 'audienceNiche', triple: true, label: 'Audience niche' },
  audience_size: { property: 'audienceSize', triple: true, label: 'Audience size' },
  bio: { property: 'bio', triple: true, label: 'Bio' },
  niche_description: { property: 'nicheDescription', triple: false, label: 'What you cover' },
  outreach_plan: { property: 'outreachPlan', triple: false, label: 'How you reach your network' },
  legal_name: { property: 'legalName', triple: true, label: 'Legal name' },
  email: { property: 'email', triple: true, label: 'Email' },
};

export type SettingsResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: 'not_found' | 'invalid'; message: string };

function invalid(message: string): { ok: false; code: 'invalid'; message: string } {
  return { ok: false, code: 'invalid', message };
}

export interface CreatorSettingsView {
  profileId: string;
  prospectId: string;
  /** The editable §5.3 fields, with §11's source label on each. */
  fields: Array<{
    id: string;
    label: string;
    value: string | null;
    supplier: string | null;
    guarded: boolean;
  }>;
  /**
   * The channel subtype, shown and not editable — Admin's §5.3 classification,
   * and the evidence on file was recorded against it.
   */
  channelSubtype: string | null;
  /** §5.3: "connected-account/transfer/tax/payout status" — Stripe's, read-only. */
  payout: { state: string | null; payoutsEnabled: boolean; accountPresent: boolean };
  /** §31.4 + §31.5: what this Creator has signed, and when. */
  signed: Array<{ label: string; version: string | null; acceptedAt: string }>;
  /** §25.8: the ask, if one has been filed. Never a deletion state. */
  deletionRequestedAt: string | null;
}

/** Resolves the Creator's own profile from the session. Never from a body. */
async function loadProfile(db: Database, userId: string) {
  const [row] = await db
    .select()
    .from(affiliateSignupProfiles)
    .where(eq(affiliateSignupProfiles.claimedUserId, userId))
    .limit(1);
  return row ?? null;
}

export async function readCreatorSettings(
  db: Database,
  userId: string,
): Promise<SettingsResult<{ settings: CreatorSettingsView }>> {
  const profile = await loadProfile(db, userId);
  if (!profile) {
    return { ok: false, code: 'not_found', message: 'There is no Creator profile for this account.' };
  }

  const [prospect] = await db
    .select({ subtype: affiliateProspects.subtype })
    .from(affiliateProspects)
    .where(eq(affiliateProspects.id, profile.prospectId))
    .limit(1);

  const [account] = await db
    .select({
      state: stripeConnectedAccounts.state,
      payoutsEnabled: stripeConnectedAccounts.payoutsEnabled,
    })
    .from(stripeConnectedAccounts)
    .where(
      and(
        eq(stripeConnectedAccounts.ownerUserId, userId),
        eq(stripeConnectedAccounts.role, 'affiliate_recipient'),
      ),
    )
    .limit(1);

  // §31.4's two policies, plus §31.5's per-campaign IP agreement instances.
  const consents = await db
    .select({
      slug: policyConsents.slug,
      version: policyConsents.version,
      acceptedVia: policyConsents.acceptedVia,
      acceptedAt: policyConsents.acceptedAt,
    })
    .from(policyConsents)
    .where(eq(policyConsents.subjectId, userId));

  const [deletion] = await db
    .select({ requestedAt: affiliateDeletionRequests.requestedAt })
    .from(affiliateDeletionRequests)
    .where(eq(affiliateDeletionRequests.prospectId, profile.prospectId))
    .limit(1);

  const row = profile as unknown as Record<string, unknown>;
  const value = (id: string): string | null => {
    const v = row[FIELDS[id]!.property];
    return typeof v === 'string' ? v : null;
  };
  // §11's source label. Absent where the field carries no triple, which is a
  // different fact from "the Creator wrote it" and is rendered as one.
  const supplier = (id: string): string | null => {
    if (!FIELDS[id]!.triple) return null;
    const v = row[`${FIELDS[id]!.property}Supplier`];
    return typeof v === 'string' ? v : null;
  };

  return {
    ok: true,
    settings: {
      profileId: profile.id,
      prospectId: profile.prospectId,
      fields: [...SETTINGS_FIELD_IDS, ...SETTINGS_GUARDED_IDS].map((id) => ({
        id,
        label: FIELDS[id]!.label,
        value: value(id),
        supplier: supplier(id),
        guarded: GUARDED_IDS.has(id),
      })),
      channelSubtype: prospect?.subtype ?? null,
      payout: {
        state: account?.state ?? null,
        payoutsEnabled: account?.payoutsEnabled ?? false,
        accountPresent: Boolean(account),
      },
      // §31.4's two policies and §31.5's per-campaign IP agreement instances,
      // as they were recorded. The slug is what the surface resolves a title
      // from — there is no second copy of the eight document names here.
      signed: consents.map((c) => ({
        label: c.slug,
        version: c.version,
        acceptedAt: c.acceptedAt.toISOString(),
      })),
      deletionRequestedAt: deletion?.requestedAt?.toISOString() ?? null,
    },
  };
}

/**
 * A Creator corrects one field of their own record.
 *
 * One field per call, deliberately. A batch that half-applied would leave the
 * Creator guessing which half landed, and every one of these carries its own
 * reason — a single reason covering four unrelated edits is a reason for none
 * of them.
 */
export async function correctOwnProfileField(
  db: Database,
  input: { userId: string; fieldId: string; newValue: string; reason: string },
): Promise<SettingsResult<{ correctionId: string }>> {
  const fieldId = input.fieldId;
  if (!EDITABLE_IDS.has(fieldId) && !GUARDED_IDS.has(fieldId)) {
    return invalid('That is not one of the settings this product lets you change.');
  }
  const reason = input.reason.trim();
  if (!reason) {
    return invalid(
      'Say why this is changing. Your profile has no version history of its own, so this note is how anybody — including you — can tell later what happened.',
    );
  }
  const newValue = input.newValue.trim();
  if (!newValue) {
    return invalid('Give the new value. Clearing a field is a support conversation, not a save.');
  }

  const profile = await loadProfile(db, input.userId);
  if (!profile) {
    return { ok: false, code: 'not_found', message: 'There is no Creator profile for this account.' };
  }

  const field = FIELDS[fieldId]!;
  // §5.3/§11: the address is lowercased exactly as the pre-claim writer does,
  // so the same value arrives at the same shape whichever route wrote it.
  const stored = fieldId === 'email' ? newValue.toLowerCase() : newValue;

  const correctionId = await db.transaction(async (tx) => {
    // §33.12.4: the prior value is READ from the row, under lock, inside the
    // transaction that changes it. A caller that supplied both halves could
    // supply a flattering pair.
    const [locked] = await tx
      .select()
      .from(affiliateSignupProfiles)
      .where(eq(affiliateSignupProfiles.id, profile.id))
      .for('update')
      .limit(1);
    const before = (locked as unknown as Record<string, unknown>) ?? {};
    const priorRaw = before[field.property];
    // §16a: a genuinely absent prior is JSON null, never SQL NULL — the two are
    // different facts, and SQL NULL here would mean "no before was recorded",
    // which is the state 0055's NOT NULL exists to forbid.
    const priorValue = typeof priorRaw === 'string' ? priorRaw : null;

    const patch: Record<string, unknown> = { [field.property]: stored };
    if (field.triple) {
      // §11's source label stays true: a value the Creator typed is theirs, and
      // the edit instant is what the surface renders beside it.
      patch[`${field.property}Supplier`] = 'affiliate';
      patch[`${field.property}EditedAt`] = new Date();
    }
    await tx
      .update(affiliateSignupProfiles)
      .set(patch)
      .where(eq(affiliateSignupProfiles.id, profile.id));

    const [row] = await tx
      .insert(affiliateProfileCorrections)
      .values({
        profileId: profile.id,
        fieldId,
        priorValue,
        newValue: stored,
        reason,
        correctedByUserId: input.userId,
      })
      .returning({ id: affiliateProfileCorrections.id });

    await tx.insert(auditEvents).values({
      actor: input.userId,
      mfaContext: 'password_session_affiliate_role_verified',
      reauthContext: 'not_required_own_record',
      targetType: 'affiliate_signup_profile',
      targetId: profile.id,
      action: 'creator.profile_corrected',
      internalReason: reason,
      customerExplanation: null,
      priorValue: { [fieldId]: priorValue },
      newValue: { [fieldId]: stored },
    });

    return row!.id;
  });

  return { ok: true, correctionId };
}

/**
 * §5.3's delete-account request, filed by the Creator themselves.
 *
 * Writes 0044's SAME record — `recordCreatorDeletionRequest`, unchanged — with
 * `received_via` naming this screen, which is precisely what that column exists
 * for. A second table would have been the duplicate this codebase refuses
 * everywhere else, and on an erasure request two copies disagreeing is the
 * worst version of that failure.
 *
 * Nothing is deleted. There is no `deleted_at`, no purge schedule, and no
 * `approved` state on that record, because §25.8's retention obligations do not
 * end because somebody clicked a button.
 */
export async function requestOwnDeletion(
  db: Database,
  input: { userId: string; detail: string },
): Promise<SettingsResult<{ requestId: string }>> {
  const profile = await loadProfile(db, input.userId);
  if (!profile) {
    return { ok: false, code: 'not_found', message: 'There is no Creator profile for this account.' };
  }
  const result = await recordCreatorDeletionRequest(
    { db },
    {
      prospectId: profile.prospectId,
      detail: input.detail,
      receivedVia: DELETION_RECEIVED_VIA,
      requestedAt: new Date(),
      who: {
        actor: input.userId,
        mfaContext: 'password_session_affiliate_role_verified',
        reauthContext: 'not_required_own_record',
      },
    },
  );
  if (!result.ok) return { ok: false, code: result.code, message: result.message };
  return { ok: true, requestId: result.requestId };
}
