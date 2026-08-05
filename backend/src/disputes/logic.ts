/**
 * §24.11 registers, restated from `@proovd/shared`
 * (`shared/src/disputes/index.ts`) because the backend cannot import shared at
 * runtime. `disputes.test.ts` drift-tests every value against the shared
 * module.
 */

export const DISPUTE_TASK_HOURS = 24;

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

export interface DisputeEvidenceItem {
  key: string;
  label: string;
  required: boolean;
}

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
