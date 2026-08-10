/**
 * §27.7's preference control and history, as a person meets them (Phase 22c).
 *
 * The server-side rules — that no code path sets a frequency without a choice,
 * that the digest cannot carry a transactional message, that the history is
 * scoped to the caller's own address — are proved against the real routes in
 * `backend/src/tests/notification-digest.test.ts`. What can only be proved
 * here is what the surface does with those answers:
 *
 *  - nothing is preselected while `chosen` is false (§30's ban on prechecked
 *    optional consent, and the reason `off` is a stored value rather than the
 *    absence of a row);
 *  - the three cadences are an exclusive choice a screen reader hears as one
 *    (§33.11 — three checkboxes that clear each other announce one thing and
 *    behave as another);
 *  - the sentence about what turning it off does NOT do is on the page, not in
 *    fine print, because §27.2 makes every other message unstoppable;
 *  - the history renders no count and no unread state (§27.7, DNA §5.2, §5.5).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { axe } from 'jest-axe';
import { appRoutes } from '../../routes.js';
import { DIGEST_NEVER_REPLACES_TRANSACTIONAL, DIGEST_OPTION_LABELS } from '@proovd/shared';

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
    // Both of these addresses sit behind a role guard now, so every render
    // begins by asking who is signed in. Answered here rather than in each
    // case: the subject of this file is the digest control, and a session stub
    // repeated in twenty tests is twenty places to forget it. A test that wants
    // a different session registers its own handler, which is matched first.
    if (url.endsWith('/api/account/me')) {
      return respond(200, {
        account: { role: sessionRole(), email: 'someone@example.com', name: 'Someone' },
      });
    }
    return respond(404, { error: 'not_found', title: 'No stub' });
  });
});

/**
 * Which role the guard should see, derived from the address under test.
 *
 * `/creator/settings/notifications` is the Creator's half of the same page, so
 * the session that reaches it has to be a Creator's — deriving it from the path
 * means adding a route here cannot silently render against the wrong role.
 */
let renderedPath = '/settings/notifications';
const sessionRole = (): 'founder' | 'affiliate' =>
  renderedPath.startsWith('/creator') ? 'affiliate' : 'founder';

afterEach(() => vi.unstubAllGlobals());

/** What the server actually returns — the copy is resolved there, not here. */
function preference(overrides: Record<string, unknown> = {}) {
  return {
    chosen: false,
    frequency: null,
    chosenAt: null,
    question: 'Would you like a summary of campaign activity?',
    options: (['off', 'daily', 'weekly'] as const).map((value) => ({
      value,
      label: DIGEST_OPTION_LABELS[value],
    })),
    transactionalNotice: DIGEST_NEVER_REPLACES_TRANSACTIONAL,
    ...overrides,
  };
}

const HISTORY = {
  entries: [
    {
      id: 'd1',
      eventKey: 'founder_campaign_live',
      occurredAt: '2026-09-20T14:05:00.000Z',
      state: 'delivered' as const,
      entityType: 'campaign',
      entityId: 'c1',
    },
    {
      id: 'd2',
      eventKey: 'founder_listing_fee_receipt',
      occurredAt: '2026-09-19T09:00:00.000Z',
      state: 'unconfirmed' as const,
      entityType: 'listing_fee_payment',
      entityId: 'p1',
    },
  ],
  nextCursor: null,
};

function stubServer(pref = preference()) {
  handlers.push((url, init) => {
    if (url.includes('/notifications/preferences') && init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as { frequency: string };
      return {
        status: 200,
        body: { preference: preference({ chosen: true, frequency: body.frequency }) },
      };
    }
    if (url.includes('/notifications/preferences')) return { status: 200, body: { preference: pref } };
    if (url.includes('/notifications/history')) return { status: 200, body: { history: HISTORY } };
    return undefined;
  });
}

function renderAt(path: string) {
  renderedPath = path;
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  return render(<RouterProvider router={router} />);
}

describe('§27.7 — the digest preference control', () => {
  it('preselects nothing until a person has chosen (§30)', async () => {
    stubServer();
    renderAt('/settings/notifications');

    const group = await screen.findByRole('radiogroup', {
      name: 'Would you like a summary of campaign activity?',
    });
    const options = within(group).getAllByRole('radio');
    expect(options).toHaveLength(3);
    // Not one of them is checked: "has not chosen" is a state, and defaulting
    // to `off` so something is always selected would be the prechecked consent
    // §30 forbids — wearing the safe-looking answer.
    for (const option of options) {
      expect(option).toHaveAttribute('aria-checked', 'false');
    }
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('is an exclusive choice, not three checkboxes (§33.11)', async () => {
    stubServer();
    renderAt('/settings/notifications');

    const group = await screen.findByRole('radiogroup');
    // Three checkboxes that clear one another announce one thing and behave as
    // another, and give keyboard users tab-per-option instead of arrow keys.
    expect(within(group).queryAllByRole('checkbox')).toHaveLength(0);
    expect(within(group).getAllByRole('radio')).toHaveLength(3);
  });

  it('says what turning it off does not do, beside the control (§27.2)', async () => {
    stubServer();
    renderAt('/settings/notifications');
    // Someone reading "No summary emails" will hear "stop emailing me" unless
    // told otherwise — and the next message they receive is a charge receipt.
    expect(await screen.findByText(DIGEST_NEVER_REPLACES_TRANSACTIONAL)).toBeTruthy();
  });

  it('records the choice the person made, and nothing else', async () => {
    stubServer();
    renderAt('/settings/notifications');

    const group = await screen.findByRole('radiogroup');
    await userEvent.click(within(group).getByRole('radio', { name: /Once a week/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const put = requests.find((r) => r.method === 'PUT');
      expect(put?.body).toEqual({ frequency: 'weekly' });
    });
    // The route carries no recipient and no target user — there is no shape of
    // request from this surface that subscribes anyone else.
    const put = requests.find((r) => r.method === 'PUT')!;
    expect(Object.keys(put.body as object)).toEqual(['frequency']);
  });

  it('shows the recorded choice when one exists', async () => {
    stubServer(preference({ chosen: true, frequency: 'daily' }));
    renderAt('/settings/notifications');

    const group = await screen.findByRole('radiogroup');
    expect(within(group).getByRole('radio', { name: /Once a day/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});

describe('§27.7 — notification history', () => {
  it('renders what was sent, with an unconfirmed delivery named as such (§1.4)', async () => {
    stubServer();
    renderAt('/settings/notifications');

    // The label comes from the shared registry, so the backend never restates
    // 123 descriptions and there is no fourth copy to drift.
    expect(await screen.findByText('Campaign live')).toBeTruthy();
    expect(screen.getByText(/Sent — delivery not confirmed/)).toBeTruthy();
  });

  it('renders no count, no badge, and no unread state (§27.7, DNA §5.5)', async () => {
    stubServer();
    const { container } = renderAt('/settings/notifications');
    await screen.findByText('Campaign live');

    const text = container.textContent ?? '';
    expect(text.toLowerCase()).not.toContain('unread');
    // A history with a primary action would be asking for something. The only
    // primary button on the page is the preference's own Save.
    expect(container.querySelectorAll('.btn--primary')).toHaveLength(1);
  });

  it('has no axe violations', async () => {
    stubServer();
    const { container } = renderAt('/settings/notifications');
    await screen.findByText('Campaign live');
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('the Creator gets the same page at its own address', () => {
  it('reads and writes the Creator routes, never the Founder ones', async () => {
    stubServer();
    renderAt('/creator/settings/notifications');

    await screen.findByRole('radiogroup');

    // The guarantee is that the Creator's page never reads the FOUNDER routes —
    // one component serves both roles, and the audience is bound at the mount
    // rather than passed as a parameter a caller could change.
    expect(requests.some((r) => r.url.startsWith('/api/creator/'))).toBe(true);
    expect(requests.filter((r) => r.url.startsWith('/api/founder/'))).toEqual([]);

    // `/api/account/me` is the role guard asking who is signed in. It is
    // account-level and belongs to neither audience, which is exactly why it is
    // the one address allowed to appear here.
    const foreign = requests.filter(
      (r) => !r.url.startsWith('/api/creator/') && !r.url.endsWith('/api/account/me'),
    );
    expect(foreign).toEqual([]);
  });
});
