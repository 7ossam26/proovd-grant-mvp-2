# Admin Founders rebuild — the reconciliation (Session A, 2026-08-16)

Produced by walking the rendered reference (`docs/design-refrence/Proovd-Founder-Admin.html`,
served and driven in Chrome — the brief's own method) on 2026-08-16: the directory, the record
in seven contrasting founder states, all 8 sections, all 21 sub-tabs, and all 8 dialogs.
Every element is in exactly one bucket: **exists** (composable from records that exist),
**new-buildable** (new surface/register work over existing records), **new-data** (needs
migration 0047), **§1.8 conflict** (the Spec wins; resolution recorded), or **parked**
(with a message naming what the destination is).

The section map confirmed: Overview · Onboarding (Invite & Prefills / Eligibility / Optional
Items / Stripe & Listing Fee) · Campaign (Details / Review / Live / Page & Updates) ·
Affiliates (Relationships / Requests / Performance & Completion) · Backers & Demand (Demand /
Responses / Backers) · Money & Fulfillment (Close / Payments / Fulfillment / Refunds &
Recovery) · Support & Enforcement (Support / Cancellation / Enforcement) · History — which
has **two sub-tabs the brief's first pass missed: Timeline and Communications**.

---

## The directory

| Element | Bucket | Notes |
|---|---|---|
| Eyebrow `FOUNDER OPERATIONS`, h1 `All Founders`, subtitle | new-buildable | Copy as drawn. |
| `Create Founder` primary action | exists | `AddFounderDialog` exists; the reference's five-step compose is Session B scope (it is the §7 intake + prefills + invitation form the product already has as two surfaces). |
| 6 filter cards (All Founders · Needs Admin · Invited — not accepted · Onboarding · Live · Pre-invite), each count + title + subtitle | new-buildable | A register (`FOUNDER_DIRECTORY_FILTERS`); counts are the SERVER's answer (the Creators-workspace rule — two derivations of "needs Admin" is two answers waiting to disagree). |
| Search (`Founder, email, business, or campaign`) | new-buildable | Must live in the URL (`?q=`), the Campaigns-hub lesson. Server-composed searchText. |
| TYPE filter: All types · Idea · Product · **Proposed** | **§1.8 conflict #6** | §9 locks type to Idea or Product at submission; there is no third type. `Proposed` is rendered as the **absence** of a locked type — a derived directory label, never a member of any type register. Filter matches campaigns whose `type_locked_at` is null. |
| OWNER filter: closed list of named people | **§1.8 conflict #7** | `internal_campaign_owner` stays free text (decision recorded in the brief 2026-08-16). The filter offers the distinct values in use; the surface says the filter matches the stored string. |
| Five-column table: FOUNDER (initials avatar, name, business · email) / TYPE-LIFECYCLE (type chip + lifecycle line) / ADMIN ACTION / FOUNDER ACTION / OWNER / → | new-buildable | The two action columns extend today's single attention chip: "who owes the next step", the Campaigns hub's `blocked`/`clear`/`system` split into two named columns. Every no-action state carries its reason (`No action — draft saved`), which is §1.4 done better than today's bare `No action needed`. |
| ~23 lifecycle labels (`Live · Day 6`, `48-hour retry window`, `Cooldown · 41 days left`, `Invite draft`, …) | new-buildable | Extends `CAMPAIGN_STATUS_LABELS` composition: label stays total over §23.1; the day/cooldown suffixes are derived facts appended at compose time, not new stored state. Pre-claim states (`Invite draft`, `Invite sent`, `Invite delivery failed`, `Pre-invite`) derive from the invitation record, not from `campaigns.status`. |
| `24 shown` count | new-buildable | Server count of the filtered set. |

## The record shell

| Element | Bucket | Notes |
|---|---|---|
| `← All Founders` back link | exists | |
| Avatar initials, `FOUNDER RECORD · F-1027` eyebrow | **new-data** | The stable quotable reference. Migration 0047: random, `PVD-`/`D14-`/`RF-` alphabet (no O/0, I/1), immutable by trigger. |
| h1 name, contact line (business · email · phone) | exists | `founder_prospects` + intake fields (0039/0043). |
| `Idea · locked` chip | exists | `campaigns.type` + `type_locked_at`; `Proposed` when unlocked (conflict #6 resolution). |
| Lifecycle chip (`Live · Day 6`) | new-buildable | Same composed label as the directory. |
| Header actions: `View live campaign` / `Edit Founder` / `Add internal note` / `Account actions` | mixed | View live campaign: real link only when a public page exists (§18 — pre-live campaigns have NO public address, the Campaigns-hub rule; the reference draws it always, which is wrong for pre-live states). Edit Founder: exists (`OverrideEdit`/field edit — Session B refines). Account actions: exists (`founder_access_actions`, ban, deletion). |
| PROBLEM / SOLUTION / BUSINESS summary strip | new-buildable | Read-only compositions; the strip renders derived one-liners, never editable here. |
| `WHERE THIS FOUNDER IS NOW` band + composed label | new-buildable | |
| Section nav (8 sections) + sub-tab rows | new-buildable | Real tablist, roving tabindex, Arrow/Home/End (§28.5). Section in the URL (DNA §5.12). |

## Overview

| Element | Bucket | Notes |
|---|---|---|
| Attention hero (`WHAT NEEDS YOUR ATTENTION NOW?` + headline + facts + freshness line `figures updated Aug 12 at 14:10 UTC`) | new-buildable | Composed from the same records the attention derivation reads today. Freshness reads a timestamp, never "real time" (§30). |
| Decision card (`DECISION TO MAKE` → one routing verb, e.g. `Open Campaign → Live`) | new-buildable | Read-and-route: the primary action NAVIGATES to the owning section/workspace; it never decides. The no-action variant (`NO ADMIN ACTION DUE` / `No action — draft saved` / `Nothing here is blocked`) carries its reason. |
| Founder summary panel (Problem, Solution, Business explanation, Potential audience, Story, Socials, Interview, Account status + status grid: Internal owner, Discovery source, Campaign type, Campaign state, Account claim, Onboarding, Stripe, Listing fee, W-9, Cooldown) | mixed | Status grid: exists (workspace composition + `readFounderPaymentStatus` + onboarding view). Problem/Solution edit: **§1.8 conflict #1/#2** — read-only with provenance; no editable key exists and none is added. Story edit: **conflict #3** — read-only (§12: the Founder's approval IS the completing act). Potential audience `49,000 potentially relevant viewers` editable free-form: **conflict #5** — renders the recorded `views_range` (closed list of four, 0042) with `CREATOR_MATCH_CAVEAT`; never a free number. Business explanation / Socials / Interview / Account status: Admin-editable records that exist (product context, socials via workspace/social profiles, interview booking, account state note). Account status control edits the Admin note, never the derived state. |
| `INTERNAL OWNER` in two places disagreeing (`Mina Park` vs `Not recorded`) | mock defect | One source: `founder_prospects.internal_campaign_owner`, rendered twice from one payload field. |
| Current campaign panel (dark card, campaign facts, both action columns) | exists | Composed: campaign row, build (threshold), reservation counts (17a composition), discovery timing (14b), association count. `PROGRESS` names the **threshold**, never `goal` (§3.2 binds identifiers; the Campaigns hub already paid for this). |
| Recent activity (5 latest events + `View full timeline`) | exists | The composed history, newest 5. |
| Discovery & internal context (discovery source, sourced by, internal owner, where we found them, product context, launch context, audience research, affiliate fit, internal notes, meeting notes) | mixed | All fields exist on `founder_prospects` (0039/0043) except **meeting notes → new-data** (0047: dated, titled, attributed, insert-only entries; `admin_notes` is one text column and cannot hold a sequence). |
| Next best action (`A new off-platform conversation happened` → Add meeting note / Add research) | new-buildable | Meeting note: 0047. `Add research` composes into `discovery_evidence` (jsonb) — confirmed shape: title + findings + source/link. |

## Dialogs

| Dialog | Bucket | Notes |
|---|---|---|
| Create Founder (5 steps: Account & business / Onboarding prefills / Research & internal setup / Optional preparation / Invitation, with `Before you send` checklist and exact-invitation preview) | Session B | Composes the §7 intake + prefill + invitation paths that exist. `Competition stays Founder-written and is never prefilled here` — the reference's own sentence, kept. `INTERNAL OWNER` as closed list → conflict #7 (datalist of values in use). |
| Edit Founder (`EDIT AND VERSION` sheet, reason/context REQUIRED) | Session B | Maps to the existing override/edit machine; every write carries its reason (audit). |
| Account actions (Open support case / Send warning / Suspend campaign / Kill campaign / Ban Founder / Archive account / **Delete prototype account**) | mixed | Suspend/restore + ban + deletion request exist. "Delete prototype account" is the prototype's own naming for the §25.8 deletion **request** — no purge, no `approved` state (`DELETION_RETENTION_NOTE`). Suspend/kill of the CAMPAIGN route to the owning workspace (out of scope here — a second door into §26.7). `Send warning` has no §27 key and no record → parked with a message, or composed as a support case; resolved in Session C. |
| Add internal note | exists | `admin_notes` edit with reason. |
| Add meeting note (meeting date, participants, notes, decisions, follow-up, source — five REQUIRED) | **new-data** | 0047 table columns follow the dialog's required fields. |
| Add research (title, findings, source) | new-buildable | `discovery_evidence` entry. |
| Inline edit (`Click away to save — Esc cancels`) | new-buildable | Only on genuinely Admin-editable fields; the §9 answers, Story, and audience never get one. |
| Preview invite (`Exact Founder invitation`) | exists | `InvitationPreviewDialog` / `resolvedRecipient()` — ONE resolver (brief scope 4). The preview's `Viewer estimate: 42,000 · potential Affiliates: 7` line renders recorded facts with `CREATOR_MATCH_CAVEAT`; the §7 no-guarantee text stays pinned. |

## Sections B and C (inventoried now, built in Sessions B/C)

**Onboarding — Invite & Prefills**: invitation facts (recipient, sender, headline, body, version `Invite v3`, sent, expiration, claimed, revoked, resend count) — all nine §7 facts exist on `campaign_invitation_sends` + `secure_tokens`; versions COMPOSED from the append-only sends, never stored. Prefill provenance ("original: Admin intake · unchanged") — exists, `draft_field_edits` is exactly this. **Competition block with `Edit` + `Record agreed correction` — §1.8 conflict #4, the big one**: 0042 removed the question; legacy answers render read-only; no editor, no correction route. The reference's `Founder-written first; never a Create-Founder prefill` sentence survives as the read-only provenance line.

**Onboarding — Eligibility**: claim facts exist. `DOB SUPPLIED · protected value not shown` / `DOB-DERIVED AGE 18+` — the product records the Founder's own §10 representations (claim profile), not a DOB; render the representation facts. The pane's own rule — `no Admin control can change age, country, acceptance state, timestamp, or version` — matches the repo (consents are records). Acknowledgement rows cite the published version (§29.8's rule; today every document is draft and the pane says so honestly).

**Onboarding — Optional Items**: all five §12 items + per-item validity/discount/history exist (workspace + `campaign_optional_items`). `Mark invalid` = `invalidateItem` (exists, two reasons). `Mark confirmed` on the interview — Admin reconciliation path exists (09a). The hero's `4 of 5 qualify / $8` — composed from the listing-fee calculation.

**Onboarding — Stripe & Listing Fee**: §13 account state (derived, read-only — `Provider identifier hidden`, matches §13/§25.7), listing fee itemisation (exists: `listing_fee_calculations` + `discountLines`), checkout/paid/refund state (exists), `REMINDER DRIP Stopped after payment` — renders the two §6 clocks' state.

**Campaign (Details / Review / Live / Page & Updates)**: read-and-route over `campaign_build`, reviews, live edits, updates, comments. The Review sub-tab's ~34 per-field review items and `Approve campaign` are §15's machine — routes to the owning services; the Founder record does not re-implement review. `Edit` controls on campaign fields follow §20's tier register (one door, `applyLiveEdit`). Type-aware absence (`No Product first/remaining-payment pathway renders`) — matches the register-driven rendering the repo already does.

**Affiliates**: the roster/terms/versions/bonus/readiness panes render §14's records (all exist); `View Affiliate record` links into the Creators workspace (which owns the relationship end to end — CLAUDE.md's seam). Requests (meeting / end-partnership, REQ-1/REQ-2) — **no record exists today**; §22.9's work-again request is the only mediated ask built. Parked or Session C decision with a message; a meeting request is §30-adjacent (no direct messaging) and needs its own design care.

**Backers & Demand**: demand/attribution/movers compose from the click ledger + reservations (17a's counts, 14b's attribution). Responses respect survey consent (§11/§25.7 — the reference's own `Aggregate only` / `Founder research opt-in` chips match). Backers list: reservation facts + support-case references; **no Backer Admin record exists** — rows link to the ledger/support case (the Backers-workspace promise), never a new Backer page.

**Money & Fulfillment**: the read-and-route principle is the reference's own copy (`System counts cannot be rewritten`; `No Admin action can fabricate a post-close or provider outcome`). Close/Payments/Fulfillment/Refunds panes render §21/§22.3/§22.5/§24.8 records through the ONE `readFounderPaymentStatus` resolver and route to `/admin/close`-family surfaces (whose routes are being restored with the close surface — CLAUDE.md records the inventory). The pre-close state (`Nothing is due yet` + why) is §16a's not-yet-populated rule, drawn correctly by the reference. Mock's money figures don't add up — fixture noise; every number from the ledger.

**Support & Enforcement**: support cases exist (16b); rows link into `/admin/support`. Cancellation renders `campaign_cancellations` (§31.6) with `No open request` honesty. Enforcement renders suspension/kill/ban records; the action buttons route to the owning surfaces (account-level suspend + ban exist on this record; campaign suspend/kill belong to campaign operations).

**History — Timeline**: the composed fourteen-table history (exists; every entry names its table). `Add internal timeline note` — **no record exists**; nearest is the audit trail. Parked or folded into internal notes; decided in Session C (a "timeline note" table would be the §26.8 second-event-store trap if done wrong). `Export audit` — §25.7 register-driven export rules apply. **History — Communications**: `notification_deliveries` history (22c's read) + `Compose message` — the §27.2 preview machine (send only through templates that resolve; no free-form send exists and none is added).

## §1.8 conflicts — the ledger (all resolved toward the Spec)

1. `Edit Problem` (two places) → read-only + provenance; no editable key. (§9)
2. `Edit Solution` (two places) → same. (§9)
3. `Edit Founder story` → read-only. (§12 — an Admin-written story is Proovd's content earning the Founder a discount)
4. Competition block with `Edit` + `Record agreed correction` → legacy answers read-only; no editor, no route. (0042 deviation, 2026-08-10)
5. `Potential audience` free-form editable → recorded `views_range` from the closed list; `CREATOR_MATCH_CAVEAT` rides every render. (§10, 0042)
6. Type filter `Proposed` → derived absence-of-lock label; never an enum member. (§9)
7. Owner closed dropdown → free text + values-in-use; the filter says it matches the stored string. (brief decision, 2026-08-16)
8. `View live campaign` always present → only when the campaign has a public page (§18; pre-live = no public address).
9. The reference's directory subtitles and heroes use no banned vocabulary — checked: no `pledge`/`goal`/`upfront`/`all-or-nothing` in any captured view; `PROGRESS` composition must keep it that way in identifiers too (§3.2).

## Mock defects (not design decisions)

- Money figures don't add up ($2,856 + $266.88 ≠ $3,694.88) — fixtures; ledger is the source.
- `INTERNAL OWNER` differs between Founder summary and Discovery panel — one payload field.
- `PUBLIC URL` on Page & Updates shows the community URL — the public URL is the campaign page's.
- Preview-invite dialog shows `SENDER Verde Notes` (the business) where the pane header showed the Admin — the send row's recorded sender is the source.

## What migration 0047 contains (confirmed against the walk)

1. `founder_prospects.record_reference` — `F-` + random alphabet (no O/0/I/1), unique, immutable by trigger, backfilled for existing rows.
2. `founder_meeting_notes` — prospect FK, meeting date, participants, notes, decisions, follow-up, source link, author from session, created_at; insert-only (no UPDATE/DELETE grant); **no `remind_at`, no recurrence, no job** — absence asserted in `information_schema` (the `relationship_touches` arrangement).

Nothing else in the walked reference needs a table or column. Research entries fit `discovery_evidence`. Invitation versions compose from sends. The two action columns are derivations. The six filter-card counts are derivations.

---

## Session A — built 2026-08-16/17

Shipped: migration 0047 (verified against a real Postgres — mint default, shape CHECK,
immutability trigger, two-shape meeting-note contract, retention-sweep join all exercised);
the shared registers (`FOUNDER_DIRECTORY_FILTERS`, `FOUNDER_TYPE_FILTERS`,
`PROPOSED_TYPE_LABEL`, `FOUNDER_NEXT_STEP_LABELS`, `FOUNDER_RECORD_SECTIONS`,
`MEETING_NOTE_FIELDS`, `RESEARCH_ENTRY_FIELDS`, the parked-key surgery, `open-campaign`)
with their `logic.ts` restatements drift-tested; the directory kernel
(`backend/src/founders/directory.ts` — pure, fed identically by the list and the record
header); `composeDiscovery` + `composeCampaignFacts`; `addMeetingNote` + `addResearchEntry`
with routes registered in `UNGATED_ADMIN_WRITES`; the rebuilt directory, record shell with
the eight-section URL-driven nav, and the Overview; PHASE 31 CSS.

**Two more §1.8-adjacent decisions taken during the build, recorded here:**

10. The record's section rail says `Affiliates` — the reference's own word, under the
    Creators-workspace precedent (2026-08-11): the shell says Creators, an Admin RECORD may
    say Affiliate, §3.1's scope is what renders to Founders and Backers. The Founders
    suite's own stricter-than-§3.1 scan consciously dropped `affiliate` from its forbidden
    list, with the precedent named at the constant.
11. The §7 discovery fields render under the record's own vocabulary (Launch frame, US and
    18+ fit, Delivery feasibility, …), not the reference fixture's paraphrase (PRODUCT
    CONTEXT, AUDIENCE RESEARCH) — the recorded §7 field list is the truth about what the
    record holds.

**Session A's honest interims** (each says what it is on the surface): Onboarding hosts the
invitation-and-vetting pane, Campaign the campaigns pane, Money & Fulfillment the money
pane, History the composed history; Affiliates / Backers & Demand / Support & Enforcement
render a panel naming the workspace that owns the work today, with a real link into it.
The identity/standing/deletion block (the old Details pane) renders inside the Overview as
the full-record Explore block — DNA §5.2, and the home of the `sec-access` jump target.
Sub-tab ROWS are deliberately not rendered yet: four tabs that all showed one interim pane
would imply distinctions that do not exist; the register carries the shape Sessions B/C fill.

**What the screenshot pass caught** (both invisible to axe and to the suite): the record
header's four new children being squeezed into PHASE 25's three-column `.fhead` grid, and
the dark Current-campaign panel rendering its values near-black-on-dark — the Campaigns
hub's invisible-pill lesson repeating. Both fixed in PHASE 31 as scoped overrides.

**Conscious test changes, each named in the file:** the detail payload gained `discovery` +
`campaignFacts` keys; the directory's eight columns became the reference's five; the
attention chip became the two action columns; `Reading the Founders list` →
`… directory`; `Add founder` → `Create Founder`; the tablist is `Founder record sections`
with eight tabs; the old campaign-link-toasts-parked test became a real-navigation test;
`PARKED_MESSAGES.tabs`/`campaign`/`support` assertions moved to the split keys.

Suites after the build: backend founder-workspace 65/65 (56 + 9 new), registers 19/19
(16 + 3 new), founder-invitation 51/51, frontend founders 36/36, §33.12.5 partition 20/20,
§33.11 QA sweep 295/295, §33.11.3 bundle scan 15/15.
