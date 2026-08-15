/**
 * The Founder Admin workspace, as a person actually meets it — Spec §26.1,
 * §26.2, §1.1, §1.4, §3.1, §9, §27.1, §27.7, §30, §33.11.
 *
 * Three old suites went out with the surfaces they covered. This is the
 * replacement, and it is deliberately a *surface* suite: the register drift and
 * the pure derivations are already proved in
 * `backend/src/tests/founder-workspace-registers.test.ts`, and re-asserting them
 * through a rendered DOM would be the same fact checked twice in the weaker
 * place. What is only checkable here is what a person sees and can operate.
 *
 * ── Everything below is driven by a payload, because the surface decides ────
 * `readFounderWorkspace` resolves every word, every status, and — crucially —
 * `header.availableActions`. So the fixtures are the lever: a menu is asserted
 * against a payload that permits two actions, the money pane against one whose
 * payments are unpopulated, the overrides against one where exactly one field
 * differs from the profile. A test that hardcoded the expected menu would be a
 * second answer to "what is possible against this record", which is the thing
 * `FounderWorkspace.tsx`'s header says it must never become.
 *
 * ── The motion runtime is installed, and that is what makes a toast visible ──
 * `window.Proovd` is absent in jsdom by design (see `frontend/vitest.config.ts`),
 * so `useToast()` is a no-op and a parked control's whole observable behaviour
 * disappears. §1.4 makes that behaviour the point — a parked control exists to
 * SAY what its destination is — so a recording double is installed here. GSAP is
 * still absent, so every animation takes its documented jump-cut path and
 * nothing in this file waits on a tween.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { createMemoryRouter, RouterProvider } from 'react-router';
import {
  ATTENTION_CHIP_LABEL,
  CREATOR_MATCH_CAVEAT,
  IDENTITY_CHECK_HELPER,
  NO_ACTIVE_CAMPAIGN_LABEL,
  NO_ATTENTION_ROW_LABEL,
  PARKED_MESSAGES,
  STATE_QUESTIONS,
  SUMMARY_IS_NOT_ADMIN_WRITABLE,
  SUMMARY_NOT_CHOSEN_LABEL,
  campaignStatusLabel,
  missingStateQuestions,
  overrideHelper,
} from '@proovd/shared';
import { appRoutes } from '../../../routes.js';
import { installQaServer, type StubRoute } from '../../qa/server.js';
import type {
  AdminIdentity,
  FounderListRow,
  FounderWorkspaceDetail,
} from '../api.js';

/* ── The recording motion runtime ──────────────────────────────────────────── */

interface RecordedToast {
  message: string;
  sub: string | undefined;
}

let toasts: RecordedToast[] = [];

/** The tokens `anim.ts` reads. Never reached here — GSAP is absent — but a
 *  runtime missing them would be a different double from the real one. */
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
    toast: (message: string, opts?: { sub?: string }) => {
      toasts.push({ message, sub: opts?.sub });
    },
    // The real morph swallows a rejected `work` and restores the button; the
    // double does the same, because `ConfirmDialog` reads the refusal back out
    // afterwards rather than letting it propagate.
    buttonProgress: async (_element: HTMLElement, work: Promise<unknown>) => {
      try {
        await work;
      } catch {
        /* the real runtime restores the button and resolves */
      }
    },
  };
}

function toastMessages(): string[] {
  return toasts.map((entry) => entry.message);
}

/* ── The stub server, with every request recorded ──────────────────────────── */

interface RecordedRequest {
  method: string;
  url: string;
  body: string | null;
}

let requests: RecordedRequest[] = [];

/**
 * Installs the shared QA stub and wraps it so the suite can assert what was
 * NOT sent — which is the whole of the "a blank required field does not reach
 * the server" test, and is not observable from the DOM.
 */
function serve(routes: StubRoute[]): void {
  // `/admin/*` is behind a role guard now, so every render begins by asking who
  // is signed in — before any Admin request is made. Prepended here rather than
  // added to each test's route list: this file has dozens, and a session stub
  // that has to be remembered per test is one that is eventually forgotten,
  // which surfaces as a ten-second timeout blaming the surface.
  //
  // A test that wants a different session puts its own `/api/account/me` route
  // in `routes` — first match wins, and `routes` is searched first.
  installQaServer([
    ...routes,
    {
      match: /\/api\/account\/me$/,
      body: { account: { role: 'admin', email: 'admin@proovd.example', name: 'An Admin' } },
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

/** A read that is accepted and never answered — what a slow link looks like. */
function hangOn(pattern: RegExp, routes: StubRoute[]): void {
  serve(routes);
  const stubbed = globalThis.fetch;
  vi.stubGlobal('fetch', (input: unknown, init?: RequestInit) =>
    pattern.test(String(input))
      ? new Promise<Response>(() => {})
      : stubbed(input as RequestInfo, init),
  );
}

function requestsTo(pattern: RegExp): RecordedRequest[] {
  return requests.filter((request) => pattern.test(request.url));
}

/* ── The one Founder every test in this file is about ──────────────────────── */

const PROSPECT = 'prospect-rae';
const QUIET_PROSPECT = 'prospect-nils';
const CAMPAIGN = 'camp-bench-lamp';
const PRODUCT = 'The Bench Lamp';

/**
 * §23.1's own worked example, on purpose.
 *
 * `affiliate_response_and_build` is the lifecycle value §26.1's register names
 * when it explains why a label register exists at all — and it contains a word
 * §3.1 forbids reaching a Founder. Using it as the fixture's raw status is what
 * makes the naming test below mean something: the pane must render "Building
 * campaign and waiting for Creators", and the raw value must stay behind the
 * Technical-details disclosure where the pane says it put it.
 */
const RAW_STATUS = 'affiliate_response_and_build' as const;
const STATUS_LABEL = campaignStatusLabel(RAW_STATUS);

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

function raeRow(): FounderListRow {
  return {
    prospectId: PROSPECT,
    legalName: 'Rae Harlow',
    preferredName: 'Rae',
    email: 'rae@harlow.example',
    productName: PRODUCT,
    setup: { stage: 'Setup complete', detail: 'Answers submitted Aug 1, 2026' },
    account: 'Active',
    paymentSetup: 'Complete',
    currentCampaign: { campaignId: CAMPAIGN, name: PRODUCT, status: STATUS_LABEL },
    attention: {
      needed: true,
      text: 'The W-9 has not been requested for this campaign yet.',
      action: { label: 'Open the money record', act: 'jump-money' },
    },
  };
}

/** A second person, with nothing outstanding — the other half of §26.1's chip. */
function quietRow(): FounderListRow {
  return {
    prospectId: QUIET_PROSPECT,
    legalName: 'Nils Aro',
    preferredName: 'Nils',
    email: 'nils@aro.example',
    productName: 'Field Notebook',
    setup: { stage: 'Invite sent', detail: null },
    account: 'Not created yet',
    paymentSetup: 'Not started',
    currentCampaign: null,
    attention: { needed: false },
  };
}

function workspaceFixture(): FounderWorkspaceDetail {
  return {
    header: {
      prospectId: PROSPECT,
      legalName: 'Rae Harlow',
      preferredName: 'Rae',
      businessName: 'Harlow Instruments LLC',
      website: 'https://example.com/harlow',
      email: 'rae@harlow.example',
      phone: '+1 555 0100',
      phoneVerified: false,
      state: 'NY',
      country: 'US',
      sticker: 7,
      account: 'Active',
      setup: { stage: 'Setup complete', detail: null },
      paymentSetup: 'Complete',
      currentCampaign: { campaignId: CAMPAIGN, name: PRODUCT, status: STATUS_LABEL },
      attention: {
        needed: true,
        text: 'The W-9 has not been requested for this campaign yet.',
        action: { label: 'Open the money record', act: 'jump-money' },
      },
      availableActions: ['edit', 'newinvite', 'cancelinvite', 'suspend', 'ban'],
    },
    overview: {
      invitation: {
        state: 'Invite accepted',
        stateAt: 'Accepted Aug 2, 2026 · 12:10 PM',
        meaning: 'Rae used the invitation and completed the account-claim step.',
        invitedBy: 'Sam Okafor',
        source: 'Proovd research',
        owner: 'Sam Okafor',
        overrides: [
          {
            key: 'recipientName',
            label: 'Recipient name',
            value: 'Rae Harlow',
            profileValue: 'Rae Harlow',
            overridden: false,
            helper: overrideHelper('recipientName', 'Rae', false, 'Rae Harlow'),
          },
          {
            // The one that differs, so the two helper sentences are both on
            // screen at once and can be told apart.
            key: 'product',
            label: 'Product',
            value: 'The Bench Lamp (pilot batch)',
            profileValue: PRODUCT,
            overridden: true,
            helper: overrideHelper('product', 'Rae', true, PRODUCT),
          },
        ],
        content: [
          {
            key: 'invSource',
            label: 'How we found this Founder',
            value: 'Proovd research',
            helper: null,
          },
          { key: 'invOwner', label: 'Proovd owner', value: 'Sam Okafor', helper: null },
          {
            key: 'invKnow',
            label: 'What we know so far',
            value: 'A machined desk lamp for people who solder at a kitchen table.',
            helper: null,
          },
        ],
        fixedContent: [
          {
            key: 'invSupport',
            label: 'Support contact',
            value: 'support@proovd.co',
          },
        ],
        unresolvedMarkers: [],
        missingBeforeSend: [],
        canSend: true,
        history: [
          {
            at: 'Aug 1, 2026 · 9:00 AM',
            title: 'Invitation sent',
            body: 'Sent to rae@harlow.example by Sam Okafor.',
          },
        ],
        technical:
          'Token version 1 · expires Aug 15, 2026. The link value itself is never stored.',
      },
      vetting: {
        progress: [
          { label: 'Problem answered', done: true },
          { label: 'Solution answered', done: true },
          { label: 'Amount of views chosen', done: true },
        ],
        progressStatus: '3 of 3 questions completed',
        campaignType: 'Product Campaign',
        campaignTypeAt: 'Aug 1, 2026 · 10:00 AM',
        campaignTypeSelected: 'Product Campaign',
        campaignTypeSelectedRaw: 'pre_launch',
        campaignTypeEditable: false,
        draftId: 'draft-1',
        answers: [
          {
            key: 'problem',
            label: 'Problem',
            text: 'Benches are lit by ceiling lights that cast a shadow over the board.',
            provenance: 'Originally prepared by Proovd · Last edited by Rae',
            editable: false,
          },
          {
            key: 'solution',
            label: 'Solution',
            text: 'A clamp lamp with a 96 CRI head and a magnetic arm that holds position.',
            provenance: 'Written by Rae',
            editable: false,
          },
          {
            key: 'views',
            label: 'Amount of views',
            text: '10,000 – 100,000',
            provenance: 'Chosen by Rae',
            editable: false,
          },
          {
            key: 'competition',
            label: 'Competition',
            text: 'Two incumbents sell at US$300 and neither publishes a colour figure.',
            provenance: 'Written by Rae',
            editable: false,
          },
        ],
        lastSaved: 'Last saved Aug 1, 2026 · 9:42 AM',
        creatorMatches: { count: 12, recordedAt: 'Aug 2, 2026 · 12:00 PM' },
      },
      accountCreatedAt: 'Aug 2, 2026 · 12:10 PM',
      signInMethod: 'Email and password',
    },
    details: {
      personal: [
        { key: 'preferred', label: 'Preferred name', value: 'Rae', helper: null, editable: true },
        { key: 'legal', label: 'Legal name', value: 'Rae Harlow', helper: null, editable: true },
        {
          key: 'email',
          label: 'Email',
          value: 'rae@harlow.example',
          helper: null,
          editable: true,
        },
        {
          key: 'phone',
          label: 'Phone',
          value: '+1 555 0100',
          helper: 'Phone number has not been verified, and the MVP has no way to verify one.',
          editable: true,
        },
        { key: 'photo', label: 'Profile photo', value: null, helper: null, editable: false },
      ],
      business: [
        {
          key: 'bizLegal',
          label: 'Legal business name',
          value: 'Harlow Instruments LLC',
          helper: null,
          editable: true,
        },
        { key: 'product', label: 'Product / startup name', value: PRODUCT, helper: null, editable: true },
      ],
      preferences: [
        {
          key: 'summary',
          label: 'Activity summary',
          value: SUMMARY_NOT_CHOSEN_LABEL,
          helper: SUMMARY_IS_NOT_ADMIN_WRITABLE,
          editable: false,
        },
      ],
      standing: {
        value: 'Active',
        detail: 'No enforcement action has ever been recorded against this Founder.',
        owner: null,
        startedAt: null,
        nextReviewAt: null,
      },
      ban: null,
      deletionRequest: null,
    },
    campaigns: {
      current: {
        campaignId: CAMPAIGN,
        name: PRODUCT,
        type: 'Product Campaign',
        status: STATUS_LABEL,
        rawStatus: RAW_STATUS,
        buildStatus: 'In progress',
        rosterReadiness: 'Waiting for Creator decisions',
        review: null,
        listing: 'Listing fee paid Aug 5, 2026',
        opensAt: null,
        closesAt: null,
        issue: null,
      },
      previous: [],
      next: null,
    },
    money: {
      setup: {
        value: 'Complete',
        body: 'Stripe has everything it needs to charge Backers on Rae’s account and to pay Rae.',
        action: null,
      },
      identity: { value: 'Verified by Stripe', helper: IDENTITY_CHECK_HELPER },
      stripe: {
        accountId: 'acct_test_harlow',
        requirements: 'Nothing outstanding',
        lastUpdated: 'Aug 10, 2026 · 10:00 AM',
        capability: 'Charges and payouts enabled',
      },
      listings: [
        {
          campaignId: CAMPAIGN,
          campaignName: PRODUCT,
          lines: [
            { label: 'Base listing fee', amount: 'US$35.00', sub: false },
            { label: 'Sales tax', amount: 'US$2.56', sub: true },
            { label: 'Charged', amount: 'US$37.56', sub: false },
          ],
          status: 'Paid Aug 5, 2026',
        },
      ],
      w9: {
        value: 'Not requested yet',
        line: 'A W-9 is requested once the campaign closes and something has been captured.',
        action: null,
      },
      // §16a's rule, and the reason this pane exists in its own test below.
      payments: {
        populated: false,
        waitingOn: 'The campaign has not closed, so no Founder payment exists to show.',
        value: null,
      },
      blockers: [],
      pricing: null,
    },
    history: [
      {
        category: 'invite',
        at: 'Aug 1, 2026 · 9:00 AM',
        occurredAt: '2026-08-01T09:00:00.000Z',
        title: 'Invitation sent',
        body: 'Sent to rae@harlow.example by Sam Okafor.',
        reason: null,
        audit: null,
        source: 'campaign_invitation_sends',
      },
      {
        category: 'admin',
        at: 'Aug 2, 2026 · 12:00 PM',
        occurredAt: '2026-08-02T12:00:00.000Z',
        title: 'Creator relevance signal recorded',
        body: CREATOR_MATCH_CAVEAT,
        reason: 'Recorded after reviewing twelve channels in this niche.',
        audit: {
          by: 'Sam Okafor',
          field: 'possible_creator_results.count',
          priorValue: 'Not recorded',
          newValue: '12',
          reason: 'Recorded after reviewing twelve channels in this niche.',
          evidence: 'Research notes filed with the prospect record.',
          at: 'Aug 2, 2026 · 12:00 PM',
        },
        source: 'possible_creator_results',
      },
    ],
    historyCounts: {
      invite: 1,
      account: 0,
      campaign: 0,
      money: 0,
      support: 0,
      admin: 1,
      enforcement: 0,
    },
  };
}

/* ── Route tables ──────────────────────────────────────────────────────────── */

const ME: StubRoute = { match: /\/api\/admin\/me$/, body: identity };

function adminRoutes(
  options: {
    founders?: FounderListRow[];
    workspace?: FounderWorkspaceDetail;
    before?: StubRoute[];
  } = {},
): StubRoute[] {
  return [
    ...(options.before ?? []),
    ME,
    {
      match: /\/api\/admin\/founders\/[^/?]+(\?.*)?$/,
      body: options.workspace ?? workspaceFixture(),
    },
    {
      match: /\/api\/admin\/founders(\?.*)?$/,
      body: { founders: options.founders ?? [raeRow(), quietRow()] },
    },
  ];
}

/* ── Rendering ─────────────────────────────────────────────────────────────── */

type Rendered = RenderResult & { router: ReturnType<typeof createMemoryRouter> };

function mount(path: string): Rendered {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  const view = render(<RouterProvider router={router} />);
  return Object.assign(view, { router });
}

/** Mounts and settles on the arrival of the surface's own `h1`. */
async function renderAdmin(path: string): Promise<Rendered> {
  const view = mount(path);
  await waitFor(() => {
    expect(view.container.querySelector('h1'), `no h1 rendered at ${path}`).not.toBeNull();
  });
  return view;
}

async function renderList(): Promise<Rendered> {
  const view = await renderAdmin('/admin/founders');
  await screen.findByRole('table');
  return view;
}

async function renderWorkspace(): Promise<Rendered> {
  const view = await renderAdmin(`/admin/founders/${PROSPECT}`);
  await screen.findByRole('tablist', { name: 'Founder workspace' });
  return view;
}

/**
 * What a reader sees, with a space where the markup puts a gap.
 *
 * `textContent` concatenates adjacent nodes with nothing between them, so a
 * `dt`/`dd` pair reads as one word that is in neither — Phase 23a's own finding,
 * and the reason every scanner in this file reads through here.
 */
function visibleText(root: HTMLElement): string {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  while (walker.nextNode()) parts.push(walker.currentNode.textContent ?? '');
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** The `.frow` a given `dt` label belongs to. */
function rowFor(root: HTMLElement, label: string): HTMLElement {
  const term = [...root.querySelectorAll('dt')].find(
    (node) => (node.textContent ?? '').trim() === label,
  );
  expect(term, `no row labelled “${label}”`).toBeDefined();
  const row = term!.closest('.frow');
  expect(row, `“${label}” is not inside a .frow`).not.toBeNull();
  return row as HTMLElement;
}

function controlsIn(root: HTMLElement): HTMLElement[] {
  return [
    ...root.querySelectorAll<HTMLElement>(
      'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"]',
    ),
  ];
}

const PANE_LABELS = ['Overview', 'Details', 'Campaigns', 'Money', 'History'] as const;

async function openTab(user: ReturnType<typeof userEvent.setup>, label: string): Promise<void> {
  await user.click(screen.getByRole('tab', { name: label }));
  await waitFor(() => {
    expect(screen.getByRole('tab', { name: label })).toHaveAttribute('aria-selected', 'true');
  });
}

beforeEach(() => {
  installMotionRuntime();
  serve(adminRoutes());
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as { Proovd?: unknown }).Proovd;
});

/* ── 1. The shell ──────────────────────────────────────────────────────────── */

describe('§26, §1.4 — the Admin shell says what exists and what does not', () => {
  it('renders the wordmark, the six sections, and marks only the current one active', async () => {
    const { container } = await renderList();

    expect(container.querySelector('.wordmark')?.textContent).toBe('proovdAdmin');

    const nav = screen.getByRole('navigation', { name: 'Admin sections' });
    expect([...nav.children].map((child) => child.textContent)).toEqual([
      'Today',
      'Founders',
      'Campaigns',
      'Backers',
      'Creators',
      'Support',
    ]);

    // Founders, Campaigns, Backers, Creators, and Support are the destinations
    // that exist, so they are the anchors — and only the one being viewed
    // carries the active state. Today is the one section still parked. The
    // order is the shell's, not this list's: asserting the exact children is
    // what caught Support being added and then Backers, which is the whole
    // reason this reads them positionally rather than by name.
    const founders = within(nav).getByRole('link', { name: 'Founders' });
    expect(founders).toHaveAttribute('href', '/admin/founders');
    expect(founders.className).toContain('is-active');
    const backers = within(nav).getByRole('link', { name: 'Backers' });
    expect(backers).toHaveAttribute('href', '/admin/backers');
    expect(backers.className).not.toContain('is-active');
    const creators = within(nav).getByRole('link', { name: 'Creators' });
    expect(creators).toHaveAttribute('href', '/admin/creators');
    expect(creators.className).not.toContain('is-active');
    const support = within(nav).getByRole('link', { name: 'Support' });
    expect(support).toHaveAttribute('href', '/admin/support');
    expect(support.className).not.toContain('is-active');
    expect(container.querySelectorAll('.navlink.is-active')).toHaveLength(1);
  });

  it('keeps the parked sections operable rather than removing them', async () => {
    await renderList();
    const nav = screen.getByRole('navigation', { name: 'Admin sections' });

    // Creators left this list on 2026-08-11, Support on 2026-08-13, and
    // Campaigns on 2026-08-15, each when its workspace was built. Today is the
    // one that remains, and it genuinely does not exist.
    for (const label of ['Today']) {
      const control = within(nav).getByRole('button', { name: label });
      // `aria-disabled`, never `disabled`: a disabled button leaves a keyboard
      // user with nothing at all where a sighted user sees a greyed section and
      // can find out why (§28.5, §33.11.2).
      expect(control.tagName).toBe('BUTTON');
      expect(control).toHaveAttribute('aria-disabled', 'true');
      expect(control).not.toBeDisabled();
      expect(control).not.toHaveAttribute('tabindex', '-1');
    }

    // The topbar's other parked control, on the same terms.
    const explore = screen.getByRole('button', { name: 'Explore' });
    expect(explore).toHaveAttribute('aria-disabled', 'true');
    expect(explore).not.toBeDisabled();
  });

  it('reaches the parked sections by keyboard, behind the skip link', async () => {
    const user = userEvent.setup();
    await renderList();

    await user.tab();
    expect(document.activeElement).toHaveClass('skip-link');
    await user.tab();
    expect(document.activeElement).toHaveTextContent('Today');
  });

  it('answers a parked section with what it is, and does not navigate', async () => {
    const user = userEvent.setup();
    const { router } = await renderList();

    await user.click(screen.getByRole('button', { name: 'Today' }));

    expect(toastMessages()).toContain(PARKED_MESSAGES.tabs);
    expect(router.state.location.pathname).toBe('/admin/founders');
  });

  /**
   * The Campaigns hub landed on 2026-08-15, so the shell's fourth real link is
   * asserted here beside the three that were already links — the positional
   * check above catches a section being ADDED, and this catches one silently
   * going back to parked.
   */
  it('renders Campaigns as a real link', async () => {
    await renderList();
    const nav = screen.getByRole('navigation', { name: 'Admin sections' });

    const campaigns = within(nav).getByRole('link', { name: 'Campaigns' });
    expect(campaigns).toHaveAttribute('href', '/admin/campaigns');
    expect(campaigns.className).not.toContain('is-active');
    expect(within(nav).queryByRole('button', { name: 'Campaigns' })).toBeNull();
  });
});

/* ── 2. The list ───────────────────────────────────────────────────────────── */

describe('§26.1 — the Founders table', () => {
  it('renders exactly the eight columns, in order', async () => {
    await renderList();
    expect(
      screen.getAllByRole('columnheader').map((cell) => cell.textContent),
    ).toEqual([
      'Founder',
      'Email',
      'Setup',
      'Account',
      'Payment setup',
      'Current campaign',
      'Campaign status',
      'Attention',
    ]);
  });

  it('shows the founder, setup, account, payment setup, campaign, and attention', async () => {
    await renderList();
    const row = screen.getByRole('link', { name: 'Rae Harlow' }).closest('tr') as HTMLElement;

    // The product sits under the name; the campaign is its own control in the
    // sixth column, and both happen to be called the same thing here.
    expect(row.querySelector('.fdr-sub')).toHaveTextContent(PRODUCT);
    expect(within(row).getByText('rae@harlow.example')).toBeInTheDocument();
    expect(within(row).getByText('Setup complete')).toBeInTheDocument();
    expect(within(row).getByText('Answers submitted Aug 1, 2026')).toBeInTheDocument();
    expect(within(row).getByText('Active')).toBeInTheDocument();
    expect(within(row).getByText('Complete')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: PRODUCT })).toBeInTheDocument();
    expect(within(row).getByText(STATUS_LABEL)).toBeInTheDocument();
  });

  it('chips only the row that needs attention, and names the other state', async () => {
    await renderList();
    const rae = screen.getByRole('link', { name: 'Rae Harlow' }).closest('tr') as HTMLElement;
    const nils = screen.getByRole('link', { name: 'Nils Aro' }).closest('tr') as HTMLElement;

    expect(within(rae).getByText(ATTENTION_CHIP_LABEL)).toBeInTheDocument();
    expect(within(rae).getByText(/W-9 has not been requested/)).toBeInTheDocument();

    // Not a blank cell: an empty attention column reads as missing data rather
    // than as a done-moment (DNA §5.4).
    expect(within(nils).queryByText(ATTENTION_CHIP_LABEL)).toBeNull();
    expect(within(nils).getByText(NO_ATTENTION_ROW_LABEL)).toBeInTheDocument();
    expect(within(nils).getByText(NO_ACTIVE_CAMPAIGN_LABEL)).toBeInTheDocument();
  });

  it('opens the workspace when the row is clicked', async () => {
    const user = userEvent.setup();
    const { router } = await renderList();
    const row = screen.getByRole('link', { name: 'Rae Harlow' }).closest('tr') as HTMLElement;

    // A press on an ordinary cell, not on a control of its own.
    await user.click(within(row).getByText('rae@harlow.example'));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/admin/founders/${PROSPECT}`);
    });
  });

  it('opens it from the keyboard through the name, not through a bare tabindex', async () => {
    const user = userEvent.setup();
    const { router } = await renderList();
    const link = screen.getByRole('link', { name: 'Rae Harlow' });
    const row = link.closest('tr') as HTMLElement;

    // The row itself is deliberately not focusable: a `tabindex` on a `<tr>` is
    // focusable without being announced as anything, and `role="button"` on one
    // breaks the table's required children. The name is the control.
    expect(row).not.toHaveAttribute('tabindex');

    link.focus();
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/admin/founders/${PROSPECT}`);
    });
  });

  it('answers the campaign link with what it is, and does not navigate', async () => {
    const user = userEvent.setup();
    const { router } = await renderList();
    const row = screen.getByRole('link', { name: 'Rae Harlow' }).closest('tr') as HTMLElement;

    await user.click(within(row).getByRole('button', { name: PRODUCT }));

    expect(toastMessages()).toContain(PARKED_MESSAGES.campaign);
    // Two answers to one press is the worst of both behaviours, which is why
    // the parked handler stops the row's own click.
    expect(router.state.location.pathname).toBe('/admin/founders');
  });
});

/* ── 3. The list's other three states ──────────────────────────────────────── */

/**
 * §27.1's six questions, minus the one an Admin surface has no destination for.
 *
 * Question 6 asks how the reader gets help without losing context. On every
 * other surface in the product that is a route to Proovd; here the reader IS
 * Proovd, and there is no second desk. Adding a `Get help` control would claim
 * a destination that does not exist (§1.4), so the question is excluded by name
 * — checked and scoped rather than silently satisfied — and the remaining five
 * are asserted in full. `qa.test.tsx` excludes admin audiences from this sweep
 * entirely; this is deliberately stricter than that.
 */
const ADMIN_ANSWERABLE = STATE_QUESTIONS.filter(
  (question) => question !== 'how_do_they_get_help_without_losing_context',
);

function unansweredQuestions(container: HTMLElement): string[] {
  const operable = controlsIn(container).filter((control) => !control.hasAttribute('disabled'));
  return missingStateQuestions(visibleText(container), {
    hasControl: operable.length > 0,
  }).filter((question) => (ADMIN_ANSWERABLE as readonly string[]).includes(question));
}

describe('§27.1, §1.1 — loading, empty, and failure each answer for themselves', () => {
  it('says what it is waiting for while the list is being read', async () => {
    hangOn(/\/api\/admin\/founders/, adminRoutes());
    const { container } = await renderAdmin('/admin/founders');

    expect(await screen.findByText('Reading the Founders list')).toBeInTheDocument();
    expect(unansweredQuestions(container)).toEqual([]);
    expect(screen.getAllByText('Admin · Founders').length).toBeGreaterThan(0);
  });

  it('says nobody has been recorded rather than showing an empty table', async () => {
    serve(adminRoutes({ founders: [] }));
    const { container } = await renderAdmin('/admin/founders');

    expect(await screen.findByText('No Founders yet')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    // An empty list is a state somebody can act on, so the panel carries the
    // one action that changes it.
    expect(screen.getAllByRole('button', { name: 'Add founder' }).length).toBeGreaterThan(0);
    expect(unansweredQuestions(container)).toEqual([]);
  });

  it('renders the failure instead of a half page, and offers the retry', async () => {
    serve(
      adminRoutes({
        before: [
          {
            match: /\/api\/admin\/founders(\?.*)?$/,
            status: 503,
            body: {
              error: 'unavailable',
              title: 'Proovd could not be reached',
              whatHappened: 'The Founders list could not be read.',
              next: 'Try the read again. Nothing was changed by the attempt.',
            },
          },
        ],
      }),
    );
    const { container } = await renderAdmin('/admin/founders');

    expect(await screen.findByText('Proovd could not be reached')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try the read again' })).toBeInTheDocument();

    // Half a page is worse than none: a table header with no rows reads as
    // "this Founder has no record" rather than "the read failed".
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('columnheader')).toBeNull();
    expect(screen.queryByText('Rae Harlow')).toBeNull();

    expect(unansweredQuestions(container)).toEqual([]);
  });
});

/* ── 4. The workspace shell ────────────────────────────────────────────────── */

describe('§26.1 — one person, five panes', () => {
  it('titles the page with the person and renders exactly one h1', async () => {
    const { container } = await renderWorkspace();
    const headings = [...container.querySelectorAll('h1')];
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent('Rae Harlow');
  });

  it('renders the five tabs and switches between them', async () => {
    const user = userEvent.setup();
    await renderWorkspace();

    const tablist = screen.getByRole('tablist', { name: 'Founder workspace' });
    expect(within(tablist).getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      ...PANE_LABELS,
    ]);
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('heading', { name: 'Invitation', level: 2 })).toBeInTheDocument();

    await openTab(user, 'Money');
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    expect(screen.getByRole('heading', { name: 'Payment setup', level: 2 })).toBeInTheDocument();
    // Only the active pane is mounted — a hidden pane is still in the
    // accessibility tree and still runs its effects.
    expect(screen.queryByRole('heading', { name: 'Invitation', level: 2 })).toBeNull();
  });

  it('shows the five header statuses and the attention the payload carried', async () => {
    const { container } = await renderWorkspace();
    const status = container.querySelector('.fstatus') as HTMLElement;

    expect([...status.querySelectorAll('dt')].map((term) => term.textContent)).toEqual([
      'Account',
      'Founder setup',
      'Payment setup',
      'Current campaign',
      'Campaign status',
    ]);
    expect(within(status).getByText(STATUS_LABEL)).toBeInTheDocument();

    expect(screen.getByText(ATTENTION_CHIP_LABEL)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open the money record' })).toBeInTheDocument();
  });

  it('offers exactly the actions the payload permits, and nothing else', async () => {
    const user = userEvent.setup();
    const detail = workspaceFixture();
    // A record that has been invited and not yet claimed: the invitation can be
    // sent, and nothing else is possible against it.
    detail.header.availableActions = ['edit', 'sendinvite'];
    serve(adminRoutes({ workspace: detail }));

    await renderWorkspace();
    await user.click(screen.getByRole('button', { name: 'More actions' }));

    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Edit Founder information',
      'Send invite',
    ]);

    // The menu is built by walking `availableActions`; there is no branch that
    // could put a decision in front of an Admin the record does not permit.
    for (const absent of [
      'Send a new invite',
      'Cancel current invite',
      'Suspend Founder access',
      'Restore Founder access',
      'Permanently ban Founder',
      'Review account deletion request',
    ]) {
      expect(within(menu).queryByRole('menuitem', { name: absent })).toBeNull();
    }
  });
});

/* ── 5. The setup answers ──────────────────────────────────────────────────── */

describe('the setup answers are the Founder’s own, with legacy Competition preserved', () => {
  it('renders every answer with its provenance and no way to change any of them', async () => {
    const { container } = await renderWorkspace();

    const answerRows = [...container.querySelectorAll('.frow')].filter((row) =>
      row.querySelector('dd.fanswer'),
    ) as HTMLElement[];

    expect(answerRows.map((row) => row.querySelector('dt')?.textContent)).toEqual([
      'Problem',
      'Solution',
      'Amount of views',
      'Competition',
    ]);

    for (const row of answerRows) {
      const label = row.querySelector('dt')?.textContent;
      // An Admin correcting a Founder's answer is a support case, not a field
      // edit — which is why `FOUNDER_EDITABLE_FIELDS` has no entry for any of
      // them and this pane has nothing to offer. Competition is a legacy
      // answer: the simplified flow no longer asks it, and a recorded one
      // still renders read-only.
      expect(controlsIn(row), `“${label}” offers a control`).toEqual([]);
    }

    expect(
      screen.queryByRole('button', { name: /^Edit (Problem|Solution|Competition|Amount of views)$/ }),
    ).toBeNull();
    expect(screen.getByText('Originally prepared by Proovd · Last edited by Rae')).toBeInTheDocument();
  });
});

/* ── 6. The activity summary ───────────────────────────────────────────────── */

describe('§27.7, §30 — Proovd never chooses a summary frequency for somebody', () => {
  it('shows the preference read-only, with the reason it cannot be set here', async () => {
    const user = userEvent.setup();
    const { container } = await renderWorkspace();
    await openTab(user, 'Details');

    const row = rowFor(container, 'Activity summary');
    expect(within(row).getByText(SUMMARY_NOT_CHOSEN_LABEL)).toBeInTheDocument();

    // Read-only with no explanation reads as a bug an Admin will file rather
    // than a rule the product is keeping (§1.4).
    expect(within(row).getByText(SUMMARY_IS_NOT_ADMIN_WRITABLE)).toBeInTheDocument();
    expect(controlsIn(row)).toEqual([]);

    // And nothing anywhere on the pane could set one: no closed list, no
    // toggle, and no control that names the preference.
    const pane = screen.getByRole('tabpanel');
    expect(pane.querySelectorAll('select, [role="radiogroup"], [role="switch"]')).toHaveLength(0);
    expect(within(pane).queryByRole('button', { name: /summary/i })).toBeNull();
    expect(within(pane).queryByText(/Daily summary|Weekly summary/)).toBeNull();
  });
});

/* ── 7. Invitation overrides ───────────────────────────────────────────────── */

describe('§26.2 — an invitation may differ from the profile, and says so', () => {
  it('labels the overridden value as custom and offers only its reset', async () => {
    const user = userEvent.setup();
    const { container } = await renderWorkspace();

    await user.click(screen.getByRole('button', { name: 'View invitation details' }));
    const overridden = await waitFor(() => rowFor(container, 'Product'));

    expect(within(overridden).getByText('The Bench Lamp (pilot batch)')).toBeInTheDocument();
    // The sentence has to name the profile, because the Admin is looking at a
    // value that disagrees with the record and needs to know which is which.
    expect(
      within(overridden).getByText(overrideHelper('product', 'Rae', true, PRODUCT)),
    ).toBeInTheDocument();
    expect(
      within(overridden).getByRole('button', { name: 'Use Founder profile value' }),
    ).toBeInTheDocument();
    expect(
      within(overridden).queryByRole('button', { name: 'Change for this invitation' }),
    ).toBeNull();
  });

  it('labels an untouched value as auto-filled and offers only the change', async () => {
    const user = userEvent.setup();
    const { container } = await renderWorkspace();

    await user.click(screen.getByRole('button', { name: 'View invitation details' }));
    const plain = await waitFor(() => rowFor(container, 'Recipient name'));

    expect(
      within(plain).getByText(overrideHelper('recipientName', 'Rae', false, 'Rae Harlow')),
    ).toBeInTheDocument();
    expect(
      within(plain).getByRole('button', { name: 'Change for this invitation' }),
    ).toBeInTheDocument();
    expect(
      within(plain).queryByRole('button', { name: 'Use Founder profile value' }),
    ).toBeNull();

    // One override in the payload, one reset control on the page.
    expect(screen.getAllByRole('button', { name: 'Use Founder profile value' })).toHaveLength(1);
  });
});

/* ── 8. Money honesty ──────────────────────────────────────────────────────── */

describe('§16a, §1.4 — not yet populated is never a zero', () => {
  it('names what the Founder-payments section is waiting for, and shows no amount', async () => {
    const user = userEvent.setup();
    const { container } = await renderWorkspace();
    await openTab(user, 'Money');

    expect(
      screen.getByText('The campaign has not closed, so no Founder payment exists to show.'),
    ).toBeInTheDocument();

    // Every ledger column in this product defaults to 0, so a naive pane says
    // "US$0.00" for a campaign whose close batch has not run — indistinguishable
    // from one that captured nothing.
    const text = visibleText(container);
    expect(text).not.toContain('US$0.00');
    // The real amounts elsewhere on the pane still render, so this is the
    // absent section being silent rather than the whole pane.
    expect(text).toContain('US$37.56');
  });

  it('states the identity check as a status, with no document anywhere near it', async () => {
    const user = userEvent.setup();
    const { container } = await renderWorkspace();
    await openTab(user, 'Money');

    const row = rowFor(container, 'Identity check');
    expect(within(row).getByText('Verified by Stripe')).toBeInTheDocument();
    expect(within(row).getByText(IDENTITY_CHECK_HELPER)).toBeInTheDocument();
    // Nothing on this pane moves money or collects a provider-held field.
    expect(screen.getByRole('tabpanel').querySelectorAll('input, select, textarea')).toHaveLength(
      0,
    );
  });
});

/* ── 9. Decisions ──────────────────────────────────────────────────────────── */

describe('§25.6, §1.1 — a decision states itself, records a reason, and is refused without one', () => {
  const ACCESS_ROUTE = /\/api\/admin\/founders\/[^/]+\/access$/;

  function routesWithAccess(): StubRoute[] {
    return adminRoutes({
      before: [{ match: ACCESS_ROUTE, method: 'POST', body: workspaceFixture() }],
    });
  }

  async function openSuspend(
    user: ReturnType<typeof userEvent.setup>,
  ): Promise<HTMLElement> {
    await renderWorkspace();
    await openTab(user, 'Details');
    const trigger = screen.getByRole('button', { name: 'Suspend Founder access' });
    await user.click(trigger);
    await screen.findByRole('dialog');
    return trigger;
  }

  it('renders the decision’s own title and body before anything is taken', async () => {
    serve(routesWithAccess());
    const user = userEvent.setup();
    await openSuspend(user);

    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByRole('heading', { name: 'Suspend Founder access' }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        /Founder access or campaign activity will be restricted until Proovd restores it/,
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Rae Harlow · The Bench Lamp')).toBeInTheDocument();
  });

  it('does not send a decision whose required reason is blank', async () => {
    serve(routesWithAccess());
    const user = userEvent.setup();
    await openSuspend(user);

    await user.click(screen.getByRole('button', { name: 'Suspend access' }));

    // Nothing left the browser — the refusal is here only so the Admin is not
    // made to wait for a round trip to be told.
    expect(requestsTo(ACCESS_ROUTE)).toEqual([]);
    expect(await screen.findByText('This field is required.')).toBeInTheDocument();
    expect(toastMessages()).toContain('This field is required');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('sends the reason once it is there, and re-reads rather than patching locally', async () => {
    serve(routesWithAccess());
    const user = userEvent.setup();
    await openSuspend(user);

    await user.type(
      screen.getByLabelText('Reason for suspension'),
      'Reviewing a discrepancy in the delivery claims.',
    );
    await user.click(screen.getByRole('button', { name: 'Suspend access' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const sent = requestsTo(ACCESS_ROUTE);
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]!.body ?? '{}')).toMatchObject({
      action: 'suspend',
      reason: 'Reviewing a discrepancy in the delivery claims.',
    });
    expect(toastMessages()).toContain('Founder access suspended');

    // Two reads of the workspace: the first render, and the re-read the
    // mutation ends in. A merged response would be a claim about an outcome
    // nobody confirmed (§1.4).
    expect(
      requestsTo(/\/api\/admin\/founders\/[^/?]+$/).filter((r) => r.method === 'GET'),
    ).toHaveLength(2);
  });

  it('holds the permanent sanction behind a second deliberate act', async () => {
    serve(routesWithAccess());
    const user = userEvent.setup();
    await renderWorkspace();
    await openTab(user, 'Details');
    await user.click(screen.getByRole('button', { name: 'Permanently ban Founder' }));

    const dialog = await screen.findByRole('dialog');
    const primary = within(dialog).getByRole('button', { name: 'Permanently ban' });
    expect(primary).toBeDisabled();

    const acknowledgement = within(dialog).getByRole('button', {
      name: 'Acknowledge — a permanent ban cannot be lifted',
    });
    await user.click(acknowledgement);

    expect(primary).toBeEnabled();
    // The step is labelled as what it actually is: nothing in this product
    // re-authenticates from a dialog, and the server checks the session on
    // submit and refuses a stale one having changed nothing.
    expect(
      within(dialog).getByText(/Proovd checks the session when this is submitted/),
    ).toBeInTheDocument();
  });

  it('closes on Escape and puts focus back on the control that opened it', async () => {
    serve(routesWithAccess());
    const user = userEvent.setup();
    const trigger = await openSuspend(user);

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(requestsTo(ACCESS_ROUTE)).toEqual([]);
  });
});

/* ── 10. Accessibility ─────────────────────────────────────────────────────── */

describe('§33.11.1, §28.5 — the workspace is operable and announces its structure', () => {
  it('has no automatically detectable violation on the Founders list', async () => {
    const { container } = await renderList();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('has none on the workspace, with each pane active', async () => {
    const user = userEvent.setup();
    const { container } = await renderWorkspace();

    for (const label of PANE_LABELS) {
      if (label !== 'Overview') await openTab(user, label);
      expect(await axe(container), `axe violation on the ${label} pane`).toHaveNoViolations();
    }
  });

  it('gives the tabs their roles, one stop in the tab order, and a labelled panel', async () => {
    await renderWorkspace();
    const tablist = screen.getByRole('tablist', { name: 'Founder workspace' });
    const tabs = within(tablist).getAllByRole('tab');

    // Roving tabindex: the selected tab is the one tab stop, the rest are
    // reached with the arrow keys.
    expect(tabs.filter((tab) => tab.getAttribute('tabindex') === '0')).toHaveLength(1);
    expect(tabs.filter((tab) => tab.getAttribute('aria-selected') === 'true')).toHaveLength(1);

    const panel = screen.getByRole('tabpanel');
    const selected = tabs.find((tab) => tab.getAttribute('aria-selected') === 'true')!;
    expect(panel).toHaveAttribute('aria-labelledby', selected.id);
    expect(selected).toHaveAttribute('aria-controls', panel.id);

    // `aria-controls` points at a panel that is in the document; the unselected
    // tabs carry none, because their panels are not mounted.
    for (const tab of tabs.filter((candidate) => candidate !== selected)) {
      expect(tab).not.toHaveAttribute('aria-controls');
    }
  });

  it('moves between panes with the arrow keys, Home, and End', async () => {
    const user = userEvent.setup();
    await renderWorkspace();

    screen.getByRole('tab', { name: 'Overview' }).focus();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Details' }));

    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');

    // Wrapping, so the last tab is one press from the first.
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  });
});

/* ── 11. Naming ────────────────────────────────────────────────────────────── */

/**
 * §3.1 permits internal names in the Admin panel — `reservation` is the table an
 * Admin reads the ledger against. These seven are the ones that must not reach a
 * person even so: §3.1's four named substitutions, plus §3.2's three, which bind
 * every audience including internal strings because they are about honesty
 * rather than about who is reading.
 *
 * An Admin surface is also read aloud on support calls, which is the reason
 * §26.1's label register exists at all — so the fixture's lifecycle value is
 * `affiliate_response_and_build` and the panes must render its label instead.
 */
const FORBIDDEN = [
  'pre_build',
  'pre_launch',
  'affiliate',
  'reservation',
  'pledge',
  'escrow',
  'all-or-nothing',
];

function namingFailures(container: HTMLElement): string[] {
  const text = visibleText(container).toLowerCase();
  return FORBIDDEN.filter((term) => text.includes(term));
}

describe('§3.1, §3.2 — no internal name reaches the rendered surface', () => {
  it('holds on the Founders list', async () => {
    const { container } = await renderList();
    expect(namingFailures(container)).toEqual([]);
  });

  it('holds on every workspace pane', async () => {
    const user = userEvent.setup();
    const { container } = await renderWorkspace();

    for (const label of PANE_LABELS) {
      if (label !== 'Overview') await openTab(user, label);
      expect(namingFailures(container), `internal name on the ${label} pane`).toEqual([]);
    }
  });

  it('renders the lifecycle label, and keeps the raw value behind the disclosure', async () => {
    const user = userEvent.setup();
    const { container } = await renderWorkspace();
    await openTab(user, 'Campaigns');

    expect(within(container).getAllByText(STATUS_LABEL).length).toBeGreaterThan(0);
    expect(visibleText(container)).not.toContain(RAW_STATUS);

    // It is not hidden — it is one gesture below its label, which is where the
    // pane says it put it.
    await user.click(screen.getByRole('button', { name: 'Technical details' }));
    expect(await screen.findByText(RAW_STATUS)).toBeInTheDocument();
  });
});
