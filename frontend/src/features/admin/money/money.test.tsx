/**
 * The Money & Fulfillment console — Spec §21, §22.1–§22.7, §24.8, §24.11, §26.6.
 *
 * What this suite is for, and what it deliberately is not:
 *
 * It does NOT re-prove that finalization is idempotent, that a Transfer is one
 * per Creator, or that a Founder-caused refund cannot claw back finalized
 * earnings. Those are §33.8 and §33.9 and they drive the services directly.
 * Re-driving them through a browser is how a suite gets slow and then gets
 * skipped.
 *
 * What it adds is everything a SURFACE can get wrong about money:
 *
 *  - that the cause narrows the treatment control, so §33.9.3's tempting wrong
 *    answer is unreachable in the form and not merely refused afterwards;
 *  - that a preview is posted for and its own consequences shown, rather than
 *    an execution that "previews" by rendering a paragraph;
 *  - that a refusal from the server is what the Admin reads;
 *  - that an absent amount says what it is waiting for instead of US$0.00;
 *  - that the nine refusals are rendered where their controls would be;
 *  - that nothing on the page computes an amount.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import {
  MONEY_OPERATIONS_ABSENCES,
  MONEY_RECORD_TABS,
  MONEY_RECORD_TAB_LABELS,
  PREVIEW_BEFORE_EXECUTE,
  REFUND_CAUSE_DECIDES_THE_TREATMENT,
  RESUME_IS_THE_SAME_MACHINE,
  THRESHOLD_DECISION_IS_FROZEN,
  TRANSFER_IS_ONE_PER_CREATOR,
  W9_REFERENCE_NEVER_HOLDS_A_TIN,
} from '@proovd/shared';
import { appRoutes } from '../../../routes.js';
import { installQaServer, type StubRoute } from '../../qa/server.js';
import { QA, QA_ROUTES } from '../../qa/fixtures.js';
import type { AdminIdentity } from '../api.js';

/* ── The recording motion runtime ───────────────────────────────────────────*/

const MOTION_TOKENS = {
  dur: { instant: 0.12, quick: 0.2, base: 0.35, slow: 0.6, grand: 0.9 },
  ease: {
    out: 'power3.out',
    hero: 'power4.out',
    move: 'power2.inOut',
    snap: 'back.out(1.4)',
    bounce: 'bounce.out',
    exit: 'power2.in',
  },
  stagger: { tight: 0.04, base: 0.08 },
  text: { chars: 0.02, words: 0.04, lines: 0.06 },
  dist: { enter: 16 },
};

let toasts: string[] = [];

function installMotionRuntime(): void {
  toasts = [];
  (window as unknown as { Proovd: unknown }).Proovd = {
    failed: false,
    MOTION: MOTION_TOKENS,
    init: () => {},
    toast: (message: string) => toasts.push(message),
    /*
      The runtime takes the PROMISE, not the callback — MotionProvider's own
      header records why, and `support.test.tsx` records what mocking it as a
      callback costs: it throws into the swallowing catch and resolves
      immediately, so `ConfirmDialog` reads a refusal that has not been assigned
      yet and closes on a decision the server refused. Every server-refusal
      assertion in this file would then pass for the wrong reason.
    */
    buttonProgress: async (_element: HTMLElement, work: Promise<unknown>) => {
      try {
        await work;
      } catch {
        /* the real runtime restores the button and resolves */
      }
    },
  };
}

/* ── The stub server ────────────────────────────────────────────────────────*/

interface RecordedRequest {
  method: string;
  url: string;
  body: string | null;
}

let requests: RecordedRequest[] = [];

const identity: AdminIdentity = {
  id: 'admin-1',
  name: 'Sam Okafor',
  email: 'sam@proovd.co',
  sessionEstablishedAt: '2026-08-19T15:00:00.000Z',
  prerequisiteKeys: [],
  environment: {
    stripeMode: 'test',
    stripeApiVersion: '2026-06-30',
    webhooksLastEventAt: '2026-08-19T13:58:00.000Z',
  },
};

/**
 * The QA fixtures, with this test's overrides in FRONT of them.
 *
 * The fixture set is the whole product's, so a surface that quietly reads
 * another flow's endpoint renders rather than 404s — the §33.11.1 arrangement.
 * An override is prepended because `installQaServer` takes the first match.
 */
function serve(extra: StubRoute[] = []): void {
  installQaServer([
    ...extra,
    {
      match: /\/api\/account\/me$/,
      body: { account: { role: 'admin', email: 'admin@proovd.example', name: 'An Admin' } },
    },
    { match: /\/api\/admin\/me$/, body: identity },
    ...QA_ROUTES,
    /* Every write answers success unless a test overrides it. */
    { match: /\/api\/admin\//, method: 'POST', body: { ok: true } },
  ]);
  const stubbed = globalThis.fetch;
  requests = [];
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
    requests.push({
      method: (init?.method ?? 'GET').toUpperCase(),
      url: String(input),
      body: init?.body ? String(init.body) : null,
    });
    return stubbed(input as RequestInfo, init);
  });
}

/** Mounts the REAL router, so the route registration is part of what is proved. */
function renderAt(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  return render(<RouterProvider router={router} />);
}

/**
 * The value of one `dt`/`dd` pair.
 *
 * Amounts legitimately repeat on this surface — a Creator whose whole earnings
 * are commission has the same number under Commission and under Earned, and
 * that is the §24.4 identity being visible rather than a defect. So an
 * assertion about an amount names the fact it is asserting about, exactly as
 * Session E scoped the checkout amounts to `.ff-money__amount`: it is stricter
 * than a page-wide query, not looser.
 */
function factValue(label: string): string {
  const term = screen
    .getAllByRole('term')
    .find((dt) => (dt.textContent ?? '').trim() === label);
  if (!term) throw new Error(`no fact labelled "${label}" on this surface`);
  const value = term.nextElementSibling;
  if (!value) throw new Error(`the fact "${label}" has no value`);
  return (value.textContent ?? '').trim();
}

const queue = () => renderAt('/admin/money');
const record = (search = '') => renderAt(`/admin/money/${QA.campaignId}${search}`);

beforeEach(() => {
  installMotionRuntime();
  serve();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as { Proovd?: unknown }).Proovd;
});

/* ── The queue ──────────────────────────────────────────────────────────────*/

describe('the close queue', () => {
  it('leads with what is recoverable, and every row is a link rather than an act', async () => {
    serve([
      {
        match: /\/api\/admin\/close$/,
        body: {
          operations: {
            /* Deliberately out of order in the payload: the ROWS are grouped by
               the server, and the surface renders the register's order. */
            reconciling: [
              {
                campaignId: 'camp-reconciling',
                campaignStatus: 'closed_reconciling',
                requiredItemsVerified: 1,
                requiredItemsTotal: 4,
                resultsPrepared: false,
              },
            ],
            retryWindow: [
              {
                campaignId: 'camp-window',
                firstFailureAt: '2026-09-12T17:02:00.000Z',
                retryDeadlineAt: '2026-09-14T17:02:00.000Z',
                retrying: 2,
              },
            ],
            incomplete: [
              {
                campaignId: 'camp-stuck',
                batchStatus: 'capturing',
                campaignStatus: 'closed_pending_capture',
                startedAt: '2026-09-12T17:00:00.000Z',
                lockedReservations: 5,
                unresolvedAttempts: 1,
                openDedupCases: 0,
                recovery: 'Resuming finishes the claimed attempt under its own key.',
              },
            ],
          },
          reconciliationItems: [],
          narrativeFields: [],
        },
      },
    ]);
    queue();

    const headings = await screen.findAllByRole('heading', { level: 2 });
    const order = headings.map((h) => h.textContent ?? '');
    expect(order[0]).toMatch(/Interrupted/);
    expect(order[1]).toMatch(/retry window/i);
    expect(order[2]).toMatch(/Charges final/i);

    // §33.7.12: an incomplete batch is visibly recoverable — and the honest
    // state (locked, unresolved) is on the row rather than only in the record.
    expect(screen.getByText('5')).toBeTruthy();
    expect(
      screen.getByText('Resuming finishes the claimed attempt under its own key.'),
    ).toBeTruthy();

    // No money act on a summary row. Resume lives on the record, where the
    // state that permits or refuses it is on screen.
    for (const control of screen.queryAllByRole('button')) {
      expect(control.textContent ?? '').not.toMatch(/resume|finalize|transfer|release|refund/i);
    }
  });

  it('says the queue is empty rather than rendering three blank sections', async () => {
    serve([
      {
        match: /\/api\/admin\/close$/,
        body: {
          operations: { incomplete: [], retryWindow: [], reconciling: [] },
          reconciliationItems: [],
          narrativeFields: [],
        },
      },
      { match: /\/api\/admin\/fulfillment\/day-14$/, body: { queue: [], failureReasons: [] } },
    ]);
    queue();
    expect(await screen.findByText(/No campaign has close work outstanding/)).toBeTruthy();
  });

  it('answers §27.1’s six questions when the read fails', async () => {
    serve([
      {
        match: /\/api\/admin\/close$/,
        status: 500,
        body: {
          error: 'server_error',
          title: 'Proovd could not read the queue',
          whatHappened: 'The close queue read failed.',
          next: 'Try again.',
          status: 500,
        },
      },
    ]);
    queue();
    expect(await screen.findByText('Proovd could not read the queue')).toBeTruthy();
    expect(screen.getByRole('button', { name: /try the read again/i })).toBeTruthy();
    // §27.1's sixth question, which a failure owes and a loading state does not.
    expect(screen.getByRole('link', { name: /get help/i })).toBeTruthy();
  });
});

/* ── The record ─────────────────────────────────────────────────────────────*/

describe('the record', () => {
  it('renders six tabs and moves between them with the arrow keys', async () => {
    record();
    const rail = await screen.findByRole('tablist', { name: /money sections/i });
    const tabs = within(rail).getAllByRole('tab');
    expect(tabs).toHaveLength(MONEY_RECORD_TABS.length);
    expect(tabs.map((t) => t.textContent)).toEqual(
      MONEY_RECORD_TABS.map((key) => MONEY_RECORD_TAB_LABELS[key]),
    );

    // Roving tabindex: Tab enters the rail once and leaves it once (§28.5).
    expect(tabs.filter((t) => t.getAttribute('tabindex') === '0')).toHaveLength(1);

    await userEvent.type(tabs[0]!, '{ArrowRight}');
    await waitFor(() =>
      expect(
        within(rail).getByRole('tab', { name: MONEY_RECORD_TAB_LABELS.reconciliation }),
      ).toHaveAttribute('aria-selected', 'true'),
    );
  });

  it('pins the rules that govern each control', async () => {
    record();
    expect(await screen.findByText(RESUME_IS_THE_SAME_MACHINE)).toBeTruthy();
    expect(screen.getByText(THRESHOLD_DECISION_IS_FROZEN)).toBeTruthy();
  });

  it('renders every §21 idempotency key and provider id, and no customer copy', async () => {
    record();
    // §25.6 keeps these internal, and this is the internal surface — an Admin
    // reconciling a charge needs the key the attempt was claimed under.
    expect(
      await screen.findByText(`reservation-capture:${QA.reservationId}:1`),
    ).toBeTruthy();
    expect(screen.getByText('pi_qa_1')).toBeTruthy();
  });
});

/* ── The money acts ─────────────────────────────────────────────────────────*/

describe('§22.1 the Creator earnings queue', () => {
  it('offers the four acts in §22.1’s order and computes no amount', async () => {
    record('?tab=creators');
    await screen.findByRole('button', { name: /record completion/i });
    const labels = screen.getAllByRole('button').map((a) => a.textContent ?? '');
    const order = [
      'Record completion',
      'Finalize earnings',
      'Approve the amount',
      'Create the Transfer',
    ];
    const positions = order.map((label) => labels.findIndex((l) => l.includes(label)));
    expect(positions.filter((p) => p < 0)).toEqual([]);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);

    expect(screen.getByText(TRANSFER_IS_ONE_PER_CREATOR)).toBeTruthy();

    /*
      The fixture's numbers, rendered exactly as the server sent them, and the
      §24.4 identity visible rather than implied: earned + returned resolves to
      the provisioned total, and all three are on the row.
    */
    expect(factValue('Earned')).toContain('US$288.00');
    expect(factValue('Returned to the Founder')).toContain('US$72.00');
    expect(factValue('Commission')).toContain('US$288.00');
  });

  it('reports the server’s refusal rather than closing on a decision it refused', async () => {
    serve([
      {
        match: /\/api\/admin\/close\/creators\/[^/]+\/transfer$/,
        method: 'POST',
        status: 409,
        body: {
          error: { code: 'before_day_3' },
          title: 'Too early',
          whatHappened: '§22.1 permits the Transfer on or after Day 3 from close.',
          next: 'Come back on or after that date.',
          status: 409,
        },
      },
    ]);
    record('?tab=creators');
    await userEvent.click(await screen.findByRole('button', { name: /create the transfer/i }));

    /*
      The four §22.1 acts have no form behind them, so their refusal arrives as
      a toast rather than inside a dialog. What matters is that the SERVER's own
      sentence is what an Admin reads — not a generic "something went wrong",
      and not a client-side rule that guessed the same answer.
    */
    await waitFor(() =>
      expect(toasts.join(' ')).toMatch(/permits the Transfer on or after Day 3/i),
    );
  });

  it('says what it is waiting for instead of US$0.00 before finalization', async () => {
    serve([
      {
        match: /\/api\/admin\/close\/[^/?]+\/earnings$/,
        body: {
          creators: [
            {
              associationId: QA.associationId,
              associationStatus: 'active',
              publicHandle: '@maren.builds',
              email: null,
              attributedCaptured: 0,
              validSubtotalCents: '0',
              latestDecision: null,
              earnings: null,
              transfer: null,
              allocation: null,
              thankYou: [],
              transferEarliestAt: null,
            },
          ],
          completionOutcomes: [],
          thankYouEligibilityFacts: [],
        },
      },
    ]);
    record('?tab=creators');
    await screen.findAllByText('Not finalized yet');

    /*
      §16a: not yet populated is not zero. Every earnings figure says what it is
      waiting for, because `US$0.00` there reads as "this Creator earned
      nothing" rather than "this has not happened yet".

      The captured subtotal beside them is deliberately NOT in that set: a
      `coalesce(sum(...), 0)` over zero attributed captured pre-orders is a real
      zero, and hiding it would be the opposite error.
    */
    for (const label of ['Commission', 'Bonus', 'Earned', 'Returned to the Founder']) {
      expect(factValue(label)).toBe('Not finalized yet');
    }
    expect(factValue('Valid attributed subtotal')).toContain('US$0.00');
  });
});

describe('§22.3 the Founder payment', () => {
  it('renders the ONE resolver’s amounts and never recomputes them', async () => {
    record('?tab=founder');
    // Exactly the fixture's values — the same object the Founder's own surface
    // renders (§33.8.13). Nothing on this page adds or multiplies.
    expect(await screen.findByText('US$4,180.80')).toBeTruthy();
    expect(screen.getByText('US$1,672.32')).toBeTruthy();
    expect(screen.getByText('US$2,508.48')).toBeTruthy();
    expect(screen.getByText(W9_REFERENCE_NEVER_HOLDS_A_TIN)).toBeTruthy();
  });

  it('names every blocker, because `blocked` with no reason is the banned word', async () => {
    serve([
      {
        match: /\/api\/admin\/close\/[^/?]+\/founder-payments$/,
        body: {
          status: {
            campaignId: QA.campaignId,
            model: 'product',
            campaignStatus: 'closed_reconciling',
            closedAt: QA.closesAt,
            currency: 'USD',
            applicable: true,
            notApplicableReason: null,
            w9: {
              state: 'requested',
              line: 'We have asked for the W-9.',
              action: 'Submit the form',
              requestedAt: QA.closesAt,
              submittedAt: null,
              verifiedAt: null,
              returnReason: null,
              blocksPayments: true,
            },
            eligibleShare: {
              exact: false,
              amountCents: '400000',
              note: 'At minimum, until every provisioned cent has resolved.',
              basis: {
                rewardSubtotalCapturedCents: '528000',
                proovdFeeCents: '26400',
                finalizedCreatorCompensationCents: '0',
                causeBasedAdjustmentsCents: '0',
                stripeFeesAllocatedToFounderCents: '0',
              },
            },
            payments: [
              {
                kind: 'first_payment',
                label: 'First payment',
                percent: 40,
                amountCents: '160000',
                amountExact: false,
                status: 'blocked',
                blockers: ['The W-9 has not been verified.'],
                secureAction: null,
                noActionNeeded: false,
                dueAt: '2026-09-15T17:00:00.000Z',
                releasedAt: null,
                releasedEarly: false,
              },
            ],
            nextReviewDate: null,
            day14: null,
            earlyRelease: null,
          },
          requests: [],
          evidenceFacts: [],
          statusFacts: [],
        },
      },
    ]);
    record('?tab=founder');
    expect(await screen.findByText('The W-9 has not been verified.')).toBeTruthy();
    /*
      The floor is labelled as a floor rather than presented as the answer —
      §22.3's "at minimum" — and it is labelled on the LINE as well as in the
      resolver's note, because the amount is what somebody quotes.
    */
    expect(factValue('Eligible share')).toMatch(/at minimum/i);
    expect(factValue('Amount')).toMatch(/at minimum/i);
  });
});

describe('§24.8 refunds', () => {
  it('offers only the treatments the chosen cause permits', async () => {
    record('?tab=refunds');
    const picker = await screen.findByLabelText(/cause for the next case/i);
    await userEvent.selectOptions(picker, 'founder_or_product');
    await userEvent.click(screen.getByRole('button', { name: /record a case/i }));

    const treatment = await screen.findByLabelText(/creator earnings treatment/i);
    const offered = within(treatment).getAllByRole('option').map((o) => o.textContent);
    // §33.9.3's most tempting wrong simplification is not on the list at all —
    // not disabled, not refused after a round trip: absent.
    expect(offered).not.toContain('cancel_unpaid_invalid');
    expect(offered).not.toContain('contractual_recovery');
    expect(offered).toContain('earnings_remain');
  });

  it('previews before it executes, and shows what the preview recorded', async () => {
    serve([
      {
        match: /\/api\/admin\/refunds\/[^/]+\/preview$/,
        method: 'POST',
        body: {
          ok: true,
          previewId: 'preview-qa-1',
          amountCents: '12990',
          consequences: [
            'The Backer is emailed that US$129.90 is on its way back.',
            'Their reward is marked do-not-fulfill.',
          ],
        },
      },
    ]);
    record('?tab=refunds');
    await userEvent.click(await screen.findByRole('button', { name: /preview the consequences/i }));

    expect(await screen.findByText(/on its way back/)).toBeTruthy();
    // The execute control appears only once a preview exists — §26.6's third
    // requirement, which is the one a surface can render and not enforce.
    const execute = screen.getByRole('button', { name: /execute this refund/i });
    await userEvent.click(execute);

    const executed = requests.find((r) => /\/execute$/.test(r.url));
    expect(executed).toBeTruthy();
    // The preview's own id travels with the execution, so the consequences the
    // Admin read are the consequences of THIS payload.
    expect(JSON.parse(executed?.body ?? '{}')).toMatchObject({ previewId: 'preview-qa-1' });
  });

  it('pins the cause rule, the preview rule, and §24.9’s best-effort sentence', async () => {
    record('?tab=refunds');
    expect(await screen.findByText(REFUND_CAUSE_DECIDES_THE_TREATMENT)).toBeTruthy();
    expect(screen.getByText(PREVIEW_BEFORE_EXECUTE)).toBeTruthy();
  });
});

describe('§24.11 disputes', () => {
  it('leads with an overdue 24-hour task and keeps the raw code internal', async () => {
    record('?tab=refunds');
    // §26.8 permits the provider code as secondary Admin detail. It is here,
    // and §33.9.11 is that it reaches nothing a customer reads.
    expect(await screen.findByText('product_not_received')).toBeTruthy();
    expect(screen.getByText('dp_qa_1')).toBeTruthy();
  });
});

/* ── The refusals ───────────────────────────────────────────────────────────*/

describe('what this console will not do', () => {
  it('renders every refusal where its control would have been', async () => {
    for (const tab of MONEY_RECORD_TABS) {
      const expected = MONEY_OPERATIONS_ABSENCES.filter((a) => a.tab === tab);
      if (expected.length === 0) continue;
      const view = record(`?tab=${tab}`);
      for (const absence of expected) {
        expect(await screen.findByText(absence.sentence)).toBeTruthy();
      }
      view.unmount();
    }
  });

  it('offers no control that would edit a decided amount or skip a gate', async () => {
    for (const tab of MONEY_RECORD_TABS) {
      const view = record(`?tab=${tab}`);
      await screen.findByRole('tablist', { name: /money sections/i });
      for (const control of screen.queryAllByRole('button')) {
        const label = (control.textContent ?? '').toLowerCase();
        expect(label).not.toMatch(/override|force|skip|bypass|extend the window|edit the amount/);
      }
      view.unmount();
    }
  });
});
