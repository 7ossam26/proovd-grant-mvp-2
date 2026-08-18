/**
 * The pre-account vetting sequence — Spec §9.
 *
 * ── The 2026-08-10 deviation was WITHDRAWN on 2026-08-18 (Founder Flow v2) ──
 * On 2026-08-10, by product direction, §9's sequence was simplified: the
 * campaign-path choice moved to Admin, Competition stopped being collected, an
 * amount-of-views answer replaced it, and §10's possible-creator result stopped
 * being a screen. `CLAUDE.md` recorded that as "a recorded deviation from the
 * Spec, not a defect to 'fix' back without the same instruction."
 *
 * **That instruction has now been given.** Four things therefore REVERT, and
 * every one of them is a return to §9 and §10 as written — not a new rule:
 *
 *   1. Competition returns as the third required answer (§9 step 4).
 *   2. The Founder chooses the campaign path again (§9 step 1). Admin's control
 *      stays — it is how a path is set from discovery — and the Founder's screen
 *      arrives pre-selected from it. The Founder's answer supersedes, and both
 *      are recorded with their own supplier.
 *   3. §10's possible-creator result returns as a Founder-facing screen. It
 *      still does NOT gate the account claim: §10 orders it *before* account
 *      creation and says nothing about blocking one, so the 2026-08-10 removal
 *      of the gate stands and is not reversed with the rest.
 *   4. The amount-of-views answer retires **from collection only**. §9 names no
 *      such step. The column, its CHECK, its history rows and every existing
 *      answer survive untouched — see `VIEWS_RANGE_CHOICES` below.
 *
 * A later session reading four undocumented reversals would conclude somebody
 * invented four rules. The opposite happened: a deviation was withdrawn.
 *
 * ── The line §9 draws around this copy ──────────────────────────────────────
 * "Each high-friction field may explain why it is needed: the decision it
 * supports, evidence expected, and what happens next. It must not become legal
 * overcopy." Three short answers per step, then stop. Every line below has been
 * through DNA §5.7's deletion test — if removing it changes nothing the Founder
 * would do differently, it is not here.
 *
 * The order lives here, once, and the surface reads it. A second copy in a
 * component is how a step quietly moves. The copy lives here too, for the same
 * reason the policy register and the §6 settings register do: it is the thing
 * the acceptance suite asserts about, and a sentence that exists in two places
 * is a sentence that will one day disagree with itself.
 */

/**
 * §9's three answered items, in the order they are always presented.
 *
 * The campaign path is its own screen and its own record (`selected_type`), and
 * §10's result is a *result* rather than a question — it has no stored answer
 * and no input. Neither is in this list, which is the list of things the
 * Founder types.
 */
export const VETTING_STEP_IDS = ['problem', 'solution', 'competition'] as const;

export type VettingStepId = (typeof VETTING_STEP_IDS)[number];

/** All three are answered by the Founder. */
export const VETTING_ANSWER_STEP_IDS = VETTING_STEP_IDS;

export type VettingAnswerStepId = VettingStepId;

export interface VettingStepCopy {
  id: VettingStepId;
  /** Short label for the progress overview. */
  label: string;
  /** The one question this step asks (DNA §5.1). */
  title: string;
  /** §9: the decision this answer supports. */
  why: string;
  /** §9: what happens next with it. */
  next: string;
  /** §9: the evidence expected, where a Founder would otherwise guess. */
  expected?: string;
}

export const VETTING_STEPS: readonly VettingStepCopy[] = [
  {
    id: 'problem',
    label: 'Problem',
    title: 'What problem does your product solve?',
    why: 'Creators decide whether a campaign fits their audience by reading this. It is the first thing a reviewer looks at.',
    next: 'It becomes the starting point for your public campaign page, which you write and we review before anything goes live.',
    expected:
      'The situation someone is in before your product exists, in their words rather than in feature names.',
  },
  {
    id: 'solution',
    label: 'Solution',
    title: 'What does your product do about it?',
    why: 'It is how we judge whether what you are offering can realistically be delivered on the timeline you set.',
    next: 'It goes into the same review, and into the brief a Creator reads before deciding.',
    expected: 'What the product actually does — not the vision, the thing that exists or will.',
  },
  {
    id: 'competition',
    label: 'Positioning',
    title: 'Who else is solving this, and why would someone choose you?',
    // §9 requires this field to be the Founder's own thinking. The copy says so
    // plainly rather than implying we have an answer we are withholding.
    why: 'This is the one part of the form we do not draft for you. Your read on the alternatives is the clearest signal we have that you know your market.',
    next: 'It stays internal. It is not published on your campaign page.',
    expected:
      'The real alternatives — including doing nothing, or a spreadsheet — and what someone gets from you instead.',
  },
];

/**
 * The two campaign paths (§9 step 1).
 *
 * §9 requires the Founder to understand what they are committing to: "the step
 * must explain what is being chosen in plain language before it is chosen",
 * because threshold, cardinality, refund source, payment schedule, fixed-payment
 * legality, and public page contents all branch on it.
 *
 * Admin may set it first from discovery, in which case the Founder's screen
 * arrives pre-selected; the Founder's own answer supersedes it. Either way the
 * choice stays freely changeable until submission, which is the moment §9's
 * permanent lock happens.
 *
 * `type` is the internal value (§3: `pre_build` / `pre_launch`); `name` is the
 * only thing that ever renders. The internal words must never reach a Founder.
 */
export interface CampaignPathChoice {
  type: 'pre_build' | 'pre_launch';
  /** The Founder-facing prompt: §9's "I have an idea" / "I have a product". */
  prompt: string;
  /** §3's customer-facing name. */
  name: string;
  summary: string;
  /** What this choice commits the campaign to. Straight from §4.1 / §4.2. */
  commitments: readonly string[];
}

export const CAMPAIGN_PATH_CHOICES: readonly CampaignPathChoice[] = [
  {
    type: 'pre_build',
    prompt: 'I have an idea',
    name: 'Idea Campaign',
    summary:
      'A concept, prototype, mockup, early demo, repository, landing page, or a product that is materially unfinished.',
    commitments: [
      'The page shows an order threshold — a number of Backers, not a dollar amount.',
      'Cards are saved, not charged. They are charged at close only if the threshold is reached. Below it, nothing is charged at all.',
      'Each Backer holds one active pre-order and can change their chosen reward before close.',
      'The Founder is paid once: the whole of their eligible share, three days after the retry window closes, once the W-9 and checks are done.',
      'Promotion has to say the product is early, may be delayed, and in rare cases may not exist.',
    ],
  },
  {
    type: 'pre_launch',
    prompt: 'I have a product',
    name: 'Product Campaign',
    summary:
      'A founding-member pre-sale for a digital product or feature that is live or close to launch.',
    commitments: [
      'There is no charge threshold. Every active pre-order is charged on the disclosed close date.',
      'The Founder keeps what they raise. Falling short of an internal target refunds nobody.',
      'Every reward carries a delivery month and year the Founder commits to.',
      'One Backer can place more than one pre-order.',
      'The Founder is paid in two parts: 40% three days after the retry window, and the remaining 60% once delivery is verified.',
    ],
  },
];

/**
 * The permanence warning, shown at the campaign-path step and again before
 * submission (§9, §33.1.7).
 *
 * §9: "The campaign type locks permanently when vetting is submitted… No
 * campaign-type migration exists. No Creator acceptance, reward, payment, or
 * consent record is copied automatically." There is no softer true version of
 * this, so there is no softer version here.
 *
 * The lock is at SUBMISSION, not at selection. The path screen sets a draft
 * answer that stays editable until the Founder submits — moving the lock
 * earlier would make the flow's own Back button destroy campaigns.
 */
export const CAMPAIGN_TYPE_LOCK_WARNING =
  'This choice is permanent. It locks when you submit this form and cannot be changed afterwards — there is no way to convert one kind of campaign into the other. If it turns out to be the wrong choice, we archive this record and start a fresh one with you: before the listing fee is paid there is no second fee, and nothing agreed, paid, or consented to on the old record carries over to the new one.';

/**
 * §10's constraints on the possible-creator result, as the sentences that must
 * appear beside the number.
 *
 * Every one is a limit on what the number means, and §33.1.6 is "possible-creator
 * result precedes account and cannot promise acceptance". Copy that implies a
 * roster is the failure this list exists to prevent, so the list is not
 * editable, is not summarised, and is rendered in full.
 *
 * §11's Founder boundary is why there is no seventh: nothing here names a
 * Creator, counts them by tier, or describes one, because none of that is a
 * thing a Founder may see about people who have agreed to nothing.
 */
export const POSSIBLE_CREATOR_RESULT_DISCLOSURES: readonly string[] = [
  'This is a relevance signal based on what you just submitted. It is not a roster.',
  'It names no Creator, and no Creator has agreed to anything.',
  'It is not the list of Creators recruited or accepted for your campaign.',
  'It guarantees neither that anyone will take part nor what results they would produce.',
  'Recruitment for your campaign may already be under way.',
  'The listing-fee refund protection still applies if recruitment produces no eligible Creator, or if no Creator and you reach a locked mutual acceptance inside the formal 72-hour window.',
];

/**
 * The amount-of-views answer — **retired from collection on 2026-08-18.**
 *
 * It was the 2026-08-10 replacement for Competition. §9 names no such step, so
 * withdrawing that deviation retires the question: no step, no PATCH key, and
 * no surface asks it.
 *
 * The register stays, and so does everything under it: `campaign_vetting.
 * views_range`, its CHECK, its `draft_field_edits` history, and every answer a
 * Founder already gave. A record is not made wrong by a later product decision,
 * and Admin still has to be able to read what was collected — so
 * `viewsRangeLabel` keeps rendering a stored answer.
 *
 * What must NOT happen is a campaign onboarded after this date rendering as
 * though the question had been asked and left blank. §16a's rule: not yet
 * populated is not zero — and here it is not even a gap, it is a question
 * nobody was asked. `VIEWS_NOT_COLLECTED_LABEL` is what that says.
 */
export interface ViewsRangeChoice {
  id: 'under_10k' | '10k_100k' | '100k_1m' | 'over_1m';
  label: string;
}

export const VIEWS_RANGE_CHOICES: readonly ViewsRangeChoice[] = [
  { id: 'under_10k', label: 'Under 10,000' },
  { id: '10k_100k', label: '10,000 – 100,000' },
  { id: '100k_1m', label: '100,000 – 1,000,000' },
  { id: 'over_1m', label: 'Over 1,000,000' },
];

export type ViewsRangeId = ViewsRangeChoice['id'];

export const VIEWS_RANGE_IDS = VIEWS_RANGE_CHOICES.map((choice) => choice.id) as ViewsRangeId[];

export function viewsRangeLabel(id: string | null): string | null {
  return VIEWS_RANGE_CHOICES.find((choice) => choice.id === id)?.label ?? null;
}

/** What an Admin surface renders where a stored views answer would have been. */
export const VIEWS_NOT_COLLECTED_LABEL =
  'Not collected — this question was retired on 18 August 2026 and was never asked on this campaign.';
