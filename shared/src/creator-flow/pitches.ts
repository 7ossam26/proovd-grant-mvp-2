/**
 * Pitches and the Active list — Creator Flow v2, Session E, 2026-08-20.
 *
 * The Creator's two modes over one address: the campaigns they have accepted,
 * and the invitations that are still open. §14.1's opportunity and §14.2's
 * three decisions sit behind the second one.
 *
 * ── This session adds no decision service, and that is the point ───────────
 * `readFormalOpportunity`, `acceptStandardTerms`, `declineOpportunity`,
 * `submitProposal` and `respondToProposal` are §33.2.6–§33.2.13's, and the
 * strongest statement that this session did not disturb them is those tests
 * passing unchanged. What Session E adds is a LIST read and a CONTENT read
 * beside the opportunity — never a second way to accept, decline, or propose.
 *
 * ── The five-step reveal has a real keyboard path ──────────────────────────
 * The reference advances by tapping anywhere on the screen. §28.5 names
 * "Affiliate decisions" among the five flows that must be completely operable
 * from a keyboard, and a tap-anywhere walkthrough is not one. So each step
 * advances with a real control, and — the load-bearing half — the recap is
 * reachable WITHOUT walking the steps at all. A commercial decision must never
 * be behind a gesture.
 *
 * ── It is a list of invitations, not a marketplace ─────────────────────────
 * §5.3 admits a Creator only through a private invitation to a specific
 * campaign, and §30 defers a public pool. The reference's `browse` framing,
 * its `Trending in your niche`, its predicted earnings, and its commission and
 * price sort keys are all refused in `CREATOR_FLOW_ABSENCES`. What survives is
 * the horizontal presentation and two sorts over stored columns.
 */

/* ── The two modes ────────────────────────────────────────────────────────── */

export interface PitchTab {
  id: 'active' | 'pitches';
  label: string;
  /** What the tab's count counts, in a sentence, for the empty state. */
  emptyLine: string;
}

/**
 * `Active` first, the reference's own order.
 *
 * A Creator arriving from an email about their live campaign meets it before a
 * list of things to decide — and §20's ranking rule says the same thing from
 * the other side: what is already running outranks what is merely offered.
 */
export const PITCH_TABS: readonly PitchTab[] = [
  {
    id: 'active',
    label: 'Active',
    emptyLine:
      'Accept a pitch and the campaign, your link, and your terms appear here.',
  },
  {
    id: 'pitches',
    label: 'Pitches',
    emptyLine:
      'Proovd recruits Creators for one campaign at a time, and we email you when there is one for you.',
  },
];

export const PITCH_TAB_IDS: readonly string[] = PITCH_TABS.map((t) => t.id);

/**
 * Pinned. Sits above the Pitches list.
 *
 * Somebody who has used an affiliate network will read a list of campaigns as
 * a catalogue and go looking for the rest of it. There is no rest of it, and
 * saying so is cheaper than letting them conclude the page is broken.
 */
/*
 * The word `browse` is NOT in this sentence, and that is deliberate. A scan of
 * rendered text cannot tell a promise not to show something from the thing
 * itself — and neither can a reader skimming it. campaign-page-v2's own
 * `placeholder_policy` finding, one rebuild later: the copy changed rather than
 * the scan.
 */
export const PITCHES_ARE_YOUR_OWN_INVITATIONS =
  'These are the campaigns Proovd invited you to. There is no wider list to look through — we recruit Creators one campaign at a time, and every pitch here was matched to you by a person.';

/**
 * Pinned. Sits on the Active list where the reference puts an earned figure.
 *
 * §33.8.13: one source, many renderers. Two surfaces already render an amount
 * from `resolveAffiliateMoneyStatus` — the work surface and Earnings — and a
 * third rendering on a list row is a third chance for them to disagree while
 * adding nothing a Creator cannot reach in one tap.
 */
export const ACTIVE_LIST_MONEY_LIVES_ON_EARNINGS =
  'Every campaign’s money is on your Earnings page, worked out from one record.';

/* ── The reveal ───────────────────────────────────────────────────────────── */

export interface PitchRevealStep {
  id: string;
  /** The small label above the step's content. */
  eyebrow: string;
  /**
   * The step named the way a control refers to it, mid-sentence.
   *
   * Separate from `eyebrow` because a nav label built by concatenating a
   * capitalised eyebrow reads as a defect — `Continue to The problem`, and
   * worse, `Continue to You earn`. §33.11.4 wants the destination named; it
   * does not want it named badly.
   */
  navName: string;
  /** The reference's own forward hint, on the control rather than the screen. */
  hint: string;
  /** A dotted path into `{ opportunity, content }` that this step renders. */
  field: string;
}

/**
 * Four steps, then the recap.
 *
 * The reference draws five progress segments and calls the last one the full
 * card; that is four steps and a destination, and modelling it as five steps
 * would make the recap something a person has to walk to rather than somewhere
 * they can go.
 *
 * `field` is what the suite resolves against a real payload — the
 * `CREATOR_WORK_ITEMS` arrangement, for the same reason: a step whose content
 * quietly stopped being served would otherwise render an empty screen with a
 * working Continue button on it.
 */
export const PITCH_REVEAL_STEPS: readonly PitchRevealStep[] = [
  {
    id: 'product',
    eyebrow: 'The campaign',
    navName: 'the campaign',
    hint: 'Start',
    field: 'content.positioning.productName',
  },
  {
    id: 'problem',
    eyebrow: 'The problem',
    navName: 'the problem',
    hint: 'Keep going',
    field: 'content.positioning.problem',
  },
  {
    id: 'solution',
    eyebrow: 'What it does',
    navName: 'what it does',
    hint: 'Almost there',
    field: 'content.positioning.solution',
  },
  {
    id: 'earn',
    eyebrow: 'You earn',
    navName: 'what you earn',
    hint: 'See it all',
    field: 'opportunity.compensation.basePercent',
  },
];

export const PITCH_REVEAL_STEP_IDS: readonly string[] = PITCH_REVEAL_STEPS.map((s) => s.id);

/** The control that leaves the walk, and the destination it names. */
export const PITCH_SKIP_LABEL = 'Read the whole pitch';

/**
 * Pinned. Renders beside the skip control, from the first step.
 *
 * §14.2 forbids hiding any of the three outcomes. A walk that has to be
 * completed before the decisions appear would hide all three behind four
 * gestures, which is worse than hiding one behind a menu.
 */
export const PITCH_WALK_IS_OPTIONAL =
  'You can read the whole pitch at once instead. Nothing is behind this walkthrough — the decisions and every detail are on one page.';

/* ── The sorts ────────────────────────────────────────────────────────────── */

export interface PitchSort {
  id: string;
  label: string;
  /** The stored column it orders by. There is no sort with no column. */
  column: string;
}

/**
 * Two sorts, both over a stored instant.
 *
 * The reference offers four: `Match fit`, `Commission`, `Newest`, `Price`.
 * `Match fit` has no score behind it — §14.1's `Why this fits your audience` is
 * two Admin-written sentences and not a number — so ordering by it would be
 * inventing a rank (§1 rule 6). `Commission` and `Price` are marketplace sort
 * keys: they invite a Creator to compare one Founder's terms against another's
 * on a list, which is the framing §5.3's private invitation does not have.
 *
 * What is left is real: the §14.5 response deadline (stored, immutable, and the
 * thing that actually decides which pitch to open first), and when the
 * invitation arrived.
 */
export const PITCH_SORTS: readonly PitchSort[] = [
  {
    id: 'deadline',
    label: 'Closing soonest',
    column: 'listing_fee_payments.response_deadline_at',
  },
  { id: 'newest', label: 'Newest', column: 'campaign_affiliate_associations.created_at' },
];

export const PITCH_SORT_IDS: readonly string[] = PITCH_SORTS.map((s) => s.id);
export const DEFAULT_PITCH_SORT = 'deadline';

/* ── The recap: §14.1's own list ──────────────────────────────────────────── */

export interface PitchRecapSection {
  id: string;
  /** §14.1's own words, so the register can be read against the Spec. */
  item: string;
  /**
   * Where the content comes from.
   *
   * `payload` — a dotted path into `{ opportunity, content }`, resolved by the
   * suite against a real read. `register` — a constant exported from this
   * module and rendered by the surface, so there is one copy of the words and
   * the backend has nothing to restate. `absent` — nothing holds it, and the
   * reason is what renders.
   */
  source: 'payload' | 'register' | 'absent';
  field?: string;
  register?: string;
  absentBecause?: string;
  specRef: string;
}

/**
 * §14.1's opportunity and Campaign kit, item by item.
 *
 * The reconciliation recorded these as *"All §14.1 kit fields that
 * `readFormalOpportunity` already returns"*, and the Session E walk found that
 * wrong: that read returns the decision facts — the §14.3 cell, high effort,
 * the versions, the agreement, the link — and none of the Founder's material.
 * Session D found three register entries wrong the first time anything read
 * them; this is the same finding one session later, and the answer is the same:
 * correct the register, and make a test resolve every entry so it cannot go
 * stale again.
 */
export const PITCH_RECAP_SECTIONS: readonly PitchRecapSection[] = [
  {
    id: 'why_this_fits',
    item: '`Why this fits your audience`: two Admin-written sentences.',
    source: 'payload',
    field: 'opportunity.whyThisFitsYourAudience',
    specRef: '§14.1',
  },
  {
    id: 'brief',
    item: 'A 60-second brief: audience, product promise, campaign type, required promotion, compensation, key date, and main delivery/claim risk.',
    source: 'payload',
    field: 'content.brief',
    specRef: '§14.1',
  },
  {
    id: 'founder',
    item: 'Founder name, entity/sole-proprietor status, profile, prior Proovd history, and connected-account readiness indicator.',
    source: 'payload',
    field: 'content.founder',
    specRef: '§14.1',
  },
  {
    id: 'positioning',
    item: 'Product category, Problem, Solution, Competition/positioning.',
    source: 'payload',
    field: 'content.positioning',
    specRef: '§14.1',
  },
  {
    id: 'charge_rule',
    item: 'Campaign type and charge rule.',
    source: 'payload',
    field: 'content.chargeRule',
    specRef: '§14.1',
  },
  {
    id: 'materials',
    item: 'Available visuals, branding, story, socials, and interview material.',
    source: 'payload',
    field: 'content.materials',
    specRef: '§14.1',
  },
  {
    id: 'high_effort',
    item: 'High-effort status and its objective basis.',
    source: 'payload',
    field: 'opportunity.highEffort',
    specRef: '§14.1, §12',
  },
  {
    id: 'rewards',
    item: 'Reward packages, prices, contents, delivery dates, fulfillment promises, and quantities.',
    source: 'payload',
    field: 'content.rewards',
    specRef: '§14.1',
  },
  {
    id: 'threshold',
    item: 'Idea threshold or Product internal target, correctly labeled.',
    source: 'payload',
    field: 'content.threshold',
    specRef: '§14.1, §3.2',
  },
  {
    id: 'dates',
    item: 'Campaign open/close dates and duration.',
    source: 'payload',
    field: 'content.dates',
    specRef: '§14.1',
  },
  {
    id: 'brand_notes',
    item: 'Brand voice/perception notes.',
    source: 'payload',
    field: 'content.brandNotes',
    specRef: '§14.1',
  },
  {
    id: 'claims',
    item: 'Permitted claims, prohibited claims, and unconfirmed-claim warnings.',
    source: 'payload',
    field: 'content.claims',
    specRef: '§14.1',
  },
  {
    id: 'refund_policy',
    item: 'Founder refund policy for a Product Campaign.',
    source: 'payload',
    field: 'content.refundPolicy',
    specRef: '§14.1, §24.10',
  },
  {
    id: 'deliverables',
    item: 'Required posts/deliverables and availability periods.',
    source: 'payload',
    field: 'content.deliverables',
    specRef: '§14.1, §20',
  },
  {
    id: 'compensation',
    item: 'Base percentage, performance bonus, bid eligibility, and fixed-payment availability.',
    source: 'payload',
    field: 'opportunity.compensation',
    specRef: '§14.1, §14.3',
  },
  {
    id: 'demo_request',
    item: 'Product demo/sample/Zoom request route if manually supported.',
    source: 'absent',
    absentBecause:
      '§14.1 makes this conditional on the route being manually supported, and none is. §30 defers the Founder–Creator meeting scheduler and direct messaging in both directions, and no record holds a demo or sample request — so there is nothing to route to and nothing to record if there were.',
    specRef: '§14.1, §30',
  },
  {
    id: 'campaign_state',
    item: 'Campaign state: preparing, formal decision open, live, or ended.',
    source: 'payload',
    field: 'opportunity.campaignStateLabel',
    specRef: '§14.1, §14.5',
  },
  {
    id: 'live_invite',
    item: 'For a live-campaign invite: exact remaining time, adjusted deliverables, and eventual activation rule.',
    source: 'payload',
    field: 'content.midCampaign',
    specRef: '§14.1, §20',
  },
  {
    id: 'rules',
    item: 'FTC rules, promotion channels, spam/minor/self-pre-order/fraud rules.',
    source: 'register',
    register: 'PITCH_PROMOTION_RULES',
    specRef: '§14.1, §29',
  },
  {
    id: 'proof',
    item: 'First-post and deliverable-proof instructions.',
    source: 'register',
    register: 'PITCH_PROOF_INSTRUCTIONS',
    specRef: '§14.1, §17',
  },
  {
    id: 'ip_summary',
    item: 'Plain-language IP/confidentiality summary.',
    source: 'register',
    register: 'PITCH_IP_SUMMARY',
    specRef: '§14.1, §31.5',
  },
  {
    id: 'money_explanation',
    item: 'Compensation finalization, adjustment, Transfer/payout, and support explanation.',
    source: 'register',
    register: 'PITCH_MONEY_EXPLANATION',
    specRef: '§14.1, §22.1, §24.4',
  },
];

export const PITCH_RECAP_SECTION_IDS: readonly string[] = PITCH_RECAP_SECTIONS.map((s) => s.id);

/* ── The four constant sections ───────────────────────────────────────────── */

/**
 * §14.1's rules bullet, in the words a Creator reads.
 *
 * Each line states a rule that already has a record behind it: the FTC
 * disclosure is on the tracking link and its absence is a §17 correction;
 * §29.1 makes a self-pre-order a disclosure with two certifications; §29.2 a
 * conflict; §29.3 the promotion channels. Nothing here is a new rule — it is
 * the existing ones, said once, before somebody accepts them.
 */
export const PITCH_PROMOTION_RULES: readonly string[] = [
  'Every post about this campaign carries the disclosure on your tracking link. A post without it is a correction, and your link pauses until it is fixed.',
  'Promote it where you told us you would. A channel nobody agreed to is not covered by the terms you are accepting here.',
  'No spam, no bought traffic, and nothing aimed at people under 18.',
  'If you pre-order on your own campaign, tell us first — it is allowed under conditions, and it earns you no commission.',
  'If you have a family, employment, or financial connection to this Founder, disclose it before you start.',
];

/** §17's steps 4 and 5, and §20's proof, from the Creator's side. */
export const PITCH_PROOF_INSTRUCTIONS: readonly string[] = [
  'Publish your first post once the campaign is live and your link is active, then submit its URL. A person at Proovd checks it against seven things and answers pass, correction needed, or rejected.',
  'Verification releases no money on its own. It decides whether traffic through your link can be counted later.',
  'Keep your posts up for the period you agreed. Taking them down early is something Proovd has to act on.',
];

/**
 * §31.5, said to the person it binds.
 *
 * Deliberately its own constant rather than the preparing kit's
 * `CONFIDENTIALITY_TERMS`: the two say the same thing about the material and
 * differ in the sentence that matters here, because the pitch is the surface
 * where accepting the per-campaign IP agreement is one of the four
 * confirmations and the kit is a surface where nothing can be accepted at all
 * (§10). The kit's copy would be wrong here and this one would be wrong there.
 */
export const PITCH_IP_SUMMARY =
  'What you can read here is confidential. It is the Founder’s unreleased product information, shared with you early and in confidence because Proovd recruited you for this campaign. Please do not share it, post about it, or use it for anything else. Every time you open it we record that you did, and we can withdraw access at any time. Accepting this opportunity includes the Creator-only IP and confidentiality agreement for this campaign.';

/** §22.1, §24.4 and §22.3, in the order money actually moves. */
export const PITCH_MONEY_EXPLANATION: readonly string[] = [
  'Nothing is earned while the campaign runs. Your percentage applies to charges that are captured after it closes and validly attributed to your link.',
  'After close, Proovd works out the final figure, an Admin approves it, and one Transfer per campaign is created on or after the third day.',
  'A refunded or disputed charge can change the figure. Where that happens it is recorded as a case with a reason, never adjusted silently.',
  'Your payouts are handled by Stripe under the account you connected. Proovd never holds your money and there is nothing to withdraw here.',
];

/* ── Refusals this surface renders where a control would be ───────────────── */

/**
 * Pinned. Where the reference puts `predicted: '$450 to $1,200'`.
 *
 * §22.2: *"Never guaranteed, estimated, or calculated by the product."* The
 * honest replacement is the §14.3 cell, which is a real term the Creator is
 * being offered rather than a number about a campaign that has not run.
 */
export const PITCH_NO_PREDICTED_EARNINGS =
  'We do not estimate what you would make. What is fixed is the percentage below; what it comes to depends on the campaign, and nobody knows that yet.';

/**
 * Pinned. Where the reference puts `Countering for 30 to 35% is fair here`.
 *
 * §14.2 lets Admin mediate and forbids Admin substituting for either party's
 * acceptance. Advising a Creator what to counter with takes a side in a
 * negotiation Proovd is the mediator of.
 */
export const PITCH_NO_COUNTER_ADVICE =
  'Proovd does not advise you on what to propose. We mediate this negotiation, so taking a side in it is not ours to do.';

/**
 * §14.2's promise, said BEFORE a decision rather than after one.
 *
 * `DECLINE_NO_PENALTY_NOTE` is the confirmation — it opens *"Your decline was
 * recorded"* — and rendering it beside an open decision tells somebody a
 * decline happened that did not (§1.4). The promise itself is what belongs on
 * the list and on the decline panel; the confirmation stays where a decline was
 * actually recorded.
 */
export const DECLINING_COSTS_YOU_NOTHING =
  'Declining does not harm your standing with Proovd in any way, and there is no penalty for taking the time to decide.';

/**
 * This surface's OWN vocabulary refusals, word-bounded and scanned across the
 * rendered list, the rendered recap, and the payload.
 *
 * §3.1's and §3.2's terms are deliberately NOT repeated here.
 * `UNIVERSALLY_BANNED_TERMS` and `CUSTOMER_ONLY_BANNED_TERMS` are the canonical
 * registers and `namingViolations` is their scanner; a second copy would be a
 * second answer to what §3 bans, and — because this file ships in the browser
 * bundle §33.11.3 reads — a copy naming them would put the banned words into
 * the bundle to say they are banned. The suites run both scanners.
 *
 * What is left is the marketplace framing the reference brings and §3 has no
 * opinion about: a catalogue to look through, a popularity signal, a predicted
 * amount, and a per-Creator rate floor that does not exist.
 */
export const PITCH_BANNED_TERMS: readonly string[] = [
  'browse',
  'marketplace',
  'trending',
  'predicted',
  'guaranteed',
  'floor',
];
