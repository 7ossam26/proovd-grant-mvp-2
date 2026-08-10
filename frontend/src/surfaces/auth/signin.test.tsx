/**
 * The account door — §5.1, §5.2, §5.3, §5.5, §1.1, §3.1, §33.11.4.
 *
 * What these prove, in order of how easy each is to break by accident:
 *
 *  1. There IS a door, and it is reachable from the root address. That was the
 *     defect: sign-in existed twice, each time embedded inside a surface you
 *     had to already know the URL of.
 *  2. The refusal never varies by cause. A wrong password and an unknown
 *     address produce one sentence — the assertion is on the STRING, because
 *     "roughly the same message" is how an oracle is reintroduced.
 *  3. The role decides the destination and the role is never rendered (§3.1:
 *     `affiliate` must not reach a person).
 *  4. There is no signup path anywhere on it (§5, §33.2.1).
 *  5. §5.5's reset acknowledgement is one frozen sentence for every outcome.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { appRoutes } from '../../routes.js';
import { RESET_ACKNOWLEDGEMENT } from './SignIn.js';
import { roleHome } from './api.js';

/**
 * The real route table in a memory router — `appRoutes`' own `Root` supplies
 * `MotionProvider`, which reads `useLocation` and therefore has to sit inside
 * the router rather than around it. Walking a hand-written copy of the routes
 * would prove nothing about the ones that ship.
 */
function renderAt(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  return { router, ...render(<RouterProvider router={router} />) };
}

type Reply = { status: number; body?: unknown };

/**
 * `afterSignIn` models what the server does, rather than counting calls.
 *
 * A test that signs in needs `/api/account/me` to answer 401 before and 200
 * after — the form only renders for an anonymous visitor now, and the
 * destination is only chosen once a session exists.
 *
 * The obvious fixture is "401 on the first call, 200 on the second", and it is
 * wrong: the number of session reads is an implementation detail of the guards
 * and React's render scheduling, so under load an extra read shifts the
 * sequence and the test fails for a reason that has nothing to do with the
 * product. Keying on whether the sign-in POST has actually happened is what the
 * server does, and it holds however many times anything asks.
 */
type Reply2 = Reply & { afterSignIn?: Reply };

/** Replies per URL; anything unmatched fails loudly rather than 404ing quietly. */
function stub(replies: Record<string, Reply2>) {
  const seen: string[] = [];
  // Every guarded surface asks who is signed in before it renders. An anonymous
  // visitor is the default, so the session read is answered 401 unless a case
  // overrides it — a test that had to remember to stub it would fail as
  // 'unstubbed request' and blame the wrong thing.
  const table: Record<string, Reply2> = { '/api/account/me': { status: 401 }, ...replies };
  let signedIn = false;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : String(input);
      seen.push(url);
      const entry = table[url];
      if (!entry) throw new Error(`unstubbed request: ${url}`);
      if (url === '/api/auth/sign-in/email' && entry.status < 400) signedIn = true;
      const reply = signedIn && entry.afterSignIn ? entry.afterSignIn : entry;
      return {
        ok: reply.status >= 200 && reply.status < 300,
        status: reply.status,
        json: async () => reply.body ?? {},
      } as Response;
    }),
  );
  return seen;
}

/** The session read: 401 while nobody has signed in, this account afterwards. */
function signsInAs(role: 'founder' | 'affiliate' | 'admin'): Reply2 {
  return {
    status: 401,
    afterSignIn: {
      status: 200,
      body: { account: { role, email: 'someone@example.com', name: 'Someone' } },
    },
  };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ══════════════════════════════════════════════════ there is a way in at all */

describe('the root address offers a way into the product (§1.1, §5)', () => {
  it('links to the sign-in page from the home page', () => {
    const { container } = renderAt('/');
    const hrefs = [...container.querySelectorAll('a')].map((a) =>
      a.getAttribute('href'),
    );
    expect(hrefs).toContain('/signin');
  });

  it('offers sign-in from the header of every public page, not just the home page', () => {
    for (const path of ['/', '/about', '/safety', '/how-payments-work']) {
      const { container, unmount } = renderAt(path);
      const header = container.querySelector('.site-header');
      expect(header, path).not.toBeNull();
      const signIn = header?.querySelector('a[href="/signin"]');
      expect(signIn, `no sign-in link in the header on ${path}`).not.toBeNull();
      unmount();
    }
  });

  it('renders the sign-in form at /signin', async () => {
    // Async now: the page asks whether somebody is already signed in before it
    // decides to show a credential form at all.
    stub({});
    renderAt('/signin');
    expect(
      await screen.findByRole('heading', { level: 1, name: /sign in to proovd/i }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeTruthy();
  });

  it('names both account roles, so a founder and a creator both know it is theirs', async () => {
    stub({});
    const { container } = renderAt('/signin');
    await screen.findByRole('heading', { level: 1, name: /sign in to proovd/i });
    const text = (container.textContent ?? '').toLowerCase();
    expect(text).toContain('founder');
    expect(text).toContain('creator');
  });

  /**
   * §5, §1.4. An already-authenticated person is not asked to prove an identity
   * they have already proved. Before this the form rendered for everybody, so a
   * signed-in Founder who clicked "Sign in" in the header was shown a password
   * box whose only possible outcome was the session they already had.
   */
  it('never shows the credential form to somebody who is already signed in', async () => {
    stub({
      '/api/account/me': {
        status: 200,
        body: { account: { role: 'founder', email: 'f@example.com', name: 'F' } },
      },
      '/api/founder/campaigns': { status: 200, body: { campaigns: [] } },
    });

    const { router } = renderAt('/signin');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/campaigns');
    });
    expect(screen.queryByLabelText(/^password$/i)).toBeNull();
  });
});

/* ══════════════════════════════════════════════ §5: no signup, for any role */

describe('§5 — the door offers no way to create an account', () => {
  it('has no signup control and no link to one (§33.2.1)', async () => {
    stub({});
    const { container } = renderAt('/signin');
    await screen.findByRole('heading', { level: 1, name: /sign in to proovd/i });
    const labels = [
      ...container.querySelectorAll('button'),
      ...container.querySelectorAll('a'),
    ].map((el) => (el.textContent ?? '').toLowerCase());

    for (const label of labels) {
      expect(label).not.toMatch(/sign up|create an account|register|get started free/);
    }
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs.some((h) => h?.includes('signup') || h?.includes('sign-up'))).toBe(false);
  });

  it('says where an account comes from instead (§1.4)', async () => {
    stub({});
    const { container } = renderAt('/signin');
    await screen.findByRole('heading', { level: 1, name: /sign in to proovd/i });
    expect((container.textContent ?? '').toLowerCase()).toContain('invitation');
  });
});

/* ═══════════════════════════════════════ §5.5: one refusal, whatever the cause */

describe('§5.5 — the refusal is identical whatever the cause', () => {
  async function refusalFor(status: number, body: unknown): Promise<string> {
    stub({ '/api/auth/sign-in/email': { status, body } });
    const user = userEvent.setup();
    const { container, unmount } = renderAt('/signin');
    const view = within(container);

    await user.type(await view.findByLabelText(/email address/i), 'someone@example.com');
    await user.type(view.getByLabelText(/^password$/i), 'whatever-it-was');
    await user.click(view.getByRole('button', { name: /^sign in$/i }));

    const alert = await view.findByRole('alert');
    const text = alert.textContent ?? '';
    // Unmount before the next call: two mounted copies make every query
    // ambiguous, and the comparison below is the point of the test.
    unmount();
    vi.unstubAllGlobals();
    return text;
  }

  it('answers a wrong password and an unknown address with the same string', async () => {
    // Better Auth answers both with 401; the surface must not start
    // distinguishing them from a body it is handed either.
    const wrongPassword = await refusalFor(401, { error: 'INVALID_EMAIL_OR_PASSWORD' });
    const unknownAddress = await refusalFor(401, { error: 'USER_NOT_FOUND' });

    expect(unknownAddress).toBe(wrongPassword);
    expect(wrongPassword).toContain('confirmed or denied');
  });

  it('never names the account, the role, or the reason', async () => {
    const refusal = (await refusalFor(401, { error: 'USER_NOT_FOUND' })).toLowerCase();
    for (const leak of ['not found', 'no account', 'incorrect password', 'founder', 'creator', 'admin']) {
      expect(refusal, leak).not.toContain(leak);
    }
  });

  it('keys on the status, so Better Auth’s own body shape cannot change the answer', async () => {
    // Better Auth answers a bad credential with 401 and a body carrying
    // neither `title` nor `whatHappened`. A client that classified by body
    // would call every real wrong password a transport failure.
    const bareBody = await refusalFor(401, { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'x' });
    expect(bareBody).toContain('confirmed or denied');
  });

  it('says the server is unavailable rather than blaming the password (§1.4)', async () => {
    // A 503 is not a decision about the credential. Telling somebody their
    // password was rejected here makes them retype one that cannot help.
    const unavailable = await refusalFor(503, {});
    expect(unavailable).not.toContain('confirmed or denied');
    expect(unavailable.toLowerCase()).toContain('503');
  });
});

/* ═══════════════════════════════════════ the server decides the destination */

describe('§5.1–§5.3 — the role decides where you land, and is never rendered', () => {
  it.each([
    ['founder' as const, '/campaigns'],
    ['affiliate' as const, '/creator/campaigns'],
    ['admin' as const, '/admin'],
  ])('sends a %s to %s', async (role, destination) => {
    expect(roleHome[role]).toBe(destination);

    stub({
      '/api/auth/sign-in/email': { status: 200, body: {} },
      // Anonymous until the sign-in POST, then this account — which is what
      // makes the form render at all now.
      '/api/account/me': signsInAs(role),
      // Whatever the destination then loads is not this test's subject — but
      // it has to succeed, because a destination that refuses is a different
      // assertion (see the Admin session-ended case, which is terminal by
      // design so the two surfaces cannot bounce each other).
      '/api/founder/campaigns': { status: 200, body: { campaigns: [] } },
      '/api/creator/campaigns': { status: 200, body: { campaigns: [] } },
      '/api/admin/me': {
        status: 200,
        body: {
          id: 'a1',
          name: 'An Admin',
          email: 'admin@example.com',
          sessionEstablishedAt: '2026-08-10T10:00:00.000Z',
          prerequisiteKeys: [],
        },
      },
      '/api/admin/founders': { status: 200, body: { founders: [] } },
    });

    const user = userEvent.setup();
    const { router } = renderAt('/signin');

    await user.type(await screen.findByLabelText(/email address/i), 'someone@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'a-real-password');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(destination);
    });
  });

  it('never prints the internal role name (§3.1)', async () => {
    stub({
      '/api/auth/sign-in/email': { status: 200, body: {} },
      '/api/account/me': signsInAs('affiliate'),
      '/api/creator/campaigns': { status: 401, body: {} },
    });

    const user = userEvent.setup();
    const { container } = renderAt('/signin');

    await user.type(await screen.findByLabelText(/email address/i), 'c@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'a-real-password');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(container.textContent ?? '').not.toMatch(/\baffiliate\b/i);
    });
  });

  /**
   * The second factor is gone (2026-08-10, product direction — see
   * `backend/src/auth/auth.ts`), and this asserts its ABSENCE rather than
   * deleting the case.
   *
   * Deleting it would leave nothing to notice a half-restored factor: a
   * `twoFactorRedirect` in a response that the surface silently ignores would
   * mean the server thinks it withheld the session and the browser thinks it
   * got one, which is the worst of both.
   */
  it('has no second-factor step, and does not invent one from a stray flag', async () => {
    stub({
      '/api/auth/sign-in/email': { status: 200, body: { twoFactorRedirect: true } },
      '/api/account/me': signsInAs('admin'),
      '/api/admin/me': {
        status: 200,
        body: {
          id: 'a1',
          name: 'An Admin',
          email: 'admin@example.com',
          sessionEstablishedAt: '2026-08-10T10:00:00.000Z',
          prerequisiteKeys: [],
        },
      },
      '/api/admin/founders': { status: 200, body: { founders: [] } },
    });

    const user = userEvent.setup();
    const { router } = renderAt('/signin');

    await user.type(await screen.findByLabelText(/email address/i), 'admin@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'a-real-password');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    // The session decides, not the flag: it lands, and never asks for a code.
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/admin');
    });
    expect(screen.queryByLabelText(/authenticator|one-time|verification code/i)).toBeNull();
  });
});

/* ══════════════════════════════════════════════ §5.5: the reset acknowledgement */

describe('§5.5 — the reset acknowledgement is frozen', () => {
  it('renders the same sentence whether or not the address has an account', async () => {
    for (const status of [200, 400, 500]) {
      stub({ '/api/auth/forget-password': { status, body: {} } });
      const user = userEvent.setup();
      const { unmount } = renderAt('/reset-password');

      await user.type(await screen.findByLabelText(/email address/i), 'someone@example.com');
      await user.click(screen.getByRole('button', { name: /send me a reset link/i }));

      const panel = await screen.findByText(RESET_ACKNOWLEDGEMENT);
      expect(panel, `status ${status}`).toBeTruthy();
      unmount();
      vi.unstubAllGlobals();
    }
  });

  it('confirms nothing about the address', () => {
    expect(RESET_ACKNOWLEDGEMENT).toMatch(/^If that email address has a Proovd account/);
  });
});

/* ══════════════════════════════════════ §1.1: the Founder landing is not a dead end */

describe('§1.1 — a signed-in Founder has somewhere to be', () => {
  const SIGNED_IN_FOUNDER: Reply = {
    status: 200,
    body: { account: { role: 'founder', email: 'f@example.com', name: 'F' } },
  };

  it('lists their campaigns with one destination each (§33.11.4)', async () => {
    stub({
      '/api/account/me': SIGNED_IN_FOUNDER,
      '/api/founder/campaigns': {
        status: 200,
        body: {
          campaigns: [
            {
              campaignId: 'c-1',
              status: 'live',
              type: 'pre_build',
              listingPaid: true,
              highEffort: false,
            },
          ],
        },
      },
    });

    const { container } = renderAt('/campaigns');
    await screen.findByRole('heading', { level: 1, name: /your campaigns/i });

    const open = screen.getByRole('link', { name: /open the campaign home/i });
    expect(open.getAttribute('href')).toBe('/campaigns/c-1/home');

    // §3.1: the customer-facing model name, never the internal one.
    const text = container.textContent ?? '';
    expect(text).toContain('Idea Campaign');
    expect(text).not.toMatch(/pre[_-]build|pre[_-]launch/i);
    // …and no internal lifecycle word either.
    expect(text).not.toMatch(/\blive\b.*\bstatus\b|affiliate_response_and_build/i);
  });

  it('answers an empty account with a named state, not a blank page (§27.1)', async () => {
    stub({
      '/api/account/me': SIGNED_IN_FOUNDER,
      '/api/founder/campaigns': { status: 200, body: { campaigns: [] } },
    });

    renderAt('/campaigns');
    await screen.findByText(/no campaign is open on your account yet/i);
    expect(screen.getByText(/what happened/i)).toBeTruthy();
    expect(screen.getByText(/^next$/i)).toBeTruthy();
  });

  /**
   * The signed-out case is now decided by the route guard, before the surface
   * renders at all — which is the improvement, not a regression. A person with
   * no session is sent to the door carrying where they were going, instead of
   * being shown a Founder page containing a sign-in button.
   */
  it('sends a visitor with no session to the door, carrying where they were going', async () => {
    stub({ '/api/account/me': { status: 401 } });
    const { router } = renderAt('/campaigns');

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/signin');
    });
    expect(router.state.location.search).toContain('next=%2Fcampaigns');
  });

  it('does not ask for a password when the server is merely down (§1.4)', async () => {
    // The session IS valid; the data read failed. Nothing about a password can
    // fix that, so the surface offers a retry and no sign-in control.
    stub({
      '/api/account/me': SIGNED_IN_FOUNDER,
      '/api/founder/campaigns': { status: 503, body: {} },
    });
    const view = renderAt('/campaigns');

    expect(
      await within(view.container).findByRole('button', {
        name: /try loading your campaigns again/i,
      }),
    ).toBeTruthy();
    expect(
      within(view.container).queryByRole('button', { name: /sign in to proovd/i }),
    ).toBeNull();
  });

  it('does not ask for a password when the session itself cannot be read either', async () => {
    // §1.4 again, one layer up: a 503 on the session read is not "you are
    // signed out", so the guard must not send anybody to the sign-in page.
    stub({ '/api/account/me': { status: 503 } });
    const { router, container } = renderAt('/campaigns');

    expect(
      await within(container).findByRole('button', { name: /try again/i }),
    ).toBeTruthy();
    expect(router.state.location.pathname).toBe('/campaigns');
  });
});
