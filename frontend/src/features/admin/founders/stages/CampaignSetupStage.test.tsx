import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CampaignSetupStage } from './CampaignSetupStage.js';
import { type StageProps } from './recordGroup.js';

const campaignId = '15151515-1515-4515-8515-151515151515';
const faqId = '25252525-2525-4525-8525-252525252525';
const props = {
  detail: {
    header: { preferredName: 'Ari', legalName: 'Ari Founder' },
    campaigns: { current: { campaignId, buildVersion: 1 } },
  },
  panel: {
    setup: {
      fields: { brandVoice: { value: 'Warm, clear' } },
      faqs: [{ id: faqId, question: 'When?', answer: 'Soon.' }],
    },
  },
  onSaved: vi.fn(),
} as unknown as StageProps;

function response(body: unknown): Response {
  return { ok: true, status: 201, json: async () => body } as Response;
}

function row(label: string): HTMLElement {
  return screen.getByText(label, { exact: true }).closest('.record-row') as HTMLElement;
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Campaign Setup change requests', () => {
  it('sends the actual endpoint and a stable stored FAQ target, with a request identity', async () => {
    const fetch = vi.fn().mockResolvedValue(response({
      requestId: 'request-1', created: true, notification: { status: 'sent' },
    }));
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    render(<CampaignSetupStage {...props} />);
    await user.click(within(row('FAQ 1 · Answer')).getByRole('button', { name: 'Request change' }));
    await user.type(screen.getByRole('textbox', { name: 'Required reason' }), 'Give a precise date.');
    await user.click(screen.getByRole('button', { name: 'Request this change' }));

    await screen.findByText('Change requested against FAQ 1 · Answer. The Founder email was sent.');
    expect(fetch).toHaveBeenCalledTimes(1);
    const [path, init] = fetch.mock.calls[0]!;
    expect(path).toBe(`/api/admin/campaigns/${campaignId}/setup-change-requests`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      fieldKey: `faq.${faqId}.answer`, reason: 'Give a precise date.', requestKey: expect.any(String),
    });
    expect(JSON.parse(init.body).requestKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps the reason and request identity when email delivery fails, then retries it', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ requestId: 'request-1', created: true, notification: { status: 'failed' } }))
      .mockResolvedValueOnce(response({ requestId: 'request-1', created: false, notification: { status: 'sent' } }));
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    render(<CampaignSetupStage {...props} />);
    await user.click(within(row('Final voice')).getByRole('button', { name: 'Request change' }));
    const reason = screen.getByRole('textbox', { name: 'Required reason' });
    await user.type(reason, 'Please use a warmer voice.');
    await user.click(screen.getByRole('button', { name: 'Request this change' }));
    await screen.findByText(/request is saved and visible to the Founder, but the email was not sent/);
    expect(reason).toHaveValue('Please use a warmer voice.');
    expect(reason).toHaveAttribute('readonly');
    expect(screen.queryByText(/The Founder email was sent/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Request this change' }));
    await screen.findByText('Change requested against Final voice. The Founder email was sent.');
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual(JSON.parse(fetch.mock.calls[1]![1].body));
  });

  it('only offers Founder requests for fields the Founder can change', () => {
    render(<CampaignSetupStage {...props} />);
    expect(within(row('Original prefills')).queryByRole('button', { name: 'Request change' })).toBeNull();
    expect(within(row('Final voice')).getByRole('button', { name: 'Request change' })).toBeEnabled();
    expect(within(row('Campaign limit')).queryByRole('button', { name: 'Request change' })).toBeNull();
    expect(within(row('Draft campaign version')).queryByRole('button', { name: 'Request change' })).toBeNull();
  });
});
