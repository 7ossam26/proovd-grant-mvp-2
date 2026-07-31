# Phase 18 — Close, capture, and recovery

**Model:** Fable 5 — The single most dangerous phase in the plan. A batch that isn't truly idempotent double-charges real people, and the failure only appears in production under a duplicate webhook or a worker restart.

**⚠ Split this phase if context runs out.** Natural seam: **18a** = the close batch, threshold resolution, tax validation, capture. **18b** = the 48-hour retry window, recovery surfaces, results preparation, reconciliation. Twelve named tests.

**Goal:** at exactly `campaign_close_at` the outcome is fixed, eligible cards are charged for exactly the amount consented to, failures enter a bounded recovery window, and running any of it twice changes nothing.

---

## Read first

- Spec §21 — Phase 15, in full
- Spec §24.2 — SetupIntent to off-session PaymentIntent
- Spec §24.3 — the money waterfall
- Spec §4.1 — the Idea threshold decision at close
- Spec **Appendix B.5** — failed-payment copy
- Spec §32.3 — webhook events and idempotent processing
- Spec §23.1 and §23.5 — the close-related lifecycle and reservation states

---

## Prerequisites

Phase 15 green — reservations, stored tax calculations, and SetupIntents exist. Phase 17 green — duplicate cases have been worked before close. Phase 03's `idempotency_keys` and `provider_events` are the backbone of this entire phase.

---

## Scope — 18a

### 1. Time anchors

`campaign_close_at` ends cancellation and Affiliate joining, fixes the Idea threshold, starts capture and retry, and anchors Day 3 and Day 14. **Never inferred from a generic create or update timestamp.**

### 2. The close batch

At exactly `campaign_close_at`:

1. **Lock** active reservations.
2. **Exclude** canceled and ineligible reservations.
3. **Stop** new Affiliate associations and Backer cancellation.
4. For Idea: **resolve pending duplicate cases** and calculate unique active Backers.
5. **If the Idea threshold is missed:** create **no** PaymentIntent; set reservations `threshold_not_met_no_charge`; remove future-charge eligibility and reference-safely detach payment methods; send the $0 no-charge closure; set the campaign `ended_no_charge`.
6. **If the threshold is met, or the campaign is Product:** set eligible reservations `pending_capture`. For each, **validate the stored tax calculation, the Founder/reward/location association, expiry and usability, and the exact amount.**
   - **If unusable:** create no PaymentIntent, set `capture_failed_dropped` with reason `tax_calculation_unusable`, and notify Backer, Founder, and Admin. **Never substitute a different total.**
   - **Otherwise:** create **one** off-session PaymentIntent for the exact authorized total, under a **stable reservation and attempt idempotency key**. Store the PaymentIntent, charge, and result.
7. Send receipts on success and recovery messages on failure.
8. Open **one** fixed 48-hour retry window from the **first close-batch failure**.

> **Running the batch twice, receiving duplicate webhooks, or a worker crash and restart cannot create duplicate charges, fees, earnings, state transitions, or messages.**

That sentence is the phase. Design for it first — a batch that produces correct results on a clean run and duplicates on a retry has failed entirely.

### 3. The Idea threshold decision

Made from **active unique Backers exactly at close**, using the Phase 15 deduplication decisions. `threshold reached` and `threshold lost` may have fired many times before close and are separate idempotent events; **only the state at close counts.**

**If at or above threshold, the outcome remains successful even when cards later fail.** The Founder proceeds with actually collected money after the retry window. Payment failures never reverse a successful threshold outcome.

**Product campaigns charge every active transaction regardless of the internal target.** Keep-what-you-raise — missing an internal target triggers no refunds and no cancellation.

### 4. Successful capture

Reservation becomes `captured`. Reward subtotal, tax, total captured, Proovd fee, provisional Creator percentage liability, Founder gross share, Stripe fee, attribution, and charge context are **separate ledger fields** — the Phase 03 columns.

The Backer receives a campaign-aware confirmation **in addition to** any provider receipt: Founder, campaign, reward, total, descriptor, delivery, magic link, and support.

**Captured money, not saved reservations, drives final revenue and commission.**

---

## Scope — 18b

### 5. Failed-payment recovery

States: `capture_failed_retrying` → either `captured` or `capture_failed_dropped`.

The Backer email and magic-link state (Appendix B.5) carry: a plain-language outcome, **whether any money moved**, campaign, reward, subtotal, tax, total attempted, the retry deadline in local time with UTC, and **one** `Update card` action.

**Neutral, non-shaming copy.** A raw decline code may appear only as secondary support detail, never as the message.

Updating the card and retrying **preserves reservation, reward, survey, and consent context** and is idempotent. `requires_action` routes to a customer-action recovery surface rather than silently succeeding or silently failing.

At the retry window's end: successful recoveries count as captured; remaining failures become **dropped** and count as **no** collected revenue, **no** Creator commission, and **no** Founder share. The Idea campaign remains successful if the threshold was met at close. **Reconciliation begins only after the window closes.**

### 6. Results preparation

**`Campaign ended` fires at close. `Results ready` fires only after charge, retry, and reconciliation results are prepared.** They are separate notifications and separate events (§33.7.11).

Founder results contain: pre-orders placed and captured; unique Backers and Product transaction and unit counts; reward subtotal, tax, and total captured **separately**; failed, recovered, and dropped payments; conversion and drop-off; survey answers according to consent; per-Creator performance; organic, house, and Creator-attributed revenue; Creator-specific bonus results; finalized Creator percentage and fixed-payment status; and a plain-language strongest signal, weakest signal, leading survey reason, and **what the result does and does not prove** — reviewed by Admin to avoid false causality.

The Creator close surface shows content verified, attributed pre-orders and captures, estimated and final earnings, the next review date, and a factual thank-you **without public ranking** (§30 forbids leaderboards).

The Backer close state is outcome-specific: threshold miss and no charge, captured, failed and dropped, or natural Product close.

### 7. Admin reconciliation

Verify batch completeness and every reservation's terminal or retry state; tax calculation and charge reconciliation; attribution validity and post verification; every Creator deliverable, waiver, and availability period; Creator-specific bonus triggers; provisional versus earned Creator amounts; return of unearned provisional amounts to the Founder through the approved adjustment path; Founder share and the W-9 block; and refund, risk, and dispute flags.

The campaign moves through `closed_pending_capture` → `capture_retry_window` → `closed_reconciling`. **Payment flags remain separate from campaign lifecycle** (§23.3).

**An incomplete batch must be visibly recoverable in Admin**, with reservations remaining locked and retry neither double-charging nor duplicating receipts (§33.7.12).

---

## Out of scope

Creator Transfers and Founder payments — Phase 19. Refunds and disputes — Phase 20.

---

## Traps

- **Idempotency is the phase.** Test the batch run twice, duplicate `payment_intent.succeeded` webhooks, and a kill -9 mid-batch followed by restart. All three must be clean.
- **Never substitute an amount.** An unusable tax calculation means no charge — not a recalculated charge, not the subtotal alone.
- **A cancellation before close prevents the PaymentIntent and preserves the successful SetupIntent as history** — never rewritten as canceled. §33.7.1.
- **Detach only where reference-safe.** A shared PaymentMethod supporting another active Product transaction must survive. §33.7.2.
- **Threshold miss and pre-charge kill create no PaymentIntent and no refund object** — there is nothing to refund. §33.7.4.
- **Payment failures never reverse a met threshold.** §33.7.5.
- **Product charges everything active regardless of internal target.** §33.7.6.
- **Dropped means zero everywhere** — no revenue, no commission, no Founder share. §33.7.10.
- **`Campaign ended` ≠ `Results ready`.** Two events, two notifications, different times. §33.7.11.
- **Non-shaming copy.** A declined card is not the Backer's moral failing, and Appendix B.5's tone is the requirement.

---

## Done when

- [ ] Cancellation prevents the PaymentIntent, preserves the SetupIntent, and detaches reference-safely — **§33.7.1**
- [ ] Canceling one Product transaction does not invalidate another sharing the method — **§33.7.2**
- [ ] Screen and email show $0, and a duplicate cancel is harmless — **§33.7.3**
- [ ] Threshold miss and pre-charge kill create no PaymentIntent and no refund object — **§33.7.4**
- [ ] The Idea threshold is fixed at close, and payment failures do not reverse success — **§33.7.5**
- [ ] Product charges every active transaction regardless of internal target — **§33.7.6**
- [ ] **Batch run twice, duplicate webhooks, and crash/restart cause no double charge, earnings, or email** — **§33.7.7**
- [ ] Decline, insufficient funds, and requires-action all enter the correct 48-hour recovery — **§33.7.8**
- [ ] Update-card preserves context, and success clears the stale failure — **§33.7.9**
- [ ] Dropped failures count toward no revenue and no commission — **§33.7.10**
- [ ] `Campaign ended` and `Results ready` are separate events — **§33.7.11**
- [ ] An incomplete batch is visibly recoverable in Admin; reservations stay locked; retry does not double-charge or duplicate receipts — **§33.7.12**
- [ ] Results carry the honest "what this does and does not prove" section, Admin-reviewed

**Acceptance:** all twelve tests in §33.7.
