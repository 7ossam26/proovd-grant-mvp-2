# Phase 04 — Authentication and tokens

**Model:** Opus 4.8 — Security-critical, but the hardest reasoning is already done in the prebuilt token service. This phase wires it correctly — non-enumeration and the concurrent-claim UPDATE are the parts to watch.

**Goal:** three authenticated roles through Better Auth, one guest role through the prebuilt token service, and a failure surface that reveals nothing.

Four actors, two mechanisms. This is not four login types.

---

## Read first

- Spec §5 — the whole actor, account, and access contract
- Spec §5.5 — password and link recovery, and the non-enumeration requirement
- Spec §28.1 — token contract
- Spec §28.2 — Admin security
- Spec §7 — draft token lifecycle, resend rotation, 30-day retention, concurrent claim
- Spec §19 — magic-link validity and scope
- `docs/README-prebuilt.md` — why the token service exists and why Better Auth's magic-link plugin is wrong here
- `backend/src/auth/token-service.ts` and `backend/src/db/schema/tokens.ts`

---

## Prerequisites

Phase 03 green — `audit_events` exists and the app role cannot mutate it. The token service writes to it on every operation.

---

## Scope

### 1. The access model

| Actor | Mechanism | Notes |
|---|---|---|
| **Admin** | Email + password, **mandatory TOTP MFA** | Seeded directly. No signup, no public invitation. All Admins have full functional access in the MVP; hierarchy is deferred (§5.1). |
| **Founder** | Email + password **or** Google OAuth | A private invitation or Google sign-in establishes invited-email ownership. Phone collected and **explicitly unverified**. |
| **Affiliate** | Email + password | Claimed only through a private campaign-specific invitation. **No public signup route exists at all.** |
| **Backer** | **No account.** Campaign-scoped magic link | Guest only. Token service, not Better Auth. |

### 2. Better Auth

Configure the three authenticated roles with route guards. Email-link password reset for all three; **Backers have none** — Admin resends or reissues a magic link instead (§5.5).

**Admin MFA is mandatory**, not opt-in. An Admin without a registered TOTP factor cannot reach any operational surface.

### 3. Session freshness gate

Money movement, refunds, connected-account actions, and campaign kill/suspend require **recent reauthentication** (§5.1, §28.2). Configure Better Auth's freshness window from the §6 Admin reauthentication setting.

The gate **fails closed**: a stale session blocks the action and prompts for reauthentication. It never proceeds and logs a warning. §33.12.5 tests exactly this.

### 4. Token service wiring

The service and schema are prebuilt. This phase wires them:

- **Migration**, including the two things drizzle-kit won't generate — both are written out at the bottom of `tokens.ts`:
  - the scope-binding `CHECK` constraint
  - `secure_tokens_one_live_per_lineage`, the partial unique index that makes "two concurrent claims yield one account and one failed safe response" a database guarantee
- **Express middleware** for draft routes and magic-link routes. It calls `verify()` and attaches the scoped subject to the request. It does not reimplement verification.
- **Audit wiring** — pass the real `audit` writer from Phase 03 into `createTokenService`.
- **Rate limiting** on verification and on resend.

### 5. The non-enumerating failure surface

One shared page for every token failure. Invalid, expired, revoked, claimed, malformed, rate-limited, and never-existed all render **the same thing**:

- It explains the link can't be used.
- It exposes no account existence and no PII.
- It offers a context-preserving support route.
- Same HTTP status in every case.

§5.5 also permits a secure, rate-limited, non-enumerating self-resend if it's cheap. Build it only if it stays non-enumerating — the resend confirmation must be identical whether or not the address exists.

---

## Out of scope

Invitation *content* and the Admin surfaces that create invitations — Phase 05 and 06. Founder vetting. Affiliate signup flow. Any campaign concept. This phase builds the mechanism; later phases build the journeys that use it.

---

## Traps

- **Do not use Better Auth's magic-link plugin for Backers.** It creates a user account and a session. §5.4 says Backers are guest-only with no password account, and §19 requires campaign-scoped access. Build it on the plugin and §33.5.13 cannot pass without a rewrite.
- **Non-enumeration is about more than the message.** Same status code, same response shape, comparable timing. A 404 for "no such token" and a 410 for "revoked" is an enumeration oracle.
- **Never add a reason field to the token error type.** If one exists, someone eventually renders it. The reason belongs in the audit log.
- **Concurrent claim is a conditional `UPDATE`**, never select-then-update. The second caller's `WHERE` matches zero rows.
- **No SMS OTP anywhere** (§5.2, §33.1.8). Phone is collected and stored as explicitly unverified.
- **Raw tokens never touch a log**, an error message, an exception trace, or Sentry. Check the Sentry integration doesn't capture request URLs containing tokens.
- **Google OAuth is Founder-only.** Affiliates and Admins use email and password.

---

## Done when

- [ ] A personalized draft link opens without an account and grants **no other access** — no Admin, no payment, no other Founder's draft — **§33.1.1**
- [ ] Token alteration, cross-Founder access, replay, expiration, revocation, resend, and simultaneous claim all fail safely and identically — **§33.1.2**
- [ ] Resend rotates the token and invalidates every older version immediately
- [ ] Two concurrent claims produce exactly one account and one safe failure
- [ ] A magic link resolves only to that Backer's view of that campaign
- [ ] Admin MFA is enforced; a sensitive action without recent reauthentication fails safely — **§33.12.5**
- [ ] No SMS OTP path exists anywhere in the codebase — **§33.1.8**
- [ ] Every token operation writes an audit row with actor, action, prior/new state, and reason
- [ ] Grepping logs and Sentry for a known raw token returns nothing
- [ ] The failure surface is byte-identical across all seven failure modes
- [ ] Rate limits on verification and resend are enforced and tested

**Acceptance:** §33.1.1, §33.1.2, §33.1.8, §33.12.5. Partial credit toward §33.2.1 (no public Affiliate signup) and §33.5.13 (magic-link duration, revoke/reissue, non-enumeration).
