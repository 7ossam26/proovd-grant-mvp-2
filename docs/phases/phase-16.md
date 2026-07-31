# Phase 16 — Admin operations: ledger, risk, and support

**Model:** Opus 4.8 — Broad rather than deep, but it's the surface through which every manual decision in the MVP is recorded. Weak audit capture here undermines §1.3 everywhere else.

**Goal:** Admin can see every reservation and charge, monitor the ten risk signals, own support cases against an SLA, and read one chronological timeline per campaign, reservation, or association — with every override recorded.

Spec §2 says the MVP is manual behind a polished surface. This is the surface.

---

## Read first

- Spec §26.5 — reservation and charge ledger
- Spec §26.6 — money controls
- Spec §26.7 — support, dispute, and kill operations
- Spec §26.8 — the chronological customer timeline and handoff notes
- Spec §31.7 — the risk-control inventory
- Spec §27.8 — the service SLA
- Spec §1.3 — manual work is valid only when the app records it
- Spec §25.7 — least-privilege data access

---

## Prerequisites

Phase 15 green — reservations exist to operate on. Phase 06 built the Admin shell this extends.

---

## Scope

### 1. Reservation and charge ledger (§26.5)

Filterable and exportable by: campaign, Founder, Creator/source/organic/house, date, reservation / SetupIntent / PaymentIntent / retry status, refund and dispute state, consent and policy version and optional-consent state, unique Backer versus Product transaction count, duplicate-review case and outcome, subtotal / tax / total, tax expiry and usability, attribution and link activation, and cap result.

Exports are **permitted exports only** — the Founder and Affiliate data-access limits in §25.7 apply to what Admin can hand out, not just what they can see.

### 2. Money controls (§26.6)

Admin sees and reconciles captured subtotal, tax, and total; Proovd's 5%; Founder share and Stripe fee; Creator provisional maximum, earned percentage and bonus, and unearned return; fixed allocation funding, return, and payment; Transfer, payout, reversal, and failure; W-9 and Founder payment status; Product early-release evidence; and the separate thank-you expense.

Most of these populate in Phases 18–19. **Build the surfaces now against the Phase 03 ledger columns** so those phases fill rows rather than inventing views.

**Every high-impact action requires** recent reauthentication, a **preview of customer-visible consequences** before execution, idempotency, and an immutable audit row. The preview is not optional polish — moving money without seeing what the customer will be told is how support contradicts the ledger.

### 3. Risk-control inventory (§31.7)

Surfaced before close and throughout live operations:

Stripe Radar result on every PaymentIntent · the practical Idea duplicate queue · any reservation amount above the highest valid reward price · click velocity and suspicious conversion spikes · Affiliate self-pre-order and duplicate Affiliate accounts · disclosed or suspected Founder–Affiliate relationships · sanctions, OFAC, or provider restriction · tax `not_collecting` or missing-registration results · connected-account requirement or capability changes · batch, webhook, job, and ledger exceptions.

**Zero tax caused by missing collection configuration is not proof that no tax is due.** Surface it as a risk, never as a clean result.

Also track Founder seller tax readiness — head-office location, applicable product tax code, registration, and active provider tax settings — as a gate on live tax collection.

### 4. Support operations (§26.7, §27.8)

Cases carry a stable ID, topic, owner, human-response due time, and the next promised update. Admin sees **due and overdue badges and a daily queue** of responses and promises due.

Submission returns the case ID and states the 48-hour Founder follow-up rule. **Even without resolution, an update goes out at the promised checkpoint.**

Responses start from **editable templates that preserve all context**, so a user is never asked to repeat campaign, reservation, or charge facts the system already holds.

**Raw provider and fraud codes are never pasted into customer messages.** They may appear as secondary support detail in the Admin view only.

When a case changes owner, require a **handoff note** containing verified facts, current owner, the next customer promise, and the statements that must stay consistent.

### 5. Suspend and kill (§26.7)

Requires a **reason category plus free text**.

- **Pre-capture:** close active reservations without charge, block future PaymentIntents, reference-safely detach methods, notify affected roles, and preserve the page with the correct banner.
- **Post-capture:** invoke the refund, reversal, and recovery policy, restrict unreleased funds where possible, notify roles, and preserve evidence.

Post-capture consequences land fully in Phase 20; build the decision, the audit, and the notification here.

### 6. The chronological customer timeline (§26.8)

**One read-only timeline per campaign, reservation, and association**, composing events that already exist rather than logging new ones: invitations, drafts, claims, onboarding, interview and review, Affiliate recruitment through kit access, response, proposals, readiness, activation, proof, completion, earnings and Transfer, pre-order, tax, consent, Founder data sharing, cancellation, SetupIntent, reminder, capture, retry, refund, dispute, threshold crossings, emails with delivery state and suppression, support case with owner and SLA, updates, delivery evidence, payment decisions, Admin actions, and work-again requests.

For the first cohort, Admin may log one-time **human relationship touches** — campaign introduction, launch-eve check, mid-campaign welcome, close thank-you, post-campaign debrief. These are personal service events, **not automated engagement**, and must never become a scheduled sequence.

---

## Out of scope

Executing refunds, reversals, and disputes — Phase 20. Close batch operations — Phase 18. Transfers and Founder payments — Phase 19.

---

## Traps

- **Admin never re-enters data the system holds.** §26.2: user and provider data auto-populates; Admin adds only review, decision, evidence, and override data. §33.12.4 tests this.
- **Every override preserves before, after, reason, actor, and time.** An override without a prior value is unauditable.
- **Never paste a decline code or fraud signal into customer copy.** §33.9.11.
- **`held` is not a synonym for `eligible`, `blocked`, or `released`** (§22.3). Establish the vocabulary here — Phase 19 depends on it.
- **The daily queue must show overdue, not just due.** An SLA nobody can see breached is an SLA that gets breached.
- **Timeline composes, it doesn't duplicate.** A second event store that drifts from the first is worse than no timeline.
- **Least privilege applies to Admin too** (§25.7). Provider-held complete bank and identity data is never copied into Proovd.

---

## Done when

- [ ] User and provider data auto-populates every Admin surface; every override records before, after, reason, actor, and time — **§33.12.4**
- [ ] The ledger filters and exports across all eleven §26.5 dimensions
- [ ] Money-control surfaces exist and read from the Phase 03 ledger columns
- [ ] Every high-impact action demands recent reauthentication and shows a customer-consequence preview first
- [ ] All ten risk signals surface, including `not_collecting` tax treated as a risk rather than a clean result
- [ ] Support cases carry stable reference, owner, due time, preserved context, and the 48-hour Founder follow-up rule — **§33.9.10**
- [ ] Raw provider and fraud codes never reach customer-facing copy — **§33.9.11**
- [ ] Owner changes require a handoff note before the case can move
- [ ] Suspend and kill require a reason category plus free text, and pre-capture behaviour is complete
- [ ] One composed read-only timeline exists per campaign, reservation, and association
- [ ] Human relationship touches are loggable one-offs, with no scheduling affordance

**Acceptance:** §33.12.4, §33.9.10, §33.9.11.
