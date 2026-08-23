import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
    if (url.endsWith('/api/admin/founders/create-and-invite') && method === 'POST') {
      return response(201, {
        prospectId: 'prospect-1',
        campaignId: 'campaign-1',
        draftId: 'draft-1',
        sendId: 'send-1',
        tokenVersion: 1,
        resent: false,
        alreadySent: false,
      });
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
  it('creates, completes the invitation, and delivers it through the real send path', async () => {
    const user = userEvent.setup();
    const openFounder = vi.fn();
    render(<Directory onOpenFounder={openFounder} />);

    await user.click(await screen.findByRole('button', { name: 'Create Founder' }));
    await user.type(screen.getByLabelText('Founder name'), 'Maya Hassan');
    await user.type(screen.getByLabelText('Email'), 'maya@example.com');
    await user.type(screen.getByLabelText('Business'), 'Maya Labs');
    await user.type(screen.getByLabelText(/^Owner/), 'Nadia Admin');
    await user.type(screen.getByLabelText('Invitation source'), 'Founder referral');
    await user.type(
      screen.getByLabelText('What Proovd understood'),
      'Maya Labs makes repairable desk lights for small workshops.',
    );
    await user.type(
      screen.getByLabelText('Why this Founder was invited'),
      'The product has a clear customer problem and a working prototype.',
    );
    await user.type(screen.getByLabelText('Expected setup time'), 'About 20 minutes');
    await user.click(screen.getByRole('button', { name: 'Create Founder and send invite' }));

    await screen.findByText('Founder created and invitation sent');

    const create = requests.find(
      (request) =>
        request.url.endsWith('/api/admin/founders/create-and-invite') &&
        request.method === 'POST',
    );
    expect(create?.body).toMatchObject({
      legalName: 'Maya Hassan',
      email: 'maya@example.com',
      businessName: 'Maya Labs',
      invitationSource: 'Founder referral',
      internalOwner: 'Nadia Admin',
      campaignType: 'pre_build',
      whatWeUnderstood: 'Maya Labs makes repairable desk lights for small workshops.',
      whyInvited: 'The product has a clear customer problem and a working prototype.',
      expectedSetupTime: 'About 20 minutes',
    });
    expect(create?.body?.['requestKey']).toMatch(/^[0-9a-f-]{36}$/i);
    expect(requests.filter((request) => request.method !== 'GET')).toHaveLength(1);
    await waitFor(() => expect(openFounder).toHaveBeenCalledWith('prospect-1'));
  });
});
