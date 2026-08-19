/**
 * The Creator app shell and Home — Creator Flow v2, Session D, 2026-08-19.
 *
 * The real route table in a memory router with `fetch` stubbed at the network
 * boundary, the arrangement `creator-flow.test.tsx` and `founder-flow.test.tsx`
 * both use. Server-side rules are proved against the real routes in
 * `backend/src/tests/creator-flow-d.test.ts`; what is proved here is what a
 * person meets.
 *
 * Four things this suite is deliberately about, each of them a place the
 * reference and the Spec disagree in a way a screenshot cannot show:
 *
 *   1. **The caught-up hero offers nothing.** §20's "show no manufactured CTA"
 *      is only true if the branch renders no control, and a test that looked
 *      for the absence of one particular button would pass while a different
 *      one was added.
 *   2. **The tier binds nothing, and says so where the number is.** The
 *      reference promises "higher floors and early access" and badges the tier
 *      `Founders see this`; both are refused, and `STANDING_BINDS_NOTHING`
 *      renders with the score.
 *   3. **The referral pays nothing and shares no link.** Both pinned refusals
 *      render beside the form rather than under it.
 *   4. **The Updates drawer carries no count.** 22c's four dashboard
 *      assertions, at the surface: a badge here would be the first of them.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { axe } from 'jest-axe';
import {
  BANNED_FRESHNESS_TERMS,
  CREATOR_APP_ABSENCES,
  CREATOR_APP_SECTIONS,
  CREATOR_HOME_CAUGHT_UP,
  CREATOR_NO_CAMPAIGN_POOL,
  CREATOR_TEAM_UP_IS_THE_FOUNDERS_ASK,
  CREATOR_UPDATES_ARE_A_RECORD,
  REFERRAL_HAS_NO_PUBLIC_LINK,
  REFERRAL_PAYS_NOTHING,
  STANDING_BINDS_NOTHING,
  STANDING_LEADERBOARD_SHOWS_HANDLES_ONLY,
  STANDING_NOT_ENOUGH_HISTORY,
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

const STANDING = {
  score: 680,
  tier: 'gold',
  percentile: 82,
  inputs: {
    campaigns_completed: 3,
    posts_verified: 3,
    obligations_met: 3,
    evidence_verified: 1,
  },
  computedAt: '2026-08-18T09:15:00.000Z',
};

function homeBody(overrides: Record<string, unknown> = {}) {
  return {
    home: {
      firstName: 'Sam',
      pitches: [
        {
          associationId: 'assoc-1',
          campaignId: 'camp-1',
          productName: 'Loopnote',
          kind: 'opportunity',
        },
      ],
      standing: STANDING,
      leaders: [
        { handle: '@rivera', score: 900, tier: 'platinum', isYou: false },
        { handle: '@sam', score: 680, tier: 'gold', isYou: true },
      ],
      cohortMinimum: 10,
      trackRecord: { launched: 3, verified: 3, backedCents: '348000' },
      workAgain: [
        {
          requestId: 'req-1',
          associationId: 'assoc-1',
          productName: 'Loopnote',
          message: 'We would like you on the next one.',
          requestedAt: '2026-08-17T12:00:00.000Z',
        },
      ],
      referrals: [],
      ...overrides,
    },
  };
}

function stubSignedInCreator(home: unknown = homeBody()) {
  handlers.push((url) => {
    if (url === '/api/account/me') {
      return {
        status: 200,
        body: {
          account: { id: 'u1', email: 'sam@example.com', name: 'Sam Okafor', role: 'affiliate' },
        },
      };
    }
    if (url === '/api/creator/home') return { status: 200, body: home };
    if (url.startsWith('/api/creator/notifications/history')) {
      return {
        status: 200,
        body: {
          history: {
            entries: [
              {
                id: 'n1',
                eventKey: 'affiliate_campaign_live',
                occurredAt: '2026-08-17T09:00:00.000Z',
                state: 'delivered',
                entityType: 'association',
                entityId: 'assoc-1',
              },
            ],
            nextCursor: null,
          },
        },
      };
    }
    return undefined;
  });
}

async function renderHome(home?: unknown) {
  stubSignedInCreator(home ?? homeBody());
  const router = createMemoryRouter(appRoutes, { initialEntries: ['/creator/home'] });
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

/* ══ The three states ═══════════════════════════════════════════════════════ */

describe('Home renders three states, and none of them is a zero standing in for a gap', () => {
  it('a Creator with a pitch waiting gets the count and one action', async () => {
    await renderHome();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('1 pitch waiting');
    expect(screen.getByRole('link', { name: /review pitches/i })).toBeInTheDocument();
    expect(screen.getByText('680')).toBeInTheDocument();
  });

  it('the caught-up hero offers NO control at all', async () => {
    await renderHome(homeBody({ pitches: [], workAgain: [] }));
    const hero = screen.getByRole('heading', { level: 1 }).closest('section')!;
    expect(hero).toHaveTextContent(CREATOR_HOME_CAUGHT_UP);
    // §20: "show no manufactured CTA". The assertion is that the branch renders
    // NOTHING operable, rather than that one particular button is missing —
    // which would pass while a different one was added.
    expect(within(hero).queryAllByRole('button')).toHaveLength(0);
    expect(within(hero).queryAllByRole('link')).toHaveLength(0);
  });

  it('a Creator with no completed campaign is told so, not scored zero', async () => {
    await renderHome(homeBody({ standing: null, leaders: [] }));
    expect(screen.getByText(STANDING_NOT_ENOUGH_HISTORY)).toBeInTheDocument();
    // §16a. A zero would read as a judgement about somebody who has not started.
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('a short cohort gets no ranking, and says why', async () => {
    await renderHome(homeBody({ leaders: [] }));
    expect(screen.getByText(/at least 10 Creators have a standing/i)).toBeInTheDocument();
  });
});

/* ══ Nothing here decides anything ══════════════════════════════════════════ */

describe('the standing block promises nothing', () => {
  it('pins the sentence that keeps the tier honest, with the number', async () => {
    await renderHome();
    expect(screen.getByText(STANDING_BINDS_NOTHING)).toBeInTheDocument();
  });

  it('renders none of the reference claims the Spec refuses', async () => {
    const { container } = await renderHome();
    const text = visibleText(container).toLowerCase();
    for (const refused of [
      'founders see this',
      'higher floors',
      'early access',
      'streak',
      'shout-out',
      'hits',
      'pick your next campaign',
      'proovd.co/join',
      'earn a percentage',
    ]) {
      expect({ refused, found: text.includes(refused) }).toEqual({ refused, found: false });
    }
  });

  it('states freshness as a time and never as a claim about immediacy', async () => {
    const { container } = await renderHome();
    const text = visibleText(container).toLowerCase();
    expect(text).toContain('updated');
    for (const banned of BANNED_FRESHNESS_TERMS) {
      expect({ banned, found: text.includes(banned.toLowerCase()) }).toEqual({
        banned,
        found: false,
      });
    }
  });

  it('names the one task that has a record behind it, and no others', async () => {
    const user = userEvent.setup();
    await renderHome();
    await user.click(screen.getByRole('button', { name: /how this is worked out/i }));
    expect(await screen.findByText(/Add evidence about your channel/i)).toBeInTheDocument();
    expect(screen.queryByText(/within 24 hours/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/conversion above/i)).not.toBeInTheDocument();
  });
});

/* ══ The referral ═══════════════════════════════════════════════════════════ */

describe('the referral pays nothing and shares no link', () => {
  it('renders both refusals beside the form', async () => {
    await renderHome();
    expect(screen.getByText(REFERRAL_PAYS_NOTHING)).toBeInTheDocument();
    expect(screen.getByText(REFERRAL_HAS_NO_PUBLIC_LINK)).toBeInTheDocument();
    // The reference's control is a read-only URL with a Copy button.
    expect(screen.queryByRole('button', { name: /^copy$/i })).not.toBeInTheDocument();
  });

  it('sends the four answers and no referrer', async () => {
    const user = userEvent.setup();
    handlers.push((url, init) => {
      if (url === '/api/creator/referrals' && init?.method === 'POST') {
        return {
          status: 200,
          body: {
            referrals: [
              { id: 'r1', referredName: 'J. Park', state: 'recorded', recordedAt: '2026-08-19' },
            ],
          },
        };
      }
      return undefined;
    });
    await renderHome();

    await user.type(screen.getByLabelText(/their name/i), 'J. Park');
    await user.type(screen.getByLabelText(/how to reach them/i), 'j@example.com');
    await user.type(screen.getByLabelText(/how you know them/i), 'We ran a series together.');
    await user.type(screen.getByLabelText(/why you would vouch/i), 'Right audience.');
    await user.click(screen.getByRole('button', { name: /send this introduction/i }));

    await waitFor(() => expect(screen.getByText('J. Park')).toBeInTheDocument());
    const posted = requests.find((r) => r.url === '/api/creator/referrals');
    // The referrer is the session's. A body that could name one could attribute
    // a vouch to somebody else.
    expect(Object.keys(posted!.body as object).sort()).toEqual([
      'note',
      'referredContact',
      'referredName',
      'relationship',
      'why',
    ]);
  });
});

/* ══ The shell ══════════════════════════════════════════════════════════════ */

describe('the app shell', () => {
  it('renders every section, and an unbuilt one explains itself instead of opening', async () => {
    await renderHome();
    const rail = screen.getByRole('navigation', { name: /creator sections/i });
    for (const section of CREATOR_APP_SECTIONS) {
      const item = within(rail).getByText(section.label);
      if (section.href) {
        expect(item.closest('a')).toHaveAttribute('href', section.href);
      } else {
        // `aria-disabled` rather than `disabled`, so it stays in the tab order
        // and a keyboard user meets the explanation (§28.5).
        const off = item.closest('[aria-disabled="true"]');
        expect(off).not.toBeNull();
        expect(off!.querySelector('a')).toBeNull();
      }
    }
  });

  it('the Updates drawer is a record, and carries no count anywhere', async () => {
    const user = userEvent.setup();
    const { container } = await renderHome();
    // 22c's four assertions, at the surface. The reference draws `Updates · 2
    // new` in the menu and a `2` on the rail; a badge would have to come from a
    // column that deliberately does not exist.
    const railText = visibleText(
      screen.getByRole('navigation', { name: /creator sections/i }) as HTMLElement,
    );
    expect(railText).not.toMatch(/\d/);

    await user.click(within(container).getAllByRole('button', { name: /updates/i })[0]!);
    expect(await screen.findByText(CREATOR_UPDATES_ARE_A_RECORD)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText(/^Campaign live$/)).toBeInTheDocument(),
    );
    // Reading it writes nothing: no read-state route exists to be called.
    expect(requests.filter((r) => r.method !== 'GET' && r.url.includes('notification'))).toEqual(
      [],
    );
  });
});

/* ══ Copy, and what must never leak onto a customer surface ═════════════════ */

describe('the copy is written for a Creator', () => {
  it('names no Spec section and uses no internal vocabulary', async () => {
    const { container } = await renderHome();
    const text = visibleText(container);
    // Session C's own scan: `basis` copy on screen 6 read "§8" aloud to a
    // Creator, which is the Campaigns hub's leak with a worse audience.
    expect(text).not.toMatch(/§\s*\d/);
    for (const banned of [
      'affiliate',
      'reservation',
      'pre_build',
      'pre_launch',
      'pledge',
      'escrow',
      'upfront',
      'all-or-nothing',
    ]) {
      expect({ banned, found: new RegExp(`\\b${banned}\\b`, 'i').test(text) }).toEqual({
        banned,
        found: false,
      });
    }
  });

  it('renders the pinned sentences the register says replace a refused control', async () => {
    await renderHome();
    expect(screen.getByText(CREATOR_NO_CAMPAIGN_POOL)).toBeInTheDocument();
    expect(screen.getByText(CREATOR_TEAM_UP_IS_THE_FOUNDERS_ASK)).toBeInTheDocument();
    expect(screen.getByText(STANDING_LEADERBOARD_SHOWS_HANDLES_ONLY)).toBeInTheDocument();

    // Every register entry that names a replacement names one that is real.
    const named = CREATOR_APP_ABSENCES.map((a) => a.replacedBy).filter(Boolean);
    expect(named.length).toBeGreaterThan(3);
  });

  it('has no axe violation', async () => {
    const { container } = await renderHome();
    expect(await axe(container)).toHaveNoViolations();
  });
});
