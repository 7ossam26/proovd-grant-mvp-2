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

**Phases 00–09 are complete.** Phase 06 was built in two halves — 06a the configuration surface, 06b the invitation — Phase 08 in three: 08a recruitment, 08b the compact signup, 08c the preparing reveal — and Phase 09 in two: 09a the workspace, 09b the interview integration. §33.1.1 through §33.1.9 all pass, so do §33.2.1 through §33.2.4, and so do §33.3.1 through §33.3.4. **Phase 10 is next** — Stripe foundations, test mode only; see `docs/master-plan.md` §6. Every path this file names exists at the path it names. `docs/phases/phase-00.md` … `phase-24.md` are all present.

What exists on disk:

| Area | State |
|---|---|
| `shared/` | money waterfall + USD formatting, three state machines, business-day calendar, notification registry, policy register, §6 settings register, the §9 vetting sequence and its copy, the §5.3 subtype/evidence register, the §8 recruitment fields, the §2.2 slot rule, **the §12 optional-item register, its rejection vocabulary, the helper resources, and the interview statuses**, Zod schemas |
| `backend/` | Express 5, Drizzle + Postgres, env guard, audit + idempotency tables, Better Auth, token service, guards, `policy_versions` + the §34 policy gate, `app_settings` + history + `production_prerequisites`, prospects/drafts/invitation sends, Resend + React Email, pg-boss retention sweep, `campaign_vetting` + provenance history, `founder_claim_profiles`, `possible_creator_results`, `policy_consents`, `affiliate_prospects`, §25.4 recruitment columns on `campaign_affiliate_associations`, `affiliate_invitation_sends`, the `affiliate_invitation` token scope, `campaign_workspace`, `campaign_assets`, `campaign_social_profiles`, `founder_interview_bookings` + events, `campaign_optional_items` + events, `high_effort_classifications`, `listing_fee_calculations`, the R2 presign port, **the Cal.com port + signed webhook + the §27.3 interview emails + the reminder/reconciliation jobs**, `/api/admin`, `/api/draft`, `/api/creator`, `/api/founder`, `/api/webhooks/calcom` |
| `frontend/` | design-system components, `MotionProvider`, the fourteen §18 public routes, the Admin shell at `/admin` (Founders, Creators, configuration, prerequisites, the vetting record, **the optional-item evidence panel**), the Founder draft landing at `/draft/:token`, the vetting flow, the possible-creator result, and the account claim under `/draft/:token/…`, the Creator's signup and preparing kit, **the Founder campaign workspace at `/campaigns/:campaignId/workspace`**, dev-only gallery at `/_gallery`, `/link-unavailable` |
| `frontend/public/` | `proovd.css`, `proovd-motion.js`, `vendor/gsap/*.min.js`, `gsap-check.html` |

Six gaps to know about, none of them a bug:

- **`frontend/public/fonts/` is empty.** `proovd.css` already declares `@font-face` against `Satoshi-Variable.woff2` and `Satoshi-VariableItalic.woff2`. Until those two files are dropped in, the fail-loud font notice is *correct* behaviour, not something to suppress.
- **All eight policy documents are `draft`.** Track A2 is in legal review; §1 rule 6 forbids inventing the text and §31.4 forbids substituting a summary. See "Policies" below.
- **Because they are drafts, the account claim refuses, in the open.** §10 requires Terms + Founder AUP + privacy acceptance and a consent may cite only a published version, so `completeClaim` returns `policies_unpublished` and the surface renders the reason instead of the button. That is the correct state, not a bug to route around — see "Vetting and the account claim" below.
- **Six §6 settings ship with no value, and the prerequisites panel blocks.** That is the designed state, not unfinished work — see "Global configuration" below.
- **No email provider is configured, so the transport refuses loudly.** `unconfiguredTransport` throws rather than swallowing a message, the failure is recorded, and the prerequisites panel already blocks on it (§1.4). Do not replace it with a no-op.
- **No R2 bucket and no Cal.com account are configured, and the four §6 interview settings are unset.** All Track A4. `unconfiguredStorage` and `unconfiguredScheduler` both throw exactly as `unconfiguredTransport` does; the workspace renders no upload control and no booking embed, and the webhook accepts nothing. Do not stub any of them.

### What Phase 08 owns, and where it was split

`docs/phases/phase-08.md` bundles three independent deliverables — §8's recruitment and invitation, §11's compact signup and payout surface, and §10's preparing reveal with the Campaign kit. That is more than one session, the same way Phase 06's brief was, so it was split against one brief on the 06a/06b precedent:

| Half | Scope | Acceptance | State |
|---|---|---|---|
| **08a** | §8 recruitment, §5.3 verification evidence, §25.4 per-campaign association facts, the private invitation, §2.2 slot accounting, the Founder-visible roster | **§33.2.1** | **built** |
| **08b** | §11 compact signup, the account claim, the `Finish payout setup` surface and its status states, the named waiting state | §33.2.2, §33.2.3 | **built** |
| **08c** | §10's preparing reveal on `founder_signup_complete`, the Campaign kit, access logging and revocation | §33.2.4, the second half of §33.1.9 | **built** |

**Phase 07 emitted `founder_signup_complete`; 08c consumes it.** `routes/vetting.ts` calls `revealPreparingCampaign` after the claim transaction commits, outside it — the reveal is idempotent, so a crash between the two costs a retry rather than correctness, and holding a row lock across an email provider call would be a much more expensive way to be no safer. Admin can re-run it from `POST /api/admin/affiliates/reveal`.

### What Phase 09 owns, and where it was split

`docs/phases/phase-09.md` bundles the §12 workspace and its evidence rules, the R2 upload path, the high-effort classification, the itemised listing fee, *and* a Cal.com integration with four notifications. That is more than one session, so it was split on the 06a/06b and 08a/08b/08c precedent:

| Half | Scope | Acceptance | State |
|---|---|---|---|
| **09a** | The workspace flow, §12's five items and their objective evidence, the R2 presign path, the interview *booking record and its lifecycle*, high-effort, the listing-fee calculation and preview, the helper resources, Admin's evidence/invalidation/override surface | **§33.3.1, §33.3.2, §33.3.3, §33.3.4** | **built** |
| **09b** | Cal.com Cloud embed, the signed webhook, the reconciliation and reminder jobs, and §27.3's four interview notifications | — (its rules are tested through 09a's record; `interview-webhook.test.ts` covers the vendor layer) | **built** |

**The booking record is 09a's, not 09b's, and the split ran there for a reason.** tech-stack §12: "The booking record in our database is the source of truth, populated from Cal.com webhooks." So the domain state, its four §12 conditions, its reschedule history, and the §33.3.3 recalculation were all built and tested first; 09b added the vendor that *feeds* them. Phase 09's own trap — "Cal.com is a source of events, not truth… don't leave `confirmed` reachable only by webhook" — is satisfied because the reconciliation path shipped before the webhook did.

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
- **`Saving…` / `Saved [time]` / `Could not save — retrying`** is the §9 autosave vocabulary. It lives in `frontend/src/lib/autosave.ts` — moved there by Phase 07, because the vetting flow, the account claim, and the settings surface all speak it and a Founder surface importing its status vocabulary out of `features/admin` was one refactor away from two of them. `retrying` appears **only** while a retry is genuinely scheduled; a 4xx is a decision, not a transient failure, and claiming to retry one would be §1.4's failure in miniature.
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

### Vetting, the type lock, and the account claim (§9, §10, built Phase 07)

The first real Founder journey, and the first irreversible decision in the product. `shared/src/vetting/steps.ts` owns §9's five-item sequence and its copy; `backend/src/vetting/` owns the record; `frontend/src/surfaces/draft/` owns the three surfaces.

- **Competition has nowhere to be prefilled, in three places.** §9 states the rule twice and §33.1.5 tests it. `campaign_vetting` carries `problem_prefilled_*` and `solution_prefilled_*` and **no `competition_prefilled_*` of any kind** — absent, not unused; `prefillVetting` takes two parameters and there is no third; a CHECK constraint pins `competition_supplier` to `founder` so even a hand-written `UPDATE` cannot record it as Proovd's. A test scans the tree for a fourth way in. It is the one field that proves the Founder did their own thinking.
- **The type lock is a database trigger, not a service rule.** Submission sets `campaigns.type` and `type_locked_at` in one conditional `UPDATE`; `enforce_campaign_type_lock` then refuses to change either, forever, for every future phase and every support script. §9: "No campaign-type migration exists." If a change proposes a "convert campaign type" affordance, that is §1 rule 6.
- **A wrong type archives and restarts; it never converts.** `archiveAndRestartVetting` marks the old campaign `archived_at`/`replaced_by_campaign_id` and creates a **new campaign, draft, and empty vetting record** for the same prospect. Archive is deliberately *not* a `campaigns.status` value — §23.1 names no destination and inventing one is forbidden — so it is its own dimension beside the lifecycle, like §23.3's payment flags. The service reads no association, reward, payment, or consent table at all: the safest implementation of "nothing is copied" is code with no idea they exist. After `listing_paid_at` it refuses and says the cancellation and refund rules control (Phase 11's).
- **The possible-creator result is a recorded Admin assessment, not a query.** §10 is explicit that it "is not the recruited/accepted roster", and Affiliate recruitment is Phase 08 — so there is nothing to count and a formula over an empty table would produce a meaningless number. A named Admin records the count *and its basis* into the append-only `possible_creator_results`; §1.3 is what makes that valid. **Zero and unrecorded produce the identical Founder-facing state** — a waiting state owned by Proovd — because telling them apart would tell the Founder a number §10 forbids showing. The basis never leaves Admin.
- **The claim is one transaction anchored by two mechanisms.** `idempotency_keys` on `founder_signup_complete:<campaignId>` makes the event singular under retry; Phase 04's conditional `claimDraft` — which now takes an executor, so it runs *inside* the transaction — settles the race between two requests holding the same link. Better Auth's account creation happens **before** the transaction on purpose: a leftover account with no claim is recoverable by clicking the link again, while a claimed draft with no account strands someone behind a dead link.
- **A draft policy blocks the claim, in the open.** A `policy_consents` row may cite only a `published` version — a trigger, not a service rule, because the failure is silent. All eight documents are drafts, so the claim refuses with `policies_unpublished` and the surface renders the reason and says nothing was lost. Do not soften this, do not stub a consent, do not accept a draft.
- **The vetting record and the claim profile are draft content, so §25.8 sweeps them.** `anonymiseDraft` nulls the answers, the profile, *and* `draft_field_edits.prior_value`/`new_value` — that table holds a verbatim copy of every version of every answer, and emptying the source while leaving the history would be a retention policy with a hole in it. `field`, `supplier`, `edited_by`, and `occurred_at` are outside the grant, so the fact of each edit outlives its text.
- **Provenance history is a trigger.** `record_vetting_edits` and `record_claim_profile_edits` write `draft_field_edits`; the anonymisation write is exempt, because recording "problem_text changed from *the Founder's words* to NULL" would file a copy of the deleted text somewhere insert-only.
- **A save writes only the keys it was given.** `undefined` means "not in this request". §9's "a failed save never clears valid fields" starts here, and on the surface the typed value never comes back from the server — `useAutosave` takes a patch and reports an outcome, and cannot overwrite what is in the box. The obvious implementation, clear-on-error-and-refetch, is the single most common autosave bug.

### Affiliate recruitment and the private invitation (§8, §5.3, §25.4, §2.2, built Phase 08a)

The third actor arrives, and most of this phase is what they *cannot* do yet. `shared/src/affiliates/` owns the §5.3 subtype register, §8's nineteen facts, and §2.2's slot rule; `backend/src/affiliates/` owns the record and the invitation; `frontend/src/features/admin/CampaignCreators.tsx` is the surface.

- **The internal quality tier is free text, and the type is the enforcement.** §8: "used only as assessment data—not as a commission floor." A ranked enum or an integer is a value that can be sorted and multiplied, and the first phase that needs a default percentage would find one sitting there — so the column is `text`, a CHECK constraint refuses a bare number or percentage (`affiliate_quality_tier_not_numeric`), the service refuses it with an explanation, and the shared register exports no `QUALITY_TIERS` to import. Naming tier levels would also invent an eligibility scheme §8 does not state. If a later phase wants to order by it, that is the §1 rule 6 violation the type exists to make visible.
- **The token is bound to one association, and the database is what binds it.** §33.2.1: "an invitation claims only that Affiliate's account/association." `secure_tokens.association_id` carries it and the scope-binding CHECK (migration 0009) refuses a row that also carries a draft, campaign, or Backer id. Bound to the *association*, not the prospect: a Creator recruited to two campaigns holds two associations and receives two invitations, and binding to the person would make one link claimable against whichever campaign the request named.
- **Migration 0008 adds the enum value; 0009 is its first use.** Postgres refuses to use an enum label in the transaction that added it and the Drizzle migrator runs one transaction per file. Do not merge them back together.
- **`invitationStatus` moved to `db/schema/domain.ts`** and is re-exported from `invitations.ts`. It is still §7's enum; it moved only because the Affiliate invitation needs the same lifecycle on `campaign_affiliate_associations`, that table lives in `domain.ts`, and `invitations.ts` already imports from it. A second `pgEnum` declaration would be a second Postgres type with the same values.
- **Two sentences in the invitation are template constants.** §8 requires the email to say the opportunity may still be preparing and that declining later does not harm standing. Both are promises about how Proovd behaves, so neither is Admin's to reword under pressure from a Founder who wants a roster filled — `PREPARING_NOTICE` and `DECLINE_NOTICE` sit beside §7's `NO_GUARANTEE_TEXT` for the same reason, are rendered read-only, and are compared verbatim by test.
- **The preview gate, the dedup key, and the write ordering are §7's, restated.** The gate scans the *rendered* output; the dedup key is the SEND and not the association (keying on the association would satisfy §27.2 and break §8's resend); the send row lands before the provider call with `notification_id` NULL, which is a *state* — "recorded, not confirmed delivered" — and Admin renders it as exactly that. `affiliates/invitation.ts` and `invitations/service.ts` are deliberately parallel rather than merged: they differ in token scope, dedup entity, state machine, and required contents, and the branch that matters most is the one §33.2.1 is about.
- **A resend does not re-transition the association.** `transitionAssociation` is a conditional UPDATE on the current status, so the second send matches nothing and writes no second history row. Two `prospect → invited` rows would misreport when the Creator was actually invited.
- **Revocation kills the link and nothing else,** and the association does **not** return to `prospect` — §23.4's machine has no edge back and inventing one is §1 rule 6. The invitation status carries the revocation; the association status carries the relationship. The prospect, the recruitment provenance, and every send row survive, because §25.4 keeps invitation events per campaign.
- **Slot occupancy is derived, never stored.** §2.2's slot "runs from tracking-link activation until campaign close or recorded removal", so `active` and `paused` occupy one and nothing else does — `paused` included, because a paused Creator is not a closed campaign and excluding it would let one Creator hold four campaigns by having one go wrong. A stored boolean would strand a Creator at three when a flag was never cleared. Phase 08 cannot reach a slot-occupying state at all; the count is rendered so Admin recruits knowing, and Phase 14's activation enforces the cap by reading it.
- **The Founder projection is the authorization boundary.** §11: the Founder "cannot contact the Affiliate directly or inspect sensitive onboarding data." `listFounderVisibleRoster` never *selects* the email, phone, legal name, quality tier, verification evidence, conflict/sanctions notes, internal comments, or recruiting Admin — there is no filtering step to forget, because the columns are not in the projection. §30 defers direct Founder–Affiliate messaging and there is no message route to work around.
- **Verification completeness is reported, not enforced — except on `verified`.** §5.3 qualifies inputs with "where appropriate" and Admin builds the record incrementally from public research, so `missingEvidence` reports the gap and an incomplete prospect saves. Refusing the save would push an Admin to type a placeholder into an evidence field, which is a worse record than an honestly incomplete one. `verified` is the one claim that requires the evidence behind it.

### The Creator's compact signup and the waiting state (§11, §28.4, built Phase 08b)

The third actor gets an account. `backend/src/affiliates/signup.ts` owns the record and the claim; `frontend/src/surfaces/creator/` owns the one page.

- **One page, two primary actions, and no third.** §11 gives the flow one action (`Confirm and create account`) and then one more (`Finish payout setup`), and forbids the alternatives by name: "no welcome tour, multi-page education sequence, separate banking page, or public Affiliate signup." There is one route serving the whole flow, one `.btn--primary` on the page (a test counts them), no step index, and no route that collects a bank, tax, or identity field — §11 forbids reproducing provider-controlled fields, and the absence of the route is what makes that true. `affiliate_signup_no_bank_data` CHECKs that `connected_account_id` looks like `acct_…` and nothing else.
- **`Finish payout setup` renders no control yet, on purpose.** Stripe is Phase 10 (§32.1 orders signup first). `payout_status` can only be `not_started`, the panel says so, and `onboardingAvailable: false` is what the surface reads. §1.4: a button that would do nothing is worse than no button.
- **Two acceptances, not three.** §11 says "Terms and Affiliate AUP acceptance" — so `AFFILIATE_CLAIM_POLICY_SLUGS` is `['terms', 'affiliate-aup']` and privacy is *not* in it. §10's Founder claim takes privacy because §10's own list names it. Collecting an acceptance the Spec does not ask for is as wrong as skipping one it does. `ip-agreement` is §31.5's per-campaign agreement, required before *work*, and belongs to the phase that opens work.
- **Both agreements are drafts, so the claim refuses in the open** — same as the Founder claim, same trigger, same reason. Do not soften it, do not stub a consent, do not accept a draft. **In tests, publication is one-way** (§29.8, enforced by `enforce_policy_version_immutability`), so the draft-refusal case has to run in its own describe *before* anything publishes. There is no `unpublish` helper and writing one would fight the invariant rather than test it.
- **The five confirmations are five columns and five controls.** §28.4 forbids bundling; §11 names them as one sentence. Nothing in the save path can set more than one from a single flag, and the surface has no "accept all".
- **`signup_field_supplier` is its own enum**, `('proovd','affiliate')`, not §9's `field_supplier` `('proovd','founder')`. The two say different things, and a shared enum would admit values neither table can legally hold.
- **The channel subtype is shown, not editable.** §11's "ability to correct it" attaches to prefilled *public information*. The subtype is Admin's §5.3 classification and decides which verification evidence was recorded against it, so a Creator flipping it would silently invalidate a verification. The surface routes a correction to support; nothing in the save path can change it.
- **The claim mirrors §10's exactly**: account created *before* the transaction (a leftover account is recoverable, a claimed invitation with no account is not), `idempotency_keys` for retry, the conditional token UPDATE for concurrency, and both §23.4 hops recorded even when the Creator never saved first — skipping the intermediate one would misreport the path they took.
- **`preparing` is reported but not reviewable.** `readConditionalState` computes §11's real condition, and the surface renders the Founder-claimed case as "being prepared" with no `Review campaign` action. §10's handoff is 08c's, and offering the action before the Campaign kit exists would claim a capability the product does not have.
- **`NO_ACTION` is exported from `StatePanel`** and read by the surfaces and the confirmation email. §11 puts "No action needed" in backticks and §33.2.3 tests for it; a paraphrase is a softer promise. One constant, three readers.
- **The confirmation email is sent after the transaction commits**, keyed on the association. §8's invitation keys dedup on the *send* because §8 requires resend to work; a signup happens once, so only §27.2 applies here and the association is the right key. A provider refusal records the failure and returns — it does not roll back an account, because the account is the more valuable of the two.

### The preparing reveal and the Campaign kit (§10, §31.5, built Phase 08c)

The pilot pre-view: a Creator reads a Founder's unreleased product information having signed nothing. §31.5 permits it only while it stays **private, authenticated, logged, campaign-scoped, and revocable**, and every one of those is a mechanism rather than an intention.

- **"Exactly once" is three mechanisms.** §10 says it twice — "appears automatically in `preparing` exactly once", and Admin sees "No duplicate visibility event or email may occur after retries". So: `idempotency_keys` on `affiliate_preparing_revealed:<associationId>`, the conditional status UPDATE `signed_up_waiting_for_founder → preparing`, and `notification_deliveries`. Any one would stop the common case; all three are there because §33.7.7's rule about duplicate events applies here as much as to a webhook.
- **Each association is its own transaction.** One Creator's failure must not roll back another's reveal — they are independent grants to independent people, and an all-or-nothing batch would let one bad row hold a whole roster in the dark.
- **Eligibility is `signed_up_waiting_for_founder`.** §10 reveals to an *authenticated* Affiliate; anything earlier has no account, so writing a `preparing` state for them would grant access to someone who cannot sign in to use it.
- **Revocation is one-way at the database level**, and so is the reveal stamp (`enforce_kit_revocation_irreversible`). An access grant nobody consciously made is what the exception cannot survive; a reveal stamp that could be cleared is a second reveal waiting to happen. Re-granting is deliberately not built (§1 rule 6).
- **`campaign_kit_access` is insert-only and records no content.** It is the evidence the exception was operated as described, so a log a later statement could edit is not evidence of anything — and copying any of the Founder's material into it would put a second copy somewhere no revocation could reach. `readPreparingKit` writes the row in the same call that returns the content, not in a middleware a later route could be added without.
- **The preparing kit is much smaller than §14.1, and says so.** §14.1 is the *complete formal* opportunity — rewards, prices, base percentage, tracking links — almost none of which exists before Phase 09/11/12. §10's phrase is "currently available", so the projection returns Founder, Problem, Solution, Competition, and campaign type, plus a list of what is missing **and why**. Rendering empty sections would read as a campaign offering nothing rather than one that is early.
- **No compensation reaches the projection at all.** §12 owns it from Phase 12. There is no percentage column selected, no control, and nothing to accidentally turn actionable — the trap's "showing the base percentage as information is fine" is moot because at preparing there is no percentage yet.
- **Accept, decline, propose, activate are absent, not disabled.** §10 makes them unreachable until listing-fee payment, and there is no route and no control for any of them.
- **`/api/creator/*` is the first non-Admin session surface**, behind `requireRole(auth, 'affiliate')`. No TOTP: §5.1 makes a second factor Admin's rule and §5.3 gives the Affiliate email + password. Every read filters on the session's user id *inside the query*, and someone else's association answers `not_found` — the same answer as one that does not exist.

### The optional items, the evidence, and the listing fee (§12, §24.6, built Phase 09a)

The first phase where a Founder's own work changes what they are charged, and the first upload surface. `shared/src/workspace/` owns the §12 register and the helper text; `backend/src/workspace/` owns the decisions; `backend/src/storage/` owns the bucket; `frontend/src/surfaces/founder/` owns the flow.

- **Content is the Founder's; the decision is the server's.** No route, no patch key, and no column lets a Founder set `complete`. `evaluateWorkspace` re-derives all five decisions from the stored content inside the same transaction as every save, and `decideItems` is a pure function over a snapshot so §33.3.1's near-misses are assertable as facts rather than as a simulated network. Phase 09's trap in one sentence: an item that completes because someone clicked "done" defeats the whole discount.
- **Approval is of a version, so editing revokes it.** §12 rejects "unapproved drafts", and a Founder who approves a story and then rewrites it has one again. `saveWorkspace` clears the approval in the same statement as the edit, and re-applies it afterwards if the same request also approved — so a save that both edits and approves approves what it just wrote.
- **A recorded Admin override survives re-evaluation; a Founder's completion does not.** §12 requires an override to carry prior value, new value, reason, actor, time, and evidence, and one the next autosave silently withdrew would be none of those. `evaluateWorkspace` skips any item whose `decision_source` is `admin_override`; it is lifted only by `overrideItem` or `reinstateItem`, both of which say who and why. `reinstateItem` deliberately cannot *grant* a completion — that would be the self-assertion hole with a different actor.
- **Three checks are in the database because they are the ones a service can forget.** `high_effort_classifications_rule` restates §12's boolean; `listing_fee_calculations_arithmetic` restates the cap and the floor; `campaign_optional_items_completion_accounted` refuses a completion with no timestamp and no source. The first is the number Phase 12's compensation matrix reads — a wrong classification is a commercial term that is wrong.
- **Item history is a trigger, not a service call.** `record_optional_item_events` writes `optional_item_events`; `UPDATE` and `DELETE` are revoked. Same reasoning as `app_setting_versions` (06a) and `draft_field_edits` (07): the row a careless `db.update()` would skip is exactly the override someone later has to explain.
- **Lockable now, locked in Phase 11.** §12: "After payment, the calculation and evidence snapshot lock." Nothing here sets `locked_at`; the triggers that refuse to edit a locked item or a locked calculation are already installed, so Phase 11 sets one timestamp instead of writing a guard under deadline. **§33.3.3's second direction is that lock, not an `if (paid)` branch** — `cancelBooking` always cancels and always re-evaluates, and after payment the re-evaluation finds nothing it may change. A rule written in a route is a rule the next route forgets.
- **The fee is computed on the server, from `app_settings`, and never in the browser.** `backend/src/workspace/listing-fee.ts` reads the four §6 keys; `shared/src/money/listing-fee.ts` stays the Phase 03 kernel over the seed defaults, and `campaign-workspace.test.ts` walks all 32 combinations through both and asserts they agree. That is the restate-and-drift-test arrangement, not a second waterfall. The surface parses cents only to format them — there is no arithmetic on a fee anywhere in `frontend/src/surfaces/founder/`.
- **No tax line and no "total due now".** §12 puts sales tax on the Checkout via Stripe Tax (Phase 10 establishes the client, Phase 11 uses it). A `taxCents: 0` would be a claim nobody has made, and a total without tax is a number the Founder will not be charged. `SEPARATE_STREAM_NOTE` travels with every preview because §24.6 makes the listing fee its own stream and §12 says the 5% is "separate and unchanged".
- **Nothing touches the container's disk.** Presign → browser PUT → server reads the object back and decides. The signature covers the method, the exact key, `content-type`, *and* `content-length`, so a URL issued for a 400 KB JPEG cannot be replayed for a 40 MB anything. Keys are derived from the campaign id and a fresh UUID — never from a filename — and `storage_key` is immutable by trigger, because repointing an approved visual moves a Founder's approval onto material they never saw. SigV4 is ~80 lines of `node:crypto`; the AWS SDK is not a dependency.
- **The bytes decide, not the declaration.** `inspectMedia` reads the format from magic bytes and the dimensions from the header. An HTML document declared as `image/png` is `file_unreadable`; SVG is excluded because browsers execute it. The placeholder floor is 320 px on the longest edge — the narrowest viewport §33.11 tests — chosen so the number is a product fact rather than an invented one. Video carries no dimension check and says so: inventing a byte-size floor would be inventing exactly what §1 rule 6 forbids.
- **Duplicates are a partial unique index, not a `SELECT`.** On (campaign, checksum) over live rows, so two concurrent requests cannot both find nothing; removing a file and re-uploading it is permitted, because that is a correction. Drizzle wraps the driver error, so the `23505` check walks `cause` — without that the §12 rule surfaces as a 500.
- **Fetching a Founder-supplied URL is the other quiet security mistake.** `checkSocialUrl` refuses anything not http(s), resolves the hostname *before* connecting and rejects every private, loopback, link-local, and unique-local address, and re-applies the whole test to each redirect rather than handing the follow to the runtime. The body is never read, never stored, and never returned — only a status code and a decision leave the module.
- **Control of a social profile is a Founder statement, never a verification.** §12 asks for a profile "controlled by the Founder" and Proovd cannot prove it; there is no OAuth handshake and inventing one is §1 rule 6. It is stored as `controls_confirmed`, shown to Admin as `controlsConfirmedByFounder`, and is its own unchecked control (§28.4 forbids bundling).
- **`/api/founder/*` is the first session-bearing Founder surface.** Behind `requireRole(auth, 'founder')`, no TOTP (§5.1 makes a second factor Admin's rule). Every route resolves the campaign through `findFounderCampaign`, which joins the caller's own claim profile *inside the query*; another Founder's campaign answers the identical 404 a non-existent one gets.
- **The helper resources are text, and there is no generate button anywhere.** §12: "static, copy-ready guidance—not an embedded AI product." §30 defers AI rewriting by name. There is no model client in the tree, no generate route, and no column that would hold a generated result — a shared test scans the register for the promise.
- **`useAutosave` moved to `frontend/src/lib/`.** Phase 07 moved the three status phrases there and left the hook in `surfaces/draft`; by Phase 09 four surfaces autosave and three of them were importing out of a fourth's folder. It now takes the request-error *class* rather than one surface's re-export.

### The embedded interview and its webhook (§12, §27.3, §28.3, built Phase 09b)

`backend/src/interviews/` owns the vendor layer; `frontend/src/surfaces/founder/InterviewBooking.tsx` owns the embed. Every transition still goes through 09a's `workspace/interview.ts` — the webhook has no privileged route of its own, which is what makes the reconciliation path real rather than aspirational.

- **Two independent facts bind a booking to a campaign.** Cal.com lets the *booker* prefill metadata, so a campaign id in the payload is a value the Founder chose — trusting it would let one attach a booking, its US$2 discount, and the high-effort input that governs Phase 12's ceiling to someone else's campaign. The signature proves the payload came from Cal.com; it proves nothing about who typed what into it. So `interviews/reference.ts` mints an HMAC over the campaign id (`BETTER_AUTH_SECRET`, domain-separated by a fixed label) that the ingest recomputes, **and** the attendee's email must independently match that campaign's Founder. Either alone fails.
- **A signed but unbindable delivery is recorded and routed to Admin, never guessed into place.** §1 rule 6 forbids guessing and §1.3 makes the manual route valid only when the app records it. It still answers 200: Cal.com retries a non-2xx, and retrying something already recorded as unbindable produces a queue of identical failures instead of the one audit row an Admin needs.
- **`provider_events` is the idempotency pivot, with `provider = 'calcom'`.** No second table and no second mechanism to keep in step with Phase 10's. Claimed before any domain work; a redelivery increments `seen_count`, writes an audit row, and returns. The 09a services are independently idempotent underneath it, so even a defeated pivot cannot produce a second transition or a second email.
- **Raw body before any JSON parser.** The signature covers the exact bytes; a re-serialised object is not the thing that was signed. `express.raw()` is mounted on this path only, capped at 256 KB, and `app.ts` still mounts no global `express.json()` — the same constraint Phase 10's Stripe endpoint needs. Comparison is `timingSafeEqual`.
- **An iframe, not an injected script.** The workspace holds the Founder's session and their unreleased product information, and a third-party script in that page can read both. `SupportChat` injects a script because it runs on public pages with neither. The sandbox deliberately withholds `allow-same-origin`.
- **The four dedup entities are different, and that is the whole design.** `confirmed` and `canceled` key on the booking; `rescheduled` and `reminder` key on the booking **and** the scheduled time. Keying a reschedule on the booking alone sends the first move and silently swallows every later one — §7's exact failure in a different phase. Keying the reminder on the booking alone means a Founder who reschedules gets no reminder for the new time.
- **The fee sentence in an email is composed against the campaign's real state.** §12 makes a confirmed interview worth US$2 and makes cancelling *before* payment recalculate; after payment §12's lock means nothing moves. A template that hardcoded "this changes your fee" would be wrong for every Founder who has already paid, so `feeNoteFor` decides and the template renders.
- **§6's reminder lead time is unset, so the reminder job sends nothing and logs that it did.** A default of "24 hours" would be a commercial rule invented in code. A silent no-op would look identical to "nothing was due" (§1.4).
- **Abandonment is defined by a fact, not a window.** §12 names `abandoned` and does not say when a booking becomes one, so the sweep marks a booking that was never confirmed and whose slot has now passed — no invented grace period. It matters because `selected` counts toward high-effort and `abandoned` does not.
- **`MEETING_PROVIDER_LABELS` is restated in `interviews/labels.ts`.** The backend cannot import `@proovd/shared` at runtime and an email is a customer-facing surface — `microsoft_teams` in a Founder's inbox is exactly the §3.1 leak. Drift-tested against the shared map.

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
