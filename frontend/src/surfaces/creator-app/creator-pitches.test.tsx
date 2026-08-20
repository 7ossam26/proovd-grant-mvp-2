/**
 * Pitches, the Active list, and the pitch — Creator Flow v2, Session E.
 *
 * What is proved here is what a person can reach and what they are told. The
 * three §14.2 decisions themselves are `decisions.ts`'s and are driven by
 * §33.2.6–§33.2.13 against the real routes; this session did not touch them,
 * and re-driving them here would be a second, weaker copy of that suite.
 *
 * The load-bearing assertions are the two §28.5 ones: every reveal step
 * advances with a real control, and the recap — which carries all three
 * outcomes — is reachable without walking any of them.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { axe } from 'jest-axe';
import {
  ACTIVE_LIST_MONEY_LIVES_ON_EARNINGS,
  DECLINE_NO_PENALTY_NOTE,
  DECLINING_COSTS_YOU_NOTHING,
  PITCHES_ARE_YOUR_OWN_INVITATIONS,
  PITCH_BANNED_TERMS,
  PITCH_IP_SUMMARY,
  PITCH_NO_COUNTER_ADVICE,
  PITCH_NO_PREDICTED_EARNINGS,
  PITCH_RECAP_SECTIONS,
  PITCH_REVEAL_STEPS,
  PITCH_SKIP_LABEL,
  PITCH_WALK_IS_OPTIONAL,
  namingViolations,
} from '@proovd/shared';
import { appRoutes } from '../../routes.js';

type StubResult = { status: number; body: unknown } | undefined;
type Handler = (url: string, init?: RequestInit) => StubResult;

let handlers: Handler[] = [];

function respond(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

beforeEach(() => {
  handlers = [];
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const url = String(input);
    for (const handler of handlers) {
      const result = handler(url, init);
      if (result) return respond(result.status, result.body);
    }
    if (url.endsWith('/api/account/me')) {
      return respond(200, {
        account: { role: 'affiliate', email: 'creator@example.com', name: 'A Creator' },
      });
    }
    if (url.includes('/notifications/')) return respond(200, {});
    return respond(404, { error: 'not_found', title: 'No stub' });
  });
});

afterEach(() => vi.unstubAllGlobals());

const ASSOCIATION = 'assoc-1';

const PITCH_ROW = {
  associationId: ASSOCIATION,
  campaignId: 'camp-1',
  productName: 'Loopnote',
  kind: 'opportunity' as const,
  whyThisFitsYourAudience: 'Your listeners already keep voice notes.',
  highEffort: true,
  basePercent: 30,
  bidAllowed: true,
  fixedPaymentAvailable: true,
  ceilingPercent: 50,
  campaignType: 'pre_launch' as const,
  responseDeadlineAt: '2026-09-01T17:00:00.000Z',
  invitedAt: '2026-08-29T17:00:00.000Z',
};

const ACTIVE_ROW = {
  associationId: 'assoc-2',
  campaignId: 'camp-2',
  productName: 'Benchlight',
  status: 'active',
  label: 'Active — your link is live',
  ready: true,
  trackingLinkUrl: 'abc123',
  trackingLinkActive: true,
  firstPostStatus: 'passed',
  destination: 'work' as const,
};

const OPPORTUNITY = {
  associationId: ASSOCIATION,
  campaignId: 'camp-1',
  associationStatus: 'reviewing',
  whyThisFitsYourAudience: 'Your listeners already keep voice notes.',
  campaignStateLabel: 'Formal decision open',
  responseDeadlineAt: '2026-09-01T17:00:00.000Z',
  highEffort: {
    result: true,
    basis: { visualsCompleted: true, brandingCompleted: true, interviewScheduledOrConfirmed: true },
  },
  compensation: {
    basePercent: 30,
    basePercentWithFixed: 20,
    bidAllowed: true,
    fixedPaymentAvailable: true,
    ceilingPercent: 50,
  },
  decisionsAvailable: true,
  versions: [],
  agreement: null,
  trackingLink: null,
};

const CONTENT = {
  brief: {
    audience: null,
    productPromise: 'Voice notes that write your weekly update.',
    campaignType: 'Product Campaign',
    requiredPromotion: 'One first post that Proovd verifies, then keep promoting.',
    compensation: 'A percentage of every captured, validly attributed pre-order.',
    keyDate: '2026-10-01T17:00:00.000Z',
    mainRisk: 'The recorder is machined to order.',
  },
  founder: {
    displayName: 'Harlow Instruments',
    entity: 'Harlow Instruments LLC',
    soleProprietor: false,
    profileUrl: 'https://example.com/harlow',
    priorCampaigns: 2,
    payoutReadiness: 'ready' as const,
  },
  positioning: {
    productName: 'Loopnote',
    category: null,
    problem: 'Weekly updates never get written.',
    solution: 'It writes them from a voice note.',
    competition: 'Two note apps with no summary.',
  },
  chargeRule: { campaignType: 'Product Campaign', rule: 'Backers are charged when it closes.' },
  materials: {
    story: 'Built on a bench.',
    socials: [{ platform: 'youtube', url: 'https://youtube.com/@harlow' }],
    visuals: { count: 0, available: false, unavailableBecause: 'No visuals uploaded yet.' },
    interview: {
      status: 'confirmed',
      available: false,
      unavailableBecause: 'Proovd keeps no recording of the interview.',
    },
  },
  rewards: [
    {
      title: 'The recorder',
      priceCents: '12000',
      contents: ['One recorder'],
      delivery: 'March 2027',
      fulfillment: 'Shipped from Portland.',
      limitedQuantity: 40,
    },
  ],
  threshold: {
    label: 'The Founder’s internal target',
    value: '400000',
    note: 'The Founder’s own target. No charge depends on it.',
  },
  dates: {
    opensAt: '2026-09-05T17:00:00.000Z',
    closesAt: '2026-10-01T17:00:00.000Z',
    durationDays: 26,
  },
  brandNotes: { brandVoice: 'Plain sentences.', brandPerception: null },
  claims: {
    requiredWording: 'Say it is machined aluminium.',
    prohibitedClaims: 'No delivery date before March 2027.',
    unconfirmedClaimWarning: 'Everything the Founder says is the Founder’s own claim.',
  },
  refundPolicy: {
    applicable: true,
    title: 'Harlow returns',
    text: 'Thirty days from delivery.',
    note: 'This is the Founder’s own policy.',
  },
  deliverables: {
    deliveryWindow: 'March 2027',
    obligations: [
      {
        key: 'disclosure',
        statement: 'Include the FTC disclosure on every post.',
        enforcement: 'A post without it is a correction.',
      },
    ],
  },
  midCampaign: null,
};

function stubPitches(view: { pitches: unknown[]; active: unknown[] }) {
  handlers.push((url) =>
    url.startsWith('/api/creator/pitches')
      ? { status: 200, body: { pitches: view, sort: 'deadline' } }
      : undefined,
  );
}

function stubPitch(over: Record<string, unknown> = {}) {
  handlers.push((url) =>
    url.includes('/opportunity')
      ? { status: 200, body: { opportunity: { ...OPPORTUNITY, ...over }, content: CONTENT } }
      : undefined,
  );
}

async function renderAt(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  return render(<RouterProvider router={router} />);
}

/* ══ The two lists ═══════════════════════════════════════════════════════ */

describe('the Creator’s two lists', () => {
  it('opens on Active and counts both tabs', async () => {
    stubPitches({ pitches: [PITCH_ROW], active: [ACTIVE_ROW] });
    await renderAt('/creator/campaigns');

    const active = await screen.findByRole('tab', { name: /Active/ });
    expect(active.getAttribute('aria-selected')).toBe('true');
    expect(active.textContent).toContain('1');
    expect(screen.getByRole('tab', { name: /Pitches/ }).textContent).toContain('1');
  });

  it('routes an active campaign to the work surface, naming it (§33.11.4)', async () => {
    stubPitches({ pitches: [], active: [ACTIVE_ROW] });
    await renderAt('/creator/campaigns');
    expect(await screen.findByRole('button', { name: /Open your work on Benchlight/i })).toBeTruthy();
  });

  it('routes an ended campaign to the close summary rather than the work surface', async () => {
    stubPitches({
      pitches: [],
      active: [{ ...ACTIVE_ROW, status: 'ended', label: 'Ended', ready: false, destination: 'close' }],
    });
    await renderAt('/creator/campaigns');
    expect(await screen.findByRole('button', { name: /Open the close summary/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Open your work/i })).toBeNull();
  });

  it('renders no amount on the Active list, and says where the money is (§33.8.13)', async () => {
    stubPitches({ pitches: [], active: [ACTIVE_ROW] });
    await renderAt('/creator/campaigns');
    await screen.findByRole('heading', { name: 'Benchlight' });
    expect(screen.getByText(ACTIVE_LIST_MONEY_LIVES_ON_EARNINGS)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/US\$/);
  });

  it('states that the pitch list is the Creator’s own invitations (§5.3)', async () => {
    stubPitches({ pitches: [PITCH_ROW], active: [] });
    await renderAt('/creator/campaigns?tab=pitches');
    expect(await screen.findByText(PITCHES_ARE_YOUR_OWN_INVITATIONS)).toBeTruthy();
  });

  it('renders the real §14.3 term and refuses a predicted amount (§22.2)', async () => {
    stubPitches({ pitches: [PITCH_ROW], active: [] });
    await renderAt('/creator/campaigns?tab=pitches');
    await screen.findByRole('heading', { name: 'Loopnote' });
    expect(screen.getByText(/30% of every captured, validly attributed pre-order/)).toBeTruthy();
    expect(screen.getByText(PITCH_NO_PREDICTED_EARNINGS)).toBeTruthy();
  });

  it('offers two sorts, both over a stored column, and no commission or price key', async () => {
    stubPitches({ pitches: [PITCH_ROW], active: [] });
    await renderAt('/creator/campaigns?tab=pitches');
    const group = await screen.findByRole('group', { name: /Sort your invitations/i });
    const labels = within(group)
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(labels).toEqual(['Closing soonest', 'Newest']);
  });

  it('keeps the tab and the sort in the address, so a reload gets them back', async () => {
    stubPitches({ pitches: [PITCH_ROW], active: [] });
    await renderAt('/creator/campaigns?tab=pitches&sort=newest');
    const newest = await screen.findByRole('button', { name: 'Newest' });
    expect(newest.getAttribute('aria-pressed')).toBe('true');
  });

  it('carries §14.2’s promise, and NOT the confirmation of a decline nobody made', async () => {
    stubPitches({ pitches: [PITCH_ROW], active: [] });
    await renderAt('/creator/campaigns?tab=pitches');
    expect(await screen.findByText(DECLINING_COSTS_YOU_NOTHING)).toBeTruthy();
    // `DECLINE_NO_PENALTY_NOTE` opens "Your decline was recorded", which is
    // untrue beside an open decision (§1.4).
    expect(screen.queryByText(DECLINE_NO_PENALTY_NOTE)).toBeNull();
    expect(document.body.textContent ?? '').not.toContain('Your decline was recorded');
  });

  it('names what an empty tab means rather than rendering nothing', async () => {
    stubPitches({ pitches: [], active: [] });
    await renderAt('/creator/campaigns');
    expect(await screen.findByText('No campaign is running yet')).toBeTruthy();
    expect(
      screen.getByText(/Accept a pitch and the campaign, your link, and your terms appear here/),
    ).toBeTruthy();
  });

  it('has no axe violation on either tab', async () => {
    stubPitches({ pitches: [PITCH_ROW], active: [ACTIVE_ROW] });
    const { container } = await renderAt('/creator/campaigns?tab=pitches');
    await screen.findByRole('heading', { name: 'Loopnote' });
    expect((await axe(container)).violations).toEqual([]);
  }, 30_000);
});

/* ══ The reveal ══════════════════════════════════════════════════════════ */

describe('§28.5 — the reveal has a keyboard path, and the recap is not behind it', () => {
  it('advances with a real control that names where it goes', async () => {
    stubPitch();
    await renderAt(`/creator/campaigns/${ASSOCIATION}/opportunity`);

    await screen.findByRole('heading', { level: 1, name: 'Loopnote' });
    expect(screen.getByText('Step 1 of 4')).toBeTruthy();

    const next = screen.getByRole('button', { name: /Continue to The problem/i });
    await userEvent.click(next);
    expect(await screen.findByRole('heading', { level: 1, name: 'The problem' })).toBeTruthy();
    expect(screen.getByText('Step 2 of 4')).toBeTruthy();
  });

  it('offers the recap from the FIRST step, with the sentence that says so', async () => {
    stubPitch();
    await renderAt(`/creator/campaigns/${ASSOCIATION}/opportunity`);
    await screen.findByText('Step 1 of 4');

    expect(screen.getByText(PITCH_WALK_IS_OPTIONAL)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: PITCH_SKIP_LABEL }));

    // All three §14.2 outcomes, without a single step walked.
    expect(await screen.findByRole('button', { name: /Accept standard terms/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Decline this campaign/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Propose different terms/i })).toBeTruthy();
  });

  it('reaches the recap by address, so a reload does not restart the walk', async () => {
    stubPitch();
    await renderAt(`/creator/campaigns/${ASSOCIATION}/opportunity?view=recap`);
    expect(await screen.findByRole('button', { name: /Accept standard terms/i })).toBeTruthy();
    expect(screen.queryByText(/Step 1 of 4/)).toBeNull();
  });

  it('opens on the recap when there is nothing left to decide', async () => {
    stubPitch({ decisionsAvailable: false, associationStatus: 'accepted', campaignStateLabel: 'Accepted' });
    await renderAt(`/creator/campaigns/${ASSOCIATION}/opportunity`);
    await screen.findByRole('heading', { level: 1, name: 'Loopnote' });
    expect(screen.queryByText(/Step 1 of 4/)).toBeNull();
  });

  it('reaches every reveal control by keyboard, with nothing trapped', async () => {
    stubPitch();
    await renderAt(`/creator/campaigns/${ASSOCIATION}/opportunity`);
    await screen.findByText('Step 1 of 4');

    const reachable = new Set<string>();
    for (let i = 0; i < 30; i += 1) {
      await userEvent.tab();
      const active = document.activeElement as HTMLElement | null;
      if (active?.tagName === 'BUTTON' || active?.tagName === 'A') {
        reachable.add((active.textContent ?? '').trim());
      }
    }
    expect([...reachable].some((label) => label.startsWith('Continue to'))).toBe(true);
    expect(reachable.has(PITCH_SKIP_LABEL)).toBe(true);
  }, 30_000);

  it('has no axe violation on the reveal', async () => {
    stubPitch();
    const { container } = await renderAt(`/creator/campaigns/${ASSOCIATION}/opportunity`);
    await screen.findByText('Step 1 of 4');
    expect((await axe(container)).violations).toEqual([]);
  }, 30_000);
});

/* ══ The recap ═══════════════════════════════════════════════════════════ */

describe('§14.1 — the recap', () => {
  it('renders every register section that is a constant', async () => {
    stubPitch();
    await renderAt(`/creator/campaigns/${ASSOCIATION}/opportunity?view=recap`);
    await screen.findByRole('button', { name: /Accept standard terms/i });
    expect(screen.getByText(PITCH_IP_SUMMARY)).toBeTruthy();
  });

  it('labels the Product internal target as internal, and never as a goal (§3.2)', async () => {
    stubPitch();
    await renderAt(`/creator/campaigns/${ASSOCIATION}/opportunity?view=recap`);
    await screen.findByRole('button', { name: /Accept standard terms/i });
    expect(screen.getByText('The Founder’s internal target')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\bgoal\b/i);
  });

  it('refuses to advise a counter, where the reference advises one (§14.2)', async () => {
    stubPitch();
    await renderAt(`/creator/campaigns/${ASSOCIATION}/opportunity?view=recap`);
    await screen.findByRole('button', { name: /Accept standard terms/i });
    expect(screen.getAllByText(PITCH_NO_COUNTER_ADVICE).length).toBeGreaterThan(0);
  });

  it('offers no meeting request and no way to contact the Founder (§30)', async () => {
    stubPitch();
    await renderAt(`/creator/campaigns/${ASSOCIATION}/opportunity?view=recap`);
    await screen.findByRole('button', { name: /Accept standard terms/i });
    for (const control of screen.getAllByRole('button')) {
      expect((control.textContent ?? '').toLowerCase()).not.toMatch(/meeting|message|contact/);
    }
  });

  it('exposes all three outcomes, and calls the second one Decline (§14.2)', async () => {
    stubPitch();
    await renderAt(`/creator/campaigns/${ASSOCIATION}/opportunity?view=recap`);
    expect(await screen.findByRole('button', { name: /Decline this campaign/i })).toBeTruthy();
    for (const control of screen.getAllByRole('button')) {
      expect((control.textContent ?? '').toLowerCase()).not.toMatch(/\breject\b/);
    }
  });

  it('takes four separate confirmations, none prechecked (§28.4)', async () => {
    stubPitch();
    await renderAt(`/creator/campaigns/${ASSOCIATION}/opportunity?view=recap`);
    await userEvent.click(await screen.findByRole('button', { name: /Accept standard terms/i }));

    const boxes = await screen.findAllByRole('checkbox');
    expect(boxes).toHaveLength(4);
    for (const box of boxes) expect(box.getAttribute('aria-checked') ?? box.getAttribute('checked')).not.toBe('true');
    expect(
      screen.getByRole('button', { name: /Confirm acceptance/i }).hasAttribute('disabled'),
    ).toBe(true);
  });

  it('offers only what the server’s §14.3 cell allows (§33.2.8)', async () => {
    stubPitch({
      compensation: {
        basePercent: 30,
        basePercentWithFixed: null,
        bidAllowed: false,
        fixedPaymentAvailable: false,
        ceilingPercent: 50,
      },
    });
    await renderAt(`/creator/campaigns/${ASSOCIATION}/opportunity?view=recap`);
    await userEvent.click(await screen.findByRole('button', { name: /Propose different terms/i }));

    expect(screen.queryByLabelText(/Total percentage/i)).toBeNull();
    expect(screen.queryByLabelText(/Fixed Creator payment request/i)).toBeNull();
    expect(screen.getByText(/only available on a high-effort campaign/i)).toBeTruthy();
    expect(screen.getByText(/not available on an Idea Campaign/i)).toBeTruthy();
  });

  it('has no axe violation on the recap', async () => {
    stubPitch();
    const { container } = await renderAt(`/creator/campaigns/${ASSOCIATION}/opportunity?view=recap`);
    await screen.findByRole('button', { name: /Accept standard terms/i });
    expect((await axe(container)).violations).toEqual([]);
  }, 30_000);

  it('exposes exactly one level-1 heading', async () => {
    stubPitch();
    await renderAt(`/creator/campaigns/${ASSOCIATION}/opportunity?view=recap`);
    await screen.findByRole('button', { name: /Accept standard terms/i });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});

/* ══ Vocabulary ══════════════════════════════════════════════════════════ */

describe('§3.1, §3.2 and §30 — what these surfaces never say', () => {
  it('renders none of the banned terms on either surface', async () => {
    stubPitches({ pitches: [PITCH_ROW], active: [ACTIVE_ROW] });
    const list = await renderAt('/creator/campaigns?tab=pitches');
    await screen.findByRole('heading', { name: 'Loopnote' });
    const listText = document.body.textContent ?? '';
    list.unmount();

    stubPitch();
    await renderAt(`/creator/campaigns/${ASSOCIATION}/opportunity?view=recap`);
    await screen.findByRole('button', { name: /Accept standard terms/i });
    const recapText = document.body.textContent ?? '';

    for (const term of PITCH_BANNED_TERMS) {
      const pattern = new RegExp(`\\b${term}\\b`, 'i');
      expect(pattern.test(listText), `${term} on the list`).toBe(false);
      expect(pattern.test(recapText), `${term} on the recap`).toBe(false);
    }
  }, 30_000);

  it('renders no §3.1 or §3.2 term, through the canonical scanner', async () => {
    // Not a second copy of §3's registers — `namingViolations` IS the register,
    // run against what the surface actually rendered.
    stubPitches({ pitches: [PITCH_ROW], active: [ACTIVE_ROW] });
    const list = await renderAt('/creator/campaigns?tab=pitches');
    await screen.findByRole('heading', { name: 'Loopnote' });
    expect(namingViolations(document.body.textContent ?? '', 'affiliate')).toEqual([]);
    list.unmount();

    stubPitch();
    await renderAt(`/creator/campaigns/${ASSOCIATION}/opportunity?view=recap`);
    await screen.findByRole('button', { name: /Accept standard terms/i });
    expect(namingViolations(document.body.textContent ?? '', 'affiliate')).toEqual([]);
  }, 30_000);

  it('names no Spec section on a customer surface', async () => {
    stubPitch();
    await renderAt(`/creator/campaigns/${ASSOCIATION}/opportunity?view=recap`);
    await screen.findByRole('button', { name: /Accept standard terms/i });
    expect(document.body.textContent ?? '').not.toMatch(/§\s*\d/);
  });
});

/* ══ The register ════════════════════════════════════════════════════════ */

describe('the registers this surface renders from', () => {
  it('has a step for every reveal id, in order', () => {
    expect(PITCH_REVEAL_STEPS.map((s) => s.id)).toEqual([
      'product',
      'problem',
      'solution',
      'earn',
    ]);
  });

  it('resolves every payload-sourced §14.1 section against a real read', () => {
    const payload = { opportunity: OPPORTUNITY, content: CONTENT } as Record<string, unknown>;
    for (const section of PITCH_RECAP_SECTIONS) {
      if (section.source !== 'payload') continue;
      const value = section.field
        ?.split('.')
        .reduce<unknown>(
          (node, key) =>
            node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined,
          payload,
        );
      // `undefined` is the failure and `null` is an answer — a live-campaign
      // block on an initial-roster Creator is legitimately null, and treating
      // that as missing would force a fake object into the payload.
      expect(value, `${section.id} → ${section.field}`).not.toBeUndefined();
    }
  });
});
