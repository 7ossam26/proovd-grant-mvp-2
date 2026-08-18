/**
 * The Founder onboarding flow, screens 1–17 — Founder Flow v2, Sessions B–D.
 *
 * The real route table in a memory router with `fetch` stubbed at the network
 * boundary. What is proved here is the half only the surface owns: that each of
 * the four pages is its own address and survives a reload there, that forward
 * and back work between them, that the help drawer lists what is behind and
 * never what is ahead, that the confirm screens render §9's prefill provenance
 * and never clear a valid field, that the campaign path is a real radio group
 * which explains both options before either is chosen, and that this screen
 * locks nothing.
 *
 * The server-side halves — that the type lock is permanent, that a failed save
 * leaves the record alone, that `founder_signup_complete` emits once — are
 * proved in `backend/src/tests/vetting.test.ts` against the real routes.
 *
 * Motion is absent in jsdom (`window.Proovd` is unset), so `relayIn` and
 * `pageExit` no-op and `leave` navigates immediately. That is the same
 * jump-cut path a person with `prefers-reduced-motion` gets (DNA §6.6), which
 * is why it is the one the suite drives rather than a mock.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { axe } from 'jest-axe';
import {
  CAMPAIGN_PATH_CHOICES,
  FLOW_AGE_IS_YOUR_STATEMENT,
  FLOW_CLAIM_USES_THE_LINK,
  FLOW_COMPLETION_IS_DECIDED,
  FLOW_LAST_LOOK_RETURNS,
  FOUNDER_ANSWER_SEQUENCE,
  FOUNDER_FLOW_EARLIER_STAGE_CLOSED,
  FOUNDER_FLOW_ABSENCES,
  FOUNDER_FLOW_PAGES,
  OBJECTLESS_CTA_LABELS,
  POSSIBLE_CREATOR_RESULT_DISCLOSURES,
  founderAnswerLabel,
  founderFlowPath,
} from '@proovd/shared';
import { invalidateSession } from '../../lib/session.js';
import { appRoutes } from '../../routes.js';

type StubResult = { status: number; body: unknown } | undefined;
type Handler = (url: string, init?: RequestInit) => StubResult;

let handlers: Handler[] = [];
let requests: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = [];

function respond(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

beforeEach(() => {
  invalidateSession();
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

const TOKEN = 'b'.repeat(43);

const EMPTY_PROVENANCE = {
  supplier: null,
  prefilledText: null,
  prefilledAt: null,
  firstEditedAt: null,
  lastEditedAt: null,
};

const LANDING = {
  recipientName: 'Rowan',
  recipientEmail: 'rowan@example.com',
  productName: 'Benchlight',
  whatWeUnderstood: null,
  senderName: 'Ada',
  expectedSetupTime: 'about 3 minutes',
  lastContactAt: '2026-08-15T09:00:00.000Z',
  reference: 'F-ABCDE',
  processSummary: ['We read it by hand.'],
  noGuarantee: 'Proovd cannot promise acceptance or results.',
};

function vettingState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    draftId: 'd1',
    campaignId: 'c1',
    selectedType: null,
    problem: null,
    solution: null,
    competition: null,
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

/** The invite page's own read. */
function stubLanding(overrides: Record<string, unknown> = {}) {
  handlers.push((url) => {
    if (!/\/api\/draft\/[^/]+$/.test(url)) return undefined;
    return { status: 200, body: { ...LANDING, ...overrides } };
  });
}

/** Serves the vetting route, echoing each patch back the way the server does. */
function stubVetting(initial: Record<string, unknown> = {}) {
  let state = vettingState(initial);
  handlers.push((url, init) => {
    if (!url.includes('/vetting')) return undefined;
    if (init?.method === 'PATCH') {
      const patch = JSON.parse(String(init.body)) as Record<string, unknown>;
      state = { ...state, ...patch, lastSavedAt: '2026-08-18T12:00:00.000Z' };
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

/* Session D: a page is addressed by its own parameter — the draft token
   through the claim, the campaign after it. */
const at = (id: string) => {
  const page = FOUNDER_FLOW_PAGES.find((p) => p.id === id)!;
  return founderFlowPath(id, page.param === 'token' ? TOKEN : CAMPAIGN);
};

const ANSWERED = {
  selectedType: 'pre_launch',
  problem: 'Benches are lit from the ceiling, so the board sits in a shadow.',
  solution: 'A clamp lamp with a magnetic arm that holds its position.',
  completeness: { problem: true, solution: true, competition: false },
};

const IDEA = CAMPAIGN_PATH_CHOICES.find((c) => c.type === 'pre_build')!;
const PRODUCT = CAMPAIGN_PATH_CHOICES.find((c) => c.type === 'pre_launch')!;

/** A `Choice` radio's accessible name is its label AND its second line. */
const pathRadio = (choice: { prompt: string }) =>
  screen.getByRole('radio', { name: new RegExp(choice.prompt, 'i') });

/* ══════════════════════════════════════════════════════════════════════════
   The four pages are four addresses
   ══════════════════════════════════════════════════════════════════════════ */

describe('the flow is a sequence of pages', () => {
  it('gives every page its own address, and each one restores there', async () => {
    for (const page of FOUNDER_FLOW_PAGES) {
      handlers = [];
      stubAllRegimes();
      const view = renderAt(at(page.id));
      // The heading is what proves the surface rendered rather than an error
      // state — every one of the four owns exactly one `h1`.
      await waitFor(() => expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1));
      view.unmount();
    }
  });

  it('walks invite → problem → solution → campaign type, and back again', async () => {
    const user = userEvent.setup();
    stubLanding();
    stubVetting(ANSWERED);
    renderAt(at('invite'));

    await user.click(await screen.findByRole('button', { name: /claim invite/i }));
    await screen.findByRole('heading', { name: /how we understood your problem/i });

    await user.click(await screen.findByRole('button', { name: /continue to your solution/i }));
    await screen.findByRole('heading', { name: /how we understood your solution/i });

    await user.click(await screen.findByRole('button', { name: /continue to campaign type/i }));
    await screen.findByRole('heading', { name: /working on an/i });

    await user.click(await screen.findByRole('button', { name: /back to your solution/i }));
    await screen.findByRole('heading', { name: /how we understood your solution/i });

    await user.click(await screen.findByRole('button', { name: /back to your problem/i }));
    await screen.findByRole('heading', { name: /how we understood your problem/i });
  });

  it('renders no persistent chrome — no site header, no footer, no progress bar', async () => {
    stubVetting(ANSWERED);
    const { container } = renderAt(at('problem'));
    await screen.findByRole('heading', { level: 1 });
    expect(container.querySelector('.site-header')).toBeNull();
    expect(container.querySelector('.site-footer')).toBeNull();
    expect(container.querySelector('.progress')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   The help drawer — §27.1's sixth question, once for the whole flow
   ══════════════════════════════════════════════════════════════════════════ */

describe('the help drawer', () => {
  it('leads with this page and marks it, and marks the earlier ones done', async () => {
    const user = userEvent.setup();
    stubVetting(ANSWERED);
    renderAt(at('solution'));
    await screen.findByRole('heading', { level: 1 });

    await user.click(screen.getByRole('button', { name: 'Help' }));
    const dialog = await screen.findByRole('dialog');
    const cards = within(dialog).getAllByRole('button');

    expect(cards[0]!.textContent).toContain('Your solution');
    expect(cards[0]!.textContent).toContain('This page');
    expect(cards[0]!.getAttribute('aria-current')).toBe('page');
    expect(cards[1]!.textContent).toContain('Your problem');
    expect(cards[1]!.textContent).toContain('Done');
  });

  it('never lists a page ahead of the one you are on', async () => {
    const user = userEvent.setup();
    stubVetting(ANSWERED);
    renderAt(at('problem'));
    await screen.findByRole('heading', { level: 1 });

    await user.click(screen.getByRole('button', { name: 'Help' }));
    const dialog = await screen.findByRole('dialog');
    // A drawer that listed what is coming would offer to jump to addresses
    // that refuse, and would be a progress bar with reading attached.
    expect(dialog.textContent).not.toContain('Campaign type');
    expect(dialog.textContent).toContain('Your problem');
    expect(dialog.textContent).toContain('Your invite');
  });

  it('jumps to an earlier page without losing the position', async () => {
    const user = userEvent.setup();
    stubLanding();
    stubVetting(ANSWERED);
    renderAt(at('solution'));
    await screen.findByRole('heading', { level: 1 });

    await user.click(screen.getByRole('button', { name: 'Help' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /your problem/i }));
    await screen.findByRole('heading', { name: /how we understood your problem/i });
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Screens 2–3 — the confirmation, its provenance, and its autosave
   ══════════════════════════════════════════════════════════════════════════ */

describe('confirming what Proovd understood', () => {
  it('shows the Proovd-drafted answer as drafted, and reads it back', async () => {
    stubVetting({
      ...ANSWERED,
      provenance: {
        problem: {
          ...EMPTY_PROVENANCE,
          supplier: 'proovd',
          prefilledText: 'Benches are poorly lit.',
        },
        solution: { ...EMPTY_PROVENANCE },
        competition: { ...EMPTY_PROVENANCE },
      },
    });
    renderAt(at('problem'));

    await screen.findByRole('heading', { level: 1 });
    expect(await screen.findByText(/drafted by proovd/i)).toBeTruthy();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(ANSWERED.problem);
  });

  it('is read-only until Edit, and editing saves what is typed', async () => {
    const user = userEvent.setup();
    stubVetting(ANSWERED);
    renderAt(at('problem'));
    await screen.findByRole('heading', { level: 1 });

    const box = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(box.readOnly).toBe(true);

    await user.click(screen.getByRole('button', { name: /edit this/i }));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).readOnly).toBe(false);

    await user.clear(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), 'A sharper problem.');
    await waitFor(() =>
      expect(
        requests.some(
          (r) => r.method === 'PATCH' && typeof r.body?.['problem'] === 'string',
        ),
      ).toBe(true),
    );
  });

  it('says Saving… then Saved with a time (§9’s vocabulary)', async () => {
    const user = userEvent.setup();
    stubVetting(ANSWERED);
    renderAt(at('problem'));
    await screen.findByRole('heading', { level: 1 });

    await user.click(screen.getByRole('button', { name: /edit this/i }));
    await user.type(screen.getByRole('textbox'), '!');
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/^Saved \S/));
  });

  it('a failed save never clears a valid field (§9)', async () => {
    const user = userEvent.setup();
    // Reads succeed, every write fails. What the Founder typed must survive.
    handlers.push((url, init) => {
      if (!url.includes('/vetting')) return undefined;
      if (init?.method === 'PATCH') return { status: 500, body: { error: 'boom' } };
      return { status: 200, body: vettingState(ANSWERED) };
    });
    renderAt(at('problem'));
    await screen.findByRole('heading', { level: 1 });

    await user.click(screen.getByRole('button', { name: /edit this/i }));
    await user.type(screen.getByRole('textbox'), ' Still mine.');
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toMatch(/could not save|not saved/i),
    );
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toContain('Still mine.');
  });

  it('a 4xx is a decision, not something to promise to retry (§1.4)', async () => {
    const user = userEvent.setup();
    handlers.push((url, init) => {
      if (!url.includes('/vetting')) return undefined;
      if (init?.method === 'PATCH') {
        return { status: 422, body: { error: 'invalid', title: 'That answer is too long' } };
      }
      return { status: 200, body: vettingState(ANSWERED) };
    });
    renderAt(at('problem'));
    await screen.findByRole('heading', { level: 1 });

    await user.click(screen.getByRole('button', { name: /edit this/i }));
    await user.type(screen.getByRole('textbox'), '!');
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/not saved/i));
    expect(screen.getByRole('status').textContent).not.toMatch(/retrying/i);
  });

  it('will not continue from an empty answer', async () => {
    stubVetting({ selectedType: 'pre_launch' });
    renderAt(at('problem'));
    await screen.findByRole('heading', { level: 1 });
    expect(
      screen.getByRole('button', { name: /continue to your solution/i }).hasAttribute('disabled'),
    ).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Screen 4 — the campaign path, which locks nothing
   ══════════════════════════════════════════════════════════════════════════ */

describe('the campaign path', () => {
  it('offers the two paths as one radio group and explains both before either is chosen', async () => {
    stubVetting(ANSWERED);
    renderAt(at('campaign-type'));
    await screen.findByRole('heading', { level: 1 });

    expect(screen.getAllByRole('radio')).toHaveLength(2);
    for (const choice of CAMPAIGN_PATH_CHOICES) {
      expect(pathRadio(choice)).toBeTruthy();
      // §9: "the step must explain what is being chosen in plain language
      // before it is chosen." Both, before the choice — not behind a pager.
      for (const line of choice.commitments) {
        expect(screen.getByText(line)).toBeTruthy();
      }
    }
  });

  it('arrives pre-selected from Admin’s discovery answer, and the Founder may change it', async () => {
    const user = userEvent.setup();
    const read = stubVetting({ ...ANSWERED, selectedType: 'pre_build' });
    renderAt(at('campaign-type'));
    await screen.findByRole('heading', { level: 1 });

    expect(pathRadio(IDEA).getAttribute('aria-checked')).toBe('true');
    await user.click(pathRadio(PRODUCT));
    await waitFor(() => expect(read()['selectedType']).toBe('pre_launch'));
  });

  it('locks nothing: it writes the answer and never a locked type (§33.1.7)', async () => {
    const user = userEvent.setup();
    const read = stubVetting(ANSWERED);
    renderAt(at('campaign-type'));
    await screen.findByRole('heading', { level: 1 });

    await user.click(pathRadio(IDEA));
    await waitFor(() => expect(read()['selectedType']).toBe('pre_build'));

    // The permanence warning says when the lock happens, and this page is not
    // it. Nothing here writes `lockedType`, `typeLockedAt`, or submits.
    expect(read()['lockedType']).toBeNull();
    expect(read()['typeLockedAt']).toBeNull();
    for (const request of requests) {
      expect(request.url).not.toMatch(/\/submit$/);
      if (request.body) expect(Object.keys(request.body)).not.toContain('lockedType');
    }
    expect(screen.getByText(/this choice is permanent/i)).toBeTruthy();
  });

  it('confirms the chosen path and then continues', async () => {
    const user = userEvent.setup();
    stubVetting(ANSWERED);
    renderAt(at('campaign-type'));
    await screen.findByRole('heading', { level: 1 });

    await user.click(pathRadio(IDEA));
    await user.click(screen.getByRole('button', { name: new RegExp(`select ${IDEA.name}`, 'i') }));

    await screen.findByRole('heading', { name: new RegExp(`you are running an ${IDEA.name}`, 'i') });
    expect(screen.getByText(/this choice is permanent/i)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /confirm and answer the last question/i }),
    ).toBeTruthy();
  });

  it('cannot be selected before a path is chosen', async () => {
    stubVetting({ problem: 'p', solution: 's' });
    renderAt(at('campaign-type'));
    await screen.findByRole('heading', { level: 1 });
    expect(
      screen.getByRole('button', { name: /select a campaign type/i }).hasAttribute('disabled'),
    ).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   What the reference draws and the Spec forbids
   ══════════════════════════════════════════════════════════════════════════ */

describe('the refusals', () => {
  it('promises no audience number anywhere in the flow (§7)', async () => {
    stubLanding();
    stubVetting(ANSWERED);
    for (const page of FOUNDER_FLOW_PAGES) {
      handlers = [];
      stubAllRegimes();
      const view = renderAt(at(page.id));
      await screen.findByRole('heading', { level: 1 });
      const text = document.body.textContent ?? '';
      expect(text).not.toMatch(/in front of/i);
      expect(text).not.toMatch(/new people/i);
      view.unmount();
    }
  });

  it('does not claim agreement was given by continuing (§10, §28.4)', async () => {
    stubLanding();
    renderAt(at('invite'));
    await screen.findByRole('heading', { level: 1 });
    // §10 records acceptance at the account claim, as three separate controls.
    // No consent row exists for anything a person does on this page.
    expect(document.body.textContent).not.toMatch(/by continuing you/i);
    expect(document.body.textContent).toMatch(/creates no account and asks for no card/i);
  });

  it('renders `~3 mins` only from the record, never as an estimate (§1.4)', async () => {
    stubLanding({ expectedSetupTime: null });
    const view = renderAt(at('invite'));
    await screen.findByRole('heading', { level: 1 });
    expect(document.body.textContent).not.toMatch(/\bmins?\b/i);
    view.unmount();

    handlers = [];
    stubLanding({ expectedSetupTime: 'about 3 minutes' });
    renderAt(at('invite'));
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByText('about 3 minutes')).toBeTruthy();
  });

  it('never renders an internal name (§3.1)', async () => {
    stubLanding();
    stubVetting(ANSWERED);
    for (const page of FOUNDER_FLOW_PAGES) {
      handlers = [];
      stubAllRegimes();
      const view = renderAt(at(page.id));
      await screen.findByRole('heading', { level: 1 });
      const text = document.body.textContent ?? '';
      for (const word of ['pre_build', 'pre_launch', 'prebuild', 'prelaunch', 'affiliate']) {
        expect(text.toLowerCase()).not.toContain(word);
      }
      view.unmount();
    }
  });

  it('records every refused element with a reason and a section', () => {
    expect(FOUNDER_FLOW_ABSENCES.length).toBeGreaterThan(0);
    for (const absence of FOUNDER_FLOW_ABSENCES) {
      expect(absence.element.trim().length).toBeGreaterThan(20);
      expect(absence.absentBecause.trim().length).toBeGreaterThan(60);
      expect(absence.specRef).toMatch(/§|DNA/);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   §33.11 — operable
   ══════════════════════════════════════════════════════════════════════════ */

describe('§33.11 the flow is operable', () => {
  it('has no axe violations on any of the four pages', async () => {
    for (const page of FOUNDER_FLOW_PAGES) {
      handlers = [];
      stubAllRegimes();
      const view = renderAt(at(page.id));
      await screen.findByRole('heading', { level: 1 });
      expect(await axe(view.container), `axe on ${page.id}`).toHaveNoViolations();
      view.unmount();
    }
  });

  it('exposes exactly one level-1 heading per page (§33.11.2)', async () => {
    for (const page of FOUNDER_FLOW_PAGES) {
      handlers = [];
      stubAllRegimes();
      const view = renderAt(at(page.id));
      await waitFor(() => expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1));
      view.unmount();
    }
  });

  it('names a destination on every nav control (§33.11.4)', async () => {
    for (const page of FOUNDER_FLOW_PAGES) {
      handlers = [];
      stubAllRegimes();
      stubClaim();
      stubCode();
      stubSignal({ status: 'available', count: 3, recordedAt: '2026-08-18T12:00:00.000Z' });
      const view = renderAt(at(page.id));
      await screen.findByRole('heading', { level: 1 });
      for (const control of screen.getAllByRole('button')) {
        const label = (control.textContent ?? '').trim().toLowerCase();
        expect(
          OBJECTLESS_CTA_LABELS as readonly string[],
          `${page.id}: "${label}"`,
        ).not.toContain(label);
      }
      view.unmount();
    }
  });

  it('offers the whole walk to the keyboard (§28.5)', async () => {
    const user = userEvent.setup();
    stubLanding();
    stubVetting(ANSWERED);
    renderAt(at('problem'));
    await screen.findByRole('heading', { level: 1 });

    const forward = screen.getByRole('button', { name: /continue to your solution/i });
    forward.focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('heading', { name: /how we understood your solution/i });
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Session C — the address, the code, Positioning, and §10's signal
   ══════════════════════════════════════════════════════════════════════════ */

const CLAIM_FIELD = {
  value: null as string | null,
  prefilled: null as string | null,
  supplier: null as string | null,
  editedAt: null as string | null,
};

/**
 * The three §10 documents, as they actually ship: `draft`.
 *
 * A consent may cite only a PUBLISHED version (a trigger, not a service
 * rule), so `completeClaim` refuses and the claim screen renders the reason.
 * Stubbing an empty list instead would be stubbing a state the product does
 * not have, and the refusal is the thing worth testing.
 */
const DRAFT_POLICIES = [
  { slug: 'terms', route: '/terms', title: 'Terms of Service', version: 'v1.0', status: 'draft' },
  { slug: 'founder-aup', route: '/founder-aup', title: 'Founder Acceptable Use Policy', version: 'v1.0', status: 'draft' },
  { slug: 'privacy', route: '/privacy', title: 'Privacy Policy', version: 'v1.0', status: 'draft' },
];

const PUBLISHED_POLICIES = DRAFT_POLICIES.map((p) => ({ ...p, status: 'published' }));
function claimView(
  overrides: Record<string, unknown> = {},
  policies: unknown[] = DRAFT_POLICIES,
): Record<string, unknown> {
  return {
    profile: {
      draftId: 'd1',
      campaignId: 'c1',
      fields: {
        legalName: { ...CLAIM_FIELD },
        preferredName: { ...CLAIM_FIELD },
        email: { ...CLAIM_FIELD, value: 'rowan@example.com', prefilled: 'rowan@example.com' },
        phone: { ...CLAIM_FIELD },
        dateOfBirth: { ...CLAIM_FIELD },
        country: { ...CLAIM_FIELD },
        stateRegion: { ...CLAIM_FIELD },
        businessName: { ...CLAIM_FIELD },
        businessEntityType: { ...CLAIM_FIELD },
      },
      soleProprietor: null,
      emailOwnership: 'invited_link',
      phoneVerified: false,
      representations: { usPerson: false, age18Plus: false, sanctions: false },
      lastSavedAt: null,
      claimedAt: null,
      ...overrides,
    },
    policies,
    canComplete: policies.length > 0,
  };
}

function stubClaim(overrides: Record<string, unknown> = {}, policies: unknown[] = DRAFT_POLICIES) {
  const view = claimView(overrides, policies);
  handlers.push((url, init) => {
    if (!/\/api\/draft\/[^/]+\/claim$/.test(url)) return undefined;
    const profile = view['profile'] as Record<string, unknown>;
    if (init?.method === 'PATCH') {
      const patch = JSON.parse(String(init.body)) as Record<string, unknown>;
      const fields = profile['fields'] as Record<string, Record<string, unknown>>;
      if ('email' in patch) fields['email'] = { ...fields['email'], value: patch['email'] };
      return { status: 200, body: profile };
    }
    return { status: 200, body: view };
  });
  return () => view;
}

/** The two code routes. `accept` is the one value that verifies. */
function stubCode(accept = '418306') {
  const asked: number[] = [];
  handlers.push((url, init) => {
    if (/\/email-code$/.test(url)) {
      asked.push(asked.length);
      return {
        status: 202,
        body: { status: 'sent', title: 'Check your email', whatHappened: 'x', next: 'y' },
      };
    }
    if (/\/email-code\/verify$/.test(url)) {
      const body = JSON.parse(String(init?.body ?? '{}')) as { code?: string };
      return body.code === accept
        ? { status: 200, body: { verified: true } }
        : {
            status: 401,
            body: {
              error: 'link_unavailable',
              title: 'We cannot open this link',
              detail: '',
              next: '',
              support: '/support/link',
            },
          };
    }
    return undefined;
  });
  return asked;
}

function stubSignal(body: Record<string, unknown>) {
  handlers.push((url) => (/\/creator-signal$/.test(url) ? { status: 200, body } : undefined));
}

describe('the address', () => {
  it('is prefilled from the invitation and says so', async () => {
    stubClaim();
    renderAt(at('email'));
    // Wait for the page rather than the field: a loading panel is announced
    // too, and a label query that matches it passes before the read resolves.
    await screen.findByRole('heading', { level: 1 });
    const field = await screen.findByLabelText(/your email address/i);
    expect((field as HTMLInputElement).value).toBe('rowan@example.com');
    expect(screen.getByText(/filled in from your invitation/i)).toBeInTheDocument();
  });

  it('does not claim that confirming an address is what saves your progress', async () => {
    // The reference's own headline is `To save your progress verify your email:`
    // and it names the wrong mechanism: §9's autosave has been writing through
    // the draft token since screen 2 (§1.4).
    stubClaim();
    renderAt(at('email'));
    await screen.findByRole('heading', { level: 1 });
    expect(document.body.textContent).not.toMatch(/to save your progress/i);
  });

  it('asks for a code and moves on, and nothing branches on the answer', async () => {
    const user = userEvent.setup();
    stubClaim();
    const asked = stubCode();
    stubVetting(ANSWERED);
    renderAt(at('email'));
    await user.click(await screen.findByRole('button', { name: /send me a code/i }));
    await waitFor(() => expect(asked.length).toBe(1));
    await screen.findByRole('heading', { name: /six-digit code/i });
  });

  it('will not send to something that is not an address', async () => {
    const user = userEvent.setup();
    stubClaim();
    renderAt(at('email'));
    await screen.findByRole('heading', { level: 1 });
    const field = await screen.findByLabelText(/your email address/i);
    await user.clear(field);
    await user.type(field, 'rowan');
    expect(screen.getByRole('button', { name: /send me a code/i })).toBeDisabled();
  });
});

describe('the six-digit code', () => {
  it('labels every box and says what confirming does NOT do', async () => {
    stubClaim();
    stubCode();
    renderAt(at('code'));
    for (let i = 1; i <= 6; i++) {
      expect(await screen.findByLabelText(`Digit ${i} of 6`)).toBeInTheDocument();
    }
    // §1.4, on the screen most likely to read as a sign-in.
    expect(document.body.textContent).toMatch(/creates no account/i);
  });

  it('advances on the sixth digit', async () => {
    const user = userEvent.setup();
    stubClaim();
    stubCode('418306');
    stubVetting(ANSWERED);
    renderAt(at('code'));
    await user.click(await screen.findByLabelText('Digit 1 of 6'));
    await user.keyboard('418306');
    await screen.findByRole('heading', { name: /who else is solving this/i });
  });

  it('takes a pasted code, because that is how people enter one', async () => {
    const user = userEvent.setup();
    stubClaim();
    stubCode('418306');
    stubVetting(ANSWERED);
    renderAt(at('code'));
    await user.click(await screen.findByLabelText('Digit 1 of 6'));
    await user.paste('418306');
    await screen.findByRole('heading', { name: /who else is solving this/i });
  });

  it('offers a real control as well as the auto-advance (§28.5)', async () => {
    const user = userEvent.setup();
    stubClaim();
    stubCode('418306');
    stubVetting(ANSWERED);
    renderAt(at('code'));
    const confirm = await screen.findByRole('button', { name: /confirm your email/i });
    expect(confirm).toBeDisabled();
    await user.click(await screen.findByLabelText('Digit 1 of 6'));
    await user.keyboard('41830');
    expect(confirm).toBeDisabled();
  });

  it('says one thing for every refusal, and lets you try again', async () => {
    const user = userEvent.setup();
    stubClaim();
    stubCode('418306');
    renderAt(at('code'));
    await user.click(await screen.findByLabelText('Digit 1 of 6'));
    await user.keyboard('000000');
    const alert = await screen.findByRole('alert');
    // It says nothing about WHICH of the five things went wrong, because the
    // server tells the surface nothing more (§5.5).
    expect(alert.textContent).toMatch(/may have been mistyped/i);
    expect(alert.textContent).not.toMatch(/too many/i);
    expect(screen.getByLabelText('Digit 1 of 6')).toHaveValue('');
  });

  it('clears the box before it on backspace, so a typo is fixable', async () => {
    const user = userEvent.setup();
    stubClaim();
    stubCode();
    renderAt(at('code'));
    await user.click(await screen.findByLabelText('Digit 1 of 6'));
    await user.keyboard('41');
    // Focus is on box 3 and it is empty, so the keystroke clears box 2 and
    // moves there. Box 1 is untouched — a second backspace would clear it,
    // which is the point: every box is reachable without a mouse.
    await user.keyboard('{Backspace}');
    expect(screen.getByLabelText('Digit 2 of 6')).toHaveValue('');
    expect(screen.getByLabelText('Digit 1 of 6')).toHaveValue('4');
  });
});

describe('positioning', () => {
  it('renders blank with no Proovd draft behind it (§9, §33.1.5)', async () => {
    stubVetting(ANSWERED);
    renderAt(at('positioning'));
    const box = await screen.findByLabelText(/positioning/i);
    expect((box as HTMLTextAreaElement).value).toBe('');
    // The one field the product never drafts. There is no "we wrote this"
    // treatment on this screen at all.
    expect(document.body.textContent).not.toMatch(/we wrote this from our conversation/i);
    expect(screen.getByText(/we do not draft for you/i)).toBeInTheDocument();
  });

  it('does not ask Problem or Solution a second time', async () => {
    // The reference asks both twice. §9 has one of each, and a record collected
    // in two places is a record whose copies eventually disagree.
    stubVetting(ANSWERED);
    renderAt(at('positioning'));
    await screen.findByLabelText(/positioning/i);
    expect(screen.queryByDisplayValue(ANSWERED.problem)).toBeNull();
    expect(screen.queryByDisplayValue(ANSWERED.solution)).toBeNull();
  });

  it('names a missing earlier answer and links back to the page that owns it', async () => {
    stubVetting({
      ...ANSWERED,
      completeness: { problem: false, solution: true, competition: false },
    });
    renderAt(at('positioning'));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('link', { name: /your problem/i })).toHaveAttribute(
      'href',
      at('problem'),
    );
  });

  it('submits, then goes to the match', async () => {
    const user = userEvent.setup();
    // Registered BEFORE `stubVetting`, whose matcher is `url.includes('/vetting')`
    // and would otherwise answer the submit with the unsubmitted state.
    handlers.push((url, init) =>
      url.includes('/vetting/submit') && init?.method === 'POST'
        ? {
            status: 200,
            body: { ...vettingState(ANSWERED), submittedAt: '2026-08-18T12:00:00.000Z' },
          }
        : undefined,
    );
    stubVetting(ANSWERED);
    stubSignal({ status: 'available', count: 3, recordedAt: '2026-08-18T12:00:00.000Z' });
    renderAt(at('positioning'));
    await user.type(await screen.findByLabelText(/positioning/i), 'Spreadsheets, mostly.');
    await user.click(screen.getByRole('button', { name: /submit and see your creator match/i }));
    await screen.findByRole('heading', { name: /3 creators/i });
  });

  it('renders the dictation absence rather than a microphone that refuses', async () => {
    stubVetting({
      ...ANSWERED,
      transcription: {
        available: false,
        absentBecause: 'Dictation is not set up on this deployment.',
      },
    });
    renderAt(at('positioning'));
    await screen.findByLabelText(/positioning/i);
    expect(screen.getByText(/dictation is not set up/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /say it instead/i })).toBeNull();
  });

  it('offers nothing that writes for you (§12, §30)', async () => {
    stubVetting({ ...ANSWERED, transcription: { available: true } });
    renderAt(at('positioning'));
    await screen.findByLabelText(/positioning/i);
    expect(screen.getByRole('button', { name: /say it instead/i })).toBeInTheDocument();
    for (const word of [/suggest/i, /rewrite/i, /summari[sz]e/i, /generate/i, /improve/i]) {
      expect(screen.queryByRole('button', { name: word })).toBeNull();
    }
  });
});

describe('the relevance signal', () => {
  it('renders Creators, never the internal word (§3.1)', async () => {
    stubSignal({ status: 'available', count: 3, recordedAt: '2026-08-18T12:00:00.000Z' });
    renderAt(at('match'));
    await screen.findByRole('heading', { name: /3 creators/i });
    expect(document.body.textContent).not.toMatch(/affiliate/i);
  });

  it('states every one of the limits, in full', async () => {
    stubSignal({ status: 'available', count: 3, recordedAt: '2026-08-18T12:00:00.000Z' });
    renderAt(at('match'));
    await screen.findByRole('heading', { name: /3 creators/i });
    for (const line of POSSIBLE_CREATOR_RESULT_DISCLOSURES) {
      expect(screen.getByText(line)).toBeInTheDocument();
    }
  });

  it('renders identically for a zero result and an unrecorded one', async () => {
    // §10: "a zero result routes to Admin before the Founder proceeds", and
    // distinguishing the two would show a Founder a number §10 forbids. The
    // server collapses them before serializing; this compares what renders.
    stubSignal({ status: 'with_admin', count: null, recordedAt: null });
    const first = renderAt(at('match'));
    await screen.findByRole('heading', { name: /working on your match/i });
    const zero = document.body.textContent;
    first.unmount();

    handlers = [];
    stubSignal({ status: 'with_admin', count: null, recordedAt: null });
    renderAt(at('match'));
    await screen.findByRole('heading', { name: /working on your match/i });
    expect(document.body.textContent).toBe(zero);
  });

  it('promises nothing about what those Creators will do, and names none', async () => {
    stubSignal({ status: 'available', count: 3, recordedAt: '2026-08-18T12:00:00.000Z' });
    renderAt(at('match'));
    await screen.findByRole('heading', { name: /3 creators/i });
    const text = document.body.textContent ?? '';
    // The reference's own sub-line. It claims people who have agreed to nothing
    // are ready to promote something.
    expect(text).not.toMatch(/ready to promote/i);
    // And the breakdown, which no record holds.
    expect(text).not.toMatch(/newsletter|community owners/i);
  });

  it('does not gate the claim: the way forward is offered in both states', async () => {
    stubSignal({ status: 'with_admin', count: null, recordedAt: null });
    renderAt(at('match'));
    await screen.findByRole('heading', { name: /working on your match/i });
    expect(screen.getByRole('button', { name: /set up your account/i })).toBeEnabled();
  });
});

describe('the flow is operable over Session C pages', () => {
  const PAGES = ['email', 'code', 'positioning', 'match'];

  function stubEverything() {
    stubClaim();
    stubCode();
    stubVetting(ANSWERED);
    stubSignal({ status: 'available', count: 3, recordedAt: '2026-08-18T12:00:00.000Z' });
  }

  it('has no axe violations on any of them', async () => {
    for (const id of PAGES) {
      handlers = [];
      stubEverything();
      const view = renderAt(at(id));
      await screen.findByRole('heading', { level: 1 });
      expect(await axe(view.container), id).toHaveNoViolations();
      view.unmount();
    }
  });

  it('exposes exactly one level-1 heading per page (§33.11.2)', async () => {
    for (const id of PAGES) {
      handlers = [];
      stubEverything();
      const view = renderAt(at(id));
      await screen.findByRole('heading', { level: 1 });
      expect(screen.getAllByRole('heading', { level: 1 }), id).toHaveLength(1);
      view.unmount();
    }
  });

  it('names a destination on every nav control (§33.11.4)', async () => {
    for (const id of PAGES) {
      handlers = [];
      stubEverything();
      const view = renderAt(at(id));
      await screen.findByRole('heading', { level: 1 });
      for (const button of screen.getAllByRole('button')) {
        const label = (button.textContent ?? '').trim().toLowerCase();
        expect(OBJECTLESS_CTA_LABELS as readonly string[], `${id}: ${label}`).not.toContain(label);
      }
      view.unmount();
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   SESSION D — the claim (16), the five §12 answers (10–14), and Last look (15)
   ══════════════════════════════════════════════════════════════════════════ */

const CAMPAIGN = 'camp-d1';

function workspaceState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    campaignId: CAMPAIGN,
    campaignStatus: 'account_claimed',
    listingPaid: false,
    items: [
      { item: 'visuals', complete: true, completedAt: '2026-08-18T10:00:00.000Z', decisionSource: 'objective_evidence', rejections: [], locked: false, invalidated: { at: null, explanation: null } },
      { item: 'branding', complete: false, completedAt: null, decisionSource: null, rejections: ['logo_missing'], locked: false, invalidated: { at: null, explanation: null } },
      { item: 'interview', complete: false, completedAt: null, decisionSource: null, rejections: ['booking_absent'], locked: false, invalidated: { at: null, explanation: null } },
      { item: 'story', complete: false, completedAt: null, decisionSource: null, rejections: ['not_approved'], locked: false, invalidated: { at: null, explanation: null } },
      { item: 'socials', complete: false, completedAt: null, decisionSource: null, rejections: ['no_profile'], locked: false, invalidated: { at: null, explanation: null } },
    ],
    fee: {
      baseCents: '3500',
      itemDiscountCents: '200',
      maxDiscountCents: '1000',
      minSubtotalCents: '2500',
      completedItems: 1,
      discountLines: [{ item: 'visuals', discountCents: '200' }],
      discountCents: '200',
      subtotalCents: '3300',
      calculatedAt: '2026-08-18T10:00:00.000Z',
      locked: false,
      separateStreamNote: 'The 5% is separate.',
    },
    highEffort: null,
    brand: { colors: null, typography: null, notes: null, approved: false, logos: [] },
    story: { text: null, approved: false },
    visuals: [],
    socials: [],
    interview: {
      bookable: false,
      missingSettings: ['interview_providers', 'interviewers'],
      providers: [],
      availability: null,
      embed: { available: false, eventTypeLink: null, reference: null },
      booking: null,
    },
    lastSavedAt: null,
    resumeStep: null,
    uploadsAvailable: false,
    transcription: { available: false, absentBecause: 'Dictation is not set up on this deployment.' },
    vetting: {
      problem: 'Benches are lit from the ceiling, so the board sits in a shadow.',
      solution: 'A clamp lamp with a magnetic arm that holds its position.',
      competition: 'Head torches, and putting up with it.',
      submittedAt: '2026-08-18T09:00:00.000Z',
    },
    ...overrides,
  };
}

/** Serves the one workspace read the six stage-3 pages share. */
function stubWorkspace(initial: Record<string, unknown> = {}) {
  let state = workspaceState(initial);
  handlers.push((url, init) => {
    if (!url.includes('/workspace')) return undefined;
    if (init?.method === 'PATCH') {
      const patch = JSON.parse(String(init.body)) as Record<string, unknown>;
      // Only what the server DERIVES comes back. The text fields deliberately
      // are not echoed: §9's rule is that the caller's state is the only copy
      // of what was typed, and a suite that echoed them would never catch a
      // surface reading them back.
      if ('brandApproved' in patch) {
        state = { ...state, brand: { ...(state['brand'] as object), approved: patch['brandApproved'] } };
      }
      if ('storyApproved' in patch) {
        state = { ...state, story: { ...(state['story'] as object), approved: patch['storyApproved'] } };
      }
      return { status: 200, body: { workspace: state } };
    }
    return { status: 200, body: { workspace: state } };
  });
  return () => state;
}

/** The whole stage-3 sequence, for a walk that crosses pages. */
function stubStage3(initial: Record<string, unknown> = {}) {
  // The six stage-3 pages are behind `RequireRole` — that is the whole point of
  // the stage boundary — so a sweep of them needs an identity as well as data.
  handlers.push((url) =>
    url.startsWith('/api/account/me')
      ? { status: 200, body: { account: { role: 'founder', email: 'rowan@example.com', name: 'Rowan' } } }
      : undefined,
  );
  stubWorkspace(initial);
  handlers.push((url) => (url.includes('/api/payouts') ? { status: 200, body: { payouts: null } } : undefined));
}

describe('the claim (16)', () => {
  it('renders §10’s contents, and the three representations as three controls', async () => {
    stubClaim();
    renderAt(at('claim'));
    await screen.findByRole('heading', { name: /good to have you/i });

    // §10's nine listed contents, each its own control.
    expect(screen.getByLabelText(/legal name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^phone/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/date of birth/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^country/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^state/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/choose a password/i)).toBeInTheDocument();

    // §28.4: three separate, unchecked representations. Never one control.
    for (const label of [/i am a us person/i, /i am 18 or older/i, /sanctions list/i]) {
      const control = screen.getByRole('checkbox', { name: label });
      expect(control).not.toBeChecked();
    }
    expect(screen.queryByRole('checkbox', { name: /accept all/i })).toBeNull();
  });

  it('refuses in the open while the agreements are drafts, and offers no button', async () => {
    // All eight §31.4 documents are `draft`; a consent may cite only a
    // published version (a trigger), so `completeClaim` returns
    // `policies_unpublished`. The screen says why rather than showing a
    // control that would be refused.
    stubClaim();
    renderAt(at('claim'));
    await screen.findByRole('heading', { name: /good to have you/i });

    expect(screen.getByText(/still with our lawyers/i)).toBeInTheDocument();
    expect(screen.getByText(/no account has been created/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create my account/i })).toBeNull();
  });

  it('collects a phone and says, in those words, that it is never verified', async () => {
    // §33.1.8's surface half. There is no code to send to it and no control
    // here that could add one.
    stubClaim();
    renderAt(at('claim'));
    await screen.findByRole('heading', { name: /good to have you/i });

    expect(screen.getByText(/never send codes to this number/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /verify (my )?phone/i })).toBeNull();
  });

  it('says the date check is a courtesy over what the Founder states (§10)', async () => {
    const user = userEvent.setup();
    stubClaim();
    renderAt(at('claim'));
    await screen.findByRole('heading', { name: /good to have you/i });

    expect(screen.getByText(FLOW_AGE_IS_YOUR_STATEMENT)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/date of birth/i), '1990-01-31');
    expect(await screen.findByText(/^That is \d+ — 18 or over\.$/)).toBeInTheDocument();

    // And it is advice, never a gate: nothing here refuses on the number.
    await user.clear(screen.getByLabelText(/date of birth/i));
    await user.type(screen.getByLabelText(/date of birth/i), '2020-01-31');
    expect(await screen.findByText(/^That is \d+, which is under 18\.$/)).toBeInTheDocument();
  });

  it('opens a calendar that is operable from the keyboard, and closes on Escape', async () => {
    const user = userEvent.setup();
    stubClaim();
    renderAt(at('claim'));
    await screen.findByRole('heading', { name: /good to have you/i });

    await user.click(screen.getByRole('button', { name: /pick it on a calendar/i }));
    const grid = await screen.findByRole('grid');
    expect(grid).toBeInTheDocument();

    // One tab stop for the whole grid, arrows inside it (§28.5).
    const focusable = within(grid).getAllByRole('button').filter((b) => b.tabIndex === 0);
    expect(focusable).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: /change the year/i }));
    expect(screen.queryByRole('grid')).toBeNull();
    const years = screen.getAllByRole('button', { name: /^\d{4}$/ });
    expect(years.length).toBeGreaterThan(0);
  });

  it('says what creating the account does to the invitation link', async () => {
    stubClaim({}, PUBLISHED_POLICIES);
    renderAt(at('claim'));
    await screen.findByRole('heading', { name: /good to have you/i });
    expect(screen.getByText(FLOW_CLAIM_USES_THE_LINK)).toBeInTheDocument();
  });
});

describe('the five §12 answers (10–14)', () => {
  it('gives each one its own address and one question', async () => {
    for (const id of ['visuals', 'branding', 'interview', 'story', 'socials']) {
      handlers = [];
      stubStage3();
      const view = renderAt(at(id));
      await waitFor(() => expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1));
      view.unmount();
    }
  });

  it('names the saving from the SETTING, never from a hardcoded $2', async () => {
    // The reference hardcodes FEE_PER=2. §6 makes it a setting, and Phase 06's
    // rule is that a hardcoded number is a bug even when it is right.
    stubStage3({ fee: { ...(workspaceState()['fee'] as object), itemDiscountCents: '350' } });
    renderAt(at('branding'));
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByText(/US\$3\.50 off your listing fee/)).toBeInTheDocument();
  });

  it('offers no control that marks an answer done, and says who decides', async () => {
    stubStage3();
    renderAt(at('branding'));
    await screen.findByRole('heading', { level: 1 });

    expect(screen.getByText(FLOW_COMPLETION_IS_DECIDED)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /mark (this )?complete/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /mark (this )?(as )?done/i })).toBeNull();
  });

  it('says what is not counting, in the Founder’s own words', async () => {
    stubStage3();
    renderAt(at('branding'));
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByText('A logo or wordmark has not been uploaded.')).toBeInTheDocument();
  });

  it('renders the Track A4 upload absence rather than a control that fails', async () => {
    stubStage3();
    renderAt(at('visuals'));
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByText(/add a photo or video/i)).toBeNull();
    expect(screen.getByText(/uploading is not switched on/i)).toBeInTheDocument();
  });

  it('names the missing §6 settings instead of offering a slot', async () => {
    stubStage3();
    renderAt(at('interview'));
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByText('Booking an interview is not open yet')).toBeInTheDocument();
    expect(screen.getByText(/interview_providers/)).toBeInTheDocument();
    // tech-stack §12: the booking record is the provider's. No picker here.
    expect(screen.queryByRole('button', { name: /google meet|zoom|teams/i })).toBeNull();
  });

  it('offers copy, never generate (§12, §30)', async () => {
    const user = userEvent.setup();
    stubStage3();
    renderAt(at('visuals'));
    await screen.findByRole('heading', { level: 1 });

    await user.click(screen.getByText('Making visuals that look like your product'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Copy prompt' })).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: /generate/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /write (it|this) for me/i })).toBeNull();
  });

  it('renders the dictation absence on Story rather than a microphone that refuses', async () => {
    stubStage3();
    renderAt(at('story'));
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByText(/dictation is not set up on this deployment/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /say it instead/i })).toBeNull();
    // The one thing dictation would do, and nothing beside it (§12, §30).
    expect(screen.queryByRole('button', { name: /summari[sz]e|rewrite|suggest/i })).toBeNull();
  });

  it('walks the sequence forward and back, naming each destination', async () => {
    const user = userEvent.setup();
    stubStage3();
    renderAt(at('visuals'));
    await screen.findByRole('heading', { level: 1 });

    await user.click(screen.getByRole('button', { name: 'Continue to Your brand' }));
    await screen.findByRole('heading', { name: /logo and a written brand direction/i });

    await user.click(screen.getByRole('button', { name: 'Back to Your visuals' }));
    await screen.findByRole('heading', { name: /photo or video of what you are making/i });
  });

  it('ends the sequence at Last look', async () => {
    const user = userEvent.setup();
    stubStage3();
    renderAt(at('socials'));
    await screen.findByRole('heading', { level: 1 });
    await user.click(screen.getByRole('button', { name: 'Continue to Last look' }));
    await screen.findByRole('heading', { name: /last look/i });
  });
});

describe('Last look (15)', () => {
  it('shows all eight answers, and the fee the server computed', async () => {
    stubStage3();
    renderAt(at('last-look'));
    await screen.findByRole('heading', { name: /last look/i });

    for (const entry of FOUNDER_ANSWER_SEQUENCE) {
      expect(screen.getByText(founderAnswerLabel(entry)), entry.key).toBeInTheDocument();
    }
    expect(screen.getByText('US$33.00')).toBeInTheDocument();
    // Nothing computed here: the reference's FEE_BASE / FEE_PER / FEE_FLOOR are
    // four §6 settings and every amount arrives already worked out.
    expect(screen.getByText(/down from US\$35\.00/i)).toBeInTheDocument();
  });

  it('offers no way to change a §9 answer, because there is no address left', async () => {
    stubStage3();
    renderAt(at('last-look'));
    await screen.findByRole('heading', { name: /last look/i });

    // §9's route is behind the draft token and §10's claim invalidated it.
    for (const entry of FOUNDER_ANSWER_SEQUENCE.filter((e) => e.owner === 'vetting')) {
      const label = founderAnswerLabel(entry);
      expect(screen.queryByRole('button', { name: new RegExp(`change ${label}`, 'i') })).toBeNull();
    }
    expect(screen.getAllByText(/submitted with your answers/i).length).toBe(3);
  });

  it('returns here when an answer is opened from here, and says so', async () => {
    const user = userEvent.setup();
    stubStage3();
    renderAt(at('last-look'));
    await screen.findByRole('heading', { name: /last look/i });

    expect(screen.getByText(FLOW_LAST_LOOK_RETURNS)).toBeInTheDocument();

    const brandLabel = founderAnswerLabel(
      FOUNDER_ANSWER_SEQUENCE.find((entry) => entry.key === 'branding')!,
    );
    await user.click(screen.getByRole('button', { name: `Add ${brandLabel}` }));
    await screen.findByRole('heading', { name: /logo and a written brand direction/i });

    // The contract is in the ADDRESS, so it survives a reload mid-edit — and
    // both controls name Last look rather than the next answer.
    expect(screen.getAllByRole('button', { name: 'Back to Last look' }).length).toBe(2);
    await user.click(screen.getAllByRole('button', { name: 'Back to Last look' })[1]!);
    await screen.findByRole('heading', { name: /last look/i });
  });

  it('carries the return through a reload of the edited page', async () => {
    stubStage3();
    renderAt(`${at('branding')}?from=review`);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getAllByRole('button', { name: 'Back to Last look' }).length).toBe(2);
  });
});

describe('the help drawer across the claim', () => {
  it('offers reading but no jump once the invitation link is spent', async () => {
    const user = userEvent.setup();
    stubStage3();
    renderAt(at('visuals'));
    await screen.findByRole('heading', { level: 1 });

    await user.click(screen.getAllByRole('button', { name: 'Help' })[0]!);
    const drawer = await screen.findByRole('dialog');

    // The card for an earlier page is still there, with its explanation.
    expect(within(drawer).getByText('Your positioning')).toBeInTheDocument();
    // …and it is not a control, because the address it needs no longer exists.
    expect(
      within(drawer).queryByRole('button', { name: /your positioning/i }),
    ).toBeNull();
    expect(within(drawer).getAllByText(FOUNDER_FLOW_EARLIER_STAGE_CLOSED).length).toBeGreaterThan(0);
    // A page in the same stage still jumps.
    expect(within(drawer).getByRole('button', { name: /your visuals/i })).toBeInTheDocument();
  });
});

describe('§33.11 the flow is operable over Session D pages', () => {
  const PAGES = ['claim', 'visuals', 'branding', 'interview', 'story', 'socials', 'last-look'];

  function stubAll() {
    stubClaim();
    stubStage3();
  }

  it('has no axe violations on any of them', async () => {
    for (const id of PAGES) {
      handlers = [];
      stubAll();
      const view = renderAt(at(id));
      await screen.findByRole('heading', { level: 1 });
      expect((await axe(view.container)).violations, id).toEqual([]);
      view.unmount();
    }
  });

  it('exposes exactly one level-1 heading per page (§33.11.2)', async () => {
    for (const id of PAGES) {
      handlers = [];
      stubAll();
      const view = renderAt(at(id));
      await waitFor(() => expect(screen.getAllByRole('heading', { level: 1 }), id).toHaveLength(1));
      view.unmount();
    }
  });

  it('names a destination on every nav control (§33.11.4)', async () => {
    for (const id of PAGES) {
      handlers = [];
      stubAll();
      const view = renderAt(at(id));
      await screen.findByRole('heading', { level: 1 });
      for (const control of screen.getAllByRole('button')) {
        const name = (control.textContent ?? '').trim().toLowerCase();
        expect(OBJECTLESS_CTA_LABELS as readonly string[], `${id}: ${name}`).not.toContain(name);
      }
      view.unmount();
    }
  });
});

/**
 * Every read the flow makes, across all three auth regimes.
 *
 * The sweeps below walk all fifteen pages, and after Session D those cross
 * from the draft token to a Founder session. A loop that stubbed only the
 * draft reads would render six error states and report them as swept —
 which is exactly the failure §33.11.1's own stub-server check exists for.
 */
function stubAllRegimes() {
  stubLanding();
  stubVetting(ANSWERED);
  stubClaim();
  stubCode();
  stubSignal({ status: 'available', count: 3, recordedAt: '2026-08-18T12:00:00.000Z' });
  stubStage3();
}
