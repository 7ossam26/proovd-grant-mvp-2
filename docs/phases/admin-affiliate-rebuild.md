# Admin Affiliate — rebuilding the workspace to a new reference (post-Phase-24 change)

**This is not a numbered phase.** `docs/master-plan.md` §6's table ends at 24, and §1.1 says a
phase file may never introduce a rule. This brief introduces none: it cites the Spec where the Spec
speaks and, where it does not, it says so in the open rather than manufacturing a citation. It is
the same kind of document the Founders, Creators, Support, Campaigns, Backers, and Tasks workspaces
were each built from — a supplied reference bundle plus the decisions that reference cannot make
for itself. `docs/phases/admin-founders-rebuild.md` is the house style; follow it.

**Model:** Opus 5. The reference decides what this looks like. Almost everything that can go wrong
here is a rule the reference cannot see — and this workspace holds more of them than any other
Admin surface, because it is the one that touches §11's Founder boundary, §29's per-relationship
enforcement, and the one Affiliate Transfer.

**Goal:** The Affiliate workspace looks and behaves exactly like the supplied reference, without
losing a single guarantee the current one holds.

**Reference bundle:** `docs/design-refrence/Proovd-Affiliate-Admin.html` (940 KB, in the repo).
Note the directory's existing misspelling — it is `design-refrence`, and five other bundles are
already there.

---

## Before you start — how to read this bundle

It is a **compiled Vite/React build**, not hand-written HTML. `<div id="root">` is empty, so
reading the markup tells you nothing. There is no source map.

**Read it by running it.** Serve the directory over HTTP and open it in the browser pane —
`file://` URLs are refused by `preview_start`. Then `read_page` for structure and `get_page_text`
for copy. The `<style>` block (lines 9–326, Tailwind v4 plus a hand-written "CRAFT PASS" section
that begins at line 11) is the authority on spacing, colour, and type.

**The fallback, which is how the reconciliation below was produced**, and which is fast enough to
be worth doing anyway as a cross-check:

- The file is 577 lines. Line 355 (134 KB) is React DOM; **line 574 (205 KB) is the application**.
- `grep -o -E 'children:"[^"]{1,120}"'` over line 574 yields **487 JSX text nodes in document
  order**. That is the entire visible UI, in the order it renders.
- The structural registers sit at the very top of the app code, ~1.7 KB in: `Vj` is the tab list,
  `Gj` the tab→sections map, `Hg` the seven first-post checks, `Xj` the four evidence categories.
- Seed records begin at `{id:"AF-1048"` and carry the full Affiliate shape; `Ga({...})` builds each
  campaign relationship.

**The reconciliation below is a first pass, dated 2026-08-17.** Re-walk the reference for your own
session's sections before writing code. Where this brief and the bundle disagree about a label, the
bundle wins; where the bundle and the Spec disagree, see the §1.8 section.

---

## Read first

Do not work from this brief's paraphrase of them.

- **§26.1** — the Admin fields for an Affiliate row. It is a field list, not a section structure;
  it does not define the eight tabs and never will.
- **§8** — recruitment, the nineteen recorded facts, and the sentence that decides the tier
  question: the internal quality tier is *assessment data, not a commission floor*.
- **§5.3** — the seven subtypes and the verification evidence each one owes.
- **§11** — the compact signup, and the Founder boundary: the Founder cannot contact the Affiliate
  directly or inspect sensitive onboarding data. Also the Creator's right to *correct* prefilled
  public information, which is what gap 9 rests on.
- **§13, §25.7** — what Proovd stores about a connected account, and what may leave the building.
- **§12** — object storage, the evidence rules, and what makes a file qualify.
- **§16, §17** — the thirteen-item readiness checklist and the first-post verification.
- **§22.1, §22.8** — the completion decision and the five criteria; §22.8's fourth is an absence.
- **§24.7** — the fixed Creator payment as a fourth money stream.
- **§25.6, §25.8** — audit capture and retention.
- **§26.7, §26.8, §27.8** — support cases, the composed timeline, and the published response
  promise. Gap 7 routes into these rather than beside them.
- **§27** — the notification inventory. Two keys are added here; read §27.4 for their shape.
- **§29** — enforcement per *relationship*, the five customer-facing statement fields, the
  five-business-day appeal, and the seven actions — two of which (`demote`, `restrict_bidding`)
  are what "Proposal access" is derived from.
- **§1 rules 2 and 6, §1.1, §1.4, and §1.8** — rule 2 is why a reference may compose surfaces
  differently; rule 6 is what it may not invent; **§1.8 is why the Spec wins when they disagree**.
- **§3.1, §3.2, §33.11.3** — the naming registers, and the scan that reads the *built bundle*.
- **§33.11, §33.12.5** — accessibility, and the gated/ungated Admin write partition.
- **DNA §5.2, §5.12, §5.14** — Explore as a first-class space, URL-held view state, Glance/Act/
  Explore staging.
- **`CLAUDE.md`** — the "Creators workspace was built" section records why the current surface is
  shaped the way it is. Several of its decisions are load-bearing and are restated under Traps.

---

## Prerequisites

- Phases 00–24 complete, and the five Admin workspaces (Founders, Creators, Support, Campaigns,
  Backers) plus the Tasks panel.
- **The Founders rebuild lands first.** It is in flight: migration `0047` is on disk and
  `backend/src/db/schema/invitations.ts` is modified. This work takes `0048`, and its shell
  decisions assume the Founders rebuild has settled PHASE 31.

---

## What exists today — the inventory this rebuild replaces

### Backend

| File | Lines | Owns |
|---|---|---|
| `backend/src/affiliates/workspace/types.ts` | 359 | The type contract; no runtime code |
| `.../labels.ts` | 331 | Vocabulary restated from shared (the `rootDir` constraint), drift-tested |
| `.../directory.ts` | 635 | `gatherCreatorFacts`, `deriveCreatorAttention`, `listCreatorDirectory`, `listAssignableCampaigns` — six batched queries, `inArray` fan-out, nothing in a loop |
| `.../record.ts` | 913 | `readCreatorWorkspace` — the only export |
| `.../relationship.ts` | 962 | `readCreatorRelationship` — four panes, sixteen reads in one `Promise.all` |
| `.../history.ts` | 579 | `readCreatorHistory` — composes fifteen tables, **writes nothing** |
| `.../mutations.ts` | 504 | Five writes, each ending in a full re-read |
| `.../audit-actions.ts` | 53 | Six action names + titles |

`backend/src/routes/admin-creators.ts` — **10 routes**. Two (`assign-campaign`,
`deletion-request`) are registered in `UNGATED_ADMIN_WRITES` (`shared/src/qa/system.ts:524`).

### Shared

`shared/src/admin/creator-workspace.ts` (651 lines). The registers that must not silently break:
`CREATOR_DIRECTORY_FILTERS`, `ADMIN_ASSOCIATION_STATUS_LABELS` (total over §23.4's nineteen),
`VERIFICATION_STATE_LABELS`, `PAYOUT_STATE_LABELS`, `CREATOR_ACCOUNT_STATES`,
`CREATOR_ACCESS_ACTIONS`, `CREATOR_ATTENTION_KINDS` (ten, priority-ordered, each naming its source
table), `PROVENANCE_BADGES`, `SUBTYPE_METRIC_LABELS`, `CREATOR_HISTORY_CATEGORIES`,
`ADD_AFFILIATE_STEPS`, `CREATOR_PARKED_MESSAGES`.

Seven pinned sentences: `FIXED_CREATOR_PAYMENT_LABEL`, `FIXED_PAYMENT_FUNDED_IS_NOT_PAID`,
`ADMIN_CANNOT_ACCEPT`, `SALES_ARE_NOT_A_COMPLETION_REQUIREMENT`, `FIRST_POST_RELEASES_ZERO`,
`ATTRIBUTION_FOOTNOTE`, `FOUNDER_NEVER_SEES_THIS`.

### Frontend

`frontend/src/features/admin/creators/`, ~7,200 lines:

| File | Lines | | File | Lines |
|---|---|---|---|---|
| `api.ts` | 894 (30 functions) | | `CreatorsDirectory.tsx` | 409 |
| `CreatorProfile.tsx` | 512 | | `PostReview.tsx` | 399 |
| `CreatorControls.tsx` | 454 | | `CreatorRecord.tsx` | 381 |
| `CreatorRelationship.tsx` | 359 | | `shared.tsx` | 245 |
| `CreatorSearch.tsx` | 185 | | `CreatorHistory.tsx` | 182 |
| `parked.ts` | 53 | | | |

Plus `dialogs/` (10 files, ~2,300 lines) and `panes/` (`RelOverview` 333, `RelAgreement` 233,
`RelContent` 285, `RelMoney` 271).

`ConfirmDialog` and `DialogShell` are imported from `../founders/dialogs/` and are shared by six
workspaces. **Changing them changes all six.**

### Tests — 141, and there is no third option

| Suite | Tests |
|---|---|
| `backend/src/tests/creator-workspace.test.ts` | 33 |
| `backend/src/tests/creator-workspace-registers.test.ts` | 21 |
| `backend/src/tests/creator-relationship.test.ts` | 17 |
| `frontend/src/features/admin/creators/creators.test.tsx` | 40 |
| `frontend/src/features/admin/creators/relationship.test.tsx` | 30 |

A test that fails after your change is either a defect you introduced or an assertion that has
become wrong because the product changed on purpose. Fix the code, or update the assertion **and
say why in the commit**. Deleting it is not the third option.

### Data

Migrations run to `0047_founder_record_reference_and_meeting_notes.sql` (the in-flight Founders
rebuild). **Next free is `0048`.** Affiliate tables today: `affiliate_prospects`,
`affiliate_invitation_sends` (0008), `affiliate_signup_profiles` (0010), `affiliate_transfers`
(0030), `affiliate_enforcement_actions` / `_appeals` / `affiliate_conflict_disclosures` /
`affiliate_self_preorder_disclosures` (0033), `affiliate_access_actions` /
`affiliate_deletion_requests` / `_reviews` (0044).

There is **no** `affiliate_ghost_bans` and **no** `affiliate_history`. Both absences are deliberate
and documented; neither becomes writable here.

### CSS

`frontend/public/proovd.css`, **PHASE 26 at lines 2870–3952**, every new selector `.cr-` prefixed.

**Verified 2026-08-17: no file outside `features/admin/creators/` uses a `.cr-` class.** PHASE 26
is therefore affiliate-only and may be **edited in place** — which is the opposite of the Founders
rebuild's answer, and for a stated reason: PHASE 25 is the shared Admin shell that five later
banners build on, whereas nothing builds on PHASE 26. Later banners mention it only in prose.

---

## The reconciliation — first pass, 2026-08-17

### The shape: 8 tabs and 25 sections, against today's 5 panes

| Tab (`Vj`) | Sections (`Gj`) |
|---|---|
| **Overview** | — (composed; no sub-sections) |
| **Profile & Verification** | Profile · Audience & Metrics · Verification · Internal Context |
| **Account & Payout Setup** | Account & Eligibility · Agreements · Stripe |
| **Campaigns** | Relationships · Opportunities & Negotiations · Readiness & Active · Completion & Work Again |
| **Content & Compliance** | Posts · Deliverables · Agreements & Disclosures · Risk & Compliance |
| **Performance & Earnings** | Performance · Earnings · Transfers & Payouts · Adjustments |
| **Support & Enforcement** | Support · Relationship Requests · Enforcement · Appeals |
| **History** | Timeline · Communications |

Today there are five surfaces — the record page, three separate person-level addresses
(`/profile`, `/controls`, `/history`), and a relationship at its own address with four panes. That
is roughly five to six times the surface area.

### It is an evolution, not a redesign — and that is the most useful finding

The reference reuses the current build's own copy verbatim: `Affiliate workspace`,
`Clear Affiliate filters`, `No Affiliates match`, `Active partnerships`, `Public presence`,
`Stripe-owned state`, `Affiliate supplied`, `Admin researched / authored`,
`Evidence + Admin decision`. It also carries this repo's own §1.8 resolution — it says
**"Fixed Creator payment"**, not the previous reference's banned "upfront fee" — and it pins
`Funded means the campaign-specific fixed Creator payment allocation is funded. It does not mean
the Affiliate was paid.`, `Admin cannot accept for either party.`,
`Sales performance is not a completion requirement.`, and `First-post review releases $0.`

So the directory and the record band are close to unchanged. **The work is the eight-tab record and
the sections inside it**, not a re-skin of what exists.

### The architecture: account level and campaign level, stated by the reference itself

The reference prints its own organising rule: **"Account data stays separate from campaign-specific
state."** Person-level tabs sit beside a **"Selected relationship"** — with its own Relationship ID,
Designation, Lifecycle state, Current owner, Agreement, Tracking link, and Completion state — which
scopes the campaign-facing tabs (Campaigns, Content & Compliance, Performance & Earnings, and the
relationship half of Support & Enforcement).

That replaces today's separate `/relationships/:associationId` address and is the single largest
structural change. It is also the change most likely to be got subtly wrong: the three ids stay
distinct — `prospectId` is the person, `associationId` is one campaign relationship,
`claimedUserId` is the Better Auth account — and **`campaign_affiliate_associations.affiliate_id`
holds the PROSPECT id**, not an account id.

### §1.8 conflicts found in the first pass — all of them in one place

**The Spec wins on every line below.** When you implement one of these, record the disagreement and
the resolution in `CLAUDE.md` in the house style — one paragraph, naming both sides.

| # | The reference shows | The rule | Resolution |
|---|---|---|---|
| 1 | An invitation lifecycle step **"Opened"**, between Delivered and Signup started | §27 ships no tracking pixel. Phase 23b refused an email-open metric outright, because it puts a silent read receipt inside a transactional message, and recorded that refusal in §31.9's secondary set | **Not built.** The step renders as absent *with its reason*, the way §31.9's entry states which half is missing rather than reporting the metric as available |
| 2 | An Admin panel reading **"Affiliate operations · MFA active"** | The Admin second factor was removed 2026-08-10 by product direction. `requireFreshSession` is now the only control between a stolen session and a money-moving action | The panel shows the **reauthentication freshness that exists** (the reference already renders `Recent reauthentication` beside it — keep that, drop the MFA line) |
| 3 | **Tier A / B / C** as a closed dropdown, in three places | §8: the tier is assessment data and **explicitly not a commission floor**. `affiliate_quality_tier_not_numeric` refuses a bare number. `CLAUDE.md` records that naming tier levels would invent an eligibility scheme §8 does not state | `quality_tier` stays **free text**; the three are offered as *suggestions* (a combobox with a free-text fallback), never an enum. `QUALITY_TIER_HELPER` already says why and rides the control |
| 4 | **Proposal access: Standard / Restricted**, with a control to set it | A stored eligibility flag is §1 rule 6 — and it would be the one field a later phase could read to refuse a proposal automatically | **Derived**, never stored: §29 already has `restrict_bidding` and `demote` in `AFFILIATE_ENFORCEMENT_ACTIONS`. "Change internal tier or proposal access" records a §29 action with its five customer-facing statement fields; the badge reads the latest one. **No new column** |
| 5 | **HEIC** in `PNG, JPG, WEBP or HEIC · multiple pictures allowed` | `ALLOWED_IMAGE_TYPES` is PNG/JPEG/WEBP/GIF, and browsers cannot render HEIC — a stored HEIC is a file nobody can review | Dropped from the copy. The sentence names what the server actually accepts |
| 6 | **"Red flags"** as a field label | §3.1 naming; the column is `sanctions_notes` | Label maps onto the existing column. No migration |
| 7 | **"Why this Affiliate fits"** returns as a visible field | The *previous* reference's acceptance audit banned `>Why fit<` by name, which is why `campaign_fit` was made nullable and its required-ness dropped | **No conflict** — the column exists and is still written and rendered. Restore the control. Record the reversal in `CLAUDE.md` so it does not read as drift |

**Item 4 is the one most likely to be missed**, because the reference's treatment is *thoughtful*:
it groups tier and proposal access under "Admin-owned classification and policy access" and gives
the control a recorded reason. It is well-designed for a stored field this product must not have.
Deriving it costs nothing — the enforcement record is richer than a boolean — and it keeps the one
number a future phase could multiply by out of the schema.

### What is new, and whether a record already holds it

Most of the reference is a **restructure of data that already exists**.

| Reference element | Backing today | Verdict |
|---|---|---|
| Profile, Audience & Metrics, Internal Context fields | `affiliate_prospects` (all columns present) | **Exists** |
| Account & Eligibility, representations, claim | `affiliate_signup_profiles` | **Exists** |
| Agreements (Terms, AUP, per-campaign IP, consent owner) | `policy_consents` + `policy_versions` | **Exists** |
| Stripe block | `stripe_connected_accounts` | **Exists** |
| Relationships, Designation, Lifecycle, Owner | `campaign_affiliate_associations` | **Exists** |
| Opportunities & Negotiations (versions, bilateral state) | `proposal_versions`, `association_compensation_agreements`, `creator_bonuses` | **Exists** |
| Readiness & Active | `gatherCreatorReadiness` — derived, never stored | **Exists** |
| Completion & Work Again | `creator_completion_decisions`, `completion/work-again.ts` | **Exists** |
| Posts + the seven checks + version history | `creator_post_submissions` | **Exists** |
| Earnings, Transfers & Payouts, money chain | `creator_earnings`, `_state_history`, `affiliate_transfers` | **Exists** |
| Adjustments & recovery | §24.8 `refund_cause_allocations` + `applyCauseBasedAffiliateAdjustment` | **Exists** — route, do not rebuild |
| Enforcement, Appeals, disclosures | `affiliate_enforcement_actions` / `_appeals` / conflict / self-pre-order | **Exists** |
| Support cases + the eleven case reasons + SLA clocks | `support_cases` and its three clocks | **Exists** — route (gap 7) |
| Timeline | `history.ts`, composed | **Exists** |
| Communications | `notification_deliveries` + Phase 22c's `history.ts` | **Extends** — read-only |
| Engagement rate as a number (`4.8`) | `engagement_evidence` jsonb; `audience_size` is **text** | **Extends** |
| Per-metric verification decisions (5 metrics) | one `verification_status` for the whole record | **New** |
| Evidence **files / pictures**, per research item | `verification_evidence` jsonb holds text only | **New** |
| Per-deliverable evidence, verification, waiver | nothing | **New** |
| Content-availability verification | nothing | **New** |
| Proposal **mediation note** | nothing | **New** |
| **Active termination request** | nothing | **New** |

### Two things the mock gets wrong that are not design decisions

- The seeded `earningsAmount: 286` sits beside a relationship whose commission percentage and
  captured subtotal do not produce it. Fixture noise; do not reverse-engineer a formula from it.
  The one waterfall is `shared/money`.
- `uploadedAt: "Now · Aug 11, 2026"` is `Date.now()` in a prototype. Every instant on the real
  surface comes from a stored column, and §27.1's timezone rule applies to anything that is a
  deadline.

---

## Decisions taken 2026-08-17, before any code

### 1. All nine parked gaps are built — each through the service that already owns its rule

`CREATOR_PARKED_MESSAGES` (`shared/src/admin/creator-workspace.ts:560`) lists nine deliberately
absent capabilities. The reference asks for seven of them by name. **The decision is to build all
nine.** Each was parked for a stated reason, so the work is not "unpark it" — it is to satisfy the
reason. None of these may become a second path into machinery that already has one.

| # | Key | How it is built | Reuses |
|---|---|---|---|
| 1 | `deliverableEvidence` | New tables: a deliverable, its submitted evidence, its verification decision, and the Founder/Admin waiver. Insert-only receipts in the §22.4 idiom — a resubmission is a **new** record | — |
| 2 | `availability` | New. The period is read from the **accepted agreement**, never invented. The reference's own label is `Agreed campaign availability period`, which is what dissolves the parked message's objection ("the Spec fixes no availability period") — a term both parties accepted is not a period this product made up | `association_compensation_agreements` |
| 3 | `payoutReminder` | Sends the **existing** key `affiliate_connected_account_info_required` (`shared/src/notifications/registry.ts:405`). §27 defines no *new* reminder, and this is the message it already defines for exactly this state | existing key |
| 4 | `stripeRefresh` | Re-reads the account and updates `stripe_connected_accounts` — the Phase 10b precedent, where returning from onboarding re-reads rather than trusting the last webhook. A vendor is a source of events, not truth | `retrieveAccount` (`payments/stripe-client.ts:313`) |
| 5 | `evidenceUpload` | New table + the Phase 09a presign path. Signature covers method, key, content-type **and** content-length; the bytes decide the format, not the declaration; keys derive from ids and a fresh UUID, never a filename; duplicates are a partial unique index on (prospect, checksum) | `storage/object-storage.ts`, `storage/media.ts` |
| 6 | `kitVisuals` | Same storage. Renders the honest unavailable state until the bucket exists | as above |
| 7 | `caseIntake` | Calls **`openSupportCase`** so §27.8's business-day clock, the owner, the waiting party, and the four-fact handoff gate stay in one place. The eleven case reasons map onto §26.7's ten categories plus the free-text subcategory — the Support workspace already made this exact reconciliation | `support/cases.ts:118` |
| 8 | `passwordRecovery` | Reuses the transport, plus a new §27 key `affiliate_password_reset` (audience `affiliate`, `specRef: '§27.4'`), symmetric with the existing `founder_password_reset`. §5.5's non-enumeration protects against an *attacker probing*; an authenticated Admin already knows the account exists, so the oracle does not arise — but the **customer-initiated** ask on the public surface keeps its frozen acknowledgement untouched | `sendResetPassword` (`auth/auth.ts:81`) |
| 9 | `requestCorrection` | New §27 key `affiliate_correction_request` (audience `affiliate`, `§27.4`). §11 gives the Creator the right to correct prefilled public information; a message asking them to is within that right, not a new commercial rule | — |

**Adding a §27 key is a five-part chain, and the coverage suite fails if you stop early**:
the shared `registry.ts` entry, the backend `notifications/events.ts` restatement, a real sender, a
`notifications/catalog.ts` entry pointing at the render function the sender calls, and a template.
`notifications/unsent.ts` and the catalog must partition the registry exactly — a key in neither,
or in both, fails `notification-coverage.test.ts`. Both new keys are money-free and deadline-free,
so §27.2's contract report should pass on the first render; check it rather than assuming.

**`CREATOR_PARKED_MESSAGES` shrinks to whatever genuinely remains.** Do not leave a key in the
register whose control now works — that is the §1.4 failure the register exists to prevent, in
reverse. If all nine close, the register goes with them and the `useCreatorParked` hook goes too.

### 2. Three sessions. Each ships something whole and testable.

| | Scope | Ships |
|---|---|---|
| **A** | The reconciliation document, the directory, the record shell and header, the eight-tab / twenty-five-section navigation with the **Selected relationship** selector, the **Overview** tab, all register changes, and migration `0048` | An Affiliate can be found and opened, and Overview is complete |
| **B** | **Profile & Verification**, **Account & Payout Setup**, **Campaigns** — with gaps 4, 5, 8, 9 and per-metric verification | The person-level record is whole |
| **C** | **Content & Compliance**, **Performance & Earnings**, **Support & Enforcement**, **History** — with gaps 1, 2, 3, 6, 7, plus Adjustments and Communications | The campaign-scoped record is whole |

Start each session by re-walking the reference for that session's sections only.

**Session A writes `docs/phases/admin-affiliate-reconciliation.md`** — every element of the
reference sorted into one of five buckets: *exists*, *extends*, *new*, *register change*, *§1.8
refused*. The previous affiliate bundle shipped a 249-row traceability matrix
(`docs/design-refrence/admin-affiliate-reference/docs/Affiliate-Implementation-Traceability-Matrix.md`);
that is the precedent for how completely this surface is expected to be accounted for. B and C
extend the same document rather than starting new ones.

### 3. What migration `0048` contains

Only what has no record today. Keep it small; six new record families, not sixty columns.

- **`affiliate_evidence_files`** — the §5.3 research evidence, one row per file, carrying its
  category (`channelPermission` / `sponsoredHistory` / `promotionPlan` /
  `similarCampaignPerformance` — the reference's `Xj` register), storage key, checksum, byte size,
  content type, dimensions, who uploaded it and when. `storage_key` immutable by trigger:
  repointing an approved file moves a decision onto material nobody reviewed. Partial unique index
  on (prospect, checksum) over live rows.
- **`affiliate_evidence_verifications`** — the per-metric decision (audience size, engagement rate,
  demographics, channel ownership, newsletter permission basis). Insert-only, latest wins; every
  answer CHECK-required to carry its detail, the §22.3 early-release idiom.
- **`association_deliverables`** + **`association_deliverable_evidence`** +
  **`association_deliverable_decisions`** — insert-only, in the §22.4 receipt idiom. A decision
  carries its outcome, its findings, and who; outcome and findings can never disagree (CHECK). The
  waiver requires a named recorder and a reason.
- **`association_availability_verifications`** — the verification against the agreed term, insert-
  only, storing the term it was checked against so the record cannot be re-read into a different
  answer later.
- **`proposal_mediation_notes`** — insert-only, association-scoped. Admin mediates and **never**
  agrees; there is no acceptance column and `ADMIN_CANNOT_ACCEPT` rides the surface.
- **`association_termination_requests`** — the reference's "Active termination request". Records
  reason, effective time, cause, and money treatment, and the decision. The money treatment is
  CHECK-constrained to §24.8's cause register; it **decides no money** — executing is 20a's
  preview-then-execute path.

Idiom, from 0044/0045/0046: prose header explaining *why*, including what is deliberately absent;
`GRANT SELECT, INSERT` for insert-only tables with `REVOKE UPDATE, DELETE`; `GRANT UPDATE (...)`
naming individual columns where a post-insert write is legitimate; CHECKs for closed value sets,
non-blank required text, and cross-column coherence; `COMMENT ON TABLE` carrying the rule;
immutability triggers that `RAISE EXCEPTION`. Statements separated by `--> statement-breakpoint`,
and a `meta/_journal.json` entry.

**No column added to `affiliate_prospects` for proposal access.** See §1.8 item 4.

### 4. Numbering

- **Migration `0048`.** Re-check `ls backend/src/db/migrations` before writing — the Founders
  rebuild may have added more.
- **CSS: edit `PHASE 26` in place.** Verified above that nothing outside the creators folder uses a
  `.cr-` class. Append a new **`PHASE 32`** banner only for genuinely new component families (the
  eight-tab record chrome, the relationship selector, the evidence uploader). Do not touch
  PHASE 25 — it is the shared shell.

---

## The §1.8 discipline — what "identical" means, and where it stops

The instruction is that the surface match the reference exactly. That is the right default, and it
is how all six workspaces were built. It has exactly three boundaries.

**1. Where the reference and the Spec disagree, §1.8 decides and the Spec wins.**
This is not hypothetical. The *previous* affiliate bundle's own acceptance audit mandated the words
"upfront fee" and refused "fixed payment" by name — while §3.2 lists `upfront (fee|payout|payment)`
among the universally banned terms. The build shipped §3.2's own replacement, and the §33.11.3
bundle scan is what caught it. Seven more are listed above. When you find another: implement the
Spec, and record the disagreement and the resolution in `CLAUDE.md`, naming both sides.

**2. Identical in appearance and interaction, never in mechanism.** A prototype is a prototype.
Replace, every time:

| Reference | This repo |
|---|---|
| in-file `SEED_AFFILIATES` fixtures, `localStorage` | the real API, server-composed |
| `prompt()` / `confirm()` | `ConfirmDialog` from `../founders/dialogs/` |
| DOM-query navigation, `setTimeout` transitions | React Router; GSAP through `MotionProvider` |
| its own `<style>` block, hex literals, Tailwind utilities | `proovd.css` tokens and `--sp-*` |
| a `ME` constant and a flat `ADMINS` array | Better Auth session (`req.authUser`) |
| client-derived status, filters computed in the browser | the server's answer, on the row |
| `URL.createObjectURL(file)` | the presigned R2 upload, and the bytes decide the format |
| `Date.now()` / `Math.random()` ids | database defaults and stored columns |

**3. Refusals that survive the redesign.** `CLAUDE.md` records them and a new reference will ask
again:

- **No account-level Creator ban.** `affiliate_access_actions.action` admits `suspend` and
  `restore` by CHECK, and the absence of a third value is the guarantee. §29 records Creator
  enforcement per *relationship*.
- **No Stripe field is editable.** §13 makes Proovd the holder of a status and an id, never of the
  data behind them. The absence of the route is the enforcement.
- **No "delete everything" action.** `affiliate_deletion_requests` has no `deleted_at`, no purge
  schedule, and no `approved` state, because retention obligations outlive the account.
- **The digest frequency is not Admin-writable.** Only the Affiliate can set it (§27.7, §30).
- **The Founder projection does not widen.** `listFounderVisibleRoster`'s seven columns are §11's
  boundary, and `FOUNDER_NEVER_SEES_THIS` says so on the surface.
- **No money decision moves here.** Finalize / approve / the one Transfer are §22.1's services,
  driven from the close queue, which owns the ordering and the §11 tax gate. A second set of
  buttons would be a second path into the one Transfer per association.

---

## Scope

### 1. The reference, read and reconciled

Produce `docs/phases/admin-affiliate-reconciliation.md` (session A; B and C extend it). Every
element of the reference lands in exactly one of: *exists*, *extends*, *new*, *register change*,
*§1.8 refused*. An element with no verdict is an element nobody decided about.

### 2. The surface

Eight tabs, twenty-five sections, the Selected-relationship scoping, and the directory as the
reference shows them. What is **not** the reference's call:

- **§27.1's six questions** on every waiting, review, payment, recovery, and exception state —
  what happened, what next, who owns it, when the next update is, what can be done now, how to get
  help without losing context. Loading and failure states both owe them (§33.11.7); a loading state
  answers five and names the sixth.
- **§28.5 and §33.11** — keyboard paths, focus order, 44px targets, 320px reflow. The tab rail is a
  hand-built `role="tablist"` with roving tabindex and Arrow/Home/End, as `CreatorRelationship`
  already does, because §26.1's stylesheet uses different markup from `components/Tabs.tsx`.
- **`aria-disabled`, not `disabled`**, for a shown-but-unavailable control, so a keyboard user
  meets the explanation a sighted user can see. `href` and `unavailableBecause` are never both set
  and never both null.
- **View state lives in the URL** — the tab, the section, the selected relationship, and the
  directory's `q`/`filter`. DNA §5.12, and the reason the Campaigns hub's `?q=` link was fixed.
- **`.sr-only` is already defined** (PHASE 27). Do not redefine it.

### 3. Data and API — only what the reference needs

Default is no migration and no new route; §26's existing routers already own most of this. Where a
record genuinely does not exist, see decision 3.

- Every new write is registered in `UNGATED_ADMIN_WRITES` (`shared/src/qa/system.ts`) **or** takes
  `requireFreshSession`. §33.12.5's partition is asserted in both directions, so a new route belongs
  to neither set until somebody decides. Recording research, evidence, or a note is the ungated
  class; enforcement, access, and anything that changes standing takes the gate.
- **The actor is the session, never the body.** `req.authUser`, the `assignToSelf` precedent.
- One `audit_events` row per mutation, in the same transaction, with `prior_value` **read from the
  row** under `FOR UPDATE` — never supplied by the caller (§33.12.4).
- Every mutation ends in a full re-read, as all ten current routes do. No local patching.
- Batched reads with `inArray` fan-out. Nothing inside a loop.

### 4. The one-resolver rule

Numbers that already have a resolver are read from it, never recomputed:
`readFounderPaymentStatus` for §22.3 money, `gatherCreatorReadiness` for the thirteen §16 items,
`resolveAffiliateMoneyStatus` for Appendix B.7, `shared/money` for the waterfall,
`missingEvidence` for the §5.3 gap. A second computation is a second answer.

### 5. Vocabulary (§3.1, §3.2, §33.11.3)

The shell tab stays **Creators**; the workspace's record vocabulary stays **Affiliate**. That split
is the previous reference's own and is preserved: §3.1's risk is an internal name reaching a
*customer*, and nothing here does.

Scan the **built bundle**, identifiers included — `progress.goal` shipped from the Campaigns hub
and the scan is what caught it. `goal` (for a threshold), `pledge`, `donate`, `escrow`, `custody`,
`tranche`, `all-or-nothing`, `upfront (fee|payout|payment)`, `Day 30`. Rebuild `frontend/dist`
first; a stale bundle passes while the code it came from has the violation.

---

## Out of scope

- **The Today tab.** Still the one parked section of the Admin shell.
- **Campaign-level operations.** The routes listed under "What the Campaigns tab inherited" in
  `CLAUDE.md` stay where they are. A campaign answers for its roster; a Creator record answers for
  the person; the two meet at the relationship.
- **The §22.1 money decisions.** The close queue owns decide → finalize → approve → transfer.
- **Provisioning the R2 bucket.** Track A4, and not a coding task. Gap 5 ships correct and refuses
  loudly until it exists — exactly as the §12 workspace does today.
- **Any customer-facing Creator surface.** `/creator/*` is untouched.
- **The two deleted routers.** `admin-close.ts`'s missing routes and `admin-refunds.ts` come back
  with the close and refund surfaces that operate them, not here.

---

## Traps

- **`useButtonProgress` is handed the promise, not the callback.** Mocking it as
  `(el, work) => await work()` looks equivalent and is not: it calls a promise, throws into the
  swallowing catch, and **resolves immediately** — so `ConfirmDialog` reads a refusal that has not
  been assigned yet and closes on a decision the server refused. Every server-refusal assertion
  behind that hook then passes for the wrong reason. `creators.test.tsx` and `relationship.test.tsx`
  were corrected on 2026-08-15 and take the promise. Keep them that way.

- **`campaign_affiliate_associations.affiliate_id` holds the PROSPECT id.** The Creator's account
  identity for a connected account is `affiliate_signup_profiles.claimed_user_id`. Anything keying
  a connected-account lookup off `affiliate_id` routes money at a UUID nobody owns.

- **Pausing a link writes three columns and no more.** `paused_at`, `paused_reason`, `paused_by` —
  the 0020 grant is what enforces it. §18 decides every click against `activated_at`, so moving it
  silently re-decides clicks already in the ledger, including the reason each earned nothing.
  Pausing a **link** is not pausing a **Creator**: the second is §29's action with its five
  statement fields and its five-business-day appeal.

- **A disabled button is not authorization.** Approve is disabled until all seven §17 checks are
  marked as a courtesy; `verifyPost` re-decides from the recorded checklist and its refusal is what
  the Admin reads.

- **Not yet populated is not zero.** A conversion over zero clicks is `null`, never `0%`.
  `estimated` earnings before close are not `US$0.00 earned`. Every unpopulated block names what it
  is waiting for.

- **`history.ts` writes nothing**, every entry names the table it came from, and `audit_events` is
  read through an **allowlist** — an unmapped action is skipped rather than rendered raw, because
  an audit action name is an internal identifier and reading `affiliate.prospect_updated` aloud on
  a support call is the §3.1 leak. Do not add a `affiliate_history` table; §26.8's trap is that a
  second event store that drifts from the first is worse than no timeline.

- **Never read `campaigns.created_at` or `updated_at`** (§33.12.1). `listAssignableCampaigns`
  orders by `campaign_drafts.created_at` for exactly this reason.

- **`ConfirmDialog` and `DialogShell` are shared by six workspaces.** A change to either is a
  six-workspace decision, and the other five have their own suites.

- **The `/` palette searches the server-composed `searchText`.** One source, so the palette and the
  directory can never disagree about what matches. `/` is suppressed inside inputs and textareas —
  without that guard a slash typed into an enforcement reason opens an overlay and eats the
  keystroke.

- **Two writes are already ungated and registered.** If you move `assign-campaign` or
  `deletion-request`, or change their gating, `UNGATED_ADMIN_WRITES` must move with them or
  §33.12.5 fails — in whichever direction you got wrong.

---

## Done when

- [ ] `docs/phases/admin-affiliate-reconciliation.md` exists and every reference element carries one
      of the five verdicts.
- [ ] The record renders eight tabs and twenty-five sections with the reference's own labels, and
      the Selected-relationship selector scopes the campaign-facing tabs.
- [ ] The directory, `/` palette, and record band match the reference.
- [ ] All nine `CREATOR_PARKED_MESSAGES` capabilities work, each through the service named in
      decision 1, and the register holds only what genuinely remains.
- [ ] Gaps 7 and 8 create no second queue and no second reset path — `openSupportCase` and
      `sendResetPassword` are the only ones, asserted.
- [ ] The two new §27 keys complete the five-part chain, and `notification-coverage.test.ts`'s
      partition holds.
- [ ] Evidence upload goes through the Phase 09a presign path; the bytes decide the format; SVG is
      excluded; the surface renders the honest unavailable state while R2 is unconfigured.
- [ ] Migration `0048` is hand-written in the 0044/0045/0046 idiom, with its prose header and its
      deliberate absences stated.
- [ ] No column stores proposal access; the badge derives from §29's `restrict_bidding` / `demote`.
- [ ] `quality_tier` is still free text and the CHECK is unchanged.
- [ ] The invitation lifecycle has no "Opened" step, and says why.
- [ ] No MFA claim appears anywhere on the surface.
- [ ] `affiliate_access_actions` still admits exactly `suspend` and `restore`.
- [ ] `listFounderVisibleRoster` is byte-for-byte unchanged.
- [ ] Every new write is in `UNGATED_ADMIN_WRITES` with a reason, or takes `requireFreshSession`;
      §33.12.5 partitions in both directions.
- [ ] Affiliate CSS is PHASE 26 edited in place plus a `PHASE 32` banner for new families;
      PHASE 25's shell selectors are unchanged.
- [ ] The §3.1/§3.2 scan over the freshly built `frontend/dist` is clean, identifiers included.
- [ ] `npm run typecheck` and `npm test` pass in one run, with all 141 existing creator tests green.
- [ ] `CLAUDE.md` gains a dated section in the house style, recording each §1.8 resolution with both
      sides named, the nine gaps and what closed them, and the `whyFit` reversal.

**Acceptance:** this rebuild has no named §33 test, because §33 tests the Spec and the Spec does not
name an eight-tab Affiliate workspace. The tests that will catch a mistake are **§33.11.3** (the
built-bundle vocabulary scan — it caught `progress.goal`), **§33.12.5** (the gated/ungated
partition — it caught thirteen unguarded Admin writes), **§33.12.1** (the campaign-anchor scan), and
the §27 coverage suite (the registry partition). Run the whole suite, not the creator files.

---

## After this

`Today` remains the only parked section of the Admin shell. The Backer pre-order still has no
record page of its own, so the Tasks panel's Backer reference and the Support workspace's pre-order
link stay shown-but-unavailable with their reasons — both were built so closing that gap is a value
change rather than a surface rewrite.
