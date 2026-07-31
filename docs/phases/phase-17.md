# Phase 17 — Live campaign operations

**Model:** Opus 4.8 — The Act ranking is a product-judgment problem with a documented override path, and the live-editing materiality split decides what a Founder can change unilaterally once real people have committed money.

**Goal:** the Founder gets a calm chronological workspace that answers what changed and offers exactly one next action; live edits route correctly by materiality; threshold crossings fire once each; and Creators can join mid-campaign without disturbing anyone's locked terms.

DNA §5.2 and §5.3 stop being principles here and become a tested surface.

---

## Read first

- Spec §20 — Phase 14, all of it
- DNA §5.2 — the three altitudes
- DNA §5.3 — the loop, not the map
- DNA §5.6 — one hero per moment
- Spec §15 "Materiality and Creator reacceptance" — reused verbatim for live edits
- Spec §29.5 — Affiliate ghosting, since it becomes detectable during live
- Spec §2.2 — the three-slot active-partnership cap

---

## Prerequisites

Phase 16 green — Admin live operations. Phase 14 green — campaigns are live with attribution running. Phase 12's materiality machinery is **reused, not rebuilt**.

---

## Scope

### 1. Founder campaign home — Glance

**A chronological campaign workspace, never a widget grid.**

- **One large number:** active pre-order count.
- Last-visit delta: `+N since [date]`, or a truthful `No change since [date]`.
- **Store and update `last_seen_count` and `last_seen_at` only after the rendered state is successfully delivered.** A failed render must not advance last-seen, or the Founder loses a delta permanently. §33.6.6 tests this.
- Idea: `[N] to go · ends [local date/time]`. Product: `Campaign ends [local date/time]`.
- A **permanent clarification** that these people selected an offer and agreed to charge rules but **have not yet been charged**.
- Current Creator liveness **only when true**.
- Data freshness as `Updated 3:40 PM`. **Never "real time"** (§30).

### 2. Act — one ranked action

Show **one** real primary action, ranked:

1. Safety or compliance blocker
2. Required delivery, refund, or date-change review
3. Unanswered Backer support question
4. Required campaign update due
5. Optional milestone update, once per actual milestone

A **documented safety override** may change the ranking. When no real action exists, show **no manufactured CTA** and close with `You're all caught up. Results land [local close].`

Store every later correction, dismissal, or reclassification with prior rank, reason, actor, and time — this feeds §31.9's next-action correction rate, which is one of the four Founder scoreboard metrics.

### 3. Explore

Complete supporting data, without competing with Glance or Act: clicks; active, new, and canceled pre-orders with net change; pre-tax reserved subtotal, estimated tax, exact authorized totals; conversion and days remaining; Creator results with activation and verification state; survey answers **according to consent**; funnel and drop-off; direct, organic, Proovd-house, and Creator attribution; comments and updates; permitted exports; data definitions and freshness.

DNA §5.2: moving something to Explore is not hiding it. Explore is a first-class space where power users live.

### 4. Live editing — the three tiers

| Directly allowed, with version history | Requires Admin review + affected Creator reacceptance | Cannot be changed directly at all |
|---|---|---|
| Typos | Claims | Campaign type |
| Non-material clarification | Rewards and prices | Idea threshold |
| Brand notes not altering approved claims | Campaign dates and duration | Product internal target |
| Community link | Delivery promises | Locked reward transaction terms |
| Non-material FAQ clarification | Refund terms | Accepted compensation |
| | Creator work, compensation, channel rules | |

**An FAQ cannot silently change a promise locked elsewhere.** This is the loophole the third column exists to close — a Founder editing "when will I get it?" in the FAQ must not effectively move a delivery date.

Material edits use Phase 12's versioning and reacceptance machinery unchanged.

### 5. Threshold and campaign events

- Store new pre-orders, cancellations, and net change **separately**.
- Crossing an Idea threshold emits `threshold reached`; falling below emits `threshold lost`. **Each crossing is its own event and notification, deduplicated by state transition** — a campaign may cross repeatedly, and each crossing notifies once.
- First pre-order, halfway, threshold met, and campaign ended may appear **once** as a milestone, then move to history.
- **No generic Day 3/7/10 "check your campaign" emails.** §33.6.11 tests for their absence.
- **Notify only for real actions or consequences.**

### 6. Creator live surface

Uses the active-partnership kit and links from Phase 14. Performance is refresh-based with definitions and timestamps.

Earnings states are **distinct and named**: `estimated`, `finalized`, `approved for transfer`, `transferred`, `paid out`, `payout failed`, `adjusted`. Every unpaid or adjusted state names reason, owner, and next date or action (Appendix B.7).

Obligations enforced or surfaced: keep content available for the agreed campaign and availability period, with story-format content following a pre-agreed natural lifespan; no spam, unsolicited DMs, identity-hidden accounts, purchased lists, unrelated mass platforms, minors, prohibited claims, or link sharing, sale, or transfer; promotion only through owned, administered, permitted, or guest channels following host rules; newsletter and email following CAN-SPAM and applicable privacy rules; student Affiliates acting personally without implying institutional endorsement.

**Every promotional post clearly discloses a paid or material relationship** with the specific Founder and product — native paid-promotion tools, prominent `#ad`/`#sponsored`, story-integrated text, or verbal pre-roll. Disclosure must be hard to miss and appear at the start or otherwise prominently.

### 7. Mid-campaign Creator addition

Same private campaign-specific invitation and compact account flow. Because the Founder is complete, the campaign appears immediately.

Show exact remaining time, the current Campaign kit, and **adjusted reasonable deliverables**. Use the same compensation matrix and the campaign's **locked** high-effort result.

**Do not change public terms or existing Creators' locked terms.** Require agreements, compensation acceptance, connected-account readiness, and every relevant readiness item. Set a **new `activated_at`** — **no retroactive attribution**. The active-partnership cap applies. Ended campaigns reject addition. A failed and refunded no-acceptance campaign **cannot be revived** by a late Creator. Do not reopen campaign review unless the addition requires a material public change.

### 8. Backer before close

Revisit through the magic link, cancel free through one clear action with **no retention obstacle**, change an Idea reward before close, read updates and comment while enabled, and contact the Founder through Proovd support.

---

## Out of scope

Close, capture, and retry — Phase 18. Refunds — Phase 20. Fulfillment and Day 14 — Phase 21.

---

## Traps

- **A failed render must not advance `last_seen`.** Update it after successful delivery, not before. §33.6.6.
- **Never manufacture a CTA.** "All caught up" is a designed done-moment (DNA §5.4), not an empty state to be filled.
- **Each threshold crossing notifies once**, deduplicated by state transition — not by day, not by count.
- **No scheduled engagement email exists.** If a job sends mail on a timer without a real consequence behind it, that's the §33.6.11 failure.
- **Mid-campaign Creators earn nothing on prior traffic.** §33.6.3 and §33.6.13.
- **Don't rebuild materiality.** Phase 12 owns it.
- **Explore is not a widget grid.** §33.6.8 tests the distinction: complete data, freshness stated, without becoming a dashboard.
- **"Refresh-based", never "live"** or "real time" in any label.

---

## Done when

- [ ] The Glance delta is exact, and a failed render does not advance last-seen — **§33.6.6**
- [ ] Act shows one correctly ranked real action, or the caught-up ending — **§33.6.7**
- [ ] Explore holds complete data with stated freshness and is not a widget grid — **§33.6.8**
- [ ] New, canceled, and net counts reconcile — **§33.6.9**
- [ ] `threshold reached` and `threshold lost` fire once per crossing, repeatedly across a campaign — **§33.6.10**
- [ ] No scheduled generic Day 3/7/10 check email exists anywhere — **§33.6.11**
- [ ] Non-material live edits version; material edits cannot publish directly — **§33.6.12**
- [ ] Mid-campaign addition gets remaining-time terms and readiness, with no retroactive credit — **§33.6.13**
- [ ] Act rank corrections store prior rank, reason, actor, and time
- [ ] An FAQ edit cannot alter a promise locked elsewhere
- [ ] Cancellation stays one action with no retention obstacle
- [ ] The active-partnership cap blocks a fourth concurrent slot

**Acceptance:** eight named tests — §33.6.6 through §33.6.13, completing §33.6.
