# Proovd MVP

Founder-led crowdfunding platform. Vetted Founders run campaigns, hand-recruited
Creators promote them, Backers save a card and are charged later under a
disclosed rule, and Admin operates the exceptions behind a polished surface.

Private repository. Not open source.

## Governing documents

Read these before changing anything — they win over anything inferred from the
code.

| Authority | Document |
| --- | --- |
| 1. Behavior, data, state, money, tax, acceptance | [docs/spec/Proovd-MVP-Engineering-Implementation-Spec-v1_0.md](docs/spec/Proovd-MVP-Engineering-Implementation-Spec-v1_0.md) |
| 2. Visual, interaction, motion, content design | [docs/spec/Proovd_DNA.md](docs/spec/Proovd_DNA.md) + [frontend/public/proovd.css](frontend/public/proovd.css) |
| 3. Implementation mechanics | [docs/tech-stack-v2.md](docs/tech-stack-v2.md) |
| 4. Sequencing | [docs/master-plan.md](docs/master-plan.md) |

Working rules for contributors and for Claude Code sessions live in
[CLAUDE.md](CLAUDE.md). Per-phase briefs live in [docs/phases/](docs/phases/).

## Status

Built one phase at a time against `docs/master-plan.md` §6. **Phases 00–05 are
complete, and Phase 06 is split in two — 06a is done, 06b is next.**

| Phase | Delivered |
| --- | --- |
| 00 | Repo structure, design-system and prebuilt files in place |
| 01 | Express backend, Postgres, Drizzle, env guard, test harness |
| 02 | Design-system vocabulary, `StatePanel`, `Flow`, component gallery |
| 03 | Domain kernel — money, state machines, calendar, audit, idempotency |
| 04 | Auth — three account roles, Admin MFA and freshness gate, token service |
| 05 | The fourteen public routes, policy versioning, two sample campaigns |
| 06a | Global configuration, the production-prerequisites gate, the Admin shell |
| 06b | *Next:* transactional email, the Founder invitation and draft, retention |

Phase 06 as written in `docs/phases/phase-06.md` bundles four independent
deliverables. 06a shipped the configuration half; 06b owns transactional email,
the Founder prospect and invitation, the draft landing state, the 30-day
retention job, the Admin Users and Campaign surfaces, and acceptance tests
§33.1.1–§33.1.3.

## Layout

npm workspaces, one root `package.json`, one multi-stage `Dockerfile`.

```
shared/     Zod schemas, money waterfall, state machines, business-day calendar
  src/policies/   the eight canonical policy records and their versions
  src/settings/   the §6 operating-constant register
backend/    Express 5 + Drizzle + Postgres 16
  src/auth/       Better Auth config, guards, token service, seeding
  src/policies/   the §34 policy gate
  src/settings/   reading, validating, and versioning the §6 constants
  src/admin/      the production-prerequisites panel
frontend/   React 19 + Vite, styled solely by proovd.css
  src/features/public/   the fourteen public routes, footer, sample campaigns
  src/features/admin/    the Admin shell, configuration, prerequisites
docs/       Spec, DNA, tech stack, master plan, phase briefs
```

`shared/money` holds the **only** implementation of the payment waterfall. Both
the checkout preview and the close batch call it.

**The backend never imports `@proovd/shared` at runtime.** That package exports
TypeScript source, the backend compiles under `rootDir: src`, and the production
image ships only `backend/dist`. Where the server needs a shared fact it
restates it and a drift test fails the suite if the two diverge — the state
enums in `backend/src/db/schema/domain.ts`, the required policy slugs in
`policy-gate.ts`, and the setting bounds carried as columns on `app_settings`
are all the same pattern. Frontend and test files import it freely; Vite and
Vitest resolve the workspace source directly.

## Domains

`proovd.co` is the marketing home and lives in its own repository.
`app.proovd.co` is this one, and it owns **every** route in Spec §18's public
inventory — including the ones that read like marketing.

That is not a preference. §18's attribution contract sets a first-party cookie
when a Backer arrives through a Creator link and reads it at pre-order; if the
campaign page and the checkout sit on different hosts, Safari and Chrome drop
it and Creator compensation is computed from nothing. Backer magic links are
campaign-scoped to the same origin for the same reason.

**The recorded redirect:** `proovd.co/<path>` 301s to `app.proovd.co/<path>`
for every path in the §18 inventory except `/`, which stays the marketing home.
The inventory itself is in
[frontend/src/features/public/site.ts](frontend/src/features/public/site.ts) —
one list, read by the router, the header, the footer, and the broken-link test.

## Policies

The eight canonical documents of Spec §31.4 are a **register, not text**.
[shared/src/policies/documents.ts](shared/src/policies/documents.ts) holds one
record per document — slug, route, title, version, status, effective date, and
the coverage §31.4 requires. The backend's `policy_versions` table mirrors it
row for row, and a drift test fails the suite if they disagree.

**Every document is currently `draft`, and that is the correct state.** The
approved text is in legal review, and the Spec forbids both filling the gap
with invented prose and shipping a summary in its place. So each route renders
its versioned record and says plainly that the document is in review.

`draft` blocks the fourth condition of Spec §34's live-mode gate. Phase 24
releases it by publishing the documents — not by bypassing the check.

## Global configuration

Every operating constant Spec §6 names lives in `app_settings`, seeded from the
register at [shared/src/settings/registry.ts](shared/src/settings/registry.ts)
and administered at `/admin/settings`. From Phase 06 on, **later code reads the
setting, never a constant** — a hardcoded duration is a bug even when the number
is right. `shared/src/money/constants.ts` survives as the seed values the
register and the migration agree on, not as something to import at a call site.

Each setting declares where its value comes from, and the distinction decides
what the surface will let you do:

| Provenance | Meaning |
| --- | --- |
| `specified` | §6 states the value. It seeds, and Admin may change it. |
| `operator` | §6 names the setting and fixes **no** value. No default exists anywhere; it ships unset and blocks. |
| `derived` | The value follows a committed artifact. Not editable. |

**Six settings ship with no value and that is correct.** Approved campaign
minimum and maximum duration, the interview providers, availability,
interviewer roster, reminder lead time, and the Admin reauthentication window —
Spec §6 names all of them and fixes a number for none. Spec §1 rule 6 forbids
inventing one, so they are empty, and the prerequisites panel blocks until an
operator states them. The same reasoning as `VITE_SUPPORT_CHAT_*`.

The two `derived` settings are the business-day calendar version and its
timezone. They come from the committed calendar in `shared/calendar`, and a
database trigger refuses to edit them: Spec §29.6 requires the calendar version
to be stored with every computed deadline and forbids an edit silently resetting
one, so a new calendar is a new committed version and a deployment.

Changes are versioned and audited by the database, not by convention.
`app_settings.updated_by` and `update_reason` are `NOT NULL`, so an update that
does not say who and why never commits, and a trigger writes the
`app_setting_versions` row that no application code can skip.

## Production prerequisites

`/admin/prerequisites` renders Spec §6's readiness list — the ten items that
must hold before Proovd may collect a live card. Five the app re-checks on every
load; five a named person verifies and records with a note and evidence, which
is Spec §34's own "recorded as complete" and Spec §1.3's rule that manual work
counts only when the app records it. Each item says which kind it is, because
showing a human check as a system check would imply automation that does not
exist (Spec §1.4).

**Incomplete prerequisites block, they do not warn.** There is no override on
that page, no "proceed anyway", and no place to add one. Spec §34 is released by
satisfying its conditions.

## Setup

Requires Node >= 20, a Postgres 16+ for integration tests, and the Stripe CLI
for local webhook forwarding.

```bash
npm install
cp .env.example .env        # fill in real values; never commit .env
npm run dev:backend
npm run dev:frontend
```

`backend/src/env.ts` is Zod-validated and **fails closed** on any live/test key
or mode mismatch — a `sk_live_` key with `STRIPE_MODE=test` exits non-zero at
boot, by design. It also refuses to boot without `BETTER_AUTH_SECRET` or
`ADMIN_REAUTH_WINDOW_SECONDS`, and rejects a half-configured Google OAuth rather
than failing later at the redirect.

`ADMIN_REAUTH_WINDOW_SECONDS` deliberately has no default. Spec §6 names the
Admin reauthentication window as a setting and fixes no value, so the operator
states it — the code does not invent one.

From Phase 06 that variable is the **first-boot seed**, not the running value.
An Admin cannot reach the settings surface before the app is running and
guarded, so the app writes it into the `admin_reauth_window_seconds` setting
while that setting is still empty, and ignores it from then on. Changing the
variable later does not change the window, and a restart cannot silently reset
a window an Admin has chosen. `requireFreshSession` reads the setting per
request and refuses — with a 503 naming the settings page — while it is unset.

## Commands

| Command | Does |
| --- | --- |
| `npm test` | Vitest across all workspaces |
| `npm run test:watch` | Vitest in watch mode |
| `npm run typecheck` | `tsc --noEmit` across shared, backend, frontend |
| `npm run build` | Build shared, then backend, then frontend |

Run a single test with Vitest's filter: `npx vitest run -t "<name>"`. Run one
workspace with `npx vitest run --project shared`.

The backend integration suites need a real Postgres. Set `TEST_DATABASE_URL` to
use an existing one, or leave it unset and Testcontainers starts
`postgres:16-alpine` (needs Docker). Migrations run `CREATE ROLE proovd_app`, so
the connecting role needs `CREATEROLE` or superuser, and `CREATE DATABASE` —
each test file that starts the app harness provisions its own database and drops
it afterwards, so one file's rows are never another file's surprise.

With neither Docker nor a spare server, a throwaway cluster does the job:

```bash
initdb -D /tmp/pgdata -U postgres --auth=trust
pg_ctl -D /tmp/pgdata -o "-p 55432" -l /tmp/pg.log start
createdb -h 127.0.0.1 -p 55432 -U postgres proovd_test
TEST_DATABASE_URL=postgres://postgres:x@127.0.0.1:55432/proovd_test npm test
pg_ctl -D /tmp/pgdata stop
```

The frontend and shared suites need neither Docker nor a database.

## Conventions that are not negotiable

- **Money is integer cents in `bigint`.** Never floats, never `NUMERIC`
  arithmetic in application code.
- **Stripe runs in test mode.** Live mode is gated by Spec §34 and is not open.
  No public surface may claim Stripe production approval before it exists
  (Spec §2.1). The homepage trust strip ships Appendix A.1 verbatim with
  exactly one sentence replaced by truthful conditional wording; that
  substitution lives in
  [frontend/src/features/public/trust-strip.ts](frontend/src/features/public/trust-strip.ts)
  and is reversed only when underwriting closes.
- **Sample campaigns collect nothing.** No form, no input, no iframe, no
  provider script — "disabled" is not the same as absent, and Spec §34 gates
  live mode on proving it.
- **Live chat renders only inside staffed hours**, and outside them not at all.
  Spec §31.4 names the hours as a setting and fixes no number, so
  `VITE_SUPPORT_CHAT_*` has no default and an unconfigured deployment shows no
  chat. The real commitment is the one-business-day email SLA in the footer.
- **`proovd.css` only** on the frontend — no Tailwind, no CSS-in-JS, no hex
  literals. GSAP is the only motion runtime, vendored under
  `frontend/public/vendor/gsap/`, never installed from npm.
- **Audit tables are insert-only.** `UPDATE` and `DELETE` are revoked from the
  application role at the database level. So are the settings-change history
  and the recorded production prerequisites.
- **Operating constants come from configuration, never from code.** Spec §6
  names roughly thirty of them; all of them are settings, and a later phase that
  needs 72 hours reads the setting. A hardcoded duration is a bug even when the
  number is right.
- **There is no public signup, for any role.** Accounts are created server-side
  by `seedAccount` in [backend/src/auth/seed.ts](backend/src/auth/seed.ts),
  which always takes an explicit role and exposes no HTTP route.
- **Backers have no account.** They use campaign-scoped magic links through
  [backend/src/auth/token-service.ts](backend/src/auth/token-service.ts) —
  never Better Auth's magic-link plugin, which would create accounts and
  sessions the Spec forbids.
- **Every token failure returns one identical response.** Invalid, expired,
  revoked, claimed, malformed, rate-limited, and never-existed are
  indistinguishable to the caller; the real reason goes only to the audit log.
  Never add a reason field, and never let a rate limiter answer with a 429.
- Secrets live in the deployment environment, never in the repo, the frontend
  bundle, email, or documentation. `.env.example` documents variable *names*
  and non-secret shape only.

The full invariant list — naming, state, idempotency, time, tokens, forbidden
patterns — is in [CLAUDE.md](CLAUDE.md).
