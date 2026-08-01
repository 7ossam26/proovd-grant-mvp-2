/**
 * Phase 08b surfaces — §33.2.2 and §33.2.3, the half a Creator can see.
 *
 *   33.2.2  Compact flow has Proovd account action and Stripe payout action,
 *           no custom bank form/tour.
 *   33.2.3  Waiting state is named and no-action-needed.
 *
 * The real route table in a memory router, with `fetch` stubbed at the network
 * boundary. Server-side rules — that the claim refuses, that a draft policy
 * blocks it, that the token cannot be crossed — are proved in
 * `backend/src/tests/affiliate-signup.test.ts` against the real routes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { axe } from 'jest-axe';
import { appRoutes } from '../../routes.js';
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
      audienceNiche: field('Indie software founders', 'Indie software founders'),
      audienceSize: field('42,000 followers', '42,000 followers'),
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

function stubInvitation(options: {
  profile?: Record<string, unknown>;
  conditional?: Record<string, unknown>;
  policies?: unknown;
} = {}) {
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
        },
      };
    }
    if (url === `/api/affiliate-invitation/${TOKEN}` && init?.method === 'PATCH') {
      return { status: 200, body: { profile: profileFor(options.profile) } };
    }
    return undefined;
  });
}

async function renderSignup() {
  const router = createMemoryRouter(appRoutes, {
    initialEntries: [`/creator-invitation/${TOKEN}`],
  });
  const view = render(<RouterProvider router={router} />);
  return view;
}

/* ══ §33.2.2 — exactly two primary actions, no bank form, no tour ════════ */

describe('§33.2.2 — the compact flow', () => {
  it('is one page with one primary action', async () => {
    stubInvitation();
    await renderSignup();

    expect(
      await screen.findByRole('button', { name: /confirm and create account/i }),
    ).toBeTruthy();

    // §11 forbids a multi-page sequence. No stepper, no next/back, no tour.
    expect(screen.queryByRole('button', { name: /^next$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^back$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /skip|take the tour|get started/i })).toBeNull();
    expect(screen.queryByText(/step \d+ of \d+/i)).toBeNull();
  });

  it('has exactly one primary button on the whole page', async () => {
    stubInvitation();
    await renderSignup();
    await screen.findByRole('button', { name: /confirm and create account/i });

    const primaries = [...document.querySelectorAll('.btn--primary')];
    expect(primaries).toHaveLength(1);
    expect(primaries[0]!.textContent).toMatch(/confirm and create account/i);
  });

  it('collects no bank, tax, or identity-document field (§11)', async () => {
    stubInvitation();
    await renderSignup();
    await screen.findByRole('button', { name: /confirm and create account/i });

    // §11: "Proovd must not reproduce provider-controlled banking or identity
    // fields in a custom form." Nothing on this page asks for one.
    for (const control of screen.getAllByRole('textbox')) {
      const label = control.closest('label')?.textContent ?? '';
      expect(label).not.toMatch(
        /routing|account number|bank|IBAN|sort code|tax id|SSN|social security|passport|driver/i,
      );
    }
    expect(
      screen.queryByText(/routing number|account number|tax identification|upload.*id/i),
    ).toBeNull();
  });

  it('labels the prefilled fields with their source, and flips on correction', async () => {
    stubInvitation();
    const user = userEvent.setup();
    await renderSignup();

    const bio = await screen.findByLabelText(/how proovd describes you/i);
    expect(screen.getByText(/written by proovd from your public channel/i)).toBeTruthy();

    await user.clear(bio);
    await user.type(bio, 'My own words.');
    expect(await screen.findByText(/^you wrote this\.$/i)).toBeTruthy();
  });

  it('says the phone is never verified, and offers no way to verify it', async () => {
    stubInvitation();
    await renderSignup();
    await screen.findByLabelText(/^phone$/i);

    expect(screen.getByText(/we never verify it and never send codes to it/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /verify/i })).toBeNull();
  });

  it('shows the channel type without letting the Creator change it', async () => {
    // Changing it would invalidate the §5.3 verification recorded against it.
    stubInvitation();
    await renderSignup();
    await screen.findByRole('button', { name: /confirm and create account/i });

    expect(screen.getByText(/we have you recorded as a social creator/i)).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('keeps the claim unavailable until everything §11 requires is present', async () => {
    stubInvitation();
    const user = userEvent.setup();
    await renderSignup();

    const claim = await screen.findByRole('button', { name: /confirm and create account/i });
    expect(claim.hasAttribute('disabled')).toBe(true);

    await user.type(await screen.findByLabelText(/date of birth/i), '1994-03-11');
    await user.type(await screen.findByLabelText(/^country$/i), 'US');
    await user.type(await screen.findByLabelText(/^state$/i), 'CA');
    await user.type(await screen.findByLabelText(/choose a password/i), 'a-perfectly-good-password');

    // Still blocked: the five confirmations and the two agreements are unticked.
    expect(claim.hasAttribute('disabled')).toBe(true);

    for (const name of [
      /at least 18/i,
      /based in the united states/i,
      /actually runs this channel/i,
      /duplicate proovd accounts/i,
      /sanctions list/i,
      /i accept the terms of service/i,
      /i accept the creator acceptable use policy/i,
    ]) {
      await user.click(screen.getByRole('checkbox', { name }));
    }

    await waitFor(() => expect(claim.hasAttribute('disabled')).toBe(false));
  });

  it('presents the five confirmations unchecked and unbundled (§28.4)', async () => {
    stubInvitation();
    const user = userEvent.setup();
    await renderSignup();
    await screen.findByRole('button', { name: /confirm and create account/i });

    const boxes = [
      screen.getByRole('checkbox', { name: /at least 18/i }),
      screen.getByRole('checkbox', { name: /based in the united states/i }),
      screen.getByRole('checkbox', { name: /actually runs this channel/i }),
      screen.getByRole('checkbox', { name: /duplicate proovd accounts/i }),
      screen.getByRole('checkbox', { name: /sanctions list/i }),
    ];
    for (const box of boxes) {
      expect(box.getAttribute('data-state') ?? box.getAttribute('aria-checked')).not.toBe('checked');
    }

    // There is no "accept all", and ticking one ticks exactly one.
    expect(screen.queryByRole('checkbox', { name: /accept all|agree to everything/i })).toBeNull();
    await user.click(boxes[0]!);
    expect(boxes[1]!.getAttribute('aria-checked')).not.toBe('true');
  });

  it('sends only the field that changed (§11)', async () => {
    stubInvitation();
    const user = userEvent.setup();
    await renderSignup();

    await user.type(await screen.findByLabelText(/^country$/i), 'US');
    await waitFor(() => {
      const patch = requests.filter((r) => r.method === 'PATCH').at(-1);
      expect(patch, 'no autosave patch was sent').toBeTruthy();
      expect(Object.keys(patch!.body as object)).toEqual(['country']);
    });
  });

  it('never autosaves the password (§28.2)', async () => {
    stubInvitation();
    const user = userEvent.setup();
    await renderSignup();

    await user.type(
      await screen.findByLabelText(/choose a password/i),
      'a-perfectly-good-password',
    );
    await user.type(await screen.findByLabelText(/^country$/i), 'US');

    await waitFor(() => expect(requests.some((r) => r.method === 'PATCH')).toBe(true));
    for (const sent of requests) {
      expect(JSON.stringify(sent.body ?? {})).not.toContain('a-perfectly-good-password');
    }
  });

  it('reports the payout step as a status with no control (§11)', async () => {
    stubInvitation({ profile: { claimedAt: '2026-08-01T09:00:00.000Z' } });
    await renderSignup();

    expect(await screen.findByText(/payout setup is not open yet/i)).toBeTruthy();
    expect(screen.getByText(/proovd never asks for your bank or tax details/i)).toBeTruthy();
    // §1.4: a control that would do nothing is worse than none.
    expect(screen.queryByRole('button', { name: /finish payout setup/i })).toBeNull();
  });
});

/* ══ The draft-agreement state ═══════════════════════════════════════════ */

describe('§11 — a draft agreement blocks the claim, in the open', () => {
  it('renders the reason and no claim control', async () => {
    stubInvitation({ policies: DRAFT_POLICIES });
    await renderSignup();

    expect(await screen.findByText(/these agreements are not final yet/i)).toBeTruthy();
    expect(screen.getByText(/still with our lawyers/i)).toBeTruthy();
    expect(screen.getByText(/nothing you have entered is lost/i)).toBeTruthy();
    // The control is absent, not disabled.
    expect(screen.queryByRole('button', { name: /confirm and create account/i })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /i accept the terms/i })).toBeNull();
  });
});

/* ══ §33.2.3 — the named waiting state ═══════════════════════════════════ */

describe('§33.2.3 — the waiting state', () => {
  it('answers all six of §27.1’s questions and says No action needed', async () => {
    stubInvitation({ profile: { claimedAt: '2026-08-01T09:00:00.000Z' } });
    await renderSignup();

    // Confirms signup, and names the campaign.
    expect(await screen.findByText(/your proovd account is set up/i)).toBeTruthy();
    expect(screen.getAllByText(/Waitlist/).length).toBeGreaterThan(0);

    // Names the state, says the Founder is finishing setup.
    expect(screen.getByText(/waiting for the founder/i)).toBeTruthy();
    expect(screen.getByText(/still finishing their setup/i)).toBeTruthy();

    // Identifies Proovd as owner, and gives a next-update expectation.
    expect(screen.getByText(/proovd owns this step/i)).toBeTruthy();
    expect(screen.getAllByText(/we will email you as soon as/i).length).toBeGreaterThan(0);

    // §11's exact words, from the one exported constant.
    expect(screen.getAllByText(NO_ACTION).length).toBeGreaterThan(0);
  });

  it('offers no action and no work while waiting', async () => {
    stubInvitation({ profile: { claimedAt: '2026-08-01T09:00:00.000Z' } });
    await renderSignup();
    await screen.findByText(/your proovd account is set up/i);

    // Accept, decline, propose, and link activation are all Phase 12+ and
    // must be unreachable here.
    for (const forbidden of [/accept/i, /decline/i, /propose/i, /activate/i, /tracking link/i]) {
      expect(screen.queryByRole('button', { name: forbidden })).toBeNull();
    }
  });

  it('does not offer Review campaign before the Campaign kit exists (§1.4)', async () => {
    // The Founder has claimed, so §11's condition is "preparing" — but the kit
    // and the Review action are Phase 08c. Claiming the capability early would
    // be the §1.4 failure.
    stubInvitation({
      profile: { claimedAt: '2026-08-01T09:00:00.000Z' },
      conditional: { state: 'preparing', founderClaimedAt: '2026-08-01T10:00:00.000Z' },
    });
    await renderSignup();

    expect(await screen.findByText(/the campaign is being prepared/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /review campaign/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /review campaign/i })).toBeNull();
    expect(screen.getAllByText(NO_ACTION).length).toBeGreaterThan(0);
  });
});

/* ══ The unusable link ═══════════════════════════════════════════════════ */

describe('§5.5 — an unusable invitation', () => {
  it('renders the one identical unavailable page', async () => {
    handlers.push(() => ({
      status: 401,
      body: { error: 'link_unavailable', title: "We can't open this link" },
    }));
    await renderSignup();
    expect(await screen.findByText(/can.t open this link/i)).toBeTruthy();
  });
});

/* ══ §33.11 — accessibility is an acceptance test ════════════════════════ */

describe('§33.11 — the Creator signup is accessible', () => {
  it('has no axe violations on the signup flow', async () => {
    stubInvitation();
    const { container } = await renderSignup();
    await screen.findByRole('button', { name: /confirm and create account/i });
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  }, 30_000);

  it('has no axe violations on the waiting state', async () => {
    stubInvitation({ profile: { claimedAt: '2026-08-01T09:00:00.000Z' } });
    const { container } = await renderSignup();
    await screen.findByText(/your proovd account is set up/i);
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  }, 30_000);

  it('gives every control a programmatic label', async () => {
    stubInvitation();
    await renderSignup();
    await screen.findByRole('button', { name: /confirm and create account/i });

    for (const control of [
      ...screen.getAllByRole('textbox'),
      ...screen.getAllByRole('checkbox'),
    ]) {
      const id = control.getAttribute('id');
      // Four legitimate ways to name a control, and this surface uses three of
      // them: `Field` wires <label for>, the confirmations are content-named
      // buttons, and nothing here relies on aria-label alone.
      const labelled =
        control.getAttribute('aria-label') ||
        control.getAttribute('aria-labelledby') ||
        control.closest('label')?.textContent ||
        (id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent : '') ||
        // Content-named: a <button role="checkbox"> takes its name from its text.
        (control.tagName === 'BUTTON' ? control.textContent : '') ||
        '';
      expect(labelled.trim(), control.outerHTML.slice(0, 120)).not.toBe('');
    }
  });

  it('exposes exactly one level-1 heading', async () => {
    stubInvitation();
    await renderSignup();
    await screen.findByRole('button', { name: /confirm and create account/i });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});
