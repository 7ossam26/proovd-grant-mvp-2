/**
 * Pre-account vetting — Spec §9, §23.1, §33.1.4, §33.1.5, §33.1.7.
 *
 * The Founder answers four questions behind a draft token, one at a time, with
 * every keystroke saved. Submitting locks the campaign type permanently and
 * moves the campaign to `vetting_submitted`.
 *
 * ── Nothing here takes a campaign id or a draft id from a caller ────────────
 * Every entry point takes the draft id the *verified token* produced, exactly
 * as `routes/draft.ts` does. §33.1.1's "grants no other access" survives only
 * while that stays true, so the routes never accept an id and this module never
 * offers a lookup by one.
 *
 * ── A save writes only what it was given ────────────────────────────────────
 * §9: "A failed save never clears valid fields." The obvious implementation of
 * autosave — send the whole form, let the server replace the row — turns one
 * dropped field in one request into deleted work. So a save carries only the
 * keys the Founder actually touched, `undefined` means "not in this request",
 * and no code path below can write a NULL over text that already exists except
 * the retention sweep, which is supposed to.
 *
 * ── Competition, again ──────────────────────────────────────────────────────
 * There is no `prefill` parameter for it here, no column for it in the table,
 * and a CHECK constraint pinning its supplier. Three locks, because §9 states
 * the rule twice and §33.1.5 tests it: it is the one field that proves the
 * Founder did their own thinking.
 *
 * ── Submission is a conditional UPDATE, not a check-then-write ──────────────
 * The type lock and the lifecycle transition both land in WHERE clauses. Two
 * concurrent submissions therefore produce one lock and one transition, and the
 * loser gets a safe refusal rather than a second `campaign_status_history` row
 * claiming the campaign entered `vetting_submitted` twice.
 */

import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns, campaignStatusHistory } from '../db/schema/domain.js';
import { campaignDrafts, founderProspects } from '../db/schema/invitations.js';
import {
  campaignVetting,
  draftFieldEdits,
  possibleCreatorResults,
  type CampaignVetting,
} from '../db/schema/vetting.js';
import { auditEvents } from '../db/schema/integrity.js';

/**
 * §9's four answered steps, restated.
 *
 * `@proovd/shared` owns the sequence and its copy, and the backend cannot
 * import it at runtime — the same constraint `db/schema/domain.ts` documents
 * for the state enums and `notifications/events.ts` for the event keys. So the
 * ids are restated and `src/tests/vetting.test.ts` fails the suite if the two
 * ever disagree.
 */
export const VETTING_ANSWER_STEPS = [
  'campaign_path',
  'problem',
  'solution',
  'competition',
] as const;

export const VETTING_STEPS = [...VETTING_ANSWER_STEPS, 'possible_creator_result'] as const;

export type VettingStep = (typeof VETTING_STEPS)[number];

/** §3: internal type values. Never rendered — the surface reads shared's names. */
export const CAMPAIGN_TYPES = ['pre_build', 'pre_launch'] as const;
export type CampaignTypeValue = (typeof CAMPAIGN_TYPES)[number];

/* ── Reading ──────────────────────────────────────────────────────────────── */

export interface FieldProvenance {
  /** Who supplied the value currently in the box (§9). */
  supplier: 'proovd' | 'founder' | null;
  /** What Proovd originally supplied, preserved through every Founder edit. */
  prefilledText: string | null;
  prefilledAt: string | null;
  firstEditedAt: string | null;
  lastEditedAt: string | null;
}

export interface VettingState {
  draftId: string;
  campaignId: string;
  selectedType: CampaignTypeValue | null;
  problem: string | null;
  solution: string | null;
  competition: string | null;
  provenance: {
    problem: FieldProvenance;
    solution: FieldProvenance;
    /**
     * No `prefilledText` and no `prefilledAt` — §9 forbids the field having
     * either, and a null-valued key would leave a shape a later phase could
     * quietly start filling.
     */
    competition: Omit<FieldProvenance, 'prefilledText' | 'prefilledAt'>;
  };
  /** §9: "Returning restores the latest saved draft and says when it was saved." */
  lastSavedAt: string | null;
  resumeStep: VettingStep | null;
  submittedAt: string | null;
  /** Which of §9's four answers are present. Drives progress and Admin's view. */
  completeness: Record<(typeof VETTING_ANSWER_STEPS)[number], boolean>;
  campaignStatus: string;
  /** Set once submission locks it. Read-only thereafter (§9). */
  lockedType: CampaignTypeValue | null;
  typeLockedAt: string | null;
}

const iso = (value: Date | null | undefined): string | null => value?.toISOString() ?? null;

function present(value: string | null): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function toState(row: CampaignVetting, campaignStatus: string, campaign: {
  type: string | null;
  typeLockedAt: Date | null;
}): VettingState {
  return {
    draftId: row.draftId,
    campaignId: row.campaignId,
    selectedType: (row.selectedType as CampaignTypeValue | null) ?? null,
    problem: row.problemText,
    solution: row.solutionText,
    competition: row.competitionText,
    provenance: {
      problem: {
        supplier: row.problemSupplier,
        prefilledText: row.problemPrefilledText,
        prefilledAt: iso(row.problemPrefilledAt),
        firstEditedAt: iso(row.problemFirstEditedAt),
        lastEditedAt: iso(row.problemLastEditedAt),
      },
      solution: {
        supplier: row.solutionSupplier,
        prefilledText: row.solutionPrefilledText,
        prefilledAt: iso(row.solutionPrefilledAt),
        firstEditedAt: iso(row.solutionFirstEditedAt),
        lastEditedAt: iso(row.solutionLastEditedAt),
      },
      competition: {
        supplier: row.competitionSupplier,
        firstEditedAt: iso(row.competitionFirstEditedAt),
        lastEditedAt: iso(row.competitionLastEditedAt),
      },
    },
    lastSavedAt: iso(row.lastSavedAt),
    resumeStep: (row.resumeStep as VettingStep | null) ?? null,
    submittedAt: iso(row.submittedAt),
    completeness: {
      campaign_path: row.selectedType !== null,
      problem: present(row.problemText),
      solution: present(row.solutionText),
      competition: present(row.competitionText),
    },
    campaignStatus,
    lockedType: (campaign.type as CampaignTypeValue | null) ?? null,
    typeLockedAt: iso(campaign.typeLockedAt),
  };
}

/**
 * The vetting record for a draft, created on first read if it does not exist.
 *
 * Created lazily rather than alongside the invitation, because a Founder who
 * never opens their link should leave no record of having been asked anything.
 * `ON CONFLICT DO NOTHING` on the unique draft index makes two simultaneous
 * first-opens produce one row.
 */
export async function ensureVetting(
  db: Database,
  draftId: string,
  actor: string,
): Promise<VettingState | null> {
  const [draft] = await db
    .select({
      id: campaignDrafts.id,
      campaignId: campaignDrafts.campaignId,
      anonymisedAt: campaignDrafts.anonymisedAt,
    })
    .from(campaignDrafts)
    .where(eq(campaignDrafts.id, draftId))
    .limit(1);

  if (!draft || draft.anonymisedAt) return null;

  await db
    .insert(campaignVetting)
    .values({ draftId, campaignId: draft.campaignId, updatedBy: actor })
    .onConflictDoNothing({ target: campaignVetting.draftId });

  return readVetting(db, draftId);
}

export async function readVetting(
  db: Database,
  draftId: string,
): Promise<VettingState | null> {
  const [row] = await db
    .select({
      vetting: campaignVetting,
      status: campaigns.status,
      type: campaigns.type,
      typeLockedAt: campaigns.typeLockedAt,
    })
    .from(campaignVetting)
    .innerJoin(campaigns, eq(campaignVetting.campaignId, campaigns.id))
    .where(eq(campaignVetting.draftId, draftId))
    .limit(1);

  if (!row || row.vetting.anonymisedAt) return null;
  return toState(row.vetting, row.status, { type: row.type, typeLockedAt: row.typeLockedAt });
}

/* ── Autosave (§9) ────────────────────────────────────────────────────────── */

export interface SaveVettingInput {
  /** Absent keys are untouched. A key present with `null` clears that answer. */
  selectedType?: CampaignTypeValue | null;
  problem?: string | null;
  solution?: string | null;
  competition?: string | null;
  resumeStep?: VettingStep;
  actor: string;
}

export type SaveVettingResult =
  | { ok: true; state: VettingState }
  | { ok: false; message: string; next: string };

/**
 * One autosave.
 *
 * The supplier flips to `founder` the moment the text differs from what Proovd
 * prefilled, and `first_edited_at` is set once and never moved — §9 asks for
 * "edit timestamps", and a single timestamp that keeps being overwritten cannot
 * answer when the Founder first took the field over.
 */
export async function saveVetting(
  db: Database,
  draftId: string,
  input: SaveVettingInput,
): Promise<SaveVettingResult> {
  // Create-if-absent, because the first thing a Founder does on the form is
  // type into it — not open a `GET` first. A save that refused until something
  // else had created the row would lose their first sentence.
  const current = await ensureVetting(db, draftId, input.actor);
  if (!current) {
    return {
      ok: false,
      message: 'This draft is no longer available.',
      next: 'Nothing was saved.',
    };
  }

  if (current.submittedAt) {
    // §9: submission locks the type and the answers. Saying so plainly beats a
    // silent no-op, which would look to the Founder like a save that worked.
    return {
      ok: false,
      message:
        'You have already submitted this form, so its answers are now read-only.',
      next: 'Nothing was changed. If something in it is wrong, reply to your invitation email and we will pick it up.',
    };
  }

  if (input.selectedType !== undefined && input.selectedType !== null) {
    if (!CAMPAIGN_TYPES.includes(input.selectedType)) {
      return {
        ok: false,
        message: 'That is not one of the two campaign paths.',
        next: 'Choose one of the options shown. Nothing was changed.',
      };
    }
  }

  const now = new Date();
  const patch: Record<string, unknown> = { lastSavedAt: now, updatedBy: input.actor };

  if (input.selectedType !== undefined) {
    patch['selectedType'] = input.selectedType;
    patch['typeChosenAt'] = input.selectedType === null ? null : now;
  }
  if (input.resumeStep !== undefined) {
    if (!VETTING_STEPS.includes(input.resumeStep)) {
      return {
        ok: false,
        message: 'That is not a step in this form.',
        next: 'Nothing was changed.',
      };
    }
    patch['resumeStep'] = input.resumeStep;
  }

  applyProvenance(patch, 'problem', input.problem, current.problem, current.provenance.problem, now);
  applyProvenance(
    patch,
    'solution',
    input.solution,
    current.solution,
    current.provenance.solution,
    now,
  );

  if (input.competition !== undefined) {
    const next = normalise(input.competition);
    patch['competitionText'] = next;
    // Never anything but `founder`, and never derived from a comparison against
    // a prefill — there is no prefill to compare against and there never will
    // be (§9, §33.1.5). The CHECK constraint says the same thing again.
    patch['competitionSupplier'] = next === null ? null : 'founder';
    if (next !== current.competition) {
      if (!current.provenance.competition.firstEditedAt) {
        patch['competitionFirstEditedAt'] = now;
      }
      patch['competitionLastEditedAt'] = now;
    }
  }

  await db.update(campaignVetting).set(patch).where(eq(campaignVetting.draftId, draftId));

  const state = await readVetting(db, draftId);
  if (!state) {
    return { ok: false, message: 'This draft is no longer available.', next: 'Nothing was saved.' };
  }
  return { ok: true, state };
}

function normalise(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : value;
}

/**
 * Sets the value, the supplier of that value, and the edit timestamps for one
 * prefillable field (§9: Problem and Solution).
 *
 * The supplier is decided by comparing against `*_prefilled_text`, not by
 * trusting the caller: a request that claimed `supplier: 'proovd'` over text the
 * Founder wrote would make the provenance record a lie, and provenance is the
 * whole reason these columns exist.
 */
function applyProvenance(
  patch: Record<string, unknown>,
  field: 'problem' | 'solution',
  incoming: string | null | undefined,
  currentText: string | null,
  provenance: FieldProvenance,
  now: Date,
): void {
  if (incoming === undefined) return;

  const next = normalise(incoming);
  patch[`${field}Text`] = next;
  patch[`${field}Supplier`] =
    next === null ? null : next === provenance.prefilledText ? 'proovd' : 'founder';

  if (next !== currentText) {
    if (!provenance.firstEditedAt) patch[`${field}FirstEditedAt`] = now;
    patch[`${field}LastEditedAt`] = now;
  }
}

/* ── Admin prefill (§9) ───────────────────────────────────────────────────── */

export interface PrefillInput {
  /** Absent keys are untouched. There is no `competition` key (§9, §33.1.5). */
  problem?: string | null;
  solution?: string | null;
  actor: string;
}

/**
 * §9: Problem and Solution are "human-prefilled by Proovd from discovery".
 *
 * There is no third parameter. Competition is never prefilled — not from
 * discovery, not from a model, not "as a starting point" — and the way to make
 * that true is to give the operation nowhere to put one.
 *
 * A prefill lands in both the prefill snapshot and the current text while the
 * Founder has not touched the field. Once they have, only the snapshot moves:
 * overwriting a Founder's own words with a later Admin edit is the failure §9's
 * "Founder can review and edit" exists to prevent.
 */
export async function prefillVetting(
  db: Database,
  draftId: string,
  input: PrefillInput,
): Promise<{ ok: true; state: VettingState } | { ok: false; message: string }> {
  const current = await ensureVetting(db, draftId, input.actor);
  if (!current) return { ok: false, message: 'That draft is no longer available.' };
  if (current.submittedAt) {
    return {
      ok: false,
      message:
        'This Founder has submitted their vetting, so its answers are locked. Nothing was changed.',
    };
  }

  const now = new Date();
  const patch: Record<string, unknown> = { updatedBy: input.actor };
  const prior: Record<string, unknown> = {};
  const next: Record<string, unknown> = {};

  for (const field of ['problem', 'solution'] as const) {
    const incoming = input[field];
    if (incoming === undefined) continue;
    const value = normalise(incoming);
    const provenance = current.provenance[field];

    prior[field] = provenance.prefilledText;
    next[field] = value;

    patch[`${field}PrefilledText`] = value;
    patch[`${field}PrefilledBy`] = input.actor;
    patch[`${field}PrefilledAt`] = value === null ? null : now;

    if (!provenance.firstEditedAt) {
      // The Founder has not touched it, so the prefill is what they will see.
      patch[`${field}Text`] = value;
      patch[`${field}Supplier`] = value === null ? null : 'proovd';
    }
  }

  if (Object.keys(next).length === 0) {
    return { ok: true, state: current };
  }

  await db.transaction(async (tx) => {
    await tx.update(campaignVetting).set(patch).where(eq(campaignVetting.draftId, draftId));
    await tx.insert(auditEvents).values({
      actor: input.actor,
      targetType: 'campaign_vetting',
      targetId: draftId,
      action: 'vetting.prefilled',
      internalReason: 'Problem/Solution prefilled from discovery (§9)',
      customerExplanation: null,
      priorValue: prior,
      newValue: next,
    });
  });

  const state = await readVetting(db, draftId);
  return state
    ? { ok: true, state }
    : { ok: false, message: 'That draft is no longer available.' };
}

/* ── Submission and the type lock (§9, §23.1, §33.1.7) ────────────────────── */

export type SubmitResult =
  | { ok: true; state: VettingState }
  | { ok: false; message: string; next: string; missing?: string[] };

/**
 * §9 State: "Submitting all vetting answers locks the type and sets
 * `vetting_submitted`."
 *
 * Three things happen in one transaction, and each is guarded by its own WHERE
 * clause rather than by a preceding read:
 *
 *  1. `campaigns.type` is set where it is still NULL — so the lock happens once
 *     even if two submissions arrive together, and the second finds it taken.
 *  2. `campaigns.status` moves where it is still `invited_draft`, which is
 *     §23.1's only legal predecessor.
 *  3. `campaign_vetting.submitted_at` is set where it is still NULL.
 *
 * A trigger then makes 1 permanent: `type` and `type_locked_at` are immutable
 * from here, in the database, for every future phase and every support script.
 * §9: "No campaign-type migration exists."
 */
export async function submitVetting(
  db: Database,
  draftId: string,
  actor: string,
): Promise<SubmitResult> {
  const current = await readVetting(db, draftId);
  if (!current) {
    return {
      ok: false,
      message: 'This draft is no longer available.',
      next: 'Nothing was submitted.',
    };
  }

  if (current.submittedAt) {
    return {
      ok: false,
      message: 'You have already submitted this form.',
      next: 'Your campaign path is locked and we are working through your answers.',
    };
  }

  const missing = VETTING_ANSWER_STEPS.filter((step) => !current.completeness[step]);
  if (missing.length > 0) {
    return {
      ok: false,
      message: 'Some answers are still empty, and the campaign path locks on submission.',
      next: 'Go back and finish them. Everything you have written is saved.',
      missing: [...missing],
    };
  }

  const type = current.selectedType!;
  const now = new Date();

  const outcome = await db.transaction(async (tx) => {
    const locked = await tx
      .update(campaigns)
      .set({ type, typeLockedAt: now, status: 'vetting_submitted' })
      .where(and(eq(campaigns.id, current.campaignId), isNull(campaigns.type), eq(campaigns.status, 'invited_draft')))
      .returning({ id: campaigns.id });

    if (locked.length !== 1) return { locked: false as const };

    await tx.insert(campaignStatusHistory).values({
      campaignId: current.campaignId,
      fromStatus: 'invited_draft',
      toStatus: 'vetting_submitted',
      actor,
    });

    await tx
      .update(campaignVetting)
      .set({ submittedAt: now, resumeStep: 'possible_creator_result', updatedBy: actor })
      .where(and(eq(campaignVetting.draftId, draftId), isNull(campaignVetting.submittedAt)));

    await tx.insert(auditEvents).values({
      actor,
      targetType: 'campaign',
      targetId: current.campaignId,
      action: 'vetting.submitted',
      internalReason: `vetting submitted; campaign type locked to ${type} (§9); status invited_draft → vetting_submitted`,
      customerExplanation:
        'You submitted your answers and your campaign path is now locked. It cannot be changed.',
      priorValue: { type: null, status: 'invited_draft' },
      newValue: { type, typeLockedAt: now, status: 'vetting_submitted' },
    });

    return { locked: true as const };
  });

  if (!outcome.locked) {
    return {
      ok: false,
      message: 'This form has already been submitted.',
      next: 'Your campaign path is locked. Reload to see where things stand.',
    };
  }

  const state = await readVetting(db, draftId);
  return state
    ? { ok: true, state }
    : { ok: false, message: 'This draft is no longer available.', next: 'Nothing was submitted.' };
}

/* ── The possible-creator result (§10) ────────────────────────────────────── */

export interface PossibleCreatorSignal {
  count: number;
  basis: string;
  recordedBy: string;
  recordedAt: string;
}

export async function readPossibleCreatorSignal(
  db: Database,
  campaignId: string,
  /**
   * §31.9's "possible-creator rendering", stamped once (Phase 23b).
   *
   * Off by default and passed only by the two Founder-facing reads, because an
   * Admin opening the record is not the Founder being shown it — and "time to
   * first magic" measured from an Admin's own click would be measuring
   * ourselves. `coalesce` in SQL rather than a read-then-write, so two
   * concurrent loads cannot both see null; the 0037 trigger refuses a move
   * regardless.
   */
  options: { stampRendered?: boolean } = {},
): Promise<PossibleCreatorSignal | null> {
  const [row] = await db
    .select()
    .from(possibleCreatorResults)
    .where(eq(possibleCreatorResults.campaignId, campaignId))
    .orderBy(desc(possibleCreatorResults.recordedAt))
    .limit(1);

  if (!row) return null;

  if (options.stampRendered && !row.firstRenderedAt) {
    await db
      .update(possibleCreatorResults)
      .set({
        firstRenderedAt: sql`coalesce(${possibleCreatorResults.firstRenderedAt}, now())`,
      })
      .where(eq(possibleCreatorResults.id, row.id));
  }

  return {
    count: row.count,
    basis: row.basis,
    recordedBy: row.recordedBy,
    recordedAt: row.recordedAt.toISOString(),
  };
}

export async function recordPossibleCreatorSignal(
  db: Database,
  input: { campaignId: string; count: number; basis: string; actor: string },
): Promise<{ ok: true; signal: PossibleCreatorSignal } | { ok: false; message: string }> {
  if (!Number.isInteger(input.count) || input.count < 0) {
    return { ok: false, message: 'The count must be a whole number of zero or more.' };
  }
  if (!input.basis.trim()) {
    return {
      ok: false,
      message:
        'Say what the count is based on. A number with no stated basis is a guess, and this one reaches a Founder.',
    };
  }

  const prior = await readPossibleCreatorSignal(db, input.campaignId);

  await db.transaction(async (tx) => {
    await tx.insert(possibleCreatorResults).values({
      campaignId: input.campaignId,
      count: input.count,
      basis: input.basis.trim(),
      recordedBy: input.actor,
    });
    await tx.insert(auditEvents).values({
      actor: input.actor,
      targetType: 'campaign',
      targetId: input.campaignId,
      action: 'vetting.possible_creator_result_recorded',
      internalReason:
        input.count === 0
          ? 'possible-creator result recorded as zero; §10 routes this to Admin and it does not render to the Founder'
          : 'possible-creator relevance signal recorded (§10)',
      customerExplanation: null,
      priorValue: prior ? { count: prior.count, basis: prior.basis } : null,
      newValue: { count: input.count, basis: input.basis.trim() },
    });
  });

  const signal = await readPossibleCreatorSignal(db, input.campaignId);
  return signal ? { ok: true, signal } : { ok: false, message: 'The record was not written.' };
}

/**
 * What the Founder is allowed to see at §9's fifth step.
 *
 * §10: "For the pre-screened invited cohort, the result must not be zero; a zero
 * result routes to Admin before the Founder proceeds." So there are exactly two
 * outcomes and no third:
 *
 *  - a count of one or more renders, with §10's disclosures;
 *  - anything else — zero, or nothing recorded yet — renders a waiting state
 *    owned by Proovd, and the claim stays closed until it changes.
 *
 * The zero and the not-yet-recorded cases deliberately produce the *same*
 * Founder-facing state. They mean the same thing to the Founder: Proovd is
 * looking at it. Distinguishing them would tell them a number they must not be
 * shown.
 */
export interface CreatorSignalView {
  status: 'available' | 'with_admin';
  count: number | null;
  recordedAt: string | null;
}

export function viewCreatorSignal(signal: PossibleCreatorSignal | null): CreatorSignalView {
  if (!signal || signal.count <= 0) {
    return { status: 'with_admin', count: null, recordedAt: null };
  }
  return { status: 'available', count: signal.count, recordedAt: signal.recordedAt };
}

/* ── The wrong-type path (§9, §33.1.7) ────────────────────────────────────── */

export interface ArchiveAndRestartResult {
  archivedCampaignId: string;
  campaignId: string;
  draftId: string;
  prospectId: string;
}

/**
 * §9: "A wrong locked type is archived and a new vetting record begins."
 *
 * The type locks on `campaigns` and the database will not unlock it, so the
 * replacement is a new campaign container with a new invited draft and a new,
 * empty vetting record. That is the whole of what carries over: the person.
 *
 * §9 and §33.1.7 are explicit about what does not: "No Creator acceptance,
 * reward, payment, or consent record is copied automatically." Nothing below
 * reads those tables — not to copy them, not to check them — because the safest
 * implementation of "nothing is copied" is code that has no idea they exist.
 *
 * §9 also fixes the fee question: "Before listing-fee payment, Admin may create
 * the replacement without another fee. After payment, cancellation/refund rules
 * control." Those rules are Phase 11's, so after payment this refuses and says
 * so rather than guessing at them (§1 rule 6).
 */
export async function archiveAndRestartVetting(
  db: Database,
  input: { campaignId: string; reason: string; actor: string },
): Promise<{ ok: true; result: ArchiveAndRestartResult } | { ok: false; message: string }> {
  if (!input.reason.trim()) {
    return { ok: false, message: 'Say why this record is being archived. The reason is stored.' };
  }

  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, input.campaignId))
    .limit(1);

  if (!campaign) return { ok: false, message: 'There is no campaign at that address.' };
  if (campaign.archivedAt) {
    return { ok: false, message: 'This record has already been archived.' };
  }
  if (!campaign.typeLockedAt) {
    return {
      ok: false,
      message:
        'This campaign has no locked type yet, so there is nothing to correct — the Founder can still change their answer.',
    };
  }
  if (campaign.listingPaidAt) {
    return {
      ok: false,
      message:
        'The listing fee has been paid on this campaign, so the cancellation and refund rules control what happens next. Archiving here would create a replacement without settling that.',
    };
  }

  const [draft] = await db
    .select({ id: campaignDrafts.id, prospectId: campaignDrafts.prospectId })
    .from(campaignDrafts)
    .where(eq(campaignDrafts.campaignId, input.campaignId))
    .limit(1);

  if (!draft) {
    return { ok: false, message: 'This campaign has no invited draft to restart from.' };
  }

  const [prospect] = await db
    .select({ id: founderProspects.id, claimedUserId: founderProspects.claimedUserId })
    .from(founderProspects)
    .where(eq(founderProspects.id, draft.prospectId))
    .limit(1);

  if (!prospect) return { ok: false, message: 'This draft has no prospect behind it.' };

  const now = new Date();

  const result = await db.transaction(async (tx) => {
    const replacement = await tx
      .insert(campaigns)
      .values({ status: 'invited_draft', replacesCampaignId: input.campaignId })
      .returning({ id: campaigns.id });

    const newCampaignId = replacement[0]!.id;

    await tx.insert(campaignStatusHistory).values({
      campaignId: newCampaignId,
      fromStatus: null,
      toStatus: 'invited_draft',
      actor: input.actor,
    });

    const archived = await tx
      .update(campaigns)
      .set({
        archivedAt: now,
        archivedReason: input.reason.trim(),
        archivedBy: input.actor,
        replacedByCampaignId: newCampaignId,
      })
      .where(and(eq(campaigns.id, input.campaignId), isNull(campaigns.archivedAt)))
      .returning({ id: campaigns.id });

    if (archived.length !== 1) throw new Error('campaign was archived concurrently');

    const newDraft = await tx
      .insert(campaignDrafts)
      .values({
        campaignId: newCampaignId,
        prospectId: prospect.id,
        senderName: null,
        senderEmail: null,
        createdBy: input.actor,
      })
      .returning({ id: campaignDrafts.id });

    const newDraftId = newDraft[0]!.id;

    // Empty. The Founder answers again, including the campaign path — which is
    // the point: the previous answer produced the wrong lock.
    await tx.insert(campaignVetting).values({
      draftId: newDraftId,
      campaignId: newCampaignId,
      updatedBy: input.actor,
    });

    await tx.insert(auditEvents).values({
      actor: input.actor,
      targetType: 'campaign',
      targetId: input.campaignId,
      action: 'vetting.archived_and_restarted',
      internalReason: input.reason.trim(),
      customerExplanation:
        'We started a fresh record for your campaign. Nothing from the previous one carries over.',
      priorValue: {
        type: campaign.type,
        typeLockedAt: campaign.typeLockedAt,
        status: campaign.status,
      },
      newValue: {
        replacedByCampaignId: newCampaignId,
        draftId: newDraftId,
        copied: 'nothing — §9 forbids migrating Creator acceptance, reward, payment, or consent records',
      },
    });

    return {
      archivedCampaignId: input.campaignId,
      campaignId: newCampaignId,
      draftId: newDraftId,
      prospectId: prospect.id,
    };
  });

  return { ok: true, result };
}

/* ── Provenance history, for Admin (§9, §26.1) ────────────────────────────── */

export interface FieldEdit {
  record: string;
  field: string;
  priorValue: string | null;
  newValue: string | null;
  supplier: 'proovd' | 'founder';
  editedBy: string;
  occurredAt: string;
}

export async function readFieldEdits(db: Database, draftId: string): Promise<FieldEdit[]> {
  const rows = await db
    .select()
    .from(draftFieldEdits)
    .where(eq(draftFieldEdits.draftId, draftId))
    .orderBy(desc(draftFieldEdits.occurredAt));

  return rows.map((row) => ({
    record: row.record,
    field: row.field,
    priorValue: row.priorValue,
    newValue: row.newValue,
    supplier: row.supplier,
    editedBy: row.editedBy,
    occurredAt: row.occurredAt.toISOString(),
  }));
}

