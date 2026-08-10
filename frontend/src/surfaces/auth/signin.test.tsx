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

/** Replies per URL; anything unmatched fails loudly rather than 404ing quietly. */
function stub(replies: Record<string, Reply>) {
  const seen: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : String(input);
      seen.push(url);
      const reply = replies[url];
      if (!reply) throw new Error(`unstubbed request: ${url}`);
      return {
        ok: reply.status >= 200 && reply.status < 300,
        status: reply.status,
        json: async () => reply.body ?? {},
      } as Response;
    }),
  );
  return seen;
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

  it('renders the sign-in form at /signin', () => {
    renderAt('/signin');
    expect(
      screen.getByRole('heading', { level: 1, name: /sign in to proovd/i }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeTruthy();
  });

  it('names both account roles, so a founder and a creator both know it is theirs', () => {
    const { container } = renderAt('/signin');
    const text = (container.textContent ?? '').toLowerCase();
    expect(text).toContain('founder');
    expect(text).toContain('creator');
  });
});

/* ═════════════════════════════════════════ §5: the signup door is Founder-only

   This block used to assert that no signup link existed at all, because no
   public signup existed for any role. That is an OPERATOR DECISION and it has
   been reversed for FOUNDERS — so these tests now guard the part of §5 that did
   not change, which is the part that was always doing the work:

     §5.1 seeds Admins and makes a TOTP factor mandatory.
     §5.3 admits Creators only through a private, campaign-scoped invitation,
          which is what §33.2.1 is named for and still enforces server-side.

   A link reading "create an account" would offer all three and deliver one,
   which is §1.4's failure with a cursor in it. So the assertion is no longer
   "there is no link" but "the link says which of the three it opens".         */

describe('§5 — the signup link offers a Founder account and only that', () => {
  it('links to /signup and names the role it creates (§33.11.4)', () => {
    const { container } = renderAt('/signin');
    const signupLinks = [...container.querySelectorAll('a')].filter((a) =>
      a.getAttribute('href')?.includes('signup'),
    );

    expect(signupLinks.length).toBeGreaterThan(0);
    // §33.11.4: a control names its destination. "Create an account" is the
    // objectless label this exists to refuse — it would promise a Creator and
    // an Admin something the server will not give them.
    for (const link of signupLinks) {
      expect((link.textContent ?? '').toLowerCase()).toContain('founder');
    }
  });

  it('never offers a Creator or Admin account (§5.1, §5.3)', () => {
    const { container } = renderAt('/signin');
    const labels = [
      ...container.querySelectorAll('button'),
      ...container.querySelectorAll('a'),
    ].map((el) => (el.textContent ?? '').toLowerCase());

    for (const label of labels) {
      expect(label).not.toMatch(/creator account|admin account|register|get started free/);
    }
  });

  it('still says where a Creator account comes from (§1.4)', () => {
    const { container } = renderAt('/signin');
    const text = (container.textContent ?? '').toLowerCase();
    // The page must not go quiet about the role its signup link does NOT open.
    expect(text).toContain('invited');
    expect(text).toContain('creator');
  });
});

/* ═══════════════════════════════════════ §5.5: one refusal, whatever the cause */

describe('§5.5 — the refusal is identical whatever the cause', () => {
  async function refusalFor(status: number, body: unknown): Promise<string> {
    stub({ '/api/auth/sign-in/email': { status, body } });
    const user = userEvent.setup();
    const { container, unmount } = renderAt('/signin');
    const view = within(container);

    await user.type(view.getByLabelText(/email address/i), 'someone@example.com');
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
      '/api/account/me': {
        status: 200,
        body: { account: { role, email: 'someone@example.com', name: 'Someone' } },
      },
      // Whatever the destination then loads is not this test's subject.
      '/api/founder/campaigns': { status: 200, body: { campaigns: [] } },
      '/api/creator/campaigns': { status: 401, body: {} },
      '/api/admin/me': { status: 401, body: {} },
    });

    const user = userEvent.setup();
    const { router } = renderAt('/signin');

    await user.type(screen.getByLabelText(/email address/i), 'someone@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'a-real-password');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(destination);
    });
  });

  it('never prints the internal role name (§3.1)', async () => {
    stub({
      '/api/auth/sign-in/email': { status: 200, body: {} },
      '/api/account/me': {
        status: 200,
        body: { account: { role: 'affiliate', email: 'c@example.com', name: 'C' } },
      },
      '/api/creator/campaigns': { status: 401, body: {} },
    });

    const user = userEvent.setup();
    const { container } = renderAt('/signin');

    await user.type(screen.getByLabelText(/email address/i), 'c@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'a-real-password');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(container.textContent ?? '').not.toMatch(/\baffiliate\b/i);
    });
  });

  it('asks for the second factor only when the server asks for it (§5.1, DNA §5.1)', async () => {
    stub({ '/api/auth/sign-in/email': { status: 200, body: { twoFactorRedirect: true } } });

    const user = userEvent.setup();
    renderAt('/signin');

    await user.type(screen.getByLabelText(/email address/i), 'admin@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'a-real-password');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    // One question per moment: the password fields are gone, not merely below.
    await screen.findByRole('heading', { level: 1, name: /authenticator code/i });
    expect(screen.queryByLabelText(/^password$/i)).toBeNull();
  });
});

/* ══════════════════════════════════════════════ §5.5: the reset acknowledgement */

describe('§5.5 — the reset acknowledgement is frozen', () => {
  it('renders the same sentence whether or not the address has an account', async () => {
    for (const status of [200, 400, 500]) {
      stub({ '/api/auth/forget-password': { status, body: {} } });
      const user = userEvent.setup();
      const { unmount } = renderAt('/reset-password');

      await user.type(screen.getByLabelText(/email address/i), 'someone@example.com');
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
  it('lists their campaigns with one destination each (§33.11.4)', async () => {
    stub({
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
    stub({ '/api/founder/campaigns': { status: 200, body: { campaigns: [] } } });

    renderAt('/campaigns');
    await screen.findByText(/no campaign is open on your account yet/i);
    expect(screen.getByText(/what happened/i)).toBeTruthy();
    expect(screen.getByText(/^next$/i)).toBeTruthy();
  });

  it('offers the way back in when the session has ended, and never when the server is merely down', async () => {
    stub({ '/api/founder/campaigns': { status: 401, body: {} } });
    renderAt('/campaigns');
    expect(await screen.findByRole('button', { name: /sign in to proovd/i })).toBeTruthy();

    vi.unstubAllGlobals();
    stub({ '/api/founder/campaigns': { status: 503, body: {} } });
    const second = renderAt('/campaigns');
    // A server that is down must not ask for a password that cannot help
    // (§1.4) — it offers a retry.
    expect(
      await within(second.container).findByRole('button', {
        name: /try loading your campaigns again/i,
      }),
    ).toBeTruthy();
    expect(
      within(second.container).queryByRole('button', { name: /sign in to proovd/i }),
    ).toBeNull();
  });
});
