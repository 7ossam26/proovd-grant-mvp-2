/**
 * Phase 15 — the Backer magic-link page (§19, §20, §33.5.13) — and Phase 18b's
 * B.5 update-card recovery state (§21, §33.7.9).
 *
 * A valid link shows the Backer's transactions with the not-charged fact and a
 * cancel action; an invalid link renders one recovery state that exposes nothing
 * (§5.5). A failed off-session charge renders Appendix B.5 with its ONE
 * `Update card` action; success reloads to the derived Captured state, and
 * `requires_action` renders a customer-action state rather than a silent
 * outcome. The network is stubbed — the surfaces and their round-trips are what
 * is under test (the card-recovery surface is one of the toolchain's named
 * Testing Library targets).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { BackerPage, type BackerPageProps } from './BackerPage.js';

function renderAt(token: string, props: BackerPageProps = {}) {
  const router = createMemoryRouter(
    [{ path: '/backer/:token', element: <BackerPage {...props} /> }],
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

/* ── Phase 18b — the B.5 update-card state (§21, §33.7.9) ──────────────────── */

const B5_BODY = [
  'We could not complete this pre-order charge.',
  '',
  'No money has moved — the charge did not complete and nothing was taken from your card.',
  'Campaign: The Focus Timer',
  'Reward: Founding backer',
  'Reward subtotal: US$25.00',
  'Sales tax: US$2.00',
  'Total attempted: US$27.00',
  'Update by: August 6, 2026 at 7:40 PM UTC (August 6, 2026 at 7:40 PM UTC)',
  '',
  'If you do nothing, this pre-order will be canceled after the retry window.',
].join('\n');

const FAILED_TX = {
  ...PAGE.transactions[0],
  status: 'capture_failed_retrying',
  statusLabel: 'Payment failed — retrying',
  canCancel: false,
  recovery: {
    body: B5_BODY,
    action: 'Update card',
    deadlineUtc: 'August 6, 2026 at 7:40 PM UTC',
    deadlineIso: '2026-08-06T19:40:00.000Z',
    available: true,
  },
};

describe('§33.7.9 — the B.5 update-card recovery state', () => {
  it('renders Appendix B.5 with one Update card action, and success clears the stale failure', async () => {
    let recovered = false;
    stubFetch((url, init) => {
      if (url.includes('/update-card')) {
        expect(JSON.parse(String(init?.body))).toEqual({ paymentMethodId: 'pm_new_card' });
        recovered = true;
        return {
          status: 200,
          body: { status: 'captured', message: 'Your updated card completed this pre-order charge.' },
        };
      }
      if (recovered) {
        return {
          status: 200,
          body: {
            ...PAGE,
            transactions: [
              {
                ...PAGE.transactions[0],
                status: 'captured',
                statusLabel: 'Captured',
                chargeOccurred: true,
                canCancel: false,
                recovery: null,
              },
            ],
          },
        };
      }
      return { status: 200, body: { ...PAGE, transactions: [FAILED_TX] } };
    });

    renderAt('validtoken123', {
      createPaymentMethodFn: async () => ({ ok: true, paymentMethodId: 'pm_new_card' }),
    });

    // The exact B.5 facts: money moved, the total attempted, the deadline.
    expect(
      await screen.findByText(/We could not complete this pre-order charge/),
    ).toBeInTheDocument();
    expect(screen.getByText(/No money has moved/)).toBeInTheDocument();
    expect(screen.getByText(/Total attempted: US\$27\.00/)).toBeInTheDocument();
    expect(screen.getByText(/Update by: August 6, 2026/)).toBeInTheDocument();
    // ONE Update card action (§21) and no competing control beside it (§30).
    const updateButtons = screen.getAllByRole('button', { name: 'Update card' });
    expect(updateButtons).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Cancel pre-order' })).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(updateButtons[0]!);

    // Success reloads: the derived state is Captured and the failure block is
    // gone — removed by the state itself, not an optimistic hide (§33.7.9).
    expect(await screen.findByText('Captured')).toBeInTheDocument();
    expect(screen.queryByText(/We could not complete this pre-order charge/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Update card' })).not.toBeInTheDocument();
  });

  it('requires_action renders the customer-action state — never a silent outcome (§21)', async () => {
    stubFetch((url) => {
      if (url.includes('/update-card')) {
        return {
          status: 200,
          body: {
            status: 'requires_action',
            clientSecret: 'pi_secret',
            message:
              'Your bank asks you to confirm this charge. Complete the confirmation to finish — nothing has been charged yet.',
          },
        };
      }
      return { status: 200, body: { ...PAGE, transactions: [FAILED_TX] } };
    });

    renderAt('validtoken123', {
      createPaymentMethodFn: async () => ({ ok: true, paymentMethodId: 'pm_3ds_card' }),
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Update card' }));

    expect(await screen.findByText(/Your bank asks you to confirm this charge/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing is charged until your bank confirms/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /I completed the confirmation/ }),
    ).toBeInTheDocument();
  });

  it('a repeat failure stays neutral and non-shaming, and the card can be tried again', async () => {
    stubFetch((url) => {
      if (url.includes('/update-card')) {
        return {
          status: 402,
          body: {
            status: 'failed_again',
            message:
              'This charge could not be completed with that card. No money has moved — you can try a different card before the update deadline.',
          },
        };
      }
      return { status: 200, body: { ...PAGE, transactions: [FAILED_TX] } };
    });

    renderAt('validtoken123', {
      createPaymentMethodFn: async () => ({ ok: true, paymentMethodId: 'pm_declining' }),
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Update card' }));

    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('No money has moved');
    // Neutral copy: no shaming, no provider code (§33.9.11, §30).
    expect(status.textContent?.toLowerCase()).not.toContain('declined');
    // The action survives for another try inside the window.
    expect(screen.getByRole('button', { name: 'Update card' })).toBeInTheDocument();
  });

  it('after the deadline the block says the window ended and offers no card field', async () => {
    stubFetch(() => ({
      status: 200,
      body: {
        ...PAGE,
        transactions: [
          { ...FAILED_TX, recovery: { ...FAILED_TX.recovery, available: false } },
        ],
      },
    }));

    renderAt('validtoken123');

    expect(await screen.findByText(/The update window ended at/)).toBeInTheDocument();
    // Both the B.5 body and the closing note state the no-money fact.
    expect(screen.getAllByText(/No money has moved/i).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Update card' })).not.toBeInTheDocument();
  });
});

describe('§33.9.2 — the B.6 refund state (Phase 20a)', () => {
  it('renders the exact B.6 block with its one help action and the quotable reference', async () => {
    const B6_BODY = [
      'Refund started — US$27.00',
      '',
      'Sent to: your original payment method',
      'Started: August 4, 2026 (UTC)',
      'Typical bank timing: 5–10 business days, typically',
      'Status: SUCCEEDED',
      'Reference: RF-7K2M9-Q4WPX',
    ].join('\n');
    stubFetch(() => ({
      status: 200,
      body: {
        ...PAGE,
        transactions: [
          {
            ...PAGE.transactions[0],
            status: 'refunded',
            statusLabel: 'Refunded',
            chargeOccurred: true,
            notChargedYet: false,
            canCancel: false,
            refunds: [
              {
                reference: 'RF-7K2M9-Q4WPX',
                status: 'succeeded',
                body: B6_BODY,
                action: 'View pre-order or get help',
              },
            ],
          },
        ],
      },
    }));

    renderAt('validtoken123');

    // The B.6 body renders whole — amount, destination, typical timing as a
    // range (never a promised date), status, and the reference.
    expect(await screen.findByText(/Refund started — US\$27\.00/)).toBeInTheDocument();
    const block = screen.getByText(/Refund started — US\$27\.00/);
    expect(block.textContent).toContain('Typical bank timing: 5–10 business days, typically');
    expect(block.textContent).toContain('Status: SUCCEEDED');
    expect(block.textContent).toContain('Reference: RF-7K2M9-Q4WPX');
    // B.6's one action — help without losing context, and nothing competing.
    expect(
      screen.getByRole('link', { name: 'View pre-order or get help' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Update card' })).not.toBeInTheDocument();
  });
});
