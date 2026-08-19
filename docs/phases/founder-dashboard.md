# Founder Dashboard — the Founder's home after the flow (post-Phase-24 change)

**This is not a numbered phase.** `docs/master-plan.md` §6's table ends at 24, and §1.1 says a
phase file may never introduce a rule. This brief introduces two, and says so in the open under
"The honest position on §1 rule 6" — both by explicit product direction, both recorded in
`CLAUDE.md` the way the 2026-08-10 Admin-MFA removal is. Everywhere else it cites the Spec, and
where the Spec is silent it says so rather than manufacturing a citation.

It is the same kind of document the six Admin workspaces, the public campaign page and the
Founder Flow were built from: a supplied reference plus the decisions that reference cannot make
for itself.

**Model:** Opus 5. Not because the dashboard is large, but because the reference and the Spec
disagree in fourteen places; three of those ship something §3.2 bans, one invents a fee, and two
sit on §30's own written deferral list. It also carries an **owner ruling that changes a design
token product-wide**, which will visibly move every surface built in thirty-nine phases.

**Goal:** The Founder gets a home. Four chapters — Choose, Live, Get paid, Wrap — plus settings
and a Backers page, replacing seven bare routes with one place, and picking up where the Founder
Flow's `You're Live!` leaves off.

**Reference bundle:** `docs/design-refrence/Proovd_Founder_Dashboard_v5.html`. One 455KB file:
~190KB of CSS, a 115KB application script, and GSAP 3.13.0 inlined ahead of it. The app script's
header comment is a genuine handoff note and carries the owner ruling — read it first.

**Walk it, do not only read it.** Open it in a browser and go through all four chapters. It
persists to `localStorage` under `proovd-founder-dashboard-v5` and reads `?type=`, `?effort=`,
`?upfront=`, `?day=` and `?phase=` from the URL, so you can reach every state: `phase` is
`matching | waiting | live` and beyond, and `day` drives the campaign clock. Several of its
decisions are behaviour rather than markup — the chapter relay, the story/recap drawer, and the
onboarding sequence that runs on first arrival.

---

## Read first

Read these before writing anything. Do not work from this brief's paraphrase of them.

- **Spec §20**, the whole section — Glance, the ranked Act, Explore's eleven sections, the three
  live-editing tiers, and the freshness rule. This is the section Chapter 2 is graded against.
- **Spec §14.1, §14.2, §14.3, §14.5** — the formal opportunity, the three decisions, who may
  propose and who may accept, the compensation matrix, and the Founder's roster card. Chapter 1
  is graded against these and it is the easiest chapter to get wrong.
- **Spec §11** and **§25.7** — what a Founder may see of a Creator, and of a Backer.
- **Spec §19**, especially "Immediate Founder operational sharing" and step 7's optional consent.
- **Spec §5.2's settings line**, §5.5, §28.1 — the settings panel and the password paths.
- **Spec §21, §22.3, §22.4, §22.5, §22.6** — Chapter 3.
- **Spec §22.8–§22.11, §31.8** — Chapter 4.
- **Spec §30, the whole deferred list.** Four of its entries bear on this reference directly.
- **Spec §3.1 and §3.2**, including §3.2's last paragraph about identifiers.
- **Spec §24.6, §24.7** — the three money streams, before reading disagreement 7.
- **Spec §27.1's six questions**, §27.2's first rule, §25.6, §25.8, §28.4, §28.5.
- **§33.11** all seven, **§33.12.5**.
- **DNA §5.1, §5.2, §5.4, §5.9, §5.10, §5.12, §5.14**, and §6 (motion).
- `frontend/public/proovd.css` — the file header and all four `:root` blocks. Session A edits a
  token there, which nothing has done since the file was written.
- `CLAUDE.md`, the post-Phase-24 sections, and `docs/phases/founder-flow-reconciliation.md`.

---

## Prerequisites

All of Phases 00–24, the six Admin workspaces, the campaign-page-v2 rebuild, **and the Founder
Flow v2 (Sessions A–F, complete)**. Session B depends on the last of those directly.

---

## The handoff already has a socket

`LiveStep.tsx:132` already navigates to `/campaigns/:campaignId/home` — "Go to your campaign
home", with a comment naming §20's Glance/Act/Explore as the surface a live campaign is operated
from. **The dashboard becomes that destination.** Connecting the two is one redirect and one
changed link, not an integration.

The reference reads `type`, `effort`, `upfront`, `day` and `phase` from the query string. Those
are the flow's own outputs — the §9 campaign type, the §12 high-effort classification, the
`founder_fixed_payment_openness` record, and the campaign clock. In production every one comes
from the campaign row. **No query parameter drives state in the built dashboard**; a value a
caller can set is a value a caller can lie about, which is the identity mistake `routes/vetting.ts`
records.

### The duplicate password step

The reference runs its own onboarding on first arrival: `password → effort → refunds → community
→ communityThanks`. §10 puts "Password creation or Google sign-in" on the **claim** surface, and
the flow already ships it there. **The dashboard's password step is dropped** — a second place to
set a password is a second path into the account, and the flow's claim is the one §10 names. The
remaining steps stay (see disagreements 7 and 12 for what happens to `community`).

---

## What cannot complete today, and must not be stubbed

Two of these are the same designed states the flow already renders:

1. **R2 is unconfigured** (Track A4). §5.2 names a profile photo; no column exists and there is
   nowhere to put the bytes. The settings panel renders a named absence, not an upload control.
2. **Cal.com is unconfigured** (Track A4). This matters for Chapter 1's meeting deviation — the
   §12 Founder interview scheduler is Cal.com's, and the new meeting record must not become a
   second scheduler (see disagreement 9).
3. **`/support` does not exist.** See the traps — it is a live bug this brief fixes rather than
   inherits.

---

## The honest position on §1 rule 6

### Three things the reference asks for are Spec-mandated and simply missing

This is the finding that most changes the brief's character. These are not new capability to be
justified — they are **compliance gaps the dashboard closes**.

- **§5.2 names the entire settings panel**: *"Founder settings: name, email, phone, profile
  photo, password, business/entity data, connected-account status, read-only KYC status,
  notification preferences, post-close W-9 status, and delete-account request."* Almost none of
  it exists. Today the whole account chrome is a Sign out button and one link on `/campaigns`.
- **§20's Explore section 10 requires a Founder export**, and the code already declares its own
  absence honestly — `available: []` beside a published withheld list.
- **§19's operational share is mandatory** — *"After a successfully saved pre-order, immediately
  share the Backer's email and purchase details necessary for fulfillment preparation and support
  with the Founder… This sharing is mandatory and disclosed before consent."*
  `founder_operational_shares` holds exactly that and is **written by five services and read by
  none** on any Founder route.

### Two new deviations — each needs its own `CLAUDE.md` section

Both are **heavier than the Founder Flow's three**, and the brief must not blur that. The flow's
deviations sat where the Spec was silent (a settings panel §5.2 anticipates) or adjacent to a
sentence that invited them (§5.2's own "a future public onboarding route requires email
verification"). **These two sit on a list the Spec wrote down.** §30 defers, verbatim:

> - Founder browsing/outreach to unmatched Affiliates.
> - Founder–Creator meeting scheduler; the human Founder interview scheduler is required.
> - Direct Founder–Affiliate messaging.

And §11: *"The Founder cannot contact the Affiliate directly."* The Admin Founders rebuild
refused a meeting record on 2026-08-17 for exactly this reason and recorded why.

**1. The Founder→Creator meeting request.** Built by explicit product direction. Confined to
§22.9's shape, which is the one mediated Founder→Creator ask the product already has: **one
message at request time, immutable afterwards, one response, no thread, no reply route, and no
way to add a second message.** It routes through Proovd rather than direct. It is a *request*
record, not a scheduler — §30's "the human Founder interview scheduler is required" means Cal.com
stays the only thing that books time, and this must not grow a slot picker.

**2. The post acknowledgement.** The reference's toast reads "Liked — creator will see it", which
makes it a message. Same treatment: a recorded acknowledgement with its own §27 key, deduped on
the post, with no free text — a free-text field here is the direct messaging §30 defers, wearing
a smaller control.

**Neither is a licence for the other three §30 entries.** Browsing unmatched Creators stays
refused, direct messaging stays refused, and the hosted community stays refused (disagreement 7).

---

## What the reference draws, and where each piece comes from

Walk this against the file. `NEW` means nothing holds it today.

| Chapter / area | Reference | Source |
|---|---|---|
| **Chrome** | wordmark, chapter rail, story drawer | `NEW` — there is no Founder shell anywhere |
| **Onboarding** | password | dropped — §10's claim owns it |
| | effort — "Your starting affiliate cut" | read-only over the §6 base settings |
| | refunds — "Add your refunds page" | `campaign_build.refund_policy_source_url` |
| | community | split — see disagreement 7 |
| **1 · Choose** | matches, one at a time | §14.5 roster via `listFounderVisibleRoster` |
| | offer → accept / counter / reject | §14.2's three responses; `POST /api/founder/proposals/:versionId/respond` |
| | bonus | §14.3 Creator-specific bonus; the existing bonus route |
| | "X is leading" + leaderboard | refused — disagreement 2 |
| | meeting request | `NEW` — deviation 1 |
| **2 · Live** | Glance numerals, what needs you | §20 `readCampaignHome` — Glance, ranked Act, Explore |
| | edit campaign / page update | the built-and-unused §20 live-editing tiers |
| | post an update | §18 `campaign_updates` |
| | posts, likes | §17 post submissions; like is `NEW` — deviation 2 |
| **3 · Get paid** | card retries | §21 retry window |
| | W-9, payout request, first/remaining | §22.3 `readFounderPaymentStatus` |
| | progress update, delivery proof | §22.4 Day 14, §22.5 fulfillment |
| **4 · Wrap** | creator recap, work-again | §22.8 completion, §22.9 `NextCampaign.tsx` (built, unrouted) |
| | backer recap, export | §20 Explore 10 + §19 operational share |
| | cooldown, next campaign | §22.10 |
| | cancel campaign | §31.6 |
| **Settings** | password, profile, personal, notifications, delete | §5.2 — mostly `NEW`; see the table below |
| **Backers** | 183 people, with context | §19 operational share + consent-gated aggregates |

**The largest existing asset is unused.** §20's three-tier live-editing API — `applyLiveEdit`,
the tier register in `shared/src/live/editing.ts`, and `POST /api/founder/campaigns/:id/live-edit`
— is built, tested, mounted, and **has zero frontend callers**. A repo-wide grep for `live-edit`
in `frontend/src` returns one comment. Chapter 2's edit controls are its first UI. Do not build a
second write path; the field's tier decides what the one route does.

### What is new schema, and what is a route

| Need | Status |
|---|---|
| Meeting request, post acknowledgement | **NEW** — the two deviations, on §22.9's shape |
| Backer data request (support/fulfillment, Admin-decided) | **NEW** |
| Founder export | **NEW** — its own permitted register |
| Delete account | **ROUTE ONLY** — `founder_deletion_requests` exists (migration `0040`, insert-only, `SELECT, INSERT` grants). The Creator flow's Session F is the template: one Founder route onto the **same record** with a `FOUNDER_DELETION_RECEIVED_VIA` constant. A second table is the duplicate this codebase refuses everywhere |
| Post-claim profile edit | **NEW** — `saveClaimProfile` refuses once `claimed_at` is set, and Admin's `updateFounderField` is the only writer. Copy `affiliate_profile_corrections` (migration `0055`) exactly: field ids CHECK-pinned to a register rather than column names, required reason, `prior_value` NOT NULL with JSON `null` for a genuinely absent prior, read `FOR UPDATE` inside the transaction, no UPDATE grant |
| Password change | **PARTIAL** — §5.5's reset ships end to end. `POST /api/auth/change-password` is reachable through Better Auth's handler but is unsurfaced; surfacing it needs the review `auth.ts:213-219` demands |
| Profile photo | **ABSENT** — §5.2 names it, no column exists, R2 is Track A4 |
| Community multiplicity | **NEW** — `community_url` is one nullable text column |
| Everything in Live / Get paid / Wrap | **EXISTS** |

---

## The fourteen places the reference and the Spec disagree

§1.8: the Spec wins on all of it. Each is a decision, made here, in the open.

### 1. The owner ruling — and it is an instruction, not a description

The app header reads:

> OWNER RULING (supersedes DNA 2 / 1 / 10.1): radius is 2px on both postures, brand-green fill
> takes `#FAFAFA` text, and the inset highlight ships on brand-filled primaries. Those three come
> from the shipped Founder Flow.

**The last sentence is not true of the code, and the brief must say so before anyone acts on it.**
`proovd.css:102` reads `--radius: 1px; /* sharp. everywhere. */`, and `radius: 2px` appears
**zero times** in the entire stylesheet. The shipped Founder Flow uses the 1px token like
everything else.

So this is a real product-wide change, taken **by product direction**, not an alignment to
something already there. It moves every surface built in thirty-nine phases.

- `--radius: 1px → 2px`, and the ≤600px override `0.5px → 1px`.
- Brand-filled surfaces take `--white`, replacing `--mint`. This reverses campaign-page-v2's
  recorded decision, and `proovd.css:158`'s hard rule is edited rather than worked around —
  a rule that is no longer true is worse than no rule.
- The inset highlight — `box-shadow: 0 3px 12px rgba(255,255,255,0.42) inset` — ships on
  `.btn--primary`.

Tech-stack §3.6's documented contrast exception already covers brand-fill buttons and is
unchanged in kind: `--mint` on `--brand` is 1.44:1 and `--white` on `--brand` is comparable.
Record the new value in that exception rather than leaving it describing the old one.

**This is Session A, alone**, with a screenshot pass over all six Admin workspaces, the public
campaign page, the flow and the samples.

### 2. `leaderboard`, and `"${name} is leading."`

Three occurrences, one of them an `h1`, plus "See the full leaderboard, then open any creator to
inspect their posts."

§30 defers "Public leaderboards/shaming", and the Creator close view already ships with **no
rank** on that basis. The distinction that resolves it: **the numbers are permitted, the ranking
is not.** §20's Explore section 5 is `creator_results`, which a Founder is entitled to — it ships
with each metric's definition beside it precisely so two people cannot read it differently.

So: per-Creator results with their definitions, ordered however the list is ordered, and **no
"leading", no crown, no position, no ranked column**. The hero on that screen is a number about
the campaign, not about which Creator won.

### 3. `pledge`, in the export

Two occurrences: the CSV header `['Name','Pledge','Source','Checkout comment']` and a Backer
detail row. §3.2 replaces it with "reserve a pre-order / reserved / authorize a future charge".

This is the worst placement the term could have — **an export file outlives the session** and is
opened somewhere Proovd cannot correct it. The column is `Pre-order`.

### 4. `upfront` × 13

§3.2 bans `upfront (fee|payout|payment)` universally, and §3.2's replacement is "optional fixed
Creator payment / secured Creator payment / Creator payment funded". **Fourth supplied reference
in a row to ship it**; the Affiliate workspace's own acceptance audit once mandated it by name.
`FIXED_PAYMENT_FUNDED_IS_NOT_PAID` travels with the copy.

The state key is `upfront` too — §3.2's last paragraph binds identifiers, and §33.11.3 reads the
built bundle where a prop name survives minification.

### 5. `goal`

"The campaign finished above goal", on a closed campaign that cleared its threshold. §3.2 bans
`goal` for an Idea threshold in every audience including identifiers. Fourth reference in a row
for this one as well.

### 6. `affiliate` × 42

§3.1 makes it customer-facing-banned with replacement **Creator**, and a Founder is a customer.
The Admin *record* vocabulary stays `Affiliate` — settled 2026-08-11, not reopened. Scan the
**rendered text** of every chapter, not the source.

### 7. `Pay $5 & set it up` — a hosted community

The `community` onboarding step offers two branches. One asks where an existing community lives
and stores a link. The other charges **$5** for Proovd to stand up a Discord server, with the
copy "a Proovd rep gets in touch so the server actually fits what you want."

The second is refused, four ways over:

- **§30 defers "Hosted Founder community"** by name.
- **§1 rule 6 forbids inventing a fee**, and this one is hardcoded rather than a §6 setting.
- **§24 has exactly three money streams that never commingle** — campaign charges, the listing
  fee, and the fixed Creator payment. A fourth has no §24 treatment, no merchant-of-record
  determination, no tax position, no refund policy, and no place in the §26.5 ledger.
- It is not describable in §23.1's lifecycle or §23.3's payment flags.

**The existing-community branch ships**, and it is legitimate: `campaign_build.community_url` is
§20's column-one `direct_versioned` field — the first entry in the live-editing register — so a
Founder may change it directly while live, with version history. §19 puts the community link on
the Backer's magic-link page.

The reference's plural "Community links" and its platform picker have no record: one nullable
text column, no platform enum, no ordering, no per-audience visibility. **Ship the single link.**
Multiplicity is a schema change with no Spec behind it, and §20's register would need a tier for
each new field.

### 8. The Founder gating who receives the opportunity

"Meet them one at a time, lock the people you trust, then Proovd sends the campaign to your final
roster."

Responding to proposals **is** §14.2 and is legitimate — `offer → accept / counter / reject` maps
exactly onto its three Founder responses. Gating who receives the opportunity is not:

- §14.5: *"Proovd owns recruitment follow-up. The Founder cannot browse or contact a general
  pool."*
- §8: *"The Founder does not browse or contact a general Affiliate pool."*
- §30 defers "Founder browsing/outreach to unmatched Affiliates".
- `rosterMembership` has two writers and both are Admin.

The chapter renders the **recruited** roster and the three responses. There is no select control,
no ordering control, and no "send to my final roster" action.

### 9. A meeting scheduler

Deviation 1 builds a *request record*. It must not become a scheduler: §30's own entry reads
"Founder–Creator meeting scheduler; **the human Founder interview scheduler is required**", and
tech-stack §12 makes the Cal.com booking record the source of truth for the one scheduler the
product has. No slot picker, no platform tiles, no calendar — those exist once, for §12.

### 10. Backer data for community and marketing

The reference lets the Founder request access for "adding backers to your community", "customer
support", or "marketing follow-up".

§25.7's Founder line is exact: aggregates, plus *"Immediate Backer email/purchase details only
for fulfillment/support"*, plus *"Identifiable survey/marketing fields only with the specific
optional consent."* §19 step 7 is that consent and it is a separate unchecked control; §19 also
says the mandatory operational share *"is not marketing consent"*.

**Support and fulfillment ship. Community and marketing are refused**, each with its reason on
the screen. The request is a record an Admin decides — never self-serve — and §31.8's "does not
coerce newsletter consent" stays enforced the way it already is: by there being nowhere to record
a marketing consent at all.

### 11. Per-topic notification toggles

"What reaches you" reads as a preference matrix. §27.2's first rule is that transactional email
is **not opt-out-able**, and the only opt-out in the product is §27.7's digest.

So the panel is the existing three-value choice — `off / daily / weekly` — plus the read-only
history, with `DIGEST_NEVER_REPLACES_TRANSACTIONAL` pinned beside it: *"This is the only email
you can turn off. Messages about your money, your deadlines, and your account always send."*

### 12. Passive bundled consent

Under the password field: "By signing up, you accept Proovd's Acceptable Use Policy and Terms."

§28.4 forbids bundled consent and §10 requires Terms, Founder AUP and privacy as separate
acceptances recorded at the claim. The flow already refuses this exact pattern on its invite page.
Since the password step is dropped entirely (see the handoff), so is the line.

### 13. `prebuild` / `prelaunch` and other internal names

§3.1: `pre-build`, `pre-launch`, `reservation` and `tranche` must never render to a Founder.
Internal state keys may use them; `CAMPAIGN_TYPE_LABELS` is what a person reads. The reference
interpolates `S.campaignType` straight into a sentence in at least one place.

### 14. Anything that advances on a timer

The reference has story and recap sequences with `afterPlayed` and stepped state. The flow's
reconciliation established the rule and it holds here: **no timer callback may navigate**, and no
`setTimeout`/`setInterval` may drive a `campaigns.status`-shaped transition. A countdown that
counts down is fine; a screen that moves on without you is not.

### Two that read like violations and are not — recorded so a later pass does not re-flag them

- **"lock the people you trust"** — the ordinary English verb, not §3.2's trust-account sense.
  §3.2 bans "escrow / trust / custody / Proovd bank hold" as a description of where money sits.
- **"Your starting affiliate cut"** — it *reads* as the Founder setting a rate, and it is a
  read-only explainer: `${baseCut()}%` as a hero, a worked example (`Affiliate offers 50% → You
  counter 35% → Both accept 35%`), and one "Show me the next step" button. There is no input.
  Only `submitProposal` originates a version and it is Creator-only; no Founder route anywhere
  accepts a rate. The word `affiliate` in it is disagreement 6, and the substance is correct.

---

## Scope

**This is seven sessions.** The seams are named below; do not start one whose predecessor is not
green. A truncated session produces code that looks finished and is not.

| | Screens | Ends at | Depends on |
|---|---|---|---|
| **A** | none | the token change is product-wide and every surface is re-checked | — |
| **B** | chrome | the shell exists and the flow lands in it | A |
| **C** | Chapter 1 | the 72-hour proposal window | A, B |
| **D** | Chapter 2 | the campaign closes | A–C |
| **E** | Chapter 3 | the money is out | A–D |
| **F** | Chapter 4 + Backers | the campaign resolves | A–E |
| **G** | Settings | §5.2's panel is whole | A–F |

---

# SESSION A — the owner ruling

No dashboard code. One token change, one rule edit, and a very large verification.

## A1. The change — four lines, and one judgement

It is a **slot** change, not a hunt through selectors. The mode system already routes every
brand-filled control through `--btn1-*`, so three edits reach the whole product.

**Find these by their declaration, not by line number** — `proovd.css` has uncommitted changes
while the Creator flow is in progress, and the numbers below were true when this brief was
written and will drift.

| Declaration | Today | Becomes |
|---|---|---|
| `--radius` in the third `:root` (~`:102`) | `1px;  /* sharp. everywhere. */` | `2px` |
| `--radius` in the `@media (max-width: 600px)` override (~`:105`) | `0.5px` | `1px` |
| `--btn1-text` in `:root, .mode-none` (~`:158`) | `var(--mint);  /* hard rule: brand fill → #E9FFE1 */` | `var(--white)` |
| `--btn1-text` in `.mode-light` (~`:216`) | `var(--mint)` | `var(--white)` |

Confirm the set first — there should be exactly three `--btn1-text` declarations and two
`--radius`:

```bash
grep -nE "\-\-btn1-text|\-\-radius:" frontend/public/proovd.css
```

**The third `--btn1-text` is the judgement, and the brief's answer is to leave it.** `.mode-dark`
sets `var(--dark)` — deep green on brand green, the *high-contrast* pairing, plainly deliberate.
The ruling qualifies its radius clause by posture ("on both postures") and does not qualify the
text clause, which is ambiguous rather than decisive. Blanket-applying `--white` there would
lower contrast on the one mode where the current value is good. Change the two that are `--mint`;
record that the dark one was considered and kept, so the next reader knows it was a decision.

`.mode-drawer` defines no `--btn1-text` and inherits — nothing to do.

The consumers (`:392`, `:1949`) need no edit; that is the point of the slot.

`.btn--primary` (`:391`) gains the inset highlight:
`box-shadow: 0 3px 12px rgba(255,255,255,0.42) inset`.

## A2. Edit the rules that are no longer true

`proovd.css:158` records the brand-fill rule and campaign-page-v2's `CLAUDE.md` section records
the opposite decision. **Edit both**, and say the ruling superseded them and when. A stale rule
is worse than none, because the next session follows it.

Tech-stack §3.6's contrast exception is re-recorded with the new value, still scoped to
brand-fill buttons.

## A3. Session A done when

- `npm test` green in one run — including `a11y.test.tsx`'s two stylesheet scans (balanced
  comments, and every `var(--x)` without a fallback naming a property the file defines).
- **A screenshot pass at 1280 and 320 over: all six Admin workspaces, the public campaign page
  and both samples, the Founder Flow's twenty-four pages, the Backer magic-link page, and the
  public site.** This is the largest visual blast radius any change in this product has had.
- `CLAUDE.md` records the ruling, that it superseded two recorded decisions, and that its own
  "these come from the shipped flow" premise was not accurate.

---

# SESSION B — the shell, and the handoff

## B1. The Founder shell

There is no Founder layout, shell, or nav component anywhere — all 26 Founder routes are bare
top-level pages. This is the first one.

It is **not** `AdminFrame`: §26 licenses dashboard density in Admin and nowhere else, and shared
chrome is how that density leaks. It is not `PublicLayout` either. Build it, with the wordmark,
the four-chapter rail, and the story drawer.

`Drawer.tsx` is already Radix `Dialog` — portal, overlay, focus trap, Escape, backdrop dismiss,
GSAP open/close all work. Use it.

## B2. `PHASE 40` in `proovd.css`

A new dated section at the bottom, one unique prefix, nothing above it edited — the convention
every phase since 25 has followed. **Verify the number** rather than trusting this brief:

```bash
grep -oE "PHASE [0-9]+" frontend/public/proovd.css | sort -u -V | tail -1
```

It has moved three times in two days. `.fd-` is proposed; check it against `.pc-` (33), `.ff-`
(34), `.cr-` (26/32), `.cf-` (31), `.mny-` (36) and the Creator flow's (39).

## B3. The chapter router and the address

`?chapter=` in the URL, not component state — DNA §5.12, and the reasoning `routes.tsx` already
records for the draft flow: a URL is the cheapest durable position. `/campaigns/:campaignId/home`
is the address, so the flow's existing link and every §27 email that points there keep working.

## B4. The handoff

Nothing arrives by query parameter. `type`, `effort`, `upfront`, `day` and `phase` all come from
the campaign row and its records — the §9 type, the §12 high-effort classification,
`founder_fixed_payment_openness`, `campaign_live_at`/`campaign_close_at`, and `campaigns.status`.

## B5. Fix `/support`

`routes.tsx:368` puts `support` inside the **admin** group. `/support` therefore 404s — and it is
the `getHelp` target in every Founder Flow step, in the global `ErrorBoundary`, and in §20's Act
ranks 1 and 3. §27.1's sixth question is currently answered with a broken link across the whole
product.

Give it a real destination. The Founder's support path is §26.7's case machinery, which already
has a reference, an owner, and §27.8's business-day promise.

## B6. Session B done when

- The four chapters render, are addressable, and survive a reload.
- The flow's `LiveStep` lands in the shell.
- **`/support` resolves for a Founder**, and every existing `getHelp` reaches it.
- §33.11.1–7 pass with the new route registered in `PRINCIPAL_FLOWS` and fixtured.
- A browser pass at 1280 and 320.

---

# SESSION C — Chapter 1, Choose

## C1. The roster and the three responses

`listFounderVisibleRoster` returns **seven columns** and is byte-for-byte frozen: association id,
public handle, subtype, audience niche, audience size, Admin bio, status. No email, no legal
name, no quality tier, no percentage. The card renders those and the §14.5 status vocabulary.

The three responses go through the one existing route,
`POST /api/founder/proposals/:versionId/respond` with `accept | decline | revise`. There is no
version to respond to until the Creator makes one.

**A revision cannot go to or below base.** `validateProposalAgainstCell` refuses it by name — the
only downward exit is decline. A free slider will produce refusals the Founder cannot act on, so
the control's range starts above base and ends at the ceiling.

`PENDING_PROPOSAL_NOTE` — a pending proposal is interest, not acceptance — renders where §14.5
puts it.

## C2. The bonus

§14.3's Creator-specific bonus through the existing route: trigger unit, threshold, additional
percentage. No rate field. It is measured against the **locked agreement's** total where one
exists, and the refusal names the largest available bonus.

## C3. The onboarding steps that survive

`effort` (read-only over the §6 base settings) and `refunds` (the §24.10 policy URL). The
password step is dropped; the community step is disagreement 7.

## C4. The meeting request — deviation 1

§22.9's shape exactly: one message at request time, immutable, one response, no thread, no reply
route, no second message. Routed through Proovd. One §27 key, through the full five-part chain.
**No slot picker and no calendar** — §12's Cal.com is the one scheduler.

## C5. Session C done when

- No control selects, deselects, orders, or sends the roster.
- A revision at or below base is refused, and the surface does not offer one.
- The rendered chapter contains no `affiliate`, no `upfront`, and no ranking.
- The meeting record cannot hold a second message — asserted, not intended.
- §33.11 passes; `/roster` and `/creator-readiness` redirect here.

---

# SESSION D — Chapter 2, Live

## D1. Glance, Act, Explore

`readCampaignHome` already composes all three. **The receipt is the trap** — `readGlance` issues
a `campaign_home_deliveries` row carrying the count it rendered and advances nothing;
`acknowledgeDelivery` advances to *the receipt's* count, never the count at acknowledgement time.

A dashboard that re-reads on every chapter change must not mint a receipt per read.
`GET .../home/explore` exists precisely so a refresh does not, and the acknowledgement stays in an
effect that runs after React commits, guarded by a ref.

The caught-up ending renders §20's exact sentence and **no manufactured CTA** — there is nowhere
to add one.

## D2. The live-editing tiers get their first UI

One route, `POST /api/founder/campaigns/:id/live-edit`; the field's tier decides whether it
writes, routes to review, or refuses. Do not add a second write path and do not let the surface
choose the tier — that is what makes "material edits cannot publish directly" structural.

A `requires_review` field renders as a change request with its reason. A `never_direct` field
renders its refusal and opens nothing.

## D3. Updates

§18 through the existing `postUpdate`, with the audience rule and the prior/revised pairing for a
material delivery change.

## D4. Session D done when

- One chapter render mints at most one Glance receipt, asserted by counting rows.
- Every editable field routes by its register tier; a `never_direct` field opens no request.
- `/home` keeps its address and `/updates` redirects here.
- No ranking anywhere in `creator_results` (disagreement 2).

---

# SESSION E — Chapter 3, Get paid

§21's retry window, §22.3's W-9 and payment schedule through the ONE `readFounderPaymentStatus`
resolver, §22.4's Day 14 checklist and its durable receipt, §22.5's four obligations.

Every amount is read, never recomputed — §33.8.13 is one source and many renderers, and this
chapter is a renderer. `blocked` always names its requirement; §22.3's vocabulary has no `held`.

`/results` and `/fulfillment` redirect here.

**Done when:** the Founder payment payload here and the Admin queue's deep-compare equal; no
arithmetic on money exists in the chapter's source; `EARLY_RELEASE_NEVER_SKIPS_DAY_14` renders
where §22.3 puts it.

---

# SESSION F — Chapter 4, Wrap, and the Backers page

## F1. Completion and what follows

§22.8's five criteria as recorded findings, §22.9's work-again request — **`NextCampaign.tsx`
already renders §22.10 and is not routed anywhere**, so route it — §22.10's two independent gates
and the cooldown computed on every read, §31.8's progression, §22.11's resolution.

## F2. The §19 operational share finally reaches the Founder

`founder_operational_shares` carries the Backer email and purchase details §19 makes mandatory,
and no Founder route reads it. Add the read. It is fulfillment/support scoped, `do_not_fulfill_at`
is honoured, and a canceled share renders as `canceled / no charge — do not fulfill`.

## F3. The export

§20's Explore section 10. It reads a **Founder-scoped permitted register** — the one line
`const columns = PERMITTED_EXPORT_COLUMNS` is the pattern, including that there is no override
parameter and the caller cannot widen it. It is **not** the Admin route with a `founderUserId`
filter: `listLedger` returns restricted columns by design and sits behind `requireAdmin`.

The withheld columns are named before the button is pressed, which the Explore payload already
does. Identifiable survey answers appear only under §19 step 7's consent, and the export must
answer the objection the ledger register records — that a consent condition cannot travel with a
CSV.

The header column is `Pre-order`, never `Pledge`.

## F4. The Backer data request

Support and fulfillment purposes only; community and marketing refused with their reason on the
screen. A record an Admin decides.

## F5. Session F done when

- The export carries no restricted column, driven and scanned rather than reviewed.
- A `do_not_fulfill` share is never presented as deliverable.
- No marketing-consent column exists anywhere — the `information_schema` assertion still passes.
- `NextCampaign.tsx` is reachable.

---

# SESSION G — Settings

§5.2's panel, whole, at an account-level address.

- **Password**: §5.5's reset ships and stays. An in-app change surfaces
  `POST /api/auth/change-password` only after the §28.1 review `auth.ts` demands. **Do not
  surface `update-user`** — it writes `user.name`/`user.phone`, which is not what any Proovd
  surface renders; the claim profile is.
- **Profile and personal info**: the corrections record, copied from `affiliate_profile_corrections`.
- **Delete account**: one route onto `founder_deletion_requests`. It records an ask and deletes
  nothing — §25.8's retention obligations outlive the account, and the copy must not imply
  otherwise (§1.4). There is no approval state and no purge column; do not add one.
- **Connected account and KYC**: read-only status and id, never the documents (§13).
- **W-9 status**: §22.3's resolver, read.
- **Notifications**: the digest choice and the history. No per-topic toggles (disagreement 11).
- **Profile photo**: a named absence.

**Done when:** every §5.2 item is present or renders why it is not; the corrections record cannot
be written without a reason; `/settings/notifications` redirects here; §33.12.5's partition passes.

---

## Out of scope

- **§15 review, §16 readiness, §17 launch, §14's Creator-side decisions.** The dashboard waits on
  them and renders their state.
- **The Admin workspaces**, except Session A's visual pass.
- **A second scheduler, a second export, a second reset path, a second live-edit write path.**
- **Publishing the policies, configuring R2 or Cal.com.** Track A.
- **Hosted community, Founder browsing of unmatched Creators, direct messaging.** §30.

---

## Traps

- **`PHASE 40` is a guess — run the grep.** The number has moved three times in two days.
- **`/support` is a live bug**, not a dashboard feature. Fix it in B5 or every `getHelp` in the
  product keeps pointing at a 404.
- **The Glance receipt is a two-write split.** Re-reading on chapter change must not mint one.
- **A Founder revision cannot go to or below base.**
- **`listFounderVisibleRoster` is frozen at seven columns.**
- **`POST /api/auth/update-user` is reachable and is the dangerous one.** `delete-user` and
  `change-email` are disabled; keep them that way.
- **`founder_deletion_requests` has `SELECT, INSERT` grants only.** A Founder route inserts; it
  does not get an approval state.
- **`useButtonProgress` must be mocked as a promise, not a callback**, in every new surface test.
  The callback-shaped mock resolves immediately and makes a server-refusal assertion pass for the
  wrong reason.
- **`campaigns.created_at` / `updated_at` are forbidden anchors** (§33.12.1's scan treats reading
  either as the failure). Every date comes from `campaign_live_at`, `campaign_close_at`, or
  `listing_paid_at`.
- **A browser pass finds what jsdom and axe cannot** — every rebuild since 2026-08-10 found at
  least one defect only a screenshot showed. Session A makes this round the highest-risk yet, and
  Chrome headless will not give a real 320px viewport: render inside a 320px iframe.

---

## Done when

- All seven sessions' done-when lists pass, in one run.
- **§33.11.1–7 pass**, with every new route registered and fixtured and every retired one
  redirecting.
- **§33.12.5's partition passes in both directions.**
- The §27 coverage partition still holds, with the two deviation keys sent.
- The bundle scan finds no §3.2 term including in identifiers — specifically no `goal`, no
  `upfront`, no `pledge` — and no `affiliate` in Founder-facing rendered text.
- The seven retired routes still resolve, because §27 emails and Appendix C walks point at them.
- A Founder can walk from the flow's `You're Live!` through all four chapters and settings.
- `CLAUDE.md` records the owner ruling, the two deviations, the three Spec gaps closed, and the
  fourteen resolutions with both sides named.

---

## After this

The Founder shell B1 builds is the product's first non-Admin authenticated chrome. If a later
phase needs one — the Creator dashboard is the obvious candidate, and its own rebuild is already
under way — that is where it goes, not a second one.

The two deviations are narrow and each is recorded. **Neither is a licence for its neighbours on
§30's list.** The meeting record is a request, not a scheduler; the acknowledgement carries no
free text. A later phase asked to add a reply, a thread, a second message, or a Creator search is
asking for the direct messaging and the pool browsing §30 defers, and this brief is not the
licence for either.
