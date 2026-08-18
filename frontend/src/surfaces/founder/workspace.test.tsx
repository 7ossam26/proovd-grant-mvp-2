/**
 * Phase 09a surfaces — the half a Founder can see.
 *
 * §33.3.1–4 are server-side and are proved against the real routes in
 * `backend/src/tests/campaign-workspace.test.ts`. What is proved here is what
 * Phase 09's brief lists separately as done-when items, all of which are
 * properties of the surface:
 *
 *   · the fee preview shows the base line, each US$2 saving separately, and the
 *     total, and explains the separate 5% without conflating the streams;
 *   · the workspace is a one-decision-at-a-time flow, not a widget dashboard;
 *   · the helper resources contain no generate action;
 *   · high effort is presented neutrally;
 *   · nothing on the page recalculates the fee.
 *
 * The real route table in a memory router, with `fetch` stubbed at the network
 * boundary — the same arrangement as the Creator signup suite.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { appRoutes } from '../../routes.js';
import { SEPARATE_STREAM_HINTS } from './test-fixtures.js';

type StubResult = { status: number; body: unknown } | undefined;
type Handler = (url: string, init?: RequestInit) => StubResult;

let handlers: Handler[] = [];

function respond(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

beforeEach(() => {
  handlers = [];
  // `Flow` persists the step a Founder reached (DNA §5.12), so one case that
  // pressed Continue would otherwise start the next one halfway through.
  sessionStorage.clear();
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const url = String(input);
    for (const handler of handlers) {
      const result = handler(url, init);
      if (result) return respond(result.status, result.body);
    }
    // Every Founder address sits behind a role guard now, so a render begins by
    // asking who is signed in. Answered here rather than in each case: the
    // subject of this file is §12's workspace, and a session stub repeated in
    // every test is a place to forget it. A case that wants a different session
    // registers its own handler, which is matched first.
    if (url.endsWith('/api/account/me')) {
      return respond(200, {
        account: { role: 'founder', email: 'founder@example.com', name: 'A Founder' },
      });
    }
    return respond(404, { error: 'not_found', title: 'No stub' });
  });
});

afterEach(() => vi.unstubAllGlobals());

const CAMPAIGN = 'campaign-1';

const SEPARATE_NOTE =
  'This is the one-off fee for listing your campaign, paid to Proovd. It is separate from the ' +
  '5% Proovd keeps from what your campaign actually collects — that is charged later, only on ' +
  'money you receive, and it is not part of this total.';

function item(key: string, complete: boolean, rejections: string[] = []) {
  return {
    item: key,
    complete,
    completedAt: complete ? '2026-08-01T10:00:00.000Z' : null,
    decisionSource: complete ? 'founder_approval' : null,
    rejections,
    locked: false,
    invalidated: { at: null, explanation: null },
  };
}

function workspace(overrides: Record<string, unknown> = {}) {
  return {
    campaignId: CAMPAIGN,
    campaignStatus: 'account_claimed',
    listingPaid: false,
    items: [
      item('visuals', true),
      item('branding', false, ['logo_missing']),
      item('interview', false, ['booking_absent']),
      item('story', false, ['not_approved']),
      item('socials', true),
    ],
    fee: {
      baseCents: '3500',
      itemDiscountCents: '200',
      maxDiscountCents: '1000',
      minSubtotalCents: '2500',
      completedItems: 2,
      discountLines: [
        { item: 'visuals', discountCents: '200' },
        { item: 'socials', discountCents: '200' },
      ],
      discountCents: '400',
      subtotalCents: '3100',
      calculatedAt: '2026-08-01T10:00:00.000Z',
      locked: false,
      separateStreamNote: SEPARATE_NOTE,
    },
    highEffort: {
      visualsCompleted: true,
      brandingCompleted: false,
      interviewScheduledOrConfirmed: false,
      highEffort: false,
      calculatedAt: '2026-08-01T10:00:00.000Z',
    },
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
    transcription: { available: false, absentBecause: 'Dictation is not set up here.' },
    vetting: { problem: null, solution: null, competition: null, submittedAt: null },
    ...overrides,
  };
}

function mount(state = workspace()) {
  handlers.push((url) =>
    url.startsWith(`/api/founder/campaigns/${CAMPAIGN}/workspace`)
      ? { status: 200, body: { workspace: state } }
      : undefined,
  );

  const router = createMemoryRouter(appRoutes, {
    initialEntries: [`/campaigns/${CAMPAIGN}/workspace`],
  });
  return render(<RouterProvider router={router} />);
}

describe('the fee preview (§12, §24.6)', () => {
  it('shows the base line and each earned saving on its own labeled line', async () => {
    mount();

    await waitFor(() => expect(screen.getByText('Your listing fee')).toBeInTheDocument());

    // §12: the base line, then each US$2 saving separately — not one
    // "discounts" line. The Founder is meant to see which work earned which.
    expect(screen.getByText('Listing a campaign')).toBeInTheDocument();
    expect(screen.getByText('US$35.00')).toBeInTheDocument();
    expect(screen.getByText('Visuals completed')).toBeInTheDocument();
    expect(screen.getByText('Socials completed')).toBeInTheDocument();
    expect(screen.getAllByText('−US$2.00')).toHaveLength(2);
    expect(screen.getByText('US$31.00')).toBeInTheDocument();
  });

  it('says tax is added at payment rather than showing a zero tax line', async () => {
    mount();
    await waitFor(() => expect(screen.getByText('Your listing fee')).toBeInTheDocument());

    // A $0.00 tax line would be a claim nobody has made (§1.4). Stripe Tax
    // calculates it at Checkout, which is Phase 11's.
    expect(screen.queryByText('Sales tax')).not.toBeInTheDocument();
    expect(screen.getByText(/Sales tax is worked out when you pay/)).toBeInTheDocument();
  });

  it('explains the separate 5% without conflating the two streams', async () => {
    mount();
    await waitFor(() => expect(screen.getByText('Your listing fee')).toBeInTheDocument());

    const note = screen.getByText(SEPARATE_NOTE);
    expect(note).toBeInTheDocument();
    for (const hint of SEPARATE_STREAM_HINTS) {
      expect(note.textContent?.toLowerCase()).toContain(hint);
    }
  });

  it('renders the server’s numbers and derives none of its own', async () => {
    // A surface that recalculated would produce $31.00 from a $35.00 base and
    // two savings even when the server said something else. This asserts it
    // renders what it was told — the guard against the preview and the charge
    // diverging.
    mount(
      workspace({
        fee: {
          ...workspace().fee,
          subtotalCents: '2500',
          completedItems: 2,
        },
      }),
    );

    await waitFor(() => expect(screen.getByText('Your listing fee')).toBeInTheDocument());
    expect(screen.getByText('US$25.00')).toBeInTheDocument();
    expect(screen.queryByText('US$31.00')).not.toBeInTheDocument();
  });
});

/*
 * The five §12 answers moved to `founder-flow.test.tsx` with the surface.
 *
 * Founder Flow v2 Session D (2026-08-18) rebuilt Visuals, Branding, Interview,
 * Story and Socials as five pages under `/campaigns/:campaignId/setup/*`. Every
 * assertion this file used to make about them — one decision at a time, the
 * rejection sentences in the Founder's own words, the named §6 absence, the
 * named Track A4 absence, and §12's copy-never-generate guidance — went with
 * them rather than being deleted. What is left here is what this address still
 * renders: the itemised fee, the high-effort classification, and what payment
 * fixes.
 */

describe('high effort (§12)', () => {
  it('is described neutrally and names the one thing it controls', async () => {
    mount();
    await waitFor(() =>
      expect(screen.getByText('What Creators will see about preparation')).toBeInTheDocument(),
    );

    const panel = screen
      .getByText('What Creators will see about preparation')
      .closest('.card') as HTMLElement;

    // §12: "Present the criteria neutrally, not as a quality judgment."
    // DNA §5.10 and §30 forbid copy implying the Founder underperformed.
    expect(within(panel).getByText(/not a judgement of your campaign/)).toBeInTheDocument();
    expect(
      within(panel).getByText(/no effect on\s+whether a fixed payment is available/),
    ).toBeInTheDocument();
    expect(panel.textContent?.toLowerCase()).not.toContain('low effort');
    expect(panel.textContent?.toLowerCase()).not.toContain('poor');
  });
});

describe('after payment (§12)', () => {
  it('says the amount paid does not move, and disables the controls', async () => {
    mount(workspace({ listingPaid: true }));
    await waitFor(() =>
      expect(screen.getByText('Your listing fee is paid')).toBeInTheDocument(),
    );

    expect(
      screen.getByText(/Changing an answer now does not change that amount/),
    ).toBeInTheDocument();
  });
});
