import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import type { FounderEmailRendered, FounderEmailTemplate } from '@proovd/shared';
import { FounderEmailEditor } from './FounderEmailEditor.js';
import { FoundersPanel } from '../FoundersPanel.js';

const BASE = '/api/admin/founder-emails';
let stored: FounderEmailTemplate[];
let requests: Array<{ url: string; method: string; body?: Record<string, unknown> }>;
let rejectSave: boolean;
let rejectPreview: boolean;
let previewFieldErrors: Record<string, unknown> | null;
let stylesheet: HTMLLinkElement;

function rendered(subject: string): FounderEmailRendered {
  return { subject, html: `<html><body><p>${subject}</p><a href="#preview">Review invitation</a></body></html>`, text: `${subject}\nReview invitation` };
}

function fixture(key: FounderEmailTemplate['key'], title: string): FounderEmailTemplate {
  const copy = { subject: `Your ${title}`, body: 'It came out of our call.' };
  return {
    key, title, description: 'A personal follow-up for an invited Founder.',
    fields: [
      { key: 'subject', label: 'Subject', kind: 'text', required: true },
      { key: 'body', label: 'Message', kind: 'textarea', required: true },
    ],
    copy, defaultCopy: { ...copy }, version: 0, updatedAt: null, updatedBy: null,
    changeNote: null,
    notes: ['The green button became a text link.', 'The call paragraph stayed unchanged.'],
    variables: [{ key: 'productName', label: 'Product name' }],
    current: rendered(copy.subject), previous: rendered(`Old ${title}`),
  };
}

function response(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => structuredClone(body) } as Response;
}

beforeEach(() => {
  stored = [fixture('founder_invitation', 'Invitation'), fixture('founder_email_code', 'Verification code')];
  requests = [];
  rejectSave = false;
  rejectPreview = false;
  previewFieldErrors = null;
  stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = '/admin-founders.css';
  document.head.appendChild(stylesheet);

  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    requests.push({ url, method, ...(body ? { body } : {}) });
    if (url === '/api/admin/founders') return response(200, { founders: [] });
    if (url === BASE) return response(200, { templates: stored });
    const template = stored.find((item) => url.includes(item.key));
    if (!template) return response(404, { error: 'not_found', title: 'No stub' });
    if (method === 'POST') {
      if (rejectPreview) return response(400, { error: 'invalid_copy', title: previewFieldErrors ? 'Please check the highlighted email fields.' : 'Check the product detail', whatHappened: 'The product detail is missing.', next: 'Keep the product detail in the subject.', ...(previewFieldErrors ? { fields: previewFieldErrors } : {}) });
      const copy = body!['copy'] as Record<string, string>;
      return response(200, { current: rendered(copy['subject']!), previous: template.previous });
    }
    if (method === 'PUT') {
      if (rejectSave) return response(409, { error: 'version_conflict', title: 'Someone else updated this email', whatHappened: 'Your edits have not been saved.', next: 'Review the current stored version before saving again.' });
      const copy = body!['copy'] as Record<string, string>;
      const saved = { ...template, copy, current: rendered(copy['subject']!), version: template.version + 1, updatedAt: '2026-10-25T08:30:00Z', updatedBy: 'admin-1', changeNote: String(body!['changeNote'] || 'Updated invitation copy.') };
      stored = stored.map((item) => item.key === saved.key ? saved : item);
      return response(200, { template: saved });
    }
    return response(404, { error: 'not_found', title: 'No stub' });
  });
});

afterEach(() => {
  stylesheet.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mountEditor() {
  const router = createMemoryRouter([
    { path: '/admin/founders/emails', element: <FounderEmailEditor /> },
    { path: '/admin/founders', element: <h1>Founder directory</h1> },
  ], { initialEntries: ['/admin/founders/emails'] });
  return { router, ...render(<RouterProvider router={router} />) };
}

describe('Founder email editor', () => {
  it('is accessible from the Founder directory even with no founder records', async () => {
    const user = userEvent.setup();
    const router = createMemoryRouter([
      { path: '/admin/founders', element: <FoundersPanel /> },
      { path: '/admin/founders/emails', element: <FoundersPanel view="emails" /> },
    ], { initialEntries: ['/admin/founders'] });
    render(<RouterProvider router={router} />);
    await user.click(await screen.findByRole('link', { name: 'Emails' }));
    await screen.findByRole('heading', { name: 'Founder emails' });
    expect(router.state.location.pathname).toBe('/admin/founders/emails');
    expect(screen.getByRole('link', { name: 'Emails' })).toHaveAttribute('aria-current', 'page');
  });

  it('shows actual previous/current formatting in isolated previews and explains the updates', async () => {
    const user = userEvent.setup();
    mountEditor();
    await screen.findByLabelText('Subject');
    expect(screen.getByTitle('Current email body')).toHaveAttribute('sandbox', '');
    expect(screen.getByTitle('Current email body')).toHaveAttribute('srcdoc', stored[0]!.current.html);
    await user.click(screen.getByRole('tab', { name: 'Compare' }));
    expect(screen.getByTitle('Before updates email body')).toHaveAttribute('srcdoc', stored[0]!.previous.html);
    expect(screen.getByTitle('Before updates email body')).toHaveAttribute('sandbox', '');
    expect(screen.getByText('The call paragraph stayed unchanged.')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Old Invitation' })).toBeVisible();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Edit' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Compare' })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('button', { name: 'Plain text' }));
    expect(screen.getByLabelText('Before updates plain text')).toHaveTextContent('Old Invitation');
    expect(screen.queryByTitle('Before updates email body')).not.toBeInTheDocument();
  });

  it('previews edited copy, saves with the read version, and loads the persisted copy again', async () => {
    const user = userEvent.setup();
    const first = mountEditor();
    const subject = await screen.findByLabelText('Subject');
    await user.clear(subject);
    await user.type(subject, 'Following up on our call');
    expect(screen.getByRole('button', { name: 'Save this email' })).toBeDisabled();
    expect(screen.getByTitle('Current email body')).toHaveAttribute('srcdoc', stored[0]!.current.html);
    expect(screen.getByTitle('Current email body').closest('article')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Updating preview…')).toBeVisible();
    await screen.findByRole('heading', { name: 'Following up on our call' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save this email' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Save this email' }));
    await screen.findByText('Invitation saved. Future emails will use this copy.');
    const save = requests.find((request) => request.method === 'PUT');
    expect(save).toMatchObject({ url: `${BASE}/founder_invitation`, body: { version: 0, copy: { subject: 'Following up on our call', body: 'It came out of our call.' } } });
    first.unmount();
    mountEditor();
    expect(await screen.findByLabelText('Subject')).toHaveValue('Following up on our call');
    expect(screen.getByRole('button', { name: 'Save this email' })).toBeDisabled();
    expect(requests.filter((request) => request.method === 'PUT')).toHaveLength(1);
  });

  it('retains unsaved drafts when switching email types and never sends an email', async () => {
    const user = userEvent.setup();
    mountEditor();
    const subject = await screen.findByLabelText('Subject');
    await user.clear(subject);
    await user.type(subject, 'A saved place in this draft');
    await user.selectOptions(screen.getByLabelText('Email', { exact: true }), 'founder_email_code');
    expect(screen.getByLabelText('Subject')).toHaveValue('Your Verification code');
    await user.selectOptions(screen.getByLabelText('Email', { exact: true }), 'founder_invitation');
    expect(screen.getByLabelText('Subject')).toHaveValue('A saved place in this draft');
    expect(screen.getByText('Unsaved changes', { exact: true })).toBeVisible();
    expect(requests.filter((request) => request.method === 'PUT')).toHaveLength(0);
    expect(requests.every((request) => request.url === '/api/admin/founders' || request.url.startsWith(BASE))).toBe(true);
  });

  it('keeps the draft and renders the real server explanation when saving fails', async () => {
    const user = userEvent.setup();
    rejectSave = true;
    mountEditor();
    const subject = await screen.findByLabelText('Subject');
    await user.clear(subject);
    await user.type(subject, 'Still here after a failure');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save this email' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Save this email' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Someone else updated this email');
    expect(screen.getByRole('alert')).toHaveTextContent('Your edits have not been saved.');
    expect(screen.getByLabelText('Subject')).toHaveValue('Still here after a failure');
    expect(stored[0]!.copy['subject']).toBe('Your Invitation');
    expect(screen.getByText('Unsaved changes', { exact: true })).toBeVisible();
    stored[0] = { ...stored[0]!, version: 3, copy: { ...stored[0]!.copy, subject: 'Someone else saved this' } };
    await user.click(screen.getByRole('button', { name: 'Refresh saved version — keep my edits' }));
    expect(await screen.findByLabelText('Subject')).toHaveValue('Still here after a failure');
    rejectSave = false;
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save this email' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Save this email' }));
    await screen.findByText('Invitation saved. Future emails will use this copy.');
    expect(requests.filter((request) => request.method === 'PUT').at(-1)?.body).toMatchObject({ version: 3 });
  });

  it('does not present an old preview as the edited email when preview validation fails', async () => {
    const user = userEvent.setup();
    mountEditor();
    const subject = await screen.findByLabelText('Subject');
    rejectPreview = true;
    await user.clear(subject);
    await user.type(subject, 'Invalid edited subject');
    expect(await screen.findByRole('alert')).toHaveTextContent('Check the product detail');
    expect(screen.getByTitle('Current email body')).toHaveAttribute('srcdoc', stored[0]!.current.html);
    expect(screen.getByText('Last successful preview')).toBeVisible();
    expect(screen.getByText('This preview does not include your latest edits.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save this email' })).toBeDisabled();
    expect(screen.getByLabelText('Subject')).toHaveValue('Invalid edited subject');
  });

  it('protects unsaved changes on page exit and asks before internal navigation', async () => {
    const user = userEvent.setup();
    const { router } = mountEditor();
    const subject = await screen.findByLabelText('Subject');
    await user.type(subject, ' edited');
    const unload = new Event('beforeunload', { cancelable: true });
    fireEvent(window, unload);
    expect(unload.defaultPrevented).toBe(true);
    await user.click(screen.getByRole('link', { name: /Back to Founders/ }));
    await screen.findByRole('dialog', { name: 'Leave your unsaved edits?' });
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(router.state.location.pathname).toBe('/admin/founders/emails');
    expect(screen.getByLabelText('Subject')).toHaveValue('Your Invitation edited');
    await user.click(screen.getByRole('link', { name: /Back to Founders/ }));
    await user.click(await screen.findByRole('button', { name: 'Leave without saving' }));
    await screen.findByRole('heading', { name: 'Founder directory' });
    expect(stored[0]!.copy['subject']).toBe('Your Invitation');
  });

  it('shows server field reasons accessibly, retains non-field errors, and recovers after correction', async () => {
    const user = userEvent.setup();
    mountEditor();
    const subject = await screen.findByLabelText('Subject');
    rejectPreview = true;
    previewFieldErrors = {
      subject: 'Keep {{productName}} in this field.',
      copy: 'Use only the supported email fields.',
      unexpected: 42,
    };
    await user.clear(subject);
    await user.type(subject, 'Missing the product detail');
    expect(await screen.findByText('Keep {{productName}} in this field.')).toBeVisible();
    expect(subject).toHaveAttribute('aria-invalid', 'true');
    expect(subject).toHaveAttribute('aria-describedby', 'fee-subject-error');
    expect(screen.getByRole('alert')).toHaveTextContent('Use only the supported email fields.');
    expect(screen.getByText('This preview does not include your latest edits.')).toBeVisible();
    expect(subject).toHaveValue('Missing the product detail');
    rejectPreview = false;
    await user.clear(subject);
    await user.paste('A follow-up for {{productName}}');
    await waitFor(() => expect(subject).not.toHaveAttribute('aria-invalid'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save this email' })).toBeEnabled());
    expect(screen.queryByText('Keep {{productName}} in this field.')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(subject).toHaveValue('A follow-up for {{productName}}');
  });
});
