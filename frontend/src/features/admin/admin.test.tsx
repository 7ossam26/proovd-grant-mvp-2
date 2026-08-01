/**
 * Phase 06a — the Admin surfaces.
 *
 * These mount the real route table in a memory router, exactly as the public
 * suite does, and stub `fetch` at the network boundary. Everything above that
 * boundary is the code that ships: the layout's session gate, the two-step
 * sign-in, the settings rows built from the shared §6 register, the §9 save
 * vocabulary, and the fail-closed prerequisites panel.
 *
 * What is deliberately NOT asserted here: that an unauthenticated caller is
 * refused. That is a server fact, proved in `backend/src/tests/admin-settings.test.ts`
 * against the real guards. A frontend test that "proved" it would only be
 * proving that a stub returned 401.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { axe } from 'jest-axe';
import { SETTING_DEFINITIONS, SETTING_GROUPS } from '@proovd/shared';
import { appRoutes } from '../../routes.js';
import { describeSaveState, isRetryable, MAX_SAVE_ATTEMPTS } from '../../lib/autosave.js';

/* ── A stub network ───────────────────────────────────────────────────────── */

type Handler = (url: string, init?: RequestInit) => { status: number; body: unknown };

let handlers: Handler[] = [];
let requests: Array<{ url: string; method: string; body: unknown }> = [];

function respond(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
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

afterEach(() => {
  vi.unstubAllGlobals();
});

const IDENTITY = {
  id: 'admin-1',
  name: 'Ada Admin',
  email: 'ada@proovd.co',
  sessionEstablishedAt: '2026-07-31T09:00:00.000Z',
  prerequisiteKeys: [],
};

/** Settings state matching the register, so the surface renders every row. */
function settingsPayload(overrides: Record<string, string | null> = {}) {
  return {
    settings: SETTING_DEFINITIONS.map((d) => ({
      key: d.key,
      value: d.key in overrides ? overrides[d.key] : d.defaultValue,
      kind: d.kind,
      provenance: d.provenance,
      minimum: d.minimum ?? null,
      maximum: d.maximum ?? null,
      specRef: d.specRef,
      version: 1,
      editable: d.provenance !== 'derived',
      updatedBy: 'system:migration',
      updateReason: 'seeded from the §6 register at migration 0004',
      updatedAt: '2026-07-31T09:00:00.000Z',
    })),
  };
}

const PREREQ_ITEMS = [
  {
    key: 'policies',
    label: 'Canonical policy documents',
    specRef: '§6, §31.4, §34 condition 4',
    verification: 'automatic' as const,
    requirement: 'All eight §31.4 documents exist and are published.',
    satisfied: false,
    detail: '8 policy document(s) still in draft: terms, privacy',
    subjectKeys: ['terms', 'privacy'],
    attestation: null,
  },
  {
    key: 'sample_campaigns',
    label: 'Sample campaigns collect nothing',
    specRef: '§6, §34, Appendix A.6',
    verification: 'recorded' as const,
    requirement: 'Both sample campaigns mount no payment field at all.',
    satisfied: false,
    detail: 'Not verified yet. A named person has to check this and record what they found.',
    subjectKeys: [],
    attestation: null,
  },
];

function stubSignedIn(settings = settingsPayload(), prereqs = PREREQ_ITEMS) {
  handlers.push((url, init) => {
    if (url === '/api/admin/me') return { status: 200, body: IDENTITY };
    if (url === '/api/admin/settings' && (init?.method ?? 'GET') === 'GET') {
      return { status: 200, body: settings };
    }
    if (url === '/api/admin/prerequisites') {
      return {
        status: 200,
        body: {
          blocking: prereqs.some((p) => !p.satisfied),
          unsatisfiedKeys: prereqs.filter((p) => !p.satisfied).map((p) => p.key),
          items: prereqs,
        },
      };
    }
    return undefined as never;
  });
}

function renderAdmin(path = '/admin/settings') {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  return render(<RouterProvider router={router} />);
}

/* ── The session gate ─────────────────────────────────────────────────────── */

describe('the Admin shell decides what to render, never who may see it', () => {
  it('shows the sign-in form when the server does not recognise the session', async () => {
    handlers.push((url) =>
      url === '/api/admin/me'
        ? { status: 401, body: { error: 'authentication_required', title: 'Please sign in' } }
        : (undefined as never),
    );

    renderAdmin();

    expect(
      await screen.findByRole('heading', { name: /sign in to proovd admin/i }),
    ).toBeInTheDocument();
    // No settings request is made while signed out.
    expect(requests.some((r) => r.url === '/api/admin/settings')).toBe(false);
  });

  it('refuses an Admin with no second factor, and offers only sign-out (§5.1)', async () => {
    handlers.push((url) =>
      url === '/api/admin/me'
        ? {
            status: 403,
            body: {
              error: 'mfa_enrollment_required',
              title: 'Set up two-factor authentication to continue',
              whatHappened:
                'Admin accounts require an authenticator app. This one does not have it yet.',
              next: 'Register an authenticator app, then sign in again.',
            },
          }
        : (undefined as never),
    );

    renderAdmin();

    expect(
      await screen.findByText(/set up two-factor authentication to continue/i),
    ).toBeInTheDocument();
    // Not a nag beside a working panel — there is no nav and no settings.
    expect(screen.queryByRole('navigation', { name: /admin sections/i })).toBeNull();
    expect(screen.queryByRole('heading', { name: /global configuration/i })).toBeNull();
  });

  it('asks for the password and the code as two moments (DNA §5.1)', async () => {
    const user = userEvent.setup();
    let signedIn = false;

    handlers.push((url, init) => {
      if (url === '/api/admin/me') {
        return signedIn
          ? { status: 200, body: IDENTITY }
          : { status: 401, body: { error: 'authentication_required', title: 'Please sign in' } };
      }
      if (url === '/api/auth/sign-in/email') return { status: 200, body: { twoFactorRedirect: true } };
      if (url === '/api/auth/two-factor/verify-totp') {
        signedIn = true;
        return { status: 200, body: {} };
      }
      if (url === '/api/admin/settings' && (init?.method ?? 'GET') === 'GET') {
        return { status: 200, body: settingsPayload() };
      }
      return undefined as never;
    });

    renderAdmin();
    await screen.findByRole('heading', { name: /sign in to proovd admin/i });

    // Step one asks for a password and nothing else.
    expect(screen.queryByLabelText(/authenticator code/i)).toBeNull();
    await user.type(screen.getByLabelText(/email address/i), 'ada@proovd.co');
    await user.type(screen.getByLabelText(/^password$/i), 'a-perfectly-good-password');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    // Step two asks for the code, and the password field is gone.
    expect(await screen.findByLabelText(/authenticator code/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^password$/i)).toBeNull();

    await user.type(screen.getByLabelText(/authenticator code/i), '123456');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    expect(
      await screen.findByRole('heading', { name: /global configuration/i }),
    ).toBeInTheDocument();
  });

  it('says nothing about the account when credentials are refused (§5.5)', async () => {
    const user = userEvent.setup();
    handlers.push((url) => {
      if (url === '/api/admin/me') {
        return { status: 401, body: { error: 'authentication_required', title: 'Please sign in' } };
      }
      if (url === '/api/auth/sign-in/email') {
        return { status: 401, body: { error: 'invalid', title: 'Invalid email or password' } };
      }
      return undefined as never;
    });

    renderAdmin();
    await screen.findByRole('heading', { name: /sign in to proovd admin/i });

    await user.type(screen.getByLabelText(/email address/i), 'nobody@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'wrong');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/not accepted/i);
    // No wording that would distinguish "no such account" from "wrong password".
    expect(alert.textContent).not.toMatch(/no account|not found|does not exist|unknown user/i);
  });
});

/* ── Global configuration (§6) ────────────────────────────────────────────── */

describe('global configuration renders the §6 register', () => {
  it('renders every setting, in its group, with its §6 citation', async () => {
    stubSignedIn();
    renderAdmin();

    await screen.findByRole('heading', { name: /global configuration/i });

    for (const { heading } of SETTING_GROUPS) {
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    }
    for (const definition of SETTING_DEFINITIONS) {
      expect(
        screen.getByRole('heading', { name: definition.label, level: 3 }),
      ).toBeInTheDocument();
    }
  });

  it('names an unset setting as unset rather than showing a stand-in value', async () => {
    stubSignedIn();
    renderAdmin();

    await screen.findByRole('heading', { name: /global configuration/i });

    const operatorSettings = SETTING_DEFINITIONS.filter((d) => d.provenance === 'operator');
    expect(operatorSettings.length).toBeGreaterThan(0);

    expect(screen.getAllByText('No value stated')).toHaveLength(operatorSettings.length);
    // Named at the top of the page, with a link to each one.
    expect(
      screen.getByText(
        new RegExp(`${operatorSettings.length} settings still have no value`, 'i'),
      ),
    ).toBeInTheDocument();
  });

  it('offers no input for a derived value, and says why (§29.6)', async () => {
    stubSignedIn();
    renderAdmin();

    await screen.findByRole('heading', { name: /global configuration/i });

    const row = screen
      .getByRole('heading', { name: /US business-day calendar version/i })
      .closest('.setting') as HTMLElement;

    expect(within(row).queryByRole('textbox')).toBeNull();
    expect(within(row).queryByRole('button', { name: /^save$/i })).toBeNull();
    expect(row).toHaveTextContent(/follows the committed business-day calendar/i);
  });

  it('will not save without a reason (§25.6)', async () => {
    const user = userEvent.setup();
    stubSignedIn();
    renderAdmin();

    await screen.findByRole('heading', { name: /global configuration/i });

    const row = screen
      .getByRole('heading', { name: 'Required promotional posts', level: 3 })
      .closest('.setting') as HTMLElement;

    const save = within(row).getByRole('button', { name: /^save$/i });
    expect(save).toBeDisabled();

    await user.clear(within(row).getByLabelText(/^value/i));
    await user.type(within(row).getByLabelText(/^value/i), '4');
    // Changed, but still no reason.
    expect(save).toBeDisabled();

    await user.type(within(row).getByLabelText(/why is this changing/i), 'agreed with the cohort');
    expect(save).toBeEnabled();
  });

  it('blocks a save on a client-side violation of a §6 floor', async () => {
    const user = userEvent.setup();
    stubSignedIn();
    renderAdmin();

    await screen.findByRole('heading', { name: /global configuration/i });

    const row = screen
      .getByRole('heading', { name: /Founder repeat-campaign cooldown/i })
      .closest('.setting') as HTMLElement;

    await user.clear(within(row).getByLabelText(/^value/i));
    await user.type(within(row).getByLabelText(/^value/i), '1');
    await user.type(within(row).getByLabelText(/why is this changing/i), 'shorten it');

    // Awaited rather than asserted synchronously: the violation message and the
    // disabled Save are rendered from state React commits after the typing
    // settles, and a bare `getByRole` here passes only while the machine is
    // fast enough. It flaked once the suite grew — the assertion was always the
    // race, not the surface.
    await waitFor(() =>
      expect(within(row).getByRole('alert')).toHaveTextContent(/floor of 3/i),
    );
    expect(within(row).getByRole('button', { name: /^save$/i })).toBeDisabled();
    expect(requests.some((r) => r.method === 'PUT')).toBe(false);
  });

  it('saves with the §9 vocabulary and sends the reason with the value', async () => {
    const user = userEvent.setup();
    stubSignedIn();
    handlers.unshift((url, init) =>
      url === '/api/admin/settings/required_promotional_posts' && init?.method === 'PUT'
        ? {
            status: 200,
            body: {
              key: 'required_promotional_posts',
              value: '4',
              version: 2,
              changed: true,
              updatedBy: 'user:admin-1',
              updateReason: 'agreed with the cohort',
              updatedAt: '2026-07-31T10:00:00.000Z',
              kind: 'count',
              provenance: 'specified',
              minimum: 1,
              maximum: null,
              specRef: '§6 · Default required promotional post count: three',
              editable: true,
            },
          }
        : (undefined as never),
    );

    renderAdmin();
    await screen.findByRole('heading', { name: /global configuration/i });

    const row = screen
      .getByRole('heading', { name: 'Required promotional posts', level: 3 })
      .closest('.setting') as HTMLElement;

    await user.clear(within(row).getByLabelText(/^value/i));
    await user.type(within(row).getByLabelText(/^value/i), '4');
    await user.type(within(row).getByLabelText(/why is this changing/i), 'agreed with the cohort');
    await user.click(within(row).getByRole('button', { name: /^save$/i }));

    // The time itself is rendered in the viewer's locale (§27.1: local time
    // primary), so the assertion is about the §9 phrase, not about digits.
    await waitFor(() =>
      expect(within(row).getByRole('status').textContent).toMatch(/^Saved \S/),
    );

    const put = requests.find((r) => r.method === 'PUT');
    expect(put?.body).toEqual({ value: '4', reason: 'agreed with the cohort' });
  });

  it('reports a server refusal as not saved, and says the stored value is unchanged', async () => {
    const user = userEvent.setup();
    stubSignedIn();
    handlers.unshift((url, init) =>
      url === '/api/admin/settings/required_promotional_posts' && init?.method === 'PUT'
        ? {
            status: 422,
            body: {
              error: 'setting_rejected',
              title: 'That change could not be saved',
              whatHappened: 'Enter a whole number with no units or separators.',
              next: 'Correct the value and save again. Nothing has changed.',
            },
          }
        : (undefined as never),
    );

    renderAdmin();
    await screen.findByRole('heading', { name: /global configuration/i });

    const row = screen
      .getByRole('heading', { name: 'Required promotional posts', level: 3 })
      .closest('.setting') as HTMLElement;

    await user.clear(within(row).getByLabelText(/^value/i));
    await user.type(within(row).getByLabelText(/^value/i), '9');
    await user.type(within(row).getByLabelText(/why is this changing/i), 'test');
    await user.click(within(row).getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(within(row).getByRole('status')).toHaveTextContent(/^Not saved/),
    );
    // A refusal is not retried — retrying a 422 shows "retrying" over a state
    // that will never resolve on its own.
    expect(within(row).getByRole('status')).not.toHaveTextContent(/retrying/i);
    expect(requests.filter((r) => r.method === 'PUT')).toHaveLength(1);
    expect(within(row).getByRole('alert')).toHaveTextContent(/still 3/);
  });
});

/* ── The §9 vocabulary itself ─────────────────────────────────────────────── */

describe('§9 save vocabulary', () => {
  it('uses exactly the three phrases §9 fixes', () => {
    expect(describeSaveState({ status: 'saving' })).toBe('Saving…');
    expect(describeSaveState({ status: 'saved', at: new Date() })).toMatch(/^Saved /);
    expect(describeSaveState({ status: 'retrying', attempt: 2 })).toMatch(
      /^Could not save — retrying/,
    );
  });

  it('promises a retry only where one is genuinely scheduled (§1.4)', () => {
    // Transient: worth another attempt.
    expect(isRetryable(0)).toBe(true);
    expect(isRetryable(500)).toBe(true);
    // Decisions: the server read the request and answered. Retrying changes
    // nothing, so the surface must not claim to be retrying.
    for (const status of [400, 401, 403, 422, 503]) {
      expect(isRetryable(status)).toBe(false);
    }
  });

  it('stops honestly once attempts run out', () => {
    expect(describeSaveState({ status: 'failed', title: 'Proovd could not be reached' })).toBe(
      'Not saved — Proovd could not be reached',
    );
    expect(MAX_SAVE_ATTEMPTS).toBeGreaterThan(1);
  });
});

/* ── Production prerequisites (§6) ────────────────────────────────────────── */

describe('the prerequisites panel fails closed', () => {
  it('states that live card collection is unavailable, and offers no override', async () => {
    stubSignedIn();
    renderAdmin('/admin/prerequisites');

    expect(
      await screen.findByText(/live card collection is unavailable/i),
    ).toBeInTheDocument();

    // §34 is released by satisfying it. Nothing here starts live mode.
    for (const name of [/enable live/i, /override/i, /proceed anyway/i, /go live/i, /skip/i]) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
  });

  it('labels an automatic check apart from a human one (§1.4)', async () => {
    stubSignedIn();
    renderAdmin('/admin/prerequisites');

    await screen.findByRole('heading', { name: /production prerequisites/i });

    const automatic = screen
      .getByRole('heading', { name: /canonical policy documents/i })
      .closest('.prereq') as HTMLElement;
    expect(within(automatic).getByText('Checked by Proovd')).toBeInTheDocument();
    expect(within(automatic).queryByRole('button', { name: /record/i })).toBeNull();

    const recorded = screen
      .getByRole('heading', { name: /sample campaigns collect nothing/i })
      .closest('.prereq') as HTMLElement;
    expect(within(recorded).getByText('Verified by a person')).toBeInTheDocument();
    expect(within(recorded).getByRole('button', { name: /record a check/i })).toBeInTheDocument();
  });

  it('will not record an attestation with no note', async () => {
    const user = userEvent.setup();
    stubSignedIn();
    renderAdmin('/admin/prerequisites');

    await screen.findByRole('heading', { name: /production prerequisites/i });

    const row = screen
      .getByRole('heading', { name: /sample campaigns collect nothing/i })
      .closest('.prereq') as HTMLElement;

    await user.click(within(row).getByRole('button', { name: /record a check/i }));
    expect(within(row).getByRole('button', { name: /record as satisfied/i })).toBeDisabled();

    await user.type(
      within(row).getByLabelText(/what did you check/i),
      'Inspected both sample pages: no form, input, iframe, or provider script.',
    );
    expect(within(row).getByRole('button', { name: /record as satisfied/i })).toBeEnabled();
  });

  it('records the check with its note and evidence', async () => {
    const user = userEvent.setup();
    stubSignedIn();
    handlers.unshift((url, init) =>
      url === '/api/admin/prerequisites/sample_campaigns' && init?.method === 'POST'
        ? { status: 201, body: { blocking: true, unsatisfiedKeys: ['policies'] } }
        : (undefined as never),
    );

    renderAdmin('/admin/prerequisites');
    await screen.findByRole('heading', { name: /production prerequisites/i });

    const row = screen
      .getByRole('heading', { name: /sample campaigns collect nothing/i })
      .closest('.prereq') as HTMLElement;

    await user.click(within(row).getByRole('button', { name: /record a check/i }));
    await user.type(within(row).getByLabelText(/what did you check/i), 'No payment field in the DOM.');
    await user.type(within(row).getByLabelText(/evidence links/i), 'https://example.test/run/1');
    await user.click(within(row).getByRole('button', { name: /record as satisfied/i }));

    await waitFor(() => {
      const post = requests.find((r) => r.method === 'POST');
      expect(post?.body).toEqual({
        status: 'satisfied',
        note: 'No payment field in the DOM.',
        evidenceLinks: ['https://example.test/run/1'],
      });
    });
  });
});

/* ── Accessibility (§33.11) ───────────────────────────────────────────────── */

describe('§33.11 the Admin surfaces are operable', () => {
  it.each([
    ['/admin/settings', /global configuration/i],
    ['/admin/prerequisites', /production prerequisites/i],
  ])('has no axe violations at %s', async (path, heading) => {
    stubSignedIn();
    const { container } = renderAdmin(path);
    await screen.findByRole('heading', { name: heading, level: 1 });

    expect(await axe(container)).toHaveNoViolations();
  }, 30_000);

  it('names its landmarks and offers a skip link to the content', async () => {
    stubSignedIn();
    renderAdmin();
    await screen.findByRole('heading', { name: /global configuration/i });

    expect(screen.getByRole('navigation', { name: /admin sections/i })).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /skip to content/i })).toHaveAttribute(
      'href',
      '#admin-main',
    );
  });

  it('exposes exactly one level-1 heading per surface', async () => {
    stubSignedIn();
    renderAdmin();
    await screen.findByRole('heading', { name: /global configuration/i });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('does not carry the public site chrome into the Admin panel (§26)', async () => {
    stubSignedIn();
    renderAdmin();
    await screen.findByRole('heading', { name: /global configuration/i });

    // No site footer sitemap, no policy links, no live-chat gate — the Admin
    // panel is the only dashboard, and its density must not leak outward.
    expect(screen.queryByRole('contentinfo')).toBeNull();
    expect(screen.queryByRole('link', { name: /refund policy/i })).toBeNull();
  });
});
