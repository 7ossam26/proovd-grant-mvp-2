/**
 * The §26.5, §26.6, §31.7, and §33.12.4 registers, restated for the backend.
 *
 * The backend never imports `@proovd/shared` at runtime — that package exports
 * TypeScript source, this package compiles under `rootDir: src`, and the
 * production image ships only `backend/dist`. So the data is restated here and
 * `admin-operations.test.ts` drift-tests every list against `@proovd/shared`,
 * exactly as `db/schema/domain.ts` does for the state enums, `policy-gate.ts`
 * for the required slugs, `launch/logic.ts` for the §17 checklist, and
 * `creator-payment/logic.ts` for the §16 checklist.
 *
 * Restating is not duplicating: the drift test is what makes the two one fact.
 * Importing across the boundary is what would not build.
 */

/* ── §26.5 ledger dimensions ──────────────────────────────────────────────── */

export const LEDGER_DIMENSION_KEYS = [
  'campaign_and_party',
  'date',
  'lifecycle_status',
  'refund_dispute',
  'consent_state',
  'backer_counting',
  'duplicate_review',
  'amounts',
  'attribution',
  'cap_result',
  'tax_treatment',
] as const;

export type LedgerDimensionKey = (typeof LEDGER_DIMENSION_KEYS)[number];

/* ── §25.7 export classes ─────────────────────────────────────────────────── */

/**
 * The columns an export may carry, and the ones it may never.
 *
 * The exporter reads this, not the caller's column list — §25.7's limit applies
 * to what Admin can *hand out*, and a limit the requester can widen is not a
 * limit. There is deliberately no override parameter and no "full export" flag.
 */
export const PERMITTED_EXPORT_COLUMNS = [
  'reservationId',
  'campaignId',
  'campaignType',
  'status',
  'reservedAt',
  'canceledAt',
  'rewardSku',
  'rewardTitle',
  'rewardSubtotalCents',
  'salesTaxCents',
  'totalAuthorizedCents',
  'totalCapturedCents',
  'taxJurisdiction',
  'taxabilityReason',
  'taxCalculationExpiresAt',
  'taxCloseUsable',
  'consentAppendix',
  'consentVersion',
  'consentHash',
  'founderMarketingConsent',
  'newsletterConsent',
  'operationalSharingAck',
  'attributionSource',
  'attributionStatus',
  'attributionAssociationId',
  'linkActivatedAt',
  'capResult',
  'duplicateCaseStatus',
  'statementDescriptor',
] as const;

export const RESTRICTED_COLUMNS = [
  'backerEmail',
  'backerPhone',
  'billingLine1',
  'billingCity',
  'surveyWhy',
  'surveyRecommend',
  'paymentMethodFingerprint',
  'stripeCustomerId',
] as const;

export type PermittedExportColumn = (typeof PERMITTED_EXPORT_COLUMNS)[number];

/** §26.5's cap-result values, mirrored by the 0024 CHECK. */
export const CAP_RESULTS = ['within_cap', 'rejected_cap_exceeded', 'not_evaluated'] as const;
export type CapResult = (typeof CAP_RESULTS)[number];

/* ── §26.6 money controls ─────────────────────────────────────────────────── */

export const MONEY_CONTROL_KEYS = [
  'captured_amounts',
  'proovd_fee',
  'founder_share',
  'creator_percentage',
  'fixed_allocation',
  'transfers',
  'founder_payment',
  'early_release_evidence',
  'thank_you_expense',
] as const;

export type MoneyControlKey = (typeof MONEY_CONTROL_KEYS)[number];

/**
 * §22.3's three real states. `held` is not among them and there is no constant
 * for it — §22.3: "Never uses `held` where `eligible`, `blocked`, or `released`
 * is accurate." Phase 19 reads this rather than inventing a fourth word.
 */
export const MONEY_STATUSES = ['eligible', 'blocked', 'released'] as const;
export type MoneyStatus = (typeof MONEY_STATUSES)[number];

export const BANNED_MONEY_STATUS_WORDS = [
  'held',
  'holding',
  'on hold',
  'in escrow',
  'escrowed',
  'in trust',
] as const;

export const HIGH_IMPACT_REQUIREMENTS = [
  'recent_reauthentication',
  'customer_consequence_preview',
  'idempotency',
  'immutable_audit',
] as const;

/* ── §31.7 risk signals ───────────────────────────────────────────────────── */

export const RISK_SIGNAL_KEYS = [
  'radar_result',
  'duplicate_queue',
  'amount_above_highest_reward',
  'click_velocity',
  'affiliate_self_preorder',
  'founder_creator_relationship',
  'sanctions_or_restriction',
  'tax_not_collecting',
  'connected_account_change',
  'processing_exception',
] as const;

export type RiskSignalKey = (typeof RISK_SIGNAL_KEYS)[number];

export type RiskSeverity = 'blocking' | 'review' | 'monitor';

/** Mirrors the shared register's severities; drift-tested. */
export const RISK_SEVERITIES: Readonly<Record<RiskSignalKey, RiskSeverity>> = {
  radar_result: 'review',
  duplicate_queue: 'review',
  amount_above_highest_reward: 'blocking',
  click_velocity: 'monitor',
  affiliate_self_preorder: 'blocking',
  founder_creator_relationship: 'review',
  sanctions_or_restriction: 'blocking',
  tax_not_collecting: 'blocking',
  connected_account_change: 'review',
  processing_exception: 'blocking',
};

export const SELLER_TAX_READINESS_FACT_KEYS = [
  'head_office_location',
  'product_tax_code',
  'registration',
  'provider_tax_settings',
] as const;

export type SellerTaxReadinessFactKey = (typeof SELLER_TAX_READINESS_FACT_KEYS)[number];

/** All four, or the campaign is not ready to collect live tax (§31.7). */
export function isSellerTaxReady(recorded: Readonly<Record<string, boolean>>): boolean {
  return SELLER_TAX_READINESS_FACT_KEYS.every((key) => recorded[key] === true);
}

export function missingSellerTaxFacts(
  recorded: Readonly<Record<string, boolean>>,
): SellerTaxReadinessFactKey[] {
  return SELLER_TAX_READINESS_FACT_KEYS.filter((key) => recorded[key] !== true);
}

/* ── §33.12.4 overrides ───────────────────────────────────────────────────── */

export const ADMIN_FIELD_KINDS = ['auto_populated', 'admin_review', 'admin_override'] as const;
export type AdminFieldKind = (typeof ADMIN_FIELD_KINDS)[number];

export const OVERRIDE_REQUIRED_FACTS = [
  'prior_value',
  'new_value',
  'reason',
  'actor',
  'occurred_at',
] as const;

export interface OverridableField {
  readonly key: string;
  readonly targetType: string;
  readonly customerConsequence: string;
}

/**
 * The registered overridable fields. A route that accepted any string for
 * `field` would happily record an override of something that does not exist,
 * and the audit trail would look complete while pointing at nothing.
 */
export const OVERRIDABLE_FIELDS: readonly OverridableField[] = [
  {
    key: 'reservation.attribution_status',
    targetType: 'reservation',
    customerConsequence:
      'Changes which Creator is credited for this pre-order, and therefore what that Creator is told they earned.',
  },
  {
    key: 'reservation.cap_result',
    targetType: 'reservation',
    customerConsequence:
      'Changes whether this pre-order counts toward the campaign total the Backer and the Founder both see.',
  },
  {
    key: 'reservation.tax_close_usable',
    targetType: 'reservation',
    customerConsequence:
      'Decides whether this card may be charged at all. Marking an expired calculation usable would charge a total the Backer never consented to.',
  },
  {
    key: 'campaign.high_effort',
    targetType: 'campaign',
    customerConsequence:
      'Changes whether a Creator may propose a percentage above the base rate on this campaign.',
  },
  {
    key: 'campaign.seller_tax_readiness',
    targetType: 'campaign',
    customerConsequence:
      'Decides whether the campaign may collect live sales tax. Recording readiness that does not exist would charge Backers a tax nobody is registered to remit.',
  },
] as const;

export function findOverridableField(key: string): OverridableField | undefined {
  return OVERRIDABLE_FIELDS.find((f) => f.key === key);
}

/* ── §33.9.11: raw provider codes never become customer copy ──────────────── */

/**
 * Restated from the shared register and drift-tested by source, so the two
 * pattern lists cannot diverge silently — a leak is invisible until someone
 * reads a support transcript.
 */
export const RAW_PROVIDER_CODE_PATTERNS: readonly RegExp[] = [
  /\b(?:card_declined|insufficient_funds|do_not_honor|lost_card|stolen_card|pickup_card|transaction_not_allowed|try_again_later|fraudulent|generic_decline|incorrect_cvc|expired_card|processing_error|authentication_required)\b/i,
  /\b(?:evt|pi|seti|ch|py|re|tr|po|acct|cs|txcd|req)_[A-Za-z0-9]{6,}\b/,
  /\bradar[_.]/i,
  /\brule:\s*[A-Za-z0-9_]+/i,
  /\brisk_level\s*[:=]/i,
];

export function containsRawProviderCode(text: string): boolean {
  return RAW_PROVIDER_CODE_PATTERNS.some((pattern) => pattern.test(text));
}
