/**
 * Phase 14b — the live campaign page's presentation (§18).
 *
 * The §33.6.1–5 behaviour is proved in the backend suite; this covers the parts
 * of §18 the page itself owns for a real (non-sample) campaign:
 *   - the always-visible short merchant-of-record line, and Appendix A.2 verbatim;
 *   - the "You came through [handle]" attribution banner;
 *   - the `noindex` switch during Days 1–7;
 *   - the outcome-specific ended state (never one generic "Campaign ended");
 *   - a disabled pre-order that collects nothing and shows no example amount.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { MotionProvider } from '../../../motion/MotionProvider.js';
import { CampaignPage } from './CampaignPage.js';
import { expandedMorBlock } from './consent.js';
import type { CampaignView } from './types.js';

function baseView(overrides: Partial<CampaignView> = {}): CampaignView {
  return {
    slug: '11111111-1111-1111-1111-111111111111',
    model: 'product',
    title: 'Nova — the desk lamp that follows the sun',
    tagline: 'A warm, honest light.',
    founder: {
      legalName: 'Ada Founder',
      entity: 'Nova Labs LLC',
      country: 'United States',
      profile: 'A reviewed Founder.',
    },
    opensAt: new Date('2026-08-01T15:00:00Z'),
    closesAt: new Date('2026-08-30T23:00:00Z'),
    rewards: [
      {
        sku: 'NOVA-1',
        title: 'Founding lamp',
        priceCents: 9900n,
        contents: ['One Nova lamp'],
        delivery: 'December 2026',
        fulfillment: 'A shipment confirmation by email.',
      },
    ],
    featuredRewardSku: 'NOVA-1',
    sampleSalesTaxCents: 0n,
    orderThreshold: null,
    thresholdProgress: null,
    momentum: null,
    statementDescriptor: 'PROOVD NOVA LABS',
    story: [{ heading: 'The story', paragraphs: ['We build honest light.'] }],
    faq: [{ question: 'When am I charged?', answer: 'On the close date.' }],
    refundSummary: ['Cancel free before close.'],
    founderRefundPolicy: null,
    commentsEnabled: false,
    isSample: false,
    ended: null,
    attribution: null,
    indexable: true,
    ...overrides,
  };
}

function renderView(view: CampaignView) {
  const router = createMemoryRouter(
    [{ path: '/', element: <MotionProvider><CampaignPage campaign={view} /></MotionProvider> }],
    { initialEntries: ['/'] },
  );
  return render(<RouterProvider router={router} />);
}

function textOf(container: HTMLElement): string {
  return (container.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** The pre-order <button> by its label (accordion triggers are buttons too). */
function preorderButton(container: HTMLElement, label: RegExp): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find((b) => label.test(b.textContent ?? ''));
}

describe('the live campaign page — merchant of record (§18, Appendix A.2)', () => {
  it('renders the always-visible short MoR line above the pre-order action', () => {
    const { container } = renderView(baseView());
    expect(textOf(container)).toContain(
      'Sold by Ada Founder of Nova Labs LLC, United States. Proovd is the platform, not the seller.',
    );
  });

  it('Appendix A.2 is verbatim, with the Founder legal name substituted', () => {
    const block = expandedMorBlock(baseView());
    expect(block).toEqual([
      'Ada Founder is the merchant of record for every transaction on this campaign and is solely responsible for delivering the rewards described above and complying with all applicable laws in their jurisdiction.',
      'Payments are processed by Stripe through Stripe Connect using the production configuration approved for this campaign. Proovd LLC acts only as the software platform that hosts this campaign; Proovd LLC is not the merchant of record and does not take title to any digital reward sold on this campaign.',
      'How customer service works on Proovd:',
      "Once you've reserved a pre-order, you'll get a magic link to your backer page. From there you can message Ada Founder about the product, delivery, or refunds through a built-in support form. We send an immediate automated acknowledgement, provide a human response within one business day, pass product/delivery/refund questions to the founder, and follow up if you haven't heard back within 48 hours.",
      "For questions about the Proovd platform itself — not about this campaign's product — email support@proovd.co.",
    ]);
  });
});

describe('the live campaign page — attribution and discovery (§18)', () => {
  it('shows "You came through [handle]" with the earn explanation while it can earn', () => {
    const { container } = renderView(
      baseView({ attribution: { handle: '@nova', status: 'provisional' } }),
    );
    const text = textOf(container);
    expect(text).toContain('You came through @nova');
    expect(text).toContain('may earn a commission');
    expect(text).toContain('this browser only');
  });

  it('drops the earn line when the link is blocked', () => {
    const { container } = renderView(
      baseView({ attribution: { handle: '@nova', status: 'blocked' } }),
    );
    const text = textOf(container);
    expect(text).toContain('You came through @nova');
    expect(text).not.toContain('may earn a commission');
  });

  it('renders noindex during Days 1–7 (indexable false) and not once open', () => {
    const { unmount } = renderView(baseView({ indexable: false }));
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toMatch(
      /noindex/,
    );
    unmount();
    renderView(baseView({ indexable: true }));
    expect(document.querySelector('meta[name="robots"]')).toBeNull();
  });
});

describe('the live campaign page — pre-order collects nothing (§18, §34)', () => {
  it('disables the action, shows the real note, and no example consent amount', () => {
    const { container } = renderView(baseView());
    const button = preorderButton(container, /Reserve a pre-order/);
    expect(button).toBeDefined();
    expect(button).toBeDisabled();
    const text = textOf(container);
    expect(text).toContain('secure Stripe checkout');
    expect(text).not.toContain('sample campaign');
    // The full A.3/A.4 consent-with-figures is a sample/checkout thing, never on
    // the live page — so its heading and its "Total authorized" line are absent.
    expect(text).not.toContain('consent, in full');
    expect(text).not.toContain('Total authorized');
  });
});

describe('the live campaign page — ended state is outcome-specific (§18)', () => {
  it('a closed campaign says it closed and tells the viewer about their charge', () => {
    const { container } = renderView(baseView({ ended: 'closed' }));
    const text = textOf(container);
    expect(text).toContain('This campaign has closed');
    expect(text).toContain('Were you charged?');
    expect(text).toContain('your saved card was charged');
    expect(preorderButton(container, /Pre-orders are closed/)).toBeDisabled();
    // §18 forbids one generic "Campaign ended" message.
    expect(text).not.toContain('Campaign ended');
  });

  it('a threshold-miss Idea campaign says no card was charged', () => {
    const { container } = renderView(
      baseView({
        model: 'idea',
        orderThreshold: 250,
        founderRefundPolicy: null,
        ended: 'no_charge',
      }),
    );
    const text = textOf(container);
    expect(text).toContain('closed without any charge');
    expect(text).toContain('No card was charged');
    expect(text).toContain('did not reach its order threshold');
    expect(text).not.toContain('Campaign ended');
  });

  it('a suspended campaign and a killed campaign give distinct copy', () => {
    const suspended = textOf(renderView(baseView({ ended: 'suspended' })).container);
    expect(suspended).toContain('on hold');
    const killed = textOf(renderView(baseView({ ended: 'killed' })).container);
    expect(killed).toContain('has been stopped');
    expect(suspended).not.toBe(killed);
  });
});
