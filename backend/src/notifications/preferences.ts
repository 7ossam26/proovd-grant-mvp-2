/**
 * The digest preference — Spec §27.7, §30, §1.4 (Phase 22c).
 *
 * §27.7: "Backer selects preference at first magic-link visit; Founder/Affiliate
 * in settings." Three roles, three places, one record.
 *
 * ── "First visit" is the absence of a row, and it had to be ─────────────────
 * There is no first-visit concept anywhere in the product to hang this on.
 * `secure_tokens.last_used_at` is a *last*-seen, stamped on every successful
 * verification, and `mintOrReissueMagicLink` rotates the lineage on every later
 * confirmation — so the one timestamp that looks like a candidate is both the
 * wrong tense and destroyed by rotation.
 *
 * Building a first-visit marker would mean inventing a second read-state store
 * beside §20's, for the sole purpose of deciding whether to render one control.
 * The preference row already answers it: no row means nobody has been asked, or
 * has been asked and not answered, and in both cases the right thing is to ask.
 * `off` is an answer, and once it exists the product stops asking and shows the
 * choice instead. That is also why `off` is a stored value rather than the
 * absence of a row — §1.4's distinction between unknown and known, applied to a
 * consent.
 *
 * ── Nothing here can turn a digest on ──────────────────────────────────────
 * §30 forbids prechecked optional consent. `setDigestPreference` is the only
 * writer, it takes the frequency as a required argument, and there is no
 * default, no backfill, and no path that creates a row as a side effect of
 * anything else. A person who never chooses receives no digest forever, which
 * is the correct behaviour rather than a gap.
 */

import { and, eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { notificationDigestPreferences } from '../db/schema/digest.js';
import { notificationDigestPreferenceEvents } from '../db/schema/digest.js';
import {
  DIGEST_NEVER_REPLACES_TRANSACTIONAL,
  DIGEST_OPTION_LABELS,
  DIGEST_PREFERENCES,
  DIGEST_PROMPT_QUESTION,
  isDigestPreference,
  type DigestAudience,
  type DigestFrequency,
  type DigestPreference,
} from './digest-logic.js';

/** Who the preference belongs to. Exactly one subject, matching the audience. */
export type DigestSubject =
  | { audience: 'founder' | 'affiliate'; userId: string }
  | { audience: 'backer'; backerIdentityId: string };

export interface DigestPreferenceView {
  /** False means nobody has recorded an answer — §27.7's "first visit" state. */
  chosen: boolean;
  /** The recorded choice, or null when none has been made. Never a default. */
  frequency: DigestPreference | null;
  chosenAt: Date | null;
  /** Everything a surface needs to render the control without inventing copy. */
  question: string;
  options: { value: DigestPreference; label: string }[];
  /** §27.2 vs §27.7: what turning this off does and does not do. */
  transactionalNotice: string;
}

function subjectWhere(subject: DigestSubject) {
  return subject.audience === 'backer'
    ? eq(notificationDigestPreferences.backerIdentityId, subject.backerIdentityId)
    : and(
        eq(notificationDigestPreferences.userId, subject.userId),
        eq(notificationDigestPreferences.audience, subject.audience),
      );
}

const OPTIONS = DIGEST_PREFERENCES.map((value) => ({
  value,
  label: DIGEST_OPTION_LABELS[value],
}));

/**
 * The current preference, and everything needed to render the control.
 *
 * Returns `chosen: false` with a null frequency when no row exists. A surface
 * that treated that as `off` would be right about the sending and wrong about
 * the asking — and the asking is the whole of §27.7's second sentence.
 */
export async function readDigestPreference(
  db: Database,
  subject: DigestSubject,
): Promise<DigestPreferenceView> {
  const [row] = await db
    .select()
    .from(notificationDigestPreferences)
    .where(subjectWhere(subject))
    .limit(1);

  const frequency = row && isDigestPreference(row.frequency) ? row.frequency : null;

  return {
    chosen: Boolean(row),
    frequency,
    chosenAt: row?.chosenAt ?? null,
    question: DIGEST_PROMPT_QUESTION,
    options: OPTIONS,
    transactionalNotice: DIGEST_NEVER_REPLACES_TRANSACTIONAL,
  };
}

export type SetPreferenceResult =
  | { status: 'recorded'; frequency: DigestPreference }
  | { status: 'invalid_frequency'; permitted: readonly string[] };

/**
 * Record a person's choice. The only writer.
 *
 * The insert-or-update is a single statement so two tabs racing produce one row
 * and one history entry per real change; the trigger on the table writes the
 * history, so nothing here can forget it.
 */
export async function setDigestPreference(
  db: Database,
  subject: DigestSubject,
  frequency: string,
): Promise<SetPreferenceResult> {
  if (!isDigestPreference(frequency)) {
    return { status: 'invalid_frequency', permitted: DIGEST_PREFERENCES };
  }

  const values =
    subject.audience === 'backer'
      ? {
          audience: subject.audience,
          backerIdentityId: subject.backerIdentityId,
          frequency,
        }
      : { audience: subject.audience, userId: subject.userId, frequency };

  const target =
    subject.audience === 'backer'
      ? notificationDigestPreferences.backerIdentityId
      : notificationDigestPreferences.userId;

  await db
    .insert(notificationDigestPreferences)
    .values(values)
    .onConflictDoUpdate({
      target,
      // The unique indexes are PARTIAL (`WHERE … IS NOT NULL`, because exactly
      // one subject column is populated per row), and Postgres will not infer a
      // partial index as the arbiter without its predicate. Omitting this is a
      // 42P10 at runtime, not a compile error.
      targetWhere: sql`${target} is not null`,
      set: { frequency, updatedAt: sql`now()` },
    });

  return { status: 'recorded', frequency };
}

/** The recorded history of one person's choices. Insert-only, oldest first. */
export async function readPreferenceHistory(db: Database, subject: DigestSubject) {
  const [row] = await db
    .select({ id: notificationDigestPreferences.id })
    .from(notificationDigestPreferences)
    .where(subjectWhere(subject))
    .limit(1);
  if (!row) return [];

  return db
    .select()
    .from(notificationDigestPreferenceEvents)
    .where(eq(notificationDigestPreferenceEvents.preferenceId, row.id))
    .orderBy(notificationDigestPreferenceEvents.occurredAt);
}

/** Everyone who chose a given cadence. The sweep's own read. */
export async function listSubscribers(
  db: Database,
  frequency: DigestFrequency,
  audience: DigestAudience,
) {
  return db
    .select()
    .from(notificationDigestPreferences)
    .where(
      and(
        eq(notificationDigestPreferences.frequency, frequency),
        eq(notificationDigestPreferences.audience, audience),
      ),
    );
}
