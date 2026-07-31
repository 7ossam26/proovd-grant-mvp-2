# Phase 03 — Domain kernel

**Model:** Fable 5 — Highest-consequence correctness phase in the plan. Money arithmetic, three state machines, exhaustive combinatorics. Nine named tests. Wrong here is invisible until reconciliation.

**Goal:** the calculations, state machines, and integrity tables that every money-touching phase depends on — written once, tested exhaustively, and never duplicated.

**This is the highest-leverage phase in the plan.** It produces nothing you can look at. It is also the phase where a subtle error stays invisible until reconciliation on a live campaign, at which point real money is already wrong. Take the time.

---

## Read first

- Spec §23 — canonical campaign, association, reservation, and payment states (all of it)
- Spec §24.3 — the money waterfall and the tax-exclusion rule
- Spec §24.4 — provisional Affiliate amount
- Spec §12 — listing-fee calculation and high-effort classification
- Spec §14.3 — the compensation matrix
- Spec §25.6 — Admin audit event
- Spec §28.3 — payment security and idempotency
- Spec §6 — the configured constants (fees, windows, percentages, calendar)
- Spec §21 — the three time anchors
- `docs/tech-stack-v2.md` §4 — the backend contract

---

## Prerequisites

Phase 01 green. Real-Postgres test harness working.

---

## Scope

### 1. `shared/money`

One module. Both the checkout preview and the close batch call it. **Never write a second implementation** — two will drift, and the drift is invisible until reconciliation.

Integer cents in `bigint`. No floats. No `NUMERIC` arithmetic in application code.

**The waterfall (§24.3):**

```
reward_subtotal          pre-tax reward price
sales_tax                added on top, paid by the Backer
total_captured           reward_subtotal + sales_tax
proovd_fee               5% × captured reward_subtotal
affiliate_compensation   locked earned % × captured validly attributed reward_subtotal
founder_gross_share      reward_subtotal − proovd_fee − affiliate_compensation
founder_net              founder_gross_share − allocated Stripe fees − cause-based adjustments
```

**Sales tax is excluded from** the Proovd 5%, every Creator percentage, the Idea threshold, and the $50,000 cap. Encode that exclusion structurally — the functions should take a pre-tax subtotal and have no access to a tax figure at all, so including it becomes impossible rather than merely discouraged.

**Listing fee (§12):**

```
base = 3500 cents
discount = 200 × completed optional items    (cap 1000)
subtotal = max(2500, 3500 − discount)
```

Five optional items → 32 combinations, all tested.

**High-effort (§12):** `true` only when all three of Visuals, Branding, and confirmed/scheduled interview are absent. Three booleans → 8 combinations, all tested. Stores the three inputs, the result, calculation time, and actor.

**Compensation matrix (§14.3):** six cells resolving base percentage, bid eligibility, and fixed-payment availability from campaign type × high-effort × fixed-payment accepted. Fixed payment is Product-only and prohibited on Idea. Bid is high-effort-only.

**Percentage ceiling:** base + bid + bonus never exceeds 50%. A fixed amount sits outside the ceiling. Creator-specific bonuses use only that Creator's captured, validly attributed results — never whole-campaign, organic, house, or another Creator's.

### 2. `shared/states`

Three machines as explicit legal-transition maps plus guard functions. An illegal transition throws; it does not silently no-op.

| Machine | States | Source |
|---|---|---|
| Campaign lifecycle | 25 | §23.1 |
| Campaign–Affiliate association | 19 | §23.4 |
| Reservation | 11 | §23.5 |

Alongside, and **kept separate** (§23.2, §23.3):

- `affiliate_roster_status` — `forming` / `launch_ready` / `failed`
- `campaign_build_status` — `not_started` / `in_progress` / `complete`
- `review_ready` — derived, never stored as truth
- Payment/reconciliation flags — independent rows carrying timestamp, amount, actor, evidence, provider IDs

Every transition writes an append-only history row. Reversals that §23.5 forbids must be impossible, not merely unused. A successful SetupIntent stays historical even after the reservation is canceled.

### 3. `shared/calendar`

`us-federal-holidays.<version>.json`, committed. Business-day arithmetic reads it. **No library that fetches holidays at runtime.**

When a business-day deadline is computed, the calendar version string is stored on the record beside the resulting timestamp. §29.6: the Creator replacement deadline is calculated once, and retries or edits can never silently reset it.

### 4. Skeleton tables

Create identity, status, timestamps, and ledger columns only. Later phases add domain columns by migration — do not attempt to model every §25.1 field now.

- `campaigns` — id, type, type-lock time, the three separate status columns, the three time anchors as **dedicated columns** (§21: never inferred from `created_at`/`updated_at`), ledger columns
- `campaign_affiliate_associations` — with initial-roster vs mid-campaign stored separately
- `reservations`
- One append-only history table per machine

### 5. Integrity tables

- **`audit_events`** (§25.6) — insert-only. Actor, MFA/reauth context, target type and ID, action, time, internal reason **and** customer-facing explanation as separate columns, prior value, new value, amount, currency, provider object IDs, evidence links, related notification IDs. Revoke `UPDATE` and `DELETE` from the application role **in the migration SQL**, not by convention.
- **`provider_events`** — unique on the provider event ID. Insert-or-skip before any domain work.
- **`idempotency_keys`** — stable domain keys for close-batch attempts, capture retries, fixed-payment funding, Transfers, refunds.
- **`notification_deliveries`** — unique on (event, target, entity).

### 6. Notification registry skeleton

A typed registry in `shared/` keyed by event name, covering the ~70 events in §27.3–27.6. This phase defines the type, the key set, and the delivery-dedup path. Templates and sends arrive with the phases that own them; Phase 22 sweeps for coverage.

Building the key set now means the acceptance suite can assert coverage later instead of grepping templates.

---

## Out of scope

Stripe SDK. Any HTTP route. Any UI. Auth. Domain columns beyond the skeleton.

---

## Traps

- **Never put a payment flag on `campaigns.status`.** §23.1 vs §23.3 is a schema instruction, and it is the single most common way this model goes wrong.
- **drizzle-kit will not generate `CHECK` constraints or partial unique indexes.** Hand-write them into the generated SQL and keep them under review.
- **Test the audit revocation.** Attempt an `UPDATE` as the app role and assert it fails. A permission nobody exercised is a permission nobody has.
- **The tax exclusion must be structural.** If a function *can* see a tax figure, someone will eventually add it in.
- **Don't derive the time anchors.** `campaign_close_at` is not "created plus fourteen days."
- **Don't invent constants.** Every fee, window, percentage, and duration comes from §6. If §6 doesn't name it, it doesn't exist.

---

## Done when

- [ ] All 32 listing-fee combinations produce the correct total, floor at $2,500 cents, cap at $1,000 discount — **§33.3.2**
- [ ] All 8 high-effort combinations correct — **§33.3.4**
- [ ] Proovd 5% and every Creator percentage exclude tax; threshold and cap use pre-tax subtotal — **§33.8.1**
- [ ] Six compensation-matrix cells produce correct base / bid / fixed rules; Idea rejects a fixed request; a standard campaign rejects a bid above base — **§33.2.7, §33.2.8**
- [ ] Ceiling includes base + bid + bonus and never exceeds 50%; fixed amount sits outside it — **§33.2.12**
- [ ] Creator-specific bonus ignores organic, house, and other-Creator results — **§33.2.13**
- [ ] Every illegal transition in all three machines throws
- [ ] History tables are append-only; a forbidden reversal is impossible
- [ ] The three anchors independently drive deadline calculation — **§33.12.1**
- [ ] A business-day deadline is exact, carries its calendar version, and cannot be reset by recomputation — **§33.12.2**
- [ ] Lifecycle status and payment flags are separate and independently auditable — **§33.12.3**
- [ ] `UPDATE`/`DELETE` on `audit_events` fails for the app role
- [ ] All four integrity tables enforce their uniqueness under concurrent insert

Nine named §33 tests. Every one passes before commit.
