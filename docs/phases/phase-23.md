# Phase 23 — The P0 pass

**Model:** Opus 5 — Cross-surface consistency requires holding seven renderings of the same fact in mind and spotting the one that disagrees. That's exactly the failure a weaker model produces rather than catches.

**Goal:** every principal flow passes accessibility, every surface agrees with every other surface on the same fact, idempotency holds under adversarial replay, and the measurement baseline is honest.

§32.1's step 17. Nothing new is built — everything already built is verified end to end.

---

## Read first

- Spec §33.11 — accessibility and content QA, all seven
- Spec §33.12 — Admin state, time, security, and measurement, all seven
- Spec §31.9 — first-cohort measurement
- Spec §28.5 — the accessibility and responsive baseline
- Spec §32.5, §32.6, §32.7 — test-card outcomes, the evidence log, architecture tests
- DNA §5.13 — cognitive load and the one-vocabulary rule

---

## Prerequisites

Phases 01–22 green. This phase finds what they missed.

---

## The seam (added by the session that started this phase, per master-plan §1.3 step 6)

Seventeen done-when items across **two complete acceptance sections** — fourteen
named tests, more than any phase in the plan, and every one of them a sweep
across everything built so far rather than a feature with a boundary. The brief
does not name a seam, so this one was written back into the file, on the line the
brief's own acceptance draws:

| Half | Scope | Acceptance | State |
|---|---|---|---|
| **23a** | Scope 1–3: the accessibility sweep across every principal flow, content QA including the built bundle, and the seven-surface cross-surface consistency contract | **§33.11.1–§33.11.7** | **built** |
| **23b** | Scope 4–8: the adversarial idempotency sweep, the §32.5 test-card matrix and its §32.6 evidence log, the §32.7 direct-architecture test, the §31.9 measurement baseline, and the time/security confirmations | **§33.12.1–§33.12.7**, plus the three §32 done-when items | **built** |

The dependency runs one way and both halves are read-only over the product:
§33.11 is about what a person **sees** — the rendered surface, the rendered
message, and whether seven renderings of one reservation agree — while §33.12 is
about what the system **does** under replay, under a clock, and under a stale
session. Nothing in 23a asserts an idempotency property and nothing in 23b
renders a surface; where they touch, 23a's cross-surface register is the
vocabulary 23b's architecture test reconciles against.

**23a builds no test clock, no evidence log, and no scoreboard.**

**What 23b found, and did not route around.** Two of §33.12's claims were held by
nothing. `campaign_payment_flags` was granted `UPDATE` and `DELETE` at the start
and no service ever used them — a trail the application role can rewrite is not
"independently auditable" (§33.12.3), so 0037 revokes the grant. And thirteen
Admin write routes ran without the freshness gate; the first draft of the sweep
required all of them to refuse, which was the wrong answer — `admin.ts` has
recorded since Phase 06a that reauthenticating for ordinary work teaches people
to do it reflexively — so the suite became a partition instead: gated, or
recorded in `UNGATED_ADMIN_WRITES` with the property it lacks.

One register entry was wrong in the other direction and the product was right.
§33.12.3 read flatly says a payment flag may not be a lifecycle state, and the
first draft enforced "no payment word in `campaigns.status`" — which would have
meant renaming five of §23.1's own committed states (`captured_pending_w9`,
`single_payment_released`, and three more) to satisfy a rule the Spec does not
state. §1 rule 6 cuts both ways: the register was corrected, not the enum.

---

## Scope

### 1. Accessibility sweep

**Every principal flow** at 320px, on desktop, by keyboard, and under a screen reader: Founder vetting and account claim · optional items and interview · listing checkout · Creator decisions and proposals · campaign build and review · the public campaign page · Backer checkout · magic-link cancellation and card recovery · support · the Admin panel.

Labels, error summaries with programmatic association, focus order matching reading order, contrast, 44px targets, and **no clipped amount, date, or action**. Images and video carry useful accessible names or captions.

`prefers-reduced-motion` collapses to quick fades, shows full text at once, and **loses no functionality**. The `html.no-motion` path leaves nothing trapped or invisible.

**The contrast exception** from tech-stack-v2 §3.6 is verified as recorded and scoped: brand-fill buttons only. Everything else independently passes AA.

### 2. Content QA

- US English and role names consistent throughout. **No `MBP`, `reservation`, `tranche`, or undefined acronym reaches a Founder or Backer** — grep the built bundle, not just the source.
- **Every CTA names the actual action.** No `Submit`, no `OK`, no `Continue` where something more specific is true.
- No unresolved variable, broken link, old campaign name, or placeholder policy presented as final.
- Loading, empty, waiting, success, and failure states **all** use the six-question pattern.
- DNA §5.13's one-vocabulary rule: each thing has exactly one name, used identically in every moment, button, and toast.

### 3. Cross-surface consistency

The hardest item, and §33.11.5 is explicit about the scope: **campaign, checkout, confirmation, email, magic link, Admin, and evidence must agree** on reward, amounts, seller, trigger, delivery, policy, descriptor, and SLA.

Seven surfaces × eight facts. Build a test that renders one reservation through all seven and asserts field equality — a manual pass will miss the one that drifted.

The statement descriptor is the classic failure: **the computed value must match everywhere** (§33.9.13), and the temptation to hard-code it in a template is high.

### 4. Idempotency sweep

Adversarially replay the state-changing paths built across the project: close batch, capture retry, listing Checkout completion, fixed-payment funding, Transfer creation, refund submission, webhook delivery for every handled event, notification send, draft claim, and campaign activation.

For each: run twice, deliver the webhook twice, kill the worker mid-operation and restart. **One domain change, one money movement, one message, every time.**

### 5. Stripe test matrix (§32.5, §32.6)

Required outcomes, all exercised: successful setup and later charge · generic decline · insufficient funds · off-session authentication and 3DS required · expired card · incorrect CVC and setup failure · processing and API error · full and partial refund · dispute.

Use **current official provider test values** — never hard-code obsolete documentation into the product.

**Retain the §32.6 test evidence log:** environment, connected-account IDs, campaign, reservation, and PaymentIntent IDs, webhook endpoint, scenario, pass/fail, defect, fix, retest, and any unresolved approved blocker. Deleted provider test data is deleted internally or marked an invalid test artifact.

### 6. Architecture test (§32.7)

Prove the direct model: SetupIntent and PaymentIntent are created in the correct Founder account context · the Founder remains MoR in domain records and disclosures · the exact subtotal + tax charge and the separate 5% and provisional Creator amounts reconcile · failure enters retry and success updates every role and Admin surface · the post-close verified Affiliate Transfer occurs once.

The backup separate-charge path is not built, so its test is **not required** — but confirm nothing in the codebase can run both paths for one transaction (§24.1).

### 7. Measurement baseline (§31.9)

The four-number Founder scoreboard, computed **from existing domain events**, with the baseline explicitly labeled `not measured` until the first 10 invited Founders:

- **Time to first magic** — median invitation-open to possible-creator rendering.
- **Founder completion** — opened invitations reaching successful listing payment with connected onboarding complete.
- **Return after closure** — Founders opening Results ready within seven days and completing a real post-campaign action.
- **Next-action correction rate** — sessions where the ranked Act item was dismissed, reclassified, or overridden because state or priority was wrong.

Plus the secondary set: autosave failures, listing-fee support contacts, time to first formal Creator response, proposal outcomes, compensation questions, reservation failure step, reminder delivery and cancel rates, support-free cancellation, payment recovery, unknown-charge contacts and disputes, support SLA misses, delivery satisfaction and follow-up, and duplicate messages suppressed versus sent.

**Do not build a general analytics warehouse** (§31.9). And do not improve metrics by hiding cancellation or support, prechecking consent, or redefining failures — that last line is a product constraint, not an analytics one.

### 8. Time and security

Confirm `listing_paid_at`, `campaign_live_at`, and `campaign_close_at` **independently** anchor every deadline. Confirm the replacement deadline is exact, calendar-versioned, and cannot silently reset. Confirm lifecycle and payment flags remain separate and independently auditable. Confirm MFA is enforced and a sensitive action without recent reauthentication fails safely.

---

## Out of scope

New features. If this phase finds missing behaviour rather than a defect, record it and fix it in the phase that owns it.

---

## Traps

- **Grep the built bundle, not the source.** Banned vocabulary hides in generated strings and template literals.
- **Cross-surface consistency needs a test, not a review.** Eight facts across seven surfaces is beyond reliable manual checking.
- **The descriptor is computed everywhere or wrong somewhere.**
- **Idempotency must be tested adversarially.** Replaying a webhook is not the same as killing a worker mid-transaction.
- **`not measured` is the honest baseline** until 10 Founders. §33.12.6 forbids an invented one.
- **Reduced motion must lose no functionality** — not just look calmer.
- **Don't fix a spec violation by changing the spec's intent.** If something can't pass, that's a finding, not a licence to reinterpret.

---

## Done when

- [x] All principal flows pass at 320px, desktop, keyboard, and screen reader — **§33.11.1**
- [x] Labels, errors, focus, and amounts, dates, actions are intact — **§33.11.2**
- [x] No banned vocabulary or undefined acronym reaches a Founder or Backer — **§33.11.3**
- [x] Every CTA names the actual action — **§33.11.4**
- [x] All seven surfaces agree on all eight facts — **§33.11.5**
- [x] No unresolved variable, broken link, old name, or placeholder policy — **§33.11.6**
- [x] Every state uses the six-question pattern — **§33.11.7**
- [x] The three anchors independently drive every deadline — **§33.12.1**
- [x] The replacement deadline is exact, versioned, and non-resettable — **§33.12.2**
- [x] Lifecycle and payment flags stay separate and auditable — **§33.12.3**
- [x] Admin auto-population works; every override records before, after, reason, actor, time — **§33.12.4**
- [x] MFA is enforced; stale reauthentication fails safely — **§33.12.5**
- [x] The scoreboard baseline is explicitly `not measured`, with no invented figure — **§33.12.6**
- [x] Cohort metrics come from defined events without hiding cancellations, support, or failures — **§33.12.7**
- [x] Every §32.5 test-card outcome is exercised and logged
- [x] The §32.6 evidence log is complete
- [x] The §32.7 direct architecture test passes; no code path can run both models

**Acceptance:** §33.11 complete (7) and §33.12 complete (7). With these, all 131 tests have been written and passed at least once.
