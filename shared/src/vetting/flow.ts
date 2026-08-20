/**
 * The Founder onboarding flow's pages — Founder Flow v2, Session B, 2026-08-18.
 *
 * ── Why this is a register and not a router ─────────────────────────────────
 * The reference is twenty-six full-bleed pages, each owning its viewport, with
 * no persistent chrome. Three things need to agree about what those pages ARE:
 * the router, the help drawer (which lists one card per page, marks the current
 * one, and jumps), and §33.11's flow register. Three hand-written lists is two
 * chances to disagree, and the disagreement shows up as a help card that jumps
 * somewhere that does not exist.
 *
 * ── It holds only the pages that EXIST ──────────────────────────────────────
 * Twenty-six were planned and twenty-four are here. On 2026-08-20, by
 * explicit product direction, the reach orbit and the problem confirm were
 * added from the reference, and two pages were removed outright — the §10
 * relevance signal (`match`) and the account-claim screen (`claim`) —
 * screens and register entries both. So this is every page the flow has,
 * and the help drawer's "everything before it" is a fact rather than an
 * aspiration.
 *
 * ── The order is the reconciliation's, not the reference's ──────────────────
 * `docs/phases/founder-flow-reconciliation.md` §1 is the canonical order, and
 * it differs from the reference's own in three places, each forced by code that
 * already exists rather than by an opinion. `stage` is the auth regime a page
 * sits under, and it is the reason those three moves are not negotiable: a page
 * cannot be one stage earlier than the mechanism that authorises it.
 */

/**
 * The auth regimes of the flow, from `founder-flow-reconciliation.md` §1.
 *
 * 1 — the draft token (`requireDraftToken`). No account exists.
 * 3 — a Founder session (`requireRole('founder')`).
 * 4 — a Founder session, money. A complete `founder_seller` account.
 * 5 — post-fee. Phase 11's effect 4 has opened the formal Creator opportunity.
 *
 * Regime 2 was the account-claim screen — the one stage-2 page there was. That
 * screen was removed on 2026-08-20 (with the §10 relevance signal), so no page
 * carries the value any more and it left the union rather than staying as a
 * stage nothing occupies. The numbering of 3–5 deliberately does not close the
 * gap: stage numbers appear in comments across the tree, and renumbering them
 * would put every one of those out of step with the code beside it.
 */
export type FounderFlowStage = 1 | 3 | 4 | 5;

export interface FounderFlowPage {
  /** Stable id. The help drawer, the router, and the tests all key on it. */
  id: string;
  /**
   * The route pattern. Its one parameter is substituted by `founderFlowPath` —
   * never interpolated by hand at a call site, because a raw token in a
   * hand-built string is one edit away from a query parameter a Referer would
   * carry to a third party (§28.1).
   */
  path: string;
  /**
   * Which value that parameter is.
   *
   * Stage-1 pages are addressed by the draft token; stage 3 onward by the
   * campaign, because §10's claim invalidates the token and every route past it
   * is behind `requireRole('founder')`. Naming it here is what lets one
   * `founderFlowPath` serve both without a call site guessing — and it is what
   * the help drawer reads to decide whether an earlier page is still reachable
   * from where somebody is standing.
   */
  param: 'token' | 'campaignId';
  /** The help drawer's card title. */
  title: string;
  /** The help drawer's one-line explanation. One line, and it stops. */
  help: string;
  stage: FounderFlowStage;
}

export const FOUNDER_FLOW_PAGES: readonly FounderFlowPage[] = [
  {
    id: 'invite',
    path: '/draft/:token',
    param: 'token',
    title: 'Your invite',
    help: 'We filled in most of this from our call. Read it, change anything that is off, and open the form.',
    stage: 1,
  },
  {
    id: 'problem',
    path: '/draft/:token/problem',
    param: 'token',
    title: 'Your problem',
    help: 'The problem we heard you describe. A reviewer and a Creator both read it, so plain words beat polished ones.',
    stage: 1,
  },
  {
    id: 'solution',
    path: '/draft/:token/solution',
    param: 'token',
    title: 'Your solution',
    help: 'What you are building, in your words. One or two sentences beats a paragraph.',
    stage: 1,
  },
  {
    /*
      The reach orbit — built 2026-08-20, on explicit product direction, from
      the reference's own `[data-reach]`. Its screen order is
      `['claim','problem','solution','reach','kind', ...]`, so it sits here.

      It is the one page in this register whose matching `FOUNDER_FLOW_ABSENCES`
      entry was DELETED rather than never written. The reasons that entry gave
      are recorded on `ReachStep.tsx`, together with the two mechanisms that
      keep the reversal narrow: this screen reads no record and stores nothing,
      and §10's relevance signal — the honest version of the same beat — is
      untouched two pages later.
    */
    id: 'reach',
    path: '/draft/:token/reach',
    param: 'token',
    title: 'Your reach',
    /*
      The reference's own help entry is
      `{id:'reach', t:'Your reach', b:'The audience our creators can put in
      front of your campaign. No action needed, just have a look.'}`.

      The title and the second sentence are verbatim. The first clause is not:
      "our creators can put in front of your campaign" states what Proovd's
      Creators WILL do, which is the §7 promise the screen was refused over.
      Changing one clause and leaving the rest is the smallest edit that
      removes it.
    */
    help: 'The audience a campaign like yours can reach. No action needed, just have a look. It is a typical figure rather than a promise, and nobody has agreed to anything.',
    stage: 1,
  },
  {
    id: 'campaign-type',
    path: '/draft/:token/campaign-type',
    param: 'token',
    title: 'Campaign type',
    help: 'An Idea Campaign tests demand before you build. A Product Campaign pre-sells something that already exists. The choice locks when you submit the form.',
    stage: 1,
  },
  {
    id: 'email',
    path: '/draft/:token/email',
    param: 'token',
    title: 'Your email',
    help: 'Where we send everything about this campaign. It is filled in from your invitation — change it if that is not the address you want.',
    stage: 1,
  },
  {
    id: 'code',
    path: '/draft/:token/code',
    param: 'token',
    title: 'Confirm your email',
    help: 'Six digits, sent to that address. It only confirms we can reach you — it creates no account and signs you into nothing.',
    stage: 1,
  },
  {
    /*
      The reference's `probConfirm` — its `vetting` screen at `vStep` 0, which
      is exactly where its `type` screen sends somebody once the code lands
      (`this.step({si:this.I('vetting'), vStep:0})`). Its own DOCS entry is
      `{t:'Confirm the basics', b:'Last look at the problem and the solution
      before the rest of the questions build on them.'}`; the title is verbatim
      and the line is narrowed to the one answer this screen shows, because
      §9 has one Problem and the reference asks the pair.
    */
    id: 'confirm-problem',
    path: '/draft/:token/confirm-problem',
    param: 'token',
    title: 'Confirm the basics',
    help: 'Last look at the problem before the rest of the questions build on it. Change it here if it is not right any more.',
    stage: 1,
  },
  {
    /*
      The same screen at `vStep` 1 — built 2026-08-20, by explicit product
      direction, from the reference's own `[data-pconfirm]`.

      One component there, two pages here. The reference's `isProbConfirm` is
      `n==='vetting' && !vReviewing && vStep<2`, so both the problem and the
      solution are `probConfirm`, and every difference between them is a
      ternary on `vStep`: `pcHead`, `pcText`, `pcCta`, and which answer
      `setProbText`/`stillMine` write. A register whose entries are ADDRESSES
      cannot hold one page at two, so the pair is two entries — which is also
      what lets the drawer name and mark them separately, and what lets Back
      from here land on the problem exactly as `back()`'s `vStep>0` branch
      does.

      The DOCS entry is shared there and covers both answers; the title is
      narrowed to this one for the same reason the problem's line was.
    */
    id: 'confirm-solution',
    path: '/draft/:token/confirm-solution',
    param: 'token',
    title: 'Confirm the solution',
    help: 'Last look at the solution before the rest of the questions build on it. Change it here if it is not right any more.',
    stage: 1,
  },
  {
    id: 'positioning',
    path: '/draft/:token/positioning',
    param: 'token',
    title: 'Your positioning',
    help: 'The one answer we never draft for you. Who else solves this, and why someone would choose you. Finishing it submits your answers.',
    stage: 1,
  },
  {
    /*
      Stage 3 — the five §12 answers and the review over all eight. Addressed by
      CAMPAIGN, because §10's claim invalidated the token and every route
      behind these is `requireRole('founder')`.
    */
    id: 'visuals',
    path: '/campaigns/:campaignId/setup/visuals',
    param: 'campaignId',
    title: 'Your visuals',
    help: 'Pictures or video of the product, approved by you for the campaign page. One is enough, and it takes US$2 off your listing fee.',
    stage: 3,
  },
  {
    id: 'branding',
    path: '/campaigns/:campaignId/setup/branding',
    param: 'campaignId',
    title: 'Your brand',
    help: 'A logo, the colours, and what the type is doing. Written direction rather than a mood board — a reviewer and a Creator both read it. US$2 off.',
    stage: 3,
  },
  {
    id: 'interview',
    path: '/campaigns/:campaignId/setup/interview',
    param: 'campaignId',
    title: 'Your interview',
    help: 'A conversation with a person at Proovd. It counts once the booking is confirmed — a slot you picked and did not confirm does not. US$2 off.',
    stage: 3,
  },
  {
    id: 'story',
    path: '/campaigns/:campaignId/setup/story',
    param: 'campaignId',
    title: 'Your story',
    help: 'Why you are building this, in your words, for the public page. You approve it before it counts — a draft or a transcript on its own does not. US$2 off.',
    stage: 3,
  },
  {
    id: 'socials',
    path: '/campaigns/:campaignId/setup/socials',
    param: 'campaignId',
    title: 'Your socials',
    help: 'One public page for you or the product that we can open and you control. US$2 off.',
    stage: 3,
  },
  {
    id: 'last-look',
    path: '/campaigns/:campaignId/setup/review',
    param: 'campaignId',
    title: 'Last look',
    help: 'All eight answers in one place, with what your listing fee comes to. Open any of the five optional ones to change it and you come straight back here.',
    stage: 3,
  },
  {
    /*
      Stage 4 — the money. Session E (2026-08-19).

      Stripe FIRST, and not as a preference: `beginListingCheckout` refuses
      without a complete `founder_seller` account, and §23.1 orders the two
      states the same way — `stripe_onboarding_pending` precedes
      `listing_fee_pending`. The reference draws the fee at 20 and payouts at
      25; drawn that way, screen 20 offers a payment the server declines.
    */
    id: 'payouts',
    path: '/campaigns/:campaignId/setup/payouts',
    param: 'campaignId',
    title: 'How you get paid',
    help: 'Your campaign takes payments through a Stripe account in your name. Stripe asks for your ID, bank and tax details directly — Proovd never sees them.',
    stage: 4,
  },
  {
    id: 'fee',
    path: '/campaigns/:campaignId/setup/fee',
    param: 'campaignId',
    title: 'Your listing fee',
    help: 'The one-off fee for listing your campaign, lowered by every optional answer you completed. Sales tax is worked out from your billing address before you agree to anything.',
    stage: 4,
  },
  {
    /*
      Stage 5 — openness, the build, and what stands between a submitted
      campaign and a live one. Session F (2026-08-19).

      After the fee because Phase 11's effect 4 is what opens the formal
      Creator opportunity: before it there is no Creator to be open to, and
      §15's review has nothing to review.
    */
    id: 'creator-payment',
    path: '/campaigns/:campaignId/setup/creator-payment',
    param: 'campaignId',
    title: 'How Creators are paid',
    help: 'Creators take a share of what your campaign collects. On a Product Campaign one may also ask for a fixed payment — this is where you say whether you would consider it, and it commits you to nothing.',
    stage: 5,
  },
  {
    id: 'voice',
    path: '/campaigns/:campaignId/setup/voice',
    param: 'campaignId',
    title: 'Your brand voice',
    help: 'A few words for how your campaign should sound, and anything else worth knowing. A reviewer and a Creator both read it.',
    stage: 5,
  },
  {
    /*
      Idea campaigns only — §14.4 gives a Product campaign no public
      threshold. `buildFlowStepsFor` is what decides the walk; the page is
      registered either way, because the register is the list of pages that
      EXIST rather than the list one campaign happens to reach.
    */
    id: 'threshold',
    path: '/campaigns/:campaignId/setup/threshold',
    param: 'campaignId',
    title: 'Your order threshold',
    help: 'How many pre-orders your campaign needs before any card is charged. It is a count of pre-orders, never an amount of money.',
    stage: 5,
  },
  {
    id: 'faqs',
    path: '/campaigns/:campaignId/setup/faqs',
    param: 'campaignId',
    title: 'Your FAQs',
    help: 'The questions people ask before they pre-order, answered in your words. They render on your public page exactly as you write them.',
    stage: 5,
  },
  {
    id: 'rewards',
    path: '/campaigns/:campaignId/setup/rewards',
    param: 'campaignId',
    title: 'Your Backer rewards',
    help: 'What somebody receives for pre-ordering, what it costs, and when it arrives. Your campaign needs at least one.',
    stage: 5,
  },
  {
    /*
      `setup/review` is Last look. This is the other kind of review — §15's,
      of the campaign — so it gets its own address rather than a parameter on
      one somebody may have bookmarked.
    */
    id: 'in-review',
    path: '/campaigns/:campaignId/setup/in-review',
    param: 'campaignId',
    title: 'Your campaign in review',
    help: 'Where your campaign stands between being submitted and going live: our review, your Creators’ decisions, and the coordinated launch.',
    stage: 5,
  },
  {
    id: 'live',
    path: '/campaigns/:campaignId/setup/live',
    param: 'campaignId',
    title: 'Your campaign is live',
    help: 'Your page is public and your Creators’ links are working. Everything after this happens on your campaign home.',
    stage: 5,
  },
];

export type FounderFlowPageId = (typeof FOUNDER_FLOW_PAGES)[number]['id'];

/** Every page's route pattern, for the §33.11 flow register and its fixtures. */
export const FOUNDER_FLOW_ROUTES: readonly string[] = FOUNDER_FLOW_PAGES.map(
  (page) => page.path,
);

export function founderFlowPage(id: string): FounderFlowPage | undefined {
  return FOUNDER_FLOW_PAGES.find((page) => page.id === id);
}

export function founderFlowIndex(id: string): number {
  return FOUNDER_FLOW_PAGES.findIndex((page) => page.id === id);
}

/**
 * A page's real address, for one draft or one campaign.
 *
 * The value is encoded here, once. Every caller passes the raw one and gets a
 * path back; nothing builds one by hand. Which value a page wants is the page's
 * own `param`, so a caller cannot pass a campaign id to a token-addressed page
 * by writing the wrong template string — there is no template string.
 */
export function founderFlowPath(id: string, param: string): string {
  const page = founderFlowPage(id);
  if (!page) throw new Error(`unknown founder flow page: ${id}`);
  return page.path.replace(`:${page.param}`, encodeURIComponent(param));
}

/* ── The help drawer ──────────────────────────────────────────────────────── */

/**
 * §27.1's sixth question — *how do I get help without losing context* —
 * answered for the whole flow rather than per screen.
 *
 * The subhead is load-bearing and is the reference's own: the drawer lists the
 * current page and the ones already passed, and NOT the ones ahead. A drawer
 * that listed what is coming would be a progress bar with reading attached,
 * and it would name pages the Founder cannot reach yet.
 */
export const FOUNDER_FLOW_HELP_TITLE = 'Help';
export const FOUNDER_FLOW_HELP_SUBHEAD = 'This page and everything before it';

/**
 * Why an earlier card in the drawer is reading rather than a jump.
 *
 * §10: a successful claim "invalidates the draft token". So from a page
 * addressed by the campaign, every page addressed by the token has no address
 * left — and offering the jump anyway would send somebody to the
 * unusable-link page from their own help drawer. The card keeps its
 * explanation, which is the half that was worth having, and loses the control
 * that would fail (§1.4).
 */
export const FOUNDER_FLOW_EARLIER_STAGE_CLOSED =
  'Your invitation link was used up when your account was created, so this step no longer opens. Your answers are on your campaign record.';

/** Whether one page can be reached from another — the same parameter, or not. */
export function founderFlowReachableFrom(fromId: string, toId: string): boolean {
  const from = founderFlowPage(fromId);
  const to = founderFlowPage(toId);
  if (!from || !to) return false;
  return from.param === to.param;
}

/* ── What the reference draws and the Spec forbids ────────────────────────── */

export interface FounderFlowAbsence {
  /** The reference's own element, named so it is recognisable in the bundle. */
  element: string;
  /** Why it is not here. Read by a person deciding whether to add it back. */
  absentBecause: string;
  specRef: string;
}

/**
 * The Founders-rebuild `OPERATIONS_ABSENCES` arrangement, applied to a flow.
 *
 * These are elements the reference draws that no surface renders. Unlike an
 * absence a screen can explain in a sentence, each of these is the removal of a
 * whole element, so there is nowhere on a page to say why — which is exactly
 * why it is written down here instead. A later session that wants one back has
 * to delete the entry that refuses it.
 */
export const FOUNDER_FLOW_ABSENCES: readonly FounderFlowAbsence[] = [
  /*
    The reach screen's entry left this register on 2026-08-20, when the screen
    was built on explicit product direction. It is recorded here rather than
    silently deleted, because a later reader meeting a missing refusal would
    conclude nobody had ever considered it — the opposite happened.

    What it said: the screen promises a result; §7 forbids Admin promising
    acceptance, results, reward pricing, or a named Creator's participation;
    and no record holds an audience number, the prototype's own being the
    constant 10,000. Every word of that is still true of the FIGURE. What
    holds it there is that `ReachStep.tsx` reads no record and stores nothing:
    a caveat sentence beneath the headline was added and then removed the same
    day by product direction, so the absence of anything behind the number is
    the whole of the guarantee rather than half of it.

    A later phase asked to make the number dynamic, per-campaign, or derived
    from §10's count is asking for the promise this entry refused. This note is
    not the licence for it.
  */
  {
    element:
      'The same "in front of [N] new people" line on the invite page, above the claim button',
    absentBecause:
      'The same promise in a smaller typeface. The invite page states what was done and what happens next, and offers no number nobody recorded.',
    specRef: '§7, §1 rule 6',
  },
  {
    element:
      'The message badge shaking on a loop — five rotations every six seconds, for as long as the page is open',
    absentBecause:
      'An element that moves indefinitely to draw attention is the pattern, whatever it opens. The badge stays, it enters once with the page, and then it is still.',
    specRef: 'DNA §5.10, §30',
  },
  {
    element: 'The campaign type rendered as `prebuild` / `prelaunch`',
    absentBecause:
      'Those are internal values and never reach a Founder. `CAMPAIGN_PATH_CHOICES[].name` — Idea Campaign, Product Campaign — is the only thing that renders.',
    specRef: '§3.1',
  },
  /* The email screen's headline and its focus ink both used to be recorded
     here. Both now SHIP, verbatim, by explicit product direction (2026-08-20) —
     see the two recorded deviations at the top of `EmailStep.tsx`. The entries
     are removed rather than left standing, because a register saying an element
     is absent while the page renders it is worse than no register.

     Four more entries left on 2026-08-20, when the match and claim screens
     were removed from the flow outright: the match sub-line and its category
     breakdown, the `Username:` label, and the three-field details screen. A
     refusal about an element of a screen that no longer exists refuses
     nothing, so the entries went with the screens. */
  {
    element:
      'The interview screen’s own platform tiles (Meet / Zoom / Teams) and time-slot chips',
    absentBecause:
      'tech-stack §12: "The booking record in our database is the source of truth, populated from Cal.com webhooks." A picker of our own is a second scheduler, and the two would disagree about what was booked — the provider would hold a slot this product never recorded, or the reverse. The screen renders the Cal.com embed, and a named absence while that account is unconfigured.',
    specRef: '§12, tech-stack §12',
  },
  {
    element:
      'The branding screen’s draggable HSV square — a saturation/value plane with a handle, over a hue bar',
    absentBecause:
      'A drag surface with no keyboard equivalent fails §28.5 on the one screen where the alternative is free, and §12 does not ask for a colour VALUE: it asks for "saved direction containing at least colors and typography/style guidance", which is writing. The hex field, the swatches it builds, and the direction box are all here; only the plane is not.',
    specRef: '§28.5, §12',
  },
  {
    element: 'The last-look card grid offering an edit affordance on all eight answers',
    absentBecause:
      'Three of the eight are §9 answers, and §9 locks them at submission — the route that wrote them is behind the draft token the claim just invalidated. So the first three cards render what was submitted and offer nothing, and the five optional ones open. An edit control that cannot work is worse than none.',
    specRef: '§9, §10, §1.4',
  },
  {
    element:
      'The listing-fee screen’s `You saved $0 by doing bonus tasks`, rendered when nothing was completed',
    absentBecause:
      'The walk found the prototype renders that line at zero. Telling somebody who did none of the optional answers that they saved nothing is worse than silence — it reads as a report that the work is not worth doing, on the screen where they can still do it. The savings line renders only when there is a saving; otherwise `LISTING_FEE_STILL_LOWERABLE` says the same beat forward.',
    specRef: '§1.4, DNA §5.4',
  },
  {
    element:
      'The listing-fee screen’s `Discount $10 by completing tasks` — the remaining discount, derived in the browser as `fee() − FEE_FLOOR`',
    absentBecause:
      'A second implementation of the fee, in a React component, is Phase 09’s named trap: it is how the preview and the charge diverge. The screen says how many optional answers are still open and what each one is worth — a count and a per-item amount the server sent — and never a total this browser worked out. It is also more accurate: the reference’s subtraction only equals the remaining discount because its three constants happen to line up, and §6 lets an operator change any of them.',
    specRef: '§6, §12, §24.6',
  },
  {
    element:
      'The `Saved $2` pulse toast on the listing-fee screen, firing when a bonus answer lands',
    absentBecause:
      'An optional answer cannot be completed from the fee screen — the five that complete one are six addresses away — so the toast announces a change that happened somewhere else, to somebody who was not there when it did. The saving is stated where it is earned: each answer page shows what it took off, and Last look shows the running total. The README describes this toast; the prototype draws nothing of the kind, which is what the walk was for.',
    specRef: '§1.4, DNA §5.10',
  },
  {
    element: 'The listing-fee screen’s payment control reading `Pay & Start`',
    absentBecause:
      'Appendix A.5 is exact text and it fixes the action as well as the body: `Agree and Pay US$[TOTAL]`, resolved by `resolveListingFeeConsent` from the same amounts the session charges. The consent opens `By clicking Agree and Pay` — a button reading anything else makes the sentence above it describe a control that is not there.',
    specRef: 'Appendix A.5, §13',
  },
  {
    element: 'The payouts-ready screen’s `Continue`',
    absentBecause:
      '§33.11.4: a control names its destination. `Continue` is the objectless label the register scans for by exact match, and on this screen the next thing is money — the one place in the flow where somebody should know what they are opening before they open it.',
    specRef: '§33.11.4, DNA §5.13',
  },
  {
    element:
      'The Creator-pay screen’s `Upfront fee` / `No upfront fee` structures, `upfrontAmount`, and the upfront-fee modal — eleven occurrences',
    absentBecause:
      '§3.2 bans `upfront (fee|payout|payment)` in every audience INCLUDING identifiers, and §33.11.3 scans the built bundle where a prop name survives minification. §3.2’s own replacement is `optional fixed Creator payment`, which is also §24.7’s name for the record. Resolved identically on 2026-08-11 for the Affiliate workspace, where the reference had *mandated* the banned term.',
    specRef: '§3.2, §24.7, §33.11.3',
  },
  {
    element:
      'The Creator-pay screen as a CHOICE of pay structure, with a Select button that picks one',
    absentBecause:
      '§16 makes the optional fixed Creator payment the CREATOR’s request, accepted bilaterally through one §14.2 proposal version. A Founder picking a structure during onboarding — before the listing fee, before any Creator exists — would be making the offer only a Creator may make. What is collected is an OPENNESS, with no amount, no percentage and no proposal reference; the record has no column for any of them.',
    specRef: '§16, §14.2, §1 rule 6',
  },
  {
    element:
      'The order-threshold screen’s `Set your order goal`, and `goalAmount`, `goalInput`, `goalEmpty`, `goalLow`, `goalFilled`, `goalNext`, `goalBoxBg` — sixty-five occurrences',
    absentBecause:
      '§3.2 bans `goal` for an Idea threshold, and its last paragraph binds identifiers. This is the third time it has come up: the Campaigns hub hit it with `progress.goal` and campaign-page-v2 with `PRIVATE BETA GOAL`, both caught by §33.11.3’s scan of the built bundle. The headline is `Set your order threshold`, and nothing — CSS class, prop, state key, register value, fixture — carries the word.',
    specRef: '§3.2, §33.11.3',
  },
  {
    element: 'The order threshold collected in dollars, with `(USD)`, `Ex: $1,000` and `Min. $500`',
    absentBecause:
      '`campaign_build.order_threshold` is an integer COUNT of pre-orders — §4.1: "a number of Backers, not a dollar amount" — so the reference collects a different commercial instrument. And §14.4 fixes no minimum at all, so `Min. $500` is an eligibility condition invented in a mockup (§1 rule 6). The field takes a count, and `ORDER_THRESHOLD_IS_A_COUNT` says so beside it.',
    specRef: '§4.1, §14.4, §1 rule 6',
  },
  {
    element: 'Three Backer rewards maximum, and six brand-voice adjectives maximum',
    absentBecause:
      '§14.4 caps neither. A cap is a commercial rule, and a Founder with four rewards would be refused by a number nobody agreed to. The reference’s three-card pager is a LAYOUT; if product wants a cap it is a §6 setting with its own decision.',
    specRef: '§14.4, §1 rule 6',
  },
  {
    element:
      'Both waiting screens auto-advancing after five seconds, with three Creator chips flipping to accepted at 1.5s and 3s on the way',
    absentBecause:
      'Between a submitted campaign and a live one stand §15’s Admin review with its immutable approved snapshot, §14.2’s bilateral Creator decisions inside a 72-hour window, §16’s thirteen-item readiness checklist and §17’s five-step coordinated launch. NONE of them is a wait, and the chips flipping are real people accepting real terms. Both screens stay and become genuine waiting states answering §27.1’s six questions; the timer goes, and the chips render the recorded association states.',
    specRef: '§15, §14.2, §16, §17, §1.4, §30',
  },
  {
    element: 'A second review screen — `Application in review`, reviewing the FOUNDER',
    absentBecause:
      'The reference draws two. §15 approves a CAMPAIGN, not a person: it has review rounds, grouped feedback with a deep link and an owner, and an immutable approved snapshot. A screen saying a person is under review describes a decision this product does not make, and there is no record behind it.',
    specRef: '§15, §1.4',
  },
  {
    element:
      'The live screen’s `Our Team will reach out to you as soon as we get all your affiliates in place`',
    absentBecause:
      '§3.1: `affiliate` is internal and never reaches a Founder. The third site in the bundle, and the one neither earlier walk named. `Creator` is the customer-facing word, and the sentence is re-authored to state what is recorded rather than to promise an outreach nobody scheduled.',
    specRef: '§3.1, §7',
  },
];

/* ── The sentences Session D pins ─────────────────────────────────────────── */

/**
 * Rendered on every one of the five optional answers, and on Last look.
 *
 * §12's completion rules are objective and are decided by the server from the
 * evidence — "Empty files, placeholders, duplicate uploads, inaccessible URLs,
 * unapproved drafts, and unconfirmed appointments do not qualify." There is no
 * control on any of these screens that marks an answer done, and a Founder who
 * expected one needs to be told that rather than left hunting for it.
 */
export const FLOW_COMPLETION_IS_DECIDED =
  'Proovd decides whether an answer counts, from what you actually provide — there is no box to tick. If something is missing we say which part, here, as soon as you save.';

/**
 * Rendered with the edit affordance on Last look.
 *
 * The reference's own behaviour, and the one most likely to be dropped: it is
 * carried in the address rather than in a component's state, so a reload in the
 * middle of an edit still comes back here.
 */
export const FLOW_LAST_LOOK_RETURNS =
  'Opening one from here brings you straight back to this page when you are done.';

/**
 * Rendered under the date of birth.
 *
 * §10 collects a date of birth and lists "US/18+ and sanctions
 * representations" separately, as things the Founder states. The check on this
 * screen is a courtesy over a recorded representation — Proovd derives no age
 * and never claims to have verified one, which is exactly what the Admin
 * Eligibility tab already renders. Saying so stops the field reading as an
 * identity check it is not.
 */
export const FLOW_AGE_IS_YOUR_STATEMENT =
  'We check the date adds up to 18 or over as you type. That is a courtesy, not a verification — what stands on your record is your own confirmation below.';

/* ── The two sentences the shell itself pins ────────────────────── */

/**
 * The invite page's own statement of what the button does.
 *
 * §7's invitation must explain "what will happen before an account or payment
 * is required", and the strongest form of that is a sentence saying the door is
 * a door. It sits with the control rather than in the small print, because
 * somebody who reads only the button needs it more than somebody who reads the
 * whole page.
 */
export const FLOW_NOTHING_COMMITTED =
  'Opening the form creates no account and asks for no card. You can close it at any point and come back to this same link — everything you have written is still here.';

/**
 * Rendered wherever the flow shows what was drafted for the Founder.
 *
 * §9 stores the supplier of the current value, and showing it is what makes
 * "we drafted this, you can change it" honest rather than a surprise.
 */
export const FLOW_PREFILL_NOTE =
  'We wrote this from our conversation. Change anything that is not right — it is your product.';
