/**
 * The Support Admin workspace, as a person actually meets it —
 * Spec §26.7, §26.8, §27.8, §1.1, §1.4, §27.1, §30, §33.9.11, §33.11.
 *
 * A *surface* suite, deliberately. The registers, the CHECK constraints, and
 * every refusal are proved in `backend/src/tests/support-workspace.test.ts`;
 * re-asserting them through a rendered DOM would be the same fact checked twice
 * in the weaker place. What is only checkable here is what a person sees, what
 * they can reach with a keyboard, and which controls exist at all.
 *
 * ── Everything is driven by a payload, because the surface decides nothing ──
 * The server resolves every chip, every deadline label, `blockedOnProovd`, and
 * the next-action sentence. So the fixtures are the lever: the unowned state is
 * asserted against a payload with no assignee, the finished state against one
 * that is closed. A test that hardcoded the expected words would be a second
 * answer to "what state is this case in".
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { createMemoryRouter, RouterProvider } from 'react-router';
import {
  CONTACT_IS_RECORDED_NOT_SENT,
  EVIDENCE_IS_A_REFERENCE,
  SUPPORT_BANNED_TERMS,
  SUPPORT_FILTER_DEFINITIONS,
  TRIAGE_NEVER_CHANGES_THE_PROMISE,
} from '@proovd/shared';
import { appRoutes } from '../../../routes.js';
import { installQaServer, type StubRoute } from '../../qa/server.js';
import type { AdminIdentity } from '../api.js';
import type { SupportCaseDetail, SupportQueueView } from './api.js';

/* ── The recording motion runtime ──────────────────────────────────────────── */

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
      The runtime takes the PROMISE, not the callback — `useButtonProgress`
      calls `runtime.buttonProgress(btn, work())` and MotionProvider's own
      header records why.

      Mocking it as `(el, work) => await work()` looks equivalent and is not: it
      calls a promise, throws `work is not a function` into the swallowing
      catch, and RESOLVES IMMEDIATELY — so `withProgress` returns before the
      submit settles, `ConfirmDialog` reads a refusal that has not been assigned
      yet, and closes the panel on a decision the server refused. Every
      server-refusal assertion behind this hook would pass for the wrong reason,
      or fail looking like a missing element.
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

/* ── The stub server ───────────────────────────────────────────────────────── */

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
  sessionEstablishedAt: '2026-08-13T15:00:00.000Z',
  prerequisiteKeys: [],
  environment: {
    stripeMode: 'test',
    stripeApiVersion: '2026-06-30',
    webhooksLastEventAt: '2026-08-13T13:58:00.000Z',
  },
};

function serve(routes: StubRoute[]): void {
  installQaServer([
    ...routes,
    {
      match: /\/api\/account\/me$/,
      body: { account: { role: 'admin', email: 'admin@proovd.example', name: 'An Admin' } },
    },
    { match: /\/api\/admin\/me$/, body: identity },
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

function requestsTo(pattern: RegExp): RecordedRequest[] {
  return requests.filter((request) => pattern.test(request.url));
}

/* ── Fixtures ──────────────────────────────────────────────────────────────── */

const CASE_ID = 'case-1842';
const UNOWNED_ID = 'case-1851';

function queueView(): SupportQueueView {
  return {
    rows: [
      {
        caseId: UNOWNED_ID,
        reference: 'PVD-4K2M9-QR7XZ',
        subject: 'I think I was charged twice',
        chip: { label: 'New', tone: 'new' },
        triage: 'urgent',
        topic: 'unknown_charge',
        topicLabel: 'A charge I do not recognise',
        requesterName: 'm.bell@fastmail.example',
        requesterKind: 'backer',
        requesterKindLabel: 'Backer',
        campaignName: 'Threadwise Beta',
        nextAction:
          'No Admin owns this case yet. Assign an owner before promising the customer a response.',
        assigneeName: null,
        responseDue: { at: '2026-08-13T16:31:00.000Z', overdue: false, label: 'due in 1h' },
        blockedOnProovd: true,
        open: true,
        searchText: 'pvd-4k2m9-qr7xz i think i was charged twice threadwise beta',
        createdAt: '2026-08-13T14:31:00.000Z',
      },
      {
        caseId: CASE_ID,
        reference: 'PVD-7H3NP-2WKQY',
        subject: 'Tracking link is not attributing pre-orders',
        chip: { label: 'Waiting on Proovd', tone: 'wait' },
        triage: 'high',
        topic: 'campaign_question',
        topicLabel: 'A question about a campaign',
        requesterName: '@sarabuilds',
        requesterKind: 'creator',
        requesterKindLabel: 'Creator',
        campaignName: 'Teeb Founding Launch',
        nextAction: 'Proovd must regenerate the tracking link and confirm nothing is re-attributed.',
        assigneeName: 'Maya Park',
        responseDue: { at: '2026-08-13T11:12:00.000Z', overdue: true, label: '2h late' },
        blockedOnProovd: true,
        open: true,
        searchText: 'pvd-7h3np-2wkqy tracking link teeb founding launch sarabuilds',
        createdAt: '2026-08-13T09:12:00.000Z',
      },
      {
        caseId: 'case-1830',
        reference: 'PVD-9XQ4T-MN8VR',
        subject: 'Refund was approved but has not appeared',
        chip: { label: 'Closed', tone: 'closed' },
        triage: 'normal',
        topic: 'refund',
        topicLabel: 'A refund',
        requesterName: 'd.ortiz@hey.example',
        requesterKind: 'backer',
        requesterKindLabel: 'Backer',
        campaignName: 'Threadwise Beta',
        nextAction: null,
        assigneeName: 'Maya Park',
        responseDue: null,
        blockedOnProovd: false,
        open: false,
        searchText: 'pvd-9xq4t-mn8vr refund was approved threadwise beta',
        createdAt: '2026-08-08T14:12:00.000Z',
      },
    ],
    counts: {
      all: 3,
      waiting_on_proovd: 2,
      waiting_on_someone_else: 0,
      unassigned: 1,
      resolved_closed: 1,
    },
    hero: {
      title: '1 case is past the response we promised',
      detail:
        'PVD-7H3NP-2WKQY (2h late). The promise is one business day on every case.',
    },
    overdueCount: 1,
  };
}

function caseDetail(overrides: Partial<SupportCaseDetail> = {}): SupportCaseDetail {
  return {
    header: {
      caseId: CASE_ID,
      reference: 'PVD-7H3NP-2WKQY',
      subject: 'Tracking link is not attributing pre-orders',
      chip: { label: 'Waiting on Proovd', tone: 'wait' },
      triage: 'high',
      triageLabel: 'High',
      topic: 'campaign_question',
      topicLabel: 'A question about a campaign',
      subcategory: 'Link not attributing',
      requesterName: '@sarabuilds',
      requesterKind: 'creator',
      requesterKindLabel: 'Creator',
      requesterEmail: 'sara@sarabuilds.example',
      campaignName: 'Teeb Founding Launch',
      createdAt: '2026-08-13T09:12:00.000Z',
      open: true,
      nextAction: 'Proovd must regenerate the tracking link and confirm nothing is re-attributed.',
      nextUpdateDue: { at: '2026-08-13T18:00:00.000Z', overdue: false, label: 'due in 3h' },
      blockedOnProovd: true,
    },
    internalReason:
      'Link was regenerated on the 11th after the campaign version change; the old link stayed live.',
    thread: [
      {
        id: 'msg-1',
        kind: 'in',
        author: 'Sara Okonjo',
        counterparty: 'Proovd Support',
        body: 'My link stopped counting pre-orders yesterday.',
        templateKey: null,
        delivery: null,
        occurredAt: '2026-08-13T09:12:00.000Z',
      },
      {
        id: 'msg-2',
        kind: 'note',
        author: 'user:maya',
        counterparty: null,
        body: 'Confirmed in the relationship record — card_declined is unrelated, this is attribution.',
        templateKey: null,
        delivery: null,
        occurredAt: '2026-08-13T09:31:00.000Z',
      },
      {
        id: 'msg-3',
        kind: 'out',
        author: 'user:maya',
        counterparty: '@sarabuilds',
        body: 'Hi Sara — the campaign moved to a new version and that regenerated your link.',
        templateKey: 'holding_update',
        delivery: 'Sent — the provider accepted it',
        occurredAt: '2026-08-13T09:48:00.000Z',
      },
    ],
    context: {
      heading: 'Requester context',
      fields: [
        { label: 'Creator', value: '@sarabuilds' },
        { label: 'Campaign', value: 'Teeb Founding Launch' },
        { label: 'Founder', value: 'Ahmed Teeb' },
      ],
      links: [
        {
          label: 'Campaign · Teeb Founding Launch',
          href: null,
          unavailableBecause: 'The Campaigns workspace is not built yet.',
        },
      ],
    },
    ownership: {
      owner: 'proovd_support',
      ownerLabel: 'PROOVD SUPPORT',
      assigneeUserId: 'admin-2',
      assigneeName: 'Maya Park',
      // Somebody else's case, so "Assign to me" is offered.
      assignedToYou: false,
      assignedAt: '2026-08-13T09:20:00.000Z',
      previousAssigneeName: null,
      lastAssignmentReason: null,
      assignments: [],
      handoffs: [],
    },
    nextResponse: {
      status: 'open',
      waitingOn: 'proovd',
      waitingLabel: 'Waiting on Proovd',
      nextAction: 'Proovd must regenerate the tracking link and confirm nothing is re-attributed.',
      nextUpdateDue: { at: '2026-08-13T18:00:00.000Z', overdue: false, label: 'due in 3h' },
      responseDue: { at: '2026-08-13T11:12:00.000Z', overdue: true, label: '2h late' },
      calendarVersion: 'us-federal.v1',
      founderFollowupDue: null,
      lastResponseAt: '2026-08-13T09:48:00.000Z',
      resolution: null,
      resolvedBy: null,
      resolvedAt: null,
      closedAt: null,
      reopens: [],
    },
    evidence: [
      {
        id: 'ev-1',
        kind: 'tracking_information',
        kindLabel: 'Tracking information',
        description: 'Link regeneration log — old link retired on the 11th.',
        linkedKind: 'campaign',
        linkedLabel: 'Campaign',
        linkedReference: 'Teeb Founding Launch v3',
        addedBy: 'user:maya',
        occurredAt: '2026-08-13T09:29:00.000Z',
      },
    ],
    contacts: [
      {
        id: 'ct-1',
        partyKind: 'founder',
        partyLabel: 'Ahmed Teeb',
        message: 'Asked Ahmed to confirm the new link is in the kit.',
        expectedResponseAt: '2026-08-14T16:00:00.000Z',
        outcome: null,
        outcomeRecordedAt: null,
        recordedBy: 'user:maya',
        occurredAt: '2026-08-13T09:35:00.000Z',
      },
    ],
    history: [
      {
        source: 'support_cases',
        section: 'status',
        title: 'Case opened',
        detail: '@sarabuilds (Creator)',
        actor: 'user:sara',
        occurredAt: '2026-08-13T09:12:00.000Z',
      },
      {
        source: 'support_case_assignments',
        section: 'ownership',
        title: 'Owner set to Maya Park',
        detail: null,
        actor: 'user:admin',
        occurredAt: '2026-08-13T09:20:00.000Z',
      },
      {
        source: 'support_case_messages',
        section: 'conversation',
        title: 'Internal note added',
        detail: 'Admin-only. Not shown to the customer.',
        actor: 'user:maya',
        occurredAt: '2026-08-13T09:31:00.000Z',
      },
    ],
    templates: [
      {
        key: 'holding_update',
        label: 'An update at the promised checkpoint',
        specRef: '§27.8',
        useWhen: 'Send an update at the promised checkpoint.',
      },
    ],
    contactableParties: [{ kind: 'founder', label: 'Ahmed Teeb' }],
    assignableAdmins: [
      { userId: 'admin-1', name: 'Sam Okafor' },
      { userId: 'admin-2', name: 'Maya Park' },
    ],
    ...overrides,
  };
}

function supportRoutes(detail: SupportCaseDetail = caseDetail()): StubRoute[] {
  return [
    { match: /\/api\/admin\/support\/workspace$/, body: queueView() },
    { match: /\/api\/admin\/support\/workspace\/[^/]+$/, body: detail },
    {
      match: /\/api\/admin\/support\/cases\/[^/]+\/templates\//,
      body: {
        key: 'holding_update',
        label: 'An update at the promised checkpoint',
        draft: 'Case PVD-7H3NP-2WKQY.\n\nWe said we would come back to you today.',
        preservedFacts: { caseReference: 'PVD-7H3NP-2WKQY', campaign: 'Teeb Founding Launch' },
        note: 'This is a starting point.',
      },
    },
    { match: /\/api\/admin\/support\/cases\/.*/, body: { ok: true } },
  ];
}

async function renderAt(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  const result = render(<RouterProvider router={router} />);
  return result;
}

beforeEach(() => {
  installMotionRuntime();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as { Proovd?: unknown }).Proovd;
});

/* ── 1. The queue ─────────────────────────────────────────────────────────── */

describe('§27.8 — the queue leads with what needs doing', () => {
  it('renders the hero, the five filters with their counts, and every case', async () => {
    serve(supportRoutes());
    await renderAt('/admin/support');

    // The hero is an h1, so a person arriving from a bookmark has the page
    // named — §33.11.2 caught exactly this missing on the Founder home.
    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('1 case is past the response we promised');

    const filters = screen.getByRole('group', { name: 'Filter the queue' });
    for (const definition of SUPPORT_FILTER_DEFINITIONS) {
      const control = within(filters).getByRole('button', {
        name: new RegExp(`^${definition.label} · `),
      });
      // §20: the count ships with the definition of what it counts.
      expect(control).toHaveAttribute('title', definition.counts);
    }

    expect(screen.getByRole('link', { name: 'Tracking link is not attributing pre-orders' }))
      .toHaveAttribute('href', `/admin/support/${CASE_ID}`);
  });

  it('says an unowned case has no owner rather than inventing a next step (§1.4)', async () => {
    serve(supportRoutes());
    await renderAt('/admin/support');
    await screen.findByRole('heading', { level: 1 });

    expect(
      screen.getByText(/No Admin owns this case yet\. Assign an owner before promising/),
    ).toBeInTheDocument();
    // A regex, because the owner line and the response deadline share one
    // element — `getByText` normalises the whole node, so an exact match would
    // be asserting the layout rather than the words.
    expect(screen.getByText(/No owner yet/)).toBeInTheDocument();
  });

  it('carries the filter in the URL so the position survives a reload', async () => {
    const user = userEvent.setup();
    serve(supportRoutes());
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/admin/support'] });
    render(<RouterProvider router={router} />);
    await screen.findByRole('heading', { level: 1 });

    await user.click(screen.getByRole('button', { name: /^Unassigned · / }));
    await waitFor(() => {
      expect(router.state.location.search).toContain('filter=unassigned');
    });

    // Only the unassigned case survives the filter.
    expect(screen.getByRole('link', { name: 'I think I was charged twice' })).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Tracking link is not attributing pre-orders' }),
    ).not.toBeInTheDocument();
  });

  it('says why nothing matched rather than showing an empty page', async () => {
    const user = userEvent.setup();
    serve(supportRoutes());
    await renderAt('/admin/support');
    await screen.findByRole('heading', { level: 1 });

    await user.type(screen.getByRole('searchbox'), 'zzzz-no-such-case');
    expect(
      await screen.findByText(/No case matches this filter and search/),
    ).toBeInTheDocument();
  });

  it('answers §27.1 on a failed read, and offers a way to retry', async () => {
    serve([
      {
        match: /\/api\/admin\/support\/workspace$/,
        status: 503,
        body: {
          error: 'unavailable',
          title: 'The support queue is unavailable',
          whatHappened: 'The read did not complete.',
          next: 'Try again in a moment. Nothing was changed by the attempt.',
        },
      },
    ]);
    await renderAt('/admin/support');

    // The SERVER's answers to §27.1, rendered rather than paraphrased.
    expect(await screen.findByText('The support queue is unavailable')).toBeInTheDocument();
    expect(screen.getByText('The read did not complete.')).toBeInTheDocument();
    expect(
      screen.getByText('Try again in a moment. Nothing was changed by the attempt.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /get help/i })).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    serve(supportRoutes());
    const { container } = await renderAt('/admin/support');
    await screen.findByRole('heading', { level: 1 });
    expect(await axe(container)).toHaveNoViolations();
  });
});

/* ── 2. The case header and the tab rail ──────────────────────────────────── */

describe('§26.8 — the case states where it stands', () => {
  it('renders the subject as the h1 with its reference and next action', async () => {
    serve(supportRoutes());
    await renderAt(`/admin/support/${CASE_ID}`);

    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Tracking link is not attributing pre-orders');
    expect(screen.getByText('PVD-7H3NP-2WKQY')).toBeInTheDocument();
    expect(
      screen.getByText(/Proovd must regenerate the tracking link/),
    ).toBeInTheDocument();
  });

  it('moves between tabs with the arrow keys and carries the tab in the URL', async () => {
    const user = userEvent.setup();
    serve(supportRoutes());
    const router = createMemoryRouter(appRoutes, {
      initialEntries: [`/admin/support/${CASE_ID}`],
    });
    render(<RouterProvider router={router} />);
    await screen.findByRole('heading', { level: 1 });

    const rail = screen.getByRole('tablist', { name: 'Case sections' });
    const conversation = within(rail).getByRole('tab', { name: 'Conversation' });
    expect(conversation).toHaveAttribute('aria-selected', 'true');

    conversation.focus();
    await user.keyboard('{ArrowRight}');
    await waitFor(() => {
      expect(within(rail).getByRole('tab', { name: 'Case & ownership' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });
    expect(router.state.location.search).toContain('tab=case');

    await user.keyboard('{End}');
    await waitFor(() => {
      expect(within(rail).getByRole('tab', { name: 'History' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });
  });

  it('offers no next step on a finished case (§20’s caught-up ending)', async () => {
    serve(
      supportRoutes(
        caseDetail({
          header: {
            ...caseDetail().header,
            open: false,
            chip: { label: 'Closed', tone: 'closed' },
            nextAction: null,
            nextUpdateDue: null,
            blockedOnProovd: false,
          },
          nextResponse: {
            ...caseDetail().nextResponse,
            status: 'resolved',
            waitingOn: null,
            waitingLabel: null,
            nextAction: null,
            resolution: 'The link was regenerated and confirmed active.',
            resolvedBy: 'user:maya',
            resolvedAt: '2026-08-13T12:00:00.000Z',
            closedAt: '2026-08-13T12:05:00.000Z',
          },
        }),
      ),
    );
    await renderAt(`/admin/support/${CASE_ID}?tab=conversation`);
    await screen.findByRole('heading', { level: 1 });

    expect(screen.getByText(/The whole conversation and the resolution stay on the record/))
      .toBeInTheDocument();
    // A closed case offers no reply — reopening is the recorded act.
    expect(screen.queryByRole('button', { name: /^Reply to/ })).not.toBeInTheDocument();
  });
});

/* ── 3. Conversation ──────────────────────────────────────────────────────── */

describe('§33.9.11 — a note is visibly not a message', () => {
  it('marks the internal note in words, not only by treatment', async () => {
    serve(supportRoutes());
    await renderAt(`/admin/support/${CASE_ID}`);
    await screen.findByRole('heading', { level: 1 });

    expect(screen.getByText('Internal · not shown to the customer')).toBeInTheDocument();
    // The note's own body IS on the thread — that is where a provider code
    // belongs (§26.8).
    expect(screen.getByText(/card_declined is unrelated/)).toBeInTheDocument();
  });

  it('renders the context panel §26.8 promises, and names a missing destination', async () => {
    serve(supportRoutes());
    await renderAt(`/admin/support/${CASE_ID}`);
    await screen.findByRole('heading', { level: 1 });

    expect(screen.getByText('Requester context')).toBeInTheDocument();
    expect(screen.getByText('Teeb Founding Launch')).toBeInTheDocument();
    // §1.4: the link is SHOWN and says what is missing rather than being hidden.
    expect(screen.getByText(/The Campaigns workspace is not built yet/)).toBeInTheDocument();
  });

  it('loads a template into the reply and sends what the Admin actually has', async () => {
    const user = userEvent.setup();
    serve(supportRoutes());
    await renderAt(`/admin/support/${CASE_ID}`);
    await screen.findByRole('heading', { level: 1 });

    await user.click(screen.getByRole('button', { name: /^Reply to/ }));
    const dialog = await screen.findByRole('dialog');

    // §26.8: the consequence is stated before the control is pressed.
    expect(within(dialog).getByText(/Once sent it cannot be edited/)).toBeInTheDocument();

    await user.selectOptions(within(dialog).getByRole('combobox'), 'holding_update');

    // The draft arrives filled from the case's own records (§26.8), and stays
    // fully editable — `toHaveValue` takes a literal, not a matcher, so the
    // value is read and checked directly.
    await waitFor(() => {
      const box = within(dialog).getByRole('textbox', {
        name: /Message to the customer/,
      }) as HTMLTextAreaElement;
      expect(box.value).toContain('We said we would come back to you today.');
    });
    // §26.8's "preserve all context": the facts that filled it are shown, so
    // the Admin edits knowingly rather than sending a paragraph unread.
    expect(within(dialog).getByText(/Teeb Founding Launch/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Send reply' }));

    await waitFor(() => {
      const sent = requestsTo(/\/messages$/);
      expect(sent).toHaveLength(1);
      const body = JSON.parse(sent[0]!.body!);
      expect(body.customerFacing).toBe(true);
      expect(body.templateKey).toBe('holding_update');
    });
  });
});

/* ── 4. Case & ownership ──────────────────────────────────────────────────── */

describe('§26.7 — the two kinds of owner stay apart', () => {
  it('renders the assigned Admin and the accountable organisation separately', async () => {
    serve(supportRoutes());
    await renderAt(`/admin/support/${CASE_ID}?tab=case`);
    await screen.findByRole('heading', { level: 1 });

    expect(screen.getByText('Assigned Admin')).toBeInTheDocument();
    expect(screen.getByText('Maya Park')).toBeInTheDocument();
    expect(screen.getByText('Accountable for the response')).toBeInTheDocument();
    expect(screen.getByText('PROOVD SUPPORT')).toBeInTheDocument();
  });

  it('shows §27.8’s promise with the calendar version that produced it', async () => {
    serve(supportRoutes());
    await renderAt(`/admin/support/${CASE_ID}?tab=case`);
    await screen.findByRole('heading', { level: 1 });

    expect(screen.getByText(/one business day, Monday–Friday/)).toBeInTheDocument();
    expect(screen.getByText(/us-federal\.v1/)).toBeInTheDocument();
    expect(screen.getByText('2h late')).toBeInTheDocument();
  });

  it('states that triage never moves the promise, on the control that sets it', async () => {
    const user = userEvent.setup();
    serve(supportRoutes());
    await renderAt(`/admin/support/${CASE_ID}?tab=case`);
    await screen.findByRole('heading', { level: 1 });

    await user.click(screen.getByRole('button', { name: 'Change triage' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(TRIAGE_NEVER_CHANGES_THE_PROMISE)).toBeInTheDocument();
  });

  it('offers the real Admin accounts, never a hardcoded list', async () => {
    const user = userEvent.setup();
    serve(supportRoutes());
    await renderAt(`/admin/support/${CASE_ID}?tab=case`);
    await screen.findByRole('heading', { level: 1 });

    await user.click(screen.getByRole('button', { name: 'Reassign to another Admin' }));
    const dialog = await screen.findByRole('dialog');
    const select = within(dialog).getAllByRole('combobox')[0]!;
    expect(within(select).getByRole('option', { name: 'Sam Okafor' })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'Maya Park' })).toBeInTheDocument();
  });

  it('takes the case in one gesture, naming nobody (§26.7)', async () => {
    const user = userEvent.setup();
    serve(supportRoutes());
    await renderAt(`/admin/support/${CASE_ID}?tab=case`);
    await screen.findByRole('heading', { level: 1 });

    await user.click(screen.getByRole('button', { name: 'Assign to me' }));

    await waitFor(() => expect(requestsTo(/\/assign$/)).toHaveLength(1));
    // The body names no user: the server resolves it from the session, so this
    // control cannot attribute the case to somebody else.
    const body = JSON.parse(requestsTo(/\/assign$/)[0]!.body!);
    expect(body).toEqual({ assignToSelf: true });
    expect(body.toUserId).toBeUndefined();
  });

  it('hides “Assign to me” on a case that is already yours (§1.4)', async () => {
    const mine = caseDetail();
    mine.ownership.assignedToYou = true;
    mine.ownership.assigneeName = 'Sam Okafor';
    serve(supportRoutes(mine));
    await renderAt(`/admin/support/${CASE_ID}?tab=case`);
    await screen.findByRole('heading', { level: 1 });

    // A control whose only effect is already true is not offered.
    expect(screen.queryByRole('button', { name: 'Assign to me' })).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Reassign to another Admin' }),
    ).toBeInTheDocument();
  });

  it('renders the server’s refusal rather than a friendlier one (§1.1)', async () => {
    const user = userEvent.setup();
    serve([
      { match: /\/api\/admin\/support\/workspace$/, body: queueView() },
      { match: /\/api\/admin\/support\/workspace\/[^/]+$/, body: caseDetail() },
      {
        match: /\/api\/admin\/support\/cases\/[^/]+\/resolve$/,
        status: 422,
        body: {
          error: 'raw_provider_code',
          title: 'That case was not resolved',
          whatHappened: 'That resolution contains a raw provider or fraud code.',
          next: 'Nothing has changed. Correct it and try again.',
        },
      },
    ]);
    await renderAt(`/admin/support/${CASE_ID}?tab=case`);
    await screen.findByRole('heading', { level: 1 });

    await user.click(screen.getByRole('button', { name: 'Mark resolved' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(
      within(dialog).getByRole('textbox', { name: /Resolution/ }),
      'Their bank said generic_decline.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Mark resolved' }));

    // The request reached the server, so what follows is about the ANSWER
    // rather than about the form never having submitted.
    await waitFor(() => expect(requestsTo(/\/resolve$/)).toHaveLength(1));

    // Document-scoped, not `within(dialog)`: if the panel had closed, `dialog`
    // would be a detached node and the query would search it forever rather
    // than reporting that the refusal was not rendered.
    expect(await screen.findByRole('alert')).toHaveTextContent(/raw provider or fraud code/);
    // It stays open, because the decision has not been made.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

/* ── 5. Evidence & contact ────────────────────────────────────────────────── */

describe('§26.8, §30 — evidence is a reference and a contact is a record', () => {
  it('says there is no upload, where an Admin would look for one (§1.4)', async () => {
    serve(supportRoutes());
    await renderAt(`/admin/support/${CASE_ID}?tab=evidence`);
    await screen.findByRole('heading', { level: 1 });

    expect(screen.getByText(EVIDENCE_IS_A_REFERENCE)).toBeInTheDocument();
    // The strongest form of "no upload" is no control at all.
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('states that recording a contact sends nothing', async () => {
    const user = userEvent.setup();
    serve(supportRoutes());
    await renderAt(`/admin/support/${CASE_ID}?tab=evidence`);
    await screen.findByRole('heading', { level: 1 });

    await user.click(screen.getAllByRole('button', { name: 'Record a contact' })[0]!);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(CONTACT_IS_RECORDED_NOT_SENT)).toBeInTheDocument();
  });

  it('drops the outcome control once an outcome exists', async () => {
    serve(supportRoutes());
    const first = await renderAt(`/admin/support/${CASE_ID}?tab=evidence`);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByRole('button', { name: 'Record what they said' })).toBeInTheDocument();

    // Unmounted before the second render: `screen` queries the whole document,
    // so leaving the first tree mounted would find the first render's control
    // and report a pass for the wrong reason.
    first.unmount();

    vi.unstubAllGlobals();
    const recorded = caseDetail();
    recorded.contacts[0]!.outcome = 'Confirmed — the new link is in the kit.';
    recorded.contacts[0]!.outcomeRecordedAt = '2026-08-13T10:00:00.000Z';
    serve(supportRoutes(recorded));
    await renderAt(`/admin/support/${CASE_ID}?tab=evidence`);
    await screen.findByRole('heading', { level: 1 });

    // Write-once at the service and by trigger, so a control that could not
    // work is absent rather than disabled (§1.4).
    expect(screen.queryByRole('button', { name: 'Record what they said' })).not.toBeInTheDocument();
    expect(screen.getByText(/Confirmed — the new link is in the kit/)).toBeInTheDocument();
  });
});

/* ── 6. History ──────────────────────────────────────────────────────────── */

describe('§26.8 — the history composes and says where each entry came from', () => {
  it('names the source table on every entry', async () => {
    serve(supportRoutes());
    await renderAt(`/admin/support/${CASE_ID}?tab=history`);
    await screen.findByRole('heading', { level: 1 });

    expect(screen.getByText('support_cases')).toBeInTheDocument();
    expect(screen.getByText('support_case_assignments')).toBeInTheDocument();
    expect(screen.getByText('support_case_messages')).toBeInTheDocument();
  });

  it('offers no control that implies the record can be changed', async () => {
    serve(supportRoutes());
    const { container } = await renderAt(`/admin/support/${CASE_ID}?tab=history`);
    await screen.findByRole('heading', { level: 1 });

    const panel = container.querySelector('.sup-panel')!;
    expect(within(panel as HTMLElement).queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByText(/Nothing here is editable or removable/)).toBeInTheDocument();
  });
});

/* ── 7. §30 and §3 — what the surface refuses to be ──────────────────────── */

/*
  One render per tab, checked twice.

  Two separate loops rendered each tab a second time, which doubled the jsdom
  and axe work this file contributes to a four-worker pool — and that is what
  the project's own note about the frontend project warns produces: a single
  axe pass that takes 40ms alone taking twenty seconds under contention, and an
  UNRELATED suite blowing its 30-second timeout. It did exactly that to
  `qa.test.tsx`'s §28.5 sweep. Rendering once and asserting both loses no
  coverage.
*/
describe('§30 — an operations console, not an engagement surface', () => {
  it.each(['conversation', 'case', 'evidence', 'history'])(
    'the %s tab carries no banned vocabulary and no axe violations',
    async (tab) => {
      vi.unstubAllGlobals();
      serve(supportRoutes());
      const { container, unmount } = await renderAt(`/admin/support/${CASE_ID}?tab=${tab}`);
      await screen.findByRole('heading', { level: 1 });

      const text = (container.textContent ?? '').toLowerCase();
      for (const term of SUPPORT_BANNED_TERMS) {
        expect(text, `${term} in ${tab}`).not.toContain(term.toLowerCase());
      }
      // §3.2's universal replacements bind every audience, Admin included, and
      // §30 forbids claiming refresh-based data is live.
      for (const term of ['escrow', 'custody', 'pledge', 'all-or-nothing', 'real-time']) {
        expect(text, `${term} in ${tab}`).not.toContain(term);
      }

      expect(await axe(container), tab).toHaveNoViolations();
      unmount();
    },
  );
});
