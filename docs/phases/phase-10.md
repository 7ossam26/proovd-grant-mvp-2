# Phase 10 — Stripe foundations

**Model:** Opus 4.8 — Webhook signature verification, mode separation, and idempotent event handling are where a plausible-looking implementation passes every happy-path test and fails on the first duplicate delivery.

**Goal:** Founders and Creators complete Stripe-hosted onboarding, both webhook endpoints verify signatures and process events idempotently, every provider object is stored with its full context, and the environment refuses to start in a mixed mode.

**No money moves in this phase.** No Checkout, no SetupIntent, no PaymentIntent, no Transfer. This is the plumbing everything from Phase 11 onward runs through.

---

## Read first

- Spec §32.2 — required mode-safe environment inputs and the reference contract
- Spec §32.3 — webhook event sets, platform and connected
- Spec §32.4 — provider-object storage
- Spec §13, "Founder connected-account onboarding" — the four return states
- Spec §11 — Affiliate payout onboarding, reuse, and the tax-accountability gate
- Spec §24.1 — account roles and the approved-configuration boundary
- Spec §28.3 — payment security
- Spec §34 — the live-mode gate this phase must not open
- `docs/tech-stack-v2.md` §6

---

## Prerequisites

Phase 03 green — `provider_events` and `idempotency_keys` exist. Phase 08 green — the Affiliate `Finish payout setup` surface is waiting for its handoff. Phase 09 green — the Founder workspace is where onboarding is reached from.

---

## Scope

### 1. The Stripe client

Locked API version, pinned in configuration and never floating. Mode read from `STRIPE_MODE`. The Phase 01 env guard already fails closed on key/mode mismatch — extend it to cover connected-account IDs and both webhook secrets (§6, §32.2).

**The architecture is locked** (§24.1): direct charges on the Founder connected account, Founder as merchant of record, Proovd's 5% and the provisional Creator liability in the platform-side application fee. `STRIPE_TEST_BACKUP_MODE_ENABLED=false`. The separate-charges path is not built, and §24.1 forbids running both for one transaction or claiming an unapproved path is live.

### 2. Founder connected-account onboarding (§13)

Stripe-hosted. Proovd stores: connected account ID, onboarding and requirements status, required capabilities and their statuses, return and refresh events, and policy/agreement acceptance references.

**Proovd does not store Stripe-collected government ID documents.** Not a copy, not a thumbnail, not a reference to a local file.

Returning from Stripe always lands on a human-readable status — never a raw requirements array:

| State | Surface |
|---|---|
| Complete | Confirmed, with what unlocks next |
| More information required | The **exact** missing requirement plus a resume action |
| Under review | Owner and next expected update |
| Restricted or failed | A safe support path, and **no misleading ability to pay the listing fee** |

All four use the Phase 02 StatePanel.

### 3. Affiliate recipient onboarding (§11)

Wire `Finish payout setup` from Phase 08 to Stripe-controlled onboarding for the approved recipient configuration.

Proovd stores only connected-account, capability, requirement, and payout statuses and IDs — **never full bank details**.

**Reuse valid onboarding from a prior campaign.** Never ask an Affiliate to re-enter valid provider data.

Where onboarding is incomplete: campaign review continues, but tracking-link activation and payment receipt are blocked, with the exact missing requirement shown and a Stripe-managed resume action offered.

### 4. Webhooks — two endpoints

Separate endpoints, separate signing secrets: platform and Connect.

**Mount raw-body parsing on these routes before any JSON parser.** Phase 01 established per-router body parsing precisely so this works. A global `express.json()` consumes the raw body and signature verification fails in a way that looks like a Stripe configuration problem and isn't.

Verify the signature before parsing anything. Reject unverified events without processing.

Handle, at minimum, the §32.3 sets relevant now — `account.updated`, and `account.application.authorized` / `deauthorized` if OAuth is used. The payment events arrive with the phases that create those objects; **register the handler shape now** so later phases add cases rather than rebuild the router.

**Every handler is idempotent.** Insert into `provider_events` keyed on the Stripe event ID, and skip if present, before any domain work. A duplicate event may update the audit trail; it may never duplicate domain state, money, or a notification (§28.3).

### 5. Provider-object storage (§32.4)

Every object affecting state is stored with **mode, account context, related domain IDs, amount components, status, idempotency key, failure details, and timestamps.**

Build the storage shape now to cover the full §32.4 list — Checkout sessions and payments, connected accounts, Customers, SetupIntents, PaymentMethods, Tax calculations, PaymentIntents, Charges, application fees and adjustments, Refunds, Disputes, Transfers, reversals, and Payouts. Later phases populate rows; none should need to alter the shape.

### 6. Tax-accountability gate (§11)

Connected-account records alone do not decide who issues US tax forms. Before any live Affiliate payment, the approved tax and accounting configuration must record payer, 1099 filing responsibility, required tax data and form, thresholds, corrections, and reconciliation responsibilities — **without duplicating sensitive provider-held data.**

Build the record and the gate. It blocks Phase 19's Transfers until populated.

### 7. Local development

Stripe CLI (or equivalent) webhook forwarding, with the CLI signing secret in local environment configuration **only** (§32.2).

---

## Out of scope

Listing-fee Checkout — Phase 11. SetupIntents — Phase 15. PaymentIntents and capture — Phase 18. Transfers — Phase 19. Refunds and disputes — Phase 20.

**And explicitly: this phase does not open the §34 live-mode gate.** Test mode only.

---

## Traps

- **Raw body before JSON.** The single most common Stripe integration failure, and it presents as a configuration problem.
- **There is no `transfer.failed` webhook.** A Transfer creation failure is a synchronous API error and a retry-job case (§32.3). Don't build a listener for an event that will never arrive.
- **`setup_intent.canceled` applies only to an intent canceled before success** (§32.3). Don't treat it as a general cancellation signal.
- **Never store provider identity documents.** §13 and §25.7 both forbid it.
- **No test cards or test controls in production UI** (§32.2). Not behind a flag, not for staff.
- **Don't claim approval that doesn't exist.** §2.1: no UI may claim approval before it exists. Track A1 is still open, so onboarding copy describes what Stripe collects, not what Proovd has been approved for.
- **The four return states are real surfaces**, not a status string. "Restricted" that still shows an enabled Pay button is the exact failure §13 calls out.
- **Idempotency is insert-first.** Checking whether an event was processed *after* doing the work is not idempotency.

---

## Done when

- [ ] The env guard rejects a live key in test mode, a live connected account in test mode, a test account in live mode, and a mode-mismatched webhook secret — each **exits non-zero**
- [ ] Founder Stripe-hosted onboarding completes and returns to a correct human-readable status for all four cases
- [ ] `Restricted` offers no path to listing-fee payment
- [ ] Affiliate payout onboarding completes; valid prior onboarding is reused without re-entry
- [ ] Incomplete Affiliate onboarding blocks link activation and payment receipt while allowing campaign review
- [ ] Both webhook endpoints verify signatures and reject unsigned or wrongly-signed payloads
- [ ] Replaying an identical `account.updated` produces one domain change, one audit row, and no second notification
- [ ] Provider objects store mode, account context, domain IDs, amounts, status, idempotency key, failure details, and timestamps
- [ ] No Stripe identity document is persisted anywhere
- [ ] The tax-accountability record exists and gates Affiliate payment
- [ ] Stripe CLI forwarding works locally with its secret only in local config
- [ ] No test card or test control renders in a production build

**Acceptance:** no §33 test completes here — this phase is infrastructure. It delivers §34's "test/live key separation and webhook signatures pass," and unblocks §33.3.5–8, §33.5, §33.7, and §33.8.
