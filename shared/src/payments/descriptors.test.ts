import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_SUFFIX_FALLBACK,
  CAMPAIGN_SUFFIX_MAX_LENGTH,
  campaignDescriptorSuffix,
  campaignDescriptorViolations,
  computeCampaignDescriptor,
  CREATOR_PAYMENT_DESCRIPTOR,
  DESCRIPTOR_MAX_LENGTH,
  DESCRIPTOR_PREFIX,
  DESCRIPTOR_SEPARATOR,
  LISTING_DESCRIPTOR,
  PLATFORM_DESCRIPTOR,
} from './descriptors.js';

describe('§24.12 statement descriptors', () => {
  it('pins the three static descriptors and the prefix', () => {
    expect(PLATFORM_DESCRIPTOR).toBe('PROOVD CAMPAIGNS');
    expect(DESCRIPTOR_PREFIX).toBe('PROOVD');
    expect(LISTING_DESCRIPTOR).toBe('PROOVD LISTING');
    expect(CREATOR_PAYMENT_DESCRIPTOR).toBe('PROOVD CREATOR PAY');
  });

  it('computes display = prefix + separator + suffix, within the provider budget', () => {
    const d = computeCampaignDescriptor({ legalName: 'Ada Example', entity: 'Focus Timer LLC' });
    expect(d.suffix).toBe('FOCUS TIMER LL');
    expect(d.display).toBe(`${DESCRIPTOR_PREFIX}${DESCRIPTOR_SEPARATOR}${d.suffix}`);
    expect(d.display.length).toBeLessThanOrEqual(DESCRIPTOR_MAX_LENGTH);
    expect(campaignDescriptorViolations(d)).toEqual([]);
  });

  it('uses the legal name for a sole proprietor', () => {
    const d = computeCampaignDescriptor({ legalName: 'Ada Example', entity: 'sole proprietor' });
    expect(d.suffix).toBe('ADA EXAMPLE');
  });

  it('strips characters the provider refuses and never exceeds the suffix budget', () => {
    const d = computeCampaignDescriptor({
      legalName: 'x',
      entity: `Nova <Labs> "quoted" * back\\slash 'and' more words here`,
    });
    expect(d.suffix.length).toBeLessThanOrEqual(CAMPAIGN_SUFFIX_MAX_LENGTH);
    for (const ch of ['<', '>', '\\', "'", '"', '*']) expect(d.suffix).not.toContain(ch);
    expect(campaignDescriptorViolations(d)).toEqual([]);
  });

  it('falls back to a lettered suffix when the name reduces to nothing valid', () => {
    const d = computeCampaignDescriptor({ legalName: '12345', entity: '!!!' });
    expect(d.suffix).toBe(CAMPAIGN_SUFFIX_FALLBACK);
    expect(campaignDescriptorViolations(d)).toEqual([]);
  });

  it('derives the capture suffix from the stored display, including the legacy shape', () => {
    expect(campaignDescriptorSuffix('PROOVD* FOCUS TIMER')).toBe('FOCUS TIMER');
    // Pre-20b rows stored `PROOVD <name>` with no separator.
    expect(campaignDescriptorSuffix('PROOVD TESTCO')).toBe('TESTCO');
    // Never returns something the provider would refuse.
    expect(campaignDescriptorSuffix('PROOVD* ')).toBe(CAMPAIGN_SUFFIX_FALLBACK);
  });

  it('names violations instead of silently normalising a bad pair', () => {
    expect(
      campaignDescriptorViolations({ suffix: 'A MUCH TOO LONG SUFFIX', display: 'PROOVD* A MUCH TOO LONG SUFFIX' }),
    ).toContain('suffix_too_long');
    expect(campaignDescriptorViolations({ suffix: '1234', display: 'PROOVD* 1234' })).toContain(
      'suffix_needs_letter',
    );
    expect(campaignDescriptorViolations({ suffix: 'OK', display: 'PROOVD OK' })).toContain(
      'display_not_prefix_plus_suffix',
    );
  });
});
