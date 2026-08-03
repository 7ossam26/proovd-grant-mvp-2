/**
 * Appendix A.3 (Idea) and A.4 (Product) — exact-text and resolution tests.
 *
 * These are the consent under which a saved card is later charged (Phase 15's
 * trap), so they are pinned to the Spec's own appendix the same way A.5, the
 * §27.8 contact block, and the A.1 trust strip are: an "improvement" to this
 * text is a defect, and the suite is where that fact lives.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import {
  IDEA_CONSENT_TEMPLATE,
  PRODUCT_CONSENT_TEMPLATE,
  AGE_US_CONFIRMATION_LABEL,
  FOUNDER_MARKETING_CONSENT_LABEL,
  NEWSLETTER_CONSENT_LABEL,
  PREORDER_AUTHORIZE_ACTION,
  resolveIdeaConsent,
  resolveProductConsent,
  type IdeaConsentVars,
  type ProductConsentVars,
} from './preorder-consent.js';

const here = dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = join(
  here,
  '..',
  '..',
  '..',
  'docs',
  'spec',
  'Proovd-MVP-Engineering-Implementation-Spec-v1_0.md',
);

function specBlock(heading: string): string {
  const spec = readFileSync(SPEC_PATH, 'utf8');
  const start = spec.indexOf(heading);
  expect(start, `the Spec must contain "${heading}"`).toBeGreaterThan(-1);
  const fenceStart = spec.indexOf('```text', start);
  const fenceEnd = spec.indexOf('```', fenceStart + 7);
  return spec.slice(fenceStart + 7, fenceEnd).trim();
}

const fold = (s: string) => s.replace(/\s+/g, ' ').trim();

describe('Appendix A.3 (Idea) is exact text', () => {
  const block = specBlock('## A.3 Idea Campaign consent');

  it('the consent body is verbatim from the Spec', () => {
    const body = block.split('[ ]')[0]!.trim();
    expect(IDEA_CONSENT_TEMPLATE.trim()).toBe(body);
  });

  it('the three checkbox labels and the action are verbatim', () => {
    const folded = fold(block);
    expect(folded).toContain(fold(AGE_US_CONFIRMATION_LABEL));
    expect(folded).toContain(fold(FOUNDER_MARKETING_CONSENT_LABEL));
    expect(folded).toContain(fold(NEWSLETTER_CONSENT_LABEL));
    expect(block).toContain(`[${PREORDER_AUTHORIZE_ACTION}]`);
  });

  it('marks the required control required and the two optional controls optional (§28.4)', () => {
    const lines = block.split('\n').filter((l) => l.startsWith('[ ]'));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('(required; unchecked by default)');
    expect(lines[1]).toContain('(optional; unchecked by default)');
    expect(lines[2]).toContain('(optional; unchecked by default)');
  });
});

describe('Appendix A.4 (Product) is exact text', () => {
  const block = specBlock('## A.4 Product Campaign consent');

  it('the consent body is verbatim from the Spec', () => {
    const body = block.split('[ ]')[0]!.trim();
    expect(PRODUCT_CONSENT_TEMPLATE.trim()).toBe(body);
  });

  it('the three checkbox labels and the action are verbatim', () => {
    const folded = fold(block);
    expect(folded).toContain(fold(AGE_US_CONFIRMATION_LABEL));
    expect(folded).toContain(fold(FOUNDER_MARKETING_CONSENT_LABEL));
    expect(folded).toContain(fold(NEWSLETTER_CONSENT_LABEL));
    expect(block).toContain(`[${PREORDER_AUTHORIZE_ACTION}]`);
  });
});

const IDEA_VARS: IdeaConsentVars = {
  campaignTitle: 'The Focus Timer',
  founderLegalName: 'Dana Rivera',
  rewardPackageName: 'Founding backer',
  rewardSubtotal: '25.00',
  salesTax: '2.06',
  totalAuthorized: '27.06',
  closeDateUtc: 'March 3, 2026 5:00 PM UTC',
  orderThreshold: '500',
  expectedStatementDescriptor: 'PROOVD FOCUS TIMER',
};

const PRODUCT_VARS: ProductConsentVars = {
  campaignTitle: 'Ledgerly Pro',
  founderLegalName: 'Ledgerly LLC',
  rewardPackageName: 'Founding member',
  rewardSubtotal: '99.00',
  salesTax: '8.16',
  totalAuthorized: '107.16',
  closeDateUtc: 'April 1, 2026 5:00 PM UTC',
  deliveryMonthYear: 'June 2026',
  policyReference: 'Ledgerly Refund Policy v2 (effective Jan 1, 2026)',
  preservedPolicyUrl: 'https://app.proovd.co/policies/ledgerly-refund/v2',
  expectedStatementDescriptor: 'PROOVD LEDGERLY',
};

describe('resolveIdeaConsent', () => {
  it('substitutes every variable and leaves no marker', () => {
    const { body, marketingLabel, action, version } = resolveIdeaConsent(IDEA_VARS);
    expect(body).not.toMatch(/\[[A-Z]/);
    expect(body).toContain('The Focus Timer');
    expect(body).toContain('US$27.06');
    expect(body).toContain('order threshold of 500');
    expect(body).toContain('PROOVD FOCUS TIMER');
    // The marketing checkbox carries the resolved Founder name (§28.4).
    expect(marketingLabel).toContain('Dana Rivera');
    expect(marketingLabel).not.toMatch(/\[FOUNDER/);
    expect(action).toBe('Authorize pre-order');
    expect(version).toBe('1.0');
  });

  it('refuses an amount that is not formatted', () => {
    expect(() => resolveIdeaConsent({ ...IDEA_VARS, totalAuthorized: '2706' })).toThrow(
      /formatted amount/,
    );
    expect(() =>
      resolveIdeaConsent({ ...IDEA_VARS, salesTax: '[SALES TAX]' }),
    ).toThrow(/formatted amount/);
  });

  it('refuses an empty non-amount variable', () => {
    expect(() => resolveIdeaConsent({ ...IDEA_VARS, founderLegalName: '' })).toThrow(
      /non-empty/,
    );
  });
});

describe('resolveProductConsent', () => {
  it('substitutes every variable and leaves no marker', () => {
    const { body } = resolveProductConsent(PRODUCT_VARS);
    expect(body).not.toMatch(/\[[A-Z]/);
    expect(body).toContain('Ledgerly Pro');
    expect(body).toContain('Expected delivery of "Founding member" is June 2026.');
    expect(body).toContain('Ledgerly Refund Policy v2 (effective Jan 1, 2026)');
    expect(body).toContain('https://app.proovd.co/policies/ledgerly-refund/v2');
    // Product consent must not mention an order threshold (§4.2).
    expect(body).not.toContain('order threshold');
  });

  it('refuses an unformatted amount', () => {
    expect(() => resolveProductConsent({ ...PRODUCT_VARS, rewardSubtotal: '99' })).toThrow(
      /formatted amount/,
    );
  });
});
