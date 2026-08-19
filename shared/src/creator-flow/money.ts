/**
 * The Creator's Earnings address — Creator Flow v2 **deviation 5**, Session F,
 * 2026-08-20.
 *
 * ═══ ONE SOURCE, MANY RENDERERS (§33.8.13) ══════════════════════════════════
 *
 * §22.1's seven earnings states and Appendix B.7's block already have exactly
 * one resolver — `resolveAffiliateMoneyStatus`, which throws on an unfilled
 * bracket — and one record, `creator_earnings`, whose amounts are trigger-
 * immutable. This screen adds an ADDRESS, not a second computation: it lists
 * what each campaign's own close view already says, and the F4 consistency
 * pass deep-compares the two.
 *
 * There is no arithmetic in this file and none on the surface that renders it.
 * §24.4's split is three separate stored numbers — finalized commission, earned
 * bonus, eligible fixed amount — and the reference's `earned * 0.8` /
 * `earned * 0.2` is browser arithmetic with invented weights, refused in
 * `CREATOR_FLOW_ABSENCES`.
 *
 * ── Why an account-level address needed a deviation ────────────────────────
 * §26: *"The Admin panel is the only dashboard-style product in MVP."* The Spec
 * gives the Creator four named surfaces and no money page. What is built is a
 * list, not a widget grid: one row per campaign, each row the B.7 block that
 * campaign's own surface renders, plus a lifetime total that is a sum of
 * recorded rows and never an estimate.
 */

/**
 * Pinned. The eyebrow where the reference put `Ready to withdraw`.
 *
 * §22.1's own sentence is the reason there is no control beneath it, and this
 * is what stands in the place a person's eye goes first.
 */
export const CREATOR_EARNINGS_TITLE = 'What you have earned';

/**
 * Pinned. Renders under the lifetime figure.
 *
 * §16a: not yet populated is not zero. A Creator whose campaigns have not
 * closed has earned nothing *yet*, and a bare `US$0.00` in a hero reads as a
 * judgement rather than a stage.
 */
export const CREATOR_EARNINGS_LIFETIME_LABEL = 'Recorded across every campaign';

/**
 * Pinned. Renders instead of a total when no campaign has finalized.
 *
 * The reference's `Pending: None` is the state this replaces — `None` is what a
 * surface says when it has looked and found nothing, and that is not the same
 * fact as a campaign that has not closed yet (§1.4).
 */
export const CREATOR_EARNINGS_NOTHING_RECORDED =
  'Nothing has been recorded yet. Earnings are worked out after a campaign closes and its charges settle — until then there is no number to show you, which is different from the number being zero.';

/**
 * Pinned. Renders where the reference put the withdrawal explainer.
 *
 * True, and §11's own posture: Proovd holds a status and an account id and
 * never the details behind them.
 */
export const CREATOR_EARNINGS_PAYOUT_IS_STRIPES =
  'Money reaches you through the payout account you set up with Stripe. Your bank details and your W-9 live there; Proovd never sees or stores them.';

/**
 * Pinned. Renders once, above the list.
 *
 * §30 forbids public leaderboards and nothing in this read touches another
 * association's rows — but the Home screen does carry a standing, and a person
 * arriving here from it should be told plainly that the two are unrelated.
 */
export const CREATOR_EARNINGS_IS_NOT_A_RANKING =
  'These are your own numbers. Nothing here is compared to anybody else, and nothing anybody else sees is worked out from them.';

/**
 * Pinned. Renders on a row whose campaign has closed but not finalized.
 *
 * §22.1 finalizes after the retry window; the estimate is the locked percentage
 * over the captured, validly attributed, pre-tax subtotal. Calling it final
 * early is the failure this sentence exists to prevent.
 */
export const CREATOR_EARNINGS_ESTIMATE_IS_NOT_FINAL =
  'This is worked out from what was actually charged and attributed to your link. It is not final until Proovd has finished reconciling the campaign.';
