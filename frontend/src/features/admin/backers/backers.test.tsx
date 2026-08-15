/**
 * The Backers Admin workspace, as a person actually meets it —
 * Spec §26.1, §25.7, §28.4, §1.1, §1.4, §27.1, §30, §33.11.
 *
 * A *surface* suite, deliberately. The registers, the derivations, and every
 * refusal are proved in `backend/src/tests/backer-workspace.test.ts`;
 * re-asserting them through a rendered DOM would be the same fact checked twice
 * in the weaker place. What is only checkable here is what a person SEES, what
 * they can reach with a keyboard, and — the thing this section is shaped around
 * — which controls exist at all.
 *
 * ── Everything is driven by a payload, because the surface decides nothing ──
 * The server resolves every consent badge, every answer, every total. So the
 * fixtures are the lever: the not-granted state is asserted against a payload
 * with `consentState: 'not_granted'`, the unanswered state against one with
 * `answered: false`. A test that hardcoded the expected words would be a second
 * answer to "what did this Backer consent to" — which is the exact mistake the
 * reference made in its own render function.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { createMemoryRouter, RouterProvider } from 'react-router';
import {
  BACKERS_IS_READ_ONLY,
  CONSENT_ABSENT_IS_NOT_GRANTED,
  NO_AFFILIATE_RESULTS,
  NO_BACKERS_MATCH,
} from '@proovd/shared';
import { appRoutes } from '../../../routes.js';
import { installQaServer, type StubRoute } from '../../qa/server.js';
import type { AdminIdentity } from '../api.js';
import type { BackersDirectoryView } from './api.js';

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
      The runtime takes the PROMISE, not the callback — `MotionProvider`'s own
      header records why, and `support.test.tsx` records what mocking it as
      `(el, work) => await work()` costs: it calls a promise, throws into the
      swallowing catch, and resolves immediately, so every server-refusal
      assertion behind the hook passes for the wrong reason. Nothing on this
      surface submits, but the shape is kept correct so a later control cannot
      inherit that bug.
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
  sessionEstablishedAt: '2026-08-15T15:00:00.000Z',
  prerequisiteKeys: [],
  environment: {
    stripeMode: 'test',
    stripeApiVersion: '2026-06-30',
    webhooksLastEventAt: '2026-08-15T13:58:00.000Z',
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

/* ── Fixtures ──────────────────────────────────────────────────────────────── */

const CAMPAIGN_ID = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';
const ASSOCIATION_ID = '11112222-3333-4444-5555-666677778888';

/**
 * A long free-text answer, because the widest cell in the Admin is the one
 * holding a person's own paragraph and the reference's fixtures are all one
 * short sentence. §13's pressure point, as a fixture.
 */
const LONG_ANSWER =
  'I lose decisions across too many apps and I keep re-reading the same threads to find them again. ' +
  'What I actually want is one place that survives a project handoff, so when somebody asks why we ' +
  'chose a supplier in March I can answer in under a minute instead of scrolling a channel.';

function view(overrides: Partial<BackersDirectoryView> = {}): BackersDirectoryView {
  return {
    totals: {
      attributedBackers: { value: '132', label: 'Affiliate Backers' },
      attributedValue: { value: 'US$15,470.00', label: 'Affiliate pre-order value' },
      affiliates: { value: '6', label: 'Affiliates' },
      excludesNote:
        'These three count Creator-attributed pre-orders only. Organic pre-orders appear in Every Backer and are not in these totals.',
      organicBackers: 2,
    },
    campaigns: [{ value: CAMPAIGN_ID, label: 'Teeb Founding Launch' }],
    affiliates: [
      { value: 'organic', label: 'Organic' },
      { value: ASSOCIATION_ID, label: 'Maya Johnson' },
    ],
    affiliateResults: {
      rows: [
        {
          associationId: ASSOCIATION_ID,
          campaignId: CAMPAIGN_ID,
          name: 'Maya Johnson',
          handle: '@mayajohnson',
          campaignName: 'Teeb Founding Launch',
          backers: 18,
          backersLabel: 'Backers',
          preorderValue: 'US$2,290.00',
          timeActive: '4 days',
          timeActiveWaitingOn: null,
          average: 'US$127.00',
          drillThrough: { campaignId: CAMPAIGN_ID, associationId: ASSOCIATION_ID },
          searchText: 'maya johnson @mayajohnson teeb founding launch',
        },
      ],
      shown: '1 Affiliate shown',
      noAttributionNote: null,
      anchorNote: null,
    },
    backers: {
      rows: [
        {
          reservationId: 'r-1',
          backerNumber: 12,
          email: 'nora.blake@example.com',
          campaignId: CAMPAIGN_ID,
          campaignName: 'Teeb Founding Launch',
          orderAmount: 'US$74.00',
          affiliateName: 'Maya Johnson',
          affiliateHandle: '@mayajohnson',
          associationId: ASSOCIATION_ID,
          attributionStatus: 'Verified',
          statusLabel: 'Reserved',
          date: 'August 12, 2026',
          answers: [
            { question: 'Why do you want this product?', answer: LONG_ANSWER, answered: true },
            {
              question: 'How likely are you to recommend this to someone?',
              answer: '9 out of 10',
              answered: true,
            },
          ],
          consentState: 'not_granted',
          consentLabel: 'Founder contact not allowed',
          consentPermits:
            'Do not forward these answers to the Founder with the identity attached, and do not add this Backer to Founder marketing. Fulfillment and purchase support are unaffected.',
          searchText: 'nora.blake@example.com teeb founding launch maya johnson',
        },
        {
          reservationId: 'r-2',
          backerNumber: null,
          email: 'yara.ali@example.com',
          campaignId: CAMPAIGN_ID,
          campaignName: 'Teeb Founding Launch',
          orderAmount: 'US$74.00',
          affiliateName: null,
          affiliateHandle: null,
          associationId: null,
          attributionStatus: 'None',
          statusLabel: 'Charged',
          date: 'August 13, 2026',
          answers: [
            { question: 'Why do you want this product?', answer: 'Not answered', answered: false },
            {
              question: 'How likely are you to recommend this to someone?',
              answer: 'Not answered',
              answered: false,
            },
          ],
          consentState: 'granted',
          consentLabel: 'Founder contact allowed',
          consentPermits:
            'The Founder may contact this Backer beyond fulfillment and may see these answers with the Backer’s identity attached.',
          searchText: 'yara.ali@example.com teeb founding launch organic',
        },
      ],
      shown: '2 Backers shown',
      page: 1,
      pageSize: 50,
      total: 2,
      hasMore: false,
    },
    readOnly: BACKERS_IS_READ_ONLY,
    noRecordPage: 'One row per Backer. No extra record page.',
    answersNotExportable:
      'Survey answers and Backer contact details are visible here for support and risk work. §25.7 keeps them out of every export, and this page has no export.',
    consentAbsentIsNotGranted: CONSENT_ABSENT_IS_NOT_GRANTED,
    ...overrides,
  };
}

function backersRoute(body: BackersDirectoryView | (() => BackersDirectoryView)): StubRoute {
  return { match: /\/api\/admin\/backers/, body: body as unknown as object };
}

async function renderAt(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  return render(<RouterProvider router={router} />);
}

/**
 * What a reader sees, with a space where the markup puts a gap.
 *
 * `textContent` concatenates adjacent nodes with nothing between them, so the
 * page lede and the heading after it read as one word that is in neither —
 * Phase 23a's finding, and without this the identifier scan below reports
 * `ordersSee` and a dozen other joins that nobody can see.
 */
function visibleText(root: HTMLElement): string {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  while (walker.nextNode()) parts.push(walker.currentNode.textContent ?? '');
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

beforeEach(() => {
  installMotionRuntime();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as { Proovd?: unknown }).Proovd;
});

/* ── 1. The page renders the reference's own copy ──────────────────────────── */

describe('the page header', () => {
  it('renders the eyebrow, title, lede, and the three totals', async () => {
    serve([backersRoute(view())]);
    await renderAt('/admin/backers');

    expect(await screen.findByRole('heading', { name: 'Backers and pre-orders' })).toBeInTheDocument();
    expect(screen.getByText(/See what every Affiliate brought in/)).toBeInTheDocument();

    const totals = screen.getByLabelText('Totals');
    expect(within(totals).getByText('132')).toBeInTheDocument();
    expect(within(totals).getByText('Affiliate Backers')).toBeInTheDocument();
    expect(within(totals).getByText('US$15,470.00')).toBeInTheDocument();
    // The label names the Affiliate scope, not just the money — the totals exclude
    // organic Backers and the label is what keeps that honest.
    expect(within(totals).getByText('Affiliate pre-order value')).toBeInTheDocument();
    expect(within(totals).getByText('Affiliates')).toBeInTheDocument();
  });

  it('says what the totals leave out, because the two views disagree by design', async () => {
    serve([backersRoute(view())]);
    await renderAt('/admin/backers');
    expect(
      await screen.findByText(/Organic pre-orders appear in Every Backer/),
    ).toBeInTheDocument();
  });

  it('states the read-only posture in the header, not a footer', async () => {
    serve([backersRoute(view())]);
    await renderAt('/admin/backers');
    expect(await screen.findByText(BACKERS_IS_READ_ONLY)).toBeInTheDocument();
  });
});

/* ── 2. It is read-only (brief §4) ─────────────────────────────────────────── */

describe('the surface has no mutation and no export', () => {
  it('submits nothing, whatever is clicked', async () => {
    const user = userEvent.setup();
    serve([backersRoute(view())]);
    const { container } = await renderAt('/admin/backers');
    await screen.findByRole('heading', { name: 'Backers and pre-orders' });

    /* Scoped to the SURFACE, not the document: the Admin shell's own Sign out
       is a real write and belongs to `AdminLayout`, so including it would make
       this assert something about the shell rather than about this section. */
    const surface = container.querySelector('.bkr') as HTMLElement;
    expect(surface).not.toBeNull();
    for (const button of within(surface).queryAllByRole('button')) {
      if (!(button as HTMLButtonElement).disabled) await user.click(button);
    }

    const writes = requests.filter((r) => r.method !== 'GET');
    expect(writes, `unexpected writes: ${JSON.stringify(writes)}`).toHaveLength(0);
  });

  it('offers no Backer mutation control and no export', async () => {
    serve([backersRoute(view())]);
    await renderAt('/admin/backers');
    await screen.findByRole('heading', { name: 'Backers and pre-orders' });

    // §4: refund, cancel, charge, contact, resend belong to the workspaces that
    // own their rules. Export is §25.7's decision and is not a convenience.
    for (const forbidden of [
      /refund/i,
      /cancel/i,
      /charge/i,
      /resend/i,
      /contact backer/i,
      /export/i,
      /download/i,
      /\.csv/i,
    ]) {
      const controls = screen
        .getAllByRole('button')
        .filter((b) => forbidden.test(b.textContent ?? ''));
      expect(controls, `a control matching ${forbidden} must not exist`).toHaveLength(0);
    }
    expect(screen.queryAllByRole('link', { name: /export|download/i })).toHaveLength(0);
  });

  it('says there is no Backer record page, and offers no row link', async () => {
    serve([backersRoute(view())]);
    await renderAt('/admin/backers?view=backers');
    expect(await screen.findByText('One row per Backer. No extra record page.')).toBeInTheDocument();
    // A Backer row is not a control: there is nowhere for it to go.
    expect(screen.queryAllByRole('link', { name: /nora\.blake/i })).toHaveLength(0);
  });
});

/* ── 3. Consent (brief §3 — the most important section) ────────────────────── */

describe('consent is rendered, never inferred', () => {
  it('a not-granted row says so and never reads as shared', async () => {
    serve([backersRoute(view())]);
    await renderAt('/admin/backers?view=backers');

    const row = (await screen.findByText('nora.blake@example.com')).closest('.bkr-row');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText('Founder contact not allowed')).toBeInTheDocument();
    // The reference's default. It must appear nowhere on this surface.
    expect(document.body.textContent).not.toMatch(/share my name and email/i);
  });

  it('the permission sentence is rendered, not left on a tooltip', async () => {
    serve([backersRoute(view())]);
    await renderAt('/admin/backers?view=backers');
    // §28.5: a pointer-only explanation is unavailable to a keyboard or
    // screen-reader user, and this is the sentence the decision turns on.
    expect(await screen.findByText(/Do not forward these answers to the Founder/)).toBeInTheDocument();
  });

  it('the badge never reads as a bare yes or no', async () => {
    serve([backersRoute(view())]);
    await renderAt('/admin/backers?view=backers');
    await screen.findByText('nora.blake@example.com');

    for (const badge of document.querySelectorAll('.bkr-consent')) {
      const text = (badge.textContent ?? '').trim().toLowerCase();
      expect(text).not.toBe('yes');
      expect(text).not.toBe('no');
      // The label names the consequence, which is the question an Admin holds.
      expect(text).toMatch(/founder contact/);
    }
  });

  it('states that an absent answer is not consent', async () => {
    serve([backersRoute(view())]);
    await renderAt('/admin/backers?view=backers');
    expect(await screen.findByText(CONSENT_ABSENT_IS_NOT_GRANTED)).toBeInTheDocument();
  });

  it('names what the consent governs, so it is not read as identity sharing', async () => {
    serve([backersRoute(view())]);
    await renderAt('/admin/backers?view=backers');
    // §19 shares the email with the Founder mandatorily; this consent is about
    // contact and identifiable answers. An Admin who confuses the two withholds
    // something the Founder is already entitled to.
    expect(await screen.findByText(/The Founder already has the email/)).toBeInTheDocument();
  });
});

/* ── 4. Answers (brief §12) ────────────────────────────────────────────────── */

describe('checkout answers', () => {
  it('stacks each question above its answer', async () => {
    serve([backersRoute(view())]);
    await renderAt('/admin/backers?view=backers');

    expect(await screen.findAllByText('Why do you want this product?')).toHaveLength(2);
    expect(screen.getByText(LONG_ANSWER)).toBeInTheDocument();
    expect(screen.getByText('9 out of 10')).toBeInTheDocument();
  });

  it('renders an unanswered question as unanswered', async () => {
    serve([backersRoute(view())]);
    await renderAt('/admin/backers?view=backers');

    const row = (await screen.findByText('yara.ali@example.com')).closest('.bkr-row');
    const unanswered = within(row as HTMLElement).getAllByText('Not answered');
    expect(unanswered).toHaveLength(2);
    // The grey/italic treatment is a second signal; the WORD is the first.
    expect(unanswered[0]).toHaveClass('bkr-qa__none');
  });

  it('does not clamp or truncate a long answer', async () => {
    serve([backersRoute(view())]);
    await renderAt('/admin/backers?view=backers');
    const answer = await screen.findByText(LONG_ANSWER);
    // §13: these answers are the point of the view. A truncated one is a quote
    // with its end cut off. The full string is present in the DOM.
    expect(answer.textContent).toBe(LONG_ANSWER);
    expect(answer.textContent).not.toMatch(/…|\.\.\.$/);
  });

  it('renders §19 two questions and never the reference three', async () => {
    serve([backersRoute(view())]);
    await renderAt('/admin/backers?view=backers');
    await screen.findByText('nora.blake@example.com');
    expect(document.body.textContent).not.toMatch(/How clear was the campaign/i);
    expect(document.body.textContent).not.toMatch(/Share name and email with the Founder/i);
  });
});

/* ── 5. Organic (brief §5.4) ───────────────────────────────────────────────── */

describe('Organic is a distinct marker, not a badge', () => {
  it('renders the Organic marker for an unattributed pre-order', async () => {
    serve([backersRoute(view())]);
    await renderAt('/admin/backers?view=backers');

    const row = (await screen.findByText('yara.ali@example.com')).closest('.bkr-row');
    const organic = within(row as HTMLElement).getByText('Organic');
    expect(organic).toHaveClass('bkr-organic');
    expect(within(row as HTMLElement).getByText('No Creator link')).toBeInTheDocument();
  });

  it('renders an Affiliate badge for an attributed one', async () => {
    serve([backersRoute(view())]);
    await renderAt('/admin/backers?view=backers');

    const row = (await screen.findByText('nora.blake@example.com')).closest('.bkr-row');
    const badge = within(row as HTMLElement).getByText('Maya Johnson');
    expect(badge).toHaveClass('bkr-badge');
  });
});

/* ── 6. The drill-through (brief §5.5) ─────────────────────────────────────── */

describe('the drill-through', () => {
  it('an Affiliate row opens the Backer view pre-filtered, as real URL state', async () => {
    const user = userEvent.setup();
    serve([backersRoute(view())]);
    await renderAt('/admin/backers');

    await user.click(await screen.findByRole('button', { name: /Maya Johnson/ }));

    // The whole position is in the address, so it is linkable and back-safe.
    const last = requests.filter((r) => r.url.includes('/api/admin/backers')).at(-1);
    expect(last!.url).toContain(`campaignId=${CAMPAIGN_ID}`);
    expect(last!.url).toContain(`affiliate=${ASSOCIATION_ID}`);
    expect(await screen.findByRole('heading', { name: 'Pre-orders and checkout answers' })).toBeInTheDocument();
  });

  it('a pre-filtered address renders the Backer view directly', async () => {
    serve([backersRoute(view())]);
    await renderAt(`/admin/backers?view=backers&campaignId=${CAMPAIGN_ID}&affiliate=${ASSOCIATION_ID}`);
    expect(await screen.findByRole('heading', { name: 'Pre-orders and checkout answers' })).toBeInTheDocument();
    const first = requests.find((r) => r.url.includes('/api/admin/backers'));
    expect(first!.url).toContain(`affiliate=${ASSOCIATION_ID}`);
  });
});

/* ── 7. Filters reach the server (brief §7.2) ──────────────────────────────── */

describe('filtering is a query, not a browser predicate', () => {
  it('choosing a campaign issues a new request', async () => {
    const user = userEvent.setup();
    serve([backersRoute(view())]);
    await renderAt('/admin/backers');
    await screen.findByRole('heading', { name: 'Who brought in what' });

    const before = requests.filter((r) => r.url.includes('/api/admin/backers')).length;
    await user.selectOptions(screen.getByLabelText('Campaign'), CAMPAIGN_ID);

    const after = requests.filter((r) => r.url.includes('/api/admin/backers'));
    expect(after.length).toBeGreaterThan(before);
    expect(after.at(-1)!.url).toContain(`campaignId=${CAMPAIGN_ID}`);
  });

  it('the time filter is disabled until one campaign anchors it, and says why', async () => {
    serve([backersRoute(view())]);
    await renderAt('/admin/backers');
    const time = (await screen.findByLabelText('Time')) as HTMLSelectElement;
    // Two campaigns launched months apart share no "first 7 days"; averaging
    // them would be the reference's fabricated arithmetic in another form.
    expect(time.disabled).toBe(true);
    expect(screen.getByText(/Choose one campaign first/)).toBeInTheDocument();
  });

  it('the window names the instant it measures from', async () => {
    serve([backersRoute(view())]);
    await renderAt(`/admin/backers?campaignId=${CAMPAIGN_ID}&window=first_7`);
    expect(
      await screen.findByText(/Pre-orders in the 7 days after the campaign went live/),
    ).toBeInTheDocument();
  });
});

/* ── 8. States (brief §12) ─────────────────────────────────────────────────── */

describe('loading, error, and the three empty states', () => {
  it('renders a loading state that answers §27.1', async () => {
    installQaServer([
      {
        match: /\/api\/account\/me$/,
        body: { account: { role: 'admin', email: 'a@b.co', name: 'A' } },
      },
      { match: /\/api\/admin\/me$/, body: identity },
      { match: /\/api\/admin\/backers/, body: new Promise<never>(() => {}) as never },
    ]);
    await renderAt('/admin/backers');
    expect(await screen.findByText('Reading Backers and pre-orders')).toBeInTheDocument();
    expect(screen.getByText('No action needed')).toBeInTheDocument();
  });

  it('renders an honest failure with a retry', async () => {
    installQaServer([
      {
        match: /\/api\/account\/me$/,
        body: { account: { role: 'admin', email: 'a@b.co', name: 'A' } },
      },
      { match: /\/api\/admin\/me$/, body: identity },
      {
        match: /\/api\/admin\/backers/,
        status: 500,
        body: {
          error: 'server_error',
          title: 'Proovd could not read the Backers list',
          whatHappened: 'The read failed. Nothing was changed by the attempt.',
          next: 'Try the read again.',
        },
      },
    ]);
    await renderAt('/admin/backers');
    expect(await screen.findByText('Proovd could not read the Backers list')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try the read again' })).toBeInTheDocument();
  });

  it('a filter that matches no Affiliate says so', async () => {
    const empty = view();
    empty.affiliateResults = { rows: [], shown: '0 Affiliates shown', noAttributionNote: null, anchorNote: null };
    serve([backersRoute(empty)]);
    await renderAt('/admin/backers');
    expect(await screen.findByText(NO_AFFILIATE_RESULTS)).toBeInTheDocument();
  });

  it('a campaign with Backers and no attribution says THAT instead', async () => {
    const noAttribution = view();
    noAttribution.affiliateResults = {
      rows: [],
      shown: '0 Affiliates shown',
      noAttributionNote:
        'No pre-order on this campaign came through a Creator link yet. Every Backer arrived organically — see Every Backer.',
      anchorNote: null,
    };
    serve([backersRoute(noAttribution)]);
    await renderAt('/admin/backers');

    // An Admin reading "no match" would go looking for a broken filter.
    expect(await screen.findByText(/Every Backer arrived organically/)).toBeInTheDocument();
    expect(screen.queryByText(NO_AFFILIATE_RESULTS)).not.toBeInTheDocument();
  });

  it('a filter that matches no Backer says so', async () => {
    const empty = view();
    empty.backers = { rows: [], shown: '0 Backers shown', page: 1, pageSize: 50, total: 0, hasMore: false };
    serve([backersRoute(empty)]);
    await renderAt('/admin/backers?view=backers');
    expect(await screen.findByText(NO_BACKERS_MATCH)).toBeInTheDocument();
  });

  it('a cell with nothing to show names what it is waiting for', async () => {
    const waiting = view();
    waiting.affiliateResults.rows[0]!.timeActive = null;
    waiting.affiliateResults.rows[0]!.timeActiveWaitingOn =
      'The tracking link has not been activated, so there is no active period yet (§18).';
    waiting.affiliateResults.rows[0]!.average = null;
    serve([backersRoute(waiting)]);
    await renderAt('/admin/backers');

    // §16a: not yet populated is not zero. Never "0 days", never "US$0.00".
    expect(await screen.findByText(/has not been activated/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('US$0.00');
  });
});

/* ── 9. Accessibility (§33.11, §28.5) ──────────────────────────────────────── */

describe('accessibility', () => {
  it('the Affiliate view has no axe violations', async () => {
    serve([backersRoute(view())]);
    const { container } = await renderAt('/admin/backers');
    await screen.findByRole('heading', { name: 'Who brought in what' });
    expect(await axe(container)).toHaveNoViolations();
  });

  it('the Backer view has no axe violations, including the answers cell', async () => {
    serve([backersRoute(view())]);
    const { container } = await renderAt('/admin/backers?view=backers');
    await screen.findByRole('heading', { name: 'Pre-orders and checkout answers' });
    expect(await axe(container)).toHaveNoViolations();
  });

  it('every filter control has a real label', async () => {
    serve([backersRoute(view())]);
    await renderAt('/admin/backers?view=backers');
    await screen.findByRole('heading', { name: 'Pre-orders and checkout answers' });
    expect(screen.getByLabelText('Campaign')).toBeInTheDocument();
    expect(screen.getByLabelText('Affiliate')).toBeInTheDocument();
    expect(screen.getByLabelText('Find Backer')).toBeInTheDocument();
  });

  it('the view tabs are keyboard reachable and announce which is current', async () => {
    const user = userEvent.setup();
    serve([backersRoute(view())]);
    await renderAt('/admin/backers');

    const affiliates = await screen.findByRole('button', { name: 'Affiliate results' });
    expect(affiliates).toHaveAttribute('aria-current', 'page');

    await user.click(screen.getByRole('button', { name: 'Every Backer' }));
    expect(await screen.findByRole('button', { name: 'Every Backer' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('the heading order is h1 then h2', async () => {
    serve([backersRoute(view())]);
    await renderAt('/admin/backers');
    await screen.findByRole('heading', { name: 'Who brought in what' });
    const levels = screen
      .getAllByRole('heading')
      .map((h) => Number(h.tagName.slice(1)))
      .filter((n) => n <= 3);
    expect(levels[0]).toBe(1);
    expect(levels).toContain(2);
  });
});

/* ── 10. Copy (§3.1, §3.2) ─────────────────────────────────────────────────── */

describe('the rendered copy', () => {
  it('carries no banned or internal vocabulary', async () => {
    serve([backersRoute(view())]);
    await renderAt('/admin/backers?view=backers');
    await screen.findByText('nora.blake@example.com');

    const text = document.body.textContent ?? '';
    /*
      §3.2 binds every audience including Admin, and including identifiers.
      §3.1's `reservation` is permitted in Admin, so it is deliberately not
      scanned here.

      `pledge` is the one worth naming. The reference's central noun is
      "Pledged" / "pledge" — its column head, its cell label, and its page title
      — and §3.2 bans the whole family outright with "reserve a pre-order /
      authorize a future charge" as the replacement. §1.8 decides it: the Spec
      wins, so this surface says pre-order throughout.

      There is no exemption in this loop, deliberately. An earlier draft skipped
      the `pledge` pattern on the reasoning that it was "the reference's own
      column word", which is how a banned term survives a copy test written by
      the person who introduced it. §33.11.3's bundle scan caught it anyway —
      the property name `pledged` shipped in the built bundle and survives
      minification, exactly the `progress.goal` case the Campaigns hub hit.
    */
    for (const banned of [
      /\bpledge[ds]?\b/i,
      /\bdonat(e|ed|ion|ions)\b/i,
      /\bescrow\b/i,
      /\bcustody\b/i,
      /all[- ]or[- ]nothing/i,
      /held in a Proovd account/i,
      /\bMBP\b/,
      /\btranche\b/i,
      /\bgoals?\b/i,
    ]) {
      expect(text, `banned term ${banned}`).not.toMatch(banned);
    }
    // Internal §3.1 names must never render.
    expect(text).not.toMatch(/pre_build|pre_launch|affiliate_compensation|captured_charge/);
  });

  it('renders no identifier where a word belongs', async () => {
    serve([backersRoute(view())]);
    await renderAt('/admin/backers?view=backers');
    await screen.findByText('nora.blake@example.com');

    /*
      A camelCase or snake_case token in visible text is a field name that
      escaped into copy. This exists because the §3.2 `pledge` rename did
      exactly that: a mechanical replacement turned the page lede into "see each
      Backer, orderAmount, email" and labelled every amount `preorderValue`.
      Neither the copy scan nor the bundle scan could see it — the words are not
      banned, they are just not words — and only looking at the page found it.

      Scoped to this surface's own text and to tokens of two or more humps, so a
      legitimate capitalised word or a §-reference does not trip it.
    */
    const surface = document.querySelector('.bkr') as HTMLElement;
    const identifiers = visibleText(surface).match(/\b[a-z]+(?:[A-Z][a-z]+){1,}\b|\b[a-z]+_[a-z_]+\b/g) ?? [];
    expect(identifiers, `identifier(s) leaked into copy: ${identifiers.join(', ')}`).toEqual([]);
  });

  it('never claims real time (§30)', async () => {
    serve([backersRoute(view())]);
    await renderAt('/admin/backers');
    await screen.findByRole('heading', { name: 'Who brought in what' });
    expect(document.body.textContent).not.toMatch(/real[- ]time|live count|updating now/i);
  });
});
