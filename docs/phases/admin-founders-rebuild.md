# Admin Founders — rebuilding the workspace to a new reference (post-Phase-24 change)

**This is not a numbered phase.** `docs/master-plan.md` §6's table ends at 24. It is the same
kind of document the Founders, Creators, Support, Campaigns, Backers, and Tasks workspaces were
each built from — a supplied reference bundle plus the decisions that reference cannot make for
itself. `docs/phases/admin-tasks.md` is the house style; follow it.

**Model:** Opus 5. The reference decides what this looks like. Almost everything that can go
wrong here is a rule the reference cannot see: the Founders tab is the **oldest** of the six
Admin surfaces, five of them were built against its stylesheet, and three of its refusals are
load-bearing.

**Goal:** The Founder workspace looks and behaves exactly like the supplied reference, without
losing a single guarantee the current one holds.

**Reference bundle:** `docs/design-refrence/Proovd-Founder-Admin.html` (783 KB, in the repo).

---

## Before you start — how to read this bundle

**It is not a hand-written prototype like the other four.** Support and Tasks were single-file
HTML/CSS/vanilla-JS with readable markup and real reasoning in their comments. This one is a
**compiled React bundle**: `<head>` carries ~4,000 lines of readable CSS (lines 8–4025), and
`<body>` is minified JS that generates every element. There is no markup to read and no author
comments to mine.

So read it by **running it**. `file://` is blocked for the preview tool, so serve the file over
HTTP from a throwaway static server and open it in the browser pane. Use the accessibility tree
(`read_page`) for structure and
`get_page_text` for copy — both are far more reliable than grepping minified JS. The CSS block
is readable directly and is the authority on spacing, colour, and type.

The reconciliation below was produced this way on 2026-08-16. **Re-walk it before building** —
it covers the directory, the Overview, the full section map, and one deep read of the
highest-stakes section, not all 21 sub-tabs.

---

## Read first

Read these before writing anything. Do not work from this brief's paraphrase of them.

- **Spec §26.1** — the Founder row's fields. This is the only part of §26 that speaks to this
  surface, and it is a field list, not a layout.
- **Spec §7** — prospect creation, the nine facts a send stores, the preview gate, the
  no-guarantee text. The invitation pane is §7's surface.
- **Spec §9 and §10** — the vetting answers and their provenance, and the possible-Creator
  result. Read §9 Step 4 in full; it is three sentences and it forbids one control outright.
- **Spec §13, §11, §25.7** — what Proovd stores about a connected account, and what it never
  stores.
- **Spec §22.3, §22.7, §25.8, §26.7** — the money block, the ban, deletion, suspension.
- **Spec §1**, especially rules 2 and 6, **§1.1**'s completeness list, **§1.4**, and **§1.8**
  (which wins when the reference and the Spec disagree).
- **Spec §3.1 and §3.2**, including §3.2's last paragraph about identifiers.
- **Spec §27.1's six questions**, **§28.5**, **§33.11**, **§33.12.5**.
- **DNA §5.2, §5.12, §5.14** and **§5.4**.
- `CLAUDE.md` — the six post-Phase-24 workspace sections, and especially **"The Admin Dashboard
  was replaced, and only Founders was rebuilt"**, which records why the current one is shaped
  the way it is. Every decision in it was paid for once.

---

## What exists today — the inventory this rebuild replaces

Nothing below is scaffolding. All of it is live, tested, and mounted.

### Backend (untouched by a visual rebuild unless the reference needs new data)

| File | Lines | What it owns |
|---|---|---|
| `backend/src/founders/workspace.ts` | 75,619 b | The five-pane composition. Reads records; owns none. |
| `backend/src/founders/history.ts` | 27,523 b | A pure read across ~14 tables. No `founder_history` table. |
| `backend/src/founders/mutations.ts` | 41,452 b | Every write. |
| `backend/src/founders/logic.ts` | 15,526 b | The drift-tested restatement of the shared register. |
| `backend/src/founders/types.ts`, `format.ts`, `audit-actions.ts` | — | Shapes, formatting, the audit allowlist. |
| `backend/src/routes/admin-founders.ts` | 1,413 | **26 routes.** 8 are registered in `UNGATED_ADMIN_WRITES`. |

### Shared

`shared/src/admin/founder-workspace.ts` (560 lines) — the registers. Names you must not break:
`CAMPAIGN_STATUS_LABELS` (**a total map over §23.1's 27 states — typed so a 28th fails the
build**), `FOUNDER_ACCOUNT_STATES`, `FOUNDER_SETUP_STAGES`, `INVITATION_STATES`,
`PROFILE_OVERRIDE_FIELDS`, `FOUNDER_EDITABLE_FIELDS`, `INVITATION_FIXED_CONTENT_KEYS`,
`FOUNDER_HISTORY_CATEGORIES`, `ATTENTION_ACTIONS`, `PARKED_MESSAGES`, and the pinned sentences
(`SUMMARY_IS_NOT_ADMIN_WRITABLE`, `CREATOR_MATCH_CAVEAT`, `CAMPAIGN_TYPE_LOCK_NOTE`,
`DELETION_RETENTION_NOTE`, `DELETION_NO_BULK_ACTION_NOTE`, `IDENTITY_CHECK_HELPER`,
`HISTORY_AUDIT_NOTE`, `REQUIRED_EMAILS_HELPER`).

### Frontend

`frontend/src/features/admin/founders/` — 17 files, ~7,280 lines:
`FoundersList.tsx` (255), `FounderWorkspace.tsx` (910), `shared.tsx` (361), `parked.ts` (56),
`panes/{Overview,Details,Campaigns,Money,History}.tsx` (391 / 238 / 153 / 190 / 110),
`dialogs/{ConfirmDialog,confirms,AddFounderDialog,InvitationPreviewDialog,OverrideEdit,fieldEdit,index}`
(405 / 309 / 141 / 134 / 181 / 102 / —), `founders.test.tsx` (1,371).

**`ConfirmDialog.tsx` is not a Founders file in practice.** It is imported by the Creators,
Support, Campaigns, Backers, and Tasks surfaces. Moving or restyling it is a six-workspace
change. If the reference wants a different confirm treatment, say so explicitly and change it
once, for everybody — do not fork it.

### Tests — 108 of them

| Suite | Tests |
|---|---|
| `backend/src/tests/founder-workspace.test.ts` | 56 |
| `backend/src/tests/founder-workspace-registers.test.ts` | 16 |
| `frontend/.../founders/founders.test.tsx` | 36 |

A test that fails after this work is either a defect you introduced or a rule the redesign
consciously changes. **There is no third option, and "the surface changed" is not a reason to
delete an assertion.** Where an assertion genuinely no longer applies, say so in the commit and
in `CLAUDE.md`.

### Data

Migrations `0039_founder_prospect_intake.sql`, `0040_founder_workspace.sql`,
`0043_prospect_identity_fields.sql`. **Next free migration is `0047`.** Only write one if the
reference needs a fact no record holds — the Support rebuild needed six columns and said which
six; a visual rebuild should need none.

---

## The reconciliation — first pass, 2026-08-16

### The shape: 8 sections and ~21 sub-tabs, against today's 5 panes

| Section | Sub-tabs |
|---|---|
| **Overview** | — (hero, decision card, Founder summary, Current campaign, Recent activity, Discovery & internal context, Next best action) |
| **Onboarding** | Invite & Prefills · Eligibility · Optional Items · Stripe & Listing Fee |
| **Campaign** | Details · Review · Live · Page & Updates |
| **Affiliates** | Relationships · Requests · Performance & Completion |
| **Backers & Demand** | Demand · Responses · Backers |
| **Money & Fulfillment** | Close · Payments · Fulfillment · Refunds & Recovery |
| **Support & Enforcement** | Support · Cancellation · Enforcement |
| **History** | — |

Today: Overview · Details · Campaigns · Money · History. So this is roughly **six times the
surface area**, and it is why the split in step 2 is not optional.

### The architecture is read-and-route, and that is the single most important finding

The obvious fear — that a Founder record carrying Campaign, Affiliates, Money and Enforcement
sections becomes a second door into rules other workspaces own — **does not materialise.** The
Money & Fulfillment → Close pane states the principle in its own copy:

> *"System counts cannot be rewritten. Admin reviews eligibility and exact exceptions."*

and every control on it is a routing verb — `Review close`, `Capture exceptions`,
`Review Idea close`, `Open reconciliation`, `History` — never `Approve`, `Execute`, or
`Capture now`. The Overview's decision card is `Open Campaign → Live`. It also renders
type-aware absence correctly: *"No Product first/remaining-payment pathway renders."*

**This is the Campaigns-hub pattern applied at Founder scope**, and it is compatible with the
repo as built. Preserve it deliberately: the Founder record shows state and routes to the
workspace whose rules encode the action. Any control that would *decide* something here — a
second path into the one Transfer per association, a second threshold decision, a second refund
execution — is out of scope no matter how the mock draws it.

### §1.8 conflicts found in the first pass — all of them in one place

The previous reference asked for three forbidden things and was refused. This one asks again,
plus more. **The Spec wins on every line below.**

| # | The reference shows | The rule | Resolution |
|---|---|---|---|
| 1 | `Edit Problem` on the Founder summary **and** on Onboarding → Invite & Prefills | §9: the Founder's own words. Today there is **no editable key** — an absence, drift-tested | Render read-only with provenance. No key, no route. |
| 2 | `Edit Solution`, same two places | as above | as above |
| 3 | `Edit Founder story` | §12: the Story is an optional item worth US$2 off the listing fee, and the Founder's approval **is** the completing act. An Admin-written story is Proovd's content earning the Founder a discount | Read-only. |
| 4 | A **Competition** block with current text, an `Edit`, and `Record agreed correction` | Competition was **removed from the product** on 2026-08-10 (migration 0042, the simplified-vetting deviation). Nothing collects it; legacy answers render read-only | Render legacy answers read-only where they exist. Build no editor and no correction route. |
| 5 | `Potential audience — 49,000 potentially relevant viewers`, editable, free-form | 0042 replaced this with `views_range`, a **closed list of four ranges** (`VIEWS_RANGE_CHOICES`). §10 also forbids the count reading as a commitment | Render the chosen range. If an Admin may set it, it is the closed list. `CREATOR_MATCH_CAVEAT` must ride any number. |
| 6 | Campaign **Type** filter offers `Idea · Product · Proposed` | §9 locks type to Idea or Product at submission; there is no third type | `Proposed` is the **absence** of a confirmed type, not an enum member. Render it as a derived label; never add it to `CAMPAIGN_TYPE_LABELS`. |
| 7 | `Owner` as a closed dropdown of three named people, and a per-record `Internal owner` | Today `internal_campaign_owner` is free text on `founder_prospects` | A real decision — see "Open questions". If owner becomes a person, it is an FK to `user` and a migration. |

**Item 4 is the one most likely to be missed**, because the reference's Competition block is
*thoughtfully* built — it says "Founder-written first; never a Create-Founder prefill" and frames
the action as recording an off-platform agreement. It is well-designed for a field this product
deliberately stopped collecting six days ago.

### What is new, and whether a record already holds it

| Reference element | Backing today | Verdict |
|---|---|---|
| `FOUNDER RECORD · F-1027` | nothing | **New.** A stable quotable reference; `PVD-`/`D14-`/`RF-` are the precedent (random, no O/0 or I/1). |
| Meeting notes (`Add meeting note`, "1 on file") | `admin_notes` text, `discovery_evidence` jsonb | **New table** — the reference shows dated, titled, attributed entries. |
| `Add research` | `discovery_evidence` jsonb | Probably composable; confirm the shape it wants. |
| Invitation version / `resend count` / `Invite v3` | `campaign_invitation_sends` (append-only, nine §7 facts) | **Exists.** Compose, do not store. |
| Prefill provenance — "original: Admin intake · unchanged" | `draft_field_edits` (field, supplier, edited_by, occurred_at, prior/new) | **Exists**, and this is exactly what it was built for. |
| Two action columns (Admin action / Founder action) | `ATTENTION_ACTIONS` (4 values), one attention chip | **Extends.** The "who owes the next step" model — the Campaigns hub's `blocked`/`clear`/`system` split into two named columns. |
| "No action — review Aug 14" style reasons | `NO_ATTENTION_ROW_LABEL = 'No action needed'` | **Extends**, and it is better: every no-action state carries its reason (§1.4). |
| 6 directory filter cards | today's filters | Register change. |
| ~23 lifecycle labels ("Live · Day 6", "48-hour retry window", "Cooldown · 41 days left") | `CAMPAIGN_STATUS_LABELS`, total over 27 states | Extends the register; keep it total. |

### Two things the mock gets wrong that are not design decisions

- Its money figures do not add up (`$2,856` + `$266.88` ≠ `$3,694.88`). Fixture noise — every
  number comes from the ledger through the existing resolvers.
- `Internal owner` reads `Mina Park` on the Founder summary and `Not recorded` on the Discovery
  panel, in the same record. Two sources in the prototype; there must be one.

---

## Decisions taken 2026-08-16, before any code

**1. Internal owner stays free text for now.** The reference draws a closed dropdown of three
named people and filters the directory by it. `founder_prospects.internal_campaign_owner` is
free text today and stays that way: the surface offers a `datalist` of values already in use, so
an Admin picks rather than types, and no assignment model is invented. §26 does not name one,
and a person-level assignee is exactly the machinery `support_cases` already owns.

*Consequence:* the directory's Owner filter matches on the stored string, and "whose Founders
are these" is not yet answerable. That is a known, accepted limitation — say so on the surface
rather than implying the filter is authoritative. Revisit as an FK to `user` once there is
evidence Admins want assignment; it would need a superseded-at handover row, the `0044`
arrangement.

**2. Three sessions.** Each ships something whole and testable.

| | Scope | Ends with |
|---|---|---|
| **A** | The directory (6 filter cards, search, Type/Owner filters, the five-column table with its two action columns), the record shell and header, the section/sub-tab navigation, the **Overview** section, all register changes, and migration `0047`. | A Founder can be found and their record opened, with Overview complete. |
| **B** | **Onboarding** — Invite & Prefills, Eligibility, Optional Items, Stripe & Listing Fee. The editable core, the invitation compose/preview/send path, and the prefill provenance display. | Every write surface the record has. |
| **C** | **Campaign, Affiliates, Backers & Demand, Money & Fulfillment, Support & Enforcement, History** — the read-and-route sections. | Full coverage; the old panes deleted. |

The seam is drawn where it is because **A and B carry nearly all the writing and all the new
records**, while C is six sections of composed reads plus links into workspaces that already own
their actions. C is the largest by pane count and the smallest by risk.

Start each session by re-walking the reference for that section only.

### What migration `0047` now contains

With the owner decision above, two things remain genuinely new:

1. **The stable record reference (`F-1027`).** A quotable id on the Founder record. Follow the
   `PVD-`/`D14-`/`RF-` precedent: random rather than sequential so it leaks no volume, from an
   alphabet with no `O`/`0` or `I`/`1`, immutable by trigger.
2. **Meeting notes.** The reference shows dated, titled, attributed entries ("1 on file",
   "Earlier · Recorded during intake") and an `Add meeting note` action. `admin_notes` is a
   single text column and `discovery_evidence` is untyped JSON; neither holds a sequence of
   attributed entries. Insert-only, author from the session, and — per §26.8's
   `relationship_touches` precedent — **no `remind_at`, no recurrence, no job that reads it**,
   with the absence asserted in `information_schema`.

Everything else the reference shows is composable from records that already exist. Confirm
against the per-section walk before writing the migration; if the answer is still these two,
`0047` is small.

---

## The §1.8 discipline — what "identical" means, and where it stops

The instruction is that the surface match the reference exactly. That is the right default, and
it is how all six workspaces were built. It has exactly three boundaries, and every previous
bundle hit at least one of them:

**1. Where the reference and the Spec disagree, §1.8 decides and the Spec wins.**
This is not hypothetical here. The affiliate bundle's own acceptance audit *mandated* the words
"upfront fee" and refused "fixed payment" by name — while §3.2 lists `upfront (fee|payout|
payment)` among the universally banned terms. The build shipped §3.2's own replacement, and the
§33.11.3 bundle scan is what caught it. Expect at least one of these. When you find one:
implement the Spec, and record the disagreement and the resolution in `CLAUDE.md` in the house
style — one paragraph, naming both sides.

**2. Identical in appearance and interaction, never in mechanism.**
A prototype is a prototype. Replace, every time:

| Reference | This repo |
|---|---|
| `localStorage`, in-file fixtures | the real API |
| `prompt()` / `confirm()` | `ConfirmDialog` |
| DOM-query navigation, `setTimeout` chains | React Router |
| its own `<style>` block, hex literals | `proovd.css` tokens |
| a flat `ADMINS` array, a `ME` constant | Better Auth session (`req.authUser`) |
| any client-derived status or filter | the server's answer |

**3. Three refusals survive the redesign. All three were requested by the last reference.**
`CLAUDE.md` records them; a new reference will very likely ask again:

- **The §9 setup answers (Problem, Solution) have no editable key.** Not a disabled control —
  an *absence*, so no route can write them however it is called, asserted by the drift test.
  §9 makes Competition the Founder's own thinking, and 0042 removed the question entirely
  while keeping its four locks.
- **The activity summary is read-only, with its reason rendered.** §27.7's digest frequency
  exists only because a person chose it; §30 forbids the product answering for them.
- **The identity check is derived from Stripe's account state, never stored.** §13 forbids
  holding the documents. `IDENTITY_CHECK_HELPER` is the sentence that says so.

And two more the reference will not know about:

- **Never a "change campaign type" control.** §9's type lock is a database trigger; a wrong
  type is archived and restarted. `CAMPAIGN_TYPE_LOCK_NOTE` is pinned for exactly the place an
  Admin would look for one.
- **Never a "delete everything" action.** `founder_deletion_requests` has no `deleted_at`, no
  purge schedule, and no `approved` state, because retention obligations outlive the account.
  `DELETION_NO_BULK_ACTION_NOTE` is pinned.

---

## The trap that will cost the most: PHASE 25 is the shell, not the Founders tab

`frontend/public/proovd.css` lines **1990–2870** are `PHASE 25 — the Founder Admin workspace`.
Read its banner before touching a line. It says, in its own words, that it owns *"the Admin
shell (top bar, view stack, tabs, tables, timeline) **and** the Founder workspace"*, and it
declares **three conventions "because two other tracks build against it"**: the view stack
(`.views` / `.view.is-active`), scoped overrides, and responsive-as-a-correction.

Five later sections restate those conventions verbatim and build on them:

| Section | Line | Workspace |
|---|---|---|
| PHASE 26 | 2870 | Creators |
| PHASE 27 | 3955 | Support |
| PHASE 28 | 4470 | Campaigns |
| PHASE 29 | 5136 | Backers |
| PHASE 30 | 5593 | Tasks |

`.views` alone is used by `AdminLayout.tsx`, `BackersWorkspace.tsx`, `CampaignRecord.tsx`,
`CreatorProfile.tsx`, `CreatorRelationship.tsx`, and `RelationshipOpsDialog.tsx`.

**So:**

- Founder-specific styling goes in a new **`PHASE 31`** banner appended at the end of the file,
  in the house format (`════` header, spec citations, `added <date>`, the three conventions
  restated). Do not rewrite PHASE 25's Founders-specific rules in place unless you are deleting
  them; a rebuild that leaves both is two stylesheets for one surface.
- **If the reference's shell chrome differs from what ships** — a different top bar, a different
  tab rail, a different table — that is a **six-workspace change**, not a Founders change. Stop,
  say so, and get it decided explicitly. Silently restyling `.views`, `.tabbtn`, `.chip`, or the
  table rules to match a Founders mock will visually break Creators, Support, Campaigns,
  Backers, and Tasks, and no test in this repo will catch it. The Campaigns build found two
  defects *only* by taking screenshots (§33.11 keeps contrast and reflow on the manual list).
- Never a hex literal, never an arbitrary spacing value, never a second stylesheet.
- Layer bands in use: `.dock` 800, Tasks 850–899, `.drawer`/`.skip-link` 900, `.modal`/
  `.cr-palette` 950, `.scrim` 940, `.toast` 1000.

---

## What has gone stale, and should be fixed while you are in here

The Founders workspace was built **2026-08-10**, before Support (08-13), Campaigns (08-15),
Backers, and Tasks (08-16). Three of its cross-links now describe a smaller product than the one
that exists. Fix them as part of this work — the same way the Campaigns build closed Support's
campaign link on 2026-08-15.

1. **`FoundersList.tsx:229`** renders `{...parked('campaign')}` on the campaign link.
   `PARKED_MESSAGES.campaign` says *"This opens the Campaign workspace — parked for now."*
   The Campaigns workspace exists at `/admin/campaigns/:id`. This should be a real
   `RouterLink`.
2. **`FounderWorkspace.tsx:153` and `:726`** carry the `parked-campaign` attention action, and
   it is a member of `ATTENTION_ACTIONS`. Same fix; the register entry goes with it.
3. **`PARKED_MESSAGES.support`** says the support console is parked. It was built 2026-08-13 at
   `/admin/support`. `PARKED_MESSAGES.tabs` says *"Parked while the Founder workspace is
   built"* — the Founder workspace is built.
4. **`frontend/src/features/admin/founders/parked.ts`'s header comment** says *"The Admin shell
   shows four sections and the Founder workspace is the only one that exists."* There are five
   sections and one parked (`Today`). A future session will read that comment and believe it.

The register entries that remain genuinely parked (`creatorFit`, `photo`, `stripeHosted`) keep
their messages — each names what the destination *is*, which is §1.4's requirement, and the
photo/upload one is Track A4 (`unconfiguredStorage` throws; there is nothing to show).

### The exact call-site inventory, measured 2026-08-16

This is bigger than "fix two messages" — nine reachable sites, not three. Budget for it.

| Key | Sites |
|---|---|
| `campaign` | `FoundersList.tsx:229`, `FounderWorkspace.tsx:727` + `:749`, `panes/Campaigns.tsx:61` + `:104`, and `founders.test.tsx:817` |
| `support` | `FounderWorkspace.tsx:753` |
| `tabs` | `AdminLayout.tsx:235` + `:315`, **`panes/Money.tsx:120`**, and `founders.test.tsx:707` |
| `photo` | `panes/Details.tsx:101` |
| `stripeHosted` | `panes/Money.tsx:55` |
| `creatorFit` | `panes/Overview.tsx:359` |

**`tabs` is doing double duty, and that is the real defect.** It carries *"Parked while the
Founder workspace is built"* for the Admin shell's parked `Today` nav **and** for the W-9 action
button on the Money pane. One message for two unrelated things: the Founder workspace has been
built since 2026-08-10, so the sentence is false in the nav, and it was never about the W-9
surface at all. **Split the key before rewording either.**

**Making `campaign` real needs a `campaignId` at each of its five sites**, which a parked control
never needed. `FoundersList.tsx` already has `row.currentCampaign.campaignId`; the two
`panes/Campaigns.tsx` sites have one; `FounderWorkspace.tsx`'s two need confirming. Check before
assuming a one-line change.

**`support` should route to `/admin/support` filtered to this Founder**, which requires the
support workspace to accept that filter in the URL — the `?q=` lesson again. Confirm the filter
exists before promising the link; otherwise it routes to the unfiltered queue and says so.

**Do not park anything new without a message that names what it is.** If the reference shows a
control this product cannot back, it joins `PARKED_MESSAGES` with a sentence, or it is not
rendered.

---

## Scope

### 1. The reference, read and reconciled

Produce, before building, a short written reconciliation: every element of the reference mapped
to one of — *already exists*, *new and buildable from records that exist*, *new and needs data*,
*conflicts with the Spec (with the §-citation and the resolution)*, or *parked with a message*.
The affiliate bundle shipped a 249-row traceability matrix for exactly this reason. If the new
bundle has one, use it as the input and record where you disagree with it.

### 2. The surface

`frontend/src/features/admin/founders/` — rebuilt to the reference. The five panes may become a
different number, a different shape, or a different navigation model; that is the reference's
call. What is *not* the reference's call:

- **Every state answers §27.1's six questions** through `StatePanel`: loading, empty, waiting,
  failure, unreachable. A failure state that says only "could not load" is not one of them.
- **Keyboard and focus** (§28.5): the tab rail is a real tablist with roving tabindex and
  Arrow/Home/End if the reference uses tabs — the current one is hand-built because §26.1's
  markup differs from `components/Tabs.tsx`. Focus is managed, never trapped in a non-modal.
- **`aria-disabled`, never `disabled`,** on any parked control, so a keyboard user meets the
  explanation a sighted user can see.
- **`.sr-only` is defined once**, in PHASE 27. It went undefined for five days in 2026-08 and
  three controls rendered their screen-reader text visibly; axe cannot catch that.
- **44px touch minimum** is not negotiable, and it deforms round controls — pin every axis
  rather than weakening `--touch`.

### 3. Data and API — only if the reference needs it

Default position: **no migration, no new route.** The composition already reads identity, the
invitation and its overrides, campaigns, money (through the ONE `readFounderPaymentStatus`
resolver), and a fourteen-table history.

If the reference needs a fact no record holds:

- One migration `0047_…`, hand-written in 0045/0046's idiom: prose header recording the
  decisions, `--> statement-breakpoint` after every statement, CHECKs for register membership
  and non-blank text, `GRANT`/`REVOKE` for `proovd_app` with exceptions granted **by column
  name**, write-once triggers, and the `meta/_journal.json` entry.
- Every new write registered in **`UNGATED_ADMIN_WRITES`** (`shared/src/qa/system.ts:470`) with
  a `route`, a `specRef`, and a reason over 60 characters — **or** gated with
  `requireFreshSession`. §33.12.5's partition walks the mounted router with a two-day-old
  session and requires the two sets to partition exactly, in both directions. It is the single
  most likely way this build breaks the suite, and the failure will not be subtle. Eight
  Founders routes are registered today; the four money/enforcement ones (`access`, `ban`,
  `send`, `revoke`) take the gate.
- **The actor is the session, never the body.** `routes/vetting.ts` records what happens
  otherwise: a route that read `googleUserId` from the request could bind a campaign to another
  person's account.
- One audit row per mutation, in the same transaction.

### 4. The one resolver rule

`resolvedRecipient()` in `invitations/service.ts` is read by four places — the preview gate, the
send row, the transport, and the rendered body. **A redesigned invitation pane must call it, not
recompute it.** Four places that must not disagree, or an Admin approves one address and the
message reaches another. The same rule holds for `readFounderPaymentStatus` (§33.8.13: one
source, many renderers) and for the §26.1 status labels.

### 5. Vocabulary (§3.1, §3.2, §33.11.3)

The rendered surface and every payload are scanned for §3.1's internal names (`reservation`,
`affiliate`, `pre_build`, `pre_launch`, …) and §3.2's universal bans (`pledge`, `donate`,
`escrow`, `goal` for a threshold, `all-or-nothing`, `upfront fee`, `Day 30`, …). **§3.2 binds
identifiers too** — a property name survives minification, and §33.11.3's bundle scan caught
`progress.goal` in the Campaigns hub's first draft. Run the built-bundle scan, not just a grep
of `frontend/`: the string that got caught last time lived in `shared/`.

`CAMPAIGN_STATUS_LABELS` staying **total** is what keeps `banned_founder` off a support call.

---

## Out of scope

- **The `Today` section.** Still parked, still the only one.
- **Campaign operations.** The Founders workspace answers for the *person*. Every campaign
  decision — review, readiness, scheduling, launch, live edits, close, earnings, refunds,
  suspend/kill — belongs to the workspace whose rules encode it. `CLAUDE.md`'s
  "What the Campaigns tab inherited" table is the inventory; do not wire any of it here.
- **A second door into money.** Finalizing, approving, and the one Transfer per association are
  driven from the close queue. The Money pane shows state and links out.
- **The Backer record.** A pre-order has no Admin workspace of its own; its facts live on the
  support case and in the §26.5 ledger.
- **Retention for Admin-authored internal content.** §25.8 defines seven windows and none covers
  it. That is a real gap; name it, do not fill it.

---

## Traps

**The five workspaces built against PHASE 25.** Covered above. It is the expensive one.

**`useButtonProgress` takes the promise, not the callback.** `MotionProvider.tsx` records it:
the runtime decides what to wait on with `typeof work.then === 'function'` and substitutes a
1.2-second timer for anything else. **The test mock has the trap in reverse** — mocking it as
`(el, work) => await work()` resolves immediately, so `ConfirmDialog` reads a refusal that has
not been assigned yet and closes on a decision the server refused, and every server-refusal
assertion behind that hook passes for the wrong reason. `founders.test.tsx` carried the wrong
shape until 2026-08-15. Copy the mock from `support.test.tsx` verbatim, where the second
parameter is typed `Promise<unknown>`.

**A disabled button is not authorization.** The send gate is enforced server-side and
re-decided independently on the route; the button state is a courtesy. Same for the §17
checklist and every readiness control.

**`?q=` must live in the URL, not in local state.** The Campaigns hub links into a directory
with a pre-filled search; that promise was broken for four days because the term was component
state. If a redesigned list has a search or filter, it is a URL parameter (DNA §5.12), and a
reset clears every parameter in **one** `setParams` call — two sequential writes each rebuild
from the same closed-over snapshot and the second restores what the first removed.

**Do not denormalise onto a Founder row.** §26.8's trap: a second event store that drifts from
the first is worse than no timeline. The history composes across fourteen tables and every entry
names the table it came from. The same applies to any temptation to cache a campaign's status or
a payment amount onto the workspace payload.

**Not-yet-populated is not zero** (§16a). An unfilled money line says what it is waiting for.
A conversion over zero clicks is `null`, never `0%`.

**`ConfirmDialog` is shared by six workspaces.** Restyle it once or not at all.

---

## Done when

- [ ] `docs/design-refrence/Proovd-Founders-Admin.html` is committed beside the other bundles.
- [ ] The written reconciliation exists, and every reference element is in one of its five
      buckets.
- [ ] The surface matches the reference — verified by **screenshots at 1280px and 320px**, not
      by reading the diff. Two Campaigns defects were invisible to axe and to the test suite.
- [ ] Every §1.8 conflict is resolved toward the Spec and recorded in `CLAUDE.md` naming both
      sides.
- [ ] The three refusals hold: no editable key for the §9 answers (asserted by drift test), the
      activity summary read-only with its reason, the identity check derived and never stored.
      Plus: no "change campaign type" control, no "delete everything" action.
- [ ] The stale cross-links are closed: the campaign link is a real route, `parked-campaign`
      is gone from `ATTENTION_ACTIONS`, `PARKED_MESSAGES` describes the product that exists,
      and `parked.ts`'s header comment is true.
- [ ] Every remaining parked control names what its destination **is**.
- [ ] Founder-specific CSS is a new `PHASE 31` banner; PHASE 25's shell selectors are unchanged,
      **or** a shell change was decided explicitly and all six workspaces were re-checked.
- [ ] All 108 existing Founder tests pass, or each removed assertion is named with its reason.
- [ ] §33.12.5's ungated-write partition passes in both directions, with any new route
      registered or gated.
- [ ] §33.11's QA sweep still renders every principal flow; the built-bundle scan is clean.
- [ ] `axe` passes on the list, the record, every pane, and every dialog.
- [ ] Loading, empty, waiting, failure, and unreachable states each answer §27.1's six
      questions.
- [ ] Keyboard: tab rail operable with Arrow/Home/End, focus managed on every dialog, no trap
      in a non-modal, `aria-disabled` on parked controls.
- [ ] `npm test`, `npm run typecheck`, and `npm run build` pass in one run.
- [ ] `CLAUDE.md`'s Founders section is rewritten with today's date, naming the files, the test
      counts, the §1.8 resolutions, and **the absences asserted by test**.

**Acceptance:** there is no named §33 test for this surface, because §33 tests the Spec and the
Spec does not name it. What it must not do is break one. The four that will catch a mistake here
are **§33.11.3** (the bundle scan), **§33.12.5** (the ungated-write partition), **§33.11.1–2**
(the principal-flow sweep), and **§33.8.13** (one source, many renderers). All four must pass.

---

## After this

`Today` remains the only parked section. The Money & Fulfillment console remains the one
`CAMPAIGN_DESTINATIONS` entry that names its own absence.
