/**
 * The Creator's recorded tone and channel figures — Creator Flow v2, Session C,
 * 2026-08-19.
 *
 * Screens 4 and 6 of the reference. Both records were built by Session A
 * (migration 0055) and neither had a reader until now; this is that reader and
 * that writer, and it adds no column and no constraint.
 *
 * ── Both records supersede rather than edit, and the trigger is why ─────────
 * `affiliate_voice_tones` and `affiliate_channel_metrics` are immutable by
 * trigger apart from `superseded_at`, which is itself write-once. So a change
 * is retire-then-insert inside one transaction — and the partial unique index
 * on the live row means the retire has to land BEFORE the insert or the second
 * row collides with the first. Every write here is in that order for that
 * reason, not as a style.
 *
 * Which answer was live when a Founder looked at somebody's card is a question
 * that may have to be answered later, and an UPDATE would have destroyed it.
 *
 * ── The service validates, because the browser is not the boundary ─────────
 * `creatorVoiceViolations` runs on the surface so a Creator reads one sentence
 * per problem. It runs again here over the same vocabulary — restated in
 * `creator-flow/logic.ts` and drift-tested — because a route is where a value
 * actually enters the record, and `lib/session.ts` has said since Phase 04 that
 * a client-side check buys a better error message and no authorization.
 *
 * ── A metric is refused unless the Creator's own subtype asks for it ────────
 * `AFFILIATE_SUBTYPE_DEFINITIONS` decides which of the nine ids each subtype
 * asks, and 0055's CHECK pins the id to the nine. What the CHECK cannot know is
 * WHOSE subtype: a podcast Creator posting `enrolled_students` would satisfy
 * the constraint and store a figure §5.3 never asks a podcaster for, which an
 * Admin would then be verifying against a question nobody put to them. So the
 * subtype is read from the record and the permitted set is derived from it.
 */

import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  affiliateChannelMetrics,
  affiliateVoiceTones,
} from '../db/schema/creator-flow.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import { campaignAffiliateAssociations } from '../db/schema/domain.js';
import { affiliateProspects } from '../db/schema/affiliates.js';
import {
  VOICE_TONE_IDS,
  VOICE_CUSTOM_MAX_COUNT,
  VOICE_CUSTOM_MAX_LENGTH,
  VOICE_MAX_TOTAL,
  CHANNEL_METRIC_IDS,
} from '../creator-flow/logic.js';
import { REQUIRED_EVIDENCE, type AffiliateSubtype } from './registry.js';
import { ensureSignupProfile } from './signup.js';

/**
 * The metrics one subtype asks for — the backend's half of shared's
 * `creatorChannelMetricsFor`.
 *
 * Derived from `REQUIRED_EVIDENCE` rather than listed, so there is no third
 * table of "which channel asks what" beside §5.3's own and shared's derivation
 * of it. `creator-flow.test.ts` drives all seven subtypes through both and
 * asserts they agree.
 */
export function permittedMetricsFor(subtype: string): readonly string[] {
  const evidence = REQUIRED_EVIDENCE[subtype as AffiliateSubtype] ?? [];
  return evidence.filter((id) => CHANNEL_METRIC_IDS.includes(id));
}

export interface CreatorVoiceState {
  tones: string[];
  customTones: string[];
  flexible: boolean;
  recordedAt: string | null;
}

export interface CreatorMetricsState {
  /** metric id → the Creator's own words. Absent means unanswered. */
  values: Record<string, string>;
  recordedAt: string | null;
}

export type CreatorProfileWriteResult =
  | { ok: true }
  | { ok: false; message: string; next: string };

/* ── Reads ────────────────────────────────────────────────────────────────── */

/**
 * The profile row id for an association, creating the row if it is absent.
 *
 * Ensure rather than read, for the reason `affiliate-invitation.ts` already
 * records on the payout route: a Creator who reaches this screen without having
 * typed into an earlier one has no profile row yet, and answering that with a
 * refusal would say "this link is broken" about a link that is fine. In
 * practice screens 2 and 3 have always saved by now — which is exactly the
 * ordering assumption not worth depending on.
 */
async function profileIdFor(db: Database, associationId: string): Promise<string | null> {
  await ensureSignupProfile(db, associationId, 'affiliate:invited');
  const [row] = await db
    .select({ id: affiliateSignupProfiles.id })
    .from(affiliateSignupProfiles)
    .where(eq(affiliateSignupProfiles.associationId, associationId))
    .limit(1);
  return row?.id ?? null;
}

export async function readCreatorVoice(
  db: Database,
  associationId: string,
): Promise<CreatorVoiceState> {
  const profileId = await profileIdFor(db, associationId);
  if (!profileId) return { tones: [], customTones: [], flexible: false, recordedAt: null };

  const [row] = await db
    .select()
    .from(affiliateVoiceTones)
    .where(
      and(
        eq(affiliateVoiceTones.profileId, profileId),
        isNull(affiliateVoiceTones.supersededAt),
      ),
    )
    .limit(1);

  if (!row) return { tones: [], customTones: [], flexible: false, recordedAt: null };
  return {
    tones: [...row.tones],
    customTones: [...row.customTones],
    flexible: row.flexible,
    recordedAt: row.recordedAt.toISOString(),
  };
}

export async function readCreatorMetrics(
  db: Database,
  associationId: string,
): Promise<CreatorMetricsState> {
  const profileId = await profileIdFor(db, associationId);
  if (!profileId) return { values: {}, recordedAt: null };

  const rows = await db
    .select()
    .from(affiliateChannelMetrics)
    .where(
      and(
        eq(affiliateChannelMetrics.profileId, profileId),
        isNull(affiliateChannelMetrics.supersededAt),
      ),
    );

  const values: Record<string, string> = {};
  let latest: Date | null = null;
  for (const row of rows) {
    values[row.metricId] = row.value;
    if (!latest || row.recordedAt > latest) latest = row.recordedAt;
  }
  return { values, recordedAt: latest ? latest.toISOString() : null };
}

/* ── Writes ───────────────────────────────────────────────────────────────── */

/**
 * Record a tone set, retiring whatever was live.
 *
 * The `flexible`-only case is a real answer and 0055's CHECK admits it on its
 * own: "these are what I default to, not what I am limited to" says something
 * even with no chip beside it.
 */
export async function recordCreatorVoice(
  db: Database,
  associationId: string,
  input: { tones: string[]; customTones: string[]; flexible: boolean; actor: string },
): Promise<CreatorProfileWriteResult> {
  const profileId = await profileIdFor(db, associationId);
  if (!profileId) {
    return {
      ok: false,
      message: 'This invitation is no longer available.',
      next: 'Nothing was saved.',
    };
  }

  const tones = [...new Set(input.tones)];
  const customTones = input.customTones.map((value) => value.trim()).filter((v) => v !== '');

  const unknown = tones.find((id) => !VOICE_TONE_IDS.includes(id));
  if (unknown !== undefined) {
    return {
      ok: false,
      message: 'One of those tones is not one we recognise.',
      next: 'Pick from the list, or add your own in the box below it. Nothing else was changed.',
    };
  }
  const tooLong = customTones.find((value) => value.length > VOICE_CUSTOM_MAX_LENGTH);
  if (tooLong !== undefined) {
    return {
      ok: false,
      message: `"${tooLong}" is longer than a tone should be.`,
      next: `Keep each one to ${VOICE_CUSTOM_MAX_LENGTH} characters or fewer. Nothing else was changed.`,
    };
  }
  if (customTones.length > VOICE_CUSTOM_MAX_COUNT) {
    return {
      ok: false,
      message: 'That is more tones of your own than we can show on your card.',
      next: `Keep it to ${VOICE_CUSTOM_MAX_COUNT}. Nothing else was changed.`,
    };
  }
  if (tones.length + customTones.length > VOICE_MAX_TOTAL) {
    return {
      ok: false,
      message: 'That is more tones than a Founder can read at a glance.',
      next: `Keep it to ${VOICE_MAX_TOTAL} in total. Nothing else was changed.`,
    };
  }
  if (tones.length === 0 && customTones.length === 0 && !input.flexible) {
    return {
      ok: false,
      message: 'That would record no answer at all.',
      next: 'Pick at least one tone, write your own, or say you are flexible.',
    };
  }

  await db.transaction(async (tx) => {
    // The retire lands FIRST. The partial unique index permits one live row per
    // profile, so an insert before the retire collides with the row it is
    // replacing — and the immutability trigger means there is no UPDATE path
    // that would have avoided the question.
    await tx
      .update(affiliateVoiceTones)
      .set({ supersededAt: new Date() })
      .where(
        and(
          eq(affiliateVoiceTones.profileId, profileId),
          isNull(affiliateVoiceTones.supersededAt),
        ),
      );

    await tx.insert(affiliateVoiceTones).values({
      profileId,
      tones,
      customTones,
      flexible: input.flexible,
      recordedBy: input.actor,
    });
  });

  return { ok: true };
}

/**
 * Record the channel figures a Creator's own subtype asks for.
 *
 * One row per metric, each superseded independently, because they are answered
 * independently — somebody correcting their subscriber count has not restated
 * their click-through rate, and folding them into one row would make every
 * correction look like a full re-declaration.
 */
export async function recordCreatorMetrics(
  db: Database,
  associationId: string,
  input: { values: Record<string, string>; actor: string },
): Promise<CreatorProfileWriteResult> {
  await ensureSignupProfile(db, associationId, input.actor);
  const [context] = await db
    .select({
      profileId: affiliateSignupProfiles.id,
      subtype: affiliateProspects.subtype,
    })
    .from(affiliateSignupProfiles)
    .innerJoin(
      campaignAffiliateAssociations,
      eq(campaignAffiliateAssociations.id, affiliateSignupProfiles.associationId),
    )
    .innerJoin(
      affiliateProspects,
      eq(affiliateProspects.id, campaignAffiliateAssociations.affiliateId),
    )
    .where(eq(affiliateSignupProfiles.associationId, associationId))
    .limit(1);

  if (!context) {
    return {
      ok: false,
      message: 'This invitation is no longer available.',
      next: 'Nothing was saved.',
    };
  }

  // §5.3 decides which figures this channel is asked for. A value outside that
  // set would satisfy 0055's CHECK and still be a question nobody put to this
  // Creator, which an Admin would then verify against.
  const permitted = new Set(permittedMetricsFor(context.subtype ?? ''));
  const entries = Object.entries(input.values);
  const stray = entries.find(([id]) => !permitted.has(id));
  if (stray) {
    return {
      ok: false,
      message: 'That is not something we ask for your kind of channel.',
      next: 'Nothing was saved. Reload the page to see what we do ask for.',
    };
  }

  const writes = entries
    .map(([id, value]) => [id, value.trim()] as const)
    .filter(([, value]) => value !== '');
  const cleared = entries.filter(([, value]) => value.trim() === '').map(([id]) => id);

  if (writes.length === 0 && cleared.length === 0) return { ok: true };

  await db.transaction(async (tx) => {
    const touched = [...writes.map(([id]) => id), ...cleared];
    await tx
      .update(affiliateChannelMetrics)
      .set({ supersededAt: new Date() })
      .where(
        and(
          eq(affiliateChannelMetrics.profileId, context.profileId),
          isNull(affiliateChannelMetrics.supersededAt),
          inArray(affiliateChannelMetrics.metricId, touched),
        ),
      );

    // A cleared field retires its row and inserts nothing: 0055 requires a
    // non-blank value, so "I would rather not say" is the ABSENCE of a live row
    // rather than an empty one. §16a's rule — unanswered is not zero.
    if (writes.length > 0) {
      await tx.insert(affiliateChannelMetrics).values(
        writes.map(([metricId, value]) => ({
          profileId: context.profileId,
          metricId,
          value,
          recordedBy: input.actor,
        })),
      );
    }
  });

  return { ok: true };
}
