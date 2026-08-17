/**
 * Everything the Founder Admin workspace WRITES — Spec §7, §25.6, §25.8,
 * §26.2, §26.7, §33.12.4.
 *
 * `workspace.ts` composes; this file changes. They are separate modules on
 * purpose: a read that could write is a read nobody can reason about, and every
 * function below has to satisfy §25.6 in the same shape — actor, prior value,
 * new value, reason, evidence, time — which is easier to hold to when it is the
 * only thing the file does.
 *
 * ── The "before" is read from the row, never supplied ───────────────────────
 * §33.12.4: "every override preserves before/after, reason, actor, and time."
 * A caller that supplies both halves can supply a flattering pair, so every
 * prior value here comes out of the record inside the same transaction that
 * changes it — 16a's `recordOverride` reasoning, applied to a person's own
 * details. Nothing takes a `priorValue` parameter and there is nowhere to pass
 * one.
 *
 * ── There is no key for the three vetting answers ───────────────────────────
 * Problem, Solution, and Competition are the Founder's own words. §9 permits
 * Proovd to prefill the first two through `prefillVetting` — which stops moving
 * the moment the Founder edits the field — and states twice that Competition is
 * always blank and always theirs. `FOUNDER_EDITABLE_FIELDS` therefore carries
 * none of the three, this file has no branch for them, and the drift test
 * against `@proovd/shared` asserts their absence from the register. The way to
 * be certain an Admin cannot answer on a Founder's behalf is to leave nowhere
 * for the answer to go (§33.1.5).
 *
 * ── The override writes the invitation, never the profile ───────────────────
 * §7 has Admin compose a message to a specific person; §26.2 has the profile
 * auto-populate it. Both hold at once because the override lives on the DRAFT.
 * `setInvitationOverride` touches `campaign_drafts` and nothing else — there is
 * no statement in this file that updates `founder_prospects` from an override
 * path — so fixing a typo in one email cannot silently rewrite the Founder's
 * own record and every other surface that fills from it.
 *
 * ── Nothing here bans, and nothing here deletes ─────────────────────────────
 * `banFounder` resolves the campaign and hands over to `fulfillment/ghost-ban.ts`,
 * which refuses every trigger the record does not actually meet (§22.7,
 * §33.10.4). A second ban path would be a second answer to "is this permitted",
 * and the one that gets called would be whichever the route author reached for.
 * `recordDeletionRequest` records an ASK: §25.8 keeps campaign, payment, tax,
 * support, and audit records regardless of who asks for what, so there is no
 * delete statement in this module and no column that implies one.
 */

import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import type { AuditWriter } from '../auth/audit.js';

import { auditEvents } from '../db/schema/integrity.js';
import { campaignDrafts, founderProspects } from '../db/schema/invitations.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import {
  founderAccessActions,
  founderDeletionRequests,
  founderDeletionReviews,
  founderMeetingNotes,
} from '../db/schema/founder-workspace.js';

import {
  editReasonRequired,
  founderFieldByKey,
  isProfileOverrideKey,
  PROFILE_OVERRIDE_FIELDS,
  type FounderAccessAction,
  type ProfileOverrideKey,
} from './logic.js';
import {
  FOUNDER_ACCESS_RECORDED,
  FOUNDER_DELETION_REQUESTED,
  FOUNDER_DELETION_REVIEWED,
  FOUNDER_FIELD_UPDATED,
  FOUNDER_MEETING_NOTE_RECORDED,
  FOUNDER_OVERRIDE_CLEARED,
  FOUNDER_OVERRIDE_SET,
  FOUNDER_RESEARCH_RECORDED,
  FOUNDER_SENDER_RECORDED,
  type FieldEditAuditValue,
} from './audit-actions.js';
import { loadFounderContext, type FounderContext } from './workspace.js';

import { createProspect, type CreatedProspect } from '../invitations/service.js';
import { prefillVetting } from '../vetting/service.js';
import { recordGhostBan, type RecordGhostBanOutcome } from '../fulfillment/ghost-ban.js';
import { recordNextCampaignReadiness } from '../completion/next-campaign.js';

/* ── What every write in this file carries ─────────────────────────────────── */

export interface FounderMutationDeps {
  db: Database;
  /** §25.6's writer, for the two services this module delegates to. */
  audit: AuditWriter;
}

/**
 * The §25.6/§28.2 actor context, taken from the guarded request rather than
 * from the body.
 *
 * `mfaContext` and `reauthContext` are recorded because §25.6 asks for them by
 * name and the database cannot see either. They are columns on
 * `founder_access_actions` and `founder_deletion_reviews` as well as on
 * `audit_events`, so the record and its audit row say the same thing.
 */
export interface ActorContext {
  /** `user:<id>`, matching every other actor string in the product. */
  actor: string;
  mfaContext?: string | null;
  reauthContext?: string | null;
}

/** The failure shape. Every refusal names itself; none of them is a boolean. */
export type MutationFailure =
  | { ok: false; code: 'not_found'; message: string }
  | { ok: false; code: 'invalid'; message: string }
  | { ok: false; code: 'refused'; message: string };

function notFound(message: string): MutationFailure {
  return { ok: false, code: 'not_found', message };
}
function invalid(message: string): MutationFailure {
  return { ok: false, code: 'invalid', message };
}
function refused(message: string): MutationFailure {
  return { ok: false, code: 'refused', message };
}

/** A value an Admin typed, normalised. Blank and absent are the same answer. */
function trimmedOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/* ── §7's first act: writing somebody down ─────────────────────────────────── */

export interface AddFounderInput {
  legalName: string;
  email: string;
  preferredName?: string | null;
  phone?: string | null;
  productName?: string | null;
  productUrl?: string | null;
  invitationSource?: string | null;
  internalOwner?: string | null;
  lastContactAt?: Date | null;
  adminNotes?: string | null;
  /** §9's two prefillable answers, when the discovery call produced them. */
  problem?: string | null;
  solution?: string | null;
}

/**
 * Creates the person, their campaign container, and the empty invited draft.
 *
 * This is `invitations/service.ts`'s `createProspect` with §9's prefill after
 * it, and nothing else — the transaction, the `invited_draft` status row, and
 * the audit event are all its. Duplicating any of that here would give the
 * product two ways to come into existence, and the one that ran would be
 * whichever route was reached.
 *
 * The prefill lands AFTER the prospect transaction commits, on 08c's
 * precedent: `prefillVetting` is idempotent and has its own surface, so a crash
 * between the two costs a retry rather than correctness. Holding a row lock
 * across a second write would be a more expensive way to be no safer.
 *
 * There is no third prefill key. §9 states twice that Competition is written by
 * the Founder, and `prefillVetting` has nowhere to put one.
 */
export async function addFounder(
  deps: FounderMutationDeps,
  input: AddFounderInput,
  who: ActorContext,
): Promise<CreatedProspect> {
  const created = await createProspect(deps.db, {
    legalName: input.legalName,
    preferredName: input.preferredName ?? null,
    email: input.email,
    phone: input.phone ?? null,
    lastContactAt: input.lastContactAt ?? null,
    productName: input.productName ?? null,
    productUrl: input.productUrl ?? null,
    invitationSource: input.invitationSource ?? null,
    internalOwner: input.internalOwner ?? null,
    adminNotes: input.adminNotes ?? null,
    actor: who.actor,
  });

  const problem = trimmedOrNull(input.problem);
  const solution = trimmedOrNull(input.solution);
  if (problem !== null || solution !== null) {
    await prefillVetting(deps.db, created.draftId, {
      ...(problem !== null ? { problem } : {}),
      ...(solution !== null ? { solution } : {}),
      actor: who.actor,
    });
  }

  return created;
}

/* ── One registered field of the record (§25.6, §26.2, §33.12.4) ───────────── */

/** The register keys that are one invitation's content rather than the person's. */
const DRAFT_KEYS = new Set(['invKnow', 'invFit', 'invTime']);

/**
 * The stored value this key is about to replace, read from the record.
 *
 * Deliberately the raw column rather than the workspace's rendered fallback:
 * `identity.preferredName` falls back to the legal name for display, and
 * recording that as the "before" of a preferred-name edit would file a prior
 * value that was never stored (§33.12.4).
 */
function readStoredValue(ctx: FounderContext, key: string): string | null {
  const claim = ctx.claim;
  const claimed = claim !== null;

  switch (key) {
    case 'legal':
      return (claimed ? claim.legalName : ctx.prospect.legalName) ?? null;
    case 'preferred':
      return (claimed ? claim.preferredName : ctx.prospect.preferredName) ?? null;
    case 'email':
      return (claimed ? claim.email : ctx.prospect.email) ?? null;
    case 'phone':
      return (claimed ? claim.phone : ctx.prospect.phone) ?? null;
    // The claim profile wins where it holds a value; the prospect is the
    // pre-claim home (migration 0043). The same precedence the workspace
    // renders, so the recorded "before" is the value the Admin was looking at.
    case 'dob':
      return claim?.dateOfBirth ?? ctx.prospect.dateOfBirth ?? null;
    case 'state':
      return claim?.stateRegion ?? ctx.prospect.stateRegion ?? null;
    case 'country':
      return claim?.country ?? ctx.prospect.country ?? null;
    case 'bizType':
      return claim?.businessEntityType ?? ctx.prospect.businessEntityType ?? null;
    case 'bizLegal':
      return claim?.businessName ?? ctx.prospect.businessName ?? null;
    case 'product':
      return ctx.prospect.productName;
    case 'website':
      return ctx.prospect.productUrl;
    case 'invSource':
      return ctx.prospect.invitationSource;
    case 'invOwner':
      return ctx.prospect.internalOwner;
    case 'invKnow':
      return ctx.currentDraft?.whatWeUnderstood ?? null;
    case 'invFit':
      return ctx.currentDraft?.whyInvited ?? null;
    case 'invTime':
      return ctx.currentDraft?.expectedSetupTime ?? null;
    default:
      return null;
  }
}

/**
 * The patch for `founder_prospects`, or null when this key does not live there.
 *
 * Written as a switch over literal keys rather than as a computed property so
 * the column names are checked against the schema. A map from register key to
 * column string would typecheck against a column that no longer exists.
 */
function prospectPatch(
  key: string,
  value: string | null,
): Partial<typeof founderProspects.$inferInsert> | null {
  switch (key) {
    case 'legal':
      return { legalName: value };
    case 'preferred':
      return { preferredName: value };
    case 'email':
      return { email: value?.toLowerCase() ?? null };
    case 'phone':
      return { phone: value };
    case 'dob':
      return { dateOfBirth: value };
    case 'state':
      return { stateRegion: value };
    case 'country':
      return { country: value };
    case 'bizType':
      return { businessEntityType: value };
    case 'bizLegal':
      return { businessName: value };
    case 'product':
      return { productName: value };
    case 'website':
      return { productUrl: value };
    case 'invSource':
      return { invitationSource: value };
    case 'invOwner':
      return { internalOwner: value };
    default:
      return null;
  }
}

/** The patch for `founder_claim_profiles`, or null when the key is not on it. */
function claimPatch(
  key: string,
  value: string | null,
): Partial<typeof founderClaimProfiles.$inferInsert> | null {
  switch (key) {
    case 'legal':
      return { legalName: value };
    case 'preferred':
      return { preferredName: value };
    case 'email':
      return { email: value?.toLowerCase() ?? null };
    case 'phone':
      return { phone: value };
    case 'dob':
      return { dateOfBirth: value };
    case 'state':
      return { stateRegion: value };
    case 'country':
      return { country: value };
    case 'bizType':
      return { businessEntityType: value };
    case 'bizLegal':
      return { businessName: value };
    default:
      return null;
  }
}

/** The patch for `campaign_drafts` — one invitation's own content (§7). */
function draftPatch(
  key: string,
  value: string | null,
): Partial<typeof campaignDrafts.$inferInsert> | null {
  switch (key) {
    case 'invKnow':
      return { whatWeUnderstood: value };
    case 'invFit':
      return { whyInvited: value };
    case 'invTime':
      return { expectedSetupTime: value };
    default:
      return null;
  }
}

export interface UpdateFounderFieldInput {
  prospectId: string;
  /** A `FOUNDER_EDITABLE_FIELDS` key. Anything else is refused by name. */
  key: string;
  value: string | null;
  /** Required exactly where `editReasonRequired` says so (§25.6). */
  reason?: string | null;
  evidence?: string | null;
}

export type UpdateFounderFieldResult =
  | { ok: true; key: string; label: string; priorValue: string | null; newValue: string | null }
  | MutationFailure;

/**
 * Changes one registered field of a Founder's record.
 *
 * Three refusals, each by name: an unregistered key (a route that accepted any
 * string would happily record an override of something that does not exist,
 * and the audit trail would look complete while pointing at nothing — 16a's
 * `AUTO_POPULATED_FIELDS` reasoning); a missing reason where §25.6 requires
 * one; and an account-only field on a person who has not claimed an account.
 *
 * Where the value lives depends on whether an account exists, because that is
 * where the workspace READS it from: once a Founder has claimed, their own
 * `founder_claim_profiles` row is what every surface renders, and an Admin
 * correction written to the discovery record instead would appear to do
 * nothing. The prospect stays the pre-claim home and the product/website/
 * invitation-provenance fields stay on it throughout — those are Proovd's
 * record of the opportunity, not the person's account details.
 */
export async function updateFounderField(
  deps: FounderMutationDeps,
  input: UpdateFounderFieldInput,
  who: ActorContext,
): Promise<UpdateFounderFieldResult> {
  const { db } = deps;

  const field = founderFieldByKey(input.key);
  if (!field) {
    return invalid(
      `“${input.key}” is not a field of the Founder record. Nothing has changed.`,
    );
  }

  const ctx = await loadFounderContext(db, input.prospectId);
  if (!ctx) return notFound('There is no Founder at that address.');

  if (ctx.prospect.anonymisedAt) {
    return refused(
      'This record was anonymised after 30 calendar days without a claim. Its content is gone and cannot be restored.',
    );
  }

  const claimed = ctx.accountUserId !== null;
  const reason = trimmedOrNull(input.reason);
  if (editReasonRequired(field.group, claimed) && reason === null) {
    return invalid(
      `Changing ${field.label} on a Founder who owns this account needs a reason. It is stored with the change and nothing is saved without it.`,
    );
  }

  const draft = ctx.currentDraft;
  if (DRAFT_KEYS.has(field.key)) {
    if (!draft) return refused('This Founder has no invitation to edit.');
    if (draft.anonymisedAt) {
      return refused(
        'This invitation was anonymised after 30 calendar days without a claim. Its content is gone and cannot be restored.',
      );
    }
  }

  const value = trimmedOrNull(input.value);

  // Both `date_of_birth` columns are Postgres `date`s, so a value the database
  // cannot read would surface as a 500 after the Admin pressed Save. Refusing
  // here names the shape instead (§27.1); clearing with an empty value is fine.
  if (field.key === 'dob' && value !== null && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return invalid(
      'A date of birth is entered as YYYY-MM-DD, e.g. 1990-04-23. Nothing has changed.',
    );
  }

  const priorValue = readStoredValue(ctx, field.key);

  const auditPrior: FieldEditAuditValue = {
    key: field.key,
    label: field.label,
    value: priorValue,
  };
  const auditNext: FieldEditAuditValue = { key: field.key, label: field.label, value };

  const claim = ctx.claim;

  await db.transaction(async (tx) => {
    // The account record wins where it has a column, because that is what every
    // surface renders once a Founder has claimed. The product, the website, and
    // §7's two provenance fields have no column there and stay on the prospect
    // throughout — they are Proovd's record of the opportunity rather than the
    // person's account details, and the invitation fills from them.
    const onClaim = claim !== null ? claimPatch(field.key, value) : null;
    if (onClaim && claim) {
      await tx
        .update(founderClaimProfiles)
        // `updated_by` is what the 0007 history trigger files as `edited_by`,
        // so the Admin who made the correction is named in §9's provenance
        // history as well as in the audit row below.
        .set({ ...onClaim, updatedBy: who.actor, updatedAt: new Date() })
        .where(eq(founderClaimProfiles.id, claim.id));
    } else {
      const onProspect = prospectPatch(field.key, value);
      if (onProspect) {
        await tx
          .update(founderProspects)
          .set({ ...onProspect, updatedAt: new Date() })
          .where(eq(founderProspects.id, ctx.prospect.id));
      }
    }

    const onDraft = draft ? draftPatch(field.key, value) : null;
    if (onDraft && draft) {
      await tx.update(campaignDrafts).set(onDraft).where(eq(campaignDrafts.id, draft.id));
    }

    await tx.insert(auditEvents).values({
      actor: who.actor,
      mfaContext: who.mfaContext ?? null,
      reauthContext: who.reauthContext ?? null,
      targetType: 'founder_prospect',
      targetId: ctx.prospect.id,
      action: FOUNDER_FIELD_UPDATED,
      internalReason:
        reason ?? `${field.label} corrected on Proovd’s own record before the account was claimed`,
      customerExplanation: null,
      priorValue: auditPrior,
      newValue: auditNext,
      ...(trimmedOrNull(input.evidence)
        ? { evidenceLinks: { note: trimmedOrNull(input.evidence) } }
        : {}),
    });
  });

  return { ok: true, key: field.key, label: field.label, priorValue, newValue: value };
}

/* ── Per-invitation overrides of the profile (§7, §26.2) ───────────────────── */

/**
 * What the Founder profile says for one overridable value.
 *
 * Restated from the projection `workspace.ts` renders, because the reference
 * rule below compares against it: setting an override to the value the profile
 * already holds stores nothing, and the two have to agree about what the
 * profile holds or an Admin would see "overridden" beside two identical
 * strings.
 */
function profileValueForOverride(ctx: FounderContext, key: ProfileOverrideKey): string {
  switch (key) {
    case 'recipientName':
      return ctx.identity.legalName;
    case 'recipientEmail':
      return ctx.identity.email;
    case 'recipientPhone':
      return ctx.identity.phone ?? '';
    case 'product':
      return ctx.prospect.productName ?? '';
    case 'website':
      return ctx.prospect.productUrl ?? '';
  }
}

function overridePatch(
  key: ProfileOverrideKey,
  value: string | null,
): Partial<typeof campaignDrafts.$inferInsert> {
  switch (key) {
    case 'recipientName':
      return { overrideRecipientName: value };
    case 'recipientEmail':
      return { overrideRecipientEmail: value };
    case 'recipientPhone':
      return { overrideRecipientPhone: value };
    case 'product':
      return { overrideProduct: value };
    case 'website':
      return { overrideWebsite: value };
  }
}

function overrideLabel(key: ProfileOverrideKey): string {
  const field = PROFILE_OVERRIDE_FIELDS.find((entry) => entry.key === key);
  return `${field?.label ?? key} (this invitation only)`;
}

function storedOverride(ctx: FounderContext, key: ProfileOverrideKey): string | null {
  const draft = ctx.currentDraft;
  if (!draft) return null;
  switch (key) {
    case 'recipientName':
      return draft.overrideRecipientName;
    case 'recipientEmail':
      return draft.overrideRecipientEmail;
    case 'recipientPhone':
      return draft.overrideRecipientPhone;
    case 'product':
      return draft.overrideProduct;
    case 'website':
      return draft.overrideWebsite;
  }
}

export interface InvitationOverrideInput {
  prospectId: string;
  key: string;
  /** Absent or blank on the clear path. */
  value?: string | null;
  reason?: string | null;
}

export type InvitationOverrideResult =
  | { ok: true; key: ProfileOverrideKey; overridden: boolean; value: string | null }
  | MutationFailure;

/**
 * Says "for THIS invitation, use something else" — and nothing more.
 *
 * The only table this writes is `campaign_drafts`. The Founder profile is left
 * exactly as it was, which is the whole reason the override exists: editing the
 * prospect to fix one message would silently rewrite the person's own record
 * and change every other surface that auto-fills from it.
 *
 * ── The reference rule ──────────────────────────────────────────────────────
 * An override set to the value the profile already holds is not an override; it
 * is a duplicate that stops tracking the profile the moment the profile
 * changes. So an Admin who types the profile's own value back gets the
 * reference restored rather than a copy frozen in time — and a blank box is the
 * same answer, which the 0040 CHECK enforces regardless of what any route does.
 */
export async function setInvitationOverride(
  deps: FounderMutationDeps,
  input: InvitationOverrideInput,
  who: ActorContext,
): Promise<InvitationOverrideResult> {
  if (!isProfileOverrideKey(input.key)) {
    return invalid(`“${input.key}” is not an overridable invitation value.`);
  }
  return writeOverride(deps, input.prospectId, input.key, trimmedOrNull(input.value), who, input.reason);
}

export async function clearInvitationOverride(
  deps: FounderMutationDeps,
  input: { prospectId: string; key: string; reason?: string | null },
  who: ActorContext,
): Promise<InvitationOverrideResult> {
  if (!isProfileOverrideKey(input.key)) {
    return invalid(`“${input.key}” is not an overridable invitation value.`);
  }
  return writeOverride(deps, input.prospectId, input.key, null, who, input.reason);
}

async function writeOverride(
  deps: FounderMutationDeps,
  prospectId: string,
  key: ProfileOverrideKey,
  requested: string | null,
  who: ActorContext,
  reason: string | null | undefined,
): Promise<InvitationOverrideResult> {
  const { db } = deps;

  const ctx = await loadFounderContext(db, prospectId);
  if (!ctx) return notFound('There is no Founder at that address.');

  const draft = ctx.currentDraft;
  if (!draft) return refused('This Founder has no invitation to override a value on.');
  if (draft.anonymisedAt) {
    return refused(
      'This invitation was anonymised after 30 calendar days without a claim. Its content is gone and cannot be restored.',
    );
  }

  const profileValue = profileValueForOverride(ctx, key);
  // The reference rule: matching the profile means "follow the profile".
  const value = requested !== null && requested === profileValue.trim() ? null : requested;

  const priorValue = storedOverride(ctx, key);
  if (priorValue === value) {
    return { ok: true, key, overridden: value !== null, value };
  }

  const label = overrideLabel(key);
  const auditPrior: FieldEditAuditValue = { key, label, value: priorValue };
  const auditNext: FieldEditAuditValue = { key, label, value };

  await db.transaction(async (tx) => {
    await tx.update(campaignDrafts).set(overridePatch(key, value)).where(eq(campaignDrafts.id, draft.id));

    await tx.insert(auditEvents).values({
      actor: who.actor,
      mfaContext: who.mfaContext ?? null,
      reauthContext: who.reauthContext ?? null,
      targetType: 'campaign_draft',
      targetId: draft.id,
      action: value === null ? FOUNDER_OVERRIDE_CLEARED : FOUNDER_OVERRIDE_SET,
      internalReason:
        trimmedOrNull(reason) ??
        (value === null
          ? 'invitation override removed; this value follows the Founder profile again'
          : 'invitation override recorded; the Founder profile is unchanged'),
      customerExplanation: null,
      priorValue: auditPrior,
      newValue: auditNext,
    });
  });

  return { ok: true, key, overridden: value !== null, value };
}

/* ── §7's named Proovd sender, recorded from the session ───────────────────── */

export type RecordSenderResult =
  | { ok: true; senderName: string; senderEmail: string; recorded: boolean }
  | MutationFailure;

/**
 * §7 requires the invitation to name a Proovd sender and a reply route.
 *
 * The Admin pressing Send IS the named sender, so their own account name and
 * address are what gets recorded — rather than a box somebody fills in with
 * whatever they like, and rather than a placeholder that would reach a Founder
 * as `[SENDER NAME]`. An already-recorded sender is left alone: a resend by a
 * different Admin must not rewrite who the first message came from.
 *
 * This is a recorded fact, not an invented rule: §7 names the requirement and
 * the session already knows the answer.
 */
export async function recordInvitationSender(
  deps: FounderMutationDeps,
  input: { draftId: string; senderName: string; senderEmail: string },
  who: ActorContext,
): Promise<RecordSenderResult> {
  const { db } = deps;

  const [draft] = await db
    .select()
    .from(campaignDrafts)
    .where(eq(campaignDrafts.id, input.draftId))
    .limit(1);
  if (!draft) return notFound('There is no invitation at that address.');

  const existingName = trimmedOrNull(draft.senderName);
  const existingEmail = trimmedOrNull(draft.senderEmail);
  if (existingName !== null && existingEmail !== null) {
    return { ok: true, senderName: existingName, senderEmail: existingEmail, recorded: false };
  }

  const senderName = trimmedOrNull(input.senderName);
  const senderEmail = trimmedOrNull(input.senderEmail);
  if (senderName === null || senderEmail === null) {
    return invalid(
      '§7 requires a named Proovd sender and a reply route, and this Admin account has neither a name nor an address to use.',
    );
  }

  const next = {
    senderName: existingName ?? senderName,
    senderEmail: (existingEmail ?? senderEmail).toLowerCase(),
  };

  await db.transaction(async (tx) => {
    await tx.update(campaignDrafts).set(next).where(eq(campaignDrafts.id, input.draftId));
    await tx.insert(auditEvents).values({
      actor: who.actor,
      mfaContext: who.mfaContext ?? null,
      reauthContext: who.reauthContext ?? null,
      targetType: 'campaign_draft',
      targetId: input.draftId,
      action: FOUNDER_SENDER_RECORDED,
      internalReason: '§7 sender and reply route recorded from the sending Admin’s own account',
      customerExplanation: null,
      priorValue: { senderName: draft.senderName, senderEmail: draft.senderEmail },
      newValue: next,
    });
  });

  return { ok: true, senderName: next.senderName, senderEmail: next.senderEmail, recorded: true };
}

/* ── Person-level access (§26.7, §25.6) ────────────────────────────────────── */

export interface AccessActionInput {
  prospectId: string;
  action: string;
  reason: string;
  evidence?: string | null;
  /** §27.1's two promises to somebody waiting. Refused on a restore. */
  reviewOwner?: string | null;
  nextReviewAt?: Date | null;
}

export type AccessActionResult =
  | { ok: true; id: string; action: FounderAccessAction }
  | MutationFailure;

/**
 * Suspends this person's Founder access, or restores it.
 *
 * Distinct from §26.7's campaign suspension, which closes reservations,
 * detaches cards, and moves `campaigns.status`. This one concerns standing:
 * whether this person may act as a Founder at all. Append-only, and the current
 * state is derived from the latest row by `deriveAccountState` — there is no
 * status column for a failed write to strand out of step with the reason that
 * justified it.
 *
 * Refuses, by name: an action that is neither of the two; a blank reason
 * (§26.7's own rule); restoring access that is not suspended; suspending access
 * that already is; and anything at all on a permanently banned Founder, because
 * §22.7 names no reversal and a suspension layered on a ban would imply one.
 */
export async function recordAccessAction(
  deps: FounderMutationDeps,
  input: AccessActionInput,
  who: ActorContext,
): Promise<AccessActionResult> {
  const { db } = deps;

  if (input.action !== 'suspend' && input.action !== 'restore') {
    return invalid('An access decision is either a suspension or a restoration.');
  }
  const action: FounderAccessAction = input.action;

  const reason = trimmedOrNull(input.reason);
  if (reason === null) {
    return invalid('Say why. The reason is stored with the decision and the Founder may be told it.');
  }

  const ctx = await loadFounderContext(db, input.prospectId);
  if (!ctx) return notFound('There is no Founder at that address.');

  if (ctx.accountState === 'Permanently banned') {
    return refused(
      'This Founder is permanently banned. §22.7 names no reversal, so their access is not something to suspend or restore.',
    );
  }
  if (action === 'suspend' && ctx.accountState === 'Access suspended') {
    return refused('This Founder’s access is already suspended. Nothing has changed.');
  }
  if (action === 'restore' && ctx.accountState !== 'Access suspended') {
    return refused('This Founder’s access is not suspended, so there is nothing to restore.');
  }

  const reviewOwner = trimmedOrNull(input.reviewOwner);
  const nextReviewAt = input.nextReviewAt ?? null;
  if (action === 'restore' && (reviewOwner !== null || nextReviewAt !== null)) {
    return invalid(
      'A restoration ends the review, so it carries no owner and no next review date. Leave both empty.',
    );
  }

  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(founderAccessActions)
      .values({
        prospectId: ctx.prospect.id,
        userId: ctx.accountUserId,
        action,
        reason,
        evidence: trimmedOrNull(input.evidence),
        reviewOwner,
        nextReviewAt,
        actor: who.actor,
        mfaContext: who.mfaContext ?? null,
        reauthContext: who.reauthContext ?? null,
      })
      .returning({ id: founderAccessActions.id });

    await tx.insert(auditEvents).values({
      actor: who.actor,
      mfaContext: who.mfaContext ?? null,
      reauthContext: who.reauthContext ?? null,
      targetType: 'founder_prospect',
      targetId: ctx.prospect.id,
      action: FOUNDER_ACCESS_RECORDED,
      internalReason: reason,
      customerExplanation: reason,
      priorValue: { accountState: ctx.accountState },
      newValue: {
        accountState: action === 'suspend' ? 'Access suspended' : 'Active',
        reviewOwner,
        nextReviewAt: nextReviewAt?.toISOString() ?? null,
      },
      ...(trimmedOrNull(input.evidence)
        ? { evidenceLinks: { note: trimmedOrNull(input.evidence) } }
        : {}),
    });

    return row!.id;
  });

  return { ok: true, id, action };
}

/* ── §22.7's one strike ────────────────────────────────────────────────────── */

export type BanFounderResult = RecordGhostBanOutcome | { status: 'no_campaign' };

/**
 * Resolves the campaign and hands over to `fulfillment/ghost-ban.ts`.
 *
 * There is no ban logic here. §22.7's four triggers are evaluated against
 * stored facts by `recordGhostBan`, which refuses by name any trigger the
 * record does not currently meet (§33.10.4) and requires all five of §22.7's
 * recorded facts before a row can exist. A second path that assembled its own
 * defaults for those fields would be a §22.7 record that nobody actually made.
 */
export async function banFounder(
  deps: FounderMutationDeps,
  input: {
    prospectId: string;
    trigger: string;
    evidence: string;
    notice: string;
    paymentRecoveryStatus: string;
    enforcementDecision: string;
    internalReason: string;
  },
  who: ActorContext,
): Promise<BanFounderResult> {
  const ctx = await loadFounderContext(deps.db, input.prospectId);
  if (!ctx) return { status: 'campaign_not_found' };

  const campaign = ctx.currentCampaign ?? ctx.campaignRows[0] ?? null;
  if (!campaign) return { status: 'no_campaign' };

  return recordGhostBan(
    { db: deps.db, audit: deps.audit },
    {
      campaignId: campaign.campaign.id,
      trigger: input.trigger,
      evidence: input.evidence,
      notice: input.notice,
      paymentRecoveryStatus: input.paymentRecoveryStatus,
      enforcementDecision: input.enforcementDecision,
      internalReason: input.internalReason,
      actor: who.actor,
    },
  );
}

/* ── §25.8's account-closure request and its reviews ───────────────────────── */

export type DeletionRequestResult = { ok: true; id: string } | MutationFailure;

/**
 * Records that the Founder asked Proovd to close their account.
 *
 * The record is of the ASK. §25.8 keeps Founder account data for account life
 * plus seven years, and campaign, payment, tax, support, and audit records
 * outlive the account regardless of what anyone requests — so there is no
 * delete here, no purge schedule, and no approval state. A column named
 * `approved` would be the first step toward an action §25.8 does not permit.
 */
export async function recordDeletionRequest(
  deps: FounderMutationDeps,
  input: {
    prospectId: string;
    requestDetail: string;
    receivedVia: string;
    requestedAt: Date;
  },
  who: ActorContext,
): Promise<DeletionRequestResult> {
  const { db } = deps;

  const requestDetail = trimmedOrNull(input.requestDetail);
  const receivedVia = trimmedOrNull(input.receivedVia);
  if (requestDetail === null) {
    return invalid('Record what the Founder actually asked for, in their words where we have them.');
  }
  if (receivedVia === null) {
    return invalid(
      'Record how the request reached us — a support case reference, an email, a call. A request with no provenance is one nobody can verify was made.',
    );
  }
  if (Number.isNaN(input.requestedAt.getTime())) {
    return invalid('That request date could not be read. Nothing has been recorded.');
  }

  const ctx = await loadFounderContext(db, input.prospectId);
  if (!ctx) return notFound('There is no Founder at that address.');

  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(founderDeletionRequests)
      .values({
        prospectId: ctx.prospect.id,
        userId: ctx.accountUserId,
        requestDetail,
        receivedVia,
        requestedAt: input.requestedAt,
        recordedBy: who.actor,
      })
      .returning({ id: founderDeletionRequests.id });

    await tx.insert(auditEvents).values({
      actor: who.actor,
      mfaContext: who.mfaContext ?? null,
      reauthContext: who.reauthContext ?? null,
      targetType: 'founder_prospect',
      targetId: ctx.prospect.id,
      action: FOUNDER_DELETION_REQUESTED,
      internalReason: `account-closure request received via ${receivedVia}`,
      customerExplanation: null,
      newValue: { requestId: row!.id, requestedAt: input.requestedAt.toISOString() },
    });

    return row!.id;
  });

  return { ok: true, id };
}

export type DeletionReviewResult = { ok: true; id: string } | MutationFailure;

/**
 * An Admin looked at the request and recorded what they concluded.
 *
 * Append-only rows rather than a decision column, so a review that changes its
 * mind leaves both answers behind. The note is required and there is no
 * default: `founder_deletion_reviews.note` is NOT NULL and the table cannot be
 * rewritten, so a fabricated sentence would put words into a record somebody
 * may later be asked to stand behind (§25.6).
 */
export async function recordDeletionReview(
  deps: FounderMutationDeps,
  input: { prospectId: string; requestId: string; note: string },
  who: ActorContext,
): Promise<DeletionReviewResult> {
  const { db } = deps;

  const note = trimmedOrNull(input.note);
  if (note === null) {
    return invalid('Write down what you concluded. It is recorded on the request and never edited.');
  }

  const [request] = await db
    .select({ id: founderDeletionRequests.id, prospectId: founderDeletionRequests.prospectId })
    .from(founderDeletionRequests)
    .where(eq(founderDeletionRequests.id, input.requestId))
    .limit(1);

  // Scoped to the person in the URL: a review recorded against somebody else's
  // request would attach a conclusion to the wrong account, and answering
  // "not found" is the same answer a request that does not exist gets.
  if (!request || request.prospectId !== input.prospectId) {
    return notFound('There is no account-closure request at that address for this Founder.');
  }

  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(founderDeletionReviews)
      .values({
        requestId: request.id,
        note,
        actor: who.actor,
        mfaContext: who.mfaContext ?? null,
        reauthContext: who.reauthContext ?? null,
      })
      .returning({ id: founderDeletionReviews.id });

    await tx.insert(auditEvents).values({
      actor: who.actor,
      mfaContext: who.mfaContext ?? null,
      reauthContext: who.reauthContext ?? null,
      targetType: 'founder_prospect',
      targetId: input.prospectId,
      action: FOUNDER_DELETION_REVIEWED,
      internalReason: note,
      customerExplanation: null,
      newValue: { requestId: request.id, reviewId: row!.id },
    });

    return row!.id;
  });

  return { ok: true, id };
}

/* ── §22.10's next-campaign readiness ──────────────────────────────────────── */

export type NextCampaignReadinessResult =
  | { ok: true; decisionId: string; campaignId: string }
  | MutationFailure;

/**
 * Records Proovd's §22.10 readiness judgement against the campaign that closed.
 *
 * The cooldown is not part of this and cannot be moved from here: it is a pure
 * function of `campaign_close_at` and the §6 setting, computed on every read.
 * §22.10 fixes no criteria list, so the criteria are the Admin's own recorded
 * judgement — and §29.4 requires the Founder to be told the actual position,
 * which is why the internal note and the customer-facing explanation are two
 * separate required statements rather than one field used twice (§25.6).
 */
export async function setNextCampaignReadiness(
  deps: FounderMutationDeps,
  input: {
    prospectId: string;
    decision: 'ready' | 'not_ready';
    criteriaNote: string;
    customerExplanation: string;
  },
  who: ActorContext,
): Promise<NextCampaignReadinessResult> {
  const { db } = deps;

  const ctx = await loadFounderContext(db, input.prospectId);
  if (!ctx) return notFound('There is no Founder at that address.');

  // The same campaign `composeNextCampaign` measures the cooldown from: the
  // most recently closed campaign that was not archived. A readiness decision
  // against a campaign that never closed would be a judgement about nothing.
  const closed = ctx.campaignRows
    .filter((row) => row.campaign.campaignCloseAt !== null && row.campaign.archivedAt === null)
    .sort(
      (a, b) =>
        (b.campaign.campaignCloseAt?.getTime() ?? 0) - (a.campaign.campaignCloseAt?.getTime() ?? 0),
    )[0];

  if (!closed) {
    return refused(
      'This Founder has no closed campaign, so there is nothing to assess them for another one against.',
    );
  }

  const result = await recordNextCampaignReadiness(
    { db, audit: deps.audit },
    {
      campaignId: closed.campaign.id,
      decision: input.decision,
      decidedBy: who.actor,
      criteriaNote: input.criteriaNote,
      customerExplanation: input.customerExplanation,
    },
  );

  if (!result.ok) {
    return result.code === 'not_found' ? notFound(result.message) : invalid(result.message);
  }
  return { ok: true, decisionId: result.decisionId, campaignId: closed.campaign.id };
}

/* ── Meeting notes and research (§7, migration 0047, 2026-08-16 rebuild) ───── */

export type MeetingNoteResult = { ok: true; id: string } | MutationFailure;

/**
 * A new off-platform conversation, written down.
 *
 * Insert-only: there is no edit path anywhere — a correction is a new note,
 * and 0047's trigger refuses every UPDATE except the §25.8 anonymising one.
 * The five required facts are the reference dialog's own ("Keep the decision,
 * participants, follow-up, and source attached to this Founder"), refused by
 * name here and by the two-shape CHECK regardless. The author is the session,
 * never the body.
 */
export async function addMeetingNote(
  deps: FounderMutationDeps,
  input: {
    prospectId: string;
    meetingDate: string;
    participants: string;
    decisions: string;
    followUp: string;
    sourceLink: string;
    notes?: string | null;
  },
  who: ActorContext,
): Promise<MeetingNoteResult> {
  const { db } = deps;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.meetingDate.trim())) {
    return invalid('The meeting date could not be read. Enter it as YYYY-MM-DD.');
  }
  const meetingDate = input.meetingDate.trim();
  const participants = trimmedOrNull(input.participants);
  const decisions = trimmedOrNull(input.decisions);
  const followUp = trimmedOrNull(input.followUp);
  const sourceLink = trimmedOrNull(input.sourceLink);
  if (participants === null) return invalid('Record who was in the conversation.');
  if (decisions === null) return invalid('Record what was decided — that is what a meeting note is for.');
  if (followUp === null) return invalid('Record the follow-up, so the next session knows what was promised.');
  if (sourceLink === null) {
    return invalid('Record the source or link, so the note can be verified later.');
  }

  const ctx = await loadFounderContext(db, input.prospectId);
  if (!ctx) return notFound('There is no Founder at that address.');
  if (ctx.prospect.anonymisedAt) {
    return refused(
      'This prospect was anonymised after 30 calendar days without a claim. Its record is closed; create a new prospect to record new work.',
    );
  }

  // ActorContext carries `user:<id>`; the FK column wants the bare Better Auth
  // id. Strip the prefix rather than asking the route for a second value —
  // one actor, two renderings.
  const authorId = who.actor.startsWith('user:') ? who.actor.slice('user:'.length) : who.actor;

  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(founderMeetingNotes)
      .values({
        prospectId: ctx.prospect.id,
        meetingDate,
        participants,
        decisions,
        followUp,
        sourceLink,
        notes: trimmedOrNull(input.notes ?? null),
        createdBy: authorId,
      })
      .returning({ id: founderMeetingNotes.id });

    await tx.insert(auditEvents).values({
      actor: who.actor,
      mfaContext: who.mfaContext ?? null,
      reauthContext: who.reauthContext ?? null,
      targetType: 'founder_prospect',
      targetId: ctx.prospect.id,
      action: FOUNDER_MEETING_NOTE_RECORDED,
      internalReason: `meeting note recorded for ${meetingDate}`,
      customerExplanation: null,
      newValue: { noteId: row!.id, meetingDate },
    });

    return row!.id;
  });

  return { ok: true, id };
}

export type ResearchEntryResult = { ok: true } | MutationFailure;

/**
 * A research finding, appended to §7's discovery-evidence list.
 *
 * One record, one shape: the intake's evidence list and this dialog write the
 * same `discovery_evidence` array, so the entry is composed into one stored
 * line rather than a second structure the intake could not read. The list is
 * append-through-this-path only in practice; the prospect-update route can
 * still replace it wholesale, and both write the same audit action family.
 */
export async function addResearchEntry(
  deps: FounderMutationDeps,
  input: { prospectId: string; title: string; findings?: string | null; sourceLink: string },
  who: ActorContext,
): Promise<ResearchEntryResult> {
  const { db } = deps;

  const title = trimmedOrNull(input.title);
  const findings = trimmedOrNull(input.findings ?? null);
  const sourceLink = trimmedOrNull(input.sourceLink);
  if (title === null) return invalid('Name the research — a finding with no title cannot be found again.');
  if (sourceLink === null) {
    return invalid('Record the source or link, so the finding can be verified later.');
  }

  const ctx = await loadFounderContext(db, input.prospectId);
  if (!ctx) return notFound('There is no Founder at that address.');
  if (ctx.prospect.anonymisedAt) {
    return refused(
      'This prospect was anonymised after 30 calendar days without a claim. Its record is closed; create a new prospect to record new work.',
    );
  }

  const entry = findings ? `${title} — ${findings} (${sourceLink})` : `${title} (${sourceLink})`;
  const existing = Array.isArray(ctx.prospect.discoveryEvidence)
    ? (ctx.prospect.discoveryEvidence as unknown[]).filter(
        (e): e is string => typeof e === 'string',
      )
    : [];

  await db.transaction(async (tx) => {
    await tx
      .update(founderProspects)
      .set({ discoveryEvidence: [...existing, entry] })
      .where(eq(founderProspects.id, ctx.prospect.id));

    await tx.insert(auditEvents).values({
      actor: who.actor,
      mfaContext: who.mfaContext ?? null,
      reauthContext: who.reauthContext ?? null,
      targetType: 'founder_prospect',
      targetId: ctx.prospect.id,
      action: FOUNDER_RESEARCH_RECORDED,
      internalReason: 'research entry appended to discovery evidence',
      customerExplanation: null,
      priorValue: { entries: existing.length },
      newValue: { entries: existing.length + 1, title },
    });
  });

  return { ok: true };
}
