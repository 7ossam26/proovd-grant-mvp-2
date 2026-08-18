/**
 * The Founder draft surfaces — §9's own four items, order, progress, autosave,
 * restore, the claim, and §33.11.
 *
 * ── Updated for the 2026-08-18 reversion ──────────────────────────────────
 * The campaign path is the Founder's step again and Positioning is the third
 * answer, so the flow is four screens rather than three. This surface is
 * INTERIM — Founder Flow v2 replaces it with twenty-six full-bleed pages in
 * Session B — and the tests below moved with the records, not with a design.
 *
 * The real route table in a memory router with `fetch` stubbed at the network
 * boundary. The server-side halves — that the type lock is permanent, that the
 * campaign path is Admin's, that `founder_signup_complete` emits once — are
 * proved in `backend/src/tests/vetting.test.ts` against the real routes. What
 * is proved here is the half only the surface owns: the fixed three-step
 * order, the visible progress, Back and Continue, the three save phrases, the
 * restored-draft line, the unsaved-data warning, that a failed save leaves
 * every field exactly as the Founder typed it, and that submitting lands on
 * the account claim.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { axe } from 'jest-axe';
import { appRoutes } from '../../routes.js';
import { VETTING_STEPS, CAMPAIGN_PATH_CHOICES } from '@proovd/shared';

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

const EMPTY_PROVENANCE = {
  supplier: null,
  prefilledText: null,
  prefilledAt: null,
  firstEditedAt: null,
  lastEditedAt: null,
};

function vettingState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    draftId: 'd1',
    campaignId: 'c1',
    selectedType: null,
    problem: null,
    solution: null,
    competition: null,
    // Retired from collection. Present on the payload because a record from
    // before 2026-08-18 carries one; nothing on this surface asks for it.
    views: null,
    provenance: {
      problem: { ...EMPTY_PROVENANCE },
      solution: { ...EMPTY_PROVENANCE },
      competition: { ...EMPTY_PROVENANCE },
    },
    lastSavedAt: null,
    resumeStep: null,
    submittedAt: null,
    completeness: { problem: false, solution: false, competition: false },
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
        problem: typeof state['problem'] === 'string' && state['problem'] !== '',
        solution: typeof state['solution'] === 'string' && state['solution'] !== '',
        competition:
          typeof state['competition'] === 'string' && state['competition'] !== '',
      };
      return { status: 200, body: state };
    }
    return { status: 200, body: state };
  });
  return () => state;
}

const CLAIM_PROFILE = {
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

const PUBLISHED_POLICIES = [
  { slug: 'terms', route: '/terms', title: 'Terms of Service', version: '1.0', status: 'published' },
  { slug: 'aup', route: '/acceptable-use', title: 'Founder Acceptable Use Policy', version: '1.0', status: 'published' },
  { slug: 'privacy', route: '/privacy', title: 'Privacy Policy', version: '1.0', status: 'published' },
];

function stubClaim(policies: unknown[] = PUBLISHED_POLICIES, profile = CLAIM_PROFILE) {
  handlers.push((url, init) => {
    if (!url.includes('/claim')) return undefined;
    if (init?.method === 'PATCH') return { status: 200, body: profile };
    if (init?.method === 'POST') return { status: 201, body: { ok: true, campaignId: 'c1' } };
    return { status: 200, body: { profile, policies } };
  });
}

function renderAt(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  return render(<RouterProvider router={router} />);
}

const renderVetting = () => renderAt(`/draft/${TOKEN}/vetting`);

/** §9 step 1's own labels. `pre_build` never renders (§3.1). */
const IDEA = CAMPAIGN_PATH_CHOICES.find((c) => c.type === 'pre_build')!;
const PRODUCT = CAMPAIGN_PATH_CHOICES.find((c) => c.type === 'pre_launch')!;

/**
 * A `Choice` radio's accessible name is its label AND its second line, because
 * both are inside the control. So each is matched by its prompt rather than
 * compared to it.
 */
const pathRadio = (choice: { prompt: string }) =>
  screen.getByRole('radio', { name: new RegExp(choice.prompt, 'i') });

/** The four positions, in order — three answers plus the path. */
const NAV_LABELS = ['Campaign path', ...VETTING_STEPS.map((s) => s.label)];

/** The campaign path answered, so a test can start on the Problem step. */
const AT_PROBLEM = { selectedType: 'pre_launch', resumeStep: 'problem' };

/** Everything before Positioning, so a test can start where it means to. */
const THROUGH_SOLUTION = {
  selectedType: 'pre_launch',
  problem: 'A problem.',
  solution: 'A solution.',
  resumeStep: 'competition',
  completeness: { problem: true, solution: true, competition: false },
};

/* ══════════════════════════════════════════════════════════════════════════
   The simplified sequence — order, progress, Back/Continue, autosave, restore
   ══════════════════════════════════════════════════════════════════════════ */

describe('the §9 vetting sequence', () => {
  it('opens on step 1 of 4 and shows the progress', async () => {
    stubVetting();
    renderVetting();

    // §9 step 1: the campaign path, the Founder's own again since 2026-08-18.
    await screen.findByRole('heading', { name: /which of these is closer to where you are today/i });
    expect(await screen.findByText('Step 1 of 4')).toBeTruthy();
  });

  it('states what the campaign path commits to, and that it is permanent (§9)', async () => {
    stubVetting();
    const { container } = renderVetting();
    await screen.findByRole('heading', { name: /which of these is closer/i });

    // §9: "the step must explain what is being chosen in plain language before
    // it is chosen." Both paths' commitments render, before the choice.
    const text = container.textContent ?? '';
    for (const choice of CAMPAIGN_PATH_CHOICES) {
      expect(text).toContain(choice.name);
      for (const line of choice.commitments) expect(text).toContain(line);
    }
    expect(text).toMatch(/permanent/i);
    // The lock is at submission, not here — which is what makes Back safe.
    expect(text).toMatch(/when you submit/i);
  });

  it('arrives pre-selected from Admin’s discovery answer, and the Founder may change it', async () => {
    const user = userEvent.setup();
    stubVetting({ selectedType: 'pre_build' });
    renderVetting();

    await screen.findByRole('heading', { name: /which of these is closer/i });
    expect(pathRadio(IDEA).getAttribute('aria-checked')).toBe('true');

    await user.click(pathRadio(PRODUCT));
    await waitFor(() =>
      expect(
        requests.some(
          (r) => r.method === 'PATCH' && r.body?.['selectedType'] === 'pre_launch',
        ),
      ).toBe(true),
    );
  });

  it('walks the fixed order and submitting lands on the account claim', async () => {
    const user = userEvent.setup();
    stubVetting();
    stubClaim();
    renderVetting();

    // 1. Campaign path
    await screen.findByRole('heading', { name: /which of these is closer/i });
    await user.click(pathRadio(IDEA));
    await user.click(screen.getByRole('button', { name: /^Continue to / }));

    // 2. Problem
    await screen.findByRole('heading', { name: /what problem does your product solve/i });
    await user.type(screen.getByLabelText(/what problem does your product solve/i), 'A problem.');
    await user.click(screen.getByRole('button', { name: /^Continue to / }));

    // 3. Solution
    await screen.findByRole('heading', { name: /what does your product do about it/i });
    await user.type(screen.getByLabelText(/what does your product do about it/i), 'A solution.');
    await user.click(screen.getByRole('button', { name: /^Continue to / }));

    // 4. Positioning — always blank, always the Founder's, then submit.
    await screen.findByRole('heading', { name: /who else is solving this/i });
    await user.type(screen.getByLabelText(/who else is solving this/i), 'Two suites.');
    await user.click(screen.getByRole('button', { name: /submit and set up my account/i }));

    // The claim, directly. No review screen and no result page between.
    await screen.findByRole('heading', { name: /what you are agreeing to/i });
    expect(requests.some((r) => r.url.endsWith('/vetting/submit') && r.method === 'POST')).toBe(
      true,
    );
  });

  it('Continue is unavailable until the step is answered', async () => {
    stubVetting();
    renderVetting();
    await screen.findByRole('heading', { name: /which of these is closer/i });
    expect(screen.getByRole('button', { name: /^Continue to / }).hasAttribute('disabled')).toBe(true);
  });

  it('Back returns to the previous step and does not exist on the first', async () => {
    const user = userEvent.setup();
    stubVetting({
      selectedType: 'pre_launch',
      problem: 'A problem.',
      completeness: { problem: true, solution: false, competition: false },
    });
    renderVetting();

    await screen.findByRole('heading', { name: /which of these is closer/i });
    // §33.11.4, §1.4: nothing precedes step 1, so there is no control rather
    // than a permanently disabled one — and every nav control names where it
    // goes.
    expect(screen.queryByRole('button', { name: /^Back to / })).toBeNull();

    await user.click(screen.getByRole('button', { name: /^Continue to / }));
    await screen.findByRole('heading', { name: /what problem does your product solve/i });
    await user.click(screen.getByRole('button', { name: /^Back to / }));
    await screen.findByRole('heading', { name: /which of these is closer/i });
  });

  it('returning to an earlier step preserves a later answer', async () => {
    const user = userEvent.setup();
    stubVetting();
    renderVetting();

    await screen.findByRole('heading', { name: /which of these is closer/i });
    await user.click(pathRadio(IDEA));
    await user.click(screen.getByRole('button', { name: /^Continue to / }));
    await user.type(screen.getByLabelText(/what problem/i), 'A problem.');
    await user.click(screen.getByRole('button', { name: /^Continue to / }));
    await user.type(screen.getByLabelText(/what does your product do/i), 'A solution.');
    await user.click(screen.getByRole('button', { name: /^Continue to / }));
    await screen.findByRole('heading', { name: /who else is solving this/i });
    await user.type(screen.getByLabelText(/who else is solving this/i), 'Two suites.');

    // All the way back to step 2, then forward again. Step 4's answer survives.
    await user.click(
      within(screen.getByRole('navigation', { name: 'All steps' })).getByRole('button', {
        name: 'Problem',
      }),
    );
    await screen.findByRole('heading', { name: /what problem/i });
    expect((screen.getByLabelText(/what problem/i) as HTMLTextAreaElement).value).toBe('A problem.');

    await user.click(
      within(screen.getByRole('navigation', { name: 'All steps' })).getByRole('button', {
        name: 'Positioning',
      }),
    );
    await screen.findByRole('heading', { name: /who else is solving this/i });
    expect((screen.getByLabelText(/who else is solving this/i) as HTMLTextAreaElement).value).toBe(
      'Two suites.',
    );
  });

  it('says Saving… then Saved with a time (§9’s vocabulary)', async () => {
    const user = userEvent.setup();
    stubVetting(AT_PROBLEM);
    renderVetting();

    await screen.findByRole('heading', { name: /what problem/i });
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
      return { status: 200, body: vettingState(AT_PROBLEM) };
    });
    renderVetting();

    await screen.findByRole('heading', { name: /what problem/i });
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
      return { status: 200, body: vettingState(AT_PROBLEM) };
    });
    renderVetting();

    await screen.findByRole('heading', { name: /what problem/i });
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
      return { status: 200, body: vettingState(AT_PROBLEM) };
    });
    renderVetting();

    await screen.findByRole('heading', { name: /what problem/i });
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
      completeness: { problem: true, solution: false, competition: false },
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

    stubVetting(AT_PROBLEM);
    renderVetting();
    await screen.findByRole('heading', { name: /what problem/i });
    await user.type(screen.getByLabelText(/what problem/i), 'U');

    await waitFor(() => expect(added).toContain('beforeunload'));
    vi.restoreAllMocks();
  });

  it('offers the two campaign paths as one radio group', async () => {
    stubVetting();
    renderVetting();

    await screen.findByRole('heading', { name: /which of these is closer/i });
    // A real radio group, not two checkboxes that clear each other: one tab
    // stop, arrow keys, and one question announced with two answers.
    for (const choice of CAMPAIGN_PATH_CHOICES) {
      expect(pathRadio(choice)).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: /^Continue to / }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('asks Positioning last, from a blank box, and never claims to have drafted it', async () => {
    stubVetting(THROUGH_SOLUTION);
    const { container } = renderVetting();

    // §9, twice: always blank, written by the Founder, never prefilled and
    // never represented as AI-generated. There is no prefill to render.
    await screen.findByRole('heading', { name: /who else is solving this/i });
    expect((screen.getByLabelText(/who else is solving this/i) as HTMLTextAreaElement).value).toBe(
      '',
    );

    const text = container.textContent ?? '';
    expect(text).toMatch(/yours from a blank page/i);
    expect(text).not.toMatch(/we drafted/i);
    expect(text).not.toMatch(/our draft/i);

    // Submit stays closed until it is answered.
    expect(
      screen.getByRole('button', { name: /submit and set up my account/i }).hasAttribute('disabled'),
    ).toBe(true);
  });

  it('asks §9’s four items and no fifth', async () => {
    stubVetting();
    renderVetting();
    await screen.findByRole('heading', { name: /tell us about your product/i });

    const nav = screen.getByRole('navigation', { name: 'All steps' });
    expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual(NAV_LABELS);

    // Retired from collection on 2026-08-18: the question is not asked, and
    // §9 never named it.
    expect(screen.queryByText(/how many views/i)).toBeNull();
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

  it('shows the Proovd-drafted fields as drafted, and never claims a draft it does not have', async () => {
    stubVetting({
      problem: 'Our draft of the problem.',
      provenance: {
        problem: {
          supplier: 'proovd',
          prefilledText: 'Our draft of the problem.',
          prefilledAt: '2026-07-30T09:00:00.000Z',
          firstEditedAt: null,
          lastEditedAt: null,
        },
        solution: { ...EMPTY_PROVENANCE },
        competition: { ...EMPTY_PROVENANCE },
      },
      ...AT_PROBLEM,
      completeness: { problem: true, solution: false, competition: false },
    });
    renderVetting();

    await screen.findByRole('heading', { name: /what problem/i });
    expect(await screen.findByText(/drafted by proovd/i)).toBeTruthy();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   The old result address goes to the claim
   ══════════════════════════════════════════════════════════════════════════ */

describe('the retired possible-creators address', () => {
  it('redirects to the account claim', async () => {
    stubClaim();
    renderAt(`/draft/${TOKEN}/result`);
    await screen.findByRole('heading', { name: /what you are agreeing to/i });
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   §10 / §28.4 — the account claim
   ══════════════════════════════════════════════════════════════════════════ */

describe('the account claim', () => {
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
      ...PUBLISHED_POLICIES.slice(1),
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

  it('has no axe violations on the Positioning step', async () => {
    stubVetting({ ...THROUGH_SOLUTION, resumeStep: 'competition' });
    const { container } = renderVetting();
    await screen.findByRole('heading', { name: /who else is solving this/i });
    expect(await axe(container)).toHaveNoViolations();
  });

  it('exposes exactly one level-1 heading per Founder surface', async () => {
    stubVetting();
    renderVetting();
    await screen.findByRole('heading', { name: /tell us about your product/i });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('offers every step of the flow to the keyboard', async () => {
    stubVetting();
    renderVetting();

    const nav = await screen.findByRole('navigation', { name: 'All steps' });
    const buttons = within(nav).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(NAV_LABELS);
    for (const button of buttons) {
      expect(button.hasAttribute('disabled')).toBe(false);
    }
  });
});
