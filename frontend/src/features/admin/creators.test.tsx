/**
 * Phase 08a surface — Admin → Creators.
 *
 * The real route table in a memory router, with `fetch` stubbed at the network
 * boundary. Server-side rules — that the send route re-decides, that a guard
 * refuses, that a numeric tier is rejected — are proved in
 * `backend/src/tests/affiliate-recruitment.test.ts` against the real routes.
 * What is checked here is that the surface behaves correctly given what the
 * server says, and that it never shows what §8 and §28.1 forbid.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { axe } from 'jest-axe';
import { appRoutes } from '../../routes.js';

type StubResult = { status: number; body: unknown } | undefined;
type Handler = (url: string, init?: RequestInit) => StubResult;

let handlers: Handler[] = [];
let requests: Array<{ url: string; method: string; body: unknown }> = [];

function respond(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

beforeEach(() => {
  handlers = [];
  requests = [];
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const url = String(input);
    requests.push({
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    for (const handler of handlers) {
      const result = handler(url, init);
      if (result) return respond(result.status, result.body);
    }
    return respond(404, { error: 'not_found', title: 'No stub' });
  });
});

afterEach(() => vi.unstubAllGlobals());

const IDENTITY = {
  id: 'admin-1',
  name: 'Ada Admin',
  email: 'ada@proovd.co',
  sessionEstablishedAt: '2026-07-31T09:00:00.000Z',
  prerequisiteKeys: [],
};

const FIXED_COPY = {
  preparingNotice: 'This campaign may still be preparing.',
  declineNotice: 'Creating an account does not commit you to anything.',
  neverAsksNotice: 'Proovd will never ask you for your bank details.',
};

const REGISTRY = {
  subtypes: ['social_creator'],
  requiredEvidence: { social_creator: ['platform', 'followers', 'engagement', 'analytics'] },
  verificationStatuses: ['unverified', 'in_review', 'verified', 'rejected'],
  fixedCopy: FIXED_COPY,
};

const ROSTER_ROW = {
  associationId: 'a1',
  prospectId: 'p1',
  campaignId: 'c1',
  legalName: 'Sam Okafor',
  publicHandle: '@sambuilds',
  email: 'sam@example.com',
  subtype: 'social_creator',
  status: 'prospect',
  invitationStatus: 'draft' as const,
  rosterMembership: 'initial_roster' as const,
  verificationStatus: 'unverified' as const,
  recruitingAdmin: 'Ada Admin',
  lastSentAt: null,
  claimedAt: null,
  createdAt: '2026-07-30T09:00:00.000Z',
};

function detailFor(overrides: Record<string, unknown> = {}) {
  return {
    association: {
      id: 'a1',
      campaignId: 'c1',
      status: 'prospect',
      rosterMembership: 'initial_roster',
      invitationStatus: 'draft',
      recruitmentSource: 'found through a mutual founder',
      recruitingAdmin: 'Ada Admin',
      recruitedAt: '2026-07-30T09:00:00.000Z',
    },
    prospect: {
      id: 'p1',
      legalName: 'Sam Okafor',
      publicHandle: '@sambuilds',
      email: 'sam@example.com',
      phone: '+1 555 0199',
      subtype: 'social_creator',
      channelReference: 'https://example.social/@sambuilds',
      audienceNiche: 'Indie software founders',
      campaignFit: 'The audience is the exact buyer.',
      audienceSize: '42,000 followers',
      engagementEvidence: null,
      audienceDemographics: null,
      permissionBasis: 'Owns the account outright.',
      priorSponsoredContent: null,
      adminBio: 'Sam writes about building software alone.',
      qualityTier: 'strong fit, small audience',
      verificationStatus: 'unverified',
      verificationEvidence: null,
      verifiedBy: null,
      verifiedAt: null,
      conflictNotes: 'promotes a competitor occasionally',
      sanctionsNotes: null,
      internalComments: 'never show this to the Founder',
      claimedAt: null,
    },
    missingEvidence: ['platform', 'followers', 'engagement', 'analytics'],
    slots: { used: 0, limit: 3, remaining: 3, atLimit: false },
    invitation: {
      whyRecruited: null,
      reviewedPresence: null,
      senderName: null,
      senderEmail: null,
      founderName: 'Rowan Vale',
      productName: 'Waitlist',
      hasLiveToken: false,
      lastSentAt: null,
      sends: [],
    },
    ...overrides,
  };
}

function previewFor(overrides: Record<string, unknown> = {}) {
  return {
    subject: 'Proovd invitation: promote Waitlist',
    html: '<p>…</p>',
    text: 'Sam, we would like you to promote Waitlist by Rowan Vale.',
    recipientEmail: 'sam@example.com',
    unresolved: ['[WHY THIS CREATOR WAS RECRUITED]'],
    blocked: true,
    claimUrlShape: 'http://localhost:3000/creator-invitation/…',
    ...overrides,
  };
}

/** The stubs a loaded Creators page needs. */
function stubPage(options: { detail?: Record<string, unknown>; preview?: Record<string, unknown> } = {}) {
  handlers.push((url) => {
    if (url === '/api/admin/me') return { status: 200, body: IDENTITY };
    if (url === '/api/admin/affiliates/registry') return { status: 200, body: REGISTRY };
    if (url.startsWith('/api/admin/affiliates?campaignId=')) {
      return { status: 200, body: { affiliates: [ROSTER_ROW] } };
    }
    if (url === '/api/admin/affiliates/a1') {
      return { status: 200, body: detailFor(options.detail) };
    }
    if (url === '/api/admin/affiliates/a1/preview') {
      return { status: 200, body: previewFor(options.preview) };
    }
    return undefined;
  });
}

async function renderCreators(path = '/admin/creators?campaignId=c1') {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  const view = render(<RouterProvider router={router} />);
  await screen.findByRole('heading', { name: /campaign creators/i });
  return view;
}

/* ── The roster ───────────────────────────────────────────────────────────── */

describe('Admin → Creators', () => {
  it('names the campaign requirement when no campaign is selected', async () => {
    handlers.push((url) =>
      url === '/api/admin/me' ? { status: 200, body: IDENTITY } : undefined,
    );
    await renderCreators('/admin/creators');
    expect(await screen.findByText(/no campaign selected/i)).toBeTruthy();
  });

  it('lists the recruited Creators by their public handle', async () => {
    stubPage();
    await renderCreators();
    expect(await screen.findByRole('rowheader', { name: /@sambuilds/ })).toBeTruthy();
    expect(screen.getByText(/not invited yet/i)).toBeTruthy();
  });

  it('shows an empty roster honestly, with what to do next', async () => {
    handlers.push((url) => {
      if (url === '/api/admin/me') return { status: 200, body: IDENTITY };
      if (url === '/api/admin/affiliates/registry') return { status: 200, body: REGISTRY };
      if (url.startsWith('/api/admin/affiliates?campaignId='))
        return { status: 200, body: { affiliates: [] } };
      return undefined;
    });
    await renderCreators();
    expect(await screen.findByText(/no creators recruited yet/i)).toBeTruthy();
    expect(screen.getByText(/nothing is sent until you preview/i)).toBeTruthy();
  });
});

/* ── §8's gate on the surface ─────────────────────────────────────────────── */

describe('§8 — the invitation gate', () => {
  it('disables Send while the server reports an unresolved field', async () => {
    stubPage();
    const user = userEvent.setup();
    await renderCreators();

    await user.click(await screen.findByRole('button', { name: /^open$/i }));
    await user.click(await screen.findByText(/^the invitation$/i));

    const send = await screen.findByRole('button', { name: /send the invitation/i });
    expect(send.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('[WHY THIS CREATOR WAS RECRUITED]')).toBeTruthy();
    expect(screen.getByText(/must never receive a placeholder/i)).toBeTruthy();
  });

  it('enables Send once the server reports it unblocked', async () => {
    stubPage({
      detail: {
        invitation: {
          whyRecruited: 'Your last three threads each ran past 200 replies.',
          reviewedPresence: 'Your public profile.',
          senderName: 'Ada Admin',
          senderEmail: 'ada@proovd.co',
          founderName: 'Rowan Vale',
          productName: 'Waitlist',
          hasLiveToken: false,
          lastSentAt: null,
          sends: [],
        },
      },
      preview: { unresolved: [], blocked: false },
    });
    const user = userEvent.setup();
    await renderCreators();

    await user.click(await screen.findByRole('button', { name: /^open$/i }));
    await user.click(await screen.findByText(/^the invitation$/i));

    const send = await screen.findByRole('button', { name: /send the invitation/i });
    expect(send.hasAttribute('disabled')).toBe(false);
  });

  it('renders §8’s fixed promises as read-only, with no control that edits them', async () => {
    stubPage();
    const user = userEvent.setup();
    await renderCreators();

    await user.click(await screen.findByRole('button', { name: /^open$/i }));
    await user.click(await screen.findByText(/^the invitation$/i));
    await user.click(await screen.findByText(/that you cannot change/i));

    const preparing = await screen.findByText(FIXED_COPY.preparingNotice);
    expect(preparing).toBeTruthy();
    expect(screen.getByText(FIXED_COPY.declineNotice)).toBeTruthy();
    expect(screen.getByText(FIXED_COPY.neverAsksNotice)).toBeTruthy();
    // Read-only means no input carries the text — not an input that is disabled.
    for (const field of screen.queryAllByRole('textbox')) {
      expect((field as HTMLInputElement).value).not.toContain(FIXED_COPY.preparingNotice);
    }
  });
});

/* ── §5.3 — the evidence the subtype asks for ─────────────────────────────── */

describe('§5.3 — subtype-specific evidence', () => {
  it('asks for the evidence this channel type needs, and says why', async () => {
    stubPage();
    const user = userEvent.setup();
    await renderCreators();

    await user.click(await screen.findByRole('button', { name: /^open$/i }));
    await user.click(await screen.findByText(/what §5.3 asks for/i));

    expect(await screen.findByText(/third-party audience audit/i)).toBeTruthy();
    expect(screen.getByText(/audit where appropriate/i)).toBeTruthy();
  });

  it('keeps "Record as verified" unavailable while evidence is missing', async () => {
    stubPage();
    const user = userEvent.setup();
    await renderCreators();

    await user.click(await screen.findByRole('button', { name: /^open$/i }));
    await user.click(await screen.findByText(/what §5.3 asks for/i));

    await user.type(
      await screen.findByLabelText(/who carried out the verification/i),
      'Ada Admin',
    );

    const verified = screen.getByRole('button', { name: /record as verified/i });
    expect(verified.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/still missing before this can be recorded/i)).toBeTruthy();
  });

  it('swaps the evidence inputs when the recruit form changes subtype', async () => {
    stubPage();
    const user = userEvent.setup();
    await renderCreators();

    const select = await screen.findByLabelText(/channel subtype/i);
    await user.selectOptions(select, 'podcast_host');
    expect(await screen.findByText(/downloads or listens per episode/i)).toBeTruthy();

    await user.selectOptions(select, 'community_owner');
    expect(await screen.findByText(/community rules and promotion permission/i)).toBeTruthy();
    expect(screen.queryByText(/downloads or listens per episode/i)).toBeNull();
  });
});

/* ── §8 / §28.1 — what the surface must never show ────────────────────────── */

describe('§8 — the quality tier is never a rate', () => {
  it('says on the form that a tier is not a score', async () => {
    stubPage();
    await renderCreators();
    expect(
      await screen.findByText(/never become a commission floor/i),
    ).toBeTruthy();
  });

  it('offers no percentage or rate input anywhere on the page', async () => {
    stubPage();
    await renderCreators();
    // §12 owns compensation and arrives in Phase 12. A rate input here would be
    // the §1 rule 6 violation the tier rule exists to prevent.
    for (const label of screen.queryAllByRole('textbox')) {
      const name = label.getAttribute('aria-label') ?? '';
      expect(name).not.toMatch(/percent|rate|commission|bid|bonus/i);
    }
    expect(screen.queryByText(/base percentage|commission rate/i)).toBeNull();
  });
});

describe('§28.1 — the link is never shown', () => {
  it('reports that a live link exists without rendering one', async () => {
    stubPage({
      detail: {
        invitation: {
          whyRecruited: 'x',
          reviewedPresence: 'y',
          senderName: 'Ada Admin',
          senderEmail: 'ada@proovd.co',
          founderName: 'Rowan Vale',
          productName: 'Waitlist',
          hasLiveToken: true,
          lastSentAt: '2026-07-30T10:00:00.000Z',
          sends: [
            {
              id: 's1',
              sentAt: '2026-07-30T10:00:00.000Z',
              recipientEmail: 'sam@example.com',
              senderName: 'Ada Admin',
              notificationId: 'msg-1',
              tokenVersion: 1,
              tokenExpiresAt: '2026-08-29T10:00:00.000Z',
              sentBy: 'user:admin-1',
              deliveryConfirmed: true,
            },
          ],
        },
      },
      preview: { unresolved: [], blocked: false },
    });
    const user = userEvent.setup();
    const { container } = await renderCreators();

    await user.click(await screen.findByRole('button', { name: /^open$/i }));
    await user.click(await screen.findByText(/^the invitation$/i));

    expect(await screen.findByRole('button', { name: /resend the invitation/i })).toBeTruthy();
    expect(screen.getByText(/unique and unrecoverable/i)).toBeTruthy();
    // No anchor to a claim URL exists on the page.
    const links = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
    expect(links.some((href) => href.includes('/creator-invitation/'))).toBe(false);
  });

  it('renders an unconfirmed send as unconfirmed, never as delivered (§1.4)', async () => {
    stubPage({
      detail: {
        invitation: {
          whyRecruited: 'x',
          reviewedPresence: 'y',
          senderName: 'Ada Admin',
          senderEmail: 'ada@proovd.co',
          founderName: 'Rowan Vale',
          productName: 'Waitlist',
          hasLiveToken: true,
          lastSentAt: '2026-07-30T10:00:00.000Z',
          sends: [
            {
              id: 's1',
              sentAt: '2026-07-30T10:00:00.000Z',
              recipientEmail: 'sam@example.com',
              senderName: 'Ada Admin',
              notificationId: null,
              tokenVersion: 1,
              tokenExpiresAt: null,
              sentBy: 'user:admin-1',
              deliveryConfirmed: false,
            },
          ],
        },
      },
      preview: { unresolved: [], blocked: false },
    });
    const user = userEvent.setup();
    await renderCreators();

    await user.click(await screen.findByRole('button', { name: /^open$/i }));
    await user.click(await screen.findByText(/^the invitation$/i));
    await user.click(await screen.findByText(/invitation history/i));

    expect(await screen.findByText(/recorded, not confirmed/i)).toBeTruthy();
  });

  it('requires a stored reason before revoking (§25.6)', async () => {
    stubPage({
      detail: {
        invitation: {
          whyRecruited: 'x',
          reviewedPresence: 'y',
          senderName: 'Ada Admin',
          senderEmail: 'ada@proovd.co',
          founderName: 'Rowan Vale',
          productName: 'Waitlist',
          hasLiveToken: true,
          lastSentAt: '2026-07-30T10:00:00.000Z',
          sends: [],
        },
      },
      preview: { unresolved: [], blocked: false },
    });
    const user = userEvent.setup();
    await renderCreators();

    await user.click(await screen.findByRole('button', { name: /^open$/i }));
    await user.click(await screen.findByText(/^the invitation$/i));

    const revoke = await screen.findByRole('button', { name: /revoke the link/i });
    expect(revoke.hasAttribute('disabled')).toBe(true);

    await user.type(await screen.findByLabelText(/reason for revoking/i), 'channel went dormant');
    await waitFor(() => expect(revoke.hasAttribute('disabled')).toBe(false));
  });
});

/* ── §33.11 — accessibility is an acceptance test ─────────────────────────── */

describe('§33.11 — the Creators surface is accessible', () => {
  it('has no axe violations', async () => {
    stubPage();
    const { container } = await renderCreators();
    await screen.findByRole('rowheader', { name: /@sambuilds/ });
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  }, 30_000);

  it('gives every recruit-form control a programmatic label', async () => {
    stubPage();
    await renderCreators();
    await screen.findByRole('rowheader', { name: /@sambuilds/ });

    for (const control of screen.getAllByRole('textbox')) {
      const labelled =
        control.getAttribute('aria-label') ??
        control.getAttribute('aria-labelledby') ??
        control.closest('label')?.textContent ??
        '';
      expect(labelled.trim(), control.outerHTML.slice(0, 120)).not.toBe('');
    }
  });
});
