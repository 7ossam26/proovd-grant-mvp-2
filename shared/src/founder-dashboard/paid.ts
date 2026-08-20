/**
 * Chapter 3, Get paid — Founder Dashboard Session E.
 *
 * `docs/phases/founder-dashboard.md`. Everything between the campaign closing
 * and the money being out: §21's retry window, §22.3's W-9 and payment
 * schedule, §22.4's Day 14 Progress Check, and §22.5's four obligations.
 *
 * ── The chapter is a RENDERER, and that is the whole design ────────────────
 * §33.8.13 is one source and many renderers. `readFounderPaymentStatus` is the
 * one place §22.3's status is composed — the exact amount affected, the
 * requirement or blocker by name, the secure action, the W-9 state, the next
 * review date, and `No action needed` while under review — and the Admin queue
 * reads the same view. So nothing in this chapter adds up a number, takes a
 * percentage of one, or subtracts one from another; a number that appears here
 * arrived from the server already resolved, and a test scans the source.
 *
 * The reference does the opposite, in the open:
 *
 *     function payoutFigures(){
 *       const gross=12840, aff=2760, proovd=385;
 *       return { gross, aff, proovd, net:gross-aff-proovd, … };
 *     }
 *     …money(Math.round(f.net*.4))… money(Math.round(f.net*.6))…
 *
 * Three things are wrong with that beyond it being a mock. §22.3's eligible
 * share subtracts five terms and the reference has three — the §24.8
 * cause-based adjustments and the §24.5 allocated Stripe fees are simply gone.
 * The remaining payment is **the exact remainder** (§33.8.11: first + remaining
 * = the share, to the cent), never an independent 60% floor beside a rounded
 * 40% one. And a browser that computes the split is a second answer to what
 * somebody is owed, which is the disagreement §33.8.13 exists to prevent.
 *
 * ── §22.3 has no Founder request, and that is the largest refusal here ─────
 * The reference's spine is `Request payment` → `In review` → `Paid ✓`, with
 * `Request 40%`, `Request the rest`, and `With Proovd rep` beside them. §22.3
 * has no such control: the payment objects are created by the schedule sweep
 * on the §6 day, and releasing one is Proovd's recorded decision. The ONE ask
 * a Founder makes about money is the early remaining release — Product-only,
 * behind a §6 setting that ships disabled, gated on four recorded proofs.
 *
 * A `Request payment` button would tell a Founder their money is waiting on
 * them when it is not (§1.4), and on an Idea single payment there is nothing
 * for it to request at all.
 */

/* ── §21: the retry window, as a Founder reads it ─────────────────────────── */

/**
 * §21's window is read from the §6 `capture_retry_window_hours` setting at
 * batch start, stored on the batch row, anchored on the FIRST failure by a
 * conditional UPDATE, CHECK-pinned to `first_failure_at + hours`, and refused
 * any later edit by trigger. Three mechanisms, so the instant a Founder is
 * shown is the instant the batch will actually act on.
 *
 * The reference calls it a "Three-day card retry window" and then reuses the
 * same three days as the payout eligibility gate (`S.campaignDay>=3`). Those
 * are two different clocks: §22.1's Day 3 is the anchor for the Creator
 * Transfer, and §22.3's payment days come from their own §6 settings. Fusing
 * them makes both wrong on any deployment that changes either setting.
 */
export const RETRY_WINDOW_IS_STORED =
  'This window was set when your campaign closed and cannot be moved. Nothing about your final numbers is settled until it ends.';

/**
 * §21: a recovery inside the window counts as captured; anything still failing
 * at the deadline drops at US$0 — no revenue, no Creator commission, no share.
 */
export const RETRY_WINDOW_OUTCOME =
  'A card that clears inside this window counts exactly as if it had cleared at close. Anything still failing when it ends is closed at US$0.00 — no charge, no commission, and nothing owed to you for it.';

/* ── §22.3: what a Founder may and may not ask for ────────────────────────── */

/**
 * §22.3's schedule is created by the `founder-payment-schedule` sweep and
 * released by Proovd. There is no request route for a scheduled payment and no
 * column that could hold one, so this sentence renders where the reference put
 * three buttons.
 */
export const NO_PAYMENT_REQUEST =
  'You do not request these. Each payment is created on its own date and released by Proovd once its requirements are met — the list below names anything still outstanding.';

/**
 * §33.8.11. The remaining payment is computed as `eligible share − first
 * payment`, and a 0031 shape trigger refuses a row that is not the exact
 * remainder of its released sibling.
 */
export const REMAINING_IS_THE_EXACT_REMAINDER =
  'The remaining payment is whatever is left of your eligible share after the first one — not a second percentage of it, so the two always add up to the whole.';

/**
 * §11 and §13: Proovd holds a status and an identifier and never the documents
 * behind them, and no Proovd column can take a taxpayer identification number
 * (the 0015 CHECK, reapplied on the 0031 W-9 record). Receipt is an Admin's
 * recorded fact rather than a Founder self-assertion (§12's rule).
 *
 * The reference draws `<input type="file" accept=".pdf,.png,.jpg,.jpeg">` with
 * a "W-9 uploaded." toast. There is no such route, no such column, and R2 is
 * unconfigured besides (Track A4) — so the control would be a promise nothing
 * behind it can keep.
 */
export const W9_IS_NOT_UPLOADED_HERE =
  'Your W-9 does not go through this page. Follow the secure instructions in your W-9 request message — Proovd records that it arrived and that it checked out, and never stores your tax number.';

/* ── §22.4: the Day 14 Progress Check ─────────────────────────────────────── */

/**
 * §22.4's review is anchored on `campaign_close_at + 14 days` — the campaign's
 * own instant, applying to EVERY campaign including Idea ones, whose §6
 * payment day is 3. The reference anchors it on the payout ("Fourteen days
 * after payout, Proovd asks for a progress update"), which for a Product
 * campaign would put it after the first payment and for an Idea campaign
 * eleven days later than it is.
 */
export const DAY_14_IS_ANCHORED_ON_CLOSE =
  'Day 14 counts from the day your campaign closed, not from when a payment landed. It happens to every campaign.';

/**
 * §22.4: the submission is a durable receipt with its own reference, and a
 * resubmission is a NEW receipt rather than an edit — the tables have no
 * UPDATE and no DELETE grant.
 */
export const DAY_14_RECEIPT_IS_KEPT =
  'Everything you send is kept with its own reference and the date we owe you a decision. Sending more later adds a second receipt; it never replaces the first.';

/**
 * §22.4's clarification window is five business days on the committed
 * calendar, and not answering inside it is one of the recorded failure
 * reasons. Phase 21a built the response route; until Session E there was no
 * control anywhere that reached it.
 */
export const CLARIFICATION_IS_ANSWERED_HERE =
  'Answer here. This is the same record Proovd reads, so a reply by email is not a reply to this.';

/* ── §22.5 ─────────────────────────────────────────────────────────────────── */

/**
 * §22.5's obligations run from the charge to delivery, and the cadence stops
 * at delivery rather than at payment. §22.7's ban has four defined triggers,
 * every one of them a recorded fact — `ghostBanTriggersMet` returns the met
 * triggers and `recordGhostBan` refuses any trigger not among them.
 *
 * The reference threatens the ban twice as a consequence of one missed step
 * ("Ghosting this request bans the account", "if you ghost, the account is
 * banned and the held money is returned to backers"). A Day-14 failure blocks
 * the unreleased remaining payment; recovering anything already released is an
 * Admin-recorded §24.8 case and never an automatic reversal.
 */
export const OBLIGATIONS_ARE_RECORDED_NOT_THREATENED =
  'Missing one of these has a stated consequence rather than a general one. A failed Day 14 review blocks a remaining payment that has not gone out; nothing already paid is taken back automatically.';

/* ── What the reference draws that this chapter does not ──────────────────── */

export interface PaidAbsence {
  /** A stable id, so a test can walk the register against the rendered chapter. */
  readonly id: string;
  /** What the reference puts here. */
  readonly reference: string;
  /** The sentence the chapter renders where the control would have been. */
  readonly sentence: string;
  readonly specRef: string;
}

/**
 * `LIVE_ABSENCES`' arrangement, applied to Chapter 3. Re-adding one of these
 * means deleting the sentence that refuses it, which is a visible edit.
 */
export const PAID_ABSENCES: readonly PaidAbsence[] = [
  {
    id: 'payment_request',
    reference:
      '“Request payment”, “Request 40%”, “Request the rest”, and the “In review” step a Founder waits through after pressing one.',
    sentence: NO_PAYMENT_REQUEST,
    specRef: '§22.3, §1.4',
  },
  {
    id: 'net_arithmetic',
    reference:
      '“Gross raised / Affiliate cut / Proovd cut / Net to you”, computed in the browser as `gross − aff − proovd`, then split as `net × 0.4` and `net × 0.6`.',
    sentence:
      'These amounts come from your campaign’s own record, already worked out. Nothing on this page does the arithmetic, so what you read here is what the payment will be.',
    specRef: '§33.8.13, §22.3',
  },
  {
    id: 'w9_upload',
    reference: '“Choose W-9” — a file input, with a “W-9 uploaded.” confirmation.',
    sentence: W9_IS_NOT_UPLOADED_HERE,
    specRef: '§11, §13, §22.3',
  },
  {
    id: 'delivery_proof_upload',
    reference: '“Upload proof of delivery” — a file input that unlocks the remaining payment.',
    sentence:
      'There is nowhere to attach a file yet. Describe what backers can actually reach and how you told them; that is the record Proovd reviews.',
    specRef: '§22.4, §12, Track A4',
  },
  {
    id: 'held_balance',
    reference:
      '“before it leaves the held balance” and “the held money is returned to backers”.',
    sentence:
      'Proovd does not sit on your money. Your backers’ cards are charged on your own payment account, and a payment is either released to you or blocked for a stated reason.',
    specRef: '§3.2, §24.1',
  },
  {
    id: 'ghost_ban_threat',
    reference:
      '“Ghosting this request bans the account.” attached to the 14-day update, and again to delivery proof.',
    sentence: OBLIGATIONS_ARE_RECORDED_NOT_THREATENED,
    specRef: '§22.7, §22.4, §24.8',
  },
  {
    id: 'three_day_retry',
    reference:
      '“Three-day card retry window”, reused as the payout eligibility gate (`campaignDay >= 3`).',
    sentence: RETRY_WINDOW_IS_STORED,
    specRef: '§21, §6',
  },
];

export function paidAbsence(id: string): PaidAbsence {
  const found = PAID_ABSENCES.find((a) => a.id === id);
  if (!found) throw new Error(`no Get paid absence '${id}'`);
  return found;
}
