/**
 * The close-batch registers and kernels, restated for runtime — Spec §21,
 * §24.3, §4.1, §33.7 (Phase 18a).
 *
 * `shared/src/close/index.ts` owns these; the backend cannot import
 * `@proovd/shared` at runtime (rootDir — the constraint `db/schema/domain.ts`
 * documents), so the data and the arithmetic are restated here and
 * `close-batch.test.ts` drift-tests every one against the shared module. The
 * §24.3 waterfall is the same arrangement `workspace/listing-fee.ts` uses: the
 * shared kernel stays the one *definition*, this restates it over the §6
 * settings actually in force, and the suite walks values through both.
 */

/* ── §21's eight steps (drift-tested against CLOSE_BATCH_STEPS) ─────────────── */

export const CLOSE_BATCH_STEP_KEYS = [
  'lock_active_reservations',
  'exclude_canceled_ineligible',
  'stop_joining_and_cancellation',
  'resolve_duplicates_and_count',
  'threshold_missed_no_charge',
  'validate_and_capture',
  'receipts_and_recovery',
  'open_retry_window',
] as const;

/* ── §33.7.8's retryable failure kinds (drift-tested) ───────────────────────── */

export const CAPTURE_FAILURE_KINDS = [
  'card_declined',
  'insufficient_funds',
  'requires_action',
] as const;

export type CaptureFailureKind = (typeof CAPTURE_FAILURE_KINDS)[number];

export const TAX_UNUSABLE_REASON = 'tax_calculation_unusable' as const;

/** Maps a provider outcome onto the §33.7.8 vocabulary (shared kernel restated). */
export function classifyCaptureFailure(input: {
  status?: string | null | undefined;
  declineCode?: string | null | undefined;
}): CaptureFailureKind {
  if (input.status === 'requires_action') return 'requires_action';
  if (input.declineCode === 'insufficient_funds') return 'insufficient_funds';
  return 'card_declined';
}

/* ── §4.1's merged-identity fold (shared kernel restated) ───────────────────── */

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
  for (const [a, b] of mergedPairs) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  const roots = new Set<string>();
  for (const id of activeIdentityIds) roots.add(find(id));
  return roots.size;
}

/** §4.1/§21: the threshold is met at `unique >= threshold` (shared kernel restated). */
export function ideaCloseThresholdMet(uniqueActiveBackers: number, threshold: number): boolean {
  return uniqueActiveBackers >= threshold;
}

/* ── The §24.3 waterfall over the §6 fee in force ───────────────────────────── */

/**
 * percent% of a cents amount, floor-rounded — `shared/money`'s `percentOfCents`
 * restated verbatim, drift-tested. Floor uniformly; the Founder gross share is
 * the exact remainder, so the components always sum to the subtotal.
 */
export function percentOfCents(amount: bigint, percent: number): bigint {
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
    throw new Error(`percent must be an integer in [0,100], got ${percent}`);
  }
  if (amount < 0n) throw new Error(`amount must be >= 0 cents, got ${amount}`);
  return (amount * BigInt(percent)) / 100n;
}

export interface CaptureLedger {
  rewardSubtotalCents: bigint;
  proovdFeeCents: bigint;
  /** §24.4: the MAXIMUM that could be owed, a liability — never Proovd revenue. */
  affiliateProvisionalCents: bigint;
  founderGrossShareCents: bigint;
}

/**
 * §24.3 for one captured transaction, provisioned per §24.4: the compensation
 * slot holds the maximum locked percentage that could be owed for the
 * attributed Creator (0 for organic/house), and the Founder gross share is the
 * exact remainder. Phase 19's finalization computes the earned percentage and
 * returns every unearned difference to the Founder once.
 */
export function captureLedger(input: {
  rewardSubtotalCents: bigint;
  platformFeePercent: number;
  provisionalAffiliatePercent: number;
}): CaptureLedger {
  const proovdFeeCents = percentOfCents(input.rewardSubtotalCents, input.platformFeePercent);
  const affiliateProvisionalCents = percentOfCents(
    input.rewardSubtotalCents,
    input.provisionalAffiliatePercent,
  );
  return {
    rewardSubtotalCents: input.rewardSubtotalCents,
    proovdFeeCents,
    affiliateProvisionalCents,
    founderGrossShareCents:
      input.rewardSubtotalCents - proovdFeeCents - affiliateProvisionalCents,
  };
}

/**
 * §24.4: "Provision the maximum locked percentage that could be owed for that
 * Creator, including conditional Creator-specific bonus." Each bonus can add
 * its `additionalPercent` up to its own `maxCombinedPercent`; the provision is
 * the largest combined value any bonus could produce, never below the locked
 * total and never above the §6 ceiling.
 */
export function provisionalPercent(input: {
  lockedTotalPercent: number;
  bonuses: ReadonlyArray<{ additionalPercent: number; maxCombinedPercent: number }>;
  ceilingPercent: number;
}): number {
  let max = input.lockedTotalPercent;
  for (const bonus of input.bonuses) {
    const combined = Math.min(
      input.lockedTotalPercent + bonus.additionalPercent,
      bonus.maxCombinedPercent,
    );
    if (combined > max) max = combined;
  }
  return Math.min(max, input.ceilingPercent);
}

/* ── §21 reconciliation register (drift-tested, Phase 18b) ──────────────────── */

export const RECONCILIATION_ITEMS = [
  {
    key: 'batch_completeness',
    spec: '§21: Batch completeness and all reservation terminal/retry states.',
    evaluation: 'app',
    requiredForResults: true,
    waitsOn: null,
  },
  {
    key: 'tax_charge_reconciliation',
    spec: '§21: Tax calculation/charge reconciliation.',
    evaluation: 'app',
    requiredForResults: true,
    waitsOn: null,
  },
  {
    key: 'attribution_post_verification',
    spec: '§21: Attribution validity and post verification.',
    evaluation: 'app',
    requiredForResults: true,
    waitsOn: null,
  },
  {
    key: 'creator_deliverables',
    spec: '§21: Every Creator deliverable/waiver/availability period.',
    evaluation: 'admin',
    requiredForResults: false,
    waitsOn: '§22.1 deliverable verification after the retry window (Phase 19)',
  },
  {
    key: 'creator_bonus_triggers',
    spec: '§21: Creator-specific bonus trigger.',
    evaluation: 'admin',
    requiredForResults: false,
    waitsOn: '§22.1 earnings finalization (Phase 19)',
  },
  {
    key: 'provisional_vs_earned',
    spec: '§21: Provisional versus earned Creator amount.',
    evaluation: 'admin',
    requiredForResults: false,
    waitsOn: '§22.1 earnings finalization (Phase 19)',
  },
  {
    key: 'unearned_return',
    spec: '§21: Return of unearned provisional amount to Founder through the approved adjustment path.',
    evaluation: 'admin',
    requiredForResults: false,
    waitsOn: '§24.4 unearned-remainder return (Phase 19)',
  },
  {
    key: 'founder_share_w9',
    spec: '§21: Founder share and W-9 block.',
    evaluation: 'admin',
    requiredForResults: false,
    waitsOn: '§22.3 W-9 collection and Founder payment schedule (Phase 19)',
  },
  {
    key: 'refund_risk_dispute',
    spec: '§21: Refund/risk/dispute flags.',
    evaluation: 'admin',
    requiredForResults: true,
    waitsOn: null,
  },
] as const;

export type ReconciliationItemKey = (typeof RECONCILIATION_ITEMS)[number]['key'];

export const RECONCILIATION_RESULTS = ['verified', 'discrepancy'] as const;
export type ReconciliationResult = (typeof RECONCILIATION_RESULTS)[number];

/* ── §21 results narrative fields (drift-tested, Phase 18b) ─────────────────── */

export const RESULTS_NARRATIVE_FIELDS = [
  { key: 'strongest_signal', label: 'Strongest signal' },
  { key: 'weakest_signal', label: 'Weakest signal' },
  { key: 'leading_survey_reason', label: 'Leading survey reason' },
  { key: 'what_this_proves', label: 'What this result proves' },
  { key: 'what_this_does_not_prove', label: 'What this result does not prove' },
] as const;

export type ResultsNarrativeFieldKey = (typeof RESULTS_NARRATIVE_FIELDS)[number]['key'];

/* ── §21 step 6's usability validation ──────────────────────────────────────── */

export type CaptureUsability =
  | { usable: true }
  | { usable: false; reason: string };

/**
 * §21 step 6: "validate stored tax calculation, Founder/reward/location
 * association, expiry/usability, and exact amount." Pure over a snapshot, so
 * §33.7's assertions are about facts rather than a simulated network. Any
 * failure means NO PaymentIntent and never a substituted total.
 */
export function validateCaptureUsability(input: {
  now: Date;
  taxCalculationId: string | null;
  taxCalculatedAt: Date | null;
  taxCalculationExpiresAt: Date | null;
  billingCountry: string | null;
  rewardSku: string | null;
  totalAuthorizedCents: bigint | null;
  rewardSubtotalCents: bigint;
  salesTaxCents: bigint;
  stripeCustomerId: string | null;
  paymentMethodId: string | null;
}): CaptureUsability {
  if (!input.taxCalculationId || !input.taxCalculatedAt) {
    return { usable: false, reason: 'no stored reservation-time tax calculation' };
  }
  if (
    input.taxCalculationExpiresAt !== null &&
    input.taxCalculationExpiresAt.getTime() <= input.now.getTime()
  ) {
    return { usable: false, reason: 'the stored tax calculation has expired' };
  }
  if (input.billingCountry !== 'US') {
    return { usable: false, reason: 'the billing location association is not the recorded US one' };
  }
  if (!input.rewardSku) {
    return { usable: false, reason: 'the reservation carries no reward association' };
  }
  if (input.totalAuthorizedCents === null) {
    return { usable: false, reason: 'no authorized total is recorded' };
  }
  if (input.totalAuthorizedCents !== input.rewardSubtotalCents + input.salesTaxCents) {
    return {
      usable: false,
      reason: 'the stored amounts do not reconcile to the exact authorized total',
    };
  }
  if (!input.stripeCustomerId || !input.paymentMethodId) {
    return { usable: false, reason: 'no usable saved payment method reference' };
  }
  return { usable: true };
}
