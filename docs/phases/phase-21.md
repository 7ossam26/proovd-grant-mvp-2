# Phase 21 — Fulfillment, Day 14, and completion

**Model:** Opus 5 — Enforcement copy has to name actual evidence and behaviour, and the ghost ban is permanent. A ban applied on an undefined trigger is unrecoverable for the person it hits.

**Goal:** the Founder delivers, Admin verifies at Day 14, Creators receive a completion status that gates future collaboration, and a Founder who ghosts is banned once — on a defined trigger, with evidence.

The campaign resolves. This is the last phase of the product lifecycle.

---

## Read first

- Spec §22.4 — the Day 14 Progress Check
- Spec §22.5 — fulfillment
- Spec §22.6 — delivery-date changes
- Spec §22.7 — the one-strike Founder ghost ban
- Spec §22.8 — Creator `successfully_completed`
- Spec §22.9 — the work-again request
- Spec §22.10 — Founder next-campaign readiness
- Spec §22.11 — campaign resolution
- Spec §31.8 — Backer status progression and satisfaction

---

## Prerequisites

Phase 19 green — payments have released, so Day 14 has something to block or reverse. Phase 20 green — refund, reversal, and recovery paths exist for Day 14 failure to invoke.

---

## The seam

Ten named tests across nine deliverables — level with Phase 12 and above Phase 17, both of which split. This brief did not name a seam, so one is recorded here (master-plan §1.3 step 6), on the boundary between **what the Founder owes and what happens when they don't** and **completion, and what comes after it**.

| Half | Scope | Acceptance |
|---|---|---|
| **21a** | Fulfillment and the four Founder obligations (§22.5), delivery-date changes and their two approval paths (§22.6), the Day 14 Progress Check with its checklist, receipt, and per-type consequences (§22.4), and the one-strike ghost ban (§22.7) | **§33.10.1–§33.10.4**, plus the update-cadence done-when |
| **21b** | Creator `successfully_completed` (§22.8), the work-again request (§22.9), Founder next-campaign readiness (§22.10), Backer status progression and satisfaction (§31.8), and campaign resolution (§22.11) | **§33.10.5–§33.10.10**, plus the `closed_resolved`/`fulfilled` done-when |

**21a is built and its four tests pass.** 21b is the remaining half.

The dependency runs one way. §22.8's fourth criterion ("no unresolved fraud, invalid-proof, material-breach, or compliance case") reads 21a's Day-14 failure and ban records; §31.8's satisfaction step only exists after 21a records a delivery; §22.11's reconciliation compares against 21a's fulfillment state. **21a writes no Creator completion status, no work-again record, and no satisfaction response** — and 21b adds no second delivery record and no second ban trigger.

---

## Scope

### 1. Fulfillment (§22.5)

Digital delivery through the promised mechanism: login credentials, download link, redemption code, beta enrollment, API key, invite or access code, or course, book, and file delivery.

**Founder obligations, all enforced or surfaced:**

- Send campaign-close confirmation **within 48 hours**.
- Post **at least one update every 30 days** from charge to delivery.
- Send a delivery notification when access is granted.
- **Preserve original and revised delivery dates** when a change occurs.

The Backer delivery email repeats the reward, access instructions, the original commitment, Founder support, the Proovd escalation route, and a short satisfaction response.

### 2. Delivery-date changes (§22.6)

**Before the remaining payment (Product):** the Founder requests Admin approval **before notifying Backers**. Admin reviews within five business days for bait-and-switch risk and payment impact.

**After the remaining payment:** the Founder must notify Backers **before the original month passes**. Admin preapproval isn't required, but refund, support, and ghost-ban rules still apply.

Material updates show the previous date, the revised date, the reason, **which obligations are unchanged**, the next update date, and the support and refund route.

### 3. Day 14 Progress Check (§22.4)

**Admin performs it for every campaign.** Pass requires adequate progress or delivery evidence plus required communication. Product evidence may show actual feature or reward access. **Idea review is enforcement-only** — there is no second payment to release.

The Founder receives a **campaign-specific evidence checklist with examples**, and submission creates a **durable receipt** listing every supplied item and the decision due time. Admin and Founder see the same checklist and the same evidence list.

**Failure includes:** no adequate progress evidence · no substantive update in the prior seven days · unreachable for Admin clarification within five business days · material delivery bait-and-switch · ghosting.

**Consequences:**

- **Product:** block the unreleased remaining payment and start refund, reversal, or recovery as applicable. Attempt best-effort reversal against the released first payment **when warranted**.
- **Idea:** no unreleased payment exists — use refunds, reversals, dispute handling, or contractual recovery, best-effort.
- Apply the one-strike ghost ban **only when a defined trigger is met**.

### 4. The one-strike ghost ban (§22.7)

**Permanent.** Triggers, and only these:

- A failed Day 14 Progress Check.
- Silence for 30+ consecutive days post-payment.
- **Product:** more than 30 days past the disclosed delivery month without an updated timeline and the required notice or approval.
- **Idea:** failure to deliver by the end of the window, **plus** failure to communicate an updated timeline within 30 days.

Admin records trigger, evidence, notice, payment and recovery status, and the enforcement decision.

Because it's permanent and one-strike, the trigger evaluation must be exact. **A ban that fires on an undefined condition is not recoverable for the Founder it hits**, and §33.10.4 tests that it only fires under the defined conditions.

### 5. Creator `successfully_completed` (§22.8)

**Only Admin assigns it**, after campaign end, when **all five** hold:

1. The Creator cleared readiness before work.
2. At least one valid post was submitted and verified.
3. Every deliverable was verified, or specifically waived by Founder **and** Admin with a reason.
4. No unresolved fraud, invalid-proof, material-breach, or compliance case exists.
5. Fixed-payment return or payment, commission adjustment, and Transfer are resolved or recorded.

**Sales performance is not required.** A Creator who did everything agreed and sold nothing is `successfully_completed` — §33.10.6 tests exactly this.

Store status, completion date, Admin, evidence, waivers, and any disqualifying reason.

### 6. Work-again request (§22.9)

After campaign end, a Founder may request another collaboration **only with a Creator marked `successfully_completed` for that campaign.**

- **Routes through Proovd. No direct messaging** — §30 defers that permanently for the MVP.
- The Creator can accept or decline **without penalty**.
- Store original campaign, Founder, Creator, request time, status, response, and notifications.
- **Acceptance creates no campaign** and bypasses **no** active-campaign limit, **no** three-month cooldown, and **no** Admin readiness approval.
- A later correction to completion status changes eligibility **without deleting history**.

### 7. Founder next-campaign readiness (§22.10)

Founder home shows the **exact earliest request date** after the three-month cooldown, the separate Admin-readiness criteria, the ability to prepare updates and evidence **without opening a new campaign**, and `ready for next campaign` **only after an Admin decision**.

Two independent gates: time, and judgment. Meeting the cooldown grants nothing by itself.

### 8. Backer satisfaction (§31.8)

Magic-link status progression is derived from real state and **never predicts an unconfirmed outcome**:

`Reserved → Charge due / No charge → Captured / Failed → Delivery due → Delivered / Refunded`

After delivery, satisfaction starts with **one click** — satisfied/not satisfied, or 1–5 — then an optional reason. **Under 30 seconds**, and it **does not coerce newsletter consent**. A negative response creates **one owned Admin follow-up task**.

### 9. Campaign resolution (§22.11)

`closed_resolved` means charge and retry, Creator Transfer, Founder payment, refund and adjustment, and required close records all reconcile. **Fulfillment may remain active separately until `fulfilled`** — the two are not the same state and must not be collapsed.

---

## Out of scope

Notification coverage across all events — Phase 22. The accessibility and consistency sweep — Phase 23.

---

## Traps

- **Zero sales does not block Creator completion.** §33.10.6. Completion measures work delivered, not results achieved.
- **The ghost ban fires only on defined triggers.** §33.10.4. No discretionary "seems inactive."
- **Work-again acceptance creates nothing.** §33.10.8. Not a campaign, not an exemption from cooldown, not readiness approval.
- **Cooldown and readiness are separate gates.** §33.10.9.
- **A revised delivery date preserves the original**, and takes the correct approval path depending on whether the remaining payment has released. §33.10.2.
- **Satisfaction must not become a newsletter funnel.** §31.8 forbids coercing consent, and §30 forbids dark patterns.
- **`fulfilled` and `closed_resolved` are different states.** Money reconciled does not mean the product shipped.
- **Enforcement copy names the actual behaviour and evidence** (§29.4). "Policy violation" is not a reason.

---

## Done when

- [ ] The delivery notification contains access instructions, the original promise, and support — **§33.10.1**
- [ ] A revised date preserves the original and follows the correct approval and notice path — **§33.10.2**
- [ ] Day 14 pass/fail evidence and consequences match the campaign type — **§33.10.3**
- [ ] The ghost ban triggers only under the four defined conditions and is fully audited — **§33.10.4**
- [ ] `successfully_completed` requires all five criteria plus Admin evidence — **§33.10.5**
- [ ] Zero sales does not block completion when the work was valid — **§33.10.6**
- [ ] Only an eligible completed Creator can receive a work-again request — **§33.10.7**
- [ ] Accept or decline creates no campaign and bypasses no cooldown or readiness gate — **§33.10.8**
- [ ] The Founder sees the exact cooldown date and the separate readiness decision — **§33.10.9**
- [ ] Satisfaction takes under 30 seconds; a negative result creates one owned follow-up — **§33.10.10**
- [ ] Founder update cadence is tracked and surfaced against the 30-day requirement
- [ ] `closed_resolved` and `fulfilled` remain independently trackable

**Acceptance:** all ten tests in §33.10.
