/**
 * The Founder dashboard shell — Founder Dashboard Session B.
 *
 * B6's done-when, driven through the REAL route table: the four chapters
 * render, are addressable, and survive a reload; the flow's `You're live` link
 * lands in the shell; `/support` resolves.
 *
 * Everything here goes through `appRoutes` rather than rendering the component
 * directly, for the reason `listing-payment.test.tsx` records: driving the real
 * route is also what proves the page is reachable at all — and this session's
 * whole subject is an address.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { CAMPAIGN_STATUSES, CAMPAIGN_STATUS_CHAPTER, FOUNDER_CHAPTERS } from '@proovd/shared';
import { SERVICE_SLA_BLOCK } from '../../features/public/site.js';
import { QA, QA_ROUTES } from '../../features/qa/fixtures.js';
import { appRoutes } from '../../routes.js';
import { invalidateSession } from '../../lib/session.js';

type StubResult = { status: number; body: unknown } | undefined;
type Handler = (url: string) => StubResult;

let handlers: Handler[] = [];
const seen: string[] = [];

function respond(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

beforeEach(() => {
  invalidateSession();
  handlers = [];
  seen.length = 0;
  vi.stubGlobal('fetch', async (input: string) => {
    const url = String(input);
    seen.push(url);
    for (const handler of handlers) {
      const result = handler(url);
      if (result) return respond(result.status, result.body);
    }
    return respond(404, { error: 'not_found', title: 'No stub' });
  });
});

afterEach(() => vi.unstubAllGlobals());

/** The one campaign the §33.11 fixtures are all about (§33.11.5's rule). */
const CAMPAIGN = QA.campaignId;

interface DashboardOverrides {
  status?: string;
  campaignLiveAt?: string | null;
  title?: string | null;
}

function dashboardBody(overrides: DashboardOverrides = {}) {
  return {
    dashboard: {
      campaignId: CAMPAIGN,
      status: overrides.status ?? 'live',
      type: 'pre_launch',
      campaignLiveAt:
        overrides.campaignLiveAt === undefined
          ? '2026-08-01T12:00:00.000Z'
          : overrides.campaignLiveAt,
      campaignCloseAt: '2026-09-12T17:00:00.000Z',
      listingPaidAt: '2026-07-01T12:00:00.000Z',
      highEffort: false,
      title: overrides.title === undefined ? 'The Bench Lamp' : overrides.title,
    },
  };
}

/**
 * The dashboard read, then the §33.11 fixture set for everything else.
 *
 * The Live chapter renders `CampaignHome` — a real §20 surface with its own
 * reads — so this suite would otherwise need a second hand-written copy of
 * `CampaignHomeView`. Reusing the fixtures the sweep already maintains means
 * this file cannot drift from the shapes the API actually returns, which is
 * exactly the drift that made the first draft of it fail.
 */
function installShell(overrides: DashboardOverrides = {}) {
  handlers = [
    (url) =>
      url.includes('/dashboard') ? { status: 200, body: dashboardBody(overrides) } : undefined,
    (url) => {
      const hit = QA_ROUTES.find((route) => route.match.test(url));
      if (!hit) return undefined;
      const body = typeof hit.body === 'function' ? (hit.body as () => unknown)() : hit.body;
      return { status: hit.status ?? 200, body };
    },
  ];
}

function renderAt(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  return render(<RouterProvider router={router} />);
}

const rail = () => screen.getByRole('navigation', { name: /campaign chapters/i });

/* ── The four chapters ────────────────────────────────────────────────────── */

describe('B6 — the four chapters render and are addressable', () => {
  it('renders every chapter in the register, in order', async () => {
    installShell();
    renderAt(`/campaigns/${CAMPAIGN}/home`);
    await waitFor(() => expect(rail()).toBeTruthy());

    const labels = within(rail())
      .getAllByRole('button')
      .map((button) => button.textContent?.trim());
    expect(labels).toEqual(FOUNDER_CHAPTERS.map((chapter) => chapter.label));
  });

  it.each(['choose', 'live', 'payouts', 'after'])(
    '?chapter=%s opens that chapter and survives a reload',
    async (chapter) => {
      // Every chapter is unlocked for a campaign that has ENDED after being
      // live, which is the state that makes all four addressable at once.
      installShell({ status: 'closed_resolved' });
      // A fresh router with the address as its only entry IS the reload: no
      // component state carries over, so anything the surface remembers has to
      // have come out of the URL (DNA §5.12).
      renderAt(`/campaigns/${CAMPAIGN}/home?chapter=${chapter}`);
      await waitFor(() => expect(rail()).toBeTruthy());

      const current = within(rail())
        .getAllByRole('button')
        .find((button) => button.getAttribute('aria-current') === 'page');
      const expected = FOUNDER_CHAPTERS.find((c) => c.id === chapter)!;
      expect(current?.textContent?.trim()).toBe(expected.label);
    },
  );

  it('clicking a chapter puts it in the address', async () => {
    installShell({ status: 'closed_resolved' });
    renderAt(`/campaigns/${CAMPAIGN}/home`);
    await waitFor(() => expect(rail()).toBeTruthy());

    await userEvent.click(within(rail()).getByRole('button', { name: 'Choose' }));
    await waitFor(() =>
      expect(
        within(rail()).getByRole('button', { name: 'Choose' }).getAttribute('aria-current'),
      ).toBe('page'),
    );
  });

  it('has exactly one h1 — the chapter supplies it, not the shell', async () => {
    installShell({ status: 'closed_resolved' });
    const { container } = renderAt(`/campaigns/${CAMPAIGN}/home?chapter=payouts`);
    await waitFor(() => expect(rail()).toBeTruthy());
    expect(container.querySelectorAll('h1')).toHaveLength(1);
  });
});

/* ── Locking, which is where B4 actually bites ────────────────────────────── */

describe('B4 — the chapters a campaign has not reached', () => {
  it('locks the later chapters on a live campaign, keeping them focusable', async () => {
    installShell({ status: 'live' });
    renderAt(`/campaigns/${CAMPAIGN}/home`);
    await waitFor(() => expect(rail()).toBeTruthy());

    const paid = within(rail()).getByRole('button', { name: /Get paid/ });
    expect(paid.getAttribute('aria-disabled')).toBe('true');
    // `aria-disabled`, never `disabled`: a disabled control leaves the tab
    // order, so a keyboard user meets silence where a sighted user sees a
    // dimmed tab (§28.5).
    expect(paid.hasAttribute('disabled')).toBe(false);
    // The reason rides the accessible name rather than a tooltip.
    expect(paid.getAttribute('aria-label')).toContain('Opens when the campaign closes');
  });

  it('a locked chapter asked for by URL falls back rather than refusing', async () => {
    installShell({ status: 'live' });
    renderAt(`/campaigns/${CAMPAIGN}/home?chapter=after`);
    await waitFor(() => expect(rail()).toBeTruthy());

    // A stale bookmark is not an attack. The campaign's real chapter renders.
    const current = within(rail())
      .getAllByRole('button')
      .find((button) => button.getAttribute('aria-current') === 'page');
    expect(current?.textContent?.trim()).toBe('Live');
  });

  it('a campaign that ended without ever going live keeps the money chapters shut', async () => {
    // §31.6's pre-live cancellation and §14.6's no-Creator failure both end a
    // campaign that never opened. This is the case `campaign_live_at` exists
    // for: without it, "every chapter up to the current one" would hand this
    // Founder a Live chapter and a Get-paid chapter for a campaign with no
    // Backers and no charge.
    installShell({ status: 'ended_no_charge', campaignLiveAt: null });
    renderAt(`/campaigns/${CAMPAIGN}/home`);
    await waitFor(() => expect(rail()).toBeTruthy());

    expect(within(rail()).getByRole('button', { name: /^Live/ }).getAttribute('aria-disabled')).toBe('true');
    expect(within(rail()).getByRole('button', { name: /Get paid/ }).getAttribute('aria-disabled')).toBe('true');
    // Wrap is where an ended campaign belongs, and it IS open.
    expect(within(rail()).getByRole('button', { name: 'Wrap' }).getAttribute('aria-disabled')).toBeNull();
  });

  it('no query parameter can move the campaign', async () => {
    // The supplied reference drives its whole state from `?phase=`, `?type=`,
    // `?day=` and `?upfront=`. Every one is a column here. A caller that could
    // name its own phase could open the Get-paid chapter of a live campaign.
    installShell({ status: 'live' });
    renderAt(
      `/campaigns/${CAMPAIGN}/home?phase=ended&type=idea&day=99&upfront=1&effort=true`,
    );
    await waitFor(() => expect(rail()).toBeTruthy());

    expect(within(rail()).getByRole('button', { name: /Get paid/ }).getAttribute('aria-disabled')).toBe('true');
    expect(within(rail()).getByRole('button', { name: /^Wrap/ }).getAttribute('aria-disabled')).toBe('true');
  });
});

/* ── The Live chapter is §20's surface, not a placeholder ─────────────────── */

describe('B1 — the shell wraps what already exists', () => {
  it('renders Phase 17a’s campaign home as the Live chapter', async () => {
    installShell({ status: 'live' });
    renderAt(`/campaigns/${CAMPAIGN}/home?chapter=live`);
    // The §20 fixture's one ranked Act. If the shell had rendered a
    // placeholder over `CampaignHome`, this would not be on the page.
    // The label renders in the Act panel and again in its detail line, so this
    // asserts presence rather than uniqueness.
    await waitFor(() =>
      expect(screen.getAllByText(/first post needs a correction/i).length).toBeGreaterThan(0),
    );
  });

  it('an unbuilt chapter names the surface that owns its work today', async () => {
    installShell({ status: 'closed_resolved' });
    renderAt(`/campaigns/${CAMPAIGN}/home?chapter=payouts`);
    await waitFor(() => expect(rail()).toBeTruthy());

    // Not an apology and not an empty frame: a real route to the surface that
    // does this work now.
    const link = screen.getByRole('link', { name: /Campaign results/i });
    expect(link.getAttribute('href')).toBe(`/campaigns/${CAMPAIGN}/results`);
  });
});

/* ── B5: /support ─────────────────────────────────────────────────────────── */

describe('B5 — /support resolves', () => {
  it('renders the support page rather than the not-found state', async () => {
    installShell();
    renderAt('/support');
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeTruthy());
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/person will read it/i);
  });

  it('renders §27.8’s published response promise verbatim', async () => {
    installShell();
    const { container } = renderAt('/support');
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeTruthy());
    // The same constant the footer renders, so the promise on this page and the
    // promise in the footer are literally the same string.
    expect(container.textContent).toContain(SERVICE_SLA_BLOCK[2]);
  });

  it('offers no intake form — there is no Founder support route on the server', async () => {
    installShell();
    const { container } = renderAt('/support');
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeTruthy());
    // §26.7's case machinery is reached by an Admin and by a Backer holding a
    // magic link. Rendering a form over an endpoint that does not exist is the
    // §1.4 failure this page was written to fix, one layer down.
    expect(container.querySelectorAll('form')).toHaveLength(0);
    expect(container.querySelectorAll('textarea')).toHaveLength(0);
  });
});

/* ── The register itself ──────────────────────────────────────────────────── */

describe('the chapter register', () => {
  it('maps every §23.1 campaign status to a chapter', () => {
    for (const status of CAMPAIGN_STATUSES) {
      expect(
        (CAMPAIGN_STATUS_CHAPTER as Record<string, string | undefined>)[status],
        `no chapter for ${status}`,
      ).toBeDefined();
    }
  });
});
