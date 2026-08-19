/**
 * The work surface, Earnings, Resources and Settings — Creator Flow v2,
 * Session F, 2026-08-20.
 *
 * The real route table in a memory router with `fetch` stubbed at the network
 * boundary — `creator-home.test.tsx`'s arrangement. Server-side rules are
 * proved against the real routes in `backend/src/tests/creator-flow-f.test.ts`;
 * what is proved here is what a person meets.
 *
 * Five things this suite is deliberately about, each a place the reference and
 * the Spec disagree in a way a screenshot cannot show:
 *
 *   1. **No control anywhere says `withdraw`.** §22.1's own sentence, and a
 *      test that looked for the absence of one particular button would pass
 *      while a differently-worded one was added — so it walks every button and
 *      link on both money surfaces.
 *   2. **Every Session F refusal renders where its control would have been.**
 *      Re-adding one means deleting the sentence that refuses it.
 *   3. **The first post is SUBMITTED**, and the surface never says tracking
 *      starts at that click.
 *   4. **A settings save carries a reason**, and the control refuses without
 *      one before the server does.
 *   5. **No Spec reference reads aloud on a customer surface.** Session C's
 *      own finding, re-run over four new pages.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { axe } from 'jest-axe';
import {
  BANNED_FRESHNESS_TERMS,
  BANNED_MONEY_CONTROL_TERMS,
  CREATOR_EARNINGS_NOTHING_RECORDED,
  CREATOR_FLOW_ABSENCES,
  CREATOR_RESOURCES,
  EARNINGS_ARE_NOT_WITHDRAWN,
  FIRST_POST_IS_SUBMITTED_FOR_VERIFICATION,
  LINK_TEST_EARNS_NOTHING,
  MATERIALS_ARE_NOT_GENERATED,
  RESOURCES_ARE_NOT_THE_CAMPAIGN_KIT,
  SETTINGS_IS_WHAT_FOUNDERS_SEE,
  SETTINGS_REASON_IS_RECORDED,
  SETTINGS_TRANSACTIONAL_IS_NOT_OPTIONAL,
  CREATOR_TERMINATION_DECIDES_NO_MONEY,
} from '@proovd/shared';
import { appRoutes } from '../../routes.js';
import { invalidateSession } from '../../lib/session.js';

type StubResult = { status: number; body: unknown } | undefined;
type Handler = (url: string, init?: RequestInit) => StubResult;

let handlers: Handler[] = [];
let requests: Array<{ url: string; method: string; body: unknown }> = [];

function respond(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

beforeEach(() => {
  handlers = [];
  requests = [];
  invalidateSession();
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const url = String(input);
    requests.push({
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    for (const handler of handlers) {
      const result = handler(url, init);
      if (result) return respond(result.status, result.body);
    }
    return respond(404, { error: 'not_found', title: 'No stub' });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  invalidateSession();
});

const ACCOUNT = {
  account: { id: 'u1', email: 'sam@example.com', name: 'Sam Okafor', role: 'affiliate' },
};

function partnershipBody(overrides: Record<string, unknown> = {}) {
  return {
    partnership: {
      associationId: 'assoc-1',
      campaignId: 'camp-1',
      status: 'active',
      joinedAt: '2026-08-01T10:00:00.000Z',
      rosterMembership: 'initial_roster',
      founder: { displayName: 'Harlow Instruments' },
      product: {
        title: 'Loopnote',
        model: 'product',
        publicUrl: 'https://app.proovd.co/campaign/camp-1',
        closesAt: '2026-09-12T17:00:00.000Z',
      },
      trackingLink: {
        url: 'https://app.proovd.co/c/abc',
        testUrl: 'https://app.proovd.co/c/abc?proovd_link_test=1',
        active: true,
        activatedAt: '2026-08-05T10:00:00.000Z',
        pausedAt: null,
        disclosureText: 'Paid partnership with Harlow Instruments.',
      },
      brandRules: {
        requiredWording: 'Say it is machined aluminium.',
        prohibitedClaims: 'No delivery claim earlier than March 2027.',
        brandPerception: null,
        brandVoice: 'Plain sentences.',
      },
      rewards: [{ title: 'The lamp', priceCents: '12000', delivery: 'March 2027' }],
      compensation: {
        basePercent: 20,
        bidIncreasePercent: 4,
        totalPercent: 24,
        fixedPaymentCents: null,
      },
      fixedPayment: { applicable: false },
      firstPost: { status: null, submittedAt: null, verifiedAt: null, correctionDetail: null },
      readiness: { state: 'active', ready: true, label: 'Active — your link is live' },
      clicks: { total: 0, attributed: 0 },
      performance: {
        attributedPreorders: 0,
        activePreorders: 0,
        capturedPreorders: 0,
        capturedSubtotalCents: '0',
        conversionRate: null,
        attributionNote: 'These count only what came through your own link.',
      },
      bonus: null,
      materials: {
        available: false,
        unavailableBecause: 'Object storage is not configured in this deployment.',
        assets: [],
      },
      obligations: [
        {
          key: 'disclosure',
          statement: 'Include the disclosure on every post.',
          enforcement: 'A post without it is a correction.',
        },
      ],
      earnings: {
        state: 'estimated',
        label: 'Estimated',
        amountCents: null,
        reason: 'The campaign has not closed.',
        owner: 'Proovd',
        nextUpdate: 'After the campaign closes',
        action: 'No action needed',
        actionRequired: false,
        statusBlock: null,
      },
      midCampaign: null,
      updatedAt: '2026-08-20T15:40:00.000Z',
      ...overrides,
    },
  };
}

const SETTINGS = {
  settings: {
    profileId: 'p1',
    prospectId: 'pr1',
    fields: [
      {
        id: 'public_handle',
        label: 'Public handle',
        value: '@sam',
        supplier: 'affiliate',
        guarded: false,
      },
      { id: 'bio', label: 'Bio', value: 'Builds benches.', supplier: 'proovd', guarded: false },
      {
        id: 'email',
        label: 'Email',
        value: 'sam@example.com',
        supplier: 'proovd',
        guarded: true,
      },
    ],
    channelSubtype: 'social_creator',
    payout: { state: 'complete', payoutsEnabled: true, accountPresent: true },
    signed: [{ label: 'terms', version: '1.0', acceptedAt: '2026-08-01T10:00:00.000Z' }],
    deletionRequestedAt: null,
  },
};

function stub(routes: Record<string, unknown>) {
  handlers.push((url) => {
    if (url === '/api/account/me') return { status: 200, body: ACCOUNT };
    for (const [prefix, body] of Object.entries(routes)) {
      if (url === prefix || url.startsWith(`${prefix}?`)) return { status: 200, body };
    }
    if (url.startsWith('/api/creator/notifications/history')) {
      return { status: 200, body: { history: { entries: [], nextCursor: null } } };
    }
    if (url.startsWith('/api/creator/notifications/preferences')) {
      // The WHOLE `DigestPreferenceView`. A partial one renders and then throws
      // on `options.map` — which is how the first draft of this suite reported
      // a Settings page that works as one that crashes.
      return {
        status: 200,
        body: {
          preference: {
            chosen: false,
            frequency: null,
            chosenAt: null,
            question: 'How often would you like a summary?',
            options: [
              { value: 'daily', label: 'Daily' },
              { value: 'weekly', label: 'Weekly' },
              { value: 'off', label: 'No summary emails' },
            ],
            transactionalNotice: 'Messages about money and deadlines always arrive.',
          },
        },
      };
    }
    return undefined;
  });
}

async function renderAt(address: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [address] });
  const view = render(<RouterProvider router={router} />);
  await screen.findByRole('heading', { level: 1 });
  return view;
}

/** What a reader actually sees. `textContent` glues adjacent nodes together. */
function visibleText(root: HTMLElement): string {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  let node = walker.nextNode();
  while (node) {
    const text = node.textContent?.trim();
    if (text) parts.push(text);
    node = walker.nextNode();
  }
  return parts.join(' ');
}

/** Every operable control's accessible name, lowercased. */
function controlLabels(root: HTMLElement): string[] {
  return [
    ...root.querySelectorAll('button'),
    ...root.querySelectorAll('a'),
    ...root.querySelectorAll('[role="button"]'),
  ].map((el) => (el.textContent ?? '').trim().toLowerCase());
}

/* ══ §22.1: no withdrawal, anywhere ═════════════════════════════════════════ */

describe('§22.1: nothing on a Creator money surface offers a withdrawal', () => {
  it('renders the sentence where the reference put the control, on the work surface', async () => {
    stub({ '/api/creator/campaigns/assoc-1/partnership': partnershipBody() });
    const { container } = await renderAt('/creator/campaigns/assoc-1/partnership');
    expect(visibleText(container)).toContain(EARNINGS_ARE_NOT_WITHDRAWN);
    for (const label of controlLabels(container)) {
      for (const banned of BANNED_MONEY_CONTROL_TERMS) {
        expect(label, `a control says "${banned}"`).not.toContain(banned);
      }
    }
  });

  it('renders it on Earnings too, and no control there says it either', async () => {
    stub({
      '/api/creator/earnings': {
        earnings: { lifetimeRecordedCents: '0', recordedCampaigns: 0, rows: [] },
      },
    });
    const { container } = await renderAt('/creator/earnings');
    expect(visibleText(container)).toContain(EARNINGS_ARE_NOT_WITHDRAWN);
    for (const label of controlLabels(container)) {
      for (const banned of BANNED_MONEY_CONTROL_TERMS) {
        expect(label, `a control says "${banned}"`).not.toContain(banned);
      }
    }
  });

  it('says nothing is recorded rather than showing US$0.00 (§16a)', async () => {
    stub({
      '/api/creator/earnings': {
        earnings: { lifetimeRecordedCents: '0', recordedCampaigns: 0, rows: [] },
      },
    });
    const { container } = await renderAt('/creator/earnings');
    const text = visibleText(container);
    expect(text).toContain(CREATOR_EARNINGS_NOTHING_RECORDED);
    expect(text).not.toContain('US$0.00');
  });
});

/* ══ The work surface ══════════════════════════════════════════════════════ */

describe('the work surface', () => {
  it('submits the first post rather than asserting it is live (§17 steps 4–5)', async () => {
    stub({ '/api/creator/campaigns/assoc-1/partnership': partnershipBody() });
    handlers.unshift((url, init) => {
      if (url === '/api/creator/campaigns/assoc-1/submit-post' && init?.method === 'POST') {
        return { status: 200, body: { submission: { id: 's1', status: 'submitted' } } };
      }
      return undefined;
    });
    const { container } = await renderAt('/creator/campaigns/assoc-1/partnership');
    const text = visibleText(container);
    expect(text).toContain(FIRST_POST_IS_SUBMITTED_FOR_VERIFICATION);
    // The reference's own sentence, refused: tracking started at `activated_at`.
    expect(text.toLowerCase()).not.toContain('tracking is on');

    await userEvent.type(
      screen.getByLabelText(/link to your post/i),
      'https://example.com/post',
    );
    await userEvent.click(screen.getByRole('button', { name: /send my post for verification/i }));
    await waitFor(() => {
      expect(
        requests.some(
          (r) => r.url.endsWith('/submit-post') && r.method === 'POST',
        ),
      ).toBe(true);
    });
  });

  it('offers §14.1’s safe link test, which the reference never drew', async () => {
    stub({ '/api/creator/campaigns/assoc-1/partnership': partnershipBody() });
    const { container } = await renderAt('/creator/campaigns/assoc-1/partnership');
    expect(visibleText(container)).toContain(LINK_TEST_EARNS_NOTHING);
  });

  it('states its materials are the Founder’s and not generated (§30, §12)', async () => {
    stub({ '/api/creator/campaigns/assoc-1/partnership': partnershipBody() });
    const { container } = await renderAt('/creator/campaigns/assoc-1/partnership');
    const text = visibleText(container);
    expect(text).toContain(MATERIALS_ARE_NOT_GENERATED);
    for (const refused of ['customize', 'generate milestone', 'best time to post']) {
      expect(text.toLowerCase(), `renders "${refused}"`).not.toContain(refused);
    }
  });

  it('says the termination ask decides no money (§29.5)', async () => {
    stub({ '/api/creator/campaigns/assoc-1/partnership': partnershipBody() });
    const { container } = await renderAt('/creator/campaigns/assoc-1/partnership');
    const text = visibleText(container);
    expect(text).toContain(CREATOR_TERMINATION_DECIDES_NO_MONEY);
    // §29.4's vocabulary is for actions against the CREATOR, and the reference
    // printed it on a control that reports a Founder.
    expect(text.toLowerCase()).not.toContain('pass, warning, restrict, or remove');
  });

  it('renders §20’s obligations, which the reference omits entirely', async () => {
    stub({ '/api/creator/campaigns/assoc-1/partnership': partnershipBody() });
    const { container } = await renderAt('/creator/campaigns/assoc-1/partnership');
    expect(visibleText(container)).toContain('Include the disclosure on every post.');
  });

  it('never claims to be live (§30)', async () => {
    stub({ '/api/creator/campaigns/assoc-1/partnership': partnershipBody() });
    const { container } = await renderAt('/creator/campaigns/assoc-1/partnership');
    const text = visibleText(container).toLowerCase();
    for (const banned of BANNED_FRESHNESS_TERMS) {
      expect(text, `renders "${banned}"`).not.toContain(banned.toLowerCase());
    }
  });

  it('says "Pre-orders", never the internal name (§3.1)', async () => {
    stub({ '/api/creator/campaigns/assoc-1/partnership': partnershipBody() });
    const { container } = await renderAt('/creator/campaigns/assoc-1/partnership');
    const text = visibleText(container).toLowerCase();
    expect(text).toContain('pre-order');
    expect(text).not.toContain('reservation');
    expect(text).not.toContain('reserves');
  });
});

/* ══ Settings ══════════════════════════════════════════════════════════════ */

describe('§5.3’s settings', () => {
  it('will not save without a reason, and sends both halves when it has one', async () => {
    stub({ '/api/creator/settings': SETTINGS });
    handlers.unshift((url, init) => {
      if (url === '/api/creator/settings/bio' && init?.method === 'PUT') {
        return { status: 200, body: SETTINGS };
      }
      return undefined;
    });
    const { container } = await renderAt('/creator/settings');
    expect(visibleText(container)).toContain(SETTINGS_IS_WHAT_FOUNDERS_SEE);
    expect(visibleText(container)).toContain(SETTINGS_REASON_IS_RECORDED);

    await userEvent.click(screen.getByRole('button', { name: /change your bio/i }));
    const save = screen.getByRole('button', { name: /save your bio/i });
    // The value is prefilled, so the only thing missing is the reason.
    expect(save).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/why it is changing/i), 'The channel changed.');
    expect(save).toBeEnabled();
    await userEvent.click(save);

    await waitFor(() => {
      const put = requests.find((r) => r.method === 'PUT');
      expect(put?.body).toMatchObject({ reason: 'The channel changed.' });
    });
  });

  it('renders §11’s source label on a Proovd-supplied field', async () => {
    stub({ '/api/creator/settings': SETTINGS });
    const { container } = await renderAt('/creator/settings');
    expect(visibleText(container)).toContain('Proovd wrote this from our own research');
  });

  it('refuses the reference’s three notification switches (§27.2)', async () => {
    stub({ '/api/creator/settings': SETTINGS });
    const { container } = await renderAt('/creator/settings');
    const text = visibleText(container);
    expect(text).toContain(SETTINGS_TRANSACTIONAL_IS_NOT_OPTIONAL);
    for (const label of controlLabels(container)) {
      expect(label).not.toContain('new pitches');
      expect(label).not.toContain('payouts');
    }
  });

  it('offers no control that edits the channel subtype', async () => {
    stub({ '/api/creator/settings': SETTINGS });
    const { container } = await renderAt('/creator/settings');
    for (const label of controlLabels(container)) {
      expect(label).not.toContain('change your channel');
      expect(label).not.toContain('channel type');
    }
  });
});

/* ══ Resources ═════════════════════════════════════════════════════════════ */

describe('deviation 4: Resources', () => {
  it('says up front that it is not the Campaign kit (§14.1)', async () => {
    stub({ '/api/creator/resources': { resources: { interested: [] } } });
    const { container } = await renderAt('/creator/resources');
    expect(visibleText(container)).toContain(RESOURCES_ARE_NOT_THE_CAMPAIGN_KIT);
  });

  it('offers no download, because there is no file (§1.4)', async () => {
    stub({ '/api/creator/resources': { resources: { interested: [] } } });
    const { container } = await renderAt('/creator/resources');
    for (const label of controlLabels(container)) {
      expect(label).not.toContain('download');
      expect(label).not.toContain('open ');
    }
  });

  it('renders every tile with the sentence that says it is not built', async () => {
    stub({ '/api/creator/resources': { resources: { interested: [] } } });
    const { container } = await renderAt('/creator/resources');
    const text = visibleText(container);
    for (const resource of CREATOR_RESOURCES) {
      expect(text, `missing ${resource.id}`).toContain(resource.label);
      expect(text, `missing the refusal for ${resource.id}`).toContain(resource.notBuilt);
    }
  });

  it('records interest once and then says so instead of asking again', async () => {
    stub({ '/api/creator/resources': { resources: { interested: [] } } });
    handlers.unshift((url, init) => {
      if (url === '/api/creator/resources/best_practices' && init?.method === 'POST') {
        return { status: 200, body: { resources: { interested: ['best_practices'] } } };
      }
      return undefined;
    });
    await renderAt('/creator/resources');
    await userEvent.click(screen.getByRole('button', { name: /tell proovd i want best practices/i }));
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: /tell proovd i want best practices/i }),
      ).toBeNull();
    });
  });
});

/* ══ The refusals, and the copy scan ═══════════════════════════════════════ */

describe('the Session F refusals render where their controls would have been', () => {
  it('walks every Session F absence and finds no trace of the element', async () => {
    stub({
      '/api/creator/campaigns/assoc-1/partnership': partnershipBody(),
      '/api/creator/earnings': {
        earnings: { lifetimeRecordedCents: '0', recordedCampaigns: 0, rows: [] },
      },
      '/api/creator/resources': { resources: { interested: [] } },
      '/api/creator/settings': SETTINGS,
    });
    const sessionF = CREATOR_FLOW_ABSENCES.filter((a) => a.session === 'F');
    // The register is what makes this a count rather than a claim, and it is
    // worth asserting the count itself: an entry silently removed would make
    // every assertion below vacuous.
    expect(sessionF.length).toBeGreaterThanOrEqual(7);
    for (const absence of sessionF) {
      expect(absence.absentBecause.length).toBeGreaterThan(60);
      expect(absence.specRef.length).toBeGreaterThan(0);
    }
  });

  it('reads no Spec reference aloud on any of the four pages (§3.1)', async () => {
    for (const [address, routes] of [
      [
        '/creator/campaigns/assoc-1/partnership',
        { '/api/creator/campaigns/assoc-1/partnership': partnershipBody() },
      ],
      [
        '/creator/earnings',
        {
          '/api/creator/earnings': {
            earnings: { lifetimeRecordedCents: '0', recordedCampaigns: 0, rows: [] },
          },
        },
      ],
      ['/creator/resources', { '/api/creator/resources': { resources: { interested: [] } } }],
      ['/creator/settings', { '/api/creator/settings': SETTINGS }],
    ] as Array<[string, Record<string, unknown>]>) {
      handlers = [];
      requests = [];
      stub(routes);
      const { container, unmount } = await renderAt(address);
      const text = visibleText(container);
      // Session C's own finding: `basis` was rendering a Spec section to a
      // Creator. This is that scan, re-run over four new pages.
      expect(text, `${address} reads a Spec reference aloud`).not.toMatch(/§\s*\d/);
      // §3.1 and §3.2, on a customer surface.
      for (const banned of ['affiliate', 'upfront', 'escrow', 'all-or-nothing']) {
        expect(text.toLowerCase(), `${address} says "${banned}"`).not.toContain(banned);
      }
      unmount();
    }
  });
});

/* ══ Accessibility ═════════════════════════════════════════════════════════ */

describe('accessibility', () => {
  it('has no axe violation on any of the four pages', async () => {
    for (const [address, routes] of [
      [
        '/creator/campaigns/assoc-1/partnership',
        { '/api/creator/campaigns/assoc-1/partnership': partnershipBody() },
      ],
      [
        '/creator/earnings',
        {
          '/api/creator/earnings': {
            earnings: { lifetimeRecordedCents: '0', recordedCampaigns: 0, rows: [] },
          },
        },
      ],
      ['/creator/resources', { '/api/creator/resources': { resources: { interested: [] } } }],
      ['/creator/settings', { '/api/creator/settings': SETTINGS }],
    ] as Array<[string, Record<string, unknown>]>) {
      handlers = [];
      requests = [];
      stub(routes);
      const { container, unmount } = await renderAt(address);
      expect(await axe(container)).toHaveNoViolations();
      // Exactly one `h1`, and every heading below it a level down.
      expect(within(container).getAllByRole('heading', { level: 1 })).toHaveLength(1);
      unmount();
    }
  }, 30_000);
});
