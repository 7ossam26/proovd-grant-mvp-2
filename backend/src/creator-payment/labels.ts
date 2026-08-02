/**
 * The customer-facing fixed-payment labels, restated for the backend runtime.
 *
 * §16 permits exactly this vocabulary — *optional fixed Creator payment*,
 * *secured Creator payment*, *Creator payment funded*, *fixed Creator payment
 * pending completion*, *fixed Creator payment paid* — and forbids §3.2's
 * holding-account terms and "money already paid to the Creator". An allocation
 * status renders through this map and nowhere else, so an internal status name
 * cannot reach a Founder (§3.1). The backend cannot import `@proovd/shared` at
 * runtime, so the values are restated here and the Phase 13 suite drift-tests
 * them against the shared `FIXED_PAYMENT_LABELS` — the `roster-labels.ts`
 * arrangement.
 */

import type { creatorPaymentStatus } from '../db/schema/creator-payment.js';

type Status = (typeof creatorPaymentStatus.enumValues)[number];

/** One permitted §16 label per funding status. */
export const FIXED_PAYMENT_LABEL: Record<Status, string> = {
  not_requested: 'No fixed Creator payment',
  payment_pending: 'Optional fixed Creator payment',
  funded: 'Fixed Creator payment pending completion',
  payment_failed: 'Fixed Creator payment funding failed',
  returned: 'Fixed Creator payment returned',
  paid: 'Fixed Creator payment paid',
};
