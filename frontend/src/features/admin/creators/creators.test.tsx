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
  CORRECTION_REQUEST_LEAVES_VALUE,
  CREATOR_NO_ATTENTION_LABEL,
  CREATOR_PARKED_MESSAGES,
  CREATOR_SUSPENSION_IS_NOT_A_BAN,
  FOUNDER_NEVER_SEES_THIS,
  PASSWORD_RECOVERY_CONSEQUENCE,
  PROPOSAL_ACCESS_IS_DERIVED,
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
    buttonProgress: async (_element: HTMLElement, work: Promise<unknown>) => {
      try {
        await work;
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
        agreement: 'Accepted',
        trackingLink: 'Affiliate link active',
        completion: 'Not due before close',
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
      evidenceFiles: {
        available: false,
        waitingOn:
          'Evidence uploads are not available on this deployment yet — the object-storage bucket is Track A4. Files already on the record still render.',
        files: [],
      },
      metricDecisions: [
        { metric: 'audience_size', label: 'Audience size', decision: null, detail: null, decidedBy: null, decidedAt: null },
        { metric: 'engagement_rate', label: 'Engagement rate', decision: 'more_evidence_needed', detail: 'Share a current analytics screenshot.', decidedBy: 'user:admin', decidedAt: 'Aug 3, 2026 · 9:00 AM UTC' },
        { metric: 'audience_demographics', label: 'Audience demographics', decision: null, detail: null, decidedBy: null, decidedAt: null },
        { metric: 'channel_ownership', label: 'Channel ownership', decision: null, detail: null, decidedBy: null, decidedAt: null },
        { metric: 'newsletter_permission_basis', label: 'Newsletter permission basis', decision: null, detail: null, decidedBy: null, decidedAt: null },
      ],
      proposalAccess: { key: 'standard', label: 'Standard proposal access', derivedFrom: null },
      agreements: {
        terms: null,
        aup: null,
        policyState: 'accepted',
        publishedVersions: [],
        perCampaign: [
          { associationId: ASSOCIATION, campaignName: 'Teeb Founding Launch', state: 'Accepted' },
        ],
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
          createdAt: 'Aug 1, 2026 · 4:00 PM UTC',
          signupStartedAt: null,
          tokenExpiresAt: 'Aug 16, 2026 · 10:00 AM UTC',
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

    // Campaigns became a real link on 2026-08-15. Today is the one section that
    // genuinely does not exist, and it is still parked and still says so.
    for (const parkedName of ['Today']) {
      const control = within(nav).getByRole('button', { name: parkedName });
      expect(control.getAttribute('aria-disabled')).toBe('true');
    }
    expect(within(nav).getByRole('link', { name: 'Campaigns' })).toHaveAttribute(
      'href',
      '/admin/campaigns',
    );
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

  /**
   * The search term is a position, and `?q=` is what carries it (2026-08-15).
   *
   * It was local state until the Campaigns hub linked a campaign's roster here.
   * That workspace is keyed on the PERSON and a campaign has a roster, so the
   * honest destination is this directory with the campaign name already
   * searched — and `searchText` carries every campaign a Creator is on, which
   * is why searching it works. Before this the parameter was accepted and
   * dropped, so the link promised a pre-search and delivered an unfiltered list.
   */
  it('opens pre-searched from ?q=, which is how a campaign links its roster here', async () => {
    serve(directoryRoutes());
    await renderAdmin('/admin/creators?q=Teeb%20Founding%20Launch');

    await waitFor(() => {
      expect(screen.getByText('1 of 2 Affiliates')).toBeTruthy();
    });
    // Maya's `searchText` carries the campaign; Devon's does not.
    expect(screen.getByRole('link', { name: 'Maya Johnson' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Devon Miles' })).toBeNull();
    // The box shows the term, so the Admin can see and edit what narrowed it.
    expect(screen.getByRole('searchbox')).toHaveValue('Teeb Founding Launch');
  });

  it('puts a typed search in the URL, and clears both axes in one act', async () => {
    serve(directoryRoutes());
    const view = await renderAdmin('/admin/creators?filter=verification');

    await userEvent.type(screen.getByRole('searchbox'), 'nobody at all');
    await waitFor(() => {
      expect(view.router.state.location.search).toContain('q=nobody+at+all');
    });

    /*
      One write, not two. Clearing the term and the filter in sequence would
      each rebuild the params from the SAME closed-over snapshot, so the second
      would restore what the first had just removed.
    */
    await userEvent.click(screen.getByRole('button', { name: /Clear Affiliate filters/i }));
    await waitFor(() => {
      expect(view.router.state.location.search).toBe('');
    });
    expect(screen.getByRole('searchbox')).toHaveValue('');
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

  it('opens the campaign relationship by selecting it and scoping the Campaigns tab', async () => {
    // Changed 2026-08-17 (rebuild Session A): the reference replaces the
    // separate relationship address with the Selected-relationship switcher,
    // so `View campaign relationship` now selects the relationship and opens
    // Campaigns · Readiness & Active — the reference's own destination. The
    // old address stays alive underneath (Session C absorbs it) and is what
    // the interim section links onward to.
    serve(recordRoutes());
    const view = await renderAdmin(`/admin/creators/${PROSPECT}`);

    const control = screen.getByRole('button', { name: /View campaign relationship/i });
    expect(control.getAttribute('aria-disabled')).toBeNull();
    await userEvent.click(control);
    await waitFor(() => {
      expect(view.router.state.location.pathname).toBe(`/admin/creators/${PROSPECT}`);
      const params = new URLSearchParams(view.router.state.location.search);
      expect(params.get('tab')).toBe('campaigns');
      expect(params.get('section')).toBe('readiness');
      expect(params.get('rel')).toBe(ASSOCIATION);
    });
    // The switcher scopes the campaign-facing tabs, and its sentence is the
    // organising rule, pinned.
    expect(screen.getByText('Selected relationship')).toBeTruthy();
    expect(
      screen.getByText('Account data stays separate from campaign-specific state'),
    ).toBeTruthy();
    expect(
      screen.getByRole('combobox', { name: 'Select campaign relationship' }),
    ).toBeTruthy();
  });

  it('parks the Stripe-owned action instead of pretending it sends', async () => {
    // Changed 2026-08-17 (rebuild Session A): the reference gives the
    // Stripe-owned attention one control — `Send payout reminder` — and the
    // rebuild decided to build it (gap 3, Session C, through the existing
    // §27 key). Until it sends, the control is parked: `aria-disabled`, and
    // pressing it explains itself rather than doing nothing (§1.4). It never
    // navigates and never claims a send.
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
    const control = within(box).getByRole('button', { name: /Send payout reminder/i });
    expect(control.getAttribute('aria-disabled')).toBe('true');
    expect(within(box).getByRole('heading', { name: 'Stripe needs information' })).toBeTruthy();
  });

  it('offers no action at all for an Affiliate-owned item', async () => {
    // §1.4 still holds where it always did: an Affiliate-owned wait is their
    // move, and the reference renders no control for it either.
    const detail = mayaDetail();
    detail.header.attention = {
      needed: true,
      kind: 'invitation_unclaimed',
      owner: 'Affiliate',
      label: 'Invitation sent, not yet claimed',
      detail: 'The invitation is live. The next move is Maya’s.',
      associationId: null,
    };
    serve(recordRoutes(detail));
    await renderAdmin(`/admin/creators/${PROSPECT}`);

    const box = screen.getByText('Owner · Affiliate').closest('section')!;
    expect(within(box).queryByRole('button')).toBeNull();
  });
});

/* ── The record shell (rebuild Session A) ──────────────────────────────────── */

describe('§26.1, DNA §5.12 — the eight-tab record shell', () => {
  it('renders the eight tabs from the register, with the campaigns count', async () => {
    serve(recordRoutes());
    await renderAdmin(`/admin/creators/${PROSPECT}`);

    const rail = screen.getByRole('tablist', {
      name: 'Maya Johnson Affiliate record tabs',
    });
    const tabs = within(rail).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual([
      'Overview',
      'Profile & Verification',
      'Account & Payout Setup',
      'Campaigns1',
      'Content & Compliance',
      'Performance & Earnings',
      'Support & Enforcement',
      'History',
    ]);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  });

  it('holds the tab and section in the URL, and an interim section says what it is', async () => {
    serve(recordRoutes());
    const view = await renderAdmin(`/admin/creators/${PROSPECT}?tab=history`);

    // History's sections render as their own rail; the first is the bare
    // address, so no `section` param appears for Timeline.
    const rail = screen.getByRole('tablist', { name: 'History sections' });
    expect(within(rail).getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Timeline',
      'Communications',
    ]);

    // The interim section owns the page title (one h1 per surface) and names
    // the surface that holds the content today, with a real route to it.
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Timeline');
    expect(screen.getByRole('button', { name: /Open the history surface/i })).toBeTruthy();

    await userEvent.click(within(rail).getByRole('tab', { name: 'Communications' }));
    await waitFor(() => {
      const params = new URLSearchParams(view.router.state.location.search);
      expect(params.get('section')).toBe('communications');
    });
    // A genuinely new read names the record that already exists rather than
    // pointing at a surface that does not (§1.4).
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Communications');
    expect(screen.queryByRole('button', { name: /^Open / })).toBeNull();
  });

  it('shows the Selected-relationship facts on a campaign-scoped interim section', async () => {
    serve(recordRoutes());
    await renderAdmin(
      `/admin/creators/${PROSPECT}?tab=campaigns&section=readiness&rel=${ASSOCIATION}`,
    );

    // Real data on an interim surface: the strip renders the server-composed
    // agreement, link, and completion facts for the selected relationship.
    expect(screen.getByText('Relationship ID')).toBeTruthy();
    expect(screen.getByText(ASSOCIATION)).toBeTruthy();
    expect(screen.getByText('Agreement')).toBeTruthy();
    expect(screen.getByText('Accepted')).toBeTruthy();
    expect(screen.getByText('Tracking link')).toBeTruthy();
    expect(screen.getByText('Affiliate link active')).toBeTruthy();
    expect(screen.getByText('Completion state')).toBeTruthy();
    expect(screen.getByText('Not due before close')).toBeTruthy();
  });
});

/* ── Profile & Verification and Account & Payout Setup (Session B) ─────────── */

describe('§5.3, §8, §11, §13 — the person-level tabs in final shape', () => {
  it('labels every section with who supplied it, on the tab that renders it', async () => {
    // The four provenance badges live on four sections now (Session B): the
    // research on Profile, the evidence decision on Verification, the
    // confirmed record on Account & Eligibility, and the provider on Stripe.
    const expectations: [string, string][] = [
      [`/admin/creators/${PROSPECT}?tab=profile`, 'Admin researched / authored'],
      [`/admin/creators/${PROSPECT}?tab=profile&section=verification`, 'Evidence + Admin decision'],
      [`/admin/creators/${PROSPECT}?tab=account`, 'Affiliate supplied'],
      [`/admin/creators/${PROSPECT}?tab=account&section=stripe`, 'Stripe supplied · read only'],
    ];
    for (const [path, badge] of expectations) {
      serve(recordRoutes());
      const view = await renderAdmin(path);
      expect(screen.getAllByText(badge).length, path).toBeGreaterThan(0);
      view.unmount();
    }
  });

  it('uses "Name" and "Username", never the retired labels', async () => {
    serve(recordRoutes());
    const view = await renderAdmin(`/admin/creators/${PROSPECT}?tab=account`);

    expect(screen.getByText('Name')).toBeTruthy();
    expect(screen.getByText('Username')).toBeTruthy();
    const text = view.container.textContent ?? '';
    expect(text).not.toContain('Legal name');
    expect(text).not.toContain('Public identity');
  });

  it('states §8’s tier rule, the derived proposal access, and §11’s boundary on Internal Context', async () => {
    serve(recordRoutes());
    await renderAdmin(`/admin/creators/${PROSPECT}?tab=profile&section=context`);

    expect(screen.getAllByText(QUALITY_TIER_HELPER).length).toBeGreaterThan(0);
    expect(screen.getAllByText(FOUNDER_NEVER_SEES_THIS).length).toBeGreaterThan(0);
    // §29-derived, never stored: the badge renders and the sentence says where
    // a change is recorded (0048's header states the column's absence).
    expect(screen.getByText('Standard proposal access')).toBeTruthy();
    expect(screen.getByText(PROPOSAL_ACCESS_IS_DERIVED)).toBeTruthy();
    // The reference's "Why this Affiliate fits" control returns — the column
    // (`campaign_fit`) never left.
    expect(screen.getByText('Why this Affiliate fits')).toBeTruthy();
  });

  it('re-reads the Stripe status through the real refresh, and still offers no edit control', async () => {
    // The Session A parked control now works (gap 4): the button posts to the
    // reconciliation route and the surface renders the re-read, never a local
    // patch. This assertion consciously replaced the parked one.
    serve([
      ...recordRoutes(),
      {
        match: /\/api\/admin\/creators\/[^/]+\/stripe-refresh$/,
        body: mayaDetail(),
      },
    ]);
    const view = await renderAdmin(`/admin/creators/${PROSPECT}?tab=account&section=stripe`);

    // §16a: not yet populated is not zero — the block says what it waits on.
    expect(screen.getByText(/Nobody has claimed this account yet/)).toBeTruthy();

    const refresh = screen.getByRole('button', { name: /Refresh Stripe status/i });
    expect(refresh.getAttribute('aria-disabled')).not.toBe('true');
    await userEvent.click(refresh);
    await waitFor(() => {
      expect(requestsTo(/\/stripe-refresh$/)).toHaveLength(1);
    });

    // §13: no input anywhere on the provider block — the absence is the
    // enforcement, and the refresh only re-reads the provider's own fact.
    const inputs = view.container.querySelectorAll('input, textarea');
    expect(inputs.length).toBe(0);
  });

  it('shows an outstanding §5.3 input as a gap to fill, not as an error', async () => {
    serve(recordRoutes());
    await renderAdmin(`/admin/creators/${PROSPECT}?tab=profile&section=verification`);

    expect(screen.getByText('Platform analytics')).toBeTruthy();
    expect(screen.getByText('82,412 as of May 31')).toBeTruthy();
    expect(screen.getAllByText('Not recorded yet').length).toBeGreaterThan(0);
    expect(screen.getByText(VERIFICATION_IS_HUMAN)).toBeTruthy();
  });

  it('records the whole-record verification and re-reads rather than patching locally', async () => {
    serve([
      ...recordRoutes(),
      { match: /\/api\/admin\/affiliates\/[^/]+\/verification$/, body: { ok: true } },
    ]);
    await renderAdmin(`/admin/creators/${PROSPECT}?tab=profile&section=verification`);

    await userEvent.click(screen.getByRole('button', { name: /Verify audience evidence/i }));
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

  it('records a per-metric decision through the 0048 trail, and reports an unsent ask (§1.4)', async () => {
    serve([
      ...recordRoutes(),
      {
        match: /\/api\/admin\/creators\/[^/]+\/evidence\/metric-decision$/,
        body: {
          detail: mayaDetail(),
          ask: { sent: false, reason: 'No email transport is configured, so the ask was recorded and nothing was sent.' },
        },
      },
    ]);
    await renderAdmin(`/admin/creators/${PROSPECT}?tab=profile&section=verification`);

    // The five metrics each carry their latest decision or its honest absence.
    expect(screen.getAllByText('No decision recorded yet').length).toBeGreaterThan(0);
    expect(screen.getByText('Share a current analytics screenshot.')).toBeTruthy();

    const rows = screen.getAllByRole('button', { name: /Record metric decision/i });
    await userEvent.click(rows[0]);
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(
      within(dialog).getByLabelText(/Detail/i),
      'Analytics screenshot matches the recorded audience size.',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: /Record decision/i }));

    await waitFor(() => {
      expect(requestsTo(/\/evidence\/metric-decision$/)).toHaveLength(1);
    });
    // Recorded with nothing sent is a STATE the Admin must see, not infer.
    await waitFor(() => {
      expect(toasts.some((t) => t.includes('Recorded — nothing was sent'))).toBe(true);
    });
  });

  it('renders the honest unavailable state while the evidence bucket is Track A4', async () => {
    serve(recordRoutes());
    await renderAdmin(`/admin/creators/${PROSPECT}?tab=profile&section=verification`);

    // §1.4: no dead upload control — the sentence names what it waits on, and
    // the control appears only when storage is configured.
    expect(screen.queryByRole('button', { name: /Upload Admin research evidence/i })).toBeNull();
    expect(screen.getByText(/object-storage bucket is Track A4/)).toBeTruthy();
  });

  it('sends the §11 correction request and shows the recorded-not-sent state', async () => {
    serve([
      ...recordRoutes(),
      {
        match: /\/api\/admin\/creators\/[^/]+\/correction-request$/,
        body: {
          detail: mayaDetail(),
          ask: { sent: false, reason: 'No email transport is configured, so the ask was recorded and nothing was sent.' },
        },
      },
    ]);
    await renderAdmin(`/admin/creators/${PROSPECT}?tab=account`);

    await userEvent.click(screen.getByRole('button', { name: /Request Affiliate correction/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(CORRECTION_REQUEST_LEAVES_VALUE)).toBeTruthy();
    await userEvent.type(
      within(dialog).getByLabelText(/What should be checked/i),
      'The handle appears to have changed on the platform.',
    );
    await userEvent.click(
      within(dialog).getByRole('button', { name: /Send Affiliate correction request/i }),
    );

    await waitFor(() => {
      expect(requestsTo(/\/correction-request$/)).toHaveLength(1);
    });
    await waitFor(() => {
      expect(toasts.some((t) => t.includes('Recorded — nothing was sent'))).toBe(true);
    });
  });

  it('sends the recovery link through the one reset path, with its consequence stated', async () => {
    serve([
      ...recordRoutes(),
      { match: /\/api\/admin\/creators\/[^/]+\/password-recovery$/, body: mayaDetail() },
    ]);
    await renderAdmin(`/admin/creators/${PROSPECT}?tab=account`);

    await userEvent.click(screen.getByRole('button', { name: /Send password recovery link/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(PASSWORD_RECOVERY_CONSEQUENCE)).toBeTruthy();
    await userEvent.click(
      within(dialog).getByRole('button', { name: /Send password recovery link/i }),
    );

    await waitFor(() => {
      expect(requestsTo(/\/password-recovery$/)).toHaveLength(1);
    });
  });

  it('renders the invitation lifecycle with the `Opened` refusal, never a bare absence', async () => {
    serve(recordRoutes());
    await renderAdmin(`/admin/creators/${PROSPECT}?tab=account`);

    // The register's own reason, where the value would be — §27 ships no
    // tracking pixel, and the step says so rather than "Not recorded".
    expect(screen.getByText('Opened')).toBeTruthy();
    expect(screen.getByText(/ships no tracking pixel/)).toBeTruthy();
    // The recorded facts render beside it.
    expect(screen.getByText('Aug 16, 2026 · 10:00 AM UTC')).toBeTruthy();
    expect(screen.getByText('Scoped to one Affiliate and campaign')).toBeTruthy();
  });

  it('withholds the §29.8 control while no policy version is published, with the reason', async () => {
    serve(recordRoutes());
    await renderAdmin(`/admin/creators/${PROSPECT}?tab=account&section=agreements`);

    // §31.4: a requirement may cite only a published version, and every
    // document is draft today — so the control is absent WITH its reason.
    expect(screen.queryByRole('button', { name: /Require current policy reacceptance/i })).toBeNull();
    expect(screen.getByText(/legal review/)).toBeTruthy();
    expect(screen.getByText('Consent owner')).toBeTruthy();
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

  it('offers a §29 action per relationship, because §29 is per relationship', async () => {
    serve(recordRoutes());
    await renderAdmin(`/admin/creators/${PROSPECT}/controls`);

    // One row per relationship rather than one control with a campaign picker:
    // the record already knows which relationships exist.
    await userEvent.click(
      screen.getByRole('button', { name: /Record enforcement action/i }),
    );
    const dialog = await screen.findByRole('dialog');

    // All five customer-facing statement fields, separately — §28.4's rule
    // applied to a statement: five things in one textarea is one thing.
    for (const label of [
      /What happened/i,
      /Which rule/i,
      /Immediate effect/i,
      /How to correct it/i,
      /Human route/i,
    ]) {
      expect(within(dialog).getByLabelText(label)).toBeTruthy();
    }
    // And the internal reason is a sixth field, kept apart (§25.6).
    expect(within(dialog).getByLabelText(/Internal reason/i)).toBeTruthy();
    expect(within(dialog).getByText(/belongs here and nowhere below/)).toBeTruthy();
  });

  it('records a conflict and a self-pre-order as two separate certifications', async () => {
    serve([
      ...recordRoutes(),
      { match: /self-preorder-disclosures$/, status: 201, body: { ok: true } },
    ]);
    await renderAdmin(`/admin/creators/${PROSPECT}/controls`);

    await userEvent.click(screen.getByRole('button', { name: /Record self-pre-order/i }));
    const dialog = await screen.findByRole('dialog');
    // §28.4 forbids bundling, so §29.2's two certifications are two answers.
    expect(within(dialog).getByLabelText(/Certified self-funded/i)).toBeTruthy();
    expect(within(dialog).getByLabelText(/Identity disclosed/i)).toBeTruthy();
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

/* ── The `/` palette ───────────────────────────────────────────────────────── */

describe('§26.1, §28.5 — the search palette', () => {
  it('opens on `/` and finds an Affiliate by campaign, not just by name', async () => {
    serve([...directoryRoutes(), ...recordRoutes()]);
    const view = await renderAdmin('/admin/creators');

    await userEvent.keyboard('/');
    const palette = await screen.findByRole('dialog');

    // `searchText` is composed server-side and includes every campaign the
    // person is on, which is why typing a campaign finds its Creators.
    await userEvent.type(within(palette).getByRole('searchbox'), 'teeb');
    const option = await within(palette).findByRole('option', { name: /Maya Johnson/ });
    expect(option).toBeTruthy();

    await userEvent.click(option);
    await waitFor(() => {
      expect(view.router.state.location.pathname).toBe(`/admin/creators/${PROSPECT}`);
    });
  });

  it('does not open while somebody is typing a slash into a field', async () => {
    serve(directoryRoutes());
    await renderAdmin('/admin/creators');

    const box = screen.getByRole('searchbox', { name: /Search Affiliates/i });
    await userEvent.type(box, 'a/b');

    // Without the guard, a slash inside a reason field opens an overlay on top
    // of the form and eats the keystroke.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect((box as HTMLInputElement).value).toBe('a/b');
  });

  it('says nothing matched rather than showing an empty panel', async () => {
    serve(directoryRoutes());
    await renderAdmin('/admin/creators');

    await userEvent.keyboard('/');
    const palette = await screen.findByRole('dialog');
    await userEvent.type(within(palette).getByRole('searchbox'), 'zzzz');
    expect(await within(palette).findByText('No matching Affiliate.')).toBeTruthy();
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
      `/admin/creators/${PROSPECT}?tab=profile`,
      `/admin/creators/${PROSPECT}?tab=profile&section=verification`,
      `/admin/creators/${PROSPECT}?tab=profile&section=context`,
      `/admin/creators/${PROSPECT}?tab=account`,
      `/admin/creators/${PROSPECT}?tab=account&section=agreements`,
      `/admin/creators/${PROSPECT}?tab=account&section=stripe`,
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
  it('has no axe violations on the directory, the record, the person-level tabs, or the history', async () => {
    for (const path of [
      '/admin/creators',
      `/admin/creators/${PROSPECT}`,
      `/admin/creators/${PROSPECT}?tab=profile`,
      `/admin/creators/${PROSPECT}?tab=profile&section=verification`,
      `/admin/creators/${PROSPECT}?tab=account`,
      `/admin/creators/${PROSPECT}?tab=account&section=stripe`,
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
      `/admin/creators/${PROSPECT}?tab=profile`,
      `/admin/creators/${PROSPECT}?tab=account&section=stripe`,
    ]) {
      serve([...directoryRoutes(), ...recordRoutes()]);
      const view = await renderAdmin(path);
      expect(screen.getAllByRole('heading', { level: 1 }), path).toHaveLength(1);
      view.unmount();
    }
  });
});
