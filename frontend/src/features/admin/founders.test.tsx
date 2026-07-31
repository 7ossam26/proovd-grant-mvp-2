/**
 * Phase 06b surfaces — Users → Founders, the invitation, and the Founder's
 * invited draft.
 *
 * The real route table in a memory router, with `fetch` stubbed at the network
 * boundary. Server-side rules — that the gate is re-decided, that a guard
 * refuses — are proved in `backend/src/tests/founder-invitation.test.ts` against
 * the real routes; what is checked here is that the surface behaves correctly
 * given what the server says.
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

const PROCESS_SUMMARY = [
  'You tell us about the product, the problem it solves, and who else is solving it.',
  'A person at Proovd reviews it with you, and may ask for a short interview.',
];
const NO_GUARANTEE =
  'Being invited is not an offer or a guarantee. Proovd cannot promise that any Creator will agree to promote your campaign.';

const FOUNDER_ROW = {
  prospectId: 'p1',
  draftId: 'd1',
  campaignId: 'c1',
  legalName: 'Rowan Vale',
  email: 'rowan@example.com',
  productName: 'Waitlist',
  status: 'sent' as const,
  invitationSource: 'introduced by a mutual contact',
  internalOwner: 'Ada Admin',
  lastSentAt: '2026-07-20T09:00:00.000Z',
  retentionDueAt: '2026-08-19T09:00:00.000Z',
  claimedAt: null,
  anonymisedAt: null,
  createdAt: '2026-07-19T09:00:00.000Z',
};

function detailFor(overrides: Record<string, unknown> = {}) {
  return {
    draft: {
      id: 'd1',
      campaignId: 'c1',
      prospectId: 'p1',
      status: 'sent',
      whatWeUnderstood: 'A scheduling tool for physiotherapists.',
      whyInvited: 'Two clinics renewed without being asked.',
      senderName: 'Ada Admin',
      senderEmail: 'ada@proovd.co',
      expectedSetupTime: 'About two hours.',
      anonymisedAt: null,
      createdAt: '2026-07-19T09:00:00.000Z',
    },
    prospect: {
      id: 'p1',
      legalName: 'Rowan Vale',
      preferredName: 'Rowan',
      email: 'rowan@example.com',
      phone: '+1 555 0100',
      productName: 'Waitlist',
      productUrl: 'https://waitlist.example',
      invitationSource: 'introduced by a mutual contact',
      internalOwner: 'Ada Admin',
      adminNotes: 'Met at a meetup.',
      claimedAt: null,
      anonymisedAt: null,
    },
    campaign: {
      id: 'c1',
      type: null,
      typeLockedAt: null,
      status: 'invited_draft',
      affiliateRosterStatus: 'forming',
      campaignBuildStatus: 'not_started',
      listingPaidAt: null,
      campaignLiveAt: null,
      campaignCloseAt: null,
      createdAt: '2026-07-19T09:00:00.000Z',
    },
    sends: [
      {
        id: 's1',
        sentAt: '2026-07-20T09:00:00.000Z',
        recipientEmail: 'rowan@example.com',
        senderName: 'Ada Admin',
        notificationId: 'msg-1',
        tokenVersion: 1,
        tokenExpiresAt: '2026-08-19T09:00:00.000Z',
        sentBy: 'user:admin-1',
      },
    ],
    lastSentAt: '2026-07-20T09:00:00.000Z',
    retentionDueAt: '2026-08-19T09:00:00.000Z',
    hasLiveToken: true,
    ...overrides,
  };
}

function previewFor(unresolved: string[] = []) {
  return {
    subject: 'Proovd invitation: run a campaign for Waitlist',
    html: '<html><body><p>Rowan</p></body></html>',
    text: 'Rowan, we would like to invite Waitlist to run a campaign on Proovd.',
    recipientEmail: 'rowan@example.com',
    unresolved,
    blocked: unresolved.length > 0,
  };
}

function stubAdmin(options: { detail?: unknown; preview?: unknown; founders?: unknown[] } = {}) {
  handlers.push((url, init) => {
    if (url === '/api/admin/me') return { status: 200, body: IDENTITY };
    if (url === '/api/admin/founders' && (init?.method ?? 'GET') === 'GET') {
      return { status: 200, body: { founders: options.founders ?? [FOUNDER_ROW] } };
    }
    if (url === '/api/admin/founders/invitation-copy') {
      return {
        status: 200,
        body: { processSummary: PROCESS_SUMMARY, noGuarantee: NO_GUARANTEE, retentionDays: 30 },
      };
    }
    if (url === '/api/admin/founders/d1/preview') {
      return { status: 200, body: options.preview ?? previewFor() };
    }
    if (url === '/api/admin/founders/d1' && (init?.method ?? 'GET') === 'GET') {
      return { status: 200, body: options.detail ?? detailFor() };
    }
    return undefined;
  });
}

function renderAt(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  return render(<RouterProvider router={router} />);
}

/* ── §26.1 Users → Founders ───────────────────────────────────────────────── */

describe('§26.1 the Founders list', () => {
  it('shows each prospect with its invitation state and the retention date', async () => {
    stubAdmin();
    renderAt('/admin/founders');

    await screen.findByRole('heading', { name: /^founders$/i, level: 1 });

    const row = screen.getByRole('row', { name: /Rowan Vale/ });
    expect(within(row).getByText('Waitlist')).toBeInTheDocument();
    expect(within(row).getByText('Invitation sent')).toBeInTheDocument();
    expect(within(row).getByText(/introduced by a mutual contact/)).toBeInTheDocument();
  });

  it('says plainly when nobody has been invited yet', async () => {
    stubAdmin({ founders: [] });
    renderAt('/admin/founders');

    expect(await screen.findByText(/no founder prospects yet/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing is sent until you compose/i)).toBeInTheDocument();
  });

  it('offers no field that would promise an outcome (§7)', async () => {
    const user = userEvent.setup();
    stubAdmin();
    renderAt('/admin/founders');
    await screen.findByRole('heading', { name: /^founders$/i, level: 1 });

    await user.click(screen.getByRole('button', { name: /create a prospect/i }));
    await screen.findByRole('heading', { name: /new founder prospect/i });

    // §7 forbids promising acceptance, results, reward pricing, or a named
    // Creator's participation. There is no field for any of them.
    for (const forbidden of [/reward price/i, /guaranteed/i, /promised creator/i, /assigned creator/i]) {
      expect(screen.queryByLabelText(forbidden)).toBeNull();
    }
    // What §7 does allow is present, and labelled as a hypothesis.
    expect(screen.getByLabelText(/creator-sourcing hypothesis/i)).toBeInTheDocument();
    expect(screen.getByText(/never a commitment that a named Creator will take it on/i)).toBeInTheDocument();
  });

  it('says the phone is never verified (§33.1.8)', async () => {
    const user = userEvent.setup();
    stubAdmin();
    renderAt('/admin/founders');
    await screen.findByRole('heading', { name: /^founders$/i, level: 1 });
    await user.click(screen.getByRole('button', { name: /create a prospect/i }));

    expect(
      await screen.findByText(/never verifies a phone number and never sends codes/i),
    ).toBeInTheDocument();
  });

  it('will not create a prospect without the fields §7 requires', async () => {
    const user = userEvent.setup();
    stubAdmin();
    renderAt('/admin/founders');
    await screen.findByRole('heading', { name: /^founders$/i, level: 1 });
    await user.click(screen.getByRole('button', { name: /create a prospect/i }));

    const submit = await screen.findByRole('button', { name: /create prospect and campaign/i });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText(/legal name/i), 'Rowan Vale');
    await user.type(screen.getByLabelText(/email address/i), 'rowan@example.com');
    await user.type(screen.getByLabelText(/product or startup name/i), 'Waitlist');
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText(/invitation source/i), 'a mutual contact');
    await user.type(screen.getByLabelText(/internal campaign owner/i), 'Ada Admin');
    expect(submit).toBeEnabled();
  });
});

/* ── §7 the invitation surface ────────────────────────────────────────────── */

describe('§7 the invitation', () => {
  it('disables Send while a placeholder is unresolved, and names each one', async () => {
    stubAdmin({ preview: previewFor(['[WHY THIS FOUNDER WAS INVITED]', '[SENDER NAME]']) });
    renderAt('/admin/founders/d1');

    await screen.findByRole('heading', { name: /^invitation$/i });

    expect(screen.getByText(/send is unavailable/i)).toBeInTheDocument();
    expect(screen.getByText('[WHY THIS FOUNDER WAS INVITED]')).toBeInTheDocument();
    expect(screen.getByText('[SENDER NAME]')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /resend invitation/i })).toBeDisabled();
  });

  it('enables Send once the server reports nothing unresolved', async () => {
    stubAdmin();
    renderAt('/admin/founders/d1');
    await screen.findByRole('heading', { name: /^invitation$/i });

    expect(screen.queryByText(/send is unavailable/i)).toBeNull();
    expect(screen.getByRole('button', { name: /resend invitation/i })).toBeEnabled();
  });

  it('never displays the draft link, and says why', async () => {
    stubAdmin();
    renderAt('/admin/founders/d1');
    await screen.findByRole('heading', { name: /^invitation$/i });

    expect(screen.getByText(/a link is live/i)).toBeInTheDocument();
    expect(screen.getByText(/the link itself is never shown here/i)).toBeInTheDocument();
    // Nothing anywhere on the page looks like a draft URL.
    expect(document.body.textContent).not.toMatch(/\/draft\/[A-Za-z0-9_-]{20,}/);
  });

  it('warns that a resend replaces the old link and restarts the window', async () => {
    stubAdmin();
    renderAt('/admin/founders/d1');
    await screen.findByRole('heading', { name: /^invitation$/i });

    expect(screen.getByText(/resending restarts that window/i)).toBeInTheDocument();
  });

  it('will not revoke without a reason (§25.6)', async () => {
    const user = userEvent.setup();
    stubAdmin();
    renderAt('/admin/founders/d1');
    await screen.findByRole('heading', { name: /^invitation$/i });

    await user.click(screen.getByRole('button', { name: /revoke link/i }));
    const confirm = await screen.findByRole('button', { name: /revoke the link/i });
    expect(confirm).toBeDisabled();

    await user.type(screen.getByLabelText(/why is this being revoked/i), 'not a fit');
    expect(confirm).toBeEnabled();
  });

  it('sends the composed content and reports the outcome', async () => {
    const user = userEvent.setup();
    stubAdmin();
    handlers.unshift((url, init) =>
      url === '/api/admin/founders/d1/send' && init?.method === 'POST'
        ? { status: 201, body: { sendId: 's2', tokenVersion: 2, resent: true } }
        : undefined,
    );

    renderAt('/admin/founders/d1');
    await screen.findByRole('heading', { name: /^invitation$/i });

    await user.click(screen.getByRole('button', { name: /resend invitation/i }));

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/previous link no longer works/i),
    );
    expect(requests.some((r) => r.url === '/api/admin/founders/d1/send')).toBe(true);
  });

  it('surfaces a server refusal without paraphrasing it', async () => {
    const user = userEvent.setup();
    stubAdmin();
    handlers.unshift((url, init) =>
      url === '/api/admin/founders/d1/send' && init?.method === 'POST'
        ? {
            status: 422,
            body: {
              error: 'send_rejected',
              title: 'That invitation was not sent',
              whatHappened: 'The email provider did not accept the message.',
              next: 'Nothing was delivered.',
            },
          }
        : undefined,
    );

    renderAt('/admin/founders/d1');
    await screen.findByRole('heading', { name: /^invitation$/i });
    await user.click(screen.getByRole('button', { name: /resend invitation/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /The email provider did not accept the message\. Nothing was delivered\./,
    );
  });

  it('offers no controls at all on an anonymised draft', async () => {
    stubAdmin({
      detail: detailFor({
        draft: { ...detailFor().draft, anonymisedAt: '2026-08-20T00:00:00.000Z' },
        hasLiveToken: false,
      }),
    });
    renderAt('/admin/founders/d1');

    expect(await screen.findByText(/this draft was anonymised/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /send invitation/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /save invitation content/i })).toBeNull();
    expect(screen.getByText(/nothing here can be restored/i)).toBeInTheDocument();
  });
});

/* ── §26.2 Campaign detail ────────────────────────────────────────────────── */

describe('§26.2 the campaign record', () => {
  it('shows the parallel tracks and the three anchors separately (§21, §23.2)', async () => {
    stubAdmin();
    renderAt('/admin/founders/d1');

    await screen.findByRole('heading', { name: /^campaign$/i });

    expect(screen.getByRole('heading', { name: /parallel tracks/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /deadline anchors/i })).toBeInTheDocument();
    expect(screen.getByText('Listing paid at')).toBeInTheDocument();
    expect(screen.getByText('Campaign live at')).toBeInTheDocument();
    expect(screen.getByText('Campaign close at')).toBeInTheDocument();
    expect(screen.getAllByText('Not set yet').length).toBeGreaterThanOrEqual(3);
  });

  it('says payment state is never part of the lifecycle status (§23.1)', async () => {
    stubAdmin();
    renderAt('/admin/founders/d1');
    await screen.findByRole('heading', { name: /^campaign$/i });

    expect(
      screen.getByText(/payment and reconciliation state is not part of the lifecycle status/i),
    ).toBeInTheDocument();
  });
});

/* ── §7 / §33.1.1 the Founder's invited draft ─────────────────────────────── */

describe("§33.1.1 the Founder's draft landing state", () => {
  const LANDING = {
    recipientName: 'Rowan',
    productName: 'Waitlist',
    whatWeUnderstood: 'A scheduling tool for physiotherapists.',
    senderName: 'Ada Admin',
    expectedSetupTime: 'About two hours of your time.',
    reference: 'c1',
    processSummary: PROCESS_SUMMARY,
    noGuarantee: NO_GUARANTEE,
  };

  function stubDraft(result: StubResult) {
    handlers.push((url) => (url.startsWith('/api/draft/') ? result : undefined));
  }

  it('names the Founder and the product, and explains what happens next', async () => {
    stubDraft({ status: 200, body: LANDING });
    renderAt('/draft/a-token-value');

    expect(
      await screen.findByRole('heading', { name: /Rowan.*Waitlist.*run a campaign/i, level: 1 }),
    ).toBeInTheDocument();

    for (const step of PROCESS_SUMMARY) {
      expect(screen.getByText(step)).toBeInTheDocument();
    }
    expect(screen.getByText(NO_GUARANTEE)).toBeInTheDocument();
    expect(screen.getByText(/sent by Ada Admin at Proovd/i)).toBeInTheDocument();
  });

  it('asks for nothing — no account, no card, no form', async () => {
    stubDraft({ status: 200, body: LANDING });
    renderAt('/draft/a-token-value');
    await screen.findByRole('heading', { level: 1 });

    expect(screen.getByText(/nothing is needed from you yet/i)).toBeInTheDocument();
    // §34 gates live card collection; this surface mounts no payment field and
    // no credential field at all — disabled is not the same as absent.
    expect(document.querySelectorAll('form')).toHaveLength(0);
    expect(document.querySelectorAll('input, iframe, select, textarea')).toHaveLength(0);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('states that nothing has been created or charged', async () => {
    stubDraft({ status: 200, body: LANDING });
    renderAt('/draft/a-token-value');
    await screen.findByRole('heading', { level: 1 });

    expect(
      screen.getByText(/no account has been created, no card has been asked for/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/never ask you for your bank details/i)).toBeInTheDocument();
  });

  it('renders the one unusable-link surface for every failure (§5.5)', async () => {
    for (const status of [401, 404, 410, 429, 500]) {
      handlers = [];
      stubDraft({ status, body: { error: 'link_unavailable' } });
      const { unmount } = renderAt('/draft/a-token-value');

      expect(
        await screen.findByRole('heading', { name: /can.t open this link/i, level: 1 }),
      ).toBeInTheDocument();
      unmount();
    }
  });

  it('carries no dashboard density and no site nav (§26)', async () => {
    stubDraft({ status: 200, body: LANDING });
    renderAt('/draft/a-token-value');
    await screen.findByRole('heading', { level: 1 });

    expect(screen.queryByRole('navigation', { name: /admin sections/i })).toBeNull();
    expect(document.querySelectorAll('table')).toHaveLength(0);
  });

  it('has no axe violations', async () => {
    stubDraft({ status: 200, body: LANDING });
    const { container } = renderAt('/draft/a-token-value');
    await screen.findByRole('heading', { level: 1 });

    expect(await axe(container)).toHaveNoViolations();
  }, 30_000);
});

/* ── Accessibility on the Admin surfaces (§33.11) ─────────────────────────── */

describe('§33.11 the Phase 06b Admin surfaces are operable', () => {
  it.each([
    ['/admin/founders', /^founders$/i],
    ['/admin/founders/d1', /Rowan Vale/i],
  ])('has no axe violations at %s', async (path, heading) => {
    stubAdmin();
    const { container } = renderAt(path);
    await screen.findByRole('heading', { name: heading, level: 1 });

    expect(await axe(container)).toHaveNoViolations();
  }, 30_000);
});
