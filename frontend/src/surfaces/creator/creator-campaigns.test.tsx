/**
 * Phase 08c surfaces — §33.2.4, the half a Creator can see.
 *
 *   33.2.4  Campaign kit is complete, private, logged, scoped, revocable.
 *
 * Private, logged, scoped, and revocable are server guarantees and are proved
 * in `backend/src/tests/affiliate-preparing.test.ts` against the real routes.
 * What is proved here is what the surface does with the server's answers — and,
 * for §10's list of things a Creator cannot do yet, that the controls are
 * absent rather than disabled.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { axe } from 'jest-axe';
import { appRoutes } from '../../routes.js';
import { NO_ACTION } from '../../components/index.js';

type StubResult = { status: number; body: unknown } | undefined;
type Handler = (url: string, init?: RequestInit) => StubResult;

let handlers: Handler[] = [];

function respond(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

beforeEach(() => {
  handlers = [];
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const url = String(input);
    for (const handler of handlers) {
      const result = handler(url, init);
      if (result) return respond(result.status, result.body);
    }
    return respond(404, { error: 'not_found', title: 'No stub' });
  });
});

afterEach(() => vi.unstubAllGlobals());

const ASSOCIATION = 'assoc-1';

const KIT = {
  associationId: ASSOCIATION,
  campaignId: 'campaign-1',
  campaignStatus: 'account_claimed',
  associationStatus: 'preparing',
  founder: { name: 'Rowan', entity: null, soleProprietor: true },
  productName: 'Waitlist',
  problem: 'Independent physiotherapists lose income to last-minute cancellations.',
  solution: 'A waitlist that fills a cancelled slot automatically.',
  competition: 'Most clinics use a paper list and a phone.',
  campaignType: 'Idea Campaign',
  notYetAvailable: [
    { item: 'Rewards, prices, and delivery dates', because: 'The Founder has not built the campaign page yet.' },
    { item: 'How much you would be paid', because: 'Compensation is agreed when the campaign formally opens.' },
  ],
  workPermitted: false,
  decisionsAvailable: false,
};

const CAMPAIGN_ROW = {
  associationId: ASSOCIATION,
  campaignId: 'campaign-1',
  productName: 'Waitlist',
  status: 'preparing',
  revealedAt: '2026-08-01T09:00:00.000Z',
  revoked: false,
  reviewAvailable: true,
};

function stubList(rows: unknown[] = [CAMPAIGN_ROW]) {
  handlers.push((url) =>
    url === '/api/creator/campaigns' ? { status: 200, body: { campaigns: rows } } : undefined,
  );
}

function stubKit(kit: Record<string, unknown> = {}) {
  handlers.push((url) =>
    url.startsWith(`/api/creator/campaigns/${ASSOCIATION}`)
      ? { status: 200, body: { kit: { ...KIT, ...kit } } }
      : undefined,
  );
}

async function renderAt(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  return render(<RouterProvider router={router} />);
}

/* ══ The list ════════════════════════════════════════════════════════════ */

describe('the Creator campaign list', () => {
  it('offers Review campaign once the campaign is revealed (§10)', async () => {
    stubList();
    await renderAt('/creator/campaigns');
    expect(await screen.findByRole('button', { name: /review campaign/i })).toBeTruthy();
    expect(screen.getByText('Waitlist')).toBeTruthy();
  });

  it('offers no review action while the campaign is still preparing', async () => {
    stubList([{ ...CAMPAIGN_ROW, reviewAvailable: false, revealedAt: null, status: 'signed_up_waiting_for_founder' }]);
    await renderAt('/creator/campaigns');

    expect(await screen.findByText(/still being prepared/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /review campaign/i })).toBeNull();
    expect(screen.getAllByText(NO_ACTION).length).toBeGreaterThan(0);
  });

  it('keeps a revoked campaign visible but not reviewable (§10)', async () => {
    stubList([{ ...CAMPAIGN_ROW, revoked: true, reviewAvailable: false }]);
    await renderAt('/creator/campaigns');

    expect(await screen.findByText(/no longer available to you/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /review campaign/i })).toBeNull();
  });

  it('shows the sign-in form when the session has gone', async () => {
    handlers.push((url) =>
      url === '/api/creator/campaigns' ? { status: 401, body: { error: 'unauthenticated' } } : undefined,
    );
    await renderAt('/creator/campaigns');
    expect(await screen.findByRole('heading', { name: /sign in/i })).toBeTruthy();
    // §5.3 gives the Creator email + password. No second factor is asked for.
    expect(screen.queryByLabelText(/authenticator|code/i)).toBeNull();
  });

  it('refuses sign-in without confirming whether the account exists (§5.5)', async () => {
    handlers.push((url, init) => {
      if (url === '/api/creator/campaigns') return { status: 401, body: { error: 'unauthenticated' } };
      if (url === '/api/auth/sign-in/email' && init?.method === 'POST') {
        return { status: 401, body: { error: 'invalid' } };
      }
      return undefined;
    });
    const user = userEvent.setup();
    await renderAt('/creator/campaigns');

    await user.type(await screen.findByLabelText(/email/i), 'sam@example.com');
    await user.type(screen.getByLabelText(/password/i), 'wrong-password-here');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    const message = await screen.findByText(/not accepted/i);
    expect(message.textContent).toMatch(/nothing about the account is confirmed or denied/i);
  });
});

/* ══ §33.2.4 — the kit ═══════════════════════════════════════════════════ */

describe('§33.2.4 — the preparing Campaign kit', () => {
  it('shows the four areas §10 names as currently available', async () => {
    stubKit();
    await renderAt(`/creator/campaigns/${ASSOCIATION}`);

    expect(await screen.findByRole('heading', { name: 'Waitlist' })).toBeTruthy();
    expect(screen.getByText(/last-minute cancellations/i)).toBeTruthy();
    expect(screen.getByText(/waitlist that fills/i)).toBeTruthy();
    expect(screen.getByText(/paper list/i)).toBeTruthy();
    expect(screen.getByText('Rowan')).toBeTruthy();
    // §3: the customer-facing name, never the internal one.
    expect(screen.getByText('Idea Campaign')).toBeTruthy();
  });

  it('never renders an internal campaign-type name (§3)', async () => {
    stubKit();
    const { container } = await renderAt(`/creator/campaigns/${ASSOCIATION}`);
    await screen.findByRole('heading', { name: 'Waitlist' });
    expect(container.textContent).not.toMatch(/pre_build|pre-build|pre_launch|pre-launch/i);
    expect(container.textContent).not.toMatch(/\baffiliate\b/i);
  });

  it('states the confidentiality terms with the material, not behind a link (§31.5)', async () => {
    stubKit();
    await renderAt(`/creator/campaigns/${ASSOCIATION}`);
    expect(await screen.findByText(/what you can read here is confidential/i)).toBeTruthy();
    expect(screen.getByText(/every time you open it we record that you did/i)).toBeTruthy();
  });

  it('says plainly that reading is not accepting (§10)', async () => {
    stubKit();
    await renderAt(`/creator/campaigns/${ASSOCIATION}`);
    expect(await screen.findByText(/reading this is not accepting it/i)).toBeTruthy();
    expect(screen.getAllByText(NO_ACTION).length).toBeGreaterThan(0);
  });

  it('offers no accept, decline, propose, or activate control at all (§10)', async () => {
    stubKit();
    await renderAt(`/creator/campaigns/${ASSOCIATION}`);
    await screen.findByRole('heading', { name: 'Waitlist' });

    // Absent, not disabled. §10: unreachable until listing-fee payment.
    for (const name of [/accept/i, /decline/i, /propose/i, /activate/i, /start work/i]) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
  });

  it('shows no compensation figure or control (§12)', async () => {
    stubKit();
    const { container } = await renderAt(`/creator/campaigns/${ASSOCIATION}`);
    await screen.findByRole('heading', { name: 'Waitlist' });

    expect(container.textContent).not.toMatch(/\d+\s*%/);
    expect(screen.queryByRole('spinbutton')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('names what is not decided yet, with the reason (§1.4)', async () => {
    stubKit();
    await renderAt(`/creator/campaigns/${ASSOCIATION}`);

    expect(await screen.findByText(/rewards, prices, and delivery dates/i)).toBeTruthy();
    expect(screen.getByText(/has not built the campaign page yet/i)).toBeTruthy();
    expect(screen.getByText(/how much you would be paid/i)).toBeTruthy();
  });

  it('offers no route to contact the Founder (§30)', async () => {
    stubKit();
    const { container } = await renderAt(`/creator/campaigns/${ASSOCIATION}`);
    await screen.findByRole('heading', { name: 'Waitlist' });

    expect(screen.getByText(/questions about the campaign go through proovd/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /message|contact the founder/i })).toBeNull();
    // No mailto to anyone but Proovd support.
    for (const link of [...container.querySelectorAll('a[href^="mailto:"]')]) {
      expect(link.getAttribute('href')).toMatch(/proovd/i);
    }
  });

  it('renders the revocation refusal without any of the material', async () => {
    handlers.push((url) =>
      url.startsWith(`/api/creator/campaigns/${ASSOCIATION}`)
        ? {
            status: 403,
            body: {
              error: 'revoked',
              title: 'This campaign is no longer available to you',
              whatHappened: 'Your access to this campaign has been withdrawn.',
              next: 'Reply to the email we sent you and we will explain.',
            },
          }
        : undefined,
    );
    const { container } = await renderAt(`/creator/campaigns/${ASSOCIATION}`);

    expect(await screen.findByText(/no longer available to you/i)).toBeTruthy();
    expect(container.textContent).not.toMatch(/cancellations|waitlist that fills|paper list/i);
  });

  it('renders the not-found refusal for someone else’s campaign', async () => {
    handlers.push((url) =>
      url.startsWith(`/api/creator/campaigns/${ASSOCIATION}`)
        ? {
            status: 404,
            body: {
              error: 'not_found',
              title: 'Campaign not found',
              whatHappened: 'We could not find that campaign for your account.',
              next: 'Go back to your campaigns.',
            },
          }
        : undefined,
    );
    await renderAt(`/creator/campaigns/${ASSOCIATION}`);
    expect(await screen.findByText(/could not find that campaign/i)).toBeTruthy();
  });
});

/* ══ §33.11 — accessibility ══════════════════════════════════════════════ */

describe('§33.11 — the Creator surfaces are accessible', () => {
  it('has no axe violations on the campaign list', async () => {
    stubList();
    const { container } = await renderAt('/creator/campaigns');
    await screen.findByRole('button', { name: /review campaign/i });
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  }, 30_000);

  it('has no axe violations on the kit', async () => {
    stubKit();
    const { container } = await renderAt(`/creator/campaigns/${ASSOCIATION}`);
    await screen.findByRole('heading', { name: 'Waitlist' });
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  }, 30_000);

  it('exposes exactly one level-1 heading on each surface', async () => {
    stubKit();
    await renderAt(`/creator/campaigns/${ASSOCIATION}`);
    await screen.findByRole('heading', { name: 'Waitlist' });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});
