# Phase 15 — Backer pre-order and card save

**Model:** Fable 5 — The $50,000 cap must hold under concurrency, deduplication decides whether cards get charged at all, and the stored tax calculation is the only amount that may ever be charged. Three independent correctness problems in one phase.

**⚠ Split this phase if context runs out.** Natural seam: **15a** = the pre-order flow, eligibility, cap, tax, SetupIntent, consent (§19 through the success state). **15b** = magic-link page, cancellation, deduplication queue, pre-charge reminder. Thirteen named tests.

**Goal:** a real person saves a real card, is charged nothing, receives proof of that, and holds campaign-scoped access to cancel freely until close.

**This is the first phase where the public gives you something to protect.** Every surface must be unambiguous that no money moved.

---

## Read first

- Spec §19 — Phase 13, in full
- Spec **Appendix A.3 and A.4** — Idea and Product consent, exact text
- Spec **Appendix B.2, B.3, B.4** — pre-order success, pre-charge reminder, cancellation
- Spec §4.1 "Practical unique-Backer decision" — deduplication
- Spec §24.2 — SetupIntent to off-session PaymentIntent
- Spec §25.2 and §25.3 — reservation and deduplication records
- Spec §20 — cancellation behaviour and the pre-charge reminder
- Spec §28.4 — privacy and consent
- Spec §2.2 — the cap and the one-active-campaign rules

---

## Prerequisites

Phase 14 green — campaigns are live, attribution is recorded. Phase 10 green — Stripe client and webhooks. Phase 04 green — the magic-link token service.

---

## Scope — 15a

### 1. The pre-order sequence (§19)

Twelve steps, in order:

1. Select exactly one reward.
2. Answer the fixed demand survey — `Why do you want this product?` (free text) and `How likely are you to recommend this to someone?` (1–10).
3. Enter email, phone, US billing country, postal code, and full billing address **only where tax or payment configuration requires it**.
4. Confirm 18+ with an **unchecked** control.
5. Calculate and display reward subtotal, sales tax, and exact total authorized.
6. Read the campaign-specific consent and the mandatory Founder fulfillment/support data-sharing acknowledgment.
7. Optionally, through a **separate unchecked** control, allow Founder marketing, research, survey contact, and identifiable survey access.
8. Optionally join Proovd's newsletter through **its own unchecked** control.
9. Enter the card through Stripe-controlled fields.
10. Confirm a SetupIntent for the exact disclosed future charge rule and amount.
11. **Create an active reservation only after SetupIntent success.**
12. Send confirmation with the magic link.

Valid survey, reward, and contact values **survive any tax, Stripe, network, validation, or server error.** Selected reward, subtotal, tax, total, delivery, availability, and refund link stay visible or directly available throughout, and **cannot change silently.**

### 2. The transaction timeline

Before the card field:

1. **Today:** card saved; charged today = **$0**.
2. **At the trigger:** exact authorized total split into subtotal and tax, local charge date and time with UTC, and the campaign rule.
3. **Delivery:** reward name and month/year or window.

### 3. Consent — exact text

Appendix A.3 for Idea, A.4 for Product. **Verbatim**, with variables resolved from the same versioned domain records the ledger uses.

Three checkboxes, all **unchecked by default**: the required 18+/US confirmation, the optional Founder marketing consent, and the optional Proovd newsletter. **No dark pattern, no preselection, no bundling** (§28.4).

Store the consent text version and hash with the reservation.

### 4. Eligibility and cardinality

- **Reject non-US billing country before SetupIntent creation.**
- Reject unchecked age confirmation.
- Check sanctions and risk inputs through approved providers.
- **Atomically check the $50,000 pre-tax active-reservation cap before SetupIntent.** Reject or waitlist anything that would exceed it — **never partly accept**. This must be a database-level atomic operation, not read-then-write. §33.5.10 tests it under concurrency.
- **Idea:** one active pre-order per practical unique Backer. A reward change creates a new tax calculation and consent, and **the old selection stays active unless the replacement SetupIntent and consent succeed.**
- **Product:** multiple transactions allowed, each with one reward and its own consent, tax, SetupIntent, status, and cancellation.
- Sold-out rewards remain **visible but unavailable**.

### 5. Reservation-time tax

Calculate at reservation time using the Founder seller account, product tax code, and Backer location. Store calculation ID, jurisdiction and rate, taxability reason, `expires_at`, subtotal, tax, total, and timestamp.

**The later charge may occur only for exactly that total, and only if that same calculation remains usable.** The MVP does not recalculate at close and does not ask for a higher-total reconsent. If unusable at capture: **no charge**, `capture_failed_dropped`, reason `tax_calculation_unusable`. Phase 18 enforces it; this phase stores what Phase 18 validates.

Zero tax caused by missing collection configuration is **not** proof that no tax is due (§31.7).

### 6. Immediate Founder operational sharing

After a successfully saved pre-order, immediately share the Backer's email and the purchase details needed for fulfillment preparation and support with the Founder — **even though no charge occurred.**

- Mandatory, and **disclosed before consent**.
- **Not marketing consent.**
- Later cancellation changes the Founder record to `canceled/no charge — do not fulfill`.
- Previously shared information **cannot be retracted** but stays restricted to operational use.
- Identifiable survey answers and any marketing contact require the **separate optional consent**.
- **Affiliates never receive Backer PII.**

### 7. Success state

Leads with **`Pre-order saved — you were not charged`** and repeats campaign and Founder/seller, selected reward, subtotal, tax, exact total authorized, $0 charged today, the campaign-specific trigger with local date/time and UTC, delivery, expected statement descriptor, cancellation deadline and path, magic-link destination, refund and support summary with the one-business-day SLA, an `Add close date to calendar` action, and the Today → Trigger → Delivery summary.

**Celebration must never imply a completed purchase or charge.** §30 forbids confetti and countdown pressure that confuses a saved card with a charge.

---

## Scope — 15b

### 8. The magic-link page

Long-lived and campaign-scoped, using the Phase 04 token service. Contains the full campaign page, each of this Backer's transactions with reward, subtotal, tax, total, date, and payment status, whether a charge occurred, the campaign-specific status progression, cancel before close, change Idea reward before close, update card during retry, public and Backer-only updates, comment ability while allowed, the Founder support form routed through Proovd, the community link, post-charge refund and support request, and the post-delivery satisfaction survey.

Valid through fulfillment or final resolution **plus 180 days** unless revoked or reissued. **Founder or Affiliate payment never expires Backer access.**

Status progression is derived from real state and **never predicts an unconfirmed outcome** (§31.8):
`Reserved → Charge due / No charge → Captured / Failed → Delivery due → Delivered / Refunded`.

### 9. Cancellation (§20)

One clear action, **no retention obstacle**, no cost. Atomically:

- Set the reservation `reserved_canceled` and remove it from close selection, cap, and threshold.
- Prevent any PaymentIntent for it.
- Remove future-charge authority and detach the PaymentMethod **only where reference-safe** — if the same method or Customer supports another active Product transaction, **do not detach globally**.
- **Preserve the successful SetupIntent as history; never label it canceled.**
- Show and email `Canceled — you were not charged` per Appendix B.4, with campaign, reward, $0, local and UTC time, and the re-pre-order route if still open.
- Product cancellation also notifies the Founder.
- Update the Founder operational record to `do not fulfill`.
- Handle duplicate submission idempotently.

### 10. Practical deduplication (§4.1)

**A fraud-control decision, not verified civil identity.** Derive a private key from normalized email and phone, supplement with the Stripe payment-method fingerprint where available, and store device and IP risk signals.

Suspected duplicates enter an **Admin queue before close**. **Shared IP alone never merges two Backers.** Admin may merge or separate only with recorded reason, evidence, prior value, new value, actor, and timestamp. Threshold updates are idempotent after the decision.

Customer copy promises **reasonable deduplication and review, never perfect identity prevention.** Identity-document collection is deferred unless a recorded risk case requires it.

Store least-privilege only (§25.3): hashes, fingerprint reference, risk references, the case, and the decision. **Never expose this as a public identity profile.**

### 11. Pre-charge reminder

Approximately 24 hours before the trigger, one reminder per still-active scheduled transaction. If created less than 24 hours before, send promptly and **suppress the later duplicate**.

Appendix B.3's content: campaign and Founder/seller, reward, subtotal, tax, exact total, local charge time with UTC, the Idea threshold or Product close rule **without guaranteeing card success**, expected descriptor, a direct magic-link review/cancel action, support and SLA.

**Canceled, killed, dropped, already captured, or otherwise ineligible reservations receive none.**

For Idea, **never imply the threshold is final before close.**

---

## Out of scope

Capture, the close batch, and retry — Phase 18. Live campaign operations — Phase 17. Refunds — Phase 20.

---

## Traps

- **The cap check must be atomic in the database.** Read-then-write passes every single-threaded test and fails on the first concurrent pair. §33.5.10.
- **No reservation exists until SetupIntent succeeds.** §33.5.4.
- **A failed Idea reward replacement leaves the old selection active.** §33.5.8. The tempting implementation — cancel then create — loses the Backer's place.
- **Shared IP alone never merges Backers.** §33.5.7.
- **Never detach a PaymentMethod still supporting another active transaction.** §33.7.2.
- **A successful SetupIntent stays historical forever**, even after cancellation (§23.5).
- **Appendix A.3 and A.4 are exact text.** These are the consent under which a card is later charged.
- **Optional consents are separate, unchecked, and purpose-specific.** Bundling them is a §28.4 violation.
- **Affiliates never see Backer PII** — enforce at the query layer.
- **`Pre-order saved — you were not charged`** is the lead. Every surface, every email.

---

## Done when

- [ ] Non-US billing and unchecked age fail **before** SetupIntent — **§33.5.1**
- [ ] Checkout shows subtotal + tax = exact total, $0 today, trigger, delivery, seller, descriptor, cancel path, and sharing — **§33.5.2**
- [ ] Optional Founder and Proovd consents are separate and unchecked — **§33.5.3**
- [ ] A successful SetupIntent creates exactly one reservation; a setup failure creates none — **§33.5.4**
- [ ] Operational details reach the Founder immediately; cancellation adds `do not fulfill` — **§33.5.5**
- [ ] Affiliates receive no PII — **§33.5.6**
- [ ] Idea one-active-pre-order and deduplication work; shared IP alone never merges — **§33.5.7**
- [ ] A failed Idea reward replacement preserves the old selection — **§33.5.8**
- [ ] Product permits multiple one-reward transactions while unique Backer count stays 1 — **§33.5.9**
- [ ] Concurrent requests near $50,000 cannot exceed the pre-tax cap — **§33.5.10**
- [ ] Stored tax calculation, expiry, and total reconcile; an unusable calculation creates no PaymentIntent and no substituted amount — **§33.5.11**
- [ ] Success page, magic link, email, and ledger all agree, and all say not charged — **§33.5.12**
- [ ] Magic-link duration, revoke/reissue, non-enumeration, and invalid recovery all work — **§33.5.13**
- [ ] Cancellation is one action with no retention obstacle, and is idempotent
- [ ] The pre-charge reminder sends once and skips every ineligible reservation

**Acceptance:** all thirteen tests in §33.5, plus §33.7.1 and §33.7.2 on cancellation behaviour.
