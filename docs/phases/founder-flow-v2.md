# Founder Flow v2 — the Founder onboarding rebuilt (post-Phase-24 change)

**This is not a numbered phase.** `docs/master-plan.md` §6's table ends at 24, and §1.1 says a
phase file may never introduce a rule. This brief introduces three, and says so in the open in
"The honest position on §1 rule 6" — each by explicit product direction, each recorded in
`CLAUDE.md` the way the 2026-08-10 Admin-MFA removal is. Everywhere else it cites the Spec, and
where the Spec is silent it says so rather than manufacturing a citation.

It is the same kind of document the Founders, Creators, Support, Campaigns, Backers, Tasks and
Campaign Page surfaces were built from: a supplied reference plus the decisions that reference
cannot make for itself.

**Model:** Opus 5. Not because the flow is long, but because the reference and the Spec disagree
in sixteen places — plus three orderings that a mechanism refuses — and most of those are
invisible to a reader who only sees the reference. Three of them ship something §3.2 bans
outright, and one offers a payment the server declines.

**Goal:** The Founder's path from opening a pre-filled invitation to a live campaign becomes the
designed flow in the reference — twenty-six full-bleed steps, no app chrome, GSAP throughout —
while every §9, §10, §12 and §14.4 record it writes stays exactly what it is today.

**Reference bundle:** `docs/design-refrence/Proovd-Founder-Flow-v2/`. **Session A copies it there
first** — it arrived at `C:\Users\ahmed\Downloads\Founderonboarding2\Proovd Founder Flow v2\` and
every other reference in this product lives under `docs/design-refrence/`. It contains
`Proovd Founder Flow v2.dc.html` (~363KB: template markup first, each page a
`<div data-NAME="1">` under an `<sc-if>` gate, then one logic class), `support.js`, a 20KB
`README.md` that is a genuine handoff spec, plus `assets/`, `fonts/` and `vendor/`.

**Read the README before this brief.** It documents its own tokens, motion sequences, and
per-screen measurements better than a paraphrase could, and this brief does not repeat it. What
this brief owns is everything the README could not know: which of its instructions are illegal
here, which of its fields already have columns, and where the seams are.

**Walk it, do not only read it.** Open the prototype in a browser and go through all twenty-six
screens. Its `startScreen` prop jumps straight to any of them — `Invite, Problem, Solution,
Campaign type, Sign in, Vetting, Intake, Match, Creator pay, Approval, Payouts, Fee, Build, Live`.
Several decisions are behaviour, not markup: the FLIP on campaign-type select, the way the edit
toggle grows the panel and collapses the Next button, the mic row collapsing into a full-width
button, and the custom scrollbar rail that tracks scroll position.

---

## Read first

Read these before writing anything. Do not work from this brief's paraphrase of them.

- **Spec §9**, the whole section — the five-item sequence, the campaign-path step and its
  permanent lock, the Problem/Solution prefill provenance, the Competition rule stated twice, and
  the autosave and failure behaviour. This is the section the first half is graded against.
- **Spec §10** — the possible-creator result and every sentence the surface must state, the
  nine-item account-claim list, and what a successful claim does.
- **Spec §12** — the five optional items, their objective completion rules, the evidence that
  does *not* count, high-effort, and the fee block.
- **Spec §5.1, §5.2, §5.5** — exactly what authentication a Founder has, and the one sentence
  about email verification that scopes deviation 1.
- **Spec §3.1 and §3.2**, including §3.2's last paragraph about identifiers.
- **Spec §13** and **§11's** tax gate — the payout-setup screens.
- **Spec §14.3, §14.4, §16** — the compensation matrix, the build ingredients, and who requests a
  fixed Creator payment.
- **Spec §15**, **§17** — what actually stands between a submitted campaign and a live one.
- **Spec §25.6** (audit), **§25.8** (retention), **§27.1's six questions**, **§28.4** (no bundled
  consent), **§28.5** (accessibility baseline), **§30** (both halves), **§31.4**.
- **Spec §33.1.1–§33.1.9** — the acceptance this flow already passes. Do not break it.
  **§33.11** all seven, **§33.12.5**.
- **DNA §5.1, §5.4, §5.6, §5.8, §5.10, §5.12, §5.13, §5.14**, and **§6** (motion).
- `frontend/public/proovd.css` — the file header and all four `:root` blocks (`:51-160`). You are
  adding to it.
- `CLAUDE.md`, the post-Phase-24 sections. They are the house style for a build like this one.

---

## Prerequisites

All of Phases 00–24, the six Admin workspaces, and the campaign-page-v2 rebuild (Sessions A–C,
2026-08-18). Session F depends on the last of those directly.

---

## What cannot complete today, and must not be stubbed

The flow this brief builds **cannot be walked end to end** in the current environment. All three
causes are designed states recorded in `CLAUDE.md`, not defects:

1. **All eight §31.4 policy documents are `draft`.** §10 requires Terms, Founder AUP and privacy
   acceptance, a `policy_consents` row may cite only a *published* version (a trigger, not a
   service rule), and so `completeClaim` returns `policies_unpublished`. The claim screen renders
   the reason instead of the button. **That is the correct state.** Do not write policy prose,
   do not stub a consent, do not accept a draft.
2. **R2 is unconfigured** (Track A4). `unconfiguredStorage` throws. The Visuals and Branding
   uploads render a named absence — the arrangement the Affiliate evidence uploader already uses:
   the presign answers 503 naming the gap *and* the payload carries `available: false` with the
   same sentence, so the surface renders the absence instead of a dead control.
3. **Cal.com is unconfigured** (Track A4) and the four §6 interview settings are unset. The
   Interview step renders no booking embed.

A screen whose dependency is missing says which dependency, in the §27.1 six-question shape. It
does not render a disabled control with no explanation, and it does not fake the capability.

---

## The honest position on §1 rule 6

### Four reversions — these return to the Spec, they do not depart from it

On 2026-08-10 the vetting flow was simplified by product direction. `CLAUDE.md` records that as
"a recorded deviation from the Spec, not a defect to 'fix' back without the same instruction."
**That instruction has now been given**, and it points back at §9 and §10 as written:

| Change | 2026-08-10 | This brief | Authority |
|---|---|---|---|
| Competition / "Positioning" | dropped | returns as required answer 3 | §9 step 4 |
| Campaign path | moved to Admin | the Founder chooses again | §9 step 1 |
| Possible-creator result | screen deleted, stopped gating | the §10 screen returns | §10 |
| `views_range` | added as Competition's replacement | retired from collection | §9 names no such step |

**Say this plainly in every commit message and in `CLAUDE.md`.** A later session reading four
undocumented reversals will conclude someone invented four rules. The opposite happened: a
deviation was withdrawn.

`views_range` is retired **from collection only**. The column, its CHECK, its history rows and
every existing answer stay. `0042`'s completeness CHECK admits two shapes and **must keep
admitting both** — see the trap.

### Three new deviations — each needs its own `CLAUDE.md` section

**1. A six-digit emailed verification code (screens 5–6).** §5.2 gives the Founder
"Email/password or Google OAuth", and there is no OTP anywhere in the product: no `token_scope`
value, no Better Auth plugin (`plugins: []`, and `auth.ts` records that the magic-link plugin is
*deliberately* unused), and no `email_ownership` value meaning verified.

**But the deviation is narrower than it first looks, and the brief must scope it there.** §5.2's
own second sentence reads: *"A private invitation or Google sign-in may establish invited-email
ownership. A future public onboarding route requires email verification."* So email verification
is a mechanism §5.2 anticipates. What is new is applying it to the *invited* route, where the
invitation already establishes ownership.

That scoping decides the design. **The code verifies an email; it does not create an account.**
Account creation stays exactly where §10 puts it — the claim surface, screen 16 — and
`completeClaim` stays one transaction with its `founder_signup_complete` exactly-once guarantee
untouched. Building the code as a second account-creation path would be a much larger deviation
and would put a second writer on the most carefully-guarded transaction in the product.

**2. Server-side voice transcription** for "Say it instead" on the Positioning and Story steps.
§12 requires the helper surfaces to be "static, copy-ready guidance—not an embedded AI product",
§30 defers AI rewriting by name, and there is no model client anywhere in the tree. Dictation is
transcription rather than generation, which is the narrower half — but it is still a new vendor
dependency inside a §12 surface. Built by explicit product direction. See D5 for the constraints
that keep it from becoming the thing §12 forbids.

**3. A Founder fixed-payment openness record** (screen 18). §16: the optional fixed Creator
payment "exists only for a Product Campaign, is requested by the Creator, accepted by both
parties through one proposal version, and is not the default model." A Founder selecting a pay
model during onboarding — before the listing fee is paid and before any Creator exists — has no
place in §14.2's bilateral, versioned negotiation. The record therefore **binds nothing**: it
creates no proposal version, sets no default, and is read by Admin when recruiting. See E4.

Everything else in this brief is a re-presentation of records that already exist.

---

## What the reference draws, and where each piece comes from

Walk this against the prototype. `NEW` means nothing holds it today. The striking result is how
little is new: the reference's twenty-six screens are almost entirely a re-presentation.

| # | Screen | Writes to | State |
|---|---|---|---|
| 1 | Invite claim | — (read of `campaign_drafts` + prospect) | `DraftLanding` today |
| 2 | Problem confirmation | `campaign_vetting.problem_text` + provenance | exists |
| 3 | Solution confirmation | `campaign_vetting.solution_text` + provenance | exists |
| 4 | Campaign type | `campaign_vetting.selected_type` | column exists; the **Founder** control returns |
| 5 | Sign in (email) | `founder_claim_profiles.email` | exists |
| 6 | Six-digit code | `email_ownership` | **NEW** mechanism (deviation 1) |
| 7 | Problem (answer) | as 2 | exists |
| 8 | Solution (answer) | as 3 | exists |
| 9 | Positioning | `campaign_vetting.competition_text` | column exists; **never prefillable** |
| 10 | Visuals | `campaign_assets` (`purpose: 'visual'`) | full lifecycle exists |
| 11 | Branding | `campaign_workspace.brand_colors` / `brand_typography` / `brand_notes` + `campaign_assets` (`purpose: 'logo'`) | exists |
| 12 | Interview | `founder_interview_bookings` | exists (Cal.com owns it) |
| 13 | Story | `campaign_workspace.story_text` + approval | exists |
| 14 | Socials | `campaign_social_profiles` | exists |
| 15 | Last look | `campaign_optional_items` + `listing_fee_calculations` | exists |
| 16 | Your details | `founder_claim_profiles`, `policy_consents` | exists — this is §10's claim surface |
| 17 | Creator match | `possible_creator_results` | table exists; the screen returns |
| 18 | Creator pay | — | **NEW** openness record (deviation 3) |
| 19 | Review | `campaigns.status` | exists |
| 20 | Listing fee | `listing_fee_payments` + Appendix A.5 | exists |
| 21 | Voice | `campaign_build.brand_voice` | see A3 before minting anything |
| 22 | Order threshold | `campaign_build.order_threshold` | exists |
| 23 | FAQs | `campaign_faqs` | exists (authoring shipped 2026-08-18) |
| 24 | Backer rewards | `campaign_reward_packages` | exists |
| 25 | Get paid / Payouts ready | `stripe_connected_accounts` | exists (§13) |
| 26 | Campaign in review → You're Live | `campaign_reviews`, `campaign_launches` | exists (§15, §17) |

**The fee is a setting, in four parts.** `listing_fee_base_cents` (3500),
`listing_fee_item_discount_cents` (200), `listing_fee_max_discount_cents` (1000),
`listing_fee_min_cents` (2500). The reference hardcodes `FEE_BASE=35`, `FEE_PER=2`,
`FEE_FLOOR=25`. Those numbers are right and the constants are still a bug — Phase 06's rule:
*a hardcoded duration is a bug even when the number is right.* Read the setting.

**The reference's "eight vetting answers" are two registers, and they stay two.** Answers 1–3 are
§9's `campaign_vetting`; answers 4–8 are §12's `campaign_optional_items`, whose completion is
derived server-side from objective evidence and is worth US$2 each. The flow presents them as one
sequence. **Do not merge the registers**: §12 completion is not a Founder assertion, and a single
`answers` table would make it one. `VETTING_STEP_IDS` and `OPTIONAL_ITEMS` remain separate; the
sequence is a presentation over both.

---

## The reference's order is wrong in three places, and a mechanism forces each

**This is the largest single decision in the brief, and it is not a matter of taste.** The
prototype has no backend, so nothing refused it. Three of its orderings are refused by code that
already exists, and building the flow in the drawn order produces screens the server rejects.

### 1. The five §12 answers cannot run before the account exists

The reference puts all eight answers (7–14) before "Your details" (16). But answers 1–3 write to
`campaign_vetting` through `/api/draft/:token/vetting` — the draft token — while answers 4–8 write
to `campaign_assets`, `campaign_workspace`, `campaign_social_profiles` and
`founder_interview_bookings` through **`/api/founder/campaigns/:id/*`, behind
`requireRole('founder')`**. Before the claim there is no session and no role.

That boundary is not incidental. Running Visuals, Branding and Interview pre-account would mean R2
objects and a Cal.com booking **owned by nobody**, a §12 evidence snapshot bound to no Founder, and
US$10 of listing-fee discount earned before any Terms, AUP or privacy acceptance exists — which is
§28.4's concern and §10's list in one. Reaching them pre-account means building five new
token-scoped routes and five new authorization paths beside the ones that work.

**The claim moves before the §12 answers**, which is where the product already has it.

### 2. Stripe payout setup must precede the listing fee

The reference puts "Get paid" at 25, after the fee at 20. `listingFeeEligible` is true only for a
**complete `founder_seller`** account, and `beginListingCheckout` refuses without it — §13's four
states include, in `CLAUDE.md`'s own words, "the one that offers *no* path to listing-fee payment".
`campaigns.status` already encodes the order: `stripe_onboarding_pending` precedes
`listing_fee_pending`.

Drawn as it is, screen 20 offers a payment the server declines. **Stripe moves before the fee.**

### 3. The match screen belongs before the account, not after the fee

§10's own first sentence fixes its timing: *"Immediately after valid vetting and before account
creation, payment, or Stripe onboarding, show the number of `creators who may be relevant`."*

The reference draws it at 17, after details and before the fee. It moves **earlier**, not later —
directly after answer 3, before the claim.

Resist the reading that puts it after the fee on the grounds that Creators have by then actually
accepted. That is a **different screen**: §14's roster, whose acceptances are real bilateral
decisions. §10's screen is a *relevance signal* that "is not the recruited/accepted roster" and
"names no Creator". Merging them would put §14's roster behind §10's copy, and §11's Founder
boundary forbids most of what a roster would show.

### The resulting order

| Stage | Auth | Screens |
|---|---|---|
| 1 | draft token | 1 invite · 2 problem · 3 solution · 4 type · 5 email · 6 code · 7–9 answers · **17 match** |
| 2 | the claim | **16 your details** → `completeClaim` |
| 3 | founder session | 10–14 the five §12 answers · 15 last look |
| 4 | founder session, money | **25 Stripe** · 20 listing fee |
| 5 | post-fee | 18 fixed-payment openness · 21–24 build · 19 + 26 review → live |

Every stage boundary is a mechanism, not a preference. **Session A decides this in writing before
a pixel is drawn**, because the order decides which screens sit behind which guard, and a screen
built against the wrong router is a screen rebuilt.

---

## The sixteen places the reference and the Spec disagree

§1.8: the Spec wins on all of it. Each is a decision, made here, in the open.

### 1. `Set your order goal`

The headline, and the identifiers under it: `goalAmount`, `goalInput`, `goalEmpty`, `goalLow`,
`goalFilled`, `goalNext`, `goalBoxBg`, and `BPAGES[1] === 'goal'`. **65 occurrences across the
bundle.**

§3.2 bans `goal` for an Idea threshold, and its last paragraph binds identifiers — tables,
fields, jobs, logs. §33.11.3's scan reads the *built bundle*, where a prop name survives
minification. The Campaigns hub hit this exact scan with `progress.goal`; campaign-page-v2 hit it
with `PRIVATE BETA GOAL`. **This is the third time.**

The headline is `Set your order threshold`. Nothing anywhere — CSS class, prop, state key,
register value, test fixture, commit message — contains the word.

### 2. `Upfront fee` / `No upfront fee`

Eleven occurrences: two pay-model card titles, their body copy, `upfrontAmount`, and a modal.
§3.2's own replacement is **"optional fixed Creator payment"**. This was resolved identically on
2026-08-11 for the Affiliate workspace, where the reference's acceptance audit had *mandated* the
banned term; §1.8 decided it then and decides it now.

The Product-only rule and `FIXED_PAYMENT_FUNDED_IS_NOT_PAID` travel with the copy.

### 3. "Campaign in review" auto-advances to "You're Live!" after five seconds

With three affiliate chips flipping to accepted on a timer at 1.5s and 3s.

Between a submitted campaign and a live one stand: §15's Admin review with its grouped feedback
and its immutable approved snapshot, §14.2's bilateral Creator decisions inside a 72-hour window,
§16's thirteen-item readiness checklist, and §17's five-step coordinated launch. None of them is
a wait. The chips flipping are **real people accepting real terms**.

So: the screen stays, its copy is already honest ("We are checking the page and lining up your
creators"), and it becomes a genuine waiting state answering §27.1's six questions — what
happened, what next, who owns it, when the next update comes, what the Founder can do now, how to
get help. The timer goes. The chips render the *recorded* association states and do not animate
between them. The Founder leaves and returns by email; `You're Live!` is reachable only from a
real §17 launch.

### 4. The fixed 2496 × 1542 stage at `scale(0.37)`

Take the README's own option 2 and convert to responsive units. Every value in the README divides
by ~2.7 for CSS px at 1440, and **the ratios are the source of truth**. Express in
`--sp-*`/`clamp()`, never a magic px. §33.11.1's 320px reflow is not satisfiable by a scaled
fixed stage.

### 5. `border-radius: 2px everywhere`

proovd.css sets `--radius: 1px` with the comment "sharp. everywhere.", drops to `0.5px` under
600px, and the only non-`var(--radius)` radii in 7,788 lines are `50%` for circles and two
Phase-32 outliers. **Use `var(--radius)`.** The reference's 2px and the product's 1px are the
same design intent, and one of them is already the system.

### 6. Twelve of nineteen reference colours have no token

Seven map cleanly: `#41ED98`→`--brand`, `#013F17`→`--dark`, `#012D10`→`--darker`,
`#FAFAFA`→`--white`, `#E9FFE1`→`--mint`, `#A2AFA8`→`--grey`, `#DEFAFC`→`--accent-blue`.

The other twelve are a design decision, not a paste. Three of them — `#B4B4B5`, `#E4E4E4`,
`#D6D6D6` — are **neutral** greys, and every grey in proovd.css is green-tinted
(`--grey #A2AFA8`, `--grey-light #F1F3F2`, `--grey-lightest #F7F7F7`). Introducing a neutral ramp
contradicts the palette's cast across the whole product, not just this flow.

**Session B decides once, for all twenty-six screens**, and records the decision in the `PHASE 34`
header. Three of the twelve are near-duplicates of existing tokens and should simply resolve to
them unless the difference is load-bearing: `#E7F7EA`≈`--stat-mint-bg #EAF7EE`,
`#F5F5F5`≈`--grey-lightest #F7F7F7`, `#DEF6FF`≈`--accent-blue #DEFAFC`. What is genuinely new is
a mid-green ramp (`#8FCBA3`, `#4E8C67`, `#4E785C`) and a yellow pair (`#F4FFA0`, `#FBFFD4`)
beside the single existing `--accent-yellow`.

### 7. A custom interview platform and time-slot picker

§12's booking is Cal.com, and tech-stack §12 is explicit: "The booking record in our database is
the source of truth, populated from Cal.com webhooks." A second picker is a second scheduler, and
the two would disagree about what was booked. The screen renders the Cal.com embed — which, while
Track A4 is open, is a named absence.

Phase 09's own trap applies: Cal.com is a source of events, not truth.

### 8. Fonts: four static weights

The reference ships `Satoshi-400/500/700/900.woff2`. proovd.css declares two `@font-face` blocks
against `Satoshi-Variable.woff2` at `font-weight: 300 900`, and the runtime *verifies* the font
loaded by measuring a span against monospace. Use the variable font already installed. Do not add
static weights, and do not touch the fail-loud notice.

### 9. Raw inline GSAP

The reference's motion approach is right and its plugin choices are already vendored — core,
Flip, SplitText and ScrollTrigger all sit in `frontend/public/vendor/gsap/`. It must route
through `MotionProvider` / `useProovdMotion` / `useGsapScope` and `frontend/src/components/anim.ts`.
Never `import gsap`, never install the package, never a CSS transition, never the Web Animations
API.

The README's own "motion housekeeping" section — pruning looping tweens whose targets left the
DOM, and the 2.2s stuck-sweep that clears a dropped tween rather than leaving a blank page — is
good engineering and should be reproduced. `proovd-motion.js` already has the equivalent
backstop for reveals (a 3-second force-reveal); match that pattern rather than inventing a second
one.

### 10. `Enter` advances the primary action on every page

Fine on a single-field page, wrong on a textarea page — where Enter is a newline — and dangerous
on the payment screen, where §30 forbids competing actions and a stray keystroke must not
authorize a charge. Enter advances **only** where the page's single control is a one-line input.
Never on a textarea page, never on screen 20.

### 11. A splash screen covering the page for up to 2.6 seconds

`html.no-motion [data-splash] { display: none !important }` already exists, so the reduced-motion
and GSAP-absent paths are handled. What is not handled is that 2.6s of nothing is 2.6s in which
§27.1's six questions have no answer. Cap it hard, let any interaction dismiss it, and never let
it gate a retry after a failed load.

### 12. A message badge shaking on a loop every six seconds, forever

DNA §5.10 and §30's forbidden mechanics. An element that moves indefinitely to draw attention is
the pattern, whatever it opens. Keep the badge, keep one entrance, drop the infinite loop.

### 13. `type` renders as `prebuild` / `prelaunch`

§3.1: `pre-build`, `pre-launch`, `reservation` and `tranche` must never render to a Founder or
Backer. Internal state keys may use them; `CAMPAIGN_TYPE_LABELS` is what a person reads.

### 14. Three rewards maximum, six voice adjectives maximum

§14.4 caps neither. A cap is a commercial rule (§1 rule 6) and a Founder with four rewards would
be refused by a number nobody agreed to. Render the reference's three-card pager as the *layout*
and do not enforce a maximum. If product wants a cap, it is a §6 setting with its own decision —
not a constant in a component.

### 15. `3 Affiliates`, and `the affiliates are excited`

The first is the match screen's hero, at 198px/900 — **the largest type anywhere in the flow.**
The second is body copy on the order-threshold screen.

§3.1 makes `affiliate` customer-facing-banned with replacement **Creator**, and a Founder is a
customer. The Admin *record* vocabulary stays `Affiliate` — that was settled on 2026-08-11 and is
not reopened here — because §3.1's risk is an internal name reaching a customer, and both of these
reach one.

`3 Creators`. Scan the rendered text of every screen, not the source: the leak here is in copy,
not identifiers.

### 16. The prototype's copy is a draft, and is re-authored rather than transcribed

Three defects prove it, and there will be more:

- `Enter the six digit code we just **send** you` on one branch and `just **sent** you` on the
  other — the desktop and mobile branches disagree with each other.
- `low enough that you and the backers **belive its** achievable` — twice.
- `backers` here is fine (§3.1 permits it), but the sentence it sits in is a claim about what
  Creators feel, which is the kind of copy §30 asks to be careful with.

§33.11.6 scans rendered text. Every string is re-read against §3.1, §3.2 and §27.1 before it
ships, and the two branches are reconciled to one source rather than both being transcribed.

---

## Scope

**This is six sessions.** The seams are named below; do not start one whose predecessor is not
green. A truncated session produces code that looks finished and is not.

**The seams are the stage boundaries from the re-sequencing above**, so each session ends where an
auth regime or a money gate ends — and after Session A each is walkable from screen 1 the moment
it lands, which is the cheapest way to find a seam that does not join.

| | Screens | Ends at | Depends on | State |
|---|---|---|---|---|
| **A** | none | the record, the reversions, the order decided in writing | — | **built** 2026-08-18 |
| **B** | 1–4 | the shell exists and four screens prove it | A | **built** 2026-08-18 |
| **C** | 5–6, 7–9, 17 | the end of the draft token | A, B | **built** 2026-08-18 |
| **D** | 16, then 10–15 | the end of `evaluateWorkspace` | A, B, C | **built** 2026-08-18 |
| **E** | 25, 20 | the listing fee is paid | A–D | **built** 2026-08-19 |
| **F** | 18, 21–24, 19, 26 | live | A–E | |


**Session C inherits one decision from B's walk.** The reference asks Problem and Solution twice —
screens 2–3, then again at 7–8, whose own help card calls it *"last look at the problem and the
solution"*. §9 has one `problem_text` and one `solution_text`, and B built screens 2–3 as those two
answers at `/draft/:token/problem` and `/draft/:token/solution`. **C must not collect either record
on a second screen**; what 7–8 become, if anything, is C's to decide. See
`founder-flow-reconciliation.md` §4.5.

**Session C resolved it by building nothing for 7–8.** Positioning is its own page at
`/draft/:token/positioning` and it submits; a missing earlier answer is NAMED there with a link
back to the page that owns it. `/draft/:token/vetting` is retired and redirects to it. **Session D
inherits the same rule for screen 15 (Last look): it reviews all eight answers and collects none of
them.** See `founder-flow-reconciliation.md` §10.

**Session D honoured it.** Last look reads all eight from the ONE workspace projection and
collects nothing; its five §12 cards open the answer that owns each, and its three §9 cards
offer nothing at all, because §9 locks them at submission and §10 invalidated the token their
route sits behind. **Session E inherits one decision in return:** `/campaigns/:campaignId/workspace`
kept its address and lost its five steps, so what it renders today is payout onboarding and the
listing fee — screens 25 and 20 — and Last look’s `All good` points at it until they have their
own pages. See `founder-flow-reconciliation.md` §12.

**Session E took them, and retired the address.** Screens 25 and 20 are their own pages at
`/campaigns/:campaignId/setup/{payouts,fee}`, `/campaigns/:campaignId/workspace` is a redirect to
the fee, and Last look’s `All good` now opens Stripe rather than the fee — because
`beginListingCheckout` refuses without a complete `founder_seller` account, which is the same
mechanism that reordered the two screens in the first place. `ListingPayment` and its thirteen-test
suite moved to the fee page rather than being deleted with the component; §12's high-effort note
moved to Last look. **Session F inherits one decision in return:** the paid state's forward control
names `/campaigns/:campaignId/build`, which is the real surface that comes next today — screen 18
and the four build steps replace it. See `founder-flow-reconciliation.md` §14.

**Two things must not be reordered for convenience.** The six-digit code's *mechanism* lands with
its screens in C and never after them — a screen built first grows a client-side "is this code
right" check, which is the enumeration oracle the frozen acknowledgement exists to prevent. And
inside E, Stripe lands before the fee for the same reason it moves in the flow: a fee screen built
first is a fee screen whose only tested path is the refusal.

---

# SESSION A — the record, the reversions, and the order

No new surface. Every later session reads what this one writes.

## A1. The bundle and the reconciliation

Copy the bundle to `docs/design-refrence/Proovd-Founder-Flow-v2/` — HTML, `support.js`,
`README.md`, `assets/`, `fonts/`, `vendor/`. Then walk all twenty-six screens in a browser and
write `docs/phases/founder-flow-reconciliation.md`, bucketing **every** element into one of:
*exists as drawn*, *exists differently*, *re-presentation of an existing record*, *new*, or
*refused with its rule*. The Affiliate rebuild's reconciliation is the model. The walk is what
finds the fifteenth disagreement this brief missed.

## A2. The order, decided in writing

Write the stage table from "The reference's order is wrong in three places" into the
reconciliation as the flow's canonical order, with the mechanism that forces each boundary named
beside it. **This is the deliverable B through F are scoped against**, and it is the one that
cannot be deferred: the order decides which screens sit behind `requireDraftToken` and which
behind `RequireRole allow={['founder']}`, and a screen built against the wrong router is a screen
rebuilt rather than adjusted.

Record the three moves as moves — the reference drew them differently and a later reader must be
able to see that the difference was decided rather than missed.

## A3. The four reversions

- **Competition returns.** `VETTING_STEP_IDS` becomes `['problem', 'solution', 'competition']`.
  Restore the step copy in `shared/src/vetting/steps.ts`. The service requires a non-blank
  `competition_text` at submission.
- **Campaign path returns to the Founder.** The Founder PATCH route accepts `selectedType` again.
  **The Admin control stays** — it is how a path is set from discovery, and the Founder's screen 4
  arrives pre-selected from it. The Founder's answer supersedes; both are recorded with their
  supplier by the existing `0042` history trigger.
- **`views_range` retires from collection.** No step, no PATCH key. The column, CHECK, history
  and existing answers stay. The Admin "Potential audience" block renders a named absence for
  campaigns onboarded after this change — "not collected", never a zero or a blank (§16a's rule).
- **The §10 result returns** to the Founder-facing read. See A4.

## A4. Migration `0052_founder_flow_v2.sql`

Small, and the header says why it is small: almost nothing the reference draws is new.

- **`founder_fixed_payment_openness`** — insert-only, one live row per campaign, superseded rather
  than edited. Columns: campaign, the Founder's stated answer, the campaign type it was answered
  against, `recorded_by`, `recorded_at`, `superseded_at`. **A CHECK refuses a row on an Idea
  campaign** — §14.3 prohibits the fixed payment there, so an openness record for one is
  unrepresentable rather than merely unused. No amount column: a number here would be the
  proposal §14.2 says only a Creator may make.
- **Voice adjectives.** Decide before minting: `campaign_build.brand_voice` is a §14.4-required
  text column that already means exactly this. If the chips serialize into it losslessly, add
  nothing. If a repeater genuinely needs rows, `campaign_voice_words` follows the
  `campaign_faqs` shape — and then `brand_voice` must be derived from it, not maintained beside
  it, or §14.4's required field and the Founder's chips become two answers to one question.
- **Nothing for competition, the campaign path, or `views_range`.** Every column exists.
- **Nothing for the six-digit code.** Session C owns it.

The header states the absences: no `answers` table merging §9 and §12; no schedule-shaped column;
no cap column for rewards or voice words; no `phone_verified`.

## A5. The §10 possible-creator read

The screen returns; **the rule returns with it.** §10: *"For the pre-screened invited cohort, the
result must not be zero; a zero result routes to Admin before the Founder proceeds."*

- Zero and unrecorded produce the **identical** Founder-facing state — a waiting state owned by
  Proovd. Distinguishing them would show the Founder a number §10 forbids.
- The read returns a count only when it is greater than zero and recorded. `basis` never leaves
  Admin.
- The surface states all five of §10's sentences — relevance signal, names no Creator, not the
  roster, guarantees nothing, recruitment may be underway.
- It **does not gate the claim**. §10 orders the result before account creation; the 2026-08-10
  change also removed the gate, and nothing in this brief restores it. A Founder whose result is
  unrecorded still proceeds; the screen is skipped and Admin sees the gap.

## A6. Registers and drift

Every register the flow reads is `shared/`, restated in `backend/` where the runtime needs it, and
drift-tested — the arrangement the enums, settings and notification keys all use. The backend
never imports `@proovd/shared` at runtime.

## A7. Session A done when

- `npm test` green in one run.
- **§33.1.1–§33.1.9 pass**, with the suites updated to the reverted flow rather than around it.
  §33.1.5 (Competition is never prefilled) is the one to check first — it should pass *unchanged*,
  because the guarantee was structural and survived the removal.
- A hand-written INSERT of a fixed-payment openness row against an Idea campaign is refused by the
  database.
- `docs/phases/founder-flow-reconciliation.md` exists, buckets every element, and **carries the
  canonical stage order with the mechanism that forces each boundary** — the deliverable B through
  F are scoped against.
- The Admin Founder workspace renders `views_range`'s absence as an absence.

---

# SESSION B — the shell, and screens 1–4

Every remaining screen renders inside what this session builds. Build it once, against four real
screens.

## B1. The full-bleed page primitive

The reference's defining structural choice: no persistent chrome, no header, no progress bar, no
navigation dock. Each page owns its viewport. The only recurring furniture is the wordmark
top-left, HELP top-right, and sometimes a message badge bottom-right.

This is **not** `PublicLayout` and **not** `Flow`. `Flow` is a step machine inside a page; this is
a sequence *of* pages. But `Flow` already solves two things this needs and §33.11.4 grades:
destination-naming Continue/Back labels, and the step title as an `h2.step-title` rather than a
`p`. Reuse the naming helpers rather than reimplementing them.

Routes are top-level, outside every layout and guard, as siblings of `/draft/:token/vetting` —
`routes.tsx` records the reason: DNA §5.12 requires position to survive interruption, and a URL is
the cheapest durable position. **Twenty-six screens means twenty-six recoverable positions.**

## B2. `PHASE 34` in `proovd.css`

A new dated section at the bottom, one unique prefix, nothing above it edited. Phase 33's own
convention. Decide the twelve-colour question from disagreement 6 here, once, and record the
decision in the section header.

## B3. Motion

Add to `frontend/src/components/anim.ts`, behind `motionLive()`:

- **The relay entrance** — `data-anim` children staged `x: 150 * direction, opacity: 0` → `0, 1`,
  0.62s `power3.out`, 0.085s stagger, reversed with `from: 'end'` on back navigation. Every page
  uses it.
- **`grow`** — `scale: 0.6 → 1`, 0.62s `back.out(1.35)`, for the match lockup.
- **The page exit** — stage fades to 0 over 0.28s `power2.in`, with the README's 520ms fallback
  timer so a stalled tween in a background tab cannot strand the flow.
- **The campaign-type FLIP** (screen 4) — Flip is vendored; this is the one screen that needs it.

Every duration must sit inside `ProovdAPI.MOTION.dur`, whose ceiling is `grand: 0.90`. The
reference's 0.8s cupid slide fits; anything longer does not.

## B4. The help drawer

Right-side sheet, one document card per page, the current page first and marked, earlier pages
marked done, each card a title plus a one-line explanation, tapping jumps there. This is §27.1's
sixth question — *how do I get help without losing context* — answered structurally for the whole
flow, which is why it belongs in the shell session and not at the end.

## B5. Screens 1–4

1. **Invite claim** — the pale-blue band, the stroked headline, the legal line, `~3 mins`, HELP.
   Reuses `DraftLanding`'s read.
2. **Problem** and 3. **Solution** — the sticker-in-headline treatment, the dark panel with its
   custom scrollbar rail, and the edit toggle that grows the panel and collapses Next. These
   render §9's prefill provenance: the Proovd-supplied text is what the Founder sees, editing
   flips the supplier, and a failed save never clears a valid field.
4. **Campaign type** — the pager, then the two-row confirm with the FLIP. Pre-selected from
   Admin's setting where one exists. **This screen does not lock anything**; the lock is at
   submission (trap 1).

## B6. Routes, the flow register, and fixtures

Register every new route in `PRINCIPAL_FLOWS` (`shared/src/qa/index.ts`) and give each a fixture.
The Founder onboarding flow is three routes today; it will not stay three. Both directions are
asserted, so a route in the router and not the register fails, and one in the register with no
fixture fails too.

## B7. Session B done when

- Screens 1–4 walk forward and back, and each is reachable by URL after a reload.
- **§33.11.1–§33.11.7 pass** with the register and fixtures updated — including the loading and
  failure states, which owe §27.1's six questions on every new route.
- No hex literal, no magic px, and no `import gsap` anywhere in the new code.
- A browser pass at 1280 and 320 against the prototype.

---

# SESSION C — the end of the draft token (screens 5–6, 7–9, 17)

Everything still reachable on the invitation token: the verification code, the three §9 answers,
and §10's relevance signal. It ends where `requireDraftToken` ends, and the next session opens
with the claim.

The code's threat model is the reason this session leads with a mechanism rather than a screen.

## C1. What it is, and what it is not

It **verifies an email**. It does not create an account, does not mint a session, and does not
touch `completeClaim`. Deviation 1 above scopes this and the scoping is the design.

Decide the mechanism against Phase 04's token service rather than Better Auth: the token service
already stores no raw token, returns one identical rejection for every failure mode, and has the
conditional-UPDATE claim path. A new `token_scope` value is the smaller change; a Better Auth
plugin widens the auth surface, which `auth.ts` warns about by name.

## C2. The rules it inherits

- **One rejection, one status, one body.** Invalid, expired, wrong, already-used and
  never-existed are indistinguishable. Nothing per-request in the response.
- **The rate limiter returns that same body**, never a 429 — Phase 04's rule: a limiter that
  announces itself is the same enumeration oracle wearing a different hat. The magic-link reissue
  route is the worked example, including answering *before* doing the work.
- **The raw code exists only in the delivered email.** Never at rest, never in a log, never in an
  error, never in the response.
- Resend is a deliberate second act and earns a second message; a retry does not (§7's rule).

## C3. Storage, and the hash that is not a hash

Ride `secure_tokens` with a new `token_scope` value rather than a second store. `failed_attempts`
is already there and is the brute-force counter a six-digit secret needs; `expires_at` is the short
absolute expiry; `claimed_at` is single-use; the lineage model, the immutability trigger and the
revocation reasons all exist. A second token table is a second set of §28.1 guarantees to keep in
step — the reason the Affiliate rebuild refused `affiliate_history`.

**But a six-digit code cannot be stored the way a 43-character token is, and this is the trap.**
`secure_tokens_hash_idx` is UNIQUE on `token_hash`, and a plain SHA-256 over six digits has 10⁶
possible values: two live codes collide on the index, and the digest is a rainbow-table lookup back
to the code. Use an **HMAC keyed on `BETTER_AUTH_SECRET` over `draftId + code`, domain-separated by
a fixed label** — which is exactly what `backend/src/interviews/reference.ts` already does for the
Cal.com binding. Binding the draft in also means a code minted for one draft cannot verify another.

## C4. `email_ownership`, and two migrations

Currently `invited_link | google_oauth | self_supplied_unverified` — none means verified. A fourth
value is needed, and the migration must say what it means and which paths may set it.

**It takes two migration files, not one.** Postgres refuses to use an enum label in the transaction
that added it, and the Drizzle migrator runs one transaction per file — so `ALTER TYPE ... ADD
VALUE` for both `token_scope` and `email_ownership` lands in the first file, and the scope-binding
CHECK that *uses* the new scope lands in the second. This is the 0008/0009 precedent, restated by
0050/0051 two days ago. Do not merge them back together.

Extend `enforce_secure_token_immutability()` to name any new column, and extend the
`secure_tokens_scope_binding` CHECK with its new branch — a scope that binds nothing is a token
that can be replayed against any record.

## C5. The screens (5–6)

5. **Sign in** — the address as a live input, the dashed brand underline, text greying on focus.
6. **Six-digit code** — six boxes, auto-advance between them, the sixth advances the flow, and the
   resend countdown. **Keyboard and screen-reader behaviour is the hard part**: six inputs that
   move focus on keystroke need a real paste path, a real backspace path, and a label per box.
   §28.5 and §33.11 apply.

## C6. The message

One new §27 key. It joins `events.ts` only when its sender exists (§1.4), and the §27 coverage
partition must still hold: every key sent, or recorded in `unsent.ts` with a reason and an owner.
§27.2's rules apply to the rendered message — it is transactional and not opt-out-able.

## C7. The answer step primitive, and answers 7–9

One component; eight configurations across C and D. `VSTEPS` in the prototype is already this
shape — id, kind (`text` / `upload` / `branding` / `schedule` / `socials`), required, title,
question, per-type help, placeholder. Mirror it as a register, and note that the reference's help
text differs between Idea and Product for the three required answers.

**The registers stay two** (see "What the reference draws"). A step's `kind` decides which service
it writes to, and the two halves land in different sessions precisely because they sit on
different sides of the account boundary.

Problem and Solution repeat screens 2–3 with the same provenance rules. **Positioning is different
and the difference is the point:** always blank, written by the Founder, never prefilled, never
represented as AI-generated. There are no `competition_prefilled_*` columns, a CHECK pins
`competition_supplier` to `founder`, and §33.1.5 tests it. Nothing in this session may add a
prefill path — **including a "suggest" affordance beside the dictation button**, which is the
form the temptation actually takes once a transcription vendor is in the tree.

## C8. The transcription port (deviation 2)

It lands here because Positioning is the first screen that offers it. Built as a **port that
throws when unconfigured**, exactly as `unconfiguredStorage`, `unconfiguredScheduler` and
`unconfiguredTransport` do. Do not stub it, do not no-op it. The prerequisites panel blocks on it.

Constraints that keep it from becoming what §12 forbids:

- **It transcribes; it does not generate, summarize, rewrite or suggest.** No column holds a
  generated variant, and there is no control that offers one. The absence is the enforcement, and
  a test scans the flow's source for a generate route.
- **The audio is not kept.** §25.8 defines seven windows and none covers a dictation recording;
  inventing one is §1 rule 6 in the other direction. Transcribe and discard, with nowhere to store
  it — no column, no bucket key, asserted in `information_schema`.
- The transcript lands in the textarea as **editable Founder text**, supplier `founder`, and the
  provenance trigger records it normally. It is the Founder's own words either way, which is what
  keeps §9's "never represented as AI-generated" true on the Positioning step.
- An env guard entry. It touches no Stripe gateway, so it needs no §34 disposition.
- Offered on Positioning and Story only, as the reference has it.

## C9. The §10 match screen (17)

A5's read, rendered — **before the claim**, where §10 puts it. The lockup grows in; the cupids
hang off the viewport rather than the stage.

§10's five sentences are on the screen. A count renders only when it is recorded and positive;
zero and unrecorded are the same waiting state. §11's boundary holds: **no Creator is named**, and
nothing here is the roster.

The hero reads `3 Creators` (disagreement 15).

## C10. Session C done when

- Wrong, expired, reused and never-existed codes are byte-identical in the response.
- The rate limiter's body equals the ordinary rejection body, asserted by comparing serialized
  responses, and it answers 202 rather than 429.
- Two drafts issued the same six digits produce different `token_hash` values.
- A wrong code increments the attempt counter, the Nth attempt refuses, and the refusal is that
  same body.
- The raw code appears in no log, no audit row, and no response — asserted, not reviewed.
- The §27 coverage partition passes, and `registry.test.ts`'s audience set-equality is untouched.
- **`completeClaim` is unchanged.** Assert it: same transaction, same idempotency key, same
  `founder_signup_complete` exactly-once behaviour. §33.1.9 passes unchanged.
- No prefill path to `competition_text` exists; the tree-wide scan still passes, and **§33.1.5
  passes unchanged** with Positioning now a required answer.
- The transcription port throws when unconfigured and the screen says so. No audio column exists
  and no job reads one.
- The match screen renders identically for a zero result and an unrecorded one — asserted by
  comparing rendered output.

---

# SESSION D — the account, and §12 (screen 16, then 10–15)

The claim, and then the five §12 answers it makes reachable. Every deliverable is either
`completeClaim` or `campaign_optional_items` — one transaction and one evaluator, both of which
already exist and neither of which this session rewrites.

## D1. Your details (16), and the claim

This is §10's account-claim surface: its nine listed contents, the DOB calendar with 18+
validation, and the three representations as **three separate controls** (§28.4 forbids bundling).

The 18+ check is a **client courtesy over a recorded representation** — the product derives no age
and never claims to have verified one, which is what the Admin Eligibility tab already renders.
Phone is collected and marked unverified; there is no `phone_verified` column, `user.phone_verified`
is CHECK-pinned false, and `vetting.test.ts` scans `founder_claim_profiles` for any column matching
`%verif%` and asserts the result is empty. A new column named `email_verified_at` would fail that
scan; `email_ownership`'s fourth value does not, which is the other reason C3 puts it there.

**`completeClaim` is not split, not reordered, and not made partial.** One transaction; the
idempotency key claimed first; `claimDraft` inside it; the conditional `vetting_submitted →
account_claimed` UPDATE; the policy consents; the audit row. Better Auth account creation stays
outside and before it, for the reason `claim.ts` states — a leftover account is recoverable by
clicking the link again, a claimed draft with no account strands somebody behind a dead link.

**It will refuse with `policies_unpublished`** while the eight documents are drafts, and the screen
renders the reason in the open. The flow stops there. That is the correct state.

## D2. Answers 4–8 — §12

Visuals, Branding, Interview, Story, Socials. Each writes to the service that already owns it and
**completion stays server-derived**. §12 is explicit that a prompt response, transcript, generated
summary or unapproved draft does not count for Story, and that an unconfirmed slot does not count
for Interview. The Founder's approval is the completing act; the screen never sets `complete`.

Each completion drops the fee by the §6 setting and shows the "Saved $2" toast. `rejections`
render as the reason the item did not count.

Visuals and Branding uploads render R2's named absence; Interview renders Cal.com's.

## D3. Last look (15)

The card grid with ADDED / MISSING per answer, the running fee, and an edit affordance per card.
Jumping into a section returns *here* rather than continuing forward — a real behaviour, the one
most likely to be dropped, and a router contract rather than a component flag.

The §9 rule underneath it is "returning to an earlier item preserves later valid answers", which
is what `VettingFlow.tsx`'s header spends fifteen lines explaining: one answers object, each step
reading its own key, never a wizard that rebuilds forward state.

This is the §12 workspace's `Flow` review step, re-presented. It reads the same projection.

**No fee arithmetic in the browser.** `shared/src/money/listing-fee.ts` is the kernel and
`backend/src/workspace/listing-fee.ts` reads the four §6 keys. There is none under
`frontend/src/surfaces/founder/` today; there must be none after this. The "Saved $2" toast
renders a server-returned delta and only when a real recalculation produced one.

## D4. Session D done when

- **§33.1.9 passes unchanged** — `founder_signup_complete` exactly once, the token invalidated, the
  campaign moved, the consents citing published versions.
- The claim refuses with `policies_unpublished` while the eight documents are drafts, and the
  surface renders the reason rather than a dead button.
- The three representations are three controls; no path sets more than one from a single flag.
- A §12 item cannot be completed by any route, patch key, or column the Founder controls —
  `evaluateWorkspace` re-derives all five.
- All eight answers save, restore after reload, and report §9's three autosave phrases; a failed
  save clears no valid field, driven rather than reviewed.
- The fee recomputes from the settings, and changing a §6 setting changes it.
- No fee arithmetic exists under `frontend/src/surfaces/`.
- Visuals, Branding and Interview render their Track A4 absences and refuse loudly.

---

# SESSION E — the money (screens 25, 20)

Two screens, and both of them gates. Stripe lands **before** the fee — inside this session as well
as in the flow — because `beginListingCheckout` refuses without a complete `founder_seller`
account, and a fee screen built first is a fee screen whose only tested path is the refusal.

## E1. Get paid, Payouts ready (25)

§13's hosted onboarding, over `beginOnboarding` and the existing `PayoutOnboarding` component.
Proovd issues a link and reads a status; it collects nothing. The "Prepare:" list tells the Founder
what Stripe will ask for and **collects none of it** — there is no route that accepts a bank, tax
or identity field, and the absence is the enforcement (§11, §5.3, §13).

The reference draws only the happy path. §13 has four states, and **restricted has no resume and
no payment control** — it offers a support path instead. The other three states are built here or
the fee screen inherits a dead end.

## E2. Listing fee (20)

The struck-through original, the current fee, the savings copy, and the per-item toast. Then
**Appendix A.5 verbatim** through `resolveListingFeeConsent`, which substitutes exactly two amounts
and throws on any surviving bracket. Nothing paraphrases, shortens or reflows it; it renders with
`white-space: pre-line`.

Tax is a real Stripe Tax calculation against a real billing address, computed **before** the
consent, and the total the Founder agreed to is the total charged — never a substituted one.
`STRIPE_TAX_ENABLED` unset refuses loudly (§31.7: a zero caused by missing configuration is not
proof no tax is due).

§30: no competing actions on this screen. Enter does not advance here (disagreement 10).

## E3. Session E done when

- The consent block is byte-identical to Appendix A.5 and throws on an unresolved bracket.
- The fee on screen matches `listing_fee_calculations`, and both derive from the four §6 settings.
- The fee screen refuses while `listingFeeEligible` is false, and names the reason.
- All four §13 states render, and the restricted one offers no payment or retry control.
- Paying moves the campaign to `affiliate_response_and_build` and locks the five §12 items and the
  fee calculation — the `locked_at` guard trigger already installed by Phase 09a.

---

# SESSION F — openness, the build, and live (18, 21–24, 19, 26)

## F1. Fixed-payment openness (18)

An Idea campaign gets the explainer — §14.3 prohibits the fixed payment there and the screen says
so plainly, with no control at all. A Product campaign gets the pay-structure pager with §3.2's
vocabulary (disagreement 2).

What the Founder answers is **whether they are open to funding an optional fixed Creator payment**.
The screen states, in its own copy, that:

- Creators propose terms and both sides must accept one version (§14.2);
- this answer is not an offer, not a default, and binds nobody;
- the base percentages are what they are — 30% standard, 20% where a fixed payment is accepted —
  read from the §6 settings, not typed here.

No amount is collected. The reference's own copy already concedes the point — *"A proovd
representative will get in touch with you to lock down the [fixed Creator payment]"* — and that is
§1.3's manual-but-recorded path, which is correct.

It sits after the fee because Phase 11's effect 4 is what opens the formal opportunity; before
that there is no Creator to be open to.

## F2. The build steps (21–24)

Voice, order threshold, FAQs, backer rewards — the four the reference draws, rendered full-bleed
with its FAQ live-preview panel and its reward card pager.

**Two build surfaces, permanently, and one rule keeps them honest: one API, one field registry, no
second writer.** Both this sequence and `/campaigns/:campaignId/build` call `fetchBuild` /
`saveBuild` / `saveFaq` / `saveRewardPackage` and read `REQUIRED_SHARED_BUILD_FIELDS`,
`REQUIRED_IDEA_BUILD_FIELDS`, `REQUIRED_PRODUCT_BUILD_FIELDS` from
`shared/src/campaign/index.ts`. A field added to one surface and not the other is exactly the
drift that makes two surfaces a mistake instead of a choice.

**The four steps do not complete a build**, and the sequence must not imply they do. Ten shared
fields are required, plus four for Idea or one for Product. At the end of step 24 the Founder
lands on `/campaigns/:campaignId/build` with what remains named — the surface rebuilt on
2026-08-18 already renders exactly that list from `READINESS_FIELD_LABELS`. Telling someone their
campaign is built when `deriveBuildStatus` says `in_progress` is the §1.4 failure.

## F3. Campaign in review (19), You're Live (26)

Disagreement 3. Both are **waiting states**, not timers, and both change when a record changes.
`pending_review → approved` is an Admin decision; `approved → live` is `launchCampaign`'s
idempotent five-step sequence with a `campaign_live_at` schedule.

The three chips render the real `campaign_affiliate_associations` states, and a state nobody has
reached renders as pending with its reason. Three chips flipping to accepted over five seconds is
a fabricated roster (§1.4, §30).

`You're Live!` renders only for a campaign that actually reached `live`, and its button goes to
`/campaigns/:campaignId/home`.

## F4. Session F done when

- No openness record can exist for an Idea campaign, at the database.
- No amount, percentage or proposal version is written anywhere in F1.
- A campaign whose build is incomplete cannot reach a screen implying it is complete.
- Both build surfaces write through one API and read one registry — asserted by driving a field
  through each and comparing the row.
- An Idea campaign can reach `campaign_build_status = 'complete'` through the product.
- **No screen advances on a timer**: no `setTimeout` or `setInterval` drives a
  `campaigns.status`-shaped transition anywhere in the flow, asserted by a source scan.
- `You're Live!` is unreachable without a §17 launch record.
- **§33.11.3's bundle scan is clean over a freshly built `frontend/dist`**, identifiers included —
  rebuild first, because a stale bundle passes while the code it came from has the violation.
- The full twenty-six-screen walk, at 1280 and 320, side by side with the prototype.

---

## Out of scope

- **§15 review, §16 readiness, §17 launch.** All built, all passing. This flow *waits* on them.
- **§14's Creator decisions.** The roster, the proposals, and the bilateral lock are untouched.
- **The Admin Founder workspace**, except the one `views_range` absence in A2.
- **The public campaign page.** Rebuilt 2026-08-18; this flow authors its content.
- **Publishing the policies, configuring R2, configuring Cal.com.** All Track A. State the
  absences; do not close them.
- **Any change to the type lock, the retention sweep, or the token model.**

---

## The existing tests, and which way each moves

`backend/src/tests/vetting.test.ts` is where the reversions land. **Sort every test into
"deliberately inverted" or "must pass unchanged" before touching it** — the failure mode is
updating a test that was protecting something, because it went red beside one that was supposed
to.

| Group | Direction |
|---|---|
| `§33.1.4 the vetting sequence` | **invert** — four answers, not three |
| `offers exactly the two campaign paths §4 defines, to Admin` | **invert** — the Founder chooses too |
| `refuses to submit while Admin has not set the campaign path, and owns the wait` | **invert** |
| `the campaign path is not writable through the Founder route` | **invert** — it is again |
| `the campaign path is Admin's, and stays changeable until submission` | **partly** — Admin's route stays; the Founder's returns beside it |
| `the Founder route no longer accepts a competition answer either` | **invert** — it does again |
| **the other five tests in `§33.1.5 Competition cannot be prefilled`** | **must pass unchanged** |
| `§33.1.6 the possible-creator result is a record, not a gate` | **must pass unchanged** — the screen returns, the gate does not |
| `§33.1.7 the campaign type locks at vetting` | **must pass unchanged** |
| `§33.1.8 no SMS OTP path exists` | **must pass unchanged** — see below |
| `§33.1.9 the account claim` | **must pass unchanged** |
| `frontend/src/surfaces/draft/vetting.test.tsx` | **rewrite deliberately** — the whole surface |
| `frontend/src/features/qa/` — the sweep, the fixtures, the bundle scan | **extend; keep green** |
| `backend/src/tests/campaign-workspace.test.ts` | **extend** — the §12 presentation |
| `backend/src/tests/notification-coverage.test.ts` | **extend, never silence** |

**§33.1.8 is the one to read twice.** It forbids an SMS OTP, and this brief adds a six-digit code.
They are compatible — the code goes to an email address, the phone stays explicitly unverified,
`user.phone_verified` stays CHECK-pinned false, and the `%verif%` column scan stays empty — but
the test is exactly the guardrail that stops the new mechanism drifting onto a phone number. It
must pass unchanged, and if it ever needs editing, that is the signal that deviation 1 has grown
past what was authorised.

---

## Traps

- **The type lock is at submission, not at selection.** A 0007 trigger refuses to change
  `campaigns.type` or `type_locked_at` forever. Screen 4 sets a *draft* answer that stays editable
  until submit. Moving the lock earlier makes the reference's own Back navigation destroy
  campaigns.
- **`0042`'s completeness CHECK admits two shapes** — competition-answered or views-answered.
  Tightening it to require competition would validate against existing rows on `ALTER TABLE` and
  fail on every legacy views-only submission. **Keep the CHECK; require competition in the
  service.**
- **§12 completion is never a Founder assertion.** No route, patch key or column lets a Founder set
  `complete`; it is re-derived server-side on every save. A merged "answers" model would quietly
  hand it over.
- **The five optional items lock at listing-fee payment** (`locked_at`, set by Phase 11, with the
  guard trigger already installed). A build step editing a locked item finds a refusal, not a
  branch.
- **`PRINCIPAL_FLOWS` is a partition, both directions.** Twenty-six screens do not fit the three
  entries the Founder flow has today. A route in the router and not the register has no fixture and
  fails on an unstubbed request; one in the register with no fixture fails too.
- **`normaliseResumeStep`** (`backend/src/vetting/service.ts`) maps the legacy `campaign_path`
  resume position onto `problem`, because the Founder no longer had a type screen. With screen 4
  returning, that mapping is now wrong in a new way: a Founder mid-flow resumes one screen past
  where they stopped.
- **`buildSnapshot`** (`backend/src/campaign/service.ts`) hand-lists fifteen keys. A field added to
  a `REQUIRED_*` register but not to `buildSnapshot.fields` reads as permanently absent and pins
  the build at `in_progress` **forever**. Session F's build steps touch exactly that surface.
- **§33.11.4 is the widest hit and the easiest to under-scope.** `OBJECTLESS_CTA_LABELS` is
  exact-match on the trimmed accessible name and contains `next`, `back`, `continue`, `confirm`,
  `done`, `submit`, `send`, `start`, `finish`, `go`, `yes`, `no`. The reference's primary control
  on roughly twenty of twenty-six screens is one of those words. This is a copy pass, not a
  find-and-replace, because a label that names the action *and* contains one of them —
  `Continue to your code` — is not a violation. (`Select`, on screen 4, is not in the register.)
- **`useButtonProgress` must be mocked as a promise, not a callback**, in every new surface test.
  The callback-shaped mock resolves immediately and makes a server-refusal assertion pass for the
  wrong reason. `support.test.tsx` records this; three suites carried the wrong mock until
  2026-08-15.
- **`useAutosave` never returns a value**, deliberately — the caller's state is the only copy of
  what was typed, and that single decision is the whole autosave bug class. Do not "fix" it to
  refetch.
- **A browser pass finds what jsdom and axe cannot.** Every rebuild since 2026-08-10 found at least
  one defect only a screenshot showed: an invisible pill, a tab rail overflowing with no
  affordance, a heading-level jump, a grid child auto-placing on its neighbour, a progress bar
  reading 100% full. Twenty-six full-bleed screens is the largest visual surface added to this
  product. Budget for it.
- **Chrome headless will not give you a 320px viewport** — `--window-size=320,900` reports
  `clientWidth: 489` on Windows. Render inside a 320px iframe or the reflow check lies.
- **`campaigns.created_at` / `updated_at` are forbidden anchors** (§33.12.1's scan treats reading
  either as the failure).

---

## Done when

- All six sessions' done-when lists pass, in one run.
- **§33.1.1 through §33.1.9 pass**, updated to the reverted flow rather than around it.
- **§33.11.1 through §33.11.7 pass**, with every new route registered and fixtured.
- **§33.12.5's partition passes in both directions.**
- The §27 coverage partition still holds.
- The bundle scan finds no §3.2 term, including in identifiers — specifically no `goal` and no
  `upfront`.
- A Founder can walk all twenty-six screens, leave at any point, return by URL, and find their
  position and their answers.
- The three Track A absences are visible and explained on the screens that need them, and none is
  stubbed.
- `CLAUDE.md` records the four reversions as reversions, the three deviations as deviations, and
  the three re-orderings with the mechanism that forced each.
- The reference and the built flow, side by side at 1280 and 320, differ only in the sixteen
  places and the three orderings this brief names.

---

## After this

The full-bleed page primitive B1 builds is the product's first sequence-of-pages shell. If a later
phase needs one — a Creator onboarding of the same shape is the obvious candidate — that is where
it goes, not a second one.

The three deviations are each narrow and each recorded. **None is a licence for its neighbours.**
The verification code verifies an email; it is not the beginning of a passwordless product. The
transcription port transcribes; a later phase asked to add summarizing, rewriting or suggesting is
asking for the embedded AI product §12 forbids and §30 defers, and this brief is not the licence
for it. The openness record binds nothing; a later phase asked to read it as a default, a filter,
or an eligibility condition is asking for the §1 rule 6 violation the CHECK and the missing amount
column exist to prevent.
