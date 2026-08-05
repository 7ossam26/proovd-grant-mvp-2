/**
 * §22.8–§22.11 and §31.8's registers and kernels — Phase 21b.
 *
 * The integration behaviour lives in `backend/src/tests/completion.test.ts`.
 * What is here is what a database cannot check: that the registers say what
 * §22 says, and that the kernels are total and honest at their edges.
 */

import { describe, expect, it } from 'vitest';
import {
  COMPLETION_CRITERIA,
  COMPLETION_CRITERION_KEYS,
  completionEligible,
  unmetCriteria,
  COMPLETION_STATUSES,
  WORK_AGAIN_STATUSES,
  WORK_AGAIN_ACCEPTANCE_GRANTS_NOTHING,
  NEXT_CAMPAIGN_GATES,
  nextCampaignEarliestAt,
  cooldownElapsed,
  BACKER_PROGRESSION,
  SATISFACTION_SCALES,
  satisfactionIsNegative,
  NEGATIVE_RATING_AT_OR_BELOW,
  SATISFACTION_PROHIBITIONS,
  RESOLUTION_AREAS,
  resolutionRequiredItems,
  resolutionComplete,
  unresolvedAreas,
} from './index.js';
import { RECONCILIATION_ITEMS } from '../close/index.js';

describe('§22.8 the five criteria', () => {
  it('is exactly five, each citing its own numbered clause', () => {
    expect(COMPLETION_CRITERIA).toHaveLength(5);
    const clauses = COMPLETION_CRITERIA.map((c) => c.spec.match(/^§22\.8\.(\d)/)?.[1]);
    expect(clauses).toEqual(['1', '2', '3', '4', '5']);
  });

  it('names no sales, revenue, or performance term (§33.10.6)', () => {
    const text = JSON.stringify(COMPLETION_CRITERIA).toLowerCase();
    for (const banned of ['sales', 'revenue', 'conversion', 'performance', 'target']) {
      expect(text).not.toContain(banned);
    }
  });

  it('needs all five, and a short set is not four out of four', () => {
    const all = COMPLETION_CRITERION_KEYS.map((key) => ({ key, met: true, detail: '' }));
    expect(completionEligible(all)).toBe(true);
    // `.every()` over a short array is true — the length and key checks are
    // what stop a partial evaluation reading as a complete one.
    expect(completionEligible(all.slice(0, 4))).toBe(false);
    // A duplicate key padding the length out is refused too.
    expect(completionEligible([...all.slice(0, 4), all[0]!])).toBe(false);
  });

  it('reports the unmet ones in register order', () => {
    const findings = COMPLETION_CRITERION_KEYS.map((key, i) => ({
      key,
      met: i > 2,
      detail: i > 2 ? '' : 'missing',
    }));
    expect(unmetCriteria(findings).map((f) => f.key)).toEqual(
      COMPLETION_CRITERION_KEYS.slice(0, 3),
    );
  });

  it('has two statuses and no middle ground', () => {
    expect([...COMPLETION_STATUSES]).toEqual([
      'successfully_completed',
      'completion_disqualified',
    ]);
  });
});

describe('§22.9 the work-again request', () => {
  it('has no status that could expire on its own', () => {
    // §22.9 sets no deadline; an `expired` value would put a clock on a
    // Creator's answer that nobody agreed to (§1 rule 6).
    expect([...WORK_AGAIN_STATUSES]).toEqual(['requested', 'accepted', 'declined', 'withdrawn']);
  });

  it('states each of the four bypasses separately (§33.10.8)', () => {
    expect(WORK_AGAIN_ACCEPTANCE_GRANTS_NOTHING).toHaveLength(4);
    const text = WORK_AGAIN_ACCEPTANCE_GRANTS_NOTHING.join(' ').toLowerCase();
    expect(text).toContain('campaign');
    expect(text).toContain('cooldown');
    expect(text).toContain('readiness');
    expect(text).toContain('active-campaign limit');
  });
});

describe('§22.10 the two gates', () => {
  it('names the two, decided by different things', () => {
    expect(NEXT_CAMPAIGN_GATES.map((g) => g.key)).toEqual(['cooldown', 'admin_readiness']);
    expect(NEXT_CAMPAIGN_GATES.map((g) => g.decidedBy)).toEqual(['time', 'admin']);
  });

  it('computes the exact date in months, not in days', () => {
    // 90 days is a different promise in February. §6 says months.
    expect(nextCampaignEarliestAt(new Date('2026-03-15T09:00:00.000Z'), 3).toISOString()).toBe(
      '2026-06-15T09:00:00.000Z',
    );
    expect(nextCampaignEarliestAt(new Date('2025-12-01T00:00:00.000Z'), 3).toISOString()).toBe(
      '2026-03-01T00:00:00.000Z',
    );
  });

  it('clamps rather than rolling into the next month', () => {
    // 31 Jan + 3 = 30 April. A naive setUTCMonth gives 1 May, which is a
    // deadline that moved on its own (§29.6).
    expect(nextCampaignEarliestAt(new Date('2026-01-31T00:00:00.000Z'), 3).toISOString()).toBe(
      '2026-04-30T00:00:00.000Z',
    );
    // 30 Nov + 3 = 28 Feb in a non-leap year.
    expect(nextCampaignEarliestAt(new Date('2026-11-30T00:00:00.000Z'), 3).toISOString()).toBe(
      '2027-02-28T00:00:00.000Z',
    );
    // And 29 Feb in a leap one.
    expect(nextCampaignEarliestAt(new Date('2027-11-30T00:00:00.000Z'), 3).toISOString()).toBe(
      '2028-02-29T00:00:00.000Z',
    );
  });

  it('is elapsed exactly at the instant, not a millisecond before', () => {
    const closed = new Date('2026-03-15T09:00:00.000Z');
    const earliest = nextCampaignEarliestAt(closed, 3);
    expect(cooldownElapsed(closed, 3, new Date(earliest.getTime() - 1))).toBe(false);
    expect(cooldownElapsed(closed, 3, earliest)).toBe(true);
  });

  it('honours a raised cooldown, since §6 states a floor rather than a figure', () => {
    const closed = new Date('2026-01-15T00:00:00.000Z');
    expect(nextCampaignEarliestAt(closed, 6).toISOString()).toBe('2026-07-15T00:00:00.000Z');
  });
});

describe('§31.8 progression and satisfaction', () => {
  it('lists the progression in its stated order', () => {
    expect(BACKER_PROGRESSION.map((s) => s.label)).toEqual([
      'Reserved',
      'Charge due',
      'No charge',
      'Captured',
      'Failed',
      'Delivery due',
      'Delivered',
      'Refunded',
    ]);
  });

  it('derives every step from at least one stored reservation status', () => {
    for (const step of BACKER_PROGRESSION) {
      expect(step.from.length).toBeGreaterThan(0);
    }
  });

  it('supports both scales §31.8 names, and no third', () => {
    expect([...SATISFACTION_SCALES]).toEqual(['binary', 'rating_1_5']);
  });

  it('treats a middling rating as neutral rather than negative', () => {
    expect(NEGATIVE_RATING_AT_OR_BELOW).toBe(2);
    expect(satisfactionIsNegative({ scale: 'rating_1_5', rating: 2 })).toBe(true);
    expect(satisfactionIsNegative({ scale: 'rating_1_5', rating: 3 })).toBe(false);
    expect(satisfactionIsNegative({ scale: 'binary', satisfied: false })).toBe(true);
    expect(satisfactionIsNegative({ scale: 'binary', satisfied: true })).toBe(false);
    // An unanswered question is not a negative answer.
    expect(satisfactionIsNegative({ scale: 'binary' })).toBe(false);
    expect(satisfactionIsNegative({ scale: 'rating_1_5' })).toBe(false);
  });

  it('names the consent prohibition explicitly (§31.8, §30)', () => {
    const keys = SATISFACTION_PROHIBITIONS.map((p) => p.key);
    expect(keys).toContain('no_consent_coercion');
    expect(keys).toContain('no_required_reason');
    expect(keys).toContain('no_gated_answer');
    expect(keys).toContain('no_second_ask');
  });
});

describe('§22.11 resolution', () => {
  it('maps its five areas onto the §21 register and nothing else', () => {
    expect(RESOLUTION_AREAS).toHaveLength(5);
    const known = new Set<string>(RECONCILIATION_ITEMS.map((i) => i.key));
    for (const area of RESOLUTION_AREAS) {
      for (const item of area.reconciliationItems) {
        expect(known.has(item), `${item} is not a §21 reconciliation item`).toBe(true);
      }
    }
  });

  it('covers every §21 item exactly once across the five areas', () => {
    const all = RESOLUTION_AREAS.flatMap((a) => [...a.reconciliationItems]);
    expect(new Set(all).size).toBe(all.length);
    // §22.11 says the whole close reconciles, so nothing is left out.
    expect(new Set(all)).toEqual(new Set<string>(RECONCILIATION_ITEMS.map((i) => i.key)));
  });

  it('is a conjunction: one missing item leaves the campaign unresolved', () => {
    const required = resolutionRequiredItems();
    expect(resolutionComplete(required)).toBe(true);
    for (const item of required) {
      expect(resolutionComplete(required.filter((i) => i !== item))).toBe(false);
    }
  });

  it('names the areas that are short, in register order', () => {
    expect(unresolvedAreas([])).toEqual(RESOLUTION_AREAS.map((a) => a.key));
    expect(unresolvedAreas(resolutionRequiredItems())).toEqual([]);
    // An area is complete only when ALL of its items are — one of two is not
    // most of the way there, it is outstanding.
    expect(unresolvedAreas(['batch_completeness'])).toContain('charge_retry');
    expect(
      unresolvedAreas(['batch_completeness', 'tax_charge_reconciliation']),
    ).not.toContain('charge_retry');
  });
});
