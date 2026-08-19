/**
 * The Creator's recorded tone — Creator Flow v2, Session A, 2026-08-19.
 *
 * Screen 4 of the reference asks a Creator to pick how they sound. The record
 * is new; what it is FOR is the part that had to be decided, because the
 * reference's own framing is forbidden.
 *
 * ── The reference's framing is refused, and the field is kept ───────────────
 * It asks: *"Pick a tone we should write your scripts in."* §30 defers AI pitch
 * rewriting and refinement, §12 makes the helper resources "static, copy-ready
 * guidance—not an embedded AI product", and there is no model client anywhere
 * in this tree. Nothing writes scripts in a tone, so a question promising that
 * is a promise the product cannot keep (§1.4).
 *
 * What the answer is actually good for is real and is why the field survives
 * the re-authoring: it is something a Founder reads on the §11 public card when
 * deciding whether this Creator suits their campaign, and it is the Creator's
 * own statement about what they are good at. So the tone is SHOWN — on the
 * public card, on the Creator's own settings, and in the §14.1 opportunity's
 * context — and is never an input to anything that generates text.
 *
 * ── It binds nothing, and the absence is the enforcement ───────────────────
 * There is no rate, no percentage, no eligibility flag, and no ordering weight
 * in this file. A tone does not decide who is recruited, what base applies, or
 * which campaigns a Creator is shown. A later phase reaching here for one of
 * those has taken a wrong turn — the same sentence `subtypes.ts` already
 * carries about compensation inputs.
 */

/**
 * The six the reference draws, kept as-is.
 *
 * Six rather than an open vocabulary because a closed list is comparable across
 * Creators and a free-text one is not — and because the custom field below
 * already covers everything the six do not. `id` is what the record stores;
 * `label` is what a person reads.
 */
export const CREATOR_VOICE_TONES = [
  {
    id: 'straight_talking',
    label: 'Straight-talking',
    help: 'Plain and direct. No build-up.',
  },
  {
    id: 'warm',
    label: 'Warm',
    help: 'Personal and unhurried. You talk to your audience like people you know.',
  },
  {
    id: 'funny',
    label: 'Funny',
    help: 'Jokes land before the pitch does.',
  },
  {
    id: 'analytical',
    label: 'Analytical',
    help: 'You show the numbers and the reasoning.',
  },
  {
    id: 'enthusiastic',
    label: 'Enthusiastic',
    help: 'High energy. You are visibly excited about what you cover.',
  },
  {
    id: 'understated',
    label: 'Understated',
    help: 'Quiet and specific. You let the product carry it.',
  },
] as const;

export type CreatorVoiceToneId = (typeof CREATOR_VOICE_TONES)[number]['id'];

export const CREATOR_VOICE_TONE_IDS: readonly string[] = CREATOR_VOICE_TONES.map((t) => t.id);

export function creatorVoiceTone(id: string) {
  return CREATOR_VOICE_TONES.find((tone) => tone.id === id);
}

/**
 * A custom tone the Creator typed.
 *
 * The reference lets somebody add their own chips, and that is worth keeping —
 * six adjectives cannot describe every channel. What it needs is bounds, since
 * this renders on a Founder-facing card: a length cap so a chip stays a chip,
 * and a count cap so the card cannot become an essay.
 *
 * Neither number is a commercial rule — nothing is refused, gated, or priced on
 * it — so they are presentation constants rather than §6 settings, the same
 * position the reward-card pager took in Founder Flow Session F.
 */
export const CREATOR_VOICE_CUSTOM_MAX_LENGTH = 24;
export const CREATOR_VOICE_CUSTOM_MAX_COUNT = 4;

/**
 * Total tones on one profile, chosen plus custom.
 *
 * A Creator who picks all six and adds four has described nothing, which is the
 * failure mode a cap exists to prevent rather than a rule anybody agreed to.
 */
export const CREATOR_VOICE_MAX_TOTAL = 5;

export interface CreatorVoiceSelection {
  /** Ids from `CREATOR_VOICE_TONES`. */
  tones: readonly string[];
  /** Free text the Creator typed. */
  customTones: readonly string[];
  /**
   * The reference's `I'm flexible with different tones` switch.
   *
   * Its own column rather than a seventh tone, because it says something about
   * the OTHER answers — "these are what I default to, not what I am limited
   * to" — and a tone that modified the meaning of its siblings would be a
   * vocabulary that is not a vocabulary.
   */
  flexible: boolean;
}

export type CreatorVoiceViolation =
  | { kind: 'unknown_tone'; value: string }
  | { kind: 'duplicate_tone'; value: string }
  | { kind: 'custom_too_long'; value: string }
  | { kind: 'custom_blank' }
  | { kind: 'too_many_custom'; count: number }
  | { kind: 'too_many_total'; count: number };

/**
 * Every problem with a selection, named — never a boolean.
 *
 * The surface renders one sentence per violation, so a Creator who typed a
 * 40-character tone and picked six chips is told both things at once rather
 * than fixing one and discovering the other.
 */
export function creatorVoiceViolations(
  selection: CreatorVoiceSelection,
): readonly CreatorVoiceViolation[] {
  const out: CreatorVoiceViolation[] = [];
  const seen = new Set<string>();

  for (const id of selection.tones) {
    if (!CREATOR_VOICE_TONE_IDS.includes(id)) {
      out.push({ kind: 'unknown_tone', value: id });
      continue;
    }
    if (seen.has(id)) out.push({ kind: 'duplicate_tone', value: id });
    seen.add(id);
  }

  const customs = selection.customTones;
  for (const value of customs) {
    if (value.trim().length === 0) {
      out.push({ kind: 'custom_blank' });
      continue;
    }
    if (value.trim().length > CREATOR_VOICE_CUSTOM_MAX_LENGTH) {
      out.push({ kind: 'custom_too_long', value });
    }
  }
  if (customs.length > CREATOR_VOICE_CUSTOM_MAX_COUNT) {
    out.push({ kind: 'too_many_custom', count: customs.length });
  }

  const total = selection.tones.length + customs.length;
  if (total > CREATOR_VOICE_MAX_TOTAL) {
    out.push({ kind: 'too_many_total', count: total });
  }

  return out;
}

/**
 * Pinned. Renders with the tone control, and again on Settings.
 *
 * A Creator picking a "tone we write your scripts in" would reasonably expect
 * scripts to arrive in it. Nothing generates text here, so the sentence that
 * makes the question honest travels with the question (§1.4, §30).
 */
export const VOICE_IS_NEVER_USED_TO_REWRITE =
  'Nothing on Proovd writes or rewrites your posts. This is shown to Founders deciding whether you suit their campaign, and it is yours to change.';

/**
 * Pinned. Renders beside the tone chips on the Founder-facing card.
 *
 * The other half: a Founder reading a tone must not read it as a commitment
 * the Creator made about deliverables. §14.2 fixes what is owed; this is not it.
 */
export const VOICE_IS_NOT_A_DELIVERABLE =
  'How this Creator describes their own style. It is not part of what they agreed to deliver.';
