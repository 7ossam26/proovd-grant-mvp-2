/**
 * §26.6 money controls, and §22.3's money vocabulary.
 *
 * §26.6 lists nine things Admin "sees and reconciles". Almost all of them are
 * filled by Phases 18–19; the phase brief's instruction is to build the surfaces
 * now against the Phase 03 ledger columns "so those phases fill rows rather than
 * inventing views". So this register names every line, says which ledger column
 * answers it, and says plainly which phase populates it — and the surface
 * renders a line with no data yet as **not yet populated**, never as a zero.
 *
 * A zero is a claim. "Proovd's 5% on this campaign is US$0.00" is true of a
 * campaign that captured nothing and equally true of a campaign whose close
 * batch has not run, and those are not the same fact. §1.4 forbids implying an
 * answer the system does not have, which is the same reason §31.7 refuses to
 * read a `not_collecting` tax result as proof no tax is due.
 */

/**
 * §22.3's vocabulary, established here because the phase trap says to:
 * "`held` is not a synonym for `eligible`, `blocked`, or `released` (§22.3).
 * Establish the vocabulary here — Phase 19 depends on it."
 *
 * §22.3's own sentence is "Never uses `held` where `eligible`, `blocked`, or
 * `released` is accurate." The three real states are what money actually is:
 *
 *   `eligible`  every condition is met and the amount is payable.
 *   `blocked`   a named requirement is outstanding — a missing W-9, an
 *               incomplete account, an open risk case. The blocker is always
 *               named, because "blocked" without a reason is `held` wearing a
 *               different word.
 *   `released`  it has been paid out.
 *
 * `held` is not in the list and there is no constant for it. §3.2 already bans
 * the holding-account vocabulary from schema, code, logs, and copy, and §22.3
 * bans this particular euphemism from Founder-facing money status. Proovd does
 * not hold anyone's money — Stripe settles to the Founder's own account — so a
 * surface that says "held" is describing an arrangement that does not exist.
 */
export const MONEY_STATUSES = ['eligible', 'blocked', 'released'] as const;
export type MoneyStatus = (typeof MONEY_STATUSES)[number];

/**
 * The words a money surface may never use for a §22.3 status, scanned for by
 * test the way the §3.2 holding-account vocabulary is.
 */
export const BANNED_MONEY_STATUS_WORDS = [
  'held',
  'holding',
  'on hold',
  'in escrow',
  'escrowed',
  'in trust',
] as const;

/** Which phase actually writes the numbers behind a control line. */
export type MoneyControlSource = 'phase_11' | 'phase_13' | 'phase_18' | 'phase_19' | 'phase_20';

export interface MoneyControlLine {
  readonly key: string;
  readonly label: string;
  readonly specRef: string;
  /** The ledger columns that answer it. Empty when the phase has not run yet. */
  readonly ledgerColumns: readonly string[];
  readonly populatedBy: MoneyControlSource;
  /** What reconciling this line actually means. */
  readonly reconciles: string;
}

/**
 * §26.6's nine lines, in the Spec's own order.
 *
 * `ledgerColumns` names the Phase 03 columns rather than inventing new ones —
 * that is the brief's instruction and the reason the close batch and the payout
 * phases will not need a second view. Where a line has no column yet (the
 * thank-you expense, Product early-release evidence), the register says so
 * instead of pointing at an approximate column, because a control that
 * reconciles against the wrong number is worse than one that says it is not
 * ready.
 */
export const MONEY_CONTROL_LINES: readonly MoneyControlLine[] = [
  {
    key: 'captured_amounts',
    label: 'Captured subtotal, tax, and total',
    specRef: '§26.6, §24.3',
    ledgerColumns: [
      'reward_subtotal_captured_cents',
      'sales_tax_captured_cents',
      'total_captured_cents',
    ],
    populatedBy: 'phase_18',
    reconciles:
      'The sum of captured reservations against the campaign aggregate, and both against the provider. Sales tax is excluded from every percentage below (§24.3).',
  },
  {
    key: 'proovd_fee',
    label: "Proovd's 5%",
    specRef: '§26.6, §24.3',
    ledgerColumns: ['proovd_fee_cents'],
    populatedBy: 'phase_18',
    reconciles: 'The platform fee taken from the pre-tax reward subtotal, never from the tax.',
  },
  {
    key: 'founder_share',
    label: 'Founder share and Stripe fee',
    specRef: '§26.6, §24.3, §24.5',
    ledgerColumns: ['founder_gross_share_cents', 'stripe_fee_cents', 'founder_net_cents'],
    populatedBy: 'phase_18',
    reconciles:
      'Gross share minus the Stripe fees allocated to the Founder under the approved configuration, giving what is actually payable.',
  },
  {
    key: 'creator_percentage',
    label: 'Creator provisional maximum, earned percentage and bonus, and unearned return',
    specRef: '§26.6, §24.4',
    ledgerColumns: [
      'affiliate_provisional_cents',
      'affiliate_earned_cents',
      'affiliate_unearned_returned_cents',
    ],
    populatedBy: 'phase_19',
    reconciles:
      'The provisional amount is a liability account and never Proovd revenue (§24.4). Earned plus unearned-returned must equal provisional, exactly once.',
  },
  {
    key: 'fixed_allocation',
    label: 'Fixed allocation funding, return, and payment',
    specRef: '§26.6, §24.7, §16',
    ledgerColumns: [
      'creator_payment_allocations.amount_cents',
      'creator_payment_allocations.status',
    ],
    populatedBy: 'phase_13',
    reconciles:
      'The fourth money stream. No percentage touches it and it carries no sales tax (§24.7). Funded is not paid — §22.1 decides that.',
  },
  {
    key: 'transfers',
    label: 'Transfer, payout, reversal, and failure',
    specRef: '§26.6, §24.1',
    ledgerColumns: ['provider_objects.object_type', 'provider_objects.status'],
    populatedBy: 'phase_19',
    reconciles:
      'Every Transfer to a Creator recipient account against the earnings that justified it. A Transfer failure is a synchronous API error and a retry case — there is no `transfer.failed` webhook to wait for (§32.3).',
  },
  {
    key: 'founder_payment',
    label: 'W-9 and Founder payment status',
    specRef: '§26.6, §22.3',
    ledgerColumns: [],
    populatedBy: 'phase_19',
    reconciles:
      'A missing or unverified W-9 blocks every Founder payment. Status is `eligible`, `blocked` with the named requirement, or `released` — never `held`.',
  },
  {
    key: 'early_release_evidence',
    label: 'Product early-release evidence',
    specRef: '§26.6, §22.3',
    ledgerColumns: [],
    populatedBy: 'phase_19',
    reconciles:
      'Recorded proof that the promised reward or access is actually available to affected Backers, that the required communication went out, that tax and payment requirements are complete, and that no immediate risk flag exists. Internal readiness alone is insufficient.',
  },
  {
    key: 'thank_you_expense',
    label: 'Separate thank-you expense',
    specRef: '§26.6, §22.2',
    ledgerColumns: [],
    populatedBy: 'phase_19',
    reconciles:
      'The discretionary good-effort payment, kept as its own expense line so it never reads as earned compensation.',
  },
] as const;

export type MoneyControlKey = (typeof MONEY_CONTROL_LINES)[number]['key'];

/**
 * The four requirements §26.6 puts on a high-impact action.
 *
 * "High-impact actions require recent reauthentication, preview of
 * customer-visible consequences, idempotency, and immutable audit."
 *
 * The phase brief adds why the second one is not decoration: "moving money
 * without seeing what the customer will be told is how support contradicts the
 * ledger."
 */
export const HIGH_IMPACT_REQUIREMENTS = [
  'recent_reauthentication',
  'customer_consequence_preview',
  'idempotency',
  'immutable_audit',
] as const;
export type HighImpactRequirement = (typeof HIGH_IMPACT_REQUIREMENTS)[number];
