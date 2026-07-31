# Phase 12 — Proposals, campaign building, review, and materiality

**Model:** Fable 5 — Bilateral version locking under concurrent responses is a distributed-agreement problem. Two versions locking, or a stale acceptance winning, silently corrupts what a Creator is owed and cannot be detected after the fact.

**⚠ Split this phase if context runs out.** Natural seam: **12a** = formal opportunity, decisions, proposals, the deadline (§14). **12b** = campaign building, roster readiness, review, materiality (§14.4, §15). Thirteen named tests — the most of any phase.

**Goal:** Creators can accept, decline, or negotiate compensation through immutable versions where only exact bilateral acceptance locks; the Founder builds the campaign in parallel; and Admin reviews it with material changes forcing reacceptance.

Two tracks run at once here — that parallelism is the phase's defining structure and its main source of bugs.

---

## Read first

- Spec §14 — Phase 8, all six subsections
- Spec §15 — Phase 9, all of it
- Spec §14.3 — the compensation matrix and Creator-specific bonuses
- Spec §23.2 — parallel build/readiness fields
- Spec §23.4 — association states
- Spec §31.5 — the Creator-only IP and confidentiality agreement
- Spec §25.4 — per-campaign association storage

---

## Prerequisites

Phase 11 green — `listing_paid_at` is set and the 72-hour clock is running. Phase 03's compensation matrix and ceiling are unit-tested; **this phase integrates them, it does not reimplement them.**

---

## Scope — 12a

### 1. The formal opportunity

Opens with `Why this fits your audience` — two Admin-written sentences — then a 60-second brief covering audience, product promise, campaign type, required promotion, compensation, key date, and the main delivery or claim risk.

The complete Campaign kit carries all twenty-two items in §14.1. It is **one kit**; §30 defers any separate resource library or education journey.

Tracking links and disclosure text get one-click copy confirmation. **A safe link-test action must not contaminate production attribution or conversion metrics.**

### 2. Three decisions, none hidden

**Accept standard terms** requires compensation terms, the per-campaign Creator-only IP/confidentiality agreement, FTC disclosure acknowledgment, and campaign terms and AUP state.

It creates a unique tracking-link record — but **the link stays inactive until approval and Creator readiness**, and the association becomes `accepted`, **not `active`**. Compensation locks for the campaign. The durable confirmation includes a worked example on a captured pre-tax charge, what is fixed versus conditional, the first action, dates, disclosure, support, and the explicit statement that **first-post verification releases no fixed-payment money.**

**Decline** stores time and an optional reason. Founder and Admin see the status, never private sensitive data. The confirmation says the decline was recorded and does not harm standing.

**Propose terms** — a percentage bid only when high-effort; a fixed Creator payment request only on a Product Campaign.

Presentation may use one primary and one secondary control under DNA, but **none of the three outcomes may be hidden.**

### 3. Proposal versioning — the hard part

Every proposal is an immutable version. The rules, all of which §33.2.9 and §33.2.10 test:

- High-effort campaigns allow a bid above base, with base + bid + bonus never exceeding 50%.
- Product Campaigns allow a fixed-payment request regardless of high-effort.
- The Founder may accept, decline, or propose a revision.
- **A Founder revision creates a new immutable version with `awaiting_creator`. It is not acceptance.**
- The Creator may accept, decline, or counter with another version.
- **Only the exact version explicitly accepted by both sides locks.**
- Admin may mediate or reject policy-violating terms but **cannot substitute for either party's acceptance.**
- Store values, proposing party, created time, both decisions and times, superseded version, and final version.
- **Stale or simultaneous responses cannot lock two versions.**
- No funding, commission record, roster readiness, or refund prevention may use a version that was not mutually accepted.
- At the 72-hour deadline, unfinished proposals become `expired_no_acceptance` and close.

Treat the last two bullets as the correctness core. Two parties responding concurrently to different versions must resolve to exactly one locked version or none — never two.

### 4. Creator-specific bonuses

Founder-offered, Creator-specific. Each uses **only that Creator's** successfully captured, validly attributed, pre-tax reward subtotal, or that Creator's unique captured attributed-Backer count.

**Whole-campaign, organic, house, or another Creator's results can never trigger it.** Store trigger unit, threshold, additional percentage, maximum combined percentage, proposal version, and earned result. A fixed amount sits outside the percentage ceiling.

### 5. The no-acceptance deadline

At **exactly** 72 hours after `listing_paid_at`:

- At least one mutually accepted locked version → the campaign continues.
- Zero eligible recruits, or no locked mutual acceptance → set `affiliate_roster_status = failed`, close pending proposals, prevent review readiness, **refund the entire listing Checkout total once including tax reversal**, notify Founder, Admin, and Affiliates as relevant, and return the campaign to allowed draft or archive handling.

**A late response cannot silently reactivate a failed and refunded campaign.**

---

## Scope — 12b

### 6. Campaign building

Runs in parallel from `listing_paid_at`. One decision at a time; **campaign type is read-only**.

Shared ingredients (§14.4): title, Founder legal/entity/sole-proprietor display and country, profile link, open and close date/time in UTC, Idea order threshold or Product internal target, reward packages, FAQs, brand perception and voice with required and prohibited wording, optional community URL, hero preference, public story, product visuals and brand assets, optional Creator-specific bonuses, and — for Product — the refund policy as exact operative text or immutable snapshot with title, source URL, version, and effective date.

Every reward package: title, USD pre-tax price, exact contents, fulfillment commitment, delivery month/year or window, optional limited quantity, SKU/tier identifier.

Idea-specific: integer order threshold, delivery window, early-product disclaimer, risks and challenges.
Product-specific: internal momentum target ≤ $50,000, **no public funding gate**, delivery month/year on every tier, immutably preserved refund policy, default 14-day duration.

### 7. Roster readiness

`affiliate_roster_status = launch_ready` only when **all six** hold (§15): at least one Creator accepted; Admin marked the final initial launch roster; every rostered Creator accepted the final compensation version; every bid, fixed-payment request, and revision for a rostered Creator is mutually accepted or closed; no pending Creator is required for planned launch; agreement, disclosure, tracking, and readiness records exist for every rostered Creator.

Declined, removed, and non-required Creators do not block readiness **after Admin records the decision**. Later mid-campaign additions never reopen this decision.

### 8. Review readiness and preview

`affiliate_roster_status` and `campaign_build_status` are stored **separately**; `review_ready` is derived and true only for `launch_ready + complete`. The Founder can submit only then.

Founder preview shows the complete public campaign exactly as a Backer will see it, including the checkout drawer with correct campaign-specific consent and example subtotal/tax/total. **Preview collects no real Backer payment information.**

### 9. Admin review

Campaign enters `pending_review`. Admin reviews the eleven areas in §15.

- **Approved:** preserve an immutable approved campaign and Creator terms version; proceed to readiness and funding.
- **Changes required:** set `changes_required`, **preserve all valid work**, group feedback into `Required before resubmission` and `Optional improvements`, deep-link to affected content, identify owner and due expectation, and state whether enforcement is involved.

### 10. Materiality and reacceptance

Every required change is classified and audited:

- **Non-material** — spelling, formatting, accessibility text, or wording that does not change meaning, economics, workload, timing, risk, claims, delivery, refunds, or channel rules. **Preserves Creator readiness.**
- **Material to Creator terms** — compensation, required work, dates, rewards or prices, approved claims, delivery promises, refund terms, channel rules, or fixed-payment conditions. **Creates a new version, invalidates affected Creator readiness, and requires explicit acceptance of that exact version before approval or live.**

Admin records classification, reason, affected fields, before and after, prior and new version, affected Creators, and reacceptance state. **A Founder cannot publish a material change directly.**

Affected Creators receive the precise changed fields and accept or decline the new version. Unaffected or non-material corrections **must not manufacture a reacceptance task.**

This machinery is reused verbatim for live editing in Phase 17 — build it general.

---

## Out of scope

Fixed-payment funding — Phase 13. Tracking-link activation and launch — Phase 14. Mid-campaign addition — Phase 17.

---

## Traps

- **A pending proposal is not acceptance**, does not pause the deadline, and does not prevent the refund. §33.2.11.
- **Two versions must never lock.** Test concurrent accept-and-counter explicitly.
- **`accepted` is not `active`.** The tracking link exists and is inactive.
- **Admin cannot substitute for a party's acceptance.** Mediation is not agreement.
- **The bonus base is that Creator's captured attributed subtotal only.** §33.2.13.
- **`review_ready` is derived.** Storing it as a column invites it drifting from its inputs. §33.3.10.
- **Non-material changes must not invalidate readiness.** Manufacturing a reacceptance task for a typo fix trains Creators to click through them.
- **Idea rejects a fixed-payment request; a standard campaign rejects a bid above base.** §33.2.8.
- **A late response cannot revive a failed campaign** — check status before processing any response that arrives after the deadline.

---

## Done when

- [ ] Listing payment activates the formal decision and deadline exactly once — **§33.2.5**
- [ ] Accept, decline, and propose are all reachable; decline carries no penalty — **§33.2.6**
- [ ] All six matrix cells produce correct base, bid, and fixed rules — **§33.2.7**
- [ ] Idea rejects a fixed request; a standard campaign rejects a bid above base — **§33.2.8**
- [ ] Versioning prevents stale and double acceptance under concurrent responses — **§33.2.9**
- [ ] Only exact bilateral acceptance locks a version — **§33.2.10**
- [ ] A pending proposal expires at the deadline and does not prevent the refund — **§33.2.11**
- [ ] The ceiling includes base + bid + bonus and never exceeds 50% — **§33.2.12**
- [ ] Creator-specific bonuses ignore organic, house, and other-Creator results — **§33.2.13**
- [ ] Roster readiness follows all six rules; a non-required pending Creator does not block after Admin closure — **§33.3.9**
- [ ] `review_ready` is false until both tracks complete — **§33.3.10**
- [ ] Required and optional feedback preserves the draft and deep-links to affected content — **§33.4.1**
- [ ] A non-material change preserves readiness; every material class versions and requires affected reacceptance — **§33.4.2**
- [ ] A Founder cannot publish a material change directly
- [ ] Preview collects no real payment information

**Acceptance:** thirteen named tests — §33.2.5–13, §33.3.9, §33.3.10, §33.4.1, §33.4.2.
