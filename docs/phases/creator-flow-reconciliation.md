# Creator Flow v2 — reconciliation

Companion to `docs/phases/creator-flow-v2.md`. Written as a **first pass on 2026-08-19**, before any
code, from the reference at `docs/design-refrence/Proovd-Creator-Flow-v2.html`. **Session A confirms
it against a served walk and corrects it; Sessions B–F extend it.** It is never re-written.

A later reader must be able to see that each difference was **decided**, not missed.

Every element is bucketed into one of these verdicts:

| Verdict | Meaning |
|---|---|
| **as drawn** | Exists today and matches. A later session re-presents it. |
| **differently** | Exists today in a different shape or place. The difference is stated. |
| **re-presentation** | A record that already exists, drawn a new way. No schema, no service. |
| **new** | Nothing holds it. Named, with the deviation it costs. |
| **refused** | Drawn by the reference, forbidden by the Spec. The rule is named. |
| **absent today** | A dependency gap — R2, the policies, the transport. Track A. |
| **absent from the reference** | Something the product must have that the prototype never drew. |

**An element with no verdict is an element nobody decided about.**

The walk's mechanical replacements apply everywhere and are not repeated per row: the `.dc` runtime
becomes React Router; `this.state` becomes the real API; `flash()` becomes the existing toast;
`sc-if`/`sc-for` become JSX; inline `style=` becomes `PHASE 37` classes; the prototype's hand-rolled
GSAP becomes `components/anim.ts`; and every seed record in the logic class
(`this.state.campaigns`, `GROW`, `NOTIFS`, `PITCH_META`) becomes a server read.

---

## 1. The canonical order

Two auth regimes, and the boundary is the claim — the same shape as the Founder flow's, one stage
shorter because a Creator has no listing fee.

| Stage | Auth regime | Screens, in order | The mechanism that forces this boundary |
|---|---|---|---|
| **1** | `requireAffiliateInvitationToken` | 0 Splash · 1 Password · 2 Profile · 3 Channel · 4 Voice · 5 Presence · 6 Verify · 7 Agree | No account exists. Every route is `/api/affiliate-invitation/:token`. |
| **2** | the claim itself | 7's primary action → 8 All set | `completeAffiliateSignup` creates the account and **claims the token**, so every address before it stops resolving. |
| **3** | `requireRole(auth, 'affiliate')` | Home · Pitches · Active · Earnings · Resources · Settings | Behind `policyReacceptanceGate` and `creatorStandingGate`, both already mounted on `/api/creator`. |

**The reference draws no boundary at all** — `signOut()` returns to step 0 and `onboarded` is a
boolean in component state. That is a prototype artifact; the boundary is real and is enforced by
two different middlewares.

### One move, recorded as a move

**The profile photo moves from screen 5 to a named absence.** The reference's `addPhoto()` sets a
boolean and renders an initial. R2 is unconfigured (Track A4), `unconfiguredStorage` throws, and the
Affiliate evidence uploader already established the arrangement: the presign answers 503 naming the
gap **and** the payload carries `available: false`. The control is not drawn as working and then
found not to be.

---

## 2. Every screen, reconciled — first pass

### Stage 1 — the invitation token

| # | Element | Verdict | Note |
|---|---|---|---|
| 0 | Sticker-peel splash, 2.6s rAF track | **new** | **Deviation 1.** §30 defers "General product tours/splash education". Hard cap, skip control present from the first frame, `reduced()` short-circuits, once per token. |
| 0 | `Mohab, You should never go hunting for the next thing to promote.` | **new** | Deviation 1. The name comes from `readInvitationLanding().recipientName`, which already exists. |
| 0 | `We bring you products people actually want, and pay you every time they bite.` | **refused as drawn** | "every time they bite" implies a charge per click. §22.1 pays on captured, validly attributed, pre-tax subtotal after verification. Re-authored. |
| 0 | Passive `By continuing you're agreeing to Proovd's Terms` | **refused** | Not drawn here, but the Founder flow's Session B found it on its own landing. §28.4 records acceptance as separate controls at the claim, and no consent row exists for anything done on the invite page. Check screen 0 for it. |
| 1 | `Set a password.` + `We never store it in plain text.` | **as drawn** | Better Auth hashes at the claim. The sentence is true. |
| 1 | Four live requirements (8 chars, upper, lower, special) | **as drawn** | `pwReqs()`. Note `completeAffiliateSignup` requires **≥ 12**, not 8 — the list must match the server or a Creator meets every tick and is refused. |
| 1 | Confirm field grows in once strong | **as drawn** | `pwShowConfirm`. Presentation. |
| 1 | `Those don't match yet.` | **as drawn** | |
| 2 | `Make sure we got you right.` / `We prefilled this from what we know.` | **as drawn** | This is §11's source label, well written. |
| 2 | `Legal name`, editable | **as drawn** | `legal_name` + triple. |
| 2 | `Email`, rendered `Locked` | **differently** | §11 gives the correction right; the column carries a supplier triple; `saveSignupProfile` already accepts it. **Disagreement 18.** |
| 2 | `Phone`, editable | **as drawn** | Collected and **unverified** — §5.3, §33.1.8. The label must say so. |
| 3 | `What founders see.` | **as drawn** | Accurate: this is the §11 public card. |
| 3 | Nine channel tiles with brand logos | **differently** | Nine tiles over §5.3's **seven** subtypes — it splits social into YouTube/TikTok/Instagram. The tile is presentation over `social_creator` + a platform. `AFFILIATE_SUBTYPE_DEFINITIONS` stays the authority for evidence. **Do not add a second subtype register.** |
| 3 | `Handle or link` | **as drawn** | `channel_reference` + triple. |
| 3 | `Audience niche`, 12-option select | **differently** | `audience_niche` is free text today with a triple. A closed list is fine; the column stays text and the register owns the options. |
| 3 | `Niche description` textarea | **new** | `niche_description`, 0055. |
| 3 | Student-only `How you reach your network` | **new** | `outreach_plan`, 0055. §5.3's `student_affiliate` evidence input is literally `promotion_plan` — this is that field, and it should be keyed to it. |
| 3 | `You can edit all of this later under Profile.` | **absent from the reference's own product** | It is true *only after* Settings ships (Session F). Today it would be false. Do not render it before F. |
| 4 | `Sound like you.` — six tone chips | **new** | `affiliate_voice_tones`, 0055. |
| 4 | `Pick a tone we should write your scripts in.` | **refused as drawn** | §30 defers AI rewriting; §12's helpers are static. Nothing writes scripts in a tone. Re-authored: the tone is what a Founder sees and what the Creator says they are good at. |
| 4 | Custom tone input + removable chips | **new** | |
| 4 | `I'm flexible with different tones` switch | **new** | |
| 5 | `Put a face to it.` — photo | **absent today** | R2 (Track A4). Named absence, not a dead control. |
| 5 | `Username` field | **refused** | `public_handle` is one column and screen 2 already renders it conceptually. **Disagreement 19.** One field. |
| 5 | `Short bio` + `We prefilled this for you` | **as drawn** | `bio` ← `affiliate_prospects.admin_bio` + triple. The §8 Admin-written bio, correctable — §11 exactly. |
| 6 | `Prove it's real.` — screenshot upload | **absent today** | R2. The record is 0048's `affiliate_evidence_files`, keyed on the prospect, so a Creator-supplied row fits without a new table. |
| 6 | `This is what shapes your affiliate score` | **refused** | Makes evidence an eligibility mechanic. **Disagreement 20.** |
| 6 | `matchPct` rising 25% per screenshot, `Add proof to unlock` | **refused** | §30's percentile pruning with a friendlier face. §8's verification is Admin's recorded judgement, not a count. |
| 6 | `verifySpec()` per-channel metric fields | **new**, and **not drawn** | Computed at 2457 and rendered nowhere — a genuine bug in the reference. Built from `AFFILIATE_SUBTYPE_DEFINITIONS`, not from the reference's hard-coded switch. **Disagreement 23.** |
| 6 | `Read-only. We never post or message on your behalf.` | **as drawn** | True, and worth keeping. |
| 7 | `You control what you post` | **as drawn** | True. §14.2 acceptance is the Creator's, §17's post is theirs. |
| 7 | `Your money is guaranteed` / `No clawbacks.` | **refused** | §22.1 provides for cancelling unpaid invalid amounts and a contractual recovery record; §29.5 protects only *valid finalized* commission. **Disagreement 16 — the most dangerous string in the reference.** |
| 7 | `real creator … only Proovd account … US-based and not sanctioned` | **differently** | Four representations in one sentence. §11 has **five** (18+, US-based, actual operator, no duplicates, sanctions/OFAC) and §28.4 forbids bundling. Five unchecked controls, five columns. |
| 7 | `Tapping agree accepts the Terms, AUP, and IP & NDA Agreement` | **refused** | §31.5's IP agreement is **per campaign**, due before *work*, already collected at §14.2 acceptance. §11 requires exactly Terms + Affiliate AUP. **Disagreement 17.** |
| 7 | The single `Agree and enter` button | **absent today** | Both policies are `draft`; a consent may cite only a published version. The screen renders the reason where the button would be. |
| 8 | Typed `N pitches waiting` → FLIP into Home | **re-presentation** | The count is open `proposal_versions`. Presentation, and good. |

### Stage 3 — the app

| Element | Verdict | Note |
|---|---|---|
| Rail: Home / Pitches / Earnings / Resources, Settings below | **new** | **Deviation 5.** §26 makes Admin the only dashboard-style product. No widget grid. |
| Rail Pitches count | **re-presentation** | Open `proposal_versions`, a real record. |
| Menu drawer | **re-presentation** | |
| Notification drawer + `NOTIFS` seed | **differently** | 22c's history exists and **must not become a dashboard**: no count in the payload, no read-state write, no `unread` column, audience prefix keeps `internal_*` off it. Four assertions. |
| **Home** — `N pitches waiting` + `Review pitches` | **re-presentation** | |
| Home — `Affiliate score 742` / `Top 8% of affiliates` | **new** | **Deviation 2.** Stored snapshot with inputs beside it. |
| Home — `Gold affiliate` + progress to Platinum | **new** | Deviation 2. **The tier binds nothing** — `STANDING_BINDS_NOTHING`. |
| Home — `Founders see this` badge on the tier | **refused** | Nothing shows a tier to a Founder, and §8 makes it assessment data. Either build the Founder-side render or drop the claim; the brief drops the claim. |
| Home — `Climb toward Platinum for higher floors and early access` | **refused** | An eligibility condition (§1 rule 6), colliding with §29.4's `restrict bidding`, which the Admin workspace already derives. |
| Home — `How to climb your score` + `More tasks` | **differently** | The three seeded tasks are invented. Any task must name a real record; "Verify a second channel" has one (§5.3 evidence), the other two do not. |
| Home — Track record: `Launched` / `Hits` / `Backed` | **new**, derived | Deviation 2. Launched = `successfully_completed`; Backed = captured attributed pre-tax subtotal; `Hits` needs a definition or it goes. |
| Home — `6-campaign streak. These only go up.` | **refused** | §30: "Confetti/streaks". |
| Home — `Ranked by impact` leaderboard | **new** | Deviation 2, narrowed: public handles only, nothing about another Creator's money. |
| Home — `Founder shout-outs` | **refused** | No record; §30 defers "Public Founder ratings" from the other side. **Disagreement 22.** |
| Home — `Refer other affiliates … earn a percentage` | **new** | **Deviation 3.** An introduction, not a signup route. `REFERRAL_PAYS_NOTHING`; the percentage is refused. |
| Home — `Team up again` + `Work again` | **re-presentation** | §22.9's real record. Read-only from the Creator side until the Founder asks — an Admin or Creator *initiating* it fabricates a Founder's ask. |
| Home — `Pick your next campaign` | **refused as drawn** | Implies a pool to pick from. §5.3/§8/§30: no browsing, no general pool. It routes to the Creator's own open invitations. |
| Home — `You're all caught up.` | **as drawn** | DNA §5.4. No manufactured CTA. |
| **Pitches** — `Active` / `Pitches` tabs with counts | **re-presentation** | |
| Pitches — the five-step tap reveal | **re-presentation**, with a keyboard path | §28.5 names "Affiliate decisions" among the five required complete keyboard paths. The recap must be reachable **without** the walkthrough. |
| Pitches — `browse` mode, `.hrow`, sort chips | **differently** | The list is the Creator's **own open invitations**. Horizontal presentation and sorting survive; the word `browse`, the marketplace framing, and the commission/price sort keys go. **Disagreement 14.** |
| Pitches — `predicted: '$450 to $1,200'` | **refused** | No record. **Disagreement 6.** |
| Pitches — `Matched to your niche` badge | **differently** | Renders §14.1's `Why this fits your audience`, two Admin-written sentences — a real field, and the first thing §14.1 puts on the surface. |
| Pitches — `Trending in your niche` | **refused** | §30 fabricated popularity. **Disagreement 7.** |
| Pitches — `Rate at your floor` + `Countering for 30 to 35% is fair here` | **refused** | No per-Creator floor exists; advising a counter takes a side in a §14.2 negotiation Proovd may only mediate. **Disagreement 8.** |
| Pitches — `Upfront offered` badge | **refused** | §3.2 bans `upfront` in every audience including identifiers. **Disagreement 3 — the third time.** |
| Pitches — `High effort` / `Light lift` tags + tooltips | **as drawn** | §12's classification, locked at listing payment. The tooltip's "you can counter for a higher rate" is correct for the bid. |
| Pitches — recap: Problem, Solution, Competition, Why now, Founder interview, Brand visuals, Socials, Updates | **re-presentation** | All §14.1 kit fields that `readFormalOpportunity` already returns. |
| Pitches — `Accept` / `Reject` | **as drawn** | §14.2. `Reject` should read `Decline` — §14.2's own word, and `DECLINE_NO_PENALTY_NOTE` exists. |
| Pitches — `Counter the rate`, high-effort only | **differently** | §14.2 has **two** proposals: bid (high-effort only) and fixed Creator payment request (**Product only, not gated on high effort**). **Disagreement 4.** |
| Pitches — `Request a 1-1 meeting` | **refused** | §30 defers the Founder–Creator meeting scheduler and direct messaging. **Disagreement 5.** |
| Pitches — decline reasons + other note | **as drawn** | §14.2: "Optional reason chips/free text". |
| **Active/work** — `Share your link` + copy | **re-presentation** | §14.1 requires one-click copy confirmation. |
| work — FTC disclosure + copy | **re-presentation** | `CREATOR_DISCLOSURE_TEXT` exists. |
| work — `I published my first post` → "Tracking is on" | **differently** | §17 steps 4–5: submit the URL, Admin verifies, three outcomes. Tracking started at `activated_at`. **Disagreement 9.** |
| work — promo format tabs, `Download`, `Customize` | **differently** | Real §31.5 kit assets, downloaded. `Customize` is refused (§30 AI). |
| work — scripts `in your {tone} voice` | **refused** | §30, §12. The tone is **shown**, never used to rewrite. **Disagreement 10.** |
| work — `Generate milestone graphic` | **refused** | §30. |
| work — `Reserves` / `N reservations` | **refused** | §3.1. **Pre-orders**, including the prop name. **Disagreement 2.** |
| work — clicks, conversion, `From your link`, attributed vs organic | **re-presentation** | §17's own list; §19's boundary — aggregate only. |
| work — Backer survey quotes | **refused** | §19, §28.4: no Backer PII, aggregate only. **Disagreement 11.** |
| work — `Hit your next milestone`, `50 reservations to your bonus tier` | **refused as drawn** | §14.3's bonus is **Creator-specific**, per proposal version, with a stored trigger unit and threshold. A platform-wide target of 50 is invented. Render the Creator's own bonus where one was agreed, and nothing where none was. |
| work — `Withdraw` + `Base commission` / `Performance bonus` | **refused** | §22.1's own sentence; the 80/20 split is browser arithmetic. **Disagreements 1 and 12.** |
| work — `Get your tax docs` | **differently** | Stripe-managed. A link, never a Proovd form (§11, §30 defers a custom tax product). |
| work — `Locked until charges clear` | **as drawn** | Honest, and close to §22.1's `estimated`. |
| work — `Terminate / report founder` → "pass, warning, restrict, or remove" | **differently** | That is §29.4's vocabulary for actions against the **Creator**. The record is 0048's `association_termination_requests` with §29.5's own reasons. **Disagreement 15.** |
| work — `Need help? Visit our creator help center` | **absent from the reference's own product** | §27.1's sixth question. The route must exist or the control names the real support path. |
| **Earnings** — `Ready to withdraw` + `Withdraw` | **refused** | §22.1. Screen and typography stay; the control becomes Appendix B.7. **Disagreement 1.** |
| Earnings — `Lifetime` / `Pending: None` | **differently** | `None` becomes the not-yet-populated state naming what it waits on (§16a). |
| Earnings — "First withdrawal sets up your bank and W-9 through Stripe" | **as drawn** | True, and §11's own posture. |
| **Resources** — four tiles, `Get notified when it's ready` | **new** | **Deviation 4.** No asset column, no URL column, no campaign id — asserted absent. |
| **Settings** — profile fields + `Save` | **absent from the reference's own product** | §5.3 licenses it; **the product has no route.** This closes a real gap. See the brief. |
| Settings — `This is exactly what founders see when we match you` | **as drawn** | Accurate and worth keeping. |
| Settings — `Signed`: Terms, AUP, per-campaign agreements | **re-presentation** | `policy_consents` + the §31.5 instances. |
| Settings — `Change password` | **re-presentation** | Better Auth's own route. |
| Settings — `Email me about`: New pitches / Campaign updates / Payouts | **refused** | §27.2: transactional email is not opt-out-able, and `Payouts` is the most transactional message a Creator gets. §27.7's digest control is the one that exists. **Disagreement 13.** |
| Settings — `Sign out` | **as drawn** | It ends the session; it does not return to onboarding. **Disagreement 24.** |
| Settings — `Proovd never costs you anything.` | **differently** | Narrowed to §24.5/§22.1's actual guarantee. **Disagreement 21.** |
| Settings — delete-account request | **absent from the reference** | §5.3 names it. Recorded, never executed — retention outlives the account. |

### Everywhere

| Element | Verdict | Note |
|---|---|---|
| `affiliate` in Creator-visible copy | **refused** | §3.1: the customer-facing name is **Creator**. The Admin record may say Affiliate (2026-08-11 precedent); this surface may not. |
| `flash()` toasts | **re-presentation** | The existing toast. |
| `Enter` advances the primary action globally (`onGlobalEnter`) | **refused** | Founder Flow Session E's reasoning: a stray keystroke must not authorize a decision. No global key handler. |
| Inline `style=` on every element | **re-presentation** | `PHASE 37`, prefix `.crf-`. |
| Eleven `--p-*` tokens | **re-presentation** | Resolved onto existing tokens in the `PHASE 37` header. **Mint none.** |
| `--bw: 2px` (border), `--br: 2px` (radius) | **re-presentation** | Read them the right way round. |
| Fixed `.claim-wide-stage` at `scale()` | **refused** | §33.11.1's 320px reflow is not satisfiable by a scaled fixed stage. Responsive units. |

---

## 3. The §1 rule 8 conflicts, in one place

The full argument for each is in the brief's `## The twenty-four places the reference and the Spec
disagree`. This is the index.

| # | The reference shows | The rule | Resolution |
|---|---|---|---|
| 1 | `Withdraw` (×2) | §22.1 | Appendix B.7 block |
| 2 | `Reserves` / `reservations` | §3.1, §3.2 identifiers | `Pre-orders` |
| 3 | `Upfront offered` | §3.2 | optional fixed Creator payment |
| 4 | Counter gated on high-effort | §14.2, §12 | two proposals, correctly gated |
| 5 | `Request a 1-1 meeting` | §30 | refused |
| 6 | `predicted: '$450 to $1,200'` | §1 rule 6, §22.2 | refused |
| 7 | `Trending in your niche` | §30 | §14.1's two Admin sentences |
| 8 | `Rate at your floor` + advice | §14.3, §14.2 | the matrix cell; no advice |
| 9 | `I published my first post` → tracking on | §17, §33.4.7 | submit for verification |
| 10 | scripts `in your {tone} voice` | §30, §12 | real kit assets |
| 11 | Backer survey quotes | §19, §28.4 | refused |
| 12 | `earned*0.8` / `earned*0.2` | one waterfall, §24.4 | server-computed |
| 13 | three notification switches | §27.2 | §27.7's digest control |
| 14 | `browse` + commission/price sort | §5.3, §8, §30 | own invitations |
| 15 | terminate → "pass, warning, restrict, remove" | §29.4 vs §29.5 | `association_termination_requests` |
| 16 | `Your money is guaranteed` / `No clawbacks` | §22.1, §29.5, §24.8 | re-authored |
| 17 | one button, three policies, four representations | §28.4, §11, §31.5 | 2 acceptances + 5 controls |
| 18 | email `Locked` | §11 | correctable |
| 19 | `Username` + `public_handle` | one column | one field |
| 20 | "shapes your affiliate score" | §30, §8 | re-authored; meter removed |
| 21 | `Proovd never costs you anything` | §24.5, §22.1 | narrowed |
| 22 | `Founder shout-outs` | §30 | refused |
| 23 | `verifySpec()` never rendered | — | built, from the §5.3 register |
| 24 | `signOut` → onboarding | — | ends the session |

Plus the four **not** in the reference that the Spec requires and a session must add:
§14.1's safe **link test** (`LINK_TEST_MARKER`), §20's **seven obligations**, §29.1's **self-pre-order
disclosure**, and §29.2's **conflict disclosure** — all of which have records and none of which the
prototype draws.

---

## 4. What Session A built, and what it deliberately did not

**Landed 2026-08-19.** No screen, no route, no service. The output is the
guarantee, not the content.

### Built

| Thing | Where |
|---|---|
| Migration `0055_creator_flow_v2.sql` | four columns on `affiliate_signup_profiles`, five new tables |
| The shared registers | `shared/src/creator-flow/{flow,voice,standing,referrals,resources,channels,settings}.ts` |
| The backend restatement | `backend/src/creator-flow/logic.ts`, drift-tested |
| The Drizzle schema | `backend/src/db/schema/creator-flow.ts` |
| The suite | `backend/src/tests/creator-flow.test.ts` — 33 tests |

Two files the brief's A3 did not name were added, each because a register in
the list needed one and putting it elsewhere would have made a second copy:

- **`channels.ts`** — the nine tiles and the per-subtype metric selection. The
  metric register is what migration 0055's CHECK pins, so it needed a home, and
  it is DERIVED from `AFFILIATE_SUBTYPE_DEFINITIONS` rather than listed, so
  there is still exactly one subtype register.
- **`settings.ts`** — the §5.3 editable-field register. A2 item 7 is the
  correction record, and a record whose field ids are free text is the
  overridable-field mistake 16a already made once.

### The three findings

1. **The delete-account request already exists, and the gap is a ROUTE.**
   Session A drafted `affiliate_deletion_requests` and then hit a name
   collision: 0044 shipped it with the Creators workspace on 2026-08-11, in the
   right shape — the record is of the ASK, with no `deleted_at`, no purge
   schedule, and no `approved` state. What is missing is that only an Admin can
   file one, which is why its `received_via` column exists at all. Session F
   adds the Creator's own route onto the SAME record with
   `received_via = CREATOR_DELETION_RECEIVED_VIA`. A second table would have
   been the duplicate this codebase refuses everywhere else, and on a person's
   erasure request two copies disagreeing is the worst version of that failure.
   **The brief's A2 item list said seven things; six were built.**

2. **`PHASE 37` was already gone before the brief was written, and `PHASE 38`
   went while Session A was running.** Today claimed 37 on 2026-08-19; an
   Admin-shell narrow-width fix claimed 38 hours later. The next free number is
   **39** at the time of writing, and the brief's own trap list is right that it
   must be re-derived rather than read: it has now moved twice in one day. Run
   the grep. `.crf-` is confirmed free (zero occurrences).

3. **The suite's first draft flagged a correct column.** The standing table's
   forbidden-substring scan caught `percentile`, which contains `percent` and is
   a rank position rather than a rate. The fix excludes that one column BY NAME
   rather than narrowing the pattern — a scan tuned until it stops flagging a
   correct column is a scan that would also stop flagging a wrong one, and the
   exact-column-set assertion beside it is what actually holds the line.

### Deliberately NOT built

- **Any surface.** `CREATOR_FLOW_PAGES` ships **empty**, and a test asserts it.
  `events.ts`' rule applied to a screen: a page appears in the register when
  something renders it, never before — otherwise every "is this reachable"
  check answers yes about surfaces that do not exist.
- **Any service, route, or job.** Nothing reads the five new tables yet, and a
  test asserts no file under `backend/src/jobs/` names one.
- **A second subtype register.** The nine tiles map onto §5.3's seven, and the
  metric ids are asserted to be evidence inputs `AFFILIATE_SUBTYPE_DEFINITIONS`
  already names — in **both** directions, so a renamed input fails the suite
  rather than orphaning a CHECK.
- **A `proposal_access` column, or anything shaped like one.** Asserted absent
  across the whole database, not just the new tables.
- **Any amount, percentage, rate, floor, multiplier, or commission column** on
  any new table, and nothing that could hold a bank account, tax id, or identity
  document.
- **The two `never` copies.** The prose — help text, explanations, the absence
  register — is NOT restated in the backend. Only the four vocabularies a CHECK
  hardcodes are, because those are the only ones whose drift a person meets.

---

## 5. What cannot complete today, and must not be stubbed

| Gap | Effect on the flow | Track |
|---|---|---|
| `terms` and `affiliate-aup` are `draft` | Screen 7 renders no primary control and says why. `completeAffiliateSignup` returns `policies_unpublished`. | A2 |
| R2 unconfigured | Screen 5's photo and screen 6's screenshots render a named absence. | A4 |
| No email transport | The invitation cannot send; the send row records the failure honestly. | A3 |
| `ip-agreement` is `draft` | §14.2 acceptance already refuses in the open. Unchanged by this flow. | A2 |

---

## 6. Results

*Per session, as each lands.* Baseline before Session A: **122 files, 3,350 tests, green in one
run.**

**After Session A: 127 files, 3,470 tests, 0 failures** — backend 1,697 (66
files), shared 465 (31 files), frontend 1,308 (30 files). Session A's own suite
is 33 of those. Nothing existing was changed to make it pass: the four suites
most exposed to the schema change (`affiliate-signup`, `creator-workspace`,
`creator-relationship`, and the new one) were run together and pass at 152/152.

**After Session B: 128 files, 3,540 tests, 0 failures** — backend 1,697 (66
files), shared 465 (31 files), frontend 1,378 (31 files). Session B's own suite
is 25 of those, and it added no backend test: everything it built is a surface,
a register entry, a stylesheet section, or a column reader whose write path the
existing `affiliate-signup` suite already drives.

**After Session C: 128 files, 3,613 tests, 0 failures** — backend 1,711 (66
files), shared 465 (31 files), frontend 1,437 (31 files). Session C added no
file and no migration: its 14 new backend tests went into `affiliate-signup`
and `creator-flow`, and its 18 new frontend ones into the two suites that
already own §33.2.2/§33.2.3 and the flow.

**After Session D: 130 files, 3,662 tests, 0 failures** — backend **1,735** (67
files), shared **465** (31 files), frontend **1,462** (32 files). Session D
added one backend suite (24) and one frontend suite (15), and no migration.

**After Session F: 132 files, 3,740 tests, 0 failures** — backend **1,757** (68
files), shared **465** (31 files), frontend **1,518** (33 files). Session F
added one backend suite (22) and one frontend suite (21), inverted one Phase 14d
assertion, and added no migration.

**After Session E: 134 files, 3,801 tests, 0 failures** — backend **1,780** (69
files), shared **465** (31 files), frontend **1,556** (34 files). Session E
added one backend suite (23) and one frontend suite (32), trimmed Phase 08c's
list tests to the kit they now cover, added no migration, and left
`decisions.ts` byte-for-byte unchanged — §33.2.6–§33.2.13 pass as they were.
**The rebuild is complete.**

**One thing worth knowing about the batching itself.** The batch runner's own
summary parse read *stderr* — which is where vitest writes the totals — and the
first version redirected it to `/dev/null`, so every batch reported zero while
every batch was in fact green. A run that reports 1,686 where 1,735 is expected
is the runner, not the suite; the fix is to capture both streams and to count
the `Test Files` line as well, so a missed batch is visible rather than silently
subtracted.

**A note on how that number was obtained, because the next session will hit
it.** This machine cannot run `npm test` as one command: esbuild intermittently
fails to read `tsconfig.base.json` with *"Access is denied"*, which aborts
project setup before any test runs. It is **concurrency-dependent and
pre-existing** — verified by stashing every Session A change and reproducing it
on a clean tree in 2 of 3 attempts. Four test files at a time is reliable;
twelve is not, and the whole project never is. The signature is unmistakable
once seen: **many failed FILES and zero failed TESTS**, because the failure is
at collection. So the suite was run in batches of five with retries and the
counts aggregated. Do not read a batch failure as a code failure without
checking that line first.

---

## 7. Session B's screen order, as built

| # | Address | Screen | What it owns |
|---|---|---|---|
| 0 | `/creator-invitation/:token` | the invitation | The recorded name, the re-authored promise, §8's no-obligation sentence, and the splash |
| 1 | `/creator-invitation/:token/password` | the password | One requirement, the confirm that grows in, and the credential that is written nowhere |
| 2 | `/creator-invitation/:token/you` | you | Legal name, email (**editable**), phone (**labelled unverified**) |
| 3 | `/creator-invitation/:token/channel` | your channel | Nine tiles, handle, niche, niche description, and the student-only promotion plan |
| — | `/creator-invitation/:token/finish` | *(interim)* | Phase 08b's compact signup, moved down one segment. **Not in the register.** Session C replaces it and retires the address to a redirect |

**Screen 0 does not move addresses.** `AFFILIATE_CLAIM_PATH` is
`/creator-invitation` and it is what the §8 invitation email points at, so every
later page hangs below it and the token travels in the path and nowhere else
(§28.1).

**The interim is deliberately not a registered page.** It has no help card, no
`CREATOR_FLOW_PAGES` entry, and `ChannelStep` addresses it directly rather than
through `creatorFlowPath`. A register entry for a page about to be deleted is a
register that lies — and the help drawer's "everything before it" would start
listing a page that is going away. The Founder flow's Session B did exactly this
with `/draft/:token/vetting` and Session C retired it.

**The interim stopped asking what screens 2–3 own.** The legal name, the email,
the phone, the channel and its niche are gone from it; what is still asked there
is the public handle (screen 5's) and the audience size (screen 6's), which are
Session C's. Anything missing is NAMED with a link back to the page that owns it
rather than re-asked — a record collected on two screens is a record whose two
copies eventually disagree, and a suite testing both copies would have made that
look correct.

### What Session B built

| Thing | Where |
|---|---|
| `CreatorFlowPage` + the help drawer | `frontend/src/surfaces/creator-flow/CreatorFlowPage.tsx` |
| The four screens | `WelcomeStep` · `PasswordStep` · `ProfileStep` · `ChannelStep` |
| The walk's in-memory state | `creator-flow/draft.ts` — the password and whether the splash has played |
| The one read and the one save | `creator-flow/useInvitation.ts` |
| The four registered pages | `CREATOR_FLOW_PAGES`, which shipped empty from Session A |
| The load-bearing copy | `shared/src/creator-flow/onboarding.ts` |
| The twelve niches | `CREATOR_AUDIENCE_NICHES`, beside the tiles that already lived there |
| `playSplash` | `frontend/src/components/anim.ts` |
| `PHASE 39` | `frontend/public/proovd.css`, prefix `.crf-` |
| The suite | `creator-flow/creator-flow.test.tsx` — 25 tests |

### The three columns the backend gained a reader for

`channel_type` (with its full supplier triple), `niche_description` and
`outreach_plan` were added by migration 0055 in Session A and **nothing read
them**. A column in Drizzle and in the migration does nothing on its own: there
is no Zod schema for an invitation patch and no route-layer whitelist, so the
`text(...)` calls inside `saveSignupProfile` and the `str(...)` calls in
`routes/affiliate-invitation.ts` **are** the entire allowlist. Each column is
therefore wired in four places — the state shape, `toState`, `SaveSignupInput`,
and the write — plus the route and the client's `CreatorPatch`. This is the
finding Founder Flow's own Session A recorded, and it holds here.

`profile_photo_key` is deliberately still unread: it is screen 5's, and R2 is
unconfigured anyway.

### Three decisions worth carrying forward

- **The password requirement list has ONE entry**, and the server was not
  changed to match the reference. `completeAffiliateSignup` enforces twelve
  characters and nothing else; the reference draws four ticks starting at eight.
  Shipping its list would tick everything green and then be refused six screens
  later. The Founder and the Admin have no composition rule either, Session F's
  password change goes through Better Auth's own route, and a checklist where
  three of four ticks decide nothing teaches people that ticks are decorative.
- **The password is module state, and a reload loses it.** There is no account
  to send it to and it must not go into browser storage, where a credential
  outlives the tab and is readable by anything running in the page. A reload
  costs one re-ask at the end and nothing else, because every profile answer is
  saved as it is typed — so position survives while the credential does not, and
  the screen that sets it says so. **Session C's Agree screen asks again rather
  than sending anybody backwards.**
- **The `channelType` tile never resolves the §5.3 subtype.** Nothing sends a
  subtype under any key, and the suite asserts the absence in the serialized
  patches. The disagreement is reported with `CHANNEL_TYPE_IS_ADMIN_CLASSIFICATION`
  and left alone: overwriting it would silently invalidate a verification
  recorded against it.

### One Session A assertion was consciously inverted

`creator-flow.test.ts`'s *"is empty, because Session A builds no screen"* now
reads *"holds exactly the screens a session has rendered"*, with a dated comment
naming the direction. The rule it protected is unchanged and is what is checked:
a page appears when something renders it, never before. The test additionally
asserts that none of Sessions C–F's screens is registered, so the register
cannot rot in the other direction either.

## 8. What the Session B browser pass found, and nothing else could

Four defects, and **two of them are pre-existing and belong to no session** —
which is the tenth rebuild in a row where the browser pass found something jsdom,
axe and the type checker all agreed was fine.

The pass renders each address at 1280 and inside a **320px iframe** (Chrome
reports `clientWidth: 489` for `--window-size=320` on Windows, so the naive form
shows the left 320px of a 489px render and reads as overflow). It reports
measurements as well as pictures: for every box, whether the content is wider
than the box and whether that box **scrolls** (designed) or **clips** (content
gone).

1. **`.wrap` is a viewport width, and `Section` renders one — so `<Measure><Section>`
   spilled 430px.** `.wrap` is `min(90vw, 1600px)`, correct for a top-level band
   and wrong for anything nested; `.measure` caps at the reading measure. The
   Creator's compact signup has nested them since **Phase 08b**, so it has been
   losing its right-hand 430px at 1280 for as long as it has existed, and at 320
   it pushed the document sideways — a §33.11.1 failure on a shipped page.
   PHASE 38 found the same thing inside the Admin view four days ago and fixed
   it there; this is the general form, `:where(.measure) .wrap { width: 100% }`,
   so it contributes no specificity and corrects every other call site at once.

2. **A `.kv` value holding a URL or an address is one unbreakable token**, and at
   320 it pushed the page sideways. PHASE 36 made this exact decision twice for
   `.mny-facts dd` and `.mny-head__title`; fixed at the definition this time,
   because a `dd` that overflows rather than wrapping is a defect at every one of
   its call sites and — unlike a colour — it changes nothing where the content
   already fits.

3. **The interim rendered the raw tile id.** `Channel` read `student`, which is
   an internal identifier on a customer surface — §3.1's whole risk. The register
   that owns the tiles owns their words, so the label is resolved from
   `CREATOR_CHANNEL_TILES`. Invisible to every scan: `student` is a real English
   word, so no naming check would ever flag it.

4. **`.field-hint` is `--grey`, about 2.18:1 on white**, and on these screens it
   carries which address every message goes to and §33.1.8's own promise that the
   phone is never verified. PHASE 34 made this correction for the Founder flow
   and recorded why it is scoped rather than global; `:where(.crf) .field-hint`
   is the same correction, for the same reason.

**One measurement is a false positive and is recorded rather than tuned away.**
An `<input>` whose value is longer than its box reports `scrollWidth > clientWidth`
and no `overflow-x` — which is how a text input works, not a defect. The probe
skips it by hand, the way PHASE 38's skipped `span.sr-only` (a 1px box whose
content overflows IS the visually-hidden mechanism). A scan tuned until it stops
flagging a correct case is one that would also stop flagging a wrong one.

**What the pass could not decide, and stays on the manual list:** real focus
visibility, 44px tap targets against a finger, an actual screen-reader pass, and
`.btn--primary`'s 1.44:1 — the documented, scoped tech-stack §3.6 exception that
every primary in the product carries.

---

*Sections 9, 11, 13, 15, 17 — `## N. Session X's screen order, as built` — and 10, 12, 14, 16, 18 —
`## N. What the Session X browser pass found, and nothing else could` — to be appended in forward
order by Sessions C–F. Ten rebuilds in a row have now found defects invisible to jsdom, axe, and the
type checker; assume the next one will too.*

---

## 9. Session C — screens 4–8, and the claim

**Landed 2026-08-19.** Five screens, two writes, no migration, and one defect
that had been shipping since Phase 08b.

The suites after Session C: backend **1,711**, shared **465**, frontend
**1,437** — 3,613 tests across 66 backend files, 31 shared and 31 frontend, all
green. §33.2.1 and §33.2.3 pass; §33.2.2 is re-authored, with one comment and
one date.

### Screen 8 could not be on the invitation token, and that is a FIX

`completeAffiliateSignup` calls `tokens.claimAffiliateInvitation`, which sets
**both** `claimed_at` and `revoked_at`. So from the instant the account exists,
every `/creator-invitation/:token` address answers the one rejection —
`affiliate-signup.test.ts` has asserted exactly that on a repeat claim since
Phase 08b.

Phase 08b's `CreatorSignup` re-read the invitation after a successful claim
(`onClaimed={load}`) and rendered §33.2.3's waiting state from
`profile.claimedAt`. That read **401s in production**, so a Creator who had just
created their account was shown the unusable-link page. The frontend suite never
saw it because it stubbed a claimed profile rather than driving a real claim —
the §33.11.1 failure mode in its own test harness, and the reason the sweep
checks for the fixture-missing panel.

The waiting state has therefore been unreachable since it was written, and
Session C is what makes it reachable: screen 8 is `/creator/welcome`, behind
`RequireRole allow={['affiliate']}`, and it reads `/api/creator/campaigns` and
the payout state rather than the invitation. A test asserts nothing on it talks
to `/api/affiliate-invitation` at all.

**Session A anticipated the shape of the answer** when it typed `param` as
`'token' | 'none'` and wrote `CREATOR_FLOW_EARLIER_STAGE_CLOSED`. The register
now holds eight token pages and exactly one addressed by nothing, and
`creatorFlowPath` throws in both directions — a parameter for the page that
takes none, and a missing one for a page that needs it. That is not a
convenience: a token appended to an app address is a live credential in an app
URL.

### The claim signs in afterwards, because it mints no session

`completeAffiliateSignup` creates the account and claims the invitation; §11
does not ask it for a session and it issues none. So the Agree screen posts the
password held in `draft.ts` to Better Auth's own `/api/auth/sign-in/email` — the
real route, its real rate limit, its real origin guard, no new server code.
Founder Flow Session D made the same call for the same reason.

If that sign-in fails the ACCOUNT still exists, and
`CREATOR_SIGN_IN_AFTER_CLAIM_FAILED` says so in those words rather than letting
somebody believe they must start over with a link that no longer works.

### Three §11 fields the reference never draws

`dateOfBirth`, `country` and `stateRegion` are gates on `completeAffiliateSignup`
and appear on **no screen of the prototype**, which bundles four representations
into one sentence instead. This is a fifth omission beside the four §2 already
names.

They are collected on screen 7 rather than screen 2, because they are the
factual half of two of the five confirmations — the birth date beside "I am at
least 18", the state beside "I am based in the United States". §10's Founder
claim puts the same pair on the same screen.

**Nothing computes an age.** §11 records what somebody states, and the
confirmation is the statement.

### What the two new writes are, and what they are not

`PUT …/voice` and `PUT …/metrics` over Session A's two 0055 tables. Neither is a
primary action — both are the same autosave the PATCH is, addressed separately
because they write append-only rows rather than columns.

* **A PUT, not a PATCH, for the tone.** The SET is the answer: dropping a chip
  is expressed by sending the remaining ones, and a merge would make removal
  unrepresentable.
* **Retire before insert, inside one transaction.** The partial unique index
  permits one live row per profile, so an insert before the retire collides with
  the row it is replacing — and the immutability trigger means there was never
  an UPDATE path that would have avoided the question.
* **The service validates, because the browser is not the boundary.**
  `creatorVoiceViolations` runs on the surface for the sentence; the same
  vocabulary runs on the server, restated in `creator-flow/logic.ts` and
  drift-tested. That restatement is the **one exception** to Session A's rule of
  restating only what a CHECK hardcodes: 0055 deliberately bounds a tone set
  only by `affiliate_voice_says_something`, because a length cap in a CHECK
  refuses a row rather than telling somebody their chip is long — which left the
  service as the only thing between a request body and the array.
* **A metric is refused unless the Creator's own subtype asks for it.** 0055's
  CHECK pins the id to the nine; what it cannot know is WHOSE subtype. A podcast
  Creator posting `enrolled_students` would satisfy the constraint and store a
  figure §5.3 never asks a podcaster for, which an Admin would then verify
  against a question nobody put to them. `permittedMetricsFor` is derived from
  `REQUIRED_EVIDENCE`, and a test drives all seven subtypes through it and
  through shared's `creatorChannelMetricsFor` and asserts they agree.
* **Clearing a metric retires its row and inserts nothing.** 0055 requires a
  non-blank value, so "I would rather not say" is the ABSENCE of a live row
  rather than an empty one (§16a).
* **Both reads are `ensureSignupProfile`, not a bare read** — the payout route's
  own reasoning: a Creator who reaches a screen without having typed into an
  earlier one has no profile row yet, and answering that with a refusal would
  say "this link is broken" about a link that is fine.

### One sentence stopped existing twice

§11's waiting state names Proovd as the owner, and that sentence has existed
twice since Phase 08b — once in `CreatorSignup`, once in
`templates/affiliate-signup-confirmed.tsx` — written independently with nothing
comparing them. The owner of a wait is a promise about who is accountable for
ending it, and two copies is how one of them quietly becomes "the Founder's
fault". `CREATOR_PROOVD_OWNS_THE_WAIT` is canonical now, the backend restates it
for the `rootDir` reason, and `creator-flow.test.ts` fails if they disagree.

### §33.2.2, re-authored — one test, one comment, one date

§33.2.2 tests *"Compact flow has Proovd account action and Stripe payout action,
no custom bank form/tour."* **Deviation 1** departs from the tour half by
explicit product direction. The half that is load-bearing is what the suite now
asserts, unchanged in substance:

* one Proovd account action, and exactly one `.btn--primary` on the screen that
  creates the account;
* one Stripe payout action, still a handoff — Phase 10b's four assertions are
  **verbatim**, only their entry point moved;
* no bank, routing, tax-id or identity input on any screen, and no route that
  could accept one;
* five confirmations, five separate unchecked controls, five columns — counted
  against `CREATOR_CONFIRMATIONS`, which names the column each writes, so the
  count is compared to the schema rather than to a second list;
* one PATCH key per confirmation control, asserted;
* two policy acceptances and no third, with §31.5's per-campaign IP agreement
  named as the reason.

### What the Session C browser pass found, and nothing else could

Five, and the eleventh rebuild in a row where the pass found what jsdom, axe and
the type checker all agreed was fine.

1. **"Date of birth" rendered twice.** `DateOfBirthField` renders its own label,
   its own hint and its own calendar disclosure, and it was wrapped in a `Field`.
   jsdom is happy with two labels and axe reads the nearer one.
2. **The reused field carried a promise this screen does not keep.**
   `FLOW_AGE_IS_YOUR_STATEMENT` says the field checks the date adds up to 18 or
   over "as a courtesy" — TRUE on the Founder claim, which computes it, and a
   claim about behaviour on the Creator's agreement, which computes nothing.
   `DateOfBirthField` takes the note as a prop now, so the sentence belongs to
   the screen rather than to the component (§1.4). The Founder flow is
   unchanged: the prop defaults to its own constant.
3. **§5.3's `basis` is ADMIN copy and was rendering to a Creator.** Screen 6's
   metric hints read *"The audience-size metric §8 requires on the prospect."* —
   a Spec section reference on a customer surface, the leak the Campaigns hub
   recorded when `§21:` read aloud nine times, and worse here because the
   audience is not an operator. The label renders and the basis does not; what a
   Creator reads instead is `CHANNEL_METRICS_ARE_YOUR_OWN_FIGURES`, which says
   the same useful thing in words written for them. A test now walks every
   screen and refuses `/§\s*\d/`.
4. **The tone help got HARDER to read at the moment somebody chose it.**
   `--moss` is about 3.4:1 on white and about 2.3:1 on the chip's mint fill. axe
   cannot see it: the accessible name is the label, and contrast is computed
   against the element's own declared background rather than the fill behind it —
   the same class of defect PHASE 28, 31 and 33 each recorded.
5. **`--brand` on white is 1.46:1**, so the two policy links on the agreement
   screen were unreadable. PHASE 34's `.ff-claim__consent a` took the same
   position on the Founder claim; the underline carries the affordance.

Plus one that is **not** a defect and is written down so the next pass does not
chase it: an `<input>` whose VALUE is longer than its box reports
`scrollWidth > clientWidth`, and the browser scrolls it natively. The probe
reports it as clipping at 320 on the channel screen; the document does not
scroll sideways and nothing is lost. It is the `.sr-only` false positive in a
different shape.

### Two contrast gaps that are pre-existing and were NOT changed here

`--moss` body copy reads about **3.37:1** on white, and it is what Session B
ships on every lede and note across the flow — Founder Flow Session C
established it as the body-copy tone. `StatePanel`'s `state-panel__key` and
`Tag`'s `tag--mint` read **2.18:1** and **2.66:1**, and both are Phase 02/05
primitives used by every workspace in the product.

Neither is Session C's to change: re-toning either is a product-wide edit with
its own screenshot pass across every phase section, and doing it inside a
five-screen session would be a change nobody could review. They are recorded
here rather than silently inherited. `.btn--primary`'s 1.44:1 stays what it has
always been — proovd.css:158's hard rule and tech-stack §3.6's documented,
scoped exception, verified as recorded in Phase 23b.

### What Session C deliberately did not build

* **Any change to `completeAffiliateSignup`.** Not split, not reordered, not
  made partial: one transaction, the same gates in the same order, account
  creation still before it. `affiliate-signup.test.ts`'s own 40 assertions pass
  untouched, which is a stronger statement than a copy of them passing
  elsewhere — so the new suite deliberately does not re-drive §33.1.9.
* **An upload route for either screen.** §12's bucket is Track A4 and
  `unconfiguredStorage` throws; the payload carries `uploads.available` and the
  surface renders a named absence. A test posts at four plausible addresses and
  asserts 404 on all four.
* **A `matchPct` meter, a score, or an unlock.** No threshold in §5.3 or §8
  exists for one to measure.
* **A third policy acceptance.** §31.5's IP agreement is per campaign and due
  before work.
* **Anything on screens 9–14.** Home, Pitches, Earnings, Resources and Settings
  are Sessions D–F, and none of them is in `CREATOR_FLOW_PAGES`.

---

## 10. Session D — the app shell and Home

**Landed 2026-08-19.** One shell, one page, two routes, no migration — and three
of Session A's own register entries corrected by the first thing that read them.

The suites after Session D: backend **1,735**, shared **465**, frontend
**1,462**. §33.11.1–§33.11.7 pass over sixteen principal flows, one of them new.

### The shell is not the Admin shell, and that is the deviation

§26 makes the Admin panel the only dashboard-style product in MVP, so a rail, a
menu drawer and a notification drawer for a Creator needed **deviation 5** to
exist at all. What keeps it from becoming the thing §26 forbids is that every
rule §20 states for the Founder campaign home is applied here and has a visible
consequence:

* **One thing waiting, or the caught-up ending.** The hero is the pitch count
  with `Review pitches`, or `CREATOR_HOME_CAUGHT_UP` with **no control at all**.
  The suite asserts the branch renders nothing operable rather than that one
  particular button is missing — which would pass while a different one was
  added.
* **No counters table.** The pitch count is a query over the association states
  and `proposal_versions`; the track record is three counts of rows. Nothing is
  stored, so nothing can be wrong while the rows are right.
* **Every number derived, or not shown.** A Creator with no completed campaign
  has **no standing row at all** rather than a score of zero, a percentile with
  no cohort is absent rather than computed anyway, and a leaderboard of three
  does not render.
* **Freshness is a time.** `GLANCE_FRESHNESS` is reused rather than a second
  wording minted, and the suite scans the rendered surface for
  `BANNED_FRESHNESS_TERMS`.

### The tier binds nothing, and a source scan is the enforcement

`MUST_NOT_READ_STANDING` names five modules by path and scans each for the table
name, the Drizzle export, and the three functions — with comments stripped
first, so a module may EXPLAIN that it must not read the standing without
failing (`notifications/send.ts`'s own rule).

The brief names `affiliates/readiness.ts` and there is no such file: §15's
roster readiness is `campaign/readiness.ts` and §16's is
`creator-payment/readiness.ts`. Both are in the register, because a scan naming
a module that does not exist passes by finding nothing. The first draft threw on
the missing path rather than skipping it, which is how that was found.

### The score is invented, and the answer to that is transparency

There is no way to build a score without choosing weights, and any choice is
arbitrary in the sense §1 rule 6 cares about — which is why the score is a
recorded deviation rather than something derived from a Spec sentence. What is
available instead of a justification is that the numbers are IN the register the
surface renders from, and "How this is worked out" states the arithmetic rather
than describing it (§33.12.6's posture on the measurement scoreboard).

The ordering does say something: a completed campaign needs all five §22.8
criteria and an Admin decision; a passed evidence check is something an Admin
reviewed; a first post that passed is smaller and repeatable; and running to the
end with no §29 action is the weakest, because it is the absence of something.

### Three of Session A's register entries were wrong, and the first read found all three

Session A wrote no surface, so nothing exercised the `derivedFrom` strings until
now.

1. **`creator_post_submissions.outcome` does not exist** — the column is
   `status`. Two entries named it.
2. **`channels_verified` counted the wrong grain.** 0048 CHECK-pins
   `affiliate_evidence_verifications.metric` to the five §5.3 evidence metrics —
   audience size, engagement rate, audience demographics, channel ownership,
   newsletter permission basis — so a Creator with ONE channel and three
   verified metrics would have scored three channels. It is `evidence_verified`
   now, labelled `Evidence checks passed`, and the name follows the record
   rather than the record being bent to the name.
3. The one surviving "how to climb" task followed it: `Verify another channel`
   became `Add evidence about your channel`.

What now stops this recurring is a test that parses every `table.column` out of
every `derivedFrom` and asserts it exists in `information_schema`. It is cheap
and it is the mechanism that would have caught all three.

### The snapshot is written on a read, and that is deliberate

`ensureStandingSnapshot` appends a row only when the derived counts DIFFER from
the latest stored ones, so the write is caused by a RECORD having moved and
never by time passing — there is no clock in the module, no sweep, and no job.
A Creator who reloads a hundred times gets one row; the suite drives that.

Writing on a read has precedent here: `readPreparingKit` writes its §31.5 access
row in the same call that returns the content, and §20's `readGlance` issues its
delivery receipt. What it buys over a sweep is that a Creator whose campaign
completed an hour ago sees it, rather than seeing `STANDING_NOT_ENOUGH_HISTORY`
until a cron fires.

A recomputation is a NEW row and the earlier one keeps its own inputs — 21b's
completion-findings reasoning applied to the number a Creator reads hardest.

### The referral reaches an Admin, and there is no §27 key for it

§1.4: a form that records something nobody will ever see is a promise. There is
no §27 key for a referral and inventing one would be inventing a message the
Spec does not define, so the destination is the record plus an `audit_events`
row — which the Creators workspace history renders through its own allowlist.
That is `founder_meeting_notes`' arrangement: a fact reaches an Admin through a
history that composes rather than through a notification nobody specified.

The audit row's target is the **referrer**, because the referred person has no
record to attach anything to — and creating one would be the signup route this
deviation refuses. The suite counts prospects, associations, users and tokens
before and after and asserts all four are unchanged.

### What the Session D browser pass found, and nothing else could

Six, and the twelfth rebuild in a row where the pass found what jsdom, axe and
the type checker all agreed was fine.

1. **`--fs-step` is a flow step TITLE, not "one step down".** It is
   `clamp(1.625rem, 4vw, 2.5rem)`, and reading it as a small size put a 40px
   sentence in the rail, a 40px eyebrow on the hero, and a 40px freshness line
   under the score. Three places, one misreading.
2. **A `.btn--primary` IS the brand fill**, so the hero's primary control was
   invisible on a brand-fill band — and the hero's own campaign links were
   brand-on-brand and simply absent. The hero carries `mode-dark` now, where the
   primary is white; the two hero states differ in treatment as well as in
   content, which is DNA §5.4's point about the done-moment.
3. **`toLocaleString()` on the freshness line** rendered
   `8/18/2026, 12:15:00 PM` — the machine's locale, with seconds. It is a medium
   date and a short time now. Not a bare time: `Updated 3:40 PM` is right for
   §20's live read and would be a false freshness claim on a snapshot computed
   three days ago.
4. **The percentile was off by one** — `101 - percentile` rendered `top 19%` for
   a percentile of 82.
5. **`Refer another Creator` wrapped to three lines** in the side column, because
   `--fs-h2` clamps to 3.25rem and the column is a third of the width.
6. **`.cra-drawer__lede` used `--moss`**, a light-mode body tone, inside
   `.drawer`'s `--darker` ground. The same class of defect PHASE 28, 31, 33 and
   39 each recorded: a colour correct in one mode carried into another.

Plus one the §33.11 sweep caught rather than the browser: the work-again row's
`Yes` / `No` are **objectless CTAs** (§33.11.4). With two requests on screen a
bare Yes says nothing about what is being agreed to, and §14.2's own word for
the other half is Decline.

### Two contrast gaps that are pre-existing and were NOT changed here

`--btn2-text` is `--brand`, so every `.btn--secondary` in the product is about
1.46:1 on white — which on the work-again row makes the accept control less
legible than the decline beside it. That is DNA §7.1's variant-2 definition and
the same documented, scoped tech-stack §3.6 territory as `.btn--primary`'s own
1.44:1; re-toning it is a product-wide edit with its own screenshot pass across
every phase section. And `--moss` body copy at ~3.37:1 is what Sessions B and C
ship on every lede in this flow.

Recorded rather than silently inherited, and rather than fixed on one surface so
that one surface disagrees with the design system.

### What Session D deliberately did not build

* **Any migration.** Session A's 0055 held every record; this is its first
  service.
* **A sweep, a job, or a schedule of any kind.** The standing appears because a
  record moved.
* **A notification count anywhere.** 22c's history has no count in the payload,
  no read-state write, and no `unread` column; the reference draws
  `Updates · 2 new` in two places and both are in `CREATOR_APP_ABSENCES`.
* **Any Pitches, Earnings, Resources or Settings surface.** Sessions E and F.
  `Earnings` and `Resources` have no address at all and say so; `Pitches` and
  `Settings` point at the addresses that already exist.
* **An Admin surface for the standing or the referral.** The referral reaches an
  Admin through the history it already writes to; a later phase asked to read
  the standing as a default, a filter, or an eligibility condition is asking for
  the §1 rule 6 violation the missing columns exist to prevent.

---

## 11. Session E — Pitches, the Active list, and the pitch

**Landed 2026-08-20, after Session F.** Two surfaces, one route, one read
module, no migration — and the last session of the rebuild.

The suites after Session E: backend **1,780**, shared **465**, frontend
**1,556**. §33.2.6–§33.2.13 pass **unchanged**, which is the only form the
"no decision service was touched" claim can take.

### It was built last, and Session F said so at the time

Session F's own section records the departure: F was built before E because E
replaces the Pitches LIST while F's four surfaces are reached from the rail and
from the existing `/creator/campaigns`. That cost was one sentence — F5's
end-to-end walk went through Phase 08c's list until E landed — and this is E
landing. The rail's `pitches` href never moved.

### The reconciliation was wrong about the recap, and the first read found it

Section 2 recorded the recap's fields as *"All §14.1 kit fields that
`readFormalOpportunity` already returns"*. That read returns the §14.3 cell,
high effort, the versions, the agreement and the link — the DECISION facts — and
none of the Founder's material: no Problem, no Solution, no rewards, no dates,
no claims, no refund policy. §14.1's "complete opportunity/Campaign kit" is
twenty-two bullets and the surface was serving about five of them.

Session D found three register entries wrong the first time anything read them;
this is the same finding one session later and the answer is the same. The
register is corrected, and `PITCH_RECAP_SECTIONS` now carries §14.1's own
bullets beside the payload field, the register constant, or the named absence
that answers each — walked against a real read in both suites, so it cannot go
stale again.

**`readPitchContent` is the other half, and `decisions.ts` is untouched.** It
reads `buildCampaignPreview` — the ONE assembly of a campaign's built content,
which the public page and the Founder preview also read — and adds beside it
what §14.1 asks a CREATOR for and a Backer is never shown: the internal target
correctly labelled, the brand and claims notes, the Founder's prior Proovd
history, and their connected-account readiness as a STATE (§13: never the
documents).

### The list does not record `reviewing`, and opening a pitch does

`readFormalOpportunity` moves `formal_decision_open → reviewing` on first read,
which is correct: opening a pitch is the act that observes it. Calling it from
the LIST would mark every open invitation reviewed because somebody looked at a
list of them — a fact the record did not observe. So the list is its own query
and the detail calls the service verbatim. Both directions are asserted: the
list leaves the status alone, and `readPitch` moves it.

### One derivation for the count

`PITCH_DECISION_OPEN_STATES` and `pitchKindFor` moved out of `home.ts` into
`creator-pitches.ts`, and `home.ts` imports them back. §20's hero count and the
Pitches tab are now the same answer rather than two that agree today — and the
suite compares the two reads over one seeded Creator.

`proposal_pending` is deliberately not in the state list: it counts only when
the open version is `awaiting_creator`, because a version waiting on the FOUNDER
is not something the Creator can act on, and counting it would put a number on a
tab that no control can reduce.

### The walk is optional, and that is the §28.5 decision

The reference advances a five-step reveal by tapping anywhere on the screen.
§28.5 names "Affiliate decisions" among the five flows that must be completely
operable from a keyboard, and §14.2 forbids hiding any of the three outcomes — a
walkthrough that must be completed before the decisions appear hides all three
behind four gestures, which is worse than hiding one behind a menu.

So: every step advances with a real, named control; `Read the whole pitch` is
present from the FIRST step; `?view=recap` lives in the address, so a reload, a
bookmark and the back button all land on the recap rather than restarting the
walk; and a pitch with nothing left to decide opens on the recap, because a walk
that introduces a campaign somebody already accepted is a delay rather than a
reveal (DNA §5.4).

It is four steps and a destination, not five steps. The reference draws five
progress segments and calls the last one the full card; modelling the recap as a
step would make it something a person has to walk TO rather than somewhere they
can go.

### Two sorts, both over a stored column

The reference offers four. `Match fit` has no score behind it — §14.1's *"Why
this fits your audience"* is two Admin-written sentences, not a number — so
ordering by it would be inventing a rank. `Commission` and `Price` are
marketplace sort keys: they invite a Creator to rank one Founder's terms against
another's on a list, which is the comparison a private invitation does not have.

What is left is real: §14.6's stored response deadline (immutable, and the thing
that actually decides which pitch to open first) and when the invitation
arrived. A pitch with no recorded deadline sorts LAST — an absent deadline is
not an urgent one. The route validates the sort against the register rather than
trusting it, and the suite asserts every `column` exists in
`information_schema`.

### What the Session E browser pass found, and nothing else could

Six, and the fourteenth rebuild in a row where the pass found what jsdom, axe
and the type checker all agreed was fine. Two of them are older than this
session.

1. **`.tabs` has been broken product-wide since PHASE 25.** The Founder Admin
   workspace took the bare `.tabs` name for its own hand-built strip and made
   it `display: flex; overflow-x: auto`, which turns the design system's `Tabs`
   component into a horizontal row with the tablist and every tabpanel side by
   side. Nothing caught it in four months because the only users were the
   gallery and a jsdom test, and jsdom does no layout. The Creator's Pitches
   list is the first product surface to use the component since, and it drew
   `Active 2` and `Pitches 2` down the left gutter beside their panels. The
   markup already carried `.frec-tabs`, so the fix is a selector change and the
   bare name returns to the design system.
2. **`Continue to The problem`, and `Continue to You earn`.** A nav label built
   by concatenating a capitalised eyebrow. §33.11.4 wants the destination named;
   it does not want it named badly. The register gained `navName` — the step as
   a control refers to it, mid-sentence.
3. **`Decide by  Aug 23, 2026, 8:00 PM`** — §27.1 asks for the timezone spelled
   out on a deadline, and `toLocaleString` names none. This is §14.6's own
   instant, after which an unfinished proposal expires. Local with UTC beside
   it now, the pair the Founder flow's fee screen already renders.
4. **The SELECTED sort chip was the harder one to read.** `.btn--secondary` is
   `--brand` on white at about 1.46:1, so `Closing soonest` (chosen) rendered
   quieter than `Newest` (not chosen) — Session D's `Accepted` reading quieter
   than `Reviewing`, on a different control. Fixed scoped to `.crp-sorts`,
   because re-toning every secondary button in the product is its own change
   with its own screenshot pass.
5. **`.kv__row` sizes per ROW, so one card drew four different value
   positions.** Session F found the same thing on Settings; the fix is the same
   and is scoped to the recap.
6. **The ended campaign's row said its link was "not active YET".** True of a
   campaign that has not launched and a promise about one that is over (§1.4).

### One copy defect the pass found that a test then pinned

`DECLINE_NO_PENALTY_NOTE` opens *"Your decline was recorded"* — it is the
CONFIRMATION. Rendering it beside an open decision, and on the decline panel
before anything is decided, tells somebody a decline happened that did not.
`DECLINING_COSTS_YOU_NOTHING` is §14.2's promise said BEFORE a decision; the
confirmation stays where a decline was actually recorded, and the suite asserts
the words "Your decline was recorded" appear nowhere on either surface.

### The banned-term register was a second copy, and the suite caught it

`PITCH_BANNED_TERMS` was first written with `upfront` and `reservation` in it —
and Session A's own scan failed, because this file ships in the browser bundle
§33.11.3 reads, so a register naming the banned words puts them in the bundle to
say they are banned. `UNIVERSALLY_BANNED_TERMS` and `CUSTOMER_ONLY_BANNED_TERMS`
are the canonical registers and `namingViolations` is their scanner; both suites
run it against the rendered surface and the payload. What is left in
`PITCH_BANNED_TERMS` is this surface's own refusals — the marketplace framing §3
has no opinion about.

### One Session F defect this session's walk found and fixed

Session D built `CreatorAppShell` and `CreatorHome` rendered it itself, so the
four surfaces Session F added — the work surface, Earnings, Resources and
Settings — shipped with **no rail and no way back except the browser**. It is a
pathless layout route now, the arrangement the guard above it already uses and
for the same reason: chrome that has to be remembered on each new surface is
chrome that eventually is not. `/creator/welcome` is deliberately outside it —
the last screen of a full-bleed nine-screen sequence, whose whole job is to hand
over to Home.

### Two contrast gaps that are pre-existing and were NOT changed here

`.kv__row dt` at ~2.18:1 and `.btn--secondary` at ~1.46:1 — both shared
primitives every workspace uses, both the documented tech-stack §3.6 territory.
PHASE 42 uses neither for anything load-bearing: a sentence that states a rule
takes `--dark`, a caption takes `--moss`.

### What Session E deliberately did not build

* **Any decision service, and any change to one.** The module has no `.insert(`,
  `.update(` or `.delete(` at all, exports nothing matching accept/decline/
  propose/respond/submit, and `decisions.ts` is untouched.
* **A migration.** Every record it reads already existed.
* **A second campaign-content assembly.** `buildCampaignPreview` is the one.
* **A meeting request, a predicted amount, a popularity signal, a per-Creator
  rate floor, or a counter recommendation.** All in `CREATOR_FLOW_ABSENCES`,
  each rendering its refusal where the control would be.
* **A product category.** §14.1 asks for one and no record holds it — not on the
  prospect, not on the build. Null and named on the surface (§16a), rather than
  a guess derived from the product name.

---

## 12. Session F — work, Earnings, Resources, Settings

**Landed 2026-08-20.** Four surfaces, nine routes, four services, no migration —
and the last of the five deviations closed with the two rail entries that had
been saying "Session F" since 2026-08-19.

The suites after Session F: backend **1,757**, shared **465**, frontend
**1,518**. §33.11.1–§33.11.7 pass over seventeen principal flows, one of them
new.

### It was built before Session E, and that is a departure

The brief's scope table makes F depend on E. Session E replaces the Pitches
LIST; F's four surfaces are reached from the rail and from the existing
`/creator/campaigns`, which still works and still links to the partnership
address. So the dependency is one of position in the walk, not of code — the
22c-before-22b precedent — and what it costs is that F5's *"the full flow walks
from the invitation email to a live campaign"* walks through the old list until
E lands. Stated rather than glossed.

### The §17 walk is a count, not a claim

`CREATOR_WORK_ITEMS` is §17's *"After readiness/activation, show:"* — thirteen
bullets, each naming the payload field that answers it — and the suite resolves
every field against a REAL `buildCreatorPartnership` payload. A bullet that
quietly loses its field fails; a field renamed in a refactor fails.

`undefined` is the failure and `null` is an answer: a mid-campaign block on an
initial-roster Creator is legitimately null, and treating that as missing would
have forced a fake object into the payload.

### The `pending` block is gone, and that is a Phase 14d assertion inverted

Phase 14d shipped five metrics labelled unavailable because Phase 15 had not
created a reservation and Phase 19 had not moved any money. Both shipped. A
block still saying "not yet" about records that exist is §1.4's failure in the
other direction, so `performance` carries the real numbers.

What that assertion was protecting survives and is the stronger half: a number
nobody has computed is ABSENT, never a zero. `conversionRate` over no clicks is
`null` rather than `0%`, and `creator-partnership.test.ts` now asserts that
instead — one test, one dated comment.

### The bonus is the Creator's own, or there is none

§14.3's bonus is per proposal version with a stored trigger unit and threshold.
The reference draws a platform-wide *"50 reservations to your bonus tier"*;
there is no such target and inventing one is §1 rule 6. A Creator with no agreed
bonus gets `null` and the section does not render.

The progress measure is a RUNNING total over rows still live or already charged,
and `note` says so — the bonus is decided at close on captured, verified charges
only. Reporting the finalization measure live would read 0 for every Creator
until the close batch runs, which is true and useless.

### The termination ask opens a case, and does NOT write 0048's row

**A decision, and it departs from the brief's own sentence.**
`association_termination_requests` requires a §24.8 `cause` and a
`money_treatment` from that cause's permitted matrix. Both are an Admin's
recorded judgement (20a), every one of the five causes asserts fault about
somebody, and there is no unclassified shape — adding one would weaken a CHECK
that exists to stop the strongest treatments becoming reachable.

Asking a Creator to pick one is asking them to classify a refund that does not
exist. So the Creator states §29.5's reason and the ask is a §26.7 support case
with its own `PVD-` reference, its owner, and §27.8's business-day promise on
the committed calendar; the Admin's own control on the Creators workspace
records the classified 0048 row from it. `openAffiliateSupportCase` took exactly
this shape on 2026-08-17 and this reuses it rather than opening a second queue.

The suite asserts both halves: a case with a real deadline and calendar version
appears, and `association_termination_requests` stays empty.

### §5.3's settings gap, closed — and it is not a relaxation

`saveSignupProfile` still hard-refuses once `claimed_at` is set; that refusal is
load-bearing for onboarding screens 1–8 and is untouched. This is a different
act with the Admin correction path's discipline: a required reason, the prior
value read `FOR UPDATE` inside the transaction that changes it (§33.12.4 — the
route has no parameter for the prior value, so a flattering pair is
unrepresentable), an `audit_events` row in the same transaction, and §11's
supplier triple recomputed so the source label stays true.

The field id is a register entry and never a column name (16a's
overridable-field reasoning). Three places agree and the suite proves it:
shared's two registers, `backend/src/creator-flow/logic.ts`, and
`pg_get_constraintdef` on 0055's own CHECK.

The delete-account ask writes **0044's own record** with `received_via` naming
this screen — which is precisely what that column exists for. A second table
would have been the duplicate this codebase refuses everywhere else, and on an
erasure request two copies disagreeing is the worst version of that failure.

### There is no withdrawal, and the suite walks every control to say so

§22.1, verbatim: *"The Affiliate never requests a Proovd withdrawal and never
receives Backer funds before Transfer creation."* The reference draws `Withdraw`
twice and `Ready to withdraw` above it.

There is no control to disable — `EARNINGS_ARE_NOT_WITHDRAWN` stands where they
were — and the enforcement is three scans: every button and link on both money
surfaces, both money modules with comments stripped first (they EXPLAIN at
length that there is no withdrawal), and two plausible route addresses driven
and asserted 404.

### Earnings is an address, not a second computation

Each row calls `readCreatorClose` — the one resolver that renders Appendix B.7
and throws on an unfilled bracket. The lifetime figure is a sum of RECORDED
rows, read straight from `creator_earnings`, and an estimate is never added in:
a lifetime number that moved when a campaign reconciled would have been wrong on
the way there. There is no arithmetic in the module beyond that addition, and
§24.4's split stays three separate stored numbers.

### Deviation 4 is kept true by four absent columns

`creator_resource_interest` has a resource key, a subject, and a timestamp, and
the suite asserts `information_schema` holds no asset, URL, file, storage, or
campaign column on it. It cannot become the §31.5 Campaign kit, which is per
campaign, access-logged, and revocable. There is no download control, because
there is no file — and a disabled one invites somebody to work out how to
enable it.

A second ask is not an error and not a second row: the unique index answers, and
telling somebody their second tap failed would report a constraint as a problem
with them.

### What the Session F browser pass found, and nothing else could

Five, and the thirteenth rebuild in a row where the pass found what jsdom, axe
and the type checker all agreed was fine.

1. **`Measure` is a max-width with no gutter.** All four pages used it, so every
   `.card` sat flush against the viewport edge while the `Section` above it was
   inset by `.wrap` — two different left edges on one page at 1280. They use
   `.cra-page` now, which is Session D's own container and what Home already
   used.
2. **`.cra-amount` at `--fs-hero` pushed the document sideways at 320.**
   `US$691.20` is 348px wide there — 28px of overflow, a §33.11.1 failure on the
   one page whose whole job is a number. It clamps now.
3. **A nested `.wrap` overflowed Settings at BOTH widths** — by 231px at 1280.
   `.wrap` is `min(90vw, 1600px)`, a VIEWPORT width, and Settings embeds
   §27.7's `NotificationSettings`, which renders its own `Section`. This is
   PHASE 38's own defect on a different container, and the fix is scoped the
   same way.
4. **Ten one-row `dl.kv` lists produced five different value positions.**
   `.kv__row` is `minmax(8rem, max-content)` and sizes per list, so the settings
   "column" was not a column. One fixed label column, collapsing at the same
   600px `.kv__row` does.
5. **The `Copy` button lost 8px of its own label at 320.** A `.btn` is
   `overflow: hidden` because it hosts the fill sweep; showing the URL itself
   where the old surface showed a label is what squeezed the row. Session D and
   Founder Flow Sessions D and E each lost a pass to the same property.

Plus one change the pass prompted rather than a defect: the tracking link
rendered the words *"Your tracking link"* where the URL should be, so a Creator
could copy their link and never read it. It shows the URL now, which is also
what the reference draws.

### Two probe results that are NOT defects

`.copylink__url` reports as clipping at 320 and is `text-overflow: ellipsis` —
designed truncation. And a `span.sr-only` reports as a 1px clipping box on every
route, which is the visually-hidden mechanism. Both are skipped, written down
rather than silenced, because a scan tuned until it stops flagging a correct
element would also stop flagging a wrong one.

### Two contrast gaps that are pre-existing and were NOT changed here

`.kv__row dt` and `.btn--secondary` — `--grey` at ~2.18:1 and `--brand` on white
at ~1.46:1. Both are shared primitives every workspace uses, both are the
documented tech-stack §3.6 territory, and re-toning either is a product-wide
edit with its own screenshot pass. PHASE 41 uses neither: a sentence that states
a rule takes `--dark`, a caption takes `--moss`.

### What Session F deliberately did not build

* **Any migration.** 0055 and 0044 held every record; this is their service.
* **A second refund path or a second Transfer path.** There is one Transfer per
  association and it is Admin's, from the close queue, under the §11 tax gate.
* **A 0048 termination row from a Creator route.** See above.
* **A Creator-facing dispute surface.** §30 defers the in-product dispute
  centre; §29.9's Backer support path is the Backer's.
* **A `List-Unsubscribe` header, a resource notification key, or any new §27
  key at all.** The §27 coverage partition is untouched.
* **Session E's Pitches list.** The rail still points at `/creator/campaigns`,
  which is Phase 08c's list until E replaces it.
