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

**Phases 00–06 are complete and committed.** Phase 06 was built in two halves — 06a the configuration surface, 06b the invitation — and §33.1.1, §33.1.2, and §33.1.3 all pass. **Phase 07 (Founder vetting and the account claim) is next.** Every path this file names exists at the path it names. `docs/phases/phase-00.md` … `phase-24.md` are all present.

What exists on disk:

| Area | State |
|---|---|
| `shared/` | money waterfall + USD formatting, three state machines, business-day calendar, notification registry, policy register, §6 settings register, Zod schemas |
| `backend/` | Express 5, Drizzle + Postgres, env guard, audit + idempotency tables, Better Auth, token service, guards, `policy_versions` + the §34 policy gate, `app_settings` + history + `production_prerequisites`, **prospects/drafts/invitation sends, Resend + React Email, pg-boss retention sweep**, `/api/admin`, `/api/draft` |
| `frontend/` | design-system components, `MotionProvider`, the fourteen §18 public routes, the Admin shell at `/admin` (Founders, configuration, prerequisites), **the Founder draft landing at `/draft/:token`**, dev-only gallery at `/_gallery`, `/link-unavailable` |
| `frontend/public/` | `proovd.css`, `proovd-motion.js`, `vendor/gsap/*.min.js`, `gsap-check.html` |

Four gaps to know about, none of them a bug:

- **`frontend/public/fonts/` is empty.** `proovd.css` already declares `@font-face` against `Satoshi-Variable.woff2` and `Satoshi-VariableItalic.woff2`. Until those two files are dropped in, the fail-loud font notice is *correct* behaviour, not something to suppress.
- **All eight policy documents are `draft`.** Track A2 is in legal review; §1 rule 6 forbids inventing the text and §31.4 forbids substituting a summary. See "Policies" below.
- **Six §6 settings ship with no value, and the prerequisites panel blocks.** That is the designed state, not unfinished work — see "Global configuration" below.
- **No email provider is configured, so the transport refuses loudly.** `unconfiguredTransport` throws rather than swallowing a message, the failure is recorded, and the prerequisites panel already blocks on it (§1.4). Do not replace it with a no-op.

### What Phase 07 owns

`docs/phases/phase-07.md` is the brief. Phase 06b deliberately stopped at the draft *landing*: it names the Founder and product, explains what happens next, and **asks for nothing**. The vetting flow, the account claim, and everything downstream of `campaigns.status = invited_draft → vetting_submitted` are Phase 07's.

`tokens.claimDraft()` exists and is tested for the concurrent case (§33.1.2), but nothing calls it yet — Phase 07 is what turns a claim into an account, and it must also set `founder_prospects.claimed_user_id`/`claimed_at`, which is what removes the prospect from the retention sweep.

## How a session works

One phase per session (`docs/master-plan.md` §1.3): read `docs/phases/phase-NN.md`, then read only the Spec sections it names — not from memory — build, run **that phase's named §33 acceptance tests**, and commit only when every one passes. Serial: never start a phase whose predecessors aren't green. If the phase is too large for one session, stop and say so; a truncated session produces code that looks finished and isn't. Phase sequencing and the 00–24 table live in `docs/master-plan.md` §6.

## Toolchain (established Phase 1, per `docs/tech-stack-v2.md` §2, §11, §13)

- **Repo:** npm workspaces — `frontend/` (React 19 + Vite), `backend/` (Express 5), `shared/` (Zod schemas, money waterfall, state machines, calendar). One root `package.json`, one multi-stage `Dockerfile`.
- **DB:** Postgres 16 + Drizzle; `drizzle-kit` generates and applies migrations. Money is integer cents in `bigint`.
- **Commands:** `npm test` (all workspaces), `npm run typecheck`, `npm run build`, `npm run dev:backend`, `npm run dev:frontend`. Run one test with Vitest's filter: `npx vitest run -t "<name>"`, or one project with `npx vitest run --project shared`.
- **Tests — map §33 directly, do not invent a parallel plan:** Vitest for domain units; supertest + a real Postgres for API integration; Stripe **test clocks** for payment outcomes; Testing Library for consent/checkout/cancel/card-recovery surfaces; Playwright for the one full-lifecycle E2E; `axe-core`-in-Playwright plus manual keyboard/screen-reader passes for §33.11.
- **Integration tests need a real Postgres.** `backend/src/tests/app-harness.ts` uses `TEST_DATABASE_URL` when set and otherwise starts a Testcontainers `postgres:16-alpine`, which needs Docker. The migrator runs `CREATE ROLE proovd_app`, so the connecting role needs `CREATEROLE` or superuser. With neither Docker nor a spare server, a throwaway cluster works: `initdb -D <tmp> -U postgres --auth=trust`, `pg_ctl -o "-p 55432"` start, `createdb`, point `TEST_DATABASE_URL` at it, and stop it afterwards.
- **A backend test that mutates seeded rows wraps them in `BEGIN`/`ROLLBACK`**, one failing statement per transaction — the first error aborts the block, so a second assertion in the same one only observes the abort. `policy-versions.test.ts` is the pattern. A test that must commit restores what it changed in a `finally`.
- **Each harness-based test file gets its own database.** Pass a label: `startHarness({}, 'settings')`. On `TEST_DATABASE_URL` this provisions `proovd_t_<label>_<hex>` and drops it on `stop()`; on Testcontainers the container already isolates it.
- **Local Stripe:** the Stripe CLI forwards webhooks; its signing secret lives in local env only. Mount raw-body parsing on webhook routes **before** `express.json()`.
- **Email templates are TSX.** `backend/tsconfig.json` sets `jsx: react-jsx` and adds `DOM` to `lib` for that reason alone. React Email is a template language here; the backend serves no React of its own. `@react-email/render` is async — await it.
- **Jobs run on pg-boss**, in the same Postgres, wired in `backend/src/jobs/scheduler.ts`. `startScheduler` throws if it will not start: a deployment whose retention sweep never runs keeps personal data past §25.8's window and should fail at boot rather than serve traffic while quietly doing so.
- **Env:** copy `.env.example` (variable names only; `docs/tech-stack-v2.md` §17). `backend/src/env.ts` is Zod-validated and fails closed on any live/test key or mode mismatch.
- **`backend/tsconfig.json` sets `declaration: false` on purpose.** Declaration emit forces TypeScript to name every inferred type, and Better Auth's instance type reaches into its own bundled Zod, which this package cannot name (TS2742). The backend is an application; nothing imports its `.d.ts`.

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

### Auth — four actors, two mechanisms (§5, built Phase 04)

This is not four login types. Admin, Founder, and Affiliate have accounts in Better Auth (`backend/src/auth/auth.ts`); Backers have none at all.

| Actor | Mechanism |
|---|---|
| Admin | Email + password, **mandatory TOTP**, freshness gate on sensitive actions |
| Founder | Email + password **or** Google OAuth |
| Affiliate | Email + password, private campaign-specific invitation only |
| Backer | **No account.** Campaign-scoped magic link, via the token service |

- **No public signup exists, for any role.** `disableSignUp: true` closes the HTTP route. Accounts are created server-side through `backend/src/auth/seed.ts` (`seedAccount`), which always takes an explicit `role` and has no HTTP surface. Do not add one — §33.2.1 is exactly this.
- **`role` has no database default.** Every creation path states it. Google sign-in maps to `founder` because §5.1 seeds Admins and §5.3 admits Affiliates by invitation only, so neither has an OAuth route.
- **Guards fail closed** (`backend/src/auth/guards.ts`): `requireSession`, `requireRole`, `requireAdmin`, `requireFreshSession`. No session, unreadable session, database error, missing role, Admin without a registered factor, stale session — every one blocks. None logs a warning and proceeds (§33.12.5).
- **The Admin reauthentication window lives in `app_settings`, not in env.** `ADMIN_REAUTH_WINDOW_SECONDS` is now only the first-boot seed: `seedAdminReauthWindow` writes it while the setting is still NULL and is a no-op afterwards, because an Admin cannot reach the settings surface before the app is running and guarded. `requireFreshSession` takes a resolver and reads the setting per request, so a change applies to the next sensitive action. It **fails closed on `null`** with a 503 that names the settings route — §6 fixes no number and a guard that invents one has invented a security policy.
- **Phone is never verified.** A CHECK constraint pins `user.phone_verified` false. There is no SMS OTP path and the acceptance suite scans the source tree to keep it that way (§33.1.8).

### Tokens (§28.1)

Backers have **no account**. Use `backend/src/auth/token-service.ts` — never Better Auth's magic-link plugin, which creates accounts and sessions. Raw tokens exist only in the delivered URL: never at rest, never in a log, never in an error. Every rejection returns the identical value; invalid, expired, revoked, claimed, and never-existed are indistinguishable to the caller (§5.5).

Wired in Phase 04, and the parts that are easy to undo by accident:

- **One rejection, one status, one body.** `backend/src/auth/token-rejection.ts` holds a frozen constant. Nothing per-request goes in it — no incident id, no timestamp, no retry hint. Rate limiters on token routes return *this*, never a 429: a limiter that announces itself is the same enumeration oracle wearing a different hat.
- **Never add a reason field.** `TokenInvalid` carries none by design. The reason goes to the audit log, where support can read it and the caller cannot.
- **Token URLs are redacted in one place.** `backend/src/auth/token-routes.ts` owns both the route shapes and `redactTokenUrl`; Sentry's `beforeSend`/`beforeBreadcrumb` in `index.ts` read from it. Two copies of that list would drift, and the drift is invisible until a token shows up in a log.
- **Concurrent claim is a conditional `UPDATE`**, never select-then-update, backed by the partial unique index `secure_tokens_one_live_per_lineage`.
- The database also enforces scope binding, token-identity immutability, and append-only `claimed_at` (migration `0002_auth_and_tokens.sql`, hand-written section).

### Policies and the §34 gate (§18, §31.4, §29.8, built Phase 05)

The eight §31.4 documents are a **register, not text**. `shared/src/policies/documents.ts` holds one record per document — slug, route, title, version, status, effective date, and §31.4's required coverage. `backend`'s `policy_versions` table mirrors it row for row, and `backend/src/tests/policy-versions.test.ts` fails the suite if they drift, the same way the state enums are drift-tested.

- **Every document is `draft` today, and that is the correct state.** §18 and §31.4 forbid placeholder, "coming soon", and summary-only text at launch; §1 rule 6 forbids inventing the real text. So the routes render the versioned record and say honestly that it is in legal review. **Do not write policy prose to fill the gap, and do not ship a coverage list as the policy.**
- **`draft` blocks §34 condition 4.** `backend/src/policies/policy-gate.ts` (`readPolicyGate`) is the authority; it fails closed on a missing record as loudly as on a draft one. Phase 06's Admin prerequisites panel renders it; Phase 24 releases it *by publishing*, never by routing around it.
- **Publication is one-way and version identity is immutable**, enforced by trigger in `0003_policy_versions.sql`. A revision is a new row with a new version — that is what §29.8's reacceptance flow compares. A consent record may cite only a published version.
- **Published documents open with a Glance overview and the full text one gesture below** (DNA §5.12). Nothing is cut; it is staged.

### Public site (§18, §31.4, §27.8, built Phase 05)

- **`frontend/src/features/public/site.ts` is the single route inventory.** The router, the header, the footer, and the §33.11.6 broken-link scan all read it. A second copy is how a footer link outlives its route.
- **`app.proovd.co` owns all fourteen routes**, including the marketing-shaped ones. `proovd.co/<path>` 301s here for every path in the inventory except `/`, which stays the marketing home. §18's attribution cookie is first-party or it is nothing (tech-stack §10).
- **Appendix A.1 is exact text, and so is the sentence after it.** `trust-strip.ts` keeps A.1 verbatim and derives the shipped strip by replacing exactly one sentence — the architecture claim — with truthful conditional wording, because Stripe underwriting (Track A1) is open and §2.1 forbids claiming approval before it exists. When A1 closes, delete the replacement. Edit it for nothing else.
- **The §27.8 contact block is exact text**, rendered line for line in `SiteFooter.tsx` and compared against the constant by test.
- **Sample campaigns mount no payment field at all** — no form, no input, no iframe, no provider script. "Disabled" is not absent, and §34 gates live mode on this. They carry the Appendix A.6 banner permanently and reproduce A.2/A.3/A.4 in full with sample figures.
- **Live chat renders only inside staffed hours, and not at all outside them.** §31.4 names the hours as a setting and fixes no number, so `VITE_SUPPORT_CHAT_*` has no default anywhere and an unconfigured deployment renders no chat. Days come from the committed calendar, not from configuration.

### Global configuration and the §6 prerequisites (§6, §25.6, §29.6, built Phase 06a)

**Every operating constant is a setting, and later phases read the setting.** `shared/src/settings/registry.ts` is the register — one record per §6 constant, mirrored row for row by `app_settings`, drift-tested in `backend/src/tests/admin-settings.test.ts` exactly like the policy register and the state enums. `shared/src/money/constants.ts` is now **seed defaults only**: it is what the register and the migration read to agree on the §6 numbers. Importing a name from it to decide a live fee, deadline, or percentage is the bug Phase 06's trap names — *"a hardcoded duration is a bug even when the number is right."* Read the setting.

- **Three provenances, and the distinction is load-bearing.** `specified` — §6 states the value; it seeds and Admin may change it. `operator` — §6 names the setting and fixes **no** value, so it has no default anywhere and ships unset; six settings are in this state and an unset one **blocks** (§1 rule 6). `derived` — the value follows a committed artifact; the holiday-calendar version and its timezone are the whole set, and a trigger refuses to edit them because §29.6 forbids an edit silently moving a deadline already computed and promised.
- **The backend never imports `@proovd/shared` at runtime.** It exports TypeScript source, the backend compiles under `rootDir: src`, and the production image ships only `backend/dist`. So `kind`, `provenance`, `minimum`, `maximum`, and `spec_ref` are columns on `app_settings`, and `backend/src/settings/values.ts` validates from the row it is validating. This is the same constraint `db/schema/domain.ts` documents for the state enums; the answer is the same — restate the data, drift-test it, never import across the boundary. Labels and help text are **not** mirrored: the Admin surface imports the register through Vite.
- **History is a trigger, not a service call.** `app_settings.updated_by` and `update_reason` are NOT NULL, so an update that does not say who and why never commits; an AFTER trigger writes `app_setting_versions`. A service that wrote the history row is a service one careless `db.update()` can bypass. The §25.6 audit row is still written by `updateSetting`, in the same transaction, because the database cannot see MFA context.
- **`production_prerequisites` is insert-only.** Ten items: five the app re-checks on every load, five a named person verifies and records with note and evidence (§34's own words: "recorded as complete"). A missing record is **unsatisfied**, never unknown. Presenting a recorded item as system-verified would be the §1.4 failure, so the surface labels which is which.
- **Fail closed means the control is gone.** `frontend/src/features/admin/PrerequisitesPage.tsx` renders no override, no "proceed anyway", no enable-live-mode button, and there is nowhere to add one. §34 is released by satisfying it.

### Admin surfaces (§26, DNA §5.2, built Phase 06a)

- **`/admin` stands outside the public shell.** No `PublicLayout`, no site footer, no live-chat gate. §26 licenses dashboard density **here and nowhere else**, and shared chrome is how that density leaks into a Founder surface. DNA §5.14 still applies: every settings row is Glance (value + provenance) → Act (inputs) → Explore (change history behind one control).
- **Guards are mounted for real now.** Everything under `/api/admin` goes through `requireAdmin`; every write additionally through `requireFreshSession`. `backend/src/tests/admin-settings.test.ts` proves no session, wrong role, unenrolled factor, and stale session all fail closed on a real product surface rather than on a probe route.
- **`Saving…` / `Saved [time]` / `Could not save — retrying`** is the §9 autosave vocabulary, established in `frontend/src/features/admin/autosave.ts` so Phase 07 inherits it. `retrying` appears **only** while a retry is genuinely scheduled; a 4xx is a decision, not a transient failure, and claiming to retry one would be §1.4's failure in miniature.
- **Backend test files each get their own database.** `startHarness(overrides, label)` provisions one when `TEST_DATABASE_URL` points at a shared server. §33.1.1 asserts that opening a draft link creates *no* user row, which is only checkable if nothing else is creating user rows concurrently — making that assertion defensive instead would have quietly weakened the one that matters.

### The Founder invitation and the retention sweep (§7, §25.8, built Phase 06b)

The first phase where a real person receives something. Three tables:
`founder_prospects` (the person), `campaign_drafts` (the personalised content the sweep removes), `campaign_invitation_sends` (append-only, the nine facts §7 requires a send to store).

- **Preview is a gate, enforced server-side.** `renderFounderInvitation` scans the *rendered* subject, HTML, and text for bracketed markers; `sendInvitation` refuses while any remain. Checking the input record instead would test the caller's list of required fields rather than what the Founder would receive. The Admin surface disables Send on the server's answer, and the send route re-decides independently — a disabled button is not authorization (§1.1).
- **The notification dedup key is the SEND, not the draft.** §27.2 forbids a duplicate delivery producing a second email; §7 requires resend to work. Keying on the draft satisfies the first and breaks the second. `createNotifier` claims the `notification_deliveries` row *before* sending, so a crash leaves an unconfirmed claim — visible, honest, and recoverable by resending — rather than two emails.
- **The send row is written BEFORE the provider call**, with `notification_id` NULL, and confirmed afterwards. Writing it after would leave a crash-shaped hole: an email delivered with no send row, therefore no retention clock, therefore a draft §25.8 would never sweep. §25.8 sets a maximum, not a minimum — a clock that starts early deletes sooner, which is the safe side. `notification_id` NULL is a *state* ("recorded, not confirmed"), the draft stays out of `sent` until confirmed, and Admin renders it as exactly that (§1.4).
- **The retention clock is `max(sent_at)`.** Not creation, not `updated_at`, not the token's `expires_at`. §33.1.3 names it precisely, which is why `campaign_invitation_sends` is insert-only apart from three columns granted by name: the two recipient fields the sweep must null (migration 0005) and `notification_id` (migration 0006). `sent_at`, `token_version`, `draft_id`, and `status` are outside every grant.
- **A claimed draft is exempted twice, on purpose.** `findDueDrafts` filters on `founder_prospects.claimed_user_id` *and* `campaign_drafts.status <> 'claimed'`. The first is the claim flow's job; the redundancy means two things have to be wrong before the sweep destroys a live Founder's record. A revoked draft is still swept — revocation kills the link, not the data.
- **Revocation and anonymisation are one transaction.** `tokens.revokeDraftTokens(draftId, reason, tx)` takes the executor so both land together. A revoked token beside live draft content is not compliance, and a crash between them would leave that state permanently.
- **Anonymisation is irreversible at the database level.** Triggers refuse to clear `anonymised_at` or write content back. A draft that could be un-anonymised was never anonymised, only hidden.
- **`NO_GUARANTEE_TEXT` and `PROCESS_SUMMARY` are constants, not columns.** §7 forbids Admin promising acceptance, results, reward pricing, or a named Creator's participation, and an editable disclaimer is one that gets softened under pressure. The compose surface renders them read-only; there is no route that writes them, and a test asserts the sent body contains the text verbatim.
- **A prospect is anonymised only when it was their last draft**, and never once claimed — §25.8 keeps Founder account data for account life + 7 years.
- **Backend event keys are restated in `notifications/events.ts`**, drift-tested against the shared §27 register. A key appears there when something starts sending it, never before: a key with no sender claims a message exists when it does not (§1.4).

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
- **Accessibility is an acceptance test**, not a polish pass: 320px, keyboard, focus order, 44px targets, screen reader (§33.11). `frontend/src/features/public/a11y.test.tsx` runs axe, the keyboard path, heading structure, and landmark naming on every public route; 320px reflow, real focus visibility, 44px targets, and the screen-reader pass stay manual.
- **New component styles extend `proovd.css` in a dated phase section** at the bottom of the file, in the same slot-reading style — never a second stylesheet, never a hex literal, never an arbitrary spacing value.

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
