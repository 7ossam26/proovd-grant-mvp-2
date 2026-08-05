/**
 * Disputes — Spec §24.11 (Phase 20b).
 *
 * A dispute is the card issuer's act, not Proovd's: the record arrives by
 * webhook, the money is already frozen or gone at the provider, and the two
 * things Proovd controls are (1) how fast an evidence packet is assembled and
 * (2) how the case is CLASSIFIED under §24.8 — through the same cause register
 * every refund uses (`refund_cause_allocations` with `case_kind = 'dispute'`),
 * never a second one. Nothing about a dispute's arrival touches earnings:
 * §33.9.6's rule is that an unrelated dispute does not automatically claw back
 * the Affiliate, and the mechanism is that the ingest writes no allocation —
 * only an Admin's recorded classification can, and its ceiling per cause is
 * 20a's matrix.
 *
 * ── The 24-hour task is a stored fact, not a habit ─────────────────────────
 * §24.11: "On dispute, create an Admin task due within 24 hours." The due time
 * is computed once from the dispute's own opening instant and CHECK-pinned to
 * it in the database — a retry or edit cannot move it (§29.6's rule about
 * promised deadlines, applied to an internal one). The queue shows overdue,
 * not just due (16b's rule: an SLA nobody can see breached is an SLA that gets
 * breached).
 */

/** §24.11: "create an Admin task due within 24 hours." */
export const DISPUTE_TASK_HOURS = 24;

/**
 * The provider's dispute lifecycle vocabulary, stored as-is on the internal
 * record. These are provider words (§25.6/§33.9.11): they live on internal
 * columns and Admin surfaces, and never reach customer copy raw.
 */
export const PAYMENT_DISPUTE_STATUSES = [
  'warning_needs_response',
  'warning_under_review',
  'warning_closed',
  'needs_response',
  'under_review',
  'won',
  'lost',
] as const;
export type PaymentDisputeStatus = (typeof PAYMENT_DISPUTE_STATUSES)[number];

/** The two terminal outcomes plus the closed-warning case. */
export const PAYMENT_DISPUTE_CLOSED_STATUSES = ['won', 'lost', 'warning_closed'] as const;

export interface DisputeEvidenceItem {
  key: string;
  /** §24.11's own words for the item. */
  label: string;
  /**
   * Whether §24.11 requires the item unconditionally. The two conditional
   * items carry the Spec's own qualifier: survey responses "where relevant and
   * permitted", and fulfillment evidence exists only once fulfillment records
   * exist (Phase 21). A packet is complete when every REQUIRED item is present
   * and each conditional item is either present or names why it is absent
   * (§1.4 — an absence is stated, never papered over).
   */
  required: boolean;
}

/**
 * §24.11's packet, as a register so "includes all required consent/tax/policy/
 * delivery/support data" (§33.9.7) is assertable against the list rather than
 * against the assembler's memory of it. Everything here already exists from
 * earlier phases — the assembler composes stored records and re-derives
 * nothing.
 */
export const DISPUTE_EVIDENCE_ITEMS: readonly DisputeEvidenceItem[] = [
  { key: 'consent', label: 'Consent text/version and timestamp', required: true },
  {
    key: 'campaign_disclosure',
    label: 'Campaign disclosure/version at reservation',
    required: true,
  },
  { key: 'founder_identity', label: 'Founder identity/MoR disclosure', required: true },
  {
    key: 'transaction_amounts',
    label: 'Reward, subtotal, tax, total, location evidence, and descriptor',
    required: true,
  },
  { key: 'delivery_promise', label: 'Delivery date/promise', required: true },
  { key: 'payment_objects', label: 'SetupIntent and PaymentIntent/charge', required: true },
  {
    key: 'survey_responses',
    label: 'Survey responses where relevant and permitted',
    required: false,
  },
  { key: 'refund_policy', label: 'Immutable refund-policy version', required: true },
  { key: 'fulfillment_evidence', label: 'Fulfillment evidence', required: false },
  {
    key: 'communication_history',
    label: 'Updates and support/communication history',
    required: true,
  },
] as const;

export type DisputeEvidenceItemKey = (typeof DISPUTE_EVIDENCE_ITEMS)[number]['key'];

export const DISPUTE_EVIDENCE_ITEM_KEYS = DISPUTE_EVIDENCE_ITEMS.map((i) => i.key);
