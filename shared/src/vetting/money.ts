/**
 * The two money screens' own registers — Founder Flow v2, Session E, 2026-08-19.
 *
 * Screens 25 and 20: Stripe payout setup, then the listing fee. Both are gates,
 * and the order is not a preference — `beginListingCheckout` refuses without a
 * complete `founder_seller` account, so a fee screen reached first is a fee
 * screen whose only path is the refusal (`founder-flow-reconciliation.md` §1,
 * move 2).
 *
 * ── Why the Prepare list is a register and not three lines of JSX ───────────
 * It is a statement about what a THIRD PARTY will ask for, on the one screen
 * where the difference between "Stripe asks for this" and "type it here" is the
 * whole of §11, §5.3 and §13. Written inline it is three strings a later
 * session can turn into three labels with three inputs under them without
 * anything failing. Written here, beside the sentence that says Proovd collects
 * none of it, adding an input means deleting a promise — and a test asserts the
 * page renders no input at all.
 *
 * ── Nothing here is an amount ───────────────────────────────────────────────
 * The reference hardcodes `FEE_BASE=35`, `FEE_PER=2`, `FEE_FLOOR=25` and
 * derives `Discount $10 by completing tasks` in the browser. All four are §6
 * settings and every amount the fee screen renders is a decimal string of
 * integer cents the server computed. There is no number in this file.
 */

/* ── Screen 25: what Stripe will ask for ──────────────────────────────────── */

export interface StripePrepareItem {
  key: 'identity' | 'bank' | 'tax';
  /** The reference's own wording, kept — it is plain and it is accurate. */
  label: string;
  /** Why Stripe wants it. One line, and it stops. */
  why: string;
}

/**
 * §13's hosted onboarding, previewed.
 *
 * Not a form, and not a checklist that tracks anything: it is what a person
 * should have to hand before they leave for Stripe, so that they leave once
 * rather than three times. Proovd never learns whether any of it was supplied —
 * only whether Stripe says the account is ready (§5.3: statuses and IDs, never
 * full bank details).
 */
export const STRIPE_PREPARE_ITEMS: readonly StripePrepareItem[] = [
  {
    key: 'identity',
    label: 'A government ID',
    why: 'Stripe has to know who is being paid before it can pay anyone.',
  },
  {
    key: 'bank',
    label: 'Your US bank account details',
    why: 'Where your campaign money lands. It goes to your account, never through one of ours.',
  },
  {
    key: 'tax',
    label: 'Your SSN or EIN if you have a business',
    why: 'Stripe reports your earnings to the IRS, so it needs the number that identifies you.',
  },
];

/**
 * Pinned, and it sits WITH the list rather than under it.
 *
 * §11 forbids reproducing provider-controlled fields; §5.3 says Proovd stores
 * statuses and IDs and "never full bank details"; §13 forbids storing identity
 * documents. A list of things somebody is about to be asked for, on a page from
 * a company that is not the one asking, needs that said in the same breath or
 * it reads as the start of a form.
 */
export const PAYOUT_PREPARE_COLLECTS_NOTHING =
  'Stripe asks for these, not Proovd. Nothing on this page collects them, and we never see or store them — only whether Stripe says your account is ready.';

/**
 * Why this comes before the fee, said once, on the screen it constrains.
 *
 * §13's own order, and §23.1's: `stripe_onboarding_pending` precedes
 * `listing_fee_pending`. Somebody who came here to pay a listing fee and met a
 * Stripe handoff instead is owed the reason.
 */
export const PAYOUTS_BEFORE_FEE =
  'This comes first because your campaign takes payments through your own Stripe account. Until that exists there is nothing for a listing fee to attach to.';

/* ── Screen 20: the listing fee ───────────────────────────────────────────── */

/* ── Screen 20's own copy, rebuilt 1:1 from the reference (2026-08-21) ─────
   The prototype builds three of the five stage strings from `FEE_BASE`,
   `FEE_FLOOR` and `FEE_PER`:

     paySavedText   : 'You saved $'+(FEE_BASE-fee())+' by doing bonus tasks'
     payDiscountText: 'Discount $'+(fee()-FEE_FLOOR)+' by completing tasks'
     the hero       : '$'+fee()

   The sentences are the reference's copy and ship verbatim; the amounts are
   the server's, because all four of its constants are §6 settings (Phase 06:
   "a hardcoded duration is a bug even when the number is right"). Each takes
   an ALREADY-FORMATTED amount — no function here does arithmetic, and none
   takes cents, so there is nothing in this file for a later session to
   subtract. */

/**
 * `paySavedText`. The reference's own sentence, at whatever the saving is.
 *
 * DELIBERATELY INVERTED (2026-08-21). Session E refused this line at zero —
 * "telling somebody who completed none of the optional answers that they saved
 * nothing is the report they least need on the screen where they can still
 * change it" — and rendered {@link LISTING_FEE_STILL_LOWERABLE} in its place.
 * That was a judgement rather than a Spec rule, and the 1:1 rebuild reverses
 * it by product direction: the supplied screenshot shows `You saved $0 by
 * doing bonus tasks` and the reference's copy is the specification on these
 * pages. The sentence is true at every value, and what a Founder can still do
 * about it is the line immediately below it.
 */
export const payoutSavedLine = (savedAmount: string): string =>
  `You saved ${savedAmount} by doing bonus tasks`;

/**
 * `payDiscountText`, on the control that goes back to Last look.
 *
 * The amount is the server's `remainingDiscountCents`, not `subtotal − floor`:
 * §12 applies a cap AND a floor, and the reference's subtraction is those two
 * coinciding on its own three constants rather than the rule
 * (`workspace/listing-fee.ts`, `lowestReachableSubtotal`).
 */
export const payoutDiscountLine = (remainingAmount: string): string =>
  `Discount ${remainingAmount} by completing tasks`;

/* `LISTING_FEE_STILL_LOWERABLE` stood here and is DELETED (2026-08-21). It was
   Session E's replacement for the reference's `You saved $0 by doing bonus
   tasks`; the 1:1 rebuild reinstates that line by product direction, so this
   had no renderer left, and an exported string nothing renders is dead code
   that ships in every browser. The reversal is recorded on `payoutSavedLine`.
   {@link LISTING_FEE_AT_THE_FLOOR} stays — it is rendered on the pay sheet. */

/**
 * Rendered once the five are in.
 *
 * §16a's rule in a Founder's own words: "nothing more to add" and "we have not
 * looked yet" are different facts, and only one of them is worth saying.
 */
export const LISTING_FEE_AT_THE_FLOOR =
  'Every optional answer is in, so this is as low as the listing fee goes.';

/**
 * Rendered above the billing fields.
 *
 * A.5 names an exact `US$[TOTAL]`, and an exact total needs an address to tax
 * against. Asking for one without saying why, on a payment screen, reads as
 * data collection for its own sake.
 */
export const LISTING_FEE_ADDRESS_FIRST =
  'Sales tax depends on where you are billed, so we work out your exact total before you agree to anything.';

/**
 * Rendered on the paid state.
 *
 * §12: "After payment, the calculation and evidence snapshot lock." A Founder
 * who goes back to an optional answer afterwards must not expect a refund of
 * the difference, and the sentence that prevents that has to be on the screen
 * that shows what they paid.
 */
export const LISTING_FEE_LOCKED_AFTER_PAYMENT =
  'What you paid is fixed. Changing an optional answer now still improves your campaign, but it does not change this amount.';

/**
 * Rendered when Stripe Checkout sends somebody back without paying.
 *
 * §30 forbids a generic error without money status. "Nothing was charged" is
 * the only fact that matters at that moment, and it belongs before anything
 * else on the screen.
 */
export const LISTING_FEE_CHECKOUT_CANCELED =
  'You came back without paying, and nothing was charged. Your campaign and every answer are exactly as you left them.';

/* ── The pay sheet: what the reference has no room for ────────────────────
   The reference's `payAndStart` advances a step. Ours opens a charge, and §13
   requires a billing address, a real Stripe Tax total, the itemisation, the
   descriptor and Appendix A.5 verbatim before anybody agrees to anything.

   None of that fits the fee screen's composition, and putting it there would
   change the one thing this rebuild exists to reproduce. So it is a sheet over
   the stage, drawn in the reference's OWN card vocabulary — `[data-pay-modal]`
   on the adjacent `[data-paypick]` screen: a 720px card, a 3px brand border, a
   2px radius, over a `rgba(1,63,23,.35)` scrim, entering with its `payModalIn`
   tween. Borrowed rather than invented, which is what keeps a screen the
   reference does not draw inside its design language. */

/** The sheet's eyebrow, in the reference's `Upfront fee` slot. */
export const PAY_SHEET_EYEBROW = 'Listing fee';

/**
 * Above the two billing fields.
 *
 * A.5 names an exact `US$[TOTAL]`, and an exact total needs an address to tax
 * against. Asking for one without saying why, on a payment screen, reads as
 * data collection for its own sake — {@link LISTING_FEE_ADDRESS_FIRST} says it
 * on the sheet the address is asked on.
 */
export const PAY_SHEET_ADDRESS_HEAD = 'Where are you billed?';

/**
 * On the first step of the sheet, under the one control.
 *
 * §30: a payment state says what the control does to the money. This one does
 * nothing to it, and somebody who has just pressed `Pay & Start` is owed that
 * before they type a postcode.
 */
export const PAY_SHEET_NOTHING_CHARGED_YET =
  'Nothing is charged by this. It works out your sales tax so we can show you the exact total to agree to.';

/** The sheet's second step, above the itemisation. */
export const PAY_SHEET_TOTAL_HEAD = 'Your total';
