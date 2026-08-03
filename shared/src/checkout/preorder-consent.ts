/**
 * Appendix A.3 (Idea) and A.4 (Product) — the pre-order consent. Exact text,
 * Spec §19, §24.2, §28.4.
 *
 * This is the consent under which a saved card is later charged (Phase 15's
 * trap): "Appendix A.3 and A.4 are exact text. These are the consent under
 * which a card is later charged." It sits beside A.5's listing consent for the
 * same reason every exact-copy constant does — an editable promise is one that
 * gets softened under pressure, and this one authorizes a real off-session
 * charge for a real amount.
 *
 * ── Variables come from the ledger, never recomputed for display ────────────
 * Appendix A's own rule: "Variables must come from the same versioned domain
 * records used by the ledger." [REWARD SUBTOTAL] is the reward package's stored
 * price; [SALES TAX] is the stored reservation-time Stripe Tax calculation's
 * tax; [TOTAL AUTHORIZED] is their sum, the exact amount the later PaymentIntent
 * may charge and nothing else (§19). The server resolves all of them and the
 * record stores the resolved text with its version and hash (§25.2) — the
 * frontend never does money arithmetic on a consent.
 *
 * ── The record is the resolved text, hashed ─────────────────────────────────
 * §19: "Store the consent text version and hash with the reservation." The
 * resolver returns the exact text the Backer authorized; the caller hashes it
 * and stores both. A dispute (§24.11) reconciles against that stored text, so a
 * consent rendered with an unresolved bracket in it is a consent to nothing —
 * the resolver refuses one, exactly as `resolveListingFeeConsent` does.
 */

/** A formatted USD amount like `1,234.00` — the shape `formatCents` produces. */
const FORMATTED_AMOUNT = /^\d{1,3}(,\d{3})*\.\d{2}$/;

/* ── A.3 — Idea Campaign consent (verbatim) ─────────────────────────────────
   Body through the "By reserving this pre-order…" paragraph. The three
   checkboxes and the action are separate constants below, because §28.4 makes
   each optional consent its own control and the required one its own gate. */
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

/* ── A.4 — Product Campaign consent (verbatim) ──────────────────────────────── */
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

/**
 * The three A.3/A.4 checkbox labels, all unchecked by default (§28.4).
 *
 * The required one is the 18+/US gate; the two optional ones are the Founder
 * marketing/research/survey consent and the Proovd newsletter — separate,
 * purpose-specific, never bundled. `[FOUNDER LEGAL NAME]` in the marketing
 * label is resolved with the same substitution as the body.
 */
export const AGE_US_CONFIRMATION_LABEL =
  'I confirm that I am at least 18 years old\nand that my billing location is in the United States.';
export const FOUNDER_MARKETING_CONSENT_LABEL =
  'I allow [FOUNDER LEGAL NAME] to\ncontact me for marketing, research, surveys, and other messages not required\nto fulfill or support this purchase, and to see my identifiable survey answers.';
export const NEWSLETTER_CONSENT_LABEL =
  "Send me Proovd's monthly newsletter about\nnew campaigns.";

/** A.3/A.4's action. Both use the same label. */
export const PREORDER_AUTHORIZE_ACTION = 'Authorize pre-order';

/**
 * Consent version. Bumped only when Appendix A.3/A.4 changes (§29.8's
 * reacceptance compares versions). The hash is computed by the caller over the
 * resolved text; the version identifies which template produced it.
 */
export const PREORDER_CONSENT_VERSION = '1.0';

export interface IdeaConsentVars {
  campaignTitle: string;
  founderLegalName: string;
  rewardPackageName: string;
  /** Formatted amounts, e.g. "25.00" — from `formatCents`, never raw cents. */
  rewardSubtotal: string;
  salesTax: string;
  totalAuthorized: string;
  /** The close instant, rendered as UTC copy, e.g. "March 3, 2026 5:00 PM UTC". */
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
  /** The exact text the Backer authorizes, to be stored and hashed (§25.2). */
  body: string;
  /** The resolved marketing-consent checkbox label (carries the Founder name). */
  marketingLabel: string;
  action: string;
  version: string;
}

/** Amount fields must be formatted; a marker or a raw integer is refused. */
function assertAmounts(pairs: ReadonlyArray<readonly [string, string]>): void {
  for (const [name, value] of pairs) {
    if (!FORMATTED_AMOUNT.test(value)) {
      throw new Error(`pre-order consent ${name} must be a formatted amount, got "${value}"`);
    }
  }
}

/** After substitution, no uppercase-led `[MARKER]` may survive (§19's trap). */
function assertResolved(text: string): void {
  const leftover = text.match(/\[[A-Z][^\]]*\]/);
  if (leftover) {
    throw new Error(`pre-order consent has an unresolved marker: ${leftover[0]}`);
  }
}

/** Resolves A.3 (Idea) with variables from the ledger. */
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
    // The Founder name marker wraps across a bullet continuation in one place.
    .replace(/\[FOUNDER LEGAL\s+NAME\]/g, vars.founderLegalName)
    .replaceAll('[REWARD PACKAGE NAME]', vars.rewardPackageName)
    .replaceAll('[REWARD SUBTOTAL]', vars.rewardSubtotal)
    .replaceAll('[SALES TAX]', vars.salesTax)
    .replaceAll('[TOTAL AUTHORIZED]', vars.totalAuthorized)
    .replaceAll('[CLOSE DATE — UTC]', vars.closeDateUtc)
    .replaceAll('[ORDER THRESHOLD]', vars.orderThreshold)
    // The descriptor marker wraps across a bullet's continuation indent.
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

/** Resolves A.4 (Product) with variables from the ledger. */
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
  const body = PRODUCT_CONSENT_TEMPLATE
    // The title and Founder-name markers wrap across lines in places.
    .replace(/\[CAMPAIGN\s+TITLE\]/g, vars.campaignTitle)
    .replace(/\[FOUNDER LEGAL\s+NAME\]/g, vars.founderLegalName)
    .replaceAll('[REWARD PACKAGE NAME]', vars.rewardPackageName)
    .replaceAll('[REWARD SUBTOTAL]', vars.rewardSubtotal)
    .replaceAll('[SALES TAX]', vars.salesTax)
    .replaceAll('[TOTAL AUTHORIZED]', vars.totalAuthorized)
    .replaceAll('[CLOSE DATE — UTC]', vars.closeDateUtc)
    .replaceAll('[DELIVERY MONTH/YEAR]', vars.deliveryMonthYear)
    .replaceAll('[POLICY TITLE / VERSION / EFFECTIVE DATE]', vars.policyReference)
    .replaceAll('[PRESERVED POLICY URL]', vars.preservedPolicyUrl)
    // The descriptor marker wraps across a bullet's continuation indent.
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
