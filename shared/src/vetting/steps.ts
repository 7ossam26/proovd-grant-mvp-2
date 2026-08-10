/**
 * The pre-account vetting sequence — three items, fixed order.
 *
 * ── Recorded deviation from Spec §9 (2026-08-10, product direction) ─────────
 * §9's five-item sequence (campaign path, Problem, Solution, Competition, the
 * possible-creator result) was simplified to three: Problem, Solution, and the
 * amount of views. The campaign-path choice moved to Admin — it is set on the
 * draft from discovery, before the Founder submits, and still locks permanently
 * at submission exactly as §9 requires. Competition is no longer collected
 * (its column and its never-prefill guarantees survive for existing records).
 * The possible-creator result no longer gates the account claim; submitting
 * lands the Founder directly on the invitation claim. This mirrors the shape
 * of the 2026-08-10 Admin-second-factor removal: a recorded product decision,
 * not a defect to "fix" back without the same instruction.
 *
 * The order lives here, once, and the surface reads it. A second copy in a
 * component is how a step quietly moves. The copy lives here too, for the same
 * reason the policy register and the §6 settings register do: it is the thing
 * the acceptance suite asserts about, and a sentence that exists in two places
 * is a sentence that will one day disagree with itself.
 */

/** The three items, in the order they are always presented. */
export const VETTING_STEP_IDS = ['problem', 'solution', 'views'] as const;

export type VettingStepId = (typeof VETTING_STEP_IDS)[number];

/** All three are answered by the Founder; there is no result step any more. */
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
    id: 'views',
    label: 'Amount of views',
    title: 'How many views does your content get?',
    why: 'It tells us the size of the audience your campaign starts from, which shapes which Creators we approach and how we position the campaign.',
    next: 'It goes to the team that recruits Creators for your campaign. It is not published on your campaign page.',
    expected:
      'A typical month across the channels you actually use — your best honest estimate, not your best month ever.',
  },
];

/**
 * The amount-of-views answer, as a fixed set of ranges.
 *
 * A register rather than a free number: the answer feeds a human judgement
 * about Creator fit, and four honest buckets are more comparable — and harder
 * to typo — than an exact figure nobody can verify. The ids are stored; only
 * the labels ever render.
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

/**
 * The two campaign paths, kept for the ADMIN control that now sets the type.
 *
 * §4.1 and §4.2 in plain language. The Founder no longer chooses; Admin does,
 * from discovery, and the choice still locks permanently when the Founder
 * submits their answers. `type` is the internal value (§3: `pre_build` /
 * `pre_launch`); `name` is the only thing that ever renders to a customer.
 */
export interface CampaignPathChoice {
  type: 'pre_build' | 'pre_launch';
  /** The short prompt: "I have an idea" / "I have a product". */
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
    prompt: 'They have an idea',
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
    prompt: 'They have a product',
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
