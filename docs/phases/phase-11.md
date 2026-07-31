# Phase 11 — Listing Checkout and the clocks

**Model:** Opus 4.8 — First real money. Appendix A.5 is exact-text mandatory, and one successful payment fires seven atomic effects that later phases assume have all happened.

**Goal:** the Founder pays an itemised listing fee through Stripe Checkout, and that single successful payment atomically locks the fee calculation, opens the formal Creator opportunity, and starts two independent clocks that three later phases read.

Proovd is merchant of record here — the only place in the product where that's true.

---

## Read first

- Spec §13 — Phase 7, listing-fee checkout, successful payment, failure handling
- Spec **Appendix A.5** — the exact listing-fee consent text
- Spec §24.6 — the listing fee as a separate stream
- Spec §31.6 — Founder cancellation, all six clauses
- Spec §14.6 — the no-acceptance deadline this phase's clock drives
- Spec §29.6 — the third refund trigger, which fires in Phase 14
- Spec §23.1 — `listing_fee_pending` → `affiliate_response_and_build`

---

## Prerequisites

Phase 09 green (the fee is calculated). Phase 10 green (Stripe client, webhooks, provider-object storage). Phase 08 green (there are Affiliates in `preparing` for the payment to activate).

---

## Scope

### 1. Checkout — the separate stream

**Stripe Checkout on Proovd's main account. Not a campaign Connect charge.** Proovd is seller and merchant of record for this fee and this fee only. Stripe Tax enabled. Descriptor `PROOVD LISTING`.

Store it as its own stream (§24.6): the Founder↔Proovd transaction, base, each optional discount separately, promotion, tax, total, descriptor, receipt, a formal invoice reachable through the context-preserving support route, the refund object with its tax reversal or correction, and the fact that **dispute responsibility here is Proovd's**, not the Founder's.

### 2. The pre-payment surface

Before payment, show: the $35 base line, **each earned $2 saving as its own labeled line**, any promotional discount, tax, total due now, the descriptor, a separate explanation that Proovd later retains 5% of captured campaign reward subtotal, the full refund promise, and **the exact consent from Appendix A.5**.

Appendix A.5 is mandatory text. Variables come from the same versioned domain records the ledger uses — never recomputed for display.

### 3. The refund promise

The full-refund promise covers the **entire Checkout charge actually paid** — listing-fee subtotal plus the associated sales-tax reversal or correction — when any of:

1. There are zero eligible recruited Affiliates; **or**
2. No Creator and Founder mutually accept the same locked compensation-proposal version by 72 hours after successful payment; **or**
3. A required launch Creator fails before launch and no replacement becomes fully ready within three US business days of the recorded failure.

**A pending proposal is not acceptance and does not pause or extend the deadline.** State that plainly in the surface, not just in the consent.

Trigger 3 fires in Phase 14. Build the refund path here so Phase 14 calls it rather than inventing a second one.

### 4. Successful payment — seven atomic effects

One transaction. All of it, or none of it:

1. Store the Checkout session and payment object, subtotal, discounts, tax, total, descriptor, receipt, and **`listing_paid_at`**.
2. **Lock** optional-item completion, the evidence snapshot, the high-effort result, the discount calculation, and the amount. Nothing recalculates after this.
3. Move the campaign to `affiliate_response_and_build`.
4. Make the formal opportunity actionable for every eligible pre-associated Affiliate.
5. Start **one** 72-hour deadline at `listing_paid_at`.
6. Start campaign building in parallel.
7. Send the Founder confirmation and receipt, and Affiliate formal-opportunity notifications — **exactly once each**.

The Founder confirmation states amount, itemised savings and tax, receipt access, the refund condition, the deadline, what happens next, who owns it, and the next update date.

### 5. Failure and abandonment

- Campaign stays `listing_fee_pending`.
- **No 72-hour clock starts.**
- Affiliate preparing states remain informational.
- Valid Founder inputs and the calculated fee survive.
- Expiration and failure are recorded and retryable **without duplicating a charge or a campaign association**.

Handle `checkout.session.completed` and `checkout.session.expired` idempotently through Phase 10's `provider_events`.

### 6. The two clocks — pg-boss

Both anchored to `listing_paid_at`, both read from Phase 06 configuration, never hardcoded.

| Clock | Duration | Fires |
|---|---|---|
| Affiliate formal response | 72 hours | Phase 12's no-acceptance deadline |
| Founder free cancellation | 48 hours, **only while not live** | §31.6 |

### 7. Founder cancellation (§31.6)

- **Within 48 hours and before live:** cancel and receive the entire Checkout charge including tax reversal or correction.
- **After 48 hours, or after live:** requires Admin approval. No automatic refund.
- **Killed for AUP or enforcement:** no automatic refund; Admin discretion plus mandatory law and provider rules control.
- **A launched or naturally closed campaign is not refunded because results were weak.**

Pre-capture cancellation behaviour — closing reservations, blocking PaymentIntents, removing future-charge authority — lands in Phase 15 and 18. Build the decision and the money path here; wire the reservation consequences when reservations exist.

### 8. Admin

Reconcile the listing fee **separately from all campaign money**. See the exact clock and current refund eligibility. Issue a direct refund to the original payment method when required.

Refunds are idempotent, and normally communicate the typical 5–10 business day bank timing **without promising an exact settlement date** (§13).

---

## Out of scope

Formal opportunity content and the accept/decline/propose actions — Phase 12. The no-acceptance evaluation at 72 hours — Phase 12. Reservation consequences of cancellation — Phase 15.

---

## Traps

- **This is not a Connect charge.** Listing money and campaign money never mix, in the schema or in reconciliation. §33.3.6 tests it.
- **The clock starts at successful payment**, not at invitation, not at signup, not at Checkout creation. §33.3.7.
- **The refund is the whole Checkout total, once.** Subtotal plus tax reversal, idempotent, never partial and never twice. §33.3.8.
- **The lock is total.** After payment, a canceled interview does not change the amount paid (§12). If any recalculation path survives, the lock is incomplete.
- **Appendix A.5 is exact text.** Not paraphrased, not "improved", not shortened.
- **Never promise a settlement date.** "5–10 business days, typically" is the shape §13 allows.
- **Seven effects, one transaction.** A partial application — say, the clock starts but the lock doesn't — is the worst outcome here, because it looks fine until the fee recalculates under someone.

---

## Done when

- [ ] Checkout and receipt list the base, each discount separately, tax, total, descriptor, refund condition, and the separate 5% explanation — **§33.3.5**
- [ ] Listing money is reconcilable entirely separately from Connect campaign money — **§33.3.6**
- [ ] The 72-hour clock starts at successful payment and at no other event — **§33.3.7**
- [ ] Zero recruits, or no bilateral locked acceptance, refunds the full Checkout subtotal + tax **once** — **§33.3.8**
- [ ] Cancellation within 48 hours and before live refunds the full total; later or live cancellation requires Admin — **§33.3.11**
- [ ] All seven atomic effects apply together, or none do
- [ ] After payment, no path recalculates the fee, the discounts, or the high-effort result
- [ ] Appendix A.5 renders verbatim with resolved variables
- [ ] A duplicate `checkout.session.completed` produces one payment record, one clock, and one set of emails
- [ ] Failed or abandoned Checkout preserves all Founder input and retries without duplicating a charge
- [ ] Admin refund is idempotent and communicates typical timing without a promised date

**Acceptance:** §33.3.5, §33.3.6, §33.3.7, §33.3.8, §33.3.11.
