/**
 * Live editing — Spec §20, §15, §33.6.12 (Phase 17b).
 *
 * §20 gives a live campaign three tiers of change, and this module is the one
 * door all three go through.
 *
 * ── The tier is a property of the field, not of the Founder's opinion ───────
 * §15 makes materiality "an Admin judgement recorded with its reason", and 12b's
 * `recordMaterialChange` was deliberately built to *take* a classification rather
 * than guess one. So nothing here asks the Founder what kind of change they are
 * making: `tierFor` looks the field up in the §20 register and the answer decides
 * which of three things happens.
 *
 *   direct_versioned  → written now, with a `campaign_live_edits` row carrying
 *                       prior and new value. §20's "with version history".
 *   requires_review   → refused, and a `campaign_change_requests` row is opened
 *                       for Admin. The Founder cannot apply it. §33.6.12.
 *   never_direct      → refused outright, with the reason. There is no request
 *                       path either — §20's third column is not a slower second
 *                       column, it is a different answer.
 *
 * ── Materiality is not rebuilt ──────────────────────────────────────────────
 * The phase trap: "Don't rebuild materiality. Phase 12 owns it." Applying an
 * approved request calls `recordMaterialChange` unchanged, which versions the
 * change, invalidates the affected Creators' readiness, and creates one
 * reacceptance task each. This module writes the new value and nothing else.
 *
 * ── The FAQ loophole ────────────────────────────────────────────────────────
 * §20: "An FAQ cannot silently change a promise locked elsewhere." An FAQ answer
 * is a column-one field, so without a check it would be the one unreviewed path
 * to every promise in column two. `commitmentsIn` finds commitment-shaped text
 * and the edit is redirected to a change request — §20's own destination for a
 * change to a promise, not a refusal invented here.
 */

import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns } from '../db/schema/domain.js';
import { campaignBuild, campaignFaqs, campaignRewardPackages } from '../db/schema/build.js';
import {
  campaignLiveEdits,
  campaignChangeRequests,
  type CampaignLiveEdit,
  type CampaignChangeRequest,
} from '../db/schema/live-editing.js';
import type { AuditWriter } from '../auth/audit.js';
import { recordMaterialChange } from './materiality.js';
import {
  tierFor,
  commitmentsIn,
  type EditSurface,
  type EditTier,
} from './editing-logic.js';

/** §20 applies these rules from launch. Before launch the build save owns edits. */
const LIVE_STATUSES = ['live'] as const;

/** The columns each surface actually stores, so a field name maps to a table. */
const BUILD_COLUMNS: Record<string, string> = {
  communityUrl: 'community_url',
  brandPerception: 'brand_perception',
  brandVoice: 'brand_voice',
  heroPreference: 'hero_preference',
  founderProfileUrl: 'founder_profile_url',
};

export type LiveEditOutcome =
  | { ok: true; tier: 'direct_versioned'; edit: CampaignLiveEdit }
  | {
      ok: true;
      tier: 'requires_review';
      request: CampaignChangeRequest;
      /** Named when an FAQ edit was redirected here by the §20 loophole check. */
      redirectedBy: 'faq_commitment' | null;
      commitments: string[];
    }
  | {
      ok: false;
      code: 'never_direct' | 'not_live' | 'unknown_field' | 'not_found' | 'request_open' | 'invalid_value';
      message: string;
      next: string;
    };

/**
 * Applies one live edit, or routes it.
 *
 * `campaignStatus` is passed rather than re-read so that one view of the campaign
 * decides — the Founder home and this path disagreeing about whether a campaign
 * is live would produce an edit that succeeded on a campaign the surface showed
 * as suspended.
 */
export async function applyLiveEdit(
  db: Database,
  deps: { audit: AuditWriter },
  input: {
    campaignId: string;
    campaignStatus: string;
    surface: EditSurface;
    field: string;
    /** The new value. Strings for text fields; the caller does no coercion. */
    value: unknown;
    /** The FAQ row or reward package being edited, where the surface has rows. */
    targetId?: string | undefined;
    /** Required when the edit routes to review — §15 records a reason. */
    reason?: string | undefined;
    actor: string;
  },
): Promise<LiveEditOutcome> {
  if (!(LIVE_STATUSES as readonly string[]).includes(input.campaignStatus)) {
    return {
      ok: false,
      code: 'not_live',
      message: 'These rules apply while a campaign is live. This one is not.',
      next: 'Edit it from your campaign build, where the whole build is still open to you.',
    };
  }

  let definition;
  try {
    definition = tierFor(input.surface, input.field);
  } catch {
    return {
      ok: false,
      code: 'unknown_field',
      message: 'That field cannot be edited while the campaign is live.',
      next: 'Contact support and tell us what you are trying to change.',
      };
  }

  /* ── Column 3: not a slower column 2. A different answer. ────────────────── */
  if (definition.tier === 'never_direct') {
    await deps.audit({
      action: 'live_edit.refused_never_direct',
      targetType: 'campaign',
      targetId: input.campaignId,
      internalReason: `§20 column 3: ${input.surface}.${input.field} cannot be changed directly. ${definition.reason}`,
      actorId: input.actor,
    });
    return {
      ok: false,
      code: 'never_direct',
      message: `${definition.label} cannot be changed once the campaign is running. ${definition.reason}`,
      next: 'Nothing has changed. If something is genuinely wrong here, contact support.',
    };
  }

  const current = await readCurrentValue(db, {
    campaignId: input.campaignId,
    surface: input.surface,
    field: input.field,
    ...(input.targetId ? { targetId: input.targetId } : {}),
  });
  if (current === undefined) {
    return {
      ok: false,
      code: 'not_found',
      message: 'We could not find what you are trying to edit.',
      next: 'Reload the page. Nothing has changed.',
    };
  }

  /* ── The §20 FAQ loophole ────────────────────────────────────────────────── */
  let redirectedBy: 'faq_commitment' | null = null;
  let commitments: string[] = [];
  if (definition.tier === 'direct_versioned' && input.surface === 'faq' && input.field === 'answer') {
    commitments = commitmentsIn(String(input.value ?? ''));
    if (commitments.length > 0) redirectedBy = 'faq_commitment';
  }

  const effectiveTier: EditTier =
    redirectedBy === null ? definition.tier : ('requires_review' as const);

  /* ── Column 2: a request, never a change ─────────────────────────────────── */
  if (effectiveTier === 'requires_review') {
    const reason = (input.reason ?? '').trim();
    if (!reason) {
      return {
        ok: false,
        code: 'invalid_value',
        message:
          redirectedBy === 'faq_commitment'
            ? `That answer states a ${commitments.join(' and a ')}, so it changes a promise rather than clarifying one. Tell us why you are changing it and a reviewer will look.`
            : 'A change to this needs a reason a reviewer can read.',
        next: 'Nothing you typed was lost.',
      };
    }

    try {
      const [request] = await db
        .insert(campaignChangeRequests)
        .values({
          campaignId: input.campaignId,
          surface: input.surface,
          field: input.field,
          targetId: input.targetId ?? null,
          currentValue: current as never,
          requestedValue: (input.value ?? null) as never,
          reason,
          requestedBy: input.actor,
        })
        .returning();

      await deps.audit({
        action: 'live_edit.change_requested',
        targetType: 'campaign',
        targetId: input.campaignId,
        internalReason:
          `§20 column 2: ${input.surface}.${input.field} routed to review` +
          (redirectedBy ? ` (FAQ commitment: ${commitments.join(', ')})` : '') +
          `. Founder reason: ${reason}`,
        priorValue: current,
        newValue: input.value,
        actorId: input.actor,
      });

      return { ok: true, tier: 'requires_review', request: request!, redirectedBy, commitments };
    } catch (error) {
      if (isUniqueViolation(error)) {
        return {
          ok: false,
          code: 'request_open',
          message: 'You already have a request open for this. A reviewer is looking at it.',
          next: 'Wait for the decision, or contact support to change what you asked for.',
        };
      }
      throw error;
    }
  }

  /* ── Column 1: written now, with version history ─────────────────────────── */
  const edit = await db.transaction(async (tx) => {
    await writeValue(tx, {
      campaignId: input.campaignId,
      surface: input.surface,
      field: input.field,
      value: input.value,
      ...(input.targetId ? { targetId: input.targetId } : {}),
      actor: input.actor,
    });

    const [row] = await tx
      .insert(campaignLiveEdits)
      .values({
        campaignId: input.campaignId,
        surface: input.surface,
        field: input.field,
        priorValue: current as never,
        newValue: (input.value ?? null) as never,
        targetId: input.targetId ?? null,
        actor: input.actor,
      })
      .returning();
    return row!;
  });

  await deps.audit({
    action: 'live_edit.applied',
    targetType: 'campaign',
    targetId: input.campaignId,
    internalReason: `§20 column 1: ${input.surface}.${input.field} edited directly while live`,
    priorValue: current,
    newValue: input.value,
    actorId: input.actor,
  });

  return { ok: true, tier: 'direct_versioned', edit };
}

/* ── Reading and writing one field ─────────────────────────────────────────── */

type Executor = Pick<Database, 'select' | 'insert' | 'update' | 'execute'>;

/**
 * The stored value, read from the row.
 *
 * Never taken from the caller. 16a's rule: a caller that supplies both halves of
 * a before/after pair can supply a flattering pair, and the version history is
 * worth nothing if the "before" is whatever the request said it was.
 */
async function readCurrentValue(
  db: Executor,
  input: { campaignId: string; surface: EditSurface; field: string; targetId?: string | undefined },
): Promise<unknown> {
  if (input.surface === 'build') {
    const [row] = await db
      .select()
      .from(campaignBuild)
      .where(eq(campaignBuild.campaignId, input.campaignId))
      .limit(1);
    if (!row) return undefined;
    const value = (row as unknown as Record<string, unknown>)[input.field];
    return value instanceof Date ? value.toISOString() : (value ?? null);
  }

  if (input.surface === 'faq') {
    if (!input.targetId) return undefined;
    const [row] = await db
      .select()
      .from(campaignFaqs)
      .where(and(eq(campaignFaqs.id, input.targetId), eq(campaignFaqs.campaignId, input.campaignId)))
      .limit(1);
    if (!row) return undefined;
    return (row as unknown as Record<string, unknown>)[input.field] ?? null;
  }

  if (input.surface === 'reward_package') {
    if (!input.targetId) return undefined;
    const [row] = await db
      .select()
      .from(campaignRewardPackages)
      .where(
        and(
          eq(campaignRewardPackages.id, input.targetId),
          eq(campaignRewardPackages.campaignId, input.campaignId),
        ),
      )
      .limit(1);
    if (!row) return undefined;
    const value = (row as unknown as Record<string, unknown>)[input.field];
    return typeof value === 'bigint' ? value.toString() : (value ?? null);
  }

  if (input.surface === 'campaign') {
    const [row] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, input.campaignId))
      .limit(1);
    if (!row) return undefined;
    return (row as unknown as Record<string, unknown>)[input.field] ?? null;
  }

  // `reservation` and `agreement` are column-three surfaces and never reach a
  // write path; they are in the register so the absence is checkable.
  return undefined;
}

/**
 * Writes one column-one field.
 *
 * Only the two surfaces column one actually contains — a `build` field or an FAQ
 * row. There is no branch here for a reward package, a reservation, or an
 * agreement, because none of their fields is in column one, and a branch that
 * existed would be one a later change could reach.
 */
async function writeValue(
  db: Executor,
  input: {
    campaignId: string;
    surface: EditSurface;
    field: string;
    value: unknown;
    targetId?: string | undefined;
    actor: string;
  },
): Promise<void> {
  if (input.surface === 'build') {
    const column = BUILD_COLUMNS[input.field];
    if (!column) {
      throw new Error(`no column-one build column is mapped for "${input.field}"`);
    }
    await db
      .update(campaignBuild)
      .set({
        [input.field]: input.value === null ? null : String(input.value).slice(0, 20_000),
        updatedAt: new Date(),
        updatedBy: input.actor,
      } as never)
      .where(eq(campaignBuild.campaignId, input.campaignId));
    return;
  }

  if (input.surface === 'faq' && input.targetId) {
    await db
      .update(campaignFaqs)
      .set({ [input.field]: String(input.value ?? '').slice(0, 20_000) } as never)
      .where(
        and(eq(campaignFaqs.id, input.targetId), eq(campaignFaqs.campaignId, input.campaignId)),
      );
    return;
  }

  throw new Error(`§20 column one has no write path for ${input.surface}.${input.field}`);
}

/* ── Admin decides a change request (§15, §20) ─────────────────────────────── */

export type DecideRequestOutcome =
  | { ok: true; request: CampaignChangeRequest; materialChangeId: string | null }
  | { ok: false; code: 'not_found' | 'already_decided' | 'invalid_value'; message: string };

/**
 * Admin applies or declines a Founder's column-two request.
 *
 * Applying is two things in one transaction-shaped sequence: write the new value,
 * then record it through §15's machine with Admin's classification and the
 * affected Creators. The classification is passed in — this module never guesses
 * it (§1 rule 6), and `recordMaterialChange` is unchanged from 12b.
 */
export async function decideChangeRequest(
  db: Database,
  deps: { audit: AuditWriter },
  input: {
    requestId: string;
    decision: 'applied' | 'declined';
    /** Admin's §15 judgement. Required when applying. */
    classification?: 'material' | 'non_material' | undefined;
    affectedCreators?: string[] | undefined;
    decisionReason: string;
    actor: string;
  },
): Promise<DecideRequestOutcome> {
  const reason = input.decisionReason.trim();
  if (!reason) {
    return {
      ok: false,
      code: 'invalid_value',
      message: 'A decision records why it was made.',
    };
  }
  if (input.decision === 'applied' && !input.classification) {
    return {
      ok: false,
      code: 'invalid_value',
      message:
        'Applying a change records whether it is material to Creator terms. §15 makes that a recorded judgement, not an assumption.',
    };
  }

  const [request] = await db
    .select()
    .from(campaignChangeRequests)
    .where(eq(campaignChangeRequests.id, input.requestId))
    .limit(1);
  if (!request) {
    return { ok: false, code: 'not_found', message: 'That request was not found.' };
  }
  if (request.status !== 'open') {
    return { ok: false, code: 'already_decided', message: 'That request was already decided.' };
  }

  if (input.decision === 'declined') {
    const [updated] = await db
      .update(campaignChangeRequests)
      .set({
        status: 'declined',
        decidedBy: input.actor,
        decidedAt: new Date(),
        decisionReason: reason,
      })
      .where(
        and(
          eq(campaignChangeRequests.id, request.id),
          eq(campaignChangeRequests.status, 'open'),
        ),
      )
      .returning();

    await deps.audit({
      action: 'live_edit.change_declined',
      targetType: 'campaign',
      targetId: request.campaignId,
      internalReason: `§20 change request declined: ${reason}`,
      priorValue: request.currentValue,
      newValue: request.requestedValue,
      actorId: input.actor,
    });
    return { ok: true, request: updated!, materialChangeId: null };
  }

  // Apply: write the value, then hand it to §15's machine unchanged.
  await db.transaction(async (tx) => {
    await applyRequestedValue(tx, request);
  });

  const recorded = await recordMaterialChange(db, deps, {
    campaignId: request.campaignId,
    classification: input.classification!,
    reason: `${reason} (Founder asked: ${request.reason})`,
    affectedFields: [request.field],
    beforeValue: request.currentValue,
    afterValue: request.requestedValue,
    ...(input.affectedCreators ? { affectedCreators: input.affectedCreators } : {}),
    actor: input.actor,
  });

  const [updated] = await db
    .update(campaignChangeRequests)
    .set({
      status: 'applied',
      decidedBy: input.actor,
      decidedAt: new Date(),
      decisionReason: reason,
      materialChangeId: recorded.change.id,
    })
    .where(
      and(eq(campaignChangeRequests.id, request.id), eq(campaignChangeRequests.status, 'open')),
    )
    .returning();

  return { ok: true, request: updated!, materialChangeId: recorded.change.id };
}

async function applyRequestedValue(
  db: Executor,
  request: CampaignChangeRequest,
): Promise<void> {
  const value = request.requestedValue;

  if (request.surface === 'build') {
    const set: Record<string, unknown> = { updatedAt: new Date(), updatedBy: 'admin:review' };
    if (request.field === 'opensAt' || request.field === 'closesAt') {
      set[request.field] = value ? new Date(String(value)) : null;
    } else if (request.field === 'refundPolicyEffectiveDate') {
      set[request.field] = value ?? null;
    } else {
      set[request.field] = value === null ? null : String(value);
    }
    await db.update(campaignBuild).set(set as never).where(eq(campaignBuild.campaignId, request.campaignId));
    return;
  }

  if (request.surface === 'reward_package' && request.targetId) {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    set[request.field] =
      request.field === 'priceCents' ? BigInt(String(value)) : String(value ?? '');
    await db
      .update(campaignRewardPackages)
      .set(set as never)
      .where(eq(campaignRewardPackages.id, request.targetId));
    return;
  }

  if (request.surface === 'faq' && request.targetId) {
    await db
      .update(campaignFaqs)
      .set({ [request.field]: String(value ?? '') } as never)
      .where(eq(campaignFaqs.id, request.targetId));
    return;
  }

  throw new Error(
    `no apply path for ${request.surface}.${request.field} — column three has none by design`,
  );
}

/* ── Reads ─────────────────────────────────────────────────────────────────── */

export async function listLiveEdits(
  db: Database,
  campaignId: string,
): Promise<CampaignLiveEdit[]> {
  return db
    .select()
    .from(campaignLiveEdits)
    .where(eq(campaignLiveEdits.campaignId, campaignId))
    .orderBy(sql`${campaignLiveEdits.occurredAt} desc`);
}

export async function listChangeRequests(
  db: Database,
  input: { campaignId?: string | undefined; status?: string | undefined },
): Promise<CampaignChangeRequest[]> {
  const filters = [
    ...(input.campaignId ? [eq(campaignChangeRequests.campaignId, input.campaignId)] : []),
    ...(input.status ? [eq(campaignChangeRequests.status, input.status)] : []),
  ];
  return db
    .select()
    .from(campaignChangeRequests)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(campaignChangeRequests.createdAt);
}

/** Drizzle wraps the driver error, so the 23505 check walks `cause` (09a). */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (
      typeof current === 'object' &&
      'code' in current &&
      (current as { code?: string }).code === '23505'
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
