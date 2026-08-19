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
