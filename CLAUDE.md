# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository.

**Read in this order:** *What Proovd is* → *Authority* → *How a session works*. Then read only
what your task needs. If you are about to change something that looks wrong, check
**Recorded deviations** before you "fix" it — several of the strangest-looking things in this
codebase are deliberate and were built by explicit product direction.

`§N` always means a section of the **Engineering Spec**. The unified brief is cited as
**Brief §N**, the design document as **DNA §N**, and the stack document as **tech-stack §N**.
Those numbering systems are unrelated; do not mix them.

---

## What Proovd is

A founder-led crowdfunding platform where crowdfunding is the mechanism and **paid validation is
the product**. Four actors:

- **Founders** are vetted, invited privately, and run one campaign at a time. Each is the
  **merchant of record** for their own campaign on their own Stripe Standard connected account.
  Proovd is the software platform and is MoR for nothing except its own listing fee.
- **Creators** (internally: affiliates / distribution partners) are hand-recruited **per campaign**
  and privately invited — never matched from a browsable pool. They are the retention engine:
  Founders churn structurally after success or failure, strong distributors recur. Where Founder
  convenience and Creator trust genuinely conflict, **Creator trust wins** unless payment safety,
  law, or platform integrity requires otherwise (Brief §0).
- **Backers** have no account at all. They save a card by SetupIntent and are charged later by
  off-session PaymentIntent — never at pre-order time.
- **Admin** operates almost everything manually behind a polished surface.

**Two campaign types, one rail.** An **Idea Campaign** (internal `pre_build`) charges only if the
disclosed order threshold — a count of unique Backers with active pre-orders — holds at close. A
**Product Campaign** (internal `pre_launch`) charges every active pre-order on the close date and
is keep-what-you-raise; its internal target is momentum, not a refund gate.

**The money.** Checkout is tax-exclusive: `subtotal + tax = total authorized`. Sales tax sits
outside Proovd's 5%, every Creator percentage, the Idea threshold, and the US$50,000 cap. The
provisional Creator amount is a **liability, never Proovd revenue**; the unearned remainder returns
to the Founder exactly once. Idea pays the Founder once (100% at Day 3); Product pays 40% at Day 3
and 60% at Day 14, with a narrow evidence-gated early exception that never skips the Day 14 review.

**The posture.** Manual behind a polished surface — and never pretending automation exists where it
does not. A manual step is valid **only when the app records it**. Live money is gated by §34 until
every condition is actually satisfied.

Everything above is background. It does not override the Spec, and it is not licence to change
anything — see *Authority*.

---

## Authority

1. **`docs/spec/Proovd-MVP-Engineering-Implementation-Spec-v1_0.md`** — behaviour, roles, data,
   state, money, tax, acceptance. **Wins on all of it (§1.8).**
2. **`docs/Proovd-Unified-MVP-Brief-v5.6.md`** — the product, operations, CX, and Stripe-approval
   source of truth. This is the **why**: what the product is for, who each actor is, what the
   commercial rules mean, and what Stripe was told. Where it and the Spec disagree on *behaviour*,
   §1.8 means the Spec wins. Where the Spec is silent on product intent, this explains it.
   **Read it for context; never treat it as a warrant to change shipped behaviour without being
   asked.**
3. **`docs/spec/Proovd_DNA.md` + `frontend/public/proovd.css`** — visual, interaction, motion, and
   content design. Wins where the Spec is silent on visual treatment.
4. **`docs/tech-stack-v2.md`** — implementation mechanics.
5. **`docs/master-plan.md`** — sequencing.
6. **`docs/build-log-archive.md`** — the full 4,200-line engineering narrative this file used to
   carry. Every decision below is summarised from it. When a summary is thinner than you need,
   the long form is there; search by surface name, section number, or date.

---

## How a session works

**Verification is scaled to the change, and most changes are small.** Almost everything recorded
in this file came out of *phase* work — whole surfaces, money paths, acceptance suites, browser
passes. Do not read that as the bar for an ordinary edit. There are two kinds of work:

- **A small change** — a copy fix, a style tweak, one component, one bug, a rename, a small
  refactor. Make the change, run `npm run typecheck`, and run **only** the one test file that
  covers what you touched (`npx vitest run <path>`). That is the whole verification. Do **not**
  run `npm test`, a whole workspace project, the §33.11 sweep, or a browser pass, and do not write
  a new test file — unless it is a bug fix whose bug a test would have caught, in which case one
  focused case is enough. If no test file covers what you touched, typecheck is the verification.
- **Phase work** — a `docs/phases/*.md` brief, or a multi-session rebuild brief. One phase per
  session (master-plan §1.3): read the phase file, then read only the Spec sections it names — not
  from memory — build, run **that phase's named §33 tests**, and commit only when every one passes.
  Serial: never start a phase whose predecessors are not green. If the phase is too large for one
  session, **stop and say so**; a truncated session produces code that looks finished and is not.

When in doubt about which kind of work you were handed, **it is the small kind.** If a small change
looks like it puts something wider at risk, say so in one sentence and let the user decide — do not
run the wider thing on your own initiative, and do not report a change as unverified because you
chose not to run a suite nobody asked for.

**Phases 00–24 are complete. All 131 §33 acceptance tests have been written and pass in a single
run.** The Founder onboarding flow, the Founder dashboard, the Creator flow, the Admin panel's
eight sections, the public campaign page, and the Backer surfaces are all built. Phase sequencing
lives in `docs/master-plan.md` §6; the per-phase splits and their reasoning are in the archive.

---

## Repository state — read this before looking for a file

> ### ⚠ The Admin panel's screens were REMOVED on 2026-08-21, to be rebuilt tab by tab
>
> 75 files under `frontend/src/features/admin/` (8 workspace directories, ~1.7 MB), the 288 tests
> that drove them, their routes, and ~4,900 lines of CSS are **gone from disk**. The archive's
> Admin sections are the *specification for the rebuild*, not a map of what is there.
>
> **What deliberately survives, and why:** the shell (`AdminLayout.tsx` and its eight nav tabs —
> the nav is the map of what the panel IS); `SectionPlaceholder.tsx` (§1.4 makes an empty screen
> indistinguishable from a broken one, and §33.11 sweeps these addresses for a heading);
> `AdminSignIn.tsx`; `api.ts` cut from 1,289 lines to 179 (**despite its folder this is the app's
> shared fetch helper** — `AdminRequestError` / `AdminError` are imported by the Founder-flow,
> Creator, Draft, Payouts and Auth clients and by `lib/useAutosave`, and `fetchDraftLanding` is the
> un-authenticated read three Founder-flow screens use; deleting it breaks Founder onboarding);
> `ConfirmDialog.tsx`; the Tasks panel; and **the entire backend**.
>
> **All 19 `admin-*.ts` routers, `backend/src/admin/`, and every `shared/src/admin/` register are
> untouched and still mounted.** This is not conservatism: commit `2f7aeed` once deleted admin
> screens *and* took five backend services and an acceptance suite with them, and **two of the 131
> named §33 tests silently stopped running** until an audit caught it. Those routers are also
> driven by pg-boss jobs, Stripe webhooks, and the §33 suites directly — none of which is a screen.
>
> **Routes are splats** (`path: 'campaigns/*'`), so a deep link minted by the Tasks panel or a §27
> notice still lands on its section. **To rebuild a section:** point its route in `routes.tsx` at
> the real component instead of `SectionPlaceholder`.
>
> Verified at removal: frontend and shared typecheck at 0 errors; the stylesheet balances and every
> `var()` resolves; zero classes orphaned; no dangling imports. **The test suite was NOT run** —
> run `npm test` before trusting the §33 suites.

| Area | State |
|---|---|
| `shared/` | The money waterfall + USD formatting, three state machines, business-day calendar, notification registry (121 §27 keys), policy register, §6 settings register, and the pure kernels and **registers** every phase is built on — §9 vetting sequence, §5.3 subtypes/evidence, §2.2 slot rule, §12 optional items, §14.3 compensation matrix, §14.4 build ingredients, §15 six-rule readiness, §16 thirteen-item checklist, §17 launch order + first-post checks, §18 attribution + update audiences, §19 consent templates + dedup normalisation, §20 Act ranks + Explore sections + live-editing tiers, §21 close/reconciliation steps, §22 completion/W-9/payment/fulfillment/ghost-ban, §24 refund causes + descriptors, §26 ledger/money-control lines, §27 contract + digest, §29 enforcement, §31.7 risk signals, §31.9 metrics, §33.11/§33.12 QA registers, §34 live-mode conditions, and the Founder/Creator flow registers. Plus Zod schemas. |
| `backend/` | Express 5, Drizzle + Postgres, env guard, Better Auth, token service, guards, audit + idempotency tables, pg-boss scheduler, Resend + React Email, the pinned Stripe client with two signed webhook endpoints, the R2 and Cal.com ports, and the full domain: vetting, invitations, workspace, listing fee, affiliates + decisions + readiness, campaign build/review/materiality, launch + attribution, reservations + close batch + retry, earnings + transfers, founder payments, refunds + disputes, fulfillment + Day 14, enforcement, support, notifications + digest, measurement, and live-mode. 58 migrations. |
| `frontend/` | Design-system components, `MotionProvider`, the fourteen §18 public routes, the Admin shell (eight sections, all placeholders except Tasks — see the notice above), the Founder onboarding flow's twenty-four full-bleed pages, the Founder dashboard (four chapters at one address + Backers page + `/settings`), the Creator flow (nine onboarding screens + app shell + Home/Pitches/pitch/work/Earnings/Resources/Settings), the public campaign page + both samples + checkout modal + follow pages, the Backer magic-link page, the §33.11 QA harness, a dev-only gallery at `/_gallery`. |
| `frontend/public/` | `proovd.css`, `proovd-motion.js`, `vendor/gsap/*.min.js`. |

**Six gaps to know about — none is a bug, and none should be "fixed" by stubbing:**

1. **`frontend/public/fonts/` is empty in a fresh clone.** `.gitignore:31` keeps the licensed woff2
   binaries out of the repo on purpose, so every Docker/Dokploy build ships a `dist/` with no fonts
   and production 404s on them. **Not fixable by editing code** — the binaries have to reach the
   image another way, and that is a licensing decision. The fail-loud font check is *correct* — it
   now reports to the console rather than rendering a banner (see *Recorded deviations*).
2. **All eight policy documents are `draft`** (Track A2, in legal review). §1 rule 6 forbids
   inventing the text; §31.4 forbids a summary.
3. **Because they are drafts, the account claim refuses, in the open.** A consent may cite only a
   published version, so `completeClaim` returns `policies_unpublished` and the surface renders the
   reason instead of the button. Correct state, not a bug to route around.
4. **Six §6 settings ship with no value and the prerequisites panel blocks.** Designed state — §6
   names them and fixes no value, and §1 rule 6 forbids inventing one.
5. **No email provider is configured, so the transport refuses loudly.** `unconfiguredTransport`
   throws rather than swallowing a message. Do not replace it with a no-op.
6. **No R2 bucket and no Cal.com account** (Track A4). `unconfiguredStorage` and
   `unconfiguredScheduler` both throw exactly as the transport does. Do not stub any of them.

---

## Invariants — these are never violated

### Invent nothing (§1 rule 6)

No new commercial rule, deadline, fee, eligibility condition, payout rule, campaign state, or
consent. If a case is not expressly automated, route it to Admin review and preserve a complete
audit record. **If something seems missing, say so — do not fill the gap.**

### Naming (§3, Brief §2.4–§2.5)

| Internal only | Customer-facing |
|---|---|
| `reservation` | Pre-order |
| `affiliate` | Creator |
| `pre_build` | Idea Campaign |
| `pre_launch` | Product Campaign |
| `single_payment` | Single Founder payment |
| `first_payment` / `remaining_payment` | First payment / remaining payment |

Also internal: `captured_charge`, `listing_fee`, `platform_fee`, `founder_share`,
`affiliate_compensation`.

**Banned everywhere, including table, column, job, and log names:** `pledge`, `donate`, `MBP`,
`tranche`, `goal` (for an Idea threshold), `escrow`, `custody`, `trust`, `held in a Proovd
account`, `all-or-nothing`, `Day 30`, `upfront (fee|payout|payment)`.

Internal names leak into Admin panels, error messages, and support transcripts — §3.1 treats that
as a real risk, not a style preference. **§33.11.3 scans the built bundle**, where a prop name
survives minification: `goal` has been caught there three times (`progress.goal`, `PRIVATE BETA
GOAL`, `goalAmount`). Sample URLs may keep `sample-pre-build` / `sample-pre-launch`.

### Money

- **Integer cents in `bigint`.** Never floats, never `NUMERIC` arithmetic in app code.
- **Sales tax is excluded from** the Proovd 5%, every Creator percentage, the Idea threshold, and
  the $50,000 cap (§24.3).
- **One implementation** of the waterfall, in `shared/money`. Both the checkout preview and the
  close batch call it. **Never write a second one.**
- The provisional Creator amount is a **liability account and is never Proovd revenue** (§24.4).
  The unearned remainder returns to the Founder exactly once.
- Three streams never commingle: campaign charges (Connect, Founder is MoR), listing fee (direct
  Checkout, Proovd is MoR, `PROOVD LISTING`), fixed Creator payment (own allocation, no percentage
  applies).
- **One resolver, many renderers.** §22.3's status is composed only by `readFounderPaymentStatus`;
  Appendix B.7 only by `resolveAffiliateMoneyStatus`. A surface that recomputes an amount is a
  second answer waiting to disagree (§33.8.13).

### State (§23)

- `campaigns.status` is **lifecycle only**. Never put a payment flag in it.
- `affiliate_roster_status` and `campaign_build_status` are separate columns. `review_ready` is
  derived, never stored.
- Payment/reconciliation flags are independent rows with timestamp, amount, actor, evidence,
  provider IDs.
- Association status (19 states) and reservation status (11 states) are their own enums.
- Every transition is append-only history. Illegal reversals must be **impossible**, not merely
  unwritten — prefer a trigger over a service rule. A successful SetupIntent stays historical even
  after the reservation is canceled.

### Idempotency — three mechanisms, all required

1. `provider_events` — unique on the Stripe/Cal.com event ID. Insert-or-skip before any domain work.
2. `idempotency_keys` — stable domain keys for close-batch attempts, capture retries, fixed-payment
   funding, Transfers, refunds.
3. `notification_deliveries` — unique on (event, target, entity).

A duplicate event may update audit. It may never duplicate domain state, money, or a message.
Running the close batch twice, receiving duplicate webhooks, and crashing mid-batch must all be
safe (§33.7.7). **Claim the row before the provider call**, never after: a crash then costs a retry
under the same key rather than money that moved with no record.

### Time

- `timestamptz` everywhere, stored UTC, rendered local with UTC secondary (§27.1). A bare
  `toISOString()` on a deadline is a §27.1 violation — `Z` spells nothing out to a reader.
- The three anchors — `listing_paid_at`, `campaign_live_at`, `campaign_close_at` — are dedicated
  columns. **Never infer them from `created_at`/`updated_at`** (§21, §33.12.1 scans for it).
- Business-day deadlines use the committed versioned holiday calendar in `shared/calendar`, and the
  version string is stored alongside the computed timestamp. A retry or edit can never silently
  reset a deadline (§29.6).
- **The anchor gates; the sweep only notices.** Cancellation ends at `campaign_close_at` itself,
  not when the cron fires.

### Audit (§25.6)

Insert-only. `UPDATE` and `DELETE` are revoked from the app role **at the database level**. Every
manual or high-impact action records actor, reauth context, target, action, time, internal reason
**and** customer-facing explanation as separate columns, prior and new value, amount, provider IDs,
evidence links, notification IDs. **The prior value is read from the row under lock inside the
transaction that changes it** — a caller that supplies both halves can supply a flattering pair
(§33.12.4).

### Never imply automation that doesn't exist (§1.4)

The MVP is manual behind a polished surface. Present manual steps truthfully as guided review,
safety control, or human support. Manual work is valid **only when the app records it** (§1.3).
Corollaries that keep recurring: a key with no sender claims a message that does not exist; a
control whose route does not exist is worse than no control; "not yet populated" is not zero; a
disabled control invites someone to work out how to enable it, so prefer **absent with the reason
rendered where the control would be**.

### The §34 live-mode gate (§34, §2.1)

No live money moves while the gate is closed, and the refusal is at the **one** Stripe gateway
every service receives — not at each caller. The decorator throws at boot if the gateway carries a
callable member with no recorded §34 disposition.

- **Never cache the gate.** A cached gate is a rollback that does not take effect.
- **Never add an override.** No route sets `open`. §34 is released by satisfying it.
- **Refunds and card detaches are permitted while the gate is closed**, deliberately. §34 blocks
  six things and all six *create* exposure; blocking the two that *unwind* it would strand the
  people the rollback plan exists for.
- An unanswered condition is unsatisfied, and a gate that cannot read its own conditions is shut.

### Auth — four actors, two mechanisms (§5)

| Actor | Mechanism |
|---|---|
| Admin | Email + password, freshness gate on sensitive actions. **No second factor** — see *Recorded deviations* |
| Founder | Email + password **or** Google OAuth |
| Creator | Email + password, private campaign-specific invitation only |
| Backer | **No account.** Campaign-scoped magic link via the token service |

- **No public signup exists, for any role.** `disableSignUp: true` closes the HTTP route; accounts
  are created server-side through `seedAccount`, which always takes an explicit `role` and has no
  HTTP surface. Do not add one — §33.2.1 is exactly this. **`disableSignUp` must also sit on the
  Google provider**: Better Auth checks email/password and social independently, and without it the
  OAuth callback creates a user for any Google identity it has not seen and stamps it `founder`.
- **`role` has no database default.** Every creation path states it.
- **Guards fail closed** (`backend/src/auth/guards.ts`). No session, unreadable session, database
  error, missing/unrecognised role, wrong role, stale session — every one blocks. None logs a
  warning and proceeds (§33.12.5). `requireAdmin` is the single place the Admin boundary is
  decided; nothing calls `requireRole(auth, 'admin')` directly.
- **An identity is never taken from a request body.** The account claim reads the Google id off a
  real session; `assignToSelf` and every actor field resolve from the session.
- **The frontend is not the boundary.** `RequireRole` decides what to *render*, not what is allowed.
- **CSRF is two layers.** `SameSite=Lax` is what actually stops a malicious page attaching the
  cookie; the CORS allow-list blocks nothing (a POST whose response the attacker never reads is a
  CSRF that succeeded). `crossOriginWriteGuard` refuses a state-changing request whose Origin is
  present and untrusted. A **missing** Origin passes deliberately — that is a non-browser caller
  with no ambient cookie, and it includes both signed webhook endpoints.
- **`TRUST_PROXY_HOPS` decides what `req.ip` is** and therefore what every rate limiter keys on. It
  defaults to `0`. Never express it as a boolean.
- **Phone is never verified.** A CHECK pins `user.phone_verified` false; §33.1.8 scans the tree to
  keep it that way.
- **Account standing is an access decision, per request.** `founderStandingGate` reads
  `founder_access_actions` and `founder_ghost_bans` on every request, so a suspension takes effect
  on the next call.

### Tokens (§28.1)

Backers have **no account**. Use `backend/src/auth/token-service.ts` — never Better Auth's
magic-link plugin, which creates accounts and sessions. Raw tokens exist only in the delivered URL:
never at rest, never in a log, never in an error.

- **One rejection, one status, one body.** `token-rejection.ts` holds a frozen constant. Nothing
  per-request goes in it. **Rate limiters on token routes return *this*, never a 429** — a limiter
  that announces itself is the same enumeration oracle wearing a different hat.
- **Never add a reason field.** The reason goes to the audit log, where support can read it and the
  caller cannot.
- **An ask route answers before it works.** Mint-and-send versus return-immediately is measurable
  even when the bodies match. `MAGIC_LINK_REISSUE_ACK`, `EMAIL_CODE_ACK` and `FOLLOW_ACK` are
  frozen and identical for a hit, a miss, a malformed address, an unknown campaign, and a caller
  over the limit.
- Concurrent claim is a **conditional `UPDATE`**, never select-then-update.

### Forbidden patterns (§30, DNA §5.10, Brief Appendix H.11)

No confetti, streaks, or countdown pressure that confuses a saved card with a charge. No fake
scarcity, fabricated popularity, or live-viewer counts. No AI support presented as human. **No
public leaderboards or ranking of any kind** — and note that a *sorted list* is still a ranking,
because the order is the claim. No prechecked optional consent. No live chat without staffing. No
"real time" claims for refresh-based data. No generic errors without money/data status and
recovery. No competing actions in payment, cancel, refund, or card-recovery states. No scheduled
"check your campaign" messages — a notification fires only for a real required action or
consequence.

---

## Recorded deviations — do not "fix" these

Each was built by **explicit product direction** and departs from the Spec. They are recorded here
so a later session does not delete one as a defect, and does not read one as licence for its
neighbours. Reversing any of them needs the same kind of instruction that created it.

| Deviation | Departs from | What keeps it narrow |
|---|---|---|
| **Admin second factor removed** (2026-08-10) | §5.1, §28.2 make Admin MFA mandatory | The plugin, table, column, setting, scripts and every enrolment path are gone (migration 0041). What did **not** change: the Admin still presents a real credential, `requireAdmin` still refuses every non-`admin` role server-side, and `requireFreshSession` is now **the only control** between a long-lived stolen session and a money-moving action — so it is the one thing in `auth/` that must never be loosened casually. No bypass, dev shortcut, or hardcoded Admin replaced it. §34 condition 8 was restated to describe the controls that exist. |
| **Account-level Creator suspend/restore** | §29 records Creator enforcement per *association*, not per account | `affiliate_access_actions.action` admits exactly two values by CHECK. There is **no ban**: no `affiliate_ghost_bans` table, no ban branch in `creatorStandingGate`. §29's association-scoped enforcement is untouched. |
| **Nine-screen Founder onboarding** and **nine-screen Creator onboarding** | §11 asks for "one compact flow" and forbids a "multi-page education sequence" | Every §11 content bullet is still collected; the five §28.4 confirmations are still five separate unchecked controls writing five columns; **no bank, routing, tax-id or identity input exists anywhere and no route could accept one**; no public route; the invitation still claims exactly one association (§33.2.1). §33.2.2 was re-authored in one test with one dated comment — the money half is load-bearing and stays. |
| **Six-digit emailed verification code** (Founder flow) | §5.2 gives the Founder email/password or Google | It verifies an **email** — creates no account, mints no session, does not touch `completeClaim`. Stored as an **HMAC** over draft + address + code (a plain SHA-256 over six digits would collide two live codes on the UNIQUE hash index and be a rainbow table one row wide). Six wrong guesses finish the code. One frozen rejection for every failure mode. **§33.1.8's no-SMS-OTP scan is the guardrail** — if it ever needs editing, that is the signal this grew past what was authorised. |
| **Transcription port** (dictation) | §30 defers AI rewriting | One method. **No generate, summarize, rewrite or suggest** — enforced by a source scan that strips comments first. **The audio is not kept**: no column, no bucket key, no job (§25.8 defines no window for it, and inventing one is §1 rule 6 in the other direction). The transcript lands as ordinary editable Founder text with supplier `founder`. |
| **Founder fixed-payment openness record** (0052) | §16 makes the fixed payment the Creator's request, accepted bilaterally through one §14.2 version | **No amount column, no percentage column, no proposal reference** — the exact column set is asserted. An Idea campaign cannot hold one (a CHECK *and* a shape trigger, because the CHECK alone is satisfiable by writing `pre_launch` onto an Idea campaign). Insert-only, superseded rather than edited. Read by Admin when recruiting and by nothing else. |
| **`campaign_followers`** (follow record) | §1 rule 6 — capturing email from someone who has not pre-ordered | **One message**, and it is a receipt. Double opt-in, and **confirm/unfollow are POSTs behind a page** — a GET confirm would let an email scanner complete the double opt-in that exists to require a person. A follower takes the **Creator** visible-audience list, never the Backer one. No `follower_count` on `campaigns`, no schedule column, no second message. Not licence for a cadence or a re-engagement sequence. |
| **Founder→Creator meeting request** (0056) | §30 defers the meeting scheduler *and* direct messaging; §11 says the Founder cannot contact the Creator directly | **Not a scheduler**: no `scheduled_for`, `duration`, `timezone`, `platform`, `meeting_url` or `slot` column — asserted, and the route is driven with those fields in the body to prove they are ignored. **Not a thread**: one message, written once, immutable by trigger; a second ask is refused by a partial unique index. It decides nothing — the association row is compared byte-for-byte before and after. One §27 key. |
| **Founder acknowledgement of a Creator's post** (0057) | §30 defers direct Founder–Creator messaging | **No free text** — the exact seven-column set is asserted, and the route ignores its body. **One-way at the database**: neither UPDATE nor DELETE is granted, so there is no un-acknowledge (a toggle would leave the record and the inbox disagreeing). Refuses a post Proovd has queried. One §27 key, deduped on the post. |
| **Creator standing / tier** (0055) | Invents a score the Spec does not define | The table has seven columns and **none is a rate, floor, percentage, multiplier, or eligibility value**; **no `proposal_access` column exists anywhere in the database**. A source scan by path proves five named modules never read it. The weights are **in the register the surface renders from**, so the arithmetic is stated rather than hidden. Sales, response speed, and the §8 quality tier are refused as inputs by name. |
| **Creator referral** (0055) | Invents an introduction path | An Admin task, not a signup route: no account, no prospect row, no association, no token scope, no public join address — all counted before and after. No amount, cents, percentage, commission or payout column. No state meaning the person joined. |
| **Creator Resources screen** | §14.1: "All material lives in one Campaign kit" | `creator_resource_interest` has a key, a subject, and a timestamp — no asset, URL, file, or campaign column, so it cannot become the §31.5 kit. No download control, because there is no file. |
| **Creator account-level Home and Earnings** | §26 makes the Admin panel the only dashboard-style product | Built to §20's Founder rules by analogy: no KPI tile wall, no counters table, no real-time claim, one thing waiting or the caught-up ending, every unpopulated block naming what it waits on. |
| **The owner ruling** (2026-08-19) | DNA §1 / §2 / §10.1 | Radius is 2px on **both** postures, brand-green fill takes `#FAFAFA` text, and the inset highlight ships on brand-filled primaries. Verified at runtime across 192 brand-filled elements and 166 primaries. Two deliberate high-contrast pairings on brand (`--dark` on brand, 8.0:1) were **kept** — the ruling replaces `#E9FFE1`, it is not a mandate to destroy a readable pair. Every other DNA rule stands. |
| **Fail-loud notices are console-only** (2026-08-24) | DNA §3 and §6.6 require a *visible* accent-yellow notice for a Satoshi or GSAP failure | Real customers were seeing `Satoshi didn't load.` while the font was working — `fontsReady` resolves on an 1800ms timeout, so a cold cache measured the fallback mid-swap and never re-checked. A false brand-failure banner shown to a Backer is worse than the failure it catches. **Nothing is swallowed:** both checks still run, `notice()` still exists on the runtime surface and still fires — as `console.error('[proovd] …')`, once per message per page load — and GSAP's failure still sets `html.no-motion`, so proovd.css's jump-cut fallbacks remain the visible degrade. The Satoshi check got **stricter**, not weaker: it now confirms with a second measurement after `document.fonts.load` before reporting. `.pv-notices` / `.pv-notice` are gone from `proovd.css`; the copy in `admin-founders.css` belongs to a standalone prototype and was left alone. |

**Withdrawn, and kept recorded so the reversal does not read as drift:** the 2026-08-10 vetting
simplification (Positioning, the Founder's own campaign-path choice, and §10's Creator signal all
returned on 2026-08-18). **One half did not revert** — the §10 result no longer *gates* the claim.
§10 orders the result before account creation and says nothing about blocking one.

---

## What each area learned

Condensed from the archive. Each entry is a rule that cost something to discover.

### Records, registers, and the shared/backend boundary

- **The backend never imports `@proovd/shared` at runtime** — it compiles under `rootDir: src` and
  the image ships only `backend/dist`. The answer is always the same: **restate the data in the
  backend and drift-test it against shared.** Never restate the *prose*; restate only what a CHECK
  or a runtime branch depends on, because two copies of a paragraph is how they start disagreeing.
- **A list in prose is a list nobody can test.** Every "all N of these" claim in the Spec is a
  shared **register** that the backend restates, the query walks, and the suite asserts. A twelfth
  filter added without a §26.5 line fails the drift test; a dropped one fails it too.
- **A column in Drizzle and the migration alone does nothing.** There is no Zod schema for a build
  patch and no route-layer whitelist — the `assign(...)` calls in `saveBuild` **are** the entire
  allowlist. Each new field is wired in five places (Drizzle, migration, `BuildPatch` + `assign`,
  `serializeBuild`, `BuildFields`) plus the one preview assembly. A field missing from `assign` is
  one no Founder can write; missing from `serializeBuild` is one they can write and never read back.
- **History is a trigger, not a service call.** A service that writes the history row is one a
  careless `db.update()` bypasses. `app_setting_versions`, `draft_field_edits`,
  `optional_item_events` and the follow-consent history all record this reasoning.
- **Insert-only means the grant, not the intention.** `UPDATE`/`DELETE` revoked from the app role;
  where one column must move, grant **that column by name**. A correction is a new row.
- **Register entries rot silently until something reads them.** Three of Session A's Creator-flow
  `derivedFrom` strings named columns that did not exist — found the moment a surface first read
  them. The fix that sticks: a test that parses every `table.column` out of the register and
  asserts it exists in `information_schema`.

### Money, Stripe, and the close path

- **`affiliate_id` on `campaign_affiliate_associations` holds the PROSPECT id, not an account id.**
  The account identity is `affiliate_signup_profiles.claimed_user_id`. Anything keying a
  connected-account lookup off `affiliate_id` **routes money at a UUID nobody owns.** Four separate
  `owns` helpers already re-implement that lookup; do not add a fifth silently.
- **The gate throws rather than returning a normalized failure** — the one exception in this
  codebase. Every caller treats a thrown error as "the provider call did not happen" and retries
  under the same key, which is the truth. A returned failure would look to `close-batch.ts` like a
  **decline**: it would enter the retry window, tell a Backer their card failed, and start a
  48-hour clock over a charge nobody attempted.
- **The threshold decision is made once, from the state at exactly close, and the database keeps
  it.** A later payment failure moves the campaign to `capture_retry_window`, never back to
  `ended_no_charge`.
- **An unusable tax calculation means no charge, never a substituted total.** `tax_calculation_
  unusable` is a real outcome with its own notice.
- **`requires_action` is routed, not converted to a failure** at the provider — §21 sends it to a
  customer-action recovery.
- **Tests move time, not the anchor.** Stored deadlines are trigger-immutable, so a window-end test
  passes `deadline + 1s` rather than editing the row.
- **The unearned return has no provider leg today** — under direct charges no platform-side fee is
  debited at capture, so the remainder is already with the Founder and the return is the ledger
  resolution of the liability.
- **§32.5's card numbers live in the suite and nowhere else.** `shared/` ships in the browser, so
  the register carries the scenario and the expected provider code — no digits — and the memory
  gateway takes an **outcome name** rather than a card.
- **The raw provider code never reaches a customer surface.** It lives on the attempt row and in
  the internal audit column; `containsRawProviderCode` refuses it at the point an Admin can still
  fix it (§33.9.11, §25.6).

### Admin

- **Every workspace is keyed on the PERSON, not the draft or the association.** A Founder whose
  campaign was archived-and-restarted appeared twice with no relationship between the rows until
  this was corrected. Three ids and confusing them is the mistake that moves money wrongly:
  `prospectId` is the person, `associationId` is one campaign relationship, `claimedUserId` is the
  account.
- **Nothing is stored.** No `timeline_events`, no `campaign_events`, no `affiliate_history`, no
  `support_case_events`, no Today table — every timeline **composes** across existing tables and
  names the table each entry came from, so the claim is checkable from the response. §26.8's trap:
  *a second event store that drifts from the first is worse than no timeline.*
- **An internal note's body never reaches a timeline** — a timeline is exactly the view that gets
  pasted into a customer message.
- **The freshness gate is a partition, not a demand.** Reauthenticating for ordinary work teaches
  people to do it reflexively, and a gate cleared without thinking is not a gate. §33.12.5 walks
  the **mounted router**, drives every write with a stale session, and requires the result to
  partition exactly: gated, or registered in `UNGATED_ADMIN_WRITES` with the sensitive property it
  lacks. A new route belongs to neither set until somebody decides.
- **Overridable fields are a register, never free text.** A route accepting any string would record
  an override of something that does not exist, and the trail would look complete while pointing at
  nothing.
- **The preview is a record, not a render.** A preview merely displayed is one nothing enforces,
  because the next caller posts straight to execute. It is stored with a hash of the exact payload
  and consumed once.
- **Seeing is not exporting (§25.7).** The ledger read returns restricted columns because support
  work needs them in front of a person; the **export reads its column list from the register, never
  from the caller** — a limit the requester can widen is not a limit.
- **Labels are total maps over the enum.** A 28th lifecycle state without a human label fails the
  **build** rather than rendering `banned_founder` to somebody on a support call.

### Notifications (§27)

- **Coverage is a partition.** Every registry key is sent **or** recorded in `unsent.ts` with a
  reason and an owner; the suite asserts the two lists partition exactly. Three kinds of absence —
  `never` (a decision the Spec itself makes), `capability` (behaviour that does not exist yet), and
  `message` (behaviour exists and is recorded) — and a `message` absence must name the record.
- **The dedup entity is the decision, not the object.** Keying on the draft satisfies §27.2 and
  breaks §7's resend. Keying an interview change on `<booking>:<time>` collides on a
  cancel-then-rebook to the same slot. Key on the **row that records the thing happening**.
- **The delivery row is written BEFORE the provider call** with `notification_id` NULL, and
  confirmed after. Writing it after leaves a crash-shaped hole: an email delivered with no send
  row, therefore no retention clock. NULL is a **state** — "recorded, not confirmed" — and surfaces
  render it as exactly that.
- **Money messages come in four classes.** One class would demand a statement descriptor on a
  cancellation — the one message where §30 makes it most important not to imply money moved.
- **The digest composes from activity records, never from `notification_deliveries`.** The obvious
  implementation ("everything we emailed you") is exactly the one that breaks §27.2's
  not-opt-out-able rule. The single permitted use of the deliveries table is to *exclude* an
  already-sent item.
- **A source scan must strip comments first.** These files explain at length what they refuse to
  say; a scan that cannot tell an explanation from a usage forces the explanations out.

### Founder and Creator flows

- **A record collected on two screens is a record whose two copies eventually disagree** — and a
  suite testing both copies makes that look correct. Every retired surface became a **redirect**
  rather than a deletion, because §27 emails and Appendix C walk steps point at the old addresses.
- **The register is the single source for the router, the help drawer, and §33.11.** Three
  hand-written lists is two chances to disagree, and the disagreement shows up as a help card that
  jumps somewhere that does not exist.
- **A page appears in the register when something renders it, never before** — `events.ts`'s rule
  applied to a screen.
- **Where a Founder can BE is a different list from what they answer.** Resume positions and answer
  keys diverged the moment a screen came back, and the stale mapping resumed people one screen past
  where they stopped.
- **The supplier is derived from the actor, never from the request.** A request that could declare
  its own provenance could declare a flattering one.
- **§9's Competition has nowhere to be prefilled** — no `competition_prefilled_*` column exists, the
  prefill function takes two parameters, and a CHECK pins the supplier to `founder`. Three
  independent locks plus a tree-wide scan (§33.1.5).
- **The campaign type lock is a trigger**, so it holds for every future phase and every support
  script. A wrong type **archives and restarts**; there is no migration path (§33.1.7).

### Frontend, CSS, and motion

- **jsdom has no layout.** Fourteen consecutive rebuilds each found at least one defect that only a
  real browser could see, and axe could see none of them. When a session's deliverable is a
  surface, the browser pass is not optional polish — it is the verification.
- **Chrome will not give you a 320px viewport on Windows.** `--window-size=320` reports 489.
  Use `Emulation.setDeviceMetricsOverride`, or render inside a 320px iframe.
- **`textContent` is not what a reader sees** — it concatenates adjacent nodes with nothing between
  them, so a `dt`/`dd` pair reads as one run-on word. Every scanner reads through `visibleText`.
- **Phase numbers in `proovd.css` collide.** Two sessions in parallel derive the same next number;
  it has happened three times, twice producing committed conflict markers that silently killed
  every rule after them. **Always** run
  `grep -oE "PHASE [0-9]+" frontend/public/proovd.css | sort -u -V | tail -1` and take the next.
- **A silently-invalid stylesheet has shipped three times.** `a11y.test.tsx` now scans for comment
  balance, brace balance, undefined `var()`, and conflict markers — added after `*/` inside a
  comment killed a token block, an unclosed `@media` swallowed a whole phase, and a merge
  interleaved two sessions' rules.
- **A `.btn`/`.tag` is `inline-flex`; a flex item in a column is stretched** by the default
  `align-items: stretch`. Four sessions lost a pass to this. **A `.btn` is `overflow: hidden`**
  (it hosts the fill sweep), so a squeezed row clips its own label rather than wrapping.
- **`.wrap` is `min(90vw, 1600px)` — a VIEWPORT width**, correct at top level and wrong nested.
  Three surfaces overflowed on it. **`min-width: auto` on a grid item** is why a single-column grid
  can be wider than its container; use `minmax(0, 1fr)`.
- **A hardcoded light token inside `mode-dark` is invisible to axe** — the accessible name is
  correct and contrast is computed against the element's own declared background, not the band
  showing through it. Five phases each recorded a version of this.
- **Known product-wide contrast gaps, deliberately NOT fixed on one surface:** `--moss` 3.37:1,
  `--grey` ~2.2:1, `--mode-link` (= `--brand`) 1.46:1, `.btn--secondary` 1.46:1, `state-panel__key`
  2.18:1, `Tag`'s mint pairs. Re-toning any is a product-wide decision with its own pass. The rule
  applied instead: **a line that states a rule takes `--dark`; a caption stays quiet.**
  `.btn--primary` at 1.44–1.46:1 is the documented, scoped **tech-stack §3.6 exception** for brand
  fill — verified as recorded, and it covers brand fill wherever it appears, not just buttons.
- **React 19 StrictMode double-invokes effects.** Any animation that measures the DOM must clear
  its transform before measuring, or the second invocation measures mid-flight. `g.from` takes the
  **current** state as its destination, so a double-invoked `from` animates nothing and snaps.
- **`event.currentTarget` is null inside a functional `setState` updater** — the synthetic event is
  recycled before the reducer runs. This threw into the ErrorBoundary on the first keystroke of a
  control answering a review that blocks a payment.
- **`useButtonProgress` hands the runtime the PROMISE, not the callback.** A callback-shaped mock
  resolves immediately and swallows the error, so every server-refusal assertion behind it passes
  for the wrong reason.
- **GSAP is the only motion runtime** and is vendored, never imported from npm. Motion in React
  goes through `MotionProvider`; skipping it makes animations die silently as the app grows.

---

## Toolchain (tech-stack §2, §11, §13)

- **Repo:** npm workspaces — `frontend/` (React 19 + Vite), `backend/` (Express 5), `shared/` (Zod,
  money, state machines, calendar). One root `package.json`, one multi-stage `Dockerfile`.
- **DB:** Postgres 16 + Drizzle; `drizzle-kit` generates and applies migrations. Money is integer
  cents in `bigint`.
- **Commands:** `npm test`, `npm run typecheck`, `npm run build`, `npm run dev:backend`,
  `npm run dev:frontend`. One file: `npx vitest run <path>`. One test: `npx vitest run -t "<name>"`.
  One project: `npx vitest run --project shared`. **`npm test` is for phase work and for when the
  user asks** — see *How a session works*.
- **Tests map §33 directly.** Do not invent a parallel plan. Vitest for domain units; supertest +
  real Postgres for API integration; Stripe test clocks for payment outcomes; Testing Library for
  consent/checkout/recovery surfaces; Playwright for the one full-lifecycle E2E;
  `axe-core` + manual keyboard/screen-reader passes for §33.11.
- **`export TEST_DATABASE_URL` first.** It lives in `.env`, which is not loaded into the shell.
  Without it the harness falls back to Testcontainers, finds no Docker, and reports **~61 failed
  FILES and 0 failed TESTS** — the identical summary line to the esbuild flake below, with a
  different fix. Look for `PostgreSqlContainer.start` in the stack before batching anything.
- **esbuild intermittently fails to read `tsconfig.base.json`** ("Access is denied"), aborting
  project setup before any test runs. Concurrency-dependent and pre-existing. Signature: **many
  failed FILES, zero failed TESTS**. Run the backend in batches of ~5 with retries and aggregate.
- Integration tests need a real Postgres and the connecting role needs `CREATEROLE` or superuser
  (the migrator runs `CREATE ROLE proovd_app`).
- **Each harness-based file gets its own database:** `startHarness({}, 'label')`.
- A backend test that mutates seeded rows wraps them in `BEGIN`/`ROLLBACK`, **one failing statement
  per transaction** — the first error aborts the block.
- **Testing Library's `waitFor` deadline is 10s**, set in `src/tests/setup.ts`; `testTimeout` does
  not govern it. The frontend project runs **four workers with a 30s `testTimeout`** — unbounded
  workers had a dozen jsdom+axe renders competing for the same cores, turning a 40ms axe pass into
  24 seconds and leaving axe mid-run so the next assertions failed with `Axe is already running`.
- **The frontend suite builds the production bundle in `globalSetup`**, not in a test — §33.11.3
  scans what ships, and running `vite build` alongside the jsdom workers timed out three unrelated
  suites.
- **Mount raw-body parsing on webhook routes before `express.json()`**, or signature verification
  fails. There is no global `express.json()`.
- **Email templates are TSX.** `@react-email/render` is async — await it.
- **Jobs run on pg-boss.** `startScheduler` throws if it will not start: a deployment whose
  retention sweep never runs keeps personal data past §25.8's window.
- **Env:** `backend/src/env.ts` is Zod-validated and fails closed on any live/test key or mode
  mismatch. `backend/tsconfig.json` sets `declaration: false` on purpose (TS2742 via Better Auth's
  bundled Zod); the backend is an application and nothing imports its `.d.ts`.

---

## Frontend rules

- **`proovd.css` only.** No Tailwind, no shadcn, no CSS-in-JS. Never write a hex literal — read a
  var or a mode slot. Never write an arbitrary spacing value — use `--sp-*`. `px` is legal only for
  borders, radii, and the 44px touch minimum.
- **Radix is headless.** Behaviour and ARIA only; styled with `proovd.css`; default `data-state`
  transitions disabled.
- **GSAP is the only motion runtime** (DNA §6). Never CSS transitions, never the Web Animations
  API, never another library — not as a fallback, not as a simplification. Never `import` gsap.
- **Motion in React** goes through `MotionProvider`. Subtrees rendering `data-*` motion attributes
  on changing content call `useProovdMotion(ref, deps)`; state-driven motion uses the imperative
  API; hand-written GSAP is wrapped in `useGsapScope`.
- **Fail loud, never silent.** If GSAP or Satoshi fails to load, `proovd-motion.js` logs a
  `[proovd]` console error and GSAP's failure also sets `html.no-motion`. The accent-yellow banner
  was removed on 2026-08-24 — see *Recorded deviations*. Never make either failure silent.
- **One question per moment, one hero, one delight** (DNA §5.1, §5.6, §5.8). Complexity is staged
  into Glance / Act / Explore, never deleted (§5.14).
- **Accessibility is an acceptance test**, not a polish pass: 320px, keyboard, focus order, 44px
  targets, screen reader (§33.11). 320px reflow, real focus visibility, tap targets, colour
  contrast, and an actual screen-reader pass stay **manual**.
- **New component styles extend `proovd.css` in a dated phase section at the bottom** — never a
  second stylesheet. Check the highest existing phase number first.

---

## Definition of done

A surface is complete only with all of §1.1: content and actions; loading, empty, waiting, success,
failure, expired, revoked, suspended, and retry states; server-side authorization; persistent
records and version history; state-transition and idempotency protection; transactional
notification and durable history; Admin visibility, ownership, due time, and recovery action; audit
event; mobile, keyboard, focus, label, contrast, and screen-reader behaviour; named acceptance
tests including negative and duplicate-event cases.

Every waiting, review, payment, recovery, or exception state answers the six questions (§27.1,
Brief §1.2): what happened, what next, who owns it, when's the next update, what can I do now, how
do I get help without losing context.

**A phase is not done until its named §33 tests pass.** These are requirements, not examples.

**This section describes phase work.** A small change is done when it does what was asked,
typechecks, and the one test file covering it passes. Re-verifying an untouched guarantee or
opening a browser pass for a copy fix is not thoroughness — it is a change the user waits for and
did not want.

---

## Working notes

- Stripe runs in **test mode**. Live mode is gated by §34. Never render test cards or test controls
  in production UI.
- The Stripe model is **direct charges on the Founder connected account**. The backup
  separate-charges path is not built; `STRIPE_TEST_BACKUP_MODE_ENABLED=false`. Never run both for
  one transaction.
- A Transfer creation failure is a **synchronous API error** and a retry-job case. There is no
  `transfer.failed` webhook to wait for (§32.3).
- **Before changing an area whose behaviour looks wrong**, check *Recorded deviations* above, then
  search `docs/build-log-archive.md` for the surface name, section number, or date. Several
  controls are absent on purpose and carry their reason where the control would be.
- If the phase you were given is too large for one session, **stop and say so.** A truncated session
  produces code that looks finished and isn't.
