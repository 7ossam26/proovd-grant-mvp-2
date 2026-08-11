/**
 * The campaign-relationship surfaces, as a person meets them — Spec §14, §16,
 * §17, §18, §22.1, §24.3, §24.7, §26.1, §28.5, §33.11.
 *
 * The composer's honesty is proved in
 * `backend/src/tests/creator-relationship.test.ts`. What is only checkable here
 * is what a person sees and can operate: that the rail is a real tablist, that
 * only the active pane is mounted, that Approve is not offered until the seven
 * §17 checks are marked, and that the four pinned sentences reach the screen.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { createMemoryRouter, RouterProvider } from 'react-router';
import {
  ADMIN_CANNOT_ACCEPT,
  ATTRIBUTION_FOOTNOTE,
  CREATOR_PARKED_MESSAGES,
  FIRST_POST_RELEASES_ZERO,
  FIRST_POST_VERIFICATION_CHECKS,
  FIXED_PAYMENT_FUNDED_IS_NOT_PAID,
} from '@proovd/shared';
import { appRoutes } from '../../../routes.js';
import { installQaServer, type StubRoute } from '../../qa/server.js';
import type { AdminIdentity } from '../api.js';
import type { CreatorRelationshipDetail } from './api.js';

/* ── The recording motion runtime ──────────────────────────────────────────── */

let toasts: string[] = [];

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
  toasts = [];
  (window as unknown as { Proovd: unknown }).Proovd = {
    failed: false,
    MOTION: MOTION_TOKENS,
    init: () => {},
    toast: (message: string) => {
      toasts.push(message);
    },
    buttonProgress: async (_element: HTMLElement, work: () => Promise<unknown>) => {
      try {
        await work();
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
  sessionEstablishedAt: '2026-08-26T15:00:00.000Z',
  prerequisiteKeys: [],
  environment: {
    stripeMode: 'test',
    stripeApiVersion: '2026-06-30',
    webhooksLastEventAt: '2026-08-26T13:58:00.000Z',
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

/* ── The one relationship every test is about ──────────────────────────────── */

const PROSPECT = 'prospect-maya';
const ASSOCIATION = 'assoc-teeb';
const SUBMISSION = 'sub-1';
const BASE = `/admin/creators/${PROSPECT}/relationships/${ASSOCIATION}`;

function detail(
  patch: (draft: CreatorRelationshipDetail) => void = () => {},
): CreatorRelationshipDetail {
  const draft: CreatorRelationshipDetail = {
    associationId: ASSOCIATION,
    prospectId: PROSPECT,
    campaignId: 'camp-teeb',
    creatorName: 'Maya Johnson',
    band: {
      campaignName: 'Teeb Founding Launch',
      campaignType: 'Product Campaign',
      founderName: 'Teeb Labs LLC',
      status: 'Active partnership',
      statusRaw: 'active',
      owner: 'System',
      designation: 'Initial launch roster',
      activatedAt: 'Aug 10, 2026 · 9:00 AM UTC',
      closesAt: 'Aug 18, 2026 · 8:00 PM UTC',
      responseDeadlineAt: null,
    },
    overview: {
      tasks: [],
      link: {
        state: 'active',
        label: 'Affiliate link active',
        url: 'https://app.proovd.test/c/abc123',
        code: 'abc123',
        activatedAt: 'Aug 10, 2026 · 9:00 AM UTC',
        pausedAt: null,
        pausedReason: null,
        testUrl: 'https://app.proovd.test/c/abc123?proovd_link_test=1',
      },
      readiness: {
        complete: 12,
        applicable: 13,
        canBeginWork: false,
        items: [
          {
            key: 'campaign_approved',
            label: 'Campaign approved',
            owner: 'admin',
            complete: true,
            applicable: true,
          },
          {
            key: 'connected_account_capability',
            label: 'Required connected-account and capability status',
            owner: 'creator',
            complete: false,
            applicable: true,
          },
        ],
      },
      kit: {
        revealedAt: 'Aug 1, 2026 · 9:00 AM UTC',
        revokedAt: null,
        revokedReason: null,
        accessCount: 3,
        lastAccessAt: 'Aug 9, 2026 · 4:00 PM UTC',
      },
    },
    agreement: {
      lockState: 'Locked · version 3',
      headlinePercent: '30%',
      headlineRest: 'of the attributed captured pre-tax reward subtotal.',
      bonus: null,
      versions: [
        {
          id: 'v1',
          number: 1,
          proposedBy: 'affiliate',
          totalPercent: 30,
          fixedPaymentCents: null,
          state: 'locked',
          affiliateDecision: 'accepted',
          founderDecision: 'accepted',
          createdAt: 'Aug 1, 2026 · 9:00 AM UTC',
          lockedAt: 'Aug 2, 2026 · 9:00 AM UTC',
        },
      ],
      agreement: {
        basePercent: 30,
        bidIncreasePercent: 0,
        totalPercent: 30,
        fixedPayment: null,
        acceptedAt: 'Aug 2, 2026 · 9:00 AM UTC',
      },
      fixedPayment: {
        available: true,
        rule: 'Optional · Product Campaigns only',
        status: 'Funded',
        amount: 'US$500.00',
        source: 'Accepted proposal version',
        fundedAt: 'Aug 3, 2026 · 9:00 AM UTC',
        deadlineAt: null,
      },
    },
    content: {
      submission: {
        id: SUBMISSION,
        version: 1,
        url: 'https://instagram.com/p/abc',
        status: 'submitted',
        statusLabel: 'Submitted for Admin review',
        submittedAt: 'Aug 11, 2026 · 9:00 AM UTC',
        verifiedAt: null,
        verifiedBy: null,
        correctionDetail: null,
        correctionDueAt: null,
        enforcementReason: null,
        checklist: null,
      },
      history: [
        {
          version: 1,
          url: 'https://instagram.com/p/abc',
          status: 'Submitted for Admin review',
          submittedAt: 'Aug 11, 2026 · 9:00 AM UTC',
        },
      ],
      performance: {
        populated: true,
        waitingOn: null,
        value: {
          clicks: 418,
          attributedReservations: 11,
          capturedAttributed: 8,
          conversion: '2.6%',
          capturedSubtotal: 'US$1,430.00',
          freshness: 'Refreshed on this read',
        },
      },
    },
    money: {
      headline: {
        status: 'estimated',
        label: 'Estimated',
        amount: 'US$0.00',
        owner: 'System owns capture and reconciliation after campaign close',
      },
      earnings: {
        populated: false,
        waitingOn:
          'Nothing has been captured yet, so nothing has been earned. §22.1 finalizes these amounts after the campaign closes.',
        value: null,
      },
      transfer: {
        populated: false,
        waitingOn:
          'The one campaign Transfer is created on or after Day 3, once earnings are approved and the §11 tax gate is satisfied.',
        value: null,
      },
      completion: null,
    },
  };
  patch(draft);
  return draft;
}

function routes(value: CreatorRelationshipDetail = detail()): StubRoute[] {
  return [
    { match: /\/relationships\/[^/]+$/, body: value },
    { match: /\/api\/admin\/creators\/[^/]+$/, body: { header: {}, relationships: [] } },
  ];
}

/* ── Rendering ─────────────────────────────────────────────────────────────── */

type Rendered = RenderResult & { router: ReturnType<typeof createMemoryRouter> };

function mount(path: string): Rendered {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  const view = render(<RouterProvider router={router} />);
  return Object.assign(view, { router });
}

/** Settles on the surface being loaded, not merely mounted. */
async function renderAdmin(path: string): Promise<Rendered> {
  const view = mount(path);
  await waitFor(() => {
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
  });
  await waitFor(() => {
    expect(screen.queryByText(/^Reading /)).toBeNull();
  });
  return view;
}

beforeEach(() => {
  installMotionRuntime();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as { Proovd?: unknown }).Proovd;
});

/* ── The rail ──────────────────────────────────────────────────────────────── */

describe('§26.1, §28.5 — four panes of one object', () => {
  it('is a real tablist, with only the active pane mounted', async () => {
    serve(routes());
    await renderAdmin(BASE);

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent?.replace(/\d+$/, '').trim())).toEqual([
      'Overview',
      'Agreement',
      'Content',
      'Money',
    ]);

    // Roving tabindex: exactly one tab is reachable by Tab, and it is the one
    // that is selected (§28.5).
    expect(tabs.filter((tab) => tab.getAttribute('tabindex') === '0')).toHaveLength(1);
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
    // Only the active pane is mounted, so the Agreement pane's content is not
    // in the document while Overview is showing.
    expect(screen.queryByText(ADMIN_CANNOT_ACCEPT)).toBeNull();
  });

  it('moves between panes with the arrow keys, and carries the pane in the URL', async () => {
    serve(routes());
    const view = await renderAdmin(BASE);

    screen.getByRole('tab', { name: /Overview/ }).focus();
    await userEvent.keyboard('{ArrowDown}');

    await waitFor(() => {
      expect(view.router.state.location.search).toContain('pane=agreement');
    });
    expect(await screen.findByText(ADMIN_CANNOT_ACCEPT)).toBeTruthy();
  });

  it('counts only a real waiting item on the rail', async () => {
    serve(routes());
    const first = await renderAdmin(BASE);
    // A submitted post is a task with a record behind it. A badge on every tab
    // would be the widget grid §20 refuses.
    expect(screen.getByLabelText('1 item waiting')).toBeTruthy();
    first.unmount();

    serve(
      routes(
        detail((draft) => {
          draft.content.submission!.status = 'passed';
        }),
      ),
    );
    const second = await renderAdmin(BASE);
    expect(screen.queryByLabelText('1 item waiting')).toBeNull();
    second.unmount();
  });
});

/* ── Overview ──────────────────────────────────────────────────────────────── */

describe('§16, §18, §31.5 — the Overview', () => {
  it('renders the link, its activation, and the safe test', async () => {
    serve(routes());
    await renderAdmin(BASE);

    expect(screen.getByText('Affiliate link active')).toBeTruthy();
    expect(screen.getByText(/proovd_link_test=1/)).toBeTruthy();
    expect(screen.getByText(ATTRIBUTION_FOOTNOTE)).toBeTruthy();
  });

  it('states §16’s complete-or-not rule beside a checklist that is short', async () => {
    serve(routes());
    await renderAdmin(BASE);

    expect(screen.getByText('12 of 13')).toBeTruthy();
    expect(screen.getByText('Readiness incomplete')).toBeTruthy();
    expect(screen.getByText(/complete or it is not: twelve of thirteen still blocks/)).toBeTruthy();
  });

  it('offers no control for a task somebody else owns', async () => {
    serve(
      routes(
        detail((draft) => {
          draft.overview.tasks = [
            {
              kind: 'waiting',
              owner: 'Founder',
              title: 'Proposal version 2 waiting',
              meta: 'The bilateral decision remains with the Founder and the Affiliate.',
              action: null,
            },
          ];
        }),
      ),
    );
    await renderAdmin(BASE);

    const card = screen.getByText('Proposal version 2 waiting').closest('section')!;
    expect(within(card).queryByRole('button')).toBeNull();
    expect(within(card).getByText('Owner · Founder')).toBeTruthy();
  });

  it('pauses the link through a dialog that says what a pause is not', async () => {
    serve([...routes(), { match: /\/link$/, body: detail() }]);
    await renderAdmin(BASE);

    await userEvent.click(
      screen.getByRole('button', { name: /Affiliate link history & controls/i }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/This is not enforcement/)).toBeTruthy();

    await userEvent.type(
      within(dialog).getByLabelText(/Why the link is being paused/i),
      'Reviewing the post.',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: /Pause the link/i }));

    await waitFor(() => {
      expect(requestsTo(/\/link$/)).toHaveLength(1);
    });
    expect(requestsTo(/\/link$/)[0]!.body).toContain('"action":"pause"');
  });
});

/* ── Agreement ─────────────────────────────────────────────────────────────── */

describe('§14.2, §14.3, §24.7 — the Agreement', () => {
  it('pins the two sentences this pane must never be without', async () => {
    serve(routes());
    await renderAdmin(`${BASE}?pane=agreement`);

    expect(screen.getByText(ADMIN_CANNOT_ACCEPT)).toBeTruthy();
    expect(screen.getByText(FIXED_PAYMENT_FUNDED_IS_NOT_PAID)).toBeTruthy();
  });

  it('states the rule instead of an empty slot on an Idea campaign', async () => {
    serve(
      routes(
        detail((draft) => {
          draft.band.campaignType = 'Idea Campaign';
          draft.agreement.fixedPayment = {
            available: false,
            rule: 'A fixed Creator payment is unavailable on Idea Campaigns',
            status: 'Not available',
            amount: null,
            source: 'Campaign type rule',
            fundedAt: null,
            deadlineAt: null,
          };
        }),
      ),
    );
    await renderAdmin(`${BASE}?pane=agreement`);

    expect(screen.getByText('A fixed Creator payment is unavailable on Idea Campaigns')).toBeTruthy();
    // The chain and the funded-is-not-paid sentence only appear where the fee
    // can exist — on an Idea campaign there is nothing for them to describe.
    expect(screen.queryByText(FIXED_PAYMENT_FUNDED_IS_NOT_PAID)).toBeNull();
  });

  it('offers no accept control anywhere', async () => {
    serve(routes());
    const view = await renderAdmin(`${BASE}?pane=agreement`);
    for (const control of within(view.container).getAllByRole('button')) {
      expect(control.textContent?.toLowerCase()).not.toContain('accept');
    }
  });
});

/* ── Content ───────────────────────────────────────────────────────────────── */

describe('§17, §18 — the Content pane', () => {
  it('shows the public URL as the object, and offers the review', async () => {
    serve(routes());
    await renderAdmin(`${BASE}?pane=content`);

    expect(screen.getByRole('link', { name: /instagram\.com\/p\/abc/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Review submitted post/i })).toBeTruthy();
  });

  it('parks the two elements with no record, and says what is missing', async () => {
    serve(routes());
    await renderAdmin(`${BASE}?pane=content`);

    const deliverables = screen.getByRole('button', { name: /Review deliverable evidence/i });
    expect(deliverables.getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(deliverables);
    expect(toasts).toContain(CREATOR_PARKED_MESSAGES.deliverableEvidence);

    const availability = screen.getByRole('button', { name: /Verify content availability/i });
    await userEvent.click(availability);
    expect(toasts).toContain(CREATOR_PARKED_MESSAGES.availability);
  });

  it('renders an em dash rather than 0% when there are no clicks', async () => {
    serve(
      routes(
        detail((draft) => {
          draft.content.performance.value = {
            clicks: 0,
            attributedReservations: 0,
            capturedAttributed: 0,
            conversion: null,
            capturedSubtotal: 'US$0.00',
            freshness: 'Refreshed on this read',
          };
        }),
      ),
    );
    await renderAdmin(`${BASE}?pane=content`);
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.queryByText('0%')).toBeNull();
  });
});

/* ── Money ─────────────────────────────────────────────────────────────────── */

describe('§22.1, §24.3, §24.4 — the Money pane', () => {
  it('says an estimated hero is not US$0.00 earned', async () => {
    serve(routes());
    await renderAdmin(`${BASE}?pane=money`);

    expect(screen.getAllByText('Estimated').length).toBeGreaterThan(0);
    expect(screen.getByText(/This is not US\$0\.00 earned/)).toBeTruthy();
    expect(screen.getByText(/§22.1 finalizes these amounts/)).toBeTruthy();
  });

  it('states §24.3’s tax rule and §24.4’s identity where the numbers are', async () => {
    serve(
      routes(
        detail((draft) => {
          draft.money.headline = {
            status: 'finalized',
            label: 'Finalized',
            amount: 'US$429.00',
            owner: 'Admin owns the next Transfer decision',
          };
          draft.money.earnings = {
            populated: true,
            waitingOn: null,
            value: {
              validSubtotal: 'US$1,430.00',
              commission: 'US$429.00',
              bonus: 'US$0.00',
              fixedPayment: 'US$500.00',
              taxInBase: 'US$0.00',
              lockedPercent: 30,
              earnedPercent: 30,
              provisionalTotal: 'US$429.00',
              earnedTotal: 'US$429.00',
              unearnedReturned: 'US$0.00',
              state: 'finalized',
              stateHistory: [],
            },
          };
        }),
      ),
    );
    await renderAdmin(`${BASE}?pane=money`);

    expect(screen.getByText(/Sales tax is excluded from every Creator percentage/)).toBeTruthy();
    expect(screen.getByText(/Earned plus returned equals the provisional total/)).toBeTruthy();
    expect(screen.getByText(/never Proovd revenue/)).toBeTruthy();
  });

  it('offers no Transfer control — the one Transfer is the close queue’s', async () => {
    serve(routes());
    const view = await renderAdmin(`${BASE}?pane=money`);
    for (const control of within(view.container).getAllByRole('button')) {
      expect(control.textContent?.toLowerCase()).not.toContain('create');
      expect(control.textContent?.toLowerCase()).not.toContain('transfer');
    }
  });
});

/* ── The §17 review ────────────────────────────────────────────────────────── */

describe('§17, §33.4.7 — the first-post review', () => {
  it('offers all seven checks, and no approval until every one is marked', async () => {
    serve(routes());
    await renderAdmin(`${BASE}/review`);

    const checks = screen.getAllByRole('button', { pressed: false });
    expect(checks.length).toBeGreaterThanOrEqual(FIRST_POST_VERIFICATION_CHECKS.length);

    const approve = screen.getByRole('button', { name: /Approve submitted post/i });
    expect(approve).toBeDisabled();

    for (const check of FIRST_POST_VERIFICATION_CHECKS) {
      await userEvent.click(screen.getByRole('button', { name: check.label }));
    }
    expect(screen.getByRole('button', { name: /Approve submitted post/i })).not.toBeDisabled();
  });

  it('pins the sentence that stops approval reading as a payment', async () => {
    serve(routes());
    await renderAdmin(`${BASE}/review`);
    expect(screen.getByText(FIRST_POST_RELEASES_ZERO)).toBeTruthy();
  });

  it('sends the decision to the submission, with the checklist keyed by check', async () => {
    serve([...routes(), { match: /\/verify$/, body: { verification: { outcome: 'passed' } } }]);
    await renderAdmin(`${BASE}/review`);

    for (const check of FIRST_POST_VERIFICATION_CHECKS) {
      await userEvent.click(screen.getByRole('button', { name: check.label }));
    }
    await userEvent.click(screen.getByRole('button', { name: /Approve submitted post/i }));

    await waitFor(() => {
      expect(requestsTo(/\/verify$/)).toHaveLength(1);
    });
    const sent = requestsTo(/\/verify$/)[0]!;
    expect(sent.url).toContain(`/api/admin/post-submissions/${SUBMISSION}/verify`);
    const body = JSON.parse(sent.body!) as { outcome: string; checklist: Record<string, boolean> };
    expect(body.outcome).toBe('passed');
    for (const check of FIRST_POST_VERIFICATION_CHECKS) {
      expect(body.checklist[check.key]).toBe(true);
    }
  });

  it('answers honestly when there is no post waiting for review', async () => {
    serve(
      routes(
        detail((draft) => {
          draft.content.submission!.status = 'passed';
          draft.content.submission!.statusLabel = 'Post approved';
        }),
      ),
    );
    mount(`${BASE}/review`);
    expect(await screen.findByText('There is no post waiting for review')).toBeTruthy();
    expect(screen.getByText(/Post approved/)).toBeTruthy();
  });

  it('carries the failed checks into step two and warns about the pause', async () => {
    serve(routes());
    await renderAdmin(`${BASE}/review`);

    await userEvent.click(
      screen.getByRole('button', { name: FIRST_POST_VERIFICATION_CHECKS[0]!.label }),
    );
    await userEvent.click(screen.getByRole('button', { name: /Request post edits/i }));

    expect(await screen.findByText('Request post edits')).toBeTruthy();
    expect(screen.getByText(/The Affiliate link pauses when this is sent/)).toBeTruthy();
    // The correction is prefilled from what did not pass — and editable.
    const box = screen.getByLabelText(/Creator-facing correction/i) as HTMLTextAreaElement;
    expect(box.value).toContain(FIRST_POST_VERIFICATION_CHECKS[1]!.label);
    expect(box.value).not.toContain(FIRST_POST_VERIFICATION_CHECKS[0]!.label);
  });
});

/* ── Accessibility ─────────────────────────────────────────────────────────── */

describe('§33.11.1 — every relationship surface is operable', () => {
  it('has no axe violations on any pane, or on the review', async () => {
    for (const path of [
      BASE,
      `${BASE}?pane=agreement`,
      `${BASE}?pane=content`,
      `${BASE}?pane=money`,
      `${BASE}/review`,
    ]) {
      serve(routes());
      const view = await renderAdmin(path);
      const results = await axe(view.container);
      expect(results.violations, `${path}: ${JSON.stringify(results.violations)}`).toHaveLength(0);
      view.unmount();
    }
  }, 60_000);

  it('renders no internal enum value or retired term on any pane', async () => {
    const banned = [
      'pre_build',
      'pre_launch',
      'readiness_blocked',
      'fixed payment',
      'escrow',
      'pledge',
      'all-or-nothing pledge',
    ];
    for (const path of [BASE, `${BASE}?pane=agreement`, `${BASE}?pane=content`, `${BASE}?pane=money`]) {
      serve(routes());
      const view = await renderAdmin(path);
      const text = (view.container.textContent ?? '').toLowerCase();
      for (const word of banned) {
        expect(text, `${word} on ${path}`).not.toContain(word.toLowerCase());
      }
      view.unmount();
    }
  });
});
