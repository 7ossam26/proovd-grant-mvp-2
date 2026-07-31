# Phase 13 — Fixed payment funding and Creator readiness

**Model:** Opus 4.8 — A small phase with strict money rules. The allocation is a fourth money stream and the vocabulary around it is legally constrained.

**Goal:** where a fixed Creator payment was mutually accepted, the Founder funds it in full before any work begins; and no Creator can start work until every applicable readiness item is complete.

Short phase, two hard gates.

---

## Read first

- Spec §16 — Phase 10, in full
- Spec §24.7 — the fixed Creator payment as a separate stream
- Spec §14.3 — where the 20% base applies and when it stops
- Spec §22.1 — the completion outcomes this funding eventually resolves into
- Spec §31.6 — what happens to a funded allocation on Founder cancellation

---

## Prerequisites

Phase 12 green — a mutually accepted proposal version exists, and roster readiness is computable.

---

## Scope

### 1. The rule

An optional fixed Creator payment exists **only for a Product Campaign**, is **requested by the Creator**, is accepted by both parties through **one proposal version**, and is **not the default model**.

Never on an Idea Campaign. Never Founder-initiated. Never inferred from anything but an accepted version.

### 2. Funding sequence

1. Create **one** campaign-and-Creator allocation for the exact accepted amount.
2. The Founder funds it **in full before the Creator begins work**. **Partial funding is rejected** — not held, not queued, rejected.
3. Statuses: `not_requested` → `payment_pending` → `funded` → `paid`, with `payment_failed` and `returned` as branches.
4. Funding failure preserves the accepted amount, blocks work, and retries idempotently **without duplicating the allocation or the charge**.
5. Missing the Admin-configured funding deadline may cancel the association and allow replacement recruitment. **The 20% base stops applying after cancellation** — a Creator whose fixed payment lapsed does not silently continue on the reduced percentage.
6. Funding, return, finalization, and Transfer each use **stable idempotency keys**.

### 3. It is a separate stream

The allocation is separate from Backer charges, sales tax, Proovd's 5%, and percentage compensation. **No percentage applies to it.** It never changes Backer totals, the 5%, the Creator percentage base, sales tax, the Idea threshold, or the campaign cap (§24.7).

Store: allocation ID, the mutually accepted proposal version, the Founder funding charge object with descriptor, fees, and tax/accounting treatment, amount and currency, funding attempts with status and idempotency, return eligibility with amount, reason, object, and idempotency, completion eligibility and evidence, and the Transfer and payout record.

**It must never be called escrow, or described as money already paid to the Creator** (§16). Both are forbidden by §2.1's language rules and §3.2's replacement table. The permitted vocabulary is *optional fixed Creator payment*, *secured Creator payment*, *Creator payment funded*, and *fixed Creator payment pending completion* / *fixed Creator payment paid*.

### 4. The readiness checklist

A Creator may begin work **only when all applicable items are complete**:

campaign approved · final rewards and offers · final incentives and compensation · product and brand assets · permitted and prohibited claims · tracking-link record · FTC disclosure template · required posts, deliverables, and availability periods · campaign dates · accepted Creator-only IP and confidentiality agreement · accepted campaign terms and AUP · fully funded fixed allocation, if applicable · required connected-account and capability status.

The Creator receives **one completed Campaign kit** and prepares the agreed work. Admin may review drafts or planned posts where available.

### 5. The two views

**Founder** sees each Creator's readiness status, fixed-payment funding status, the exact blockers, the owner, and the next date. **The Founder cannot ask a Creator to begin while any required item is incomplete** — this is a product constraint, not a guideline, so there is no "nudge" affordance.

**Admin** verifies every checklist item, the funding object, the amount, the accepted proposal version, and the draft or launch plan. Admin schedules **one exact `campaign_live_at`** only after the campaign and every scheduled Creator are ready.

---

## Out of scope

Launch itself and tracking-link activation — Phase 14. Completion outcomes and the return-or-pay decision — Phase 19. Transfer creation — Phase 19.

---

## Traps

- **Never the word escrow**, in UI, in schema, in logs, in Admin, in support templates. §3.1 warns that internal names leak.
- **Partial funding is rejected outright.** Accepting $400 against a $500 allocation and marking it partially funded is the failure §33.4.3 tests.
- **Funded is not paid.** The allocation being funded says nothing about the Creator having earned it — §22.1's outcomes decide that in Phase 19.
- **Idea Campaigns cannot have one.** If a fixed request reaches this phase on an Idea campaign, Phase 12's validation failed.
- **The 20% base is conditional on the fixed payment surviving.** Cancel the association and the reduced base stops applying.
- **Readiness is all-or-nothing.** Twelve of thirteen items complete means the Creator cannot begin.
- **Duplicate funding attempts must not create a second allocation or a second charge.** Stable idempotency keys, tested with a replayed request.

---

## Done when

- [ ] Fixed funding requires the **exact full amount** and a mutually accepted version; failed, partial, and duplicate funding cannot mark it `funded` — **§33.4.3**
- [ ] No Creator can begin work before every applicable readiness item is complete — **§33.4.4**
- [ ] An Idea Campaign cannot reach a fixed-payment allocation by any path
- [ ] Missing the funding deadline can cancel the association, and the 20% base stops applying
- [ ] The allocation appears in no percentage calculation, no tax base, no threshold, and no cap
- [ ] Funding, return, finalization, and Transfer all use stable idempotency keys; replaying any of them is a no-op
- [ ] The words `escrow`, `custody`, `trust`, `upfront payout`, `first half`, and `final half` appear nowhere in code, schema, copy, or logs
- [ ] The Founder sees exact blockers with owner and next date, and has no way to ask a Creator to start early
- [ ] Admin can schedule exactly one `campaign_live_at`, and only when everything is ready

**Acceptance:** §33.4.3, §33.4.4.
