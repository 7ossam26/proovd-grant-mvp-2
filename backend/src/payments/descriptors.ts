/**
 * Statement descriptors — Spec §24.12, restated from `@proovd/shared`
 * (`shared/src/payments/descriptors.ts`) because the backend cannot import
 * shared at runtime. `descriptors.test.ts` drift-tests every value and the
 * kernel against the shared module.
 *
 * One kernel, seven surfaces (§33.9.13): the campaign page, the checkout, the
 * pre-charge reminder, the charge receipt, the magic-link page, the support
 * case context, and the dispute evidence packet all render the display value
 * this module computes — computed once at pre-order, stored on the
 * reservation, and read back after that. Only the capture call uses the
 * suffix, derived from the STORED display, because the provider joins its
 * account prefix to the suffix with `* ` and sending the full display as a
 * suffix would render `PROOVD* PROOVD …` on a real statement.
 */

export const DESCRIPTOR_PREFIX = 'PROOVD';
export const PLATFORM_DESCRIPTOR = 'PROOVD CAMPAIGNS';
export const LISTING_DESCRIPTOR = 'PROOVD LISTING';
export const CREATOR_PAYMENT_DESCRIPTOR = 'PROOVD CREATOR PAY';
export const DESCRIPTOR_SEPARATOR = '* ';
export const DESCRIPTOR_MAX_LENGTH = 22;
export const CAMPAIGN_SUFFIX_MAX_LENGTH =
  DESCRIPTOR_MAX_LENGTH - (DESCRIPTOR_PREFIX.length + DESCRIPTOR_SEPARATOR.length);
export const DESCRIPTOR_FORBIDDEN_CHARACTERS = ['<', '>', '\\', "'", '"', '*'] as const;
export const CAMPAIGN_SUFFIX_FALLBACK = 'CAMPAIGN';
/** §1.4: an unknown descriptor is named, never invented — one fallback everywhere. */
export const DESCRIPTOR_UNKNOWN_LABEL = 'the campaign descriptor';

export interface CampaignDescriptor {
  suffix: string;
  display: string;
}

function cleanDescriptorText(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function computeCampaignDescriptor(founder: {
  legalName: string;
  entity: string;
}): CampaignDescriptor {
  const base =
    founder.entity && founder.entity !== 'sole proprietor' ? founder.entity : founder.legalName;
  let suffix = cleanDescriptorText(base).slice(0, CAMPAIGN_SUFFIX_MAX_LENGTH).trim();
  if (!/[A-Z]/.test(suffix)) suffix = CAMPAIGN_SUFFIX_FALLBACK;
  return { suffix, display: `${DESCRIPTOR_PREFIX}${DESCRIPTOR_SEPARATOR}${suffix}` };
}

export function campaignDescriptorSuffix(display: string): string {
  let rest = display;
  const modern = `${DESCRIPTOR_PREFIX}${DESCRIPTOR_SEPARATOR}`;
  const legacy = `${DESCRIPTOR_PREFIX} `;
  if (display.startsWith(modern)) rest = display.slice(modern.length);
  else if (display.startsWith(legacy)) rest = display.slice(legacy.length);
  let suffix = cleanDescriptorText(rest).slice(0, CAMPAIGN_SUFFIX_MAX_LENGTH).trim();
  if (!/[A-Z]/.test(suffix)) suffix = CAMPAIGN_SUFFIX_FALLBACK;
  return suffix;
}

export function campaignDescriptorViolations(descriptor: CampaignDescriptor): string[] {
  const violations: string[] = [];
  if (descriptor.suffix.length === 0) violations.push('suffix_empty');
  if (descriptor.suffix.length > CAMPAIGN_SUFFIX_MAX_LENGTH) violations.push('suffix_too_long');
  if (!/[A-Za-z]/.test(descriptor.suffix)) violations.push('suffix_needs_letter');
  for (const ch of DESCRIPTOR_FORBIDDEN_CHARACTERS) {
    if (descriptor.suffix.includes(ch)) {
      violations.push('suffix_forbidden_character');
      break;
    }
  }
  if (descriptor.display !== `${DESCRIPTOR_PREFIX}${DESCRIPTOR_SEPARATOR}${descriptor.suffix}`) {
    violations.push('display_not_prefix_plus_suffix');
  }
  if (descriptor.display.length > DESCRIPTOR_MAX_LENGTH) violations.push('display_too_long');
  return violations;
}
