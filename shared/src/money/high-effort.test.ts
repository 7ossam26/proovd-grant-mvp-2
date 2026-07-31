/**
 * §33.3.4 — high-effort is correct for all eight combinations. `true` only
 * when Visuals, Branding, AND a scheduled/confirmed interview are all absent
 * (§12).
 */

import { describe, it, expect } from 'vitest';
import { classifyHighEffort } from './high-effort.js';

describe('high-effort classification (§12, §33.3.4)', () => {
  const when = new Date('2026-07-01T12:00:00Z');
  const actor = 'system:test';

  it('is correct for all 8 combinations', () => {
    for (let bits = 0; bits < 8; bits++) {
      const inputs = {
        visualsCompleted: Boolean(bits & 1),
        brandingCompleted: Boolean(bits & 2),
        interviewScheduledOrConfirmed: Boolean(bits & 4),
      };
      const result = classifyHighEffort(inputs, when, actor);

      // High effort only when ALL THREE are absent — i.e. bits === 0.
      expect(result.highEffort).toBe(bits === 0);
    }
  });

  it('records the three inputs, the result, calculation time, and actor (§12)', () => {
    const inputs = {
      visualsCompleted: false,
      brandingCompleted: false,
      interviewScheduledOrConfirmed: false,
    };
    const result = classifyHighEffort(inputs, when, actor);
    expect(result).toEqual({
      inputs,
      highEffort: true,
      calculatedAt: when,
      actor,
    });
    // The stored inputs are a snapshot, not a live reference.
    expect(result.inputs).not.toBe(inputs);
  });
});
