/**
 * Integer cents in `bigint` — the only money representation in the codebase
 * (Spec §24.3, tech-stack §4.1). No floats, no NUMERIC arithmetic, no string
 * parsing. Every function in shared/money takes and returns `bigint` cents.
 */

import { MoneyRuleError } from './errors.js';

export type Cents = bigint;

/** Guards a cents value: must be a non-negative integer bigint. */
export function assertCents(value: bigint, label: string): void {
  if (typeof value !== 'bigint') {
    throw new MoneyRuleError(`${label} must be bigint cents, got ${typeof value}`);
  }
  if (value < 0n) {
    throw new MoneyRuleError(`${label} must be >= 0 cents, got ${value}`);
  }
}

/** Guards a whole-number percentage in [0, max]. */
export function assertPercent(value: number, max: number, label: string): void {
  if (!Number.isInteger(value)) {
    throw new MoneyRuleError(`${label} must be an integer percentage, got ${value}`);
  }
  if (value < 0 || value > max) {
    throw new MoneyRuleError(`${label} must be between 0 and ${max}, got ${value}`);
  }
}

/**
 * percent% of a cents amount, floor-rounded to whole cents.
 *
 * Floor is deliberate and applied uniformly: the Proovd fee and every Creator
 * percentage round down, and the Founder gross share receives the exact
 * remainder (subtotal − fee − compensation), so the waterfall components always
 * sum to the subtotal with no lost or invented cent.
 */
export function percentOfCents(amount: Cents, percent: number): Cents {
  assertCents(amount, 'amount');
  assertPercent(percent, 100, 'percent');
  return (amount * BigInt(percent)) / 100n;
}
