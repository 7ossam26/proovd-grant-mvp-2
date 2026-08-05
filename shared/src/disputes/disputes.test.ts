import { describe, expect, it } from 'vitest';
import {
  DISPUTE_EVIDENCE_ITEM_KEYS,
  DISPUTE_EVIDENCE_ITEMS,
  DISPUTE_TASK_HOURS,
  PAYMENT_DISPUTE_STATUSES,
} from './index.js';

describe('§24.11 dispute register', () => {
  it('pins the 24-hour Admin task', () => {
    expect(DISPUTE_TASK_HOURS).toBe(24);
  });

  it('names all ten §24.11 packet items, in the Spec order', () => {
    expect(DISPUTE_EVIDENCE_ITEM_KEYS).toEqual([
      'consent',
      'campaign_disclosure',
      'founder_identity',
      'transaction_amounts',
      'delivery_promise',
      'payment_objects',
      'survey_responses',
      'refund_policy',
      'fulfillment_evidence',
      'communication_history',
    ]);
  });

  it('marks exactly the two conditional items optional — survey ("where relevant and permitted") and fulfillment', () => {
    const optional = DISPUTE_EVIDENCE_ITEMS.filter((i) => !i.required).map((i) => i.key);
    expect(optional).toEqual(['survey_responses', 'fulfillment_evidence']);
  });

  it('keeps the provider status vocabulary internal-shaped (no customer words)', () => {
    expect(PAYMENT_DISPUTE_STATUSES).toContain('needs_response');
    expect(PAYMENT_DISPUTE_STATUSES).toContain('won');
    expect(PAYMENT_DISPUTE_STATUSES).toContain('lost');
  });
});
