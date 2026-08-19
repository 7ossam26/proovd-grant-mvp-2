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
import {
  BASE_CUT_IS_NOT_YOURS_TO_SET,
  BONUS_AFTER_ACCEPTANCE,
  BONUS_COUNTS_TOWARD_THE_CEILING,
  CAMPAIGN_STATUSES,
  CAMPAIGN_STATUS_CHAPTER,
  CHOOSE_ABSENCES,
  COMMUNITY_IS_YOURS_TO_RUN,
  FOUNDER_CHAPTERS,
  MEETING_REQUEST_IS_NOT_A_SCHEDULER,
  MEETING_REQUEST_ONE_MESSAGE,
  NO_DOWNWARD_BID,
} from '@proovd/shared';
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

/* ══════════════════════════════════════════════════════════════════════════
   Chapter 1, Choose — Founder Dashboard Session C.

   The half of C5 that is a property of a rendered surface.
   `backend/src/tests/founder-dashboard-c.test.ts` owns the record and the
   routes; this owns what a Founder can see and press.
   ═════════════════════════════════════════════════════════════════════════ */

const choose = () => `/campaigns/${CAMPAIGN}/home?chapter=choose`;

describe('C1 — the roster is answered, never assembled', () => {
  it('renders the recruited Creators and offers no way to add or send one', async () => {
    installShell({ status: 'affiliate_response_and_build' });
    renderAt(choose());
    await waitFor(() => expect(screen.getAllByText(/@solderandsawdust/).length).toBeGreaterThan(0));

    // §14.5: Proovd owns recruitment follow-up, and §30 defers Founder
    // outreach to unmatched Creators. The reference draws "Send to affiliates".
    for (const label of [/send to/i, /add creator/i, /invite a creator/i, /find creators/i, /browse/i]) {
      expect(screen.queryByRole('button', { name: label })).toBeNull();
      expect(screen.queryByRole('link', { name: label })).toBeNull();
    }
    // Every absence in the register renders its reason somewhere on the page.
    for (const id of ['send_to_roster', 'browse_creators']) {
      const absence = CHOOSE_ABSENCES.find((a) => a.id === id)!;
      expect(screen.getByText(absence.sentence)).toBeTruthy();
    }
  });

  it('offers §14.2’s three responses, and no fourth', async () => {
    installShell({ status: 'affiliate_response_and_build' });
    renderAt(choose());
    await waitFor(() => expect(screen.getByRole('button', { name: /^Accept/ })).toBeTruthy());

    expect(screen.getByRole('button', { name: /Decline this offer/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Offer a different number/ })).toBeTruthy();
    // "Reject match" says the Founder removed somebody, which they cannot.
    expect(screen.queryByRole('button', { name: /reject match/i })).toBeNull();
    expect(
      screen.getByText(CHOOSE_ABSENCES.find((a) => a.id === 'remove_creator')!.sentence),
    ).toBeTruthy();
  });

  it('bounds the revision above base and at the ceiling', async () => {
    installShell({ status: 'affiliate_response_and_build' });
    renderAt(choose());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Offer a different number/ })).toBeTruthy(),
    );
    await userEvent.click(screen.getByRole('button', { name: /Offer a different number/ }));

    // The fixture's base is 30 and its ceiling 50, so the control opens at 43
    // (one below their 44) and cannot be driven to or below 30. A free slider
    // produces refusals a Founder cannot act on — they lower the number to be
    // reasonable and are told the standard terms already give more.
    const group = await screen.findByRole('group', { name: /percentage you are offering/i });
    expect(within(group).getByText('43%')).toBeTruthy();
    const down = within(group).getAllByRole('button')[0]!;
    for (let i = 0; i < 30; i++) {
      if (down.hasAttribute('disabled')) break;
      await userEvent.click(down);
    }
    expect(within(group).getByText('31%')).toBeTruthy();
    expect(down.hasAttribute('disabled')).toBe(true);
  });
});

describe('C2/C4 — the bonus and the meeting request', () => {
  it('offers the bonus only once terms are locked', async () => {
    installShell({ status: 'affiliate_response_and_build' });
    renderAt(choose());
    await waitFor(() => expect(screen.getAllByText(/@solderandsawdust/).length).toBeGreaterThan(0));
    // The open-proposal Creator has no locked terms, so the ceiling has no
    // baseline to be measured against yet (§14.3, `offerCreatorBonus`).
    expect(screen.queryByRole('button', { name: /Offer a bonus/ })).toBeNull();
    expect(screen.getByText(BONUS_AFTER_ACCEPTANCE)).toBeTruthy();
  });

  it('the bonus control counts by result and never by a time window', async () => {
    installShell({ status: 'affiliate_response_and_build' });
    renderAt(`/campaigns/${CAMPAIGN}/home?chapter=choose&creator=assoc-qa-2`);
    await waitFor(() => expect(screen.getByRole('button', { name: /Offer a bonus/ })).toBeTruthy());
    await userEvent.click(screen.getByRole('button', { name: /Offer a bonus/ }));

    // §14.3 names exactly two trigger units. The reference adds "When should it
    // count? — 3 days / 1 week / By campaign end", which is a third rule with
    // no column on `creator_bonuses` behind it.
    expect(await screen.findByRole('radio', { name: /Pre-orders they bring in/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Sales they bring in/ })).toBeTruthy();
    for (const label of [/3 days/i, /1 week/i, /by campaign end/i]) {
      expect(screen.queryByRole('radio', { name: label })).toBeNull();
      expect(screen.queryByRole('button', { name: label })).toBeNull();
    }
    expect(screen.getByText(BONUS_COUNTS_TOWARD_THE_CEILING)).toBeTruthy();
    expect(
      screen.getByText(CHOOSE_ABSENCES.find((a) => a.id === 'bonus_period')!.sentence),
    ).toBeTruthy();
  });

  it('the meeting ask has one message box and no time to pick', async () => {
    installShell({ status: 'affiliate_response_and_build' });
    renderAt(choose());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Ask to talk first/ })).toBeTruthy(),
    );
    await userEvent.click(screen.getByRole('button', { name: /Ask to talk first/ }));

    expect(await screen.findByRole('textbox', { name: /talk about/i })).toBeTruthy();
    // §30 defers a Founder–Creator scheduler and requires §12's human one.
    // The reference offers three slots and "Send meeting invite".
    for (const label of [/tue/i, /wed/i, /fri/i, /10:00/, /send meeting invite/i]) {
      expect(screen.queryByRole('button', { name: label })).toBeNull();
      expect(screen.queryByRole('checkbox', { name: label })).toBeNull();
    }
    expect(screen.getByText(MEETING_REQUEST_IS_NOT_A_SCHEDULER)).toBeTruthy();
    expect(screen.getByText(MEETING_REQUEST_ONE_MESSAGE)).toBeTruthy();
  });

  it('an answered request shows the answer and offers no second message', async () => {
    installShell({ status: 'affiliate_response_and_build' });
    renderAt(`/campaigns/${CAMPAIGN}/home?chapter=choose&creator=assoc-qa-2`);
    await waitFor(() => expect(screen.getByText(/You asked to talk/)).toBeTruthy());
    expect(screen.getByText(/Proovd is arranging the time/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Ask to talk/ })).toBeNull();
    expect(screen.queryByRole('textbox', { name: /talk about/i })).toBeNull();
  });
});

describe('C3 — the two surviving onboarding fields', () => {
  it('renders the base cut read-only, with no way to set it', async () => {
    installShell({ status: 'affiliate_response_and_build' });
    renderAt(choose());
    await waitFor(() => expect(document.querySelector('.fd-hero-num')?.textContent).toBe('30%'));
    expect(screen.getByText(BASE_CUT_IS_NOT_YOURS_TO_SET)).toBeTruthy();
    // §14.2 permits a bid ABOVE base, high-effort only. The reference says
    // "Affiliates can bid higher or lower"; there is no downward bid anywhere.
    expect(screen.getByText(NO_DOWNWARD_BID)).toBeTruthy();
  });

  it('takes the community link and refuses to sell a hosted one', async () => {
    installShell({ status: 'affiliate_response_and_build' });
    renderAt(choose());
    await waitFor(() => expect(screen.getByLabelText(/Link to your community/)).toBeTruthy());
    // §30 defers a hosted Founder community, §1 rule 6 forbids inventing a fee,
    // and §24's three money streams never commingle. The reference charges US$5
    // for Proovd to stand up a Discord server.
    expect(screen.getByText(COMMUNITY_IS_YOURS_TO_RUN)).toBeTruthy();
    const body = document.body.textContent ?? '';
    expect(body).not.toMatch(/\$5\b/);
    expect(body).not.toMatch(/discord/i);
  });
});

describe('the retired addresses', () => {
  it.each([
    ['roster', 'roster'],
    ['creator-readiness', 'creator-readiness'],
  ])('/%s lands in Chapter 1 rather than 404ing', async (_name, segment) => {
    installShell({ status: 'affiliate_response_and_build' });
    renderAt(`/campaigns/${CAMPAIGN}/${segment}`);
    // §27 emails and Appendix C's §34 walk steps point at both, so the address
    // survives its component.
    await waitFor(() => expect(rail()).toBeTruthy());
    const current = within(rail())
      .getAllByRole('button')
      .find((b) => b.getAttribute('aria-current') === 'page');
    expect(current?.textContent?.trim()).toBe('Choose');
  });
});
