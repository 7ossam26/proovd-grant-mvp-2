/**
 * The §31.9 measurement register, as kernels — Phase 23b (§33.12.6, §33.12.7).
 *
 * What is proved here is the shape of the answer: that a number cannot be
 * produced before the cohort is whole, that `not measured` is a state with a
 * reason rather than a rendering of zero, and that the three things §33.12.7
 * forbids excluding are refused by name. Whether the *service* computes them
 * from the records it names is proved against a real database in
 * `backend/src/tests/measurement.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import {
  COHORT_BASELINE_SIZE,
  NOT_MEASURED_LABEL,
  FOUNDER_SCOREBOARD,
  SCOREBOARD_METRIC_KEYS,
  SECONDARY_METRICS,
  NEVER_EXCLUDED,
  NEVER_EXCLUDED_KEYS,
  MEASUREMENT_PROHIBITIONS,
  FORBIDDEN_MEASUREMENT_TABLES,
  CORRECTION_KINDS_COUNTED,
  exclusionViolations,
  gateOnCohort,
  medianHours,
  isMeasured,
  type MeasuredRate,
} from './index.js';
import { ACT_CORRECTION_KINDS } from '../live/index.js';

describe('§33.12.6 — the baseline is a state, not a number', () => {
  it('uses §31.9’s own cohort size and §33.12.6’s own label', () => {
    expect(COHORT_BASELINE_SIZE).toBe(10);
    expect(NOT_MEASURED_LABEL).toBe('not measured');
  });

  it('refuses to compute anything before the cohort is whole', () => {
    let computed = false;
    const value = gateOnCohort(9, () => {
      computed = true;
      return { state: 'measured', unit: 'rate', numerator: 9, denominator: 9, value: 1 };
    });
    // Not merely discarded — never computed. A gate that runs the computation
    // and then hides it is one refactor away from rendering it.
    expect(computed).toBe(false);
    expect(value.state).toBe('not_measured');
    expect(value).toMatchObject({ reason: 'cohort_incomplete', invitedFounders: 9, cohortSize: 10 });
  });

  it('separates an incomplete cohort from a complete one with nothing to measure', () => {
    const nothing = gateOnCohort(10, () => null);
    expect(nothing).toMatchObject({ state: 'not_measured', reason: 'no_observations' });
    // The two are different facts and the reader is owed the difference: one
    // says "too early to know", the other says "ten Founders, none of them did
    // this yet".
    const early = gateOnCohort(0, () => null);
    expect(early).toMatchObject({ reason: 'cohort_incomplete' });
  });

  it('produces a number once the cohort is whole and there is something to count', () => {
    const value = gateOnCohort<MeasuredRate>(12, () => ({
      state: 'measured',
      unit: 'rate',
      numerator: 3,
      denominator: 12,
      value: 0.25,
    }));
    expect(isMeasured(value)).toBe(true);
    expect(value).toMatchObject({ value: 0.25, numerator: 3, denominator: 12 });
  });

  it('never turns an empty observation set into a zero', () => {
    expect(medianHours([])).toBeNull();
    expect(medianHours([3_600_000])).toBe(1);
    expect(medianHours([3_600_000, 7_200_000])).toBe(1.5);
    expect(medianHours([7_200_000, 3_600_000, 10_800_000])).toBe(2);
  });
});

describe('§31.9 — the four-number Founder scoreboard', () => {
  it('is exactly §31.9’s four, in §31.9’s order', () => {
    expect(SCOREBOARD_METRIC_KEYS).toEqual([
      'time_to_first_magic',
      'founder_completion',
      'return_after_closure',
      'next_action_correction_rate',
    ]);
  });

  it('computes every metric from named existing records', () => {
    for (const metric of FOUNDER_SCOREBOARD) {
      expect(metric.sources.length, metric.key).toBeGreaterThan(0);
      for (const source of metric.sources) {
        expect(source.table.length, `${metric.key}/${source.table}`).toBeGreaterThan(0);
        expect(source.specRef.startsWith('§'), `${metric.key}/${source.table}`).toBe(true);
        // A metric reading a table §31.9 itself invented would be the warehouse
        // arriving one column at a time.
        expect(FORBIDDEN_MEASUREMENT_TABLES as readonly string[]).not.toContain(source.table);
      }
    }
  });

  it('states a numerator and a denominator for every rate, and neither for a duration', () => {
    for (const metric of FOUNDER_SCOREBOARD) {
      if (metric.unit === 'rate') {
        expect(metric.numerator, metric.key).toBeTruthy();
        expect(metric.denominator, metric.key).toBeTruthy();
      } else {
        expect(metric.numerator, metric.key).toBeNull();
        expect(metric.denominator, metric.key).toBeNull();
      }
    }
  });

  it('counts §20’s three correction kinds and not the safety override', () => {
    // The exact §20 vocabulary `act_rank_corrections.correction_kind` stores —
    // a fourth spelling here would silently count nothing.
    expect(CORRECTION_KINDS_COUNTED).toEqual(['correction', 'dismissal', 'reclassification']);
    expect(CORRECTION_KINDS_COUNTED as readonly string[]).not.toContain('safety_override');
    expect([...CORRECTION_KINDS_COUNTED, 'safety_override'].sort()).toEqual(
      [...ACT_CORRECTION_KINDS].sort(),
    );
  });
});

describe('§33.12.7 — what a metric may never exclude', () => {
  it('names all three, separately', () => {
    expect(NEVER_EXCLUDED_KEYS).toEqual([
      'cancellations',
      'support_requests',
      'failed_payments',
    ]);
    for (const entry of NEVER_EXCLUDED) {
      expect(entry.definition.length, entry.key).toBeGreaterThan(40);
    }
  });

  it('refuses an exclusion by name, and says why', () => {
    const violations = exclusionViolations('founder_completion', ['cancellations']);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('founder_completion excludes cancellations');
    expect(violations[0]).toContain('remain in every denominator');
  });

  it('lets a metric exclude something that is not one of the three', () => {
    // §20's documented safety override is legitimately outside the correction
    // rate: it is Admin promoting a real candidate, not the ranking being wrong.
    expect(exclusionViolations('next_action_correction_rate', ['safety_override'])).toEqual([]);
  });

  it('makes every scoreboard metric declare it keeps all three in', () => {
    for (const metric of FOUNDER_SCOREBOARD) {
      expect([...metric.neverExcludes].sort(), metric.key).toEqual([...NEVER_EXCLUDED_KEYS].sort());
    }
  });

  it('carries §31.9’s other two prohibitions, which are not exclusions', () => {
    const keys = MEASUREMENT_PROHIBITIONS.map((entry) => entry.key);
    expect(keys).toContain('no_prechecked_consent');
    expect(keys).toContain('no_redefined_failure');
  });
});

describe('§31.9 — the secondary set', () => {
  it('carries one entry per phrase §31.9 names', () => {
    expect(SECONDARY_METRICS).toHaveLength(13);
  });

  it('gives every entry either a source or a stated reason there is none', () => {
    for (const metric of SECONDARY_METRICS) {
      const hasSource = metric.sources.length > 0;
      const explained = 'absentBecause' in metric && typeof metric.absentBecause === 'string';
      expect(hasSource || explained, metric.key).toBe(true);
      if (!hasSource) {
        expect((metric as { absentBecause: string }).absentBecause.length, metric.key)
          .toBeGreaterThan(60);
      }
    }
  });

  it('explains the two gaps rather than approximating them', () => {
    const autosave = SECONDARY_METRICS.find((metric) => metric.key === 'autosave_failures');
    expect(autosave?.sources).toEqual([]);
    expect(autosave?.absentBecause).toContain('warehouse');

    const reminder = SECONDARY_METRICS.find(
      (metric) => metric.key === 'reminder_delivery_and_cancel',
    );
    // Partially present: delivery and cancellation are recorded, the open is
    // not, and the entry says which half is missing rather than reporting the
    // whole metric as available.
    expect(reminder?.sources.length).toBeGreaterThan(0);
    expect(reminder?.absentBecause).toContain('pixel');
  });
});
