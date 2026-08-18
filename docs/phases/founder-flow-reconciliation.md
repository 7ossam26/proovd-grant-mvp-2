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

### 4.4 The reference has a **fourteenth** screen the README does not number: `reach`

Found by Session B's own walk of the prototype's `SCREENS` array, which is
`['claim','problem','solution','reach','kind','type','vetting','intake','match','model',
'approval','fee','build','live']`. `reach` sits **between Solution and campaign type** and is a
full page: forty phones orbiting in 3D behind

> **We can get [product] in front of 10,000 new people**

with the number counting up, its own HELP button, and a help card reading *"The audience our
creators can put in front of your campaign. No action needed, just have a look."*

The Session A reconciliation attributed this line to screen 1, where the README mentions it. It is
its own screen, at the largest type in the flow, and `RTARGET = 10000` is a hardcoded constant in
the prototype.

**Refused.** §7 forbids Admin promising acceptance, results, reward pricing, or a named Creator's
participation, and no record holds an audience number — `views_range` was the *Founder's own*
content reach and is retired, and `possible_creator_results` counts Creators and stores a basis.
§10's match screen is the honest version of this beat and already sits in stage 1: it counts
Creators who might be a fit, carries six sentences saying what the number is *not*, and names
nobody. Recorded in `FOUNDER_FLOW_ABSENCES` rather than as a comment, because an element that is
absent has nowhere on a page to say why.

### 4.5 The reference asks Problem and Solution **twice**

`si: 'problem'` / `si: 'solution'` are screens 2–3 — "This is how we understood your problem", the
prefill with an edit toggle. `VSTEPS[0]` and `VSTEPS[1]` are screens 7–8 inside the answer
sequence, and the prototype's own help card for them is `probConfirm` — *"Confirm the basics. Last
look at the problem and the solution before the rest of the questions build on them."*

Two passes over one record, one screen apart, and screen 15 (Last look) already reviews all eight.
§9 has one `problem_text` and one `solution_text`.

**Session B built screens 2–3 as those two answers**, at `/draft/:token/problem` and
`/draft/:token/solution`, and the interim Positioning surface no longer re-asks them — it names any
that are missing and links back to the page that owns each. **Session C decides what, if anything,
7–8 become**; what it must not do is collect either record on a second screen, because a record
collected in two places is a record whose two copies eventually disagree.

### 4.6 `By continuing you're agreeing to Proovd's Terms of Service and Privacy Policy`

Drawn on the reference's invite screen as the legal line, and — separately — shipped on the Phase
06b landing surface since it was built.

**Refused, and this is the one finding that was already in the product.** §10 records acceptance at
the account claim as three separate controls (§28.4), and no `policy_consents` row exists for
anything a person does on the invite page. A sentence claiming agreement was given is a claim about
a record that is not there. The documents are linked as reading, and `FLOW_NOTHING_COMMITTED` says
what opening the form does and does not do.

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

## 7. Results

**Session A** — `npm test`: **118 files, 2,987 tests, green in one run.** §33.1.1 through §33.1.9
pass, updated to the reverted flow rather than around it — and **every test in §33.1.5 passed
unchanged**, which is the point: the never-prefill guarantee was structural, not a property of the
question being absent.

**Session B** — `npm test`: **119 files, 3,040 tests, green in one run.** §33.11.1 through
§33.11.7 pass with the four new addresses in `PRINCIPAL_FLOWS` and swept; the §33.11.3 bundle scan
passes over a fresh `dist`.

**Session C** — `npm test`: **119 files, 3,100 tests, green in one run.** §33.1.1 through §33.1.9
pass **unchanged** — including §33.1.5 and §33.1.9, which is C10's own contract: `completeClaim`
is not touched by the code, and the never-prefill guarantee holds with Positioning collected again.
§33.11.1 through §33.11.7 pass over the eight addresses, and the §27 coverage partition still
holds with one new key beside `founder_email_verification`, whose `never` decision is unchanged.

---

## 8. Session B's screen order, as built

The four addresses, and what each is:

| Page id | Address | Reference | Note |
|---|---|---|---|
| `invite` | `/draft/:token` | 1 | The address in the invitation email; it does not move. |
| `problem` | `/draft/:token/problem` | 2 | §9's Problem answer, with its prefill provenance. |
| `solution` | `/draft/:token/solution` | 3 | §9's Solution answer. |
| `campaign-type` | `/draft/:token/campaign-type` | 4 (`kind`) | Two stages on one route; locks nothing. |

`/draft/:token/vetting` remains, asking §9's third answer and submitting. It is interim, it renders
outside `FlowPage` deliberately (declaring a page id for a screen Session C moves would put a
non-existent surface in the register), and it re-asks nothing screens 2–4 own.

Four decisions worth carrying forward:

- **Both campaign paths render at once**, with all ten commitments, rather than behind the
  reference's pager. §9 requires the choice explained *before* it is made, and behind a pager half
  of that explanation is one interaction away from somebody who never presses the arrow. The pager
  is the reference's answer to a fixed 2496px stage; responsive units remove the constraint.
- **The confirmation field is a `readOnly` textarea, not a paragraph that swaps into one.** Same
  element in both states: a long answer scrolls natively either way, focus survives the mode change,
  and there is no second DOM shape to keep accessible.
- **`Next` does not collapse while editing.** The reference animates its height and margin to zero;
  a disappearing primary action inside a twenty-six page sequence is a trap at 320px where
  `Done editing` and `Continue` need not be on screen together. The panel still grows.
- **The custom 9px scrollbar rail is the platform's own scrollbar, styled.** Same design, and no
  second scroll position to keep in step with the real one.

---

## 9. What the Session B browser pass found, and nothing else could

Four defects, all invisible to jsdom, axe, and the type checker. This is the fifth rebuild in a row
where that has been true.

1. **A CSS comment containing `*/` closed early and killed the whole `PHASE 34` token block.** The
   header explained the stage conversion as `--sp-*/clamp()`; `*/` inside a comment *ends* the
   comment, so everything after it parsed as garbage until the next `*/` — taking `--ff-display`,
   `--ff-pad` and the rest with it. Every page rendered at browser-default type with 8px of body
   margin. A file-wide comment-balance scan now runs beside the fix.
2. **`.field__label` matched nothing.** The `Field` component's classes are `field-label` and
   `field-hint`, single hyphen. So the label on the dark panel rendered dark green on dark green and
   was invisible — and axe cannot see it, because the accessible name was correct either way. This
   is the same class of defect PHASE 28, PHASE 31 and PHASE 33 each recorded.
3. **The travelling sticker had zero size.** `.sticker` sets a width and no `display`, and every
   other sticker in the product sits in a flex or grid parent that blockifies it; inside a plain
   `<span>` the width was ignored. Its space is now reserved too, so choosing a path does not shift
   the two explanations under the reader's cursor.
4. **`--grey` on `--white` is about 2.2:1**, and it was carrying real sentences — a permanence
   warning, a legal line, a save status. It is the token for placeholders and disabled ink. Those
   five lines read `--moss` now, which is what PHASE 33 uses for body copy.

Two things the pass confirmed rather than found: the splash works (it is the runtime's own, once
per session with a 4-second backstop, and `--virtual-time-budget=4000` was simply catching it
mid-play), and a 320px viewport still needs the iframe technique — Chrome on Windows reports
`clientWidth: 489` for `--window-size=320`.

## 10. Session C's screen order, as built

The four addresses that finish the draft token, and what each is:

| Page id | Address | Reference | Note |
|---|---|---|---|
| `email` | `/draft/:token/email` | 5 | `founder_claim_profiles.email`. The reference's headline is refused. |
| `code` | `/draft/:token/code` | 6 | **Deviation 1.** Verifies an email; creates no account. |
| `positioning` | `/draft/:token/positioning` | 9 | §9's third answer, and the submission that locks the type. |
| `match` | `/draft/:token/match` | 17 | §10's relevance signal, at §10's own position. |

**`/draft/:token/vetting` is retired and redirects to `/draft/:token/positioning`.** It was the
interim surface that asked §9's third answer and submitted; Positioning is its own page now and the
submission went with it. A redirect rather than a deleted route, because the address shipped in
Phase 07 and somebody may have it bookmarked.

**Screens 7–8 become nothing, which is §4.5's decision carried out.** The reference asks Problem
and Solution a second time inside the answer sequence; §9 has one `problem_text` and one
`solution_text`, and Session B built screens 2–3 as those two answers. What the Positioning screen
does instead is name any earlier answer that is still empty and link back to the page that owns it.
A record collected in two places is a record whose copies eventually disagree — and a suite testing
both copies would have made that look correct.

### What the Session C walk found that neither earlier walk did

Four elements the reference draws are refused, each now an entry in `FOUNDER_FLOW_ABSENCES`:

1. **`In your category are ready to promote this`** — the match screen's sub-line. §10 says the
   number "guarantees neither that anyone will take part nor what results they would produce" and
   "is not the recruited/accepted roster". "Ready to promote this" says people who have agreed to
   nothing are ready to promote something. `POSSIBLE_CREATOR_RESULT_DISCLOSURES` is the honest
   version of the same beat, and it is six sentences long because every one of them is a limit the
   number needs.
2. **The match breakdown** — `1 Newsletter / blog operator`, `2 Community owners`.
   `possible_creator_results` holds a count, a basis, and who recorded it. There is no category
   breakdown to render, so drawing one means inventing a fact (§1 rule 6) about people §11 says a
   Founder may not be shown. The `basis` never leaves Admin.
3. **`To save your progress verify your email:`** — the email screen's headline. Progress is already
   saved: §9's autosave has been writing every answer through the draft token since screen 2, and
   the invitation link is what brings a Founder back to all of it. A sentence naming the wrong
   mechanism is the §1.4 failure in one line, and it is the line somebody reads while deciding
   whether they can close the tab.
4. **The email field's ink turning `#A2AFA8` on focus** — `--grey` on `--white` is about 2.2:1,
   applied to the text a person is actively typing. It is the token for placeholders and disabled
   ink, and Session B moved five sentences off it for the same reason. The dashed brand underline
   marks focus instead.

And one copy defect confirmed: the reference's `six digit code we just **send** you` /
`just **sent** you` disagree between its two branches. One source, and it reads `sent`.

### Two decisions inside the deviations

**The code screen keeps a submit control as well as the auto-advance.** The reference has none — the
sixth digit fires the check — which is right for the common case and cannot be the only path: a
rejected code leaves six full boxes and nothing to press, and a keyboard or screen-reader user needs
a control they chose to operate (§28.5, §33.11.4). So both.

**The reference's Positioning hint is refused.** Its `"Nothing" is not an answer.` contradicts §9's
own expectation, which this product already states as "the real alternatives — including doing
nothing, or a spreadsheet". A hint that argued with it would push a Founder to invent a competitor.

---

## 11. What the Session C browser pass found, and nothing else could

Four defects, all invisible to jsdom, axe, and the type checker. Sixth rebuild in a row.

1. **`gap: var(--sp-20)` against a scale with no `--sp-20`.** The declaration was invalid, so the
   gap collapsed to zero on the one screen with the most stacked prose in it: the Positioning
   headline sat directly on its lede, and the dictation absence ran into the permanence warning.
   A `var()` naming an undefined property is not an error anywhere — the declaration is simply
   dropped — so the page just looked badly designed.
2. **The message badge sat on top of the primary control at 1280×520.** `.ff__stage`'s
   badge clearance was inside the `max-width: 599.98px` block; the badge is fixed at every width.
   A laptop with browser chrome is that viewport.
3. **`.field-hint` is `--grey`**, about 2.2:1, and on these pages a hint is a real sentence that
   changes what somebody types. Moved to `--moss` **inside the flow only** — and the first draft of
   that fix was itself a defect: `.ff .field-hint` ties Session B's `.ff-panel .field-hint` on
   specificity and wins on order, so the dark panel's hint went mid-green on dark green.
   `:where(.ff)` contributes nothing to specificity, which is exactly what was needed.
4. **`.cr-file { background: var(--paper) }`** — a token this file has never defined, so the
   Affiliate workspace's evidence rows have had no background since 2026-08-17. Found by the scan
   below rather than by looking at it.

**Two scans now run on every commit**, in `a11y.test.tsx`, because finding (1) is the second time a
silently-invalid stylesheet has shipped — Session B's was a comment containing `*/`, which closed
early and killed the whole `PHASE 34` token block:

- Every CSS comment opens and closes exactly once, and never nests.
- Every `var(--x)` with **no fallback** names a property the file defines. `var(--x, fallback)` is
  exempt, and the distinction is the point: `--track`, `--sweep`, `--p` and four others are set
  inline by a component and carry their own default. Both scans read the file with comments
  stripped, because the very first version failed on its own comment naming `var(--paper)` —
  `backend/src/notifications` makes the same split for the same reason.

One deliberate departure from the reference's scale: the match hero is
`clamp(2.75rem, 7.4vw, 5.5rem)` rather than 198px/900. That ratio — 2.25× its own campaign-type
headline — does not survive a 320px viewport. It is still clearly the largest type in the flow,
which is DNA §5.8's one delight.

## 12. Session D's screen order, as built

The claim, and the six addresses behind it:

| Page id | Address | Reference | Note |
|---|---|---|---|
| `claim` | `/draft/:token/claim` | 16 | §10's account claim. The one stage-2 page. Address unchanged since Phase 07. |
| `visuals` | `/campaigns/:campaignId/setup/visuals` | 10 | `campaign_assets` (`purpose: 'visual'`). |
| `branding` | `/campaigns/:campaignId/setup/branding` | 11 | `campaign_workspace` + `campaign_assets` (`purpose: 'logo'`). |
| `interview` | `/campaigns/:campaignId/setup/interview` | 12 | `founder_interview_bookings`, fed by Cal.com. |
| `story` | `/campaigns/:campaignId/setup/story` | 13 | `campaign_workspace.story_text` + approval. |
| `socials` | `/campaigns/:campaignId/setup/socials` | 14 | `campaign_social_profiles`. |
| `last-look` | `/campaigns/:campaignId/setup/review` | 15 | The review over all eight answers. |

**The parameter changes at the claim, and that is the whole of stage 2.** Every
page before it is addressed by the draft token; §10's claim invalidates that
token, and every route behind these six is `requireRole('founder')`. So
`FounderFlowPage` gained `param: 'token' | 'campaignId'`, `founderFlowPath`
substitutes whichever the page declares, and `founderFlowReachableFrom` is what
the help drawer reads to decide whether an earlier card is a jump or reading.

**`/campaigns/:campaignId/workspace` keeps its address and loses its five steps.**
Two Founder-facing surfaces over the same five items would be two places to
answer one question — the reasoning that deleted `DraftLanding` in Session B and
the interim vetting surface in Session C. What is left there is payout
onboarding and the listing fee, which are **Session E's screens 25 and 20**;
Last look's `All good` points at it for exactly as long as that is true. The
Founder's own campaign list now opens Last look for the pre-money states and the
fee surface for the two money ones, which is what those states are about.

### What the Session D walk found that neither earlier walk did

Five elements the reference draws are refused, each now an entry in
`FOUNDER_FLOW_ABSENCES`:

1. **`Username:` as the legal-name field label.** It writes
   `founder_claim_profiles.legal_name`, which is what §10 collects and what
   Stripe is later given. Calling it a username misnames the record on the one
   screen that creates it — and invites a nickname into the field the seller of
   record is identified by.
2. **The details screen collecting three fields and nothing else.** Less a
   refusal than a gap: §10 lists nine contents and the prototype has no account
   behind it to need the rest. Country and state, sole-proprietor or entity, the
   password, the three agreements and the three representations are all here,
   because `completeClaim` refuses by name for each.
3. **The interview screen's own platform tiles and time-slot chips.** tech-stack
   §12: "The booking record in our database is the source of truth, populated
   from Cal.com webhooks." A picker of our own is a second scheduler, and the two
   would disagree about what was booked.
4. **The branding screen's draggable HSV plane.** A drag surface with no keyboard
   equivalent fails §28.5 on the one screen where the alternative is free, and
   §12 does not ask for a colour VALUE — it asks for "saved direction containing
   at least colors and typography/style guidance", which is writing. The hex
   field, the swatches it builds, and the direction box all ship; only the plane
   does not.
5. **An edit affordance on all eight Last-look cards.** Three of the eight are §9
   answers, locked at submission, and the route that wrote them is behind the
   token the claim just invalidated. Those three cards render what was submitted
   and offer nothing.

### Three decisions inside the session

**Signing in after the claim is the browser doing what a person would.** §10's
successful claim creates the account and invalidates the token; it does not
mention a session, and `completeClaim` issues none. The flow continues into
`requireRole('founder')` territory, so somebody has to sign in. Rather than add a
second session-minting path to the most carefully guarded transaction in the
product, the claim screen posts the password the Founder just chose to
`/api/auth/sign-in/email` — the real route, with its real rate limit, its real
origin guard, and no new server code. It buys no access the password itself would
not. If it fails the ACCOUNT still exists, and the screen says exactly that.

**The return-from-Last-look contract is `?from=review`, in the address.** The
reference's own behaviour — "jumping into a section from here returns you to Last
look on that section's Next" — and the brief calls it "a router contract rather
than a component flag" for a reason: a component flag does not survive a reload
in the middle of an edit, and this sequence's position is the URL everywhere else.

**Dictation on Story needed a second route, and the port is unchanged.**
`POST /api/draft/:token/transcribe` is Positioning's and cannot serve Story: the
claim invalidated that token on the way here. `POST /api/founder/campaigns/:id/transcribe`
is the same port behind the Founder guard, with the same configured-check before
the body parser and the same absence carried on the read. Everything that keeps
deviation 2 narrow is a property of the port rather than of either route.

---

## 13. What the Session D browser pass found, and nothing else could

Two defects, both invisible to jsdom, axe, and the type checker. Seventh
rebuild in a row.

1. **A `.tag` inside `.ff-item__status` stretched into a full-width band.**
   The container is a column flex, `.tag` is `inline-flex`, and a flex ITEM in
   a column is stretched to the container width by the default
   `align-items: stretch`. So `Not counting yet` and `Counts` rendered as
   dark and moss bars across the measure rather than as chips. axe reads a
   correctly named Tag either way. `align-items: flex-start` fixes it, and the
   complete state — one sentence with a chip in it — stops being a flex column
   at all.
2. **§12’s completion rule read as a claim that it had already happened.**
   `OPTIONAL_ITEMS.interview.completesWhen` is literally `Your booking is
   confirmed.` — correct as a RULE and wrong as a lede under the question, on
   the one screen where nothing is booked. §1.4 in one line, and the same
   sentence appears again on the Last look card for a MISSING answer. Both now
   carry a label (`What makes this count` / `Counts when`) and the register is
   untouched: it is a condition everywhere, and only the presentation said
   otherwise.

One harness bug worth recording so the next session does not chase it: the
fixture server matched `/workspace` before the static-file fallback, so
`/campaigns/c1/workspace` served JSON at a PAGE address and the screenshot was
a wall of raw payload. The check is `p.startsWith('/api/') && p.includes(...)`
now. Nothing about the product was wrong.
