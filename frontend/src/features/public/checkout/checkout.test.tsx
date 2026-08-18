/**
 * Phase 15 — the Backer pre-order checkout surface.
 *
 * Acceptance: §33.5.2 (the checkout shows subtotal + tax = total, US$0 today,
 * trigger, delivery, seller, descriptor, cancel, and sharing), §33.5.3 (the two
 * optional consents are separate and unchecked), and §33.5.12 (the success state
 * leads with "you were not charged" and matches the authorized total).
 *
 * The network and Stripe are injected as test seams, so the surface's content
 * and flow are what is under test — not a real charge (§34).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CheckoutForm } from './CheckoutDrawer.js';
import type { Quote, PreorderSuccess } from './api.js';

const QUOTE: Quote = {
  campaignTitle: 'The Focus Timer',
  founderLegalName: 'Dana Rivera',
  rewardSku: 'TIER-1',
  rewardTitle: 'Founding backer',
  rewardSubtotal: '25.00',
  salesTax: '2.00',
  totalAuthorized: '27.00',
  chargedToday: '0.00',
  chargeRule: 'Charged on the close date (March 3, 2026, 5:00 PM UTC).',
  chargeTimeUtc: 'March 3, 2026, 5:00 PM UTC',
  delivery: 'December 2026',
  statementDescriptor: 'PROOVD FOCUS TIMER',
  consentAppendix: 'A.4',
  consentText: 'You are placing a founding-member pre-order.\n\nYour card will NOT be charged today.',
  marketingLabel: 'I allow Dana Rivera to contact me for marketing, research, surveys.',
  sharingDisclosure:
    'Your email and purchase details are shared with the Founder immediately after you reserve.',
  cancellationPath: 'Cancel free any time before the charge date from your backer page.',
  capacity: null,
};

const SUCCESS: PreorderSuccess = {
  reservationId: 'res-1',
  campaignTitle: 'The Focus Timer',
  founderLegalName: 'Dana Rivera',
  rewardTitle: 'Founding backer',
  rewardSubtotal: '25.00',
  salesTax: '2.00',
  totalAuthorized: '27.00',
  chargedToday: '0.00',
  chargeRule: 'Charged on the close date.',
  chargeTimeUtc: 'March 3, 2026, 5:00 PM UTC',
  delivery: 'December 2026',
  statementDescriptor: 'PROOVD FOCUS TIMER',
  magicLinkUrl: 'http://localhost:3000/backer/rawtoken123',
  suspectedDuplicate: false,
};

function renderForm(overrides: Partial<Parameters<typeof CheckoutForm>[0]> = {}) {
  const fetchQuoteFn = vi.fn(async () => ({ ok: true as const, quote: QUOTE }));
  const submitFn = vi.fn(async () => ({ ok: true as const, success: SUCCESS }));
  const createPaymentMethodFn = vi.fn(async () => ({ ok: true as const, paymentMethodId: 'pm_test' }));
  render(
    <CheckoutForm
      campaignId="c1"
      reward={{ sku: 'TIER-1', title: 'Founding backer', priceCents: 2_500n, delivery: 'December 2026' }}
      model="product"
      founderLegalName="Dana Rivera"
      fetchQuoteFn={fetchQuoteFn}
      submitFn={submitFn}
      createPaymentMethodFn={createPaymentMethodFn}
      {...overrides}
    />,
  );
  return { fetchQuoteFn, submitFn, createPaymentMethodFn };
}

async function fillDetailsAndCalculate(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Why do you want this product?'), 'I need to focus.');
  await user.selectOptions(
    screen.getByLabelText('How likely are you to recommend this to someone?'),
    '8',
  );
  await user.type(screen.getByLabelText('Email'), 'backer@example.com');
  await user.type(screen.getByLabelText('Phone'), '4155550100');
  await user.type(screen.getByLabelText('Billing postal code'), '10001');
  await user.type(screen.getByLabelText('State (2-letter)'), 'NY');
  await user.click(screen.getByRole('button', { name: 'Calculate total' }));
}

describe('§33.5.2 — the checkout shows every required fact', () => {
  it('renders subtotal + tax = total, US$0 today, seller, descriptor, delivery, cancel, sharing', async () => {
    const user = userEvent.setup();
    renderForm();
    await fillDetailsAndCalculate(user);

    /*
      Scoped to the itemised list, which is where §33.5.2's contract actually
      lives: "subtotal + tax = total" is a statement about the breakdown, not
      about the page containing the string somewhere. Session C's restyle adds
      the reference's summary card and its `US$0 today → US$27.00` pair, so the
      total legitimately appears more than once — asserting it HERE is narrower
      than the page-wide query it replaces, not looser.
    */
    await screen.findByText('US$25.00');
    const amounts = document.querySelector('.checkout__amounts') as HTMLElement;
    expect(amounts).not.toBeNull();
    const itemised = within(amounts);
    expect(itemised.getByText('US$25.00')).toBeInTheDocument();
    expect(itemised.getByText('US$2.00')).toBeInTheDocument();
    expect(itemised.getByText('US$27.00')).toBeInTheDocument();
    // US$0 charged today — §30's most important fact on this surface, and the
    // restyle now states it twice on purpose (the itemised row and the
    // reference's `today` card). Asserted in the itemised list for the same
    // reason as the three above.
    expect(itemised.getByText('US$0.00')).toBeInTheDocument();
    expect(screen.getByText(/Seller: Dana Rivera/)).toBeInTheDocument();
    expect(screen.getByText(/Charged on the close date/)).toBeInTheDocument();
    expect(screen.getByText(/Delivery: December 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Expected statement: PROOVD FOCUS TIMER/)).toBeInTheDocument();
    expect(screen.getByText(QUOTE.cancellationPath)).toBeInTheDocument();
    expect(screen.getByText(QUOTE.sharingDisclosure)).toBeInTheDocument();
    // The consent read before any card, with its not-charged line.
    expect(screen.getByText(/Your card will NOT be charged today/)).toBeInTheDocument();
  });
});

describe('§33.5.3 — the optional consents are separate and unchecked', () => {
  it('shows three distinct controls, all unchecked, with the two optional ones separate', async () => {
    const user = userEvent.setup();
    renderForm();
    await fillDetailsAndCalculate(user);
    await screen.findAllByText('US$27.00');

    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(3);
    // All unchecked by default (§28.4).
    for (const s of switches) expect(s).toHaveAttribute('aria-checked', 'false');

    // The two optional consents are distinct, purpose-specific controls.
    expect(screen.getByText(/I allow Dana Rivera to contact me/)).toBeInTheDocument();
    expect(screen.getByText(/monthly newsletter/)).toBeInTheDocument();
    expect(screen.getByText(/at least 18 years old/)).toBeInTheDocument();
  });
});

describe('§33.5.12 — the success state leads with not-charged and matches the total', () => {
  it('reaches the B.2 success state after authorizing', async () => {
    const user = userEvent.setup();
    const { submitFn } = renderForm();
    await fillDetailsAndCalculate(user);
    await screen.findAllByText('US$27.00');

    // Confirm 18+, then authorize.
    const [ageSwitch] = screen.getAllByRole('switch');
    await user.click(ageSwitch!);
    await user.click(screen.getByRole('button', { name: 'Authorize pre-order' }));

    expect(await screen.findByText('Pre-order saved — you were not charged.')).toBeInTheDocument();
    expect(screen.getByText('US$0 charged today')).toBeInTheDocument();
    expect((await screen.findAllByText('US$27.00')).length).toBeGreaterThan(0);
    expect(submitFn).toHaveBeenCalledOnce();
    // The success action links to the Backer magic-link page.
    expect(screen.getByRole('link', { name: /Review or cancel/ })).toHaveAttribute(
      'href',
      '/backer/rawtoken123',
    );
  });

  it('does not submit until 18+ is confirmed', async () => {
    const user = userEvent.setup();
    const { submitFn } = renderForm();
    await fillDetailsAndCalculate(user);
    await screen.findAllByText('US$27.00');

    await user.click(screen.getByRole('button', { name: 'Authorize pre-order' }));
    expect(submitFn).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/18/);
  });
});
