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
import {
  FOUNDER_ANSWER_SEQUENCE,
  FOUNDER_FLOW_PAGES,
  FOUNDER_FLOW_ROUTES,
  VETTING_STEPS,
  founderAnswerLabel,
  founderAnswerNext,
  founderAnswerPrevious,
  founderFlowIndex,
  founderFlowPage,
  founderFlowPath,
  founderFlowReachableFrom,
} from '../vetting/index.js';
import { OPTIONAL_ITEMS } from '../workspace/index.js';
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
  const setupFlow = PRINCIPAL_FLOWS.find((flow) => flow.key === 'founder_workspace')!;
  const moneyFlow = PRINCIPAL_FLOWS.find((flow) => flow.key === 'founder_money')!;
  const pageFlow = PRINCIPAL_FLOWS.find((flow) => flow.key === 'founder_page_build')!;

  it('restates every flow page in PRINCIPAL_FLOWS, in order', () => {
    // `PRINCIPAL_FLOWS` is `as const`, so the routes cannot be spread in from
    // `FOUNDER_FLOW_PAGES` without widening every one to `string`. They are
    // restated and drift-tested instead — the arrangement the state enums, the
    // §6 settings and the §27 keys all use.
    //
    // Session D split them across flow entries, because the register's
    // audience is one thing and its AUTH REGIME is another: stages 1–2 are the
    // draft token, stage 3 is a Founder session, and stage 4 additionally
    // needs a complete `founder_seller` account — a §33.11 sweep has to stub a
    // different thing for each. Together they are still every page, and the
    // last assertion is what keeps that true when a session adds one.
    const tokenPages = FOUNDER_FLOW_PAGES.filter((page) => page.param === 'token');
    const campaignPages = FOUNDER_FLOW_PAGES.filter((page) => page.param === 'campaignId');
    expect(founderFlow.routes).toEqual(tokenPages.map((page) => page.path));
    expect([...setupFlow.routes, ...moneyFlow.routes, ...pageFlow.routes]).toEqual(
      campaignPages.map((page) => page.path),
    );
    expect(
      [...founderFlow.routes, ...setupFlow.routes, ...moneyFlow.routes, ...pageFlow.routes].sort(),
    ).toEqual([...FOUNDER_FLOW_ROUTES].sort());
  });

  it('gives every page a distinct id, address, title and one-line help', () => {
    expect(new Set(FOUNDER_FLOW_PAGES.map((p) => p.id)).size).toBe(FOUNDER_FLOW_PAGES.length);
    expect(new Set(FOUNDER_FLOW_PAGES.map((p) => p.path)).size).toBe(FOUNDER_FLOW_PAGES.length);
    for (const page of FOUNDER_FLOW_PAGES) {
      expect(page.path.includes(`:${page.param}`), page.id).toBe(true);
      expect(page.title.trim().length, page.id).toBeGreaterThan(3);
      // One line, and it stops. A help card is not a second copy of the page.
      expect(page.help.trim().length, page.id).toBeGreaterThan(30);
      expect(page.help.split('\n').length, page.id).toBe(1);
    }
  });

  it('holds only the pages that exist', () => {
    // Twenty-six were planned; on 2026-08-20 the reach orbit and the
    // problem confirm were added, and the match and claim screens were
    // removed outright. So this is every page the flow has.
    expect(FOUNDER_FLOW_PAGES).toHaveLength(24);
  });

  it('addresses a page by the parameter its own auth regime has', () => {
    // The whole reason `param` exists. Stage 1 runs on the draft token;
    // stage 3 onward is addressed by campaign, behind a Founder session.
    // A stage-3 page holding `:token` would be a page nobody could reach.
    for (const page of FOUNDER_FLOW_PAGES) {
      expect(page.param, page.id).toBe(page.stage === 1 ? 'token' : 'campaignId');
    }
  });

  it('puts Stripe before the listing fee, because the server does', () => {
    // `founder-flow-reconciliation.md` §1, move 2. The reference draws the fee
    // at 20 and payouts at 25; `beginListingCheckout` refuses without a
    // complete `founder_seller` account, so drawn that way screen 20 offers a
    // payment the server declines. §23.1 orders the two states the same way.
    const payouts = founderFlowIndex('payouts');
    const fee = founderFlowIndex('fee');
    expect(payouts).toBeGreaterThan(-1);
    expect(fee).toBeGreaterThan(payouts);
    expect(founderFlowPage('payouts')?.stage).toBe(4);
    expect(founderFlowPage('fee')?.stage).toBe(4);
    // And after Last look, which is where stage 3 ends.
    expect(payouts).toBeGreaterThan(founderFlowIndex('last-look'));
  });

  it('offers a jump only where the parameter carries over', () => {
    // What the help drawer reads. From a stage-3 page every earlier card is
    // reading rather than a control, because the address it needs no longer
    // exists (§10) — and offering it anyway would send somebody to the
    // unusable-link page from their own help drawer.
    expect(founderFlowReachableFrom('problem', 'invite')).toBe(true);
    expect(founderFlowReachableFrom('story', 'visuals')).toBe(true);
    expect(founderFlowReachableFrom('visuals', 'positioning')).toBe(false);
    expect(founderFlowReachableFrom('last-look', 'problem')).toBe(false);
    // An id nobody registered is not reachable from anywhere, rather than
    // throwing on a help drawer somebody opened.
    expect(founderFlowReachableFrom('visuals', 'nope')).toBe(false);
  });

  it('substitutes whichever parameter the page declares', () => {
    expect(founderFlowPath('positioning', 'tok en')).toBe('/draft/tok%20en/positioning');
    expect(founderFlowPath('visuals', 'camp-1')).toBe('/campaigns/camp-1/setup/visuals');
    expect(founderFlowPath('last-look', 'camp-1')).toBe('/campaigns/camp-1/setup/review');
  });
});

describe('the eight answers, as a sequence over two registers', () => {
  it('covers §9’s three and §12’s five, once each, in flow order', () => {
    expect(FOUNDER_ANSWER_SEQUENCE).toHaveLength(8);
    expect(FOUNDER_ANSWER_SEQUENCE.filter((e) => e.owner === 'vetting')).toHaveLength(3);
    expect(FOUNDER_ANSWER_SEQUENCE.filter((e) => e.owner === 'optional')).toHaveLength(5);
    expect(new Set(FOUNDER_ANSWER_SEQUENCE.map((e) => e.key)).size).toBe(8);
  });

  it('keeps the two registers apart — every key lives in exactly one', () => {
    // The brief's own instruction, and the reason it matters: a §12 answer is
    // COMPLETE or not, decided server-side from objective evidence, and a
    // merged register would quietly make that a Founder assertion.
    const vettingIds = new Set<string>(VETTING_STEPS.map((step) => step.id));
    const optionalIds = new Set<string>(OPTIONAL_ITEMS.map((item) => item.key));
    for (const entry of FOUNDER_ANSWER_SEQUENCE) {
      const inVetting = vettingIds.has(entry.key);
      const inOptional = optionalIds.has(entry.key);
      expect(inVetting !== inOptional, entry.key).toBe(true);
      expect(entry.owner === 'vetting' ? inVetting : inOptional, entry.key).toBe(true);
    }
  });

  it('makes every §9 answer uneditable after the claim, and every §12 one editable', () => {
    // Not a policy: §9's route is behind the draft token and §10's claim
    // invalidates it, so there is no address to send anybody to. Last look
    // reads this rather than comparing an index somebody could reorder.
    for (const entry of FOUNDER_ANSWER_SEQUENCE) {
      expect(entry.editableAfterClaim, entry.key).toBe(entry.owner === 'optional');
    }
  });

  it('points every entry at a page that exists', () => {
    for (const entry of FOUNDER_ANSWER_SEQUENCE) {
      expect(FOUNDER_FLOW_PAGES.some((page) => page.id === entry.pageId), entry.key).toBe(true);
    }
  });

  it('takes its labels from whichever register owns the answer', () => {
    expect(founderAnswerLabel(FOUNDER_ANSWER_SEQUENCE[0]!)).toBe(
      VETTING_STEPS.find((step) => step.id === 'problem')!.label,
    );
    expect(founderAnswerLabel(FOUNDER_ANSWER_SEQUENCE[3]!)).toBe(
      OPTIONAL_ITEMS.find((item) => item.key === 'visuals')!.label,
    );
  });

  it('walks the five optional answers and stops', () => {
    expect(founderAnswerNext('visuals')?.pageId).toBe('branding');
    expect(founderAnswerNext('socials')).toBeNull();
    expect(founderAnswerPrevious('visuals')).toBeNull();
    expect(founderAnswerPrevious('socials')?.pageId).toBe('story');
    // A §9 page is not in the optional sequence at all, so it walks to neither.
    expect(founderAnswerNext('positioning')).toBeNull();
    expect(founderAnswerPrevious('positioning')).toBeNull();
  });
});
