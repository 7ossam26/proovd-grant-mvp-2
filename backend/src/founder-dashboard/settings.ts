/**
 * The Founder's own settings — Founder Dashboard Session G (§5.2).
 *
 * §5.2's eleven items, at an account-level address. What is worth knowing about
 * this module is how little of it is new: the deletion request calls the
 * service the Admin workspace already calls, the payout and W-9 blocks read the
 * resolvers §13 and §22.3 already own, the notification half is Phase 22c's
 * page absorbed whole, and the password change wraps Better Auth's own
 * endpoint. What Session G adds is one correction path and the read that
 * composes them.
 *
 * ── The account is the most recent claim ────────────────────────────────────
 * `founder_claim_profiles` is unique per campaign, so a Founder who has run two
 * campaigns has two rows and an account-level page has to pick one. It picks
 * the most recently created — which is exactly what `loadFounderContext` has
 * done for the Admin workspace since 2026-08-16. They must agree: an Admin
 * correcting a Founder's phone number and the Founder correcting their own
 * would otherwise be writing different rows, and the surface each of them is
 * looking at would show the other's edit as having done nothing.
 *
 * ── The correction writes no new table ──────────────────────────────────────
 * `record_claim_profile_edits` has written `draft_field_edits` by trigger since
 * Phase 07 — prior value, new value, supplier, editor, instant, insert-only —
 * and `audit_events` carries the reason. Both already exist and both are
 * already read. A `founder_profile_corrections` table would be a third copy of
 * the same fact, and it would sit somewhere `founders/history.ts` does not
 * look. See the shared register's header for the full comparison with the
 * Creator record, which genuinely needed one.
 *
 * ── `updatedBy` is what the trigger files as the editor ─────────────────────
 * So it is set to the Founder's own account rather than left as whatever wrote
 * the row last. Without it, a Founder's correction would appear in §9's
 * provenance history under the Admin who composed their invitation.
 */

import { desc, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import type { AuditWriter } from '../auth/audit.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { founderDeletionRequests } from '../db/schema/founder-workspace.js';
import { campaignBuild } from '../db/schema/build.js';
import { user } from '../db/schema/auth.js';
import { auditEvents } from '../db/schema/integrity.js';
import { readFounderPaymentStatus } from '../close/founder-payments.js';
import type { FounderPaymentStatusView } from '../close/founder-payments.js';
import { recordDeletionRequest } from '../founders/mutations.js';
import {
  FOUNDER_CORRECTABLE_FIELD_IDS,
  FOUNDER_DELETION_VIA,
  FOUNDER_SELF_CORRECTED,
  founderSettingsColumn,
  isGuardedSettingsField,
} from './settings-logic.js';

/* ── Who is asking ────────────────────────────────────────────────────────── */

export interface FounderAccountContext {
  readonly claimId: string;
  readonly prospectId: string;
  readonly campaignId: string;
  readonly draftId: string;
}

/**
 * The signed-in Founder's current record.
 *
 * Scoped inside the query by `claimed_user_id`, so there is no filtering step
 * to forget and somebody else's record cannot be reached by any parameter —
 * there is no parameter. A Founder who has claimed nothing answers null, and
 * the route turns that into the same 404 a nonexistent address gets.
 */
export async function loadFounderAccount(
  db: Database,
  founderUserId: string,
): Promise<FounderAccountContext | null> {
  const [row] = await db
    .select({
      claimId: founderClaimProfiles.id,
      prospectId: founderClaimProfiles.prospectId,
      campaignId: founderClaimProfiles.campaignId,
      draftId: founderClaimProfiles.draftId,
    })
    .from(founderClaimProfiles)
    .where(eq(founderClaimProfiles.claimedUserId, founderUserId))
    // The same tiebreak `loadFounderContext` uses. Not `campaigns.created_at`:
    // §33.12.1's scan treats reading either campaign row timestamp AT ALL as
    // the failure, and the claim row is written in the campaign's own
    // transaction, so this is the same ordering from a column that is nobody's
    // anchor.
    .orderBy(desc(founderClaimProfiles.createdAt))
    .limit(1);

  return row ?? null;
}

/* ── The read ─────────────────────────────────────────────────────────────── */

/**
 * One field's stored value, keyed rather than labelled.
 *
 * The label lives in the shared register and is resolved in the browser —
 * Phase 22c's rule for the notification history, applied here for the same
 * reason: a copy of every label on the server would be a second place for one
 * word to drift, and the backend cannot import the register at runtime anyway.
 */
export interface FounderSettingsFieldValue {
  readonly id: string;
  readonly value: string | null;
  readonly guarded: boolean;
}

export interface FounderRepresentationFact {
  readonly id: string;
  readonly label: string;
  readonly confirmed: boolean;
}

export interface FounderSettingsView {
  readonly campaignId: string;
  /** §14.4's own title, or null. The page names which record it is showing. */
  readonly campaignTitle: string | null;
  /** The address this account signs in with. Read-only here (§5.2, §5.5). */
  readonly signInEmail: string | null;
  readonly accountCreatedAt: string | null;
  readonly fields: readonly FounderSettingsFieldValue[];
  /**
   * §10's three, each its own recorded statement (§28.4). Rendered as what was
   * confirmed and when — never as a control.
   */
  readonly representations: readonly FounderRepresentationFact[];
  readonly dateOfBirthOnFile: boolean;
  readonly country: string | null;
  readonly stateRegion: string | null;
  readonly soleProprietor: boolean | null;
  /**
   * §22.3's status through the ONE resolver every §22.3 surface renders
   * (§33.8.13). Null before close, or where the campaign captured nothing —
   * "not applicable yet" rather than an invented state.
   */
  readonly w9: FounderPaymentStatusView['w9'] | null;
  readonly w9NotApplicableBecause: string | null;
  /** How many account-closure requests are already on file, and the latest. */
  readonly deletionRequestedAt: string | null;
}

/**
 * Everything §5.2 names except the two blocks that already have their own read.
 *
 * The payout account (§13) and the notification preference and history (§27.7)
 * are fetched by the surface from `GET /api/founder/payouts` and the two
 * `/api/founder/notifications` routes, which already exist and are already
 * rendered by components built for them. Re-serving those facts here would be
 * a second answer to "is this account complete" and a second place for §13's
 * four states to drift.
 */
export async function readFounderSettings(
  db: Database,
  founderUserId: string,
): Promise<FounderSettingsView | null> {
  const account = await loadFounderAccount(db, founderUserId);
  if (!account) return null;

  const [claim] = await db
    .select()
    .from(founderClaimProfiles)
    .where(eq(founderClaimProfiles.id, account.claimId))
    .limit(1);
  if (!claim) return null;

  const [title] = await db
    .select({ title: campaignBuild.title })
    .from(campaignBuild)
    .where(eq(campaignBuild.campaignId, account.campaignId))
    .limit(1);

  const [accountRow] = await db
    .select({ email: user.email, createdAt: user.createdAt })
    .from(user)
    .where(eq(user.id, founderUserId))
    .limit(1);

  const payments = await readFounderPaymentStatus(db, { campaignId: account.campaignId });

  const [deletion] = await db
    .select({ requestedAt: sql<string | null>`max(${founderDeletionRequests.requestedAt})` })
    .from(founderDeletionRequests)
    .where(eq(founderDeletionRequests.prospectId, account.prospectId));

  const stored = claim as unknown as Record<string, unknown>;

  const fields: FounderSettingsFieldValue[] = FOUNDER_CORRECTABLE_FIELD_IDS.map((id) => {
    const column = founderSettingsColumn(id);
    const raw = column ? stored[toCamel(column)] : null;
    return {
      id,
      value: typeof raw === 'string' && raw.trim() ? raw : null,
      guarded: isGuardedSettingsField(id),
    };
  });

  return {
    campaignId: account.campaignId,
    campaignTitle: title?.title ?? null,
    signInEmail: accountRow?.email ?? null,
    accountCreatedAt: accountRow?.createdAt?.toISOString() ?? null,
    fields,
    representations: [
      {
        id: 'age_18_plus',
        label: 'I am 18 or older',
        confirmed: claim.representationAge18Plus,
      },
      { id: 'us_person', label: 'I am a US person', confirmed: claim.representationUsPerson },
      {
        id: 'sanctions',
        label: 'I am not on a sanctions list',
        confirmed: claim.representationSanctions,
      },
    ],
    // Presence only. §10 collects the date; nothing on a settings page needs to
    // render it back, and a birthday printed on a page somebody screen-shares
    // is a fact leaving for no reason (§25.5).
    dateOfBirthOnFile: claim.dateOfBirth !== null,
    country: claim.country,
    stateRegion: claim.stateRegion,
    soleProprietor: claim.soleProprietor,
    // §33.8.13: one source, many renderers. The W-9 block and the sentence
    // explaining its absence both come from `readFounderPaymentStatus` — the
    // resolver every §22.3 surface and email already render — rather than
    // being recomposed here, where a second wording would eventually disagree
    // with the one on Chapter 3.
    w9: payments && payments.applicable ? payments.w9 : null,
    w9NotApplicableBecause:
      payments && payments.applicable ? null : (payments?.notApplicableReason ?? W9_NOT_YET),
    deletionRequestedAt: deletion?.requestedAt ? new Date(deletion.requestedAt).toISOString() : null,
  };
}

/**
 * What a Founder reads before their campaign has closed.
 *
 * The resolver has no sentence for this case because it returns null entirely
 * when there is no campaign type yet, and §16a's rule applies: "nothing has
 * happened yet" is a different answer from "nothing will", and rendering an
 * empty W-9 block would read as the second.
 */
const W9_NOT_YET =
  'A W-9 is asked for once your campaign closes and something has been charged. Nothing is needed from you yet.';

function toCamel(column: string): string {
  return column.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/* ── The correction ───────────────────────────────────────────────────────── */

export type SettingsFailure = {
  ok: false;
  code: 'not_found' | 'invalid' | 'refused';
  message: string;
};

export type CorrectFieldResult =
  | { ok: true; id: string; priorValue: string | null; newValue: string | null }
  | SettingsFailure;

export interface CorrectFounderFieldInput {
  founderUserId: string;
  /** A `FOUNDER_CORRECTABLE_IDS` value. Anything else is refused by name. */
  fieldId: string;
  value: string | null;
  reason: string;
}

/**
 * Changes one registered field of the Founder's own record.
 *
 * Three refusals, each by name, and each mirroring the Admin path that writes
 * the same row:
 *
 *   * an **unregistered field id** — a route accepting any string would record
 *     a correction of something that does not exist, and the audit trail would
 *     look complete while pointing at nothing (16a's reasoning);
 *   * a **missing reason** — `editReasonRequired` has made one mandatory on a
 *     profile field of a CLAIMED account since 2026-08-16, and this account is
 *     claimed by definition: the caller is signed in as it;
 *   * an **anonymised record**, which has no content left to correct.
 *
 * The prior value is read from the row `FOR UPDATE` inside the transaction that
 * changes it (§33.12.4). A caller that supplied both halves could supply a
 * flattering pair, and here the caller is the person the record is about.
 */
export async function correctFounderField(
  db: Database,
  input: CorrectFounderFieldInput,
): Promise<CorrectFieldResult> {
  const column = founderSettingsColumn(input.fieldId);

  if (!column || !FOUNDER_CORRECTABLE_FIELD_IDS.includes(input.fieldId)) {
    return {
      ok: false,
      code: 'invalid',
      message: `“${input.fieldId}” is not something you can change here. Nothing has changed.`,
    };
  }

  const reason = input.reason.trim();
  if (!reason) {
    return {
      ok: false,
      code: 'invalid',
      message:
        'Tell us why this is changing. It is stored with the change, and nothing is saved without it.',
    };
  }

  const account = await loadFounderAccount(db, input.founderUserId);
  if (!account) return { ok: false, code: 'not_found', message: 'There is no record to change.' };

  const value = input.value === null ? null : input.value.trim() || null;

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(founderClaimProfiles)
      .where(eq(founderClaimProfiles.id, account.claimId))
      .for('update')
      .limit(1);

    if (!row) return { ok: false, code: 'not_found', message: 'There is no record to change.' };
    if (row.anonymisedAt) {
      return {
        ok: false,
        code: 'refused',
        message:
          'This record was cleared under Proovd’s retention rules and its content is gone. Contact support and a person will pick it up.',
      };
    }

    const stored = row as unknown as Record<string, unknown>;
    const priorRaw = stored[toCamel(column)];
    const priorValue = typeof priorRaw === 'string' && priorRaw.trim() ? priorRaw : null;

    await tx
      .update(founderClaimProfiles)
      .set({
        [toCamel(column)]: value,
        // What the 0007 history trigger files as `edited_by`, so the Founder's
        // own correction is named in §9's provenance history rather than
        // inheriting whoever wrote the row last.
        updatedBy: `user:${input.founderUserId}`,
        updatedAt: new Date(),
      } as Record<string, unknown>)
      .where(eq(founderClaimProfiles.id, account.claimId));

    await tx.insert(auditEvents).values({
      actor: `user:${input.founderUserId}`,
      targetType: 'founder_claim_profile',
      targetId: account.claimId,
      action: FOUNDER_SELF_CORRECTED,
      internalReason: reason,
      customerExplanation: null,
      priorValue: { key: input.fieldId, value: priorValue },
      newValue: { key: input.fieldId, value },
    });

    return { ok: true, id: input.fieldId, priorValue, newValue: value };
  });
}

/* ── The account-closure request ──────────────────────────────────────────── */

export type DeletionAskResult = { ok: true; id: string } | SettingsFailure;

/**
 * §5.2's delete-account request, onto the record that already exists.
 *
 * It calls `recordDeletionRequest` — the SAME service the Admin workspace calls
 * when somebody transcribes the ask off a call — with `received_via` set to the
 * constant that distinguishes a Founder-filed request from a transcribed one.
 * That column exists for exactly this distinction.
 *
 * There is no approval state to set here and no purge column to write, because
 * 0040 has neither: §25.8's retention obligations do not end because somebody
 * clicked a button, and a column named `approved` would be the first step
 * toward a "delete everything" action §25.8 does not permit.
 */
export async function requestFounderDeletion(
  deps: { db: Database; audit: AuditWriter },
  input: { founderUserId: string; requestDetail: string; now?: Date },
): Promise<DeletionAskResult> {
  const { db } = deps;
  const detail = input.requestDetail.trim();
  if (!detail) {
    return {
      ok: false,
      code: 'invalid',
      message:
        'Tell us what you are asking for, in your own words. A person reads this and it is what they act on.',
    };
  }

  const account = await loadFounderAccount(db, input.founderUserId);
  if (!account) return { ok: false, code: 'not_found', message: 'There is no record to close.' };

  const result = await recordDeletionRequest(
    { db, audit: deps.audit },
    {
      prospectId: account.prospectId,
      requestDetail: detail,
      receivedVia: FOUNDER_DELETION_VIA,
      requestedAt: input.now ?? new Date(),
    },
    { actor: `founder:${input.founderUserId}` },
  );

  if (!result.ok) {
    return { ok: false, code: 'refused', message: result.message };
  }
  return { ok: true, id: result.id };
}

/* ── Anything else on this page is somebody else's read ───────────────────── */

/**
 * Deliberately absent from this module, each because it already exists:
 *
 *   * the payout account and its §13 state — `readOnboardingState`, served at
 *     `GET /api/founder/payouts` and rendered by `PayoutOnboarding`;
 *   * the digest preference and the notification history — Phase 22c's two
 *     routes and the two components built for them;
 *   * the password change — Better Auth's own endpoint, wrapped by the route
 *     rather than reimplemented here, because a second password path is a
 *     second place for a credential rule to be wrong;
 *   * §5.5's reset — a public ask at `/reset-password`, which stays exactly
 *     where it is: somebody who cannot sign in cannot reach a settings page.
 */
export const SETTINGS_COMPOSES_EXISTING_READS = true;

export { FOUNDER_SELF_CORRECTED } from './settings-logic.js';
