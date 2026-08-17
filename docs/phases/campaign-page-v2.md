# Campaign Page v2 — the public campaign page rebuilt (post-Phase-24 change)

**This is not a numbered phase.** `docs/master-plan.md` §6's table ends at 24, and §1.1 says a
phase file may never introduce a rule. This brief introduces none: it cites the Spec where the
Spec speaks and, where it does not, it says so in the open rather than manufacturing a citation.
It is the same kind of document the Founders, Creators, Support, Campaigns, Backers, and Tasks
surfaces were built from — a supplied reference plus the decisions that reference cannot make for
itself.

**Model:** Opus 5. Not because the page is large, but because the reference and the Spec disagree
in seven places, and six of those disagreements are invisible to a reader who only sees the
reference. Getting one of them wrong ships a page that is either illegal or fails the acceptance
suite.

**Goal:** The public campaign page becomes the designed page in the reference — hero, interactive
demo, benefits, story, threshold panel, selectable rewards, updates, FAQ — while exposing every
one of §18's fourteen mandatory items, and a Founder can author every piece of it.

**Reference bundle:** `docs/design-refrence/Proovd-Campaign-Page-v2.html`. A standalone single-file
build: a ~310-line stylesheet (`:12-322`), a body of seven sections plus a footer, a mobile dock
and a checkout modal (`:326-452`), and one ~130-line script (`:503-628`) driving a three-state
product demo, reward selection, two expanders, an FAQ accordion, and a two-step checkout. GSAP,
ScrollTrigger and SplitText are inlined into it — all three are already vendored in this repo.

**Walk it, do not only read it.** Open the file in a browser at 1280 and at 320 before writing
anything. Several of its decisions — the demo's auto-advance cadence, the way the story expander
uses `grid-template-rows: 0fr → 1fr`, the mobile dock's safe-area padding — are behaviours, not
markup.

---

## Read first

Read these before writing anything. Do not work from this brief's paraphrase of them.

- **Spec §18**, the whole section — discovery and attribution timing, the attribution contract,
  the public route inventory, **the fourteen-item campaign page content order**, the Founder/MoR
  disclosure and its expanded explanation, the campaign-type difference table, and the sample
  campaign rules. This is the section the page is graded against.
- **Spec §14.4** — the build ingredients, both the shared list and the two type-specific ones,
  and the seven facts every reward package carries.
- **Spec §19** and **Appendix A.2, A.3, A.4, A.6** — the pre-order flow and the exact-text blocks.
- **Spec §20's three live-editing tiers.** Every new authorable field needs a tier.
- **Spec §3.1 and §3.2**, including §3.2's last paragraph about identifiers.
- **Spec §27.1's six questions** and **§27.2's** transactional rules.
- **Spec §30**, both halves.
- **Spec §25.6** (audit), **§25.8** (retention), **§28.4** (no bundled consent), **§28.5**
  (accessibility baseline).
- **Spec §33.6.1–5** (the §18 acceptance already passing — do not break it), **§33.11** all seven,
  **§33.12.5**.
- **DNA §5.1, §5.2, §5.6, §5.8, §5.10, §5.12, §5.13, §5.14**, and **§6** (motion).
- `frontend/public/proovd.css` — the file header and `:root` (`:51-134`). You are adding to it.
- `CLAUDE.md`, the six post-Phase-24 workspace sections. They are the house style for a build
  like this one.

---

## Prerequisites

All of Phases 00–24 and the six Admin surfaces built after them. Nothing here depends on work
that has not landed.

---

## The honest position on §1 rule 6

**§18 defines the page's content, not its design.** Its own words: "Every campaign page exposes
all of the following; **the DNA UX document controls presentation**." So a redesign is licensed —
what is not licensed is dropping an item, and the reference drops four.

**Three things in this brief are genuinely new capability**, and each is named rather than
smuggled in under a citation:

1. **The interactive demo stage** and **the benefit cards**. §14.4 lists thirteen shared build
   ingredients and neither is among them. They are *presentation of the Founder's own product*,
   in the same class as "Hero preference" and "Product visuals and brand assets", which §14.4 does
   name. They carry no commercial rule: no price, no date, no threshold, no eligibility. Both are
   optional; a campaign with no rows renders no section.
2. **The follow record** — an email captured against a campaign by someone who has not
   pre-ordered. This IS a new commercial capability and a new notification audience, and §1 rule 6
   would forbid it. **It is built by explicit product direction**, and is recorded as a deviation
   in `CLAUDE.md` exactly as the 2026-08-10 Admin-MFA removal and the account-level Creator
   suspend/restore are. See scope 11.
3. **Section headings as authorable copy** (`Built to disappear.`, `Choose your access.`). A
   heading is presentation, not a commercial rule. Defaults are supplied and are not invented
   promises — the product already does this with `Untitled campaign` and `The story`.

Everything else in this brief is a re-presentation of data that already exists.

---

## What the reference draws, and where each piece comes from

Walk this table against the file. `NEW` means no column holds it today.

| Reference | §18 item | Source |
|---|---|---|
| `.site-nav` — brand, `Why it works`, `Access`, `Reserve` | — | new chrome |
| `.hero h1` "Drink on time. / **Without thinking.**" | — | `NEW` `hero_headline` + `hero_headline_accent` |
| `.hero-copy > p` "Tidemark nudges you only when it helps." | — | `NEW` `hero_subheadline` (today `tagline` is `brandPerception`, a stand-in) |
| `Reserve for $9` | 9 | lowest reward `priceCents` |
| `$0 today` | 9 | pinned fact |
| `247 people reserved`, avatar stack | — | `readPreorderCounts().uniqueActiveBackers` |
| `.demo-stage` — wordmark, `Today`, 3 moments | — | `NEW` `campaign_demo_moments`, `demo_context_label` |
| `.benefits` — heading + 3 cards | — | `NEW` `campaign_benefit_cards`, `benefits_heading` |
| `.story-compact` — monogram, name, pull quote, expander | 10, part of 2 | initials derived; `NEW` `founder_pull_quote`; existing `publicStory` |
| `.campaign-panel` — `247 of 500`, `253 more`, bar | 6 | `orderThreshold` + `uniqueActiveBackers` |
| `.rule-steps` — Reserve → Reach 500 → Pay once | 4 | derived from `model` + threshold + `closesAt` |
| `Cancel before August 15` | 5 | derived from `closesAt` |
| `.rewards` — badge, price, contents, eta, `88 left` | 3 | existing + `NEW` `badge`; `limitedQuantity` (stop dropping it) − `countActiveForReward` |
| `.build` — heading, latest update with `86%`, archive | 12 | `campaign_updates` + `NEW` `metric_label`/`metric_value`, `updates_heading` |
| `Follow build` | — | `NEW` follow record (scope 11) |
| `.faq-clean` | 11 | existing `campaign_faqs` + `NEW` `faq_heading` |
| `footer` — `Tidemark · iOS + Android` | 14 | `title` + `NEW` `platform_line` |
| `.mobile-dock` | 9 | selected reward |
| checkout modal | 9 | the existing §19 `CheckoutDrawer`, restyled |

**Four §18 items the reference does not draw at all**, and where they go:

| Missing | Item | Placement |
|---|---|---|
| Founder legal name, entity, country, profile | 2 | the new `.seller` band (only the display name and monogram appear in `.story-compact`) |
| Refund summary, `/refunds`, `/fulfillment`, the Founder policy | 7 | the new `.seller` band |
| The always-visible MoR line + the A.2 expansion | 8 | the new `.seller` band — **above the pre-order action**, which §18 requires literally |
| Comments | 13 | a band above the footer |

---

## The seven places the reference and the Spec disagree

§1.8: the Spec wins on all of it. Each of these is a decision, made here, in the open.

### 1. `PRIVATE BETA GOAL`

§3.2 bans `goal` for an Idea threshold, and its last paragraph binds **identifiers** — table,
column, job, and log names. §33.11.3's bundle scan reads the *built bundle*, so a prop named
`goal` survives minification and fails it. The Campaigns hub hit this exact scan with
`progress.goal` on its first draft.

The eyebrow reads `ORDER THRESHOLD`. Nothing anywhere — CSS class, prop, register value, test
fixture — may contain the word.

### 2. `Continue` and `Back` in the checkout

Both are in `OBJECTLESS_CTA_LABELS` (`shared/src/qa/index.ts:225`), so §33.11.4 fails on them.
The existing drawer already has correct labels. Keep `Calculate total` and `Authorize pre-order`;
the back control is `Back to your details`.

### 3. No Founder/MoR disclosure anywhere

§18 is literal: the disclosure is **above the pre-order action**, always visible, with an
expandable explanation preserving seven specific facts. `expandedMorBlock()`
(`features/public/campaign/consent.ts:221`) already renders Appendix A.2 verbatim and is
compared by test. Render it unchanged inside the new `.seller` band, and place that band
immediately before `.rewards` — the last thing a reader passes before the reward CTAs.

The hero CTA and the footer CTA both *scroll to rewards* in the reference; they do not open
checkout. Keep that. The mobile dock does open checkout, and the checkout itself carries the
full A.3/A.4 consent naming the seller — so the requirement holds there too.

### 4. Brand fills use `--white` text

`proovd.css:158` records a hard rule: brand fill → `#E9FFE1`. Tech-stack §3.6's contrast
exception is scoped to brand-fill *buttons*. Use `--mint` on every brand fill — the moment
buttons, the selected reward badge, the selector square, the FAQ plus icon, the done icon, the
demo log button, the second avatar. `#E9FFE1` against `#FAFAFA` is imperceptible.

### 5. The demo auto-advances every 2.6s, forever

WCAG 2.2.2. Keep the auto-advance; honour `prefers-reduced-motion` (the reference already does);
and **stop it permanently the first time a person interacts with a moment button**. The three
buttons are already the stop mechanism and are keyboard-reachable — no new control is added.

### 6. `.streak-card`, and variants named after one campaign's copy

§30 lists streaks among forbidden mechanics. More practically, a variant named for Tidemark's
copy is unusable by the next Founder. The three visual treatments are named by **shape**:

| Reference class | Register value | What it draws |
|---|---|---|
| `.timing-card` | `bars` | four stacked bars, the third filled |
| `.tap-card` | `check` | a circle with a check |
| `.streak-card` | `dots` | seven dots, one outlined |

The card's own accent colour travels with the variant (`--accent-blue` / `--brand` /
`--accent-yellow`), exactly as the reference has it.

### 7. Raw inline GSAP, `setInterval`, and a demo card field

- Motion goes through `MotionProvider` against `frontend/public/vendor/gsap/`. Never `import gsap`,
  never a CSS transition, never the Web Animations API. **Both plugins the reference inlines —
  ScrollTrigger and SplitText — are already vendored.**
- `frontend/src/components/anim.ts` already exports `slideStep`, `animateAccordion`,
  `animateDrawerOpen/Close`, `animateModalOpen/Close`, `reduced()`, `motionLive()`. The checkout
  steps, the two expanders and the modal are existing helpers. **Only two are new**: the
  demo-message enter and the `scaleX` progress-bar fill on scroll. Add both to `anim.ts`, behind
  `motionLive()`.
- The reference's `#cardInput` and its `Demo only — no payment is processed` note exist because
  the reference has no backend. They are dropped. §34 gates live mode on samples mounting no
  payment field at all, and a fake one is worse than none.

---

## Scope

**This is three sessions.** The seam is named below; do not start one whose predecessor is not
green. A truncated session produces code that looks finished and is not.

---

# SESSION A — the record

Writes no surface. Every deliverable is a column, a table, a register, or a route.

## A1. Migration `0049_campaign_page_v2.sql`

0048 is the highest; the next is 0049. `meta/_journal.json` needs
`{"idx": 49, "version": "7", "when": 1786896000000, "tag": "0049_campaign_page_v2",
"breakpoints": true}` — the series steps exactly 86 400 000 ms per migration.

Follow `0018`'s idiom: DDL, then CHECKs, then grants, and a header saying what the file
deliberately does not add.

### New `campaign_build` columns

All `text`, all nullable, **none added to any `REQUIRED_*` register** — a build must not stop
completing because a campaign has no marketing headline.

`hero_headline`, `hero_headline_accent`, `hero_subheadline`, `founder_pull_quote`,
`platform_line`, `demo_context_label`, `benefits_heading`, `rewards_heading`, `updates_heading`,
`faq_heading`.

### New `campaign_reward_packages` column

`badge text` nullable. The reference's `Lowest price` / `Best value` / `For five`.

### New `campaign_updates` columns

`metric_label text`, `metric_value text`, with a **both-or-neither CHECK**. A bare `86%` with no
label is meaningless to a screen reader, and a label with no value is an empty promise.

### `campaign_demo_moments`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `campaign_id` | uuid NOT NULL | FK → `campaigns(id)` |
| `sort_order` | integer NOT NULL | default 0 |
| `time_label` | text NOT NULL | `8:15` |
| `moment_label` | text NOT NULL | `Morning` |
| `state_word` | text NOT NULL | `Quiet` |
| `headline` | text NOT NULL | `You're on track.` |
| `signal_text` | text | `No nudge needed` |
| `is_action` | boolean NOT NULL | default false |
| `action_label` | text | `Log water` |
| `created_at` / `updated_at` | timestamptz NOT NULL | `now()` |

UNIQUE `(campaign_id, sort_order)`. CHECK: `is_action` ⇒ `action_label` present and non-blank;
`NOT is_action` ⇒ `signal_text` present and non-blank. A moment is one or the other and the
database is what says so. Full CRUD granted, like `campaign_reward_packages`.

### `campaign_benefit_cards`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `campaign_id` | uuid NOT NULL | FK → `campaigns(id)` |
| `sort_order` | integer NOT NULL | default 0 |
| `title` | text NOT NULL | `Smart timing` |
| `footer_word` | text NOT NULL | `Right moment` |
| `visual_variant` | text NOT NULL | CHECK `IN ('bars','check','dots')` |
| `created_at` / `updated_at` | timestamptz NOT NULL | |

UNIQUE `(campaign_id, sort_order)`. Full CRUD.

### What the migration header must say it does NOT add

No `goal` column of any spelling. No `follower_count` on `campaigns` (§30 — a public popularity
number computed from a table nobody can audit). No `is_featured` on rewards — `featuredRewardSku`
is already `sortOrder`'s answer and a second mechanism would be a second answer.

## A2. Every new column, in five places

**This is the finding that matters most.** A column added to Drizzle and the migration alone does
nothing at all — there is no Zod in `shared/` and no route-layer whitelist. The effective
allowlist is the `assign(...)` calls inside `saveBuild`.

1. `backend/src/db/schema/build.ts`
2. the migration
3. `BuildPatch` (`backend/src/campaign/service.ts:51`) **and** an `assign(…)` line in `saveBuild`
4. `serializeBuild` (`backend/src/routes/founder-build.ts:355`)
5. `BuildFields` (`frontend/src/surfaces/founder/api.ts:458`)

…and to appear publicly, in **`buildCampaignPreview`** (`backend/src/campaign/preview.ts:74`) —
the ONE assembly the Founder preview and the public page both read, so wiring it there fixes both
and cannot let them drift.

Two existing bugs to fix while you are in `service.ts`: `assign('heroPreference', …)` appears
twice (`:215` and `:225`), and `assign`'s first parameter is never read.

## A3. The public payload

`PublicCampaignPayload` (`backend/src/campaign/public-page.ts:200`) gains:

- the ten hero/story/heading fields
- `demoMoments: PublicDemoMoment[]`, `benefitCards: PublicBenefitCard[]`
- `badge` and **`limitedQuantity` + `remaining`** on each reward — `buildPublicCampaign:285-311`
  currently *drops* `limitedQuantity`; stop dropping it and compute `remaining` with the existing
  `countActiveForReward`
- `preorderCounts: { uniqueActiveBackers, activeCount }` from `readPreorderCounts`
  (`backend/src/live/counts.ts:59`) — §21's own threshold measure, so no new counting code
- `metricLabel` / `metricValue` on each update
- `tagline` stops being `brandPerception` and becomes `hero_subheadline`

**Close the `thresholdProgress` gap.** `LiveCampaignPage.tsx:68` hardcodes it to `null`, so no
real Idea campaign has ever drawn a progress bar. It is now `uniqueActiveBackers`. The threshold
panel is the reference's largest single section and it cannot ship empty.

**§30 holds throughout.** A count is rendered only where a real record produced it. Zero
pre-orders renders `Be the first` — never a fabricated number, never a rounded-up one. A reward
with `limitedQuantity IS NULL` renders **no** remaining line, not `unlimited`.

## A4. Both live-edit registers, byte for byte

Every new field needs an entry in **`shared/src/live/editing.ts` `EDITABLE_FIELDS`** *and* in
**`backend/src/campaign/editing-logic.ts`**, which is the backend's runtime restatement because
it cannot import `@proovd/shared`. `tests/live-editing.test.ts:304` asserts the two lengths are
equal and walks every field. `tierFor` **throws** on an unregistered field — no default in either
direction, deliberately.

| Tier | Fields |
|---|---|
| `direct_versioned` | `benefits_heading`, `rewards_heading`, `updates_heading`, `faq_heading`, `demo_context_label`, demo `time_label` / `moment_label` / `state_word`, benefit `footer_word` / `visual_variant` |
| `requires_review` | `hero_headline`, `hero_headline_accent`, `hero_subheadline`, `founder_pull_quote`, `platform_line`, demo `headline` / `signal_text` / `action_label`, benefit `title`, reward `badge` |
| `never_direct` | nothing new |

The split is whether the field can carry a promise. A heading cannot; a hero headline is the
largest type on the page and is exactly where a claim would live.

Two consequences:

- A `direct_versioned` **build** field also needs a snake_case entry in `BUILD_COLUMNS`
  (`backend/src/campaign/live-editing.ts:59`) or `writeValue` throws
  `no column-one build column is mapped for "<field>"`.
- **`commitmentsIn` must run on every `direct_versioned` free-text field**, not only FAQ answers.
  §20 names the FAQ loophole by example — "a Founder editing 'when will I get it?' in the FAQ must
  not effectively move a delivery date" — and a section heading is the same loophole with a
  different name. Broad is correct here: a false positive costs a review, a false negative moves a
  date nobody accepted.

Two new surfaces join the `surface` enum: `demo_moment` and `benefit_card`. That is a CHECK on
`campaign_live_edits.surface` (`0027_live_editing_and_comments.sql:54`) — amend it in 0049.

## A5. The Founder build inputs

`frontend/src/surfaces/founder/CampaignBuild.tsx` gains cards for the new content: **Hero**,
**Your story** (pull quote), **The demo** (a repeater, up to 3 moments), **Benefits** (a repeater,
up to 3 cards), **Section headings**, and `platform_line` in the essentials. Reward badge and
`limitedQuantity` join the reward sub-form. Autosave-on-blur, the existing `TextField` pattern,
and the §9 rule that a key absent from the request writes nothing.

**Close the pre-existing gap while you are here.** Twelve of twenty-six build columns have no
input today, including four §14.4-required ones — `orderThreshold`, `deliveryWindow`,
`earlyProductDisclaimer`, `risksAndChallenges` — plus `internalTargetCents` and the five
`refundPolicy*` columns. **An Idea campaign cannot reach `complete` through this UI at all.**
`READINESS_FIELD_LABELS` names them in "Still needed in your build" and there is nowhere to type
them. Adding ten more fields on top of that makes the page worse; fix it in the same session.

**FAQs have no production write path.** `campaign_faqs` is only ever `SELECT`ed or live-edited;
the only `INSERT` in the repo is in a test, and `routes/founder-build.ts:96` exposes them
read-only. The reference makes the FAQ a full section, so add the authoring route and the
repeater rather than shipping a section a Founder cannot fill.

Refused, and each refusal is rendered as a sentence where the control would be:

- **No "generate" control anywhere.** §12: static copy-ready guidance, not an embedded AI product;
  §30 defers AI rewriting by name.
- **No `visual_variant` free text** — three shapes exist and a fourth would render nothing.
- **No follower list on a Founder surface.** §11 keeps the Founder's view of people to public
  handles; a list of emails who followed is the contact channel §30 defers.

## A6. Samples

`frontend/src/features/public/campaign/samples.ts` gains the new content for **both** fixtures —
demo moments, benefit cards, hero headline and accent, subheadline, pull quote, reward badges, an
update with a metric, the platform line, section headings. The two sample routes are §18-mandated
and §34 gates live mode on them being realistic; a half-empty sample is a §33.11 flow reported as
swept that a person would call broken.

Keep the dates fixed constants. `samples.ts:19-23` records why: a moving close date moves consent
text a Backer legally agrees to.

## A7. Session A done when

- `npm run typecheck && npm test` green.
- `npx vitest run --project shared` — `campaign-build.test.ts` and `live-editing.test.ts` drift
  guards pass with the new fields in both registers.
- A test asserts no `goal`-spelled identifier exists in the new schema, registers, or payload.
- A test asserts a reward with `limitedQuantity IS NULL` returns `remaining: null`, and one at its
  limit returns `0` — and that both agree with what `preorder.ts` would refuse.
- A test asserts an Idea campaign can now reach `campaign_build_status = 'complete'` **entirely
  through the Founder build routes**, which is not true today.
- `tierFor` throws for a new field deliberately left unregistered (prove the register is the gate).

---

# SESSION B — the page

Adds no column. Every deliverable is markup, CSS, motion, or a test.

## B1. `CampaignPage.tsx`, rewritten

Not patched. It keeps its header contract, restated at the top of the new file: **no payment
field anywhere in this file** — no Stripe mount, no `<form>`, no `<input>` — and the Appendix A.6
banner above everything, non-dismissible.

New band order. The `.seller` band is the one insertion; everything else is the reference's own
order.

1. sample banner → ended banner → attribution arrival *(unchanged, pre-numbered)*
2. `.hero` — title kicker, two-part `h1`, subheadline, `Reserve for $N`, `$0 today`, avatar stack, demo stage
3. `.benefits`
4. `.story-compact`
5. `.campaign` panel — threshold, progress, rule steps, cancel-before, opens/closes
6. **`.seller`** — MoR line, A.2 accordion, founder identity, refunds, `/refunds`, `/fulfillment`
7. `.rewards`
8. `.build` — updates
9. `.faq-clean`
10. `.comments`
11. footer band → `<SiteFooter/>`
12. `.mobile-dock`, checkout modal, `MagicLinkRequest`

**The `h1` is the hero headline; the campaign title is a `.kicker` directly above it**, and stays
the document `<title>`. §18 item 1 requires the title exposed, not that it be the `h1`. One small
line is the smallest deviation that satisfies both.

**Every campaign-type branch survives.** Product campaigns have no threshold: the panel shows
units reserved and the close date instead of a progress bar, per §18's difference table ("Prefer
Backers/units/days; no misleading public dollar gate"). Idea campaigns have no
`founderRefundPolicy`. Both are already fixtured.

## B2. `SiteHeader` gains a campaign variant

The three campaign routes **stay inside `PublicLayout`**. It is a thin shell but it does real
§33.11.1 work — skip-link first in tab order, scroll reset, focus into `<main>` on route change —
and moving out would silently drop all three.

`SiteHeader` renders the campaign nav (brand + `Why it works` + `Access` + `Reserve`, sticky) on
`/campaign/*` and the site nav everywhere else. `<main>`, `SiteFooter` and `SupportChat` are
untouched, so §27.8's pinned contact block, its test, and `a11y.test.tsx`'s landmark assertions do
not move. The reference's dark footer band is the last section *inside* `<main>`, directly above
`<SiteFooter/>` — two dark bands reading as one footer.

## B3. Reward selection

New behaviour. The page holds a selected SKU, defaulting to `featuredRewardSku`. Selecting a card
updates the card state, the mobile dock, the hero CTA price, and the modal title, and the
**selected** reward is what goes to `CheckoutDrawer` — which already takes a `reward` prop, so
nothing in the drawer changes.

Selection is a real toggle group: `aria-pressed` on each choice, arrow-key navigation, and the
selected card's CTA is the only one rendered (the reference hides the others).

**A sold-out reward is visible and unavailable** (§19's own words), never hidden.

## B4. `proovd.css` — `PHASE 33`

A new dated section at the bottom, in the slot-reading style. Never a hex literal, never an
arbitrary spacing value; `px` only for borders, radii, and the 44px touch minimum.

The reference's `:root` maps onto existing vars 1:1 — this is an in-house design, and finding the
mapping is not guesswork:

| Reference | proovd.css |
|---|---|
| `--brand` `--white` `--dark` `--darker` `--grey` `--grey-light` | identical names, identical values |
| `--light` #E9FFE1 | `--mint` |
| `--link` #D2FBC2 | `--leaf` |
| `--soft` #95C79D | `--sage` |
| `--muted` #669370 | `--moss` |
| `--visual` #F7F7F7 | `--grey-lightest` |
| `--light-stat` #EAF7EE | `--stat-mint-bg` |
| `--blue` #DEFAFC | `--accent-blue` |
| `--yellow` #F7FF9E | `--accent-yellow` |
| `--line` 2px → 1px at ≤600px | `--bw`, which already does exactly that |

Reproduce both breakpoints as the reference has them (1099.98px and 599.98px), the
`prefers-reduced-motion` block, and the `env(safe-area-inset-bottom)` dock padding. Reuse the
existing `.dock` (`proovd.css:350`) rather than adding a second fixed bar.

## B5. Motion

Through `MotionProvider`. Any subtree rendering `data-*` motion attributes on changing content
calls `useProovdMotion(ref, deps)`; anything driven by React state uses the imperative API;
hand-written GSAP is wrapped in `useGsapScope`.

| Reference behaviour | How |
|---|---|
| hero copy stagger, demo slide-in | `gsap.from` in a `useGsapScope` |
| demo message enter | **new** helper in `anim.ts` |
| progress bar `scaleX` on scroll | **new** helper in `anim.ts`, ScrollTrigger (vendored), `once: true` |
| story / updates expanders | existing `animateAccordion` |
| press and hover | existing `[data-pressable]` / `[data-hover]` treatment |
| checkout step transitions | existing `slideStep` |
| modal open/close | existing `animateDrawerOpen` / `animateDrawerClose` |

Everything behind `motionLive()`. The demo's auto-advance honours `reduced()` and stops
permanently on first interaction.

## B6. Accessibility

§28.5 and §33.11 are acceptance, not polish.

- Demo moments: `aria-pressed`, arrow-key navigation, and the auto-advance stop.
- The metric on an update needs its `metric_label` as an accessible name — a bare `86%` reads as
  nothing.
- The progress bar is the existing `Progress` component with a real `valueText`.
- Every expander: `aria-expanded` and a controlled panel.
- The avatar stack is decorative; `247 people reserved` is the text.
- The `h1` → `h2` per band → `h3` inside cards. **Eight `h3`s in the Affiliate rebuild had to
  become `h2`s** because they moved out from under a band heading — check the levels after the
  rewrite, do not assume them.
- 44px minimum on every control; the reference's `button { min-height: 48px }` satisfies it.

## B7. Tests to update

| File | What changes |
|---|---|
| `public-site.test.tsx:454-477` | The `h1, h2[id]` order list. **This is a §33.11 gate, not a formality** — rewrite it to the new order deliberately |
| `campaign-live.test.tsx` | MoR line and A.2 verbatim now live in `.seller`; attribution, noindex, ended copy, and the disabled pre-order all still assert |
| `a11y.test.tsx` | the new bands |
| `features/qa/fixtures.ts` + `qa.test.tsx` | the payload additions. **This will fail `npm run typecheck` first** — the fixtures are typed against the api modules' own interfaces, which is exactly what they are for. Let it fail and fill it in |
| `bundle.test.ts` | no new §3.2 term ships |

**Add a new assertion**: on a sample campaign the count of checkout entry points is **zero**.

The reference has four CTAs. Two only *scroll* — the hero's `Reserve for $9` and the footer's
`Reserve` are both `data-scroll="rewards"` — and two actually open checkout: the selected reward's
CTA and the mobile dock. Keep that split; it is good design, and it is also why the `.seller` band
sitting above `.rewards` satisfies §18's "above the pre-order action".

But the current page has exactly **one** disabled button, so a test naming one known control would
pass while the other three were live on a sample. Count controls, do not name one.

## B8. Session B done when

- `npm run typecheck && npm test` green, including all of §33.6.1–5 and §33.11.1–7 unchanged.
- The `h1, h2[id]` order test asserts all fourteen §18 items are present.
- A browser pass at 1280 and 320 against the reference, section by section.

---

# SESSION C — the modal and the follow record

## C1. The checkout modal — a restyle

`Drawer` (`frontend/src/components/Drawer.tsx`) is **already Radix `Dialog`** — portal, overlay,
focus trap, Escape, backdrop dismiss, GSAP open/close. The reference's `role="dialog"
aria-modal="true"` behaviour therefore already works. This is a CSS change plus one prop.

`CheckoutForm`'s three steps (`details → review → success`) already match the reference's
two-steps-plus-done shell exactly. **Do not renumber, reorder, or merge them.**

| Reference chrome | How |
|---|---|
| backdrop `rgba(1,45,16,.9)`, `min(100%,35rem)` centred, bottom-sheet ≤600px | `PHASE 33` CSS on `Dialog.Overlay` / `Dialog.Content` |
| `STEP 1 OF 2` eyebrow | one new optional `eyebrow` prop on `Drawer`. **`Dialog.Title` stays** — it is the accessible name |
| two-segment progress rail | markup + CSS |
| summary card, `$0 today → $N at threshold` rule cards, cancel note | markup + CSS, wrapping the existing `Quote` values |
| done state, `Founding user #248` | the existing `SuccessState`, plus the Backer number from 17b's `campaign_backer_numbers` |

**Everything below the chrome is untouched**: the survey, the billing fields, the server-rendered
`consentText`, the three separate unchecked toggles (§28.4 — never bundle them), the Stripe mount
and its three branches including the honest refusal when Stripe is unconfigured, and the
`PREORDER_SAVED_LEAD` line.

**Never render a fake card field.** The reference's is a mockup artefact.

## C2. The follow record — a recorded deviation

**Built by explicit product direction.** §1 rule 6 would forbid it: capturing an email from
somebody who has not pre-ordered, and sending them recurring mail, is a new commercial capability
the Spec does not define. It is built anyway, at the narrowest shape that honours the promise the
button makes, and recorded in `CLAUDE.md` the way the 2026-08-10 Admin-MFA removal and the
account-level Creator suspend/restore are — so a later session does not "fix" it by deleting it.

**Two things this brief got wrong on its first pass, corrected here.** Both were checked against
the code and the Spec, and both change what you write:

1. **Do not add a fifth notification audience.** `registry.test.ts:35-38` asserts
   `new Set(audiences)` **equals** exactly `{founder, affiliate, backer, internal}`, and
   `:21`'s key regex is a closed alternation. A `follower_` prefix is not a bill you pay across
   six files — it converts a deliberately-closed invariant into an open one, and makes
   `audienceOf` (`contract-logic.ts:266`) **throw** on the hot render path. Use `backer_`.
2. **§25.8 already covers this.** Its fourth window is *"Marketing consent: until unsubscribe +
   2 years"* (Spec `:2242`) — a follower email is a marketing consent, exactly. Do **not** derive
   a window from campaign resolution. Inventing a rule where the Spec speaks is §1 rule 6 in the
   other direction, and the Spec speaks here.

### Why `backer_` is honest, not a dodge

The prefix names the **delivery channel and history scope**, not a claim that the person
pre-ordered. `HISTORY_AUDIENCES` (`digest-logic.ts:137`) is `founder | affiliate | admin` — a
Backer has no notification-history surface at all — so the prefix reaches no reader and leaks
nowhere. Say this in the registry `description`, so the next person to read the key does not
conclude the product thinks a follower is a Backer.

### The record — migration `0050_campaign_followers.sql`

Session A took 0049; this is 0050, and the CHECK re-add below is 0051.

`campaign_followers`: `id`, `campaign_id`, `email`, `email_normalized`, `state`
(`pending | confirmed | unfollowed`), `frequency`, `requested_at`, `confirmed_at`,
`unfollowed_at`, `anonymised_at`, `consent_text`, `consent_version`, `source`
(`campaign_page | checkout_success`).

`email`, `email_normalized` and `consent_text` are **nullable** — §25.8's anonymisation nulls
them, and a NOT NULL column would make the retention sweep impossible to write.

CHECKs, on 0035's house style:

- state ∈ the three; `confirmed` ⇒ `confirmed_at NOT NULL`; `unfollowed` ⇒ `unfollowed_at NOT NULL`
- source ∈ the two
- **the two-shape rule** (migration 0047's arrangement): either every personal column is present,
  or `email`, `email_normalized` and `consent_text` are **all** null with `anonymised_at` set.
  A half-swept row is unrepresentable.
- partial unique `(campaign_id, email_normalized) WHERE email_normalized IS NOT NULL` — one
  follow per address per campaign. **A partial index means any `onConflictDoUpdate` needs
  `targetWhere`**, or Postgres raises 42P10 at runtime; `preferences.ts:151` documents this.

Triggers: identity immutability (`campaign_id`, `requested_at`, `source`, `consent_version` never
move; `email_normalized` may only go non-null → null, which is the anonymising write); an
insert-only `campaign_follow_events` history written **by trigger, not by a service** — this is a
consent, so "did they ask for this" is a fact we may have to prove, and a service that wrote it is
a service one careless `db.update()` bypasses.

Grants: `SELECT, INSERT`, column-scoped `UPDATE` on the state/stamp/anonymisation columns by name,
`DELETE` revoked. Insert-only on the events table.

**Columns that must not exist**, asserted absent in `information_schema`: `remind_at`,
`notify_at`, `recurrence`, `repeat_interval`, `next_send_at`, `cadence`, `template_id`,
`escalate_at`, `snooze_until`, and any `follower_count` on `campaigns`. §30 defers public like
signals, and the strongest form of a promise not to chase is having nowhere to record a schedule.

### Nothing existing can be reused, and the brief checked

`backer_identities` cannot hold a follower: `phone` is `NOT NULL` (`reservations.ts:68`) and
`dedup_key` is an HMAC over normalised email **+ phone**. A follower has no phone, and supplying
one would be invention. `support_cases.requester_email` has no public intake. `POST
/api/link/request` is the only public route that accepts an email — and it **records nothing**; it
is a lookup. It is the *shape* to copy, not the record.

### Double opt-in, and the non-enumerating ask

`POST /api/campaign/:campaignId/follow` copies `magic-link-reissue.ts` point for point:

1. A **frozen** `FOLLOW_ACK` — `Object.freeze`, nothing per-request. No timestamp, no request id,
   no retry hint. Anything that varies is a channel.
2. **The rate limiter answers that same body at 202, never a 429** (`backer.ts:156-165`'s
   `handler`). A 429 on the fifth try tells you the first four were interesting.
3. **Answer before the work** (`backer.ts:171-177`): `res.status(202).json(ACK)` fires *first*,
   then validation, then the work. Mint-and-send versus return-immediately is measurable even when
   the bodies match.
4. **The error path is silent** — a `try/catch` that writes an audit row and nothing else.
5. **Six branches, one answer**: already following, not following, malformed address, unknown
   campaign, campaign not live, over the limit.
6. **One query, not two.** A two-step "find the campaign, then find the follow" answers faster for
   a campaign that does not exist.
7. **The client swallows failures** (`MagicLinkRequest.tsx:47-58`) so the page cannot become the
   oracle the route refuses to be.

### The token — two lineages of one scope

`ALTER TYPE token_scope ADD VALUE 'campaign_follow'` and
`ALTER TABLE secure_tokens ADD COLUMN campaign_follower_id` land in **0050**; the DROP + re-ADD of
`secure_tokens_scope_binding` with its fourth branch lands in **0051**. That is the 0008/0009
precedent verbatim — Postgres refuses to use an enum label in the transaction that added it, and
the migrator runs one transaction per file. **The re-ADD must also add
`AND campaign_follower_id IS NULL` to the three existing branches**, exactly as 0009 did.

**Extend `enforce_secure_token_immutability()` to name the new column.** 0009 did not need this;
here, omitting it leaves the new binding column mutable, which is the cross-scope repoint §33.1.2
exists to catch.

**Confirm and unfollow are two lineages, and this is the subtlety worth reading twice.** The
confirm link is single-use, so it is claimed. The unfollow link must keep working for the life of
the record — but `verify` rejects a claimed token (`token-service.ts:325`) and
`secure_tokens_one_live_per_lineage` is keyed on `revoked_at IS NULL AND claimed_at IS NULL`. So
one scope, two lineages: the confirm lineage is claimed on use; the unfollow lineage is never
claimed and is revoked only when the follow ends. Use the existing `claimed` revocation reason —
do not start a third two-migration dance for an enum label.

### The message: ONE new key, and the recurring send needs none

**`backer_follow_confirmation`** — `audience: 'backer'`, `specRef: '§27.7'`. It is the consent
receipt for §27.7's optional summary, and `founder_activity_digest` already sets the precedent for
a §27.7 key.

It is **transactional** — a receipt for a consent, not the consented mail — so `optOutRule` stays
`forbidden` and it must carry **no opt-out language at all**. It touches exactly three files:
`shared/src/notifications/registry.ts`, `backend/src/notifications/events.ts` (the `const` **and**
`BACKEND_NOTIFICATION_EVENTS` — omitting the second puts the key in `neither` and fails the
partition), and `catalog.ts`. Nothing in `classification.ts`/`contract-logic.ts`: it is not money
and carries no deadline.

**The recurring send needs zero new keys.** `DIGEST_EVENT_KEY['backer']` is already
`BACKER_CAMPAIGN_UPDATE_DIGEST` (`digest.ts:89`), it is already in `NON_TRANSACTIONAL_KEYS`, and
it already carries the opt-out route. Ride it.

### Digest reuse — four changes, no schema churn

**Do not add a fourth digest audience.** Migration 0035's `digest_preference_subject_matches_audience`
CHECK admits exactly two subject columns and three audiences, and both registers are asserted
deep-equal between shared and backend. Store the follower's `frequency` on `campaign_followers`
instead, and leave `notification_digest_preferences` untouched.

1. `sweepDigests` (`digest.ts:445-492`) gains a follower branch reading
   `campaign_followers WHERE state='confirmed'`, calling `sendDigest` with `audience: 'backer'`
   and `preferenceId: <followerId>`. **Do not add a second `from(notificationDeliveries)`** —
   `notification-digest.test.ts:650-657` asserts there is exactly one in the module.
2. `composeDigest` (`:353`) currently branches
   `audience === 'backer' ? BACKER_VISIBLE_AUDIENCES : CREATOR_VISIBLE_AUDIENCES`. A follower must
   take **`CREATOR_VISIBLE_AUDIENCES`** (`general_public`, `milestone_progress`) — *not* the
   Backer list, which includes `backer_only`. Getting this backwards is a §18 disclosure failure,
   not a digest bug, so the branch must key on follower-ness rather than on the `audience` string.
3. `preferencesUrlFor` (`:423-429`) returns the follower's **unfollow** URL. The digest's single
   action then *is* the opt-out, which satisfies `oneActionAtMost` and `optOutRule: 'required'`
   simultaneously.
4. Dedup entity stays `${preferenceId}:${digestPeriodKey(...)}` — a follower id in that slot is
   unique against `(event, target, entity)`, so a job that runs twice still sends once.

**Frequency has no default.** §27.7's rule is that the preference exists only because a person
chose it; the follow form asks, and no code path may set it.

### The `List-Unsubscribe` decision — raise it, do not resolve it by editing a test

`notification-coverage.test.ts:171-177` forbids adding a `List-Unsubscribe` header in `send.ts`,
because §27.2 says transactional email is not opt-out-able and the header would attach to every
message. A marketing send conventionally wants that header. **This is a genuine tension between a
platform invariant and a mail convention. Surface it as a decision; do not silence the test.** The
narrow fix, if one is wanted, is a per-key header rather than a blanket one — and that is its own
decision, not a side effect of this brief.

Note also that the digest template's opt-out vocabulary is deliberately *"Change how often you get
this"* (`templates/digest.tsx:110`), which satisfies the preview's `hasOptOutPath` detector while
staying clear of the coverage suite's narrower `/unsubscribe|opt[- ]out|.../` ban. Follower copy
uses that vocabulary and never the literal word.

### Retention — §25.8 window 4, on the `anonymiseDraft` pattern

**Until unfollow + 2 years**, then irreversible anonymisation. Window 5 separately covers the
token hashes. Window 1 does not apply — a follower has no reservation.

`sweepFollowConsent` copies `invitations/retention.ts:126-296`: one transaction; **token
revocation first, inside it** (a revoked token beside live content is not compliance, and a crash
between them leaves that state permanently); null every content column and stamp `anonymised_at`;
provenance columns survive because the column-scoped GRANT permits exactly those and nothing else;
exactly one `audit_events` row naming the reason and **carrying no copy of what was deleted**.
Irreversibility is a database property — the two-shape CHECK plus a trigger refusing any other
update — not a service one. It is idempotent by construction: an anonymised row no longer matches
the due query.

Schedule it as `follow-consent-retention` on the existing `RETENTION_SCHEDULE_CRON`
(`scheduler.ts:72`), beside `unclaimed-draft-retention`.

### The surface

`Follow build` / `Following` in the `.build` header, and `Follow the build` on the done state.
Anonymous visitors get the email form. A Backer who just pre-ordered is offered the §27.7 digest
control they already own, through `notifications/preferences.ts` — the one writer, with no default
anywhere.

**Do not put the unfollow route in `routes/notifications.ts`** — `notification-digest.test.ts:772-773`
asserts that router's write methods are exactly `['router.put(']`.

**Follower counts never render publicly** (§30). A read-only count on the Admin campaign detail is
a `GET` and is fine.

### Registration

**Add no Admin write, and no §33.12.5 entry is needed.** The partition test filters to
`/api/admin` writes only; the three public routes are outside it. Two hazards if you add one
anyway: it must be gated or carry a 60-character reason naming the sensitive property it lacks,
and `system-contract.test.ts:565-567` asserts `gated.length > ungated.length`, which a few more
ungated writes could invert.

## C3. `CLAUDE.md`

Add a dated section for this rebuild in the house style, and record the follow-record deviation
explicitly: what it is, that it is by product direction, what §1 rule 6 says about it, and what
did NOT change (no follower list on a Founder surface, no public count, no schedule column, no
second digest). Update the repository-state table and the frontend row.

## C4. Session C done when

- `npm run typecheck && npm test` green.
- The §27 coverage partition passes with the one new key — and `registry.test.ts`'s audience
  set-equality assertion is **untouched**, because no fifth audience was added.
- §33.12.5's partition passes in both directions.
- A test drives the public follow route with a hit, a miss, a malformed address, an unknown
  campaign, and a rate-limited caller and asserts the **byte-identical** response every time.
- A test asserts no schedule-shaped column exists and no file under `backend/src/jobs/` chases a
  follower.
- A test asserts a follower digest containing a `backer_only` update is impossible.
- `notification-digest.test.ts:650-657` still passes — exactly one `from(notificationDeliveries)`
  in `digest.ts`, and it is still only the exclusion.
- A test asserts the retention sweep anonymises at **unfollow + 2 years** (§25.8 window 4), and
  that an anonymised row cannot be un-anonymised — refused by the database, not by the service.
- **One open decision is answered in writing, not by editing a test:** whether a
  `List-Unsubscribe` header ships on the follower digest, and if so how it attaches per-key rather
  than to every message. Record the answer in `CLAUDE.md` beside the deviation.

---

## Out of scope

- **Comments as a working thread.** §18 item 13 renders as the band with its existing empty-state
  copy; the live thread is the Backer magic-link page's (`CommentThread.tsx`) and stays there.
- **Discovery, attribution, and the ended-state classifier.** All Phase 14b, all passing, all
  untouched. This rebuild re-presents them.
- **The §19 flow itself.** Restyle only.
- **Video or animation assets in the demo stage.** It is CSS and text; the R2 bucket is Track A4
  and `unconfiguredStorage` still throws.
- **Any change to the attribution cookie, the threshold decision, or the close batch.**

---

## Traps

- **The five-place rule (A2).** A column in Drizzle and the migration alone does nothing. There is
  no Zod in `shared/`; `saveBuild`'s `assign` calls are the whole allowlist.
- **`buildSnapshot`** (`campaign/service.ts:139`) hand-lists fifteen keys. A field added to a
  `REQUIRED_*` register but not to `buildSnapshot.fields` reads as permanently absent and pins the
  build at `in_progress` forever. None of the *new* fields is required — but the ones A5 un-strands
  are, so check it.
- **`approved_campaign_snapshots`** spreads the whole build row (`campaign/review.ts:229`), so new
  columns are captured automatically — but a raw bigint or Date throws on the JSONB insert.
- **Two registers or the drift test fails.** `shared/src/live/editing.ts` and
  `backend/src/campaign/editing-logic.ts`, byte for byte.
- **`useButtonProgress` must be mocked as a promise, not a callback**, in any new surface test.
  The callback-shaped mock resolves immediately and makes a server-refusal assertion pass for the
  wrong reason. `support.test.tsx` records this; three other suites carried the wrong mock until
  2026-08-15.
- **A browser pass finds what jsdom and axe cannot.** Every workspace rebuild found at least one
  defect only a screenshot showed — an invisible pill, a tab rail overflowing with no affordance,
  a heading level jump, a grid child auto-placing on top of its neighbour. This is the largest
  visual change in the product. Budget for it, at 1280 **and** 320.
- **`campaigns.created_at` and `updated_at` are forbidden anchors** (§33.12.1's scan treats reading
  either as the failure). Every date on this page comes from `opensAt`, `closesAt`, or
  `campaign_live_at`.

---

## Done when

- All three sessions' done-when lists pass, in one run.
- **§33.6.1 through §33.6.5 still pass**, unchanged — the §18 contract this page already honours.
- **§33.11.1 through §33.11.7 still pass**, with the flow register and fixtures updated.
- **§33.12.5's partition passes in both directions.**
- The bundle scan finds no §3.2 term, including in identifiers.
- Both sample routes render the full new design with no empty section and **zero** payment fields.
- A Founder can author every authorable piece of the page through `/campaigns/:id/build`, and an
  Idea campaign can reach `complete` there — which it cannot today.
- The reference and the built page, side by side at 1280 and 320, differ only in the seven places
  this brief names.

---

## After this

The `.seller` band is the first place in the product where §18's items 2, 7 and 8 sit together as
one designed unit. If a later phase adds a Founder-identity fact, that band is where it goes —
not a fifteenth section.

The follow record is a deviation with one message and no schedule. If a later phase is asked to
add a second follower message, a cadence, or a re-engagement sequence, that is §30's automated
engagement sequence and this brief is not the licence for it.
