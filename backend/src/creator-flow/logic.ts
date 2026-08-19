/**
 * Creator Flow v2's vocabularies, restated for the runtime — Session A,
 * 2026-08-19.
 *
 * `@proovd/shared` exports TypeScript source, the backend compiles under
 * `rootDir: src`, and the production image ships only `backend/dist`. So the
 * four closed vocabularies migration 0055 CHECK-pins live here as well as
 * there, and `src/tests/creator-flow.test.ts` fails the suite if any of them
 * ever disagrees — with shared, or with the database.
 *
 * This is the same arrangement as the state enums in `db/schema/domain.ts`, the
 * required policy slugs in `policies/policy-gate.ts`, and `live-mode/logic.ts`.
 * It is not a second source of truth — it is the same truth, three times, with
 * a test in between.
 *
 * ── Why these and not the rest ─────────────────────────────────────────────
 * A vocabulary is restated here when a **CHECK constraint hardcodes it**. That
 * is the only place a drift becomes a runtime failure a person meets: a Creator
 * picks a tile the register added last week, the INSERT is refused by a
 * constraint naming nothing they can act on, and the surface reports a save
 * that did not happen. Everything else in `shared/src/creator-flow/` —
 * the copy, the help text, the explanations, the absence register — is
 * presentation, is imported directly through Vite, and is deliberately NOT
 * copied here, because two versions of one paragraph is how they begin to
 * disagree.
 *
 * ── One addition Session C had to make, and why it is the exception ─────────
 * `VOICE_TONE_IDS` and the three voice caps are NOT CHECK-pinned: 0055 bounds
 * a tone set only by `affiliate_voice_says_something`, deliberately, because a
 * length cap in a CHECK refuses a row rather than telling somebody their chip
 * is long. That left the SERVICE as the only thing standing between a request
 * body and the array — and the browser is not the boundary (`lib/session.ts`).
 * So they are restated and drift-tested for the same reason the rest are, even
 * though the failure they prevent is a stored value nobody can render rather
 * than a constraint violation.
 */

/**
 * The nine channel tiles (0055 `affiliate_signup_channel_type_known`).
 *
 * Nine tiles over §5.3's seven subtypes — the reference splits social into
 * YouTube, TikTok, and Instagram. `AFFILIATE_SUBTYPE_DEFINITIONS` remains the
 * single authority for verification evidence; a tile is presentation over a
 * subtype plus a platform, and there is exactly one subtype register in this
 * product.
 */
export const CHANNEL_TILE_IDS: readonly string[] = [
  'youtube',
  'tiktok',
  'instagram',
  'newsletter',
  'podcast',
  'community',
  'course',
  'student',
  'niche_marketer',
];

/**
 * The nine self-reportable channel metrics (0055
 * `affiliate_channel_metric_id_known`).
 *
 * Every one is an evidence input `AFFILIATE_SUBTYPE_DEFINITIONS` already names,
 * and the drift test asserts that in both directions — so a renamed evidence
 * input fails the suite rather than silently orphaning a column.
 */
export const CHANNEL_METRIC_IDS: readonly string[] = [
  'followers',
  'engagement',
  'subscribers',
  'click_through',
  'downloads',
  'members',
  'active_users',
  'enrolled_students',
  'ratings',
];

/**
 * The four standing tiers (0055 `affiliate_standing_tier_known`).
 *
 * **The tier binds nothing.** There is no rate, floor, percentage, or
 * eligibility value anywhere in this file or its table — see the migration's
 * section 4 and `shared/src/creator-flow/standing.ts` for the full reasoning.
 * A later phase reaching here for a compensation or eligibility input has taken
 * a wrong turn.
 */
export const STANDING_TIER_IDS: readonly string[] = [
  'starting',
  'established',
  'gold',
  'platinum',
];

/** The four resource keys (0055 `creator_resource_id_known`). */
export const RESOURCE_IDS: readonly string[] = [
  'marketing_toolkit',
  'content_templates',
  'best_practices',
  'tracking_and_analytics',
];

/**
 * Every field id the post-claim correction record admits (0055
 * `affiliate_correction_field_known`).
 *
 * The freely-editable eight plus the two guarded ones. Named ids rather than
 * free-text column names — 16a's overridable-field reasoning: a route accepting
 * any string would record a correction of something that does not exist, and
 * the trail would look complete while pointing at nothing.
 */
export const CORRECTION_FIELD_IDS: readonly string[] = [
  'public_handle',
  'phone',
  'channel_reference',
  'audience_niche',
  'audience_size',
  'bio',
  'niche_description',
  'outreach_plan',
  'legal_name',
  'email',
];

/** The referral lifecycle (0055 `affiliate_referral_state_known`). */
export const REFERRAL_STATES: readonly string[] = ['recorded', 'reviewed', 'closed'];

/**
 * The score bounds (0055 `affiliate_standing_score_bounded`).
 *
 * Restated because the CHECK carries them, not because anything reads them as a
 * threshold — the tier boundaries live in shared and are presentation.
 */
export const STANDING_SCORE_MIN = 0;
export const STANDING_SCORE_MAX = 1000;

/**
 * The six recorded tones (`CREATOR_VOICE_TONES`).
 *
 * Not CHECK-pinned — see the header. The service refuses an id outside this
 * list because an unknown tone renders as nothing at all on the §11 public
 * card, which is a value that looks saved and is not (§1.4).
 */
export const VOICE_TONE_IDS: readonly string[] = [
  'straight_talking',
  'warm',
  'funny',
  'analytical',
  'enthusiastic',
  'understated',
];

/**
 * The three voice bounds.
 *
 * Presentation constants rather than §6 settings — nothing is refused, gated,
 * or priced on them, and the reward-card pager took the same position in
 * Founder Flow Session F. Restated here because the service is what enforces
 * them; a 10 KB "tone" is not a chip.
 */
export const VOICE_CUSTOM_MAX_LENGTH = 24;
export const VOICE_CUSTOM_MAX_COUNT = 4;
export const VOICE_MAX_TOTAL = 5;
