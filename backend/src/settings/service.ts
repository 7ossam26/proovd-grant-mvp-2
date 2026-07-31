/**
 * Reading and changing the §6 operating constants.
 *
 * Everything downstream of Phase 06 reads its fees, windows, percentages, and
 * schedules through here. Phase 06's own rule: "constants live in
 * configuration, not in code — a hardcoded duration is a bug even when the
 * number is right."
 *
 * ── What this module owns, and what the database owns ───────────────────────
 * The database owns what cannot be left to a caller: identity immutability,
 * version increment, the history row, and the refusal to edit a `derived`
 * value (migration 0004). This module owns what the database cannot see —
 * validation against the row's own bounds, and the §25.6 audit row carrying the
 * actor's MFA and reauthentication context.
 *
 * Both records are written in one transaction, so a settings change either
 * lands with its history *and* its audit event, or does not land.
 *
 * ── No register import ──────────────────────────────────────────────────────
 * `shared/src/settings/registry.ts` seeded these rows and the Admin surface
 * renders it, but nothing here reads it: the backend cannot import
 * `@proovd/shared` at runtime (see `db/schema/settings.ts`). Every fact needed
 * to validate a change is a column on the row being changed.
 */

import { asc, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { appSettings, appSettingVersions } from '../db/schema/settings.js';
import { auditEvents } from '../db/schema/integrity.js';
import {
  parseValue,
  canonicalise,
  type SettingKind,
  type SettingProvenance,
  type SettingValue,
} from './values.js';

export interface StoredSetting {
  key: string;
  value: string | null;
  kind: SettingKind;
  provenance: SettingProvenance;
  minimum: number | null;
  maximum: number | null;
  specRef: string;
  version: number;
  updatedBy: string;
  updateReason: string;
  updatedAt: Date;
}

export interface SettingRow extends StoredSetting {
  /** The parsed value, or `null` while the setting has never been stated. */
  parsed: SettingValue | null;
  /** `derived` values follow a committed artifact and are not edited (§29.6). */
  editable: boolean;
}

/** Raised when a caller asks for a setting that does not exist. */
export class SettingNotRegistered extends Error {
  constructor(key: string) {
    super(
      `setting "${key}" does not exist — the §6 register and migration 0004 have ` +
        `drifted; do not paper over it in application code`,
    );
    this.name = 'SettingNotRegistered';
  }
}

/** Raised when a caller asks for a setting that has never been given a value. */
export class SettingNotConfigured extends Error {
  constructor(key: string) {
    super(
      `setting "${key}" has no value. §6 names it and fixes no number, so an ` +
        `operator must state one before anything may read it.`,
    );
    this.name = 'SettingNotConfigured';
  }
}

const COLUMNS = {
  key: appSettings.key,
  value: appSettings.value,
  kind: appSettings.kind,
  provenance: appSettings.provenance,
  minimum: appSettings.minimum,
  maximum: appSettings.maximum,
  specRef: appSettings.specRef,
  version: appSettings.version,
  updatedBy: appSettings.updatedBy,
  updateReason: appSettings.updateReason,
  updatedAt: appSettings.updatedAt,
};

/* ── Reading ──────────────────────────────────────────────────────────────── */

/**
 * Every setting, ordered by key.
 *
 * The Admin surface groups and orders these from the shared register, which it
 * imports directly. Serving a stable alphabetical order here keeps the response
 * independent of insertion order, so re-running a migration cannot reshuffle a
 * page.
 */
export async function readSettings(db: Database): Promise<SettingRow[]> {
  const rows = await db.select(COLUMNS).from(appSettings).orderBy(asc(appSettings.key));

  return rows.map((row) => {
    const parsed = row.value === null ? null : parseValue(row, row.value);
    return {
      ...row,
      parsed: parsed && parsed.ok ? parsed.value : null,
      editable: row.provenance !== 'derived',
    };
  });
}

/**
 * One typed value. Throws rather than returning a fallback: a caller that
 * silently continues on an unconfigured commercial rule is the failure §6's
 * fail-closed instruction exists to prevent.
 */
export async function readSettingValue(db: Database, key: string): Promise<SettingValue> {
  const [row] = await db.select(COLUMNS).from(appSettings).where(eq(appSettings.key, key)).limit(1);

  if (!row) throw new SettingNotRegistered(key);
  if (row.value === null) throw new SettingNotConfigured(key);

  const parsed = parseValue(row, row.value);
  if (!parsed.ok) {
    throw new SettingNotRegistered(`${key} (stored value does not parse: ${parsed.message})`);
  }
  return parsed.value;
}

/**
 * The Admin reauthentication window, for `requireFreshSession`.
 *
 * Returns `null` when unset, and the guard blocks on `null`. §6 names the
 * setting and fixes no number; a guard that invents one has invented a security
 * policy.
 */
export async function readAdminReauthWindowSeconds(db: Database): Promise<number | null> {
  try {
    const value = await readSettingValue(db, 'admin_reauth_window_seconds');
    return typeof value === 'number' ? value : null;
  } catch {
    return null;
  }
}

/**
 * The keys §6 requires a value for that have none.
 *
 * A whitespace-only value counts as unset — a space is not a stated commercial
 * rule. Empty means nothing blocks.
 */
export async function readMissingRequiredSettings(db: Database): Promise<string[]> {
  const rows = await db
    .select({ key: appSettings.key, value: appSettings.value })
    .from(appSettings)
    .orderBy(asc(appSettings.key));

  return rows.filter((r) => r.value === null || r.value.trim() === '').map((r) => r.key);
}

/* ── Changing ─────────────────────────────────────────────────────────────── */

export interface UpdateSettingInput {
  key: string;
  /** The new value as text. Validated against the row's bounds before it lands. */
  value: string;
  /** `user:<id>` of the Admin making the change. */
  actor: string;
  /** §25.6 internal reason. Required — the database will not accept a blank. */
  reason: string;
  mfaContext?: string | null;
  reauthContext?: string | null;
}

export type UpdateSettingResult =
  | { ok: true; row: StoredSetting; changed: boolean }
  | { ok: false; message: string };

/**
 * Validates, writes, versions, and audits one settings change.
 *
 * Refusals are explained. This is not the token surface — an Admin who mistypes
 * a percentage has already proved who they are, and §27.1 requires a state to
 * say what happened and what to do next.
 */
export async function updateSetting(
  db: Database,
  input: UpdateSettingInput,
): Promise<UpdateSettingResult> {
  if (!input.reason.trim()) {
    return {
      ok: false,
      message: 'Say why this is changing. The reason is stored with the change.',
    };
  }

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select(COLUMNS)
      .from(appSettings)
      .where(eq(appSettings.key, input.key))
      .for('update')
      .limit(1);

    if (!current) {
      return { ok: false as const, message: 'That setting does not exist.' };
    }

    if (current.provenance === 'derived') {
      return {
        ok: false as const,
        message:
          'This value comes from the committed business-day calendar, not from configuration. ' +
          'Changing it here would move deadlines that have already been computed and promised, ' +
          'so a new calendar ships as a new committed version and a deployment.',
      };
    }

    const parsed = parseValue(current, input.value);
    if (!parsed.ok) {
      return { ok: false as const, message: parsed.message };
    }

    const canonical = canonicalise(parsed.value);

    if (current.value === canonical) {
      // Not an error, and not a change. Returning the current row keeps the
      // autosave surface honest ("Saved") without writing a history row saying
      // a commercial rule changed when it did not.
      return { ok: true as const, row: current, changed: false };
    }

    const [updated] = await tx
      .update(appSettings)
      .set({
        value: canonical,
        updatedBy: input.actor,
        updateReason: input.reason.trim(),
        // `version` and `updated_at` belong to the trigger; anything set here
        // is overwritten by it. Left out so the two cannot disagree.
      })
      .where(eq(appSettings.key, input.key))
      .returning(COLUMNS);

    await tx.insert(auditEvents).values({
      actor: input.actor,
      mfaContext: input.mfaContext ?? null,
      reauthContext: input.reauthContext ?? null,
      targetType: 'app_setting',
      targetId: input.key,
      action: 'setting.updated',
      internalReason: input.reason.trim(),
      // §25.6 keeps the customer-facing explanation in its own column. A
      // settings change has no customer-facing message of its own; the
      // surfaces that read the setting say what changed, for whom.
      customerExplanation: null,
      priorValue: { value: current.value, version: current.version },
      newValue: { value: canonical, version: updated!.version },
    });

    return { ok: true as const, row: updated!, changed: true };
  });
}

/* ── History ──────────────────────────────────────────────────────────────── */

export interface SettingHistoryEntry {
  key: string;
  version: number;
  priorValue: string | null;
  newValue: string | null;
  changedBy: string;
  reason: string;
  occurredAt: Date;
}

export async function readSettingHistory(
  db: Database,
  key: string,
): Promise<SettingHistoryEntry[]> {
  return db
    .select({
      key: appSettingVersions.key,
      version: appSettingVersions.version,
      priorValue: appSettingVersions.priorValue,
      newValue: appSettingVersions.newValue,
      changedBy: appSettingVersions.changedBy,
      reason: appSettingVersions.reason,
      occurredAt: appSettingVersions.occurredAt,
    })
    .from(appSettingVersions)
    .where(eq(appSettingVersions.key, key))
    .orderBy(sql`${appSettingVersions.version} DESC`);
}

/* ── First-boot seeding ───────────────────────────────────────────────────── */

/**
 * Seeds `admin_reauth_window_seconds` from the environment, once.
 *
 * The chicken-and-egg: `requireFreshSession` reads the setting, but an Admin
 * cannot reach the settings surface until the app is running and guarded. So
 * `ADMIN_REAUTH_WINDOW_SECONDS` — which `env.ts` already refuses to boot
 * without — provides the first value, recorded with an honest actor and reason.
 *
 * It runs only while the setting is still NULL. Once an Admin states a value,
 * the setting is authoritative and the environment variable is ignored: two
 * sources of truth for one security policy is worse than either alone, and a
 * restart that silently reset a window an Admin had chosen would be the worse
 * of the two.
 */
export async function seedAdminReauthWindow(
  db: Database,
  windowSeconds: number,
): Promise<'seeded' | 'already_set'> {
  const seeded = await db
    .update(appSettings)
    .set({
      value: String(windowSeconds),
      updatedBy: 'system:bootstrap',
      updateReason:
        'seeded from ADMIN_REAUTH_WINDOW_SECONDS at first boot; the setting is authoritative from here',
    })
    .where(
      sql`${appSettings.key} = 'admin_reauth_window_seconds' AND ${appSettings.value} IS NULL`,
    )
    .returning({ key: appSettings.key });

  return seeded.length > 0 ? 'seeded' : 'already_set';
}
