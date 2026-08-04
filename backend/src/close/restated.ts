/**
 * Appendix B.5 and the US$0 closure sentences, restated for the backend
 * runtime.
 *
 * `shared/src/close/index.ts` owns them (pinned against the Spec appendix);
 * the backend cannot import `@proovd/shared` at runtime — the constraint
 * `reservations/restated.ts` documents — so the template, the resolver, and
 * the pinned sentences are restated verbatim here and the close suite compares
 * them character-for-character with the shared originals.
 */

/* ── Appendix B.5 (shared/close FAILED_PAYMENT_TEMPLATE) ────────────────────── */

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

export const NO_MONEY_MOVED_STATE =
  'No money has moved — the charge did not complete and nothing was taken from your card.';

export const UPDATE_CARD_ACTION = 'Update card';

const FORMATTED_AMOUNT = /^\d{1,3}(,\d{3})*\.\d{2}$/;

export interface FailedPaymentVars {
  moneyMovedState: string;
  campaignTitle: string;
  rewardTitle: string;
  rewardSubtotal: string;
  salesTax: string;
  totalAttempted: string;
  updateByLocal: string;
  updateByUtc: string;
}

export interface ResolvedFailedPayment {
  body: string;
  action: string;
}

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
    .replace('\n[Update card]\n', '\n');

  const leftover = body.match(/\[[A-Z][^\]]*\]/);
  if (leftover) {
    throw new Error(`failed-payment copy has an unresolved marker: ${leftover[0]}`);
  }

  return { body, action: UPDATE_CARD_ACTION };
}

/* ── The US$0 no-charge closures (shared/close) ─────────────────────────────── */

export const THRESHOLD_MISS_REASON =
  'The campaign did not reach its order threshold by close, so no charge occurred. Amount charged: US$0.';

export const TAX_UNUSABLE_DROP_REASON =
  'The sales-tax calculation stored with your pre-order could no longer be used at close, so no charge occurred — Proovd never substitutes a different total. Amount charged: US$0.';
