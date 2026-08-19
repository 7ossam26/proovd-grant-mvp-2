/**
 * The Founder's fixed-payment openness — Founder Flow v2, Session F, 2026-08-19.
 *
 * Session A built the record (migration 0052) and no service; this is the one
 * writer, and the one read the screen renders.
 *
 * ── What it is, and the five things it is not ───────────────────────────────
 * §16 makes the optional fixed Creator payment the CREATOR's request, accepted
 * bilaterally through one §14.2 proposal version. What a Founder states during
 * onboarding — before the listing fee is even paid, before any Creator has been
 * approached — is an OPENNESS. It is not an offer, not a default, not a
 * percentage, not an amount, and not a proposal version, and the table has no
 * column for any of them: the absence is what keeps this from becoming the
 * §1 rule 6 violation it would otherwise be.
 *
 * ── The database refuses an Idea campaign twice, and so does this ───────────
 * §14.3 prohibits the fixed Creator payment on an Idea Campaign. 0052 pins the
 * stored type to `pre_launch` by CHECK, and a shape trigger requires that type
 * to be the campaign's OWN — without the trigger the CHECK is satisfiable by
 * writing `pre_launch` onto an Idea campaign and enforces nothing. This service
 * refuses first, by name, so a Founder reads a sentence rather than a
 * constraint; the database refuses regardless of who is calling.
 *
 * ── Superseded, never edited ────────────────────────────────────────────────
 * An answer somebody changed their mind about is two facts, and which one was
 * live when a Creator was approached is a question that may have to be answered
 * later. `recordOpenness` retires the live row and inserts a new one in one
 * transaction; a partial unique index makes a second live answer the database's
 * refusal rather than a service that counted first.
 */

import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns } from '../db/schema/domain.js';
import { founderFixedPaymentOpenness } from '../db/schema/creator-payment.js';
import { readCompensationSettings } from '../affiliates/decisions.js';
import type { AuditWriter } from '../auth/audit.js';

type Executor = Pick<Database, 'select' | 'insert' | 'update' | 'execute' | 'transaction'>;

/**
 * §14.3's three answers, restated.
 *
 * The backend cannot import `@proovd/shared` at runtime — it compiles under
 * `rootDir: src` and the production image ships only `backend/dist` — so the
 * vocabulary is restated here and drift-tested against `FIXED_PAYMENT_STANCES`,
 * the arrangement the state enums, the §6 settings and the §27 keys all use.
 */
export type FixedPaymentStance = 'open' | 'not_open' | 'undecided';

export const OPENNESS_STANCES: readonly FixedPaymentStance[] = ['open', 'not_open', 'undecided'];

export interface OpennessView {
  /**
   * Whether this campaign can hold an answer at all.
   *
   * False for an Idea Campaign, and the screen renders §14.3's explanation with
   * no control — the absence of the control IS the rule (§1.4).
   */
  applicable: boolean;
  campaignType: 'pre_build' | 'pre_launch';
  /** The live answer, or null when nobody has been asked yet. */
  stance: FixedPaymentStance | null;
  recordedAt: string | null;
  /**
   * §14.3's two base percentages, from the §6 settings in force.
   *
   * Read rather than written: Phase 06's rule is that a hardcoded number is a
   * bug even when it is right, and these are the two numbers the screen is
   * about.
   */
  standardBasePercent: number;
  withFixedBasePercent: number;
}

export type RecordOpennessResult =
  | { ok: true; view: OpennessView }
  | { ok: false; code: 'not_found' | 'idea_campaign' | 'unknown_stance' | 'type_not_locked'; message: string };

async function loadCampaign(
  db: Executor,
  campaignId: string,
): Promise<{ id: string; type: 'pre_build' | 'pre_launch' | null } | null> {
  const [row] = await db
    .select({ id: campaigns.id, type: campaigns.type })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  return row ? { id: row.id, type: row.type } : null;
}

async function liveAnswer(
  db: Executor,
  campaignId: string,
): Promise<{ stance: FixedPaymentStance; recordedAt: Date } | null> {
  const [row] = await db
    .select({
      stance: founderFixedPaymentOpenness.stance,
      recordedAt: founderFixedPaymentOpenness.recordedAt,
    })
    .from(founderFixedPaymentOpenness)
    .where(
      and(
        eq(founderFixedPaymentOpenness.campaignId, campaignId),
        isNull(founderFixedPaymentOpenness.supersededAt),
      ),
    )
    .orderBy(desc(founderFixedPaymentOpenness.recordedAt))
    .limit(1);
  return row ? { stance: row.stance as FixedPaymentStance, recordedAt: row.recordedAt } : null;
}

export async function readOpenness(
  db: Executor,
  campaignId: string,
): Promise<OpennessView | null> {
  const campaign = await loadCampaign(db, campaignId);
  if (!campaign || !campaign.type) return null;

  const settings = await readCompensationSettings(db);
  const live = campaign.type === 'pre_launch' ? await liveAnswer(db, campaignId) : null;

  return {
    applicable: campaign.type === 'pre_launch',
    campaignType: campaign.type,
    stance: live?.stance ?? null,
    recordedAt: live?.recordedAt.toISOString() ?? null,
    standardBasePercent: settings.standardBasePercent,
    withFixedBasePercent: settings.withFixedBasePercent,
  };
}

export async function recordOpenness(
  db: Database,
  audit: AuditWriter,
  input: { campaignId: string; stance: string; actor: string },
): Promise<RecordOpennessResult> {
  if (!OPENNESS_STANCES.includes(input.stance as FixedPaymentStance)) {
    return {
      ok: false,
      code: 'unknown_stance',
      message: 'That is not one of the three answers this screen offers.',
    };
  }

  const campaign = await loadCampaign(db, input.campaignId);
  if (!campaign) {
    return { ok: false, code: 'not_found', message: 'We could not find that campaign.' };
  }
  if (!campaign.type) {
    // §9 locks the type at submission. A stance recorded against an unlocked
    // type could later find itself attached to an Idea campaign.
    return {
      ok: false,
      code: 'type_not_locked',
      message: 'Your campaign type is not settled yet, so there is nothing to be open about.',
    };
  }
  if (campaign.type !== 'pre_launch') {
    // §14.3, refused by name here and by CHECK and trigger regardless.
    return {
      ok: false,
      code: 'idea_campaign',
      message:
        'On an Idea Campaign there is no fixed Creator payment to be open to, so there is nothing to record.',
    };
  }

  const stance = input.stance as FixedPaymentStance;

  await db.transaction(async (tx) => {
    // Retire the live answer first: the partial unique index is what refuses a
    // second one, so superseding is what makes room rather than a nicety.
    await tx
      .update(founderFixedPaymentOpenness)
      .set({ supersededAt: new Date() })
      .where(
        and(
          eq(founderFixedPaymentOpenness.campaignId, input.campaignId),
          isNull(founderFixedPaymentOpenness.supersededAt),
        ),
      );

    await tx.insert(founderFixedPaymentOpenness).values({
      campaignId: input.campaignId,
      stance,
      campaignType: campaign.type as string,
      recordedBy: input.actor,
    });
  });

  await audit({
    action: 'campaign.fixed_payment_openness_recorded',
    targetType: 'campaign',
    targetId: input.campaignId,
    internalReason: `the Founder recorded that they are ${stance.replace('_', ' ')} to funding an optional fixed Creator payment`,
    newValue: { stance } as unknown as Record<string, unknown>,
  });

  const view = await readOpenness(db, input.campaignId);
  return { ok: true, view: view! };
}

/** Every answer this campaign has held, newest first — the Admin read. */
export async function readOpennessHistory(
  db: Executor,
  campaignId: string,
): Promise<Array<{ stance: FixedPaymentStance; recordedBy: string; recordedAt: Date; supersededAt: Date | null }>> {
  const rows = await db
    .select({
      stance: founderFixedPaymentOpenness.stance,
      recordedBy: founderFixedPaymentOpenness.recordedBy,
      recordedAt: founderFixedPaymentOpenness.recordedAt,
      supersededAt: founderFixedPaymentOpenness.supersededAt,
    })
    .from(founderFixedPaymentOpenness)
    .where(eq(founderFixedPaymentOpenness.campaignId, campaignId))
    .orderBy(desc(founderFixedPaymentOpenness.recordedAt));
  return rows.map((row) => ({
    stance: row.stance as FixedPaymentStance,
    recordedBy: row.recordedBy,
    recordedAt: row.recordedAt,
    supersededAt: row.supersededAt,
  }));
}
