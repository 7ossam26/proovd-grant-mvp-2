/**
 * §33.2.2 and §33.2.3 — the half of the Creator's signup a person can see.
 *
 *   33.2.2  Compact flow has Proovd account action and Stripe payout action,
 *           no custom bank form/tour.
 *   33.2.3  Waiting state is named and no-action-needed.
 *
 * The real route table in a memory router, with `fetch` stubbed at the network
 * boundary. Server-side rules — that the claim refuses, that a draft policy
 * blocks it, that the token cannot be crossed — are proved in
 * `backend/src/tests/affiliate-signup.test.ts` against the real routes.
 *
 * ── §33.2.2, RE-AUTHORED (Creator Flow v2 Session C, 2026-08-19) ────────────
 * §11 asks for "one compact account-and-profile flow" and forbids a
 * "multi-page education sequence"; §30 defers general product tours. Creator
 * Flow v2's **deviation 1** departs from that half by explicit product
 * direction, and `docs/phases/creator-flow-v2.md` records what it is not
 * licence for — not a public signup, not a second invitation mechanism, not a
 * tour anywhere else in the product.
 *
 * The half that is load-bearing does not move, and is what the tests below
 * assert: **one Proovd account action, one Stripe payout action, no custom bank
 * form.** Every §11 content bullet is still collected, the five confirmations
 * are still five separate unchecked controls writing five columns, no bank,
 * routing, tax-id or identity input exists on any screen, there is no public
 * route, and the invitation still claims exactly one association.
 *
 * ── Where the two states live now ──────────────────────────────────────────
 * The account action is screen 7 (`/agree`). The waiting state is screen 8
 * (`/creator/welcome`) — a SESSION address, because `completeAffiliateSignup`
 * claims and revokes the invitation token, so a "you are signed up" state at a
 * token address is one nobody can reach. `DoneStep` records that in full.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { axe } from 'jest-axe';
import { CREATOR_CONFIRMATIONS } from '@proovd/shared';
import { appRoutes } from '../../routes.js';
import { invalidateSession } from '../../lib/session.js';
import { NO_ACTION } from '../../components/index.js';

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

const TOKEN = 'a'.repeat(43);

const LANDING = {
  recipientName: '@sambuilds',
  publicHandle: '@sambuilds',
  founderName: 'Rowan Vale',
  productName: 'Waitlist',
  whyRecruited: 'Your last three threads each ran past 200 replies.',
  reviewedPresence: 'Your public profile.',
  senderName: 'Ada Admin',
  reference: 'campaign-1',
};

const field = (value: string | null, prefilled: string | null = null) => ({
  value,
  supplier: prefilled === null ? (value === null ? null : 'affiliate') : 'proovd',
  prefilled,
  editedAt: null,
});

function profileFor(overrides: Record<string, unknown> = {}) {
  return {
    associationId: 'a1',
    campaignId: 'campaign-1',
    fields: {
      legalName: field('Sam Okafor', 'Sam Okafor'),
      publicHandle: field('@sambuilds', '@sambuilds'),
      email: field('sam@example.com', 'sam@example.com'),
      phone: field('+1 555 0199', '+1 555 0199'),
      channelReference: field('https://example.social/@sambuilds', 'https://example.social/@sambuilds'),
      channelType: field('instagram'),
      audienceNiche: field('Indie software founders', 'Indie software founders'),
      audienceSize: field('42,000 followers', '42,000 followers'),
      nicheDescription: field('Threads about shipping alone.'),
      outreachPlan: field(null),
      bio: field('Sam writes about building software alone.', 'Sam writes about building software alone.'),
      dateOfBirth: field(null),
      country: field(null),
      stateRegion: field(null),
    },
    channelSubtype: 'social_creator',
    phoneVerified: false,
    confirmations: {
      age18Plus: false,
      usBased: false,
      actualOperator: false,
      noDuplicateAccounts: false,
      sanctionsEligible: false,
    },
    payout: { status: 'not_started', connectedAccountId: null, requirements: null, updatedAt: null },
    lastSavedAt: null,
    claimedAt: null,
    ...overrides,
  };
}

const PUBLISHED_POLICIES = [
  { slug: 'terms', title: 'Terms of Service', version: '1.0', status: 'published', route: '/terms' },
  {
    slug: 'affiliate-aup',
    title: 'Creator Acceptable Use Policy',
    version: '1.0',
    status: 'published',
    route: '/affiliate-aup',
  },
];

const DRAFT_POLICIES = PUBLISHED_POLICIES.map((p) => ({ ...p, status: 'draft' }));

/**
 * §13's onboarding state, as the server would report it.
 *
 * Phase 10b's panel reads `/api/creator/payouts` on mount, so every case that
 * renders screen 8 needs one — a case that does not stub it gets no panel at
 * all, which is the honest behaviour when the state is unreadable.
 */
function stubPayouts(overrides: Record<string, unknown> = {}) {
  handlers.push((url) =>
    url === '/api/creator/payouts'
      ? {
          status: 200,
          body: {
            payouts: {
              state: 'not_started',
              stripeAccountId: null,
              missingRequirements: [],
              pendingVerification: [],
              disabledReason: null,
              canResume: false,
              onboardingAvailable: false,
              listingFeeEligible: false,
              linkActivationBlocked: true,
              paymentReceiptBlocked: true,
              campaignReviewBlocked: false,
              lastSyncedAt: null,
              ...overrides,
            },
          },
        }
      : undefined,
  );
}

function stubInvitation(
  options: {
    profile?: Record<string, unknown>;
    conditional?: Record<string, unknown>;
    policies?: unknown;
    uploads?: { available: boolean };
  } = {},
) {
  handlers.push((url, init) => {
    if (url === `/api/affiliate-invitation/${TOKEN}` && (init?.method ?? 'GET') === 'GET') {
      return {
        status: 200,
        body: {
          landing: LANDING,
          profile: profileFor(options.profile),
          conditional: {
            state: 'not_signed_up',
            campaignId: 'campaign-1',
            productName: 'Waitlist',
            founderClaimedAt: null,
            listingPaidAt: null,
            payoutStatus: 'not_started',
            reviewAvailable: false,
            ...options.conditional,
          },
          policies: options.policies ?? PUBLISHED_POLICIES,
          voice: { tones: [], customTones: [], flexible: false, recordedAt: null },
          metrics: { values: {}, recordedAt: null },
          metricsAsked: ['followers', 'engagement'],
          uploads: options.uploads ?? { available: false },
        },
      };
    }
    if (url === `/api/affiliate-invitation/${TOKEN}` && init?.method === 'PATCH') {
      return { status: 200, body: { profile: profileFor(options.profile) } };
    }
    return undefined;
  });
}

/**
 * Screen 8 is behind `RequireRole allow={['affiliate']}`, so it needs a real
 * session answer. The account exists by the time this screen renders — the
 * claim is what put it there.
 */
function stubSignedIn() {
  handlers.push((url) =>
    url === '/api/account/me'
      ? {
          status: 200,
          body: {
            account: {
              id: 'u1',
              email: 'sam@example.com',
              name: 'Sam Okafor',
              role: 'affiliate',
            },
          },
        }
      : undefined,
  );
}

/** Screen 8's own read. The account exists by the time this is called. */
function stubCampaigns(overrides: Record<string, unknown> = {}) {
  handlers.push((url) =>
    url === '/api/creator/campaigns'
      ? {
          status: 200,
          body: {
            campaigns: [
              {
                associationId: 'a1',
                campaignId: 'campaign-1',
                productName: 'Waitlist',
                status: 'creator_prep',
                revealedAt: null,
                revoked: false,
                reviewAvailable: false,
                ...overrides,
              },
            ],
          },
        }
      : undefined,
  );
}

async function renderAt(path: string) {
  // The session read is module-cached and shared across every caller on the
  // page, so one test's answer would otherwise be the next test's first paint.
  invalidateSession();
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  return render(<RouterProvider router={router} />);
}

/** Screen 7 — the agreement, and §11's one account action. */
const renderAgree = () => renderAt(`/creator-invitation/${TOKEN}/agree`);
/** Screen 8 — the account, and §11's one payout action. */
const renderDone = () => {
  stubSignedIn();
  return renderAt('/creator/welcome');
};

/* ══ §33.2.2 — one account action, one payout action, no bank form ════════ */

describe('§33.2.2 — the account action and the payout action', () => {
  it('offers exactly one primary action on the screen that creates the account', async () => {
    stubInvitation();
    await renderAgree();

    await screen.findByRole('heading', { level: 1 });
    const primaries = document.querySelectorAll('.btn--primary');
    expect(primaries).toHaveLength(1);
    expect(primaries[0]!.textContent).toContain('Confirm and create account');
  });

  it('collects no bank, tax, or identity-document field (§11)', async () => {
    stubInvitation();
    await renderAgree();
    await screen.findByRole('heading', { level: 1 });

    const forbidden = /account number|routing|iban|sort code|ssn|social security|ein|tax id|passport|driver|upload/i;
    for (const control of Array.from(document.querySelectorAll('input, textarea, select'))) {
      const label = document.querySelector(`label[for="${control.id}"]`)?.textContent ?? '';
      expect(label).not.toMatch(forbidden);
      expect(control.getAttribute('name') ?? '').not.toMatch(forbidden);
    }
    // There is no route to post one to either, which is what actually makes it
    // true — the absence of the field is only the visible half.
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('presents the five confirmations unchecked and unbundled (§28.4)', async () => {
    stubInvitation();
    await renderAgree();
    await screen.findByRole('heading', { level: 1 });

    const boxes = screen.getAllByRole('checkbox');
    // The five §11 confirmations plus the two §11 policy acceptances. Both sets
    // are separate controls; nothing on the page sets more than one.
    expect(boxes).toHaveLength(CREATOR_CONFIRMATIONS.length + PUBLISHED_POLICIES.length);
    for (const box of boxes) expect(box.getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByText(/accept all/i)).toBeNull();
  });

  it('writes one column per confirmation, and never two from one control', async () => {
    stubInvitation();
    const user = userEvent.setup();
    await renderAgree();
    await screen.findByRole('heading', { level: 1 });

    await user.click(screen.getByRole('checkbox', { name: CREATOR_CONFIRMATIONS[0]!.label }));
    await waitFor(() => {
      const patch = requests.find((r) => r.method === 'PATCH');
      expect(patch).toBeTruthy();
      expect(Object.keys(patch!.body as object)).toEqual([CREATOR_CONFIRMATIONS[0]!.key]);
    });
  });

  it('keeps the account action unavailable until everything §11 requires is present', async () => {
    stubInvitation();
    await renderAgree();
    await screen.findByRole('heading', { level: 1 });
    expect(
      screen.getByRole('button', { name: /confirm and create account/i }),
    ).toBeDisabled();
  });

  it('reports the payout step as a status with no control while Stripe is unconfigured (§11, §1.4)', async () => {
    stubCampaigns();
    stubPayouts({ onboardingAvailable: false });
    await renderDone();

    expect(await screen.findByText(/payout setup is not open yet/i)).toBeTruthy();
    expect(screen.getByText(/proovd never asks for your bank or tax details/i)).toBeTruthy();
    // §1.4: a control that would do nothing is worse than none. Phase 10b gives
    // this panel a real handoff; while the provider is unconfigured it still
    // renders none.
    expect(screen.queryByRole('button', { name: /finish payout setup/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /set up payouts/i })).toBeNull();
  });

  it('offers the Stripe handoff once it is available, and still no form (§11, §5.3)', async () => {
    stubCampaigns();
    stubPayouts({ onboardingAvailable: true, canResume: true });
    await renderDone();

    expect(await screen.findByRole('button', { name: /set up payouts/i })).toBeTruthy();

    // §11 forbids reproducing provider-controlled fields and §5.3 says Proovd
    // stores statuses and IDs and never full bank details. The handoff is the
    // whole integration — there is no field here to collect one.
    for (const label of [/bank/i, /routing/i, /account number/i, /tax id/i, /ssn/i]) {
      expect(screen.queryByLabelText(label)).toBeNull();
    }
  });

  it('names the exact missing requirement rather than saying "more information" (§13)', async () => {
    stubCampaigns();
    stubPayouts({
      state: 'more_information_required',
      onboardingAvailable: true,
      canResume: true,
      missingRequirements: ['external_account', 'individual.verification.document'],
    });
    await renderDone();

    expect(
      await screen.findByText(/a bank account to be paid into.*a photo of your ID/i),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /finish payout setup/i })).toBeTruthy();
  });

  it('offers a restricted account support and no way to try again (§13)', async () => {
    stubCampaigns();
    stubPayouts({
      state: 'restricted',
      onboardingAvailable: true,
      canResume: false,
      disabledReason: 'rejected.fraud',
    });
    await renderDone();

    expect(await screen.findByText(/stripe cannot continue with this account/i)).toBeTruthy();
    // §13: a safe support path, and no resume — looping someone through
    // onboarding that will fail again is the §1.4 failure with a spinner on it.
    expect(screen.queryByRole('button', { name: /payout/i })).toBeNull();
    // §13 again: restricted must never offer a route to payment.
    expect(screen.queryByRole('button', { name: /pay/i })).toBeNull();
  });
});

/* ══ The agreement screen's own §1.8 refusals ════════════════════════════ */

describe('§22.1, §29.5, §31.5 — what the agreement screen does not promise', () => {
  it('does not claim earnings can never be clawed back', async () => {
    stubInvitation();
    await renderAgree();
    await screen.findByRole('heading', { level: 1 });

    const text = document.body.textContent ?? '';
    // §22.1 provides for cancelling unpaid invalid amounts and a contractual
    // recovery record; §29.5 protects only VALID FINALIZED commission.
    expect(text).not.toMatch(/no clawbacks/i);
    expect(text).not.toMatch(/your (money|pay) is guaranteed/i);
    expect(text).toMatch(/can be reversed/i);
  });

  it('takes two policy acceptances and says why the IP agreement is not one', async () => {
    stubInvitation();
    await renderAgree();
    await screen.findByRole('heading', { level: 1 });

    // §11's two. §31.5's IP agreement is per campaign and due before WORK.
    expect(screen.getAllByRole('checkbox')).toHaveLength(
      CREATOR_CONFIRMATIONS.length + 2,
    );
    expect(screen.getByText(/per campaign/i)).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: /IP|NDA|confidentiality/i })).toBeNull();
  });
});

/* ══ The draft-agreement state ═══════════════════════════════════════════ */

describe('§11 — a draft agreement blocks the claim, in the open', () => {
  it('renders the reason and no claim control', async () => {
    stubInvitation({ policies: DRAFT_POLICIES });
    await renderAgree();

    await screen.findByText(/still with our lawyers/i);
    expect(screen.queryByRole('button', { name: /confirm and create account/i })).toBeNull();
  });
});

/* ══ §33.2.3 — the named waiting state ═══════════════════════════════════ */

describe('§33.2.3 — the waiting state', () => {
  it('answers all six of §27.1’s questions and says No action needed', async () => {
    stubCampaigns();
    stubPayouts();
    await renderDone();

    const head = await screen.findByText(/waiting for the founder/i);
    // Scoped to the waiting panel: the payout panel is a `StatePanel` too and
    // legitimately says `No action needed` while Stripe is unconfigured. A
    // page-wide query would find both and report a duplicate that is not one.
    const panel = head.closest('.state-panel') as HTMLElement;
    expect(within(panel).getByText(/still finishing their setup/i)).toBeTruthy();
    expect(within(panel).getByText(/proovd owns this step/i)).toBeTruthy();
    expect(within(panel).getByText(NO_ACTION)).toBeTruthy();
    expect(within(panel).getByText(/we will email you/i)).toBeTruthy();
  });

  it('offers no action and no work while waiting', async () => {
    stubCampaigns();
    stubPayouts();
    await renderDone();

    await screen.findByText(/waiting for the founder/i);
    expect(screen.queryByRole('button', { name: /accept|decline|propose|review campaign/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /review campaign/i })).toBeNull();
  });

  it('offers Review campaign only once there is something to read (§10, §1.4)', async () => {
    stubCampaigns({ reviewAvailable: true });
    stubPayouts();
    await renderDone();

    await screen.findByText(/ready to read/i);
    expect(screen.getByRole('link', { name: /review campaign/i })).toBeTruthy();
  });

  it('lives at an account address, because the claim revokes the token', async () => {
    // The regression this screen exists to fix: Phase 08b re-read the
    // invitation after a successful claim, and that read 401s in production.
    // Nothing on screen 8 talks to `/api/affiliate-invitation`.
    stubCampaigns();
    stubPayouts();
    await renderDone();
    await screen.findByText(/waiting for the founder/i);

    expect(requests.some((r) => r.url.includes('/api/affiliate-invitation'))).toBe(false);
  });
});

/* ══ The unusable link ═══════════════════════════════════════════════════ */

describe('§5.5 — an unusable invitation', () => {
  it('renders the one identical unavailable page', async () => {
    handlers.push(() => ({ status: 401, body: { error: 'invalid' } }));
    await renderAgree();
    await screen.findByRole('heading', { name: /link seems to have broken/i });
  });
});

/* ══ §33.11 — accessibility is an acceptance test ════════════════════════ */

describe('§33.11 — the Creator signup is accessible', () => {
  it('has no axe violations on the agreement screen', async () => {
    stubInvitation();
    const { container } = await renderAgree();
    await screen.findByRole('heading', { level: 1 });
    expect(await axe(container)).toHaveNoViolations();
  });

  it('has no axe violations on the waiting state', async () => {
    stubCampaigns();
    stubPayouts();
    const { container } = await renderDone();
    await screen.findByText(/waiting for the founder/i);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('gives every control a programmatic label', async () => {
    stubInvitation();
    await renderAgree();
    await screen.findByRole('heading', { level: 1 });

    for (const control of Array.from(
      document.querySelectorAll<HTMLElement>('input, textarea, select'),
    )) {
      const labelled =
        control.getAttribute('aria-label') ??
        control.getAttribute('aria-labelledby') ??
        (control.id ? document.querySelector(`label[for="${control.id}"]`)?.textContent : null);
      expect(labelled, `unlabelled control: ${control.outerHTML.slice(0, 80)}`).toBeTruthy();
    }
  });

  it('exposes exactly one level-1 heading on each screen', async () => {
    stubInvitation();
    const agree = await renderAgree();
    await screen.findByRole('heading', { level: 1 });
    expect(within(agree.container).getAllByRole('heading', { level: 1 })).toHaveLength(1);
    agree.unmount();

    stubCampaigns();
    stubPayouts();
    const done = await renderDone();
    await screen.findByText(/waiting for the founder/i);
    expect(within(done.container).getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});
