/**
 * The Creator onboarding flow's pages — Creator Flow v2, Session A, 2026-08-19.
 *
 * ── Why this is a register and not a router ─────────────────────────────────
 * `shared/src/vetting/flow.ts`'s reasoning, applied to the second full-bleed
 * sequence in the product. Three things need to agree about what these pages
 * ARE: the router, the help drawer (which lists one card per page, marks the
 * current one, and jumps), and §33.11's flow register. Three hand-written lists
 * is two chances to disagree, and the disagreement shows up as a help card that
 * jumps somewhere that does not exist.
 *
 * ── It holds only the pages a session has BUILT ─────────────────────────────
 * `events.ts`'s rule, applied to a surface: a page appears here when something
 * renders it, never before. Session A shipped it empty because it built no
 * screen; Session B added the four the invitation token opens. What it must
 * never do is list a page nobody can reach, because the help drawer's
 * "everything before it" is then an aspiration rather than a fact.
 *
 * ── The order is the reconciliation's, not the reference's ──────────────────
 * `docs/phases/creator-flow-reconciliation.md` §1 is the canonical order.
 * `stage` is the auth regime a page sits under, and it is why the boundary at
 * the claim is not negotiable: a page cannot be one stage earlier than the
 * mechanism that authorises it. The reference draws no boundary at all — its
 * `signOut()` returns to step 0 and `onboarded` is a boolean in component
 * state. That is a prototype artifact. Here it is two different middlewares.
 */

/**
 * The three auth regimes of the flow, from the reconciliation's §1.
 *
 * 1 — the invitation token (`requireAffiliateInvitationToken`). No account
 *     exists, and every route is `/api/affiliate-invitation/:token`.
 * 2 — the claim itself. `completeAffiliateSignup`, once, which creates the
 *     account and CLAIMS the token — so every stage-1 address stops resolving.
 * 3 — a Creator session (`requireRole('affiliate')`), behind
 *     `policyReacceptanceGate` and `creatorStandingGate`.
 *
 * One stage shorter than the Founder flow's five, because a Creator pays no
 * listing fee and therefore has no money regime of their own.
 */
export type CreatorFlowStage = 1 | 2 | 3;

export interface CreatorFlowPage {
  /** Stable id. The help drawer, the router, and the tests all key on it. */
  id: string;
  /**
   * The route pattern. Its one parameter is substituted by `creatorFlowPath` —
   * never interpolated by hand at a call site, because a raw token in a
   * hand-built string is one edit away from a query parameter a Referer would
   * carry to a third party (§28.1).
   */
  path: string;
  /**
   * Which value that parameter is.
   *
   * Stage 1 and 2 are addressed by the invitation token; stage 3 by nothing,
   * because the app's addresses are account-level and carry no id at all.
   * Naming it here is what lets one `creatorFlowPath` serve both without a call
   * site guessing — and it is what the help drawer reads to decide whether an
   * earlier page is still reachable from where somebody is standing.
   */
  param: 'token' | 'none';
  /** The help drawer's card title. */
  title: string;
  /** The help drawer's one-line explanation. One line, and it stops. */
  help: string;
  stage: CreatorFlowStage;
}

/**
 * The pages a session has actually built.
 *
 * Session A shipped this empty and a test asserted it. Session B appended
 * screens 0–3 and Session C appends 4–8; Session D adds the app shell. Each
 * session adds only what it renders, because a register pre-populated with
 * fourteen pages would make every "is this page reachable" check answer yes
 * about surfaces that do not exist — and the help drawer's "everything before
 * it" would be an aspiration rather than a fact.
 *
 * ── The addresses (Session B, 2026-08-19) ───────────────────────────────────
 * `/creator-invitation/:token` is the invitation's own address and screen 0 is
 * what the §8 email points at. Every later stage-1 page hangs below it, so the
 * token travels in the path and nowhere else (§28.1) and a Creator's position
 * is a URL they can reload (DNA §5.12).
 *
 * ── Screen 8 is stage 3, and that is forced by the record (Session C) ───────
 * `completeAffiliateSignup` calls `tokens.claimAffiliateInvitation`, which sets
 * BOTH `claimed_at` and `revoked_at` — so from the instant the account exists,
 * every `/creator-invitation/:token` address answers the one rejection. A
 * "your account is set up" screen at a token address is a screen nobody can
 * reach, which is why `done` is `param: 'none'` and lives under `/creator`.
 *
 * That is not a Session C decision so much as one Session A anticipated when
 * it typed `param` as `'token' | 'none'` and wrote
 * `CREATOR_FLOW_EARLIER_STAGE_CLOSED`.
 */
export const CREATOR_FLOW_PAGES: readonly CreatorFlowPage[] = [
  {
    id: 'welcome',
    path: '/creator-invitation/:token',
    param: 'token',
    title: 'Your invitation',
    help: 'Who invited you, and what promoting a Proovd campaign involves.',
    stage: 1,
  },
  {
    id: 'password',
    path: '/creator-invitation/:token/password',
    param: 'token',
    title: 'Your password',
    help: 'The password for the account you are about to create. We never store it in plain text.',
    stage: 1,
  },
  {
    id: 'profile',
    path: '/creator-invitation/:token/you',
    param: 'token',
    title: 'You',
    help: 'Your name, the address we write to, and your phone. We filled in what we already knew.',
    stage: 1,
  },
  {
    id: 'channel',
    path: '/creator-invitation/:token/channel',
    param: 'token',
    title: 'Your channel',
    help: 'What a Founder sees when they look at you: where you post, who watches, and what about.',
    stage: 1,
  },
  {
    id: 'voice',
    path: '/creator-invitation/:token/voice',
    param: 'token',
    title: 'Your voice',
    help: 'How you describe your own style. Shown to Founders, and never used to write anything for you.',
    stage: 1,
  },
  {
    id: 'presence',
    path: '/creator-invitation/:token/presence',
    param: 'token',
    title: 'Your bio',
    help: 'The short description a Founder reads. We drafted one; your words replace it.',
    stage: 1,
  },
  {
    id: 'verify',
    path: '/creator-invitation/:token/verify',
    param: 'token',
    title: 'Your numbers',
    help: 'Your own audience figures, which somebody at Proovd checks against your channel.',
    stage: 1,
  },
  {
    id: 'agree',
    path: '/creator-invitation/:token/agree',
    param: 'token',
    title: 'The agreement',
    help: 'What you are agreeing to, and the one action that creates your account.',
    stage: 2,
  },
  {
    id: 'done',
    path: '/creator/welcome',
    param: 'none',
    title: 'You are in',
    help: 'Your account exists. What happens next, who owns the wait, and your payout setup.',
    stage: 3,
  },
];

/** Every page's route pattern, for the §33.11 flow register and its fixtures. */
export const CREATOR_FLOW_ROUTES: readonly string[] = CREATOR_FLOW_PAGES.map(
  (page) => page.path,
);

export function creatorFlowPage(id: string): CreatorFlowPage | undefined {
  return CREATOR_FLOW_PAGES.find((page) => page.id === id);
}

export function creatorFlowIndex(id: string): number {
  return CREATOR_FLOW_PAGES.findIndex((page) => page.id === id);
}

/**
 * A page's real address, for one invitation token.
 *
 * The value is encoded here, once. Every caller passes the raw one and gets a
 * path back; nothing builds one by hand. A `param: 'none'` page has no value to
 * substitute, so passing one is a caller error rather than a silently ignored
 * argument — the flow's addresses after the claim are account-level, and a
 * token appended to one would be a live credential in an app URL.
 */
export function creatorFlowPath(id: string, param?: string): string {
  const page = creatorFlowPage(id);
  if (!page) throw new Error(`unknown creator flow page: ${id}`);
  if (page.param === 'none') {
    if (param !== undefined) {
      throw new Error(`creator flow page ${id} takes no parameter`);
    }
    return page.path;
  }
  if (param === undefined) {
    throw new Error(`creator flow page ${id} needs a ${page.param}`);
  }
  return page.path.replace(`:${page.param}`, encodeURIComponent(param));
}

/* ── The help drawer ──────────────────────────────────────────────────────── */

/**
 * §27.1's sixth question — *how do I get help without losing context* —
 * answered for the whole flow rather than per screen.
 *
 * The subhead is load-bearing and is the Founder flow's own: the drawer lists
 * the current page and the ones already passed, and NOT the ones ahead. A
 * drawer that listed what is coming would be a progress bar with reading
 * attached, and it would name pages the Creator cannot reach yet.
 */
export const CREATOR_FLOW_HELP_TITLE = 'Help';
export const CREATOR_FLOW_HELP_SUBHEAD = 'This page and everything before it';

/**
 * Why an earlier card in the drawer is reading rather than a jump.
 *
 * `completeAffiliateSignup` claims the invitation token, so from any page in
 * the app every stage-1 page has no address left — and offering the jump anyway
 * would send somebody to the unusable-link page from their own help drawer. The
 * card keeps its explanation, which is the half that was worth having, and
 * loses the control that would fail (§1.4).
 */
export const CREATOR_FLOW_EARLIER_STAGE_CLOSED =
  'Your invitation link was used up when your account was created, so this step no longer opens. Everything you entered is on your profile.';

/** Whether one page can be reached from another — the same parameter, or not. */
export function creatorFlowReachableFrom(fromId: string, toId: string): boolean {
  const from = creatorFlowPage(fromId);
  const to = creatorFlowPage(toId);
  if (!from || !to) return false;
  return from.param === to.param;
}

/* ── What the reference draws and the Spec forbids ────────────────────────── */

export interface CreatorFlowAbsence {
  /** The reference's own element, named so it is recognisable in the bundle. */
  element: string;
  /** Why it is not here. Read by a person deciding whether to add it back. */
  absentBecause: string;
  specRef: string;
  /** Which session owns the surface this would have appeared on. */
  session: 'B' | 'C' | 'D' | 'E' | 'F';
}

/**
 * The `FOUNDER_FLOW_ABSENCES` arrangement, applied to the Creator's flow.
 *
 * These are elements the reference draws that no surface renders. Unlike an
 * absence a screen can explain in a sentence, each of these is the removal of a
 * whole element, so there is nowhere on a page to say why — which is exactly
 * why it is written down here instead. **A later session that wants one back
 * has to delete the entry that refuses it.**
 *
 * The five authorised deviations are NOT here. This register is what the Spec
 * refuses; a deviation is what product direction accepted with the rule named.
 */
export const CREATOR_FLOW_ABSENCES: readonly CreatorFlowAbsence[] = [
  {
    element:
      'The passive "By continuing you\'re agreeing to Proovd\'s Terms" line on the splash screen',
    absentBecause:
      '§28.4 records acceptance as separate unchecked controls at the claim, and no `policy_consents` row exists for anything done on the invitation page. A line that says agreement happened by arriving describes a consent the product did not record.',
    specRef: '§28.4, §11',
    session: 'B',
  },
  {
    element:
      '"We bring you products people actually want, and pay you every time they bite" on the splash',
    absentBecause:
      'It reads as a payment per click. §22.1 pays on the captured, validly attributed, pre-tax subtotal, after first-post verification and after Admin finalizes — never per visit. Re-authored rather than dropped; the beat is fine and the promise is not.',
    specRef: '§22.1, §18',
    session: 'B',
  },
  {
    element: 'The `Username` input on the Presence screen, beside the public handle',
    absentBecause:
      '`public_handle` is one column and is what a Founder sees on the §11 public card. Two fields writing one conceptual thing is two values that eventually disagree, and the surface would have to pick one to show.',
    specRef: '§11',
    session: 'C',
  },
  {
    element:
      '"This is what shapes your affiliate score and whether founders trust you" beside the evidence upload',
    absentBecause:
      'It makes evidence an eligibility mechanic. §8 makes verification an Admin\'s recorded judgement over §5.3\'s evidence, not a count of files — and a number of screenshots deciding how many Founders can see somebody is §30\'s percentile pruning with a friendlier face.',
    specRef: '§8, §30, §5.3',
    session: 'C',
  },
  {
    element:
      'The `matchPct` meter rising 25% per screenshot, and the "Add proof to unlock" state behind it',
    absentBecause:
      'The same mechanic as a progress bar. There is no threshold in §5.3 or §8 that a count of uploads crosses, so the meter would measure something nobody defined.',
    specRef: '§8, §30, §1 rule 6',
    session: 'C',
  },
  {
    element:
      '"Your money is guaranteed" / "Follow the agreement and your pay is locked" / "No clawbacks." above the agreement on the consent screen',
    absentBecause:
      'Untrue, on the screen where somebody is consenting. §22.1 provides for cancelling unpaid invalid amounts and creating a contractual recovery record on fraud, fake traffic, self-dealing, false claims, invalid proof, or material breach; §29.5 protects only VALID FINALIZED commission and only absent Creator-caused invalidity; and 20a\'s `applyCauseBasedAffiliateAdjustment` exists precisely because clawbacks happen. Re-authored to what is true, which is close to the Spec\'s own and is stronger copy.',
    specRef: '§22.1, §29.5, §24.8',
    session: 'C',
  },
  {
    element:
      'One `Agree and enter` button covering Terms + AUP + IP & NDA and four representations in one sentence',
    absentBecause:
      'Three separate problems. §28.4 forbids bundling and requires the 18+ confirmation unchecked; §11 requires exactly two policy acceptances, Terms and the Creator AUP, which is what `AFFILIATE_CLAIM_POLICY_SLUGS` already holds; and §31.5\'s IP agreement is PER CAMPAIGN and due before work, already collected at §14.2 acceptance — putting it here would collect it for a campaign the Creator has not accepted.',
    specRef: '§28.4, §11, §31.5',
    session: 'C',
  },
  {
    element: 'The `Founders see this` badge on the standing tier',
    absentBecause:
      'Nothing shows a tier to a Founder. §8 makes the internal quality tier assessment data, and `listFounderVisibleRoster`\'s seven-column projection carries no tier at all. Either build the Founder-side render or drop the claim; the claim is dropped.',
    specRef: '§8, §11',
    session: 'D',
  },
  {
    element: '"Climb toward Platinum for higher floors and early access"',
    absentBecause:
      'An eligibility condition in §1 rule 6\'s own list, and it collides with something already built: §29.4 makes `restrict bidding` an enforcement action, and the Admin workspace DERIVES proposal access from §29 records rather than storing it. A standing tier that changed proposal access would be a second, contradictory answer to one question.',
    specRef: '§1 rule 6, §29.4, §8',
    session: 'D',
  },
  {
    element: 'The "6-campaign streak. These only go up." card',
    absentBecause: '§30 defers confetti, streaks, and countdown pressure by name.',
    specRef: '§30',
    session: 'D',
  },
  {
    element: 'The `Founder shout-outs` block — two testimonials attributed to named Founders',
    absentBecause:
      'No record holds a Founder testimonial about a Creator, and §30 defers public Founder ratings from the other direction.',
    specRef: '§30, §1 rule 6',
    session: 'D',
  },
  {
    element: '"Pick your next campaign" on Home',
    absentBecause:
      'It implies a pool to pick from. §5.3 and §8 admit a Creator to one campaign per invitation, and §30 defers algorithmic general-pool matching and Founder browsing of unmatched Creators. It routes to the Creator\'s own open invitations, which is a real list.',
    specRef: '§5.3, §8, §30',
    session: 'D',
  },
  {
    element: 'The `browse` mode, its horizontal marketplace row, and the Commission and Price sort keys',
    absentBecause:
      'There is no marketplace. §11 keeps a Creator tied to the campaign that caused the invitation. What survives is real and is kept: a Creator may hold several open invitations at once, so the list is their OWN, the horizontal presentation stays, and sorting is by response deadline and campaign.',
    specRef: '§5.3, §8, §11, §30',
    session: 'E',
  },
  {
    element: 'The `predicted: "$450 to $1,200"` and `"$400 up + 25%"` lines on every pitch card',
    absentBecause:
      'No record holds a predicted earning. §22.2 forbids compensation being guaranteed, estimated, or calculated by the product, and §1 rule 6 is the direct one. The card renders the real §14.3 cell instead.',
    specRef: '§1 rule 6, §22.2, §14.3',
    session: 'E',
  },
  {
    element: 'The `Trending in your niche` badge',
    absentBecause:
      '§30 defers fabricated popularity. Nothing counts "trending" and nothing could. The badge renders §14.1\'s own `Why this fits your audience` — two Admin-written sentences, which is a real field and the first thing §14.1 puts on the surface.',
    specRef: '§30, §14.1',
    session: 'E',
  },
  {
    element: '"Sits at your floor. Countering for 30 to 35% is fair here."',
    absentBecause:
      'Two things at once. There is no per-Creator rate floor anywhere — §14.3\'s base comes from three §6 settings and the campaign model — and advising a counter amount is Proovd taking a side in a §14.2 negotiation it may only mediate.',
    specRef: '§14.3, §14.2, §1 rule 6',
    session: 'E',
  },
  {
    element: 'The `Request a 1-1 meeting` control, on the pitch recap and the work surface',
    absentBecause:
      '§30 defers the Founder–Creator meeting scheduler and direct Founder–Affiliate messaging, and §16\'s no-nudge rule says the same thing from the other side. The Founders workspace refused a meeting record for this reason on 2026-08-17.',
    specRef: '§30, §16',
    session: 'E',
  },
  {
    element:
      'The `Customize` control on promo assets, `Generate milestone graphic`, and scripts rendered "in your {tone} voice"',
    absentBecause:
      '§30 defers AI pitch rewriting and refinement; §12 makes the helper resources static, copy-ready guidance and not an embedded AI product. There is no model client in this tree and a shared test scans for one. The tabs stay and render real §31.5 kit assets, downloaded rather than generated; the recorded tone is SHOWN and never used to rewrite anything.',
    specRef: '§30, §12',
    session: 'F',
  },
  {
    element: 'Backer survey quotes on the work surface',
    absentBecause:
      '§19 limits a Creator to aggregate clicks, attributed pre-orders, reward summary, and timestamps; §28.4 says the Creator receives no Backer PII. A free-text survey answer is neither aggregate nor a timestamp, and §19\'s survey consent is scoped to the Founder\'s results surface.',
    specRef: '§19, §28.4',
    session: 'F',
  },
  {
    element: 'The `Best time to post:` line on the work surface',
    absentBecause:
      'Found by the Session F walk rather than named in the brief. It is an analytic over when other people posted and how their traffic performed — nothing counts it, and building it would need per-Creator behavioural data §19 does not give this surface and §30 would not permit it to advise on. The click ledger records outcomes, not a recommendation.',
    specRef: '§19, §30, §1 rule 6',
    session: 'F',
  },
  {
    element:
      'The `Hit your next milestone` card and its "50 reservations to your bonus tier" target',
    absentBecause:
      '§14.3\'s bonus is Creator-specific, per proposal version, with a stored trigger unit and threshold. A platform-wide target of 50 is invented. The surface renders the Creator\'s own agreed bonus where one exists, and nothing where none does.',
    specRef: '§14.3, §1 rule 6',
    session: 'F',
  },
  {
    element:
      'The `Withdraw` and `Ready to withdraw` controls on the Earnings hero and the per-campaign panel',
    absentBecause:
      '§22.1, verbatim: "The Affiliate never requests a Proovd withdrawal and never receives Backer funds before Transfer creation." Admin creates ONE idempotent Transfer per association on or after Day 3, under the §11 tax gate. The screen keeps its typography; the control becomes Appendix B.7, resolved server-side.',
    specRef: '§22.1, §11',
    session: 'F',
  },
  {
    element:
      'The `Base commission` / `Performance bonus` split computed as `earned * 0.8` and `earned * 0.2`',
    absentBecause:
      'Money arithmetic in the browser, with invented weights. There is one waterfall, in `shared/money`, and §24.4 has the real split: finalized commission, earned bonus, and eligible fixed amount are three separate stored numbers on `creator_earnings`.',
    specRef: '§24.4, §33.8.13',
    session: 'F',
  },
  {
    element:
      'The three notification switches — `New pitches`, `Campaign updates`, `Payouts` — on Settings',
    absentBecause:
      '§27.2\'s first rule is that transactional email is not opt-out-able, and `Payouts` is the most transactional message a Creator receives. §27.7\'s optional digest is the one opt-out-able thing in the product, and its control already exists.',
    specRef: '§27.2, §27.7',
    session: 'F',
  },
  {
    element: '"Proovd never costs you anything."',
    absentBecause:
      'Broader than any record. §24.5 forbids hiding processing fees inside Creator percentages and §24.7 keeps the fixed payment out of every percentage — both true, both narrower than the sentence. Narrowed to what those two actually guarantee.',
    specRef: '§24.5, §24.7, §22.1',
    session: 'F',
  },
  {
    element: 'The global `Enter` handler that fires the current screen\'s primary action',
    absentBecause:
      'Founder Flow Session E\'s reasoning: a stray keystroke must not authorize a decision, and on this flow the decisions include accepting a §14.2 agreement. No global key handler exists.',
    specRef: '§28.5, §30',
    session: 'B',
  },
  {
    element: '`signOut()` returning to the onboarding wizard at step 0',
    absentBecause:
      'A prototype artifact — `onboarded` is a boolean in component state there. Signing out ends the session; the invitation token was claimed and its addresses no longer resolve.',
    specRef: '§5',
    session: 'F',
  },
  {
    element: 'The fixed `.claim-wide-stage` at a CSS `scale()`',
    absentBecause:
      '§33.11.1\'s 320px reflow is not satisfiable by a scaled fixed stage — it produces a smaller picture of an overflowing page, not a page that fits. Responsive units throughout.',
    specRef: '§33.11.1, §28.5',
    session: 'B',
  },
];

/**
 * What the Spec requires and the prototype never drew.
 *
 * The other direction of the same discipline. An element missing from a
 * reference is invisible — there is no control to notice the absence of — so
 * the four §-required things it omits are listed here, with the session that
 * owes each one.
 */
export interface CreatorFlowOmission {
  element: string;
  requiredBecause: string;
  specRef: string;
  session: 'B' | 'C' | 'D' | 'E' | 'F';
}

export const CREATOR_FLOW_OMISSIONS: readonly CreatorFlowOmission[] = [
  {
    element: 'The safe tracking-link test',
    requiredBecause:
      '§14.1 gives the Creator a way to check their own link without earning attribution. The mechanism exists — `LINK_TEST_MARKER`, excluded by the 14b ingest by that exact name and CHECK-tied to the `link_test` outcome — and the prototype offers no control for it.',
    specRef: '§14.1, §18',
    session: 'F',
  },
  {
    element: 'The seven §20 Creator obligations',
    requiredBecause:
      '§20 lists what a Creator owes during a live campaign, and `CREATOR_OBLIGATIONS` already holds all seven. The prototype\'s work screen shows metrics and materials and never states the obligations they attach to.',
    specRef: '§20',
    session: 'F',
  },
  {
    element: 'The §29.1 self-pre-order disclosure',
    requiredBecause:
      'A Creator pre-ordering through their own link must disclose it, and the record exists with both certifications CHECK-required. Without a control the only path is an Admin recording it for them, which is not what §29.1 describes.',
    specRef: '§29.1',
    session: 'F',
  },
  {
    element: 'The §29.2 conflict disclosure',
    requiredBecause:
      'The same shape as §29.1 and the same gap. The record exists; the prototype draws no way to file one.',
    specRef: '§29.2',
    session: 'F',
  },
];
