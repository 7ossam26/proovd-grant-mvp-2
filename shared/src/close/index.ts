/**
 * The campaign close — Spec §21, §4.1, §24.2, Appendix B.5 (Phase 18a).
 *
 * This module owns the vocabulary the close batch runs on:
 *
 *  - `CLOSE_BATCH_STEPS` — §21's eight steps as a register, so "the batch does
 *    all eight" is assertable rather than a comment. The backend restates it in
 *    `close/logic.ts` and a drift test fails the suite if the two disagree.
 *  - `CAPTURE_FAILURE_KINDS` — the retryable off-session outcomes §33.7.8
 *    names, plus the classifier that maps a provider result onto them. Every
 *    kind here enters `capture_failed_retrying`; the raw provider code stays an
 *    internal column and never becomes the message (§25.6, §33.9.11).
 *  - `TAX_UNUSABLE_REASON` — §21's one no-PaymentIntent drop at the batch:
 *    an unusable stored tax calculation means NO charge, never a substituted
 *    total.
 *  - Appendix B.5 — the failed-payment copy, exact text, with a resolver that
 *    refuses an unfilled bracket the way A.3/A.4/A.5 and B.8 do.
 *  - `foldMergedIdentities` — §4.1's close-time unique-Backer fold: an Admin
 *    `merged` decision makes two backer identities one person for the
 *    threshold, and the decision record is the only thing that may do that.
 */

import { ideaThresholdMet } from '../money/thresholds.js';

/* ── §21's eight close-batch steps, as data ─────────────────────────────────── */

export const CLOSE_BATCH_STEPS = [
  {
    key: 'lock_active_reservations',
    spec: '§21 step 1: Lock active reservations.',
  },
  {
    key: 'exclude_canceled_ineligible',
    spec: '§21 step 2: Exclude canceled/ineligible reservations.',
  },
  {
    key: 'stop_joining_and_cancellation',
    spec: '§21 step 3: Stop new Affiliate associations and Backer cancellation.',
  },
  {
    key: 'resolve_duplicates_and_count',
    spec: '§21 step 4: For Idea, resolve pending duplicate cases and calculate unique active Backers.',
  },
  {
    key: 'threshold_missed_no_charge',
    spec: '§21 step 5: If Idea threshold missed — no PaymentIntent, reservations threshold_not_met_no_charge, eligibility removed, US$0 closure, campaign ended_no_charge.',
  },
  {
    key: 'validate_and_capture',
    spec: '§21 step 6: If threshold met or Product — pending_capture, validate the stored tax calculation and exact amount, one off-session PaymentIntent under a stable key.',
  },
  {
    key: 'receipts_and_recovery',
    spec: '§21 step 7: Send receipts on success and recovery messages on failure.',
  },
  {
    key: 'open_retry_window',
    spec: '§21 step 8: Open one fixed 48-hour retry window from the first close-batch failure.',
  },
] as const;

export type CloseBatchStepKey = (typeof CLOSE_BATCH_STEPS)[number]['key'];

/* ── Retryable capture failures (§21, §33.7.8) ──────────────────────────────── */

/**
 * The three retryable ways an off-session PaymentIntent fails. Every one moves
 * the reservation to `capture_failed_retrying` and into the one 48-hour window;
 * `requires_action` additionally routes to a customer-action recovery surface
 * rather than silently succeeding or silently failing (§21).
 */
export const CAPTURE_FAILURE_KINDS = [
  'card_declined',
  'insufficient_funds',
  'requires_action',
] as const;

export type CaptureFailureKind = (typeof CAPTURE_FAILURE_KINDS)[number];

/**
 * Classifies a provider outcome into the §33.7.8 vocabulary.
 *
 * The decline code is a provider word and stays internal (§25.6); this decides
 * only which recovery the Backer enters. Anything that is not specifically an
 * insufficient-funds decline or a pending customer action is a card decline —
 * the recovery is identical, and inventing finer-grained customer-facing
 * categories would put provider vocabulary in front of a person (§33.9.11).
 */
export function classifyCaptureFailure(input: {
  /** The provider PaymentIntent status, when the failure is a pending action. */
  status?: string | null | undefined;
  /** The provider decline code, e.g. `insufficient_funds`, when one exists. */
  declineCode?: string | null | undefined;
}): CaptureFailureKind {
  if (input.status === 'requires_action') return 'requires_action';
  if (input.declineCode === 'insufficient_funds') return 'insufficient_funds';
  return 'card_declined';
}

/**
 * §21 step 6's one no-PaymentIntent drop reason at the batch. An unusable
 * stored tax calculation creates no PaymentIntent and never a substituted
 * total — the reservation drops with this reason recorded.
 */
export const TAX_UNUSABLE_REASON = 'tax_calculation_unusable' as const;

/* ── The Idea threshold decision at close (§4.1, §21) ───────────────────────── */

/**
 * §4.1: an Admin `merged` decision says two backer identities are one practical
 * unique Backer. This folds a set of active identity ids over the recorded
 * merge decisions (transitively — A merged with B and B merged with C is one
 * person) and returns the unique count the threshold is decided on.
 *
 * `separated` and undecided pairs fold nothing: two people stay two people
 * until an Admin records otherwise, and shared signals alone never merge
 * (§4.1's own rule, enforced upstream).
 */
export function foldMergedIdentities(
  activeIdentityIds: readonly string[],
  mergedPairs: ReadonlyArray<readonly [string, string]>,
): number {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== undefined && parent.get(root) !== root) {
      root = parent.get(root)!;
    }
    return root;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const [a, b] of mergedPairs) union(a, b);

  const roots = new Set<string>();
  for (const id of activeIdentityIds) roots.add(find(id));
  return roots.size;
}

/**
 * The §21 close decision for an Idea campaign, over the folded unique count.
 * Re-exported through the same kernel §33.6.10's crossings use, so the live
 * crossing and the close decision cannot disagree about what "met" means.
 */
export function ideaCloseThresholdMet(uniqueActiveBackers: number, threshold: number): boolean {
  return ideaThresholdMet(uniqueActiveBackers, threshold);
}

/* ── Appendix B.5 — failed payment (exact text) ─────────────────────────────── */

/**
 * Appendix B.5, verbatim. `[ACTUAL MONEY-MOVED STATE]` is §21's "whether any
 * money moved", stated as a fact by the service; for a failed or
 * requires-action off-session PaymentIntent nothing was captured, and
 * `NO_MONEY_MOVED_STATE` is the pinned sentence for that state.
 */
export const FAILED_PAYMENT_TEMPLATE = `We could not complete this pre-order charge.

[ACTUAL MONEY-MOVED STATE]
Campaign: [CAMPAIGN]
Reward: [REWARD]
Reward subtotal: US$[SUBTOTAL]
Sales tax: US$[SALES TAX]
Total attempted: US$[TOTAL]
Update by: [LOCAL DATE/TIME] ([UTC])

[Update card]

If you do nothing, this pre-order will be canceled after the retry window.`;

/** The truthful money-moved sentence when a capture attempt did not complete. */
export const NO_MONEY_MOVED_STATE =
  'No money has moved — the charge did not complete and nothing was taken from your card.';

/** B.5's one action (§21: "One `Update card` action"). */
export const UPDATE_CARD_ACTION = 'Update card';

/** A formatted USD amount like `1,234.00` — the shape `formatCents` produces. */
const FORMATTED_AMOUNT = /^\d{1,3}(,\d{3})*\.\d{2}$/;

export interface FailedPaymentVars {
  /** The stated money-moved fact — `NO_MONEY_MOVED_STATE` for a failed capture. */
  moneyMovedState: string;
  campaignTitle: string;
  rewardTitle: string;
  /** Formatted amounts, e.g. "25.00" — from `formatCents`, never raw cents. */
  rewardSubtotal: string;
  salesTax: string;
  totalAttempted: string;
  /** The retry deadline in local time, e.g. "August 6, 2026 3:40 PM EDT". */
  updateByLocal: string;
  /** The same instant in UTC (§27.1's secondary rendering). */
  updateByUtc: string;
}

export interface ResolvedFailedPayment {
  /** The exact B.5 body, with `[Update card]` removed — it renders as the action. */
  body: string;
  action: string;
}

/**
 * Resolves Appendix B.5 with variables from the ledger. Throws on a
 * non-formatted amount or any surviving bracket — a recovery message with a
 * marker in it tells a Backer nothing about their own money.
 */
export function resolveFailedPaymentCopy(vars: FailedPaymentVars): ResolvedFailedPayment {
  for (const [name, value] of Object.entries(vars)) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`failed-payment copy ${name} must be a non-empty string`);
    }
  }
  for (const [name, value] of [
    ['rewardSubtotal', vars.rewardSubtotal],
    ['salesTax', vars.salesTax],
    ['totalAttempted', vars.totalAttempted],
  ] as const) {
    if (!FORMATTED_AMOUNT.test(value)) {
      throw new Error(`failed-payment copy ${name} must be a formatted amount, got "${value}"`);
    }
  }

  const body = FAILED_PAYMENT_TEMPLATE.replaceAll('[ACTUAL MONEY-MOVED STATE]', vars.moneyMovedState)
    .replaceAll('[CAMPAIGN]', vars.campaignTitle)
    .replaceAll('[REWARD]', vars.rewardTitle)
    .replaceAll('[SUBTOTAL]', vars.rewardSubtotal)
    .replaceAll('[SALES TAX]', vars.salesTax)
    .replaceAll('[TOTAL]', vars.totalAttempted)
    .replaceAll('[LOCAL DATE/TIME]', vars.updateByLocal)
    .replaceAll('[UTC]', vars.updateByUtc)
    // The action renders as the message's one control, not as body text.
    .replace('\n[Update card]\n', '\n');

  const leftover = body.match(/\[[A-Z][^\]]*\]/);
  if (leftover) {
    throw new Error(`failed-payment copy has an unresolved marker: ${leftover[0]}`);
  }

  return { body, action: UPDATE_CARD_ACTION };
}

/* ── The US$0 no-charge closure (§21 step 5) ────────────────────────────────── */

/**
 * The pinned reason sentences for the two US$0 no-charge closures the batch can
 * send. Both state US$0 explicitly (§33.7.3's rule extended to close), and
 * neither implies the Backer did something wrong (§30's non-shaming rule).
 */
export const THRESHOLD_MISS_REASON =
  'The campaign did not reach its order threshold by close, so no charge occurred. Amount charged: US$0.';

export const TAX_UNUSABLE_DROP_REASON =
  'The sales-tax calculation stored with your pre-order could no longer be used at close, so no charge occurred — Proovd never substitutes a different total. Amount charged: US$0.';
