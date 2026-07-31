# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Proovd MVP. A founder-led crowdfunding platform: vetted Founders run campaigns, hand-recruited Creators promote them, Backers save a card and are charged later under a disclosed rule, and Admin operates almost everything manually behind a polished surface.

You are building this one phase at a time. **Read the phase file you were given, then read the Spec sections it names.** Do not work from memory or from paraphrase.

---

## Authority

1. `docs/spec/Proovd-MVP-Engineering-Implementation-Spec-v1_0.md` — behavior, roles, data, state, money, tax, acceptance. Wins on all of it (§1.8).
2. `docs/spec/Proovd_DNA.md` + `frontend/public/proovd.css` — visual, interaction, motion, content design. Wins where the Spec is silent on visual treatment.
3. `docs/tech-stack-v2.md` — implementation mechanics.
4. `docs/master-plan.md` — sequencing.

`§N` below always means a section of the Engineering Spec.

---

## Repository state — read this before looking for a file

This repo is **pre-Phase-1**. It holds only the governing documents plus staged design-system and prebuilt-integration files. **There is no application code yet.** `frontend/`, `backend/`, and `shared/` do not exist. The code tree in `docs/tech-stack-v2.md` §11 is the *target* layout, and the paths this file names — `shared/money`, `backend/src/auth/token-service.ts`, `frontend/src/motion/MotionProvider.tsx`, `frontend/public/proovd.css` — are where things *will* live, not where they are now. Never assume a path this file references already exists; check first.

What is actually on disk today, and where the docs point instead:

| Thing | Referenced in the docs as | Actually at |
|---|---|---|
| Engineering Spec | `docs/spec/…-Spec-v1_0.md` | `docs/spec/Proovd-MVP-Engineering-Implementation-Spec-v1_0.md` ✓ |
| DNA | `docs/spec/Proovd_DNA.md` | `docs/spec/Proovd_DNA.md` ✓ |
| Stylesheet / motion runtime | `frontend/public/proovd.css`, `…/proovd-motion.js` | `docs/spec/proovd.css`, `docs/spec/proovd-motion.js` (staged) |
| Vendored GSAP + smoke test | `frontend/public/vendor/gsap/…`, `…/gsap-check.html` | `docs/gsap/vendor/gsap/…`, `docs/gsap/gsap-check.html` (staged) |
| Phase files | `docs/phases/phase-NN.md` | only `phase-00.md` exists so far |

The two spec files now match the paths the docs reference. The remaining rows are still staged under `docs/` — open by the "Actually at" column until Phase 0 moves them. Phase 0 (`docs/phases/phase-00.md`) is a **human** step, not a Claude Code session: it moves the staged files to their target paths under `frontend/`, `backend/`, and `shared/`, and runs the `gsap-check.html` smoke test. Phase 1 is the first Claude Code session and scaffolds the workspaces, Docker, Postgres, and test harness (`docs/master-plan.md` §6).

## How a session works

One phase per session (`docs/master-plan.md` §1.3): read `docs/phases/phase-NN.md`, then read only the Spec sections it names — not from memory — build, run **that phase's named §33 acceptance tests**, and commit only when every one passes. Serial: never start a phase whose predecessors aren't green. If the phase is too large for one session, stop and say so; a truncated session produces code that looks finished and isn't. Phase sequencing and the 00–24 table live in `docs/master-plan.md` §6.

## Toolchain (established Phase 1, per `docs/tech-stack-v2.md` §2, §11, §13)

Nothing below runs yet — these are the commands the scaffolding will expose, so a future session knows what to reach for once it exists.

- **Repo:** npm workspaces — `frontend/` (React 19 + Vite), `backend/` (Express 5), `shared/` (Zod schemas, money waterfall, state machines, calendar). One root `package.json`, one multi-stage `Dockerfile`.
- **DB:** Postgres 16 + Drizzle; `drizzle-kit` generates and applies migrations. Money is integer cents in `bigint`.
- **Tests — map §33 directly, do not invent a parallel plan:** Vitest for domain units; supertest + a real Postgres test container for API integration; Stripe **test clocks** for payment outcomes; Testing Library for consent/checkout/cancel/card-recovery surfaces; Playwright for the one full-lifecycle E2E; `axe-core`-in-Playwright plus manual keyboard/screen-reader passes for §33.11. To run one test, use Vitest's filter (`vitest run -t "<name>"` / path).
- **Local Stripe:** the Stripe CLI forwards webhooks; its signing secret lives in local env only. Mount raw-body parsing on webhook routes **before** `express.json()`.
- **Env:** copy `.env.example` (variable names only; `docs/tech-stack-v2.md` §17). `backend/src/env.ts` is Zod-validated and fails closed on any live/test key or mode mismatch.

---

## Invariants — these are never violated

### Invent nothing (§1 rule 6)

No new commercial rule, deadline, fee, eligibility condition, payout rule, campaign state, or consent. If a case isn't expressly automated, route it to Admin review and preserve a complete audit record. If something seems missing, say so — do not fill the gap.

### Naming (§3)

| Internal only | Customer-facing |
|---|---|
| `reservation` | Pre-order |
| `affiliate` | Creator |
| `pre_build` | Idea Campaign |
| `pre_launch` | Product Campaign |
| `single_payment` | Single Founder payment |
| `first_payment` / `remaining_payment` | First payment / remaining payment |

Also internal: `captured_charge`, `listing_fee`, `platform_fee`, `founder_share`, `affiliate_compensation`.

**Banned everywhere, including table, column, job, and log names:** `pledge`, `donate`, `MBP`, `tranche`, `goal` (for an Idea threshold), `escrow`, `custody`, `trust`, `held in a Proovd account`, `all-or-nothing`, `Day 30`. Internal names leak into Admin panels, error messages, and support transcripts — §3.1 treats that as a real risk, not a style preference.

`pre-build` / `pre-launch` / `reservation` / `tranche` must never render to a Founder or Backer. Sample URLs may keep `sample-pre-build` / `sample-pre-launch`.

### Money

- **Integer cents in `bigint`.** Never floats, never `NUMERIC` arithmetic in app code.
- **Sales tax is excluded from** the Proovd 5%, every Creator percentage, the Idea threshold, and the $50,000 cap (§24.3).
- **One implementation** of the waterfall, in `shared/money`. Both the checkout preview and the close batch call it. Never write a second one.
- The provisional Creator amount is a **liability account and is never Proovd revenue** (§24.4). Unearned remainder returns to the Founder exactly once.
- Three streams never commingle: campaign charges (Connect, Founder is MoR), listing fee (direct Checkout, Proovd is MoR, `PROOVD LISTING`), fixed Creator payment (own allocation, no percentage applies).

### State (§23)

- `campaigns.status` is **lifecycle only**. Never put a payment flag in it.
- `affiliate_roster_status` and `campaign_build_status` are separate columns. `review_ready` is derived, never stored as truth.
- Payment/reconciliation flags are independent rows with timestamp, amount, actor, evidence, provider IDs.
- Association status (19 states) and reservation status (11 states) are their own enums.
- Every transition is append-only history. Illegal reversals must be impossible. A successful SetupIntent stays historical even after the reservation is canceled.

### Idempotency — three mechanisms, all required

1. `provider_events` — unique on the Stripe event ID. Insert-or-skip before any domain work.
2. `idempotency_keys` — stable domain keys for close-batch attempts, capture retries, fixed-payment funding, Transfers, refunds.
3. `notification_deliveries` — unique on (event, target, entity).

A duplicate event may update audit. It may never duplicate domain state, money, or a message. Running the close batch twice, receiving duplicate webhooks, or crashing mid-batch must all be safe (§33.7.7).

### Time

- `timestamptz` everywhere, stored UTC, rendered local with UTC secondary (§27.1).
- The three anchors — `listing_paid_at`, `campaign_live_at`, `campaign_close_at` — are dedicated columns. **Never infer them from `created_at`/`updated_at`** (§21).
- Business-day deadlines use the committed versioned holiday calendar in `shared/calendar`, and the version string is stored alongside the computed timestamp. A retry or edit can never silently reset a deadline (§29.6).

### Audit (§25.6)

Insert-only. `UPDATE` and `DELETE` are revoked from the app role at the database level. Every manual or high-impact action records actor, MFA/reauth context, target, action, time, internal reason **and** customer-facing explanation as separate columns, prior and new value, amount, provider IDs, evidence links, notification IDs.

### Never imply automation that doesn't exist (§1.4)

The MVP is manual behind a polished surface. Present manual steps truthfully as guided review, safety control, or human support. Manual work is valid **only when the app records it** (§1.3).

### Tokens (§28.1)

Backers have **no account**. Use `backend/src/auth/token-service.ts` — never Better Auth's magic-link plugin, which creates accounts and sessions. Raw tokens exist only in the delivered URL: never at rest, never in a log, never in an error. Every rejection returns the identical value; invalid, expired, revoked, claimed, and never-existed are indistinguishable to the caller (§5.5).

### Forbidden patterns (§30, DNA §5.10)

No confetti, streaks, or countdown pressure that confuses a saved card with a charge. No fake scarcity, fabricated popularity, or live-viewer counts. No AI support presented as human. No public leaderboards. No prechecked optional consent. No live chat without staffing. No "real time" claims for refresh-based data. No generic errors without money/data status and recovery. No competing actions in payment, cancel, refund, or card-recovery states.

---

## Frontend rules

- **`proovd.css` only.** No Tailwind, no shadcn, no CSS-in-JS. Never write a hex literal — read a var or a mode slot. Never write an arbitrary spacing value — use `--sp-*`. `px` is legal only for borders, radii, and the 44px touch minimum.
- **Radix is headless.** Behavior and ARIA only; styled with `proovd.css` classes; default `data-state` transitions disabled.
- **GSAP is the only motion runtime** (DNA §6). Never CSS transitions, never the Web Animations API, never another library — not as a fallback, not as a simplification. Never `import` gsap from npm; never install the package. The vendored files in `frontend/public/vendor/gsap/` are the source of truth.
- **Motion in React** goes through `frontend/src/motion/MotionProvider.tsx`. Any subtree rendering `data-*` motion attributes on changing content calls `useProovdMotion(ref, deps)`. Anything driven by React state uses the imperative API. Hand-written GSAP is wrapped in `useGsapScope`. Skipping this makes animations die silently as the app grows.
- **Fail loud, never silent.** If GSAP or Satoshi fails to load, the accent-yellow notice renders. Never suppress it.
- **One question per moment, one hero, one delight** (DNA §5.1, §5.6, §5.8). Complexity is staged into Glance / Act / Explore, never deleted (§5.14).
- **Accessibility is an acceptance test**, not a polish pass: 320px, keyboard, focus order, 44px targets, screen reader (§33.11).

---

## Definition of done

A surface is complete only with all of §1.1: content and actions; loading, empty, waiting, success, failure, expired, revoked, suspended, and retry states; server-side authorization; persistent records and version history; state-transition and idempotency protection; transactional notification and durable history; Admin visibility, ownership, due time, and recovery action; audit event; mobile, keyboard, focus, label, contrast, and screen-reader behavior; named acceptance tests including negative and duplicate-event cases.

Every waiting, review, payment, recovery, or exception state answers the six questions (§27.1): what happened, what next, who owns it, when's the next update, what can I do now, how do I get help without losing context.

**A phase is not done until its named §33 tests pass.** §33's own framing: these are requirements, not examples. Do not commit a phase with a failing named test.

---

## Working notes

- Stripe runs in **test mode**. Live-mode is gated by §34 and is not yet open. Never render test cards or test controls in production UI.
- The Stripe model is **direct charges on the Founder connected account**. The backup separate-charges path is not built; `STRIPE_TEST_BACKUP_MODE_ENABLED=false`. Never run both for one transaction.
- Mount raw-body parsing on webhook routes **before** `express.json()`, or signature verification will fail.
- A Transfer creation failure is a synchronous API error and a retry-job case. There is no `transfer.failed` webhook to wait for (§32.3).
- Environment fails closed on any live/test key or mode mismatch (§6).
- If the phase you were given is too large for one session, **stop and say so.** A truncated session produces code that looks finished and isn't.
