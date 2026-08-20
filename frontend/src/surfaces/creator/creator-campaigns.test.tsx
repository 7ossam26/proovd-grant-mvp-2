/**
 * The preparing Campaign kit — Phase 08c, §33.2.4, the half a Creator can see.
 *
 * The LIST that stood beside it, and the sign-in form it fell back to, are
 * Session E's `CreatorPitches` as of 2026-08-20 and are tested in
 * `creator-app/creator-pitches.test.tsx`. What is left here is the kit.
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
    // Every Creator address sits behind a role guard now, so a render begins by
    // asking who is signed in. Answered here rather than in each case; a case
    // that wants a different session — a signed-out one, say — registers its
    // own handler, which is matched first.
    if (url.endsWith('/api/account/me')) {
      return respond(200, {
        account: { role: 'affiliate', email: 'creator@example.com', name: 'A Creator' },
      });
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
