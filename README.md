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

Built one phase at a time against `docs/master-plan.md` §6. **Phases 00–04 are
complete**; Phase 05 (public site and policy routes) is next.

| Phase | Delivered |
| --- | --- |
| 00 | Repo structure, design-system and prebuilt files in place |
| 01 | Express backend, Postgres, Drizzle, env guard, test harness |
| 02 | Design-system vocabulary, `StatePanel`, `Flow`, component gallery |
| 03 | Domain kernel — money, state machines, calendar, audit, idempotency |
| 04 | Auth — three account roles, Admin MFA and freshness gate, token service |

## Layout

npm workspaces, one root `package.json`, one multi-stage `Dockerfile`.

```
shared/     Zod schemas, money waterfall, state machines, business-day calendar
backend/    Express 5 + Drizzle + Postgres 16
  src/auth/   Better Auth config, guards, token service, seeding
frontend/   React 19 + Vite, styled solely by proovd.css
docs/       Spec, DNA, tech stack, master plan, phase briefs
```

`shared/money` holds the **only** implementation of the payment waterfall. Both
the checkout preview and the close batch call it.

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
the connecting role needs `CREATEROLE` or superuser.

## Conventions that are not negotiable

- **Money is integer cents in `bigint`.** Never floats, never `NUMERIC`
  arithmetic in application code.
- **Stripe runs in test mode.** Live mode is gated by Spec §34 and is not open.
- **`proovd.css` only** on the frontend — no Tailwind, no CSS-in-JS, no hex
  literals. GSAP is the only motion runtime, vendored under
  `frontend/public/vendor/gsap/`, never installed from npm.
- **Audit tables are insert-only.** `UPDATE` and `DELETE` are revoked from the
  application role at the database level.
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
