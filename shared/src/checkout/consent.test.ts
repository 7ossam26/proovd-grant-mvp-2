/**
 * Appendix A.5 — exact-text and resolution tests.
 *
 * The template is compared against the Spec's own appendix file, the same way
 * the §27.8 contact block and the A.1 trust strip are pinned: an "improvement"
 * to this text is a defect, and the suite is where that fact lives.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import {
  LISTING_FEE_CONSENT_TEMPLATE,
  LISTING_FEE_NEWSLETTER_LABEL,
  LISTING_FEE_PAY_ACTION_TEMPLATE,
  resolveListingFeeConsent,
} from './consent.js';

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

/** The A.5 code block, exactly as the Spec ships it. */
function specConsentBlock(): string {
  const spec = readFileSync(SPEC_PATH, 'utf8');
  const start = spec.indexOf('## A.5 Listing-fee consent');
  expect(start, 'the Spec must contain Appendix A.5').toBeGreaterThan(-1);
  const fenceStart = spec.indexOf('```text', start);
  const fenceEnd = spec.indexOf('```', fenceStart + 7);
  return spec.slice(fenceStart + 7, fenceEnd).trim();
}

describe('Appendix A.5 is exact text', () => {
  it('the consent body is verbatim from the Spec', () => {
    const block = specConsentBlock();
    // The block also carries the optional checkbox and the action; the body is
    // everything before the checkbox line.
    const body = block.split('[ ]')[0]!.trim();
    expect(LISTING_FEE_CONSENT_TEMPLATE.trim()).toBe(body);
  });

  it('the newsletter consent and the action are verbatim from the Spec', () => {
    const block = specConsentBlock();
    // The Spec wraps the label across two lines; compare with wrapping folded.
    const folded = block.replace(/\s+/g, ' ');
    expect(folded).toContain(LISTING_FEE_NEWSLETTER_LABEL.replace(/\s+/g, ' '));
    expect(block).toContain(`[${LISTING_FEE_PAY_ACTION_TEMPLATE}]`);
    // (optional; unchecked by default) — §28.4, and the Spec says so inline.
    const checkboxLine = block.split('\n').find((l) => l.startsWith('[ ]'));
    expect(checkboxLine).toContain('(optional; unchecked by default)');
  });
});

describe('resolution', () => {
  it('substitutes both markers everywhere they appear', () => {
    const resolved = resolveListingFeeConsent({ subtotal: '25.00', total: '27.06' });
    expect(resolved.body).toContain('US$25.00');
    expect(resolved.body).toContain('US$27.06');
    expect(resolved.body).not.toContain('[SUBTOTAL]');
    expect(resolved.body).not.toContain('[TOTAL]');
    expect(resolved.action).toBe('Agree and Pay US$27.06');
  });

  it('refuses an unformatted amount rather than rendering a bracket', () => {
    expect(() => resolveListingFeeConsent({ subtotal: '[SUBTOTAL]', total: '27.06' })).toThrow();
    expect(() => resolveListingFeeConsent({ subtotal: '25', total: '27.06' })).toThrow();
    expect(() => resolveListingFeeConsent({ subtotal: '25.00', total: '' })).toThrow();
  });
});
