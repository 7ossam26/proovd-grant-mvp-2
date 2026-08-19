/**
 * The Creator onboarding flow, screens 0–3 — Creator Flow v2, Session B,
 * 2026-08-19.
 *
 * The real route table in a memory router with `fetch` stubbed at the network
 * boundary, the arrangement `creator-signup.test.tsx` and `founder-flow.test.tsx`
 * both use. Server-side rules are proved against the real routes in
 * `backend/src/tests/affiliate-signup.test.ts` and `creator-flow.test.ts`; what
 * is proved here is what a person meets.
 *
 * Three things this suite is deliberately about, because each is a place the
 * reference and the Spec disagree and the disagreement is invisible in a
 * screenshot:
 *
 *   1. The password requirement list matches the SERVER. The reference draws
 *      four ticks and the claim enforces one thing, so shipping the reference's
 *      list would tick everything green and then be refused six screens later.
 *   2. The email is editable. The reference renders it `Locked`; §11 gives the
 *      correction right, and it is the address every message goes to.
 *   3. The nine tiles do not resolve the §5.3 subtype. A Creator's answer and
 *      an Admin's classification are two facts, and overwriting the second with
 *      the first would silently invalidate a recorded verification.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { axe } from 'jest-axe';
import {
  CREATOR_CHANNEL_TILES,
  CREATOR_FLOW_ABSENCES,
  CREATOR_FLOW_PAGES,
  CREATOR_PASSWORD_MIN_LENGTH,
  CREATOR_PASSWORD_REQUIREMENTS,
  creatorFlowPath,
} from '@proovd/shared';
import { appRoutes } from '../../routes.js';
import { clearDraft } from './draft.js';

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
  // Module state survives between tests in one file, and the password holder is
  // module state on purpose. A screen that found a leftover password would pass
  // for the wrong reason.
  clearDraft();
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

afterEach(() => {
  vi.unstubAllGlobals();
  clearDraft();
});

const TOKEN = 'b'.repeat(43);

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
      phone: field(null),
      channelReference: field('https://example.social/@sambuilds', 'https://example.social/@sambuilds'),
      channelType: field(null),
      audienceNiche: field('Indie software founders', 'Indie software founders'),
      audienceSize: field('42,000 followers', '42,000 followers'),
      nicheDescription: field(null),
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

function stubInvitation(options: { profile?: Record<string, unknown> } = {}) {
  handlers.push((url, init) => {
    if (url === `/api/affiliate-invitation/${TOKEN}` && (init?.method ?? 'GET') === 'GET') {
      return {
        status: 200,
        body: {
          landing: {
            recipientName: 'Sam',
            publicHandle: '@sambuilds',
            founderName: 'Rowan Vale',
            productName: 'Waitlist',
            whyRecruited: 'Your last three threads each ran past 200 replies.',
            reviewedPresence: 'Your public profile.',
            senderName: 'Ada Admin',
            reference: 'campaign-1',
          },
          profile: profileFor(options.profile),
          conditional: {
            state: 'not_signed_up',
            campaignId: 'campaign-1',
            productName: 'Waitlist',
            founderClaimedAt: null,
            listingPaidAt: null,
            payoutStatus: 'not_started',
            reviewAvailable: false,
          },
          policies: [
            { slug: 'terms', title: 'Terms of Service', version: '1.0', status: 'published', route: '/terms' },
            { slug: 'affiliate-aup', title: 'Creator Acceptable Use Policy', version: '1.0', status: 'published', route: '/affiliate-aup' },
          ],
        },
      };
    }
    if (url === `/api/affiliate-invitation/${TOKEN}` && init?.method === 'PATCH') {
      return { status: 200, body: { profile: profileFor(options.profile) } };
    }
    return undefined;
  });
}

async function renderAt(pageId: string) {
  const router = createMemoryRouter(appRoutes, {
    initialEntries: [creatorFlowPath(pageId, TOKEN)],
  });
  return render(<RouterProvider router={router} />);
}

const patches = () =>
  requests.filter((r) => r.method === 'PATCH').map((r) => r.body as Record<string, unknown>);

/* ══ The register, the router, and the help drawer agree ══════════════════ */

describe('the four pages are one list, read three ways', () => {
  it('registers exactly the four screens Session B built, all on the token', () => {
    expect(CREATOR_FLOW_PAGES.map((p) => p.id)).toEqual([
      'welcome',
      'password',
      'profile',
      'channel',
    ]);
    for (const page of CREATOR_FLOW_PAGES) {
      expect(page.param).toBe('token');
      expect(page.stage).toBe(1);
    }
  });

  it('gives every registered page a real address', async () => {
    stubInvitation();
    for (const page of CREATOR_FLOW_PAGES) {
      const router = createMemoryRouter(appRoutes, {
        initialEntries: [creatorFlowPath(page.id, TOKEN)],
      });
      const view = render(<RouterProvider router={router} />);
      // A page in the register with no route renders nothing at all, which is
      // the failure this assertion exists to catch.
      expect(await view.findByRole('heading', { level: 1 })).toBeTruthy();
      view.unmount();
    }
  });

  it('lists what is behind and nothing ahead', async () => {
    stubInvitation();
    const user = userEvent.setup();
    await renderAt('profile');
    await screen.findByRole('heading', { level: 1 });

    await user.click(screen.getByRole('button', { name: /^help$/i }));
    const drawer = await screen.findByRole('dialog');

    // Screen 2 is `profile`, so its own card and the two before it — and the
    // one AFTER it must not be offered, because a drawer listing what is to
    // come is a progress bar with reading attached.
    expect(within(drawer).getByText('You')).toBeTruthy();
    expect(within(drawer).getByText('Your password')).toBeTruthy();
    expect(within(drawer).getByText('Your invitation')).toBeTruthy();
    expect(within(drawer).queryByText('Your channel')).toBeNull();
  });
});

/* ══ Screen 0 — the invitation ════════════════════════════════════════════ */

describe('screen 0 — the invitation', () => {
  it('greets by the recorded name and refuses the reference’s two lines', async () => {
    stubInvitation();
    await renderAt('welcome');

    const head = await screen.findByRole('heading', { level: 1 });
    expect(head.textContent).toMatch(/Sam, you should never go hunting/i);

    const text = document.body.textContent ?? '';
    // Re-authored: §22.1 pays on a captured, validly attributed subtotal after
    // verification, never per visit.
    expect(text).not.toMatch(/every time they bite/i);
    // §28.4: no consent is recorded by arriving on a page.
    expect(text).not.toMatch(/by continuing you(’|')re agreeing/i);
    expect(text).toMatch(/pre-orders and their card is charged/i);
  });

  it('offers one way forward and it names where it goes', async () => {
    stubInvitation();
    await renderAt('welcome');
    await screen.findByRole('heading', { level: 1 });

    expect(screen.getByRole('button', { name: /set your password/i })).toBeTruthy();
    // §33.11.4's own list, exact-match: the reference's label is `Get started`.
    expect(screen.queryByRole('button', { name: /^(get started|start|continue|next)$/i })).toBeNull();
  });

  it('says declining later does not count against them (§8)', async () => {
    stubInvitation();
    await renderAt('welcome');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByText(/turning it down later does not count against you/i)).toBeTruthy();
  });
});

/* ══ Screen 1 — the password ══════════════════════════════════════════════ */

describe('screen 1 — the password', () => {
  it('lists only what the server enforces', async () => {
    stubInvitation();
    await renderAt('password');
    await screen.findByRole('heading', { level: 1 });

    // One requirement, because `completeAffiliateSignup` checks one thing.
    expect(CREATOR_PASSWORD_REQUIREMENTS).toHaveLength(1);
    expect(screen.getByText(new RegExp(`at least ${CREATOR_PASSWORD_MIN_LENGTH} characters`, 'i'))).toBeTruthy();

    // The three the reference draws and the server does not check. Shipping
    // them would tick four boxes for an eight-character password and be
    // refused at the claim.
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/uppercase|lowercase|special character/i);
  });

  it('refuses to advance until the password meets the server’s rule and is confirmed', async () => {
    stubInvitation();
    const user = userEvent.setup();
    await renderAt('password');
    await screen.findByRole('heading', { level: 1 });

    const next = screen.getByRole('button', { name: /next: about you/i });
    expect(next.hasAttribute('disabled')).toBe(true);

    // Eleven characters: the reference's own list would call this strong.
    await user.type(screen.getByLabelText(/your password/i), 'short-elev');
    expect(screen.queryByLabelText(/confirm it/i)).toBeNull();
    expect(next.hasAttribute('disabled')).toBe(true);

    await user.type(screen.getByLabelText(/your password/i), 'a-good-password');
    const confirm = await screen.findByLabelText(/confirm it/i);
    expect(next.hasAttribute('disabled')).toBe(true);

    await user.type(confirm, 'something-else-entirely');
    expect(await screen.findByText(/those do not match yet/i)).toBeTruthy();
    expect(next.hasAttribute('disabled')).toBe(true);
  });

  it('never sends the password anywhere', async () => {
    stubInvitation();
    const user = userEvent.setup();
    await renderAt('password');
    await screen.findByRole('heading', { level: 1 });

    await user.type(screen.getByLabelText(/your password/i), 'a-perfectly-good-password');
    await waitFor(() => expect(screen.queryByLabelText(/confirm it/i)).toBeTruthy());

    // No request at all carries it, under any key — there is no account to
    // attach it to until the claim, and §28.2 is why it is not autosaved.
    const serialized = JSON.stringify(requests);
    expect(serialized).not.toContain('a-perfectly-good-password');
  });

  it('says the password is not kept, on the screen that sets it', async () => {
    stubInvitation();
    await renderAt('password');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByText(/we will ask for it again at the end/i)).toBeTruthy();
  });

  it('writes it to no browser storage', async () => {
    stubInvitation();
    const user = userEvent.setup();
    await renderAt('password');
    await screen.findByRole('heading', { level: 1 });

    await user.type(screen.getByLabelText(/your password/i), 'a-perfectly-good-password');

    // A credential at rest in the browser outlives the tab and is readable by
    // anything running in the page.
    expect(JSON.stringify({ ...window.sessionStorage })).not.toContain('a-perfectly-good');
    expect(JSON.stringify({ ...window.localStorage })).not.toContain('a-perfectly-good');
  });
});

/* ══ Screen 2 — you ═══════════════════════════════════════════════════════ */

describe('screen 2 — you', () => {
  it('lets the email be corrected, and never renders it locked', async () => {
    stubInvitation();
    const user = userEvent.setup();
    await renderAt('profile');
    await screen.findByRole('heading', { level: 1 });

    const email = screen.getByLabelText(/^email$/i) as HTMLInputElement;
    expect(email.hasAttribute('readonly')).toBe(false);
    expect(email.hasAttribute('disabled')).toBe(false);
    expect(document.body.textContent ?? '').not.toMatch(/\blocked\b/i);

    await user.clear(email);
    await user.type(email, 'sam@newaddress.example');
    await waitFor(() => {
      expect(patches().some((p) => p['email'] === 'sam@newaddress.example')).toBe(true);
    });
  });

  it('says the phone is never verified, and offers no way to verify it', async () => {
    // MOVED here from `creator-signup.test.tsx` with the field itself
    // (Creator Flow v2 Session B, 2026-08-19). §33.1.8's own guarantee.
    stubInvitation();
    await renderAt('profile');
    await screen.findByRole('heading', { level: 1 });

    expect(screen.getByLabelText(/^phone$/i)).toBeTruthy();
    expect(screen.getByText(/we do not text you and we do not verify this number/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /verify/i })).toBeNull();
  });

  it('labels a prefilled field with its source (§11)', async () => {
    stubInvitation();
    await renderAt('profile');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getAllByText(/from your invitation\. change it if it is wrong\./i).length).toBeGreaterThan(0);
  });

  it('sends only the key that changed', async () => {
    stubInvitation();
    const user = userEvent.setup();
    await renderAt('profile');
    await screen.findByRole('heading', { level: 1 });

    await user.type(screen.getByLabelText(/^phone$/i), '555');
    await waitFor(() => {
      const last = patches().at(-1);
      expect(last, 'no autosave patch was sent').toBeTruthy();
      // §9: a key absent from the request writes nothing, so one screen cannot
      // blank another's answer.
      expect(Object.keys(last!)).toEqual(['phone']);
    });
  });
});

/* ══ Screen 3 — the channel ═══════════════════════════════════════════════ */

describe('screen 3 — the channel', () => {
  it('offers nine tiles over seven subtypes, and no tenth subtype', async () => {
    stubInvitation();
    await renderAt('channel');
    await screen.findByRole('heading', { level: 1 });

    expect(CREATOR_CHANNEL_TILES).toHaveLength(9);
    expect(new Set(CREATOR_CHANNEL_TILES.map((t) => t.subtype)).size).toBe(7);
    for (const tile of CREATOR_CHANNEL_TILES) {
      expect(screen.getByRole('button', { name: tile.label, pressed: false })).toBeTruthy();
    }
    // The reference's ninth is `Other`, which maps to no §5.3 subtype at all.
    expect(screen.queryByRole('button', { name: /^other$/i })).toBeNull();
  });

  it('records the tile without touching the Admin classification', async () => {
    stubInvitation();
    const user = userEvent.setup();
    await renderAt('channel');
    await screen.findByRole('heading', { level: 1 });

    await user.click(screen.getByRole('button', { name: 'Podcast' }));
    await waitFor(() => {
      expect(patches().some((p) => p['channelType'] === 'podcast')).toBe(true);
    });

    // The recorded subtype is `social_creator`. Nothing sent a subtype, under
    // any key — overwriting it would silently invalidate the verification
    // recorded against it.
    const serialized = JSON.stringify(patches());
    expect(serialized).not.toContain('channelSubtype');
    expect(serialized).not.toContain('subtype');

    // The disagreement is reported and left alone.
    expect(await screen.findByText(/changing it here would quietly undo that check/i)).toBeTruthy();
  });

  it('says nothing about a disagreement when there is none', async () => {
    stubInvitation();
    const user = userEvent.setup();
    await renderAt('channel');
    await screen.findByRole('heading', { level: 1 });

    await user.click(screen.getByRole('button', { name: 'YouTube' }));
    await waitFor(() => expect(patches().length).toBeGreaterThan(0));
    expect(screen.queryByText(/would quietly undo that check/i)).toBeNull();
  });

  it('asks a student for their promotion plan, and asks nobody else', async () => {
    stubInvitation();
    const user = userEvent.setup();
    await renderAt('channel');
    await screen.findByRole('heading', { level: 1 });

    expect(screen.queryByLabelText(/how you reach your network/i)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Student' }));
    expect(await screen.findByLabelText(/how you reach your network/i)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Podcast' }));
    await waitFor(() => expect(screen.queryByLabelText(/how you reach your network/i)).toBeNull());
  });

  it('keeps a stored niche the closed list does not contain', async () => {
    stubInvitation({
      profile: { fields: { ...profileFor().fields, audienceNiche: field('B2B SaaS founders', 'B2B SaaS founders') } },
    });
    await renderAt('channel');
    await screen.findByRole('heading', { level: 1 });

    const select = screen.getByLabelText(/audience niche/i) as HTMLSelectElement;
    expect(select.value).toBe('B2B SaaS founders');
    // A select that silently dropped it would lose §11's prefill on first
    // render, and the Creator would never know a value had been recorded.
    expect(within(select).getByRole('option', { name: 'B2B SaaS founders' })).toBeTruthy();
  });

  it('does not yet claim the answers can be edited later', async () => {
    stubInvitation();
    await renderAt('channel');
    await screen.findByRole('heading', { level: 1 });

    // The reference's line is true only once Session F ships Settings, and
    // §5.3 licenses that right while the product has no route for it.
    expect(document.body.textContent ?? '').not.toMatch(/edit all of this later under profile/i);
    expect(screen.getByText(/tell us and we will update it for you/i)).toBeTruthy();
  });
});

/* ══ Across the four ══════════════════════════════════════════════════════ */

describe('across the four screens', () => {
  it('collects no bank, tax, or identity field anywhere (§11)', async () => {
    stubInvitation();
    for (const page of CREATOR_FLOW_PAGES) {
      const view = await renderAt(page.id);
      await screen.findByRole('heading', { level: 1 });

      for (const control of Array.from(document.querySelectorAll('input, select, textarea'))) {
        const label = (control.getAttribute('aria-label') ?? '') + ' ' +
          (document.querySelector(`label[for="${control.id}"]`)?.textContent ?? '');
        expect(label).not.toMatch(
          /routing|account number|\bbank\b|IBAN|sort code|tax id|SSN|social security|passport|driver/i,
        );
      }
      view.unmount();
    }
  });

  it('has no axe violation on any of the four', async () => {
    stubInvitation();
    for (const page of CREATOR_FLOW_PAGES) {
      const view = await renderAt(page.id);
      await screen.findByRole('heading', { level: 1 });
      expect(await axe(view.container)).toHaveNoViolations();
      view.unmount();
    }
  });

  it('binds no global Enter handler (§28.5, §30)', async () => {
    stubInvitation();
    const user = userEvent.setup();
    await renderAt('password');
    await screen.findByRole('heading', { level: 1 });

    await user.type(screen.getByLabelText(/your password/i), 'a-perfectly-good-password{Enter}');
    // The reference fires the current screen's primary action on Enter. A
    // stray keystroke must not advance a walk whose later screens accept a
    // §14.2 agreement — and there is no `<form>` here either, so the browser's
    // own submit-on-Enter has nothing to submit.
    expect(document.querySelector('[data-flow-page="password"]')).toBeTruthy();
    expect(document.querySelector('[data-flow-page="profile"]')).toBeNull();
  });
});

/* ══ The refusals are written down ════════════════════════════════════════ */

describe('what the reference draws and this flow refuses', () => {
  it('names each of Session B’s refusals with a reason worth reading', () => {
    const mine = CREATOR_FLOW_ABSENCES.filter((a) => a.session === 'B');
    expect(mine.length).toBeGreaterThan(0);
    for (const absence of mine) {
      expect(absence.absentBecause.length).toBeGreaterThan(60);
      expect(absence.specRef).toMatch(/§/);
    }
  });
});
