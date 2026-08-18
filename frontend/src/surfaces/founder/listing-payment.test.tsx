/**
 * The listing-fee payment surface — Spec §13, §24.6, §31.6, Appendix A.5.
 *
 * §33.3.5's surface half: "Checkout/receipt list base, each discount, tax,
 * total, descriptor, refund, separate 5%." The receipt and the Checkout session
 * are proved server-side in `backend/src/tests/listing-checkout.test.ts`; what
 * is proved here is what the Founder actually reads before agreeing to pay —
 * including that Appendix A.5 renders **verbatim** with its variables resolved,
 * which is the one thing no server test can see.
 *
 * ── Where it renders, since 2026-08-19 ────────────────────────────────────
 * Founder Flow v2 Session E made the listing fee its own page — screen 20, at
 * `/campaigns/:campaignId/setup/fee` — and retired the campaign workspace that
 * used to hold it. This suite moved with the surface rather than being deleted
 * with the component, because what it proves is the Founder's side of §33.3.5
 * and Appendix A.5, and neither of those changed address. It now drives the
 * real route through `appRoutes`, which is also what proves the page is
 * reachable at all.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { appRoutes } from '../../routes.js';
import { invalidateSession } from '../../lib/session.js';

type StubResult = { status: number; body: unknown } | undefined;
type Handler = (url: string, init?: RequestInit) => StubResult;

let handlers: Handler[] = [];
const requests: Array<{ url: string; body: unknown }> = [];

function respond(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

beforeEach(() => {
  invalidateSession();
  handlers = [];
  requests.length = 0;
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    for (const handler of handlers) {
      const result = handler(url, init);
      if (result) return respond(result.status, result.body);
    }
    return respond(404, { error: 'not_found', title: 'No stub' });
  });
});

afterEach(() => vi.unstubAllGlobals());

const CAMPAIGN = 'campaign-listing-1';

const QUOTE = {
  url: 'https://checkout.stripe.test/pay/cs_test_1',
  sessionId: 'cs_test_1',
  baseCents: '3500',
  discountLines: [
    { item: 'branding', discountCents: '200' },
    { item: 'story', discountCents: '200' },
  ],
  discountCents: '400',
  subtotalCents: '3100',
  taxCents: '248',
  totalCents: '3348',
  descriptor: 'PROOVD LISTING',
};

/**
 * The §12 fee the page's hero reads.
 *
 * Deliberately a different subtotal from the quote's, so an assertion about one
 * cannot pass by finding the other.
 */
const WORKSPACE_FEE = {
  baseCents: '3500',
  itemDiscountCents: '200',
  maxDiscountCents: '1000',
  minSubtotalCents: '2500',
  completedItems: 2,
  discountLines: [
    { item: 'branding', discountCents: '200' },
    { item: 'story', discountCents: '200' },
  ],
  discountCents: '400',
  subtotalCents: '3100',
  calculatedAt: '2026-08-19T10:00:00.000Z',
  locked: false,
  separateStreamNote:
    'This is the one-off fee for listing your campaign. Proovd separately retains 5% of ' +
    'captured campaign rewards if your campaign succeeds; that is not part of this total.',
};

function mount(listing: Record<string, unknown>, quote: unknown = QUOTE) {
  handlers.push((url, init) => {
    if (url.endsWith('/listing/checkout') && init?.method === 'POST') {
      return { status: 200, body: { checkout: quote } };
    }
    if (url.endsWith('/listing')) return { status: 200, body: { listing } };
    if (url.startsWith('/api/account/me')) {
      return {
        status: 200,
        body: { account: { role: 'founder', email: 'rowan@example.com', name: 'Rowan' } },
      };
    }
    if (url.includes('/workspace')) {
      return {
        status: 200,
        body: {
          workspace: {
            campaignId: CAMPAIGN,
            campaignStatus: 'listing_fee_pending',
            listingPaid: listing['paid'] === true,
            items: [],
            fee: WORKSPACE_FEE,
            highEffort: null,
            brand: { colors: null, typography: null, notes: null, approved: false, logos: [] },
            story: { text: null, approved: false },
            visuals: [],
            socials: [],
            interview: {
              bookable: false,
              missingSettings: [],
              providers: [],
              availability: null,
              embed: { available: false, eventTypeLink: null, reference: null },
              booking: null,
            },
            lastSavedAt: null,
            resumeStep: null,
            uploadsAvailable: false,
            transcription: { available: false, absentBecause: 'Not set up here.' },
            vetting: { problem: null, solution: null, competition: null, submittedAt: null },
          },
        },
      };
    }
    return undefined;
  });
  const router = createMemoryRouter(appRoutes, {
    initialEntries: [`/campaigns/${CAMPAIGN}/setup/fee`],
  });
  return render(<RouterProvider router={router} />);
}

/** The A.5 block, straight from the Spec — the same source the shared test uses. */
function specConsentBody(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const spec = readFileSync(
    join(here, '..', '..', '..', '..', 'docs', 'spec', 'Proovd-MVP-Engineering-Implementation-Spec-v1_0.md'),
    'utf8',
  );
  const start = spec.indexOf('## A.5 Listing-fee consent');
  const fenceStart = spec.indexOf('```text', start);
  const fenceEnd = spec.indexOf('```', fenceStart + 7);
  return spec.slice(fenceStart + 7, fenceEnd).split('[ ]')[0]!.trim();
}

const eligible = {
  paid: false,
  onboardingState: 'complete',
  listingFeeEligible: true,
  taxAvailable: true,
  checkoutAvailable: true,
};

/* ── §33.3.5 — what the Founder reads before paying ───────────────────────── */

describe('the pre-payment surface (§13, §33.3.5)', () => {
  it('itemises base, each labeled saving, tax, total, and the descriptor', async () => {
    mount(eligible);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Your listing fee' })).toBeInTheDocument());

    // Tax needs an address, so the total is quoted only after one is given.
    await user.type(screen.getByLabelText('Billing ZIP code'), '94105');
    await user.click(screen.getByRole('button', { name: 'Work out my total' }));

    await waitFor(() => expect(screen.getByText('Total due now')).toBeInTheDocument());

    expect(screen.getByText('Listing a campaign')).toBeInTheDocument();
    expect(screen.getByText('US$35.00')).toBeInTheDocument();
    // §13: each earned saving on its own labeled line, not one "discounts" row.
    expect(screen.getByText('Branding completed')).toBeInTheDocument();
    expect(screen.getByText('Story completed')).toBeInTheDocument();
    expect(screen.getAllByText('−US$2.00')).toHaveLength(2);
    expect(screen.getByText('Subtotal')).toBeInTheDocument();
    expect(screen.getByText('US$31.00')).toBeInTheDocument();
    expect(screen.getByText('Sales tax')).toBeInTheDocument();
    expect(screen.getByText('US$2.48')).toBeInTheDocument();
    expect(screen.getByText('US$33.48')).toBeInTheDocument();
    // The descriptor appears twice on purpose: once as the fine-print line
    // §13 asks for, and once inside A.5, which names it in its own words.
    expect(screen.getAllByText(/PROOVD LISTING/).length).toBeGreaterThanOrEqual(2);
  });

  it('renders Appendix A.5 verbatim with both variables resolved', async () => {
    mount(eligible);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Your listing fee' })).toBeInTheDocument());
    await user.type(screen.getByLabelText('Billing ZIP code'), '94105');
    await user.click(screen.getByRole('button', { name: 'Work out my total' }));

    const consent = await screen.findByTestId('listing-consent');
    const rendered = consent.textContent ?? '';

    // The Spec's own words, with only [SUBTOTAL] and [TOTAL] substituted.
    const expected = specConsentBody()
      .replaceAll('[SUBTOTAL]', '31.00')
      .replaceAll('[TOTAL]', '33.48');

    // Compared with wrapping folded: `white-space: pre-line` preserves the
    // paragraph breaks, and jsdom reports the raw text either way.
    const fold = (s: string) => s.replace(/\s+/g, ' ').trim();
    expect(fold(rendered)).toBe(fold(expected));

    // No marker survives, and the amounts are the ones the session charges.
    expect(rendered).not.toMatch(/\[SUBTOTAL\]|\[TOTAL\]/);
    expect(rendered).toContain('US$31.00');
    expect(rendered).toContain('US$33.48');
  });

  it('states the refund promise, the separate 5%, and that a pending proposal is not acceptance', async () => {
    mount(eligible);
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Your listing fee' })).toBeInTheDocument());
    await user.type(screen.getByLabelText('Billing ZIP code'), '94105');
    await user.click(screen.getByRole('button', { name: 'Work out my total' }));

    await screen.findByTestId('listing-consent');
    const page = document.body.textContent ?? '';

    // The refund promise — A.5's second paragraph, inside the consent.
    expect(page).toContain('Proovd will refund the entire amount charged at this Checkout');
    // §24.6: the 5% is a separate stream, said separately from the fee lines.
    expect(page).toContain('Proovd retains 5% of the captured campaign reward');
    // The brief: "State that plainly in the surface, not just in the consent."
    expect(page).toContain(
      'A pending proposal is not acceptance and does not pause or extend the 72-hour deadline.',
    );
  });

  it('offers one payment action, carrying A.5’s exact words and the session URL', async () => {
    mount(eligible);
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Your listing fee' })).toBeInTheDocument());
    await user.type(screen.getByLabelText('Billing ZIP code'), '94105');
    await user.click(screen.getByRole('button', { name: 'Work out my total' }));

    const pay = await screen.findByRole('link', { name: 'Agree and Pay US$33.48' });
    expect(pay).toHaveAttribute('href', QUOTE.url);

    // §30: no competing action in a payment state. The flow's Back control
    // sits beside it and is deliberately `tertiary` — the rule is about a
    // second thing competing for the press, not about having a way out.
    const primaries = document.querySelectorAll('.btn--primary');
    expect(primaries).toHaveLength(1);
    expect(primaries[0]?.textContent).toContain('Agree and Pay');
    // Help is not lost by keeping it to one: HELP is in the flow's top bar on
    // every page, which is where §27.1's sixth question is answered.
    expect(screen.getByRole('button', { name: /^help$/i })).toBeInTheDocument();
  });

  it('keeps the newsletter consent unchecked and separate (§28.4)', async () => {
    mount(eligible);
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Your listing fee' })).toBeInTheDocument());
    await user.type(screen.getByLabelText('Billing ZIP code'), '94105');
    await user.click(screen.getByRole('button', { name: 'Work out my total' }));

    await screen.findByTestId('listing-consent');
    const newsletter = screen.getByRole('checkbox', {
      name: /monthly newsletter about new campaigns/i,
    });
    expect(newsletter).toHaveAttribute('aria-checked', 'false');
  });

  it('computes nothing: the rendered totals are exactly what the server sent', async () => {
    // A server that sends deliberately inconsistent lines must surface them
    // rather than have the browser quietly re-derive a "correct" total —
    // that divergence is the bug the no-arithmetic rule exists to expose.
    mount(eligible, { ...QUOTE, totalCents: '9999' });
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Your listing fee' })).toBeInTheDocument());
    await user.type(screen.getByLabelText('Billing ZIP code'), '94105');
    await user.click(screen.getByRole('button', { name: 'Work out my total' }));

    await screen.findByTestId('listing-consent');
    expect(screen.getByText('US$99.99')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Agree and Pay US$99.99' })).toBeInTheDocument();
  });
});

/* ── §13 — the states that offer no way to pay ────────────────────────────── */

describe('states with no path to payment (§13)', () => {
  it('a restricted account gets support and no payment control', async () => {
    mount({
      paid: false,
      onboardingState: 'restricted',
      listingFeeEligible: false,
      taxAvailable: true,
      checkoutAvailable: false,
    });

    await waitFor(() =>
      expect(screen.getByText('Payment is not available')).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: /Work out my total/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Agree and Pay/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Contact support/)).toBeInTheDocument();
  });

  it('incomplete onboarding says so and offers no payment control', async () => {
    mount({
      paid: false,
      onboardingState: 'more_information_required',
      listingFeeEligible: false,
      taxAvailable: true,
      checkoutAvailable: false,
    });

    await waitFor(() => expect(screen.getByText('Payment is not open yet')).toBeInTheDocument());
    expect(screen.getByText(/payout setup is not finished/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Agree and Pay/ })).not.toBeInTheDocument();
  });

  it('unconfigured tax refuses loudly rather than quoting an untaxed total', async () => {
    mount({
      paid: false,
      onboardingState: 'complete',
      listingFeeEligible: true,
      taxAvailable: false,
      checkoutAvailable: false,
    });

    await waitFor(() => expect(screen.getByText('Payment is not open yet')).toBeInTheDocument());
    expect(screen.getByText(/Sales-tax calculation is not switched on/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Agree and Pay/ })).not.toBeInTheDocument();
  });
});

/* ── §31.6 / §33.3.11 — after payment ─────────────────────────────────────── */

const paid = (overrides: Record<string, unknown> = {}) => ({
  paid: true,
  payment: {
    baseCents: '3500',
    discountLines: [{ item: 'story', discountCents: '200' }],
    discountCents: '200',
    promotionCents: '0',
    subtotalCents: '3300',
    taxCents: '264',
    totalCents: '3564',
    descriptor: 'PROOVD LISTING',
    receiptUrl: null,
    paidAt: new Date().toISOString(),
    responseDeadlineAt: new Date(Date.now() + 72 * 3600_000).toISOString(),
    freeCancellationDeadlineAt: new Date(Date.now() + 48 * 3600_000).toISOString(),
  },
  refund: null,
  cancellation: null,
  ...overrides,
});

describe('after payment (§24.6, §31.6)', () => {
  it('shows the itemised record and offers the free cancellation while it is open', async () => {
    mount(paid());

    await waitFor(() =>
      expect(screen.getByText('Your listing fee is paid')).toBeInTheDocument(),
    );
    expect(screen.getByText('US$35.00')).toBeInTheDocument();
    expect(screen.getByText('Story completed')).toBeInTheDocument();
    expect(screen.getByText('US$2.64')).toBeInTheDocument();
    // Twice by design: the page's own hero keeps the amount after payment, and
    // §24.6's itemisation states it as the total charged. One field, one value.
    expect(screen.getAllByText('US$35.64')).toHaveLength(2);
    expect(screen.getAllByText(/PROOVD LISTING/).length).toBeGreaterThanOrEqual(1);

    expect(
      screen.getByRole('button', { name: 'Cancel and refund my listing fee' }),
    ).toBeInTheDocument();
  });

  it('after the free window, the control asks rather than promises', async () => {
    mount(
      paid({
        payment: {
          ...paid().payment,
          freeCancellationDeadlineAt: new Date(Date.now() - 3600_000).toISOString(),
        },
      }),
    );

    await waitFor(() =>
      expect(screen.getByText('Your listing fee is paid')).toBeInTheDocument(),
    );
    expect(screen.getByText(/free cancellation window has closed/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Ask to cancel this campaign' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Cancel and refund/ }),
    ).not.toBeInTheDocument();
  });

  it('a refunded fee states the full amount and never a settlement date', async () => {
    mount(
      paid({
        refund: {
          status: 'succeeded',
          trigger: 'no_mutual_acceptance',
          totalRefundedCents: '3564',
          explanation:
            'No Creator and Founder mutually accepted locked campaign terms within 72 hours, so the full charge is refunded.',
        },
      }),
    );

    await waitFor(() =>
      expect(screen.getByText('Your listing fee is refunded in full')).toBeInTheDocument(),
    );
    const page = document.body.textContent ?? '';
    expect(page).toContain('US$35.64');
    expect(page).toContain('5–10 business days');
    expect(page).toContain('cannot promise an exact date');
  });

  it('a pending request says who owns it and asks nothing further', async () => {
    mount(
      paid({
        cancellation: {
          status: 'pending',
          kind: 'admin_review',
          explanation: 'Your cancellation request is with our team for review.',
        },
      }),
    );

    await waitFor(() =>
      expect(screen.getByText('Your cancellation request is with our team')).toBeInTheDocument(),
    );
    expect(screen.getByText('No action needed')).toBeInTheDocument();
  });
});
