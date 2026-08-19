/**
 * The §34 live-mode gate, as a person actually meets it — Spec §34, §2.1,
 * §1.1, §1.4, §26.6, Appendix C.
 *
 * A *surface* suite. The gate's fail-closed behaviour, the pilot's guarantees,
 * the frozen refusals and Appendix C's `undocumented_knowledge_required` rule
 * are all proved in `backend/src/tests/live-mode.test.ts` (36 tests); asserting
 * them again through a rendered DOM would be the same fact checked twice in the
 * weaker place.
 *
 * What is only checkable here is the thing Phase 24 was most careful about:
 * **which controls exist at all.** "There must be no override on it and nowhere
 * to add one" is a claim about a rendered page, and this is the only place it
 * can be made.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import {
  APPENDIX_C_STATEMENTS,
  APPENDIX_C_STEP_KEYS,
  LIVE_MODE_BLOCKED_MESSAGE,
  LIVE_MODE_CONDITIONS,
  PILOT_PREFLIGHT_CHECKS,
  ROLLBACK_PLAN_FIELDS,
} from '@proovd/shared';
import { appRoutes } from '../../../routes.js';
import { installQaServer, type StubRoute } from '../../qa/server.js';
import type { AdminIdentity } from '../api.js';
import type { LiveModeView } from './api.js';

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

let requests: Array<{ method: string; url: string; body: string | null }> = [];

function serve(routes: StubRoute[]): void {
  installQaServer([
    ...routes,
    {
      match: /\/api\/account\/me$/,
      body: { account: { role: 'admin', email: 'admin@proovd.example', name: 'An Admin' } },
    },
    { match: /\/api\/admin\/me$/, body: identity },
    { match: /\/api\/admin\/tasks$/, body: { lists: [], tasks: [] } },
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

/** The state this product is actually in: shut, ten of eleven outstanding. */
function shutGate(overrides: Partial<LiveModeView> = {}): LiveModeView {
  return {
    gate: {
      open: false,
      blockingKeys: LIVE_MODE_CONDITIONS.filter((c) => c.key !== 'key_separation').map(
        (c) => c.key,
      ),
      conditions: LIVE_MODE_CONDITIONS.map((c) => ({
        key: c.key,
        verification: c.verification,
        satisfied: c.key === 'key_separation',
        detail:
          c.key === 'key_separation'
            ? 'The environment separates test from live.'
            : 'No answer has been filed for this condition.',
        filedAnswer: null,
      })),
    },
    pilot: null,
    appendixC: { passed: [], failed: [], unwalked: [...APPENDIX_C_STEP_KEYS] },
    stripeMode: 'test',
    approvalCopyState: 'conditional_copy_is_correct',
    ...overrides,
  };
}

function openGate(overrides: Partial<LiveModeView> = {}): LiveModeView {
  return shutGate({
    gate: {
      open: true,
      blockingKeys: [],
      conditions: LIVE_MODE_CONDITIONS.map((c) => ({
        key: c.key,
        verification: c.verification,
        satisfied: true,
        detail: 'This condition holds.',
        filedAnswer: null,
      })),
    },
    ...overrides,
  });
}

function mount(view: LiveModeView) {
  serve([{ match: /\/api\/admin\/live-mode$/, body: view }]);
  const router = createMemoryRouter(appRoutes, { initialEntries: ['/admin/live-mode'] });
  return render(<RouterProvider router={router} />);
}

beforeEach(() => {
  sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe('the gate, while it is shut', () => {
  it('renders no control that could open it', async () => {
    mount(shutGate());
    await screen.findByRole('heading', { name: 'Live mode' });

    // §34 is released by satisfying it. Phase 24: "There must be no override on
    // it and nowhere to add one." The enable form is ABSENT rather than
    // disabled — a disabled control is one somebody looks for a way around.
    expect(screen.queryByRole('button', { name: /enable live mode/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^campaign$/i)).not.toBeInTheDocument();

    for (const control of screen.getAllByRole('button')) {
      const label = (control.textContent ?? '').toLowerCase();
      expect(label).not.toMatch(/override|proceed anyway|force|skip|open the gate|enable live/);
    }
  });

  it('says what is in the way, and carries the frozen refusal verbatim', async () => {
    mount(shutGate());
    await screen.findByRole('heading', { name: 'Live mode' });

    // The same sentence a refused live operation carries. A softer paraphrase
    // here would be the first place somebody learned the gate was negotiable.
    expect(screen.getByText(LIVE_MODE_BLOCKED_MESSAGE)).toBeInTheDocument();
    expect(screen.getByText(/10 of 11 conditions do not hold yet/i)).toBeInTheDocument();
  });

  it('renders every one of §34’s eleven, from the register', async () => {
    mount(shutGate());
    await screen.findByRole('heading', { name: 'Live mode' });

    for (const condition of LIVE_MODE_CONDITIONS) {
      expect(screen.getByText(condition.requirement), condition.key).toBeInTheDocument();
    }
    expect(LIVE_MODE_CONDITIONS).toHaveLength(11);
  });

  it('offers no way to file an answer for a condition decided on every read', async () => {
    mount(shutGate());
    await screen.findByRole('heading', { name: 'Live mode' });

    // §1.4: an `automatic` condition has no row shape, so an attestation cannot
    // outlive the fact it describes. There is nothing to file, and the row says
    // so rather than offering a control that would record a stale signature.
    const automatic = LIVE_MODE_CONDITIONS.filter((c) => c.verification === 'automatic');
    expect(automatic.length).toBeGreaterThan(0);
    for (const condition of automatic) {
      const row = screen.getByText(condition.requirement).closest('li') as HTMLElement;
      expect(within(row).queryByRole('button', { name: /file an answer/i })).not.toBeInTheDocument();
      expect(within(row).getByText(/decided on every read/i)).toBeInTheDocument();
    }
  });

  it('says which kind of evidence each condition rests on, and why it cannot be automated', async () => {
    mount(shutGate());
    await screen.findByRole('heading', { name: 'Live mode' });

    const recorded = LIVE_MODE_CONDITIONS.find((c) => c.verification === 'recorded')!;
    const row = screen.getByText(recorded.requirement).closest('li') as HTMLElement;
    expect(within(row).getByText('A recorded judgement')).toBeInTheDocument();
    // Writing down why the process cannot answer it is what makes a later
    // session adding a heuristic a visible edit rather than a quiet one.
    expect(within(row).getByText(recorded.cannotBeAutomatedBecause!)).toBeInTheDocument();
  });

  it('states §2.1 in the direction that is currently true', async () => {
    const view = mount(shutGate());
    await screen.findByRole('heading', { name: 'Live mode' });
    expect(screen.getByText(/conditional wording on the public site is correct/i)).toBeInTheDocument();
    view.unmount();
  });

  it('states §2.1 the other way once approval exists', async () => {
    // Both directions, because §2.1 runs both ways: Phase 05 shipped hedged
    // architecture wording, and hedged copy must not survive the hedge becoming
    // false. The state is derived from condition 1 rather than stored.
    mount(shutGate({ approvalCopyState: 'conditional_copy_is_now_stale' }));
    await screen.findByRole('heading', { name: 'Live mode' });
    expect(screen.getByText(/conditional wording is now stale/i)).toBeInTheDocument();
  });
});

describe('the gate, once it is open', () => {
  it('offers the enable form, with both owners and all five rollback fields', async () => {
    mount(openGate());
    await screen.findByRole('heading', { name: 'Live mode' });

    expect(
      screen.getByRole('button', { name: /enable live mode for this campaign/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('Rollback owner')).toBeInTheDocument();
    expect(screen.getByText('Monitoring owner')).toBeInTheDocument();

    // §34: written before cutover, not after a problem — which is why the
    // enablement cannot exist without all five.
    for (const field of ROLLBACK_PLAN_FIELDS) {
      expect(screen.getByLabelText(field.label), field.key).toBeInTheDocument();
    }
  });

  it('renders the pilot, its preflight, and the rollback once one is enabled', async () => {
    mount(
      openGate({
        pilot: {
          enablementId: 'en-1',
          campaignId: 'camp-1',
          enabledBy: 'user:admin-1',
          enabledAt: '2026-08-19T12:00:00.000Z',
          owners: [
            { role: 'monitoring', name: 'Ada Admin', contact: 'ada@proovd.co', acknowledgedBy: 'Sam' },
            { role: 'rollback', name: 'Sam Okafor', contact: 'sam@proovd.co', acknowledgedBy: 'Ada' },
          ],
          preflightConfirmed: [],
          preflightComplete: false,
        },
      }),
    );
    await screen.findByRole('heading', { name: 'Live mode' });

    expect(screen.getByText('camp-1')).toBeInTheDocument();
    for (const check of PILOT_PREFLIGHT_CHECKS) {
      expect(screen.getByText(check.requirement), check.key).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: /roll back live mode/i })).toBeInTheDocument();
    // The enable form is gone: one live enablement in the whole system.
    expect(
      screen.queryByRole('button', { name: /enable live mode for this campaign/i }),
    ).not.toBeInTheDocument();
  });

  it('refuses a rollback with no reason recorded', async () => {
    mount(
      openGate({
        pilot: {
          enablementId: 'en-1',
          campaignId: 'camp-1',
          enabledBy: 'user:admin-1',
          enabledAt: '2026-08-19T12:00:00.000Z',
          owners: [],
          preflightConfirmed: [],
          preflightComplete: false,
        },
      }),
    );
    await screen.findByRole('heading', { name: 'Live mode' });

    // Why live money stopped is not a fact to erase, so it is not optional
    // either. The control waits for it rather than sending an empty reason.
    expect(screen.getByRole('button', { name: /roll back live mode/i })).toBeDisabled();
  });
});

describe('Appendix C', () => {
  it('walks every step, and cannot record a pass that needed undocumented knowledge', async () => {
    mount(shutGate());
    await screen.findByRole('heading', { name: 'Live mode' });

    const total = APPENDIX_C_STATEMENTS.reduce((n, s) => n + s.steps.length, 0);
    expect(APPENDIX_C_STEP_KEYS).toHaveLength(total);

    const first = APPENDIX_C_STATEMENTS[0]!.steps[0]!;
    const row = screen.getByText(first.clause).closest('li') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: /record a walk/i }));

    await userEvent.type(within(row).getByLabelText(/what happened/i), 'It opened and worked.');
    expect(within(row).getByRole('button', { name: /it worked/i })).toBeEnabled();

    // Appendix C's condition is "without undocumented operator knowledge", so a
    // walk that only succeeded because the walker knew a trick is a FAILED
    // walk. Filling this in takes the pass away rather than annotating it.
    await userEvent.type(
      within(row).getByLabelText(/not written down/i),
      'You have to know the campaign id is in the URL of the other tab.',
    );
    expect(within(row).getByRole('button', { name: /it worked/i })).toBeDisabled();
    expect(within(row).getByRole('button', { name: /it did not/i })).toBeEnabled();
  });

  it('keeps “not walked” apart from “failed”', async () => {
    mount(shutGate());
    await screen.findByRole('heading', { name: 'Live mode' });

    // §16a's rule on a verification list: "nobody has tried this" and "somebody
    // tried and it did not work" are different facts.
    expect(screen.getAllByText('Not walked').length).toBe(APPENDIX_C_STEP_KEYS.length);
    expect(screen.queryAllByText('Failed')).toHaveLength(0);
  });
});

describe('the reads and writes it makes', () => {
  it('reads once and writes nothing on load', async () => {
    mount(shutGate());
    await screen.findByRole('heading', { name: 'Live mode' });

    const mine = requests.filter((r) => r.url.includes('/api/admin/live-mode'));
    expect(mine).toHaveLength(1);
    expect(mine[0]!.method).toBe('GET');
  });
});
