# Phase 14 — Campaign page, launch, and attribution

**Model:** Opus 4.8 — The launch order is strictly sequenced and idempotent, and attribution decides who gets paid. Every attribution edge case here has a matching §33.6 test.

**Goal:** an approved campaign goes live in a strict, idempotent, five-step order; Creator tracking links activate; Admin verifies first posts; and every visitor's attribution is recorded correctly — including all the cases that must earn nothing.

The campaign becomes public. Attribution decided here is what Phase 19 pays out on.

---

## Read first

- Spec §17 — Phase 11, launch order and post verification
- Spec §18 — Phase 12, discovery timing, the attribution contract, campaign page content order, updates and comments, the ended-state contract
- Spec **Appendix A.2** — the expanded merchant-of-record block, exact text
- Spec §29.6 — required launch Creator failure and the three-business-day replacement window
- Spec §31.6 — Founder cancellation once live
- Spec §25.2 — where attribution is stored on the reservation

---

## Prerequisites

Phase 13 green — Creators are ready and `campaign_live_at` is scheduled. Phase 05 built the public route shell and the sample campaigns; this phase makes real campaigns render.

---

## Scope

### 1. The campaign page

All fourteen content items in §18's order. DNA controls presentation; every item must be exposed.

1. Title · 2. Founder identity — legal name, entity or sole proprietor, country, profile · 3. Reward packages with SKU, pre-tax USD price, exact contents, delivery, fulfillment · 4. Campaign-type badge paired with its plain charge rule · 5. Open and close in viewer local time with UTC available · 6. Idea threshold row **only for Idea Campaigns** · 7. Refund and fulfillment links · 8. Always-visible Founder/MoR disclosure with expandable explanation · 9. Pre-order action · 10. Story · 11. FAQ · 12. Updates · 13. Comments where enabled · 14. Legal and support footer.

**Reward prices are pre-tax.** Page copy must not imply tax-inclusive pricing when checkout will add tax.

Near the primary action, a compact summary: card saved today → charge at the campaign-specific trigger → delivery month/year.

**Appendix A.2's expanded MoR block is exact text.** The always-visible line above the pre-order action is the short form; A.2 is what expands.

The campaign-type differences table in §18 governs what changes between Idea and Product — threshold visible or hidden, charge rule, public progress, delivery format, refund summary, pre-order action label.

### 2. Coordinated launch — strict order, idempotent

At `campaign_live_at`, in exactly this sequence:

1. Activate the approved public campaign page.
2. Activate scheduled Creator tracking links with `activated_at = campaign_live_at`. **They must already resolve to the live page** — which is why step 1 precedes step 2.
3. Creators publish their scheduled posts containing the working links.
4. Each Creator submits the public post URL.
5. Admin verifies the live post.

**Post verification never launches or unlaunches the campaign page, and never releases fixed-payment money.**

Running the activation twice must produce one state and one set of messages, and move no money (§33.4.6).

### 3. First-post verification

For each submitted URL, record submission time and verify: approved channel and account identity, public accessibility, an FTC disclosure naming the Founder and product, brand-note compliance, no prohibited or unsupported claim, work matching agreed terms, and campaign-type risk disclosure where material.

| Outcome | Effect |
|---|---|
| **Passed** | Valid traffic and captured charges after `activated_at` remain provisionally attributable and may later finalize |
| **Correction needed** | Pause that Creator's link as configured, identify the exact correction and due time, prevent invalid earnings from finalizing |
| **Rejected / serious breach** | Pause the link, block invalid earnings, create enforcement review, preserve evidence |

**Traffic and captures after activation are provisional until verification. Earlier traffic, pre-orders, and charges never receive retroactive attribution. A rejected post does not reverse the public campaign launch.**

### 4. The attribution contract

Every rule here maps to a §33.6 test:

- The **last valid Creator link clicked** before a pre-order wins, on the same browser and device.
- Its **first-party cookie expires at `campaign_close_at`**.
- A later valid Creator click **replaces** an earlier one.
- A direct return **without** another Creator link **preserves** the current cookie.
- **No cross-device or cross-browser attribution promise exists** — don't build one, and don't imply one in copy.
- Links used **before `activated_at`, while paused, or after close cannot create payable attribution.**
- Attribution attaches to the reservation and becomes **payable only on successful capture and verification.**
- Creator-link arrival shows `You came through [handle]` and explains the Creator may earn if the later charge succeeds.

A **safe link-test action must not contaminate production attribution or conversion metrics** (§14.1).

### 5. Discovery timing

- **Days 1–7:** the public route is reachable through known Creator, Founder, Proovd-house, or direct links, but **excluded from Proovd browse, discovery, and indexing.**
- **From Day 8:** the campaign may enter browse and indexable discovery. The Founder receives **one** factual notice explaining what changed and how organic, house, and Creator attribution differ.
- **Organic and direct transactions carry no Creator commission.** Proovd-house traffic is tracked separately from third-party Creator performance.

**The Day 8 switch must not rewrite existing attribution** (§33.6.5).

### 6. Creator active-partnership surface

Founder and product, campaign type and public link, the unique tracking link with copy confirmation, disclosure templates with copy confirmation, brand notes, allowed and prohibited claims, rewards and prices, delivery dates, campaign end, joined-at and `activated_at`, remaining-time deliverables for mid-campaign joiners, locked compensation, fixed-payment funding and completion state, first-post state, readiness, clicks, attributed active pre-orders, conversion, captured attributed amount after close, estimated and finalized earnings with bonus progress, Transfer and payout state.

Plus `Updated [local time]` and the explanation that **metrics are refresh-based, not real time.** §30 forbids real-time claims for refresh data.

### 7. Required launch Creator failure (§29.6)

Before `campaign_live_at`: Admin records `creator_failure_recorded_at` **once**, sets `creator_replacement`, and the system calculates the exact due timestamp using the configured US business calendar and version. **Retries and edits cannot reset it.**

A replacement must become fully ready by the due time. Failure sets `refunded_no_creator`, returns the funded allocation, and **refunds the full listing Checkout total including tax treatment** — using the Phase 11 refund path, not a new one.

### 8. Updates, comments, and the ended state

Updates: Product allows general/public or Backer-only; Idea adds milestone/progress. Only after live; may continue after close. Text, image, embedded video. Local publication time and audience label. **Material delivery changes show prior and revised commitments together.**

Comments: one general thread plus one per update. **Only a magic-link-authenticated Backer may post.** Display `Backer ###` or a chosen name, **never the email local-part by default**. Flagging routes to Admin. New comments disabled after close, suspension, or kill.

Ended state: the page stays accessible after natural close, threshold miss, suspension, or kill. New pre-orders and comments disable, and outcome-specific copy states why it ended, whether **this viewer** was charged, what happens next, and where existing Backers get help. **One generic "Campaign ended" message is prohibited.**

---

## Out of scope

The pre-order flow itself — Phase 15. Live campaign operations and the Founder home — Phase 17. Mid-campaign Creator addition — Phase 17.

---

## Traps

- **Page before links.** A link activating before the page it resolves to produces a live tracking URL pointing at a 404.
- **First-post verification releases $0.** §33.4.7 tests exactly this. Verification is a compliance gate, not a payment trigger.
- **A rejected post does not unlaunch the campaign.** Pause the Creator's link; leave the page live.
- **No retroactive attribution, ever.** Not for pre-activation traffic, not for a mid-campaign Creator's prior traffic.
- **The cookie dies at close**, not after a fixed window.
- **Don't promise cross-device attribution** in copy or in implementation.
- **The replacement deadline is computed once**, carries its calendar version, and cannot be reset by recomputation (§33.4.9, §33.12.2).
- **Never render the email local-part as a commenter name.**
- **Refresh-based, never "live"** in any metric label.

---

## Done when

- [ ] Launch executes page → links → posts → verification, in order — **§33.4.5**
- [ ] Duplicate activation or verification yields one state, one message, and no money movement — **§33.4.6**
- [ ] First-post verification releases $0 — **§33.4.7**
- [ ] Correction or rejection pauses the Creator and their link and blocks invalid earnings, without reversing the page launch — **§33.4.8**
- [ ] Required Creator failure creates one non-resettable three-business-day deadline; a missed deadline returns the allocation and refunds the full listing total — **§33.4.9**
- [ ] Last valid same-browser Creator link wins; direct return preserves it — **§33.6.1**
- [ ] A later Creator link replaces the earlier; the cookie ends at close — **§33.6.2**
- [ ] Pre-activation, paused, post-close, and mid-campaign prior traffic all earn nothing — **§33.6.3**
- [ ] Post-activation results stay provisional until verification — **§33.6.4**
- [ ] Days 1–7 are known-link-only; the Day 8 switch does not rewrite attribution — **§33.6.5**
- [ ] Appendix A.2 renders verbatim; the short MoR line is always visible above the pre-order action
- [ ] The ended state is outcome-specific and tells the viewer whether **they** were charged
- [ ] The link-test action leaves production attribution and conversion untouched

**Acceptance:** ten named tests — §33.4.5–9 and §33.6.1–5.
