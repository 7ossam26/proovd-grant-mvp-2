/**
 * The §31.7 risk-control inventory — ten signals, plus Founder seller tax
 * readiness.
 *
 * §31.7's opening words are "Before close and throughout live operations", so
 * this is not a close-time report: the signals are computed on every read of the
 * risk surface and are visible from the moment a campaign has anything to say.
 *
 * ── The one that is a trap rather than a signal ──────────────────────────────
 * §31.7: "Tax `not_collecting` or missing-registration result; zero tax caused
 * by missing collection configuration is not treated as proof that no tax is
 * due." The phase brief repeats it in bold. A US$0.00 tax line has two
 * completely different meanings — the jurisdiction genuinely charges nothing on
 * this, or nobody configured collection — and only one of them is safe. So
 * `tax_not_collecting` is a *risk*, always, and the surface may never render it
 * as a clean result. This is the same refusal `STRIPE_TAX_ENABLED` makes at the
 * listing Checkout, applied to the campaign charge.
 *
 * ── Severity is about what it blocks, not about how alarming it sounds ───────
 * `blocking`  something must not proceed while this is true.
 * `review`    a person has to look at it and record a decision.
 * `monitor`   worth seeing; no decision is owed yet.
 *
 * No signal is scored, ranked, or summed into an index. §1 rule 6 forbids
 * inventing an eligibility condition, and a risk score is exactly that with
 * arithmetic in front of it — the first phase that wanted an automatic refusal
 * would find a number already sitting there to compare against a threshold
 * nobody agreed. Admin reads the signals and decides.
 */

export type RiskSeverity = 'blocking' | 'review' | 'monitor';

export interface RiskSignalDefinition {
  readonly key: string;
  readonly label: string;
  readonly specRef: string;
  readonly severity: RiskSeverity;
  /** What is actually checked. Rendered beside the count, present or absent. */
  readonly detects: string;
  /** What an Admin does about it. §27.1 question 5, for an internal surface. */
  readonly action: string;
}

/** §31.7's ten bullets, in the Spec's own order. */
export const RISK_SIGNALS: readonly RiskSignalDefinition[] = [
  {
    key: 'radar_result',
    label: 'Stripe Radar result on every PaymentIntent',
    specRef: '§31.7',
    severity: 'review',
    detects:
      'Any PaymentIntent whose stored Radar outcome is elevated or blocked. Populated from Phase 18 captures; before then there are no PaymentIntents to read.',
    action: 'Open the transaction, read the Radar detail in the provider, and record a decision.',
  },
  {
    key: 'duplicate_queue',
    label: 'Practical Idea duplicate queue',
    specRef: '§31.7, §4.1',
    severity: 'review',
    detects:
      'Open deduplication cases on Idea Campaigns. A case is a suspicion, never a merge — shared IP alone never opens one.',
    action: 'Merge or separate with a recorded reason, evidence, prior value, new value, and actor.',
  },
  {
    key: 'amount_above_highest_reward',
    label: 'Reservation above the highest valid reward price',
    specRef: '§31.7',
    severity: 'blocking',
    detects:
      'Any active reservation whose pre-tax subtotal exceeds the highest priced reward package on its campaign. A transaction that cannot correspond to anything on sale is a ledger error or a manipulation.',
    action: 'Reconcile against the reward packages before close. Nothing should capture while this is unexplained.',
  },
  {
    key: 'click_velocity',
    label: 'Click velocity and suspicious conversion spikes',
    specRef: '§31.7, §18',
    severity: 'monitor',
    detects:
      'Clicks concentrated in a short window on one tracking link, and pre-order conversion far outside the campaign norm. Read from the §18 click ledger, which records every click and why an ignored one earned nothing.',
    action: 'Compare against the Creator first-post verification and the link activation time.',
  },
  {
    key: 'affiliate_self_preorder',
    label: 'Creator self-pre-order and duplicate Creator accounts',
    specRef: '§31.7, §29.1',
    severity: 'blocking',
    detects:
      'A reservation whose Backer contact matches a Creator associated with the same campaign, and Creator accounts sharing a normalized contact.',
    action: 'Enforce under §29.1 and record it. Self-pre-order is fraud, not an edge case.',
  },
  {
    key: 'founder_creator_relationship',
    label: 'Disclosed or suspected Founder–Creator relationship',
    specRef: '§31.7, §29.2',
    severity: 'review',
    detects:
      'Recorded conflict notes on a campaign association, and contact overlap between a campaign Founder and one of its Creators.',
    action: 'Record the disclosure and whether the partnership may continue (§29.2).',
  },
  {
    key: 'sanctions_or_restriction',
    label: 'Sanctions, OFAC, or provider restriction',
    specRef: '§31.7, §13',
    severity: 'blocking',
    detects:
      'Recorded sanctions notes on a prospect, and any connected account Stripe has moved to a restricted state.',
    action: 'Nothing pays out while this is open. Route to the recorded support path, never to another onboarding attempt.',
  },
  {
    key: 'tax_not_collecting',
    label: 'Tax `not_collecting` or missing registration',
    specRef: '§31.7',
    severity: 'blocking',
    detects:
      'Reservations whose stored taxability reason is `not_collecting`, and campaigns whose seller tax readiness is unrecorded. A zero produced by missing configuration is never proof that no tax is due.',
    action:
      'Confirm the registration and the product tax code before close. Do not read the zero as a clean result.',
  },
  {
    key: 'connected_account_change',
    label: 'Connected-account requirement or capability change',
    specRef: '§31.7, §13',
    severity: 'review',
    detects:
      'Accounts whose state moved, or whose outstanding requirement names changed, since the last review. Read from the append-only account event log.',
    action: 'Check what the account can still do before relying on it for a charge or a payout.',
  },
  {
    key: 'processing_exception',
    label: 'Batch, webhook, job, and ledger exception',
    specRef: '§31.7, §28.3',
    severity: 'blocking',
    detects:
      'Provider events claimed but never processed, and idempotency keys claimed but never completed. Both are the honest state a partial failure leaves behind, and both mean something is unfinished.',
    action: 'Reconcile the unfinished work before it is retried or written off.',
  },
] as const;

export type RiskSignalKey = (typeof RISK_SIGNALS)[number]['key'];

/**
 * §31.7's closing paragraph, which is a gate rather than a signal.
 *
 * "Founder seller tax readiness requires head-office location, applicable
 * product tax code, registration, and active provider tax settings before live
 * tax collection."
 *
 * Four facts, all four required, each recorded by a named person with evidence —
 * §1.3's rule that manual work counts only when the app records it, and §34's
 * "recorded as complete". Three of four does not make a campaign ready, the same
 * way twelve of the thirteen §16 Creator-readiness items still block.
 */
export const SELLER_TAX_READINESS_FACTS = [
  {
    key: 'head_office_location',
    label: 'Head-office location',
    requirement:
      'Where the Founder actually sells from, which decides the jurisdictions in play. Not the mailing address on the account.',
  },
  {
    key: 'product_tax_code',
    label: 'Applicable product tax code',
    requirement:
      'The provider tax code that matches what the campaign is actually selling. A default code applied to everything is a guess.',
  },
  {
    key: 'registration',
    label: 'Registration',
    requirement:
      'The Founder is registered where the campaign will collect. An unregistered jurisdiction is what produces a `not_collecting` result.',
  },
  {
    key: 'provider_tax_settings',
    label: 'Active provider tax settings',
    requirement:
      'Tax settings are live on the connected account, not merely saved in a draft state.',
  },
] as const;

export type SellerTaxReadinessFactKey = (typeof SELLER_TAX_READINESS_FACTS)[number]['key'];

/** All four, or the campaign is not ready to collect live tax. §31.7. */
export function isSellerTaxReady(recorded: Readonly<Record<string, boolean>>): boolean {
  return SELLER_TAX_READINESS_FACTS.every((fact) => recorded[fact.key] === true);
}

/** The facts still outstanding, in register order, for the surface to name. */
export function missingSellerTaxFacts(
  recorded: Readonly<Record<string, boolean>>,
): readonly SellerTaxReadinessFactKey[] {
  return SELLER_TAX_READINESS_FACTS.filter((fact) => recorded[fact.key] !== true).map(
    (fact) => fact.key,
  );
}
