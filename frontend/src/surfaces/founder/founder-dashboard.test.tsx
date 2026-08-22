/**
 * The founder dashboard route is now a full-screen host for the supplied,
 * self-contained dashboard. These tests deliberately exercise the real route
 * table so the handoff URL and the document it opens cannot drift apart.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { invalidateSession } from '../../lib/session.js';
import { appRoutes } from '../../routes.js';

const CAMPAIGN = 'campaign-founder-dashboard';

beforeEach(() => {
  invalidateSession();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          account: { role: 'founder', email: 'founder@example.com', name: 'Founder' },
        }),
      }) as Response,
    ),
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

    const frame = await screen.findByTitle<HTMLIFrameElement>('Founder dashboard');
    const source = new URL(frame.src);

    expect(source.pathname).toBe('/founder-dashboard-final.html');
    expect(source.searchParams.has('dashboard')).toBe(false);
  });

  it('carries supported reference state into the dashboard and drops retired dashboard state', async () => {
    renderAt(
      `/campaigns/${CAMPAIGN}/home?phase=live&day=9&type=product&effort=high&upfront=1&chapter=payouts`,
    );

    const frame = await screen.findByTitle<HTMLIFrameElement>('Founder dashboard');
    const source = new URL(frame.src);

    expect(Object.fromEntries(source.searchParams)).toEqual({
      phase: 'live',
      day: '9',
      type: 'product',
      effort: 'high',
      upfront: '1',
    });
  });
});
