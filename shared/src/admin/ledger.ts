/**
 * The §26.5 reservation/charge ledger dimensions, and what §25.7 lets Admin
 * hand out.
 *
 * §26.5 lists eleven things the ledger filters and exports by. A list in prose
 * is a list nobody can test, so it is a register here: the backend restates it
 * (`backend/src/admin/logic.ts`, drift-tested the way the state enums and the
 * §6 settings are), the query builder walks it, and the acceptance suite asserts
 * every dimension is reachable. A twelfth filter someone adds without a §26.5
 * line fails the drift test, and a dimension quietly dropped fails it too.
 *
 * ── Seeing is not exporting (§25.7) ─────────────────────────────────────────
 * The phase brief is explicit: "Exports are permitted exports only — the Founder
 * and Affiliate data-access limits in §25.7 apply to what Admin can hand out,
 * not just what they can see." Admin holds least-privilege operational access
 * for review, support, risk, money, and audit — that is a licence to *look*, not
 * a licence to produce a spreadsheet of Backer identities and send it onward.
 *
 * So every ledger column declares its export class, and the exporter reads the
 * class rather than the caller's column list. `operational` leaves the building;
 * `restricted` never does. There is deliberately no "export everything" flag and
 * no per-request override — a permission that can be waived under pressure from
 * whoever is asking is not the §25.7 limit, it is a speed bump.
 */

/** Which of §26.5's eleven dimensions a filter belongs to. */
export interface LedgerDimension {
  readonly key: string;
  readonly label: string;
  readonly specRef: string;
  /** What an Admin is actually asking when they filter on it. */
  readonly question: string;
}

/**
 * §26.5's eleven dimensions, in the Spec's own order.
 *
 * They are eleven because §26.5 has eleven bullets, not because eleven is a
 * round number — `subtotal/tax/total, tax expiry/usability` is one bullet and
 * therefore one dimension with several inputs, and splitting it to reach a
 * tidier count would be inventing structure the Spec does not state.
 */
export const LEDGER_DIMENSIONS: readonly LedgerDimension[] = [
  {
    key: 'campaign_and_party',
    label: 'Campaign, Founder, and source',
    specRef: '§26.5',
    question: 'Whose campaign is this, and did the pre-order arrive through a Creator, organically, or from house traffic?',
  },
  {
    key: 'date',
    label: 'Date',
    specRef: '§26.5',
    question: 'When was the reservation made?',
  },
  {
    key: 'lifecycle_status',
    label: 'Reservation, SetupIntent, PaymentIntent, and retry status',
    specRef: '§26.5, §23.5',
    question: 'Where is this transaction in its lifecycle, and did the card save or the charge fail?',
  },
  {
    key: 'refund_dispute',
    label: 'Refund and dispute state',
    specRef: '§26.5, §24.8',
    question: 'Has money gone back, and was it a refund or a dispute?',
  },
  {
    key: 'consent_state',
    label: 'Consent and policy version, and optional-consent state',
    specRef: '§26.5, §28.4',
    question: 'Which exact consent was agreed to, and which optional permissions were given?',
  },
  {
    key: 'backer_counting',
    label: 'Unique Backer versus Product transaction count',
    specRef: '§26.5, §4.1',
    question: 'How many distinct people is this, as opposed to how many transactions?',
  },
  {
    key: 'duplicate_review',
    label: 'Duplicate-review case and outcome',
    specRef: '§26.5, §4.1',
    question: 'Was this flagged as a possible duplicate, and what did an Admin decide?',
  },
  {
    key: 'amounts',
    label: 'Subtotal, tax, and total, with tax expiry and usability',
    specRef: '§26.5, §19',
    question: 'What was authorized, and is the tax calculation behind it still usable at capture?',
  },
  {
    key: 'attribution',
    label: 'Attribution and link activation',
    specRef: '§26.5, §18',
    question: 'Which Creator link won this, and was it active and verified at the time?',
  },
  {
    key: 'cap_result',
    label: 'Cap result',
    specRef: '§26.5, §2.2',
    question: 'Did this transaction fit inside the pre-tax campaign cap, or was it refused by it?',
  },
  {
    key: 'tax_treatment',
    label: 'Tax treatment',
    specRef: '§26.5, §31.7',
    question:
      'Was tax collected, or was the zero produced by a `not_collecting` result that is not proof no tax is due?',
  },
] as const;

export type LedgerDimensionKey = (typeof LEDGER_DIMENSIONS)[number]['key'];

/**
 * §25.7's line, applied to a column rather than to a screen.
 *
 * `operational` — a fact about the transaction: amounts, status, versions,
 *                 timestamps, attribution. Admin may export it.
 * `restricted`  — a fact about a *person*: email, phone, billing address, the
 *                 identifiable survey answer. Visible in the Admin detail view
 *                 for support and risk work; never written into an export.
 */
export type LedgerExportClass = 'operational' | 'restricted';

export interface LedgerColumn {
  readonly key: string;
  readonly label: string;
  readonly exportClass: LedgerExportClass;
  /** Why it is classed the way it is, so the next reader does not reclassify it. */
  readonly note?: string;
}

/**
 * The ledger's columns and what may leave with them.
 *
 * The restricted set is not a judgement call made per export — it is §25.7's
 * own list of what an Affiliate may never receive ("Backer name, email, phone,
 * billing address, or identifiable survey response") plus the payment
 * references, which identify a card rather than a transaction.
 */
export const LEDGER_COLUMNS: readonly LedgerColumn[] = [
  { key: 'reservationId', label: 'Reservation', exportClass: 'operational' },
  { key: 'campaignId', label: 'Campaign', exportClass: 'operational' },
  { key: 'campaignType', label: 'Campaign model', exportClass: 'operational' },
  { key: 'status', label: 'Reservation status', exportClass: 'operational' },
  { key: 'reservedAt', label: 'Reserved at', exportClass: 'operational' },
  { key: 'canceledAt', label: 'Canceled at', exportClass: 'operational' },
  { key: 'rewardSku', label: 'Reward SKU', exportClass: 'operational' },
  { key: 'rewardTitle', label: 'Reward', exportClass: 'operational' },
  { key: 'rewardSubtotalCents', label: 'Subtotal', exportClass: 'operational' },
  { key: 'salesTaxCents', label: 'Sales tax', exportClass: 'operational' },
  { key: 'totalAuthorizedCents', label: 'Total authorized', exportClass: 'operational' },
  { key: 'totalCapturedCents', label: 'Total captured', exportClass: 'operational' },
  { key: 'taxJurisdiction', label: 'Tax jurisdiction', exportClass: 'operational' },
  { key: 'taxabilityReason', label: 'Taxability reason', exportClass: 'operational' },
  { key: 'taxCalculationExpiresAt', label: 'Tax calculation expires', exportClass: 'operational' },
  { key: 'taxCloseUsable', label: 'Tax usable at close', exportClass: 'operational' },
  { key: 'consentAppendix', label: 'Consent appendix', exportClass: 'operational' },
  { key: 'consentVersion', label: 'Consent version', exportClass: 'operational' },
  { key: 'consentHash', label: 'Consent hash', exportClass: 'operational' },
  { key: 'founderMarketingConsent', label: 'Founder marketing consent', exportClass: 'operational' },
  { key: 'newsletterConsent', label: 'Proovd newsletter consent', exportClass: 'operational' },
  { key: 'operationalSharingAck', label: 'Operational sharing acknowledged', exportClass: 'operational' },
  { key: 'attributionSource', label: 'Attribution source', exportClass: 'operational' },
  { key: 'attributionStatus', label: 'Attribution status', exportClass: 'operational' },
  { key: 'attributionAssociationId', label: 'Attributed association', exportClass: 'operational' },
  { key: 'linkActivatedAt', label: 'Link activated at', exportClass: 'operational' },
  { key: 'capResult', label: 'Cap result', exportClass: 'operational' },
  { key: 'duplicateCaseStatus', label: 'Duplicate-review outcome', exportClass: 'operational' },
  { key: 'statementDescriptor', label: 'Statement descriptor', exportClass: 'operational' },

  {
    key: 'backerEmail',
    label: 'Backer email',
    exportClass: 'restricted',
    note: '§25.7 names it among the fields an Affiliate never receives. Support and risk read it on screen; it never enters an export file.',
  },
  {
    key: 'backerPhone',
    label: 'Backer phone',
    exportClass: 'restricted',
    note: '§25.7, as above.',
  },
  {
    key: 'billingLine1',
    label: 'Billing address',
    exportClass: 'restricted',
    note: '§25.7 names billing address explicitly.',
  },
  {
    key: 'billingCity',
    label: 'Billing city',
    exportClass: 'restricted',
    note: '§25.7, as above.',
  },
  {
    key: 'surveyWhy',
    label: 'Survey — why they want it',
    exportClass: 'restricted',
    note: '§25.7: identifiable survey responses need the specific optional consent, and an export cannot carry that condition with it.',
  },
  {
    key: 'surveyRecommend',
    label: 'Survey — recommendation score',
    exportClass: 'restricted',
    note: '§25.7, as above. Aggregate survey data is a different product and a different query.',
  },
  {
    key: 'paymentMethodFingerprint',
    label: 'Payment-method fingerprint',
    exportClass: 'restricted',
    note: 'A card identifier, not a transaction fact. §25.3 keeps it as a reference for deduplication only.',
  },
  {
    key: 'stripeCustomerId',
    label: 'Stripe customer',
    exportClass: 'restricted',
    note: 'Identifies the person at the provider. Reconciliation uses the reservation id and the PaymentIntent.',
  },
] as const;

/** The columns an export may contain. Read by the exporter; never overridden. */
export function permittedExportColumns(): readonly LedgerColumn[] {
  return LEDGER_COLUMNS.filter((c) => c.exportClass === 'operational');
}

/** The columns visible on screen but withheld from every export (§25.7). */
export function restrictedColumns(): readonly LedgerColumn[] {
  return LEDGER_COLUMNS.filter((c) => c.exportClass === 'restricted');
}

/**
 * §26.5's cap-result values.
 *
 * §2.2 gives the cap two outcomes and §19 adds the third: a reservation fits, or
 * it is refused because it would exceed the pre-tax ceiling, or it never reached
 * the check because something earlier refused it. `waitlisted` is *not* here —
 * §19 offers "reject or waitlist" as the operator's choice and this build
 * rejects, so recording a waitlist state nothing can produce would be a state
 * with no path into it.
 */
export const CAP_RESULTS = ['within_cap', 'rejected_cap_exceeded', 'not_evaluated'] as const;
export type CapResult = (typeof CAP_RESULTS)[number];
