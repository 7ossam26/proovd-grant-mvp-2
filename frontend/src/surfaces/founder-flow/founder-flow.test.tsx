/**
 * The whole Founder onboarding flow — Founder Flow v2, Sessions B–F.
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
  FLOW_COMPLETION_IS_DECIDED,
  FLOW_LAST_LOOK_RETURNS,
  FOUNDER_ANSWER_SEQUENCE,
  FOUNDER_FLOW_EARLIER_STAGE_CLOSED,
  FOUNDER_FLOW_ABSENCES,
  FOUNDER_FLOW_PAGES,
  OBJECTLESS_CTA_LABELS,
  BUILD_STEPS_ARE_NOT_THE_WHOLE_BUILD,
  FIXED_PAYMENT_BINDS_NOBODY,
  FIXED_PAYMENT_IDEA_EXPLAINER,
  FIXED_PAYMENT_STANCES,
  FIXED_PAYMENT_TERMS_COME_LATER,
  LIVE_MEANS_A_LAUNCH_RECORD,
  LISTING_FEE_CHECKOUT_CANCELED,
  NOTHING_HERE_IS_A_TIMER,
  ORDER_THRESHOLD_IS_A_COUNT,
  ROSTER_CHIPS_ARE_RECORDED,
  LISTING_FEE_LOCKED_AFTER_PAYMENT,
  LISTING_FEE_NEWSLETTER_LABEL,
  LISTING_FEE_STILL_LOWERABLE,
  PAYOUT_PREPARE_COLLECTS_NOTHING,
  SEPARATE_FIVE_PERCENT_NOTE,
  STRIPE_PREPARE_ITEMS,
  founderAnswerLabel,
  founderFlowPath,
  resolveListingFeeConsent,
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

    // DELIBERATELY UPDATED (2026-08-20): screen 1 was rebuilt to the supplied
    // reference and its control is the reference's own `Check info`. What this
    // walk asserts — that the front door leads to the problem page and the
    // sequence walks both ways — is unchanged.
    await user.click(await screen.findByRole('button', { name: /check info/i }));
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

    await user.click(screen.getByRole('button', { name: 'Next' }));

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
    await user.click(screen.getByRole('button', { name: 'Next' }));

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

    await user.click(screen.getByRole('button', { name: /^back$/i }));

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

describe('the address', () => {
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

  it('submits, then goes straight to the first campaign-addressed page', async () => {
    // The match and claim screens left the flow on 2026-08-20, so the
    // submission continues to Your visuals with the campaign id the submit
    // response carries.
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
    await screen.findByText(FLOW_COMPLETION_IS_DECIDED);
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

  it('offers no Back on the first one, so Back can never walk forward', async () => {
    // §10's claim invalidated the draft token, so nothing behind `visuals` has
    // an address left. Its Back used to go to Last look — five pages FORWARD —
    // and that closed a ring: Back from Last look walked socials → story →
    // interview → branding → visuals and arrived at Last look again, round for
    // as long as somebody kept pressing it.
    stubStage3();
    const view = renderAt(at('visuals'));
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('button', { name: /^back to/i })).toBeNull();
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
    // DELIBERATELY REWORDED (2026-08-20): `visuals` was rebuilt to the supplied
    // reference and its zone carries the absence inside the reference's own
    // 500px box. The rule is unchanged and is what this asserts — the reason
    // renders where the control would be, and no control offers to add a file.
    stubStage3();
    renderAt(at('visuals'));
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByText(/tap to add a file/i)).toBeNull();
    expect(screen.getByText(/adding files is not switched on/i)).toBeInTheDocument();
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
    // DELIBERATELY MOVED (2026-08-20): it ran on `visuals`, whose rebuild to the
    // supplied reference leaves no helper block — the reference's composition is
    // the zone, the link row and one Next. The rule is about the helper
    // resources rather than about that page, so it runs on `branding`, which
    // still renders them.
    const user = userEvent.setup();
    stubStage3();
    renderAt(at('branding'));
    await screen.findByRole('heading', { level: 1 });

    await user.click(screen.getByText('Finding a brand direction that is yours'));
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

describe('the help drawer across the stage boundary', () => {
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
    await screen.findByRole('heading', { name: /set up how you get paid/i });

    for (const item of STRIPE_PREPARE_ITEMS) {
      expect(screen.getByText(item.label)).toBeInTheDocument();
    }
    expect(screen.getByText(PAYOUT_PREPARE_COLLECTS_NOTHING)).toBeInTheDocument();

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
    await screen.findByRole('heading', { name: /set up how you get paid/i });

    await userEvent.click(screen.getByRole('button', { name: /take me to stripe/i }));
    await waitFor(() =>
      expect(requests.some((r) => r.url.endsWith('/api/founder/payouts/link') && r.method === 'POST')).toBe(true),
    );
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://connect.stripe.example/x'));
  });

  it('names the listing fee when the account is complete, rather than “Continue”', async () => {
    stubMoney({ state: 'complete', listingFeeEligible: true });
    renderAt(at('payouts'));
    await screen.findByRole('heading', { name: /all set to get paid/i });

    const forward = screen.getByRole('button', { name: /continue to your listing fee/i });
    expect(forward).toBeInTheDocument();
    // §33.11.4's own register, by exact match on the trimmed accessible name.
    for (const control of screen.getAllByRole('button')) {
      expect(OBJECTLESS_CTA_LABELS as readonly string[]).not.toContain(
        (control.textContent ?? '').trim(),
      );
    }

    await userEvent.click(forward);
    await screen.findByRole('heading', { name: /your listing fee/i });
  });

  it('offers a restricted account a support path and no way to pay', async () => {
    stubMoney({ state: 'restricted', canResume: false, disabledReason: 'rejected.fraud' });
    renderAt(at('payouts'));
    await screen.findByText(/Stripe cannot continue with this account/i);

    // §13: "no misleading ability to pay the listing fee", and no retry either —
    // looping somebody through onboarding that will fail again is §1.4's
    // failure with a spinner on it.
    for (const control of screen.getAllByRole('button')) {
      const label = (control.textContent ?? '').toLowerCase();
      expect(label).not.toMatch(/pay|listing fee|stripe|finish|resume|try again/);
    }
    expect(screen.queryByRole('link', { name: /listing fee/i })).not.toBeInTheDocument();
    // The raw provider reason never reaches the Founder (§25.6, §33.9.11).
    expect(document.body.textContent).not.toContain('rejected.fraud');
  });

  it('offers no way forward while Stripe is still reviewing', async () => {
    // `listingFeeEligible` is true only for a COMPLETE account, so the fee page
    // refuses for this one too — and a control opening a page whose answer we
    // already know is a refusal is the same §1.4 failure with a happier tone.
    stubMoney({ state: 'under_review', pendingVerification: ['individual.verification.document'] });
    renderAt(at('payouts'));
    await screen.findByText(/Stripe is checking your details/i);

    for (const control of screen.getAllByRole('button')) {
      expect((control.textContent ?? '').toLowerCase()).not.toContain('listing fee');
    }
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
    await screen.findByRole('heading', { name: /your listing fee/i });

    const hero = document.querySelector('.ff-money__amount') as HTMLElement;
    expect(hero.textContent).toBe('US$29.00');
    expect(screen.queryByText('US$25.00')).not.toBeInTheDocument();
  });

  it('never reports a saving of zero, and says what each answer is worth', async () => {
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
    await screen.findByRole('heading', { name: /your listing fee/i });

    // The reference renders `You saved $0 by doing bonus tasks` here.
    expect(document.body.textContent).not.toMatch(/saved\s+US\$0/i);
    expect(document.body.textContent).not.toMatch(/saved\s+\$0/i);
    expect(screen.getByText(/Each optional answer takes US\$2\.00 off/)).toBeInTheDocument();
    expect(screen.getByText(LISTING_FEE_STILL_LOWERABLE)).toBeInTheDocument();
  });

  it('shows the base line and each earned saving on its own labeled line (§13)', async () => {
    stubMoney({ state: 'complete', listingFeeEligible: true });
    renderAt(at('fee'));
    await screen.findByRole('heading', { name: /your listing fee/i });

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
    await screen.findByRole('heading', { name: /your listing fee/i });

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
    await screen.findByRole('heading', { name: /your listing fee/i });

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
    expect(screen.queryByRole('button', { name: /pay & start/i })).not.toBeInTheDocument();
    const rows = document.querySelectorAll('.ff-lines__row--total dd');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toBe('US$35.72');
  });

  it('keeps the newsletter its own unchecked control (§28.4)', async () => {
    stubMoney({ state: 'complete', listingFeeEligible: true });
    renderAt(at('fee'));
    await screen.findByRole('heading', { name: /your listing fee/i });
    await userEvent.type(screen.getByLabelText(/billing zip/i), '97201');
    await userEvent.click(screen.getByRole('button', { name: /work out my total/i }));
    await screen.findByTestId('listing-consent');

    const optIn = screen.getByRole('checkbox', { name: LISTING_FEE_NEWSLETTER_LABEL });
    expect(optIn).not.toBeChecked();
  });

  it('does not advance on Enter (disagreement 10)', async () => {
    stubMoney({ state: 'complete', listingFeeEligible: true });
    renderAt(at('fee'));
    await screen.findByRole('heading', { name: /your listing fee/i });

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
    await screen.findByRole('heading', { name: /your listing fee is paid/i });

    const total = document.querySelector('.ff-money__amount') as HTMLElement;
    expect(total.textContent).toBe('US$35.72');
    expect(screen.getByText(/PROOVD LISTING/)).toBeInTheDocument();
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
    await screen.findByRole('heading', { name: /your listing fee/i });

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
    await screen.findByRole('heading', { name: /your listing fee/i });
    expect(screen.getByText(LISTING_FEE_STILL_LOWERABLE)).toBeInTheDocument();
  });

  it('sends Last look’s All good to Stripe rather than to the fee', async () => {
    // `beginListingCheckout` refuses without a complete `founder_seller`, so
    // the fee page reached first is a fee page whose only path is the refusal.
    stubStage3();
    renderAt(at('last-look'));
    await screen.findByRole('heading', { name: /last look/i });

    await userEvent.click(screen.getByRole('button', { name: /set up how you get paid/i }));
    // Which §13 state greets them depends on their account; that it is the
    // payouts PAGE is the claim, and `data-flow-page` is what says so.
    await waitFor(() =>
      expect(document.querySelector('[data-flow-page="payouts"]')).not.toBeNull(),
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
    await screen.findByText('What Creators will see about preparation');

    // §12: "Present the criteria neutrally, not as a quality judgment."
    // DNA §5.10 and §30 forbid copy implying the Founder underperformed.
    const body = document.body.textContent ?? '';
    expect(body).toMatch(/not a judgement of your campaign/);
    expect(body).toMatch(/no effect on\s+whether a fixed payment is available/);
    expect(body.toLowerCase()).not.toContain('low effort');
    expect(body.toLowerCase()).not.toContain('poor');
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

function stubStage5(build: Record<string, unknown> = {}, openness: Record<string, unknown> = {}) {
  handlers.push((url) =>
    url.startsWith('/api/account/me')
      ? { status: 200, body: { account: { role: 'founder', email: 'rowan@example.com', name: 'Rowan' } } }
      : undefined,
  );
  stubOpenness(openness);
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
              creators: [
                { associationId: 'a1', handle: '@nolan', channelType: null, audienceMetric: null, niche: null, bio: null, statusLabel: 'Accepted', openProposal: null },
                { associationId: 'a2', handle: '@wren', channelType: null, audienceMetric: null, niche: null, bio: null, statusLabel: 'Reviewing', openProposal: null },
              ],
            },
          },
        }
      : undefined,
  );
}

describe('how Creators are paid (18)', () => {
  it('offers three answers, and no amount anywhere', async () => {
    stubStage5();
    renderAt(at('creator-payment'));
    await screen.findByRole('heading', { name: /how creators are paid/i });

    // §14.3's percentages, from the settings the server sent — never typed
    // into this file. The lede states the standard rate and the panel states
    // both, which is why the standard one appears twice.
    expect(screen.getAllByText(/30%/).length).toBeGreaterThan(0);
    expect(screen.getByText(/20%/)).toBeInTheDocument();

    for (const stance of FIXED_PAYMENT_STANCES) {
      expect(screen.getByRole('radio', { name: new RegExp(stance.label, 'i') })).toBeInTheDocument();
    }
    expect(screen.getByText(FIXED_PAYMENT_BINDS_NOBODY)).toBeInTheDocument();
    expect(screen.getByText(FIXED_PAYMENT_TERMS_COME_LATER)).toBeInTheDocument();

    // §16: the terms are the Creator's to propose. There is no field here that
    // could carry an amount, and the record has no column for one.
    const page = document.querySelector('.ff') as HTMLElement;
    for (const input of page.querySelectorAll('input')) {
      expect(input.getAttribute('type')).toBe('radio');
    }
    expect(page.textContent).not.toMatch(/\bupfront\b/i);
    expect(page.textContent).not.toMatch(/US\$/);
  });

  it('records the answer and carries on into the build', async () => {
    stubStage5();
    renderAt(at('creator-payment'));
    await screen.findByRole('heading', { name: /how creators are paid/i });

    await userEvent.click(screen.getByRole('radio', { name: /would consider it/i }));
    await userEvent.click(screen.getByRole('button', { name: /save and start/i }));

    await waitFor(() =>
      expect(
        requests.some((r) => r.url.includes('fixed-payment-openness') && r.method === 'PUT'),
      ).toBe(true),
    );
    const sent = requests.find((r) => r.url.includes('fixed-payment-openness') && r.method === 'PUT');
    // The body carries the stance and nothing else — no amount to strip.
    expect(Object.keys(sent!.body ?? {})).toEqual(['stance']);
    await waitFor(() =>
      expect(document.querySelector('[data-flow-page="voice"]')).not.toBeNull(),
    );
  });

  it('gives an Idea campaign the explanation and no control at all (§14.3)', async () => {
    stubStage5({}, { applicable: false, campaignType: 'pre_build' });
    renderAt(at('creator-payment'));
    await screen.findByRole('heading', { name: /how creators are paid/i });

    expect(screen.getByText(FIXED_PAYMENT_IDEA_EXPLAINER)).toBeInTheDocument();
    // The absence IS the rule. Not a disabled control — none at all.
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/would consider it/i);
  });
});

describe('the build steps (21–24)', () => {
  it('composes the voice chips into the one §14.4 field, with no cap', async () => {
    stubStage5();
    renderAt(at('voice'));
    await screen.findByRole('heading', { name: /how should your campaign sound/i });

    await userEvent.click(screen.getByRole('button', { name: 'Fun' }));
    await userEvent.click(screen.getByRole('button', { name: 'Regal' }));

    const box = screen.getByLabelText(/your brand voice/i) as HTMLTextAreaElement;
    expect(box.value).toBe('Fun, Regal');

    // §14.4 caps nothing — the reference stops at six. Every suggestion is
    // still offered after two are in.
    expect(screen.getAllByRole('button', { pressed: false }).length).toBeGreaterThan(6);
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
    await screen.findByText(/This step is for Idea Campaigns/i);

    // No field to disable — a Product campaign has no public threshold.
    expect(screen.queryByLabelText(/pre-orders needed/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /on to your faqs/i })).toBeInTheDocument();
  });

  it('previews an FAQ as it is typed', async () => {
    stubStage5();
    renderAt(at('faqs'));
    await screen.findByRole('heading', { name: /what will people ask/i });

    await userEvent.type(screen.getByLabelText(/the question/i), 'When will I get it?');
    const preview = document.querySelector('.ff-faq__preview') as HTMLElement;
    expect(within(preview).getByText('When will I get it?')).toBeInTheDocument();
  });

  it('converts a typed price to integer cents exactly once', async () => {
    stubStage5();
    renderAt(at('rewards'));
    await screen.findByRole('heading', { name: /backer rewards/i });

    await userEvent.type(screen.getByLabelText(/what is it called/i), 'Founding Edition');
    await userEvent.type(screen.getByLabelText(/^price/i), '120.5');
    await userEvent.type(screen.getByLabelText(/what is included/i), 'One lamp.');
    await userEvent.type(screen.getByLabelText(/when does it arrive/i), 'March 2027');
    await userEvent.type(screen.getByLabelText(/what you commit to/i), 'We email if it moves.');
    await userEvent.click(screen.getByRole('button', { name: /add this reward/i }));

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

    // Ten shared fields are required plus one for Product; these four steps
    // cover three. Telling somebody their campaign is built here is §1.4's
    // failure with a celebration on it.
    expect(screen.getByText(BUILD_STEPS_ARE_NOT_THE_WHOLE_BUILD)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /see what is left on your campaign/i }),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/your campaign is (built|ready|complete)/i);
  });

  it('continues into the flow rather than ending at the campaign build', async () => {
    // The last step's only forward control used to leave the flow for
    // `/campaigns/:id/build`, and nothing in the product navigated into
    // `in-review` — so `in-review`, `live` and `password` were an unreachable
    // island and no Founder ever arrived at the screen that sets a password.
    // The reference's own chain is build → `campreview` → `live`.
    const user = userEvent.setup();
    stubStage5();
    renderAt(at('rewards'));
    await screen.findByRole('heading', { name: /backer rewards/i });

    await user.click(screen.getByRole('button', { name: /see where your campaign stands/i }));
    await screen.findByRole('heading', { name: /where your campaign stands/i });
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

  it('refuses to celebrate a campaign that has not launched (§17)', async () => {
    stubStage5({ campaignStatus: 'approved' });
    renderAt(at('live'));
    await screen.findByRole('heading', { name: /not live yet/i });

    expect(document.body.textContent).not.toMatch(/you.{0,3}re live/i);
    expect(screen.queryByRole('button', { name: /campaign home/i })).not.toBeInTheDocument();
  });

  it('hands over to §20’s campaign home once a launch record exists', async () => {
    stubStage5({ campaignStatus: 'live' });
    renderAt(at('live'));
    await screen.findByRole('heading', { name: /you.{0,3}re live/i });

    expect(screen.getByText(LIVE_MEANS_A_LAUNCH_RECORD)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /go to your campaign home/i }),
    ).toBeInTheDocument();
  });
});
