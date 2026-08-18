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

/**
 * Rendered where the reference renders `You saved $0 by doing bonus tasks`.
 *
 * The walk found the prototype renders that line at zero, which tells somebody
 * who did none of the optional answers that doing them saved nothing. This is
 * the same beat said forward: what is still available, as a COUNT of answers
 * and the per-answer amount the server sends — never a total this browser
 * worked out (`founder-flow-v2.md` E2, Phase 09's rule).
 */
export const LISTING_FEE_STILL_LOWERABLE =
  'You can still bring this down. Each optional answer you complete takes the listing fee lower, right up until you pay.';

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
