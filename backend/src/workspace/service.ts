/**
 * The Founder campaign workspace — Spec §12, §25.1, §33.3.1–4.
 *
 * ── One entry point, and it is not the Founder's ────────────────────────────
 * A Founder saves *content*. Whether an item is complete is decided by
 * `evaluateWorkspace`, which re-derives all five decisions from the stored
 * content every time anything changes and writes the result. There is no route,
 * no patch key, and no column that lets a Founder set `complete` — Phase 09's
 * trap is that an item completing because someone clicked "done" defeats the
 * whole discount, and the way to make that impossible is for the field not to
 * be reachable rather than for a handler to remember not to set it.
 *
 * ── Approval is of a version, so editing revokes it ─────────────────────────
 * §12 rejects "unapproved drafts". A Founder who approves a story and then
 * rewrites it has an unapproved draft again — the approval was of the text they
 * read, not of the box it lived in. So a content change to an approved field
 * clears the approval in the same statement. Leaving it would let a Founder
 * approve one sentence and publish another, which is the same failure as
 * self-assertion wearing a different hat.
 *
 * ── Evaluation and the save are one transaction ─────────────────────────────
 * Two Founder tabs saving at once would otherwise interleave a read of the old
 * content with a write of the new decision. The workspace row is locked FOR
 * UPDATE and everything downstream of it happens inside that lock, so the
 * decisions, the classification, and the fee always describe one consistent
 * snapshot.
 *
 * ── History records changes, not heartbeats ─────────────────────────────────
 * §12 asks for the calculation time and actor on high-effort, and §24.6 for the
 * fee's own record. Writing an identical row on every keystroke would satisfy
 * the letter and destroy the use: "the fee was recalculated at 14:32" only means
 * something if it changed. So a classification row is written when the inputs or
 * the result differ from the latest one, and a fee row when the subtotal or the
 * completed set differs. The current answer is always readable from the latest
 * row, and `campaigns.high_effort` mirrors it for Phase 12's matrix.
 *
 * ── The lock is honoured here and enforced below ────────────────────────────
 * §12: "After payment, the calculation and evidence snapshot lock." Phase 11
 * sets `locked_at`; this service skips locked items and refuses to supersede a
 * locked calculation, and the database triggers from migration 0012 refuse it
 * again if anything here is ever wrong. §33.3.3's second direction — canceling
 * the interview after payment does not change the amount already paid — is that
 * pair of mechanisms, not a condition someone remembered to write.
 */

import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns } from '../db/schema/domain.js';
import {
  campaignWorkspace,
  campaignAssets,
  campaignSocialProfiles,
  campaignOptionalItems,
  founderInterviewBookings,
  highEffortClassifications,
  listingFeeCalculations,
} from '../db/schema/workspace.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { OPTIONAL_ITEM_KEYS, interviewCountsForHighEffort, type OptionalItemKey } from './registry.js';
import { decideItems, type WorkspaceSnapshot, type ItemDecision } from './evidence.js';
import {
  computeListingFee,
  readListingFeeSettings,
  type ListingFeeResult,
} from './listing-fee.js';

/**
 * A database or a transaction. Structural rather than a Drizzle transaction
 * type, for the reason `affiliates/recruitment.ts` documents: naming the
 * transaction type drags Drizzle's generic schema parameter through every
 * signature, and the only thing these functions need is the four verbs.
 *
 * Everything that must land together takes this and runs inside the caller's
 * transaction — an evaluation that committed separately from the save that
 * caused it would leave a decision describing content that no longer exists.
 */
type Executor = Pick<Database, 'select' | 'insert' | 'update' | 'execute'>;

/* ── Authorization ────────────────────────────────────────────────────────── */

/**
 * The campaign this signed-in Founder owns, or null.
 *
 * The predicate is in the query, not after it — the same decision as
 * `readPreparingKit` (Phase 08c). A campaign belonging to someone else answers
 * `null`, which the route turns into the same 404 a campaign that does not exist
 * gets, so nothing can be enumerated.
 */
export async function findFounderCampaign(
  db: Database,
  input: { campaignId: string; founderUserId: string },
): Promise<{ campaignId: string; status: string; listingPaidAt: Date | null } | null> {
  const [row] = await db
    .select({
      campaignId: campaigns.id,
      status: campaigns.status,
      listingPaidAt: campaigns.listingPaidAt,
    })
    .from(campaigns)
    .innerJoin(founderClaimProfiles, eq(founderClaimProfiles.campaignId, campaigns.id))
    .where(
      and(
        eq(campaigns.id, input.campaignId),
        eq(founderClaimProfiles.claimedUserId, input.founderUserId),
        isNull(campaigns.archivedAt),
      ),
    )
    .limit(1);

  return row ?? null;
}

/** Every campaign this Founder has claimed. The workspace's entry list. */
export async function listFounderCampaigns(db: Database, founderUserId: string) {
  return db
    .select({
      campaignId: campaigns.id,
      status: campaigns.status,
      type: campaigns.type,
      listingPaidAt: campaigns.listingPaidAt,
      highEffort: campaigns.highEffort,
    })
    .from(campaigns)
    .innerJoin(founderClaimProfiles, eq(founderClaimProfiles.campaignId, campaigns.id))
    .where(and(eq(founderClaimProfiles.claimedUserId, founderUserId), isNull(campaigns.archivedAt)));
}

/* ── Opening the workspace ────────────────────────────────────────────────── */

/**
 * Creates the workspace row and the five item rows, once.
 *
 * The five rows exist from the start rather than appearing as items are
 * attempted, because §12's surface has to show all five with their state from
 * the first visit — "not a widget dashboard or endless form" still means the
 * Founder can see what the five things are. A missing row and an incomplete row
 * would otherwise be different states meaning the same thing.
 *
 * `ON CONFLICT DO NOTHING` rather than a check-then-insert: two tabs opening the
 * workspace at the same moment is an ordinary race, not an error.
 */
export async function ensureWorkspace(
  db: Executor,
  input: { campaignId: string; actor: string },
): Promise<void> {
  await db
    .insert(campaignWorkspace)
    .values({ campaignId: input.campaignId, updatedBy: input.actor })
    .onConflictDoNothing({ target: campaignWorkspace.campaignId });

  await db
    .insert(campaignOptionalItems)
    .values(
      OPTIONAL_ITEM_KEYS.map((item) => ({
        campaignId: input.campaignId,
        item,
        updatedBy: input.actor,
      })),
    )
    .onConflictDoNothing({
      target: [campaignOptionalItems.campaignId, campaignOptionalItems.item],
    });
}

/* ── The snapshot ─────────────────────────────────────────────────────────── */

export interface WorkspaceRows {
  workspace: typeof campaignWorkspace.$inferSelect;
  assets: (typeof campaignAssets.$inferSelect)[];
  socials: (typeof campaignSocialProfiles.$inferSelect)[];
  booking: typeof founderInterviewBookings.$inferSelect | null;
  items: (typeof campaignOptionalItems.$inferSelect)[];
}

/** Everything the decision rests on, read in one place. */
export async function loadWorkspaceRows(
  db: Executor,
  campaignId: string,
): Promise<WorkspaceRows | null> {
  const [workspace] = await db
    .select()
    .from(campaignWorkspace)
    .where(eq(campaignWorkspace.campaignId, campaignId))
    .limit(1);

  if (!workspace) return null;

  const [assets, socials, bookings, items] = await Promise.all([
    db.select().from(campaignAssets).where(eq(campaignAssets.campaignId, campaignId)),
    db
      .select()
      .from(campaignSocialProfiles)
      .where(eq(campaignSocialProfiles.campaignId, campaignId)),
    db
      .select()
      .from(founderInterviewBookings)
      .where(eq(founderInterviewBookings.campaignId, campaignId))
      .orderBy(desc(founderInterviewBookings.createdAt)),
    db
      .select()
      .from(campaignOptionalItems)
      .where(eq(campaignOptionalItems.campaignId, campaignId)),
  ]);

  // The live booking if there is one, otherwise the most recent — a canceled
  // booking is still the interview's state, and §12 asks the item to report
  // `booking_canceled` rather than "no interview".
  const booking =
    bookings.find((b) => b.status === 'confirmed' || b.status === 'selected') ?? bookings[0] ?? null;

  return { workspace, assets, socials, booking, items };
}

function toSnapshot(rows: WorkspaceRows): WorkspaceSnapshot {
  return {
    assets: rows.assets.map((a) => ({
      id: a.id,
      purpose: a.purpose,
      state: a.state,
      rejection: (a.rejection ?? null) as WorkspaceSnapshot['assets'][number]['rejection'],
      approved: a.approvedAt !== null,
      removed: a.removedAt !== null,
    })),
    socials: rows.socials.map((s) => ({
      id: s.id,
      url: s.url,
      accessible: s.accessible,
      rejection: (s.rejection ?? null) as WorkspaceSnapshot['socials'][number]['rejection'],
      controlsConfirmed: s.controlsConfirmed,
      removed: s.removedAt !== null,
    })),
    brand: {
      colors: rows.workspace.brandColors,
      typography: rows.workspace.brandTypography,
      approved: rows.workspace.brandApprovedAt !== null,
    },
    story: {
      text: rows.workspace.storyText,
      approved: rows.workspace.storyApprovedAt !== null,
    },
    interview: { status: rows.booking?.status ?? null },
    invalidated: Object.fromEntries(
      rows.items.filter((i) => i.invalidatedAt !== null).map((i) => [i.item, true]),
    ) as WorkspaceSnapshot['invalidated'],
  };
}

/* ── Evaluation ───────────────────────────────────────────────────────────── */

export interface EvaluationResult {
  decisions: ItemDecision[];
  completed: OptionalItemKey[];
  highEffort: {
    visualsCompleted: boolean;
    brandingCompleted: boolean;
    interviewScheduledOrConfirmed: boolean;
    highEffort: boolean;
    calculatedAt: Date;
  };
  fee: ListingFeeResult;
  /** True while §12's lock is in force — Phase 11 sets it at payment. */
  locked: boolean;
}

/**
 * Re-derives every decision, the classification, and the fee. Idempotent.
 *
 * Called after any content change and callable on its own — Admin's "recheck"
 * and the reconciliation path both use it. Running it twice with no change
 * writes no history and produces the same answer, which is what makes it safe
 * to call from anywhere.
 */
export async function evaluateWorkspace(
  db: Executor,
  input: { campaignId: string; actor: string; trigger: string },
): Promise<EvaluationResult> {
  const rows = await loadWorkspaceRows(db, input.campaignId);
  if (!rows) {
    throw new Error(`no workspace for campaign ${input.campaignId}`);
  }

  const decisions = decideItems(toSnapshot(rows));
  const byItem = new Map(rows.items.map((i) => [i.item, i]));
  const locked = rows.items.some((i) => i.lockedAt !== null);

  const now = new Date();

  for (const decision of decisions) {
    const current = byItem.get(decision.item);
    if (!current) continue;

    // §12's lock. The stored decision is what the Founder was charged against;
    // it does not move because the content moved afterwards.
    if (current.lockedAt !== null) continue;

    // A recorded Admin override is a standing decision, not an evidence
    // reading. §12 requires an override to carry prior value, new value,
    // reason, actor, time, and evidence — and one that the Founder's next
    // autosave silently withdrew would be none of those things. It is lifted by
    // `overrideItem` or by `reinstateItem`, both of which say who and why.
    if (current.decisionSource === 'admin_override') continue;

    const unchanged =
      current.complete === decision.complete &&
      JSON.stringify(current.evidence) === JSON.stringify(decision.evidence) &&
      JSON.stringify(current.rejections) === JSON.stringify(decision.rejections);

    if (unchanged) continue;

    await db
      .update(campaignOptionalItems)
      .set({
        complete: decision.complete,
        completedAt: decision.complete ? (current.completedAt ?? now) : null,
        // An item completed by re-evaluation was completed by the Founder's own
        // act — the approval, the upload, the confirmed booking. An override
        // never reaches here: the loop above leaves those rows alone.
        decisionSource: decision.complete ? 'founder_approval' : null,
        evidence: decision.evidence,
        rejections: decision.rejections,
        evaluatedAt: now,
        updatedBy: input.actor,
        updatedAt: now,
      })
      .where(eq(campaignOptionalItems.id, current.id));
  }

  // Read back what actually landed: a locked item keeps its stored decision,
  // and the fee has to follow the record rather than the recomputation.
  const settled = await db
    .select()
    .from(campaignOptionalItems)
    .where(eq(campaignOptionalItems.campaignId, input.campaignId));

  const completed = OPTIONAL_ITEM_KEYS.filter((key) =>
    settled.some((row) => row.item === key && row.complete),
  );

  const highEffort = await recordHighEffort(db, {
    campaignId: input.campaignId,
    actor: input.actor,
    trigger: input.trigger,
    visualsCompleted: completed.includes('visuals'),
    brandingCompleted: completed.includes('branding'),
    interviewScheduledOrConfirmed: interviewCountsForHighEffort(rows.booking?.status ?? null),
  });

  const fee = await recordListingFee(db, {
    campaignId: input.campaignId,
    actor: input.actor,
    trigger: input.trigger,
    completed,
  });

  return { decisions, completed, highEffort, fee, locked };
}

/* ── High-effort (§12) ────────────────────────────────────────────────────── */

/**
 * §12: "`high_effort = true` only when all three are absent at calculation
 * time… Store the three inputs, result, calculation time, and actor/system."
 *
 * The rule is one boolean expression and it is stated once, here, and again as
 * a CHECK constraint on the table — because this is the input to Phase 12's
 * six-cell compensation matrix, and a classification that is wrong is a
 * commercial term that is wrong.
 *
 * §12 also requires the criteria to be presented neutrally. Nothing in the
 * stored record carries a judgement: three booleans, a result, a time, an
 * actor, and why it ran.
 */
export async function recordHighEffort(
  db: Executor,
  input: {
    campaignId: string;
    actor: string;
    trigger: string;
    visualsCompleted: boolean;
    brandingCompleted: boolean;
    interviewScheduledOrConfirmed: boolean;
  },
): Promise<EvaluationResult['highEffort']> {
  const highEffort =
    !input.visualsCompleted && !input.brandingCompleted && !input.interviewScheduledOrConfirmed;

  const [latest] = await db
    .select()
    .from(highEffortClassifications)
    .where(eq(highEffortClassifications.campaignId, input.campaignId))
    .orderBy(desc(highEffortClassifications.calculatedAt))
    .limit(1);

  const unchanged =
    latest !== undefined &&
    latest.visualsCompleted === input.visualsCompleted &&
    latest.brandingCompleted === input.brandingCompleted &&
    latest.interviewScheduledOrConfirmed === input.interviewScheduledOrConfirmed &&
    latest.highEffort === highEffort;

  if (unchanged) {
    return {
      visualsCompleted: latest.visualsCompleted,
      brandingCompleted: latest.brandingCompleted,
      interviewScheduledOrConfirmed: latest.interviewScheduledOrConfirmed,
      highEffort: latest.highEffort,
      calculatedAt: latest.calculatedAt,
    };
  }

  const [written] = await db
    .insert(highEffortClassifications)
    .values({
      campaignId: input.campaignId,
      visualsCompleted: input.visualsCompleted,
      brandingCompleted: input.brandingCompleted,
      interviewScheduledOrConfirmed: input.interviewScheduledOrConfirmed,
      highEffort,
      actor: input.actor,
      trigger: input.trigger,
    })
    .returning();

  // §25.1: the campaign record stores the result. Mirrored so Phase 12 reads
  // one column; the append-only table remains the explanation.
  await db
    .update(campaigns)
    .set({ highEffort, highEffortCalculatedAt: written!.calculatedAt, updatedAt: new Date() })
    .where(eq(campaigns.id, input.campaignId));

  return {
    visualsCompleted: input.visualsCompleted,
    brandingCompleted: input.brandingCompleted,
    interviewScheduledOrConfirmed: input.interviewScheduledOrConfirmed,
    highEffort,
    calculatedAt: written!.calculatedAt,
  };
}

/* ── The fee (§12, §24.6) ─────────────────────────────────────────────────── */

/**
 * Recomputes the listing fee from the §6 settings and records it when it moves.
 *
 * A locked calculation is never superseded: §12 locks at payment, and a second
 * row after that would make "which one was charged" a question. Phase 11 stamps
 * the lock on the row it charges; this returns that row unchanged from then on.
 */
export async function recordListingFee(
  db: Executor,
  input: {
    campaignId: string;
    actor: string;
    trigger: string;
    completed: readonly OptionalItemKey[];
  },
): Promise<ListingFeeResult> {
  const [latest] = await db
    .select()
    .from(listingFeeCalculations)
    .where(eq(listingFeeCalculations.campaignId, input.campaignId))
    .orderBy(desc(listingFeeCalculations.calculatedAt))
    .limit(1);

  if (latest?.lockedAt) {
    return {
      baseCents: latest.baseCents,
      itemDiscountCents: latest.itemDiscountCents,
      maxDiscountCents: latest.maxDiscountCents,
      minSubtotalCents: latest.minSubtotalCents,
      completedItems: latest.completedItems,
      discountLines: latest.discountLines as ListingFeeResult['discountLines'],
      discountCents: latest.discountCents,
      subtotalCents: latest.subtotalCents,
    };
  }

  const settings = await readListingFeeSettings(db as Database);
  const result = computeListingFee(settings, input.completed);

  const unchanged =
    latest !== undefined &&
    latest.subtotalCents === result.subtotalCents &&
    latest.completedItems === result.completedItems &&
    latest.baseCents === result.baseCents &&
    JSON.stringify(latest.itemsSnapshot) === JSON.stringify(input.completed);

  if (!unchanged) {
    await db.insert(listingFeeCalculations).values({
      campaignId: input.campaignId,
      baseCents: result.baseCents,
      itemDiscountCents: result.itemDiscountCents,
      maxDiscountCents: result.maxDiscountCents,
      minSubtotalCents: result.minSubtotalCents,
      completedItems: result.completedItems,
      discountCents: result.discountCents,
      subtotalCents: result.subtotalCents,
      discountLines: result.discountLines.map((l) => ({
        item: l.item,
        discountCents: l.discountCents.toString(),
      })),
      itemsSnapshot: [...input.completed],
      actor: input.actor,
      trigger: input.trigger,
    });
  }

  return result;
}

/* ── Saving content ───────────────────────────────────────────────────────── */

export interface WorkspacePatch {
  brandColors?: string | null;
  brandTypography?: string | null;
  brandNotes?: string | null;
  storyText?: string | null;
  resumeStep?: string;
  /** §12's completing act for Branding. Its own key, never bundled. */
  brandApproved?: boolean;
  /** §12's completing act for Story. */
  storyApproved?: boolean;
}

/**
 * Writes only the keys it was given, and re-evaluates in the same transaction.
 *
 * `undefined` means "not in this request" — §9's rule, restated here because the
 * workspace autosaves the same way the vetting flow does and a patch that
 * cleared absent keys would empty a story on the first partial save.
 */
export async function saveWorkspace(
  db: Database,
  input: { campaignId: string; actor: string; patch: WorkspacePatch },
): Promise<EvaluationResult> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(campaignWorkspace)
      .where(eq(campaignWorkspace.campaignId, input.campaignId))
      .for('update')
      .limit(1);

    if (!current) throw new Error(`no workspace for campaign ${input.campaignId}`);

    const { patch } = input;
    const now = new Date();
    const changes: Partial<typeof campaignWorkspace.$inferInsert> = {
      updatedBy: input.actor,
      updatedAt: now,
      lastSavedAt: now,
    };

    if (patch.resumeStep !== undefined) changes.resumeStep = patch.resumeStep;
    if (patch.brandNotes !== undefined) changes.brandNotes = patch.brandNotes;

    // Editing approved content revokes the approval. The approval was of the
    // text they read, not of the field it lived in (§12: "unapproved drafts…
    // do not count").
    const brandChanged =
      (patch.brandColors !== undefined && patch.brandColors !== current.brandColors) ||
      (patch.brandTypography !== undefined && patch.brandTypography !== current.brandTypography);

    if (patch.brandColors !== undefined) changes.brandColors = patch.brandColors;
    if (patch.brandTypography !== undefined) changes.brandTypography = patch.brandTypography;
    if (brandChanged) {
      changes.brandApprovedAt = null;
      changes.brandApprovedBy = null;
    }

    const storyChanged = patch.storyText !== undefined && patch.storyText !== current.storyText;
    if (patch.storyText !== undefined) changes.storyText = patch.storyText;
    if (storyChanged) {
      changes.storyApprovedAt = null;
      changes.storyApprovedBy = null;
    }

    // Approval is applied after the edit, so a request that both edits and
    // approves in one save approves what it just wrote rather than being
    // cancelled by its own revocation.
    if (patch.brandApproved !== undefined) {
      changes.brandApprovedAt = patch.brandApproved ? now : null;
      changes.brandApprovedBy = patch.brandApproved ? input.actor : null;
    }
    if (patch.storyApproved !== undefined) {
      changes.storyApprovedAt = patch.storyApproved ? now : null;
      changes.storyApprovedBy = patch.storyApproved ? input.actor : null;
    }

    await tx
      .update(campaignWorkspace)
      .set(changes)
      .where(eq(campaignWorkspace.campaignId, input.campaignId));

    return evaluateWorkspace(tx, {
      campaignId: input.campaignId,
      actor: input.actor,
      trigger: 'founder_save',
    });
  });
}

/* ── Admin invalidation and override (§12) ────────────────────────────────── */

export type ItemDecisionRefusal = 'locked' | 'not_found';

export type AdminItemResult =
  | { ok: true; result: EvaluationResult }
  | { ok: false; code: ItemDecisionRefusal; message: string };

/**
 * §12: "Admin may invalidate an item before payment with a reason; the Founder
 * can correct it."
 *
 * Before payment is the whole condition, so a locked item refuses and says why.
 * The reason and the customer-facing explanation are separate columns (§25.6),
 * and both are required by the database — an invalidation the Founder cannot
 * read is one they cannot correct.
 */
export async function invalidateItem(
  db: Database,
  input: {
    campaignId: string;
    item: OptionalItemKey;
    actor: string;
    reason: string;
    explanation: string;
  },
): Promise<AdminItemResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(campaignOptionalItems)
      .where(
        and(
          eq(campaignOptionalItems.campaignId, input.campaignId),
          eq(campaignOptionalItems.item, input.item),
        ),
      )
      .for('update')
      .limit(1);

    if (!row) return { ok: false as const, code: 'not_found' as const, message: 'No such item.' };
    if (row.lockedAt) {
      return {
        ok: false as const,
        code: 'locked' as const,
        message:
          'This campaign has paid its listing fee, so the evidence snapshot is fixed. §12 allows ' +
          'invalidation before payment only.',
      };
    }

    await tx
      .update(campaignOptionalItems)
      .set({
        complete: false,
        completedAt: null,
        decisionSource: null,
        invalidatedAt: new Date(),
        invalidatedReason: input.reason,
        invalidatedExplanation: input.explanation,
        invalidatedBy: input.actor,
        updatedBy: input.actor,
        updatedAt: new Date(),
      })
      .where(eq(campaignOptionalItems.id, row.id));

    const result = await evaluateWorkspace(tx, {
      campaignId: input.campaignId,
      actor: input.actor,
      trigger: 'admin_invalidated',
    });
    return { ok: true as const, result };
  });
}

/**
 * Clears an invalidation, so the item is decided by its evidence again.
 *
 * Deliberately not "mark complete". §12 gives Admin the power to invalidate and
 * gives the Founder the correction; an Admin who could hand out a completion
 * without evidence would be the self-assertion hole with a different actor.
 * `overrideItem` exists for the case §12 does name — a recorded manual override
 * — and it is a different function with a different decision source.
 */
export async function reinstateItem(
  db: Database,
  input: { campaignId: string; item: OptionalItemKey; actor: string; reason: string },
): Promise<AdminItemResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(campaignOptionalItems)
      .where(
        and(
          eq(campaignOptionalItems.campaignId, input.campaignId),
          eq(campaignOptionalItems.item, input.item),
        ),
      )
      .for('update')
      .limit(1);

    if (!row) return { ok: false as const, code: 'not_found' as const, message: 'No such item.' };
    if (row.lockedAt) {
      return {
        ok: false as const,
        code: 'locked' as const,
        message: 'This campaign has paid its listing fee, so the evidence snapshot is fixed.',
      };
    }

    await tx
      .update(campaignOptionalItems)
      .set({
        invalidatedAt: null,
        invalidatedReason: null,
        invalidatedExplanation: null,
        invalidatedBy: null,
        updatedBy: input.actor,
        updatedAt: new Date(),
      })
      .where(eq(campaignOptionalItems.id, row.id));

    const result = await evaluateWorkspace(tx, {
      campaignId: input.campaignId,
      actor: input.actor,
      trigger: `admin_reinstated:${input.reason}`,
    });
    return { ok: true as const, result };
  });
}

/**
 * §12: "A manual override requires prior value, new value, reason, actor, time,
 * and evidence."
 *
 * The override survives re-evaluation — `evaluateWorkspace` keeps an existing
 * `decision_source` on an item that stays complete — so an Admin who grants an
 * item for a reason the rules cannot see does not have it silently withdrawn by
 * the next autosave. It is visible as `admin_override` for the rest of the
 * campaign's life, in the item row and in the append-only history the trigger
 * wrote.
 */
export async function overrideItem(
  db: Database,
  input: {
    campaignId: string;
    item: OptionalItemKey;
    actor: string;
    complete: boolean;
    reason: string;
    explanation: string;
    evidence: Record<string, unknown>;
  },
): Promise<AdminItemResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(campaignOptionalItems)
      .where(
        and(
          eq(campaignOptionalItems.campaignId, input.campaignId),
          eq(campaignOptionalItems.item, input.item),
        ),
      )
      .for('update')
      .limit(1);

    if (!row) return { ok: false as const, code: 'not_found' as const, message: 'No such item.' };
    if (row.lockedAt) {
      return {
        ok: false as const,
        code: 'locked' as const,
        message: 'This campaign has paid its listing fee, so the evidence snapshot is fixed.',
      };
    }

    const now = new Date();
    await tx
      .update(campaignOptionalItems)
      .set({
        complete: input.complete,
        completedAt: input.complete ? now : null,
        decisionSource: input.complete ? 'admin_override' : null,
        evidence: { ...input.evidence, override: { reason: input.reason, by: input.actor } },
        rejections: input.complete ? [] : ['invalidated'],
        invalidatedAt: input.complete ? null : now,
        invalidatedReason: input.complete ? null : input.reason,
        invalidatedExplanation: input.complete ? null : input.explanation,
        invalidatedBy: input.complete ? null : input.actor,
        evaluatedAt: now,
        updatedBy: input.actor,
        updatedAt: now,
      })
      .where(eq(campaignOptionalItems.id, row.id));

    // The fee follows the record, so an override moves the quote immediately.
    const settled = await tx
      .select()
      .from(campaignOptionalItems)
      .where(eq(campaignOptionalItems.campaignId, input.campaignId));

    const completed = OPTIONAL_ITEM_KEYS.filter((key) =>
      settled.some((r) => r.item === key && r.complete),
    );

    const rows = await loadWorkspaceRows(tx, input.campaignId);

    const highEffort = await recordHighEffort(tx, {
      campaignId: input.campaignId,
      actor: input.actor,
      trigger: 'admin_override',
      visualsCompleted: completed.includes('visuals'),
      brandingCompleted: completed.includes('branding'),
      interviewScheduledOrConfirmed: interviewCountsForHighEffort(rows?.booking?.status ?? null),
    });

    const fee = await recordListingFee(tx, {
      campaignId: input.campaignId,
      actor: input.actor,
      trigger: 'admin_override',
      completed,
    });

    return {
      ok: true as const,
      result: { decisions: [], completed, highEffort, fee, locked: false },
    };
  });
}

/** The §12 history Admin reads: every decision on one campaign's items. */
export async function readItemHistory(db: Database, campaignId: string) {
  return db.execute(sql`
    SELECT * FROM optional_item_events
    WHERE campaign_id = ${campaignId}
    ORDER BY occurred_at DESC
  `);
}
