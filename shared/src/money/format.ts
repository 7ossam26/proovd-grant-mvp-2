/**
 * Money rendering — Spec §3.3, §24.3.
 *
 * §3.3 requires every money-related statement to show the amount, and to show
 * reward subtotal, sales tax, and total separately where relevant. §24.3 keeps
 * money in integer cents, so the formatting here works on the digits of the
 * `bigint` and never converts through `Number` — a float round-trip is exactly
 * the drift the integer rule exists to prevent.
 *
 * Currency is USD at launch (§2.2), so the prefix is fixed rather than
 * locale-derived: `US$` is the literal Appendix A consent copy uses.
 */

import { assertCents, type Cents } from './cents.js';

/** `1234500n` → `"12,345.00"`. Digits only — no currency prefix. */
export function formatCents(cents: Cents): string {
  assertCents(cents, 'cents');
  const digits = cents.toString().padStart(3, '0');
  const whole = digits.slice(0, -2);
  const fraction = digits.slice(-2);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${grouped}.${fraction}`;
}

/** `1234500n` → `"US$12,345.00"`. The form Appendix A's consent blocks use. */
export function formatUsd(cents: Cents): string {
  return `US$${formatCents(cents)}`;
}
