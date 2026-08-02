/**
 * Appendix A.5 — the listing-fee consent. Exact text, Spec §13, §24.6.
 *
 * "Appendix A.5 is exact text. Not paraphrased, not 'improved', not shortened"
 * (Phase 11's trap). It sits beside §7's NO_GUARANTEE_TEXT and §8's two
 * invitation constants for the same reason those exist: an editable promise is
 * one that gets softened under pressure, and this one is a refund promise with
 * money attached.
 *
 * ── Variables come from the ledger, never recomputed for display ────────────
 * Appendix A's own rule: "Variables must come from the same versioned domain
 * records used by the ledger." [SUBTOTAL] is the stored listing-fee
 * calculation's subtotal; [TOTAL] is that subtotal plus the stored Stripe Tax
 * calculation's tax. The server resolves both and the surface renders what it
 * was given — there is no arithmetic on a fee anywhere in the frontend
 * (Phase 09's rule, unchanged).
 *
 * ── Why the total is knowable before Checkout ───────────────────────────────
 * Sales tax depends on the Founder's billing address, so the pre-payment
 * surface collects it, the server creates a Stripe Tax calculation (stored
 * under §32.4 with its ID and expiry), and the Checkout session charges exactly
 * the total this consent named. If that calculation cannot be made, the consent
 * cannot render and payment is not offered — a total the Founder was never
 * shown must never be charged (the §19/§21 rule, applied to Proovd's own fee).
 */

/** The consent body, verbatim from Appendix A.5. Two paragraphs. */
export const LISTING_FEE_CONSENT_TEMPLATE = `By clicking Agree and Pay, you agree to pay Proovd LLC a one-time
listing fee of US$[SUBTOTAL] plus applicable sales tax, for a total of
US$[TOTAL], and you agree to our Terms of Service, Acceptable Use
Policy, Refund Policy, Fulfillment Policy, and Privacy Policy. Your
statement will show "PROOVD LISTING." Questions: support@proovd.co.

Proovd will refund the entire amount charged at this Checkout — the
listing-fee subtotal plus the associated sales-tax reversal or
correction — if no eligible campaign-specific Creator is recruited,
or if no Creator and Founder mutually accept locked campaign terms
within 72 hours after this payment succeeds. A pending proposal does
not pause or extend that deadline. The same full refund applies if a
required launch Creator later fails and Proovd does not make a fully
ready replacement available within three U.S. business days after the
failure is recorded.`;

/**
 * A.5's one optional consent. Unchecked by default, and §28.4 keeps it its own
 * control — never bundled into the payment action.
 */
export const LISTING_FEE_NEWSLETTER_LABEL =
  "Send me Proovd's monthly newsletter about new campaigns.";

/** A.5's action. [TOTAL] resolves to the same value as in the body. */
export const LISTING_FEE_PAY_ACTION_TEMPLATE = 'Agree and Pay US$[TOTAL]';

/**
 * §13's pre-payment surface also states, outside the consent text, that a
 * pending proposal is not acceptance — the brief: "State that plainly in the
 * surface, not just in the consent."
 */
export const PENDING_PROPOSAL_NOTE =
  'A pending proposal is not acceptance and does not pause or extend the 72-hour deadline.';

/**
 * §13: "Separate explanation that Proovd later retains 5% of captured campaign
 * reward subtotal." Separate from the fee lines and from the consent, because
 * §24.6 makes the listing fee its own stream and §12 says the 5% is "separate
 * and unchanged".
 */
export const SEPARATE_FIVE_PERCENT_NOTE =
  'Separately from this listing fee, Proovd retains 5% of the captured campaign reward ' +
  'subtotal if your campaign succeeds. That percentage is unchanged by anything on this page.';

export interface ResolvedListingConsent {
  body: string;
  action: string;
}

/**
 * Resolves [SUBTOTAL] and [TOTAL] from formatted amounts (e.g. "25.00").
 *
 * Takes strings rather than cents so the resolver has no money arithmetic of
 * its own — the caller formats the ledger's values with `formatCents` and this
 * only substitutes. Refuses a value that still looks like a marker, because a
 * consent rendered with a bracket in it is a consent to nothing.
 */
export function resolveListingFeeConsent(input: {
  subtotal: string;
  total: string;
}): ResolvedListingConsent {
  for (const [name, value] of Object.entries(input)) {
    if (!/^\d{1,3}(,\d{3})*\.\d{2}$/.test(value)) {
      throw new Error(`listing consent ${name} must be a formatted amount, got "${value}"`);
    }
  }
  return {
    body: LISTING_FEE_CONSENT_TEMPLATE.replaceAll('[SUBTOTAL]', input.subtotal).replaceAll(
      '[TOTAL]',
      input.total,
    ),
    action: LISTING_FEE_PAY_ACTION_TEMPLATE.replaceAll('[TOTAL]', input.total),
  };
}
