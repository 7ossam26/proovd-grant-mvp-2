/**
 * The follow surfaces — a RECORDED DEVIATION from §1 rule 6 (campaign-page-v2
 * Session C). Like the backend suite, every assertion here is about a LIMIT.
 *
 * The client half of the enumeration defence is the one that is easy to lose:
 * the route answers one frozen body for every outcome, and a page that
 * rendered a network failure differently would hand back the difference the
 * route refuses to give. So the acknowledgement is asserted identical across a
 * success, a 404, and a thrown fetch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { MotionProvider } from '../../../motion/MotionProvider.js';
import { FollowBuild } from './FollowBuild.js';
import { FollowConfirmPage, FollowStopPage } from './FollowAction.js';

function renderAt(element: React.ReactElement, path = '/x') {
  // MotionProvider reads `useLocation`, so it belongs INSIDE the router — the
  // app mounts it the same way.
  const wrapped = <MotionProvider>{element}</MotionProvider>;
  const router = createMemoryRouter(
    [
      { path: '/x', element: wrapped },
      { path: '/follow/:action/:token', element: wrapped },
    ],
    { initialEntries: [path] },
  );
  return render(<RouterProvider router={router} />);
}

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('the follow form', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as never;
  });

  it('says what it is not before it asks for anything', async () => {
    const user = userEvent.setup();
    renderAt(<FollowBuild campaignId="camp-1" />);
    await user.click(screen.getByRole('button', { name: /follow the build/i }));

    // §30's saved-card/charge confusion is the failure to avoid on a page
    // whose every other control leads to a card.
    expect(screen.getByText(/not a pre-order/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing is charged/i)).toBeInTheDocument();
  });

  it('preselects no cadence and stays inert until one is chosen', async () => {
    const user = userEvent.setup();
    renderAt(<FollowBuild campaignId="camp-1" />);
    await user.click(screen.getByRole('button', { name: /follow the build/i }));

    // §27.7: the preference exists only because a person chose it.
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).not.toBeChecked();
    }
    const submit = screen.getByRole('button', { name: /confirmation link/i });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText(/email/i), 'a@example.com');
    expect(submit).toBeDisabled(); // an address alone is not a choice
    await user.click(screen.getByRole('radio', { name: /weekly/i }));
    expect(submit).toBeEnabled();
  });

  it('renders one acknowledgement whatever the server did', async () => {
    const outcomes = [
      () => Promise.resolve({ ok: true, json: async () => ({}) }),
      () => Promise.resolve({ ok: false, status: 404, json: async () => ({}) }),
      () => Promise.reject(new Error('offline')),
    ];
    const seen: string[] = [];

    for (const outcome of outcomes) {
      global.fetch = vi.fn().mockImplementation(outcome) as never;
      const user = userEvent.setup();
      const view = renderAt(<FollowBuild campaignId="camp-1" />);
      await user.click(screen.getByRole('button', { name: /follow the build/i }));
      await user.type(screen.getByLabelText(/email/i), 'a@example.com');
      await user.click(screen.getByRole('radio', { name: /weekly/i }));
      await user.click(screen.getByRole('button', { name: /confirmation link/i }));
      const ack = await screen.findByRole('status');
      seen.push(ack.textContent ?? '');
      view.unmount();
    }

    // Byte-identical. A client that distinguished them would be the oracle the
    // route is built not to be.
    expect(new Set(seen).size).toBe(1);
    expect(seen[0]).toContain('Check your email');
  });
});

describe('the confirm and unfollow pages', () => {
  it('act on a click, never on the page being fetched', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ campaignId: 'c1', campaignTitle: 'A' }) });
    global.fetch = fetchMock as never;

    renderAt(<FollowConfirmPage />, '/follow/confirm/tok');
    // Rendering the page must not have called anything: an email scanner
    // prefetching this URL would otherwise complete the double opt-in.
    await waitFor(() => expect(screen.getByRole('heading')).toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();

    await userEvent.setup().click(screen.getByRole('button', { name: /start the summary/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'POST' });
  });

  it('says the same thing for every kind of unusable link', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }) as never;
    renderAt(<FollowStopPage />, '/follow/stop/tok');
    await userEvent.setup().click(screen.getByRole('button', { name: /stop the summary/i }));
    // §5.5: spent, wrong lineage, expired and never-existed read identically.
    expect(await screen.findByText(/not usable/i)).toBeInTheDocument();
    expect(screen.getByText(/Nothing has changed/i)).toBeInTheDocument();
  });

  it('tells a Backer their pre-order is unaffected', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ campaignId: 'c1', campaignTitle: 'A' }) }) as never;
    renderAt(<FollowStopPage />, '/follow/stop/tok');
    // §27.2: a transactional message is not opt-out-able, so stopping the
    // summary must not read as stopping the receipts.
    expect(screen.getByText(/pre-order, it is untouched/i)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: /stop the summary/i }));
    expect(await screen.findByText(/pre-order you placed is unaffected/i)).toBeInTheDocument();
  });
});
