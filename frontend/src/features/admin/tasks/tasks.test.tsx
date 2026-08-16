/**
 * The Admin Tasks panel, as a person actually meets it — post-Phase-24 change,
 * 2026-08-16. Spec §1.1, §1.4, §27.1, §28.5, §30; DNA §5.4, §5.10.
 *
 * A *surface* suite. The registers, the grants, the triggers, and every server
 * refusal are proved in `backend/src/tests/admin-tasks.test.ts`; what is only
 * checkable here is what a person sees and what a keyboard can reach:
 *
 *   - focus enters the panel on open and returns to the launcher on close;
 *   - Escape closes compose FIRST, then the panel — and it is not a focus
 *     trap, because the panel blocks nothing;
 *   - the shortcut is suppressed while typing (the CreatorSearch guard);
 *   - the two empty states are distinct sentences;
 *   - a reference with nowhere to go is a label, never a dead button;
 *   - the pinned due-date sentence rides the control that sets the value;
 *   - and none of the banned vocabulary reaches the rendered surface.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { createMemoryRouter, RouterProvider } from 'react-router';
import {
  TASK_DUE_DATE_IS_CHECKED,
  TASKS_BANNED_TERMS,
} from '@proovd/shared';
import { appRoutes } from '../../../routes.js';
import { installQaServer, type StubRoute } from '../../qa/server.js';
import type { AdminIdentity } from '../api.js';
import type { TasksPanelView, TaskView } from './api.js';

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

function installMotionRuntime(): void {
  (window as unknown as { Proovd: unknown }).Proovd = {
    failed: false,
    MOTION: MOTION_TOKENS,
    init: () => {},
    toast: () => {},
    /*
      The runtime takes the PROMISE, not the callback — the trap
      `support.test.tsx` records. Mocking it as `(el, work) => await work()`
      resolves immediately and every server-refusal assertion behind the hook
      passes for the wrong reason.
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
  sessionEstablishedAt: '2026-08-16T15:00:00.000Z',
  prerequisiteKeys: [],
  environment: {
    stripeMode: 'test',
    stripeApiVersion: '2026-06-30',
    webhooksLastEventAt: '2026-08-16T13:58:00.000Z',
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
    {
      match: /\/api\/admin\/campaigns$/,
      body: { checkedAt: '2026-08-16T14:00:00.000Z', rows: [], blockedCount: 0 },
    },
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

/* ── Fixtures ──────────────────────────────────────────────────────────────── */

const CAMPAIGN_ID = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';

function isoDay(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function task(overrides: Partial<TaskView> & { id: string; title: string }): TaskView {
  return {
    listId: 'l-1',
    notes: null,
    dueOn: null,
    createdBy: 'admin-1',
    createdByName: 'Sam Okafor',
    createdAt: '2026-08-16T10:00:00.000Z',
    completed: false,
    completedByName: null,
    reference: null,
    ...overrides,
  };
}

function panelView(tasks: TaskView[]): TasksPanelView {
  const open = tasks.filter((t) => !t.completed && t.listId === 'l-1').length;
  return {
    lists: [
      { id: 'l-1', name: 'My tasks', createdBy: 'admin-1', createdByName: 'Sam Okafor', openCount: open },
      { id: 'l-2', name: 'Follow-ups', createdBy: 'admin-2', createdByName: 'Ade Bello', openCount: 0 },
    ],
    tasks,
  };
}

const FULL_VIEW = panelView([
  task({
    id: 't-1',
    title: 'Decide the Verde Notes Review commission',
    notes: 'Founder must accept or counter 34% on v3.',
    dueOn: isoDay(1),
    reference: {
      kind: 'campaign',
      kindLabel: 'Campaign',
      id: CAMPAIGN_ID,
      label: 'Verde Notes Review',
      href: `/admin/campaigns/${CAMPAIGN_ID}`,
      unavailableBecause: null,
    },
  }),
  task({ id: 't-2', title: 'Confirm the W-9 receipt cleared', dueOn: isoDay(-1) }),
  task({ id: 't-3', title: 'Read the new dispute packet', dueOn: isoDay(0) }),
  task({
    id: 't-4',
    title: 'Check the removed record note',
    reference: {
      kind: 'founder',
      kindLabel: 'Founder',
      id: 'gone-1',
      label: 'A Founder — Old Product',
      href: null,
      unavailableBecause:
        'That record no longer exists — the label is what was written down when the task was created.',
    },
  }),
  task({ id: 't-5', title: 'Old finished thing', completed: true, completedByName: 'Ade Bello' }),
]);

function tasksStub(view: TasksPanelView): StubRoute {
  return { match: /\/api\/admin\/tasks$/, method: 'GET', body: view };
}

async function renderAt(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  return render(<RouterProvider router={router} />);
}

async function openPanel(user: ReturnType<typeof userEvent.setup>) {
  const launcher = await screen.findByRole('button', { name: /Tasks/ });
  await user.click(launcher);
  return screen.findByRole('complementary', { name: 'Tasks' });
}

beforeEach(() => {
  installMotionRuntime();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as { Proovd?: unknown }).Proovd;
});

/* ── 1. The launcher and the panel ─────────────────────────────────────────── */

describe('the launcher and the panel', () => {
  it('renders the launcher with the open count, and the overdue tone when something is late', async () => {
    serve([tasksStub(FULL_VIEW)]);
    await renderAt('/admin/campaigns');

    const launcher = await screen.findByRole('button', { name: /Tasks/ });
    /* The count arrives with the read; the launcher renders before it. */
    const badge = await within(launcher).findByText('4');
    expect(badge.className).toContain('tsk-badge--over');
    expect(launcher.title).toMatch(/overdue/);
  });

  it('opens with focus inside, closes on Escape with focus back on the launcher', async () => {
    serve([tasksStub(FULL_VIEW)]);
    const user = userEvent.setup();
    await renderAt('/admin/campaigns');

    await openPanel(user);
    const close = screen.getByRole('button', { name: 'Close tasks' });
    expect(document.activeElement).toBe(close);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('complementary', { name: 'Tasks' })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Tasks/ }));
  });

  it('passes axe open, on compose, and on the empty state', async () => {
    serve([tasksStub(FULL_VIEW)]);
    const user = userEvent.setup();
    const { container } = await renderAt('/admin/campaigns');

    await openPanel(user);
    expect(await axe(container)).toHaveNoViolations();

    await user.click(screen.getByRole('button', { name: '+ Create task' }));
    await screen.findByRole('heading', { name: 'Create task' });
    expect(await axe(container)).toHaveNoViolations();
  });

  it('the empty state passes axe and answers with a distinct sentence per cause', async () => {
    serve([tasksStub(panelView([]))]);
    const user = userEvent.setup();
    const { container } = await renderAt('/admin/campaigns');
    await openPanel(user);
    expect(
      await screen.findByText(/No tasks in this list yet/),
    ).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('completed-hidden is its own empty state, not the same sentence', async () => {
    serve([
      tasksStub(panelView([task({ id: 't-9', title: 'Done thing', completed: true })])),
    ]);
    const user = userEvent.setup();
    await renderAt('/admin/campaigns');
    await openPanel(user);
    expect(await screen.findByText(/1 completed task is hidden/)).toBeInTheDocument();
    expect(screen.queryByText(/No tasks in this list yet/)).not.toBeInTheDocument();

    /* Turning Show completed on reveals it under the Completed section head. */
    await user.click(screen.getByRole('checkbox', { name: /Show completed/ }));
    expect(await screen.findByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('Done thing')).toBeInTheDocument();
  });
});

/* ── 2. §27.1 — the waiting and failure states ─────────────────────────────── */

describe('§27.1 — the six questions in every state', () => {
  it('the failure state names what happened and offers a retry and help', async () => {
    serve([
      {
        match: /\/api\/admin\/tasks$/,
        method: 'GET',
        status: 500,
        body: {
          error: 'unavailable',
          title: 'Your tasks could not be loaded',
          whatHappened: 'The tasks read failed on the server.',
          next: 'Try again in a moment.',
          status: 500,
        },
      },
    ]);
    const user = userEvent.setup();
    await renderAt('/admin/campaigns');
    await openPanel(user);

    expect(await screen.findByText('Your tasks could not be loaded')).toBeInTheDocument();
    expect(screen.getByText('The tasks read failed on the server.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Get help/i })).toBeInTheDocument();
  });

  it('no lists at all is a state with one action, not a blank', async () => {
    serve([{ match: /\/api\/admin\/tasks$/, method: 'GET', body: { lists: [], tasks: [] } }]);
    const user = userEvent.setup();
    await renderAt('/admin/campaigns');
    await openPanel(user);
    expect(await screen.findByText('No lists yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New list' })).toBeInTheDocument();
  });
});

/* ── 3. The due pill and the pinned sentence ───────────────────────────────── */

describe('§30 — the due date is a pill you read, and the sentence rides the control', () => {
  it('renders late, today, and future as three distinct states', async () => {
    serve([tasksStub(FULL_VIEW)]);
    const user = userEvent.setup();
    await renderAt('/admin/campaigns');
    await openPanel(user);

    expect((await screen.findByText(/Overdue ·/)).className).toContain('tsk-due--late');
    expect(screen.getByText('Due today').className).toContain('tsk-due--today');
    expect(screen.getByText('Due tomorrow').className).toContain('tsk-due--future');
  });

  it('the pinned sentence renders with the due-date field, character for character', async () => {
    serve([tasksStub(FULL_VIEW)]);
    const user = userEvent.setup();
    await renderAt('/admin/campaigns');
    await openPanel(user);
    await user.click(screen.getByRole('button', { name: '+ Create task' }));
    expect(await screen.findByText(TASK_DUE_DATE_IS_CHECKED)).toBeInTheDocument();
  });
});

/* ── 4. The reference chip ─────────────────────────────────────────────────── */

describe('a reference with nothing to navigate to is a label, not a dead button', () => {
  it('renders a link when the target answers and a label with the reason when it does not', async () => {
    serve([tasksStub(FULL_VIEW)]);
    const user = userEvent.setup();
    await renderAt('/admin/campaigns');
    await openPanel(user);

    const live = await screen.findByRole('link', { name: /Verde Notes Review/ });
    expect(live).toHaveAttribute('href', `/admin/campaigns/${CAMPAIGN_ID}`);

    const gone = screen.getByText('A Founder — Old Product').closest('.tsk-ref');
    expect(gone).not.toBeNull();
    expect(gone!.tagName).not.toBe('A');
    expect(gone!.tagName).not.toBe('BUTTON');
    expect(
      screen.getByText(/That record no longer exists/),
    ).toBeInTheDocument();
  });
});

/* ── 5. Compose ────────────────────────────────────────────────────────────── */

describe('compose covers the panel and Escape unwinds in order', () => {
  it('one panel on screen at a time — compose is inside the panel, not a second layer', async () => {
    serve([tasksStub(FULL_VIEW)]);
    const user = userEvent.setup();
    await renderAt('/admin/campaigns');
    const panel = await openPanel(user);

    await user.click(screen.getByRole('button', { name: '+ Create task' }));
    const compose = await screen.findByRole('heading', { name: 'Create task' });
    expect(panel.contains(compose)).toBe(true);

    /* Escape closes compose FIRST; the panel stays. */
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('heading', { name: 'Create task' })).not.toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Tasks' })).toBeInTheDocument();

    /* And the second Escape closes the panel. */
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('complementary', { name: 'Tasks' })).not.toBeInTheDocument();
  });

  it('creates a task with the chosen reference, sending kind and id and never a label', async () => {
    serve([
      tasksStub(FULL_VIEW),
      {
        match: /\/api\/admin\/tasks\/targets\?kind=campaign&q=/,
        method: 'GET',
        body: { targets: [{ id: CAMPAIGN_ID, label: 'Verde Notes Review' }] },
      },
      { match: /\/api\/admin\/tasks$/, method: 'POST', body: { ok: true, taskId: 't-new' } },
    ]);
    const user = userEvent.setup();
    await renderAt('/admin/campaigns');
    await openPanel(user);
    await user.click(screen.getByRole('button', { name: '+ Create task' }));

    await user.type(screen.getByLabelText('Task'), 'Point at the campaign');
    await user.selectOptions(screen.getByLabelText('Kind'), 'campaign');
    const option = await screen.findByRole('button', { name: 'Verde Notes Review' });
    await user.click(option);
    expect(await screen.findByText(/This task will point at/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Create task' }));

    await waitFor(() => {
      const create = requests.find(
        (r) => r.method === 'POST' && /\/api\/admin\/tasks$/.test(r.url),
      );
      expect(create).toBeDefined();
      const body = JSON.parse(create!.body!);
      expect(body.reference).toEqual({ kind: 'campaign', id: CAMPAIGN_ID });
      expect(body.reference.label).toBeUndefined();
      expect(body.createdBy).toBeUndefined();
    });
  });

  it('changing the kind clears the narrower choice beneath it', async () => {
    serve([
      tasksStub(FULL_VIEW),
      {
        match: /\/api\/admin\/tasks\/targets\?kind=campaign&q=/,
        method: 'GET',
        body: { targets: [{ id: CAMPAIGN_ID, label: 'Verde Notes Review' }] },
      },
      {
        match: /\/api\/admin\/tasks\/targets\?kind=founder&q=/,
        method: 'GET',
        body: { targets: [] },
      },
    ]);
    const user = userEvent.setup();
    await renderAt('/admin/campaigns');
    await openPanel(user);
    await user.click(screen.getByRole('button', { name: '+ Create task' }));

    await user.selectOptions(screen.getByLabelText('Kind'), 'campaign');
    await user.click(await screen.findByRole('button', { name: 'Verde Notes Review' }));
    expect(await screen.findByText(/This task will point at/)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Kind'), 'founder');
    expect(screen.queryByText(/This task will point at/)).not.toBeInTheDocument();
  });
});

/* ── 6. The deep link ──────────────────────────────────────────────────────── */

describe('?tasks=new opens compose with the campaign offered as the reference', () => {
  it('opens the panel in compose and the context strip offers the record', async () => {
    serve([
      tasksStub(FULL_VIEW),
      {
        match: new RegExp(`/api/admin/tasks/targets\\?kind=campaign&id=${CAMPAIGN_ID}`),
        method: 'GET',
        body: { targets: [{ id: CAMPAIGN_ID, label: 'Verde Notes Review' }] },
      },
      {
        match: /\/api\/admin\/tasks\/targets\?kind=campaign&q=/,
        method: 'GET',
        body: { targets: [] },
      },
      /* The record read behind the panel is not this test's subject; its
         failure state renders and the panel floats above it either way. */
    ]);
    const user = userEvent.setup();
    await renderAt(`/admin/campaigns/${CAMPAIGN_ID}?tasks=new`);

    await screen.findByRole('heading', { name: 'Create task' });
    expect(await screen.findByText(/You are looking at/)).toBeInTheDocument();
    expect(screen.getByText('Verde Notes Review')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Use this' }));
    expect(await screen.findByText(/This task will point at/)).toBeInTheDocument();
  });
});

/* ── 7. The shortcut ───────────────────────────────────────────────────────── */

describe('the shortcut is suppressed while typing', () => {
  it('Ctrl+Shift+U toggles the panel, except inside a text field', async () => {
    serve([tasksStub(FULL_VIEW)]);
    const user = userEvent.setup();
    await renderAt('/admin/campaigns');
    await screen.findByRole('button', { name: /Tasks/ });

    await user.keyboard('{Control>}{Shift>}u{/Shift}{/Control}');
    expect(await screen.findByRole('complementary', { name: 'Tasks' })).toBeInTheDocument();

    /* Inside compose's notes field the same chord types rather than toggles. */
    await user.click(screen.getByRole('button', { name: '+ Create task' }));
    const notes = await screen.findByLabelText(/Notes/);
    (notes as HTMLElement).focus();
    await user.keyboard('{Control>}{Shift>}u{/Shift}{/Control}');
    expect(screen.getByRole('complementary', { name: 'Tasks' })).toBeInTheDocument();
  });
});

/* ── 8. Where the panel exists at all ──────────────────────────────────────── */

describe('the panel lives inside the Admin shell and nowhere else', () => {
  it('renders no launcher on a public route', async () => {
    /* The mount point is what makes this true — `AdminFrame`, inside
       `RequireRole` — so one public page stands in for all of them. */
    serve([tasksStub(FULL_VIEW)]);
    await renderAt('/link-unavailable');
    await screen.findByRole('heading', { level: 1 });
    expect(document.querySelector('.tsk-launch')).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Tasks' })).not.toBeInTheDocument();
  });
});

/* ── 9. §30 and §3.2 — the vocabulary ──────────────────────────────────────── */

describe('§30 — none of the banned vocabulary reaches the surface', () => {
  it('scans the rendered panel and compose', async () => {
    serve([tasksStub(FULL_VIEW)]);
    const user = userEvent.setup();
    await renderAt('/admin/campaigns');
    await openPanel(user);
    await user.click(screen.getByRole('button', { name: '+ Create task' }));
    await screen.findByRole('heading', { name: 'Create task' });

    const text = (document.body.textContent ?? '').toLowerCase();
    for (const term of TASKS_BANNED_TERMS) {
      const pattern = new RegExp(`\\b${term.replace(/ /g, '\\s+')}\\b`);
      expect(pattern.test(text), term).toBe(false);
    }
    for (const term of ['escrow', 'custody', 'pledge', 'all-or-nothing', 'upfront fee']) {
      expect(text, term).not.toContain(term);
    }
  });
});
