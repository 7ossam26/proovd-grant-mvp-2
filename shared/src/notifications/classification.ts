/**
 * Which §27 messages are money messages, and which carry a deadline — Spec
 * §27.1, §27.2, §3.3.
 *
 * §27.2's money rule and §27.1's timezone rule both apply to *some* messages,
 * and neither section says which. A judgement made at each call site is a
 * judgement thirty senders make differently, so it is made once here and the
 * coverage suite reads it: a key classified `charge` owes a seller and a
 * descriptor whether or not the person writing its template remembered, and a
 * key classified as carrying a deadline owes a spelled-out timezone.
 *
 * The registers are deliberately *not* exhaustive over the key set. A key
 * absent from `MONEY_MESSAGE_CLASS` is not "not about money" — it is a message
 * whose money content varies by the record behind it, and §26.7's
 * suspension/kill notices are the clear case: the same key carries "nothing was
 * charged" before capture and "your charge stands" after. Forcing those into a
 * single class would make the register assert something untrue for half the
 * sends. They are still bound by every other §27.2 rule.
 *
 * Phase 22a classifies the keys that have senders. 22b classifies each new
 * message as it gains one — the coverage suite is what makes that non-optional
 * for a money message, because a money template that satisfies no class is
 * indistinguishable from a money template nobody classified.
 */

import type { MoneyMessageClass } from './contract.js';
import type { NotificationEventKey } from './registry.js';

/**
 * §27.2's money messages, by class. See `contract.ts` for why the classes are
 * four rather than one.
 */
export const MONEY_MESSAGE_CLASS: Partial<Record<NotificationEventKey, MoneyMessageClass>> = {
  /* ── Money off a card, now ─────────────────────────────────────────────── */
  backer_charge_receipt: 'charge',
  backer_retry_success: 'charge',
  // The B.5 recovery: the charge is the subject of the message even though it
  // has not landed. It names the amount, the seller, and what the statement
  // will show, because the Backer is being asked to let it complete.
  backer_charge_failed_update_card: 'charge',
  founder_listing_fee_receipt: 'charge',

  /* ── Money off a card, later ───────────────────────────────────────────── */
  // §30's two most sensitive messages: both name a future charge in full and
  // both must say, in words, that nothing has been charged yet.
  backer_preorder_confirmation: 'scheduled',
  backer_precharge_reminder: 'scheduled',

  /* ── Money toward someone ──────────────────────────────────────────────── */
  backer_refund_started: 'payout',
  backer_refund_completed: 'payout',
  backer_refund_failed: 'payout',
  founder_listing_fee_refund: 'payout',
  founder_single_payment_released: 'payout',
  founder_first_payment_released: 'payout',
  founder_remaining_payment_released: 'payout',
  founder_w9_block: 'payout',
  founder_payment_blocked: 'payout',
  founder_early_remaining_result: 'payout',
  affiliate_commission_finalized: 'payout',
  affiliate_transfer_created: 'payout',
  affiliate_transfer_failure: 'payout',
  affiliate_transfer_reversal: 'payout',
  affiliate_payout_paid: 'payout',
  affiliate_payout_failed: 'payout',

  /* ── Money that did not move and will not ──────────────────────────────── */
  backer_cancellation_confirmation: 'no_charge',
  backer_threshold_miss_no_charge: 'no_charge',
  backer_retry_dropped: 'no_charge',
};

/**
 * §27.1: "deadline emails spell out timezone". These are the messages that
 * render a moment a reader has to act before. An ISO string ending in `Z` is
 * canonical UTC but does not spell anything out — the check is for a named
 * zone, because the person reading it at 22:00 in Denver is the reason the
 * rule exists.
 */
export const DEADLINE_MESSAGE_KEYS: readonly NotificationEventKey[] = [
  // The charge date the Backer may still cancel before (§19, §20).
  'backer_precharge_reminder',
  // Appendix B.5's retry-window deadline, after which the pre-order is canceled.
  'backer_charge_failed_update_card',
  // §29.4's five-business-day appeal deadline.
  'affiliate_warning',
  'affiliate_suspension',
  // §29.8's reacceptance deadline.
  'affiliate_policy_reacceptance',
  // The Admin queue's own due times (§27.6).
  'internal_day_14_due',
  'internal_money_decisions_due',
  'internal_dispute_opened',
  // `internal_deliverable_verification_due` is deliberately absent. It says
  // work is due *now* — the schedule has reached the first payment day and
  // some Creator associations have no completion decision — and carries no
  // future instant to act before. Demanding a timezone would push the sender
  // to invent a deadline §22.1 does not state.
];

export function moneyClassFor(key: NotificationEventKey): MoneyMessageClass | undefined {
  return MONEY_MESSAGE_CLASS[key];
}

export function carriesDeadline(key: NotificationEventKey): boolean {
  return DEADLINE_MESSAGE_KEYS.includes(key);
}
