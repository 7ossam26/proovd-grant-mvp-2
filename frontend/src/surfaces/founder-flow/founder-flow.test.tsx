/**
 * The whole Founder onboarding flow — Founder Flow v2, Sessions B–F.
 *
 * The real route table in a memory router with `fetch` stubbed at the network
 * boundary. What is proved here is the half only the surface owns: that each of
 * the four pages is its own address and survives a reload there, that forward
 * and back work between them, that the help drawer lists what is behind and
 * never what is ahead, that the confirm screens render §9's prefill provenance
 * and never clear a valid field, that the campaign path is a real radio group
 * which explains both options before either is chosen, and a campaign in
 * review cannot issue build writes.
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
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { axe } from 'jest-axe';
import {
  FOUNDER_ANSWER_SEQUENCE,
  FOUNDER_FLOW_ABSENCES,
  FOUNDER_FLOW_PAGES,
  OBJECTLESS_CTA_LABELS,
  LISTING_FEE_CHECKOUT_CANCELED,
  NOTHING_HERE_IS_A_TIMER,
  ORDER_THRESHOLD_IS_A_COUNT,
  ROSTER_CHIPS_ARE_RECORDED,
  LISTING_FEE_LOCKED_AFTER_PAYMENT,
  LISTING_FEE_NEWSLETTER_LABEL,
  payoutDiscountLine,
  payoutSavedLine,
  SEPARATE_FIVE_PERCENT_NOTE,
  STRIPE_PREPARE_ITEMS,
  founderAnswerLabel,
  founderFlowPath,
  resolveListingFeeConsent,
} from '@proovd/shared';
import { invalidateSession } from '../../lib/session.js';
import { appRoutes } from '../../routes.js';
import { clearDraftFlowCache } from '../draft/api.js';
import { clearFounderWorkspaceCache } from '../founder/api.js';
import { resolvePitchDemoMode } from './referenceWalkthrough.js';

describe('Founder Flow pitch-demo build flag', () => {
  it('requires an explicit opt-in in production and never bypasses payment tests', () => {
    expect(resolvePitchDemoMode({ dev: false, mode: 'production' })).toBe(false);
    expect(resolvePitchDemoMode({ dev: false, mode: 'production', flag: 'true' })).toBe(true);
    expect(resolvePitchDemoMode({ dev: false, mode: 'test', flag: 'true' })).toBe(false);
  });
});

type StubResult = { status: number; body: unknown } | undefined;
type Handler = (url: string, init?: RequestInit) => StubResult | Promise<StubResult>;

let handlers: Handler[] = [];
let requests: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = [];

function respond(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

beforeEach(() => {
  cleanup();
  invalidateSession();
  clearDraftFlowCache();
  clearFounderWorkspaceCache();
  sessionStorage.clear();
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
      const result = await handler(url, init);
      if (result) return respond(result.status, result.body);
    }
    return respond(404, { error: 'not_found', title: 'No stub' });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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
  viewsCount: 24000,
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

describe('the phone and tablet handoff', () => {
  it('asks the Founder to claim the invite from a desktop', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: query.includes('pointer: coarse'),
          media: query,
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          dispatchEvent: () => false,
        }) as MediaQueryList,
    );
    stubLanding();

    renderAt(at('invite'));

    await screen.findByRole('heading', {
      name: 'We want you to have a great experience',
    });
    expect(
      screen.getByText('To claim your invite please open this link from your desktop'),
    ).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Proovd' })).toHaveAttribute(
      'src',
      '/assets/proovd-logo.svg',
    );
    expect(screen.queryByRole('button', { name: /open my form/i })).not.toBeInTheDocument();
  });
});


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
  }, 60_000);

  it('walks invite → problem → solution → campaign type, and back again', async () => {
    const user = userEvent.setup();
    stubLanding();
    stubVetting(ANSWERED);
    renderAt(at('invite'));

    // DELIBERATELY UPDATED (2026-08-20): screen 1 was rebuilt to the supplied
    // reference and its control is the reference's own `Check info`. What this
    // walk asserts — that the front door leads to the problem page and the
    // sequence walks both ways — is unchanged.
    await user.click(await screen.findByRole('button', { name: /check info/i }));
    await screen.findByRole('heading', { name: /this is how we understood your.*problem/i });

    await user.click(await screen.findByRole('button', { name: /continue to your solution/i }));
    await screen.findByRole('heading', { name: /this is how we understood your.*solution/i });

    await user.click(await screen.findByRole('button', { name: /continue to your reach/i }));
    await screen.findByRole('heading', { name: /new people/i });

    await user.click(await screen.findByRole('button', { name: /accept invite/i }));
    await screen.findByRole('heading', { name: /working on a/i });

    await user.click(await screen.findByRole('button', { name: /back to your reach/i }));
    await screen.findByRole('heading', { name: /new people/i });
  }, 30_000);

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
   Contextual help — factual guidance and a real support path
   ══════════════════════════════════════════════════════════════════════════ */

describe('the help drawer', () => {
  it('shows factual guidance for the current page and a real support path', async () => {
    const user = userEvent.setup();
    stubVetting(ANSWERED);
    renderAt(at('solution'));
    await screen.findByRole('heading', { level: 1 });

    await user.click(screen.getByRole('button', { name: 'Help' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('The solution');
    expect(dialog).toHaveTextContent('Describe what you are building and how it addresses the problem.');
    expect(dialog.querySelector('.ff-help-ref__docs section')).toHaveClass('is-current');
    expect(within(dialog).getByRole('link', { name: 'Contact Proovd support' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/support\?reference=/),
    );
    expect(dialog.textContent).not.toMatch(/\.pdf|worked example/i);
  });

  it('is page reading rather than a progress or navigation list', async () => {
    const user = userEvent.setup();
    stubVetting(ANSWERED);
    renderAt(at('problem'));
    await screen.findByRole('heading', { level: 1 });

    await user.click(screen.getByRole('button', { name: 'Help' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('The problem');
    expect(dialog).toHaveTextContent('Confirm or correct the problem your product solves.');
    expect(dialog).not.toHaveTextContent('Your solution');
    expect(dialog).not.toHaveTextContent('Your invite');
  });

  it('closes from its X without changing the page', async () => {
    const user = userEvent.setup();
    stubVetting(ANSWERED);
    renderAt(at('solution'));
    await screen.findByRole('heading', { level: 1 });

    await user.click(screen.getByRole('button', { name: 'Help' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /close help/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.querySelector('[data-flow-page]')).toHaveAttribute('data-flow-page', 'solution');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Screens 2–3 — the confirmation, its provenance, and its autosave
   ══════════════════════════════════════════════════════════════════════════ */

describe('confirming what Proovd understood', () => {
  it('shows the supplied answer read-only without adding provenance copy', async () => {
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
    const answer = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(answer.value).toBe(ANSWERED.problem);
    expect(answer.readOnly).toBe(true);
    expect(document.body).not.toHaveTextContent(/drafted by proovd/i);
  });

  it('is read-only until Edit, and editing saves what is typed', async () => {
    const user = userEvent.setup();
    stubVetting(ANSWERED);
    renderAt(at('problem'));
    await screen.findByRole('heading', { level: 1 });

    const box = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(box.readOnly).toBe(true);

    await user.click(screen.getByRole('button', { name: /^edit$/i }));
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

    await user.click(screen.getByRole('button', { name: /^edit$/i }));
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

    await user.click(screen.getByRole('button', { name: /^edit$/i }));
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

    await user.click(screen.getByRole('button', { name: /^edit$/i }));
    await user.type(screen.getByRole('textbox'), '!');
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/not saved/i));
    expect(screen.getByRole('status').textContent).not.toMatch(/retrying/i);
  });

  /*
    REWRITTEN 2026-08-20. It asserted a DISABLED forward control, and the screen
    was rebuilt to the reference's own `Next`, which is never disabled — the
    file's header records why: `.ff-prob__cta:disabled` renders identically to
    the live control, so a Founder pressed a button that looked exactly as
    pressable as it ever does and nothing happened.

    What it was protecting is what it still asserts, and more of it: an empty
    answer does not go past this screen. That is now load-bearing rather than
    tidy — letting one through deferred the refusal to Positioning six pages
    later, which answered it by navigating BACKWARD to here, and that closed the
    ring this test's neighbour below now covers.
  */
  it('will not continue from an empty answer, and says why at the control', async () => {
    const user = userEvent.setup();
    stubVetting({ selectedType: 'pre_launch' });
    renderAt(at('problem'));
    await screen.findByRole('heading', { level: 1 });

    await user.click(screen.getByRole('button', { name: 'Continue to your solution' }));

    // Still here, and told why — never an inert button and never a silent one.
    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot be skipped/i);
    expect(document.querySelector('[data-flow-page]')).toHaveAttribute(
      'data-flow-page',
      'problem',
    );
    // And the box is open, because it is read-only until Edit: a refusal about
    // an empty field with the field still closed names a control nobody sees.
    expect(screen.getByRole('textbox')).not.toHaveAttribute('readonly');
  });

  it('returns to Positioning when Positioning is what sent you here', async () => {
    // Without the return contract, filling the answer Positioning is waiting on
    // costs seven screens to get back — solution, reach, the campaign path, the
    // address, a NEW six-digit code, and both confirms. That is the ring again,
    // walked by hand. `AnswerPage`'s `?from=review`, for the other place in the
    // flow that sends somebody back for an answer.
    const user = userEvent.setup();
    stubVetting({ selectedType: 'pre_launch' });
    renderAt(`${at('problem')}?from=positioning`);
    await screen.findByRole('heading', { level: 1 });

    await user.click(screen.getByRole('button', { name: 'edit' }));
    await user.type(screen.getByRole('textbox'), 'Benches are lit from the ceiling.');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await user.click(screen.getByRole('button', { name: 'Continue to your solution' }));

    // Straight back, not on to Your solution.
    await waitFor(() =>
      expect(document.querySelector('[data-flow-page]')).toHaveAttribute(
        'data-flow-page',
        'positioning',
      ),
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Screen 4 — the campaign path, which locks nothing

   REWRITTEN 2026-08-20 with the screen, which was rebuilt to the reference's
   own `[data-kind]` pager (two arrows, one card, one `Select`, then a confirm
   stage of two rows). The `Choice` radio group these tests were written
   against no longer exists, so asserting against it would be asserting the
   absence of the rebuild.

   What they were PROTECTING survives, and is what they still assert: both
   paths are explained before either is chosen (§9), the answer is written and
   changeable, and NOTHING here locks anything (§33.1.7). One assertion is
   deliberately gone — see the note on the lock test.
   ══════════════════════════════════════════════════════════════════════════ */

describe('the campaign path', () => {
  /** The card on show: its headline, its sentence, and the sticker beside it. */
  const card = () => ({
    head: screen.getByRole('heading', { level: 1 }).textContent ?? '',
    body: document.querySelector('.ff-kind__body')?.textContent ?? '',
  });
  const pageTo = async (user: ReturnType<typeof userEvent.setup>, dir: 'next' | 'previous') =>
    user.click(screen.getByRole('button', { name: new RegExp(`show the ${dir} campaign type`, 'i') }));

  it('explains each path in plain language before either is chosen (§9)', async () => {
    const user = userEvent.setup();
    stubVetting({ problem: 'p', solution: 's' });
    renderAt(at('campaign-type'));
    await screen.findByRole('heading', { level: 1 });

    // The reference opens on the Idea card. Both its headline and its own
    // sentence are on the page before anything is chosen.
    expect(card().head).toContain('working on an');
    expect(card().body).toContain('Idea campaigns');
    expect(card().body).toContain('turn it into a product');

    // And the other one is one arrow away — the reference's answer to "explain
    // before it is chosen" on a stage that cannot hold both at once.
    await pageTo(user, 'next');
    await waitFor(() => expect(card().head).toContain('working on a...'));
    expect(card().body).toContain('Product campaigns');
    expect(card().body).toContain('founding-member pre-sale');

    // It wraps, so either arrow reaches either card.
    await pageTo(user, 'next');
    await waitFor(() => expect(card().body).toContain('Idea campaigns'));
  });

  it('opens on Admin’s discovery answer, and the Founder’s own choice supersedes it', async () => {
    const user = userEvent.setup();
    const read = stubVetting({ ...ANSWERED, selectedType: 'pre_build' });
    renderAt(at('campaign-type'));
    await screen.findByRole('heading', { level: 1 });

    expect(card().body).toContain('Idea campaigns');

    // Paging alone writes nothing — the reference sets the answer at `Select`,
    // and looking at a card is not choosing it.
    await pageTo(user, 'next');
    await waitFor(() => expect(card().body).toContain('Product campaigns'));
    expect(read()['selectedType']).toBe('pre_build');

    await user.click(screen.getByRole('button', { name: /^select$/i }));
    await waitFor(() => expect(read()['selectedType']).toBe('pre_launch'));
  });

  it('locks nothing: it writes the answer and never a locked type (§33.1.7)', async () => {
    const user = userEvent.setup();
    const read = stubVetting(ANSWERED);
    renderAt(at('campaign-type'));
    await screen.findByRole('heading', { level: 1 });

    await user.click(screen.getByRole('button', { name: /^select$/i }));
    await waitFor(() => expect(read()['selectedType']).toBe('pre_launch'));

    // The lock is at SUBMISSION and this page is not it. Nothing here writes
    // `lockedType`, writes `typeLockedAt`, or submits.
    //
    // The permanence warning this test used to assert is deliberately no
    // longer on the screen: the reference's `[data-kind]` does not draw one,
    // and `CAMPAIGN_TYPE_LOCK_WARNING`'s own register entry says it is shown
    // "at the campaign-path step and again before submission" — the second of
    // which is where it now renders alone, which is also the only moment it is
    // true. What the rule actually requires is asserted here instead, which is
    // that this screen cannot lock anything.
    expect(read()['lockedType']).toBeNull();
    expect(read()['typeLockedAt']).toBeNull();
    for (const request of requests) {
      expect(request.url).not.toMatch(/\/submit$/);
      if (request.body) expect(Object.keys(request.body)).not.toContain('lockedType');
    }
  });

  it('confirms the chosen path on a second stage, and the rows can still change it', async () => {
    const user = userEvent.setup();
    const read = stubVetting(ANSWERED);
    renderAt(at('campaign-type'));
    await screen.findByRole('heading', { level: 1 });

    await user.click(screen.getByRole('button', { name: /^select$/i }));

    // The pick stage's controls leave the tab order with it, and the confirm
    // stage's arrive: two rows and one `Confirm`.
    const chosen = await screen.findByRole('button', { name: /i have a product/i });
    await waitFor(() => expect(chosen.getAttribute('aria-pressed')).toBe('true'));
    const other = screen.getByRole('button', { name: /i have an idea/i });
    expect(other.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: /^confirm$/i })).toBeTruthy();

    // `rowPick`: the answer is still changeable here, and it writes.
    await user.click(other);
    await waitFor(() => expect(read()['selectedType']).toBe('pre_build'));
    expect(other.getAttribute('aria-pressed')).toBe('true');
  });

  it('goes back to the two cards without losing the answer', async () => {
    const user = userEvent.setup();
    stubVetting({ ...ANSWERED, selectedType: 'pre_build' });
    renderAt(at('campaign-type'));
    await screen.findByRole('heading', { level: 1 });

    await user.click(screen.getByRole('button', { name: /^select$/i }));
    await screen.findByRole('button', { name: /^confirm$/i });

    await user.click(screen.getByRole('button', { name: /back to campaign choices/i }));

    // The pick stage again, showing the card that was chosen — not reset to
    // the first one.
    await screen.findByRole('button', { name: /^select$/i });
    expect(card().body).toContain('Idea campaigns');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   What the reference draws and the Spec forbids
   ══════════════════════════════════════════════════════════════════════════ */

describe('the refusals', () => {
  it('keeps the supplied reach figure confined to its own page (§7)', async () => {
    stubLanding();
    stubVetting(ANSWERED);
    for (const page of FOUNDER_FLOW_PAGES) {
      handlers = [];
      stubAllRegimes();
      const view = renderAt(at(page.id));
      await screen.findByRole('heading', { level: 1 });
      const text = document.body.textContent ?? '';
      if (page.id === 'reach') expect(text).toMatch(/24,000\s*new people/i);
      else expect(text).not.toMatch(/24,000\s*new people/i);
      view.unmount();
    }
  });

  // DELIBERATELY INVERTED (2026-08-20), by explicit product direction. This
  // test used to refuse the reference's passive legal line on §10/§28.4
  // grounds; screen 1 now ships it verbatim and the reversal is recorded at
  // the top of InviteClaim.tsx.
  //
  // What the refusal was protecting is asserted here instead, because it is
  // the half that is about BEHAVIOUR rather than about copy: the claim still
  // wants three separate acceptances, this page still records none, and the
  // absence of a consent route from it is unchanged. The two other screens
  // that refuse the same sentence — the six-digit code and the Creator's
  // welcome — still assert it is absent, in their own suites.
  it('renders the reference legal line and still records no consent (§10)', async () => {
    stubLanding();
    renderAt(at('invite'));
    await screen.findByRole('heading', { level: 1 });

    const text = document.body.textContent ?? '';
    expect(text).toMatch(/By continuing you(’|')re agreeing to Proovd(’|')s/i);
    expect(screen.getByRole('link', { name: 'Terms of Service' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Privacy Policy.' })).toBeTruthy();

    // The page asks for nothing and can record nothing: no form, no field, no
    // checkbox, and one control — which navigates.
    expect(document.querySelectorAll('form')).toHaveLength(0);
    expect(document.querySelectorAll('input, select, textarea')).toHaveLength(0);
    expect(
      screen.getAllByRole('button').filter((b) => !/^help$/i.test(b.textContent ?? '')),
    ).toHaveLength(1);
  });

  // DELIBERATELY INVERTED (2026-08-20), by explicit product direction. This
  // used to assert the meta slot rendered the invitation record's own
  // `expected_setup_time`, and nothing at all when that was blank. The
  // reference hardcodes `~3 mins` and the instruction was to take its copy
  // verbatim; the record is a paragraph, and a paragraph in that slot squeezed
  // HELP out of its own width. The reversal is recorded in InviteClaim.tsx.
  it('renders the reference time estimate, whatever the record says', async () => {
    stubLanding({ expectedSetupTime: null });
    const view = renderAt(at('invite'));
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByText('~3 mins')).toBeTruthy();
    view.unmount();

    // The field is still collected and still stored. This screen no longer
    // renders it, so a long one can never reach the row.
    handlers = [];
    stubLanding({
      expectedSetupTime: 'About 20 to 30 minutes to tell us about the product.',
    });
    renderAt(at('invite'));
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByText('~3 mins')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/20 to 30 minutes/i);
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
      for (const word of ['pre_build', 'pre_launch', 'prebuild', 'prelaunch']) {
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
  }, 60_000);

  it('exposes exactly one level-1 heading per page (§33.11.2)', async () => {
    for (const page of FOUNDER_FLOW_PAGES) {
      handlers = [];
      stubAllRegimes();
      const view = renderAt(at(page.id));
      await waitFor(() => expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1));
      view.unmount();
    }
  }, 60_000);

  it('names a destination on every nav control (§33.11.4)', async () => {
    for (const page of FOUNDER_FLOW_PAGES) {
      handlers = [];
      stubAllRegimes();
      stubClaim();
      stubCode();
      const view = renderAt(at(page.id));
      await screen.findByRole('heading', { level: 1 });
      for (const control of screen.getAllByRole('button')) {
        const label = (control.getAttribute('aria-label') ?? control.textContent ?? '').trim().toLowerCase();
        expect(
          OBJECTLESS_CTA_LABELS as readonly string[],
          `${page.id}: "${label}"`,
        ).not.toContain(label);
      }
      view.unmount();
    }
  }, 60_000);

  it('offers the whole walk to the keyboard (§28.5)', async () => {
    const user = userEvent.setup();
    stubLanding();
    stubVetting(ANSWERED);
    renderAt(at('problem'));
    await screen.findByRole('heading', { level: 1 });

    const forward = screen.getByRole('button', { name: /continue to your solution/i });
    forward.focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('heading', { name: /this is how we understood your.*solution/i });
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Session C — the address, the code, and Positioning
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
 * rule). Stubbing an empty list instead would be stubbing a state the
 * product does not have.
 */
const DRAFT_POLICIES = [
  { slug: 'terms', route: '/terms', title: 'Terms of Service', version: 'v1.0', status: 'draft' },
  { slug: 'founder-aup', route: '/founder-aup', title: 'Founder Acceptable Use Policy', version: 'v1.0', status: 'draft' },
  { slug: 'privacy', route: '/privacy', title: 'Privacy Policy', version: 'v1.0', status: 'draft' },
];

function claimView(
  overrides: Record<string, unknown> = {},
  policies: unknown[] = DRAFT_POLICIES,
  founderSessionAuthorized = false,
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
    founderSessionAuthorized,
    canComplete: policies.length > 0,
  };
}

function stubClaim(
  overrides: Record<string, unknown> = {},
  policies: unknown[] = DRAFT_POLICIES,
  founderSessionAuthorized = false,
) {
  const view = claimView(overrides, policies, founderSessionAuthorized);
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
              support: '/support',
            },
          };
    }
    return undefined;
  });
  return asked;
}

describe('the address', () => {
  it('restores an existing Founder session and does not ask for email verification again', async () => {
    stubClaim({ emailOwnership: 'code_verified' }, DRAFT_POLICIES, true);
    stubVetting(ANSWERED);
    renderAt(at('email'));

    expect(
      await screen.findByRole('heading', { name: /you confirmed this was the problem/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /confirm email/i })).toBeNull();
  });

  it('is prefilled from the invitation, in a field a screen reader can name', async () => {
    stubClaim();
    renderAt(at('email'));
    // Wait for the page rather than the field: a loading panel is announced
    // too, and a label query that matches it passes before the read resolves.
    await screen.findByRole('heading', { level: 1 });
    const field = await screen.findByLabelText(/your email address/i);
    expect((field as HTMLInputElement).value).toBe('rowan@example.com');
    // DELIBERATELY INVERTED (2026-08-20), with the rebuild to the supplied
    // reference: the prefill NOTE is gone. The reference draws no label and no
    // hint on this screen, and one is not invented for it — the address IS the
    // prefill, in a field an `aria-label` names and a pencil marks as editable.
    expect(screen.queryByText(/filled in from your invitation/i)).toBeNull();
  });

  it('carries the reference’s own headline', async () => {
    // DELIBERATELY INVERTED (2026-08-20). This asserted the opposite: the
    // headline was refused because progress is already saved (§9's autosave has
    // been writing through the draft token since screen 2), and it now ships
    // verbatim by explicit product direction. That is a recorded deviation —
    // see the header of `EmailStep.tsx` — and the BEHAVIOUR is unchanged: no
    // save path moved, and confirming an address still saves nothing that was
    // not already saved. The matching `FOUNDER_FLOW_ABSENCES` entry has gone
    // with it, because a register naming an element the page renders is worse
    // than no register.
    stubClaim();
    renderAt(at('email'));
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: /to save your progress verify your email:/i,
      }),
    ).toBeInTheDocument();
  });

  it('asks for a code and moves on, and nothing branches on the answer', async () => {
    const user = userEvent.setup();
    stubClaim();
    const asked = stubCode();
    stubVetting(ANSWERED);
    renderAt(at('email'));
    // `Confirm email` is the reference's own label for this control.
    await user.click(await screen.findByRole('button', { name: /confirm email/i }));
    await waitFor(() => expect(asked.length).toBe(1));
    await screen.findByRole('heading', { name: /six digit code/i });
  });

  it('will not send to something that is not an address', async () => {
    const user = userEvent.setup();
    stubClaim();
    renderAt(at('email'));
    await screen.findByRole('heading', { level: 1 });
    const field = await screen.findByLabelText(/your email address/i);
    await user.clear(field);
    await user.type(field, 'rowan');
    // The reference's own click is a no-op on an address that is not one
    // (`if(/.+@.+\..+/.test(st.email))`); this is that, with the browser
    // announcing it, and it renders identically — there is no disabled
    // treatment in the reference to contradict.
    expect(screen.getByRole('button', { name: /confirm email/i })).toBeDisabled();
  });

  it('offers the reference’s one control, and it names where it goes', async () => {
    stubClaim();
    renderAt(at('email'));
    await screen.findByRole('heading', { level: 1 });
    // The reference draws `Back` bottom-left and nothing else — no wordmark, no
    // HELP, no message badge. `FlowPage`'s top bar is hidden for this page the
    // way it is for screens 1–4 and 6 (`.ff[data-flow-page='email'] .ff__top`),
    // so it leaves the tab order too; that is a stylesheet fact and jsdom loads
    // no stylesheet, which is why it is not asserted here. What IS asserted is
    // the control's accessible name: the visible word is the reference's own,
    // and §33.11.4's objectless-CTA rule is answered by the name.
    expect(screen.getByRole('button', { name: /back to campaign type/i })).toBeInTheDocument();
    // No badge is asked for at all, which is a fact about the markup.
    expect(screen.queryByRole('button', { name: /reading for this step/i })).toBeNull();
  });
});

describe('the six-digit code', () => {
  it('restores an existing Founder session and skips the code on Back, Forward, or reopen', async () => {
    stubClaim({ emailOwnership: 'code_verified' }, DRAFT_POLICIES, true);
    stubVetting(ANSWERED);
    renderAt(at('code'));

    expect(
      await screen.findByRole('heading', { name: /you confirmed this was the problem/i }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Digit 1 of 6')).toBeNull();
  });

  it('renders only link-unavailable when authorization fails', async () => {
    handlers.push((url) =>
      /\/api\/draft\/[^/]+\/claim$/.test(url)
        ? {
            status: 401,
            body: {
              error: 'link_unavailable',
              title: 'We cannot open this link',
              detail: '',
              next: '',
              support: '/support/link',
            },
          }
        : undefined,
    );
    renderAt(at('code'));

    expect(await screen.findByRole('heading', { name: /open this link/i })).toBeInTheDocument();
    expect(screen.queryByLabelText('Digit 1 of 6')).toBeNull();
    expect(screen.queryByRole('button', { name: /^resend$/i })).toBeNull();
  });

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
    await screen.findByRole('heading', { name: /you confirmed this was the problem/i });
    expect(document.querySelector('[data-flow-page]')).toHaveAttribute('data-flow-page', 'confirm-problem');
  });

  it('takes a pasted code, because that is how people enter one', async () => {
    const user = userEvent.setup();
    stubClaim();
    stubCode('418306');
    stubVetting(ANSWERED);
    renderAt(at('code'));
    await user.click(await screen.findByLabelText('Digit 1 of 6'));
    await user.paste('418306');
    await screen.findByRole('heading', { name: /you confirmed this was the problem/i });
    expect(document.querySelector('[data-flow-page]')).toHaveAttribute('data-flow-page', 'confirm-problem');
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

  it('locks Resend while its request is in flight', async () => {
    const user = userEvent.setup();
    stubClaim();
    let finish!: () => void;
    const pending = new Promise<StubResult>((resolve) => {
      finish = () =>
        resolve({
          status: 202,
          body: { status: 'sent', title: 'Check your email', whatHappened: 'x', next: 'y' },
        });
    });
    let calls = 0;
    handlers.push((url) => {
      if (!/\/email-code$/.test(url)) return undefined;
      calls += 1;
      return pending;
    });

    renderAt(at('code'));
    const resend = await screen.findByRole('button', { name: /^resend$/i });
    const first = user.click(resend);
    const second = user.click(resend);
    await Promise.all([first, second]);

    expect(calls).toBe(1);
    expect(resend).toBeDisabled();
    finish();
  });

  it('restores Resend and preserves the current code when the request fails', async () => {
    const user = userEvent.setup();
    stubClaim();
    handlers.push((url) =>
      /\/email-code$/.test(url)
        ? { status: 503, body: { error: 'email_code_unavailable' } }
        : undefined,
    );

    renderAt(at('code'));
    await user.click(await screen.findByLabelText('Digit 1 of 6'));
    await user.keyboard('41');
    const resend = screen.getByRole('button', { name: /^resend$/i });
    await user.click(resend);

    await waitFor(() => expect(resend).toBeEnabled());
    expect(screen.getByLabelText('Digit 1 of 6')).toHaveValue('4');
    expect(screen.getByLabelText('Digit 2 of 6')).toHaveValue('1');
    expect(screen.queryByText(/a new code is on its way/i)).toBeNull();
  });
});

describe('positioning', () => {
  it('hard-stops an unauthorized direct middle-step URL before Founder content renders', async () => {
    handlers.push((url) =>
      /\/api\/draft\/[^/]+\/vetting$/.test(url)
        ? {
            status: 401,
            body: {
              error: 'link_unavailable',
              title: 'We cannot open this link',
              detail: '',
              next: '',
              support: '/support/link',
            },
          }
        : undefined,
    );
    renderAt(at('positioning'));

    expect(await screen.findByRole('heading', { name: /open this link/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/positioning/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /next|back/i })).toBeNull();
  });

  it('renders blank with no Proovd draft behind it (§9, §33.1.5)', async () => {
    stubVetting(ANSWERED);
    renderAt(at('positioning'));
    const box = await screen.findByLabelText(/who else is solving this/i);
    expect((box as HTMLTextAreaElement).value).toBe('');
    // The one field the product never drafts. There is no helper that offers
    // to generate, suggest or write the answer for the Founder.
    expect(document.body.textContent).not.toMatch(/we wrote this from our conversation/i);
    expect(document.body.textContent).not.toMatch(/generate|suggest|write .* for me/i);
  });

  it('does not ask Problem or Solution a second time', async () => {
    // The reference asks both twice. §9 has one of each, and a record collected
    // in two places is a record whose copies eventually disagree.
    stubVetting(ANSWERED);
    renderAt(at('positioning'));
    await screen.findByLabelText(/who else is solving this/i);
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
      `${at('problem')}?from=positioning`,
    );
  });

  it('submits, then goes straight to the first campaign-addressed page', async () => {
    // The old token-addressed match/claim result pair left this part of the
    // flow on 2026-08-20, so submission continues to Your visuals with the
    // campaign id the submit response carries. Match now comes after Details.
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
    stubStage3();
    renderAt(at('positioning'));
    await user.type(
      await screen.findByLabelText(/who else is solving this/i),
      'Spreadsheets, mostly.',
    );
    await user.click(screen.getByRole('button', { name: /next/i }));
    await screen.findByRole('heading', { name: /we want to see your product/i });
    expect(document.querySelector('[data-flow-page]')).toHaveAttribute('data-flow-page', 'visuals');
  });

  it('never answers Next with silence, and never with a step backwards', async () => {
    /*
      Two bugs, and this test is the second half of the correction.

      The first, reported 2026-08-20: `Next` was `disabled` while an earlier §9
      answer was empty, and `.ff-compet__next:disabled` renders identically to
      the live control — same brand fill, same opacity. The button looked
      exactly as pressable as it ever does and did nothing at all. That half
      stands: the control is enabled and it answers.

      The second, reported the same day and REWRITTEN here: the answer it gave
      was to navigate to the page owning the empty answer. Walking forward from
      there arrives back here — problem → solution → reach → campaign type →
      email → code → the two confirms → positioning — so Next went round for
      ever and `visuals` was never reached. The guard is still right; §9 submits
      all three together and `submitVetting` refuses a short set by name. What
      it owes is the reason, said here, beside the links that were always on
      this page. An empty answer no longer gets past the screen that owns it
      either, which is what stops anybody arriving here in this state at all.
    */
    const user = userEvent.setup();
    stubVetting({
      ...ANSWERED,
      problem: null,
      completeness: { problem: false, solution: true, competition: false },
    });
    renderAt(at('positioning'));

    const next = await screen.findByRole('button', { name: /next/i });
    expect(next).toBeEnabled();

    await user.type(screen.getByRole('textbox'), 'Spreadsheets, mostly.');
    await user.click(next);

    // Still here, and the one message says what it blocks rather than only
    // what is missing — a second paragraph repeating it is what the first
    // correction shipped and a Founder reported.
    expect(document.querySelector('[data-flow-page]')).toHaveAttribute(
      'data-flow-page',
      'positioning',
    );
    const missing = screen.getByText(/one earlier answer is still empty/i);
    expect(missing).toHaveTextContent(/Next cannot go until it is filled in/i);
    expect(screen.queryAllByText(/is still empty/i)).toHaveLength(1);

    // And Next answers by putting the caret on the way out — a link that comes
    // back here rather than seven screens away, one of which mints a new code.
    const link = within(missing).getByRole('link', { name: /your problem/i });
    expect(link).toHaveAttribute('href', `${at('problem')}?from=positioning`);
    expect(link).toHaveFocus();
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
    expect(await screen.findByLabelText(/who else is solving this/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /say it instead/i })).toBeNull();
  });

  it('offers nothing that writes for you (§12, §30)', async () => {
    stubVetting({ ...ANSWERED, transcription: { available: true } });
    renderAt(at('positioning'));
    await screen.findByLabelText(/who else is solving this/i);
    expect(screen.getByRole('button', { name: /say it instead/i })).toBeInTheDocument();
    for (const word of [/suggest/i, /rewrite/i, /summari[sz]e/i, /generate/i, /improve/i]) {
      expect(screen.queryByRole('button', { name: word })).toBeNull();
    }
  });

  it('retries inside the recording row without replaying the microphone handoff', async () => {
    const user = userEvent.setup();
    const recognitions: MockRecognition[] = [];

    class MockRecognition {
      continuous = false;
      interimResults = false;
      lang = '';
      onresult = null;
      onerror = null;
      onend: (() => void) | null = null;
      onaudiostart: (() => void) | null = null;
      aborted = false;

      constructor() {
        recognitions.push(this);
      }

      start() {
        window.setTimeout(() => this.onaudiostart?.(), 0);
      }

      stop() {
        window.setTimeout(() => this.onend?.(), 0);
      }

      abort() {
        this.aborted = true;
        window.setTimeout(() => this.onend?.(), 0);
      }
    }

    vi.stubGlobal('SpeechRecognition', MockRecognition);
    stubVetting({ ...ANSWERED, transcription: { available: true } });
    const { container } = renderAt(at('positioning'));

    await user.click(await screen.findByRole('button', { name: /say it instead/i }));
    const firstRow = await waitFor(() => {
      const row = container.querySelector('[data-rec-row]');
      expect(row).not.toBeNull();
      return row;
    });

    await user.click(container.querySelector('button.is-retry')!);

    await waitFor(() => expect(recognitions).toHaveLength(2));
    expect(recognitions[0]?.aborted).toBe(true);
    expect(container.querySelector('[data-rec-row]')).toBe(firstRow);
    expect(container.querySelector('[data-say-row]')).toBeNull();
  });
});

describe('the flow is operable over Session C pages', () => {
  const PAGES = ['email', 'code', 'positioning'];

  function stubEverything() {
    stubClaim();
    stubCode();
    stubVetting(ANSWERED);
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
  }, 30_000);

  it('exposes exactly one level-1 heading per page (§33.11.2)', async () => {
    for (const id of PAGES) {
      handlers = [];
      stubEverything();
      const view = renderAt(at(id));
      await screen.findByRole('heading', { level: 1 });
      expect(screen.getAllByRole('heading', { level: 1 }), id).toHaveLength(1);
      view.unmount();
    }
  }, 30_000);

  it('names a destination on every nav control (§33.11.4)', async () => {
    for (const id of PAGES) {
      handlers = [];
      stubEverything();
      const view = renderAt(at(id));
      await screen.findByRole('heading', { level: 1 });
      for (const button of screen.getAllByRole('button')) {
        const label = (button.getAttribute('aria-label') ?? button.textContent ?? '').trim().toLowerCase();
        expect(OBJECTLESS_CTA_LABELS as readonly string[], `${id}: ${label}`).not.toContain(label);
      }
      view.unmount();
    }
  }, 30_000);
});

/* ══════════════════════════════════════════════════════════════════════════
   SESSION D — the five §12 answers (10–14), and Last look (15)
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
      // What the four remaining optional answers would still take off. Derived
      // on the server (§12 applies a cap AND a floor) and rendered by screen
      // 20's discount control.
      remainingDiscountCents: '800',
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
  handlers.push((url, init) => {
    if (!/\/details$/.test(url)) return undefined;
    const details = {
      name: 'Rowan',
      username: 'rowanbuilds',
      phone: '+1 555 0100',
      dateOfBirth: '1990-01-01',
      affiliateMatches: 4,
      affiliateType: 'community_owner',
    };
    if (init?.method === 'PATCH') {
      const patch = JSON.parse(String(init.body)) as Record<string, unknown>;
      return { status: 200, body: { details: { ...details, ...patch } } };
    }
    return { status: 200, body: { details } };
  });
  // Session E: the two stage-4 pages read these. The handler here used to
  // match `/api/payouts`, which is not an address this product has — the real
  // bases are `/api/founder/payouts` and `/api/creator/payouts` — so it never
  // fired, and the sweeps below rendered a payout panel with nothing in it.
  stubPayouts({ state: 'complete', listingFeeEligible: true });
  stubListing();
}

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

  it('renders the reference Back on Visuals without inventing a spent-token route', async () => {
    stubStage3();
    const view = renderAt(at('visuals'));
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByRole('button', { name: 'Back to the previous step' })).toBeInTheDocument();
    view.unmount();

    // And every later answer still steps back exactly one page.
    handlers = [];
    stubStage3();
    renderAt(at('branding'));
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByRole('button', { name: 'Back to Your visuals' })).toBeInTheDocument();
  });

  it('names the saving from the SETTING, never from a hardcoded $2', async () => {
    // The reference hardcodes FEE_PER=2. §6 makes it a setting, and Phase 06's
    // rule is that a hardcoded number is a bug even when it is right.
    stubStage3({ fee: { ...(workspaceState()['fee'] as object), itemDiscountCents: '350' } });
    renderAt(at('branding'));
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByText('optional: $3.50 discount')).toBeInTheDocument();
  });

  it('offers no control that lets the Founder mark an answer done', async () => {
    stubStage3();
    renderAt(at('branding'));
    await screen.findByRole('heading', { level: 1 });

    expect(screen.queryByRole('checkbox', { name: /mark (this )?complete/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /mark (this )?(as )?done/i })).toBeNull();
  });

  it('keeps an empty branding answer as an empty upload state', async () => {
    stubStage3();
    renderAt(at('branding'));
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByRole('button', { name: /upload logo/i })).toBeInTheDocument();
    expect(document.querySelector('.ff-brandlogo__list')).toBeNull();
  });

  it('keeps the reference upload copy visible when storage is unavailable', async () => {
    stubStage3();
    renderAt(at('visuals'));
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByText('Tap to add a file')).toBeInTheDocument();
    expect(screen.getByText('PNG, JPG, MP4')).toBeInTheDocument();
    expect(document.querySelector('#ff-vis-file')).toBeDisabled();
  });

  it('uses the reference ordinal label for an added logo instead of its filename', async () => {
    stubStage3({
      brand: {
        colors: null,
        typography: null,
        notes: null,
        approved: false,
        logos: [
          {
            id: 'logo-1',
            filename: 'founder-final-logo-v7.png',
            contentType: 'image/png',
            state: 'stored',
            rejection: null,
            approved: true,
            width: 1200,
            height: 1200,
            byteSize: '48120',
          },
        ],
      },
    });
    // A unique address avoids the workspace read-through cache populated by
    // earlier Branding renders in this suite.
    renderAt(founderFlowPath('branding', 'camp-logo-row'));
    await screen.findByRole('heading', { level: 1 });

    expect(screen.getByText('Logo 1 added')).toBeInTheDocument();
    expect(screen.queryByText('founder-final-logo-v7.png')).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove Logo 1 added' })).toHaveTextContent('x');
  });

  it('keeps Socials to the reference input and Add controls only', async () => {
    stubStage3({
      socials: [
        {
          id: 'social-1',
          url: 'https://instagram.com/proovd',
          platform: 'instagram.com',
          handle: 'proovd',
          accessible: false,
          rejection: 'unreachable',
          controlsConfirmed: false,
          checkedAt: '2026-08-18T10:00:00.000Z',
        },
      ],
    });
    renderAt(founderFlowPath('socials', 'camp-social-reference'));
    await screen.findByRole('heading', { level: 1 });

    expect(screen.getAllByRole('button', { name: 'Add' })).toHaveLength(4);
    expect(screen.queryByText('I control this profile')).toBeNull();
    expect(screen.queryByText('Check it again')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(screen.queryByText('That is not a web address we can open.')).toBeNull();
  });

  it('keeps the interview picker visible without inventing an unavailable embed', async () => {
    stubStage3();
    renderAt(at('interview'));
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByRole('heading', { name: /book your founder interview/i })).toBeInTheDocument();
    expect(document.querySelector('.ff-int__embed')).toBeNull();
  });

  it('offers factual help, never generated brand work (§12, §30)', async () => {
    // DELIBERATELY MOVED (2026-08-20): it ran on `visuals`, whose rebuild to the
    // supplied reference leaves no helper block — the reference's composition is
    // the zone, the link row and one Next. The rule is about the helper
    // resources rather than about that page, so it runs on `branding`, which
    // still renders them.
    const user = userEvent.setup();
    stubStage3();
    renderAt(at('branding'));
    await screen.findByRole('heading', { level: 1 });

    await user.click(screen.getAllByRole('button', { name: 'Help' })[0]!);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Branding');
    expect(dialog).toHaveTextContent(/product name and logo/i);
    expect(screen.queryByRole('button', { name: /generate/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /write (it|this) for me/i })).toBeNull();
  });

  it('keeps Story editable when dictation is unavailable, without a dead microphone', async () => {
    stubStage3();
    renderAt(at('story'));
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('button', { name: /say it instead/i })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Your story' })).toBeInTheDocument();
    // The one thing dictation would do, and nothing beside it (§12, §30).
    expect(screen.queryByRole('button', { name: /summari[sz]e|rewrite|suggest/i })).toBeNull();
  });

  it('saves the Founder approval that completes a written Story', async () => {
    const user = userEvent.setup();
    stubStage3();
    renderAt(at('story'));

    const story = await screen.findByRole('textbox', { name: 'Your story' });
    const approval = screen.getByRole('checkbox', {
      name: /approve this story for my public campaign page/i,
    });
    expect(approval).toBeDisabled();

    await user.type(story, 'Built from a real customer problem.');
    expect(approval).toBeEnabled();
    await user.click(approval);

    await waitFor(() =>
      expect(
        requests.some(
          (request) => request.method === 'PATCH' && request.body?.['storyApproved'] === true,
        ),
      ).toBe(true),
    );
  });

  it('lets the Founder approve a stored logo for Branding evidence', async () => {
    const user = userEvent.setup();
    const logo = {
      id: 'logo-approval',
      filename: 'logo.png',
      contentType: 'image/png',
      state: 'stored',
      rejection: null,
      approved: false,
      width: 1200,
      height: 1200,
      byteSize: '48120',
    };
    const initial = {
      brand: {
        colors: '#41ED98 — primary',
        typography: 'Bold headings and a clean sans-serif body',
        notes: null,
        approved: false,
        logos: [logo],
      },
    };
    handlers.push((url, init) =>
      url.endsWith('/uploads/logo-approval/approval') && init?.method === 'POST'
        ? {
            status: 200,
            body: {
              workspace: workspaceState({
                ...initial,
                brand: { ...initial.brand, logos: [{ ...logo, approved: true }] },
              }),
            },
          }
        : undefined,
    );
    stubStage3(initial);
    renderAt(at('branding'));

    const approval = await screen.findByRole('checkbox', { name: 'Approved' });
    await user.click(approval);
    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.url.endsWith('/uploads/logo-approval/approval') &&
            request.body?.['approved'] === true,
        ),
      ).toBe(true),
    );
  });

  it('saves typography and approval to complete the Brand direction', async () => {
    const user = userEvent.setup();
    stubStage3({
      brand: {
        colors: '#41ED98 — primary',
        typography: null,
        notes: null,
        approved: false,
        logos: [],
      },
    });
    renderAt(at('color'));

    const typography = await screen.findByRole('textbox', { name: 'Typography or style' });
    const approval = screen.getByRole('checkbox', {
      name: /approve this brand direction for my campaign/i,
    });
    expect(approval).toBeDisabled();

    await user.type(typography, 'Bold headings and a clean sans-serif body');
    expect(approval).toBeEnabled();
    await user.click(approval);

    await waitFor(() => {
      expect(
        requests.some(
          (request) =>
            request.method === 'PATCH' &&
            request.body?.['brandTypography'] === 'Bold headings and a clean sans-serif body',
        ),
      ).toBe(true);
      expect(
        requests.some(
          (request) => request.method === 'PATCH' && request.body?.['brandApproved'] === true,
        ),
      ).toBe(true);
    });
  });

  it('walks the sequence forward and back, naming each destination', async () => {
    // DELIBERATELY CHANGED (2026-08-20): `visuals` was rebuilt to the supplied
    // reference, whose forward control is its own word — `Next` — so the
    // objectless-CTA rule is answered there the way every other rebuilt screen
    // in this flow answers it, by the reference's copy being the specification.
    // The half this test exists for is unchanged and is still asserted: the
    // page it lands on names where its own Back goes.
    const user = userEvent.setup();
    stubStage3();
    renderAt(at('visuals'));
    await screen.findByRole('heading', { level: 1 });

    // Its visible word is the reference's `Next`; the accessible name adds the
    // destination, which is the half §33.11.4 is actually about.
    await user.click(screen.getByRole('button', { name: 'Next — your brand' }));
    await screen.findByRole('heading', { name: /more about your brand/i });

    await user.click(screen.getByRole('button', { name: 'Back to Your visuals' }));
    await screen.findByRole('heading', { name: /we want to see your product/i });
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
    expect(screen.getByText('$33')).toBeInTheDocument();
    // Nothing computed here: the reference's FEE_BASE / FEE_PER / FEE_FLOOR are
    // three §6 settings and every amount arrives already worked out. The
    // sentence is the reference's own `lastLookNote`, with the per-item amount
    // read from the server rather than from its hardcoded `$2`.
    expect(
      screen.getByText(/bonus answers left, each one drops the fee \$2\./i),
    ).toBeInTheDocument();
  });

  it('offers no way to change a §9 answer, because there is no address left', async () => {
    stubStage3();
    renderAt(at('last-look'));
    await screen.findByRole('heading', { name: /last look/i });

    // §9's route is behind the draft token and §10's claim invalidated it.
    // Not a disabled button — no button at all, which is what the reference's
    // own clickable card becomes when there is nowhere for it to go.
    for (const entry of FOUNDER_ANSWER_SEQUENCE.filter((e) => e.owner === 'vetting')) {
      const label = founderAnswerLabel(entry);
      expect(screen.queryByRole('button', { name: new RegExp(`^${label}`, 'i') })).toBeNull();
    }
    expect(screen.getAllByText(/submitted with your answers/i).length).toBe(3);
  });

  it('returns here when an answer is opened from here, and says so', async () => {
    const user = userEvent.setup();
    stubStage3();
    renderAt(at('last-look'));
    await screen.findByRole('heading', { name: /last look/i });


    const brandLabel = founderAnswerLabel(
      FOUNDER_ANSWER_SEQUENCE.find((entry) => entry.key === 'branding')!,
    );
    // The reference's card is a title and a tag, and that pair is its name.
    await user.click(screen.getByRole('button', { name: new RegExp(`^${brandLabel}`, 'i') }));
    await screen.findByRole('heading', { name: /more about your brand/i });

    // Branding is one two-screen answer. The first screen keeps the supplied
    // Back destination; Next carries the review return through the colour step.
    expect(screen.getByRole('button', { name: 'Back to Your visuals' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next — choose your brand colours' }));
    await waitFor(() =>
      expect(document.querySelector('[data-flow-page="color"]')).not.toBeNull(),
    );
    await user.click(screen.getByRole('button', { name: 'Next — back to Last look' }));
    await screen.findByRole('heading', { name: /last look/i });
  });

  it('carries the return through a reload of the edited page', async () => {
    stubStage3();
    renderAt(`${at('branding')}?from=review`);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByRole('button', { name: 'Back to Your visuals' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next — choose your brand colours' })).toBeInTheDocument();
  });
});

describe('the help drawer on campaign-addressed pages', () => {
  it('shows only factual guidance for that page', async () => {
    const user = userEvent.setup();
    stubStage3();
    renderAt(at('visuals'));
    await screen.findByRole('heading', { level: 1 });

    await user.click(screen.getAllByRole('button', { name: 'Help' })[0]!);
    const drawer = await screen.findByRole('dialog');

    expect(drawer).toHaveTextContent('Campaign visuals');
    expect(drawer).toHaveTextContent('Add visuals you have the right to publish.');
    expect(drawer).toHaveTextContent('Contact Proovd support');
    expect(drawer.textContent).not.toMatch(/\.pdf|handbook|worked example/i);
    expect(drawer).not.toHaveTextContent('Your positioning');
  });
});

describe('§33.11 the flow is operable over Session D pages', () => {
  const PAGES = ['visuals', 'branding', 'interview', 'story', 'socials', 'last-look'];

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
  }, 30_000);

  it('exposes exactly one level-1 heading per page (§33.11.2)', async () => {
    for (const id of PAGES) {
      handlers = [];
      stubAll();
      const view = renderAt(at(id));
      await waitFor(() => expect(screen.getAllByRole('heading', { level: 1 }), id).toHaveLength(1));
      view.unmount();
    }
  }, 30_000);

  it('names a destination on every nav control (§33.11.4)', async () => {
    for (const id of PAGES) {
      handlers = [];
      stubAll();
      const view = renderAt(at(id));
      await screen.findByRole('heading', { level: 1 });
      for (const control of screen.getAllByRole('button')) {
        const name = (control.getAttribute('aria-label') ?? control.textContent ?? '').trim().toLowerCase();
        expect(OBJECTLESS_CTA_LABELS as readonly string[], `${id}: ${name}`).not.toContain(name);
      }
      view.unmount();
    }
  }, 30_000);
});

/**
 * Every read the flow makes, across all three auth regimes.
 *
 * The sweeps below walk all twenty-four pages, and after Session D those cross
 * from the draft token to a Founder session, on to the money, and into the
 * build. A loop that stubbed only the draft reads would render fifteen error
 * states and report them as swept —
 which is exactly the failure §33.11.1's own stub-server check exists for.
 */
function stubAllRegimes() {
  stubLanding();
  stubVetting(ANSWERED);
  stubClaim();
  stubCode();
  stubStage3();
  // Session F's seven pages read the openness, the build and the roster.
  stubStage5();
}

/* ══════════════════════════════════════════════════════════════════════════
   Session E — the money (screens 25, 20)
   ══════════════════════════════════════════════════════════════════════════ */

const PAYOUTS_BASE = {
  stripeAccountId: null as string | null,
  missingRequirements: [] as string[],
  pendingVerification: [] as string[],
  disabledReason: null as string | null,
  canResume: true,
  onboardingAvailable: true,
  listingFeeEligible: false,
  linkActivationBlocked: false,
  paymentReceiptBlocked: false,
  campaignReviewBlocked: false,
  lastSyncedAt: null as string | null,
};

function stubPayouts(overrides: Record<string, unknown> = {}) {
  const payouts = { ...PAYOUTS_BASE, state: 'not_started', ...overrides };
  handlers.push((url) =>
    /\/api\/founder\/payouts$/.test(url) ? { status: 200, body: { payouts } } : undefined,
  );
  handlers.push((url) =>
    /\/api\/founder\/payouts\/link$/.test(url)
      ? { status: 200, body: { url: 'https://connect.stripe.example/x', expiresAt: '2026-08-19T12:00:00.000Z', reused: false } }
      : undefined,
  );
  return payouts;
}

const QUOTE = {
  url: 'https://checkout.stripe.example/s/1',
  sessionId: 'cs_1',
  baseCents: '3500',
  discountLines: [{ item: 'visuals', discountCents: '200' }],
  discountCents: '200',
  subtotalCents: '3300',
  taxCents: '272',
  totalCents: '3572',
  descriptor: 'PROOVD LISTING',
};

function stubListing(overrides: Record<string, unknown> = {}, quote = QUOTE) {
  const listing = {
    paid: false,
    onboardingState: 'complete',
    listingFeeEligible: true,
    taxAvailable: true,
    checkoutAvailable: true,
    ...overrides,
  };
  handlers.push((url, init) => {
    if (/\/listing\/checkout$/.test(url) && init?.method === 'POST') {
      return { status: 200, body: { checkout: quote } };
    }
    if (/\/listing$/.test(url)) return { status: 200, body: { listing } };
    return undefined;
  });
  return listing;
}

/** The §24.6 record a paid campaign renders. */
function paidListing(overrides: Record<string, unknown> = {}) {
  return {
    paid: true,
    payment: {
      baseCents: '3500',
      discountLines: [{ item: 'visuals', discountCents: '200' }],
      discountCents: '200',
      promotionCents: '0',
      subtotalCents: '3300',
      taxCents: '272',
      totalCents: '3572',
      descriptor: 'PROOVD LISTING',
      receiptUrl: null,
      paidAt: '2026-08-19T10:00:00.000Z',
      responseDeadlineAt: '2026-08-22T10:00:00.000Z',
      freeCancellationDeadlineAt: '2099-01-01T10:00:00.000Z',
    },
    refund: null,
    cancellation: null,
    ...overrides,
  };
}

/**
 * Screen 20's pay sheet — the step §13's billing address, tax total and
 * Appendix A.5 live on since the 1:1 rebuild (2026-08-21).
 *
 * The reference's `payAndStart` advances a step; here it opens a charge, and
 * none of what §13 requires before one fits the composition. So the assertions
 * that used to read the page directly open the sheet first.
 */
async function openPaySheet() {
  await screen.findByRole('heading', { name: /please pay/i });
  await userEvent.click(screen.getByRole('button', { name: /^pay & start/i }));
  await screen.findByRole('dialog');
}

function stubMoney(payouts: Record<string, unknown> = {}, listing: Record<string, unknown> = {}) {
  handlers.push((url) =>
    url.startsWith('/api/account/me')
      ? { status: 200, body: { account: { role: 'founder', email: 'rowan@example.com', name: 'Rowan' } } }
      : undefined,
  );
  stubPayouts(payouts);
  stubListing(listing);
  stubWorkspace();
}

describe('how you get paid (25)', () => {
  it('names what Stripe will ask for, and collects none of it', async () => {
    stubMoney();
    renderAt(at('payouts'));
    await screen.findByRole('heading', { name: /setup how you get paid/i });

    for (const item of STRIPE_PREPARE_ITEMS) {
      expect(screen.getByText(item.label)).toBeInTheDocument();
    }
    // §11 forbids reproducing provider-controlled fields; §5.3 says Proovd
    // stores statuses and IDs and never full bank details; §13 forbids storing
    // identity documents. The absence IS the enforcement, so it is asserted as
    // an absence rather than by checking what a field is named.
    const page = document.querySelector('.ff') as HTMLElement;
    expect(page.querySelectorAll('input')).toHaveLength(0);
    expect(page.querySelectorAll('select')).toHaveLength(0);
    expect(page.querySelectorAll('textarea')).toHaveLength(0);
  });

  it('opens Stripe rather than a form of our own', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    stubMoney();
    renderAt(at('payouts'));
    await screen.findByRole('heading', { name: /setup how you get paid/i });

    await userEvent.click(screen.getByRole('button', { name: /take me to stripe/i }));
    await waitFor(() =>
      expect(requests.some((r) => r.url.endsWith('/api/founder/payouts/link') && r.method === 'POST')).toBe(true),
    );
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://connect.stripe.example/x'));
  });

  it('keeps the supplied Continue label while naming its campaign-review destination', async () => {
    stubMoney({ state: 'complete', listingFeeEligible: true });
    stubStage5({ campaignStatus: 'pending_review' });
    renderAt(at('payouts'));
    await screen.findByRole('heading', { name: /all set to get paid/i });

    const forward = screen.getByRole('button', { name: /continue to campaign review/i });
    expect(forward).toBeInTheDocument();
    expect(forward.textContent?.trim()).toBe('Continue');

    await userEvent.click(forward);
    await screen.findByRole('heading', { name: /where your campaign stands/i });
  });

  it('offers a restricted account a support path and no way to PAY', async () => {
    stubMoney({ state: 'restricted', canResume: false, disabledReason: 'rejected.fraud' });
    renderAt(at('payouts'));
    await screen.findByText(/Stripe cannot continue with this account/i);

    // §13: "no misleading ability to pay the listing fee", and no retry either —
    // looping somebody through onboarding that will fail again is §1.4's
    // failure with a spinner on it.
    //
    // DELIBERATELY NARROWED (2026-08-21): this walked every button and refused
    // the whole vocabulary, which also refused a control that merely LEAVES.
    // The skip added this day is small, tertiary, sits under the row, and names
    // no payment — the §13 property is that nothing here offers to pay or to
    // retry onboarding, not that the page is a dead end. `Skip for now` is
    // exempted by name so a `Pay now` or a `Resume with Stripe` added later
    // still fails.
    for (const control of screen.getAllByRole('button')) {
      const label = (control.textContent ?? '').trim().toLowerCase();
      if (label === 'skip for now') continue;
      expect(label).not.toMatch(/pay|listing fee|stripe|finish|resume|try again/);
    }
    expect(screen.queryByRole('link', { name: /listing fee/i })).not.toBeInTheDocument();
    // The raw provider reason never reaches the Founder (§25.6, §33.9.11).
    expect(document.body.textContent).not.toContain('rejected.fraud');
  });

  it('offers no payment or forward action while Stripe is still reviewing', async () => {
    // `listingFeeEligible` is true only for a COMPLETE account, so the fee page
    // refuses for this one too — what §1.4 forbids is a control that IMPLIES
    // the payment will go through, and screen 20's refusal is a named state
    // with the way back on it rather than a dead end.
    //
    // DELIBERATELY INVERTED (2026-08-21): the second half asserted no forward
    // control existed at all. What it protected survives as the stronger half —
    // no visible label anywhere on the page names the listing fee, so nothing
    // here reads as an offer to pay.
    stubMoney({ state: 'under_review', pendingVerification: ['individual.verification.document'] });
    renderAt(at('payouts'));
    await screen.findByText(/Stripe is checking your details/i);

    for (const control of screen.getAllByRole('button')) {
      expect((control.textContent ?? '').toLowerCase()).not.toContain('listing fee');
    }

    expect(screen.queryByRole('button', { name: /skip|continue|pay|listing fee/i })).not.toBeInTheDocument();
  });
});

describe('the listing fee (20)', () => {
  it('renders the server’s subtotal and derives none of its own', async () => {
    // A surface that recalculated would produce US$25.00 from a US$35.00 base
    // and five savings whatever the server said. The reference does exactly
    // that — `max(25, 35 − 2 × n)` — which is how the preview and the charge
    // come to disagree (Phase 09's trap).
    stubMoney(
      { state: 'complete', listingFeeEligible: true },
      {},
    );
    handlers.unshift((url) =>
      url.includes('/workspace')
        ? {
            status: 200,
            body: {
              workspace: workspaceState({
                fee: { ...(workspaceState()['fee'] as object), subtotalCents: '2900', completedItems: 5 },
              }),
            },
          }
        : undefined,
    );
    renderAt(at('fee'));
    await screen.findByRole('heading', { name: /please pay/i });

    // UPDATED 2026-08-21 for the 1:1 rebuild: the hero is the reference's own
    // `${{ feeNow }}` — a literal `$` and the server's amount — so what is
    // asserted is the same fact in the shape the screen now renders it.
    const hero = document.querySelector('.ff-fee__amount') as HTMLElement;
    expect(hero.textContent).toBe('$29');
    expect(document.body.textContent).not.toContain('25.00');
  });

  /*
    DELIBERATELY INVERTED 2026-08-21. This asserted that `You saved $0` never
    renders — Session E's judgement, recorded on `payoutSavedLine`, and reversed
    by product direction with the 1:1 rebuild: the supplied screenshot shows
    that line at zero and the reference's copy is the specification on these
    pages. What the test protected is the half that matters and it is what is
    asserted now: every amount on the screen is the SERVER's, in the reference's
    own sentence, and nothing here computes one.
  */
  it('renders the reference’s saved line, with the server’s amount', async () => {
    stubMoney({ state: 'complete', listingFeeEligible: true });
    handlers.unshift((url) =>
      url.includes('/workspace')
        ? {
            status: 200,
            body: {
              workspace: workspaceState({
                fee: {
                  ...(workspaceState()['fee'] as object),
                  completedItems: 0,
                  discountLines: [],
                  discountCents: '0',
                  subtotalCents: '3500',
                },
              }),
            },
          }
        : undefined,
    );
    renderAt(at('fee'));
    await screen.findByRole('heading', { name: /please pay/i });

    expect(screen.getByText(payoutSavedLine('$0'))).toBeInTheDocument();
    // `payCanLower` is the server's `remainingDiscountCents`, not
    // `subtotal − floor`: the reference's subtraction is its own cap and floor
    // coinciding rather than the rule.
    expect(screen.getByText(payoutDiscountLine('$8'))).toBeInTheDocument();
  });

  it('shows the base line and each earned saving on its own labeled line (§13)', async () => {
    stubMoney({ state: 'complete', listingFeeEligible: true });
    renderAt(at('fee'));
    // UPDATED 2026-08-21: §13's itemisation has no room in the reference's
    // composition, so it is on the pay sheet — the step before anybody agrees
    // to anything, which is where §13 wants it.
    await openPaySheet();

    expect(screen.getByText('Listing a campaign')).toBeInTheDocument();
    expect(screen.getByText('US$35.00')).toBeInTheDocument();
    expect(screen.getByText('Visuals completed')).toBeInTheDocument();
    expect(screen.getByText('−US$2.00')).toBeInTheDocument();
    // Tax is Stripe's, against a real address. A US$0.00 line here would be a
    // claim nobody has made (§1.4).
    expect(screen.getByText(/Worked out from your billing address/)).toBeInTheDocument();
  });

  it('explains the separate 5% without conflating the two streams (§24.6)', async () => {
    stubMoney({ state: 'complete', listingFeeEligible: true });
    renderAt(at('fee'));
    await openPaySheet();

    const note = screen.getByText(SEPARATE_FIVE_PERCENT_NOTE);
    const text = note.textContent?.toLowerCase() ?? '';
    // The three facts §24.6 needs, whatever the wording: which fee this is,
    // that the 5% is a different one, and that the two never commingle.
    expect(text).toContain('5%');
    expect(text).toContain('separately from this listing fee');
    expect(text).toContain('unchanged by anything on this page');
  });

  it('refuses while payout setup is unfinished, and names the reason', async () => {
    stubMoney({ state: 'more_information_required' }, { checkoutAvailable: false, listingFeeEligible: false, onboardingState: 'more_information_required' });
    renderAt(at('fee'));
    await screen.findByText(/Your payout setup is not finished/);

    expect(screen.queryByRole('button', { name: /agree and pay/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /work out my total/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /finish setting up payouts/i })).toBeInTheDocument();
  });

  it('offers a restricted account no payment control at all (§13)', async () => {
    stubMoney({ state: 'restricted' }, { checkoutAvailable: false, listingFeeEligible: false, onboardingState: 'restricted' });
    renderAt(at('fee'));
    await screen.findByText(/Payment is not available/);

    for (const control of screen.getAllByRole('button')) {
      const label = (control.textContent ?? '').toLowerCase();
      expect(label).not.toMatch(/pay|total|finish setting up/);
    }
  });

  it('renders Appendix A.5 verbatim once the total is known, with A.5’s own action', async () => {
    stubMoney({ state: 'complete', listingFeeEligible: true });
    renderAt(at('fee'));
    await openPaySheet();

    await userEvent.type(screen.getByLabelText(/billing zip/i), '97201');
    await userEvent.click(screen.getByRole('button', { name: /work out my total/i }));

    const consent = await screen.findByTestId('listing-consent');
    const expected = resolveListingFeeConsent({ subtotal: '33.00', total: '35.72' });
    // Byte-identical, and the resolver throws on any surviving bracket.
    expect(consent.textContent).toBe(expected.body);
    expect(expected.body).not.toMatch(/\[[A-Z]+\]/);

    // §30: ONE action in a payment state, and A.5 fixes its words. The
    // reference's own `Pay & Start` would leave the consent's opening clause —
    // "By clicking Agree and Pay" — describing a control that is not there.
    expect(screen.getByRole('link', { name: expected.action })).toBeInTheDocument();
    // `Pay & Start` is the control that OPENED this sheet, and the background
    // is `inert` while it is open — so it is not something a person can press
    // from here (§30).
    expect(document.querySelector('.ff-fee__page')?.hasAttribute('inert')).toBe(true);
    const rows = document.querySelectorAll('.ff-fee__line--total dd');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toBe('US$35.72');
  });

  it('keeps the newsletter its own unchecked control (§28.4)', async () => {
    stubMoney({ state: 'complete', listingFeeEligible: true });
    renderAt(at('fee'));
    await openPaySheet();
    await userEvent.type(screen.getByLabelText(/billing zip/i), '97201');
    await userEvent.click(screen.getByRole('button', { name: /work out my total/i }));
    await screen.findByTestId('listing-consent');

    const optIn = screen.getByRole('checkbox', { name: LISTING_FEE_NEWSLETTER_LABEL });
    expect(optIn).not.toBeChecked();
  });

  it('does not advance on Enter (disagreement 10)', async () => {
    stubMoney({ state: 'complete', listingFeeEligible: true });
    renderAt(at('fee'));
    await openPaySheet();

    // The reference binds Enter to the current page's primary action
    // throughout. §30 forbids competing actions in a payment state, and a
    // stray keystroke in a ZIP field must not authorize a charge.
    await userEvent.type(screen.getByLabelText(/billing zip/i), '97201{Enter}');
    await new Promise((r) => setTimeout(r, 20));
    expect(requests.some((r) => r.url.includes('/listing/checkout'))).toBe(false);
    expect(screen.queryByTestId('listing-consent')).not.toBeInTheDocument();
  });

  it('renders §24.6’s record and §31.6’s decision once the fee is paid', async () => {
    stubMoney({ state: 'complete', listingFeeEligible: true }, paidListing());
    renderAt(at('fee'));
    // UPDATED 2026-08-21: the paid state keeps the reference's composition —
    // a headline, the amount, a line, one quiet control and one loud one — so
    // §24.6's record and §31.6's decision are behind `See what you paid`, and
    // the deadline itself is on the screen in the chrome.
    await screen.findByRole('heading', { name: /paid\. now build it/i });

    const total = document.querySelector('.ff-fee__amount') as HTMLElement;
    expect(total.textContent).toBe('$35.72');
    expect(document.body.textContent).toMatch(/whole amount back/i);

    await userEvent.click(screen.getByRole('button', { name: /see what you paid/i }));
    expect(await screen.findByText(/PROOVD LISTING/)).toBeInTheDocument();
    expect(screen.getByText(LISTING_FEE_LOCKED_AFTER_PAYMENT)).toBeInTheDocument();
    // §31.6, inside the window: the whole amount back, including its tax.
    expect(
      screen.getByRole('button', { name: /cancel and refund my listing fee/i }),
    ).toBeInTheDocument();
    // §30: the payment action is gone once there is nothing to pay.
    expect(screen.queryByRole('link', { name: /agree and pay/i })).not.toBeInTheDocument();
  });

  it('says nothing was charged when Stripe sends somebody back (§30)', async () => {
    stubMoney({ state: 'complete', listingFeeEligible: true });
    renderAt(`${at('fee')}?listing=canceled`);
    await screen.findByRole('heading', { name: /please pay/i });

    expect(screen.getByText(LISTING_FEE_CHECKOUT_CANCELED)).toBeInTheDocument();
  });
});

describe('what Session E moved', () => {
  it('redirects the retired campaign workspace to the listing fee', async () => {
    // The address survives its component: §27.3/§27.4 campaign emails sent
    // since Phase 12 point at it, so do Appendix C's §34 walkthrough steps, and
    // the listing fee is what a Founder following one was coming for.
    stubMoney({ state: 'complete', listingFeeEligible: true });
    renderAt(`/campaigns/${CAMPAIGN}/workspace`);
    // The fee page rendered, which is the whole claim — the memory router the
    // suite drives never touches `window.location`.
    await screen.findByRole('heading', { name: /please pay/i });
    expect(screen.getByText(payoutSavedLine('$2'))).toBeInTheDocument();
  });

  it('sends Last look’s All good to the Founder details handoff', async () => {
    stubStage3();
    renderAt(at('last-look'));
    await screen.findByRole('heading', { name: /last look/i });

    await userEvent.click(screen.getByRole('button', { name: 'All good' }));
    await waitFor(() =>
      expect(document.querySelector('[data-flow-page="details"]')).not.toBeNull(),
    );
  });

  it('carries §12’s high-effort note onto Last look, neutrally', async () => {
    stubStage3({
      highEffort: {
        visualsCompleted: true,
        brandingCompleted: false,
        interviewScheduledOrConfirmed: false,
        highEffort: false,
        calculatedAt: '2026-08-18T10:00:00.000Z',
      },
    });
    renderAt(at('last-look'));
    await screen.findByRole('heading', { name: /last look/i });

    // §12: "Present the criteria neutrally, not as a quality judgment."
    // The supplied Last look composition omits the internal high-effort
    // calculation entirely, so no verdict or implementation vocabulary leaks.
    const body = document.body.textContent ?? '';
    expect(body.toLowerCase()).not.toContain('high effort');
    expect(body.toLowerCase()).not.toContain('low effort');
    expect(body.toLowerCase()).not.toContain('poor');
    expect(body.toLowerCase()).not.toContain('judgement');
  });

  it('prefills the onboarding username and lets the Founder correct it', async () => {
    stubStage3();
    renderAt(at('details'));

    const username = await screen.findByLabelText('Username:');
    expect(username).toHaveValue('rowanbuilds');

    await userEvent.clear(username);
    await userEvent.type(username, 'rowan-labs');
    await userEvent.tab();

    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.method === 'PATCH' &&
            request.url.endsWith('/details') &&
            request.body?.['username'] === 'rowan-labs',
        ),
      ).toBe(true),
    );
  });

  it('uses the saved onboarding match count and type', async () => {
    stubStage3();
    renderAt(at('match'));

    expect(await screen.findByRole('heading', { name: '4 Affiliates' })).toBeInTheDocument();
    expect(screen.getByText('Community owner')).toBeInTheDocument();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Session F — openness, the build, and live (18, 21–24, 19, 26)
   ══════════════════════════════════════════════════════════════════════════ */

const BUILD_FIELDS = {
  title: null as string | null,
  founderDisplayName: null,
  founderEntityDisplay: null,
  founderCountry: null,
  founderProfileUrl: null,
  opensAt: null,
  closesAt: null,
  brandPerception: null,
  brandVoice: null,
  heroPreference: null,
  publicStory: null,
  orderThreshold: null as number | null,
  deliveryWindow: null,
  earlyProductDisclaimer: null,
  risksAndChallenges: null,
  internalTargetCents: null,
};

function buildState(overrides: Record<string, unknown> = {}) {
  return {
    build: { ...BUILD_FIELDS },
    rewardPackages: [],
    faqs: [],
    demoMoments: [],
    benefitCards: [],
    buildStatus: 'in_progress',
    missing: ['title', 'publicStory', 'rewardPackages'],
    campaignStatus: 'affiliate_response_and_build',
    model: 'product',
    reviewReadiness: { rosterStatus: 'gathering', buildStatus: 'in_progress', reviewReady: false },
    ...overrides,
  };
}

function stubBuild(initial: Record<string, unknown> = {}) {
  let state = buildState(initial);
  handlers.push((url, init) => {
    if (!/\/build$/.test(url)) return undefined;
    if (init?.method === 'PATCH') {
      const patch = JSON.parse(String(init.body)) as Record<string, unknown>;
      // Only what the server DERIVES comes back (§9). The text fields are
      // deliberately not echoed.
      state = {
        ...state,
        build: { ...(state.build as object), ...patch } as typeof state.build,
      };
      return { status: 200, body: { buildStatus: state.buildStatus, missing: state.missing, build: state.build } };
    }
    return { status: 200, body: state };
  });
  handlers.push((url, init) =>
    /\/build\/faqs$/.test(url) && init?.method === 'PUT'
      ? { status: 200, body: { faq: { id: 'faq-1', question: 'When?', answer: 'March 2027.' } } }
      : undefined,
  );
  handlers.push((url, init) =>
    /\/build\/rewards$/.test(url) && init?.method === 'PUT'
      ? { status: 200, body: { package: { id: 'rw-1' } } }
      : undefined,
  );
  return () => state;
}

function stubOpenness(overrides: Record<string, unknown> = {}) {
  const openness = {
    applicable: true,
    campaignType: 'pre_launch',
    stance: null,
    recordedAt: null,
    standardBasePercent: 30,
    withFixedBasePercent: 20,
    ...overrides,
  };
  handlers.push((url, init) => {
    if (!/fixed-payment-openness$/.test(url)) return undefined;
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as { stance: string };
      return { status: 200, body: { openness: { ...openness, stance: body.stance } } };
    }
    return { status: 200, body: { openness } };
  });
  return openness;
}

function stubStage5(
  build: Record<string, unknown> = {},
  openness: Record<string, unknown> = {},
  applicationReviewRequired = false,
) {
  handlers.push((url) =>
    url.startsWith('/api/account/me')
      ? { status: 200, body: { account: { role: 'founder', email: 'rowan@example.com', name: 'Rowan' } } }
      : undefined,
  );
  stubOpenness(openness);
  handlers.push((url, init) => {
    if (!/\/application-review(?:\/submit)?$/.test(url)) return undefined;
    const review = applicationReviewRequired
      ? {
          required: true,
          mayContinue: false,
          review: {
            round: 1,
            outcome: 'waiting',
            submittedAt: '2026-08-23T09:00:00.000Z',
            decidedAt: null,
            customerExplanation: null,
            changeRequests: [],
          },
        }
      : { required: false, mayContinue: true, review: null };
    if (init?.method === 'POST' || !init?.method) {
      return { status: 200, body: { applicationReview: review } };
    }
    return undefined;
  });
  stubBuild(build);
  handlers.push((url) =>
    /\/roster$/.test(url)
      ? {
          status: 200,
          body: {
            roster: {
              responseDeadlineAt: null,
              fullRefundOutcome: 'x',
              pendingProposalNote: 'y',
              terms: {
                basePercent: 30,
                ceilingPercent: 50,
                bidAllowed: true,
                fixedPaymentAllowed: true,
                highEffort: false,
              },
              creators: [
                { associationId: 'a1', handle: '@nolan', channelType: null, audienceMetric: null, niche: null, bio: null, statusLabel: 'Accepted', openProposal: null, lockedTerms: { totalPercent: 30, fixedPaymentCents: null }, meetingRequest: null },
                { associationId: 'a2', handle: '@wren', channelType: null, audienceMetric: null, niche: null, bio: null, statusLabel: 'Reviewing', openProposal: null, lockedTerms: null, meetingRequest: null },
              ],
            },
          },
        }
      : undefined,
  );
}

describe('how Creators are paid (18)', () => {
  it('clones the Product campaign payment-structure picker', async () => {
    stubStage5();
    renderAt(at('creator-payment'));
    await screen.findByRole('heading', { name: 'No optional fixed Creator payment' });

    expect(screen.getByText('Choose your creator payment structure')).toBeInTheDocument();
    expect(screen.getByText('Creators are paid only through their agreed share of captured pre-orders.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Next payment structure' }));
    expect(screen.getByRole('heading', { name: 'Open to an optional fixed Creator payment' })).toBeInTheDocument();
    expect(screen.getByText('A Creator may propose a fixed payment alongside a lower agreed percentage. Nothing is agreed on this screen.')).toBeInTheDocument();
  });

  it('records the selected structure and goes directly to the listing fee', async () => {
    stubStage5();
    stubMoney({ state: 'complete', listingFeeEligible: true });
    renderAt(at('creator-payment'));
    await screen.findByRole('heading', { name: 'No optional fixed Creator payment' });

    await userEvent.click(screen.getByRole('button', { name: 'Select' }));

    await waitFor(() =>
      expect(
        requests.some((r) => r.url.includes('fixed-payment-openness') && r.method === 'PUT'),
      ).toBe(true),
    );
    const sent = requests.find((r) => r.url.includes('fixed-payment-openness') && r.method === 'PUT');
    expect(sent!.body).toEqual({ stance: 'not_open' });
    await screen.findByRole('heading', { name: /please pay/i });
  });

  it('holds a campaign at Application Review when the Admin requirement is on', async () => {
    stubStage5({}, {}, true);
    renderAt(at('creator-payment'));
    await screen.findByRole('heading', { name: 'No optional fixed Creator payment' });

    await userEvent.click(screen.getByRole('button', { name: 'Select' }));

    expect(await screen.findByRole('heading', { name: 'Application Review' })).toBeInTheDocument();
    expect(screen.getByText(/with our review team/i)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /please pay/i })).not.toBeInTheDocument();
  });

  it('gives an Idea campaign the reference explainer and continuation instead of the picker', async () => {
    stubStage5({}, { applicable: false, campaignType: 'pre_build' });
    stubMoney({ state: 'complete', listingFeeEligible: true });
    renderAt(at('creator-payment'));
    await screen.findByRole('heading', { name: /creators earn an agreed share.*of captured pre-orders/i });

    expect(screen.queryByText('Choose your creator payment structure')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'I understand' })).toBeInTheDocument();
  });
});

describe('the build steps (23–26)', () => {
  it('opens with the two Admin brand-voice descriptors ready to edit', async () => {
    stubStage5({
      build: { ...BUILD_FIELDS, brandVoice: 'Confident, Friendly' },
    });
    renderAt(at('voice'));

    expect(await screen.findByRole('button', { name: 'Replace Confident' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replace Friendly' })).toBeInTheDocument();
  });

  it('composes the voice chips into the one §14.4 field, with no cap', async () => {
    stubStage5();
    renderAt(at('voice'));
    await screen.findByRole('heading', { name: /brand voice and tone/i });

    await userEvent.click(screen.getByRole('button', { name: /add more/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Fun' }));
    await userEvent.click(screen.getByRole('button', { name: 'Regal' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(screen.getByRole('button', { name: 'Replace Fun' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replace Regal' })).toBeInTheDocument();

    // §14.4 caps nothing — the reference stops at six. Every suggestion is
    // still offered after two are in.
    await userEvent.click(screen.getByRole('button', { name: /add more/i }));
    expect(screen.getAllByRole('button', { pressed: false }).length).toBeGreaterThan(6);
  });

  it('opens the add-more sheet while the campaign is editable', async () => {
    stubStage5();
    renderAt(at('voice'));
    await screen.findByRole('heading', { name: /brand voice and tone/i });

    await userEvent.click(screen.getByRole('button', { name: /add more/i }));

    expect(await screen.findByRole('dialog', { name: /is also/i })).toBeInTheDocument();
  });

  it('does not issue build writes after the campaign is locked for review', async () => {
    stubStage5({
      campaignStatus: 'pending_review',
      build: { ...BUILD_FIELDS, brandVoice: 'Fun' },
    });
    renderAt(at('voice'));
    await screen.findByRole('heading', { name: /where your campaign stands/i });

    expect(document.querySelector('[data-flow-page="voice"]')).toBeNull();
    expect(
      requests.some((request) => request.method === 'PATCH' && /\/build$/.test(request.url)),
    ).toBe(false);
  });

  it('does not let a stale local walkthrough marker override lifecycle state in tests', async () => {
    sessionStorage.setItem('proovd:founder-reference-walkthrough:camp-d1', '1');
    stubStage5({
      campaignStatus: 'vetting',
      build: { ...BUILD_FIELDS, brandVoice: 'Fun' },
    });
    renderAt(at('voice'));
    await screen.findByRole('heading', { name: /where your campaign stands/i });

    expect(
      requests.some((request) => request.method === 'PATCH' && /\/build$/.test(request.url)),
    ).toBe(false);
  });

  it('takes the threshold as a count, never an amount (§4.1)', async () => {
    stubStage5({ model: 'idea' });
    renderAt(at('threshold'));
    await screen.findByRole('heading', { name: /order threshold/i });

    expect(screen.getByText(ORDER_THRESHOLD_IS_A_COUNT)).toBeInTheDocument();
    // The reference labels this `(USD)` with `Ex: $1,000` and `Min. $500`.
    const page = document.querySelector('.ff') as HTMLElement;
    expect(page.textContent).not.toMatch(/USD|\$|minimum|Min\./i);
    // §3.2 bans the word for an Idea threshold in every audience.
    expect(page.textContent).not.toMatch(/\bgoals?\b/i);

    await userEvent.type(screen.getByLabelText(/pre-orders needed/i), '12a0');
    expect((screen.getByLabelText(/pre-orders needed/i) as HTMLInputElement).value).toBe('120');
  });

  it('tells a Product Founder the threshold step is not theirs (§14.4)', async () => {
    stubStage5({ model: 'product' });
    renderAt(at('threshold'));
    await screen.findByRole('heading', { name: /This step is for Idea Campaigns/i });

    // No field to disable — a Product campaign has no public threshold.
    expect(screen.queryByLabelText(/pre-orders needed/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /on to your faqs/i })).toBeInTheDocument();
  });

  // DELIBERATELY UPDATED (2026-08-21): screen 23 was rebuilt 1:1 from the
  // reference, so the surface this named is gone — its heading was `What will
  // people ask?`, its field `The question`, and its `.ff-faq__preview` a
  // stacked card list. What the test was protecting is unchanged and is what it
  // still asserts: the preview renders what is typed, from the same values.
  // The reference's own placeholder is what stands there before anything is.
  it('previews an FAQ as it is typed, over the reference placeholder', async () => {
    stubStage5();
    renderAt(at('faqs'));
    await screen.findByRole('heading', { name: /add your faq/i });

    const preview = document.querySelector('.ff-faq__card') as HTMLElement;
    expect(within(preview).getByText('You’ll see FAQ 1 here')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/FAQ 1 Title/i), 'When will I get it?');
    expect(within(preview).getByText('When will I get it?')).toBeInTheDocument();
  });

  it('converts a typed price to integer cents exactly once', async () => {
    stubStage5();
    renderAt(at('rewards'));
    await screen.findByRole('heading', { name: /backer rewards/i });

    await userEvent.type(screen.getByLabelText('Reward title'), 'Founding Edition');
    await userEvent.type(screen.getByLabelText('Reward price'), '120.5');
    await userEvent.type(screen.getByLabelText('Reward description'), 'One lamp.');
    await userEvent.type(screen.getByLabelText('Delivered by'), '0327');
    await userEvent.click(screen.getByRole('button', { name: /1\/3 add rewards/i }));

    await waitFor(() =>
      expect(requests.some((r) => r.url.includes('/build/rewards'))).toBe(true),
    );
    const sent = requests.find((r) => r.url.includes('/build/rewards'))!;
    expect((sent.body as Record<string, unknown>)['priceCents']).toBe('12050');
  });

  it('does not claim the build is finished when it is not', async () => {
    stubStage5();
    renderAt(at('rewards'));
    await screen.findByRole('heading', { name: /backer rewards/i });

    expect(screen.getByLabelText('Reward title')).toBeInTheDocument();
    expect(screen.getByLabelText('Reward description')).toBeInTheDocument();
    expect(screen.getByLabelText('Reward price')).toBeInTheDocument();
    expect(screen.getByLabelText('Delivered by')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/your campaign is (built|ready|complete)/i);
  });

  it('continues into the flow rather than ending at the campaign build', async () => {
    // The last step's only forward control used to leave the flow for
    // `/campaigns/:id/build`, and nothing in the product navigated into
    // `in-review` — so it was an unreachable island and no Founder ever arrived
    // at the dashboard handoff.
    // The reference's own chain is build → `campreview` → `live`.
    const user = userEvent.setup();
    stubStage5();
    stubMoney();
    renderAt(at('rewards'));
    await screen.findByRole('heading', { name: /backer rewards/i });

    for (let index = 1; index <= 3; index += 1) {
      await user.type(screen.getByLabelText('Reward title'), `Reward ${index}`);
      await user.type(screen.getByLabelText('Reward description'), `Description ${index}`);
      await user.type(screen.getByLabelText('Reward price'), `${20 + index}`);
      await user.type(screen.getByLabelText('Delivered by'), '0327');
      await user.click(screen.getByRole('button', { name: new RegExp(`${index}\\/3 add rewards`, 'i') }));
    }
    await screen.findByRole('heading', { name: /setup how you get paid/i });
  });
});

describe('the two waiting states (19, 26)', () => {
  it('says where the campaign stands, and never advances on its own', async () => {
    stubStage5({ campaignStatus: 'pending_review' });
    renderAt(at('in-review'));
    await screen.findByRole('heading', { name: /where your campaign stands/i });

    expect(screen.getByText(/with our review team/i)).toBeInTheDocument();
    expect(screen.getByText(NOTHING_HERE_IS_A_TIMER)).toBeInTheDocument();

    // The reference auto-advances after five seconds. Nothing here does.
    const before = document.body.textContent;
    await new Promise((r) => setTimeout(r, 120));
    expect(document.body.textContent).toBe(before);
  });

  it('renders the roster as recorded states, not as an animation', async () => {
    stubStage5({ campaignStatus: 'approved' });
    renderAt(at('in-review'));
    await screen.findByRole('heading', { name: /where your campaign stands/i });

    expect(screen.getByText(ROSTER_CHIPS_ARE_RECORDED)).toBeInTheDocument();
    expect(screen.getByText('@nolan')).toBeInTheDocument();
    expect(screen.getByText('Accepted')).toBeInTheDocument();
    // A Creator nobody has heard from is shown waiting, with §14.5's own word —
    // never flipped to accepted on a timer.
    expect(screen.getByText('Reviewing')).toBeInTheDocument();
  });

});

describe('the founder dashboard handoff', () => {
  it('sets a durable password before opening the authenticated campaign dashboard', async () => {
    stubStage5({ campaignStatus: 'pending_review' });
    handlers.push((url, init) =>
      /\/api\/founder\/settings\/initial-password$/.test(url) && init?.method === 'POST'
        ? { status: 200, body: { ok: true } }
        : undefined,
    );
    handlers.push((url) =>
      /\/api\/founder\/campaigns\/[^/]+\/dashboard$/.test(url)
        ? {
            status: 200,
            body: {
              dashboard: {
                campaignId: CAMPAIGN,
                status: 'pending_review',
                type: 'pre_launch',
                campaignLiveAt: null,
                campaignCloseAt: null,
                listingPaidAt: '2026-08-23T09:00:00.000Z',
                highEffort: false,
                title: 'Benchlight',
              },
            },
          }
        : undefined,
    );
    renderAt(at('in-review'));

    await userEvent.click(
      await screen.findByRole('button', { name: 'Secure account and continue' }),
    );

    await screen.findByRole('heading', { name: 'Secure your Founder account' });
    await userEvent.type(screen.getByLabelText('New password'), 'StrongPassword1!');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'StrongPassword1!');
    await userEvent.click(screen.getByRole('button', { name: 'Set password and open dashboard' }));

    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.url.endsWith('/api/founder/settings/initial-password') &&
            request.method === 'POST' &&
            request.body?.['campaignId'] === CAMPAIGN,
        ),
      ).toBe(true),
    );

    expect(await screen.findByRole('navigation', { name: 'Campaign chapters' })).toBeInTheDocument();
    expect(
      requests.some((request) => request.url.endsWith(`/campaigns/${CAMPAIGN}/dashboard`)),
    ).toBe(true);
  });

  it('keeps the retired live URL redirecting to the dashboard intro', async () => {
    stubStage5({ campaignStatus: 'live' });
    handlers.push((url) =>
      /\/api\/founder\/campaigns\/[^/]+\/dashboard$/.test(url)
        ? {
            status: 200,
            body: {
              dashboard: {
                campaignId: CAMPAIGN,
                status: 'live',
                type: 'pre_launch',
                campaignLiveAt: '2026-08-23T09:00:00.000Z',
                campaignCloseAt: '2026-09-06T09:00:00.000Z',
                listingPaidAt: '2026-08-22T09:00:00.000Z',
                highEffort: false,
                title: 'Benchlight',
              },
            },
          }
        : undefined,
    );
    renderAt(`/campaigns/${CAMPAIGN}/setup/live`);

    expect(await screen.findByRole('navigation', { name: 'Campaign chapters' })).toBeInTheDocument();
  });

  it('keeps a failed password write on the credential screen', async () => {
    stubStage5({ campaignStatus: 'pending_review' });
    handlers.push((url, init) =>
      /\/api\/founder\/settings\/initial-password$/.test(url) && init?.method === 'POST'
        ? {
            status: 422,
            body: {
              error: 'password_rejected',
              title: 'That password was not set',
              whatHappened: 'Choose a different password.',
            },
          }
        : undefined,
    );
    renderAt(at('password'));

    await userEvent.type(await screen.findByLabelText('New password'), 'StrongPassword1!');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'StrongPassword1!');
    await userEvent.click(screen.getByRole('button', { name: 'Set password and open dashboard' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a different password.');
    expect(screen.queryByRole('main', { name: 'Founder dashboard' })).not.toBeInTheDocument();
  });
});
