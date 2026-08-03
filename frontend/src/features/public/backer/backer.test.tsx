/**
 * Phase 15 — the Backer magic-link page (§19, §20, §33.5.13).
 *
 * A valid link shows the Backer's transactions with the not-charged fact and a
 * cancel action; an invalid link renders one recovery state that exposes nothing
 * (§5.5). The network is stubbed — the page's content and the cancel round-trip
 * are what is under test.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { BackerPage } from './BackerPage.js';

function renderAt(token: string) {
  const router = createMemoryRouter(
    [{ path: '/backer/:token', element: <BackerPage /> }],
    { initialEntries: [`/backer/${token}`] },
  );
  render(<RouterProvider router={router} />);
}

const PAGE = {
  notChargedLead: 'Pre-order saved — you were not charged',
  campaign: { campaign: { title: 'The Focus Timer', model: 'product' } },
  transactions: [
    {
      reservationId: 'res-1',
      rewardTitle: 'Founding backer',
      delivery: 'December 2026',
      rewardSubtotal: '25.00',
      salesTax: '2.00',
      totalAuthorized: '27.00',
      status: 'reserved_active',
      statusLabel: 'Reserved',
      chargeOccurred: false,
      notChargedYet: true,
      canCancel: true,
      canChangeReward: false,
    },
  ],
};

function stubFetch(handler: (url: string, init?: RequestInit) => { status: number; body?: unknown }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const { status, body } = handler(url, init);
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
      } as Response;
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('§33.5.13 — the Backer magic-link page', () => {
  it('renders the transactions with the not-charged fact and cancels', async () => {
    let canceled = false;
    stubFetch((url, init) => {
      if (url.includes('/cancel')) {
        canceled = true;
        return { status: 200, body: { status: 'canceled', amountCharged: 'US$0' } };
      }
      // The page read: first call returns active; after cancel, canceled.
      if (canceled) {
        return {
          status: 200,
          body: {
            ...PAGE,
            transactions: [{ ...PAGE.transactions[0], statusLabel: 'Canceled', canCancel: false }],
          },
        };
      }
      return { status: 200, body: PAGE };
    });

    renderAt('validtoken123');

    expect(await screen.findByText('The Focus Timer')).toBeInTheDocument();
    expect(screen.getByText('Pre-order saved — you were not charged.')).toBeInTheDocument();
    expect(screen.getByText('US$27.00')).toBeInTheDocument();
    expect(screen.getByText('Reserved')).toBeInTheDocument();
    expect(screen.getByText('US$0 — not charged')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Cancel pre-order' }));

    // After cancel, the status becomes Canceled and the cancel action is gone.
    expect(await screen.findByText('Canceled')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel pre-order' })).not.toBeInTheDocument();
  });

  it('renders a recovery state for an invalid link, exposing nothing', async () => {
    stubFetch(() => ({ status: 401, body: { error: 'link_unavailable' } }));
    renderAt('badtoken');

    expect(await screen.findByText(/We couldn.t open this link/)).toBeInTheDocument();
    // No PII, no reservation, no campaign detail is leaked on a rejected link.
    expect(screen.queryByText('The Focus Timer')).not.toBeInTheDocument();
    expect(screen.getByText(/support@proovd.co/)).toBeInTheDocument();
  });
});
