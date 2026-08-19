/**
 * The channel tiles and the per-channel metrics — Creator Flow v2, Session A,
 * 2026-08-19.
 *
 * Two registers that look like one and must not become one.
 *
 * ── The nine tiles are NOT the seven subtypes ──────────────────────────────
 * §5.3 has seven subtypes; the reference draws nine tiles, because it splits
 * social into YouTube, TikTok, and Instagram. Both are right about different
 * things: a Creator picking "YouTube" is answering a presentation question, and
 * `AFFILIATE_SUBTYPE_DEFINITIONS` is what decides which VERIFICATION EVIDENCE
 * an Admin had to record. So a tile carries the subtype it belongs to plus, for
 * the three social ones, a platform — and there is exactly one subtype
 * register in this product.
 *
 * **The Creator's tile is not the Admin's classification, and a disagreement is
 * a fact rather than a bug.** `affiliate_prospects.subtype` was chosen by the
 * Admin who researched the channel, and the evidence on file was recorded
 * against it. If a Creator picks a tile whose subtype differs, the answer is
 * NOT to overwrite the classification — that would silently invalidate a
 * recorded verification, which is the exact reason `affiliate-signup.ts` has
 * always rendered the subtype read-only. It is surfaced to Admin and left
 * alone.
 *
 * ── The metrics come from §5.3's evidence register ─────────────────────────
 * `verifySpec()` at line 2457 of the reference builds per-channel metric fields
 * from a six-branch hard-coded switch, and then renders them nowhere — a
 * genuine bug in the prototype whose OUTPUT is good: subscribers and open rate
 * for a newsletter, downloads and completion for a podcast, members and
 * weekly-active for a community.
 *
 * They are built, and they are built from `AFFILIATE_SUBTYPE_DEFINITIONS`
 * rather than from the reference's list, because that register already carries
 * every one of these ids and is already what an Admin verifies against. Two
 * lists would mean a Creator answering one question and an Admin verifying a
 * different one.
 */

import { AFFILIATE_SUBTYPE_DEFINITIONS, type AffiliateSubtype } from '../affiliates/subtypes.js';

/* ── The nine tiles (screen 3) ────────────────────────────────────────────── */

export interface CreatorChannelTile {
  id: string;
  label: string;
  /** §5.3's subtype this tile belongs to. Never a tenth subtype. */
  subtype: AffiliateSubtype;
  /**
   * The platform, for the three tiles that split one subtype.
   *
   * `null` where the tile IS the subtype. This is what lands in the
   * `platform` evidence input §5.3 already names for `social_creator`, so the
   * split costs no new field.
   */
  platform: string | null;
}

export const CREATOR_CHANNEL_TILES: readonly CreatorChannelTile[] = [
  { id: 'youtube', label: 'YouTube', subtype: 'social_creator', platform: 'YouTube' },
  { id: 'tiktok', label: 'TikTok', subtype: 'social_creator', platform: 'TikTok' },
  { id: 'instagram', label: 'Instagram', subtype: 'social_creator', platform: 'Instagram' },
  {
    id: 'newsletter',
    label: 'Newsletter or blog',
    subtype: 'newsletter_blog_operator',
    platform: null,
  },
  { id: 'podcast', label: 'Podcast', subtype: 'podcast_host', platform: null },
  { id: 'community', label: 'Community', subtype: 'community_owner', platform: null },
  { id: 'course', label: 'Course', subtype: 'course_instructor', platform: null },
  { id: 'student', label: 'Student', subtype: 'student_affiliate', platform: null },
  { id: 'niche_marketer', label: 'Niche marketer', subtype: 'niche_marketer', platform: null },
];

export type CreatorChannelTileId = (typeof CREATOR_CHANNEL_TILES)[number]['id'];

export const CREATOR_CHANNEL_TILE_IDS: readonly string[] = CREATOR_CHANNEL_TILES.map(
  (t) => t.id,
);

export function creatorChannelTile(id: string): CreatorChannelTile | undefined {
  return CREATOR_CHANNEL_TILES.find((tile) => tile.id === id);
}

/** Every tile that maps onto one §5.3 subtype. Three, for social. */
export function creatorChannelTilesForSubtype(
  subtype: AffiliateSubtype,
): readonly CreatorChannelTile[] {
  return CREATOR_CHANNEL_TILES.filter((tile) => tile.subtype === subtype);
}

/**
 * Whether the Creator's tile agrees with the Admin's §5.3 classification.
 *
 * Returns the disagreement rather than resolving it. Nothing in the product
 * calls this to CHANGE anything — it exists so the Admin record can say
 * "this Creator says they run a podcast; we classified them as a social
 * creator and verified them on that basis", which is a fact worth an Admin's
 * attention and is not a fact the product may settle on its own (§1 rule 6).
 */
export function creatorChannelDisagreesWithSubtype(
  tileId: string,
  recordedSubtype: AffiliateSubtype,
): boolean {
  const tile = creatorChannelTile(tileId);
  if (!tile) return false;
  return tile.subtype !== recordedSubtype;
}

/* ── The audience niches (screen 3) ───────────────────────────────────────── */

/**
 * The twelve options behind `audience_niche`.
 *
 * The reference draws a closed select and the column is free text with a full
 * supplier triple. Both survive: the register owns the options, the column
 * stays `text`, and the §8 recruitment record's own prefilled value renders
 * even when it is not one of the twelve — an Admin who wrote "B2B SaaS
 * founders" during research has said something more useful than any list
 * entry, and a select that silently dropped it would lose §11's prefill.
 *
 * `Other` is the twelfth and is deliberately kept. It is a niche somebody
 * chooses, not a subtype that maps to nothing — which is why the ninth CHANNEL
 * tile is `niche_marketer` (a real §5.3 subtype) rather than the reference's
 * own `Other`.
 */
export const CREATOR_AUDIENCE_NICHES: readonly string[] = [
  'Finance content',
  'Gym & fitness',
  'Fashion & style',
  'Beauty & skincare',
  'Tech & gadgets',
  'Food & cooking',
  'Travel',
  'Gaming',
  'Home & lifestyle',
  'Health & wellness',
  'Parenting & family',
  'Other',
];

/* ── The per-channel metrics (screen 6) ───────────────────────────────────── */

/**
 * The nine evidence ids that are NUMBERS A CREATOR CAN SUPPLY about their own
 * channel.
 *
 * A strict subset of `AFFILIATE_SUBTYPE_DEFINITIONS`' evidence ids, and the
 * subset is the point: the other inputs — `analytics`, `audit`,
 * `demographics`, `kyc`, `rules_permission`, `campaign_fit` — are things an
 * Admin gathers, judges, or is shown, not things a person types a figure into.
 * Asking a Creator to self-report their own third-party audit is asking for a
 * claim, and §8's verification is a judgement over evidence rather than over
 * claims.
 *
 * Every id here MUST appear in the subtype register, and a test asserts it in
 * both directions — so a renamed evidence input fails the suite rather than
 * silently orphaning a column.
 */
export const CREATOR_CHANNEL_METRIC_IDS = [
  'followers',
  'engagement',
  'subscribers',
  'click_through',
  'downloads',
  'members',
  'active_users',
  'enrolled_students',
  'ratings',
] as const;

export type CreatorChannelMetricId = (typeof CREATOR_CHANNEL_METRIC_IDS)[number];

/**
 * The metrics one subtype asks for, derived from the subtype register.
 *
 * Derived rather than listed, so there is no second table of "which channel
 * asks what" to drift from §5.3's own. A subtype whose evidence carries none of
 * the nine — `student_affiliate` and `niche_marketer`, whose §5.3 inputs are a
 * promotion plan and a disclaimer rather than an audience number — returns an
 * empty list, and the screen says there is nothing to enter rather than
 * inventing a figure to ask for.
 */
export function creatorChannelMetricsFor(
  subtype: AffiliateSubtype,
): readonly { id: CreatorChannelMetricId; label: string; basis: string }[] {
  const definition = AFFILIATE_SUBTYPE_DEFINITIONS.find((d) => d.id === subtype);
  if (!definition) return [];
  const ids: readonly string[] = CREATOR_CHANNEL_METRIC_IDS;
  return definition.evidence
    .filter((input) => ids.includes(input.id))
    .map((input) => ({
      id: input.id as CreatorChannelMetricId,
      label: input.label,
      basis: input.basis,
    }));
}

/** Every metric id any subtype actually asks for. The CHECK in 0055 reads this. */
export function allCreatorChannelMetricIds(): readonly string[] {
  const out = new Set<string>();
  for (const definition of AFFILIATE_SUBTYPE_DEFINITIONS) {
    for (const input of definition.evidence) {
      if ((CREATOR_CHANNEL_METRIC_IDS as readonly string[]).includes(input.id)) {
        out.add(input.id);
      }
    }
  }
  return [...out].sort();
}

/* ── The pinned sentences ─────────────────────────────────────────────────── */

/**
 * Pinned. Renders under the metric fields.
 *
 * §8's verification is Admin's recorded judgement over §5.3's evidence. A
 * self-reported number is a starting point for that judgement and not the
 * judgement — and saying so is what stops the fields reading as the thing that
 * gets somebody verified (which is the mechanic the reference's `matchPct`
 * meter builds, and which `CREATOR_FLOW_ABSENCES` refuses).
 */
export const CHANNEL_METRICS_ARE_YOUR_OWN_FIGURES =
  'Your own figures, as you report them. Somebody at Proovd checks them against your channel before a Founder sees them.';

/**
 * Pinned. Renders beside the read-only channel type on Settings and screen 3.
 *
 * `affiliate-signup.ts` has carried this reasoning since Phase 08b; the
 * sentence is what a Creator reads instead of an editable control.
 */
export const CHANNEL_TYPE_IS_ADMIN_CLASSIFICATION =
  'We recorded your channel type when we researched you, and the evidence on file was checked against it. If it is wrong, tell us and we will correct it — changing it here would quietly undo that check.';

/**
 * Pinned. Renders where a subtype asks for none of the nine.
 *
 * §16a: not yet populated is not zero, and here it is not even a gap. A student
 * Creator has no audience metric to enter because §5.3 does not ask them for
 * one.
 */
export const CHANNEL_METRICS_NOT_ASKED =
  'Nothing to enter for this kind of channel. What we check for you is your reach plan and how you identify yourself, which we go through with you directly.';
