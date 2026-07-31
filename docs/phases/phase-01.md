# Phase 01 — Foundation

**Model:** Sonnet 4.6 — Scaffolding with no judgement calls. The only real thinking is the fail-closed env guard, which is a short, well-defined function.

**Goal:** an empty application that deploys to `app.proovd.co` over TLS, connects to Postgres, runs a migration, serves `/healthz`, passes one test, and refuses to start on a Stripe mode mismatch.

Nothing domain-specific is built here. No auth, no UI beyond a blank root, no business rules. This phase exists so that every later phase has a place to put things and a way to prove they work.

---

## Read first

- `docs/tech-stack-v2.md` — §2 (the stack), §4 (backend contract), §11 (repo layout), §16 (deployment), §17 (environment contract)
- Spec §32.2 — required mode-safe environment inputs
- Spec §6 — "Environment refuses a live/test key mismatch… Incomplete prerequisites fail closed."

---

## Prerequisites

Phase 0 complete: files placed, `gsap-check.html` all green, first commit made.

---

## Scope

### 1. Workspaces

Three npm workspaces — `frontend`, `backend`, `shared` — with one `Dockerfile`, one `tsconfig.base.json`, and one root `vitest.config.ts`. TypeScript on all three. `backend` and `frontend` both import from `shared`.

### 2. Backend — Express 5

- TypeScript build to `backend/dist`.
- `pino` logger, `pino-pretty` in development. Structured logs; never log a token, a raw card field, or a secret.
- `helmet`, `express-rate-limit`, CORS configured for a single origin.
- `GET /healthz` returning 200 with a database round-trip. This is what UptimeRobot polls.
- Static fallback: `/api/*` routes first, then serve `backend/public/index.html` for any other path.

**Middleware ordering matters more than it looks.** Do not mount a global `express.json()`. Mount it per-router. Phase 10 adds Stripe webhook routes that need the raw body for signature verification, and a global JSON parser consumes it — producing signature failures that look like a Stripe configuration problem and aren't. Establish per-router body parsing now so that trap never appears.

### 3. Environment — fails closed

`backend/src/env.ts` validates with Zod at boot and **exits non-zero on failure**. Not a warning, not a default.

Beyond schema validation, it enforces the §6 mode rules:

- `STRIPE_MODE=test` requires `sk_test_` / `pk_test_` prefixes; `live` requires `sk_live_` / `pk_live_`. A mismatch is fatal.
- A live connected-account ID in test mode, or a test account in live mode, is fatal.
- A webhook secret whose mode doesn't match `STRIPE_MODE` is fatal.
- `CRON_SECRET` must be present and non-trivial.

Full variable list in `docs/tech-stack-v2.md` §17. Values live in Dokploy's environment configuration; only names go in `.env.example`.

### 4. Database

- Postgres 16 in a sibling Dokploy container, named volume.
- Drizzle + `drizzle-kit`, migrations checked into `backend/src/db/migrations/`.
- First migration enables `pgcrypto` (for `gen_random_uuid()`) and creates nothing else. Its only job is proving the migration pipeline runs in development, in test, and on deploy.
- A documented migration command that runs on container start before the server binds.

### 5. Frontend — React 19 + Vite

- Vite + React Router v7 in data mode, TanStack Query provider.
- `frontend/index.html` is already written (Phase 0). **Do not regenerate it** — the vendor script order is mandated by DNA §6.7.
- Confirm Vite copies `frontend/public/` verbatim without processing. The GSAP files and `proovd-motion.js` must not be bundled or transformed.
- One blank route. No design system yet — that's Phase 02.

### 6. Test harness

- Vitest at the root, projects per workspace.
- `supertest` for backend integration tests, running against a **real Postgres** (Testcontainers, or a dedicated test database in CI). Not a mock, not SQLite. Later phases test atomic cap checks and partial unique indexes; neither behaves correctly outside real Postgres.
- Per-test transaction rollback or truncate-between-tests, whichever is cleaner with Drizzle.
- Two tests ship in this phase: `/healthz` returns 200, and env validation rejects a mode mismatch.

### 7. Deploy

- Multi-stage `Dockerfile`: build frontend → build backend → runtime on Node 20 Alpine, with `frontend/dist` copied to `backend/public`.
- Dokploy service, TLS on `app.proovd.co`, migrations on start.
- Sentry initialised with source maps uploaded at build.
- Point UptimeRobot at `/healthz`.

---

## Out of scope

Auth. Domain tables. Design system. Stripe SDK. pg-boss. Email. R2. Any route beyond `/healthz` and the SPA fallback.

---

## Traps

- **Express 5 changed async error handling.** Rejected promises in handlers now propagate to the error middleware automatically. Don't wrap everything in try/catch out of habit, and don't install `express-async-errors`.
- **Don't mount global `express.json()`.** See above.
- **Don't install the `gsap` npm package.** The vendored files are the runtime. A second instance breaks plugin registration.
- **The env check must be tested, not just written.** A fail-closed guard nobody exercised is a fail-open guard.
- **Postgres in tests must be real.** This decision gets reversed under time pressure around Phase 15 and then costs a week.

---

## Done when

- [ ] `npm install` at root wires all three workspaces
- [ ] `docker build` succeeds; the image runs migrations then serves
- [ ] `https://app.proovd.co/healthz` returns 200 with a real database round-trip
- [ ] `drizzle-kit` generates and applies the first migration in dev, test, and deploy
- [ ] Booting with `STRIPE_MODE=test` and a `sk_live_` key **exits non-zero**
- [ ] Both tests pass against real Postgres
- [ ] Sentry receives a deliberately thrown test error
- [ ] UptimeRobot reports the endpoint up
- [ ] No secret is committed

**Acceptance:** foundation only — no §33 test applies yet. The env guard is an early down-payment on §33.12.5 and §34's "test/live key separation and webhook signatures pass."
