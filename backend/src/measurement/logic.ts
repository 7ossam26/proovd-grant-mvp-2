/**
 * The §31.9 register, restated for the runtime — Phase 23b.
 *
 * `@proovd/shared` exports TypeScript source, the backend compiles under
 * `rootDir: src`, and the production image ships only `backend/dist`. So the
 * cohort size, the label, the metric keys, the correction kinds, and the three
 * never-excluded facts are restated here and drift-tested against shared in
 * `src/tests/measurement.test.ts` — the arrangement the state enums, the §6
 * settings, the notification keys, and the business calendar all use.
 *
 * The frontend imports the shared register directly through Vite; nothing here
 * is a second answer, only a second copy that a test refuses to let diverge.
 */

/** §31.9: "baseline `not measured` until the first 10 invited Founders". */
export const COHORT_BASELINE_SIZE = 10;

/** §33.12.6's label, verbatim. Rendered; never paraphrased. */
export const NOT_MEASURED_LABEL = 'not measured';

/** §31.9's four, in §31.9's order. */
export const SCOREBOARD_METRIC_KEYS = [
  'time_to_first_magic',
  'founder_completion',
  'return_after_closure',
  'next_action_correction_rate',
] as const;

export type ScoreboardMetricKey = (typeof SCOREBOARD_METRIC_KEYS)[number];

/**
 * §20's three kinds that mean the ranking was wrong.
 *
 * The fourth value `act_rank_corrections.correction_kind` can hold is
 * `safety_override`, which is Admin promoting a real candidate — the ranking
 * working as designed under supervision, not a correction of it. Counting it
 * would make the metric worse the more carefully the product was operated.
 */
export const CORRECTION_KINDS_COUNTED = [
  'correction',
  'dismissal',
  'reclassification',
] as const;

/** §33.12.7's three, which no metric may exclude. */
export const NEVER_EXCLUDED_KEYS = [
  'cancellations',
  'support_requests',
  'failed_payments',
] as const;

/**
 * §31.9's "return after closure" second half: "completing a real post-campaign
 * action."
 *
 * A register rather than a sentence, because "real" is the whole of the metric.
 * Each entry is a record that only exists because the Founder did something
 * after their campaign closed — never a read, never a login, and never opening
 * the results page itself, which is already the first half of the metric and
 * would make the numerator measure the denominator.
 */
export const POST_CAMPAIGN_ACTIONS = [
  { key: 'fulfillment_mechanism_set', table: 'campaign_fulfillment', specRef: '§22.5' },
  { key: 'delivery_commitment_revised', table: 'delivery_commitments', specRef: '§22.6' },
  { key: 'day_14_evidence_submitted', table: 'day_14_evidence_submissions', specRef: '§22.4' },
  { key: 'campaign_update_posted', table: 'campaign_updates', specRef: '§18' },
  { key: 'work_again_requested', table: 'work_again_requests', specRef: '§22.9' },
] as const;

export type PostCampaignActionKey = (typeof POST_CAMPAIGN_ACTIONS)[number]['key'];

/** §31.9: "within seven days". The Spec's own number, pinned — §6 fixes none. */
export const RETURN_WINDOW_DAYS = 7;
