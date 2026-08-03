/**
 * The atomic US$50,000 pre-tax cap — Spec §2.2, §33.5.10.
 *
 * Phase 15's headline trap: "The cap check must be atomic in the database.
 * Read-then-write passes every single-threaded test and fails on the first
 * concurrent pair." So the check is a single conditional UPDATE — increment the
 * running total only where the new total would still fit — and the row's CHECK
 * constraint is the backstop that no path, not even hand-written SQL, can cross.
 *
 * ── Reserve before SetupIntent, release on failure ──────────────────────────
 * §19 requires the cap decision *before* SetupIntent. So the capacity is held
 * first; the reservation then owns that hold, and a SetupIntent failure releases
 * it (§33.5.4 keeps a failed setup from creating a reservation, and this keeps it
 * from silently consuming capacity). A crash between hold and reservation leaks
 * capacity toward *under*-accepting, which is the safe direction — it can never
 * push the total over the cap (§2.2: "never partly accept").
 *
 * The cap value is read from the §6 `campaign_cap_cents` setting when the
 * capacity row is first created and frozen there (§29.6: a later settings edit
 * never moves a promise already made). Pre-tax throughout (§24.3).
 */

import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { readSettingValue } from '../settings/service.js';

type Executor = Pick<Database, 'execute'>;

export const CAMPAIGN_CAP_SETTING_KEY = 'campaign_cap_cents';

/** Reads the §6 cap in force, in cents. Throws on an unset/invalid value.
    The `money_cents` setting parses to a bigint; a legacy number is tolerated. */
export async function readCampaignCapCents(db: Database): Promise<bigint> {
  const value = await readSettingValue(db, CAMPAIGN_CAP_SETTING_KEY);
  const cents =
    typeof value === 'bigint'
      ? value
      : typeof value === 'number' && Number.isInteger(value)
        ? BigInt(value)
        : null;
  if (cents === null || cents <= 0n) {
    throw new Error(`setting "${CAMPAIGN_CAP_SETTING_KEY}" is not a positive whole number of cents`);
  }
  return cents;
}

/**
 * Ensures the capacity row exists, seeding `cap_cents` from the setting in force.
 * Idempotent: a second call for the same campaign changes nothing (the unique
 * index makes `ON CONFLICT DO NOTHING` the whole mechanism).
 */
export async function ensureCapacityRow(
  db: Database,
  campaignId: string,
  capCents: bigint,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO campaign_reservation_capacity (campaign_id, cap_cents, reserved_subtotal_cents)
    VALUES (${campaignId}, ${capCents.toString()}, 0)
    ON CONFLICT (campaign_id) DO NOTHING
  `);
}

/**
 * Atomically holds `subtotalCents` of capacity. Returns true only if the hold
 * fit under the cap — a single conditional UPDATE, so two concurrent callers
 * serialize on the row and the second sees the first's increment (§33.5.10).
 */
export async function reserveCapacity(
  db: Executor,
  campaignId: string,
  subtotalCents: bigint,
): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE campaign_reservation_capacity
    SET reserved_subtotal_cents = reserved_subtotal_cents + ${subtotalCents.toString()},
        updated_at = now()
    WHERE campaign_id = ${campaignId}
      AND reserved_subtotal_cents + ${subtotalCents.toString()} <= cap_cents
    RETURNING id
  `);
  return (result.rowCount ?? 0) === 1;
}

/**
 * Releases a previously held amount (a SetupIntent failure, or a cancellation).
 * Guarded against going negative — a double release is a no-op below zero.
 */
export async function releaseCapacity(
  db: Executor,
  campaignId: string,
  subtotalCents: bigint,
): Promise<void> {
  await db.execute(sql`
    UPDATE campaign_reservation_capacity
    SET reserved_subtotal_cents = GREATEST(0, reserved_subtotal_cents - ${subtotalCents.toString()}),
        updated_at = now()
    WHERE campaign_id = ${campaignId}
  `);
}

/** The current pre-tax reserved total and cap, for Admin/checkout display. */
export async function readCapacity(
  db: Database,
  campaignId: string,
): Promise<{ capCents: bigint; reservedSubtotalCents: bigint } | null> {
  const result = await db.execute(sql`
    SELECT cap_cents, reserved_subtotal_cents
    FROM campaign_reservation_capacity
    WHERE campaign_id = ${campaignId}
    LIMIT 1
  `);
  const row = result.rows[0] as
    | { cap_cents: string; reserved_subtotal_cents: string }
    | undefined;
  if (!row) return null;
  return {
    capCents: BigInt(row.cap_cents),
    reservedSubtotalCents: BigInt(row.reserved_subtotal_cents),
  };
}
