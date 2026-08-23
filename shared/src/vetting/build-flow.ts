/**
 * Openness, the build steps, and the two waiting states — Session F, 2026-08-19.
 *
 * Screens 18, 21–24, 19 and 26: what a Founder answers about the optional fixed
 * Creator payment, the four build steps, and the two states between a submitted
 * campaign and a live one.
 *
 * ── Why the stances are a register and not three strings ────────────────────
 * §16 makes the optional fixed Creator payment the CREATOR's request, accepted
 * bilaterally through one §14.2 proposal version. A Founder answering during
 * onboarding — before the listing fee, before any Creator exists — is not in
 * that negotiation, so what they state is an OPENNESS and nothing else. The
 * register carries three answers and no fourth, and it carries no amount, no
 * percentage and no proposal reference, because the moment one of those exists
 * the answer has become the offer only a Creator may make (§1 rule 6).
 *
 * ── The percentages are read, never written here ────────────────────────────
 * §14.3's 30% and 20% are §6 settings (`affiliate_base_percent_standard`,
 * `affiliate_base_percent_with_fixed`). Phase 06's rule: a hardcoded number is a
 * bug even when it is right. There is no number in this file.
 *
 * ── Nothing here advances on a clock ────────────────────────────────────────
 * The reference auto-advances screens 19 and 26 after five seconds and flips
 * three Creator chips to accepted on the way. Between a submitted campaign and a
 * live one stand §15's Admin review, §14.2's bilateral decisions inside a
 * 72-hour window, §16's thirteen-item readiness checklist and §17's five-step
 * launch. None of them is a wait, and the chips flipping are real people
 * accepting real terms (§1.4, §30).
 */

/* ── Screen 18 — the fixed-payment openness (deviation 3) ─────────────────── */

export type FixedPaymentStance = 'open' | 'not_open' | 'undecided';

export interface FixedPaymentStanceChoice {
  value: FixedPaymentStance;
  /** What the Founder reads on the control. */
  label: string;
  /** What choosing it does, and — as importantly — what it does not do. */
  meaning: string;
}

/**
 * Three answers and no fourth.
 *
 * `undecided` is a recorded "I do not know yet", which is a different fact from
 * never having been asked (§1.4) — and it is what lets the screen offer a way
 * past without inventing a default. A skipped screen and a recorded shrug are
 * not the same thing, and only one of them tells an Admin anything.
 */
export const FIXED_PAYMENT_STANCES: readonly FixedPaymentStanceChoice[] = [
  {
    value: 'open',
    label: 'Yes — I would consider it',
    meaning:
      'A Creator may raise it, and we will bring you the terms they propose. Nothing is agreed until you and they accept the same version.',
  },
  {
    value: 'not_open',
    label: 'No — percentage only',
    meaning:
      'Creators are paid a share of what your campaign collects and nothing before it. A Creator can still ask, and you can still say no.',
  },
  {
    value: 'undecided',
    label: 'I do not know yet',
    meaning:
      'We record that you have not decided, and nobody is told anything else. You can answer later, and it changes nothing you have already done.',
  },
];

/**
 * Pinned, and it rides the control rather than sitting under it.
 *
 * §14.2 makes every set of terms a bilateral acceptance of one immutable
 * version. An answer given here binds nobody — and a screen that collected it
 * without saying so would read as the offer, which is the one thing §16 says a
 * Founder does not make.
 */
export const FIXED_PAYMENT_BINDS_NOBODY =
  'This is not an offer and it commits you to nothing. Creators propose their own terms, and a set of terms only takes effect when you and the Creator have both accepted the same version.';

/**
 * The §1.3 manual-but-recorded path, which the reference's own copy concedes:
 * "A proovd representative will get in touch with you to lock down the […]".
 *
 * No amount is collected here and none could be — the record has no column for
 * one, by design.
 */
export const FIXED_PAYMENT_TERMS_COME_LATER =
  'No amount is set here. If a Creator asks and you are interested, someone at Proovd works the terms through with both of you before anything is agreed.';

/**
 * §14.3 prohibits the fixed Creator payment on an Idea Campaign, so an Idea
 * Founder gets an explanation and no control at all — the absence is the rule.
 */
export const FIXED_PAYMENT_IDEA_EXPLAINER =
  'On an Idea Campaign there is no fixed Creator payment to be open to. Creators are paid a share of what your campaign collects, and nothing before it — so there is nothing to decide on this screen.';

/** The two §6 keys the screen renders, named so nothing is retyped. */
export const FIXED_PAYMENT_PERCENT_SETTINGS = {
  standard: 'affiliate_base_percent_standard',
  withFixed: 'affiliate_base_percent_with_fixed',
} as const;

/* ── Steps 23–26 — the authored launch-preparation steps ─────────────────── */

export interface BuildFlowStep {
  /** The flow page id, and the register key. */
  id: 'voice' | 'threshold' | 'faqs' | 'rewards';
  /** Which campaign models reach it. §14.4's threshold is Idea-only. */
  models: readonly ('idea' | 'product')[];
  /** The §14.4 ingredient it writes. */
  writes: string;
}

/**
 * The four the reference draws, and the ONE rule that keeps two build surfaces
 * honest: both this sequence and `/campaigns/:campaignId/build` call the same
 * `fetchBuild` / `saveBuild` / `saveFaq` / `saveRewardPackage`, and both read
 * `REQUIRED_SHARED_BUILD_FIELDS` and its two type registers. A field added to
 * one and not the other is exactly the drift that makes two surfaces a mistake
 * rather than a choice.
 */
export const BUILD_FLOW_STEPS: readonly BuildFlowStep[] = [
  { id: 'voice', models: ['idea', 'product'], writes: 'campaign_build.brand_voice' },
  {
    id: 'threshold',
    models: ['idea', 'product'],
    writes: 'campaign_build.order_threshold | campaign_build.internal_target_cents',
  },
  { id: 'faqs', models: ['idea', 'product'], writes: 'campaign_faqs' },
  { id: 'rewards', models: ['idea', 'product'], writes: 'campaign_reward_packages' },
];

/** Which of the four this campaign walks. */
export function buildFlowStepsFor(model: 'idea' | 'product'): readonly BuildFlowStep[] {
  return BUILD_FLOW_STEPS.filter((step) => step.models.includes(model));
}

/**
 * Pinned, and rendered at the end of step 24.
 *
 * Ten shared fields are required plus four for Idea or one for Product, and
 * these four steps cover three of them. Telling somebody their campaign is
 * built while `deriveBuildStatus` says `in_progress` is §1.4's failure with a
 * celebration on it.
 */
export const BUILD_STEPS_ARE_NOT_THE_WHOLE_BUILD =
  'These are the parts of your page it helps to write in one sitting. Your campaign has more to fill in before it can go for review, and the control below opens the page that lists exactly what is left.';

/**
 * §14.4's threshold is a COUNT of pre-orders, not an amount.
 *
 * §4.1: "a number of Backers, not a dollar amount". The reference collects it
 * with a `(USD)` label and a `Min. $500`, which is a different commercial
 * instrument with an invented floor. §14.4 fixes no minimum at all.
 */
export const ORDER_THRESHOLD_IS_A_COUNT =
  'This is a number of pre-orders, not an amount of money. If your campaign reaches it, the cards are charged; if it does not, nobody is charged at all.';

/* ── Launch-preparation lifecycle states ──────────────────────────────────── */

/**
 * Pinned, and asserted by a source scan rather than trusted.
 *
 * The reference advances both screens after five seconds. What actually stands
 * between a submitted campaign and a live one is §15's Admin review with its
 * immutable approved snapshot, §14.2's bilateral Creator decisions inside a
 * 72-hour window, §16's thirteen-item readiness checklist, and §17's five-step
 * coordinated launch. A timer would announce an outcome none of them has
 * reached.
 */
export const NOTHING_HERE_IS_A_TIMER =
  'This screen changes when something actually happens, not after a countdown. You do not need to keep it open — we email you.';

/**
 * The roster chips on the waiting screen render RECORDED states.
 *
 * §14.5's own vocabulary, projected: a Founder sees whether a Creator has
 * accepted, and never the eighteen internal transitions behind it (§11, §3.1).
 * A Creator nobody has heard from renders as waiting, with the reason, rather
 * than animating into an acceptance that has not happened (§1.4, §30).
 */
export const ROSTER_CHIPS_ARE_RECORDED =
  'These are the Creators on your campaign and where each one actually stands. Nothing here moves on its own.';

/** §17: a campaign is live because a launch record exists, and for no other reason. */
export const LIVE_MEANS_A_LAUNCH_RECORD =
  'Your campaign page is public and your Creators’ links are live.';

/* ── Screen 21 — the brand voice, rebuilt 1:1 from the reference, 2026-08-21 ──
 *
 * The reference's `[data-voice]`: a sentence a Founder edits by tapping the
 * adjectives inside it — `Teeb is [Luxurious ▾] and [Youthful ▾]` — with a
 * replacement sheet behind each chip and an "add more" sheet behind `+ add
 * more`. What it collects is a description of how the campaign should sound,
 * and §14.4 has exactly one field for that: `campaign_build.brand_voice`.
 *
 * ── The chips are a way into ONE field, not a second record ─────────────────
 * A repeater beside `brand_voice` would make §14.4's field and the Founder's
 * chips two answers to one question, and the one nobody updated is the one that
 * ships. So the words compose the text, the text is what is stored, and
 * `parseBrandVoice` reads them back out of it — which is what lets the same
 * record be edited from `/campaigns/:campaignId/build`, whose textarea is the
 * other surface over this column.
 *
 * ── No cap, and that is a refusal the register already carries ──────────────
 * The reference stops at six adjectives (`.slice(0, 6)`). §14.4 caps nothing,
 * and a Founder with a seventh word would be refused by a number nobody agreed
 * to (§1 rule 6). `FOUNDER_FLOW_ABSENCES` records it by name.
 */

/**
 * The reference's `VOICE_SHORT` — the six offered when REPLACING a word.
 *
 * Its own list, kept in its own order. The replacement sheet is a narrower
 * question than "what else is true of you", which is why the reference gives it
 * six rather than twelve, and reproducing that is reproducing the question.
 */
export const BRAND_VOICE_WORDS_SHORT = [
  'Fun',
  'Regal',
  'Professional',
  'Affordable',
  'Confident',
  'Friendly',
] as const;

/**
 * The reference's `VOICE_ALL` — the twelve offered when ADDING words.
 *
 * `Trustworthy` stays. §3.2's ban is on `trust` as in *held in trust*, the
 * scanner is word-bounded, and a brand adjective is not a custody claim. It is
 * recorded here so a later session does not "fix" it.
 */
export const BRAND_VOICE_WORDS_ALL = [
  'Fun',
  'Regal',
  'Professional',
  'Affordable',
  'Trustworthy',
  'Quirky',
  'Visionary',
  'Provocative',
  'Human',
  'Caring',
  'Confident',
  'Friendly',
] as const;

/** The two chip fills, alternating by position. The reference's own pair. */
export const BRAND_VOICE_CHIP_FILLS = ['#F4FFA0', '#DFFAFC'] as const;

export interface BrandVoiceValue {
  /** The adjectives, in the order they are read. */
  words: readonly string[];
  /** The reference's "Tell us more" paragraph, or ''. */
  more: string;
}

/**
 * How many words a comma-part may carry before it stops being an adjective.
 *
 * The chips are one record with `/campaigns/:campaignId/build`, whose control
 * is a textarea — so a Founder may legitimately write prose into this column
 * and come back here. Splitting `A brand for people who commute, mostly` into
 * two chips would present their sentence as two adjectives. So a first
 * paragraph only becomes chips when every part reads like one; anything else is
 * carried whole as `more`, and the sentence survives verbatim.
 */
const ADJECTIVE_MAX_WORDS = 2;
const ADJECTIVE_MAX_CHARS = 24;

function readsLikeAnAdjective(part: string): boolean {
  const t = part.trim();
  if (!t || t.length > ADJECTIVE_MAX_CHARS) return false;
  return t.split(/\s+/).length <= ADJECTIVE_MAX_WORDS;
}

/**
 * `brand_voice` → the chips and the paragraph. The inverse of `composeBrandVoice`.
 *
 * Round-trippable by construction: compose writes the words as one comma-joined
 * first paragraph and the paragraph after a blank line, and this reads exactly
 * that back. Anything it cannot read as chips it returns as `more` rather than
 * discarding — losing a Founder's own sentence to a parser is worse than
 * rendering no chips.
 */
export function parseBrandVoice(stored: string | null | undefined): BrandVoiceValue {
  const text = (stored ?? '').trim();
  if (!text) return { words: [], more: '' };

  const split = text.split(/\n\s*\n/);
  const head = (split[0] ?? '').trim();
  const tail = split.slice(1).join('\n\n').trim();

  const parts = head
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length && parts.every(readsLikeAnAdjective)) {
    return { words: parts, more: tail };
  }
  return { words: [], more: text };
}

/** The chips and the paragraph → `brand_voice`. */
export function composeBrandVoice(value: BrandVoiceValue): string {
  const words = value.words.map((w) => w.trim()).filter(Boolean);
  const more = value.more.trim();
  const head = words.join(', ');
  if (head && more) return `${head}\n\n${more}`;
  return head || more;
}

/**
 * The sentence the reference draws, as its three parts.
 *
 * `voiceChips`: the last of several words is preceded by `and`, and every word
 * before the last two is followed by a comma. One word takes neither. Returned
 * rather than rendered so the surface stays a renderer.
 */
export function brandVoiceChipAffixes(
  index: number,
  count: number,
): { pre: string; post: string } {
  return {
    pre: index === count - 1 && count > 1 ? 'and' : '',
    post: index < count - 2 ? ',' : '',
  };
}

/**
 * What the sentence reads when no word has been chosen yet.
 *
 * The reference always ships two, so it never draws this. §16a's rule decides
 * it here: an empty record is not a zero, and a bare `Teeb is` with nothing
 * after it reads as a sentence somebody failed to finish.
 */
export const BRAND_VOICE_NO_WORDS_YET =
  'No words yet — add the first one below.';

/**
 * §14.4's field is one field, and it is read by people rather than by a model.
 *
 * §30 defers AI rewriting by name, §12 makes the helper resources static, and
 * there is no model client in this tree. The words are a way of writing the
 * field, and nothing writes anything in a tone.
 */
export const BRAND_VOICE_IS_READ_BY_PEOPLE =
  'A reviewer and a Creator both read this. Nothing is generated from it.';
