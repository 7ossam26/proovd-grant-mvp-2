import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { SetupChangeRequests } from './SetupChangeRequests.js';

const campaignId = '15151515-1515-4515-8515-151515151515';
const base = `/campaigns/${campaignId}`;
const voice = {
  id: 'request-1', campaignId, fieldKey: 'build.brand_voice', fieldLabel: 'Final voice',
  reason: 'Please use a warmer voice.\nKeep the product names clear.',
  deepLink: `${base}/setup/voice?changeRequest=request-1`, requestedAt: '2026-10-25T00:00:00Z',
};
function response(requests: unknown[]): Response {
  return { ok: true, status: 200, json: async () => ({ requests }) } as Response;
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Founder saved change requests', () => {
  it('loads the owned campaign requests and opens the exact emailed reason on its edit page', async () => {
    const fetch = vi.fn().mockResolvedValue(response([voice]));
    vi.stubGlobal('fetch', fetch);
    render(<MemoryRouter initialEntries={[voice.deepLink]}><SetupChangeRequests campaignId={campaignId} floating /></MemoryRouter>);
    await screen.findByText(/Please use a warmer voice/);
    expect(screen.getByText(/Please use a warmer voice/).textContent).toBe(voice.reason);
    expect(screen.getByText('Final voice').closest('details')).toHaveAttribute('open');
    expect(screen.getByRole('link', { name: 'Open this field' })).toHaveAttribute('href', voice.deepLink);
    expect(fetch).toHaveBeenCalledWith(`/api/founder/campaigns/${campaignId}/setup-change-requests`, expect.objectContaining({ credentials: 'same-origin' }));
  });

  it('stays absent when there are no requests and hides other fields on a focused setup page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([{ ...voice, deepLink: `${base}/setup/faqs?changeRequest=request-1` }])));
    await act(async () => {
      render(<MemoryRouter initialEntries={[`${base}/setup/voice`]}><SetupChangeRequests campaignId={campaignId} floating /></MemoryRouter>);
    });
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('keeps a failed emailed request visible with a retry action', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response([voice]));
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={[voice.deepLink]}><SetupChangeRequests campaignId={campaignId} /></MemoryRouter>);
    await screen.findByText('We could not load the requested change.');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText(/Please use a warmer voice/);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
