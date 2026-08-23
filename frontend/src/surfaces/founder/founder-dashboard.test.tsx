/**
 * The founder dashboard route is now a full-screen host for the supplied,
 * self-contained dashboard. These tests deliberately exercise the real route
 * table so the handoff URL and the document it opens cannot drift apart.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { invalidateSession } from '../../lib/session.js';
import { appRoutes } from '../../routes.js';

const CAMPAIGN = 'campaign-founder-dashboard';

beforeEach(() => {
  invalidateSession();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.endsWith(`/api/founder/campaigns/${CAMPAIGN}/dashboard`)
        ? {
            dashboard: {
              campaignId: CAMPAIGN,
              status: 'approved',
              type: 'pre_build',
              campaignLiveAt: null,
              campaignCloseAt: null,
              listingPaidAt: '2026-08-23T12:00:00.000Z',
              highEffort: false,
              title: 'Connected campaign',
              founderName: 'Real Founder',
              founderEmail: 'founder@example.com',
            },
          }
        : { account: { role: 'founder', email: 'founder@example.com', name: 'Founder' } };
      return { ok: true, status: 200, json: async () => body } as Response;
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

function renderAt(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  return render(<RouterProvider router={router} />);
}

describe('the final founder dashboard', () => {
  it('loads the supplied dashboard document from its intro at the founder home route', async () => {
    renderAt(`/campaigns/${CAMPAIGN}/home`);

    expect(await screen.findByRole('heading', { name: 'You’re in!' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Secure account and open my dashboard' }));

    const frame = await screen.findByTitle<HTMLIFrameElement>('Founder dashboard');
    const source = new URL(frame.src);

    expect(source.pathname).toBe('/founder-dashboard-final.html');
    expect(Object.fromEntries(source.searchParams)).toEqual({
      campaign: CAMPAIGN,
      type: 'idea',
      effort: 'standard',
      phase: 'matching',
      day: '1',
      name: 'Connected campaign',
      founder: 'Real Founder',
      email: 'founder@example.com',
    });
  });

  it('uses recorded campaign facts instead of address parameters', async () => {
    renderAt(
      `/campaigns/${CAMPAIGN}/home?phase=live&day=9&type=product&effort=high&upfront=1&chapter=payouts`,
    );

    fireEvent.click(
      await screen.findByRole('button', { name: 'Secure account and open my dashboard' }),
    );

    const frame = await screen.findByTitle<HTMLIFrameElement>('Founder dashboard');
    const source = new URL(frame.src);

    expect(source.searchParams.get('type')).toBe('idea');
    expect(source.searchParams.get('effort')).toBe('standard');
    expect(source.searchParams.get('phase')).toBe('matching');
    expect(source.searchParams.has('upfront')).toBe(false);
  });
});
