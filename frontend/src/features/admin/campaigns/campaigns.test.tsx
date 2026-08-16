/**
 * The Campaigns Admin hub, as a person actually meets it —
 * Spec §26.1, §1.1, §1.4, §27.1, §30, §33.11.
 *
 * A *surface* suite, deliberately. The registers, the derivations, and every
 * refusal are proved in `backend/src/tests/campaign-workspace.test.ts`;
 * re-asserting them through a rendered DOM would be the same fact checked twice
 * in the weaker place. What is only checkable here is what a person sees, what
 * they can reach with a keyboard, and — the thing this section is shaped around
 * — which controls exist at all.
 *
 * ── Everything is driven by a payload, because the surface decides nothing ──
 * The server resolves every pill, every blocker, every filter membership and
 * the freshness stamp. So the fixtures are the lever: the not-live state is
 * asserted against a payload with `live: false`, the unpublished state against
 * one with `publicUrl: null`. A test that hardcoded the expected words would be
 * a second answer to "what state is this campaign in".
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { createMemoryRouter, RouterProvider } from 'react-router';
import {
  BLOCKED_COUNT_CAPTION,
  CAMPAIGNS_IS_READ_ONLY,
  CAMPAIGN_BANNED_TERMS,
  CAMPAIGN_COPY,
  CAMPAIGN_FILTER_DEFINITIONS,
  NO_BLOCKER_LABEL,
  NO_PERSON_NEEDED_LABEL,
  THRESHOLD_NOT_SET_NOTE,
} from '@proovd/shared';
import { appRoutes } from '../../../routes.js';
import { installQaServer, type StubRoute } from '../../qa/server.js';
import type { AdminIdentity } from '../api.js';
import type { CampaignDirectoryView, CampaignRecordView } from './api.js';

/* ── The recording motion runtime ──────────────────────────────────────────── */

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

let toasts: string[] = [];

function installMotionRuntime(): void {
  toasts = [];
  (window as unknown as { Proovd: unknown }).Proovd = {
    failed: false,
    MOTION: MOTION_TOKENS,
    init: () => {},
    toast: (message: string) => toasts.push(message),
    /*
      The runtime takes the PROMISE, not the callback — see the note in
      `support.test.tsx`. Nothing here submits, but the shape is kept correct so
      a later control added to this section cannot pass for the wrong reason.
    */
    buttonProgress: async (_element: HTMLElement, work: Promise<unknown>) => {
      try {
        await work;
      } catch {
        /* the real runtime restores the button and resolves */
      }
    },
  };
}

/* ── The stub server ───────────────────────────────────────────────────────── */

interface RecordedRequest {
  method: string;
  url: string;
  body: string | null;
}

let requests: RecordedRequest[] = [];

const identity: AdminIdentity = {
  id: 'admin-1',
  name: 'Sam Okafor',
  email: 'sam@proovd.co',
  sessionEstablishedAt: '2026-08-15T15:00:00.000Z',
  prerequisiteKeys: [],
  environment: {
    stripeMode: 'test',
    stripeApiVersion: '2026-06-30',
    webhooksLastEventAt: '2026-08-15T13:58:00.000Z',
  },
};

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

/* ── Fixtures ──────────────────────────────────────────────────────────────── */

const LIVE_ID = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';
const DRAFT_ID = '11112222-3333-4444-5555-666677778888';

function link(key: string, label: string, detail: string, mark: string, href: string | null, why: string | null) {
  return { key, label, detail, mark, href, unavailableBecause: why };
}

const BUILT_LINKS = [
  link('founder_admin', 'Founder Admin', 'Campaign review: Approved', 'F', '/admin/founders/p-1', null),
  link('affiliate_admin', 'Affiliate Admin', 'Creator work: 3 active', 'A', '/admin/creators?q=Teeb', null),
  link('backer_admin', 'Backer Admin', '109 active pre-orders', 'B', null,
    'There is no Backer workspace. A pre-order has no Admin address of its own.'),
  link('money_admin', 'Money & Fulfillment', 'Listing fee paid', '$', null,
    'The money and fulfillment console is supplied separately.'),
  link('support_admin', 'Support Admin', 'Support cases: 1 open', 'S', '/admin/support', null),
  /* Built 2026-08-16: the destination is the record itself with `?tasks=new`,
     which the shell reads to open the Tasks panel with this campaign chosen. */
  link('tasks', 'Tasks', 'Write a task pointing at this campaign', 'T',
    `/admin/campaigns/${LIVE_ID}?tasks=new`, null),
];

function directoryView(): CampaignDirectoryView {
  return {
    checkedAt: '2026-08-15T14:32:00.000Z',
    blockedCount: 2,
    rows: [
      {
        campaignId: DRAFT_ID,
        displayId: 'CP-111122',
        initials: 'TF',
        name: 'Teeb Founding Launch',
        company: 'Teeb Labs LLC',
        founderName: 'Maya Patel',
        founderHref: '/admin/founders/p-2',
        typeLabel: 'Product Campaign',
        stateLabel: 'Changes requested by Proovd',
        rawStatus: 'changes_required',
        stateKind: 'risk',
        groups: ['needs', 'waiting', 'product'],
        blocker: {
          blocked: true,
          clear: false,
          text: 'Proovd requested changes before this campaign can be approved.',
          owner: 'founder',
          ownerLabel: 'Founder',
          due: 'Waiting for the Founder to resubmit',
          route: link('founder_admin', 'Founder Admin', 'Resubmit', 'F', '/admin/founders/p-2', null),
        },
        dateLabel: 'Launch not set',
        searchText: 'teeb founding launch teeb labs llc maya patel',
      },
      {
        campaignId: LIVE_ID,
        displayId: 'CP-0F1E2D',
        initials: 'BI',
        name: 'Bloom Idea Campaign',
        company: 'Bloom Health LLC',
        founderName: 'Erin Wade',
        founderHref: '/admin/founders/p-1',
        typeLabel: 'Idea Campaign',
        stateLabel: 'Live',
        rawStatus: 'live',
        stateKind: 'live',
        groups: ['live', 'idea'],
        blocker: {
          blocked: false,
          clear: true,
          text: NO_BLOCKER_LABEL,
          owner: 'system',
          ownerLabel: 'System',
          due: 'Closes Aug 21, 2026 · 8:00 PM UTC',
          route: null,
        },
        dateLabel: 'Close Aug 21, 2026',
        searchText: 'bloom idea campaign bloom health llc erin wade',
      },
      {
        campaignId: '99998888-7777-6666-5555-444433332222',
        displayId: 'CP-999988',
        initials: 'CM',
        name: 'Cove Market Test',
        company: 'Cove Home Corp.',
        founderName: 'Priya Singh',
        founderHref: '/admin/founders/p-3',
        typeLabel: 'Product Campaign',
        stateLabel: 'Closed and reconciled',
        rawStatus: 'closed_resolved',
        stateKind: 'closed',
        groups: ['closed', 'product'],
        blocker: {
          blocked: false,
          clear: true,
          text: NO_BLOCKER_LABEL,
          owner: 'system',
          ownerLabel: 'System',
          due: 'All jobs finished',
          route: null,
        },
        dateLabel: 'Closed Aug 2, 2026',
        searchText: 'cove market test cove home corp priya singh',
      },
      {
        campaignId: '77776666-5555-4444-3333-222211110000',
        displayId: 'CP-777766',
        initials: 'FI',
        name: 'Forge Idea Launch',
        company: 'Forge Studio LLC',
        founderName: 'Olivia Grant',
        founderHref: '/admin/founders/p-4',
        typeLabel: 'Idea Campaign',
        stateLabel: 'Live',
        rawStatus: 'live',
        stateKind: 'risk',
        groups: ['needs', 'live', 'idea'],
        blocker: {
          blocked: true,
          clear: false,
          text: '2 support cases are open on this campaign.',
          owner: 'proovd_support',
          ownerLabel: 'Proovd — support',
          due: 'Proovd answers every case within one business day',
          route: link('support_admin', 'Support Admin', 'Open cases', 'S', '/admin/support', null),
        },
        dateLabel: 'Close Aug 24, 2026',
        searchText: 'forge idea launch forge studio llc olivia grant',
      },
    ],
  };
}

function fact(label: string, value: string | null, waitingOn: string | null) {
  return { label, value, waitingOn };
}

function liveRecord(): CampaignRecordView {
  return {
    checkedAt: '2026-08-15T14:32:00.000Z',
    header: {
      campaignId: LIVE_ID,
      displayId: 'CP-0F1E2D',
      name: 'Bloom Idea Campaign',
      company: 'Bloom Health LLC',
      founderName: 'Erin Wade',
      founderHref: '/admin/founders/p-1',
      typeLabel: 'Idea Campaign',
      stateLabel: 'Live',
      rawStatus: 'live',
      stateKind: 'live',
      waitingOnLabel: 'Nobody',
      launch: 'Aug 7, 2026 · 9:00 AM UTC',
      close: 'Aug 21, 2026 · 8:00 PM UTC',
      publicState: 'public',
      publicStateLabel: 'Public',
      publicUrl: 'https://app.proovd.co/campaign/' + LIVE_ID,
      publicUrlUnavailableBecause: null,
    },
    overview: {
      blocker: {
        blocked: false,
        clear: true,
        text: NO_BLOCKER_LABEL,
        owner: 'system',
        ownerLabel: 'System',
        due: 'Closes Aug 21, 2026 · 8:00 PM UTC',
        route: null,
      },
      quickFacts: [
        fact('Type', 'Idea Campaign', null),
        fact('Founder', 'Erin Wade', null),
        fact('Review', 'Approved', null),
        fact('Creator work', '3 active', null),
        fact('Public page', 'Public', null),
      ],
      stages: [
        { key: 'founder_setup', label: 'Founder setup', state: 'done', caption: 'Listing fee paid' },
        { key: 'campaign_review', label: 'Campaign review', state: 'done', caption: 'Approved' },
        { key: 'affiliate_work', label: 'Affiliate work', state: 'done', caption: 'Creator work complete' },
        { key: 'launch_set', label: 'Launch set', state: 'done', caption: 'Aug 7, 2026' },
        { key: 'live', label: 'Live', state: 'done', caption: 'Now' },
        { key: 'closed', label: 'Closed', state: 'current', caption: 'Not yet' },
      ],
      dates: [
        fact('Launch', 'Aug 7, 2026 · 9:00 AM UTC', null),
        fact('Close', 'Aug 21, 2026 · 8:00 PM UTC', null),
        fact('Listing fee paid', 'Aug 1, 2026 · 10:00 AM UTC', null),
        fact('Discovery opened', 'Aug 14, 2026', null),
      ],
      links: BUILT_LINKS,
    },
    liveTab: {
      live: true,
      publicStateLabel: 'Public',
      metrics: {
        active: 109,
        canceled: 6,
        third: {
          label: 'Backers toward threshold',
          value: '109 of 120',
          progress: { percent: 91, threshold: 120, note: null },
        },
      },
      dates: [
        fact('Went live', 'Aug 7, 2026 · 9:00 AM UTC', null),
        fact('Closes', 'Aug 21, 2026 · 8:00 PM UTC', null),
        fact('Public page', 'Public', null),
      ],
      links: [BUILT_LINKS[2]!, BUILT_LINKS[1]!, BUILT_LINKS[4]!],
    },
    close: {
      closed: false,
      heading: 'What happens at close',
      facts: [
        fact('Close time', 'Aug 21, 2026 · 8:00 PM UTC', null),
        fact('Result', null, 'The close batch has not run'),
        fact('Backer charges', null, 'Nothing is charged until the campaign closes'),
        fact('Founder payment', null, 'No Founder payment has been released yet'),
        fact('Delivery', null, 'Delivery begins after charges are final'),
        fact('Support cases', '1 open', null),
        fact('Results', null, 'Results are prepared after the retry window closes'),
      ],
      links: [BUILT_LINKS[2]!, BUILT_LINKS[3]!, BUILT_LINKS[4]!, BUILT_LINKS[1]!],
    },
    history: [
      {
        id: 'status:1',
        at: '2026-08-07T09:00:00.000Z',
        atLabel: 'Aug 7, 2026 · 9:00 AM UTC',
        headline: 'Live',
        detail: 'Moved from “Creators preparing to launch”.',
        tag: 'Proovd',
        source: 'campaign_status_history',
      },
      {
        id: 'listing:1',
        at: '2026-08-01T10:00:00.000Z',
        atLabel: 'Aug 1, 2026 · 10:00 AM UTC',
        headline: 'Listing fee paid',
        detail: 'US$85.00 recorded.',
        tag: 'Money',
        source: 'listing_fee_payments',
      },
    ],
  };
}

/** A campaign that never launched: no public address, no metric hero. */
function draftRecord(): CampaignRecordView {
  const base = liveRecord();
  return {
    ...base,
    header: {
      ...base.header,
      campaignId: DRAFT_ID,
      displayId: 'CP-111122',
      name: 'Teeb Founding Launch',
      company: 'Teeb Labs LLC',
      founderName: 'Maya Patel',
      typeLabel: 'Product Campaign',
      stateLabel: 'Changes requested by Proovd',
      rawStatus: 'changes_required',
      stateKind: 'risk',
      waitingOnLabel: 'Founder',
      launch: 'Not set',
      close: 'Not set',
      publicState: 'private_draft',
      publicStateLabel: 'Not public',
      publicUrl: null,
      publicUrlUnavailableBecause:
        'This campaign has never been public, so it has no public address. A campaign page exists from launch.',
    },
    overview: {
      ...base.overview,
      blocker: {
        blocked: true,
        clear: false,
        text: 'Proovd requested changes before this campaign can be approved.',
        owner: 'founder',
        ownerLabel: 'Founder',
        due: 'Waiting for the Founder to resubmit',
        route: link('founder_admin', 'Founder Admin', 'Resubmit', 'F', '/admin/founders/p-2', null),
      },
      stages: [
        { key: 'founder_setup', label: 'Founder setup', state: 'done', caption: 'Listing fee paid' },
        { key: 'campaign_review', label: 'Campaign review', state: 'current', caption: 'Changes needed' },
        { key: 'affiliate_work', label: 'Affiliate work', state: 'upcoming', caption: '2 recruited' },
        { key: 'launch_set', label: 'Launch set', state: 'upcoming', caption: 'Not set' },
        { key: 'live', label: 'Live', state: 'upcoming', caption: 'Not yet' },
        { key: 'closed', label: 'Closed', state: 'upcoming', caption: 'Not yet' },
      ],
    },
    liveTab: {
      live: false,
      publicStateLabel: 'Not public',
      metrics: null,
      dates: [
        fact('Went live', null, 'Not launched yet'),
        fact('Closes', null, 'Set at launch'),
        fact('Public page', 'Not public', null),
      ],
      links: [BUILT_LINKS[2]!, BUILT_LINKS[1]!, BUILT_LINKS[4]!],
    },
    history: [],
  };
}

/** An Idea campaign whose build never set a threshold — no bar, and it says why. */
function noThresholdRecord(): CampaignRecordView {
  const base = liveRecord();
  return {
    ...base,
    liveTab: {
      ...base.liveTab,
      metrics: {
        active: 4,
        canceled: 0,
        third: {
          label: 'Backers toward threshold',
          value: '4',
          progress: { percent: null, threshold: null, note: THRESHOLD_NOT_SET_NOTE },
        },
      },
    },
  };
}

function routes(record: CampaignRecordView = liveRecord()): StubRoute[] {
  return [
    { match: /\/api\/admin\/campaigns\/[^/?]+$/, body: record },
    { match: /\/api\/admin\/campaigns$/, body: directoryView() },
  ];
}

async function renderAt(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  return render(<RouterProvider router={router} />);
}

beforeEach(() => {
  installMotionRuntime();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as { Proovd?: unknown }).Proovd;
});

/* ── 1. The directory ──────────────────────────────────────────────────────── */

describe('the directory', () => {
  it('renders the hero, the count card, the seven filters, and every row', async () => {
    serve(routes());
    await renderAt('/admin/campaigns');

    // The hero is an h1, so a person arriving from a bookmark has the page
    // named — §33.11.2 caught exactly this missing on the Founder home.
    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent(CAMPAIGN_COPY.directoryTitle);
    expect(screen.getByText(CAMPAIGN_COPY.directoryLede)).toBeInTheDocument();

    // The count is the server's, and its caption is what it counts.
    expect(screen.getByText(BLOCKED_COUNT_CAPTION)).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('blocked')).toBeInTheDocument();

    for (const definition of CAMPAIGN_FILTER_DEFINITIONS) {
      expect(screen.getByRole('button', { name: definition.label })).toBeInTheDocument();
    }

    expect(screen.getByRole('link', { name: /Bloom Idea Campaign/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Cove Market Test/ })).toBeInTheDocument();
  });

  /**
   * §1.4, and the whole point of this section: it summarises and routes. A
   * control that changed a campaign here would be a second door into rules the
   * owning workspace encodes.
   */
  it('offers no control that changes a campaign, and issues no write', async () => {
    serve(routes());
    await renderAt('/admin/campaigns');
    await screen.findByRole('heading', { level: 1 });

    /*
      Word-boundary matches, not substrings, and `close` is deliberately absent
      from the list: `Closed` is one of the seven filters, and a check that
      fired on correct copy would have to be silenced — which is worse than no
      check (§33.11.3's `OBJECTLESS_CTA_LABELS` reasoning, applied to verbs).
      A campaign-closing control would read "Close campaign", which `\bclosing\b`
      would miss and the form/verb assertions below would still catch.
    */
    const labels = screen
      .getAllByRole('button')
      .map((button) => (button.textContent ?? '').toLowerCase());
    const forbidden = /\b(create|edit|approve|reject|launch|pause|suspend|delete|remove|save|refund|kill)\b/;
    for (const label of labels) {
      expect(forbidden.test(label), `a mutating control exists: "${label}"`).toBe(false);
    }
    expect(document.querySelector('form')).toBeNull();
    expect(requests.every((request) => request.method === 'GET')).toBe(true);
  });

  it('states the read-only posture where somebody would look for a button', async () => {
    serve(routes());
    await renderAt('/admin/campaigns');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByText(CAMPAIGNS_IS_READ_ONLY)).toBeInTheDocument();
  });

  /** §30: refresh-based data never claims to be live. */
  it('carries a freshness stamp and none of the banned vocabulary', async () => {
    serve(routes());
    const { container } = await renderAt('/admin/campaigns');
    await screen.findByRole('heading', { level: 1 });

    expect(screen.getByText(/^Checked /)).toBeInTheDocument();
    const text = (container.textContent ?? '').toLowerCase();
    for (const term of CAMPAIGN_BANNED_TERMS) {
      expect(text, `banned term "${term}" is on screen`).not.toContain(term.toLowerCase());
    }
  });

  /**
   * The filters are NOT exclusive and the membership is the server's. Forge is
   * in `needs`, `live` and `idea` at once, so it survives all three.
   */
  it('filters on the server-derived groups, and the filter lives in the URL', async () => {
    const user = userEvent.setup();
    serve(routes());
    await renderAt('/admin/campaigns');
    await screen.findByRole('heading', { level: 1 });

    await user.click(screen.getByRole('button', { name: 'Blocked' }));
    expect(screen.getByRole('link', { name: /Forge Idea Launch/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Teeb Founding Launch/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Cove Market Test/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Idea' }));
    expect(screen.getByRole('link', { name: /Forge Idea Launch/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Bloom Idea Campaign/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Teeb Founding Launch/ })).toBeNull();

    // The definition ships beside the filter (§20's rule).
    const idea = CAMPAIGN_FILTER_DEFINITIONS.find((entry) => entry.key === 'idea')!;
    expect(screen.getByText(idea.counts)).toBeInTheDocument();
  });

  it('searches the haystack the server composed', async () => {
    const user = userEvent.setup();
    serve(routes());
    await renderAt('/admin/campaigns');
    await screen.findByRole('heading', { level: 1 });

    await user.type(screen.getByRole('searchbox', { name: /search campaigns/i }), 'priya');
    expect(screen.getByRole('link', { name: /Cove Market Test/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Bloom Idea Campaign/ })).toBeNull();
  });

  /**
   * The empty state distinguishes "nothing matches this filter" from "no
   * campaign exists" — two different facts, and §27.1's six questions are owed
   * by both.
   */
  it('an empty result says which kind of empty it is, and offers a way back', async () => {
    const user = userEvent.setup();
    serve(routes());
    await renderAt('/admin/campaigns');
    await screen.findByRole('heading', { level: 1 });

    await user.type(screen.getByRole('searchbox', { name: /search campaigns/i }), 'zzzznothing');
    expect(screen.getByText(CAMPAIGN_COPY.emptyTitle)).toBeInTheDocument();
    expect(screen.getByText(/4 campaigns are on the record/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Show all campaigns/ })).toBeInTheDocument();
  });

  it('a campaign nobody owes says so instead of showing a blank cell', async () => {
    serve(routes());
    await renderAt('/admin/campaigns');
    await screen.findByRole('heading', { level: 1 });

    expect(screen.getAllByText(NO_BLOCKER_LABEL).length).toBeGreaterThan(0);
    expect(screen.getAllByText(NO_PERSON_NEEDED_LABEL).length).toBeGreaterThan(0);
    expect(screen.getByText('Owned by Proovd — support')).toBeInTheDocument();
  });

  it('the loading and failure states each answer §27.1', async () => {
    // A read that never resolves is a state a person genuinely sees.
    installQaServer([
      { match: /\/api\/account\/me$/, body: { account: { role: 'admin', email: 'a@b.c', name: 'A' } } },
      { match: /\/api\/admin\/me$/, body: identity },
      { match: /\/api\/admin\/campaigns$/, status: 200, body: new Promise(() => {}) },
    ]);
    const pending = await renderAt('/admin/campaigns');
    expect(await screen.findByText('Reading the campaigns list')).toBeInTheDocument();
    expect(screen.getByText(/who owns the next step/)).toBeInTheDocument();
    pending.unmount();

    serve([
      {
        match: /\/api\/admin\/campaigns$/,
        status: 500,
        body: {
          error: 'unavailable',
          title: 'Proovd could not read the campaigns',
          whatHappened: 'The read failed part-way.',
          next: 'Try again. Nothing was changed.',
        },
      },
    ]);
    await renderAt('/admin/campaigns');
    expect(await screen.findByText('Proovd could not read the campaigns')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try the read again/ })).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    serve(routes());
    const { container } = await renderAt('/admin/campaigns');
    await screen.findByRole('heading', { level: 1 });
    expect(await axe(container)).toHaveNoViolations();
  });
});

/* ── 2. The record ─────────────────────────────────────────────────────────── */

describe('the record', () => {
  it('renders the header, the five facts, and the four tabs', async () => {
    serve(routes());
    await renderAt(`/admin/campaigns/${LIVE_ID}`);

    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Bloom Idea Campaign');
    expect(screen.getByText(/Idea Campaign · CP-0F1E2D/)).toBeInTheDocument();
    expect(screen.getByText('Bloom Health LLC · Founder Erin Wade')).toBeInTheDocument();

    const tabs = screen.getByRole('tablist', { name: /campaign sections/i });
    for (const label of ['Overview', 'Live', 'Close', 'History']) {
      expect(within(tabs).getByRole('tab', { name: label })).toBeInTheDocument();
    }
    expect(within(tabs).getByRole('tab', { selected: true })).toHaveTextContent('Overview');
  });

  /**
   * Two controls, and neither changes anything. This is the assertion the whole
   * section is shaped around.
   */
  it('offers exactly two controls, and both are about the public page', async () => {
    serve(routes());
    await renderAt(`/admin/campaigns/${LIVE_ID}`);
    await screen.findByRole('heading', { level: 1 });

    expect(screen.getByRole('button', { name: 'Copy public link' })).toBeInTheDocument();
    const open = screen.getByRole('link', { name: 'Open public campaign' });
    expect(open).toHaveAttribute('href', `https://app.proovd.co/campaign/${LIVE_ID}`);

    const labels = screen
      .getAllByRole('button')
      .map((button) => (button.textContent ?? '').toLowerCase());
    for (const forbidden of ['approve', 'reject', 'launch', 'pause', 'suspend', 'refund', 'delete', 'save']) {
      expect(labels.some((label) => label.includes(forbidden)), `a "${forbidden}" control exists`).toBe(false);
    }
    expect(document.querySelector('form')).toBeNull();
    expect(requests.every((request) => request.method === 'GET')).toBe(true);
  });

  /**
   * The brief's §9: nothing unpublished becomes publicly reachable through this
   * tab. Structural — there is no address, so there is no control, and the page
   * says why instead of showing a dead button.
   */
  it('a campaign that never went live offers no public control at all', async () => {
    serve(routes(draftRecord()));
    await renderAt(`/admin/campaigns/${DRAFT_ID}`);
    await screen.findByRole('heading', { level: 1 });

    expect(screen.queryByRole('button', { name: 'Copy public link' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open public campaign' })).toBeNull();
    expect(screen.getByText(/has never been public/)).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(`/campaign/${DRAFT_ID}`);
  });

  it('the tab is in the URL and Arrow keys move the rail', async () => {
    const user = userEvent.setup();
    serve(routes());
    await renderAt(`/admin/campaigns/${LIVE_ID}`);
    await screen.findByRole('heading', { level: 1 });

    const tabs = screen.getByRole('tablist', { name: /campaign sections/i });
    await user.click(within(tabs).getByRole('tab', { name: 'Close' }));
    expect(within(tabs).getByRole('tab', { selected: true })).toHaveTextContent('Close');
    expect(screen.getByText(CAMPAIGN_COPY.closeLede)).toBeInTheDocument();

    // Roving tabindex: Tab enters the rail once, arrows move within it.
    within(tabs).getByRole('tab', { selected: true }).focus();
    await user.keyboard('{ArrowRight}');
    expect(within(tabs).getByRole('tab', { selected: true })).toHaveTextContent('History');
    await user.keyboard('{Home}');
    expect(within(tabs).getByRole('tab', { selected: true })).toHaveTextContent('Overview');
  });

  it('the blocker band names the owner and routes; a clear one offers nothing', async () => {
    serve(routes(draftRecord()));
    const blocked = await renderAt(`/admin/campaigns/${DRAFT_ID}`);
    await screen.findByRole('heading', { level: 1 });

    expect(screen.getByText('Current blocker')).toBeInTheDocument();
    // Scoped to the band: "Founder" is also the header's "Waiting on" value, and
    // an unscoped query would pass on either without saying which.
    const band = document.querySelector('.cmp-band')!;
    expect(within(band as HTMLElement).getByText('Owner')).toBeInTheDocument();
    expect(within(band as HTMLElement).getByText('Founder')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open Founder Admin/ })).toHaveAttribute(
      'href',
      '/admin/founders/p-2',
    );
    blocked.unmount();

    serve(routes());
    await renderAt(`/admin/campaigns/${LIVE_ID}`);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByText('On track')).toBeInTheDocument();
    // Scoped to the band. `Open public campaign` is a legitimate header control
    // and an unscoped `/^Open /` would fire on it — the routing control is the
    // one that must be absent when nobody owes anything (§20's caught-up
    // ending: no manufactured CTA).
    const clearBand = document.querySelector('.cmp-band') as HTMLElement;
    expect(within(clearBand).queryByRole('link')).toBeNull();
    expect(within(clearBand).queryByRole('button')).toBeNull();
  });

  it('the six-stage strip renders every stage with a state a reader can hear', async () => {
    serve(routes(draftRecord()));
    await renderAt(`/admin/campaigns/${DRAFT_ID}`);
    await screen.findByRole('heading', { level: 1 });

    // Scoped to the strip: "Live" and "Closed" are also a tab and a filter, and
    // an unscoped query would pass on those without proving the stage rendered.
    const strip = within(document.querySelector('.cmp-steps') as HTMLElement);
    for (const label of ['Founder setup', 'Campaign review', 'Affiliate work', 'Launch set', 'Live', 'Closed']) {
      expect(strip.getByText(label)).toBeInTheDocument();
    }
    // State is never colour alone.
    expect(strip.getAllByText('Complete').length).toBeGreaterThan(0);
    expect(strip.getAllByText('In progress')).toHaveLength(1);
    expect(strip.getAllByText('Not started').length).toBeGreaterThan(0);
  });

  /** §1.4: three destinations do not exist, and each says what it is. */
  it('the routing list shows unbuilt destinations and names what is missing', async () => {
    serve(routes());
    await renderAt(`/admin/campaigns/${LIVE_ID}`);
    await screen.findByRole('heading', { level: 1 });

    expect(screen.getByRole('link', { name: /Founder Admin/ })).toHaveAttribute(
      'href',
      '/admin/founders/p-1',
    );
    expect(screen.getByRole('link', { name: /Support Admin/ })).toHaveAttribute(
      'href',
      '/admin/support',
    );

    for (const label of ['Backer Admin', 'Money & Fulfillment']) {
      const row = screen.getByText(label).closest('.cmp-link');
      expect(row, `${label} row is missing`).not.toBeNull();
      expect(row).toHaveAttribute('aria-disabled', 'true');
      expect(row!.tagName).not.toBe('A');
    }
    expect(screen.getByText(/There is no Backer workspace/)).toBeInTheDocument();
    /* Built 2026-08-16: Tasks routes to this record with `?tasks=new`, which
       the shell reads to open the panel with the campaign preselected. */
    expect(screen.getByRole('link', { name: /Tasks/ })).toHaveAttribute(
      'href',
      `/admin/campaigns/${LIVE_ID}?tasks=new`,
    );
  });

  /* ── The Live tab, in all three of its shapes ───────────────────────────── */

  it('an Idea campaign shows the threshold bar against the build value', async () => {
    const user = userEvent.setup();
    serve(routes());
    await renderAt(`/admin/campaigns/${LIVE_ID}`);
    await screen.findByRole('heading', { level: 1 });
    await user.click(screen.getByRole('tab', { name: 'Live' }));

    expect(screen.getByText('109')).toBeInTheDocument();
    expect(screen.getByText('Active pre-orders')).toBeInTheDocument();
    expect(screen.getByText('109 of 120')).toBeInTheDocument();
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '91');
    // §3.2's own replacement — never "goal", which the bundle scan caught in
    // the first draft of this surface as a minification-surviving property name.
    expect(bar).toHaveAccessibleName('91% of the 120-Backer order threshold');
  });

  /**
   * The prototype hardcodes 120 as the denominator. §14.4 makes it the
   * Founder's own build value, so an unset one draws no bar and says why.
   */
  it('an Idea campaign with no threshold draws no bar and names the absence', async () => {
    const user = userEvent.setup();
    serve(routes(noThresholdRecord()));
    await renderAt(`/admin/campaigns/${LIVE_ID}`);
    await screen.findByRole('heading', { level: 1 });
    await user.click(screen.getByRole('tab', { name: 'Live' }));

    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByText(THRESHOLD_NOT_SET_NOTE)).toBeInTheDocument();
  });

  /** §16a: a hero of three zeros for a campaign that never opened is a lie. */
  it('a campaign that never launched gets the not-live state, not a zeroed hero', async () => {
    const user = userEvent.setup();
    serve(routes(draftRecord()));
    await renderAt(`/admin/campaigns/${DRAFT_ID}`);
    await screen.findByRole('heading', { level: 1 });
    await user.click(screen.getByRole('tab', { name: 'Live' }));

    expect(screen.getByText(CAMPAIGN_COPY.notLiveTitle)).toBeInTheDocument();
    expect(screen.getByText(CAMPAIGN_COPY.notLiveBody)).toBeInTheDocument();
    expect(screen.queryByText('Active pre-orders')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  /* ── Close and History ──────────────────────────────────────────────────── */

  it('the close pane says what each unfinished fact is waiting for', async () => {
    const user = userEvent.setup();
    serve(routes());
    await renderAt(`/admin/campaigns/${LIVE_ID}`);
    await screen.findByRole('heading', { level: 1 });
    await user.click(screen.getByRole('tab', { name: 'Close' }));

    expect(screen.getByText('What happens at close')).toBeInTheDocument();
    expect(screen.getByText('The close batch has not run')).toBeInTheDocument();
    expect(screen.getByText('Nothing is charged until the campaign closes')).toBeInTheDocument();
    expect(screen.getByText(CAMPAIGN_COPY.routeNoteTitle)).toBeInTheDocument();
    // Never a US$0.00 standing in for "this has not happened".
    expect(screen.queryByText('US$0.00')).toBeNull();
  });

  it('the history names the admin page every entry came from', async () => {
    const user = userEvent.setup();
    serve(routes());
    await renderAt(`/admin/campaigns/${LIVE_ID}`);
    await screen.findByRole('heading', { level: 1 });
    await user.click(screen.getByRole('tab', { name: 'History' }));

    expect(screen.getByText('Listing fee paid')).toBeInTheDocument();
    expect(screen.getByText('Money')).toBeInTheDocument();
    expect(screen.getByText('Proovd')).toBeInTheDocument();
    expect(screen.getByText(CAMPAIGN_COPY.historyLede)).toBeInTheDocument();
  });

  it('an empty history says so rather than rendering nothing', async () => {
    const user = userEvent.setup();
    serve(routes(draftRecord()));
    await renderAt(`/admin/campaigns/${DRAFT_ID}`);
    await screen.findByRole('heading', { level: 1 });
    await user.click(screen.getByRole('tab', { name: 'History' }));

    expect(screen.getByText(/Nothing has been recorded against this campaign yet/)).toBeInTheDocument();
  });

  it('the loading and failure states each answer §27.1', async () => {
    installQaServer([
      { match: /\/api\/account\/me$/, body: { account: { role: 'admin', email: 'a@b.c', name: 'A' } } },
      { match: /\/api\/admin\/me$/, body: identity },
      { match: /\/api\/admin\/campaigns\/[^/?]+$/, status: 200, body: new Promise(() => {}) },
    ]);
    const pending = await renderAt(`/admin/campaigns/${LIVE_ID}`);
    expect(await screen.findByText('Reading the campaign')).toBeInTheDocument();
    // The way back exists even while the read is in flight (DNA §5.12).
    expect(screen.getByRole('link', { name: /All campaigns/ })).toBeInTheDocument();
    pending.unmount();

    serve([
      {
        match: /\/api\/admin\/campaigns\/[^/?]+$/,
        status: 404,
        body: {
          error: 'not_found',
          title: 'Campaign not found',
          whatHappened: 'No campaign with that id is on the record.',
          next: 'Open the campaign from the Campaigns list.',
        },
      },
    ]);
    await renderAt(`/admin/campaigns/${LIVE_ID}`);
    expect(await screen.findByText('Campaign not found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /All campaigns/ })).toBeInTheDocument();
  });

  it('has no axe violations on every tab', async () => {
    const user = userEvent.setup();
    serve(routes());
    const { container } = await renderAt(`/admin/campaigns/${LIVE_ID}`);
    await screen.findByRole('heading', { level: 1 });
    expect(await axe(container)).toHaveNoViolations();

    for (const tab of ['Live', 'Close', 'History']) {
      await user.click(screen.getByRole('tab', { name: tab }));
      expect(await axe(container), `${tab} has axe violations`).toHaveNoViolations();
    }
  });
});

/* ── 3. The shell ──────────────────────────────────────────────────────────── */

describe('the Admin shell', () => {
  it('Campaigns is a real link now, and Today is still honestly parked', async () => {
    serve(routes());
    await renderAt('/admin/campaigns');
    await screen.findByRole('heading', { level: 1 });

    const nav = screen.getByRole('navigation', { name: /admin sections/i });
    const campaigns = within(nav).getByRole('link', { name: 'Campaigns' });
    expect(campaigns).toHaveAttribute('href', '/admin/campaigns');
    expect(campaigns).toHaveAttribute('aria-current', 'page');

    const today = within(nav).getByRole('button', { name: 'Today' });
    expect(today).toHaveAttribute('aria-disabled', 'true');
  });
});
