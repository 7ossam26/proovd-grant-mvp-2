import { describe, it, expect } from 'vitest';
import {
  ACT_RANKS,
  ACT_ACTION_KINDS,
  ACT_CAUGHT_UP,
  BANNED_FRESHNESS_TERMS,
  EXPLORE_SECTIONS,
  EXPLORE_SECTION_KEYS,
  GLANCE_NOT_YET_CHARGED,
  LiveRuleError,
  MILESTONE_KINDS,
  actRankFor,
  crossingFor,
  decideAct,
  reachedMilestones,
  reconcileCounts,
  resolveCaughtUp,
  resolveDelta,
  resolveFreshness,
  resolveProgress,
  thresholdStateFor,
  type ActCandidate,
} from './index.js';

const AT = (iso: string) => new Date(iso);

function candidate(
  kind: ActCandidate['kind'],
  occurredAt = '2026-03-01T00:00:00.000Z',
): ActCandidate {
  return {
    kind,
    sourceTable: 'test',
    sourceId: `${kind}-1`,
    detail: `a real ${kind}`,
    href: `/x/${kind}`,
    occurredAt: AT(occurredAt),
  };
}

describe('§20 Act — the five ranks are a register', () => {
  it('registers exactly the five §20 ranks, in order, with no gaps', () => {
    expect(ACT_RANKS.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(ACT_RANKS.map((r) => r.kind)).toEqual([...ACT_ACTION_KINDS]);
  });

  it('every rank names the record that has to exist before it may be shown', () => {
    for (const definition of ACT_RANKS) {
      expect(definition.requiresRealRecord.trim().length).toBeGreaterThan(0);
      expect(definition.specRef).toMatch(/^§20 Act [1-5]$/);
    }
  });

  it('refuses a kind with no §20 line behind it', () => {
    expect(() => actRankFor('invented_action' as never)).toThrow(LiveRuleError);
  });
});

describe('§33.6.7 — one correctly ranked real action, or the caught-up ending', () => {
  it('picks the lowest rank number when several are real', () => {
    const decision = decideAct(
      [
        candidate('optional_milestone_update'),
        candidate('unanswered_backer_question'),
        candidate('safety_compliance_blocker'),
        candidate('required_campaign_update'),
      ],
      { localCloseLabel: 'March 20, 2026 at 5:00 PM' },
    );
    expect(decision.state).toBe('action');
    if (decision.state !== 'action') return;
    expect(decision.action.kind).toBe('safety_compliance_blocker');
    expect(decision.rank).toBe(1);
    expect(decision.overridden).toBe(false);
    // Everything else stays available — Explore is not a bin (DNA §5.2).
    expect(decision.deferred.map((c) => c.kind)).toEqual([
      'unanswered_backer_question',
      'required_campaign_update',
      'optional_milestone_update',
    ]);
  });

  it('breaks a tie inside one rank with the record that has waited longest', () => {
    const older = { ...candidate('unanswered_backer_question', '2026-03-01T00:00:00.000Z'), sourceId: 'older' };
    const newer = { ...candidate('unanswered_backer_question', '2026-03-05T00:00:00.000Z'), sourceId: 'newer' };
    const decision = decideAct([newer, older], { localCloseLabel: 'March 20, 2026 at 5:00 PM' });
    if (decision.state !== 'action') throw new Error('expected an action');
    expect(decision.action.sourceId).toBe('older');
  });

  it('closes with the exact §20 done-moment when nothing real is outstanding', () => {
    const decision = decideAct([], { localCloseLabel: 'March 20, 2026 at 5:00 PM' });
    expect(decision).toEqual({
      state: 'caught_up',
      sentence: "You're all caught up. Results land March 20, 2026 at 5:00 PM.",
    });
  });

  it('never manufactures a CTA — an empty list has no action branch at all', () => {
    const decision = decideAct([], { localCloseLabel: 'March 20, 2026 at 5:00 PM' });
    expect(decision.state).toBe('caught_up');
    expect(JSON.stringify(decision)).not.toContain('href');
  });
});

describe('§20 — the documented safety override', () => {
  const override = {
    promoteKind: 'unanswered_backer_question' as const,
    reason: 'A named regulator asked about this Backer question today.',
    actor: 'admin:1',
    recordedAt: AT('2026-03-02T00:00:00.000Z'),
  };

  it('promotes a real candidate above its natural rank and says it did', () => {
    const decision = decideAct(
      [candidate('safety_compliance_blocker'), candidate('unanswered_backer_question')],
      { localCloseLabel: 'March 20, 2026 at 5:00 PM', override },
    );
    if (decision.state !== 'action') throw new Error('expected an action');
    expect(decision.action.kind).toBe('unanswered_backer_question');
    expect(decision.overridden).toBe(true);
    expect(decision.rank).toBe(3);
  });

  it('cannot manufacture an action for a kind with no real record', () => {
    const decision = decideAct([], { localCloseLabel: 'March 20, 2026 at 5:00 PM', override });
    expect(decision.state).toBe('caught_up');
  });

  it('refuses an undocumented override — reason and actor are required', () => {
    expect(() =>
      decideAct([candidate('unanswered_backer_question')], {
        localCloseLabel: 'March 20, 2026 at 5:00 PM',
        override: { ...override, reason: '  ' },
      }),
    ).toThrow(LiveRuleError);
    expect(() =>
      decideAct([candidate('unanswered_backer_question')], {
        localCloseLabel: 'March 20, 2026 at 5:00 PM',
        override: { ...override, actor: '' },
      }),
    ).toThrow(LiveRuleError);
  });
});

describe('§20 Glance — the copy renders or throws', () => {
  it('renders the delta, and 0 is a truthful no-change rather than "+0"', () => {
    expect(resolveDelta(3, 'March 2')).toBe('+3 since March 2');
    expect(resolveDelta(0, 'March 2')).toBe('No change since March 2');
  });

  it('refuses to render a sentence with an unfilled marker', () => {
    expect(() => resolveCaughtUp('')).toThrow(LiveRuleError);
    expect(() => resolveDelta(1, '   ')).toThrow(LiveRuleError);
    expect(() => resolveFreshness('')).toThrow(LiveRuleError);
    expect(ACT_CAUGHT_UP).toContain('[LOCAL CLOSE]');
  });

  it('states an Idea countdown and a Product close, and refuses to mix them', () => {
    expect(
      resolveProgress({ model: 'idea', localCloseLabel: 'March 20, 5:00 PM', remainingToThreshold: 12 }),
    ).toBe('12 to go · ends March 20, 5:00 PM');
    expect(resolveProgress({ model: 'product', localCloseLabel: 'March 20, 5:00 PM' })).toBe(
      'Campaign ends March 20, 5:00 PM',
    );
    // §14.4: a Product campaign has no public funding gate.
    expect(() =>
      resolveProgress({
        model: 'product',
        localCloseLabel: 'March 20, 5:00 PM',
        remainingToThreshold: 4,
      }),
    ).toThrow(LiveRuleError);
    expect(() => resolveProgress({ model: 'idea', localCloseLabel: 'March 20, 5:00 PM' })).toThrow(
      LiveRuleError,
    );
  });

  it('keeps the permanent not-yet-charged clarification and never claims immediacy', () => {
    expect(GLANCE_NOT_YET_CHARGED).toContain('have not been charged');
    const copy = [
      GLANCE_NOT_YET_CHARGED,
      ACT_CAUGHT_UP,
      resolveFreshness('3:40 PM'),
      ...EXPLORE_SECTIONS.map((s) => `${s.title} ${s.definition}`),
      ...ACT_RANKS.map((r) => `${r.label} ${r.requiresRealRecord}`),
    ]
      .join(' ')
      .toLowerCase();
    for (const term of BANNED_FRESHNESS_TERMS) {
      expect(copy).not.toContain(term);
    }
  });
});

describe('§33.6.9 — new, canceled, and net counts reconcile', () => {
  it('computes net as new minus canceled and agrees with the active set', () => {
    expect(reconcileCounts({ newCount: 10, canceledCount: 3, otherExits: 0, activeCount: 7 })).toEqual({
      newCount: 10,
      canceledCount: 3,
      otherExits: 0,
      activeCount: 7,
      netChange: 7,
    });
  });

  it('keeps a kill separate from a cancellation and still reconciles', () => {
    const counts = reconcileCounts({
      newCount: 10,
      canceledCount: 3,
      otherExits: 2,
      activeCount: 5,
    });
    // Net change is what Backers did; the two killed ones are not cancellations.
    expect(counts.netChange).toBe(7);
    expect(counts.activeCount).toBe(5);
  });

  it('throws rather than displaying three numbers that disagree', () => {
    expect(() =>
      reconcileCounts({ newCount: 10, canceledCount: 3, otherExits: 0, activeCount: 6 }),
    ).toThrow(/do not reconcile/);
    expect(() =>
      reconcileCounts({ newCount: -1, canceledCount: 0, otherExits: 0, activeCount: 0 }),
    ).toThrow(LiveRuleError);
  });
});

describe('§33.6.10 — a crossing is deduplicated by state transition', () => {
  it('emits reached on the way up and lost on the way down, once each', () => {
    expect(crossingFor(null, 'reached')).toBe('reached');
    expect(crossingFor('reached', 'reached')).toBeNull();
    expect(crossingFor('reached', 'below')).toBe('lost');
    expect(crossingFor('lost', 'below')).toBeNull();
  });

  it('emits nothing for a campaign that has never reached the threshold', () => {
    expect(crossingFor(null, 'below')).toBeNull();
  });

  it('fires repeatedly across a campaign that crosses more than once', () => {
    let last: 'reached' | 'lost' | null = null;
    const emitted: string[] = [];
    // 4 → 5 → 4 → 6, threshold 5.
    for (const count of [4, 5, 4, 6]) {
      const crossing = crossingFor(last, thresholdStateFor(count, 5));
      if (crossing) {
        emitted.push(crossing);
        last = crossing;
      }
    }
    expect(emitted).toEqual(['reached', 'lost', 'reached']);
  });

  it('refuses a threshold that is not a positive integer', () => {
    expect(() => thresholdStateFor(3, 0)).toThrow(LiveRuleError);
    expect(() => thresholdStateFor(-1, 5)).toThrow(LiveRuleError);
  });
});

describe('§20 milestones — four kinds, Idea-only where §14.4 forbids a public gate', () => {
  it('registers exactly §20’s four', () => {
    expect([...MILESTONE_KINDS]).toEqual([
      'first_preorder',
      'halfway',
      'threshold_met',
      'campaign_ended',
    ]);
  });

  it('reaches halfway and threshold met on an Idea campaign', () => {
    expect(
      reachedMilestones({
        model: 'idea',
        everHadPreorder: true,
        uniqueActiveBackers: 5,
        threshold: 10,
        ended: false,
      }),
    ).toEqual(['first_preorder', 'halfway']);
    expect(
      reachedMilestones({
        model: 'idea',
        everHadPreorder: true,
        uniqueActiveBackers: 10,
        threshold: 10,
        ended: true,
      }),
    ).toEqual(['first_preorder', 'halfway', 'threshold_met', 'campaign_ended']);
  });

  it('never reports a halfway or threshold milestone for a Product campaign', () => {
    expect(
      reachedMilestones({
        model: 'product',
        everHadPreorder: true,
        uniqueActiveBackers: 500,
        ended: false,
      }),
    ).toEqual(['first_preorder']);
  });
});

describe('§33.6.8 — Explore is a register of complete data, each with a definition', () => {
  it('registers all eleven §20 Explore bullets, in order', () => {
    expect(EXPLORE_SECTIONS.map((s) => s.key)).toEqual([...EXPLORE_SECTION_KEYS]);
    expect(EXPLORE_SECTIONS).toHaveLength(11);
  });

  it('gives every section a definition, because §20’s last bullet asks for one', () => {
    for (const section of EXPLORE_SECTIONS) {
      expect(section.definition.trim().length).toBeGreaterThan(20);
      expect(section.specRef).toMatch(/^§20 Explore \d+$/);
    }
  });
});
