/**
 * First-cohort measurement — Spec §31.9, §33.12.6, §33.12.7 (Phase 23b).
 *
 * ── What this is not ───────────────────────────────────────────────────────
 * §31.9's first sentence is a prohibition: "Use existing events; do not build a
 * general analytics warehouse." So there is no event table here, no tracker, no
 * session store, and no `measurement_events`. Every metric names the record it
 * reads — a table and a column that already exist because some phase needed
 * them for a product reason — and a metric whose input is not recorded says so
 * rather than acquiring one.
 *
 * That is also why the register carries `sources` rather than an event name: an
 * event name is something a later phase would emit *for the metric's sake*,
 * which is the warehouse arriving one column at a time.
 *
 * ── Why the baseline is a state and not a number ───────────────────────────
 * §33.12.6: "First 10 invited Founders establish the explicitly labeled
 * baseline for the four Founder scoreboard metrics; no invented baseline
 * exists." A scoreboard that renders `0%` before anybody has been invited has
 * invented one — it is indistinguishable from a cohort that completed and
 * failed. So the value is a union: `not measured` until the cohort is whole,
 * with the reason and the count, and a number afterwards. This is §16a's
 * "not yet populated is not zero" applied to measurement.
 */

/* ── The cohort ────────────────────────────────────────────────────────────── */

/**
 * §31.9's own number: "baseline `not measured` until the first 10 invited
 * Founders". Pinned rather than a §6 setting because §6 names no setting for
 * it and inventing one would let the baseline be declared complete early.
 */
export const COHORT_BASELINE_SIZE = 10;

/** The label §33.12.6 requires, verbatim. Rendered, never paraphrased. */
export const NOT_MEASURED_LABEL = 'not measured';

/**
 * Why a metric has no number yet. Both are honest and they are not the same
 * thing, so they are not collapsed: a scoreboard showing `not measured` for a
 * whole cohort with no observations is telling the reader something different
 * from one showing it because only four Founders have been invited.
 */
export type NotMeasuredReason =
  /** Fewer than `COHORT_BASELINE_SIZE` Founders have been invited (§33.12.6). */
  | 'cohort_incomplete'
  /** The cohort is whole and no observation of this metric has occurred yet. */
  | 'no_observations'
  /** The metric's input is not a recorded fact in this build. Names which. */
  | 'input_not_recorded';

export interface NotMeasured {
  state: 'not_measured';
  reason: NotMeasuredReason;
  /** Invited Founders so far, so the reader can see how far off the baseline is. */
  invitedFounders: number;
  cohortSize: number;
  /** For `input_not_recorded`, the input that is missing. Never a guess. */
  missingInput?: string;
}

export interface MeasuredDuration {
  state: 'measured';
  unit: 'median_hours';
  value: number;
  observations: number;
}

export interface MeasuredRate {
  state: 'measured';
  unit: 'rate';
  numerator: number;
  denominator: number;
  /** 0–1. A rate over a zero denominator is never 0 — it is `no_observations`. */
  value: number;
}

export type MetricValue = NotMeasured | MeasuredDuration | MeasuredRate;

export function isMeasured(value: MetricValue): value is MeasuredDuration | MeasuredRate {
  return value.state === 'measured';
}

/**
 * The one place a metric becomes a number.
 *
 * Every scoreboard metric goes through this, so the cohort gate cannot be
 * forgotten on one of the four — which is exactly how three metrics stay honest
 * and the fourth quietly becomes the invented baseline §33.12.6 forbids.
 */
export function gateOnCohort<T extends MeasuredDuration | MeasuredRate>(
  invitedFounders: number,
  compute: () => T | null,
): MetricValue {
  if (invitedFounders < COHORT_BASELINE_SIZE) {
    return {
      state: 'not_measured',
      reason: 'cohort_incomplete',
      invitedFounders,
      cohortSize: COHORT_BASELINE_SIZE,
    };
  }
  const measured = compute();
  if (measured === null) {
    return {
      state: 'not_measured',
      reason: 'no_observations',
      invitedFounders,
      cohortSize: COHORT_BASELINE_SIZE,
    };
  }
  return measured;
}

/** The median, in hours, of a set of durations. Null on an empty set. */
export function medianHours(durationsMs: readonly number[]): number | null {
  if (durationsMs.length === 0) return null;
  const sorted = [...durationsMs].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const ms =
    sorted.length % 2 === 1
      ? (sorted[middle] as number)
      : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
  return ms / 3_600_000;
}

/* ── §33.12.7 what a metric may never exclude ─────────────────────────────── */

/**
 * §31.9's closing sentence is a product constraint wearing analytics clothes:
 * "Do not improve metrics by hiding cancellation/support, prechecking consent,
 * or redefining failures."
 *
 * Read as advice it is unenforceable. Read as a register it is a test: every
 * metric declares what it excludes, and excluding one of these is refused by
 * name. The three are separate entries because they are three different ways to
 * flatter the same number, and a product that only guarded the first would look
 * compliant while redefining what counts as a failed payment.
 */
export const NEVER_EXCLUDED = [
  {
    key: 'cancellations',
    specRef: '§31.9, §33.12.7',
    definition:
      'A Backer who canceled, a Founder who canceled the listing, and a campaign that ended without charge all remain in every denominator that would otherwise have contained them.',
  },
  {
    key: 'support_requests',
    specRef: '§31.9, §33.12.7',
    definition:
      'A journey that required support is still a completed journey, and is never removed to make a completion rate look cleaner.',
  },
  {
    key: 'failed_payments',
    specRef: '§31.9, §33.12.7',
    definition:
      'A declined, dropped, or disputed charge stays in the numerator or denominator it belongs to. Redefining what counts as a failure is the same exclusion by another route.',
  },
] as const;

export type NeverExcludedKey = (typeof NEVER_EXCLUDED)[number]['key'];

export const NEVER_EXCLUDED_KEYS = NEVER_EXCLUDED.map((entry) => entry.key) as NeverExcludedKey[];

/**
 * The other two prohibitions in §31.9's closing sentence, which are not
 * exclusions and so cannot be caught by the register above.
 *
 * Both are already structural elsewhere and are recorded here so the reasoning
 * sits with the metric that would benefit from breaking them: §28.4 forbids
 * prechecked optional consent and §30 lists it among the forbidden patterns, and
 * §31.8's satisfaction table has nowhere to record a newsletter answer at all.
 */
export const MEASUREMENT_PROHIBITIONS = [
  {
    key: 'no_prechecked_consent',
    specRef: '§31.9, §28.4, §30',
    statement:
      'No optional consent is prechecked to raise a rate. Every optional control ships unchecked and unselected.',
  },
  {
    key: 'no_redefined_failure',
    specRef: '§31.9, §33.12.7',
    statement:
      'A failure keeps the definition the Spec gives it. A metric may not narrow what counts as a failure to improve itself.',
  },
] as const;

/* ── The four-number Founder scoreboard ───────────────────────────────────── */

export interface MetricSource {
  /** The table that already holds the fact. */
  table: string;
  /** The column read, where one column is the fact. */
  column?: string;
  /** The section that put it there. */
  specRef: string;
}

export type MetricUnit = 'median_hours' | 'rate';

export interface ScoreboardMetric {
  key: string;
  /** What the Admin panel calls it. §31.9's own name. */
  label: string;
  specRef: string;
  /** §31.9's definition, restated rather than reinterpreted. */
  definition: string;
  unit: MetricUnit;
  /** For a rate, what is counted on each side. Null for a duration. */
  numerator: string | null;
  denominator: string | null;
  /** The existing records this is computed from. Never an event invented for it. */
  sources: readonly MetricSource[];
  /** §33.12.7: what this metric must keep in. Every metric names all three. */
  neverExcludes: readonly NeverExcludedKey[];
}

/**
 * §31.9's four, in §31.9's order.
 *
 * Each `sources` entry is a table that exists because a phase needed it for the
 * product — `secure_tokens` because a Founder opens a link, `act_rank_corrections`
 * because §20 requires a correction to be recorded with its reason. Three of the
 * four columns marked below were added by this phase and record nothing new:
 * they stamp the FIRST occurrence of something the system already causes, beside
 * a `last_*` that was already stored and is the wrong tense for a duration.
 */
export const FOUNDER_SCOREBOARD = [
  {
    key: 'time_to_first_magic',
    label: 'Time to first magic',
    specRef: '§31.9',
    definition: 'Median time from invitation-open to possible-creator rendering.',
    unit: 'median_hours',
    numerator: null,
    denominator: null,
    sources: [
      { table: 'secure_tokens', column: 'first_used_at', specRef: '§7, §31.9' },
      { table: 'possible_creator_results', column: 'first_rendered_at', specRef: '§10, §31.9' },
    ],
    neverExcludes: ['cancellations', 'support_requests', 'failed_payments'],
  },
  {
    key: 'founder_completion',
    label: 'Founder completion',
    specRef: '§31.9',
    definition:
      'Opened invitations reaching successful listing payment with connected onboarding complete.',
    unit: 'rate',
    numerator:
      'Campaigns whose listing fee was paid and whose Founder connected account is complete.',
    denominator: 'Invitations that were opened.',
    sources: [
      { table: 'secure_tokens', column: 'first_used_at', specRef: '§7, §31.9' },
      { table: 'listing_fee_payments', column: 'paid_at', specRef: '§13' },
      { table: 'stripe_connected_accounts', column: 'state', specRef: '§13' },
    ],
    neverExcludes: ['cancellations', 'support_requests', 'failed_payments'],
  },
  {
    key: 'return_after_closure',
    label: 'Return after closure',
    specRef: '§31.9',
    definition:
      'Founders opening Results ready within seven days and completing a real post-campaign action.',
    unit: 'rate',
    numerator:
      'Campaigns whose results were first viewed within seven days AND which then recorded a post-campaign action.',
    denominator: 'Campaigns whose results became ready.',
    sources: [
      { table: 'campaign_results', column: 'first_viewed_at', specRef: '§21, §31.9' },
      { table: 'campaign_fulfillment', specRef: '§22.5' },
      { table: 'day_14_evidence_submissions', specRef: '§22.4' },
      { table: 'delivery_commitments', specRef: '§22.5' },
      { table: 'work_again_requests', specRef: '§22.9' },
      { table: 'campaign_updates', specRef: '§18' },
    ],
    neverExcludes: ['cancellations', 'support_requests', 'failed_payments'],
  },
  {
    key: 'next_action_correction_rate',
    label: 'Next-action correction rate',
    specRef: '§31.9, §20',
    definition:
      'Founder sessions where the ranked Act item was dismissed, reclassified, or overridden because state or priority was wrong.',
    unit: 'rate',
    numerator: 'Recorded Act corrections of the three kinds §20 names.',
    denominator: 'Campaign-home deliveries that carried a ranked Act.',
    sources: [
      { table: 'act_rank_corrections', specRef: '§20, §31.9' },
      { table: 'campaign_home_deliveries', specRef: '§20' },
    ],
    neverExcludes: ['cancellations', 'support_requests', 'failed_payments'],
  },
] as const satisfies readonly ScoreboardMetric[];

export type ScoreboardMetricKey = (typeof FOUNDER_SCOREBOARD)[number]['key'];

export const SCOREBOARD_METRIC_KEYS = FOUNDER_SCOREBOARD.map(
  (metric) => metric.key,
) as ScoreboardMetricKey[];

/**
 * §20 names three kinds of correction and they mean different things — a
 * dismissal says the item should not have been shown, a reclassification says
 * it was the wrong rank, a correction says the record was wrong. §31.9's
 * metric asks for all three and NOT for the fourth kind in that table, the
 * documented safety override, which is Admin promoting a real candidate rather
 * than the ranking being wrong.
 */
export const CORRECTION_KINDS_COUNTED = [
  'correction',
  'dismissal',
  'reclassification',
] as const;

/* ── The secondary set ────────────────────────────────────────────────────── */

export interface SecondaryMetric {
  key: string;
  /** §31.9's own phrase. */
  label: string;
  sources: readonly MetricSource[];
  /**
   * Where §31.9 names something this build does not record, the reason — never
   * an approximation. 23a's `absentBecause` contract, reused: a metric computed
   * from a proxy is worse than one that says it has no input, because only the
   * second is visibly a gap.
   */
  absentBecause?: string;
}

/**
 * §31.9's "also track" list, one entry each, in the Spec's order.
 *
 * Two carry `absentBecause`, and both are worth reading rather than filling in.
 * There is no autosave-failure record because §9's autosave reports its outcome
 * to the person and retries; a counter would be a client-side beacon, which is
 * the warehouse §31.9 forbids arriving through the front door. And there is no
 * email-open record because §27 has no tracking pixel and adding one to measure
 * a reminder would put a silent third-party read receipt inside a transactional
 * message — delivery and cancellation are recorded, and those are the two halves
 * the metric is actually for.
 */
export const SECONDARY_METRICS = [
  {
    key: 'autosave_failures',
    label: 'Autosave failures',
    sources: [],
    absentBecause:
      '§9 autosave reports its own outcome to the Founder and retries; nothing records a failure count, and a client-side beacon to produce one is the analytics warehouse §31.9 forbids.',
  },
  {
    key: 'listing_fee_support_contacts',
    label: 'Listing-fee support contacts',
    sources: [{ table: 'support_cases', column: 'topic', specRef: '§26.7' }],
  },
  {
    key: 'time_to_first_creator_response',
    label: 'Time to first formal Creator response / roster update',
    sources: [
      {
        table: 'campaign_affiliate_associations',
        column: 'formal_opened_at',
        specRef: '§14.1',
      },
      { table: 'association_status_history', specRef: '§23.4' },
    ],
  },
  {
    key: 'proposal_outcomes',
    label: 'Proposal outcomes',
    sources: [{ table: 'proposal_versions', column: 'state', specRef: '§14.2' }],
  },
  {
    key: 'compensation_questions',
    label: 'Compensation questions',
    sources: [{ table: 'support_cases', column: 'topic', specRef: '§26.7' }],
  },
  {
    key: 'reservation_failure_step',
    label: 'Pre-order failure step',
    sources: [{ table: 'audit_events', column: 'action', specRef: '§19, §25.6' }],
  },
  {
    key: 'reminder_delivery_and_cancel',
    label: 'Reminder delivery and cancel rates',
    sources: [
      { table: 'notification_deliveries', specRef: '§27.2' },
      { table: 'reservation_status_history', specRef: '§20' },
    ],
    absentBecause:
      'The open half of §31.9’s "delivery/open/cancel" has no source: §27 ships no tracking pixel, and adding one would put a silent read receipt inside a transactional message. Delivery and cancellation are both recorded.',
  },
  {
    key: 'support_free_cancellation',
    label: 'Support-free cancellation',
    sources: [
      { table: 'reservation_status_history', specRef: '§20' },
      { table: 'support_cases', specRef: '§26.7' },
    ],
  },
  {
    key: 'payment_recovery',
    label: 'Payment recovery',
    sources: [
      { table: 'reservation_capture_attempts', specRef: '§21' },
      { table: 'reservation_status_history', specRef: '§21' },
    ],
  },
  {
    key: 'unknown_charge_contacts_and_disputes',
    label: 'Unknown-charge contacts and disputes',
    sources: [
      { table: 'support_cases', column: 'topic', specRef: '§26.7' },
      { table: 'payment_disputes', specRef: '§24.11' },
    ],
  },
  {
    key: 'support_sla_misses',
    label: 'Support SLA misses',
    sources: [
      { table: 'support_cases', column: 'human_response_due_at', specRef: '§27.8' },
      { table: 'support_case_messages', specRef: '§26.8' },
    ],
  },
  {
    key: 'delivery_satisfaction_and_followup',
    label: 'Delivery satisfaction and follow-up',
    sources: [
      { table: 'backer_satisfaction_responses', specRef: '§31.8' },
      { table: 'support_cases', specRef: '§31.8' },
    ],
  },
  {
    key: 'duplicate_messages_suppressed_vs_sent',
    label: 'Duplicate messages suppressed versus sent',
    sources: [
      { table: 'audit_events', column: 'action', specRef: '§27.2' },
      { table: 'notification_deliveries', specRef: '§27.2' },
    ],
  },
] as const satisfies readonly SecondaryMetric[];

export type SecondaryMetricKey = (typeof SECONDARY_METRICS)[number]['key'];

/**
 * §31.9's first prohibition, as the tables a measurement module may not create.
 *
 * A warehouse does not arrive as a warehouse. It arrives as one `events` table
 * "just for the scoreboard", and the suite asserts none of these exists.
 */
export const FORBIDDEN_MEASUREMENT_TABLES = [
  'measurement_events',
  'analytics_events',
  'metric_snapshots',
  'founder_sessions',
  'page_views',
  'tracking_events',
] as const;

/** What a metric may not exclude, checked. Returns the §33.12.7 violations. */
export function exclusionViolations(
  metricKey: string,
  excluded: readonly string[],
): string[] {
  return excluded
    .filter((key) => (NEVER_EXCLUDED_KEYS as readonly string[]).includes(key))
    .map(
      (key) =>
        `${metricKey} excludes ${key}, which §33.12.7 forbids: ${
          NEVER_EXCLUDED.find((entry) => entry.key === key)?.definition ?? ''
        }`,
    );
}
