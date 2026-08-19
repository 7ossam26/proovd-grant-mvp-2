# Creator Flow v2 — the Creator signup and dashboard rebuilt (post-Phase-24 change)

**This is not a numbered phase.** `docs/master-plan.md` §6's table ends at 24, and §1.1 says a
phase file may never introduce a rule. This brief introduces five, and says so in the open in
"The honest position on §1 rule 6" — each by explicit product direction on 2026-08-19, each to be
recorded in `CLAUDE.md` the way the 2026-08-10 Admin-MFA removal is. Everywhere else it cites the
Spec, and where the Spec is silent it says so rather than manufacturing a citation.

It is the same kind of document the Founders, Creators, Support, Campaigns, Backers, Tasks, Campaign
Page and Founder Flow surfaces were built from: a supplied reference plus the decisions that
reference cannot make for itself.

**Model:** Opus 5. Not because the flow is long, but because the reference and the Spec disagree in
**twenty-four places**, and five of those are not details — they are the product. Three ship a term
§3.2 bans outright. One prints a money promise on a consent screen that §22.1 contradicts. And
unlike every previous rebuild, this one **replaces a working surface whose own file header is a
sustained argument against the reference**.

**Goal:** The Creator's path from opening a private campaign invitation to promoting a live campaign
becomes the designed flow in the reference — nine full-bleed onboarding screens and a five-section
app — while every §5.3, §8, §11, §14 and §17 record it writes stays exactly what it is today.

**Reference bundle:** `docs/design-refrence/Proovd-Creator-Flow-v2.html` (513KB, 2,682 lines). It
arrived at `C:\Users\ahmed\Downloads\Proovd_Affiliate_Founder_Rebuild_v11_FIXED_SHAREABLE.html` and
was copied here, because every other reference in this product lives under `docs/design-refrence/`.

It is a `.dc` export with a standalone runtime injected at the top. Its shape:

| Lines | What |
|---|---|
| 11–264 | The `.dc` runtime. Not ours; do not port it. |
| 269–299 | Vendored GSAP 3.13.0, Flip, SplitText. We already vendor these. |
| 300–1023 | The prototype's CSS, including its eleven `--p-*` tokens. |
| 1025–1826 | The template. Each screen is an `<sc-if value="{{ flag }}">`. |
| 1828–2679 | One logic class. `renderVals()` at 2408 is the whole view model. |

**Walk it, do not only read it.** Serve the file and open it. Its `startScreen` prop jumps straight
to any of the fourteen: `Splash, Welcome, Profile, Channel, Voice, Presence, Verify, Agree, AllSet,
Home, Pitches, Earnings, Resources, Settings`. Several decisions are behaviour, not markup:

- the **sticker-peel splash** (`playSplash`, 2127) — a hand-written 2.6s rAF track, not GSAP;
- the **confirm field that grows in** once the password is strong (`pwShowConfirm`);
- the **typed headline** on All set (`scheduleEnter`, 2281) that then **FLIPs** from
  `[data-transition-source="dashboard-card"]` into `[data-transition-target="dashboard-card"]`
  on Home (`runFlip`, 2304), with siblings staggering in behind it;
- the **five-step tap-through** on a pitch (`advance`, `pStep`, `pSeg`, `hintLabels`);
- the **horizontal wheel handler** (`_wheelBound`, 1969) that converts vertical scroll over `.hrow`.

---

## Read first

Read these before writing anything. Do not work from this brief's paraphrase of them.

- **Spec §11**, the whole section, twice. It is forty-five lines and it is what deviation 1 departs
  from. Every one of its content bullets is still collected; the departure is the pagination.
- **Spec §5.3** — admission, the seven-subtype register and its evidence inputs, what Proovd stores
  and never stores, and the **`Affiliate settings:` bullet**, which is the only place the Spec
  enumerates a Creator settings surface and is what licenses the Settings screen.
- **Spec §8** — the seventeen prospect facts, the invitation contents, the two mandated sentences
  (`PREPARING_NOTICE`, `DECLINE_NOTICE`), and the quality-tier sentence: *"used only as assessment
  data—not as a commission floor."*
- **Spec §10** — the handoff at `founder_signup_complete` and the pilot pre-view exception.
- **Spec §12** — high-effort and its one gating rule, the helper resources ("static, copy-ready
  guidance—not an embedded AI product"), and the preparing-kit rule.
- **Spec §14.1, §14.2, §14.3** — the complete opportunity, the three decisions and **which party may
  propose what**, and the six-cell matrix. §14.1's last line kills a resource library.
- **Spec §15** — materiality and the Creator reacceptance loop.
- **Spec §16** — the thirteen readiness items, the fixed-payment funding sequence, and the no-nudge
  rule.
- **Spec §17** — the five-step launch order, the **active-partnership surface content list** (which
  is the real specification for the reference's `work` screen), and the three verification outcomes.
- **Spec §19's data boundary** — *"Affiliate sees only aggregate clicks, attributed pre-orders,
  reward summary, and timestamps."*
- **Spec §20** — the four things a Creator sees during a live campaign, the seven obligations, the
  disclosure paragraph, and mid-campaign addition.
- **Spec §22.1, §22.2, §22.8, §22.9** — the five fixed-payment outcomes, the seven earnings states,
  the sentence that forbids a withdrawal, the thank-you rules, `successfully_completed`, and the
  work-again request.
- **Spec §24.4, §24.5, §24.7** — provisional vs earned, the fee rule, and the fourth money stream.
- **Spec §27.1's six questions**, **§27.4's Affiliate event list**, **§27.7**.
- **Spec §28.4** (no bundling, 18+ unchecked) and **§28.5** (which names *"Affiliate decisions"*
  among the five required complete keyboard paths).
- **Spec §29 whole** — the seven enforcement actions, the self-pre-order rule, conflicts, the
  one-month restriction, ghosting, and the valid termination reasons.
- **Spec §30, both halves.** Read the deferral list line by line. Five of its entries are drawn by
  this reference.
- **Spec §31.5** — the per-campaign IP/confidentiality agreement and the pilot pre-view exception.
- **Spec §3.1 and §3.2**, including §3.2's last paragraph about identifiers.
- **Spec §1 rules 2, 5, 6 and 8.** Rule 2 is the licence for redrawing; rule 8 is what decides every
  disagreement below.
- **Spec §33.2.1–13 and §33.4.1–9** — the acceptance this flow already passes. Only §33.2.2 moves,
  and only in the half named below. **Appendix B.7** — the Creator money-status block, exact text.
- **DNA §5.1, §5.4, §5.6, §5.12, §5.13, §5.14**, and **§6** (motion).
- `frontend/public/proovd.css` — the file header and all four `:root` blocks (`:51-160`). You are
  adding to it.
- `frontend/src/surfaces/creator/CreatorSignup.tsx` — **its 37-line header, in full.** It is the
  best statement of §11 in the repository, it argues against what you are about to build, and the
  brief that overrides it owes it a reply rather than a deletion.
- `CLAUDE.md`, the post-Phase-24 sections. They are the house style for a build like this one.

---

## Prerequisites

All of Phases 00–24, the six Admin workspaces, the campaign-page-v2 rebuild, and Founder Flow v2
Sessions A–F. Session B depends on `FlowPage` and `components/anim.ts` from Founder Flow v2 Session
B directly; Session F depends on `readFounderPaymentStatus`'s one-resolver arrangement as the model
for the Creator money surface.

**One piece of work was in flight when this brief was written and is not in the list above:** the
**Money & Fulfillment** Admin console (`PHASE 36`, 2026-08-19). It touches `admin-close.ts`,
`admin-refunds.ts` and `admin-disputes.ts` and adds `shared/src/admin/money-workspace.ts`. Session F
reads the same §22.1 earnings records it renders, so **rebase on it before Session F** and check
whether its resolver is the one this brief's F4 consistency pass should compare against.

---

## What exists today — the inventory this rebuild replaces

Unlike the Founder flow, this one replaces a **working, acceptance-tested surface**. Know it before
you touch it.

### Frontend — `frontend/src/surfaces/creator/`

| File | Lines | What |
|---|---|---|
| `CreatorSignup.tsx` | 527 | The one-page compact signup. Exports `CreatorSignup`, `PROOVD_OWNS_THE_WAIT`. Internal `WaitingState`, `PayoutPanel`, `SignupForm`; consts `TEXT_FIELDS` (7), `CONFIRMATIONS` (5). |
| `CreatorCampaigns.tsx` | 508 | Campaign list + preparing kit. Exports `CreatorCampaigns`, `CreatorCampaignKit`, `CONFIDENTIALITY_TERMS`, `NO_WORK_YET`. |
| `FormalOpportunity.tsx` | 550 | §14.1/§14.2 opportunity and the three decisions. |
| `CreatorPartnership.tsx` | 258 | The §17 active-partnership surface. |
| `CreatorCampaignClose.tsx` | 156 | The §21 close view, Appendix B.7. |
| `api.ts` | 460 | Two clients: token-scoped (`call`, no credentials) and session-scoped (`sessionCall`). |
| `creator-signup.test.tsx` | 550 | |
| `creator-campaigns.test.tsx` | 305 | |

Also Creator-facing: `surfaces/notifications/NotificationSettings.tsx` (`CreatorNotificationSettings`),
`surfaces/payouts/PayoutOnboarding.tsx` + `StripeReturn.tsx`, `surfaces/LinkUnavailable.tsx`.

**Six `/creator/*` addresses plus the token one.** `roleHome.affiliate = '/creator/campaigns'`.

### Backend

`affiliates/signup.ts` (794), `invitation.ts` (625), `kit.ts`, `partnership.ts`, `decisions.ts`,
`close/creator-close.ts`. **Seven routers contribute to `/api/creator`** — `creator.ts`,
`creator-decisions.ts`, `completion.ts`, `enforcement.ts`, `founder-build.ts` (the reacceptance
router), `notifications.ts`, `payouts.ts` — all behind `requireRole(auth, 'affiliate')`, with
`policyReacceptanceGate` and `creatorStandingGate` mounted in front of the whole prefix. The
token-scoped `affiliate-invitation.ts` sits outside all of it.

### Data

`affiliate_prospects` (0008, 30 columns, `quality_tier` deliberately `text`),
**`affiliate_signup_profiles` (0010, 54 columns)** — one CHECK (`affiliate_signup_no_bank_data`),
one trigger (`affiliate_signup_claim_immutable`), and **no history table**: provenance is the in-row
`*_prefilled` / `*_supplier` / `*_edited_at` triple on **eight fields only**.
`campaign_affiliate_associations` (19-state enum), `affiliate_invitation_sends` (insert-only apart
from `notification_id`), `campaign_kit_access`, and 0048's six families including
`affiliate_evidence_files`, `affiliate_evidence_verifications`, and
`association_termination_requests`.

### Shared

`shared/src/affiliates/{subtypes,recruitment,slots,decisions}.ts` — `AFFILIATE_SUBTYPE_DEFINITIONS`
with per-subtype evidence inputs, `SPEC_8_FACTS` (19 ids), `RECRUITMENT_FIELDS` (21),
`ACTIVE_PARTNERSHIP_SLOT_LIMIT = 3`, `FOUNDER_ROSTER_STATUS_LABELS`, `LINK_TEST_MARKER`.

---

## What cannot complete today, and must not be stubbed

Three designed states recorded in `CLAUDE.md`, not defects:

1. **`terms` and `affiliate-aup` are both `draft`.** A `policy_consents` row may cite only a
   *published* version — a trigger, not a service rule — so `completeAffiliateSignup` returns
   `policies_unpublished` and `CreatorSignup.tsx` renders no primary button at all. **That is the
   correct state.** Do not write policy prose, do not stub a consent, do not accept a draft. Screen
   7 renders the reason where the button would be.
2. **R2 is unconfigured (Track A4).** `unconfiguredStorage` throws. Screen 6's screenshot upload and
   screen 5's profile photo render a **named absence** — the arrangement the Affiliate evidence
   uploader already uses: the presign answers 503 naming the gap **and** the payload carries
   `available: false` with the same sentence, so the surface renders the absence rather than a dead
   control.
3. **No email provider is configured.** `unconfiguredTransport` throws and records the failure.

A screen whose dependency is missing says **which** dependency, in §27.1's six-question shape. It
does not render a disabled control with no explanation, and it does not fake the capability.

---

## The honest position on §1 rule 6

Five deviations, taken by explicit product direction on 2026-08-19 after each was put with the rule
that forbids it. Each needs its own `CLAUDE.md` section. Each is narrowed by **mechanism**, not by
intention — the pattern `email-code.ts` and `campaign_followers` established.

### Deviation 1 — the nine-screen onboarding

§11: *"one compact account-and-profile flow with one primary action: `Confirm and create account`"*
and *"There is no welcome tour, multi-page education sequence, separate banking page, or public
Affiliate signup."* §30 defers *"General product tours/splash education."* §33.2.2 tests
*"Compact flow has Proovd account action and Stripe payout action, no custom bank form/tour."*

**What stays true, and is asserted:**

- Every §11 content bullet is still collected, on one screen or another. Nothing is dropped.
- The five confirmations remain **five separate unchecked controls writing five columns** (§28.4).
  A test counts the controls and the columns.
- **No bank, routing, tax-id, or identity-document input exists anywhere**, and no route could
  accept one. The absence is the enforcement, as it is today. `affiliate_signup_no_bank_data`
  stands.
- There is **no public route**. The whole flow is behind `requireAffiliateInvitationToken`.
- The invitation still claims exactly one association (§33.2.1).
- `Finish payout setup` remains the only additional primary onboarding action, and it remains a
  handoff to Stripe.

**§33.2.2 is re-authored, not deleted.** It becomes: *"the flow has a Proovd account action and a
Stripe payout action and no custom bank form."* The half about money is the half that is load-
bearing; the half about the tour is what the deviation departs from, and the test says so in a
comment naming this brief and the date.

**What a later phase must not read this as licence for.** Not a public signup route. Not a second
invitation mechanism. Not a Founder-facing tour, a Backer-facing tour, or an education sequence
anywhere else. §30's deferral of general product tours stands for every other surface in the
product.

### Deviation 2 — the Creator standing record

The reference's Home carries an `Affiliate score` of 742, `Top 8% of affiliates`, a Gold→Platinum
tier bar badged `Founders see this`, `How to climb your score`, a `6-campaign streak`, a track record
(`Launched` / `Hits` / `Backed`), and a `Ranked by impact` leaderboard naming other Creators.

§30 forbids *"Public leaderboards/shaming"*, *"Confetti/streaks/countdown pressure"*, and
*"Automatic Affiliate percentile pruning"*. §8 makes the internal quality tier *"assessment data—not
a commission floor"*. §26 says *"The Admin panel is the only dashboard-style product in MVP."*

**The hard constraint: the tier binds nothing.** The reference's *"Climb toward Platinum for higher
floors and early access"* is an **eligibility condition** in §1 rule 6's own list, and it would
collide with something already built: §29.4 makes `restrict bidding` an enforcement action, and the
Affiliate Admin workspace already **derives** `proposal_access` from §29 records rather than storing
it. A standing tier that changed proposal access would be a second, contradictory answer to the same
question.

So:

- `STANDING_BINDS_NOTHING` is a pinned sentence rendered with the block.
- A **source scan** asserts that no file under `backend/src/affiliates/decisions.ts`,
  `creator-payment/`, `close/earnings.ts`, or `affiliates/readiness.ts` reads the standing tables.
- The copy loses `higher floors and early access` and every other benefit claim.
- **Every number is derived from a record that already exists, or it is not shown.** `Launched` =
  associations at `successfully_completed`. `Backed` = captured, validly attributed, pre-tax reward
  subtotal. A rate over a zero denominator is `null`, never `0%` (§16a's rule, and 17a's).
- The score, the percentile and the tier thresholds are the genuinely new part. They are a stored
  snapshot with the inputs recorded beside them, never a live recomputation a surface can drift
  from — 21b's completion-findings reasoning applied to the number a Creator will read hardest.
- The leaderboard renders **public handles only** and nothing about another Creator's money.
  §11's Founder→Creator boundary has no Creator→Creator twin in the Spec, so this brief states one:
  a Creator sees of another Creator exactly what a Founder sees of them.

**What a later phase must not read this as licence for.** Not a public leaderboard. Not a score on
any Founder or Backer surface. Not a ranking that decides who is recruited, who may bid, or what
base applies. Not confetti.

### Deviation 3 — the referral link

`Refer other affiliates` / `Bring an affiliate you'd vouch for and earn a percentage of their
campaigns` / `proovd.co/join/mohab`.

§5.3: *"No open public signup. Enters only through a private, campaign-specific invitation."*
§8: *"No generic Affiliate credential email and no public signup exist."*

**The record is an introduction, not a signup route.** A referral produces an **Admin task** naming
who vouched for whom; recruitment stays §8's, the invitation stays campaign-specific, and the link
creates no account and no association. The URL is a token that opens a form Admin reads, not a
route that admits anybody.

**`earn a percentage of their campaigns` is refused outright.** §24 defines four money streams and
this would be a fifth. `REFERRAL_PAYS_NOTHING` is pinned beside the control and the copy is
re-authored.

**What a later phase must not read this as licence for.** Not a public join page. Not a referral
commission. Not an affiliate-of-affiliate tree.

### Deviation 4 — the Resources screen

Four tiles — `Marketing Toolkit`, `Content Templates`, `Best Practices Manual`,
`Campaign Tracking and Analytics` — whose action is *"We'll email you when it's ready."*

§14.1: *"All material lives in one Campaign kit. No separate resource-library or education journey
is required."* §30 defers *"Reusable Affiliate course/resource library; the single Campaign kit is
required."*

**What keeps §14.1's sentence true is a separation, and it is structural:** the Resources record
carries **no campaign material and no campaign reference**. It is a list of four things that do not
exist yet plus an interest record — a table with a resource key, a subject, and a timestamp, and no
column that could hold an asset, a URL, or a campaign id. A test asserts those columns are absent.
It does not replace the §31.5 Campaign kit and cannot become it.

**What a later phase must not read this as licence for.** Not a content library. Not campaign
material outside the kit. Not an education journey.

### Deviation 5 — the account-level home and Earnings address

§26: *"The Admin panel is the only dashboard-style product in MVP."* The Spec gives the Creator four
named surfaces (§11's claim, §10's preparing kit, §14.1's opportunity, §17's active partnership) plus
settings and notification history — and no home.

What is built is a home and an earnings address that are **not a widget grid**: §20's rules for the
Founder home, applied here by analogy because the Spec gives no Creator equivalent. No KPI tile wall,
no counters table, no real-time claim, `Updated [local time]` with the refresh-based explanation
(§17's own words), and every unpopulated block names what it is waiting for.

**What a later phase must not read this as licence for.** Not a Backer dashboard. Not real-time
sockets. Not a second place a campaign is operated from.

---

## The one place the reference is more compliant than the product

§5.3 lists, verbatim: *"Affiliate settings: name, email, phone, password, channel type/handles,
audience metrics, niche, bio, connected-account/transfer/tax/payout status, notification
preferences, and delete-account request."*

Today **none of that is editable after the claim.** `saveSignupProfile` hard-refuses once
`claimed_at` is set, and no session-authenticated route writes `affiliate_signup_profiles` at all.
The only post-claim write is Admin's `correctAffiliateAccountField`, over six columns, from
`/api/admin/creators/:prospectId/account-correction`. And `requestAffiliateCorrection` emails a
Creator the `affiliate_correction_request` key **asking them to correct something they have no route
to correct.**

The Settings screen closes that gap. **It is not a deviation** — it is §5.3 as written. It inherits
the Admin correction path's discipline exactly:

- a **reason** is required;
- the **prior value is read from the row `FOR UPDATE` inside the transaction that changes it**
  (§33.12.4 — a caller that supplies both halves can supply a flattering pair);
- an **audit row** in the same transaction, because `affiliate_signup_profiles` has no history table
  and `date_of_birth`, `country`, `state_region` and the five confirmations have no provenance
  columns at all;
- the supplier triple is recomputed on the eight prefillable fields, so §11's source label stays
  true;
- **`legal_name` and `email` are not freely rewritable** — they are the identity Stripe was given
  and the address every transactional message goes to. They take the same shape as the Admin path.

The delete-account request is **recorded, not executed** — retention obligations outlive the account
(the `founder_deletion_requests` arrangement: no `deleted_at`, no purge schedule, no `approved`
state).

---

## What the reference draws, and where each piece comes from

| # | Screen | Writes to | Verdict |
|---|---|---|---|
| 0 | Splash — the claim intro and the sticker peel | — | **new** (deviation 1) |
| 1 | `Set a password.` + the four live requirements | Better Auth `account.password`, at the claim | as drawn |
| 2 | `Make sure we got you right.` — legal name, email, phone | `legal_name`, `email`, `phone` + triples | **differently** — email is *not* `Locked` |
| 3 | `What founders see.` — 9 channel tiles, handle, niche, description | `channel_reference`, `audience_niche` + **new** `channel_type`, `niche_description`, `outreach_plan` | partly new |
| 4 | `Sound like you.` — tone chips, custom tones, flexible switch | **new** `affiliate_voice_tones` | new |
| 5 | `Put a face to it.` — photo, username, bio | `public_handle`, `bio` + **new** photo | **differently** — one handle field, not two |
| 6 | `Prove it's real.` — screenshots, per-channel metrics | 0048 `affiliate_evidence_files` + **new** channel metrics | **absent today** (R2, Track A4) |
| 7 | `You stay in control…` — the promises and the agreement | `policy_consents` × 2, five confirmation columns | **differently** — five controls, not one button |
| 8 | All set — the typed headline and the FLIP | — | re-presentation |
| — | Home — pitches hero, standing, track record, leaderboard, referral | **new** standing + referral; open proposals from `proposal_versions` | deviations 2, 3, 5 |
| — | Pitches — tabs, 5-step reveal, the list, the decisions | `readFormalOpportunity`, `acceptStandardTerms`, `declineOpportunity`, `submitProposal`, `respondToProposal` | **re-presentation** |
| — | Active / work — link, disclosure, first post, materials, metrics | `buildCreatorPartnership`, `submitPost`, `association_termination_requests` | **re-presentation** |
| — | Earnings | `readCreatorClose` + `creator_earnings` | **re-presentation** |
| — | Resources | **new** | deviation 4 |
| — | Settings — profile, signed, password, notifications | `affiliate_signup_profiles` post-claim, `/api/creator/notifications/*` | **closes a §5.3 gap** |

**The `work` screen is §17's own content list, redrawn.** Read §17's *"After readiness/activation,
show:"* bullets beside the reference's screen. Fourteen of them already have a field in
`buildCreatorPartnership`'s payload. That correspondence is why this is a re-presentation and not a
rebuild, and it is the single largest saving in the phase.

**The nine channel tiles are not the §5.3 subtype register**, and the difference matters. §5.3 has
seven subtypes and the reference has nine tiles (it splits social into YouTube/TikTok/Instagram).
`AFFILIATE_SUBTYPE_DEFINITIONS` stays the authority for **evidence**; the tile is a presentation
choice over `social_creator` plus a platform. Do not add two subtype registers.

---

## The twenty-four places the reference and the Spec disagree

§1 rule 8: the Spec wins on all of it. Each is a decision, made here, in the open. The five
deviations above are the exceptions and are not repeated here.

### 1. `Withdraw` / `Ready to withdraw` / `Get your tax docs`

Two places: the Earnings hero and the per-campaign panel.

§22.1, verbatim: *"The Affiliate never requests a Proovd withdrawal and never receives Backer funds
before Transfer creation."* Admin creates **one** idempotent Transfer on or after Day 3, under the
§11 tax gate, for finalized commission + earned bonus + eligible fixed amount.

The screen keeps its typography and its visual weight. The hero renders the real amount from the one
resolver. The control becomes **Appendix B.7**, exact text, resolved server-side:

```
US$[AMOUNT] recorded

Status: [ESTIMATED / FINALIZED / APPROVED FOR TRANSFER / TRANSFERRED /
PAID OUT / PAYOUT FAILED / ADJUSTED]
Why it is not paid yet: [REASON]
Expected next update: [DATE]
Your action: [ACTION or "No action needed"]
```

`resolveAffiliateMoneyStatus` already exists and already throws on an unfilled bracket. Use it.
`earnPending: 'None'` becomes the honest not-yet-populated state (§16a).

### 2. `Reserves` / `reservations` / `38 reservations`

`metrics.reservations`, `workRes`, `wBonusTarget`'s copy, and `activesV`'s status lines.

§3.1 makes `reservation` the internal name and `Pre-order` the customer-facing one, and a Creator is
a customer. §3.2's last paragraph binds **identifiers**, and §33.11.3 scans the built bundle where a
prop name survives minification.

**Pre-orders**, everywhere — copy, prop names, state keys, fixtures, and commit messages.

### 3. `Upfront offered` / `$400 upfront` / `Lead with the $400 upfront`

Three places in the seed data plus the badge.

§3.2 bans `upfront (fee|payout|payment)` in every audience **including identifiers**, and names the
replacement: *optional fixed Creator payment / secured Creator payment / Creator payment funded*.
This was resolved identically on 2026-08-11 for the Affiliate Admin workspace — where the
reference's own acceptance audit had *mandated* the banned term — and again in Founder Flow v2
Session F. **This is the third time.**

`FIXED_PAYMENT_FUNDED_IS_NOT_PAID` travels with the copy.

### 4. `Counter the rate`, rendered only when `highEffort`

`crCanCounter: !!(cr && cr.highEffort)`.

§14.2 has **two** proposals and gates them differently:

- **Percentage bid** — high-effort only, total base + bid + bonus capped at 50%.
- **Fixed Creator payment request** — **Product Campaign only, whether or not high-effort.**
  §12 states it outright: *"High-effort status controls only whether an Affiliate can bid a
  percentage above the base; it does not control fixed-payment availability."*

The reference offers no fixed-payment request at all, and gates the bid on the wrong axis for the
other one. Both are offered, correctly gated. §33.2.8 already tests both refusals — *"Idea rejects
fixed request; standard campaign rejects bid above base"* — and must stay green.

`FormalOpportunity.tsx` already renders both correctly. This is a re-presentation of a control that
works, not a new one.

### 5. `Request a 1-1 meeting`

Three places: the pitch recap, the work surface, and `bookMeeting()`.

§30 defers *"Founder–Creator meeting scheduler; the human Founder interview scheduler is required"*
and *"Direct Founder–Affiliate messaging"*. §16 adds the no-nudge rule from the other direction.
The Founders workspace rebuild refused a meeting record for exactly this reason on 2026-08-17 and
recorded it as `MEDIATED_REQUESTS_ABSENT`.

**Refused.** The register carries the reason where the control would be.

### 6. `predicted: '$450 to $1,200'` / `'$400 up + 25%'`

`PITCH_META`, rendered on every browse card.

No record holds it, and §22.2's *"Never guaranteed, estimated, or calculated by the product"* is the
nearest rule with teeth. §1 rule 6 is the direct one.

**Refused.** What the card renders instead is the real §14.3 cell: the base percentage, and the
`earnLine` the opportunity already carries.

### 7. `Trending in your niche`

§30: *"Fake scarcity, fabricated popularity/live viewers, or false urgency."* Nothing counts
"trending" and nothing could.

The badge renders §14.1's own record: **`Why this fits your audience`, two Admin-written sentences.**
That is a real field, it is what §14.1 puts first on the opportunity surface, and it is better copy.

### 8. `Rate at your floor` / `Sits at your floor. Countering for 30 to 35% is fair here.`

Implies a stored per-Creator rate floor and then advises a number.

§14.3's base comes from three §6 settings and the campaign's model — there is no per-Creator floor
anywhere, and inventing one is an eligibility condition. Advising a counter amount is Proovd taking
a side in a §14.2 negotiation it is only allowed to mediate.

The badge names the matrix cell. The advice goes.

### 9. `I published my first post` → *"First post is live. Tracking is on."*

`confirmPost()` sets `posted: true` from a Creator's own click.

§17's steps 4 and 5 are *"Each Creator submits the public post URL"* and *"Admin verifies the live
post"*, with three outcomes. `submitPost` already exists at
`POST /api/creator/campaigns/:associationId/submit-post` and already notifies the queue. And
tracking started at `activated_at` (§17 step 2), not at this click — the sentence is false as
drawn.

The control submits the URL. The state that follows is `FIRST_POST_LABELS`' pending-verification
one. §33.4.7 requires the verification to release US$0 and must stay green.

### 10. Scripts and assets `in your {tone} voice`, `Customize`, `Generate milestone graphic`

`onGet: () => this.flash(n + ' copied in your ' + wTone + ' voice.')`, `onPromoCustomize`,
`onGenGraphic`.

§30 defers *"AI pitch rewriting/refinement"*. §12 makes the helper resources *"static, copy-ready
guidance—not an embedded AI product"*. There is no model client anywhere in this tree and a shared
test scans for one.

The tabs stay. What they render are the **real §31.5 Campaign kit assets and §14.1 disclosure
templates**, downloaded rather than generated. The recorded tone is **shown** — it is the Creator's
own answer and worth showing back — and never used to rewrite anything.

### 11. `workSurvey` — Backer quotes on the Creator surface

`'"Bought it for the cloud renders, stayed for the speed."'`

§19: *"Affiliate sees only aggregate clicks, attributed pre-orders, reward summary, and
timestamps."* §28.4: *"Affiliate receives no Backer PII."* A free-text survey answer is neither
aggregate nor a timestamp, and §19's survey consent is scoped to the Founder's results surface.

**Refused.**

### 12. `workBase` / `workBonusAmt` = `earned * 0.8` / `earned * 0.2`

Money arithmetic in the browser, with invented weights.

There is **one** waterfall, in `shared/money`, and §24.4 has the real split: finalized commission,
earned bonus, and eligible fixed amount are three separate stored numbers on `creator_earnings`.
A source scan asserts no arithmetic on an amount exists under `frontend/src/surfaces/creator/`.

### 13. Three notification switches — `New pitches`, `Campaign updates`, `Payouts`

§27.2's first rule is that transactional email is **not** opt-out-able, and `Payouts` is the most
transactional message a Creator receives. §27.7's optional digest is the one opt-out-able thing in
the product, its preference exists only because a person chose it, and its control already lives at
`/creator/settings/notifications`.

The Settings screen renders **that** control plus the notification history — which is the §27.7
capability the Spec actually grants, and which must not become a dashboard: no count in the payload,
no read-state column, no unread badge (22c's four assertions).

### 14. `Browse` mode, sorted by `Commission` and `Price`

`queueMode: 'browse'`, `SORTS`, `browseList`, the horizontal `.hrow`.

§5.3 and §8 admit a Creator to **one campaign per invitation**; §11 says the Creator *"remains tied
to the one campaign that caused the invitation"*; §30 defers *"Algorithmic general-pool Affiliate
matching"* and *"Founder browsing/outreach to unmatched Affiliates"*. There is no marketplace.

What survives is real and is worth keeping: a Creator may hold several open invitations at once
(and up to three active partnerships, §2.2). So the list is **their own open invitations**, the
horizontal presentation stays, and sorting stays. The word `browse`, the framing, and the
commission/price sort keys go — sorting is by response deadline and by campaign.

### 15. `Terminate / report founder` → *"One admin decides: pass, warning, restrict, or remove."*

That sentence is §29.4's vocabulary for enforcement actions **against the Creator**, printed on a
control that reports a Founder.

The real record exists: 0048's `association_termination_requests`, with its money treatment
CHECK-matrixed against §24.8's per-cause register, one open ask per relationship, and a write-once
decision. §29.5 names the valid reasons: *"Founder material breach, Proovd suspension, documented
emergency/capacity, or other Admin-accepted reason."*

The control opens that record, with §29.5's own vocabulary, and says what it actually does.

### 16. `Your money is guaranteed` / `Follow the agreement and your pay is locked` / `No clawbacks.`

On the consent screen, above the agreement.

**This is the most dangerous string in the reference.** §22.1 provides for cancelling unpaid invalid
amounts and creating *"a negative balance and contractual recovery record"* on fraud, fake traffic,
self-dealing, false claims, invalid proof, or material breach. §29.5 protects only *valid finalized*
commission and only *"absent Affiliate-caused invalidity"*. §24.8's cause register and 20a's
`applyCauseBasedAffiliateAdjustment` exist precisely because clawbacks happen.

Re-authored to what is true, on the screen where a person is consenting. The honest version is
strong copy and is close to the Spec's own: compensation locks at bilateral acceptance (§14.2),
first-post verification releases nothing (§17), and completed verified work is eligible *"even if
sales were poor"* (§22.1) — which is the real promise and is better than the false one.

### 17. One `Agree and enter` covering Terms + AUP + IP & NDA + four representations

*"Tapping agree accepts the Terms, Acceptable Use Policy, and IP & NDA Agreement, and confirms
everything above."*

Three problems. §28.4: *"No dark pattern, preselection, or bundling of optional consent"* and
*"18+ confirmation is required and unchecked."* §11 requires **Terms and Affiliate AUP** — two
acceptances, and `AFFILIATE_CLAIM_POLICY_SLUGS` is exactly those two. And §31.5's IP agreement is
**per campaign**, due before *work*, and is already collected at §14.2 acceptance alongside the FTC
acknowledgment — putting it here would collect it for a campaign the Creator has not yet accepted.

Two policy acceptances and five separate unchecked confirmations, as today. The IP agreement is not
on this screen.

### 18. Email rendered `Locked`

Screen 2 renders the email in a disabled box with a `LOCKED` tag.

§11 requires a *"source label for prefilled public information and ability to correct it"*, the
column carries a full supplier triple, and `saveSignupProfile` already lowercases and accepts it.
Locking it removes a §11 right and would strand a Creator whose invitation went to a stale address.

Correctable, with its source label.

### 19. `Username` and `public_handle` as two fields

Screen 5 adds a `Username` input; screen 2's `profUsername` writes the same conceptual thing.
`public_handle` is one column and is what a Founder sees (§11's public card).

One field, one column, on screen 5.

### 20. *"This is what shapes your **affiliate score** and whether founders trust you."*

On the Verify screen, beside the upload. Plus `matchPct` rising 25% per screenshot and
`'Add proof to unlock'`.

Even under deviation 2, this makes evidence upload an **eligibility mechanic** — the number of
screenshots deciding how many Founders can see you is §30's percentile pruning with a friendlier
face, and §8's verification is Admin's recorded judgement over §5.3's evidence, not a count.

The copy states what §5.3's evidence is actually for: it is what an Admin verifies the channel
against. The meter goes.

### 21. `Proovd never costs you anything.`

Broader than any record. §24.5 forbids hiding processing fees inside Creator percentages and §24.7
keeps the fixed payment out of every percentage — both true, both narrower than the sentence.

Narrowed to what §24.5 and §22.1 actually guarantee.

### 22. `Founder shout-outs`

`GROW.shouts` — two testimonials about the Creator, attributed to named Founders.

No record holds them, and §30 defers *"Public Founder ratings"* from the other direction.

**Refused.**

### 23. `verifySpec()` is computed and never rendered

`verifyFields` is built in `renderVals` (2457) from a six-branch per-channel switch and appears
nowhere in the template. It is a genuine bug in the reference — and the fields it produces are
good: subscribers and open rate for a newsletter, downloads and completion for a podcast, members
and weekly-active for a community.

They map cleanly onto §5.3's own evidence register, so they are **built** — from
`AFFILIATE_SUBTYPE_DEFINITIONS`, which already carries `subscribers`, `click_through`, `downloads`,
`members`, `active_users`, `enrolled_students`, `ratings`, `followers`, `engagement` — rather than
from the reference's hard-coded list. One register, not two.

### 24. `signOut()` returns to the onboarding wizard

`this.setState({onboarded:false, step:0, ...})`. A prototype artifact; sign-out ends the session.

---

## Scope

**This is six sessions.** The seams are named below; do not start one whose predecessor is not
green. A truncated session produces code that looks finished and is not.

**The seams are the auth-regime and money boundaries**, the arrangement Founder Flow v2 used — so
each session ends where a guard changes, and after Session B each is walkable from screen 0 the
moment it lands, which is the cheapest way to find a seam that does not join.

| | Screens | Ends at | Depends on |
|---|---|---|---|
| **A** | none | the reconciliation, migration `0055`, the shared registers | — |
| **B** | 0–3 | the shell, `PHASE 37`, motion, routes, `PRINCIPAL_FLOWS` | A |
| **C** | 4–8 + the claim | the end of the invitation token; §33.2.2 re-authored | B |
| **D** | the app shell + Home | the rail, both drawers, the standing and referral records | C |
| **E** | Pitches + the Active list | over `decisions.ts` unchanged | D |
| **F** | work, Earnings, Resources, Settings | the money-surface consistency pass | E |

**Session A writes no surface.** **Session E adds no decision service** — `acceptStandardTerms`,
`declineOpportunity`, `submitProposal` and `respondToProposal` are §33.2.6–13's, and the strongest
statement that this session did not disturb them is those tests passing unchanged. **Session F adds
no second money path**: there is one Transfer per association and it is Admin's.

---

# SESSION A — the record, the registers, and the order

Session A builds no screen. Its output is the guarantee, not the content.

## A1. The reconciliation

Write `docs/phases/creator-flow-reconciliation.md`. Five declared verdicts, plus the two the Founder
flow found it needed:

| Verdict | Meaning |
|---|---|
| **as drawn** | Exists today and matches. A later session re-presents it. |
| **differently** | Exists today in a different shape or place. The difference is stated. |
| **re-presentation** | A record that already exists, drawn a new way. No schema, no service. |
| **new** | Nothing holds it. Named, with the deviation it costs. |
| **refused** | Drawn by the reference, forbidden by the Spec. The rule is named. |
| **absent today** | A dependency gap (R2, the policies, the transport). |
| **absent from the reference** | Something the product must have that the prototype never drew. |

An element with no verdict is an element nobody decided about. Every later session appends its own
`## N. Session X's screen order, as built` and `## N. What the Session X browser pass found`.

## A2. Migration `0055_creator_flow_v2.sql`

Boxed header in the 0050–0054 idiom, with the mandatory
`── What this migration deliberately does NOT add ──` list. Insert-only tables get
`GRANT SELECT, INSERT` plus a column-scoped `GRANT UPDATE` naming each column and a `REVOKE DELETE`.
Triggers are `$fn$`-quoted and raise **human sentences** at `ERRCODE = '23514'`, never a constraint
name. If you add an enum label and then use it, split `0055` / `0056_..._binding.sql` — the
0008/0009 dance, restated by 0050/0051. Do not merge them.

**What it adds:**

1. **`affiliate_signup_profiles`** gains `channel_type`, `niche_description`, `outreach_plan`,
   `profile_photo_key` — each with its `*_prefilled` / `*_supplier` / `*_edited_at` triple where the
   field is prefillable, so §11's source label keeps working. `channel_type` is the Creator's own
   answer and is **not** `affiliate_prospects.subtype`; a disagreement between them is a fact for
   Admin, not something the product resolves (see Traps).
2. **`affiliate_voice_tones`** — the tone chips, the custom tones, and the flexible flag. One live
   set per profile; a change supersedes rather than edits.
3. **`affiliate_channel_metrics`** — the per-subtype answers from §23 above, keyed on the evidence
   id from `AFFILIATE_SUBTYPE_DEFINITIONS`. A CHECK pins the id to the register.
4. **`affiliate_standing_snapshots`** — deviation 2. Insert-only, with the inputs stored beside the
   outputs. No column that any compensation, readiness, or proposal path could read.
5. **`affiliate_referrals`** — deviation 3. Records an introduction. **No amount column, no
   percentage column, no commission column** — a test asserts the exact column set, the way 0052's
   openness record does.
6. **`creator_resource_interest`** — deviation 4. A resource key, a subject, a timestamp. **No
   asset column, no URL column, no campaign id** — asserted absent.
7. **The post-claim correction record** — the Settings write, with its reason, prior value, and
   audit linkage.

**What it deliberately does NOT add:** no `affiliate_signup_field_edits` history table (the in-row
triple is the arrangement `affiliate-signup.ts:8-14` chose deliberately, and the audit row covers
the rest); no schedule-shaped column anywhere (`remind_at`, `notify_at`, `recurrence`,
`next_send_at`, `cadence`, `escalate_at`, `snooze_until`) and no job that reads any new table; no
`proposal_access` column (§29-derived, and adding one would be the eligibility flag deviation 2
exists to avoid); no second subtype register; nothing that could hold a bank, tax id, or identity
document.

## A3. The shared registers — `shared/src/creator-flow/`

- **`flow.ts`** — the page register on `FOUNDER_FLOW_PAGES`' six-field shape
  (`id`, `path`, `param`, `title`, `help`, `stage`), `CREATOR_FLOW_PAGES`, `CREATOR_FLOW_ROUTES`,
  `creatorFlowPath` (which throws on an unknown id and substitutes rather than interpolating),
  `creatorFlowReachableFrom` (comparing `param`, not `stage`), and **`CREATOR_FLOW_ABSENCES`** —
  the `{ element, absentBecause, specRef }` register for every refused element, because an element
  that is absent has nowhere on a page to say why. **A later session that wants one back has to
  delete the entry that refuses it.**
- **`voice.ts`** — the six tones, the custom-tone rules, `VOICE_IS_NEVER_USED_TO_REWRITE`.
- **`standing.ts`** — deviation 2's vocabulary, the derivation inputs, `STANDING_BINDS_NOTHING`.
- **`referrals.ts`** — deviation 3, `REFERRAL_PAYS_NOTHING`.
- **`resources.ts`** — the four tiles and `RESOURCES_ARE_NOT_THE_CAMPAIGN_KIT`.

Pinned sentences are grouped by the session that pinned them, each with a JSDoc naming where it
renders and which section requires it.

The backend restates whatever it needs at runtime and drift-tests it — the `rootDir` constraint,
as always.

## A4. Session A done when

- The reconciliation exists and every reference element carries a verdict.
- `0055` applies, and its absence assertions pass.
- The registers exist, the backend restatement drift-tests green.
- `npm test` is green with no surface changed.

---

# SESSION B — the shell, and screens 0–3

## B1. The full-bleed page primitive

`CreatorFlowPage`, on `FlowPage`'s shape and for its reasons: module-scoped `pendingDirection`
(a fact about the transition, not about either page — routing it would make two addresses for one
screen), a `useFlowNav` context exposing `leave` / `leaveToPage` / `param`, and the help drawer
listing **current first, then backwards, never anything ahead**. A drawer showing what is to come is
a progress bar with reading attached, and it would offer jumps to addresses that refuse.

Outside the public shell (its header offers a nav bar of things to probe, and these pages are
reached by a personal link), outside the Admin shell (§26 licenses density there and nowhere else),
and outside every guard, because an invitation token is not a session.

**One address per page**, registered in `routes.tsx` as top-level `{ path, element }` objects.
DNA §5.12 wants position to survive interruption, and nine screens is nine positions a single
stateful page destroys on reload.

## B2. `PHASE 37` in `proovd.css`

The prefix is **`.crf-`**, and it is the fourth candidate — the obvious three are all taken.
State every collision in the header: `.cr-` is PHASE 26/32's Affiliate **Admin** workspace, `.cf-`
is PHASE 31's Create Founder compose page (`.cf-step`, `.cf-rail`, `.cf-check`), `.ff-` is PHASE
34's Founder flow, and `.mny-` is PHASE 36's Money & Fulfillment console. None is related to this.

**Check the number before you write it.** PHASE 36 was claimed on 2026-08-19 by Money & Fulfillment
while this brief was being written. Run `grep -oE "PHASE [0-9]+" frontend/public/proovd.css | sort
-u` and take the next free one; if it is no longer 37, use whatever it is and correct this heading.

Restate the three PHASE-25 conventions (tokens only; scoped reuse of `.btn` / `.choice` / `.field` /
`.tag` / `.drawer` / `.sticker` / `.wordmark`; brand fill takes `--mint`, because the reference's own
`#FAFAFA` on `#41ED98` is imperceptible — `proovd.css:158`).

Carry a **colour-resolution block** in the header resolving the reference's eleven `--p-*` tokens
onto existing ones, with the reason for each, and **mint none**. The reference's `--bw: 2px` and
`--br: 2px` are its hairline and radius; state which existing token each becomes. Its `--p-blue`
(`#DEFAFC`) and `--p-yellow` (`#F7FF9E`) are the only two with no obvious home — decide once, in the
header, for all fourteen screens.

Local display recipes are `--crf-*` on the root class, never new `:root` entries. Cross-component
overrides use `:where()` so they contribute no specificity.

## B3. Motion

Through `components/anim.ts` — `relayIn`, `pageExit`, `swellChoice`, `captureFlip`/`flipHome` — and
never raw GSAP in a surface file. Every duration is a §6.1 token and each says which reference value
it stands in for.

**The splash is its own helper.** The reference's is a 2.6-second hand-written rAF track with a
1.2s safety timeout. §30 forbids countdown pressure and DNA §6.1's ceiling is `grand: 0.90`. So: a
hard cap, a **skip control that is present from the first frame**, `reduced()` short-circuits it
before it starts, and it plays **once per token**, never on a return visit.

The All set → Home FLIP is `captureFlip` before the state swap and `flipHome` after, matched by
`data-flip-id` because the source and target are different DOM nodes.

## B4. Screens 0–3

Screen 0's `Get started`, screen 1's live requirement list (`pwReqs`, four checks) and the confirm
field that grows in, screen 2's three fields with **email correctable**, screen 3's nine tiles and
the Student-only outreach textarea.

Autosave through `useAutosave` and `describeSaveState` — §9's vocabulary, already shared. **A key
absent from the request writes nothing** (`saveSignupProfile` already honours this); the typed value
never comes back from the server, so a failed save cannot clear a valid field.

## B5. Routes, the flow register, and fixtures

New `PRINCIPAL_FLOWS` entries, **split by auth regime** the way the Founder flow's four are, with
routes **restated and drift-tested** rather than spread (spreading widens every literal to `string`).
Typed fixtures in `frontend/src/features/qa/fixtures.ts` against the api modules' own interfaces.

## B6. Session B done when

- Screens 0–3 render and save, from `/creator-invitation/:token`.
- The help drawer lists what is behind and nothing ahead.
- §33.11.1–7 pass over the four new addresses: no axe violations, exactly one `h1` per page, every
  nav control names its destination (§33.11.4), the whole walk is reachable by keyboard (§28.5), and
  the stub server records no unmatched request.
- A browser pass at 1280 and inside a 320px iframe.

---

# SESSION C — the end of the invitation token (screens 4–8, and the claim)

## C1. Screens 4–8

Voice (tone chips, custom tones, the flexible switch), Presence (photo, one handle field, bio),
Verify (the upload as a **named absence** while R2 is unconfigured, plus the per-subtype metric
fields from `AFFILIATE_SUBTYPE_DEFINITIONS`), Agree (**five separate unchecked controls** and two
policy acceptances, with the re-authored promises), and All set.

## C2. The claim is not touched

`completeAffiliateSignup` is **not** split, reordered, or made partial. One transaction:
`affiliate_signup_complete:<associationId>` claimed first, `claimAffiliateInvitation`, the profile
UPDATE that must affect exactly one row, the prospect and association updates, **both**
`association_status` hops recorded even when the Creator never saved first, two `policy_consents`
rows, and the audit row with `newValue.corrections`. Account creation stays **before** the
transaction, for the reason `signup.ts` records: a leftover account is recoverable by clicking the
link again; a claimed invitation with no account strands somebody behind a dead link.

The strongest statement that this session did not disturb it is `creator-signup.test.tsx` passing
with **only** the assertions that are about the wizard consciously inverted, each carrying a comment
naming this brief and the date.

## C3. §33.2.2, re-authored

One test, one comment, one date. See deviation 1.

## C4. Session C done when

- The nine screens walk end to end, and the claim refuses with `policies_unpublished` in the open.
- The five confirmations are five controls and five columns; a test counts both.
- No bank, tax, or identity input exists on any screen; a test posts one at every route and asserts
  nothing lands.
- §33.2.1 and §33.2.3 pass unchanged.

---

# SESSION D — the app shell and Home

## D1. The shell

The rail (Home, Pitches, Earnings, Resources, and Settings below), the menu drawer, and the
notification drawer. The rail's Pitches count is real — open `proposal_versions` — and the
notification drawer reads `notification_deliveries` through 22c's history, which **must not become a
dashboard**: no count in the payload, no read-state write, no `unread` column, and the audience
prefix is what keeps `internal_*` off it.

## D2. Home

The pitches hero and its `Review pitches` action; the standing block; the track record; the
leaderboard; the referral card; `Team up again` (which is §22.9's real work-again record, read-only
from the Creator side until the Founder asks); and the caught-up state, which renders no manufactured
CTA (DNA §5.4, §20's rule).

Every number derived. `STANDING_BINDS_NOTHING` and `REFERRAL_PAYS_NOTHING` pinned. The source scan
from A3 runs here.

## D3. Session D done when

- Home renders for a Creator with pitches, a Creator with none, and a brand-new Creator whose
  standing has no observations — three different states, none of them a zero standing in for a gap.
- No compensation, readiness, or proposal path reads a standing table (source scan).
- The notification drawer's four dashboard assertions pass.

---

# SESSION E — Pitches, and the Active list

## E1. The tab switcher and the two modes

`Active` / `Pitches` with counts. The five-step tap reveal (`pSeg`, `hintLabels`, `p0`–`p3`, then
the recap) and the list.

**§28.5 names "Affiliate decisions" among the five required complete keyboard paths.** A
tap-anywhere-to-advance walkthrough is not one. So the steps have a real keyboard path, and the
recap is reachable **without** walking them — a decision must never be behind a gesture.

## E2. The three decisions

Over `readFormalOpportunity`, `acceptStandardTerms`, `declineOpportunity`, `submitProposal` and
`respondToProposal`, **unchanged**. §14.2: *"none of the outcomes may be hidden"*, and declining
does not reduce standing — `DECLINE_NO_PENALTY_NOTE` already exists.

Both proposals, correctly gated (disagreement 4). Acceptance still requires its four confirmations,
still creates the tracking link inactive, and still moves the association to `accepted`, not
`active`.

## E3. Session E done when

- §33.2.6 through §33.2.13 pass unchanged.
- The recap is reachable by keyboard without the walkthrough.
- No file in this session calls a decision service that did not exist before it.

---

# SESSION F — work, Earnings, Resources, Settings

## F1. The work surface

§17's content list, redrawn over `buildCreatorPartnership`. The link and the disclosure with
one-click copy confirmation (§14.1). The first post as a **submission** (disagreement 9). The promo
and script tabs over real kit assets. The termination request over
`association_termination_requests`. Metrics with `Updated [local time]` and the refresh-based
explanation, and a conversion over zero clicks rendered `null`.

## F2. Earnings

Appendix B.7, exact, from the one resolver (disagreement 1). No withdraw control anywhere; a test
walks every button on the page and asserts none of them says `withdraw`, `cash out`, or
`request payout`.

## F3. Resources and Settings

Resources per deviation 4. Settings per the §5.3 gap-closing section above — profile fields with the
Admin correction path's discipline, the signed agreements, the password change through Better Auth's
own route, §27.7's digest control, the notification history, and the recorded delete-account request.

## F4. The money-surface consistency pass

One source, many renderers (§33.8.13's rule). The amount on Earnings, the amount on the work
surface, the amount in every §27.4 Creator email, and the amount the Admin close queue shows are the
same resolver's output. A test deep-compares them.

## F5. Session F done when

- Every §17 bullet has a field on the work surface.
- The Appendix B.7 block renders for all seven states and throws on an unfilled bracket.
- The §5.3 settings list is editable, with a reason, a prior value read under lock, and an audit row.
- `npm test` green in one run; the full flow walks from the invitation email to a live campaign.

---

## Out of scope

- **§14.2's decision services, §15's materiality, §16's readiness, §17's launch and verification,
  §22.1's Transfer, §29's enforcement records.** All built, all passing. This flow *waits* on them
  and re-presents them.
- **The Admin Affiliate workspace** (Sessions A–C, 2026-08-17). It owns the relationship end to end
  and this flow links into it, never past it.
- **Publishing the eight policies, configuring R2, configuring Cal.com, configuring the transport.**
  All Track A. State the absences; do not close them.
- **The `campaign_kit_access` log and §31.5's revocation.** Built in 08c and untouched.
- **A Creator-facing dispute surface.** §30 defers the in-product dispute center; §29.9's Backer
  support path is the Backer's, not the Creator's.

---

## The existing tests, and which way each moves

Sort them **before** touching anything.

| Group | Direction |
|---|---|
| `creator-signup.test.tsx` (550) | **partly** — the one-page/two-primary-action assertions invert with a dated comment; the five-controls, no-bank-field, `policies_unpublished`, prefill-provenance, and phone-unverified assertions **must pass unchanged** |
| `creator-campaigns.test.tsx` (305) | **extend; keep green** |
| §33.2.1, §33.2.3–13 | **must pass unchanged** |
| §33.2.2 | **re-authored** — one test, one comment, one date |
| §33.4.1–9 | **must pass unchanged** |
| §33.11.1–7 and `PRINCIPAL_FLOWS` | **extend** — new entries split by auth regime, routes restated and drift-tested |
| §33.11.3 bundle scan | **must pass unchanged** — `upfront`, `goal`, `reservation` reach no identifier |
| §33.12.5 `UNGATED_ADMIN_WRITES` | **extend** only if an Admin route is added; the referral task is one |
| §27 coverage partition | **extend** — every new key either sends or is recorded in `unsent.ts` with a kind, an owner, and a record |
| §33.1.8 (no SMS OTP) | **must pass unchanged.** Phone stays collected and unverified. |

---

## Traps

- **Four prefixes are taken, not two.** `.cr-` is PHASE 26/32 (Affiliate Admin), `.cf-` is
  PHASE 31 (Create Founder compose), `.ff-` is PHASE 34 (Founder flow), `.mny-` is PHASE 36 (Money
  & Fulfillment). Use `.crf-`, and grep the stylesheet for it before you commit to it.
- **PHASE 36 is Money & Fulfillment, claimed 2026-08-19**, and its files were untracked when this
  brief was written (`frontend/src/features/admin/money/`, `shared/src/admin/money-workspace.ts`,
  and edits to `admin-close.ts` / `admin-refunds.ts` / `admin-disputes.ts`). Rebase on it before
  Session B, and re-derive the free phase number rather than trusting this document's.
- **`campaign_affiliate_associations.affiliate_id` holds the PROSPECT id, not an account id.**
  The Creator's account identity is `affiliate_signup_profiles.claimed_user_id`. Anything keying a
  connected-account lookup off `affiliate_id` routes money at a UUID nobody owns.
- **Four `owns` helpers already exist** — in `creator.ts`, `completion.ts`, `enforcement.ts` and
  `founder-build.ts`, each re-implementing the `claimed_user_id` lookup. Do not add a fifth
  silently; if you consolidate, consolidate all four.
- **The channel type the Creator picks is not the Admin's §5.3 `subtype`.** A disagreement
  invalidates a recorded verification and is a fact for Admin — surface it, do not resolve it, and
  do not let the Creator's answer overwrite the classification the evidence was recorded against.
- **`useButtonProgress` must be mocked as a promise, not a callback.** The callback-shaped mock
  calls a promise, throws into the swallowing catch, and resolves immediately — so a `ConfirmDialog`
  closes on a decision the server refused, and every server-refusal assertion behind it passes for
  the wrong reason. `support.test.tsx` records this; three suites carried the wrong mock until
  2026-08-15.
- **Chrome headless will not give you a 320px viewport.** `--window-size=320,900` reports
  `clientWidth: 489` on Windows. Render inside a 320px iframe or the reflow check lies.
- **`SignupProfileState.campaignId` is `''` from `toState`** and is only filled by
  `readSignupProfile`'s spread. Any new direct caller gets an empty string.
- **Every rejection on a token route returns the identical frozen body** (`TOKEN_REJECTION_BODY`),
  and a rate limiter returns *that*, never a 429. A limiter that announces itself is the same
  enumeration oracle wearing a different hat.
- **`saveSignupProfile` refuses once `claimed_at` is set**, and that refusal is load-bearing for
  screens 1–8. The Settings write is a **different route** with its own discipline, not a relaxation
  of this one.
- **A `<datalist>`, not a `<select>`, for the tone suggestions** — and it goes *beside* the `Field`,
  never inside it. `Field` clones its only child to wire `htmlFor`; a fragment swallows the id and
  orphans every label in every dialog. The Affiliate workspace hit this on 2026-08-17.
- **`.sr-only` and `.page-title` have both been used by components and defined by nothing** in this
  file's history. Grep any class you reuse against the stylesheet before you rely on it.
- **A `.btn` and a `.tag` are `inline-flex`**, and an inline-flex flex item in a column is stretched
  by the default `align-items: stretch`. Both Founder Flow Sessions D and E lost a browser pass to
  this.
- **The prototype's `--br: 2px` is a radius, not a border.** `--bw: 2px` is the border. Reading them
  the other way inverts the entire visual language.

---

## Done when

- A Creator opens `/creator-invitation/:token` and walks nine screens to a claimed account, or reads
  the honest refusal where the policies are draft.
- The five §11 confirmations are five unchecked controls writing five columns, and nothing in the
  path can set more than one.
- No bank, routing, tax-id, or identity input exists on any Creator surface, and no route accepts
  one.
- The rail's five sections render with real records, and every unpopulated block names what it is
  waiting for rather than showing a zero.
- The three §14.2 decisions are reachable, correctly gated, and keyboard-complete (§28.5).
- The first post is submitted for verification, and the verification releases US$0 (§33.4.7).
- No surface renders `Withdraw`, `reservation`, `upfront`, or a predicted earning; the bundle scan
  confirms none reaches an identifier.
- Appendix B.7 renders for all seven earnings states from one resolver, and the amount agrees across
  every surface and every email.
- The §5.3 settings list is editable after the claim, with a reason, a locked prior read, and an
  audit row — closing the gap `requestAffiliateCorrection` has had since 2026-08-17.
- `CREATOR_FLOW_ABSENCES` holds every refused element, a test walks it, and the five deviations each
  have a `CLAUDE.md` section.
- `npm test` green in one run. §33.2, §33.4, §33.11 and §33.12 all pass.

---

## After this

The new primitive is `CreatorFlowPage` and the `.crf-` family, and what it is for is a
**token-addressed, guard-free, full-bleed sequence** — the second one in the product after the
Founder flow's. If a third appears, it takes this shape rather than inventing one.

The five deviations are narrow by construction: an onboarding sequence with no public route, a
standing that binds nothing, a referral that pays nothing, a resource list that holds no campaign
material, and a home with no widget grid. **None is a licence for its neighbours.** A later phase
asked to read the standing as an eligibility input, to pay a referral, to put campaign material in
Resources, or to build a Backer dashboard is asking for the §1 rule 6 violation these absences exist
to prevent.
