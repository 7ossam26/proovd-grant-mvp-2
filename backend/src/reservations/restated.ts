/**
 * Shared pre-order logic, restated for the backend runtime.
 *
 * The backend cannot import `@proovd/shared` at runtime: it exports TypeScript
 * source, the backend compiles under `rootDir: src`, and the production image
 * ships only `backend/dist`. This is the same constraint `db/schema/domain.ts`
 * documents for the state enums, `notifications/events.ts` for the event keys,
 * and `launch/business-calendar.ts` for the holiday calendar — and the answer is
 * the same: restate what is needed here and let a drift test fail the suite if
 * the two ever disagree.
 *
 * `src/tests/backer-preorder.test.ts` pins every export below against
 * `@proovd/shared` (a test file may import it — tests are excluded from the
 * backend `tsconfig`).
 *
 * The consent templates carry the most weight: they are Appendix A.3/A.4
 * verbatim, the text a saved card is later charged under (§19), so the drift
 * test compares them character-for-character with the shared originals, which
 * are themselves pinned to the Spec appendix.
 */

/* ── USD formatting (shared/money/format) ──────────────────────────────────── */

/** `1234500n` → `"12,345.00"`. Digits only, no currency prefix. */
export function formatCents(cents: bigint): string {
  const digits = cents.toString().replace('-', '').padStart(3, '0');
  const whole = digits.slice(0, -2);
  const fraction = digits.slice(-2);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sign = cents < 0n ? '-' : '';
  return `${sign}${grouped}.${fraction}`;
}

/* ── Deduplication normalization (shared/reservation/dedup) ─────────────────── */

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D+/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits;
}

export function normalizeDedupInputs(input: { email: string; phone: string }): {
  email: string;
  phone: string;
} {
  return { email: normalizeEmail(input.email), phone: normalizePhone(input.phone) };
}

export const MERGE_SIGNALS = ['email', 'phone', 'payment_fingerprint'] as const;

export function isMergeSignal(signal: string): boolean {
  return (MERGE_SIGNALS as readonly string[]).includes(signal);
}

/* ── Demand survey (shared/reservation/survey) ─────────────────────────────── */

export const SURVEY_WHY_MAX_LENGTH = 2000;
export const SURVEY_RECOMMEND_MIN = 1;
export const SURVEY_RECOMMEND_MAX = 10;

export interface SurveyAnswers {
  why: string;
  recommend: number;
}

export type SurveyValidation =
  | { ok: true; value: SurveyAnswers }
  | { ok: false; field: 'why' | 'recommend'; reason: string };

export function validateSurvey(input: { why: unknown; recommend: unknown }): SurveyValidation {
  const why = typeof input.why === 'string' ? input.why.trim() : '';
  if (why.length === 0) {
    return { ok: false, field: 'why', reason: 'Tell the Founder why you want this.' };
  }
  if (why.length > SURVEY_WHY_MAX_LENGTH) {
    return {
      ok: false,
      field: 'why',
      reason: `Keep this under ${SURVEY_WHY_MAX_LENGTH} characters.`,
    };
  }
  const recommend =
    typeof input.recommend === 'number'
      ? input.recommend
      : typeof input.recommend === 'string' && input.recommend.trim() !== ''
        ? Number(input.recommend)
        : NaN;
  if (
    !Number.isInteger(recommend) ||
    recommend < SURVEY_RECOMMEND_MIN ||
    recommend > SURVEY_RECOMMEND_MAX
  ) {
    return {
      ok: false,
      field: 'recommend',
      reason: `Choose a number from ${SURVEY_RECOMMEND_MIN} to ${SURVEY_RECOMMEND_MAX}.`,
    };
  }
  return { ok: true, value: { why, recommend } };
}

/* ── A.3 / A.4 consent (shared/checkout/preorder-consent) ──────────────────── */

const FORMATTED_AMOUNT = /^\d{1,3}(,\d{3})*\.\d{2}$/;

export const IDEA_CONSENT_TEMPLATE = `You are reserving a pre-order on the campaign "[CAMPAIGN TITLE]"
operated by [FOUNDER LEGAL NAME] (the merchant of record).

Reward: [REWARD PACKAGE NAME]
Reward subtotal: US$[REWARD SUBTOTAL]
Sales tax: US$[SALES TAX]
Total authorized: US$[TOTAL AUTHORIZED]

By clicking Authorize, you agree that:

- Your card will NOT be charged today.
- You are authorizing [FOUNDER LEGAL NAME] and Proovd LLC (acting as
  the Stripe Connect platform on behalf of [FOUNDER LEGAL NAME]) to
  charge your saved card a single off-session payment of exactly
  US$[TOTAL AUTHORIZED] on or shortly after [CLOSE DATE — UTC], if and
  only if the campaign reaches its order threshold of [ORDER THRESHOLD]
  unique Backers with active pre-orders at [CLOSE DATE — UTC]. The
  threshold measures valid purchase commitments at close; it does not
  guarantee that every saved card will later succeed.
- The total above includes the sales tax calculated when you authorize.
  The later charge will occur only if that same tax calculation remains
  usable for the exact total shown above. If it is not usable, you will
  not be charged; Proovd will not substitute a different total.
- If the campaign does not reach the threshold by [CLOSE DATE — UTC],
  no charge will occur, your saved card will lose future-charge
  eligibility for this campaign, and you will not be billed.
- You may cancel this pre-order at any time before [CLOSE DATE — UTC]
  at no cost by clicking "Cancel pre-order" on your backer page using
  the magic link in your confirmation email.
- I understand this product is still in development, may face delays,
  and — in rare cases where the founder is unable to complete the
  project — may not be delivered. I accept that risk as part of
  supporting an early-stage product. After a valid charge there is no
  voluntary/change-of-mind refund. Proovd's Refund Policy at
  proovd.co/refunds explains the exceptions for duplicate, wrong,
  canceled, unauthorized, materially misrepresented, applicable
  non-delivery, serious-violation, legal, Stripe, and card-issuer cases.
- Your card statement is expected to show "[EXPECTED STATEMENT
  DESCRIPTOR]". Contact support@proovd.co with any questions.
- Your email and purchase details will be shared with [FOUNDER LEGAL
  NAME] immediately after you reserve, even though you are not charged
  today, only so they can prepare fulfillment and provide purchase
  support. If you cancel, the Founder will be told not to fulfill your
  order; cancellation cannot retract information already shared.

By reserving this pre-order, you also agree to Proovd's Terms of Service,
Acceptable Use Policy, Refund Policy, Fulfillment Policy, and Privacy Policy.`;

export const PRODUCT_CONSENT_TEMPLATE = `You are placing a founding-member pre-order on the campaign "[CAMPAIGN
TITLE]" operated by [FOUNDER LEGAL NAME] (the merchant of record).

Reward: [REWARD PACKAGE NAME]
Reward subtotal: US$[REWARD SUBTOTAL]
Sales tax: US$[SALES TAX]
Total authorized: US$[TOTAL AUTHORIZED]

By clicking Authorize, you agree that:

- Your card will NOT be charged today.
- You are authorizing [FOUNDER LEGAL NAME] and Proovd LLC (acting as
  the Stripe Connect platform on behalf of [FOUNDER LEGAL NAME]) to
  charge your saved card a single off-session payment of exactly
  US$[TOTAL AUTHORIZED] on [CLOSE DATE — UTC] for the reward package
  "[REWARD PACKAGE NAME]" described on the campaign page above.
- The total above includes the sales tax calculated when you authorize.
  The later charge will occur only if that same tax calculation remains
  usable for the exact total shown above. If it is not usable, you will
  not be charged; Proovd will not substitute a different total.
- Expected delivery of "[REWARD PACKAGE NAME]" is [DELIVERY MONTH/YEAR].
  If this expected delivery window changes, [FOUNDER LEGAL NAME] will
  notify you by email.
- You may cancel this pre-order at any time before [CLOSE DATE — UTC]
  at no cost by clicking "Cancel pre-order" on your backer page using
  the magic link in your confirmation email. After [CLOSE DATE — UTC],
  refund eligibility is governed by the campaign-specific Founder refund
  policy [POLICY TITLE / VERSION / EFFECTIVE DATE] at [PRESERVED POLICY URL]
  and Proovd's Refund Policy at proovd.co/refunds, subject to applicable law,
  Stripe, and card-issuer rules.
- I understand this is a pre-order for an early-stage product or feature
  launch. Delivery is on the disclosed timeline above; in the uncommon
  event of material delay or the rare event of non-delivery, the refund
  mechanisms defined in the preserved policy version above apply.
- Your card statement is expected to show "[EXPECTED STATEMENT
  DESCRIPTOR]". Contact support@proovd.co with any questions.
- Your email and purchase details will be shared with [FOUNDER LEGAL
  NAME] immediately after you reserve, even though you are not charged
  today, only so they can prepare fulfillment and provide purchase
  support. If you cancel, the Founder will be told not to fulfill your
  order; cancellation cannot retract information already shared.

By reserving this pre-order, you also agree to Proovd's Terms of Service,
Acceptable Use Policy, Refund Policy, Fulfillment Policy, and Privacy Policy.`;

export const FOUNDER_MARKETING_CONSENT_LABEL =
  'I allow [FOUNDER LEGAL NAME] to\ncontact me for marketing, research, surveys, and other messages not required\nto fulfill or support this purchase, and to see my identifiable survey answers.';

export const PREORDER_AUTHORIZE_ACTION = 'Authorize pre-order';
export const PREORDER_CONSENT_VERSION = '1.0';

export interface IdeaConsentVars {
  campaignTitle: string;
  founderLegalName: string;
  rewardPackageName: string;
  rewardSubtotal: string;
  salesTax: string;
  totalAuthorized: string;
  closeDateUtc: string;
  orderThreshold: string;
  expectedStatementDescriptor: string;
}

export interface ProductConsentVars {
  campaignTitle: string;
  founderLegalName: string;
  rewardPackageName: string;
  rewardSubtotal: string;
  salesTax: string;
  totalAuthorized: string;
  closeDateUtc: string;
  deliveryMonthYear: string;
  policyReference: string;
  preservedPolicyUrl: string;
  expectedStatementDescriptor: string;
}

export interface ResolvedPreorderConsent {
  body: string;
  marketingLabel: string;
  action: string;
  version: string;
}

function assertAmounts(pairs: ReadonlyArray<readonly [string, string]>): void {
  for (const [name, value] of pairs) {
    if (!FORMATTED_AMOUNT.test(value)) {
      throw new Error(`pre-order consent ${name} must be a formatted amount, got "${value}"`);
    }
  }
}

function assertResolved(text: string): void {
  const leftover = text.match(/\[[A-Z][^\]]*\]/);
  if (leftover) {
    throw new Error(`pre-order consent has an unresolved marker: ${leftover[0]}`);
  }
}

export function resolveIdeaConsent(vars: IdeaConsentVars): ResolvedPreorderConsent {
  assertAmounts([
    ['rewardSubtotal', vars.rewardSubtotal],
    ['salesTax', vars.salesTax],
    ['totalAuthorized', vars.totalAuthorized],
  ]);
  for (const [name, value] of Object.entries(vars)) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`pre-order consent ${name} must be a non-empty string`);
    }
  }
  const body = IDEA_CONSENT_TEMPLATE.replaceAll('[CAMPAIGN TITLE]', vars.campaignTitle)
    .replace(/\[FOUNDER LEGAL\s+NAME\]/g, vars.founderLegalName)
    .replaceAll('[REWARD PACKAGE NAME]', vars.rewardPackageName)
    .replaceAll('[REWARD SUBTOTAL]', vars.rewardSubtotal)
    .replaceAll('[SALES TAX]', vars.salesTax)
    .replaceAll('[TOTAL AUTHORIZED]', vars.totalAuthorized)
    .replaceAll('[CLOSE DATE — UTC]', vars.closeDateUtc)
    .replaceAll('[ORDER THRESHOLD]', vars.orderThreshold)
    .replace(/\[EXPECTED STATEMENT\s+DESCRIPTOR\]/g, vars.expectedStatementDescriptor);
  assertResolved(body);
  return {
    body,
    marketingLabel: FOUNDER_MARKETING_CONSENT_LABEL.replaceAll(
      '[FOUNDER LEGAL NAME]',
      vars.founderLegalName,
    ),
    action: PREORDER_AUTHORIZE_ACTION,
    version: PREORDER_CONSENT_VERSION,
  };
}

export function resolveProductConsent(vars: ProductConsentVars): ResolvedPreorderConsent {
  assertAmounts([
    ['rewardSubtotal', vars.rewardSubtotal],
    ['salesTax', vars.salesTax],
    ['totalAuthorized', vars.totalAuthorized],
  ]);
  for (const [name, value] of Object.entries(vars)) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`pre-order consent ${name} must be a non-empty string`);
    }
  }
  const body = PRODUCT_CONSENT_TEMPLATE.replace(/\[CAMPAIGN\s+TITLE\]/g, vars.campaignTitle)
    .replace(/\[FOUNDER LEGAL\s+NAME\]/g, vars.founderLegalName)
    .replaceAll('[REWARD PACKAGE NAME]', vars.rewardPackageName)
    .replaceAll('[REWARD SUBTOTAL]', vars.rewardSubtotal)
    .replaceAll('[SALES TAX]', vars.salesTax)
    .replaceAll('[TOTAL AUTHORIZED]', vars.totalAuthorized)
    .replaceAll('[CLOSE DATE — UTC]', vars.closeDateUtc)
    .replaceAll('[DELIVERY MONTH/YEAR]', vars.deliveryMonthYear)
    .replaceAll('[POLICY TITLE / VERSION / EFFECTIVE DATE]', vars.policyReference)
    .replaceAll('[PRESERVED POLICY URL]', vars.preservedPolicyUrl)
    .replace(/\[EXPECTED STATEMENT\s+DESCRIPTOR\]/g, vars.expectedStatementDescriptor);
  assertResolved(body);
  return {
    body,
    marketingLabel: FOUNDER_MARKETING_CONSENT_LABEL.replaceAll(
      '[FOUNDER LEGAL NAME]',
      vars.founderLegalName,
    ),
    action: PREORDER_AUTHORIZE_ACTION,
    version: PREORDER_CONSENT_VERSION,
  };
}
