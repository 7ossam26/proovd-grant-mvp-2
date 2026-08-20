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
  ACKNOWLEDGEMENT_HAS_NO_MESSAGE,
  ACKNOWLEDGEMENT_NOT_WHILE_UNDER_CORRECTION,
  BASE_CUT_IS_NOT_YOURS_TO_SET,
  BONUS_AFTER_ACCEPTANCE,
  BONUS_COUNTS_TOWARD_THE_CEILING,
  CAMPAIGN_STATUSES,
  CAMPAIGN_STATUS_CHAPTER,
  CHOOSE_ABSENCES,
  CLARIFICATION_IS_ANSWERED_HERE,
  COMMUNITY_IS_YOURS_TO_RUN,
  EARLY_RELEASE_NEVER_SKIPS_DAY_14,
  EDITABLE_FIELDS,
  EDIT_TIER_GROUPS,
  FOUNDER_CHAPTERS,
  FOUNDER_CHAPTER_BUILD,
  LIVE_ABSENCES,
  MEETING_REQUEST_IS_NOT_A_SCHEDULER,
  MEETING_REQUEST_ONE_MESSAGE,
  NO_DOWNWARD_BID,
  PRINCIPAL_FLOWS,
  NO_PAYMENT_REQUEST,
  PAID_ABSENCES,
  RETRY_WINDOW_IS_STORED,
  RETRY_WINDOW_OUTCOME,
  W9_IS_NOT_UPLOADED_HERE,
  BACKER_DATA_REQUEST_GRANTS_NO_ACCESS,
  DO_NOT_FULFILL_LABEL,
  EXPORT_CANNOT_CARRY_A_CONSENT_CONDITION,
  FOUNDER_EXPORT_WITHHELD,
  REFUSED_BACKER_DATA_PURPOSES,
  RESOLUTION_IS_NOT_FULFILLMENT,
  WRAP_ABSENCES,
  liveAbsence,
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
 * The Live chapter is a real §20 surface with its own
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

  it('no chapter is interim any more, and the shell has no branch left for one', async () => {
    /*
      DELIBERATELY RETIRED (Session F, 2026-08-20). This asserted the interim
      panel's shape — a real route to the surface that owned the work, and the
      session that would replace it. Session E moved it from Get paid onto
      Wrap; Session F built Wrap, so the assertion would now be asserting that
      Session F did not happen.

      What replaces it is the fact that made it dead: every chapter's
      `ownedForNowBy` is null, and `ChapterBody` is an exhaustive switch over a
      closed union — so there is no interim branch for a fifth state to fall
      into, and adding a chapter without a component fails the BUILD.
    */
    for (const chapter of FOUNDER_CHAPTERS) {
      expect(
        FOUNDER_CHAPTER_BUILD[chapter.id].ownedForNowBy,
        `${chapter.id} still names a surface that owns its work`,
      ).toBeNull();
    }
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

/* ══════════════════════════════════════════════════════════════════════════
   Session D — Chapter 2, Live
   ══════════════════════════════════════════════════════════════════════════ */

const live = () => `/campaigns/${CAMPAIGN}/home?chapter=live`;

describe('D1 — Glance, and the hero that is a count rather than money', () => {
  it('leads with the active pre-order count and the permanent not-charged notice', async () => {
    installShell();
    renderAt(live());
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeTruthy());

    // §20 names Glance's one large number: the active pre-order count.
    expect(screen.getByText('active pre-orders')).toBeTruthy();
    // §20's permanent clarification, not a tooltip and not below a fold.
    expect(screen.getByText(/No card has been charged/)).toBeTruthy();
  });

  it('renders no money hero and no ranking — four mechanisms, all absent', async () => {
    installShell();
    renderAt(live());
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeTruthy());
    const body = document.body.textContent ?? '';

    // The reference's hero: `$12,840 Money made`. Nothing has been captured
    // during a live campaign — capture is §21's close batch (§30).
    expect(body).not.toMatch(/money made/i);
    expect(body).not.toMatch(/gross raised/i);
    expect(body).not.toMatch(/checkout sentiment/i);

    // Disagreement 2: a ranking is four mechanisms, not one. The h1 claim, the
    // numbered badges, the podium's medal, and the sort.
    expect(body).not.toMatch(/is leading/i);
    expect(body).not.toMatch(/leaderboard/i);
    expect(body).not.toMatch(/\bpodium\b/i);
    expect(screen.queryByText(/^#[0-9]+$/)).toBeNull();
  });

  it('mints ONE home read and refreshes through explore (§33.6.6)', async () => {
    installShell();
    renderAt(live());
    await waitFor(() => expect(screen.getByText('active pre-orders')).toBeTruthy());

    const homeReads = seen.filter((url) => /\/home$/.test(url.split('?')[0] ?? ''));
    expect(homeReads).toHaveLength(1);
    // And the acknowledgement went out — after the render committed, which is
    // the whole reason it lives in an effect rather than in the fetch.
    await waitFor(() => expect(seen.some((url) => url.includes('/home/seen'))).toBe(true));
  });

  it('copies the campaign’s own address, never a Creator’s /c/ link', async () => {
    installShell();
    renderAt(live());
    await waitFor(() => expect(screen.getByText('active pre-orders')).toBeTruthy());

    // The label is short so it does not ellipsise at 320 (the browser pass's
    // finding); the ADDRESS is what the control carries and copies, so that is
    // what this asserts.
    const url = document.querySelector('.copylink__url')?.getAttribute('title') ?? '';
    expect(url).toContain(`/campaign/${CAMPAIGN}`);
    // `/c/…` is §18's per-Creator tracking ingest. Sharing one would credit a
    // Creator for people the Founder brought in themselves.
    expect(url).not.toMatch(/\/c\//);
    expect(screen.getByText(liveAbsence('creator_tracking_link').sentence)).toBeTruthy();
  });
});

describe('D2 — §20’s three tiers get their first UI', () => {
  it('groups the picker by tier and never lets the surface choose one', async () => {
    installShell();
    renderAt(live());
    await waitFor(() => expect(screen.getByLabelText(/What do you want to change/)).toBeTruthy());

    const picker = screen.getByLabelText(/What do you want to change/) as HTMLSelectElement;
    const groups = [...picker.querySelectorAll('optgroup')].map((g) => g.getAttribute('label'));
    expect(groups).toEqual(EDIT_TIER_GROUPS.map((group) => group.label));

    // §15: materiality is an Admin judgement. There is no control anywhere on
    // this surface that could name a tier.
    expect(screen.queryByLabelText(/tier/i)).toBeNull();
    expect(screen.queryByRole('radio', { name: /publish directly/i })).toBeNull();
  });

  it('a locked field renders its reason and offers nothing to submit', async () => {
    installShell();
    renderAt(live());
    await waitFor(() => expect(screen.getByLabelText(/What do you want to change/)).toBeTruthy());

    const locked = EDITABLE_FIELDS.find((f) => f.tier === 'never_direct')!;
    await userEvent.selectOptions(
      screen.getByLabelText(/What do you want to change/),
      `${locked.surface}:${locked.field}`,
    );

    // §20's third column. The refusal replaces the control, and no request is
    // opened — the route refuses independently, which the backend suite drives.
    await waitFor(() => expect(screen.getByText(locked.reason)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /Save the change/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Send it to Proovd/ })).toBeNull();
  });

  it('a column-two field asks for a reason before it will send', async () => {
    installShell();
    renderAt(live());
    await waitFor(() => expect(screen.getByLabelText(/What do you want to change/)).toBeTruthy());

    const review = EDITABLE_FIELDS.find(
      (f) => f.tier === 'requires_review' && f.surface === 'build',
    )!;
    await userEvent.selectOptions(
      screen.getByLabelText(/What do you want to change/),
      `${review.surface}:${review.field}`,
    );
    await waitFor(() => expect(screen.getByLabelText(/Why are you changing it/)).toBeTruthy());

    // §15 records a reason with every material change; the control cannot send
    // without one, and the server refuses without one regardless (§1.1).
    const send = screen.getByRole('button', { name: /Send it to Proovd/ });
    expect(send.hasAttribute('disabled')).toBe(true);
  });
});

describe('D3 and deviation 2 — updates, and the post acknowledgement', () => {
  it('offers only the audiences §18 allows for this campaign model', async () => {
    installShell();
    renderAt(live());
    await waitFor(() => expect(screen.getByLabelText(/Who sees this/)).toBeTruthy());

    const audiences = [...(screen.getByLabelText(/Who sees this/) as HTMLSelectElement).options].map(
      (option) => option.value,
    );
    // The fixture campaign is a Product one, so §18's Idea-only milestone
    // audience is absent — the server's rule, rendered rather than restated.
    expect(audiences).toContain('general_public');
    expect(audiences).toContain('backer_only');
    expect(audiences).not.toContain('milestone_progress');
  });

  it('offers the acknowledgement with no note field anywhere', async () => {
    installShell();
    renderAt(live());
    await waitFor(() => expect(screen.getByRole('button', { name: /Tell them you saw it/ })).toBeTruthy());

    // The reference's toast reads "Liked — creator will see it", which makes it
    // a message; §30 defers direct Founder–Affiliate messaging, so it carries
    // no free text and the record has no column for one.
    expect(screen.getByText(ACKNOWLEDGEMENT_HAS_NO_MESSAGE)).toBeTruthy();
    expect(screen.queryByLabelText(/note/i)).toBeNull();
    expect(screen.queryByRole('textbox', { name: /message|note|say/i })).toBeNull();
  });

  it('replaces the control with its reason on a post Proovd has queried', async () => {
    installShell();
    renderAt(live());
    await waitFor(() =>
      expect(screen.getByText(ACKNOWLEDGEMENT_NOT_WHILE_UNDER_CORRECTION)).toBeTruthy(),
    );

    // The second fixture post is `correction_needed`: acknowledging it would
    // tell the Creator their Founder liked work Proovd asked them to change.
    expect(screen.getAllByRole('button', { name: /Tell them you saw it/ })).toHaveLength(1);
  });

  it('routes a problem with a post to Proovd rather than to the Creator', async () => {
    installShell();
    renderAt(live());
    // Wait on something only the posts panel renders. `@solderandsawdust` also
    // appears in the Act panel's detail, which resolves from the EARLIER `home`
    // read — so waiting on the handle passes before the posts have arrived, and
    // the assertion below then races them. It passed alone and failed under the
    // full suite's load, which is exactly what that shape looks like.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Tell them you saw it/ })).toBeTruthy(),
    );

    // The reference draws "I have an issue" with a free-text box that goes to
    // the Creator. §20 makes post review Proovd's, and §26.7's case machinery
    // is where a problem belongs.
    expect(screen.queryByRole('button', { name: /I have an issue/i })).toBeNull();
    expect(screen.getByText(liveAbsence('post_issue').sentence)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Get help with a post/ })).toBeTruthy();
  });
});

describe('the Live chapter’s absences', () => {
  it('renders every register entry’s sentence somewhere on the chapter', async () => {
    installShell();
    renderAt(live());

    // The absences are spread across four panels with four independent reads,
    // so waiting on any ONE of them resolves before the rest have arrived —
    // the race that made this pass alone and fail under the full suite's load.
    // Waiting on the assertion is what makes it a fact rather than a timing bet.
    await waitFor(() => {
      const body = document.body.textContent ?? '';
      for (const absence of LIVE_ABSENCES) {
        expect(body).toContain(absence.sentence);
      }
    });
  });
});

describe('the retired updates address', () => {
  it('/updates lands in Chapter 2 rather than 404ing', async () => {
    installShell();
    renderAt(`/campaigns/${CAMPAIGN}/updates`);
    // §27's campaign emails point at it, so the address survives its component.
    await waitFor(() => expect(rail()).toBeTruthy());
    const current = within(rail())
      .getAllByRole('button')
      .find((button) => button.getAttribute('aria-current') === 'page');
    expect(current?.textContent?.trim()).toBe('Live');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Session E — Chapter 3, Get paid
   ══════════════════════════════════════════════════════════════════════════ */

/*
  Every test below opens a CLOSED campaign, because that is the only state in
  which Chapter 3 is unlocked at all — `founderChapterUnlocked` reads
  `campaigns.status` and `campaign_live_at`, and a live campaign's Get paid tab
  is `aria-disabled` with its reason (B4, already asserted above).
*/
const paid = () => `/campaigns/${CAMPAIGN}/home?chapter=payouts`;

function installClosed() {
  installShell({ status: 'closed_reconciling' });
}

describe('E — §21’s retry window is read, never worked out', () => {
  it('states the stored deadline and what the window decides', async () => {
    installClosed();
    renderAt(paid());

    await waitFor(() => expect(screen.getByText(RETRY_WINDOW_IS_STORED)).toBeTruthy());
    expect(screen.getByText(RETRY_WINDOW_OUTCOME)).toBeTruthy();
    // The reference's "Three-day card retry window" is refused by name.
    expect(document.body.textContent).not.toMatch(/three-day/i);
  });
});

describe('E — §22.3 through the one resolver', () => {
  it('leads with the resolved eligible share and its own note', async () => {
    installClosed();
    renderAt(paid());

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Your payment' })).toBeTruthy());
    // The fixture's share, formatted by the shared kernel and by nothing else.
    expect(screen.getAllByText(/US\$/).length).toBeGreaterThan(0);
  });

  it('offers no control that would request a scheduled payment', async () => {
    installClosed();
    renderAt(paid());
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Your payment' })).toBeTruthy());

    for (const control of screen.getAllByRole('button')) {
      const label = control.textContent ?? '';
      expect(label).not.toMatch(/request payment/i);
      expect(label).not.toMatch(/request 40|request the rest|request the remaining/i);
    }
    expect(screen.getByText(NO_PAYMENT_REQUEST)).toBeTruthy();
  });

  it('renders §22.3’s never-skips sentence beside the early-release ask', async () => {
    installClosed();
    renderAt(paid());
    await waitFor(() =>
      expect(screen.getByText(EARLY_RELEASE_NEVER_SKIPS_DAY_14)).toBeTruthy(),
    );
  });

  it('has no file input anywhere — the W-9 is a secure action (§11, §13)', async () => {
    installClosed();
    const { container } = renderAt(paid());
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Your payment' })).toBeTruthy());

    expect(container.querySelectorAll('input[type="file"]')).toHaveLength(0);
    expect(screen.getByText(W9_IS_NOT_UPLOADED_HERE)).toBeTruthy();
  });
});

describe('E — §22.4’s clarification finally has somewhere to answer', () => {
  it('renders the question, the deadline, and a control that posts the answer', async () => {
    installClosed();
    const posted: string[] = [];
    handlers.unshift((url) => {
      if (url.includes('/day-14/clarification')) {
        posted.push(url);
        return { status: 200, body: { status: 'recorded' } };
      }
      return undefined;
    });
    renderAt(paid());

    await waitFor(() =>
      expect(screen.getByText(/Which of the tooling photographs/)).toBeTruthy(),
    );
    expect(screen.getByText(CLARIFICATION_IS_ANSWERED_HERE)).toBeTruthy();

    const answer = screen.getByRole('textbox', { name: /your answer/i });
    await userEvent.type(answer, 'The one dated 14 September.');
    await userEvent.click(screen.getByRole('button', { name: /send my answer/i }));

    await waitFor(() => expect(posted.length).toBe(1));
  });
});

describe('the Get paid chapter’s absences', () => {
  it('renders every register entry’s sentence somewhere on the chapter', async () => {
    installClosed();
    renderAt(paid());

    // Four independent reads again (Session D's finding): waiting on the
    // assertion rather than on one panel's content is what makes this a fact
    // rather than a bet on which read resolves first.
    await waitFor(() => {
      const body = document.body.textContent ?? '';
      for (const absence of PAID_ABSENCES) {
        expect(body).toContain(absence.sentence);
      }
    });
  });
});

describe('the retired money addresses', () => {
  it.each([
    ['results', 'results'],
    ['fulfillment', 'fulfillment'],
  ])('/%s lands in Chapter 3 rather than 404ing', async (_name, segment) => {
    installClosed();
    renderAt(`/campaigns/${CAMPAIGN}/${segment}`);
    // §27's close, results, and Day-14 messages point at both, so the address
    // survives its component.
    await waitFor(() => expect(rail()).toBeTruthy());
    const current = within(rail())
      .getAllByRole('button')
      .find((button) => button.getAttribute('aria-current') === 'page');
    expect(current?.textContent?.trim()).toBe('Get paid');
  });
});


/* ══════════════════════════════════════════════════════════════════════════
   SESSION F — Chapter 4, Wrap, and the Backers page
   ══════════════════════════════════════════════════════════════════════════ */

/*
  A campaign in a Wrap state, which is the only condition under which Chapter 4
  is unlocked at all. `closed_resolved` is what the QA fixture uses too, for the
  reason the last describe in this file records.
*/
const wrap = () => `/campaigns/${CAMPAIGN}/home?chapter=after`;
const backersPath = () => `/campaigns/${CAMPAIGN}/backers`;

function installWrapped() {
  installShell({ status: 'closed_resolved' });
}

describe('F1 — the Creator recap has no ranking anywhere in it', () => {
  it('renders the roster with no position, no podium, and no order of merit', async () => {
    installWrapped();
    renderAt(wrap());

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Your creators' })).toBeTruthy());

    /*
      The reference ranks four ways at once — a numbered badge, a first-place
      tile, a "who you'd work with again" heading, and a sort by backer count.
      §30 defers public leaderboards, and removing the crown while keeping the
      sort is still a ranking because the order IS the claim.
    */
    const body = document.body.textContent ?? '';
    expect(body).not.toMatch(/is leading/i);
    expect(body).not.toMatch(/#1|#2|#3/);
    expect(body).toMatch(/listed by handle/i);

    /*
      The word-hunt is not the assertion — `leaderboard` appears on this page,
      inside the register sentence that refuses one, and a scan that could not
      tell an explanation from a usage would force the explanation out (the
      rule `notifications/` records).

      The assertion is the ORDER, because the order IS the claim: the server
      sorts by handle and the surface renders what it is given. A surface that
      re-sorted by anything would show these two the other way round.
    */
    const handles = [...document.querySelectorAll('.fd-wrap__handle')].map(
      (node) => node.textContent?.trim(),
    );
    expect(handles).toEqual(['@benchnotes', '@solderandsawdust']);
  });

  it('offers §22.9 on a recorded completion and withholds it otherwise', async () => {
    installWrapped();
    renderAt(wrap());

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Your creators' })).toBeTruthy());

    // The fixture has one completed Creator and one Proovd has not decided on.
    // The ask follows §22.8's recorded status, which contains no sales term at
    // all (§33.10.6) — never a revenue figure.
    expect(screen.getAllByRole('button', { name: /ask them to work again/i })).toHaveLength(1);
    expect(document.body.textContent).toContain(
      'Proovd has not made a completion decision on this partnership yet',
    );
  });
});

describe('F1 — §22.11 and §22.10', () => {
  it('says whether the money is closed out without naming a reconciliation item', async () => {
    installWrapped();
    renderAt(wrap());

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Closing the campaign out' })).toBeTruthy(),
    );
    // §22.11's own sentence: money reconciled is not a reward shipped.
    expect(screen.getByText(RESOLUTION_IS_NOT_FULFILLMENT)).toBeTruthy();
    // §21's item keys are Admin vocabulary and a Founder cannot act on one.
    const body = document.body.textContent ?? '';
    for (const key of ['batch_completeness', 'provisional_vs_earned', 'founder_share_w9']) {
      expect(body).not.toContain(key);
    }
  });

  it('renders Phase 21b two gates as two panels, with no combined tick above them', async () => {
    installWrapped();
    renderAt(wrap());

    // `NextCampaign.tsx` was built in Phase 21b and routed nowhere until now.
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Your next campaign' })).toBeTruthy(),
    );
    expect(screen.getByText('The three-month wait')).toBeTruthy();
    expect(screen.getByText("Proovd's readiness decision")).toBeTruthy();
    // §33.10.9's trap is summarising both into one green tick.
    expect(screen.getByText(/both parts above have to be done/i)).toBeTruthy();
  });

  it('states the threshold as a count of pre-orders, never a dollar amount', async () => {
    installWrapped();
    renderAt(wrap());

    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeTruthy());
    const body = document.body.textContent ?? '';
    // §4.1. The reference reads "$12,840 raised against a $10,000 threshold".
    expect(body).toMatch(/pre-orders this campaign needed/i);
    expect(body).not.toMatch(/against a \$[\d,]+ threshold/i);
  });
});

describe('F2 — the §19 operational share reaches a Founder for the first time', () => {
  it('renders a withdrawn share as what it is, never as deliverable', async () => {
    installWrapped();
    renderAt(backersPath());

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /people, with what they chose/i })).toBeTruthy(),
    );
    // The pinned sentence, not the enum value — this is a fact about
    // somebody's money and `do_not_fulfill` is an internal name (§3.1).
    expect(screen.getByText(DO_NOT_FULFILL_LABEL)).toBeTruthy();
    expect(document.body.textContent).not.toContain('do_not_fulfill');
  });
});

describe('F3 — the export names what it withholds before the button', () => {
  it('lists every withheld column and links to the server-composed file', async () => {
    installWrapped();
    renderAt(backersPath());

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Download the list' })).toBeTruthy(),
    );
    for (const withheld of FOUNDER_EXPORT_WITHHELD) {
      expect(document.body.textContent).toContain(withheld.reason);
    }
    expect(screen.getByText(EXPORT_CANNOT_CARRY_A_CONSENT_CONDITION)).toBeTruthy();

    // A plain link the browser follows. Nothing in the surface assembles a row
    // or chooses a column — §25.7's limit applies to what leaves the server.
    const download = screen.getByRole('link', { name: /download the pre-order list/i });
    expect(download.getAttribute('href')).toContain('/backers/export');
  });
});

describe('F4 — §25.7 two purposes, and two refusals with their reasons', () => {
  it('offers only fulfillment and support, and says why the other two are absent', async () => {
    installWrapped();
    renderAt(backersPath());

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Ask for more than this' })).toBeTruthy(),
    );
    expect(screen.getByRole('radio', { name: /delivering what somebody pre-ordered/i })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /answering a support question/i })).toBeTruthy();

    // The reference's other two are named with their reason, where the option
    // would have been — not quietly dropped.
    for (const refused of REFUSED_BACKER_DATA_PURPOSES) {
      expect(document.body.textContent).toContain(refused.refusedBecause);
      expect(screen.queryByRole('radio', { name: refused.label })).toBeNull();
    }
    expect(screen.getByText(BACKER_DATA_REQUEST_GRANTS_NO_ACCESS)).toBeTruthy();
  });

  it('records the ask through the route', async () => {
    installWrapped();
    const user = userEvent.setup();
    renderAt(backersPath());

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Ask for more than this' })).toBeTruthy(),
    );
    await user.click(screen.getByRole('radio', { name: /answering a support question/i }));
    await user.type(
      screen.getByLabelText(/what do you need, exactly/i),
      'A backer says their reward never arrived.',
    );
    await user.click(screen.getByRole('button', { name: /send this to proovd/i }));

    await waitFor(() => expect(seen.some((url) => url.includes('/backer-data-request'))).toBe(true));
  });
});

describe('the Wrap chapter absences', () => {
  it('renders every register entry across the chapter and the Backers page', async () => {
    installWrapped();
    const { unmount } = renderAt(wrap());
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Your creators' })).toBeTruthy());
    const chapterBody = document.body.textContent ?? '';
    unmount();

    installWrapped();
    renderAt(backersPath());
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Download the list' })).toBeTruthy(),
    );
    const combined = chapterBody + (document.body.textContent ?? '');

    for (const absence of WRAP_ABSENCES) {
      expect(combined, `${absence.id} is refused but its reason renders nowhere`).toContain(
        absence.absentBecause,
      );
    }
  });
});

describe('the §33.11 fixture unlocks every chapter the register addresses', () => {
  /*
    Session E found this the hard way. The QA dashboard fixture said `live`,
    and `founderChapterUnlocked` opens only the chapters a campaign has
    REACHED — so the sweep's `founder_paid` address silently fell back to
    Chapter 2 and reported Get paid as swept while rendering Live. That is
    §33.11.1's own trap ("a surface showing something else is not the flow")
    in its quietest form: nothing errored, nothing 404ed, and the flow's axe
    and keyboard passes were run against the wrong page.

    Asserting the agreement is what stops it rotting back, and it is what
    Session F will trip on the day it addresses `?chapter=after`.
  */
  it('every ?chapter= a principal flow names is open on the fixture campaign', async () => {
    // The QA fixtures ALONE — no local dashboard override — because the
    // fixture's own `/dashboard` body is what the sweep serves, and it is the
    // thing under test.
    handlers = [
      (url) => {
        const hit = QA_ROUTES.find((route) => route.match.test(url));
        if (!hit) return undefined;
        const body = typeof hit.body === 'function' ? (hit.body as () => unknown)() : hit.body;
        return { status: hit.status ?? 200, body };
      },
    ];
    renderAt(`/campaigns/${CAMPAIGN}/home`);
    await waitFor(() => expect(rail()).toBeTruthy());

    const addressed = PRINCIPAL_FLOWS.flatMap((flow) => flow.routes)
      .filter((route) => route.includes('/home?chapter='))
      .map((route) => route.split('chapter=')[1]!);
    expect(addressed.length).toBeGreaterThan(0);

    for (const chapter of addressed) {
      const label = FOUNDER_CHAPTERS.find((c) => c.id === chapter)!.label;
      const control = within(rail()).getByRole('button', { name: new RegExp(`^${label}`) });
      expect(
        control.getAttribute('aria-disabled'),
        `?chapter=${chapter} is addressed by a principal flow but locked on the fixture campaign`,
      ).not.toBe('true');
    }
  });
});
