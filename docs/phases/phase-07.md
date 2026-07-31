# Phase 07 — Vetting, type lock, and account claim

**Model:** Opus 4.8 — The type lock is irreversible and its consequences reach twenty phases forward. Provenance tracking and the "Competition is never prefilled" rule are the kind of constraint a weaker model rationalises away.

**Goal:** a Founder moves from an invitation link to a real account, having locked their campaign type permanently, with every prefilled field carrying provenance and every keystroke surviving a network failure.

The first real Founder journey, and the first genuinely irreversible decision in the product.

---

## Read first

- Spec §9 — Phase 3, the whole vetting sequence
- Spec §10 — Phase 4, possible-creator result and account claim
- Spec §4.1 and §4.2 — what each campaign type commits the Founder to, since this is where they choose
- Spec §23.1 — the `invited_draft` → `vetting_submitted` → `account_claimed` transitions
- DNA §5.9 — flow, one thing per screen
- DNA §5.12 — position survives; coming back never means starting over

---

## Prerequisites

Phase 06 green. Phase 02's Flow primitive is the backbone of this phase — don't rebuild it here.

---

## Scope

### 1. The vetting sequence

Five steps, **fixed order**, one decision at a time (§9). Visual arrangement follows DNA; the sequence and information do not vary.

```
1. Campaign path   2. Problem   3. Solution   4. Competition/positioning   5. Possible-creator result
```

Always shows current progress, Back/Continue, autosave status, and restored-draft information. **Returning to an earlier step preserves later valid answers** — this is a flow, not a wizard that discards forward state.

### 2. Step 1 — campaign path, and the lock

`I have an idea` → Idea Campaign. `I have a product` → Product Campaign.

**The type locks permanently when vetting is submitted.** Campaign setup displays it read-only thereafter. There is no migration path and none may be built.

A wrong locked type is handled by archiving the record and beginning a new vetting record. Before listing-fee payment, Admin may create the replacement without another fee; after payment, cancellation and refund rules control. **No Creator acceptance, reward, payment, or consent record is copied automatically** to the replacement.

Because everything downstream branches on this — threshold vs no threshold, one pre-order vs many, refund policy source, payment schedule, fixed-payment legality, public page contents — the step must explain what is being chosen in plain language before it is chosen.

### 3. Steps 2–4 — provenance

| Step | Prefill | Storage |
|---|---|---|
| **Problem** | Human-prefilled by Proovd from discovery | original text, current text, supplier (`Proovd` or `Founder`), edit timestamps |
| **Solution** | Human-prefilled by Proovd | same |
| **Competition/positioning** | **Always blank** | same |

**Competition is never prefilled and must never be represented as AI-generated.** §9 states this twice and §33.1.5 tests it. It is the one field that proves the Founder did their own thinking, and prefilling it destroys the signal the whole vetting exists to capture.

Each high-friction field may explain why it's needed — the decision it supports, the evidence expected, what happens next. It must not become legal overcopy (§9). Run DNA §5.7's deletion test on every line.

### 4. Autosave

Status reads `Saving…`, `Saved [local time]`, or `Could not save — retrying`.

- A failed save **never clears valid fields**.
- Returning restores the latest saved draft and says when it was saved.
- Leaving with newer unsaved data triggers a browser warning.
- Network, validation, server, and provider errors preserve all valid values and offer a safe next action.

This is where DNA §5.12's "position survives" becomes a tested requirement rather than a principle.

### 5. Step 5 — the possible-creator result

Shown immediately after valid vetting and **before** account creation, payment, or Stripe onboarding. It displays a count of *creators who may be relevant*, and states plainly that:

- the count is a relevance signal based on submitted information;
- it names no Creator;
- it is not the recruited or accepted roster;
- it guarantees neither participation nor results;
- campaign-specific recruitment may already be underway;
- the listing-fee refund protection remains available if there are zero eligible recruits, or no mutual locked acceptance within the formal 72-hour window.

**For the pre-screened invited cohort the result must not be zero.** A zero result routes to Admin before the Founder proceeds — it does not render.

### 6. Account claim

Prefilled from invitation and discovery, **every prefilled field editable**: legal and preferred name, email and ownership status, phone marked unverified, date of birth, country and state, business name/entity or sole-proprietor status, password creation or Google sign-in, Terms + Founder AUP + privacy + applicable policy acceptance, and US/18+ and sanctions representations.

Every prefilled field stores whether Proovd or the Founder supplied the current value, plus edit timestamps.

Successful claim, atomically:

- creates the Founder account,
- invalidates the draft token,
- preserves the draft and its provenance in the account and campaign record,
- emits `founder_signup_complete` **exactly once**,
- moves the campaign to `account_claimed`.

### 7. Admin view

Admin sees the live saved draft, provenance, completeness, last-save time, and errors — and **does not re-enter Founder data**. Admin can revoke the draft or assist through support. Account-claim time and provenance appear in the campaign detail from Phase 06.

---

## Out of scope

The Affiliate handoff that §10 attaches to `founder_signup_complete`. **Emit the event here; Phase 08 consumes it.** Affiliates don't exist yet, so there is nothing to reveal a preparing campaign to.

Also out: optional items and the interview (Phase 09), Stripe onboarding (Phase 10), campaign building (Phase 12).

---

## Traps

- **Never prefill Competition.** Not from discovery, not from an LLM, not "as a starting point." §33.1.5 tests it directly.
- **The possible-creator result must not promise acceptance** (§33.1.6). It is a relevance signal. Copy that implies a roster is a failure.
- **Type lock is permanent and there is no migration.** If the model proposes a "change type" affordance, that's §1 rule 6 — inventing a rule the Spec forbids.
- **`founder_signup_complete` emits once.** Retries, duplicate submissions, and concurrent claims produce one event and one account (§33.1.9).
- **No SMS OTP anywhere** (§33.1.8). Phone is collected and explicitly unverified.
- **A failed save must not clear the field.** The obvious implementation — clear on error, re-fetch — loses the Founder's work and is the single most common autosave bug.
- **Don't rebuild the Flow primitive.** Phase 02 owns it. If it needs extending, extend it there.
- **The draft token invalidates on claim**, and a second concurrent claim gets the standard safe failure from the Phase 04 conditional `UPDATE`.

---

## Done when

- [ ] Step order, progress, Back/Continue, autosave, restore, unsaved-data warning, and provenance all work — **§33.1.4**
- [ ] Competition cannot be prefilled by any path — **§33.1.5**
- [ ] The possible-creator result renders before account creation and promises nothing — **§33.1.6**
- [ ] A zero result for an invited-cohort Founder routes to Admin instead of rendering
- [ ] Type locks at vetting submission; a wrong type archives and restarts **without migrating agreements, payments, or consents** — **§33.1.7**
- [ ] No SMS OTP path exists — **§33.1.8**
- [ ] `founder_signup_complete` emits exactly once under retry and concurrent claim — **§33.1.9** (revelation half deferred to Phase 08)
- [ ] Returning to step 2 after completing step 4 preserves step 4's answer
- [ ] Killing the network mid-save preserves every valid field and shows `Could not save — retrying`
- [ ] Every prefilled field records supplier and edit timestamps
- [ ] Campaign reaches `account_claimed`; the draft token is invalidated; the draft is preserved
- [ ] Keyboard and screen-reader pass across the whole flow at 320px

**Acceptance:** §33.1.4 through §33.1.9 — six named tests, the full remainder of §33.1.
