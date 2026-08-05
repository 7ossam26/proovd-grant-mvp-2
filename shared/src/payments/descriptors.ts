/**
 * Statement descriptors — Spec §24.12 (Phase 20b).
 *
 * §24.12 fixes three static descriptors and one computed one, and then makes
 * one demand about the computed one: "Campaign, checkout, reminder, receipt,
 * magic-link, support, and evidence views display the same computed value"
 * (§33.9.13), and that value is "the actual validated value sent in the
 * Founder/account context — never hard-code `PROOVD*[FOUNDERHANDLE]` if the
 * provider sends another value."
 *
 * ── Why the kernel returns a pair, not a string ────────────────────────────
 * The campaign charge is a direct charge on the Founder's connected account
 * (§24.1), and what the provider actually puts on a card statement is the
 * account's descriptor PREFIX joined to the per-charge SUFFIX with `* ` —
 * `PROOVD* FOCUS TIMER`, never the suffix alone. Before Phase 20b the code
 * computed one full `PROOVD …` string and then sent that whole string as the
 * *suffix* at capture, which would have rendered `PROOVD* PROOVD …` on a real
 * statement — exactly the drift §24.12's last bullet warns about. So the one
 * kernel computes:
 *
 *   suffix  — what is sent to the provider on the PaymentIntent, validated
 *             against the provider's own rules (length budget, at least one
 *             letter, no reserved characters);
 *   display — what the statement will actually show: `PROOVD* <suffix>`.
 *
 * Every §24.12 surface renders the display value; only the capture call uses
 * the suffix. The display value is computed once at pre-order, stored on the
 * reservation, and read back everywhere after that — surfaces never recompute
 * it from a Founder name that may since have changed.
 */

/** §24.12: "Prefix: `PROOVD`." Set on the Founder seller account context. */
export const DESCRIPTOR_PREFIX = 'PROOVD';

/** §24.12: "Platform static descriptor: `PROOVD CAMPAIGNS` where applicable." */
export const PLATFORM_DESCRIPTOR = 'PROOVD CAMPAIGNS';

/** §24.12/§24.6: the listing fee is its own stream with its own descriptor. */
export const LISTING_DESCRIPTOR = 'PROOVD LISTING';

/** §24.7: the fixed Creator payment funding charge (Phase 13's literal, named). */
export const CREATOR_PAYMENT_DESCRIPTOR = 'PROOVD CREATOR PAY';

/**
 * The provider joins prefix and suffix with an asterisk and a space. This is
 * the provider's separator, not a character inside either part.
 */
export const DESCRIPTOR_SEPARATOR = '* ';

/** Provider rule: the complete statement descriptor is at most 22 characters. */
export const DESCRIPTOR_MAX_LENGTH = 22;

/**
 * The room left for the campaign suffix once `PROOVD* ` is spent:
 * 22 − 'PROOVD* '.length = 14.
 */
export const CAMPAIGN_SUFFIX_MAX_LENGTH =
  DESCRIPTOR_MAX_LENGTH - (DESCRIPTOR_PREFIX.length + DESCRIPTOR_SEPARATOR.length);

/** Characters the provider refuses anywhere in a descriptor part. */
export const DESCRIPTOR_FORBIDDEN_CHARACTERS = ['<', '>', '\\', "'", '"', '*'] as const;

/**
 * The fallback suffix when a Founder name reduces to nothing the provider
 * would accept (for example a name of only punctuation or digits — the
 * provider requires at least one letter). Deliberately generic and truthful:
 * it names the charge as a campaign charge without inventing a handle.
 */
export const CAMPAIGN_SUFFIX_FALLBACK = 'CAMPAIGN';

/**
 * What a surface says when no stored descriptor exists for a reservation
 * (§1.4: an unknown value is named, never invented). One constant so the
 * receipt, the reminder, and the magic link cannot drift into three fallbacks.
 */
export const DESCRIPTOR_UNKNOWN_LABEL = 'the campaign descriptor';

export interface CampaignDescriptor {
  /** Sent to the provider as the per-charge statement descriptor suffix. */
  suffix: string;
  /** What the Backer's statement shows: `PROOVD* <suffix>`. Stored and rendered. */
  display: string;
}

/**
 * Reduce a Founder-supplied name to the character set every card network
 * accepts: uppercase A–Z, digits, spaces. Everything else becomes a space and
 * runs collapse.
 */
function cleanDescriptorText(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The §24.12 campaign descriptor. The base is the Founder's entity name unless
 * they are a sole proprietor, in which case their legal name — the same §18
 * identity the campaign page discloses (Phase 14b's rule, kept).
 */
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

/**
 * The suffix to send at capture, derived from the reservation's STORED display
 * value — never recomputed from a Founder name that may have changed since the
 * Backer consented (§24.10's posture applied to the descriptor). Accepts the
 * pre-20b stored shape (`PROOVD <name>`, no separator) so an old reservation
 * still charges under the suffix its stored display implies.
 */
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

/**
 * Provider validation, stated as named violations so a test (and an Admin
 * surface) can assert "passes provider validation" (§33.9.13) as a fact rather
 * than trusting the compute path. An empty array means the pair is valid.
 */
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
