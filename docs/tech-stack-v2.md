# Proovd MVP — Tech Stack v2.0

**Supersedes:** `tech-stack.md` (v1.0). That document was written against an earlier product definition and is no longer a valid input. Do not read it alongside this one.

**Status:** Subordinate reference document. It records *how* to build, never *what* to build.

---

## 0. Authority chain — read this before anything else

Three documents govern this project. When they disagree, resolve in this order:

1. **`Proovd-MVP-Engineering-Implementation-Spec-v1_0.md`** — controls product behavior, roles, data, surfaces, state transitions, payments, tax, operations, edge cases, and acceptance. Its §1.8 is explicit: on business behavior, state, money, consent, eligibility, data access, or timing, the Spec wins.
2. **`Proovd_DNA.md` + `proovd.css` + `proovd-motion.js`** — control visual treatment, interaction, motion, and content design. Where the Spec does not define visual treatment, DNA wins.
3. **This document** — controls implementation mechanics only: libraries, file layout, infrastructure, conventions. **It may never introduce a commercial rule, deadline, fee, eligibility condition, payout rule, campaign state, or consent.** Spec §1 rule 6 forbids this absolutely.

If this document appears to contradict either of the two above, this document is wrong. Fix it here, not there.

**Naming discipline is not optional.** Spec §3 is a binding contract. Internal schema, log, job, and table names use `reservation`, `captured_charge`, `listing_fee`, `platform_fee`, `founder_share`, `single_payment`, `first_payment`, `remaining_payment`, `affiliate_compensation`. Customer-facing surfaces use `Pre-order`, `Creator`, `Idea Campaign`, `Product Campaign`. Nothing may be named in a way implying escrow, custody, trust, or a Proovd bank hold — internal names leak into Admin panels, error messages, and support transcripts. `pledge`, `MBP`, `tranche`, `goal`, and `Day 30` do not exist in this codebase.

---

## 1. What changed from v1.0

### Killed — these rows were built on a dead spec

| v1.0 said | Why it's dead |
|---|---|
| Payments deferred; interfaces + `ManualProvider` only; collect money off-platform via Wise/PayPal | Spec line 9 keeps Stripe integration, payment behavior, tax treatment, connected-account behavior, and live-processing gates **in scope**. §24, §32, §34 are a full Connect + Stripe Tax contract. Payments are foundational, not a v2 swap. |
| Public campaign discovery (Day 8+) → v2 | Spec §18: Days 1–7 known-link-only, Day 8 discovery switch, with acceptance test 33.6.5. |
| Fraud/dedupe (IP, device, click velocity) → "interface in place, logic deferred" | Spec §4.1.1: practical unique-Backer deduplication **decides whether cards get charged** on every Idea Campaign. Not deferrable. |
| KYC ID upload → "collect via form, don't verify" | Spec §5.2, §11: Stripe-hosted onboarding is the KYC source of truth. Proovd must **not** reproduce provider-controlled banking or identity fields in a custom form. |
| Tailwind v4 as the styling layer | `proovd.css` is a complete token + slot + element-identity system. See §3 below. |
| "MBP zone", "two-tranche milestone", "Day 30 check", "pledge creation", "campaign goal-hit" | Vocabulary from a superseded spec. Banned by §3.2 and §33.11.3. |
| Founder onboarding described as "8+ fields with conditional logic" | Actual shape is Spec §9: a 5-step type-locking vetting flow with provenance tracking on every prefilled field, then §12's five optional items, then §14.4's campaign build. |

### Survived — still correct

Repo shape (npm workspaces), TypeScript both sides, Vitest + Testing Library + supertest, React 19 + Vite, React Router v7 data mode, TanStack Query, Zustand-only-when-needed, React Hook Form + Zod in `shared/`, Express 5, Postgres 16, Drizzle + drizzle-kit, Better Auth, Resend, Cloudflare R2, Hostinger VPS + Dokploy, Sentry, PostHog, pg-boss, sharp, express-rate-limit, helmet, Docker-as-process.

### Added

GSAP 3.15.0 vendored runtime, `proovd.css`, `proovd-motion.js`, Radix (headless only), Stripe + Stripe Tax, Cal.com, Tawk.to, a committed US federal holiday calendar, and an immutable audit layer.

---

## 2. The stack

| Layer | Pick | Notes |
|---|---|---|
| Repo shape | npm workspaces — `frontend/`, `backend/`, `shared/` | One Dockerfile at root |
| Language | TypeScript both sides | |
| Frontend framework | React 19 + Vite | SPA, served by Express |
| Routing | React Router v7 (data mode) | Loaders/actions + TanStack Query |
| **Styling** | **`proovd.css` (no Tailwind)** | See §3.1 |
| **Component primitives** | **Radix UI — headless only, all animation disabled** | See §3.2 |
| Icons | Lucide React | Colored via `--mode-icon` slot, never hex literals |
| **Motion** | **GSAP 3.15.0 (vendored) + `proovd-motion.js`** | See §3.3. Non-negotiable per DNA §6 |
| **Fonts** | **Satoshi, self-hosted woff2** | See §3.4 |
| State (server) | TanStack Query | |
| State (client) | Zustand, only where a flow genuinely needs it | Default is React Query + `useState` |
| Forms | React Hook Form + Zod (`shared/`) | |
| Backend framework | Express 5 | |
| Validation | Zod, shared FE/BE | |
| Database | Postgres 16 (Dokploy container) | Named volume; nightly `pg_dump` → R2 |
| ORM | Drizzle + drizzle-kit | |
| **Auth** | **Better Auth (3 roles) + custom token table (Backer)** | See §5 |
| **Payments** | **Stripe Connect — direct charges + Stripe Tax** | See §6 |
| Email | Resend + React Email | |
| File storage | Cloudflare R2 + presigned URLs (`@aws-sdk/client-s3`) | |
| Image processing | sharp (server-side thumbnails only) | |
| Background jobs | pg-boss | See §7 |
| **Scheduling / interviews** | **Cal.com Cloud, embedded + webhooks** | See §12 |
| **Live chat** | **Tawk.to** | Only rendered during staffed US business hours |
| Hosting | Hostinger VPS + Dokploy, single container | |
| Error tracking | Sentry | |
| Product analytics | PostHog Cloud | Supplementary — see §14 |
| Logs | pino → Dokploy viewer | |
| Uptime | UptimeRobot on `/healthz` | |
| Rate limiting | express-rate-limit | |
| Security headers | helmet | |
| Phone verification | **Not built** — collected and explicitly stored as unverified | Spec §5.2: no SMS OTP exists |

---

## 3. Frontend contract

This is the part most likely to be got wrong. Read all of it.

### 3.1 `proovd.css` owns appearance. Tailwind is not installed.

`proovd.css` is a finished system: raw palette → semantic slots (`--mode-title`, `--btn1-bg`, …) → section modes (`.mode-none`, `.mode-dark`, `.mode-light`, `.mode-drawer`) → components (`.btn`, `.input`, `.toggle`, `.option`, `.stepper`, `.tag`, `.card`, `.progress`, `.copylink`, `.sticker`, `.drawer`, `.modal`, `.menu`, `.accordion`, `.toast`, `.stat`).

The architecture is that **components read slots, and generators pick a mode, never a color.** `<button class="btn btn--primary">` is automatically correct inside any section mode. Tailwind utilities would bypass the slots entirely and reintroduce exactly the hex-literal and arbitrary-spacing drift that DNA §1 and §4.5 forbid.

Rules:

- No Tailwind, no shadcn, no CSS-in-JS.
- Never write a hex literal in a component. Read a var or a slot.
- Never write an arbitrary spacing value. Use `--sp-*`.
- Never write a `px` value except for borders, radii, and the 44px touch minimum. DNA §9: everything else is responsive.
- New components extend `proovd.css` in the same slot-reading style; they do not get their own stylesheets.
- Grey `#A2AFA8` borders belong to form inputs at rest and nothing else (DNA §1, §7.1).

### 3.2 Radix is headless only

Radix supplies behavior and accessibility — focus trapping, ARIA wiring, keyboard navigation, dismiss handling — for Dialog, Popover, DropdownMenu, Tabs, Tooltip, Accordion, Checkbox, Switch, RadioGroup.

Radix supplies **no visual styling and no animation**. Every Radix component is rendered with `asChild` where available and given `proovd.css` classes. Its default `data-state` CSS transitions are disabled; all motion is re-driven through GSAP per §3.3. DNA §6 forbids reimplementing Proovd motion in CSS transitions "not as a fallback, not as a simplification."

This matters for a11y: Spec §33.11.1 requires all principal flows to pass at 320px, on desktop, by keyboard, and under a screen reader. Hand-rolling dialogs and menus to that standard would cost more than the entire Radix integration.

### 3.3 GSAP + `proovd-motion.js` — and the React problem

**Vendoring (DNA §6.7).** Exactly this layout, exactly this order:

```
frontend/public/
├── vendor/gsap/
│   ├── gsap.min.js              ← always first
│   ├── ScrollTrigger.min.js
│   ├── Flip.min.js
│   ├── SplitText.min.js
│   ├── TextPlugin.min.js
│   └── ScrambleTextPlugin.min.js
├── proovd.css
├── proovd-motion.js             ← always last
└── fonts/
    ├── Satoshi-Variable.woff2
    └── Satoshi-VariableItalic.woff2
```

Loaded via `<script src>` tags in `index.html`, **not** `import`ed. `proovd-motion.js` is an IIFE that assigns `window.Proovd`; it is not an ES module and Vite must not process it. `frontend/public/` is copied verbatim into the Vite build, which is exactly the behavior needed.

No CDN. No bundler-managed `gsap` npm package — it would produce a second GSAP instance and break plugin registration. No model or human ever writes GSAP source by hand (DNA §6.7).

**One path fix:** the header comment in `proovd-motion.js` documents `vendor/gsap.min.js`; the actual vendor layout is `vendor/gsap/gsap.min.js`. Update the comment when the file lands so it doesn't mislead later.

**Verification:** `gsap-check.html` is the vendor smoke test. Serve it once after wiring the vendor folder and confirm every row reads OK before writing any animation code.

**The React integration problem.** `proovd-motion.js` exposes `init(root)`, which walks the DOM with `querySelectorAll` and binds listeners to the nodes it finds at that instant. React replaces DOM nodes on re-render, and those bindings die silently — no error, just a product that gradually stops animating. This is the single highest-risk item in the frontend.

The contract:

- A `<MotionProvider>` at the app root calls `window.Proovd.init()` once, and re-calls it scoped on route change.
- A `useProovdMotion(ref, deps)` hook calls `window.Proovd.init(ref.current)` in a `useLayoutEffect` whenever `deps` change, so any subtree that re-renders re-binds. Every surface with `data-reveal`, `data-hover`, `data-press`, `data-scroll`, `data-progress`, `data-count-to`, `data-grid`, `data-accordion`, `data-tabs`, or `data-splash` uses it.
- Anything driven by React state — number rolls, progress fills, button→progress→done morphs, toasts, page transitions, Flip morphs — uses the imperative API (`Proovd.numberRoll`, `Proovd.progress`, `Proovd.buttonProgress`, `Proovd.toast`, `Proovd.pageSlide`, `Proovd.curtain`, `Proovd.unroll`, `Proovd.morph`) from an effect or a ref callback, **not** declarative attributes.
- Wrap every GSAP call in `gsap.context()` scoped to the component, and `revert()` on unmount. Without this, React StrictMode's double-invoked effects will double-bind every animation in development.
- SplitText reverts are mandatory (DNA §6.4). Split spans left in the DOM break text selection, screen readers, and reflow — and would fail Spec §33.11.

**Fail-loud is a product requirement, not a dev convenience.** If GSAP is missing, `proovd-motion.js` sets `html.no-motion`, `proovd.css` provides jump-cut fallbacks, and an accent-yellow notice renders. Never suppress that notice in production. DNA §6.6: a quiet downgrade is how the brand erodes one deploy at a time.

### 3.4 Satoshi — self-hosted, not the Fontshare link

DNA §3 requires self-hosted `@font-face`, and `proovd.css` already declares it against `fonts/Satoshi-Variable.woff2`. This is also the faster option, not a tradeoff against it: a third-party font host costs an extra DNS lookup and TLS handshake on the critical path, and since browsers partitioned their HTTP caches by origin in 2020, there is no longer any cross-site caching benefit to a public font CDN. Self-hosted woff2 from the same origin as the HTML is strictly quicker.

Drop the two woff2 files into `frontend/public/fonts/`. `proovd-motion.js` already ships the runtime `document.fonts.check('16px Satoshi')` verification and the accent-yellow notice on failure.

### 3.5 Surface composition

`Proovd_DNA.md` is a design *system* and a UX *filter*. It contains zero screen specifications. Every surface in the Spec must therefore be composed from scratch by running DNA §5.11's one-shot recipe: write the moment's one question → inventory everything → sort into Glance / Act / Explore → name the loop → pick the hero → write the words → deal the flow → compose → run the checklist.

Two structural consequences:

- **The Founder campaign home (Spec §20) is already Glance/Act/Explore.** The Spec and DNA were written together here. Spec §20's ranked single Act item is DNA §5.2's "the product does the ranking."
- **The Admin panel is the one licensed exception.** Spec §26 explicitly permits dashboard density there. DNA §5.14 still applies: complexity is staged, never amputated.

### 3.6 The contrast exception

**Owner ruling, 2026-08-19: brand-green fill takes `#FAFAFA` text.** DNA §1 had stated as an absolute rule that a `#41ED98`-filled surface uses `#E9FFE1`; the ruling supersedes it and `--btn1-text` now reads `--white`. The exception is unchanged in kind and barely changed in degree:

| Pair | Ratio |
|---|---|
| `#FAFAFA` on `#41ED98` — **what ships now** | **1.46:1** |
| `#E9FFE1` on `#41ED98` — what shipped until 2026-08-19 | 1.44:1 |

WCAG AA requires 4.5:1 for body text and 3:1 for large text, so both fail and the ruling is a wash rather than a regression.

Per the authority chain, DNA controls visual treatment and the owner controls DNA, so this pair ships as ruled. But Spec §1.3 requires every exception to be recorded, and §33.11 makes accessibility a mandatory acceptance test. So:

- Record this as a named, dated, owner-attributed design exception in the audit trail before launch. The ruling is dated and attributed; the audit-trail record is still owed and is a Track A item.
- Mitigate where the system already allows it: brand-filled buttons are used at button scale (`--fs-btn`, 700+ weight), and the `.btn--secondary` border-only tier — `#41ED98` border and text on `#FAFAFA`, which measures far better — is available for any action where the primary tier isn't required.
- Keyboard focus rings, error text, and all body copy must independently pass AA.

**What the exception covers, stated accurately.** It used to end "the one button pair, nothing else", and that had not been true since 2026-08-18: campaign-page-v2 shipped five non-button brand fills carrying text at the same ratio — the avatar initial, the illustrated demo control, the active demo moment, the check benefit card, and the selected reward badge. They were the same exception, unrecorded. The exception is **brand fill**, wherever it appears, and it is a slot (`--btn1-text`) plus those five scoped rules. It does not license a low-contrast pair anywhere else.

Two pairings people reach for here are **not** in the exception and must not be moved into it: `.mode-dark`'s primary is `#013F17` on a `#FAFAFA` fill (11.7:1) and `.mode-light`'s is `#FAFAFA` on `#013F17` (11.7:1). Both are white-or-dark fills rather than brand ones, and both are already good.

Claude Code will "helpfully" substitute a darker text color here unless told not to. Tell it not to.

---

## 4. Backend contract

### 4.1 Money is integers

All monetary values are stored as integer cents in `bigint` columns. No floats, no `NUMERIC` arithmetic in application code, no currency parsing from strings. Every amount carries an explicit currency column even though the MVP is USD-only (Spec §2.2).

Spec §24.3's waterfall is stored as **separate persisted columns**, not derived on read:

```
reward_subtotal_cents
sales_tax_cents
total_captured_cents
proovd_fee_cents                    -- 5% of reward_subtotal, tax excluded
affiliate_provisional_cents         -- liability account, never Proovd revenue
affiliate_earned_cents
affiliate_unearned_returned_cents
founder_gross_share_cents
stripe_fee_cents
founder_net_cents
```

Sales tax is excluded from the Proovd 5%, all Creator percentages, the Idea threshold, and the $50,000 cap (Spec §24.3). Encode that exclusion once, in a shared calculation module in `shared/`, and let both the checkout preview and the close batch call it. Two implementations will drift.

### 4.2 State machines are explicit and separate

Spec §23.1 vs §23.3 is a schema instruction: **campaign lifecycle status must never carry payment flags.**

- `campaigns.status` — one enum, lifecycle only (`invited_draft` … `closed_resolved`).
- `campaigns.affiliate_roster_status` — `forming` / `launch_ready` / `failed`.
- `campaigns.campaign_build_status` — `not_started` / `in_progress` / `complete`.
- `review_ready` — derived, never stored as a source of truth.
- Payment/reconciliation flags — independent boolean+timestamp+amount+actor+evidence rows, not enum values.
- `campaign_affiliate_associations.status` — its own enum (19 states, Spec §23.4).
- `reservations.status` — its own enum (11 states, Spec §23.5).

Every transition writes an append-only history row. Spec §23.5: illegal reversals must be impossible, and a successful SetupIntent stays historical even after the reservation is canceled.

### 4.3 Idempotency is a first-class table, not a hope

Three separate mechanisms, all required:

1. **`provider_events`** — unique on Stripe `event.id`. Webhook handlers insert-or-skip before doing any domain work. A duplicate event may update the audit trail but may never duplicate domain state, money, or a notification (Spec §28.3).
2. **`idempotency_keys`** — stable domain-level keys for close-batch attempts, capture retries, fixed-payment funding, Transfers, and refunds. Spec §33.7.7: running the close batch twice, receiving duplicate webhooks, or crashing and restarting mid-batch must produce no double charge, no double earnings, and no double email.
3. **`notification_deliveries`** — unique on (event type, target, entity), so retries can't send a second email. Spec §27.2 and §33.9.12.

### 4.4 Audit is immutable

One `admin_audit_events` table, insert-only. Revoke UPDATE and DELETE from the application role at the database level. Every row carries actor, MFA/reauth context, target type and ID, action, time, internal reason and customer-facing explanation **as separate columns**, prior and new value, amount and currency, provider object IDs, evidence links, and related notification IDs (Spec §25.6).

### 4.5 Time

All timestamps `timestamptz`, stored UTC, rendered in viewer local with UTC secondary (Spec §27.1). The three anchors — `listing_paid_at`, `campaign_live_at`, `campaign_close_at` — are dedicated columns and are **never** inferred from `created_at` or `updated_at` (Spec §21).

**US business-day calendar:** a committed, versioned JSON table of US federal holidays lives in `shared/src/calendar/us-federal-holidays.<version>.json`. When a business-day deadline is computed, the calendar version string is stored on the record alongside the resulting timestamp. Spec §29.6: the Creator replacement deadline is calculated once and retries or edits can never silently reset it. Do not use a library that fetches holidays at runtime.

### 4.6 Tokens

Founder invitation drafts and Backer magic links share one implementation shape (Spec §28.1):

- ≥128 bits of entropy from `crypto.randomBytes`.
- Raw value exists only in the delivered URL. Never logged, never stored, never in an error message.
- Store one-way hash, version, issued/last-used/revoked timestamps, revocation reason, and lineage.
- Constant-time comparison.
- Rate-limited verification and resend.
- Non-enumerating errors — an invalid, expired, or revoked link must never reveal whether an account exists (Spec §5.5).
- Rotation on resend revokes all prior versions immediately.
- Scoped to exactly one draft, or one Backer + one campaign.

---

## 5. Auth model — four actors, two mechanisms

This is not four login types.

| Actor | Mechanism | Library |
|---|---|---|
| **Admin** | Email + password, short session freshness window for money/refund/connected-account/kill actions. **No second factor** — the TOTP layer was removed on 2026-08-10 by product direction; see `backend/src/auth/auth.ts`. Spec §5.1/§28.2 still require MFA, so this is a recorded deviation, and the freshness window is now the only control on a high-impact action | Better Auth |
| **Founder** | Email + password **or** Google OAuth. Private invitation establishes invited-email ownership | Better Auth |
| **Affiliate** | Email + password, claimed only through a private campaign-specific invitation. No public signup route exists | Better Auth |
| **Backer** | **No account.** Long-lived, campaign-scoped magic link | **Custom token table — not Better Auth** |

**Do not use Better Auth's magic-link plugin for Backers.** It creates user accounts and sessions. Spec §5.4 is explicit that Backers are guest-only with no password account, and §28.1 requires campaign-scoped token identity with hash-only storage and version lineage. Build the token table per §4.6 above.

Magic links stay valid through fulfillment or final resolution plus 180 days unless revoked or reissued (Spec §19). Founder or Affiliate payment events never expire Backer access.

Better Auth's role support covers the three authenticated actors. All Admins have full functional access in the MVP; hierarchy is deferred (Spec §5.1).

---

## 6. Payments — Stripe Connect

**Architecture, locked (Spec §24.1 preferred model):** direct charges on the Founder's connected account. Founder is merchant of record on every campaign transaction. Proovd's 5% and the provisional Creator liability ride in the platform-side application fee. The Founder connected account bears Stripe processing fees, separately visible in reconciliation (§24.5).

The separate-charges + `on_behalf_of` backup path is **not built**, and `STRIPE_TEST_BACKUP_MODE_ENABLED=false`. The ledger, milestone, disclosure, and customer-copy rules are identical either way, so a later switch is a payment-layer change, not a domain rewrite. §24.1 forbids running both paths for one transaction or claiming an unapproved path is live.

**Separate money streams, never commingled in the schema:**

1. **Campaign charges** — Connect, Founder as MoR, SetupIntent → off-session PaymentIntent.
2. **Listing fee** — direct Stripe Checkout on the Proovd platform account, Proovd as MoR, descriptor `PROOVD LISTING` (§24.6).
3. **Fixed Creator payment** — its own allocation, funding, return, and Transfer records. No percentage applies to it. It never touches Backer totals, the 5%, the tax base, the threshold, or the cap (§24.7).

**Stripe Tax** is enabled. Tax is calculated at reservation time and the calculation object is stored with its ID, jurisdiction, rate, taxability reason, and `expires_at`. At capture, the stored calculation is re-validated for usability; if it is unusable, no PaymentIntent is created, the reservation becomes `capture_failed_dropped` with reason `tax_calculation_unusable`, and **no substitute amount is ever charged** (Spec §19, §21).

**Webhooks:** two endpoints, platform and Connect, with separate signing secrets. Signature verification before any parsing. Mount raw-body parsing on the webhook routes *before* `express.json()` — the classic Express failure here is a global JSON parser destroying the raw body Stripe needs to verify the signature. Handle the event sets listed in Spec §32.3. Note §32.3's trap: a Transfer creation failure is a synchronous API error and a retry-job case; there is no `transfer.failed` webhook to wait for.

**Test/live separation fails closed.** Environment refuses a live/test key mismatch, a live connected account in test mode, a test account in live mode, or a webhook secret/mode mismatch (Spec §6). No test cards or test controls ever render in production UI.

**Deferred by your decision:** which Stripe account type Founders use, whether Connect is approved, and whether the Affiliate recipient/Transfer capability is enabled. Build against test mode with `STRIPE_TEST_FOUNDER_CONNECTED_ACCOUNT_ID` and `STRIPE_TEST_AFFILIATE_CONNECTED_ACCOUNT_ID`. Spec §34's live-mode gate stays closed until those answers exist — which is fine, because §34 explicitly permits onboarding, drafting, review, recruitment, and test-mode engineering to proceed while it's blocked.

---

## 7. Background jobs — pg-boss

pg-boss now carries jobs where a double-run means a double charge. Every handler is idempotent per §4.3 above, and no job may be the only guard against duplication.

| Job | Trigger | Spec |
|---|---|---|
| Close batch — lock reservations, resolve duplicates, fix Idea threshold, create off-session PaymentIntents | exact `campaign_close_at` | §21 |
| Capture retry sweep | 48h window from first close-batch failure | §21 |
| Retry-window close + reconciliation start | window expiry | §21 |
| 72-hour Affiliate response deadline | `listing_paid_at` + 72h | §14.6 |
| 48-hour Founder free-cancellation window | `listing_paid_at` + 48h | §31.6 |
| Pre-charge reminder | ~24h before trigger; if created <24h before, send promptly and suppress the duplicate | §20 |
| Creator replacement deadline | 3 US business days from `creator_failure_recorded_at`, non-resettable | §29.6 |
| Day 3 / Day 14 payment and review windows | anchored to `campaign_close_at` | §22 |
| Unclaimed draft deletion / anonymization | 30 days from most recent send | §7 |
| Magic-link retention expiry | resolution + 180 days | §25.8 |
| Tax calculation expiry watch | pre-close risk surface | §31.7 |
| Support SLA due / overdue badges | one business day, Mon–Fri excl. US federal holidays | §27.8 |
| Nightly `pg_dump` → R2 | cron | — |

The close-batch endpoint and any HTTP-triggered job are protected by `CRON_SECRET` (Spec §32.2).

**No generic engagement jobs.** Spec §20 forbids scheduled Day 3/7/10 "check your campaign" emails, and §33.6.11 tests for their absence. Notify only for real actions or consequences.

---

## 8. Email — Resend + React Email

Transactional only, not opt-out-able (Spec §27.2). Specific subject naming the campaign/product, at most one primary action, a plain-text support route, and a stable campaign/reservation/case reference in every message. Money emails carry amount, seller/MoR, expected descriptor, and pending/completed status.

Deduplication is enforced at the `notification_deliveries` table, not by the mail provider.

Spec §27.3–27.6 enumerate roughly 70 distinct transactional events across Founder, Affiliate, Backer, and internal. Build them as a typed registry in `shared/` keyed by event name, so the acceptance suite can assert coverage rather than grep templates.

Watch the Resend free tier: 3,000/month and 100/day. A single pilot campaign close with a few hundred Backers will generate a pre-charge reminder plus a receipt or failure notice plus recovery messages, and can clear 100/day easily. Confirm the plan before the first live close.

---

## 9. Storage — Cloudflare R2

Presigned PUT from the browser; no file touches the VPS disk. `sharp` runs server-side only, for thumbnails of avatars and Founder logos.

Holds: Founder campaign visuals and brand assets, Creator proof-of-post evidence, dispute evidence packets, Day 14 progress evidence, W-9 uploads, and nightly database dumps.

W-9s and dispute packets are sensitive. Keep them in a separate bucket or prefix with its own lifecycle policy, and never issue a long-lived presigned URL for them.

---

## 10. Domains and route ownership

`proovd.co` — existing landing page repository, already deployed. Marketing surface only.

`app.proovd.co` — this repository. **Owns every route in Spec §18's public inventory**, including the ones that read like marketing:

```
/                      /about              /how-payments-work
/safety                /terms              /privacy
/cookies               /refunds            /fulfillment
/aup                   /affiliate-aup      /ip-agreement
/campaign/sample-pre-build                 /campaign/sample-pre-launch
/campaign/:slug        (every approved live campaign)
```

**Why the app owns them, not the landing repo:** Spec §18's attribution contract requires a first-party cookie set on Creator link arrival, expiring at `campaign_close_at`, read at pre-order. If the campaign page and the checkout live on different hosts, that cookie is cross-site — third-party cookie restrictions in Safari and Chrome will break attribution, and Creator commission is calculated from it. Backer magic links are campaign-scoped to the same origin. Keep campaign pages, checkout, policy routes, and the magic-link surface on one origin.

The landing repo may keep its own marketing `/` and `/about`. If both exist, `proovd.co` is the marketing home and `app.proovd.co/` is the platform home required by Spec §18's homepage trust content. Decide the canonical redirect and record it once.

**Policy routes must contain the complete canonical approved policy** — no placeholder, no "coming soon", no summary-only (Spec §18, §31.4). Ship them as static routes rendering versioned content from the repo, with the version string stored on every consent record.

---

## 11. Repo layout

```
proovd-app/
├── Dockerfile                     # multi-stage: build FE, build BE, runtime
├── package.json                   # npm workspaces root
├── tsconfig.base.json
├── vitest.config.ts
├── .env.example
│
├── frontend/
│   ├── index.html                 # vendor <script> tags, in DNA §6.7 order
│   ├── vite.config.ts
│   ├── public/
│   │   ├── vendor/gsap/*.min.js
│   │   ├── proovd.css
│   │   ├── proovd-motion.js
│   │   ├── fonts/Satoshi-*.woff2
│   │   └── gsap-check.html        # vendor smoke test; excluded from prod build
│   └── src/
│       ├── main.tsx
│       ├── router.tsx
│       ├── motion/                # MotionProvider, useProovdMotion, gsap.context helpers
│       ├── components/            # proovd.css-classed wrappers over Radix
│       ├── features/
│       │   ├── admin/  founder/  affiliate/  backer/  public/
│       └── lib/                   # api client, query setup, posthog
│
├── backend/
│   ├── drizzle.config.ts
│   ├── public/                    # FE build lands here in Docker
│   └── src/
│       ├── index.ts
│       ├── env.ts                 # zod-validated, fails closed on mode mismatch
│       ├── db/
│       │   ├── schema/            # campaigns, reservations, associations, ledger, audit, tokens
│       │   └── migrations/
│       ├── auth/                  # better-auth config + custom Backer token service
│       ├── routes/
│       ├── payments/              # stripe client, webhooks, ledger, tax, idempotency
│       ├── jobs/                  # pg-boss worker + the §7 job definitions
│       ├── notifications/         # typed event registry + delivery dedup
│       ├── storage/               # r2 presigning
│       └── lib/                   # pino logger, errors, middleware, audit writer
│
└── shared/
    └── src/
        ├── schemas/               # zod — used by FE and BE
        ├── money/                 # the §24.3 waterfall, one implementation
        ├── states/                # campaign / association / reservation state machines
        ├── calendar/              # versioned US federal holidays
        └── types/
```

---

## 12. Third-party services decided this round

**Interviews — Cal.com Cloud, embedded.** Spec §12 requires in-product booking with times in the Founder's timezone, Google Meet / Zoom / Teams, canonical UTC value, meeting provider and link, named interviewer, status, reschedule history, and cancellation — plus confirmation, reminder, reschedule, and cancellation notifications, and a recalculation of both high-effort status and the listing fee if the interview is canceled before payment.

Cal.com generates the conferencing links, handles reschedule and cancel, and fires webhooks. Chosen over Calendly because reschedule/cancel webhooks and the reschedule history the Spec requires sit behind Calendly's paid tiers, and over a hand-built scheduler because conferencing-link generation across three providers is not a two-week problem.

**The booking record in our database is the source of truth**, populated from Cal.com webhooks. `interview_confirmed` is a domain state that gates a $2 listing-fee discount and one third of the high-effort classification — it cannot live in a vendor's system. A selected-but-unconfirmed, canceled, or abandoned slot does not count (Spec §12).

Self-hosted Cal.com on Dokploy is the fallback if data residency becomes a requirement. Don't start there.

**Live chat — Tawk.to.** Rendered only during staffed US business hours. Spec §31.4: never promise unstaffed chat. The one-business-day email SLA in §27.8 is the actual commitment; chat is supplementary and must not appear to override it.

---

## 13. Testing — the acceptance suite is the test plan

Spec §33 contains roughly 130 named acceptance tests across twelve groups. §33's own framing: *these are requirements, not examples*, and each must pass at server, domain-state, customer-surface, notification, Admin, and audit levels where applicable.

Do not invent a separate test plan. Map §33 directly:

| Layer | Tool | Covers |
|---|---|---|
| Domain unit | Vitest | §33.3 fee combinations, §33.2.7 six compensation-matrix cells, §33.8.1 tax exclusions, the money waterfall, state-machine legality, business-day math |
| API integration | supertest + a real Postgres test container | §33.1 tokens, §33.5 eligibility/cap/tax, §33.7 close/retry/idempotency, §33.9 refund/dispute |
| Stripe | Stripe test clocks + the §32.5 required card outcomes | success, generic decline, insufficient funds, 3DS required, expired card, bad CVC, processing error, full and partial refund, dispute |
| Component | Testing Library | Consent surfaces, checkout, cancellation, card recovery — the flows where wrong copy is a compliance failure |
| E2E | Playwright | One full lifecycle: invite → vetting → claim → listing payment → Creator acceptance → build → review → launch → pre-order → close → capture → payout |
| A11y | axe-core in Playwright, plus manual keyboard and screen-reader passes | §33.11 at 320px, desktop, keyboard, screen reader |

Three tests deserve dedicated engineering time because they cannot be retrofitted:

- **§33.7.7** — close batch run twice, duplicate webhooks, crash and restart: no double charge, earnings, or email.
- **§33.5.10** — concurrent requests near $50,000 cannot exceed the pre-tax cap. This is a database-level atomic check, not an application read-then-write.
- **§33.2.9/10** — proposal versioning prevents stale and double acceptance; only the exact bilaterally accepted version locks.

---

## 14. Observability and measurement

Sentry for errors with source maps uploaded at build. pino → Dokploy log viewer. UptimeRobot on `/healthz` from day one.

**PostHog is supplementary, not the measurement system.** Spec §31.9 is explicit: use existing domain events and do not build a general analytics warehouse. The four-number Founder scoreboard — time to first magic, Founder completion, return after closure, next-action correction rate — is computed from domain events in Postgres, with an explicitly labeled `not measured` baseline until the first 10 invited Founders. PostHog covers session recordings and funnel exploration on top of that; it never becomes the source of a reported number.

Spec §31.9's closing rule is a product constraint, not an analytics one: do not improve metrics by hiding cancellation or support, prechecking consent, or redefining failures.

---

## 15. Security baseline

- helmet, express-rate-limit, CSRF protection on state-changing routes.
- Recent-reauthentication gate on money, refund, connected-account, and kill/suspend actions, failing safely when stale (Spec §33.12.5). Admin MFA is NOT in force: removed 2026-08-10 by product direction, against §5.1/§28.2 — recorded rather than silently dropped.
- Raw card data never reaches Proovd servers — Stripe-controlled fields only.
- Secrets in the Dokploy environment or a secrets manager. Never in the repository, the frontend bundle, email, or documentation.
- No sensitive value in logs, client bundles, screenshots, or error messages.
- Raw tokens never at rest (§4.6).
- Immutable audit with UPDATE/DELETE revoked at the database role (§4.4).
- Affiliates receive no Backer PII, ever — enforce at the query layer, not the serializer (Spec §25.7, §33.5.6).

---

## 16. Deployment

One Docker container running Express on port 3000, serving `/api/*` then falling back to the built SPA. Postgres in a sibling Dokploy container with a named volume. R2 external. Dokploy handles TLS for `app.proovd.co`.

Stripe webhooks need a stable public HTTPS endpoint — confirm Dokploy's ingress exposes it before wiring Connect. Local development uses the Stripe CLI for webhook forwarding, with the CLI signing secret in local environment configuration only (Spec §32.2).

---

## 17. Environment contract

Per Spec §32.2, extended with this stack's additions. Fails closed on any mode or context mismatch.

```
NODE_ENV=
APP_BASE_URL=https://app.proovd.co
DATABASE_URL=

STRIPE_MODE=test
STRIPE_API_VERSION=[LOCKED VERSION]
STRIPE_PLATFORM_ACCOUNT_ID=acct_...
STRIPE_PLATFORM_SECRET_KEY=sk_test_...
STRIPE_PLATFORM_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET_PLATFORM=whsec_...
STRIPE_WEBHOOK_SECRET_CONNECT=whsec_...
STRIPE_CONNECT_RETURN_URL=https://app.proovd.co/stripe/return
STRIPE_CONNECT_REFRESH_URL=https://app.proovd.co/stripe/refresh
STRIPE_TEST_FOUNDER_CONNECTED_ACCOUNT_ID=acct_...
STRIPE_TEST_AFFILIATE_CONNECTED_ACCOUNT_ID=acct_...
STRIPE_TEST_BACKUP_MODE_ENABLED=false
STRIPE_TAX_ENABLED=true

BETTER_AUTH_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

RESEND_API_KEY=
EMAIL_FROM=

R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
R2_BUCKET_SENSITIVE=

CALCOM_API_KEY=
CALCOM_WEBHOOK_SECRET=

TAWK_PROPERTY_ID=
SENTRY_DSN=
POSTHOG_KEY=

CRON_SECRET=
US_HOLIDAY_CALENDAR_VERSION=
```

---

## 18. Not in the MVP — corrected list

Spec §30 governs. These are deferred by the Spec itself, not by this document:

AI pitch rewriting or refinement. Automated Founder scoring. Algorithmic general-pool Affiliate matching. Founder browsing or outreach to unmatched Affiliates. Full teaser mode. A reusable Affiliate course or resource library — the single Campaign kit is required instead. A Founder–Creator meeting scheduler — only the human Founder interview scheduler is required. Direct Founder–Affiliate messaging. Real-time sockets or dashboards. Backer password accounts or profiles. A full in-product dispute center. Fully automated milestone or payout decisions. A custom tax-filing product. A hosted Founder community. Non-US roles. W-8BEN workflows. Physical or mixed rewards. Enterprise procurement. A native mobile app. Automatic Affiliate percentile pruning. Public Founder ratings. Advanced analytics or animations beyond the DNA kit. A push-notification matrix. Product tours or splash education. Recurring Creator management beyond the work-again request.

Spec §30 also lists patterns that are **forbidden**, not merely deferred: confetti or countdown pressure that confuses a saved card with a charge, fake scarcity or fabricated popularity, AI support presented as human, public leaderboards, prechecked optional consent, live chat without staffing, real-time claims for refresh-based data, automatic review presented as human safety, generic errors without money/data status and recovery, and multiple competing actions in payment, cancel, refund, or card-recovery states. DNA §5.10 says the same thing in its own words.

---

## 19. Open before live

Not blockers for building. All are blockers for Spec §34's live-mode gate.

1. **Stripe account facts** — connected account type for Founders, Connect approval status, Affiliate recipient/Transfer capability, Stripe Tax registrations and product tax codes. Deferred by decision; build in test mode. §2.1 forbids any UI claiming approval before it exists.
2. **Satoshi woff2 files** → `frontend/public/fonts/`.
3. **The eight canonical policy documents** — Terms, Privacy, Cookies, Refunds, Fulfillment, Founder AUP, Affiliate AUP, IP/confidentiality agreement. Confirmed available; supplied before launch. §18 and §31.4 require complete, non-placeholder text, and §34 gates live mode on it.
4. **The contrast exception record** (§3.6 above).
5. **Founder seller tax readiness** — head-office location, product tax code, registration, active provider tax settings (§31.7).
6. **Named monitoring and rollback owners** for the one pilot campaign (§34).

---

## Appendix — confirmed facts

- Proovd LLC, Delaware. 254 Chapman Rd, Ste 208 #27541, Newark, DE 19702, USA. `support@proovd.co`. Support SLA one business day, Mon–Fri excluding US federal holidays.
- Founder is merchant of record for every campaign transaction. Proovd is MoR only for the listing fee.
- Listing fee: $35 base, $2 per completed optional item, $10 maximum discount, $25 minimum. Platform fee 5% of captured pre-tax reward subtotal.
- Campaign cap: $50,000 aggregate pre-tax active pre-order value, checked atomically.
- US-only, 18+, USD, digital rewards only.
- GSAP 3.15.0, vendored at `vendor/gsap/`.
