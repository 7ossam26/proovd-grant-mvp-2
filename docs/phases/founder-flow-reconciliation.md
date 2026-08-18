# Founder Flow v2 — the walk, the order, and every element reconciled

**Written in Session A, 2026-08-18.** `docs/phases/founder-flow-v2.md` is the brief; this is the
walk it asks for in A1 and the canonical order it asks for in A2. Sessions B through F are scoped
against the order below, not against the reference's own screen numbers.

The reference is `docs/design-refrence/Proovd-Founder-Flow-v2/` — a standalone prototype plus a
20KB handoff `README.md` that is the authority on the design. It was **walked, not only read**:
the prototype was served locally and all fourteen `startScreen` entry points were rendered in
Chrome at 1600×1000, and every visible string in the template was extracted and scanned against
§3.1, §3.2 and §27.1. Two of the findings below exist only because of that — a reader of the
markup would have missed both.

Every element is bucketed into one of five verdicts:

| Verdict | Meaning |
|---|---|
| **as drawn** | Exists today and matches. Session B–F re-presents it. |
| **differently** | Exists today in a different shape or place. The difference is stated. |
| **re-presentation** | A record that already exists, drawn a new way. No schema, no service. |
| **new** | Nothing holds it. Named, with the deviation it costs. |
| **refused** | Drawn by the reference, forbidden by the Spec. The rule is named. |

---

## 1. The canonical order — A2's deliverable

**This is what B through F are scoped against.** The reference's own order is wrong in three
places, and each is refused by code that already exists rather than by an opinion. A screen built
against the wrong router is a screen rebuilt, so the order is decided here, before a pixel.

| Stage | Auth regime | Screens, in order | The mechanism that forces this boundary |
|---|---|---|---|
| **1** | draft token (`requireDraftToken`) | 1 invite · 2 problem · 3 solution · 4 campaign type · 5 email · 6 code · 7–9 the three §9 answers · **17 match** | A draft token is not a session. Everything here writes `campaign_vetting` through `/api/draft/:token/*`, which learns the draft id from the *verified subject* and never from the request (§33.1.1). |
| **2** | the claim itself | **16 your details** → `completeClaim` | §10's account-claim surface. One transaction, `founder_signup_complete` exactly once. Nothing after this stage is reachable without the account it creates. |
| **3** | founder session (`requireRole('founder')`) | 10 visuals · 11 branding · 12 interview · 13 story · 14 socials · 15 last look | The five §12 answers write `campaign_assets`, `campaign_workspace`, `campaign_social_profiles` and `founder_interview_bookings` through `/api/founder/campaigns/:id/*`. Before the claim there is no session and no role. |
| **4** | founder session, money | **25 Stripe** · 20 listing fee | `beginListingCheckout` refuses without a **complete `founder_seller`** account. `campaigns.status` already encodes the order: `stripe_onboarding_pending` precedes `listing_fee_pending`. |
| **5** | post-fee | 18 fixed-payment openness · 21 voice · 22 order threshold · 23 FAQs · 24 rewards · 19 + 26 review → live | Phase 11's effect 4 is what opens the formal Creator opportunity. Before the fee is paid there is no Creator to be open to, and §15's review has nothing to review. |

### The three moves, recorded as moves

A later reader must be able to see that each difference was **decided**, not missed.

**Move 1 — the five §12 answers move AFTER the claim.** The reference puts all eight answers
(7–14) before "Your details" (16). Running Visuals, Branding and Interview pre-account would mean
R2 objects and a Cal.com booking **owned by nobody**, a §12 evidence snapshot bound to no Founder,
and US$10 of listing-fee discount earned before any Terms, AUP or privacy acceptance exists —
which is §28.4's concern and §10's list at once. Reaching them pre-account would need five new
token-scoped routes and five new authorization paths beside the ones that work.

**Move 2 — Stripe moves BEFORE the fee.** The reference draws "Get paid" at 25, after the fee at
20. §13's four connected-account states include, in `CLAUDE.md`'s own words, "the one that offers
*no* path to listing-fee payment". Drawn as it is, screen 20 offers a payment the server declines.

**Move 3 — the match screen moves EARLIER, not later.** §10's own first sentence fixes its timing:
*"Immediately after valid vetting and before account creation, payment, or Stripe onboarding."*
The reference draws it at 17, after details and before the fee. It moves to directly after answer
3. Resist the reading that puts it after the fee because Creators have by then actually accepted —
that is a **different screen**: §14's roster, whose acceptances are real bilateral decisions. §10's
screen is a relevance signal that "is not the recruited/accepted roster" and "names no Creator".

---

## 2. The four reversions — these return to the Spec

On 2026-08-10 the vetting flow was simplified by product direction, and `CLAUDE.md` recorded it as
"a recorded deviation from the Spec, not a defect to 'fix' back without the same instruction."
**That instruction has now been given.** All four are returns to §9 and §10 as written.

| | 2026-08-10 | 2026-08-18 | Authority |
|---|---|---|---|
| Competition / "Positioning" | dropped | required answer 3 | §9 step 4 |
| Campaign path | moved to Admin | the Founder chooses again; **Admin's control stays** and pre-selects | §9 step 1 |
| Possible-creator result | screen deleted | the §10 screen and its read return | §10 |
| `views_range` | added as Competition's replacement | retired **from collection only** | §9 names no such step |

**The one thing that did NOT revert with them is the §10 gate.** §10 orders the result *before*
account creation and says nothing about blocking one. The 2026-08-10 change removed the gate and
this reversion deliberately leaves it removed: a Founder whose result is unrecorded still
proceeds, the screen is skipped, and Admin sees the gap. `§33.1.6 … is a record, not a gate` passes
unchanged for the reason it always did.

**`views_range` retires from collection only.** The column, its CHECK, its `draft_field_edits`
history and every stored answer survive. `0042`'s completeness CHECK still admits **both** shapes —
tightening it to require competition would validate against existing rows on `ALTER TABLE` and fail
on every legacy views-only submission. Competition is required in the **service**, where a refusal
is a sentence a Founder reads rather than a constraint name.

---

## 3. Every screen, reconciled

### Stage 1 — the draft token

| # | Element | Verdict | Note |
|---|---|---|---|
| 1 | Invite claim: pale-blue band, stroked headline, `~3 mins`, HELP, legal line | **re-presentation** | `DraftLanding`'s read of `campaign_drafts` + `founder_prospects`. |
| 1 | `We can get Teeb in front [N] new people` | **refused** | §7 forbids Admin promising results. The prototype's own render leaves the number blank, which is what a promise with no record looks like. |
| 1 | Splash covering the page up to 2.6s | **differently** | `html.no-motion [data-splash] { display: none }` already exists. Capped hard, dismissed by any interaction, never gating a retry — 2.6s of nothing is 2.6s in which §27.1's six questions have no answer. |
| 2–3 | Problem / Solution confirmation, sticker-in-headline, dark panel, custom scrollbar rail, edit toggle that grows the panel and collapses Next | **as drawn** | Renders §9's prefill provenance: Proovd-supplied text is what the Founder sees, editing flips the supplier, a failed save never clears a valid field. |
| 4 | Campaign type: pager → two-row confirm with the FLIP | **re-presentation** | `campaign_vetting.selected_type`. Pre-selected from Admin's discovery answer. **Locks nothing** — the lock is at submission. |
| 4 | `type` rendered as `prebuild` / `prelaunch` | **refused** | §3.1: those never reach a Founder. `CAMPAIGN_PATH_CHOICES[].name` is what renders. |
| 5 | Sign in: address as a live 104px input, dashed brand underline, text greying on focus | **re-presentation** | `founder_claim_profiles.email`. |
| 6 | Six-digit emailed code, auto-advance, resend countdown | **new** | **Deviation 1.** Verifies an email; creates no account and mints no session. Session C, with its screens. |
| 7–8 | Problem / Solution as answers | **as drawn** | Same records and provenance rules as 2–3. |
| 9 | Positioning (`Lets talk about your competitors...`) | **as drawn** | `competition_text`. Always blank, never prefillable — no `competition_prefilled_*` column exists, a CHECK pins the supplier to `founder`, and §33.1.5 tests it. |
| 9, 13 | `Say it instead` — mic row, recording state, 72-bar visualizer | **new** | **Deviation 2**, server-side transcription. Session C. It transcribes; it does not generate, summarize, rewrite or suggest. |
| 17 | Creator match: lockup, cupids, the count, the breakdown | **re-presentation** | `possible_creator_results`, moved to its §10 position. |
| 17 | `3 Affiliates` at 198px — the largest type in the flow | **refused** | §3.1: `affiliate` is customer-facing-banned, replacement **Creator**, and a Founder is a customer. `3 Creators`. |

### Stage 2 — the claim

| # | Element | Verdict | Note |
|---|---|---|---|
| 16 | Your details: legal name, phone, DOB calendar with 18+ validation | **as drawn** | §10's nine listed contents. The 18+ check is a client courtesy over a **recorded representation** — the product derives no age and never claims to have verified one. |
| 16 | `Username:` as the legal-name field label | **refused** | It writes `founder_claim_profiles.legal_name`. §10 collects a legal name; calling it a username misnames the record on the screen that creates it. |
| 16 | `Phone Number:` / `Phone:` — the two branches disagree | **differently** | One source. Phone is collected and explicitly **unverified**; there is no `phone_verified` column and §33.1.8 scans for one. |
| 16 | The three §10 representations | **as drawn** | Three separate controls. §28.4 forbids bundling. |
| 16 | — | **blocked today** | All eight §31.4 documents are `draft`, a consent may cite only a *published* version (a trigger), so `completeClaim` returns `policies_unpublished` and the screen renders the reason. **That is the correct state.** |

### Stage 3 — the five §12 answers

| # | Element | Verdict | Note |
|---|---|---|---|
| 10 | Visuals: 500px upload zone, link row, added-file rows | **re-presentation** | `campaign_assets` (`purpose: 'visual'`), full Phase 09a lifecycle. |
| 11 | Branding: logo upload, HSV picker, hex field, three swatch slots | **re-presentation** | `campaign_workspace.brand_colors` / `brand_typography` / `brand_notes` + `campaign_assets` (`purpose: 'logo'`). |
| 10–11 | — | **absent today** | R2 is unconfigured (Track A4). `unconfiguredStorage` throws; the presign answers 503 naming the gap **and** the payload carries `available: false`, so the surface renders the absence rather than a dead control. |
| 12 | Interview: custom platform tiles and time-slot chips | **refused** | tech-stack §12: "The booking record in our database is the source of truth, populated from Cal.com webhooks." A second picker is a second scheduler and the two would disagree about what was booked. The screen renders the Cal.com embed — a named absence while Track A4 is open. |
| 13 | Story: headline, textarea, dictation | **re-presentation** | `campaign_workspace.story_text` + approval. §12: a transcript, generated summary or unapproved draft **does not count** — the Founder's approval is the completing act. |
| 14 | Socials: four rows, icons as CSS backgrounds | **as drawn** | `campaign_social_profiles`. The CSS-background choice is deliberate and kept: an unresolved value cannot fire a failed request. |
| 15 | Last look: card grid with ADDED / MISSING, the running fee, edit per card | **re-presentation** | The §12 workspace's review step. Jumping into a section returns **here** — a router contract, not a component flag. |
| 15, 20 | `FEE_BASE=35`, `FEE_PER=2`, `FEE_FLOOR=25` as constants | **refused** | Four §6 settings (`listing_fee_base_cents`, `listing_fee_item_discount_cents`, `listing_fee_max_discount_cents`, `listing_fee_min_cents`). The numbers are right and the constants are still a bug — Phase 06's rule: *a hardcoded duration is a bug even when the number is right.* **No fee arithmetic in the browser.** |
| 15 | `optional: $2 discount` per answer | **as drawn** | Reads the §6 setting. |

### Stage 4 — the money

| # | Element | Verdict | Note |
|---|---|---|---|
| 25 | Get paid: `Prepare:` list, three icon rows, `Take me to stripe` | **re-presentation** | §13's hosted onboarding over `beginOnboarding`. The list tells the Founder what Stripe will ask for and **collects none of it** — there is no route that accepts a bank, tax or identity field, and the absence is the enforcement. |
| 25 | Only the happy path is drawn | **differently** | §13 has four states. **Restricted has no resume and no payment control** — it offers a support path. The other three are built here or the fee screen inherits a dead end. |
| 25 | `Payouts ready`, piggy bank, Continue | **as drawn** | |
| 20 | Struck-through original, current fee, savings copy, `Saved $2` toast | **as drawn** | The toast renders a **server-returned** delta and only when a real recalculation produced one. |
| 20 | — | **absent from the reference** | Appendix A.5 verbatim, through `resolveListingFeeConsent`, which substitutes exactly two amounts and throws on any surviving bracket. Tax is a real Stripe Tax calculation against a real billing address, computed **before** the consent. |
| 20 | `Enter` advances the primary action | **refused** | §30 forbids competing actions in a payment state, and a stray keystroke must not authorize a charge. Enter advances only where the page's single control is a one-line input — never on a textarea page, never here. |

### Stage 5 — openness, the build, review, live

| # | Element | Verdict | Note |
|---|---|---|---|
| 18 | Idea explainer / Product pay-structure pager | **new** | **Deviation 3**, the openness record. Migration 0052; see §5 below. |
| 18 | `Upfront fee`, `No upfront fee`, `upfrontAmount`, the modal — 11 occurrences | **refused** | §3.2 bans `upfront (fee\|payout\|payment)` in every audience **including identifiers**, and §33.11.3 scans the built bundle. §3.2's own replacement is **optional fixed Creator payment**. Resolved identically on 2026-08-11 for the Affiliate workspace, where the reference had *mandated* the banned term. |
| 21 | Voice: adjective chips, replacement sheet, `+ add more`, `Tell us more` | **re-presentation** | `campaign_build.brand_voice` — a §14.4-**required** text column that already means exactly this. Nothing minted; see §5. |
| 22 | `Set your order goal` — plus `goalAmount`, `goalInput`, `goalEmpty`, `goalLow`, `goalFilled`, `goalNext`, `goalBoxBg`, `BPAGES[1] === 'goal'` — **65 occurrences** | **refused** | §3.2 bans `goal` for an Idea threshold, and its last paragraph binds identifiers. §33.11.3 reads the *built bundle*, where a prop name survives minification. **This is the third time**: the Campaigns hub hit it with `progress.goal`, campaign-page-v2 with `PRIVATE BETA GOAL`. The headline is `Set your order threshold`, and nothing anywhere — CSS class, prop, state key, register value, fixture, commit message — contains the word. |
| 22 | `(USD)` and `Min. $500` | **refused** | **A walk finding — see §4.** |
| 22 | `…high enough that you and the affiliates are excited…` | **refused** | §3.1, as at 17. Also `belive its`, twice. |
| 23 | FAQs: form left, live preview panel right | **re-presentation** | `campaign_faqs`. Its authoring route shipped 2026-08-18 with campaign-page-v2. |
| 24 | Backer rewards: copy column and card, inline-editable fields, pager, `Delete reward N` below the card | **re-presentation** | `campaign_reward_packages`. |
| 21, 24 | Three rewards maximum, six voice adjectives maximum | **refused** | §14.4 caps neither. A cap is a commercial rule (§1 rule 6) and a Founder with four rewards would be refused by a number nobody agreed to. The three-card pager is a **layout**. If product wants a cap it is a §6 setting with its own decision. |
| 21–24 | — | **differently** | The four steps **do not complete a build**: ten shared fields are required, plus four for Idea or one for Product. Step 24 lands the Founder on `/campaigns/:campaignId/build` with what remains named from `READINESS_FIELD_LABELS`. |
| 19 | `Application in review` + `Our Team will reach out … as soon as we approve you` | **differently** | A second review screen, distinct from 26's. §15 approves a **campaign**, not a person. |
| 26 | `Campaign in review`, three affiliate chips flipping to accepted at 1.5s and 3s, auto-advance after 5s | **refused** | Between a submitted campaign and a live one stand §15's Admin review with its immutable approved snapshot, §14.2's bilateral Creator decisions inside a 72-hour window, §16's thirteen-item readiness checklist and §17's five-step coordinated launch. **None of them is a wait.** The chips flipping are real people accepting real terms. The screen stays and becomes a genuine waiting state answering §27.1's six questions; the timer goes; the chips render the **recorded** association states and do not animate between them. |
| 26 | `Our Team will reach out to you as soon as we get all your affiliates in place` | **refused** | **A walk finding — §3.1 again, a third site the brief did not name.** |
| 26 | `You're Live!` | **differently** | Reachable only from a real §17 launch record. Its button goes to `/campaigns/:campaignId/home`. |
| 26 | `Your content creators are hard at work…` | **as drawn** | `content creators` is not `affiliate`; it reads as a claim about work, so it is re-authored to state what is recorded. |

### Everywhere

| Element | Verdict | Note |
|---|---|---|
| Full-bleed pages, no chrome, wordmark top-left, HELP top-right, message badge bottom-right | **as drawn** | The product's first sequence-of-pages shell. Routes are top-level, outside every layout and guard — twenty-six screens means twenty-six recoverable positions (DNA §5.12). |
| Help drawer: right sheet, one card per page, current first and marked, earlier marked done, tap to jump | **as drawn** | §27.1's sixth question — *how do I get help without losing context* — answered structurally for the whole flow, which is why it belongs in the shell session. |
| Message badge shaking on a loop every six seconds, forever | **refused** | DNA §5.10, §30. An element that moves indefinitely to draw attention is the pattern, whatever it opens. Keep the badge, keep one entrance, drop the loop. |
| Fixed 2496×1542 stage at `scale(0.37)` | **differently** | The README's own option 2: convert to responsive units, ratios as the source of truth, expressed in `--sp-*`/`clamp()`. §33.11.1's 320px reflow is not satisfiable by a scaled fixed stage. |
| `border-radius: 2px everywhere` | **differently** | `proovd.css` sets `--radius: 1px` — "sharp. everywhere." — and drops to `0.5px` under 600px. Same design intent; one of them is already the system. |
| Satoshi 400/500/700/900 static weights | **refused** | `proovd.css` declares two `@font-face` blocks against `Satoshi-Variable.woff2` at `font-weight: 300 900`, and the runtime *verifies* the font loaded. Do not add static weights and do not touch the fail-loud notice. |
| Raw inline GSAP | **differently** | Core, Flip, SplitText and ScrollTrigger are all already vendored. Route through `MotionProvider` / `useProovdMotion` / `useGsapScope` and `components/anim.ts`. The README's motion housekeeping — pruning looping tweens whose targets left the DOM, and the 2.2s stuck-sweep — is good engineering and matches `proovd-motion.js`'s existing 3-second force-reveal. |
| Brand-green fills with `#FAFAFA` text | **differently** | `proovd.css:158`'s hard rule: brand fill takes `--mint`, because `#FAFAFA` on `#41ED98` is imperceptible. Recorded for campaign-page-v2 on 2026-08-18 and it recurs on every green CTA here. |
| Twelve of nineteen reference colours have no token | **differently** | Seven map cleanly. Three are near-duplicates that should resolve to existing tokens unless the difference is load-bearing (`#E7F7EA`≈`--stat-mint-bg`, `#F5F5F5`≈`--grey-lightest`, `#DEF6FF`≈`--accent-blue`). Three — `#B4B4B5`, `#E4E4E4`, `#D6D6D6` — are **neutral** greys where every grey in `proovd.css` is green-tinted; a neutral ramp contradicts the palette across the whole product. Genuinely new: a mid-green ramp (`#8FCBA3`, `#4E8C67`, `#4E785C`) and a yellow pair (`#F4FFA0`, `#FBFFD4`). **Session B decides once, in the `PHASE 34` header.** |
| `Next`, `Back`, `Continue`, `Confirm`, `Done` as the primary control on ~20 of 26 screens | **refused** | §33.11.4's `OBJECTLESS_CTA_LABELS` is exact-match on the trimmed accessible name. A copy pass, not a find-and-replace: `Continue to your code` names the action *and* contains one of them, and is not a violation. `Select`, `Add`, `Retry`, `Got it`, `Clear` and `Lets start` are not in the register. |
| `Enter` advances the primary action on every page | **differently** | Fine on a single-field page, wrong on a textarea page where Enter is a newline, dangerous on screen 20. |
| Copy | **differently** | It is a draft and is re-authored, not transcribed. Proved by `just send you` / `just sent you` disagreeing between the desktop and mobile branches, and `belive its` twice. §33.11.6 scans rendered text. |
| `Trustworthy` in the voice adjective list | **as drawn** | Recorded so a later session does not "fix" it: §3.2's ban is on `trust` as in *held in trust*, the scanner is word-bounded (`\btrust\b`), and `Trustworthy` does not match. |

---

## 4. What the walk found that the brief did not

The brief predicted the walk would find a further disagreement. It found three.

### 4.1 The order-threshold screen collects **dollars**, with an invented **$500 minimum**

The brief's disagreement 1 is about the *word* `goal`. The screen has two further problems that a
reader of the markup would not see, and both are larger:

- **`(USD)`.** `campaign_build.order_threshold` is an `integer` **count of pre-orders**. §4.1 and
  `CAMPAIGN_PATH_CHOICES` both state it: *"an order threshold — a number of Backers, not a dollar
  amount."* The Founder build surface already labels it `Order threshold (number of pre-orders)`.
  A currency-denominated threshold is a different commercial instrument.
- **`Min.  $500`.** §14.4 fixes no minimum threshold and §6 has no setting for one. A floor typed
  into a component is §1 rule 6 — a Founder with a smaller campaign would be refused by a number
  nobody agreed to.

Both are refused. The screen collects a whole number of pre-orders, with no minimum beyond what
`REQUIRED_IDEA_BUILD_FIELDS` already requires (a value at all).

### 4.2 A third `affiliate` leak, on the review screen

The brief names two (`3 Affiliates`, and the order-threshold body copy). The walk found a third:
**`Our Team will reach out to you as soon as we get all your affiliates in place`**, rendered on
both the review and the campaign-in-review screens. §3.1 applies identically.

### 4.3 The reference draws **two** review screens, not one

`Application in review` (with `…as soon as we approve you for the next steps`) is a separate screen
from `Campaign in review`. §15 reviews and approves a **campaign**; nothing in the product approves
a *person* at that point — the Founder already has an account by then. Session F renders one honest
waiting state per real record rather than two screens for one.

---

## 5. What Session A built, and what it deliberately did not

### Built

- **The four reversions**, in `shared/src/vetting/steps.ts`, `backend/src/vetting/service.ts`,
  `backend/src/routes/vetting.ts`, the interim `VettingFlow` surface, and the Admin workspace.
- **`VETTING_RESUME_POSITIONS`** — where a Founder can *be*, which is not the same list as what
  they *answer*. The campaign path is a position with a stored value and no text. Keeping the two
  apart is what lets a Founder who stopped on the path screen resume **there**; the 2026-08-10
  mapping sent them one screen past it the moment that screen came back.
- **Migration 0052**: `founder_fixed_payment_openness`, and `record_vetting_edits()` re-stated so
  the campaign path's supplier is **derived from the actor** rather than hard-coded `proovd`. The
  Founder's actor is `draft:<draftId>`; Admin's is a user id. A history row claiming Proovd chose
  what the Founder chose would be a provenance record that is simply untrue.
- **§10's read**, `viewCreatorSignal`, and `GET /api/draft/:token/creator-signal`. Zero and
  unrecorded are collapsed **before serialization**, so no field in the response can tell them
  apart — asserted by comparing the two serialized bodies.
- **The Admin absence**: a campaign onboarded after the retirement renders
  `VIEWS_NOT_COLLECTED_LABEL` where a views answer would be — never a blank, never a zero (§16a).

### The openness record binds nothing, and the enforcement is what it cannot hold

**Deviation 3, by explicit product direction.** §16 makes the fixed Creator payment the *Creator's*
request, accepted bilaterally through one proposal version (§14.2), and not the default model. So:

- **No amount column.** A number here would be the proposal only a Creator may make. The
  reference's own copy concedes it — *"A proovd representative will get in touch with you to lock
  down the [fixed Creator payment]"* — which is §1.3's manual-but-recorded path.
- **No percentage column.** §14.3's matrix is three §6 settings; a rate here would be a fourth
  answer to the same question.
- **No proposal-version reference.** It is not a version, creates none, and is an input to none.
- **A CHECK refuses an Idea campaign** (§14.3), *and* a shape trigger requires the stored type to
  be the campaign's own — without the trigger the CHECK is satisfiable by writing `pre_launch` onto
  an Idea campaign and enforces nothing. Both directions are tested.
- Insert-only, superseded rather than edited, one live row per campaign by partial unique index.

### Not built, on purpose

- **Any surface.** Sessions B–F.
- **The six-digit code's storage.** Session C, *with* its screens — a code screen built first grows
  a client-side "is this right" check, which is the enumeration oracle the frozen rejection exists
  to prevent.
- **A voice-adjective table.** `campaign_build.brand_voice` is a §14.4-required text column that
  already means exactly this and the chips serialize into it losslessly. A repeater beside it would
  make §14.4's required field and the Founder's chips two answers to one question.
- **An `answers` table merging §9 and §12.** The flow presents all eight as one sequence; the
  registers stay two, because §12 completion is derived from objective evidence and a merged table
  would quietly make it a Founder assertion.

---

## 6. What cannot complete today, and must not be stubbed

All three are designed states recorded in `CLAUDE.md`, not defects. A screen whose dependency is
missing says **which** dependency, in §27.1's six-question shape. It does not render a disabled
control with no explanation and it does not fake the capability.

| Gap | Effect on the flow | Track |
|---|---|---|
| All eight §31.4 documents are `draft` | The claim (stage 2) refuses with `policies_unpublished` and the screen renders the reason. The flow stops there. | A2 |
| R2 unconfigured — `unconfiguredStorage` throws | Visuals and Branding render a named absence. | A4 |
| Cal.com unconfigured, four §6 interview settings unset | The Interview step renders no booking embed. | A4 |

---

## 7. Session A's result

`npm test`: **118 files, 2,987 tests, green in one run.** §33.1.1 through §33.1.9 pass, updated to
the reverted flow rather than around it — and **every test in §33.1.5 passed unchanged**, which is
the point: the never-prefill guarantee was structural, not a property of the question being absent.
