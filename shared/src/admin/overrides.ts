/**
 * The override contract §33.12.4 tests, and the §26.2 rule it protects.
 *
 * §33.12.4: "User/provider data auto-populates Admin; every override preserves
 * before/after, reason, actor, and time."
 *
 * Those are two claims and the second only means something because of the
 * first. §26.2: "User/Stripe data auto-populates; Admin adds only
 * review/decision/evidence/override data." If an Admin were re-typing a
 * Founder's email or a Stripe requirement name, there would be no way to tell a
 * correction from a transcription error — and "before" would be whatever was
 * last typed rather than what the system actually held.
 *
 * So the two halves are enforced separately:
 *
 *   **Auto-populated** fields have no write path. Not a disabled input, not a
 *   validated one — no route, no column in any request body, nothing to send.
 *   The absence is the enforcement, the same posture 10b took with bank details
 *   and 09a with Founder-set completions.
 *
 *   **Override** fields go through one path that refuses without a prior value.
 *   An override with no before is unauditable, which is the phase trap's exact
 *   wording, so the machine reads the current value itself rather than trusting
 *   a caller-supplied one — a caller that supplies both halves can supply a
 *   flattering pair.
 */

/**
 * What kind of data a field on an Admin surface is (§26.2).
 *
 * `auto_populated`  arrives from the user's own submission or from a provider.
 *                   Read-only for Admin, forever. Correcting it is the owner's
 *                   job or a support case, never a typed-over value.
 * `admin_review`    Admin's own judgement, evidence, or decision. Admin writes
 *                   it because there is nowhere else it could come from.
 * `admin_override`  Admin replacing a value the system derived. Requires the
 *                   full §25.6 record and is the only one that needs a before.
 */
export const ADMIN_FIELD_KINDS = ['auto_populated', 'admin_review', 'admin_override'] as const;
export type AdminFieldKind = (typeof ADMIN_FIELD_KINDS)[number];

/**
 * The five things §33.12.4 requires an override to preserve.
 *
 * Named as a register so the acceptance test asserts against the Spec's list
 * rather than against whatever the implementation happened to store.
 */
export const OVERRIDE_REQUIRED_FACTS = [
  'prior_value',
  'new_value',
  'reason',
  'actor',
  'occurred_at',
] as const;
export type OverrideRequiredFact = (typeof OVERRIDE_REQUIRED_FACTS)[number];

/**
 * The overridable targets this phase knows about.
 *
 * A register rather than free text, because an override route that accepts any
 * string for `field` is a route that will happily record an override of
 * something that does not exist — and the audit trail would look complete while
 * pointing at nothing. Later phases add entries; they do not widen the type to
 * `string`.
 */
export interface OverridableField {
  readonly key: string;
  readonly label: string;
  readonly targetType: string;
  readonly specRef: string;
  /** What overriding it actually changes for a customer. Feeds the §26.6 preview. */
  readonly customerConsequence: string;
}

export const OVERRIDABLE_FIELDS: readonly OverridableField[] = [
  {
    key: 'reservation.attribution_status',
    label: 'Attribution status on a reservation',
    targetType: 'reservation',
    specRef: '§18, §26.5',
    customerConsequence:
      'Changes which Creator is credited for this pre-order, and therefore what that Creator is told they earned.',
  },
  {
    key: 'reservation.cap_result',
    label: 'Cap result on a reservation',
    targetType: 'reservation',
    specRef: '§2.2, §26.5',
    customerConsequence:
      'Changes whether this pre-order counts toward the campaign total the Backer and the Founder both see.',
    },
  {
    key: 'reservation.tax_close_usable',
    label: 'Tax calculation usability at close',
    targetType: 'reservation',
    specRef: '§19, §31.7',
    customerConsequence:
      'Decides whether this card may be charged at all. Marking an expired calculation usable would charge a total the Backer never consented to.',
  },
  {
    key: 'campaign.high_effort',
    label: 'High-effort classification',
    targetType: 'campaign',
    specRef: '§12, §14.3',
    customerConsequence:
      'Changes whether a Creator may propose a percentage above the base rate on this campaign.',
  },
  {
    key: 'campaign.seller_tax_readiness',
    label: 'Seller tax readiness',
    targetType: 'campaign',
    specRef: '§31.7',
    customerConsequence:
      'Decides whether the campaign may collect live sales tax. Recording readiness that does not exist would charge Backers a tax nobody is registered to remit.',
  },
] as const;

export type OverridableFieldKey = (typeof OVERRIDABLE_FIELDS)[number]['key'];

export function findOverridableField(key: string): OverridableField | undefined {
  return OVERRIDABLE_FIELDS.find((f) => f.key === key);
}

/**
 * §26.7/§33.9.11's rule, established here because the money surfaces hit it
 * first: raw provider and fraud codes never become customer copy.
 *
 * §26.8: "Raw provider/fraud codes are never pasted into customer messages."
 * §33.9.11 tests it. They may appear as secondary support detail in the Admin
 * view — that is where they are useful — so this is not a rule about storing
 * them, it is a rule about which column they may be read out of.
 *
 * The shapes below are what a provider code actually looks like: Stripe decline
 * and error codes, Radar rule outcomes, and the `evt_`/`pi_`/`req_` object
 * prefixes. A customer-facing string containing one has leaked.
 */
export const RAW_PROVIDER_CODE_PATTERNS: readonly RegExp[] = [
  /\b(?:card_declined|insufficient_funds|do_not_honor|lost_card|stolen_card|pickup_card|transaction_not_allowed|try_again_later|fraudulent|generic_decline|incorrect_cvc|expired_card|processing_error|authentication_required)\b/i,
  /\b(?:evt|pi|seti|ch|py|re|tr|po|acct|cs|txcd|req)_[A-Za-z0-9]{6,}\b/,
  /\bradar[_.]/i,
  /\brule:\s*[A-Za-z0-9_]+/i,
  /\brisk_level\s*[:=]/i,
] as const;

/**
 * Does this string contain something that must not reach a customer?
 *
 * Used by the customer-facing halves of the override and money surfaces before
 * a message is stored, so the refusal happens where an Admin can fix it rather
 * than after it has been sent.
 */
export function containsRawProviderCode(text: string): boolean {
  return RAW_PROVIDER_CODE_PATTERNS.some((pattern) => pattern.test(text));
}
