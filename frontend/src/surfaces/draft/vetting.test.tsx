/**
 * Positioning, the submission, and the account claim — §9, §10, §33.11.
 *
 * ── Screens 1-4 moved out on 2026-08-18 ───────────────────────────────────
 * Founder Flow v2 Session B gave the invite, Problem, Solution and the
 * campaign path their own addresses under `FOUNDER_FLOW_PAGES`, so this
 * surface no longer asks them — and the tests for them moved with them, to
 * `surfaces/founder-flow/founder-flow.test.tsx`. Asking the same two records
 * on two screens is how the two come to disagree, and a suite that tested both
 * copies would have made that look correct.
 *
 * What is left here is §9's third answer, the submission that locks the
 * campaign type, and §10's claim. Session C rebuilds the first two.
 *
 * The real route table in a memory router with `fetch` stubbed at the network
 * boundary. The server-side halves — that the type lock is permanent, that
 * `founder_signup_complete` emits once — are proved in
 * `backend/src/tests/vetting.test.ts` against the real routes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { axe } from 'jest-axe';
import { appRoutes } from '../../routes.js';
import { CAMPAIGN_TYPE_LOCK_WARNING } from '@proovd/shared';

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

/** Everything Session B's own pages own, answered. */
const EARLIER_DONE = {
  selectedType: 'pre_launch',
  problem: 'A problem.',
  solution: 'A solution.',
  completeness: { problem: true, solution: true, competition: false },
};

/* ══════════════════════════════════════════════════════════════════════════
   The simplified sequence — order, progress, Back/Continue, autosave, restore
   ══════════════════════════════════════════════════════════════════════════ */

describe('Positioning, and the submission that locks the type', () => {
  it('asks one question, from a blank box, and never claims to have drafted it (§33.1.5)', async () => {
    stubVetting(EARLIER_DONE);
    renderVetting();

    await screen.findByRole('heading', { name: /who else is solving this/i });
    expect(screen.getByText(/your words/i)).toBeTruthy();
    expect(screen.getByText(/we do not draft it, and we never will/i)).toBeTruthy();
    expect(screen.queryByText(/drafted by proovd/i)).toBeNull();
    // One textarea, because there is one question left.
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
  });

  it('states the permanence of the campaign type at the moment it becomes true (§33.1.7)', async () => {
    stubVetting(EARLIER_DONE);
    renderVetting();
    await screen.findByRole('heading', { name: /who else is solving this/i });
    expect(screen.getByText(CAMPAIGN_TYPE_LOCK_WARNING)).toBeTruthy();
  });

  it('says when the restored draft was last saved (§9)', async () => {
    stubVetting({ ...EARLIER_DONE, lastSavedAt: '2026-07-31T12:00:00.000Z' });
    renderVetting();
    expect(await screen.findByText(/we restored what you wrote last time/i)).toBeTruthy();
  });

  it('says Saving… then Saved with a time (§9’s vocabulary)', async () => {
    const user = userEvent.setup();
    stubVetting(EARLIER_DONE);
    renderVetting();

    await screen.findByRole('heading', { name: /who else is solving this/i });
    await user.type(screen.getByRole('textbox'), 'Spreadsheets, mostly.');
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/^Saved \S/));
  });

  it('a failed save never clears a valid field (§9)', async () => {
    const user = userEvent.setup();
    handlers.push((url, init) => {
      if (!url.includes('/vetting')) return undefined;
      if (init?.method === 'PATCH') return { status: 500, body: { error: 'boom' } };
      return { status: 200, body: vettingState(EARLIER_DONE) };
    });
    renderVetting();

    await screen.findByRole('heading', { name: /who else is solving this/i });
    await user.type(screen.getByRole('textbox'), 'Still mine.');
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toMatch(/could not save|not saved/i),
    );
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Still mine.');
  });

  it('warns the browser before leaving with unsaved data (§9)', async () => {
    const user = userEvent.setup();
    stubVetting(EARLIER_DONE);
    renderVetting();

    await screen.findByRole('heading', { name: /who else is solving this/i });
    await user.type(screen.getByRole('textbox'), 'x');

    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('submits and lands on the account claim', async () => {
    const user = userEvent.setup();
    stubVetting(EARLIER_DONE);
    stubClaim();
    renderVetting();

    await screen.findByRole('heading', { name: /who else is solving this/i });
    await user.type(screen.getByRole('textbox'), 'Spreadsheets, and a lamp that costs four times as much.');
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: /submit and set up my account/i })
          .hasAttribute('disabled'),
      ).toBe(false),
    );
    await user.click(screen.getByRole('button', { name: /submit and set up my account/i }));
    await screen.findByRole('heading', { name: /what you are agreeing to/i });
  });

  it('will not submit an empty answer', async () => {
    stubVetting(EARLIER_DONE);
    renderVetting();
    await screen.findByRole('heading', { name: /who else is solving this/i });
    expect(
      screen
        .getByRole('button', { name: /submit and set up my account/i })
        .hasAttribute('disabled'),
    ).toBe(true);
  });

  it('does not re-ask an earlier answer — it names it and links back (§1.4)', async () => {
    stubVetting({ solution: 'A solution.', completeness: { problem: false, solution: true, competition: false } });
    renderVetting();

    await screen.findByRole('heading', { name: /who else is solving this/i });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Your problem');
    expect(alert.textContent).toContain('Campaign type');
    // The record is collected on its own page. Collecting it on two screens is
    // how the two come to disagree, so there is no second box for it here.
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(
      within(alert).getByRole('link', { name: /go back to your problem/i }).getAttribute('href'),
    ).toBe(`/draft/${TOKEN}/problem`);
    expect(
      screen
        .getByRole('button', { name: /submit and set up my account/i })
        .hasAttribute('disabled'),
    ).toBe(true);
  });

  it('never renders an internal name (§3)', async () => {
    stubVetting({ ...EARLIER_DONE, competition: 'The alternatives.' });
    const { container } = renderVetting();
    await screen.findByRole('heading', { name: /who else is solving this/i });
    const text = (container.textContent ?? '').toLowerCase();
    for (const word of ['pre_build', 'pre_launch', 'prebuild', 'prelaunch', 'affiliate']) {
      expect(text).not.toContain(word);
    }
  });
});

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
  it('has no axe violations on Positioning', async () => {
    stubVetting(EARLIER_DONE);
    const { container } = renderVetting();
    await screen.findByRole('heading', { name: /who else is solving this/i });
    expect(await axe(container)).toHaveNoViolations();
  });

  it('exposes exactly one level-1 heading', async () => {
    stubVetting(EARLIER_DONE);
    renderVetting();
    await screen.findByRole('heading', { name: /who else is solving this/i });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('offers the way back and the way on to the keyboard', async () => {
    stubVetting(EARLIER_DONE);
    renderVetting();
    await screen.findByRole('heading', { name: /who else is solving this/i });
    expect(
      screen.getByRole('link', { name: /back to campaign type/i }).getAttribute('href'),
    ).toBe(`/draft/${TOKEN}/campaign-type`);
    expect(screen.getByRole('button', { name: /submit and set up my account/i })).toBeTruthy();
  });
});
