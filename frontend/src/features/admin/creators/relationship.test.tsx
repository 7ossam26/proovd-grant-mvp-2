/**
 * The campaign-scoped tabs of the Affiliate record, as a person meets them —
 * Spec §14, §16, §17, §18, §22.1, §24.3, §24.7, §24.8, §26.1, §28.5, §29,
 * §33.11. Rewritten for Session C of the 2026-08-17 rebuild: the old
 * relationship page and its four panes were absorbed into the record's
 * Campaigns / Content & Compliance / Performance & Earnings tabs, addressed by
 * `?tab=`, `?section=`, and `?rel=` — so every test here renders the RECORD
 * and selects the relationship the way an Admin does.
 *
 * The composer's honesty is proved in
 * `backend/src/tests/creator-relationship.test.ts`. What is only checkable
 * here is what a person sees and can operate: that the switcher scopes the
 * tabs, that Approve is not offered until the seven §17 checks are marked,
 * that the pinned sentences reach the screen — and that every control the
 * reference draws and the Spec forbids renders its refusal sentence instead
 * (`AFFILIATE_OPERATIONS_ABSENCES`).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { createMemoryRouter, RouterProvider } from 'react-router';
import {
  ADMIN_CANNOT_ACCEPT,
  AFFILIATE_OPERATIONS_ABSENCES,
  ATTRIBUTION_FOOTNOTE,
  AVAILABILITY_TERM_IS_AGREED,
  FIRST_POST_RELEASES_ZERO,
  FIRST_POST_VERIFICATION_CHECKS,
  FIXED_PAYMENT_FUNDED_IS_NOT_PAID,
  TERMINATION_DECIDES_NO_MONEY,
  affiliateOperationsAbsence,
} from '@proovd/shared';
import { appRoutes } from '../../../routes.js';
import { installQaServer, type StubRoute } from '../../qa/server.js';
import type { AdminIdentity } from '../api.js';
import type { CreatorRelationshipDetail, CreatorWorkspaceDetail } from './api.js';

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
    /*
     * The PROMISE shape — the trap `support.test.tsx` records. A
     * callback-shaped mock resolves before the work does, so every
     * server-refusal assertion behind the hook passes for the wrong reason.
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
const RECORD = `/admin/creators/${PROSPECT}`;
/** The §17 review keeps its own address — its decision is its own act. */
const REVIEW = `${RECORD}/relationships/${ASSOCIATION}/review`;

function at(tab: string, section?: string): string {
  const params = new URLSearchParams({ tab, rel: ASSOCIATION });
  if (section) params.set('section', section);
  return `${RECORD}?${params.toString()}`;
}

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
      launchFailure: { required: false, failure: null },
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
    deliverables: {
      items: [
        {
          id: 'dlv-1',
          title: 'Launch post on the approved channel',
          source: 'Standard terms acceptance',
          state: 'evidence_submitted',
          stateLabel: 'Evidence submitted',
          createdAt: 'Aug 10, 2026 · 9:00 AM UTC',
          latestEvidence: {
            id: 'ev-1',
            reference: 'https://instagram.com/p/abc',
            note: null,
            submittedBy: 'user:admin-1',
            submittedAt: 'Aug 11, 2026 · 9:00 AM UTC',
          },
          latestDecision: null,
        },
      ],
      resolved: 0,
      canRecord: true,
      sourceLabel: 'Standard terms acceptance',
    },
    availability: {
      term:
        'Keep your promotional content available for the agreed campaign and availability period. Story-format content may follow the natural lifespan you agreed in advance. · Campaign close: Aug 18, 2026 · 8:00 PM UTC',
      termSource: '§20 Creator obligations · the accepted campaign period',
      checks: 0,
      latest: null,
    },
    mediationNotes: [],
    terminationRequests: { open: null, history: [] },
    kitAssets: {
      visualsAvailable: false,
      waitingOn:
        'The §12 object storage is not configured in this deployment (Track A4), so there are no stored visuals to show. The asset records below are what the campaign holds; every Creator kit read is still logged.',
      files: [],
    },
    workAgain: [],
  };
  patch(draft);
  return draft;
}

/** A complete workspace read — the record shell renders from it first. */
function workspace(
  patch: (draft: CreatorWorkspaceDetail) => void = () => {},
): CreatorWorkspaceDetail {
  const draft: CreatorWorkspaceDetail = {
    header: {
      prospectId: PROSPECT,
      initials: 'MJ',
      name: 'Maya Johnson',
      handle: '@mayabuilds',
      channelUrl: 'https://instagram.com/mayabuilds',
      platform: 'instagram.com',
      subtype: 'Social Creator',
      niche: 'Productivity & creator tools',
      location: 'United States · Texas',
      verification: { state: 'verified', label: 'Verified', at: 'Jun 2, 2026', missing: [] },
      slots: { used: 1, limit: 3, remaining: 2, atLimit: false },
      payout: { state: 'requirements_due', label: 'Stripe needs information' },
      account: 'Eligible',
      attention: { needed: false },
      openCases: 0,
      availableActions: ['assign', 'suspend', 'deletion', 'verify'],
    },
    relationships: [
      {
        associationId: ASSOCIATION,
        campaignId: 'camp-teeb',
        campaignName: 'Teeb Founding Launch',
        founderName: 'Teeb Labs LLC',
        campaignType: 'Product Campaign',
        campaignTypeRaw: 'pre_launch',
        status: 'Active partnership',
        statusRaw: 'active',
        designation: 'Initial launch roster',
        owner: 'System',
        activatedAt: 'Aug 10, 2026 · 9:00 AM UTC',
        closesAt: 'Aug 18, 2026 · 8:00 PM UTC',
        holdsSlot: true,
        agreement: 'Accepted',
        trackingLink: 'Affiliate link active',
        completion: 'Not due before close',
      },
    ],
    profile: {
      summary: {
        handle: '@mayabuilds',
        channelUrl: 'https://instagram.com/mayabuilds',
        platform: 'instagram.com',
      },
      blocks: [
        {
          provenance: 'admin',
          title: 'Channel details',
          fields: [
            {
              key: 'conflicts',
              label: 'Conflicts',
              value: null,
              helper: null,
              emptyLabel: 'None recorded',
            },
            {
              key: 'sanctions',
              label: 'Red flags',
              value: null,
              helper: null,
              emptyLabel: 'None recorded',
            },
          ],
        },
      ],
      verification: {
        state: 'verified',
        label: 'Verified',
        at: 'Jun 2, 2026 · 9:00 AM UTC',
        by: 'Ada Admin',
        metricLabel: 'Engagement rate',
        metrics: [],
        evidence: [],
        missing: [],
      },
      evidenceFiles: { available: false, waitingOn: 'Track A4.', files: [] },
      metricDecisions: [],
      proposalAccess: { key: 'standard', label: 'Standard proposal access', derivedFrom: null },
      agreements: {
        terms: 'v2026.05',
        aup: 'v2026.05',
        policyState: 'accepted',
        publishedVersions: [],
        perCampaign: [
          {
            associationId: ASSOCIATION,
            campaignName: 'Teeb Founding Launch',
            state: 'Accepted',
          },
        ],
      },
      provider: {
        populated: true,
        waitingOn: null,
        accountId: 'acct_1MAYA000000',
        state: 'requirements_due',
        label: 'Stripe needs information',
        transferCapability: 'Blocked',
        requirements: ['external_account'],
        requirementsLabel: '1 outstanding',
        lastUpdated: 'Aug 15, 2026 · 11:00 AM UTC',
      },
      invitations: [],
      support: [],
      deletionRequest: null,
    },
    standing: {
      account: { state: 'Eligible', latest: null, history: [] },
      enforcement: [],
      disclosures: [],
      policyReacceptanceOpen: false,
      cases: [],
    },
    history: [],
    historyCounts: {},
    communications: [],
  };
  patch(draft);
  return draft;
}

function routes(
  value: CreatorRelationshipDetail = detail(),
  ws: CreatorWorkspaceDetail = workspace(),
): StubRoute[] {
  return [
    { match: /\/relationships\/[^/]+$/, body: value },
    { match: /\/api\/admin\/creators\/[^/]+$/, body: ws },
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

/* ── The switcher and the scoped tabs ──────────────────────────────────────── */

describe('§26.1, §28.5 — the campaign tabs render from the one relationship read', () => {
  it('scopes the campaign tabs by the switcher, and the retired address redirects', async () => {
    serve(routes());
    const view = await renderAdmin(at('campaigns', 'readiness'));

    // The Selected-relationship switcher is the scoping control.
    expect(screen.getByText('Selected relationship')).toBeTruthy();
    expect(
      (screen.getByLabelText('Select campaign relationship') as HTMLSelectElement).value,
    ).toBe(ASSOCIATION);
    expect(screen.getByText('Affiliate link active')).toBeTruthy();
    view.unmount();

    // The old sibling address still lands on the record it meant.
    serve(routes());
    const redirected = mount(`${RECORD}/relationships/${ASSOCIATION}`);
    await waitFor(() => {
      expect(redirected.router.state.location.pathname).toBe(RECORD);
    });
    expect(redirected.router.state.location.search).toContain('tab=campaigns');
    expect(redirected.router.state.location.search).toContain(`rel=${ASSOCIATION}`);
    redirected.unmount();
  });

  it('renders the relationship fact card, and the reference’s edit control as its refusal', async () => {
    serve(routes());
    await renderAdmin(at('campaigns'));

    expect(screen.getByText('Relationship ID')).toBeTruthy();
    expect(screen.getByText(ASSOCIATION)).toBeTruthy();
    // "Edit Admin-owned relationship data" is refused — the sentence renders
    // where the control would have been (§1.8).
    expect(
      screen.getByText(affiliateOperationsAbsence('relationshipEdit').sentence),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Edit Admin-owned relationship data/i })).toBeNull();
  });
});

/* ── Readiness & Active (the old Overview pane) ────────────────────────────── */

describe('§16, §18, §31.5 — Readiness & Active', () => {
  it('renders the link, its activation, and the safe test', async () => {
    serve(routes());
    await renderAdmin(at('campaigns', 'readiness'));

    expect(screen.getByText('Affiliate link active')).toBeTruthy();
    expect(screen.getByText(/proovd_link_test=1/)).toBeTruthy();
    expect(screen.getByText(ATTRIBUTION_FOOTNOTE)).toBeTruthy();
  });

  it('offers the §16 operations, none of which grants anything', async () => {
    serve(routes());
    await renderAdmin(at('campaigns', 'readiness'));

    await userEvent.click(screen.getByRole('button', { name: /Re-derive readiness/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/It grants nothing/)).toBeTruthy();
    expect(
      within(dialog).getByText(/no control anywhere can mark an item done by hand/i),
    ).toBeTruthy();
  });

  it('offers the kit access log, and revocation only while access exists', async () => {
    serve([...routes(), { match: /access-log$/, body: { access: [] } }]);
    await renderAdmin(at('campaigns', 'readiness'));

    expect(screen.getByRole('button', { name: /View the access log/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Revoke kit access/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Reveal the preparing campaign/i })).toBeNull();
  });

  it('renders the visual kit as records with the honest Track A4 absence (gap 6)', async () => {
    serve(
      routes(
        detail((draft) => {
          draft.kitAssets.files = [
            {
              id: 'asset-1',
              purpose: 'visual',
              state: 'stored',
              filename: 'hero.png',
              dimensions: '1600 × 900',
              approved: true,
              removed: false,
            },
          ];
        }),
      ),
    );
    await renderAdmin(at('campaigns', 'readiness'));

    // The kit read is real now: the campaign's own asset records, and the
    // preview absence names Track A4 rather than a parked toast.
    expect(screen.getByText('hero.png')).toBeTruthy();
    expect(screen.getByText(/Track A4/)).toBeTruthy();
    expect(screen.queryByText(/arrives with Session C/)).toBeNull();
  });

  it('states §16’s complete-or-not rule beside a checklist that is short', async () => {
    serve(routes());
    await renderAdmin(at('campaigns', 'readiness'));

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
    await renderAdmin(at('campaigns', 'readiness'));

    const card = screen.getByText('Proposal version 2 waiting').closest('section')!;
    expect(within(card).queryByRole('button')).toBeNull();
    expect(within(card).getByText('Owner · Founder')).toBeTruthy();
  });

  it('pauses the link through a dialog that says what a pause is not', async () => {
    serve([...routes(), { match: /\/link$/, body: detail() }]);
    await renderAdmin(at('campaigns', 'readiness'));

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

/* ── Opportunities & Negotiations (the old Agreement pane) ─────────────────── */

describe('§14.2, §14.3, §24.7 — Opportunities & Negotiations', () => {
  it('pins the two sentences this section must never be without', async () => {
    serve(routes());
    await renderAdmin(at('campaigns', 'negotiations'));

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
    await renderAdmin(at('campaigns', 'negotiations'));

    expect(
      screen.getByText('A fixed Creator payment is unavailable on Idea Campaigns'),
    ).toBeTruthy();
    expect(screen.queryByText(FIXED_PAYMENT_FUNDED_IS_NOT_PAID)).toBeNull();
  });

  it('offers the one Admin move on an open version, and only on an open one', async () => {
    serve(
      routes(
        detail((draft) => {
          draft.agreement.versions = [
            {
              id: 'v2',
              number: 2,
              proposedBy: 'affiliate',
              totalPercent: 35,
              fixedPaymentCents: null,
              state: 'awaiting_founder',
              affiliateDecision: 'proposed',
              founderDecision: null,
              createdAt: 'Aug 3, 2026 · 9:00 AM UTC',
              lockedAt: null,
            },
            {
              id: 'v1',
              number: 1,
              proposedBy: 'founder',
              totalPercent: 30,
              fixedPaymentCents: null,
              state: 'superseded',
              affiliateDecision: 'declined',
              founderDecision: 'proposed',
              createdAt: 'Aug 1, 2026 · 9:00 AM UTC',
              lockedAt: null,
            },
          ];
        }),
      ),
    );
    await renderAdmin(at('campaigns', 'negotiations'));

    expect(screen.getAllByRole('button', { name: /Reject for policy/i })).toHaveLength(1);
  });

  it('records a mediation note — an act with no acceptance to smuggle', async () => {
    serve([...routes(), { match: /\/mediation-note$/, body: detail() }]);
    await renderAdmin(at('campaigns', 'negotiations'));

    await userEvent.click(
      screen.getByRole('button', { name: /Record proposal mediation note/i }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/cannot accept for either party/)).toBeTruthy();
    await userEvent.type(
      within(dialog).getByLabelText(/Mediation note/i),
      'Clarified the tax exclusion.',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: /Record the note/i }));

    await waitFor(() => {
      expect(requestsTo(/\/mediation-note$/)).toHaveLength(1);
    });
  });

  it('offers no accept control anywhere', async () => {
    serve(routes());
    const view = await renderAdmin(at('campaigns', 'negotiations'));
    for (const control of within(view.container).getAllByRole('button')) {
      expect(control.textContent?.toLowerCase()).not.toContain('accept');
    }
  });
});

/* ── Completion & Work Again ───────────────────────────────────────────────── */

describe('§22.8, §22.9 — Completion & Work Again', () => {
  it('reads §22.8’s criteria rather than asking an Admin to assert them', async () => {
    serve([
      ...routes(),
      { match: /\/api\/admin\/completion\//, body: { findings: [], current: null } },
    ]);
    await renderAdmin(at('campaigns', 'completion'));

    expect(
      screen.getByText(/read from readiness, post verification, the §22.1 decision/i),
    ).toBeTruthy();
    expect(
      screen.getAllByText(/Sales performance is not a completion requirement/).length,
    ).toBeGreaterThan(0);
  });

  it('renders the work-again record read-only, and the reissue as its refusal', async () => {
    serve(
      routes(
        detail((draft) => {
          draft.workAgain = [
            {
              id: 'wa-1',
              status: 'requested',
              message: 'We would love to work with you again on the next run.',
              requestedAt: 'Aug 20, 2026 · 9:00 AM UTC',
              respondedAt: null,
              responseNote: null,
            },
          ];
        }),
      ),
    );
    await renderAdmin(at('campaigns', 'completion'));

    expect(
      screen.getByText('We would love to work with you again on the next run.'),
    ).toBeTruthy();
    // "Reissue work-again request" fabricates a Founder ask — refused (§1.8).
    expect(
      screen.getByText(affiliateOperationsAbsence('workAgainReissue').sentence),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Reissue work-again request/i })).toBeNull();
  });
});

/* ── Content & Compliance ──────────────────────────────────────────────────── */

describe('§17, §18, §22.4 idiom — Content & Compliance', () => {
  it('shows the public URL as the object, and offers the review', async () => {
    serve(routes());
    await renderAdmin(at('content'));

    expect(screen.getByRole('link', { name: /instagram\.com\/p\/abc/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Review submitted post/i })).toBeTruthy();
  });

  it('operates the deliverable records — receipt, decision, and the waiver’s named recorder (gap 1)', async () => {
    serve([...routes(), { match: /\/decision$/, body: detail() }]);
    await renderAdmin(at('content', 'deliverables'));

    // The record is real now: the row, its state, and its latest receipt.
    expect(screen.getByText('Launch post on the approved channel')).toBeTruthy();
    expect(screen.getByText(/Evidence submitted/)).toBeTruthy();
    expect(screen.getByText('0 of 1 resolved')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: /Review deliverable evidence/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Findings/)).toBeTruthy();
    await userEvent.selectOptions(within(dialog).getByLabelText(/Decision/i), 'verified');
    await userEvent.type(
      within(dialog).getByLabelText(/Findings/i),
      'The post is live and matches the agreed work.',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: /Record the decision/i }));

    await waitFor(() => {
      expect(requestsTo(/\/decision$/)).toHaveLength(1);
    });
    expect(requestsTo(/\/decision$/)[0]!.body).toContain('"outcome":"verified"');
  });

  it('verifies availability against the AGREED term, shown read-only (gap 2)', async () => {
    serve([...routes(), { match: /\/availability$/, body: detail() }]);
    await renderAdmin(at('content', 'deliverables'));

    expect(screen.getByText('Agreed campaign availability period')).toBeTruthy();
    expect(screen.getAllByText(AVAILABILITY_TERM_IS_AGREED).length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole('button', { name: /Verify content availability/i }));
    const dialog = await screen.findByRole('dialog');
    // The term is composed server-side and rendered — never an input.
    expect(within(dialog).getByText(/available for the agreed campaign/)).toBeTruthy();
    await userEvent.selectOptions(
      within(dialog).getByLabelText(/Is the content available/i),
      'yes',
    );
    await userEvent.type(
      within(dialog).getByLabelText(/Evidence or check note/i),
      'Checked the live post URL.',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: /Record the check/i }));

    await waitFor(() => {
      expect(requestsTo(/\/availability$/)).toHaveLength(1);
    });
    expect(requestsTo(/\/availability$/)[0]!.body).toContain('"available":true');
  });

  it('offers §29.6 only against a Creator §15 marked required for launch', async () => {
    serve(routes());
    const first = await renderAdmin(at('content'));
    expect(screen.queryByRole('button', { name: /Record a failure to post/i })).toBeNull();
    first.unmount();

    serve(
      routes(
        detail((draft) => {
          draft.content.launchFailure = { required: true, failure: null };
        }),
      ),
    );
    const required = await renderAdmin(at('content'));
    expect(screen.getByRole('button', { name: /Record a failure to post/i })).toBeTruthy();
    required.unmount();
  });

  it('states the §29.6 window is non-resettable, with the calendar it was cut on', async () => {
    serve(
      routes(
        detail((draft) => {
          draft.content.launchFailure = {
            required: true,
            failure: {
              status: 'replacement_pending',
              dueAt: 'Aug 14, 2026 · 5:00 PM UTC',
              calendarVersion: 'us-federal.v1',
              replacementDesignation: 'Approaching two Creators from the same niche.',
              recordedAt: 'Aug 11, 2026 · 9:00 AM UTC',
            },
          };
        }),
      ),
    );
    await renderAdmin(at('content'));

    expect(screen.getByText('Replacement window open')).toBeTruthy();
    expect(screen.getByText(/us-federal\.v1/)).toBeTruthy();
    expect(screen.getByText(/non-resettable/)).toBeTruthy();
    expect(screen.getByText(/the sweep does, at the deadline/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Record a failure to post/i })).toBeNull();
    expect(screen.getByRole('button', { name: /Mark the replacement ready/i })).toBeTruthy();
  });
});

/* ── Performance & Earnings (the old Money pane) ───────────────────────────── */

describe('§18, §22.1, §24.3, §24.4 — Performance & Earnings', () => {
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
    await renderAdmin(at('performance'));
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.queryByText('0%')).toBeNull();
  });

  it('says an estimated hero is not US$0.00 earned', async () => {
    serve(routes());
    await renderAdmin(at('performance', 'earnings'));

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
    await renderAdmin(at('performance', 'earnings'));

    expect(screen.getByText(/Sales tax is excluded from every Creator percentage/)).toBeTruthy();
    expect(screen.getByText(/Earned plus returned equals the provisional total/)).toBeTruthy();
    expect(screen.getByText(/never Proovd revenue/)).toBeTruthy();
  });

  it('offers no Transfer control — the refusal sentence renders instead (§1.8)', async () => {
    serve(routes());
    const view = await renderAdmin(at('performance', 'transfers'));

    expect(screen.getByText(affiliateOperationsAbsence('createTransfer').sentence)).toBeTruthy();
    for (const control of within(view.container).getAllByRole('button')) {
      expect(control.textContent?.toLowerCase()).not.toContain('create');
      expect(control.textContent?.toLowerCase()).not.toContain('transfer');
    }
  });

  it('sends the payout reminder — the real §27 key, with its outcome reported (gap 3)', async () => {
    serve([
      ...routes(),
      {
        match: /\/payout-reminder$/,
        body: { detail: workspace(), ask: { sent: true, reason: null } },
      },
    ]);
    await renderAdmin(at('performance', 'transfers'));

    await userEvent.click(screen.getByRole('button', { name: /Send payout reminder/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/message §27 already defines/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: /Send the reminder/i }));

    await waitFor(() => {
      expect(requestsTo(/\/payout-reminder$/)).toHaveLength(1);
    });
    expect(toasts).toContain('Payout reminder sent');
  });

  it('renders Adjustments as §24.8’s records with the free-form editor refused', async () => {
    serve(routes());
    await renderAdmin(at('performance', 'adjustments'));

    expect(screen.getByText('Only Affiliate-caused invalidity')).toBeTruthy();
    expect(screen.getByText(affiliateOperationsAbsence('adjustEarnings').sentence)).toBeTruthy();
    expect(screen.getByText(affiliateOperationsAbsence('fixedOutcome').sentence)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /adjust earnings/i })).toBeNull();
  });
});

/* ── The termination request (Support & Enforcement → Relationship Requests) ─ */

describe('§29, §24.8 — the termination request decides no money', () => {
  it('constrains the treatments to the chosen cause, and pins the consequence', async () => {
    serve([...routes(), { match: /\/termination-request$/, body: detail() }]);
    await renderAdmin(at('support', 'requests'));

    expect(screen.getAllByText(TERMINATION_DECIDES_NO_MONEY).length).toBeGreaterThan(0);

    await userEvent.click(
      screen.getByRole('button', { name: /Record active termination request/i }),
    );
    const dialog = await screen.findByRole('dialog');

    // The default cause (Founder or product) permits three treatments — the
    // §24.8 matrix's own row — and the clawback pair is not among them.
    const treatment = within(dialog).getByLabelText(/Money treatment/i) as HTMLSelectElement;
    const options = [...treatment.options].map((option) => option.value);
    expect(options).toContain('earnings_remain');
    expect(options).not.toContain('cancel_unpaid_invalid');
    expect(options).not.toContain('contractual_recovery');

    await userEvent.selectOptions(treatment, 'earnings_remain');
    await userEvent.type(
      within(dialog).getByLabelText(/Why the partnership should end/i),
      'The Creator asked to step away.',
    );
    await userEvent.type(within(dialog).getByLabelText(/Asked to take effect/i), '2026-08-20');
    await userEvent.type(
      within(dialog).getByLabelText(/How the ask reached us/i),
      'Email, forwarded to support.',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: /Record the request/i }));

    await waitFor(() => {
      expect(requestsTo(/\/termination-request$/)).toHaveLength(1);
    });
    const body = JSON.parse(requestsTo(/\/termination-request$/)[0]!.body!) as {
      cause: string;
      moneyTreatment: string;
    };
    expect(body.cause).toBe('founder_or_product');
    expect(body.moneyTreatment).toBe('earnings_remain');
  });

  it('renders the campaign suspend/kill and tier/access combos as refusals', async () => {
    serve(routes());
    await renderAdmin(at('support', 'enforcement'));

    expect(
      screen.getByText(affiliateOperationsAbsence('campaignSuspendKill').sentence),
    ).toBeTruthy();
    expect(screen.getByText(affiliateOperationsAbsence('tierAccessCombo').sentence)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Kill campaign/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Suspend campaign/i })).toBeNull();
  });
});

/* ── The §17 review (its own address, unchanged) ───────────────────────────── */

describe('§17, §33.4.7 — the first-post review', () => {
  it('offers all seven checks, and no approval until every one is marked', async () => {
    serve(routes());
    await renderAdmin(REVIEW);

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
    await renderAdmin(REVIEW);
    expect(screen.getByText(FIRST_POST_RELEASES_ZERO)).toBeTruthy();
  });

  it('sends the decision to the submission, with the checklist keyed by check', async () => {
    serve([...routes(), { match: /\/verify$/, body: { verification: { outcome: 'passed' } } }]);
    await renderAdmin(REVIEW);

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
    mount(REVIEW);
    expect(await screen.findByText('There is no post waiting for review')).toBeTruthy();
    expect(screen.getByText(/Post approved/)).toBeTruthy();
  });

  it('carries the failed checks into step two and warns about the pause', async () => {
    serve(routes());
    await renderAdmin(REVIEW);

    await userEvent.click(
      screen.getByRole('button', { name: FIRST_POST_VERIFICATION_CHECKS[0]!.label }),
    );
    await userEvent.click(screen.getByRole('button', { name: /Request post edits/i }));

    expect(await screen.findByText('Request post edits')).toBeTruthy();
    expect(screen.getByText(/The Affiliate link pauses when this is sent/)).toBeTruthy();
    const box = screen.getByLabelText(/Creator-facing correction/i) as HTMLTextAreaElement;
    expect(box.value).toContain(FIRST_POST_VERIFICATION_CHECKS[1]!.label);
    expect(box.value).not.toContain(FIRST_POST_VERIFICATION_CHECKS[0]!.label);
  });
});

/* ── The refused-controls register, walked ─────────────────────────────────── */

describe('§1.8 — every refused control renders its sentence somewhere', () => {
  it('walks AFFILIATE_OPERATIONS_ABSENCES across the rendered tabs', async () => {
    // Each register entry's sentence must appear on at least one section, so
    // re-adding the control means deleting the sentence that refuses it.
    const addresses: Record<string, string> = {
      createTransfer: at('performance', 'transfers'),
      adjustEarnings: at('performance', 'adjustments'),
      fixedOutcome: at('performance', 'adjustments'),
      workAgainReissue: at('campaigns', 'completion'),
      campaignSuspendKill: at('support', 'enforcement'),
      tierAccessCombo: at('support', 'enforcement'),
      relationshipEdit: at('campaigns'),
    };
    for (const entry of AFFILIATE_OPERATIONS_ABSENCES) {
      expect(addresses[entry.key], entry.key).toBeTruthy();
    }
    for (const entry of AFFILIATE_OPERATIONS_ABSENCES) {
      serve([
        ...routes(),
        { match: /\/api\/admin\/completion\//, body: { findings: [], current: null } },
      ]);
      const view = await renderAdmin(addresses[entry.key]!);
      expect(screen.getAllByText(entry.sentence).length, entry.key).toBeGreaterThan(0);
      view.unmount();
    }
  }, 60_000);
});

/* ── Accessibility ─────────────────────────────────────────────────────────── */

describe('§33.11.1 — every campaign-scoped surface is operable', () => {
  it('has no axe violations on any section, or on the review', async () => {
    const addresses = [
      at('campaigns'),
      at('campaigns', 'readiness'),
      at('campaigns', 'negotiations'),
      at('campaigns', 'completion'),
      at('content'),
      at('content', 'deliverables'),
      at('content', 'disclosures'),
      at('content', 'risk'),
      at('performance'),
      at('performance', 'earnings'),
      at('performance', 'transfers'),
      at('performance', 'adjustments'),
      at('support', 'requests'),
      REVIEW,
    ];
    for (const address of addresses) {
      serve([
        ...routes(),
        { match: /\/api\/admin\/completion\//, body: { findings: [], current: null } },
      ]);
      const view = await renderAdmin(address);
      expect((await axe(view.container)).violations).toEqual([]);
      view.unmount();
    }
  }, 120_000);

  it('renders no internal enum value or retired term on any section', async () => {
    const addresses = [
      at('campaigns'),
      at('campaigns', 'negotiations'),
      at('content'),
      at('performance', 'earnings'),
      at('support', 'requests'),
    ];
    for (const address of addresses) {
      serve(routes());
      const view = await renderAdmin(address);
      const text = view.container.textContent ?? '';
      for (const banned of ['pre_build', 'pre_launch', 'readiness_blocked', 'escrow', 'pledge']) {
        expect(text, `${address} · ${banned}`).not.toContain(banned);
      }
      view.unmount();
    }
  }, 60_000);
});
