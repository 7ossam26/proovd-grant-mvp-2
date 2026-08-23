import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { FoundersPanel } from './FoundersPanel.js';

interface SeenRequest {
  url: string;
  method: string;
}

let requests: SeenRequest[] = [];
let stylesheet: HTMLLinkElement;

function response(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  requests = [];

  // FoundersPanel waits for its isolated reference stylesheet before drawing.
  // Mark it as present so this behavior test can exercise the rendered chrome.
  stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = '/admin-founders.css';
  document.head.appendChild(stylesheet);

  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    requests.push({ url, method });

    if (url.endsWith('/api/admin/founders') && method === 'GET') {
      return response(200, { founders: [] });
    }
    if (url.endsWith('/api/auth/sign-out') && method === 'POST') {
      return response(204);
    }
    return response(404, { error: 'not_found', title: 'No stub' });
  });
});

afterEach(() => {
  stylesheet.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Admin Founders panel session control', () => {
  it('signs out and returns to the Admin sign-in page', async () => {
    const user = userEvent.setup();
    const router = createMemoryRouter(
      [
        { path: '/admin/founders', element: <FoundersPanel /> },
        { path: '/admin/signin', element: <h1>Admin sign in</h1> },
      ],
      { initialEntries: ['/admin/founders'] },
    );
    render(<RouterProvider router={router} />);

    await user.click(await screen.findByRole('button', { name: 'Sign out' }));

    await screen.findByRole('heading', { name: 'Admin sign in' });
    await waitFor(() => {
      expect(requests).toContainEqual({ url: '/api/auth/sign-out', method: 'POST' });
    });
    expect(router.state.location.pathname).toBe('/admin/signin');
  });
});
