/**
 * Phase 07 Founder surfaces — §33.1.4, §33.1.5, §33.1.6, §33.1.9, §33.11.
 *
 * The real route table in a memory router with `fetch` stubbed at the network
 * boundary. The server-side halves of these requirements — that the type lock
 * is permanent, that a zero never leaves the server, that
 * `founder_signup_complete` emits once — are proved in
 * `backend/src/tests/vetting.test.ts` against the real routes. What is proved
 * here is the half §33.1.4 puts on the surface and nowhere else: the fixed
 * order, the visible progress, Back and Continue, the three save phrases, the
 * restored-draft line, the unsaved-data warning, and that a failed save leaves
 * every field exactly as the Founder typed it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { axe } from 'jest-axe';
import { appRoutes } from '../../routes.js';
import { POSSIBLE_CREATOR_RESULT_DISCLOSURES, VETTING_STEPS } from '@proovd/shared';

type StubResult = { status: number; body: unknown } | undefined;
type Handler = (url: string, init?: RequestInit) => StubResult;

let handlers: Handler[] = [];
let requests: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = [];

function respond(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

beforeEach(() => {
  handlers = [];
  requests = [];
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const url = String(input);
    requests.push({
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    for (const handler of handlers) {
      const result = handler(url, init);
      if (result) return respond(result.status, result.body);
    }
    return respond(404, { error: 'not_found', title: 'No stub' });
  });
});

afterEach(() => vi.unstubAllGlobals());

const TOKEN = 'a'.repeat(43);

const EMPTY_PROVENANCE = { supplier: null, firstEditedAt: null, lastEditedAt: null };

function vettingState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    draftId: 'd1',
    campaignId: 'c1',
    selectedType: null,
    problem: null,
    solution: null,
    competition: null,
    provenance: {
      problem: { ...EMPTY_PROVENANCE, prefilledText: null, prefilledAt: null },
      solution: { ...EMPTY_PROVENANCE, prefilledText: null, prefilledAt: null },
      competition: { ...EMPTY_PROVENANCE },
    },
    lastSavedAt: null,
    resumeStep: null,
    submittedAt: null,
    completeness: { campaign_path: false, problem: false, solution: false, competition: false },
    campaignStatus: 'invited_draft',
    lockedType: null,
    typeLockedAt: null,
    ...overrides,
  };
}

/** Serves the vetting route, echoing each patch back the way the server does. */
function stubVetting(initial: Record<string, unknown> = {}) {
  let state = vettingState(initial);
  handlers.push((url, init) => {
    if (!url.includes('/vetting')) return undefined;
    if (url.endsWith('/submit')) {
      state = { ...state, submittedAt: '2026-07-31T12:00:00.000Z' };
      return { status: 201, body: state };
    }
    if (init?.method === 'PATCH') {
      const patch = JSON.parse(String(init.body)) as Record<string, unknown>;
      state = { ...state, ...patch, lastSavedAt: '2026-07-31T12:00:00.000Z' };
      state['completeness'] = {
        campaign_path: state['selectedType'] !== null,
        problem: typeof state['problem'] === 'string' && state['problem'] !== '',
        solution: typeof state['solution'] === 'string' && state['solution'] !== '',
        competition: typeof state['competition'] === 'string' && state['competition'] !== '',
      };
      return { status: 200, body: state };
    }
    return { status: 200, body: state };
  });
  return () => state;
}

function renderAt(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  return render(<RouterProvider router={router} />);
}

const renderVetting = () => renderAt(`/draft/${TOKEN}/vetting`);

/* ══════════════════════════════════════════════════════════════════════════
   §33.1.4 — order, progress, Back/Continue, autosave, restore
   ══════════════════════════════════════════════════════════════════════════ */

describe('§33.1.4 the vetting sequence', () => {
  it('opens on step 1 of 5 and shows the progress', async () => {
    stubVetting();
    renderVetting();

    await screen.findByRole('heading', { name: /which of these is closer/i });
    expect(await screen.findByText('Step 1 of 5')).toBeTruthy();
  });

  it('walks §9’s fixed order and never varies it', async () => {
    const user = userEvent.setup();
    stubVetting();
    renderVetting();

    // 1. Campaign path
    await screen.findByRole('heading', { name: /which of these is closer/i });
    await user.click(screen.getByRole('radio', { name: /i have a product/i }));
    await user.click(screen.getByRole('button', { name: /^Continue to / }));

    // 2. Problem
    await screen.findByRole('heading', { name: /what problem does your product solve/i });
    await user.type(screen.getByLabelText(/what problem does your product solve/i), 'A problem.');
    await user.click(screen.getByRole('button', { name: /^Continue to / }));

    // 3. Solution
    await screen.findByRole('heading', { name: /what does your product do about it/i });
    await user.type(screen.getByLabelText(/what does your product do about it/i), 'A solution.');
    await user.click(screen.getByRole('button', { name: /^Continue to / }));

    // 4. Competition
    await screen.findByRole('heading', { name: /who else is solving this/i });
    await user.type(screen.getByLabelText(/who else is solving this/i), 'Spreadsheets.');
    await user.click(screen.getByRole('button', { name: 'Review my answers' }));

    // 5. The review moment (DNA §5.9)
    await screen.findByRole('heading', { name: /everything you have told us/i });
  });

  it('Continue is unavailable until the step is answered', async () => {
    stubVetting();
    renderVetting();
    await screen.findByRole('heading', { name: /which of these is closer/i });
    expect(screen.getByRole('button', { name: /^Continue to / }).hasAttribute('disabled')).toBe(true);
  });

  it('Back returns to the previous step and does not exist on the first', async () => {
    const user = userEvent.setup();
    stubVetting({ selectedType: 'pre_launch' });
    renderVetting();

    await screen.findByRole('heading', { name: /which of these is closer/i });
    // Phase 23a (§33.11.4, §1.4): nothing precedes step 1, so there is no
    // control rather than a permanently disabled one — and every nav control
    // now names where it goes.
    expect(screen.queryByRole('button', { name: /^Back to / })).toBeNull();

    await user.click(screen.getByRole('button', { name: /^Continue to / }));
    await screen.findByRole('heading', { name: /what problem does your product solve/i });
    await user.click(screen.getByRole('button', { name: /^Back to / }));
    await screen.findByRole('heading', { name: /which of these is closer/i });
  });

  it('returning to an earlier step preserves a later answer (§9)', async () => {
    const user = userEvent.setup();
    stubVetting({ selectedType: 'pre_launch' });
    renderVetting();

    await screen.findByRole('heading', { name: /which of these is closer/i });
    await user.click(screen.getByRole('button', { name: /^Continue to / }));
    await user.type(screen.getByLabelText(/what problem/i), 'A problem.');
    await user.click(screen.getByRole('button', { name: /^Continue to / }));
    await user.type(screen.getByLabelText(/what does your product do/i), 'A solution.');
    await user.click(screen.getByRole('button', { name: /^Continue to / }));
    await user.type(screen.getByLabelText(/who else is solving this/i), 'Spreadsheets.');

    // All the way back to step 2, then forward again. Step 4's answer survives.
    await user.click(within(screen.getByRole('navigation', { name: 'All steps' })).getByRole('button', { name: 'Problem' }));
    await screen.findByRole('heading', { name: /what problem/i });
    expect((screen.getByLabelText(/what problem/i) as HTMLTextAreaElement).value).toBe('A problem.');

    await user.click(within(screen.getByRole('navigation', { name: 'All steps' })).getByRole('button', { name: 'Competition' }));
    await screen.findByRole('heading', { name: /who else is solving this/i });
    expect((screen.getByLabelText(/who else/i) as HTMLTextAreaElement).value).toBe('Spreadsheets.');
  });

  it('says Saving… then Saved with a time (§9’s vocabulary)', async () => {
    const user = userEvent.setup();
    stubVetting({ selectedType: 'pre_launch' });
    renderVetting();

    await screen.findByRole('heading', { name: /which of these is closer/i });
    await user.click(screen.getByRole('button', { name: /^Continue to / }));
    await user.type(screen.getByLabelText(/what problem/i), 'A problem.');

    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/^Saved /), {
      timeout: 4000,
    });
  });

  it('says Could not save — retrying only while a retry is scheduled (§1.4)', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    handlers.push((url, init) => {
      if (!url.includes('/vetting')) return undefined;
      if (init?.method === 'PATCH') {
        attempts += 1;
        // A 500 is transient: worth retrying, and the line may say so.
        return { status: 500, body: { title: 'Proovd could not be reached' } };
      }
      return { status: 200, body: vettingState({ selectedType: 'pre_launch' }) };
    });
    renderVetting();

    await screen.findByRole('heading', { name: /which of these is closer/i });
    await user.click(screen.getByRole('button', { name: /^Continue to / }));
    await user.type(screen.getByLabelText(/what problem/i), 'A problem.');

    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/retrying/i), {
      timeout: 4000,
    });
    expect(attempts).toBeGreaterThan(0);
  });

  it('a failed save never clears a valid field (§9)', async () => {
    const user = userEvent.setup();
    handlers.push((url, init) => {
      if (!url.includes('/vetting')) return undefined;
      if (init?.method === 'PATCH') {
        return {
          status: 422,
          body: { title: 'That was not saved', whatHappened: 'Refused.', next: 'Nothing changed.' },
        };
      }
      return { status: 200, body: vettingState({ selectedType: 'pre_launch' }) };
    });
    renderVetting();

    await screen.findByRole('heading', { name: /which of these is closer/i });
    await user.click(screen.getByRole('button', { name: /^Continue to / }));
    const box = screen.getByLabelText(/what problem/i) as HTMLTextAreaElement;
    await user.type(box, 'Work I do not want to lose.');

    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Not saved/i), {
      timeout: 4000,
    });
    // The whole point: the refusal did not take the sentence with it.
    expect(box.value).toBe('Work I do not want to lose.');
  });

  it('a 4xx is a decision, not something to promise to retry (§1.4)', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    handlers.push((url, init) => {
      if (!url.includes('/vetting')) return undefined;
      if (init?.method === 'PATCH') {
        attempts += 1;
        return { status: 422, body: { title: 'That was not saved', whatHappened: 'Refused.' } };
      }
      return { status: 200, body: vettingState({ selectedType: 'pre_launch' }) };
    });
    renderVetting();

    await screen.findByRole('heading', { name: /which of these is closer/i });
    await user.click(screen.getByRole('button', { name: /^Continue to / }));
    await user.type(screen.getByLabelText(/what problem/i), 'Refused text.');

    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Not saved/i), {
      timeout: 4000,
    });
    expect(screen.getByRole('status').textContent).not.toMatch(/retrying/i);
    expect(attempts).toBe(1);
  });

  it('says when the restored draft was last saved (§9)', async () => {
    stubVetting({
      problem: 'Written last week.',
      lastSavedAt: '2026-07-24T09:30:00.000Z',
      resumeStep: 'problem',
      completeness: { campaign_path: false, problem: true, solution: false, competition: false },
    });
    renderVetting();

    expect(await screen.findByText(/we restored what you wrote last time/i)).toBeTruthy();
    // And it reopened where they left off, not at step 1 (DNA §5.12).
    await screen.findByRole('heading', { name: /what problem/i });
    expect((screen.getByLabelText(/what problem/i) as HTMLTextAreaElement).value).toBe(
      'Written last week.',
    );
  });

  it('warns the browser before leaving with unsaved data (§9)', async () => {
    const user = userEvent.setup();
    const added: string[] = [];
    const original = window.addEventListener.bind(window);
    vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
      added.push(String(type));
      return original(type, listener as EventListener, options);
    });

    stubVetting({ selectedType: 'pre_launch' });
    renderVetting();
    await screen.findByRole('heading', { name: /which of these is closer/i });
    await user.click(screen.getByRole('button', { name: /^Continue to / }));
    await user.type(screen.getByLabelText(/what problem/i), 'U');

    await waitFor(() => expect(added).toContain('beforeunload'));
    vi.restoreAllMocks();
  });

  it('shows the permanence of the campaign path before it is chosen, and again at review', async () => {
    const user = userEvent.setup();
    stubVetting({
      selectedType: 'pre_launch',
      problem: 'p',
      solution: 's',
      competition: 'c',
      completeness: { campaign_path: true, problem: true, solution: true, competition: true },
    });
    renderVetting();

    expect(await screen.findAllByText(/this choice is permanent/i)).toHaveLength(1);

    await user.click(
      within(screen.getByRole('navigation', { name: 'All steps' })).getByRole('button', {
        name: 'Review',
      }),
    );
    await screen.findByRole('heading', { name: /everything you have told us/i });
    expect(screen.getAllByText(/this choice is permanent/i).length).toBeGreaterThan(0);
  });

  it('renders both campaign paths in full, with what each commits them to (§4, §9)', async () => {
    stubVetting();
    renderVetting();

    await screen.findByRole('heading', { name: /which of these is closer/i });
    expect(screen.getByText('Idea Campaign')).toBeTruthy();
    expect(screen.getByText('Product Campaign')).toBeTruthy();
    expect(screen.getAllByText(/what this commits you to/i)).toHaveLength(2);
  });

  it('never renders an internal name (§3)', async () => {
    stubVetting();
    const { container } = renderVetting();
    await screen.findByRole('heading', { name: /tell us about your product/i });
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/pre[-_]build/i);
    expect(text).not.toMatch(/pre[-_]launch/i);
    expect(text).not.toMatch(/\breservation\b/i);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   §33.1.5 — Competition is never prefilled
   ══════════════════════════════════════════════════════════════════════════ */

describe('§33.1.5 the Competition step', () => {
  it('starts blank even when Proovd prefilled the other two', async () => {
    const user = userEvent.setup();
    stubVetting({
      selectedType: 'pre_launch',
      problem: 'Our draft of the problem.',
      solution: 'Our draft of the solution.',
      provenance: {
        problem: {
          supplier: 'proovd',
          prefilledText: 'Our draft of the problem.',
          prefilledAt: '2026-07-30T09:00:00.000Z',
          firstEditedAt: null,
          lastEditedAt: null,
        },
        solution: {
          supplier: 'proovd',
          prefilledText: 'Our draft of the solution.',
          prefilledAt: '2026-07-30T09:00:00.000Z',
          firstEditedAt: null,
          lastEditedAt: null,
        },
        competition: { supplier: null, firstEditedAt: null, lastEditedAt: null },
      },
      completeness: { campaign_path: true, problem: true, solution: true, competition: false },
    });
    renderVetting();

    await screen.findByRole('heading', { name: /which of these is closer/i });
    await user.click(
      within(screen.getByRole('navigation', { name: 'All steps' })).getByRole('button', {
        name: 'Competition',
      }),
    );

    const box = (await screen.findByLabelText(/who else is solving this/i)) as HTMLTextAreaElement;
    expect(box.value).toBe('');
    // And it says why, rather than leaving the Founder to wonder.
    expect(screen.getByText(/this one is yours from a blank page/i)).toBeTruthy();
  });

  it('shows the Proovd-drafted fields as drafted, and never claims a draft it does not have', async () => {
    const user = userEvent.setup();
    stubVetting({
      selectedType: 'pre_launch',
      problem: 'Our draft of the problem.',
      provenance: {
        problem: {
          supplier: 'proovd',
          prefilledText: 'Our draft of the problem.',
          prefilledAt: '2026-07-30T09:00:00.000Z',
          firstEditedAt: null,
          lastEditedAt: null,
        },
        solution: { supplier: null, prefilledText: null, prefilledAt: null, firstEditedAt: null, lastEditedAt: null },
        competition: { supplier: null, firstEditedAt: null, lastEditedAt: null },
      },
      completeness: { campaign_path: true, problem: true, solution: false, competition: false },
    });
    renderVetting();

    await screen.findByRole('heading', { name: /which of these is closer/i });
    await user.click(
      within(screen.getByRole('navigation', { name: 'All steps' })).getByRole('button', {
        name: 'Problem',
      }),
    );
    expect(await screen.findByText(/drafted by proovd/i)).toBeTruthy();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   §33.1.6 — the possible-creator result
   ══════════════════════════════════════════════════════════════════════════ */

describe('§33.1.6 the possible-creator result', () => {
  function stubSignal(body: Record<string, unknown>) {
    handlers.push((url) =>
      url.includes('/creator-signal') ? { status: 200, body } : undefined,
    );
  }

  it('shows the count with every §10 limit beside it', async () => {
    stubSignal({
      status: 'available',
      count: 7,
      recordedAt: '2026-07-31T10:00:00.000Z',
      submittedAt: '2026-07-31T09:00:00.000Z',
    });
    renderAt(`/draft/${TOKEN}/result`);

    expect(await screen.findByText('7')).toBeTruthy();
    for (const line of POSSIBLE_CREATOR_RESULT_DISCLOSURES) {
      expect(screen.getByText(line)).toBeTruthy();
    }
  });

  it('promises nothing and names nobody', async () => {
    stubSignal({
      status: 'available',
      count: 7,
      recordedAt: '2026-07-31T10:00:00.000Z',
      submittedAt: '2026-07-31T09:00:00.000Z',
    });
    const { container } = renderAt(`/draft/${TOKEN}/result`);
    await screen.findByText('7');

    const text = (container.textContent ?? '').toLowerCase();
    expect(text).toContain('it is not a roster');
    expect(text).not.toMatch(/\bconfirmed\b/);
    expect(text).not.toMatch(/\binterested\b/);
    expect(text).not.toMatch(/\bwaiting to\b/);
    // §3: `affiliate` is internal, always.
    expect(text).not.toMatch(/\baffiliate/);
  });

  it('precedes the account: the only action is on to the claim', async () => {
    stubSignal({
      status: 'available',
      count: 3,
      recordedAt: '2026-07-31T10:00:00.000Z',
      submittedAt: '2026-07-31T09:00:00.000Z',
    });
    const { container } = renderAt(`/draft/${TOKEN}/result`);
    await screen.findByText('3');

    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain(`/draft/${TOKEN}/claim`);
  });

  it('renders no number at all when the result is with Admin (§10)', async () => {
    stubSignal({
      status: 'with_admin',
      count: null,
      recordedAt: null,
      submittedAt: '2026-07-31T09:00:00.000Z',
    });
    const { container } = renderAt(`/draft/${TOKEN}/result`);

    expect(await screen.findByText(/we're reviewing your submission/i)).toBeTruthy();
    // No zero, no "0 creators", nothing numeric standing in for a result.
    expect(container.textContent).not.toMatch(/\b0\b/);
    // And the claim is not offered.
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).not.toContain(`/draft/${TOKEN}/claim`);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   §10 / §28.4 — the account claim
   ══════════════════════════════════════════════════════════════════════════ */

describe('the account claim', () => {
  const PROFILE = {
    draftId: 'd1',
    campaignId: 'c1',
    fields: {
      legalName: { value: 'Rowan Vale', supplier: 'proovd', prefilled: 'Rowan Vale', editedAt: null },
      preferredName: { value: 'Rowan', supplier: 'proovd', prefilled: 'Rowan', editedAt: null },
      email: { value: 'rowan@example.com', supplier: 'proovd', prefilled: 'rowan@example.com', editedAt: null },
      phone: { value: '+1 555 0100', supplier: 'proovd', prefilled: '+1 555 0100', editedAt: null },
      dateOfBirth: { value: null, supplier: null, prefilled: null, editedAt: null },
      country: { value: null, supplier: null, prefilled: null, editedAt: null },
      stateRegion: { value: null, supplier: null, prefilled: null, editedAt: null },
      businessName: { value: null, supplier: null, prefilled: null, editedAt: null },
      businessEntityType: { value: null, supplier: null, prefilled: null, editedAt: null },
    },
    soleProprietor: null,
    emailOwnership: 'invited_link',
    phoneVerified: false,
    representations: { usPerson: false, age18Plus: false, sanctions: false },
    lastSavedAt: null,
    claimedAt: null,
  };

  const PUBLISHED = [
    { slug: 'terms', route: '/terms', title: 'Terms of Service', version: '1.0', status: 'published' },
    { slug: 'aup', route: '/acceptable-use', title: 'Founder Acceptable Use Policy', version: '1.0', status: 'published' },
    { slug: 'privacy', route: '/privacy', title: 'Privacy Policy', version: '1.0', status: 'published' },
  ];

  function stubClaim(policies: unknown[] = PUBLISHED, profile = PROFILE) {
    handlers.push((url, init) => {
      if (!url.includes('/claim')) return undefined;
      if (init?.method === 'PATCH') return { status: 200, body: profile };
      if (init?.method === 'POST') return { status: 201, body: { ok: true, campaignId: 'c1' } };
      return { status: 200, body: { profile, policies } };
    });
  }

  it('prefills every field and says where each value came from (§10)', async () => {
    stubClaim();
    renderAt(`/draft/${TOKEN}/claim`);

    const name = (await screen.findByLabelText('Legal name')) as HTMLInputElement;
    expect(name.value).toBe('Rowan Vale');
    expect(screen.getAllByText(/from your invitation/i).length).toBeGreaterThan(0);
  });

  it('says the phone is unverified and offers no way to verify it (§33.1.8)', async () => {
    stubClaim();
    const { container } = renderAt(`/draft/${TOKEN}/claim`);

    await screen.findByLabelText('Phone');
    expect(screen.getByText(/we never send codes to this number/i)).toBeTruthy();
    expect(container.textContent).not.toMatch(/verify (?:your )?(?:phone|number)/i);
    expect(screen.queryByRole('button', { name: /verify/i })).toBeNull();
  });

  it('starts every consent and every representation unchecked (§28.4)', async () => {
    stubClaim();
    renderAt(`/draft/${TOKEN}/claim`);

    await screen.findByRole('heading', { name: /what you are agreeing to/i });
    for (const box of screen.getAllByRole('checkbox')) {
      expect(box.getAttribute('aria-checked')).toBe('false');
    }
    // §28.4 forbids bundling: there is no single control that accepts them all.
    expect(screen.queryByRole('checkbox', { name: /accept all/i })).toBeNull();
  });

  it('keeps the claim closed until every consent and representation is given', async () => {
    const user = userEvent.setup();
    stubClaim();
    renderAt(`/draft/${TOKEN}/claim`);

    await screen.findByRole('heading', { name: /what you are agreeing to/i });
    const create = screen.getByRole('button', { name: /create my account/i });
    expect(create.hasAttribute('disabled')).toBe(true);

    await user.type(screen.getByLabelText(/choose a password/i), 'a-long-enough-password');
    expect(screen.getByRole('button', { name: /create my account/i }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('does not offer to create an account while an agreement is unpublished (§31.4)', async () => {
    stubClaim([
      { slug: 'terms', route: '/terms', title: 'Terms of Service', version: '1.0', status: 'draft' },
      ...PUBLISHED.slice(1),
    ]);
    renderAt(`/draft/${TOKEN}/claim`);

    expect(await screen.findByText(/still with our lawyers/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /create my account/i })).toBeNull();
    // And it says nothing was lost, which is the §27.1 answer that matters here.
    expect(screen.getByText(/everything you have entered is saved/i)).toBeTruthy();
  });

  it('says the link is used up once the account exists (§10)', async () => {
    const user = userEvent.setup();
    stubClaim();
    renderAt(`/draft/${TOKEN}/claim`);

    await screen.findByRole('heading', { name: /what you are agreeing to/i });
    await user.type(screen.getByLabelText(/choose a password/i), 'a-long-enough-password');
    await user.type(screen.getByLabelText('Date of birth'), '1990-04-11');
    await user.type(screen.getByLabelText('Country'), 'United States');
    await user.type(screen.getByLabelText('State'), 'Oregon');
    await user.click(screen.getByRole('checkbox', { name: /sole proprietor/i }));
    // The three agreements and the three representations, each its own control
    // — §28.4 forbids one that does all six, so the test cannot take one either.
    for (const name of [
      /i accept the terms of service/i,
      /i accept the founder acceptable use policy/i,
      /i accept the privacy policy/i,
      /i am a us person/i,
      /i am 18 or older/i,
      /i am not on any sanctions list/i,
    ]) {
      await user.click(screen.getByRole('checkbox', { name }));
    }

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /create my account/i }).hasAttribute('disabled'),
      ).toBe(false),
    );

    await user.click(screen.getByRole('button', { name: /create my account/i }));
    expect(await screen.findByText(/your invitation link has been used/i)).toBeTruthy();
  });

  it('sends the password only on the claim, never on an autosave (§28.2)', async () => {
    const user = userEvent.setup();
    stubClaim();
    renderAt(`/draft/${TOKEN}/claim`);

    await screen.findByRole('heading', { name: /what you are agreeing to/i });
    await user.type(screen.getByLabelText(/choose a password/i), 'a-long-enough-password');
    await user.type(screen.getByLabelText('Country'), 'United States');

    await waitFor(() => expect(requests.some((r) => r.method === 'PATCH')).toBe(true), {
      timeout: 4000,
    });
    for (const request of requests.filter((r) => r.method === 'PATCH')) {
      expect(request.body).not.toHaveProperty('password');
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   §33.11 — the surfaces are operable
   ══════════════════════════════════════════════════════════════════════════ */

describe('§33.11 the Founder surfaces are operable', () => {
  it('has no axe violations on the vetting flow', async () => {
    stubVetting();
    const { container } = renderVetting();
    await screen.findByRole('heading', { name: /tell us about your product/i });
    expect(await axe(container)).toHaveNoViolations();
  });

  it('has no axe violations on the possible-creator result', async () => {
    handlers.push((url) =>
      url.includes('/creator-signal')
        ? {
            status: 200,
            body: {
              status: 'available',
              count: 7,
              recordedAt: '2026-07-31T10:00:00.000Z',
              submittedAt: '2026-07-31T09:00:00.000Z',
            },
          }
        : undefined,
    );
    const { container } = renderAt(`/draft/${TOKEN}/result`);
    await screen.findByText('7');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('exposes exactly one level-1 heading per Founder surface', async () => {
    stubVetting();
    renderVetting();
    await screen.findByRole('heading', { name: /tell us about your product/i });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('offers every step of the flow to the keyboard', async () => {
    stubVetting({
      selectedType: 'pre_launch',
      completeness: { campaign_path: true, problem: false, solution: false, competition: false },
    });
    renderVetting();

    const nav = await screen.findByRole('navigation', { name: 'All steps' });
    const buttons = within(nav).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual([
      ...VETTING_STEPS.filter((s) => s.id !== 'possible_creator_result').map((s) => s.label),
      'Review',
    ]);
    for (const button of buttons) {
      expect(button.hasAttribute('disabled')).toBe(false);
    }
  });
});
