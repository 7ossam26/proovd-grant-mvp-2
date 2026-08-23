import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Directory } from './Directory.js';

type SeenRequest = { url: string; method: string; body: Record<string, unknown> | null };
let requests: SeenRequest[] = [];

function response(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

beforeEach(() => {
  requests = [];
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    requests.push({ url, method, body });

    if (url.endsWith('/api/admin/founders') && method === 'GET') {
      return response(200, { founders: [] });
    }
    if (url.endsWith('/api/admin/founders') && method === 'POST') {
      return response(201, {
        prospectId: 'prospect-1',
        campaignId: 'campaign-1',
        draftId: 'draft-1',
      });
    }
    if (url.includes('/api/admin/founders/') && method === 'PUT') {
      return response(200, { ok: true });
    }
    return response(404, { error: 'not_found', title: 'No stub' });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Admin Founder creation', () => {
  it('creates the Founder draft and leaves invitation delivery to the Invite stage', async () => {
    const user = userEvent.setup();
    const openFounder = vi.fn();
    render(<Directory onOpenFounder={openFounder} />);

    await user.click(await screen.findByRole('button', { name: 'Create Founder' }));
    const dialog = screen.getByRole('dialog', { name: 'Create Founder' });
    await user.type(within(dialog).getByLabelText('Founder name'), 'Maya Hassan');
    await user.type(within(dialog).getByLabelText('Email'), 'maya@example.com');
    await user.type(within(dialog).getByLabelText('Business'), 'Maya Labs');
    await user.type(within(dialog).getByLabelText(/^Owner/), 'Nadia Admin');
    expect(within(dialog).queryByLabelText('Invitation source')).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText('What Proovd understood')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /send invite/i })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Create Founder' }));

    await screen.findByText('Founder and first campaign created');

    const create = requests.find(
      (request) =>
        request.url.endsWith('/api/admin/founders') && request.method === 'POST',
    );
    expect(create?.body).toEqual({
      legalName: 'Maya Hassan',
      email: 'maya@example.com',
      productName: 'Maya Labs',
      internalOwner: 'Nadia Admin',
    });
    expect(requests.some((request) => request.url.includes('create-and-invite'))).toBe(false);
    expect(requests.some((request) => /\/send$/.test(request.url))).toBe(false);
    await waitFor(() => expect(openFounder).toHaveBeenCalledWith('prospect-1'));
  });
});
