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
  COMMENTS_NEVER_REWRITTEN,
  CREATOR_MATCH_CAVEAT,
  ELIGIBILITY_READ_ONLY_NOTE,
  IDENTITY_CHECK_HELPER,
  MEDIATED_REQUESTS_ABSENT,
  NO_ACTIVE_CAMPAIGN_LABEL,
  NO_ATTENTION_ROW_LABEL,
  NOTIFICATION_EVENTS,
  OPERATIONS_ABSENCES,
  OPTIONAL_ITEM_CONTENT_IS_FOUNDERS,
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
    recordReference: 'F-7K3MQ',
    legalName: 'Rae Harlow',
    preferredName: 'Rae',
    email: 'rae@harlow.example',
    productName: PRODUCT,
    businessName: 'Harlow Instruments LLC',
    owner: 'Sam Okafor',
    typeLabel: 'Product',
    lifecycle: STATUS_LABEL,
    adminAction: { kind: 'due', label: 'The W-9 has not been requested for this campaign yet.' },
    founderAction: { kind: 'due', label: 'Finish the campaign build' },
    filters: ['all', 'needs_admin', 'onboarding'],
    searchText: 'rae harlow rae@harlow.example harlow instruments the bench lamp sam okafor',
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
    recordReference: 'F-9XW2H',
    legalName: 'Nils Aro',
    preferredName: 'Nils',
    email: 'nils@aro.example',
    productName: 'Field Notebook',
    businessName: null,
    owner: 'Mina Park',
    typeLabel: 'Proposed',
    lifecycle: 'Invite sent',
    adminAction: { kind: 'none', label: 'No action — Nils owns the next step' },
    founderAction: { kind: 'due', label: 'Accept the private invitation' },
    filters: ['all', 'invited'],
    searchText: 'nils aro nils@aro.example field notebook mina park',
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
      recordReference: 'F-7K3MQ',
      typeChip: 'Product · locked',
      lifecycle: STATUS_LABEL,
      adminAction: {
        kind: 'due',
        label: 'The W-9 has not been requested for this campaign yet.',
      },
      founderAction: { kind: 'due', label: 'Finish the campaign build' },
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
        facts: {
          sendCount: 1,
          tokenVersion: 1,
          expiration: 'Link inactive',
          claimed: 'Recorded Aug 2, 2026 · 12:10 PM',
          revoked: false,
        },
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
    discovery: {
      fields: [
        { key: 'invitationSource', label: 'Discovery source', value: 'Proovd research', helper: null },
        { key: 'internalOwner', label: 'Internal owner', value: 'Sam Okafor', helper: null },
        { key: 'adminNotes', label: 'Internal notes', value: null, helper: null },
        { key: null, label: 'Last contact', value: null, helper: 'A record, never a schedule (§30).' },
      ],
      research: [],
      meetingNotes: [],
    },
    eligibility: {
      claim: {
        inviteClaimed: true,
        claimedAt: 'Aug 2, 2026 · 12:10 PM',
        accountCreatedAt: 'Aug 2, 2026 · 12:10 PM',
        completion: 'Complete',
        connectedRecord: 'F-7K3MQ',
      },
      facts: {
        dobSupplied: true,
        age18Plus: true,
        usPerson: true,
        location: 'NY · US',
        sanctionsClear: true,
      },
      acknowledgements: [
        { label: 'Terms of Service', version: 'v1.0', acceptedAt: 'Aug 2, 2026 · 12:10 PM' },
      ],
      acknowledgementsAbsent: null,
    },
    campaignFacts: null,
    operations: operationsFixture(),
    communications: {
      total: 1,
      rows: [
        {
          eventKey: 'founder_invitation',
          target: 'rae@harlow.example',
          at: 'Jul 22, 2026 · 3:10 PM UTC',
          state: 'Delivered',
        },
      ],
    },
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

/** Session C: the read-and-route sections' composed state, one live campaign. */
function operationsFixture(): NonNullable<FounderWorkspaceDetail['operations']> {
  return {
    campaignId: CAMPAIGN,
    campaignName: PRODUCT,
    typeLabel: 'Product',
    statusLabel: STATUS_LABEL,
    content: {
      fields: [
        { label: 'Title', value: PRODUCT },
        { label: 'Dates', value: 'Aug 7, 2026 → Aug 20, 2026' },
        { label: 'Brand voice', value: 'Direct, calm, specific.' },
        { label: 'Delivery window', value: 'November 2026' },
        { label: 'Risks / challenges', value: null },
      ],
      rewards: [
        {
          title: 'Founding access',
          price: 'US$28.00',
          contents: 'Early digital access',
          delivery: 'November 2026',
        },
      ],
      faqs: [{ question: 'Can I cancel?', answer: 'Yes, at any time before close.' }],
    },
    review: {
      buildStatus: 'in_progress',
      rosterReadiness: 'forming',
      rounds: [
        {
          round: 1,
          outcome: 'pending',
          submittedAt: 'Aug 1, 2026 · 9:00 AM UTC',
          decidedAt: null,
        },
      ],
      feedback: [{ group: 'required', text: 'Name the delivery month in the story.' }],
      approvedAt: null,
    },
    live: {
      isLive: true,
      liveAt: 'Aug 7, 2026 · 4:00 PM UTC',
      campaignDay: 6,
      closesAt: 'Aug 20, 2026',
      discovery: 'Known links only',
      publicUrl: `/campaign/${CAMPAIGN}`,
      created: 110,
      active: 105,
      canceled: 5,
      validClicks: 2835,
      conversion: '3.7%',
      reservedSubtotal: 'US$2,856.00',
      updatesCount: 2,
      commentsCount: 3,
      threshold: null,
    },
    page: {
      updates: [
        {
          title: 'Week one: what we learned',
          audience: 'Public',
          publishedAt: 'Aug 12, 2026 · 12:40 PM UTC',
          body: '105 people have reserved.',
          materialChange: false,
        },
      ],
      updatesCount: 2,
      comments: [
        {
          author: 'Backer 427',
          body: 'Would a browser extension be in the first release?',
          postedAt: 'Aug 12, 2026 · 1:00 PM UTC',
          state: 'Visible',
        },
      ],
      commentsCount: 3,
      openFlags: 1,
    },
    roster: [
      {
        associationId: 'assoc-1',
        prospectId: 'creator-prospect-1',
        name: 'Open Field Notes',
        handle: 'openfieldnotes',
        statusLabel: 'Active',
        terms: '35% locked',
        launchRequired: true,
        backers: 41,
        validClicks: 1758,
        completion: null,
        workAgain: null,
      },
      {
        associationId: 'assoc-2',
        prospectId: 'creator-prospect-2',
        name: 'Verde Notes Review',
        handle: 'verdenotesreview',
        statusLabel: 'Formal decision open',
        terms: '34% proposed on v3 · not locked',
        launchRequired: false,
        backers: 18,
        validClicks: 621,
        completion: null,
        workAgain: null,
      },
    ],
    rosterCounts: { total: 2, backersBroughtIn: 59, validClicks: 2835 },
    workAgain: [
      {
        creatorName: 'Open Field Notes',
        requestedAt: 'Aug 12, 2026 · 9:00 AM UTC',
        status: 'Requested — awaiting the Creator',
        message: 'We would love to work with you again on the next run.',
        respondedAt: null,
        responseNote: null,
      },
    ],
    demand: {
      split: [
        { label: 'Affiliate traffic', clicks: 2835, backers: 59 },
        { label: 'Direct & organic', clicks: 0, backers: 46 },
      ],
    },
    responses: {
      total: 82,
      rows: [
        {
          backer: 'Backer 427',
          reward: 'Founding access',
          status: 'Active',
          why: 'I need a calmer place for unfinished research threads.',
          recommend: 4,
          consent: 'Aggregate only',
        },
      ],
    },
    backerRows: {
      total: 110,
      rows: [
        {
          backer: 'Backer 427',
          reward: 'Founding access',
          createdAt: 'Aug 12, 2026',
          status: 'reserved active',
          attribution: '@openfieldnotes',
          caseRef: 'PVD-24680-13579',
          caseId: 'case-1',
        },
      ],
    },
    close: {
      scheduledClose: 'Aug 20, 2026',
      batch: null,
      finalActive: null,
      canceledExcluded: null,
      captureState: 'Not due — the campaign has not closed',
      retryWindow: null,
      reconciliation: 'Waiting for close',
      resultsPreparedAt: null,
      idea: null,
    },
    fulfillment: {
      available: false,
      waitingOn:
        'Delivery evidence, the Day-14 review, and missed-commitment records exist only after the lifecycle reaches fulfillment.',
      mechanism: null,
      deliveredAt: null,
      obligations: [],
      commitments: [],
      day14: null,
    },
    refunds: {
      openRefunds: 0,
      totalRefunds: 0,
      openDisputes: 0,
      totalDisputes: 0,
      recoveryRecords: 0,
    },
    supportCases: [
      {
        caseId: 'case-1',
        reference: 'PVD-24680-13579',
        subject: 'Backer asks about workshop schedule',
        status: 'Waiting on Founder',
        owner: 'Proovd',
        due: 'Aug 13, 2026 · 4:00 PM UTC',
      },
    ],
    cancellation: null,
    enforcement: { campaignActions: [] },
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
  await screen.findByRole('tablist', { name: 'Founder record sections' });
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

/**
 * The eight sections of the 2026-08-16 rebuild, in the reference's order.
 * `Affiliates` is the reference's own record vocabulary — the Creators
 * workspace set the precedent on 2026-08-11: the shell says Creators, an
 * Admin RECORD may say Affiliate, and §3.1's scope is what renders to
 * Founders and Backers.
 */
const SECTION_LABELS = [
  'Overview',
  'Onboarding',
  'Campaign',
  'Affiliates',
  'Backers & Demand',
  'Money & Fulfillment',
  'Support & Enforcement',
  'History',
] as const;

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

    expect(toastMessages()).toContain(PARKED_MESSAGES.today);
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
  it('renders exactly the five columns, in order', async () => {
    // The 2026-08-16 rebuild: the reference's five-column directory. Setup,
    // account, and payment facts moved into the record; the campaign cell
    // became Type / Lifecycle; the attention chip became two action columns.
    await renderList();
    expect(
      screen.getAllByRole('columnheader').map((cell) => cell.textContent),
    ).toEqual(['Founder', 'Type / Lifecycle', 'Admin action', 'Founder action', 'Owner']);
  });

  it('shows the founder with their business and email under the name', async () => {
    await renderList();
    const row = screen.getByRole('link', { name: 'Rae Harlow' }).closest('tr') as HTMLElement;

    expect(row.querySelector('.fdr-sub')).toHaveTextContent(
      'Harlow Instruments LLC · rae@harlow.example',
    );
    // The avatar square is decoration; the name is the control.
    expect(row.querySelector('.fdir-avatar')).toHaveAttribute('aria-hidden', 'true');
  });

  it('emphasises a due action and names why the quiet cell is quiet', async () => {
    // The single attention chip became two named action columns, and every
    // no-action state carries its reason (§1.4: `No action — …` beats a blank
    // cell that reads as missing data).
    await renderList();
    const rae = screen.getByRole('link', { name: 'Rae Harlow' }).closest('tr') as HTMLElement;
    const nils = screen.getByRole('link', { name: 'Nils Aro' }).closest('tr') as HTMLElement;

    expect(within(rae).getByText(/W-9 has not been requested/)).toHaveClass('fdir-due');
    expect(within(nils).getByText('No action — Nils owns the next step')).toHaveClass(
      'fdir-none',
    );
    expect(within(nils).getByText('Accept the private invitation')).toHaveClass(
      'fdir-due--founder',
    );
  });

  it('opens the workspace when the row is clicked', async () => {
    const user = userEvent.setup();
    const { router } = await renderList();
    const row = screen.getByRole('link', { name: 'Rae Harlow' }).closest('tr') as HTMLElement;

    // A press on an ordinary cell, not on a control of its own.
    await user.click(within(row).getByText('Sam Okafor'));

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

  it('renders each row’s type chip, lifecycle, and both action columns', async () => {
    // The 2026-08-16 rebuild: the campaign cell became the Type/Lifecycle
    // column, and the single attention chip became two named action columns.
    // The old assertion — that the campaign control toasts a parked message —
    // consciously changed: the Campaigns workspace exists, and the record
    // links into it from the workspace header instead.
    await renderList();
    const row = screen.getByRole('link', { name: 'Rae Harlow' }).closest('tr') as HTMLElement;

    expect(within(row).getByText('Product')).toBeInTheDocument();
    expect(within(row).getByText(STATUS_LABEL)).toBeInTheDocument();
    expect(
      within(row).getByText('The W-9 has not been requested for this campaign yet.'),
    ).toBeInTheDocument();
    expect(within(row).getByText('Finish the campaign build')).toBeInTheDocument();
    expect(within(row).getByText('Sam Okafor')).toBeInTheDocument();
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

    expect(await screen.findByText('Reading the Founders directory')).toBeInTheDocument();
    expect(unansweredQuestions(container)).toEqual([]);
    expect(screen.getAllByText('Admin · Founders').length).toBeGreaterThan(0);
  });

  it('says nobody has been recorded rather than showing an empty table', async () => {
    serve(adminRoutes({ founders: [] }));
    const { container } = await renderAdmin('/admin/founders');

    expect(await screen.findByText('No Founders yet')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    // An empty list is a state somebody can act on, so the panel carries the
    // one action that changes it — a LINK since Session B: Create Founder is
    // the five-step compose page, not a dialog.
    expect(screen.getAllByRole('link', { name: 'Create Founder' }).length).toBeGreaterThan(0);
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

describe('§26.1 — one person, eight sections', () => {
  it('titles the page with the person and renders exactly one h1', async () => {
    const { container } = await renderWorkspace();
    const headings = [...container.querySelectorAll('h1')];
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent('Rae Harlow');
  });

  it('renders the eight sections and switches between them', async () => {
    const user = userEvent.setup();
    await renderWorkspace();

    const tablist = screen.getByRole('tablist', { name: 'Founder record sections' });
    expect(within(tablist).getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      ...SECTION_LABELS,
    ]);
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('heading', { name: 'Founder summary', level: 2 })).toBeInTheDocument();

    // The invitation-and-setup record lives under Onboarding now (Session A's
    // honest interim: the pane that owns the content, under the section that
    // will hold its four tabs).
    await openTab(user, 'Onboarding');
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    expect(screen.getByRole('heading', { name: 'Invitation', level: 2 })).toBeInTheDocument();

    // Session C: the Money section is the four-tab shape, opening on Close.
    // (This assertion consciously changed from the old pane's 'Payment setup'
    // heading — payment setup lives on Onboarding → Stripe & Listing Fee now.)
    await openTab(user, 'Money & Fulfillment');
    expect(screen.getByRole('heading', { name: 'Campaign close', level: 2 })).toBeInTheDocument();
    // Only the active section is mounted — a hidden pane is still in the
    // accessibility tree and still runs its effects.
    expect(screen.queryByRole('heading', { name: 'Invitation', level: 2 })).toBeNull();
  });

  it('shows the record reference, both chips, the strip, and the decision card', async () => {
    // The 2026-08-16 rebuild: the header's five-status grid became the
    // reference's shape — the quotable reference in the eyebrow, the type and
    // lifecycle chips, the Problem/Solution/Business strip — and the
    // attention chip became the Overview's decision card, whose one primary
    // is a routing verb.
    const { container } = await renderWorkspace();

    expect(visibleText(container)).toContain('Founder record · F-7K3MQ');
    expect(container.querySelector('.frec-chip--type')).toHaveTextContent('Product · locked');
    expect(container.querySelector('.frec-chip--life')).toHaveTextContent(STATUS_LABEL);

    const strip = container.querySelector('.frec-strip') as HTMLElement;
    expect([...strip.querySelectorAll('dt')].map((term) => term.textContent)).toEqual([
      'Problem',
      'Solution',
      'Business',
    ]);

    const decide = container.querySelector('.fov-decide') as HTMLElement;
    expect(within(decide).getByText(/W-9 has not been requested/)).toBeInTheDocument();
    expect(
      within(decide).getByRole('button', { name: 'Open the money record' }),
    ).toBeInTheDocument();
  });

  it('offers exactly the actions the payload permits, and nothing else', async () => {
    const user = userEvent.setup();
    const detail = workspaceFixture();
    // A record that has been invited and not yet claimed: the invitation can be
    // sent, and nothing else is possible against it.
    detail.header.availableActions = ['edit', 'sendinvite'];
    serve(adminRoutes({ workspace: detail }));

    await renderWorkspace();
    await user.click(screen.getByRole('button', { name: 'Account actions' }));

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
    const user = userEvent.setup();
    const { container } = await renderWorkspace();
    // The full invitation-and-setup record lives under Onboarding (Session A).
    await openTab(user, 'Onboarding');

    const answerRows = [...container.querySelectorAll('.frow')].filter((row) =>
      row.querySelector('dd.fanswer'),
    ) as HTMLElement[];

    // Session B's Invite & Prefills tab: Problem/Solution/views live on the
    // prefills panel and the legacy Competition answer in its own panel, whose
    // value row is labelled "Current text" under the "Competition" heading.
    expect(answerRows.map((row) => row.querySelector('dt')?.textContent)).toEqual([
      'Problem',
      'Solution',
      'Amount of views',
      'Current text',
    ]);
    expect(screen.getByRole('heading', { name: 'Competition' })).toBeInTheDocument();

    for (const row of answerRows) {
      const label = row.querySelector('dt')?.textContent;
      // An Admin correcting a Founder's answer is a support case, not a field
      // edit — which is why `FOUNDER_EDITABLE_FIELDS` has no entry for any of
      // them and this pane has nothing to offer. Competition is a legacy
      // answer: the simplified flow no longer asks it, and a recorded one
      // still renders read-only — with no edit and no "Record agreed
      // correction" route, however the reference draws one.
      expect(controlsIn(row), `“${label}” offers a control`).toEqual([]);
    }

    expect(
      screen.queryByRole('button', { name: /^Edit (Problem|Solution|Competition|Amount of views)$/ }),
    ).toBeNull();
    expect(screen.queryByText('Record agreed correction')).toBeNull();
    expect(screen.getByText('Originally prepared by Proovd · Last edited by Rae')).toBeInTheDocument();
  });
});

/* ── 6. The activity summary ───────────────────────────────────────────────── */

describe('§27.7, §30 — Proovd never chooses a summary frequency for somebody', () => {
  it('shows the preference read-only, with the reason it cannot be set here', async () => {
    // The identity-and-preferences block sits inside the Overview since the
    // 2026-08-16 rebuild (DNA §5.2's Explore: the full record one gesture
    // below the summary), so no tab press is needed to reach it.
    const { container } = await renderWorkspace();

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
    await openTab(user, 'Onboarding');

    // Session B: the overrides render directly on the Invite & Prefills tab —
    // there is no longer a disclosure between the Admin and the recipient row.
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
    await openTab(user, 'Onboarding');

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
    // Session C: the waiting sentence lives on Money & Fulfillment → Payments
    // now, and the listing amounts moved to Onboarding → Stripe & Listing Fee
    // in Session B — so this test navigates to the tab and no longer asserts
    // a listing line on the same pane.
    const user = userEvent.setup();
    const { container } = await renderWorkspace();
    await openTab(user, 'Money & Fulfillment');
    await user.click(screen.getByRole('tab', { name: 'Payments' }));

    expect(
      await screen.findByText('The campaign has not closed, so no Founder payment exists to show.'),
    ).toBeInTheDocument();

    // Every ledger column in this product defaults to 0, so a naive pane says
    // "US$0.00" for a campaign whose close batch has not run — indistinguishable
    // from one that captured nothing.
    const text = visibleText(container);
    expect(text).not.toContain('US$0.00');
    // The W-9 state still renders beside it, so this is the absent section
    // being silent rather than the whole tab.
    expect(screen.getByRole('heading', { name: 'W-9', level: 2 })).toBeInTheDocument();
  });

  it('states the identity check as a status, with no document anywhere near it', async () => {
    // Session C: the identity row lives on Onboarding → Stripe & Listing Fee
    // (it moved there with payment setup in Session B; the old Money pane that
    // duplicated it is deleted). The claim is unchanged: a status, no document,
    // and no control that collects a provider-held field.
    serve(adminRoutes({ before: [CAMPAIGN_WORKSPACE_READ] }));
    const user = userEvent.setup();
    const { container } = await renderWorkspace();
    await openTab(user, 'Onboarding');
    await user.click(screen.getByRole('tab', { name: 'Stripe & Listing Fee' }));

    const row = await waitFor(() => rowFor(container, 'Identity check'));
    expect(within(row).getByText('Verified by Stripe')).toBeInTheDocument();
    expect(within(row).getByText(IDENTITY_CHECK_HELPER)).toBeInTheDocument();
    // Nothing on this tab moves money or collects a provider-held field.
    expect(
      screen
        .getAllByRole('tabpanel')
        .flatMap((panel) => [...panel.querySelectorAll('input, select, textarea')]),
    ).toHaveLength(0);
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
    // The standing block sits inside the Overview's full-record section since
    // the 2026-08-16 rebuild; no tab press is needed to reach it.
    await renderWorkspace();
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

    for (const label of SECTION_LABELS) {
      if (label !== 'Overview') await openTab(user, label);
      expect(await axe(container), `axe violation on the ${label} section`).toHaveNoViolations();
    }
  });

  it('gives the tabs their roles, one stop in the tab order, and a labelled panel', async () => {
    await renderWorkspace();
    const tablist = screen.getByRole('tablist', { name: 'Founder record sections' });
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
    expect(screen.getByRole('tab', { name: 'Onboarding' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Onboarding' }));

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
/*
 * `affiliate` left this list on 2026-08-16, consciously: the rebuilt record's
 * section rail says `Affiliates`, which is the reference's own vocabulary and
 * the Creators-workspace precedent (2026-08-11) -- the shell says Creators, an
 * Admin RECORD may say Affiliate, and §3.1's scope is what renders to
 * Founders and Backers. §3.2's terms stay: they are about honesty, not
 * audience.
 */
const FORBIDDEN = [
  'pre_build',
  'pre_launch',
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

    for (const label of SECTION_LABELS) {
      if (label !== 'Overview') await openTab(user, label);
      expect(namingFailures(container), `internal name on the ${label} section`).toEqual([]);
    }
  });

  it('renders the lifecycle label, and keeps the raw value behind the disclosure', async () => {
    const user = userEvent.setup();
    const { container } = await renderWorkspace();
    await openTab(user, 'Campaign');

    expect(within(container).getAllByText(STATUS_LABEL).length).toBeGreaterThan(0);
    expect(visibleText(container)).not.toContain(RAW_STATUS);

    // It is not hidden — it is one gesture below its label, which is where the
    // pane says it put it.
    await user.click(screen.getByRole('button', { name: 'Technical details' }));
    expect(await screen.findByText(RAW_STATUS)).toBeInTheDocument();
  });
});

/* ── 17. Session B — the Onboarding section's four tabs ────────────────────── */

/** The §12 admin read, as the Optional Items and Stripe tabs consume it. */
function campaignWorkspaceFixture() {
  const item = (key: string, complete: boolean, extra: Record<string, unknown> = {}) => ({
    item: key,
    complete,
    completedAt: complete ? 'Aug 4, 2026 · 2:10 PM' : null,
    decisionSource: complete ? 'evidence' : null,
    rejections: complete ? [] : ['A story is saved and you have approved it for the public campaign page.'],
    locked: false,
    invalidated: { at: null, explanation: null },
    invalidatedReason: null,
    invalidatedBy: null,
    evaluatedAt: 'Aug 4, 2026 · 2:10 PM',
    evidence: {},
    ...extra,
  });
  return {
    workspace: {
      campaignId: CAMPAIGN,
      items: [
        item('visuals', true),
        item('branding', true),
        item('interview', true),
        item('story', true),
        item('socials', false),
      ],
      fee: {
        baseCents: '3500',
        itemDiscountCents: '200',
        completedItems: 4,
        discountLines: [
          { item: 'visuals', discountCents: '200' },
          { item: 'branding', discountCents: '200' },
          { item: 'interview', discountCents: '200' },
          { item: 'story', discountCents: '200' },
        ],
        discountCents: '800',
        subtotalCents: '2700',
        calculatedAt: 'Aug 4, 2026 · 2:10 PM',
        locked: false,
        separateStreamNote:
          'This is the one-off fee for listing your campaign, paid to Proovd. It is separate from the 5% Proovd keeps from what your campaign actually collects — that is charged later, only on money you receive, and it is not part of this total.',
      },
      highEffort: {
        visualsCompleted: true,
        brandingCompleted: true,
        interviewScheduledOrConfirmed: true,
        highEffort: true,
        calculatedAt: 'Aug 4, 2026 · 2:10 PM',
      },
      assets: [
        {
          id: 'asset-1',
          purpose: 'visual',
          state: 'stored',
          rejection: null,
          approved: true,
          removed: false,
          filename: 'bench-lamp-hero.png',
          contentType: 'image/png',
        },
      ],
      socials: [
        {
          id: 'social-1',
          url: 'https://example.com/@bench',
          accessible: true,
          rejection: null,
          controlsConfirmedByFounder: true,
          removed: false,
        },
      ],
      interview: {
        booking: {
          id: 'booking-1',
          status: 'confirmed',
          scheduledAt: 'Aug 1, 2026 · 10:00 AM',
          founderTimezone: 'America/Chicago',
          meetingProvider: 'google_meet_label_free',
          meetingLink: 'https://meet.example/xyz',
          interviewer: 'Mina Park',
        },
      },
    },
  };
}

const CAMPAIGN_WORKSPACE_READ: StubRoute = {
  match: /\/api\/admin\/campaigns\/[^/]+\/workspace$/,
  method: 'GET',
  body: campaignWorkspaceFixture(),
};

describe('Session B — the Onboarding section is four tabs behind one question each', () => {
  it('renders the sub-tab rail, defaults to Invite & Prefills, and keeps the tab in the URL', async () => {
    const user = userEvent.setup();
    const view = await renderWorkspace();
    await openTab(user, 'Onboarding');

    const rail = screen.getByRole('tablist', { name: 'Onboarding record' });
    expect(
      within(rail)
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual(['Invite & Prefills', 'Eligibility', 'Optional Items', 'Stripe & Listing Fee']);
    expect(within(rail).getByRole('tab', { name: 'Invite & Prefills' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // The pinned question leads the tab (ONBOARDING_TAB_COPY is the register).
    expect(
      screen.getByText('What did we send, and what did the Founder change?'),
    ).toBeInTheDocument();

    await user.click(within(rail).getByRole('tab', { name: 'Eligibility' }));
    await waitFor(() => {
      expect(view.router.state.location.search).toContain('tab=eligibility');
    });
    expect(screen.getByText('Did the Founder legitimately become eligible?')).toBeInTheDocument();
  });

  it('renders the invitation as rows of facts, never a token value (§28.1)', async () => {
    const user = userEvent.setup();
    const { container } = await renderWorkspace();
    await openTab(user, 'Onboarding');

    expect(within(rowFor(container, 'Sends')).getByText('1')).toBeInTheDocument();
    expect(within(rowFor(container, 'Version')).getByText('Invite v1')).toBeInTheDocument();
    expect(within(rowFor(container, 'Link')).getByText('Link inactive')).toBeInTheDocument();
    expect(
      within(rowFor(container, 'Claimed')).getByText('Recorded Aug 2, 2026 · 12:10 PM'),
    ).toBeInTheDocument();
    expect(within(rowFor(container, 'Revoked')).getByText('No')).toBeInTheDocument();
  });

  it('the Eligibility tab is read-only, structurally — no input, no edit control', async () => {
    const user = userEvent.setup();
    const { container } = await renderWorkspace();
    await openTab(user, 'Onboarding');
    await user.click(screen.getByRole('tab', { name: 'Eligibility' }));

    await screen.findByText('Eligible — recorded at the account claim');

    const pane = screen.getByRole('tabpanel', { name: 'Onboarding' });
    // The rule is pinned AND enforced by absence: nothing on this tab can
    // write. The two History buttons navigate; neither edits.
    expect(within(pane).getByText(ELIGIBILITY_READ_ONLY_NOTE)).toBeInTheDocument();
    expect(pane.querySelectorAll('input, select, textarea')).toHaveLength(0);
    expect(within(pane).queryByRole('button', { name: /edit/i })).toBeNull();

    // The representations render as what they are — recorded representations,
    // never a verified age (§10) — and the DOB as presence only.
    expect(within(rowFor(container, 'Date of birth')).getByText('Supplied')).toBeInTheDocument();
    expect(visibleText(rowFor(container, '18 or older'))).toContain('Represented — 18+');
    expect(
      within(rowFor(container, 'Acknowledgement 1')).getByText(/Terms of Service v1\.0/),
    ).toBeInTheDocument();
  });

  it('the Optional Items tab reads the §12 route and decides through its dialogs', async () => {
    serve(adminRoutes({ before: [CAMPAIGN_WORKSPACE_READ] }));
    const user = userEvent.setup();
    await renderWorkspace();
    await openTab(user, 'Onboarding');
    await user.click(screen.getByRole('tab', { name: 'Optional Items' }));

    // The hero is the fee record's own count over the register's five.
    await screen.findByText('4 of 5 qualify');
    expect(screen.getByRole('heading', { name: 'Story' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Socials' })).toBeInTheDocument();

    // Track A4: no upload path exists, so no upload control renders — not a
    // disabled one, none (§1.4).
    expect(screen.queryByText('Add / replace')).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();

    // §12's division of labour is pinned on the tab.
    expect(screen.getByText(OPTIONAL_ITEM_CONTENT_IS_FOUNDERS)).toBeInTheDocument();

    // Marking an item invalid demands both §12 sentences and posts to the
    // §12 route — the same one the old admin surface drove.
    serve([
      {
        match: /\/api\/admin\/campaigns\/[^/]+\/workspace\/items\/visuals\/invalidate$/,
        method: 'POST',
        body: campaignWorkspaceFixture(),
      },
      CAMPAIGN_WORKSPACE_READ,
      ...adminRoutes(),
    ]);
    await user.click(screen.getAllByRole('button', { name: 'Mark invalid' })[0]!);
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Internal reason'), 'The file is a placeholder.');
    await user.type(
      within(dialog).getByLabelText('Explanation Rae will read'),
      'The uploaded visual is a single-colour block, so it cannot count yet.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Mark invalid' }));

    await waitFor(() => {
      const posts = requestsTo(/\/workspace\/items\/visuals\/invalidate$/);
      expect(posts).toHaveLength(1);
      expect(JSON.parse(posts[0]!.body ?? '{}')).toEqual({
        reason: 'The file is a placeholder.',
        explanation: 'The uploaded visual is a single-colour block, so it cannot count yet.',
      });
    });
  });

  it('the Stripe & Listing Fee tab answers from the money record and the provider dialog', async () => {
    serve(adminRoutes({ before: [CAMPAIGN_WORKSPACE_READ] }));
    const user = userEvent.setup();
    const { container } = await renderWorkspace();
    await openTab(user, 'Onboarding');
    await user.click(screen.getByRole('tab', { name: 'Stripe & Listing Fee' }));

    await screen.findByText('Can this Founder move into campaign work?');
    expect(
      within(rowFor(container, 'Connected account')).getByText('acct_test_harlow'),
    ).toBeInTheDocument();

    // The secure-status dialog is read-only provider facts (§13: the status
    // and the identifiers, never the documents).
    await user.click(screen.getByRole('button', { name: 'Open secure status' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Stripe requirements')).toBeInTheDocument();
    expect(controlsIn(dialog).filter((el) => el.matches('input, select, textarea'))).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));

    // The listing fee renders the payment row's own stored lines.
    expect(screen.getByText('Base listing fee')).toBeInTheDocument();
    expect(screen.getByText('Charged')).toBeInTheDocument();
  });
});

/* ── 18. Session B — the Create Founder compose ────────────────────────────── */

describe('Session B — Create Founder is a page: five steps, one checklist, two acts', () => {
  it('renders the refused reference boxes as reasons, not inputs', async () => {
    await renderAdmin('/admin/founders/new');

    expect(screen.getByRole('heading', { name: 'Create Founder' })).toBeInTheDocument();

    // The register is the contract: every refused box renders its reason and
    // no input. A `Founder story` textarea reappearing here is the §1.8
    // conflict the first build already paid for.
    expect(screen.queryByLabelText(/Founder story/i)).toBeNull();
    expect(screen.queryByLabelText(/Audience/i)).toBeNull();
    expect(screen.queryByLabelText(/Business explanation/i)).toBeNull();
    expect(screen.queryByLabelText(/Meeting notes/i)).toBeNull();
    expect(screen.getByText(/No founder story box\./)).toBeInTheDocument();
    expect(screen.getByText(/No visual asset uploads box\./)).toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).toBeNull();

    // Competition has NO box and NO absence note needing one — the checklist
    // rail carries the §9 sentence instead.
    expect(screen.queryByLabelText(/Competition/i)).toBeNull();
    expect(
      screen.getByText(/Competition stays Founder-written and is never prefilled here/),
    ).toBeInTheDocument();
  });

  it('the checklist answers the form, and Create & send stays closed until it passes', async () => {
    const user = userEvent.setup();
    await renderAdmin('/admin/founders/new');

    const send = screen.getByRole('button', { name: 'Create & send invitation' });
    expect(send).toBeDisabled();

    await user.type(screen.getByLabelText('Founder name'), 'Noor Vance');
    await user.type(screen.getByLabelText('Business name'), 'Vance Audio');
    await user.type(screen.getByLabelText('Email'), 'noor@vance.example');
    await user.type(screen.getByLabelText('US city and state'), 'Austin, TX');
    await user.type(screen.getByLabelText('Discovery source'), 'Founder research');
    await user.type(screen.getByLabelText('Internal owner'), 'Sam Okafor');
    await user.type(screen.getByLabelText('What we know so far'), 'A modular synth pedal.');
    await user.type(
      screen.getByLabelText('Why we think they could be a fit'),
      'Sells direct already.',
    );
    await user.type(screen.getByLabelText('Estimated time to get started'), 'About 20 minutes');

    // All five lines flip; the rail stays a courtesy — the send route
    // re-decides server-side and the page says so.
    const rail = screen.getByRole('complementary', { name: 'Before you send' });
    await waitFor(() => {
      expect(within(rail).queryAllByText(/— not yet/)).toHaveLength(0);
    });
    expect(screen.getByRole('button', { name: 'Create & send invitation' })).toBeEnabled();
  });

  it('Create prospect writes the records through §7’s own routes and lands on the record', async () => {
    const created = { prospectId: PROSPECT, campaignId: CAMPAIGN, draftId: 'draft-1' };
    serve([
      { match: /\/api\/admin\/founders$/, method: 'POST', body: created },
      { match: /\/api\/admin\/founders\/draft-1\/prospect$/, method: 'PUT', body: { ok: true } },
      {
        match: /\/api\/admin\/founders\/[^/]+\/fields\/[^/]+$/,
        method: 'PUT',
        body: workspaceFixture(),
      },
      ...adminRoutes(),
    ]);
    const user = userEvent.setup();
    const view = await renderAdmin('/admin/founders/new');

    await user.type(screen.getByLabelText('Founder name'), 'Noor Vance');
    await user.type(screen.getByLabelText('Business name'), 'Vance Audio');
    await user.type(screen.getByLabelText('Email'), 'noor@vance.example');
    await user.type(screen.getByLabelText('US city and state'), 'Austin, TX');
    await user.click(screen.getByRole('button', { name: 'Create prospect' }));

    await waitFor(() => {
      expect(view.router.state.location.pathname).toBe(`/admin/founders/${PROSPECT}`);
    });
    expect(view.router.state.location.search).toContain('section=onboarding');

    // The create carried the identity; the 0043 state field went through the
    // person-keyed field route rather than a body key the route ignores.
    const post = requestsTo(/\/api\/admin\/founders$/).find((r) => r.method === 'POST');
    expect(JSON.parse(post?.body ?? '{}')).toMatchObject({
      legalName: 'Noor Vance',
      email: 'noor@vance.example',
      productName: 'Vance Audio',
    });
    const fieldPuts = requestsTo(/\/fields\/state$/);
    expect(fieldPuts).toHaveLength(1);
    expect(JSON.parse(fieldPuts[0]!.body ?? '{}')).toEqual({ value: 'Austin, TX' });
  });
});

/* ── 19. Session B — the Edit Founder sheet ────────────────────────────────── */

describe('Session B — the Edit Founder sheet carries the editable core and nothing else', () => {
  async function openSheet(user: ReturnType<typeof userEvent.setup>) {
    await renderWorkspace();
    await user.click(screen.getByRole('button', { name: 'Account actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit Founder information' }));
    return await screen.findByRole('dialog', { name: 'Edit Founder' });
  }

  it('renders the profile fields and refuses the reference’s five (§9, §12, derived state)', async () => {
    const user = userEvent.setup();
    const sheet = await openSheet(user);

    // The editable core: FOUNDER_EDITABLE_FIELDS' profile group.
    expect(within(sheet).getByLabelText('Legal name')).toBeInTheDocument();
    expect(within(sheet).getByLabelText('Phone')).toBeInTheDocument();
    expect(within(sheet).getByLabelText('Legal business name')).toBeInTheDocument();

    // The refusals, each an absence: the §9 answers and the Story have no
    // editable key; the account status is derived from three records; the
    // audience range is the Founder's own closed-list answer.
    expect(within(sheet).queryByLabelText(/Problem/)).toBeNull();
    expect(within(sheet).queryByLabelText(/Solution/)).toBeNull();
    expect(within(sheet).queryByLabelText(/story/i)).toBeNull();
    expect(within(sheet).queryByLabelText(/status/i)).toBeNull();
    expect(within(sheet).queryByLabelText(/audience/i)).toBeNull();
    expect(sheet.querySelectorAll('select')).toHaveLength(0);
  });

  it('writes only what changed, with the one reason, through the existing field route', async () => {
    serve([
      {
        match: /\/api\/admin\/founders\/[^/]+\/fields\/[^/]+$/,
        method: 'PUT',
        body: workspaceFixture(),
      },
      ...adminRoutes(),
    ]);
    const user = userEvent.setup();
    const sheet = await openSheet(user);

    const phone = within(sheet).getByLabelText('Phone');
    await user.clear(phone);
    await user.type(phone, '+1 555 0199');

    // Rae owns the account, so the sheet mirrors `editReasonRequired` and
    // refuses before anything is sent.
    await user.click(within(sheet).getByRole('button', { name: 'Save new version' }));
    expect(await within(sheet).findByRole('alert')).toHaveTextContent(/stated reason/);
    expect(requestsTo(/\/fields\//)).toHaveLength(0);

    await user.type(
      within(sheet).getByLabelText('Reason / context'),
      'Rae asked support to correct the number.',
    );
    await user.click(within(sheet).getByRole('button', { name: 'Save new version' }));

    await waitFor(() => {
      const puts = requestsTo(/\/fields\//);
      // ONE write: the one changed field, not the eleven on the sheet.
      expect(puts).toHaveLength(1);
      expect(puts[0]!.url).toContain('/fields/phone');
      expect(JSON.parse(puts[0]!.body ?? '{}')).toEqual({
        value: '+1 555 0199',
        reason: 'Rae asked support to correct the number.',
      });
    });
  });
});

/* ── 18. Session C — the read-and-route sections ───────────────────────────── */

describe('Session C — the six read-and-route sections', () => {
  it('Campaign is four tabs; Details renders the build read-only with the raw value behind the disclosure', async () => {
    const user = userEvent.setup();
    const { container } = await renderWorkspace();
    await openTab(user, 'Campaign');

    const rail = screen.getByRole('tablist', { name: 'Campaign record' });
    expect(within(rail).getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Details',
      'Review',
      'Live',
      'Page & Updates',
    ]);

    // The build content renders as facts — and there is no per-field Edit.
    const row = rowFor(container, 'Delivery window');
    expect(within(row).getByText('November 2026')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit campaign' })).toBeNull();
  });

  it('Review renders rounds and feedback, and refuses the decision controls by register', async () => {
    const user = userEvent.setup();
    await renderWorkspace();
    await openTab(user, 'Campaign');
    await user.click(screen.getByRole('tab', { name: 'Review' }));

    expect(await screen.findByText('Round 1')).toBeInTheDocument();
    expect(screen.getByText('Name the delivery month in the story.')).toBeInTheDocument();

    // The reference draws Approve campaign / Return changes / Mark reviewed.
    // None mounts; the register's sentence renders where they would have been.
    expect(screen.queryByRole('button', { name: 'Approve campaign' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Return changes' })).toBeNull();
    const entry = OPERATIONS_ABSENCES.find(
      (absence) => absence.control === 'Mark reviewed / Approve campaign / Return changes',
    );
    expect(entry).toBeDefined();
    expect(screen.getByText(entry!.reason)).toBeInTheDocument();
  });

  it('Affiliates renders the roster linking into the Creators workspace, and Admin never agrees', async () => {
    const user = userEvent.setup();
    await renderWorkspace();
    await openTab(user, 'Affiliates');

    // The relationship rows link out — the Creators workspace owns them.
    const open = screen.getAllByRole('link', { name: 'Open relationship' });
    expect(open[0]).toHaveAttribute(
      'href',
      '/admin/creators/creator-prospect-1/relationships/assoc-1',
    );
    expect(screen.getByText('35% locked')).toBeInTheDocument();
    expect(screen.getByText('34% proposed on v3 · not locked')).toBeInTheDocument();

    // §14.2: no control records a party's decision, and no control sets a bonus.
    expect(screen.queryByRole('button', { name: /Record Founder acceptance/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Set bonus/ })).toBeNull();
  });

  it('Requests renders the work-again record read-only and names the mediated-request absence', async () => {
    const user = userEvent.setup();
    await renderWorkspace();
    await openTab(user, 'Affiliates');
    await user.click(screen.getByRole('tab', { name: 'Requests' }));

    expect(await screen.findByText('Requested — awaiting the Creator')).toBeInTheDocument();
    expect(screen.getByText(MEDIATED_REQUESTS_ABSENT)).toBeInTheDocument();
    // §22.9: the ask is the Founder's own; Admin cannot send one.
    expect(screen.queryByRole('button', { name: /work-again/i })).toBeNull();
  });

  it('Demand splits attribution honestly and does not invent drop-off reasons', async () => {
    const user = userEvent.setup();
    const { container } = await renderWorkspace();
    await openTab(user, 'Backers & Demand');

    const split = rowFor(container, 'Affiliate traffic');
    expect(within(split).getByText('2835 valid clicks · 59 Backers')).toBeInTheDocument();
    expect(screen.getByText(/No cancellation-reason record exists/)).toBeInTheDocument();
  });

  it('Backers rows carry numbers only and route to the Backers workspace and the case', async () => {
    const user = userEvent.setup();
    await renderWorkspace();
    await openTab(user, 'Backers & Demand');
    await user.click(screen.getByRole('tab', { name: 'Backers' }));

    expect(await screen.findByText('Backer 427')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'PVD-24680-13579' })).toHaveAttribute(
      'href',
      '/admin/support/case-1',
    );
    expect(screen.getByRole('link', { name: 'Open Backers workspace' })).toHaveAttribute(
      'href',
      `/admin/backers?view=backers&campaignId=${CAMPAIGN}`,
    );
  });

  it('Money opens on Close with honest not-due states, and Payments refuses the money decisions', async () => {
    const user = userEvent.setup();
    const { container } = await renderWorkspace();
    await openTab(user, 'Money & Fulfillment');

    expect(
      within(rowFor(container, 'Capture state')).getByText(
        'Not due — the campaign has not closed',
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Payments' }));
    const approve = OPERATIONS_ABSENCES.find(
      (absence) => absence.control === 'Approve, hold, or release a Founder payment',
    );
    expect(await screen.findByText(approve!.reason)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /reminder/i })).toBeNull();
  });

  it('Support cases link to their own record, and Enforcement refuses the campaign-scoped controls', async () => {
    const user = userEvent.setup();
    await renderWorkspace();
    await openTab(user, 'Support & Enforcement');

    expect(await screen.findByText('PVD-24680-13579')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open support case' })).toHaveAttribute(
      'href',
      '/admin/support/case-1',
    );

    await user.click(screen.getByRole('tab', { name: 'Enforcement' }));
    expect(await screen.findByText('Not banned')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suspend campaign' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Kill campaign' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send warning' })).toBeNull();
  });

  it('History is Timeline and Communications, with the label resolved from the registry', async () => {
    const user = userEvent.setup();
    await renderWorkspace();
    await openTab(user, 'History');

    // Timeline keeps the chips and offers the record's ONE note write.
    expect(screen.getByRole('button', { name: 'Add internal note' })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Communications' }));
    // 22c's rule: the payload carries the key; the label resolves here.
    expect(
      await screen.findByText(NOTIFICATION_EVENTS.founder_invitation.description),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Compose/ })).toBeNull();
  });

  it('every register refusal renders somewhere across the section tabs', async () => {
    // The Create Founder arrangement, applied to operations: each refused
    // control's sentence must be ON a surface, so re-adding the control means
    // deleting the sentence that says why it must not exist.
    const user = userEvent.setup();
    await renderWorkspace();

    const walk: [string, string | null][] = [
      ['Campaign', null],
      ['Campaign', 'Review'],
      ['Affiliates', null],
      ['Affiliates', 'Performance & Completion'],
      ['Backers & Demand', 'Responses'],
      ['Money & Fulfillment', 'Payments'],
      ['Money & Fulfillment', 'Fulfillment'],
      ['Support & Enforcement', 'Enforcement'],
      ['History', null],
      ['History', 'Communications'],
    ];
    const seen = new Set<string>();
    for (const [section, tab] of walk) {
      await openTab(user, section!);
      if (tab) await user.click(screen.getByRole('tab', { name: tab }));
      await waitFor(() => {
        expect(screen.getAllByRole('tabpanel').length).toBeGreaterThan(0);
      });
      for (const absence of OPERATIONS_ABSENCES) {
        if (screen.queryByText(absence.reason)) seen.add(absence.control);
      }
    }
    const missing = OPERATIONS_ABSENCES.map((absence) => absence.control).filter(
      (control) => !seen.has(control),
    );
    expect(missing, 'register refusals with no rendered sentence').toEqual([]);
  });

  it('the no-campaign state renders the honest absence, not a campaign-shaped zero', async () => {
    const workspace = workspaceFixture();
    workspace.operations = null;
    serve(adminRoutes({ workspace }));
    const user = userEvent.setup();
    const { container } = await renderWorkspace();
    await openTab(user, 'Campaign');

    expect(screen.getByText('Campaign unavailable')).toBeInTheDocument();
    expect(within(rowFor(container, 'Campaign')).getByText('Not created')).toBeInTheDocument();
    // No count renders as a zero for a campaign that does not exist.
    expect(visibleText(container)).not.toContain('0 active');
  });
});
