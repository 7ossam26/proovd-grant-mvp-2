# Phase 09 — Optional items, interview, high-effort, and the listing fee

**Model:** Opus 4.8 — The evidence rules are a long list of near-misses that must each be rejected, and high-effort feeds the compensation matrix twelve phases later. Also the first file-upload surface, which is where quiet security mistakes live.

**Goal:** the Founder can complete five optional items, book a real interview without leaving the product, and see an itemised listing fee — with every completion backed by objective evidence rather than a self-report.

Money is calculated here. It isn't charged until Phase 11.

---

## Read first

- Spec §12 — Phase 6, in full
- Spec §6 — the fee constants and interview configuration
- Spec §24.6 — the listing fee as a separate stream
- Spec §25.1 — what the campaign record stores for optional items and high-effort
- `docs/tech-stack-v2.md` §9 (R2 storage) and §12 (Cal.com)
- DNA §5.9 — the workspace is a flow, not a dashboard

---

## Prerequisites

Phase 07 green. Phase 03's `shared/money` already implements and tests the fee and high-effort calculations — **this phase integrates them, it does not reimplement them.**

---

## Scope

### 1. The workspace

Five optional items, each worth a $2 discount on objective completion. Presented **one coherent decision at a time** with progress, Back/Continue, autosave, save recovery, and a complete preview/summary in the secondary surface.

§12 is explicit that this is **not a widget dashboard or an endless form.** Use the Phase 02 Flow primitive.

### 2. Objective completion rules

Each item completes only on evidence. Self-assertion never counts.

| Item | Completes when |
|---|---|
| **Visuals** | At least one non-placeholder visual or video, uploaded, accessible, and Founder-approved for campaign use |
| **Branding** | A usable logo or wordmark **and** a saved direction containing at least colours and typography/style guidance, Founder-approved |
| **Interview** | The embedded booking has status `confirmed`. Selected-but-unconfirmed, canceled, or abandoned does **not** count |
| **Story** | A Founder-approved public campaign story is saved. A prompt response, transcript, generated summary, or unapproved draft does **not** count |
| **Socials** | At least one valid, accessible, public Founder or product social profile the Founder controls |

**Explicitly rejected:** empty files, placeholders, duplicate uploads, inaccessible URLs, unapproved drafts, unconfirmed appointments. §33.3.1 tests these directly, so build the rejections deliberately rather than discovering them.

Each item stores evidence, completion timestamp, and decision source. Admin may invalidate an item **before payment** with a recorded reason, and the Founder can correct it. **After payment, the calculation and evidence snapshot lock** (Phase 11 performs the lock; this phase makes the snapshot lockable).

### 3. File upload — R2

Browser POSTs to a presigned URL from the backend. **No file touches the VPS disk.** `sharp` runs server-side only, for thumbnails, on objects fetched back from R2.

Validate content type and size server-side, not just in the browser. "Non-placeholder" and "accessible" are real checks: a zero-byte file, a 1×1 pixel, or a URL that 404s does not complete the item.

### 4. Interview — Cal.com

The Founder books a **human Proovd interview** without leaving the product.

The booking record holds: available times in the Founder's timezone, the meeting provider (Google Meet, Zoom, or Teams), the scheduled time **and its canonical UTC value**, timezone, provider link, interviewer, status, reschedule history, and cancellation.

Confirmation, reminder, reschedule, and cancellation notifications all go through the Phase 03 registry.

**Our database is the source of truth, populated from Cal.com webhooks.** `interview_confirmed` gates a $2 discount and one third of the high-effort classification — it cannot live in a vendor's system.

**Cancellation asymmetry, and it matters:** canceling *before* listing-fee payment recalculates both high-effort status and the fee. Canceling *after* successful payment does **not** change the amount already paid. §33.3.3 tests both directions.

### 5. High-effort classification

`high_effort = true` **only** when all three are absent at calculation time: no completed Visuals, no completed Branding, no scheduled or confirmed interview.

Store the three inputs, the result, the calculation time, and the actor or system.

**Present the criteria neutrally.** It is not a quality judgment and must not read as one. It controls only whether a Creator may bid above base — it does **not** control fixed-payment availability (§12).

### 6. Fee calculation and preview

```
base            = $35
discount        = $2 × completed items      (cap $10)
subtotal        = max($25, $35 − discount)
sales tax       = Stripe Tax on Proovd's direct listing service
checkout total  = subtotal + tax
```

The preview itemises: the $35 base line, **each earned $2 saving as its own labeled line**, tax, and total due now. It also carries the separate explanation that Proovd later retains 5% of captured campaign reward subtotal — a different stream, not part of this charge (§24.6).

The 5% campaign fee is untouched by any of this.

### 7. Helper resources

Static, copy-ready guidance for Competition, Branding, Visuals, and Story — including the reusable prompts §12 describes for AI-assisted work.

**This is not an embedded AI product.** §30 defers AI pitch rewriting and refinement. Guidance the Founder reads and applies elsewhere is in scope; a generate button is not.

### 8. Admin and Affiliate views

**Admin** sees every item, its evidence, status, discount line, the high-effort inputs, the fee preview, interview state, invalidation history, and any override. A manual override requires prior value, new value, reason, actor, time, and evidence.

**Affiliate** — the preparing Campaign kit may now show available materials and the high-effort result with its objective basis. It still must not present a mutable compensation decision (§12).

---

## Out of scope

Listing-fee **payment** and the lock — Phase 11. Stripe Tax wiring — Phase 10 establishes the client, Phase 11 uses it for Checkout. Campaign building — Phase 12.

---

## Traps

- **Evidence rules are the substance of this phase.** An item that completes because the Founder clicked "done" defeats the entire discount mechanism.
- **`confirmed` is not `selected`.** A held slot, an abandoned booking, and a canceled booking all fail the interview item.
- **A transcript is not a Story.** Neither is a generated summary or an unapproved draft. Founder approval is the completing act.
- **Don't recalculate in the UI.** The fee and high-effort come from `shared/money`. A second implementation in a React component is how the preview and the charge diverge.
- **High-effort is neutral.** Copy implying the Founder underperformed violates §12 and DNA §5.10's guardrails.
- **Presigned uploads must be scoped and short-lived.** Don't issue a URL that grants broader bucket access than the one object.
- **Cal.com is a source of events, not truth.** If the webhook is missed, the booking state must be reconcilable — don't leave `confirmed` reachable only by webhook.
- **No AI generation button.** §30.

---

## Done when

- [ ] Evidence rules reject placeholders, empty files, duplicate uploads, inaccessible links, unapproved Story, and unconfirmed interview — **§33.3.1**
- [ ] Every combination of completed items produces $35 − $2/item, floored at $25 — **§33.3.2** (integration; unit-tested in Phase 03)
- [ ] Canceling the interview before payment recalculates high-effort **and** the fee; after payment neither changes — **§33.3.3**
- [ ] High-effort is correct across all eight input combinations — **§33.3.4** (lock at payment lands in Phase 11)
- [ ] The fee preview shows the base line, each $2 saving separately, tax, and total
- [ ] The preview explains the separate 5% campaign fee without conflating the streams
- [ ] Uploads go browser → R2 presigned; nothing is written to the container disk
- [ ] Booking records carry local time, canonical UTC, provider, link, interviewer, status, and reschedule history
- [ ] All four interview notifications fire, once each
- [ ] Admin can invalidate an item pre-payment with a reason, and the Founder can correct it
- [ ] The workspace is a one-decision-at-a-time flow with working autosave and recovery
- [ ] Helper resources contain no generate action

**Acceptance:** §33.3.1, §33.3.2, §33.3.3, §33.3.4.
