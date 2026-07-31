/**
 * The §9 pre-account vetting sequence — five items, fixed order.
 *
 * §9: "The draft collects one decision at a time. Visual arrangement follows the
 * DNA UX document, but the sequence and information are fixed." So the order
 * lives here, once, and the surface reads it. A second copy in a component is
 * how a step quietly moves.
 *
 * The copy lives here too, for the same reason the policy register and the §6
 * settings register do: it is the thing the acceptance suite asserts about, and
 * a sentence that exists in two places is a sentence that will one day disagree
 * with itself.
 *
 * ── The line §9 draws around this copy ──────────────────────────────────────
 * "Each high-friction field may explain why it is needed: the decision it
 * supports, evidence expected, and what happens next. It must not become legal
 * overcopy." Three short answers per step, then stop. Every line below has been
 * through DNA §5.7's deletion test — if removing it changes nothing the Founder
 * would do differently, it is not here.
 */

/** §9's five items, in the order they are always presented. */
export const VETTING_STEP_IDS = [
  'campaign_path',
  'problem',
  'solution',
  'competition',
  'possible_creator_result',
] as const;

export type VettingStepId = (typeof VETTING_STEP_IDS)[number];

/**
 * The four the Founder answers. The fifth is a result Proovd shows them, not a
 * question — it has no stored answer and no input, which is why it is separated
 * here rather than being step five of one list.
 */
export const VETTING_ANSWER_STEP_IDS = [
  'campaign_path',
  'problem',
  'solution',
  'competition',
] as const;

export type VettingAnswerStepId = (typeof VETTING_ANSWER_STEP_IDS)[number];

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
    id: 'campaign_path',
    label: 'Campaign path',
    title: 'Which of these is closer to where you are today?',
    why: 'It decides how your campaign works end to end — whether there is an order threshold, how many pre-orders one Backer can place, which refund policy applies, and when you are paid.',
    next: 'It locks when you submit this form, and campaign setup shows it read-only from then on.',
  },
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
    label: 'Competition',
    title: 'Who else is solving this, and why would someone choose you?',
    // §9 requires this field to be the Founder's own thinking. The copy says so
    // plainly rather than implying we have an answer we are withholding.
    why: 'This is the one part of the form we do not draft for you. Your read on the alternatives is the clearest signal we have that you know your market.',
    next: 'It stays internal. It is not published on your campaign page.',
    expected:
      'The real alternatives — including doing nothing, or a spreadsheet — and what someone gets from you instead.',
  },
  {
    id: 'possible_creator_result',
    label: 'Possible creators',
    title: 'Creators who may be relevant',
    why: 'It is an early relevance signal, so you know roughly what recruitment has to work with before you spend any time on setup.',
    next: 'Recruitment is ours to do. You will see the actual roster once Creators have been approached and have decided.',
  },
];

/**
 * §4.1 and §4.2, in plain language, shown at step 1 before the choice is made.
 *
 * §9 requires the Founder to understand what they are committing to: "the step
 * must explain what is being chosen in plain language before it is chosen",
 * because threshold, cardinality, refund source, payment schedule, fixed-payment
 * legality, and public page contents all branch on it.
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
  /** What this choice commits them to. Straight from §4.1 / §4.2. */
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
      'Your page shows an order threshold — a number of Backers, not a dollar amount.',
      'Cards are saved, not charged. They are charged at close only if the threshold is reached. Below it, nothing is charged at all.',
      'Each Backer holds one active pre-order and can change their chosen reward before close.',
      'You are paid once: the whole of your eligible share, three days after the retry window closes, once your W-9 and our checks are done.',
      'Your promotion has to say the product is early, may be delayed, and in rare cases may not exist.',
    ],
  },
  {
    type: 'pre_launch',
    prompt: 'I have a product',
    name: 'Product Campaign',
    summary:
      'A founding-member pre-sale for a digital product or feature that is live or close to launch.',
    commitments: [
      'There is no charge threshold. Every active pre-order is charged on the close date you disclose.',
      'You keep what you raise. Falling short of an internal target refunds nobody.',
      'Every reward carries a delivery month and year that you commit to.',
      'One Backer can place more than one pre-order.',
      'You are paid in two parts: 40% three days after the retry window, and the remaining 60% once we have verified you actually delivered.',
    ],
  },
];

/**
 * The permanence warning, shown at step 1 and again on the review before
 * submission (§9, §33.1.7).
 *
 * §9: "The campaign type locks permanently when vetting is submitted… No
 * campaign-type migration exists. No Creator acceptance, reward, payment, or
 * consent record is copied automatically." There is no softer true version of
 * this, so there is no softer version here.
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
 */
export const POSSIBLE_CREATOR_RESULT_DISCLOSURES: readonly string[] = [
  'This is a relevance signal based on what you just submitted. It is not a roster.',
  'It names no Creator, and no Creator has agreed to anything.',
  'It is not the list of Creators recruited or accepted for your campaign.',
  'It guarantees neither that anyone will take part nor what results they would produce.',
  'Recruitment for your campaign may already be under way.',
  'The listing-fee refund protection still applies if recruitment produces no eligible Creator, or if no Creator and you reach a locked mutual acceptance inside the formal 72-hour window.',
];
