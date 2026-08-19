/**
 * The Creator standing record — Creator Flow v2 **deviation 2**, Session A,
 * 2026-08-19.
 *
 * ═══ A RECORDED DEVIATION FROM §1 RULE 6, BY EXPLICIT PRODUCT DIRECTION ═════
 *
 * The reference's Home carries an `Affiliate score` of 742, `Top 8% of
 * affiliates`, a Gold→Platinum tier badged `Founders see this`, `How to climb
 * your score`, a `6-campaign streak`, a track record, and a `Ranked by impact`
 * leaderboard naming other Creators.
 *
 * §30 forbids "Public leaderboards/shaming", "Confetti/streaks/countdown
 * pressure", and "Automatic Affiliate percentile pruning". §8 makes the
 * internal quality tier "used only as assessment data—not as a commission
 * floor." §26 says "The Admin panel is the only dashboard-style product in
 * MVP."
 *
 * This is recorded the way the 2026-08-10 Admin-MFA removal and the
 * `campaign_followers` record are: **so a later session neither deletes it as a
 * mistake nor reads it as licence for its neighbours.**
 *
 * ── The hard constraint: THE TIER BINDS NOTHING ────────────────────────────
 * The reference's "Climb toward Platinum for higher floors and early access" is
 * an eligibility condition in §1 rule 6's own list, and it would collide with
 * something already built. §29.4 makes `restrict bidding` an enforcement
 * action, and the Affiliate Admin workspace already DERIVES `proposal_access`
 * from §29 records rather than storing it (2026-08-17). A standing tier that
 * changed proposal access would be a second, contradictory answer to one
 * question — and the two would disagree the first time an Admin restricted
 * somebody with a high score.
 *
 * So there is no rate, no floor, no percentage, no multiplier, no eligibility
 * flag, and no ordering weight in this file, and the promise is not made. What
 * enforces it beyond this comment is a **source scan** (Session D) asserting
 * that nothing under `affiliates/decisions.ts`, `creator-payment/`,
 * `close/earnings.ts` or `affiliates/readiness.ts` reads the standing tables at
 * all. The tier is something a Creator sees about their own history. It decides
 * nothing.
 *
 * ── Every number is derived from a record that already exists ──────────────
 * Or it is not shown. §16a's rule and 17a's: a rate over a zero denominator is
 * `null`, never `0%`, and an unpopulated block names what it is waiting for
 * rather than standing in a zero.
 *
 * ── The score is a SNAPSHOT, with its inputs stored beside it ──────────────
 * 21b's completion-findings reasoning, applied to the number a Creator will
 * read hardest. A live recomputation on every page load is a number that
 * silently changes its own justification the next time a record moves — and
 * here the person reading it would have no way to know it had. So the score,
 * the percentile, and the tier are written once with the inputs that produced
 * them, and a later recomputation is a NEW row.
 *
 * ── What a later phase must not read this as licence for ───────────────────
 * Not a public leaderboard. Not a score on any Founder or Backer surface. Not a
 * ranking that decides who is recruited, who may bid, or what base applies. Not
 * confetti.
 */

/**
 * The four tiers, lowest first.
 *
 * A closed vocabulary because it is a label rather than a scale — and because
 * a fifth added later must be a visible edit rather than a number drifting past
 * a threshold nobody wrote down.
 */
export const CREATOR_STANDING_TIERS = [
  { id: 'starting', label: 'Starting out', minScore: 0 },
  { id: 'established', label: 'Established', minScore: 400 },
  { id: 'gold', label: 'Gold', minScore: 650 },
  { id: 'platinum', label: 'Platinum', minScore: 850 },
] as const;

export type CreatorStandingTierId = (typeof CREATOR_STANDING_TIERS)[number]['id'];

export const CREATOR_STANDING_TIER_IDS: readonly string[] = CREATOR_STANDING_TIERS.map(
  (t) => t.id,
);

export const CREATOR_STANDING_SCORE_MIN = 0;
export const CREATOR_STANDING_SCORE_MAX = 1000;

/**
 * The tier a score falls in. Pure, total, and the only place the thresholds are
 * read — so the badge, the progress line, and the stored snapshot cannot
 * disagree about where a number sits.
 */
export function creatorStandingTier(score: number): CreatorStandingTierId {
  let current: CreatorStandingTierId = CREATOR_STANDING_TIERS[0].id;
  for (const tier of CREATOR_STANDING_TIERS) {
    if (score >= tier.minScore) current = tier.id;
  }
  return current;
}

/**
 * One input to the score, and the record it is derived from.
 *
 * `derivedFrom` is required and is the whole discipline of this register: an
 * input with no record behind it is an invented number, which is exactly what
 * §1 rule 6 forbids and exactly what a score is the easiest place to hide.
 */
export interface CreatorStandingInput {
  id: string;
  label: string;
  /** The table and column this is counted from. Never a judgement. */
  derivedFrom: string;
  /** What it means, in the words the Creator reads on "how this is worked out". */
  explanation: string;
  specRef: string;
}

/**
 * The four inputs. Each names a table that exists today.
 *
 * Deliberately NOT included, each for its own reason:
 *   * Sales volume or revenue — §22.8's own rule is that completion never reads
 *     sales, and a score that did would reintroduce through the back door the
 *     thing §33.10.6 asserts is absent.
 *   * Response speed to a §14.1 opportunity — §14.2 says declining carries no
 *     penalty (`DECLINE_NO_PENALTY_NOTE`), and a score that fell for a slow or
 *     declined response would make that sentence untrue.
 *   * The §8 internal quality tier — assessment data, and Admin's judgement
 *     rather than a record of what somebody did.
 */
export const CREATOR_STANDING_INPUTS: readonly CreatorStandingInput[] = [
  {
    id: 'campaigns_completed',
    label: 'Campaigns completed',
    derivedFrom: "campaign_affiliate_associations.status = 'successfully_completed'",
    explanation:
      'Partnerships an Admin marked successfully completed, which needs all five §22.8 criteria to hold.',
    specRef: '§22.8',
  },
  {
    id: 'posts_verified',
    label: 'First posts verified',
    derivedFrom: "creator_post_submissions.outcome = 'passed'",
    explanation:
      'Posts that passed the §17 seven-point verification the first time they were reviewed.',
    specRef: '§17',
  },
  {
    id: 'obligations_met',
    label: 'Campaigns with no enforcement action',
    derivedFrom: 'affiliate_enforcement_actions (the absence of a row)',
    explanation:
      'Partnerships that ran to the end with no §29 action recorded against them.',
    specRef: '§29',
  },
  {
    id: 'channels_verified',
    label: 'Channels verified',
    derivedFrom: "affiliate_evidence_verifications.decision = 'verified'",
    explanation:
      'Channels an Admin verified against the §5.3 evidence you supplied.',
    specRef: '§5.3, §8',
  },
];

export const CREATOR_STANDING_INPUT_IDS: readonly string[] = CREATOR_STANDING_INPUTS.map(
  (i) => i.id,
);

/**
 * The track record. Three counts, each from a record.
 *
 * The reference's third is `Hits`, which the reconciliation flagged as needing
 * a definition or going. It goes: "a hit" would have to mean a campaign that
 * did well, which is a sales judgement — the one thing §22.8 keeps out of a
 * Creator's standing. What replaces it is `Verified`, which is a fact about
 * what the Creator did rather than about how the campaign sold.
 */
export const CREATOR_TRACK_RECORD_ITEMS = [
  {
    id: 'launched',
    label: 'Launched',
    derivedFrom: "campaign_affiliate_associations.status = 'successfully_completed'",
    explanation: 'Campaigns you promoted from launch to completion.',
  },
  {
    id: 'verified',
    label: 'Verified',
    derivedFrom: "creator_post_submissions.outcome = 'passed'",
    explanation: 'First posts that passed review.',
  },
  {
    id: 'backed',
    label: 'Backed',
    derivedFrom:
      "reservations: captured, attribution_status = 'verified', pre-tax reward subtotal",
    explanation:
      'The pre-order value people bought through your link, before sales tax. Not what you earned.',
  },
] as const;

export type CreatorTrackRecordItemId = (typeof CREATOR_TRACK_RECORD_ITEMS)[number]['id'];

/* ── The pinned sentences ─────────────────────────────────────────────────── */

/**
 * Pinned. Renders WITH the standing block, not below it.
 *
 * Somebody reading a tier and a percentile will assume it does something unless
 * told otherwise — that is what every tier in every other product they have
 * used does. The sentence that makes it honest has to be where the number is.
 */
export const STANDING_BINDS_NOTHING =
  'Your standing is a record of what you have done. It does not change your rate, decide which campaigns you are invited to, or affect what you can propose — those come from each campaign\'s own terms and from decisions an Admin records.';

/**
 * Pinned. Renders on the leaderboard.
 *
 * §11 draws a Founder→Creator boundary and the Spec has no Creator→Creator
 * twin, so this brief states one and this sentence is where a reader meets it:
 * a Creator sees of another Creator exactly what a Founder sees of them.
 */
export const STANDING_LEADERBOARD_SHOWS_HANDLES_ONLY =
  'Public handles only. Nobody can see another Creator\'s earnings, campaigns, or terms.';

/**
 * Pinned. Renders where a percentile has no cohort to sit in.
 *
 * §16a: not yet populated is not zero. A brand-new Creator is not in the bottom
 * percentile — there is nothing to compare them against yet, and saying so is a
 * different fact from ranking them last.
 */
export const STANDING_NOT_ENOUGH_HISTORY =
  'Not enough history yet. Your standing appears once you have completed a campaign.';

/**
 * Pinned. The "how this is worked out" disclosure.
 *
 * §33.12.6's posture on the measurement scoreboard, applied here: every number
 * carries its own definition, so two people reading the same score cannot mean
 * different things by it.
 */
export const STANDING_HOW_IT_IS_WORKED_OUT =
  'Worked out from four things you have done, each counted from a record you can see on your own campaigns.';

/**
 * The three seeded "How to climb your score" tasks in the reference are
 * invented — the reconciliation names this. Only one of them has a record
 * behind it, so only one survives, and it is a task rather than a nudge: it
 * names something the Creator can do and does not chase them about it.
 */
export const CREATOR_STANDING_TASKS = [
  {
    id: 'verify_second_channel',
    label: 'Verify another channel',
    /** §5.3's evidence register is the record; the ask is real. */
    derivedFrom: 'affiliate_evidence_verifications',
    explanation:
      'Add evidence for a second channel and an Admin will review it. More verified channels means more campaigns you are a fit for.',
    specRef: '§5.3, §8',
  },
] as const;
