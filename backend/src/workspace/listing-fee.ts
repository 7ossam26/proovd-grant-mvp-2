/**
 * The listing-fee calculation — Spec §12, §6, §24.6, §33.3.2.
 *
 *   base            = §6 `listing_fee_base_cents`
 *   discount        = §6 `listing_fee_item_discount_cents` × completed items,
 *                     capped at §6 `listing_fee_max_discount_cents`
 *   subtotal        = max(§6 `listing_fee_min_cents`, base − discount)
 *
 * ── Why this reads settings rather than importing `shared/money` ────────────
 * `shared/src/money/listing-fee.ts` is the Phase 03 kernel and it computes from
 * `money/constants.ts`. Since Phase 06 those constants are *seed defaults*, not
 * the operating values: §6 makes every one of these four numbers a setting an
 * Admin may change, and Phase 06's rule is unambiguous — "a hardcoded duration
 * is a bug even when the number is right. Read the setting."
 *
 * The backend also cannot import `@proovd/shared` at runtime. So the money math
 * lives here, over values read from `app_settings`, and
 * `campaign-workspace.test.ts` walks all 32 item combinations through both this
 * and the shared kernel and asserts they agree on the seeded §6 numbers. That is
 * the same restate-and-drift-test arrangement as the state enums and the policy
 * slugs — not a second implementation of the §24.3 waterfall, which stays
 * single and stays in `shared/money`.
 *
 * The one place this must never be re-implemented is the browser. Phase 09's
 * trap: "Don't recalculate in the UI. A second implementation in a React
 * component is how the preview and the charge diverge." The surface renders the
 * numbers this returns and computes nothing.
 *
 * ── Tax is not here ─────────────────────────────────────────────────────────
 * §12 puts sales tax on the Checkout, calculated by Stripe Tax on Proovd's
 * direct listing service. Phase 10 establishes the client and Phase 11 uses it.
 * There is deliberately no `taxCents: 0` in the result: a zero would read as
 * "no tax is due", which is a claim nobody has made (§1.4).
 */

import type { Database } from '../db/client.js';
import { readSettingValue } from '../settings/service.js';
import { OPTIONAL_ITEM_KEYS, type OptionalItemKey } from './registry.js';

/** The four §6 keys this reads. Named once so a typo is a compile error. */
export const LISTING_FEE_SETTING_KEYS = {
  base: 'listing_fee_base_cents',
  perItem: 'listing_fee_item_discount_cents',
  maxDiscount: 'listing_fee_max_discount_cents',
  minSubtotal: 'listing_fee_min_cents',
} as const;

export interface ListingFeeSettings {
  baseCents: bigint;
  itemDiscountCents: bigint;
  maxDiscountCents: bigint;
  minSubtotalCents: bigint;
}

export interface DiscountLine {
  item: OptionalItemKey;
  discountCents: bigint;
}

export interface ListingFeeResult extends ListingFeeSettings {
  completedItems: number;
  /** §24.6: "each optional discount" — one labeled line per earned saving. */
  discountLines: DiscountLine[];
  discountCents: bigint;
  subtotalCents: bigint;
}

/**
 * Reads the four §6 values in force.
 *
 * `readSettingValue` throws on an unset or unregistered setting rather than
 * returning a fallback — a fee quoted from an invented number is the failure
 * §6's fail-closed instruction exists to prevent. All four are `specified`
 * provenance and seeded, so this only throws if migration 0004 and the register
 * have drifted, which is a deployment fault and should read like one.
 */
export async function readListingFeeSettings(db: Database): Promise<ListingFeeSettings> {
  const [base, perItem, maxDiscount, minSubtotal] = await Promise.all([
    readSettingValue(db, LISTING_FEE_SETTING_KEYS.base),
    readSettingValue(db, LISTING_FEE_SETTING_KEYS.perItem),
    readSettingValue(db, LISTING_FEE_SETTING_KEYS.maxDiscount),
    readSettingValue(db, LISTING_FEE_SETTING_KEYS.minSubtotal),
  ]);

  const cents = (value: unknown, key: string): bigint => {
    if (typeof value !== 'bigint') {
      throw new Error(`setting "${key}" is not integer cents; money is never a float or a decimal`);
    }
    return value;
  };

  return {
    baseCents: cents(base, LISTING_FEE_SETTING_KEYS.base),
    itemDiscountCents: cents(perItem, LISTING_FEE_SETTING_KEYS.perItem),
    maxDiscountCents: cents(maxDiscount, LISTING_FEE_SETTING_KEYS.maxDiscount),
    minSubtotalCents: cents(minSubtotal, LISTING_FEE_SETTING_KEYS.minSubtotal),
  };
}

/**
 * §12's arithmetic. Integer cents throughout — never a float, never a decimal.
 *
 * The cap and the floor are both applied, in that order, because §12 states
 * both and they are not the same constraint: the cap bounds what five items can
 * earn, the floor bounds what the fee can fall to. With the seeded §6 numbers
 * the cap binds first (5 × $2 = $10, capped at $10) and the floor is reached
 * exactly ($35 − $10 = $25) — but an Admin may change any of the four, and a
 * calculation that applied only one would silently produce a different fee.
 */
export function computeListingFee(
  settings: ListingFeeSettings,
  completed: readonly OptionalItemKey[],
): ListingFeeResult {
  // Deduplicated and ordered by §12's own list, so the receipt lines are in a
  // stable order regardless of which order the items were completed in.
  const completedSet = new Set(completed);
  const lines = OPTIONAL_ITEM_KEYS.filter((k) => completedSet.has(k)).map((item) => ({
    item,
    discountCents: settings.itemDiscountCents,
  }));

  const raw = settings.itemDiscountCents * BigInt(lines.length);
  const discountCents = raw > settings.maxDiscountCents ? settings.maxDiscountCents : raw;

  const reduced = settings.baseCents - discountCents;
  const subtotalCents = reduced < settings.minSubtotalCents ? settings.minSubtotalCents : reduced;

  return {
    ...settings,
    completedItems: lines.length,
    discountLines: lines,
    discountCents,
    subtotalCents,
  };
}
