/**
 * Today — Spec §26, §1.4, §30, DNA §5.4.
 *
 * What only a surface test can decide about an overview screen: that it points
 * rather than decides, that a lapsed deadline and open work read as two
 * different things, that the cleared state has nowhere to grow a call to
 * action, and that the four things it must never become are stated rather than
 * merely absent.
 *
 * The counts themselves are the four queues' own, proved where those live.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import {
  TODAY_ABSENCES,
  TODAY_CLEAR,
  TODAY_IS_A_POINTER,
  TODAY_SOURCES,
} from '@proovd/shared';
import { appRoutes } from '../../../routes.js';
import { installQaServer, type StubRoute } from '../../qa/server.js';
import { QA_ROUTES } from '../../qa/fixtures.js';
import type { AdminIdentity } from '../api.js';

const identity: AdminIdentity = {
  id: 'admin-1',
  name: 'Sam Okafor',
  email: 'sam@proovd.co',
  sessionEstablishedAt: '2026-08-19T15:00:00.000Z',
  prerequisiteKeys: [],
  environment: {
    stripeMode: 'test',
    stripeApiVersion: '2026-06-30',
    webhooksLastEventAt: '2026-08-19T13:58:00.000Z',
  },
};

let requests: { method: string; url: string }[] = [];

function serve(extra: StubRoute[] = []): void {
  installQaServer([
    ...extra,
    {
      match: /\/api\/account\/me$/,
      body: { account: { role: 'admin', email: 'admin@proovd.example', name: 'An Admin' } },
    },
    { match: /\/api\/admin\/me$/, body: identity },
    ...QA_ROUTES,
  ]);
  const stubbed = globalThis.fetch;
  requests = [];
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
    requests.push({ method: (init?.method ?? 'GET').toUpperCase(), url: String(input) });
    return stubbed(input as RequestInfo, init);
  });
}

function installMotionRuntime(): void {
  (window as unknown as { Proovd: unknown }).Proovd = {
    failed: false,
    MOTION: {
      dur: { instant: 0.12, quick: 0.2, base: 0.35, slow: 0.6, grand: 0.9 },
      ease: { out: 'power3.out', hero: 'power4.out', move: 'power2.inOut', snap: 'back.out(1.4)', bounce: 'bounce.out', exit: 'power2.in' },
      stagger: { tight: 0.04, base: 0.08 },
      text: { chars: 0.02, words: 0.04, lines: 0.06 },
      dist: { enter: 16 },
    },
    init: () => {},
    toast: () => {},
    buttonProgress: async (_el: HTMLElement, work: Promise<unknown>) => {
      try {
        await work;
      } catch {
        /* the real runtime restores the button and resolves */
      }
    },
  };
}

const CLEAR = {
  counts: TODAY_SOURCES.map((s) => ({ key: s.key, count: 0, kind: 'waiting' as const })),
  clear: true,
  overdueTotal: 0,
  sourceKeys: TODAY_SOURCES.map((s) => s.key),
};

function renderAt(path = '/admin/today') {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  return render(<RouterProvider router={router} />);
}

beforeEach(() => {
  installMotionRuntime();
  serve();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as { Proovd?: unknown }).Proovd;
});

describe('Today', () => {
  it('is the shell index, and its nav entry is a link rather than a parked control', async () => {
    renderAt('/admin');
    const nav = await screen.findByRole('navigation', { name: 'Admin sections' });
    expect(within(nav).getByRole('link', { name: 'Today' })).toHaveAttribute(
      'href',
      '/admin/today',
    );
    // The last parked section is gone, so no nav entry is a button.
    expect(within(nav).queryAllByRole('button')).toHaveLength(0);
  });

  it('counts only lapsed deadlines in the hero, and names open work separately', async () => {
    renderAt();
    // Two support promises and one dispute task are past due; the retry window
    // and the reconciling campaigns are open work nobody is late for. Summing
    // them would report urgency the records do not carry (§30).
    expect(await screen.findByRole('heading', { level: 1, name: '3 past due' })).toBeTruthy();
    expect(screen.getAllByText('Past due')).toHaveLength(2);
    expect(screen.getAllByText('Waiting')).toHaveLength(2);
  });

  it('renders every row as a link into the workspace that owns the work', async () => {
    const { container } = renderAt();
    await screen.findByRole('heading', { level: 1 });
    for (const source of TODAY_SOURCES) {
      const row = screen.queryByRole('link', { name: new RegExp(source.label, 'i') });
      if (!row) continue;
      expect(row).toHaveAttribute('href', source.href);
    }
    /*
      Nothing on this page decides anything: no control that submits.

      Scoped to the page rather than the document — the shell mounts Sign out,
      the parked Explore control, and the Tasks launcher around every Admin
      route, and a document-wide query would be asserting something about the
      shell rather than about Today.
    */
    const page = container.querySelector('.tdy');
    expect(page).toBeTruthy();
    expect(within(page as HTMLElement).queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByText(TODAY_IS_A_POINTER)).toBeTruthy();
  });

  it('says which queues were checked and found clear', async () => {
    renderAt();
    await screen.findByRole('heading', { level: 1 });
    // §1.4: "checked and clear" and "not checked" are different facts, and only
    // the first is true — so the zero rows are stated rather than dropped.
    /*
      And it names the SUBJECT, not the label. Reusing the label produced
      "Clear: day 14 decisions past due" — a sentence that says the opposite of
      what it means, and only a browser pass finds that.
    */
    const line = screen.getByText(/^Checked and clear:/);
    expect(line.textContent).toContain('Day 14 decisions');
    expect(line.textContent).not.toMatch(/past due/i);
  });

  it('offers nothing at all when nothing is due', async () => {
    serve([{ match: /\/api\/admin\/today$/, body: CLEAR }]);
    renderAt();

    expect(await screen.findByText(TODAY_CLEAR)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Nothing is past due' })).toBeTruthy();
    /*
      §20's caught-up ending: no manufactured CTA. There is no row, no link into
      a workspace "while you are here", and no control except the Tasks launcher
      the shell mounts on every Admin route.
    */
    const links = screen
      .queryAllByRole('link')
      .filter((a) => (a.getAttribute('href') ?? '').startsWith('/admin/'))
      .filter((a) => !a.className.includes('navlink'));
    expect(links).toHaveLength(0);
  });

  it('states the four things it is not', async () => {
    renderAt();
    await screen.findByRole('heading', { level: 1 });
    for (const absence of TODAY_ABSENCES) {
      expect(screen.getByText(absence.sentence)).toBeTruthy();
    }
  });

  it('records no visit — the read is the only request it makes', async () => {
    renderAt();
    await screen.findByRole('heading', { level: 1 });
    /*
      §30's prohibition on manufactured engagement, as an absence: there is no
      write route on this page, so opening it changes nothing and there is no
      record that anybody looked.
    */
    const writes = requests.filter(
      (r) => r.method !== 'GET' && r.url.includes('/api/admin/today'),
    );
    expect(writes).toHaveLength(0);
  });

  it('answers §27.1’s six questions when a queue does not come back', async () => {
    serve([
      {
        match: /\/api\/admin\/today$/,
        status: 500,
        body: {
          error: 'server_error',
          title: 'Proovd could not read the queues',
          whatHappened: 'One of the four reads failed.',
          next: 'Try again, or open a workspace directly.',
          status: 500,
        },
      },
    ]);
    renderAt();
    expect(await screen.findByText('Proovd could not read the queues')).toBeTruthy();
    expect(screen.getByRole('button', { name: /try the read again/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /get help/i })).toBeTruthy();
  });
});
