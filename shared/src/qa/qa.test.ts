/**
 * The §33.11 kernels — Phase 23a.
 *
 * The registers themselves are proved by the suites that walk them: the
 * frontend QA sweep renders every `PRINCIPAL_FLOWS` entry, and the backend
 * cross-surface suite fills every `CONSISTENCY_SURFACES` entry. What is proved
 * here is the arithmetic underneath — that the comparison catches a
 * disagreement rather than reporting one, and that each scanner is neither so
 * loose it flags correct copy nor so tight it misses the thing it was written
 * for.
 */

import { describe, it, expect } from 'vitest';
import { namingViolations } from '../notifications/contract.js';
import { FOUNDER_FLOW_PAGES, FOUNDER_FLOW_ROUTES } from '../vetting/index.js';
import {
  CONSISTENCY_FACT_KEYS,
  CONSISTENCY_SURFACE_KEYS,
  CONSISTENCY_FACTS,
  PRINCIPAL_FLOWS,
  KEYBOARD_PATH_FLOWS,
  crossSurfaceDisagreements,
  ctaNamesItsAction,
  isReadableCopy,
  missingStateQuestions,
  placeholderViolations,
  type ConsistencyFact,
  type SurfaceFacts,
} from './index.js';

function facts(overrides: Partial<SurfaceFacts> = {}): SurfaceFacts {
  return {
    reward: 'Founding Edition — Walnut',
    amounts: 'subtotal 12000 / tax 990 / total 12990',
    seller: 'Harlow Instruments LLC',
    trigger: 'Charged when the campaign closes on 12 September 2026',
    delivery: 'March 2027',
    policy: 'refund-policy v1',
    descriptor: 'PROOVD* HARLOW BENCH',
    sla: 'within one (1) business day',
    ...overrides,
  };
}

describe('§33.11.5 the cross-surface comparison', () => {
  it('reports nothing when all seven agree', () => {
    const rendered = Object.fromEntries(
      CONSISTENCY_SURFACE_KEYS.map((surface) => [surface, facts()]),
    );
    expect(crossSurfaceDisagreements(rendered)).toEqual([]);
  });

  it('names the fact and both values when one surface drifts', () => {
    const rendered = Object.fromEntries(
      CONSISTENCY_SURFACE_KEYS.map((surface) => [surface, facts()]),
    );
    rendered['email'] = facts({ descriptor: 'PROOVD* HARLOW' });

    const [drift, ...rest] = crossSurfaceDisagreements(rendered);
    expect(rest).toEqual([]);
    expect(drift?.fact).toBe('descriptor');
    expect(drift?.kind).toBe('conflicting');
    expect(drift?.values.map((entry) => entry.value)).toContain('PROOVD* HARLOW');
    expect(drift?.values.map((entry) => entry.value)).toContain('PROOVD* HARLOW BENCH');
  });

  it('treats a required fact that is absent as a failure, not as agreement', () => {
    const rendered = Object.fromEntries(
      CONSISTENCY_SURFACE_KEYS.map((surface) => [surface, facts()]),
    );
    rendered['magic_link'] = facts({ reward: null });

    const [missing] = crossSurfaceDisagreements(rendered);
    expect(missing?.fact).toBe('reward');
    expect(missing?.kind).toBe('missing');
  });

  it('permits a documented absence, and every one of them says why', () => {
    // The campaign page carries no amounts and no descriptor: §24.3 has no
    // address to tax against yet and §30 forbids implying a charge.
    const rendered = {
      campaign: facts({ amounts: null, descriptor: null, sla: null }),
      checkout: facts({ sla: null }),
      confirmation: facts({ sla: null }),
      email: facts({ policy: null }),
      magic_link: facts(),
      admin: facts({ trigger: null, delivery: null, policy: null, sla: null }),
      evidence: facts(),
    };
    expect(crossSurfaceDisagreements(rendered)).toEqual([]);

    for (const key of CONSISTENCY_FACT_KEYS) {
      const definition: ConsistencyFact = CONSISTENCY_FACTS[key];
      const missingSurfaces = CONSISTENCY_SURFACE_KEYS.filter(
        (surface) => !(definition.requiredOn as readonly string[]).includes(surface),
      );
      if (missingSurfaces.length > 0) {
        expect(definition.absentBecause, `${key} owes a reason for its absence`).toBeTruthy();
      }
    }
  });
});

describe('§33.11.4 a CTA names its action', () => {
  it.each(['Submit', 'OK', 'Continue', 'continue →', 'Next', 'Learn more', 'Click here'])(
    'refuses %s',
    (label) => {
      expect(ctaNamesItsAction(label)).toBe(false);
    },
  );

  it.each([
    'Submit for review',
    'Continue to your code',
    'Save pre-order',
    'Update card',
    'Cancel my pre-order',
    'Review campaign',
    'Get help',
  ])('accepts %s', (label) => {
    expect(ctaNamesItsAction(label)).toBe(true);
  });
});

describe('§33.11.6 nothing unresolved reaches the reader', () => {
  it('catches an unrendered variable in either shape', () => {
    expect(placeholderViolations('You will be charged US$[TOTAL]')).toContain(
      'square_bracket_variable',
    );
    expect(placeholderViolations('Hello {{firstName}}')).toContain('brace_variable');
    expect(placeholderViolations('Your total is ${amount}')).toContain('brace_variable');
  });

  it('catches a value that stringified', () => {
    expect(placeholderViolations('Charged on undefined')).toContain('undefined_value');
    expect(placeholderViolations('US$NaN')).toContain('undefined_value');
  });

  it('catches a document presented as final while it is a stub', () => {
    expect(placeholderViolations('Refund policy — coming soon')).toContain('placeholder_policy');
  });

  it('leaves ordinary copy alone', () => {
    expect(
      placeholderViolations(
        'Your card is saved. Nothing has been charged today. You can cancel any time before 12 September 2026.',
      ),
    ).toEqual([]);
  });
});

describe('§33.11.7 the six-question pattern on a surface', () => {
  it('names the questions a state leaves unanswered', () => {
    expect(missingStateQuestions('Something went wrong. Try again.')).toEqual([
      'what_happened',
      'what_happens_next',
      'who_owns_it',
      'when_is_the_next_update',
      'what_can_the_user_do_now',
      'how_do_they_get_help_without_losing_context',
    ]);
  });

  it('reports none for a panel that answers all six', () => {
    const panel =
      'What happened Your card could not be charged. ' +
      'Next We will try again. Owner You. ' +
      'Next update by 12 September 2026. Reference PVD-12345-67890. ' +
      'Update card. Get help.';
    expect(missingStateQuestions(panel, { hasControl: true })).toEqual([]);
  });

  it('does not accept the word “action” as a control', () => {
    // The failure the structural evidence exists to prevent: a state that
    // discusses actions and offers none.
    const panel =
      'What happened The batch is running. Next We will post the result. ' +
      'Owner Proovd. Next update by 12 September 2026. ' +
      'No further action is possible at this time. Get help.';
    expect(missingStateQuestions(panel)).toEqual(['what_can_the_user_do_now']);
  });
});

describe('§33.11.3 what a bundle scan reads', () => {
  it('reads copy and ignores identifiers, paths, and enum values', () => {
    expect(isReadableCopy('Your card is saved and has not been charged.')).toBe(true);
    expect(isReadableCopy('/api/backer/reservations')).toBe(false);
    expect(isReadableCopy('reservationId')).toBe(false);
    expect(isReadableCopy('PRE_BUILD')).toBe(false);
    expect(isReadableCopy('${campaignId}/preorder')).toBe(false);
  });
});

describe('§33.11.1 the principal-flow register', () => {
  it('names a unique key, at least one route, and a spec reference for each', () => {
    const keys = PRINCIPAL_FLOWS.map((flow) => flow.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const flow of PRINCIPAL_FLOWS) {
      expect(flow.routes.length, flow.key).toBeGreaterThan(0);
      expect(flow.specRef, flow.key).toMatch(/§/);
    }
  });

  it('carries §28.5’s five keyboard-path flows', () => {
    // §28.5: "Founder forms, Affiliate decisions, campaign/checkout,
    // magic-link cancellation/card recovery, and support."
    const keys = KEYBOARD_PATH_FLOWS.map((flow) => flow.key);
    for (const required of [
      'founder_vetting',
      'creator_decisions',
      'backer_checkout',
      'backer_magic_link',
    ]) {
      expect(keys).toContain(required);
    }
  });
});

describe('§3.2 the equity rule reads a claim, not a word', () => {
  it('catches the framings that present a pre-order as an investment', () => {
    for (const copy of [
      'Track your investment in real time.',
      'Invest in this campaign today.',
      'An equity stake in the company.',
      'Expect returns on your contribution.',
      'A strong ROI for early backers.',
      'This is an investment opportunity.',
    ]) {
      expect(namingViolations(copy, 'backer').map((v) => v.term), copy).toContain('equity');
    }
  });

  it('leaves the sentences that deny it, and the prohibited-category list, alone', () => {
    // Both are the public site's own copy, and both are §3.2's position stated
    // rather than broken (§18, §31.4).
    for (const copy of [
      'We are not an investment platform, a charity platform, or a marketplace.',
      'We do not list financial, legal, investment, brokerage, crypto, gambling, or weapons businesses.',
    ]) {
      expect(namingViolations(copy, 'backer'), copy).toEqual([]);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   The Founder flow's own pages are in the register — Founder Flow v2
   ══════════════════════════════════════════════════════════════════════════ */

describe('the Founder onboarding flow', () => {
  const founderFlow = PRINCIPAL_FLOWS.find((flow) => flow.key === 'founder_vetting')!;

  it('restates every flow page in PRINCIPAL_FLOWS, in order', () => {
    // `PRINCIPAL_FLOWS` is `as const`, so the routes cannot be spread in from
    // `FOUNDER_FLOW_PAGES` without widening every one to `string`. They are
    // restated and drift-tested instead — the arrangement the state enums, the
    // §6 settings and the §27 keys all use.
    expect(founderFlow.routes.slice(0, FOUNDER_FLOW_ROUTES.length)).toEqual(
      FOUNDER_FLOW_ROUTES,
    );
  });

  it('gives every page a distinct id, address, title and one-line help', () => {
    expect(new Set(FOUNDER_FLOW_PAGES.map((p) => p.id)).size).toBe(FOUNDER_FLOW_PAGES.length);
    expect(new Set(FOUNDER_FLOW_PAGES.map((p) => p.path)).size).toBe(FOUNDER_FLOW_PAGES.length);
    for (const page of FOUNDER_FLOW_PAGES) {
      expect(page.path.startsWith('/draft/:token'), page.id).toBe(true);
      expect(page.title.trim().length, page.id).toBeGreaterThan(3);
      // One line, and it stops. A help card is not a second copy of the page.
      expect(page.help.trim().length, page.id).toBeGreaterThan(30);
      expect(page.help.split('\n').length, page.id).toBe(1);
    }
  });

  it('holds only the pages that exist', () => {
    // Twenty-six are planned and four are built. A register entry claiming a
    // surface the product does not have is §1.4's failure in a different file,
    // and the help drawer would offer to jump to an address that refuses.
    expect(FOUNDER_FLOW_PAGES).toHaveLength(4);
    for (const page of FOUNDER_FLOW_PAGES) expect(page.stage).toBe(1);
  });
});
