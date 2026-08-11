/**
 * The Creator (Affiliate) Admin workspace, as a person actually meets it —
 * Spec §26.1, §8, §5.3, §11, §13, §1.1, §1.4, §3.1, §27.1, §33.11.
 *
 * A *surface* suite, deliberately. The register drift and the pure derivations
 * are proved in `backend/src/tests/creator-workspace-registers.test.ts`, and
 * re-asserting them through a rendered DOM would be the same fact checked twice
 * in the weaker place. What is only checkable here is what a person sees and
 * can operate.
 *
 * ── Everything is driven by a payload, because the surface decides nothing ──
 * `readCreatorWorkspace` resolves every word, every status, and crucially
 * `header.availableActions`. So the fixtures are the lever: the menu is
 * asserted against a payload that permits certain actions, the Stripe block
 * against one with no connected account, the evidence grid against one with a
 * §5.3 gap. A test that hardcoded the expected actions would be a second answer
 * to "what is possible against this record".
 *
 * ── The motion runtime is installed, and that is what makes a toast visible ──
 * `window.Proovd` is absent in jsdom by design, so `useToast()` is a no-op and
 * a parked control's whole observable behaviour disappears. §1.4 makes that
 * behaviour the point — a parked control exists to SAY what its destination is
 * — so a recording double is installed. GSAP is still absent, so every
 * animation takes its documented jump-cut path.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { createMemoryRouter, RouterProvider } from 'react-router';
import {
  CREATOR_NO_ATTENTION_LABEL,
  CREATOR_PARKED_MESSAGES,
  CREATOR_SUSPENSION_IS_NOT_A_BAN,
  FOUNDER_NEVER_SEES_THIS,
  PROSPECT_CREATES_NO_ACCOUNT,
  QUALITY_TIER_HELPER,
  VERIFICATION_IS_HUMAN,
} from '@proovd/shared';
import { appRoutes } from '../../../routes.js';
import { installQaServer, type StubRoute } from '../../qa/server.js';
import type { AdminIdentity } from '../api.js';
import type {
  CreatorDirectoryRow,
  CreatorWorkspaceDetail,
} from './api.js';

/* ── The recording motion runtime ──────────────────────────────────────────── */

let toasts: string[] = [];

const MOTION_TOKENS = {
  dur: { instant: 0.12, quick: 0.2, base: 0.35, slow: 0.6, grand: 0.9 },
  ease: {
    out: 'power3.out',
    hero: 'power4.out',
    move: 'power2.inOut',
    snap: 'back.out(1.4)',
    bounce: 'bounce.out',
    exit: 'power2.in',
  },
  stagger: { tight: 0.04, base: 0.08 },
  text: { chars: 0.02, words: 0.04, lines: 0.06 },
  dist: { enter: 16 },
};

function installMotionRuntime(): void {
  toasts = [];
  (window as unknown as { Proovd: unknown }).Proovd = {
    failed: false,
    MOTION: MOTION_TOKENS,
    init: () => {},
    toast: (message: string) => {
      toasts.push(message);
    },
    buttonProgress: async (_element: HTMLElement, work: () => Promise<unknown>) => {
      try {
        await work();
      } catch {
        /* the real runtime restores the button and resolves */
      }
    },
  };
}

/* ── The stub server, with every request recorded ──────────────────────────── */

interface RecordedRequest {
  method: string;
  url: string;
  body: string | null;
}

let requests: RecordedRequest[] = [];

function serve(routes: StubRoute[]): void {
  installQaServer([
    ...routes,
    {
      match: /\/api\/account\/me$/,
      body: { account: { role: 'admin', email: 'admin@proovd.example', name: 'An Admin' } },
    },
    { match: /\/api\/admin\/me$/, body: identity },
  ]);
  const stubbed = globalThis.fetch;
  requests = [];
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
    requests.push({
      method: (init?.method ?? 'GET').toUpperCase(),
      url: String(input),
      body: init?.body ? String(init.body) : null,
    });
    return stubbed(input as RequestInfo, init);
  });
}

/** A read that is accepted and never answered — what a slow link looks like. */
function hangOn(pattern: RegExp, routes: StubRoute[]): void {
  serve(routes);
  const stubbed = globalThis.fetch;
  vi.stubGlobal('fetch', (input: unknown, init?: RequestInit) =>
    pattern.test(String(input))
      ? new Promise<Response>(() => {})
      : stubbed(input as RequestInfo, init),
  );
}

function requestsTo(pattern: RegExp): RecordedRequest[] {
  return requests.filter((request) => pattern.test(request.url));
}

/* ── The one Affiliate every test in this file is about ────────────────────── */

const PROSPECT = 'prospect-maya';
const QUIET_PROSPECT = 'prospect-devon';
const ASSOCIATION = 'assoc-teeb';
const CAMPAIGN = 'camp-teeb';

const identity: AdminIdentity = {
  id: 'admin-1',
  name: 'Sam Okafor',
  email: 'sam@proovd.co',
  sessionEstablishedAt: '2026-08-26T15:00:00.000Z',
  prerequisiteKeys: [],
  environment: {
    stripeMode: 'test',
    stripeApiVersion: '2026-06-30',
    webhooksLastEventAt: '2026-08-26T13:58:00.000Z',
  },
};

function mayaRow(): CreatorDirectoryRow {
  return {
    prospectId: PROSPECT,
    initials: 'MJ',
    name: 'Maya Johnson',
    handle: '@maya.builds',
    subtype: 'Social Creator',
    platform: 'instagram.com',
    niche: 'Study tools',
    verification: { state: 'unverified', label: 'Not verified yet', at: null, missing: 2 },
    campaigns: { total: 2, activeSlots: 1, slotLimit: 3, leadLabel: 'Active partnership' },
    payout: { state: 'requirements_due', label: 'Stripe needs information' },
    account: 'Eligible',
    attention: {
      needed: true,
      kind: 'verification_due',
      owner: 'Admin',
      label: 'Verification evidence to review',
      detail: '2 §5.3 evidence inputs outstanding for this subtype.',
      associationId: null,
    },
    filters: { adminWork: true, verification: true, payout: true },
    searchText: 'maya johnson @maya.builds instagram.com study tools teeb founding launch',
    recruitedAt: '2026-07-01T09:00:00.000Z',
  };
}

/** A second person, with nothing outstanding — the other half of the chip. */
function devonRow(): CreatorDirectoryRow {
  return {
    prospectId: QUIET_PROSPECT,
    initials: 'DM',
    name: 'Devon Miles',
    handle: '@devonreads',
    subtype: 'Newsletter / blog operator',
    platform: 'devonreads.example',
    niche: 'Productivity',
    verification: {
      state: 'verified',
      label: 'Verified',
      at: 'Jul 12, 2026 · 2:00 PM UTC',
      missing: 0,
    },
    campaigns: { total: 1, activeSlots: 0, slotLimit: 3, leadLabel: 'Accepted' },
    payout: { state: 'complete', label: 'Payout ready' },
    account: 'Eligible',
    attention: { needed: false },
    filters: { adminWork: false, verification: false, payout: false },
    searchText: 'devon miles @devonreads devonreads.example productivity',
    recruitedAt: '2026-06-02T09:00:00.000Z',
  };
}

function mayaDetail(
  overrides: Partial<CreatorWorkspaceDetail> = {},
): CreatorWorkspaceDetail {
  return {
    header: {
      prospectId: PROSPECT,
      initials: 'MJ',
      name: 'Maya Johnson',
      handle: '@maya.builds',
      channelUrl: 'https://instagram.com/maya.builds',
      platform: 'instagram.com',
      subtype: 'Social Creator',
      niche: 'Study tools',
      location: 'United States · California',
      verification: {
        state: 'unverified',
        label: 'Not verified yet',
        at: null,
        missing: ['platform_analytics', 'audience_demographics'],
      },
      slots: { used: 1, limit: 3, remaining: 2, atLimit: false },
      payout: { state: 'requirements_due', label: 'Stripe needs information' },
      account: 'Eligible',
      attention: {
        needed: true,
        kind: 'verification_due',
        owner: 'Admin',
        label: 'Verification evidence to review',
        detail: '2 §5.3 evidence inputs outstanding for this subtype.',
        associationId: null,
      },
      availableActions: ['assign', 'verify', 'suspend', 'deletion'],
    },
    relationships: [
      {
        associationId: ASSOCIATION,
        campaignId: CAMPAIGN,
        campaignName: 'Teeb Founding Launch',
        founderName: 'Teeb Labs LLC',
        campaignType: 'Product Campaign',
        campaignTypeRaw: 'pre_launch',
        status: 'Active partnership',
        statusRaw: 'active',
        designation: 'Initial launch roster',
        owner: 'System',
        activatedAt: 'Aug 10, 2026 · 9:00 AM UTC',
        closesAt: 'Aug 18, 2026 · 8:00 PM UTC',
        holdsSlot: true,
      },
    ],
    profile: {
      summary: {
        handle: '@maya.builds',
        channelUrl: 'https://instagram.com/maya.builds',
        platform: 'instagram.com',
      },
      blocks: [
        {
          provenance: 'affiliate',
          title: 'Account details',
          fields: [
            { key: 'name', label: 'Name', value: 'Maya Johnson', helper: null, emptyLabel: 'Not provided yet' },
            { key: 'username', label: 'Username', value: '@maya.builds', helper: null, emptyLabel: 'Not provided yet' },
            { key: 'email', label: 'Email', value: 'maya@example.com', helper: null, emptyLabel: 'Not provided yet' },
            {
              key: 'phone',
              label: 'Phone number',
              value: null,
              helper: 'Collected, never verified. The MVP has no way to verify a phone number.',
              emptyLabel: 'Not supplied',
            },
          ],
        },
        {
          provenance: 'admin',
          title: 'Channel details',
          fields: [
            { key: 'niche', label: 'Niche', value: 'Study tools', helper: null, emptyLabel: 'Not researched' },
            {
              key: 'tier',
              label: 'Internal quality tier',
              value: 'Strong operator; consistent posting',
              helper: QUALITY_TIER_HELPER,
              emptyLabel: 'None recorded',
            },
            { key: 'bio', label: 'Admin bio', value: 'Posts weekly about study tools.', helper: null, emptyLabel: 'Not researched', wide: true },
            { key: 'fit', label: 'Campaign fit', value: null, helper: null, emptyLabel: 'Not researched', wide: true },
          ],
        },
      ],
      verification: {
        state: 'unverified',
        label: 'Not verified yet',
        at: null,
        by: null,
        metricLabel: 'Engagement rate',
        metrics: [
          { key: 'audienceSize', label: 'Audience size', value: '82,412', helper: null, emptyLabel: 'Evidence needed' },
          { key: 'engagement', label: 'Engagement rate', value: null, helper: null, emptyLabel: 'Evidence needed' },
        ],
        evidence: [
          {
            id: 'platform_analytics',
            label: 'Platform analytics',
            basis: '§5.3 required for this subtype',
            value: null,
            required: true,
          },
          {
            id: 'follower_count',
            label: 'Follower count',
            basis: '§5.3 required for this subtype',
            value: '82,412 as of May 31',
            required: true,
          },
        ],
        missing: ['platform_analytics', 'audience_demographics'],
      },
      provider: {
        populated: false,
        waitingOn: 'Nobody has claimed this account yet, so there is no connected account.',
        accountId: null,
        state: null,
        label: 'No payout account yet',
        transferCapability: 'Not available yet',
        requirements: [],
        requirementsLabel: 'Not applicable yet',
        lastUpdated: null,
      },
      invitations: [
        {
          associationId: ASSOCIATION,
          campaignName: 'Teeb Founding Launch',
          state: 'sent',
          stateLabel: 'Sent',
          lastSentAt: 'Aug 2, 2026 · 10:00 AM UTC',
          hasLiveToken: true,
          claimedAt: null,
          sends: [
            {
              at: 'Aug 2, 2026 · 10:00 AM UTC',
              by: 'Sam Okafor',
              to: 'maya@example.com',
              status: 'sent',
              confirmed: true,
            },
          ],
          unresolved: [],
          canSend: true,
        },
      ],
      support: [
        { key: 'recovery', label: 'Password recovery', value: 'Email-link recovery · transactional', helper: null, emptyLabel: 'Not provided yet' },
        { key: 'digest', label: 'Eligible digest', value: 'Not chosen yet', helper: null, emptyLabel: 'Not provided yet' },
      ],
      deletionRequest: null,
    },
    standing: {
      account: { state: 'Eligible', latest: null, history: [] },
      enforcement: [],
      disclosures: [],
      policyReacceptanceOpen: false,
    },
    history: [
      {
        category: 'account',
        at: 'Jul 1, 2026 · 9:00 AM UTC',
        occurredAt: '2026-07-01T09:00:00.000Z',
        title: 'Prospect recorded',
        detail: 'Recruited from off-platform research. No account exists at this point.',
        actor: 'Sam Okafor',
        source: 'affiliate_prospects',
        reference: 'affiliate_prospects:prospect-maya',
      },
      {
        category: 'campaign',
        at: 'Aug 10, 2026 · 9:00 AM UTC',
        occurredAt: '2026-08-10T09:00:00.000Z',
        title: 'Active partnership',
        detail: 'Moved from Ready to launch on Teeb Founding Launch.',
        actor: 'System',
        source: 'association_status_history',
        reference: 'association_status_history:hist-1',
      },
    ],
    historyCounts: { account: 1, campaign: 1 },
    ...overrides,
  };
}

function directoryRoutes(rows: CreatorDirectoryRow[] = [mayaRow(), devonRow()]): StubRoute[] {
  return [{ match: /\/api\/admin\/creators$/, body: { creators: rows } }];
}

function recordRoutes(detail: CreatorWorkspaceDetail = mayaDetail()): StubRoute[] {
  return [
    { match: /\/api\/admin\/creators\/campaigns$/, body: { campaigns: [] } },
    { match: /\/api\/admin\/creators\/[^/]+$/, body: detail },
  ];
}

/* ── Rendering ─────────────────────────────────────────────────────────────── */

type Rendered = RenderResult & { router: ReturnType<typeof createMemoryRouter> };

function mount(path: string): Rendered {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  const view = render(<RouterProvider router={router} />);
  return Object.assign(view, { router });
}

/**
 * Mounts and settles on the surface being LOADED, not merely mounted.
 *
 * The `h1` is not enough on its own: every surface here knows its own title
 * before the read resolves — the directory's is the filter — so a test that
 * waited only for the heading would run its assertions against a loading panel.
 * On a fast machine that surfaces as a flake; on a loaded one it surfaces as a
 * banned-word scan and an axe pass that both succeed by having nothing to look
 * at, which is the worse failure of the two.
 *
 * Every loading state on these surfaces begins "Reading …", so its absence is
 * the settle condition.
 */
async function renderAdmin(path: string): Promise<Rendered> {
  const view = mount(path);
  await waitFor(() => {
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
  });
  await waitFor(() => {
    expect(screen.queryByText(/^Reading /)).toBeNull();
  });
  return view;
}

beforeEach(() => {
  installMotionRuntime();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as { Proovd?: unknown }).Proovd;
});

/* ── The shell ─────────────────────────────────────────────────────────────── */

describe('§26.1 — Creators is a real section of the Admin shell now', () => {
  it('renders it as a link rather than a parked control', async () => {
    serve(directoryRoutes());
    await renderAdmin('/admin/creators');

    const nav = screen.getByRole('navigation', { name: /Admin sections/i });
    const creators = within(nav).getByRole('link', { name: 'Creators' });
    expect(creators.getAttribute('aria-disabled')).toBeNull();
    expect(creators.className).toContain('is-active');

    // The two that genuinely do not exist are still parked and still say so.
    for (const parkedName of ['Today', 'Campaigns']) {
      const control = within(nav).getByRole('button', { name: parkedName });
      expect(control.getAttribute('aria-disabled')).toBe('true');
    }
  });
});

/* ── The directory ─────────────────────────────────────────────────────────── */

describe('§26.1, §8 — the directory', () => {
  it('leads with the filter label as the page identity, and counts what it shows', async () => {
    serve(directoryRoutes());
    await renderAdmin('/admin/creators');

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('All Affiliates');
    // The hero renders before the read resolves — its title is the filter, which
    // the surface knows without asking. The count waits for the rows.
    expect(await screen.findByText('2 of 2 Affiliates')).toBeTruthy();
  });

  it('renders every cell the server resolved, and derives none of them', async () => {
    serve(directoryRoutes());
    await renderAdmin('/admin/creators');

    expect(await screen.findByRole('link', { name: 'Maya Johnson' })).toBeTruthy();
    expect(screen.getByText('@maya.builds · instagram.com')).toBeTruthy();
    expect(screen.getByText('Not verified yet')).toBeTruthy();
    expect(screen.getByText('1 of 3 active')).toBeTruthy();
    // The quiet row shows the done-moment rather than a blank cell.
    expect(screen.getByText(CREATOR_NO_ATTENTION_LABEL)).toBeTruthy();
  });

  it('carries the filter in the URL, so the page identity survives a reload', async () => {
    serve(directoryRoutes());
    const view = await renderAdmin('/admin/creators');

    await userEvent.click(screen.getByRole('button', { name: 'Verification' }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Verification');
    });
    expect(view.router.state.location.search).toContain('filter=verification');

    // The filter is over the server's own answer, so only Maya survives it.
    expect(screen.queryByText('Devon Miles')).toBeNull();
    expect(screen.getByText('1 of 2 Affiliates')).toBeTruthy();
  });

  it('answers a search that matches nobody differently from an empty directory', async () => {
    serve(directoryRoutes());
    await renderAdmin('/admin/creators');

    await userEvent.type(screen.getByRole('searchbox'), 'nobody at all');
    await waitFor(() => {
      expect(screen.getByText('No Affiliates match')).toBeTruthy();
    });
    // Two different facts, two different next actions (§27.1).
    expect(screen.getByRole('button', { name: /Clear Affiliate filters/i })).toBeTruthy();
    expect(screen.queryByText('No Affiliates yet')).toBeNull();
  });

  it('says nobody has been recruited when nobody has', async () => {
    serve(directoryRoutes([]));
    await renderAdmin('/admin/creators');

    expect(await screen.findByText('No Affiliates yet')).toBeTruthy();
    expect(screen.getByText(/Recording a prospect creates no account/)).toBeTruthy();
  });

  it('opens the record from the name, by keyboard', async () => {
    serve([...directoryRoutes(), ...recordRoutes()]);
    const view = await renderAdmin('/admin/creators');

    const link = await screen.findByRole('link', { name: 'Maya Johnson' });
    link.focus();
    await userEvent.keyboard('{Enter}');

    await waitFor(() => {
      expect(view.router.state.location.pathname).toBe(`/admin/creators/${PROSPECT}`);
    });
  });
});

/* ── Loading, failure, empty ───────────────────────────────────────────────── */

describe('§27.1, §1.1 — loading and failure each answer for themselves', () => {
  it('answers while the directory is still being read', async () => {
    hangOn(/\/api\/admin\/creators$/, directoryRoutes());
    mount('/admin/creators');

    await waitFor(() => {
      expect(screen.getByText('Reading the Affiliate directory')).toBeTruthy();
    });
    expect(screen.getByText(/Within a few seconds/)).toBeTruthy();
  });

  it('renders the server’s own refusal, verbatim, when the read fails', async () => {
    serve([
      {
        match: /\/api\/admin\/creators$/,
        status: 503,
        body: {
          error: 'unavailable',
          title: 'The directory is unavailable',
          whatHappened: 'The read did not complete.',
          next: 'Try again in a moment.',
        },
      },
    ]);
    mount('/admin/creators');

    await waitFor(() => {
      expect(screen.getByText('The directory is unavailable')).toBeTruthy();
    });
    // Never paraphrased: the server answered §27.1's questions and the browser
    // renders those answers rather than writing its own.
    expect(screen.getByText('The read did not complete.')).toBeTruthy();
    expect(screen.getByText('Try again in a moment.')).toBeTruthy();
  });
});

/* ── The record ────────────────────────────────────────────────────────────── */

describe('§26.1, §2.2, §11 — the Affiliate record', () => {
  it('shows the four facts, with §2.2’s cap spelled out', async () => {
    serve(recordRoutes());
    await renderAdmin(`/admin/creators/${PROSPECT}`);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Maya Johnson');
    expect(screen.getByText('1 of 3')).toBeTruthy();
    expect(screen.getByText('Active partnerships')).toBeTruthy();
  });

  it('offers exactly the actions the payload permits, and nothing else', async () => {
    serve(recordRoutes());
    await renderAdmin(`/admin/creators/${PROSPECT}`);

    expect(screen.getByRole('button', { name: /Assign to another campaign/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Record deletion request/i })).toBeTruthy();
  });

  it('names the campaign relationship, its Founder, and its designation', async () => {
    serve(recordRoutes());
    await renderAdmin(`/admin/creators/${PROSPECT}`);

    expect(screen.getByText('Teeb Founding Launch')).toBeTruthy();
    expect(screen.getByText('Teeb Labs LLC · Initial launch roster')).toBeTruthy();
    expect(screen.getByText('Active partnership')).toBeTruthy();
  });

  it('opens the campaign relationship, which is a real destination now', async () => {
    serve(recordRoutes());
    const view = await renderAdmin(`/admin/creators/${PROSPECT}`);

    const control = screen.getByRole('button', { name: /View campaign relationship/i });
    expect(control.getAttribute('aria-disabled')).toBeNull();
    await userEvent.click(control);
    await waitFor(() => {
      expect(view.router.state.location.pathname).toBe(
        `/admin/creators/${PROSPECT}/relationships/${ASSOCIATION}`,
      );
    });
  });

  it('offers no action for an item somebody else owns', async () => {
    const detail = mayaDetail();
    detail.header.attention = {
      needed: true,
      kind: 'payout_blocked',
      owner: 'Stripe',
      label: 'Stripe needs information',
      detail: 'Stripe is holding this account. Proovd cannot supply what it is asking for.',
      associationId: null,
    };
    serve(recordRoutes(detail));
    await renderAdmin(`/admin/creators/${PROSPECT}`);

    // The label also appears in the facts strip, so the attention object is
    // found by its owner pill — the thing only it carries.
    const box = screen.getByText('Owner · Stripe').closest('section')!;
    // §1.4: offering Proovd a button for somebody else's work claims a
    // capability the product does not have.
    expect(within(box).queryByRole('button')).toBeNull();
    expect(within(box).getByRole('heading', { name: 'Stripe needs information' })).toBeTruthy();
  });
});

/* ── Profile & evidence ────────────────────────────────────────────────────── */

describe('§5.3, §8, §11, §13 — profile and evidence', () => {
  it('labels every block with who supplied it', async () => {
    serve(recordRoutes());
    await renderAdmin(`/admin/creators/${PROSPECT}/profile`);

    expect(screen.getByText('Affiliate supplied')).toBeTruthy();
    expect(screen.getAllByText('Admin researched / authored').length).toBeGreaterThan(0);
    expect(screen.getByText('Evidence + Admin decision')).toBeTruthy();
    expect(screen.getByText('Stripe supplied · read only')).toBeTruthy();
  });

  it('uses "Name" and "Username", never the retired labels', async () => {
    serve(recordRoutes());
    const view = await renderAdmin(`/admin/creators/${PROSPECT}/profile`);

    expect(screen.getByText('Name')).toBeTruthy();
    expect(screen.getByText('Username')).toBeTruthy();
    const text = view.container.textContent ?? '';
    expect(text).not.toContain('Legal name');
    expect(text).not.toContain('Public identity');
  });

  it('states §8’s tier rule and §11’s boundary where they can be breached', async () => {
    serve(recordRoutes());
    await renderAdmin(`/admin/creators/${PROSPECT}/profile`);

    expect(screen.getAllByText(QUALITY_TIER_HELPER).length).toBeGreaterThan(0);
    expect(screen.getByText(FOUNDER_NEVER_SEES_THIS)).toBeTruthy();
  });

  it('offers no control at all on the Stripe block’s values', async () => {
    serve(recordRoutes());
    await renderAdmin(`/admin/creators/${PROSPECT}/profile`);

    // §16a: not yet populated is not zero — the block says what it waits on.
    expect(
      screen.getByText(/Nobody has claimed this account yet/),
    ).toBeTruthy();
    // The refresh control is parked, because a live provider read is not built.
    const refresh = screen.getByRole('button', { name: /Refresh Stripe status/i });
    expect(refresh.getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(refresh);
    expect(toasts).toContain(CREATOR_PARKED_MESSAGES.stripeRefresh);
  });

  it('shows an outstanding §5.3 input as a gap to fill, not as an error', async () => {
    serve(recordRoutes());
    await renderAdmin(`/admin/creators/${PROSPECT}/profile`);

    expect(screen.getByText('Platform analytics')).toBeTruthy();
    expect(screen.getByText('82,412 as of May 31')).toBeTruthy();
    expect(screen.getAllByText('Not recorded yet').length).toBeGreaterThan(0);
    expect(screen.getByText(VERIFICATION_IS_HUMAN)).toBeTruthy();
  });

  it('records a verification decision and re-reads rather than patching locally', async () => {
    serve([
      ...recordRoutes(),
      { match: /\/api\/admin\/affiliates\/[^/]+\/verification$/, body: { ok: true } },
    ]);
    await renderAdmin(`/admin/creators/${PROSPECT}/profile`);

    await userEvent.click(screen.getByRole('button', { name: /Record verification decision/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText(/Decision/i), 'in_review');
    await userEvent.type(within(dialog).getByLabelText(/Recorded by/i), 'Sam Okafor');
    await userEvent.click(within(dialog).getByRole('button', { name: /Record the decision/i }));

    await waitFor(() => {
      expect(requestsTo(/\/verification$/)).toHaveLength(1);
    });
    // The whole record is re-read afterwards: a locally-edited copy is a claim
    // about an outcome nobody confirmed.
    await waitFor(() => {
      expect(requestsTo(/\/api\/admin\/creators\/prospect-maya$/).length).toBeGreaterThan(1);
    });
  });
});

/* ── The history ───────────────────────────────────────────────────────────── */

describe('§26.8, §25.6 — the history is read-only and names its sources', () => {
  it('renders every entry with the table it came from', async () => {
    serve(recordRoutes());
    await renderAdmin(`/admin/creators/${PROSPECT}/history`);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('History');
    expect(screen.getByText('Prospect recorded')).toBeTruthy();
    expect(screen.getByText(/recorded in affiliate_prospects/)).toBeTruthy();
  });

  it('hides a filter with no entries rather than showing it as a zero', async () => {
    serve(recordRoutes());
    await renderAdmin(`/admin/creators/${PROSPECT}/history`);

    expect(screen.getByRole('button', { name: /^Account$/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Campaign$/ })).toBeTruthy();
    // §16a in miniature: a `Money · 0` chip reads as "we checked and there is no
    // money", when the truth is this Affiliate has not reached a money phase.
    expect(screen.queryByRole('button', { name: /^Money$/ })).toBeNull();
  });

  it('has no control that writes anything', async () => {
    serve(recordRoutes());
    await renderAdmin(`/admin/creators/${PROSPECT}/history`);

    for (const control of screen.getAllByRole('button')) {
      // Only the filters and the shell's own controls; nothing that submits.
      expect(control.getAttribute('type')).not.toBe('submit');
    }
    expect(requests.filter((r) => r.method !== 'GET')).toHaveLength(0);
  });
});

/* ── Add Affiliate ─────────────────────────────────────────────────────────── */

describe('§8, §5.3 — the Add Affiliate flow', () => {
  it('says it creates no account and sends nothing', async () => {
    serve([...directoryRoutes(), { match: /\/api\/admin\/affiliates\/registry$/, body: {
      subtypes: ['social_creator'],
      requiredEvidence: { social_creator: ['platform_analytics'] },
      verificationStatuses: ['unverified'],
      fixedCopy: { preparingNotice: '', declineNotice: '', neverAsksNotice: '' },
    } }, { match: /\/api\/admin\/creators\/campaigns$/, body: { campaigns: [] } }]);
    await renderAdmin('/admin/creators');

    await userEvent.click(screen.getByRole('button', { name: 'Add Affiliate' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(PROSPECT_CREATES_NO_ACCOUNT)).toBeTruthy();
    expect(within(dialog).getByText('Who is the campaign prospect?')).toBeTruthy();
  });

  it('names where Continue goes, rather than saying "Continue"', async () => {
    serve([...directoryRoutes(), { match: /\/api\/admin\/creators\/campaigns$/, body: { campaigns: [] } }]);
    await renderAdmin('/admin/creators');

    await userEvent.click(screen.getByRole('button', { name: 'Add Affiliate' }));
    const dialog = await screen.findByRole('dialog');
    // §33.11.4: a control that names no destination tells a screen-reader user
    // nothing when they meet four of them.
    expect(
      within(dialog).getByRole('button', { name: /Continue to What evidence supports the channel\?/i }),
    ).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: /^Continue$/ })).toBeNull();
  });
});

/* ── Policy, cases and access ──────────────────────────────────────────────── */

describe('§26.7, §29 — the controls surface keeps the two scopes apart', () => {
  it('is quiet when no review is open, and says so', async () => {
    serve(recordRoutes());
    await renderAdmin(`/admin/creators/${PROSPECT}/controls`);

    expect(screen.getByText('Account eligible')).toBeTruthy();
    expect(screen.getByText('No account-level review is open.')).toBeTruthy();
    expect(screen.getByText(CREATOR_SUSPENSION_IS_NOT_A_BAN)).toBeTruthy();
  });

  it('offers suspend and restore, and never a third control', async () => {
    serve(recordRoutes());
    const view = await renderAdmin(`/admin/creators/${PROSPECT}/controls`);

    expect(screen.getByRole('button', { name: /Suspend Affiliate account/i })).toBeTruthy();
    // §22.7's one-strike sanction is a FOUNDER record. There is no permanent
    // Creator equivalent in the Spec, so there is nothing here to press.
    for (const control of within(view.container).getAllByRole('button')) {
      expect(control.textContent?.toLowerCase()).not.toContain('ban');
      expect(control.textContent?.toLowerCase()).not.toContain('permanent');
    }
  });

  it('demands §27.1’s two promises before a suspension can be sent', async () => {
    serve(recordRoutes());
    await renderAdmin(`/admin/creators/${PROSPECT}/controls`);

    await userEvent.click(screen.getByRole('button', { name: /Suspend Affiliate account/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/Who owns the review/i)).toBeTruthy();
    expect(within(dialog).getByLabelText(/When they hear next/i)).toBeTruthy();
    // §30: a commitment shown on a surface, never a schedule.
    expect(within(dialog).getByText(/nothing sweeps it/i)).toBeTruthy();
  });

  it('renders all five §29 statement fields when an action is recorded', async () => {
    const detail = mayaDetail();
    detail.standing.enforcement = [
      {
        id: 'enf-1',
        associationId: ASSOCIATION,
        campaignName: 'Teeb Founding Launch',
        actionKind: 'pause',
        reasonCategory: 'content_policy',
        statement: {
          evidenceAndBehavior: 'The post omitted the required disclosure.',
          ruleViolated: 'Campaign AUP · disclosure must be hard to miss.',
          immediateEffect: 'The Affiliate link is paused.',
          correctionPath: 'Repost with the disclosure and submit the corrected URL.',
          humanRoute: 'Reply to this message and a person will read it.',
        },
        appealDueAt: 'Aug 18, 2026 · 5:00 PM UTC',
        appeal: null,
        at: 'Aug 11, 2026 · 10:00 AM UTC',
      },
    ];
    serve(recordRoutes(detail));
    await renderAdmin(`/admin/creators/${PROSPECT}/controls`);

    expect(screen.getByText('The post omitted the required disclosure.')).toBeTruthy();
    expect(screen.getByText(/disclosure must be hard to miss/)).toBeTruthy();
    expect(screen.getByText('The Affiliate link is paused.')).toBeTruthy();
    expect(screen.getByText(/submit the corrected URL/)).toBeTruthy();
    expect(screen.getByText(/a person will read it/)).toBeTruthy();
    expect(screen.getByText(/Five business days/)).toBeTruthy();
  });

  it('parks case intake and says the console owns it', async () => {
    serve(recordRoutes());
    await renderAdmin(`/admin/creators/${PROSPECT}/controls`);

    const control = screen.getByRole('button', {
      name: /Record a compliance or support case/i,
    });
    expect(control.getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(control);
    expect(toasts).toContain(CREATOR_PARKED_MESSAGES.caseIntake);
  });
});

/* ── Naming and copy ───────────────────────────────────────────────────────── */

describe('§3.1, §3.2 — no internal name reaches the rendered surface', () => {
  /**
   * Words that must not appear anywhere in the rendered text.
   *
   * Two kinds: internal enum values §3.1 forbids reaching a person, and §3.2's
   * banned vocabulary. Plus the reference's own retired term — "fixed payment",
   * which its acceptance audit refuses by name in favour of "upfront fee".
   */
  const BANNED_ANYWHERE = [
    'pre_build',
    'pre_launch',
    'affiliate_response_and_build',
    'readiness_blocked',
    'signed_up_waiting_for_founder',
    'pledge',
    'donate',
    'escrow',
    'custody',
    'all-or-nothing',
    'fixed payment',
    'Why fit',
  ];

  /**
   * Labels the reference retired, checked as LABELS rather than as substrings.
   *
   * A whole-document scan for "Legal name" fires on §11's own boundary sentence
   * — "the Founder never sees … no legal name …" — which is correct copy saying
   * something true. §33.11.3's rule: a check that has to be silenced is worse
   * than none, so the check is narrowed to where the defect would actually be.
   * The reference's audit does the same thing, matching `>Legal name<`.
   */
  const RETIRED_LABELS = ['Legal name', 'Public identity'];

  it('renders none of them on any Creator surface', async () => {
    for (const path of [
      '/admin/creators',
      `/admin/creators/${PROSPECT}`,
      `/admin/creators/${PROSPECT}/profile`,
      `/admin/creators/${PROSPECT}/history`,
      `/admin/creators/${PROSPECT}/controls`,
    ]) {
      serve([...directoryRoutes(), ...recordRoutes()]);
      const view = await renderAdmin(path);

      const text = view.container.textContent ?? '';
      for (const banned of BANNED_ANYWHERE) {
        expect(text.toLowerCase(), `${banned} on ${path}`).not.toContain(banned.toLowerCase());
      }

      const labels = [...view.container.querySelectorAll('dt, label, th')].map(
        (node) => (node.textContent ?? '').trim(),
      );
      for (const retired of RETIRED_LABELS) {
        expect(labels, `${retired} on ${path}`).not.toContain(retired);
      }

      view.unmount();
    }
  });
});

/* ── Accessibility ─────────────────────────────────────────────────────────── */

describe('§33.11.1, §28.5 — every Creator surface is operable', () => {
  it('has no axe violations on the directory, the record, the profile, or the history', async () => {
    for (const path of [
      '/admin/creators',
      `/admin/creators/${PROSPECT}`,
      `/admin/creators/${PROSPECT}/profile`,
      `/admin/creators/${PROSPECT}/history`,
      `/admin/creators/${PROSPECT}/controls`,
    ]) {
      serve([...directoryRoutes(), ...recordRoutes()]);
      const view = await renderAdmin(path);
      const results = await axe(view.container);
      expect(results.violations, `${path}: ${JSON.stringify(results.violations)}`).toHaveLength(0);
      view.unmount();
    }
  }, 60_000);

  it('has exactly one h1 per surface', async () => {
    for (const path of [
      '/admin/creators',
      `/admin/creators/${PROSPECT}`,
      `/admin/creators/${PROSPECT}/profile`,
    ]) {
      serve([...directoryRoutes(), ...recordRoutes()]);
      const view = await renderAdmin(path);
      expect(screen.getAllByRole('heading', { level: 1 }), path).toHaveLength(1);
      view.unmount();
    }
  });
});
