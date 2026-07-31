# Proovd MVP — Master Plan

**Status:** Controlling build document. Subordinate to the Engineering Spec and the DNA system; superior to any phase file.

**Operating reality:** one developer plus Claude Code. No fixed deadline. The grant requires **real money collected**, which makes Spec §34's live-mode gate a hard deliverable.

---

## 1. How to use this plan

### 1.1 Authority chain

1. **`docs/spec/Proovd-MVP-Engineering-Implementation-Spec-v1_0.md`** — product behavior, roles, data, surfaces, state, payments, tax, operations, acceptance. Wins on everything in §1.8's list.
2. **`docs/spec/Proovd_DNA.md` + `proovd.css` + `proovd-motion.js`** — visual treatment, interaction, motion, content design. Wins where the Spec doesn't define visual treatment.
3. **`docs/tech-stack-v2.md`** — implementation mechanics only.
4. **This plan** — sequencing and scope only.
5. **`docs/phases/phase-NN.md`** — the working instruction for one session.

A phase file may never introduce a rule. If a phase file and the Spec disagree, the phase file is a bug. Fix it there.

### 1.2 The repository is the context

Everything above lives in the repo. Claude Code reads the Spec directly rather than receiving a paraphrase of it — paraphrase is where detail dies. `CLAUDE.md` sits at the root and loads automatically every session, carrying the invariants so no phase file has to restate them.

```
proovd-app/
├── CLAUDE.md
└── docs/
    ├── spec/          Engineering Spec, DNA, proovd.css
    ├── tech-stack-v2.md
    ├── master-plan.md          ← this file
    └── phases/phase-00.md …
```

### 1.3 Running one phase

Serial. One phase per session. Never start a phase whose predecessors aren't green.

1. Open a fresh Claude Code session. Point it at `docs/phases/phase-NN.md`.
2. It reads the phase file, then the Spec sections that file names.
3. Build.
4. Run the phase's named §33 acceptance tests. They are requirements, not examples — §33's own words.
5. Commit only when every one passes.
6. If the phase revealed the plan was wrong, **edit the affected phase files before moving on.** This is the feedback loop; skipping it is how a plan rots.

If a session runs out of context mid-phase, that phase was too big. Split it in the file, don't push through — a truncated session produces code that looks finished and isn't.

---

## 2. Track A — the non-code critical path

**Start today. These run in parallel with the entire build and none of them is a coding task.**

| | Item | Why it's on the critical path | Owner |
|---|---|---|---|
| A1 | **Stripe Connect platform application + underwriting** | Longest lead on the project. Crowdfunding-adjacent platforms draw real underwriting scrutiny. May return with conditions that change §24.1's account model. Everything in §34 waits on it. | You |
| A2 | **The eight canonical policy documents + legal review** | §18 and §31.4: complete canonical text, no placeholder, no summary-only. §34 gates on it. Legal review has its own lead time. | You + counsel |
| A3 | **Tax configuration** | Founder is seller/MoR, so per §31.7 each Founder needs head-office location, product tax code, registration, and active provider tax settings before live collection. With real money this is a live operational requirement, not a config flag. | You |
| A4 | **Accounts and assets** | Satoshi `.woff2` files, Cal.com, Tawk.to, Resend domain verification, R2 buckets (including the separate sensitive bucket), Sentry, PostHog, UptimeRobot. | You |
| A5 | **Contrast exception sign-off** | tech-stack-v2 §3.6. A recorded, dated, owner-attributed design decision. Blocks §33.11. | You |
| A6 | **Pilot monitoring + rollback owners** | §34's final line. Named humans, not a process document. | You |

**A1 is the one that can wreck the schedule.** If underwriting returns conditions that force §24.1's backup model — separate charges with `on_behalf_of` — the ledger, milestone, and disclosure rules are unchanged, so the damage is contained to the payments layer. That containment is *why* the plan builds the ledger in Phase 3 and the Stripe wiring in Phase 10, not the other way round.

---

## 3. Decisions already locked

Do not relitigate these in a phase.

| Area | Decision |
|---|---|
| Stripe model | Direct charges on the Founder connected account. Founder is MoR. Proovd 5% + provisional Creator liability ride in the platform-side application fee. Founder bears processing fees. Backup path unbuilt; `STRIPE_TEST_BACKUP_MODE_ENABLED=false`. |
| Styling | `proovd.css` only. No Tailwind, no shadcn, no CSS-in-JS. |
| Components | Radix headless, styled by `proovd.css` classes, all default animation disabled. |
| Motion | GSAP 3.15.0 vendored + `proovd-motion.js`. React integration via the prebuilt `MotionProvider`. |
| Fonts | Satoshi, self-hosted woff2. |
| Auth | Better Auth for Founder / Affiliate / Admin. Backer uses the prebuilt token service — **not** Better Auth's magic-link plugin. |
| Routes | `app.proovd.co` owns every §18 public route, including policies and campaign pages. First-party attribution cookie requires one origin. |
| Interviews | Cal.com Cloud, embedded, webhooks → our DB as source of truth. |
| Jobs | pg-boss, with domain-level idempotency keys. |
| Money | Integer cents in `bigint`. Never floats. |

---

## 4. Domain model

### 4.1 The two axes everything branches on

**Campaign type**, locked permanently at vetting submission (§9), no migration path. Forks: threshold vs none, one pre-order vs many per Backer, refund policy source, Founder payment schedule, fixed Creator payment legality, public page contents.

**Phase position**, which determines what each of the four actors can see and do. Every Spec phase specifies all four lenses; a role marked "no direct surface" may still receive a notification or generate a record.

### 4.2 Three separate state machines

Never collapse these into one column. §23.1 vs §23.3 is a schema instruction.

- **`campaigns.status`** — 25 lifecycle states, `invited_draft` → `closed_resolved`. Lifecycle only.
- **`campaigns.affiliate_roster_status`** — `forming` / `launch_ready` / `failed`.
- **`campaigns.campaign_build_status`** — `not_started` / `in_progress` / `complete`.
- **`review_ready`** — derived from the two above. Never stored as truth.
- **Payment/reconciliation flags** — independent rows carrying timestamp, amount, actor, evidence, provider IDs. Not enum values on the campaign.
- **`campaign_affiliate_associations.status`** — 19 states (§23.4), with initial-roster vs mid-campaign stored separately.
- **`reservations.status`** — 11 states (§23.5). Append-only history. Illegal reversals impossible. A successful SetupIntent stays historical even after cancellation.

### 4.3 The ledger

§24.3's waterfall, stored as persisted columns, not derived on read:

```
reward_subtotal_cents
sales_tax_cents
total_captured_cents
proovd_fee_cents                 5% of reward_subtotal — tax excluded
affiliate_provisional_cents      liability account; NEVER Proovd revenue
affiliate_earned_cents
affiliate_unearned_returned_cents
founder_gross_share_cents
stripe_fee_cents
founder_net_cents
```

**Sales tax is excluded from** the Proovd 5%, every Creator percentage, the Idea threshold, and the $50,000 cap. One implementation in `shared/money`, called by both the checkout preview and the close batch. Two implementations will drift, and the drift will be invisible until reconciliation.

**Three money streams that never commingle:** campaign charges (Connect, Founder MoR), listing fee (direct Checkout, Proovd MoR, `PROOVD LISTING`), fixed Creator payment (own allocation/funding/return/Transfer, no percentage applies).

### 4.4 The long-range couplings

These are why the build order isn't the narrative order. Each spans phases that would otherwise look independent.

| Coupling | Set in | Consumed in |
|---|---|---|
| `listing_paid_at` | Phase 11 | 72h Creator deadline, 48h Founder cancellation, refund eligibility |
| Listing-fee refund promise (Appendix A.5) | printed Phase 11 | one trigger only fires at Phase 14 (§29.6 Creator failure) |
| `high_effort` | computed Phase 9, locked Phase 11 | Phase 12's six-cell compensation matrix |
| Attribution | cookie Phase 14 | reservation Phase 15 → provisional pending verification Phase 14 → finalized on capture Phase 18 → paid Phase 19 |
| Tax calculation | created Phase 15 | re-validated at capture Phase 18; unusable ⇒ no charge, no substitute amount |
| Provisional Creator liability | Phase 18 | reconciled and returned to Founder once, Phase 19 |
| Materiality versioning | built Phase 12 | reused verbatim for live editing, Phase 17 |

---

## 5. Cross-cutting contracts

Every phase honors all of these. They live in `CLAUDE.md` so they're in context automatically.

1. **Naming (§3).** Internal: `reservation`, `captured_charge`, `listing_fee`, `platform_fee`, `founder_share`, `single_payment`, `first_payment`, `remaining_payment`, `affiliate_compensation`. Customer-facing: `Pre-order`, `Creator`, `Idea Campaign`, `Product Campaign`. Nothing named to imply escrow, custody, trust, or a Proovd bank hold. `pledge`, `MBP`, `tranche`, `goal`, `Day 30` do not exist in this codebase.
2. **Manual work only counts when recorded (§1.3).** Every manual review, decision, override, money action, and exception stores actor, time, reason, prior value, new value, amount, provider IDs, notes, evidence.
3. **Never imply automation that doesn't exist (§1.4).** Manual steps are presented truthfully as guided review, safety control, or human support.
4. **Invent nothing (§1 rule 6).** No new commercial rule, deadline, fee, eligibility condition, payout rule, campaign state, or consent. Unhandled cases route to Admin review with a complete audit record.
5. **Idempotency, three mechanisms.** `provider_events` unique on Stripe event ID; `idempotency_keys` for domain operations; `notification_deliveries` for messages. A duplicate may update audit, never domain state, money, or a notification.
6. **The six-question pattern (§27.1).** Every waiting, review, payment, recovery, and exception state answers: what happened, what next, who owns it, when's the next update, what can I do now, how do I get help without losing context.
7. **Completeness (§1.1).** A section is done only with: page content and actions; loading/empty/waiting/success/failure/expired/revoked/suspended/retry states; server-side authorization; persistent records and version history; state transition and idempotency protection; notification and durable history; Admin visibility, ownership, due time, recovery; audit event; mobile/keyboard/focus/label/contrast/screen-reader behavior; named acceptance tests including negative and duplicate-event cases.
8. **Forbidden patterns (§30, DNA §5.10).** No confetti or countdown pressure confusing saved card with charge. No fake scarcity or fabricated popularity. No AI support presented as human. No public leaderboards. No prechecked optional consent. No live chat without staffing. No real-time claims for refresh data. No generic errors without money/data status and recovery. No competing actions in payment, cancel, refund, or card-recovery states.

---

## 6. Build sequence

Follows §32.1's recommended order, not the narrative order of §6–22, plus foundation work §32.1 assumes.

Phases 1–3 are pure foundation and pay for themselves across every later phase. Resist the urge to skip to something visible.

### Phase table

| # | Phase | Spec | Acceptance | Notes |
|---|---|---|---|---|
| **00** | **Repo setup — you, not Claude Code.** Files into place, vendor smoke test, Track A kickoff | — | `gsap-check.html` all OK | See `phases/phase-00.md` |
| **01** | Repo, Docker, Postgres, Drizzle, env fail-closed, logging, test harness, deploy | §32.2 | deploy green, one migration, one test | |
| **02** | Design system: proovd.css, GSAP vendor, Satoshi, motion layer, Radix wrappers, flow primitive, a11y baseline | DNA all | component gallery, §33.11.1–2 | Prebuilt files drop in here |
| **03** | Domain kernel: money waterfall, three state machines, business-day calendar, audit, idempotency tables, notification registry | §23, §24.3, §25.6 | §33.3.2, §33.3.4, §33.8.1, §33.12.1–3 | **Highest leverage phase in the plan** |
| **04** | Auth: Better Auth three roles, Admin MFA + freshness, token service, non-enumerating errors | §5, §28.1–2 | §33.1.1–2, §33.12.5 | Prebuilt token files drop in here |
| **05** | Public site, all policy routes, both sample campaigns, footer, trust strip | §18, §31.4, App. A.1 | §33.11.3–7 | Needs A2 |
| **06** | Admin shell, global config, Founder prospect + invitation + secure draft | §6, §7, §26.1–2 | §33.1.1–3 | |
| **07** | Vetting, type lock, possible-creator result, account claim, `founder_signup_complete` | §9, §10 | §33.1.4–9 | |
| **08** | Affiliate recruitment, private signup, waiting/preparing, Campaign kit, pilot pre-view exception | §8, §11 | §33.2.1–4 | |
| **09** | Cal.com interview, five optional items, high-effort, listing-fee calculation | §12 | §33.3.1–4 | Needs A4 |
| **10** | Stripe foundations: connected onboarding, two webhook endpoints, signature verification, provider_events | §32.2–4 | mode mismatch fails closed | Test mode only |
| **11** | Listing Checkout, App. A.5 consent, `listing_paid_at` atomic effects, 72h + 48h clocks, refund with tax reversal | §13, §31.6 | §33.3.5–8, §33.3.11 | |
| **12** | Compensation matrix, proposal versioning, campaign build, `review_ready`, Admin review, materiality + reacceptance | §14, §15 | §33.2.5–13, §33.3.9–10, §33.4.1–2 | **Split if context runs out** |
| **13** | Fixed Creator payment funding, Creator readiness checklist | §16 | §33.4.3–4 | |
| **14** | Campaign page, MoR block, launch order, tracking links, first-post verification, attribution, Day 1–7/Day 8 | §17, §18, App. A.2 | §33.4.5–9, §33.6.1–5 | |
| **15** | Backer pre-order: tax calc, consent, SetupIntent, cap, dedup, magic-link page, cancellation, pre-charge reminder | §19, App. A.3–4 | §33.5 (all 13) | **Split if context runs out** |
| **16** | Admin reservation/charge/duplicate/risk operations | §26.5–7, §31.7 | §33.12.4 | |
| **17** | Live ops: Glance/Act/Explore, live editing, mid-campaign Creator, threshold events | §20 | §33.6.6–13 | |
| **18** | Close batch, tax usability, off-session capture, 48h retry, results | §21 | §33.7 (all 12) | **The critical phase.** Split. |
| **19** | Creator earnings, Transfers, W-9, Founder payments, thank-you | §22.1–3 | §33.8 (all 14) | |
| **20** | Refunds, reversals, disputes, evidence packets, suspension, kill, enforcement | §24.8–11, §26.7, §29 | §33.9 (all 13) | |
| **21** | Fulfillment, Day 14, ghost ban, completion, work-again, cooldown, satisfaction | §22.4–11 | §33.10 (all 10) | |
| **22** | Notification sweep: all ~70 events, digests, in-app history, support SLA | §27 | §33.9.10, §33.9.12 | Registry built in P3, filled throughout |
| **23** | P0 pass: accessibility, content QA, idempotency, cross-surface consistency, measurement | §31.9, §33.11–12 | §33.11 + §33.12 complete | |
| **24** | Live-mode gate | §34 | all 131 | Needs A1–A6 |

**131 acceptance tests total.** Every one is a requirement.

### Dependency notes

- Phase 3 unblocks 11, 12, 15, 18, 19 — everything that touches money or state.
- Phase 10 unblocks 11, 13, 15, 18, 19.
- Phase 14's attribution unblocks 15's reservation attribution and 19's earnings.
- Phase 18 depends on 15's stored tax calculations existing in the shape 18 re-validates.
- Phase 24 depends on the entire build **and** all of Track A.

---

## 7. Definition of done, per phase

A phase is complete when all of these hold:

1. Its named §33 tests pass at server, domain-state, customer-surface, notification, Admin, and audit levels where applicable.
2. Every surface it built satisfies §1.1's completeness list.
3. Every state it introduced answers the §27.1 six questions.
4. Every manual action it introduced writes an audit row per §25.6.
5. Every notification it introduced is in the typed registry and deduplicated.
6. Accessibility holds at 320px, on desktop, by keyboard, and under a screen reader.
7. No banned vocabulary reached a Founder- or Backer-facing surface.
8. Nothing was invented — no rule, deadline, fee, state, or consent that isn't in the Spec.

---

## 8. Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| **Stripe underwriting delays or returns conditions** | Blocks §34 entirely. Real money is a grant requirement. | Start A1 today. Ledger built in P3 independent of Stripe, so a forced switch to the §24.1 backup model is contained to the payments layer. |
| Policy documents late or fail legal review | Blocks Phase 4 and §34 | Start A2 today; Phase 5 can build routes against drafts, but §34 needs final text |
| Per-Founder tax registration burden underestimated | Blocks live collection | A3 now; confirm the operational cost before the first live campaign |
| Phase 18 close batch subtly non-idempotent | Double charges on real money. Unrecoverable reputationally. | §33.7.7 is a dedicated engineering task, not a checkbox. Test crash/restart mid-batch. |
| §33.5.10 cap check implemented as read-then-write | Campaign exceeds $50,000 under concurrency | Database-level atomic check, tested with concurrent requests |
| Motion bindings silently die as the app grows | Gradual invisible degradation | Prebuilt `MotionProvider`; `useProovdMotion` mandatory on re-rendering subtrees |
| Context exhaustion mid-phase | Code that looks finished and isn't | Split the phase file. Never push through. |
| Solo build, no reviewer | Errors compound unseen | The §33 suite *is* the reviewer. Never commit a phase with a failing named test. |
| Resend free tier hit at first close | Failed transactional email during a charge event | Confirm the plan before Phase 19 |

---

## 9. What this plan deliberately excludes

Per §30, deferred: AI pitch rewriting, automated Founder scoring, algorithmic Affiliate matching, Founder browsing of unmatched Affiliates, full teaser mode, reusable Affiliate resource library, Founder–Creator scheduler, direct Founder–Affiliate messaging, real-time sockets, Backer accounts, full dispute center, automated payout decisions, custom tax filing, hosted community, non-US roles, W-8BEN, physical rewards, enterprise procurement, native mobile, percentile pruning, public ratings, push matrix, product tours, recurring Creator management beyond work-again.

---

## Next artifacts

1. **`CLAUDE.md`** — the always-loaded invariants.
2. **`docs/phases/phase-01.md` … `phase-24.md`** — delivered in batches, each self-contained, each naming its Spec sections and its §33 tests.
