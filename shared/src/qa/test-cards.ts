/**
 * The provider test contract — Spec §32.5, §32.6 (Phase 23b).
 *
 * ── Why there is not a single card number in this file ──────────────────────
 * §32.2: "No test cards or test controls appear in production UI." `shared/` is
 * imported by the frontend and therefore ships in the browser bundle, so a card
 * number recorded here would be in production UI by construction — reachable
 * from the console of a live deployment, whatever the surfaces render.
 *
 * §32.5's other sentence points the same way: "Use current official provider
 * test values during implementation; do not hard-code obsolete documentation
 * into the customer product." The stable half of a scenario is the OUTCOME and
 * the code the provider returns for it — `card_declined`, `insufficient_funds`,
 * `expired_card` — which is what the product branches on and what §33.7.8
 * classifies. The card number that produces it is test infrastructure, belongs
 * in the suite, and is re-verified against the provider's published list rather
 * than remembered.
 *
 * So: the outcomes are here, the numbers are in `backend/src/tests`, and a test
 * asserts they appear nowhere else — including in the built bundle.
 */

/**
 * Which stream a scenario exercises. §24.1 splits the money three ways and the
 * scenarios do not all live in the same one: a decline on a campaign capture is
 * a Connect-endpoint event on the Founder's account, while a listing-fee
 * failure is a platform-endpoint event with Proovd as merchant of record.
 */
export type TestStream = 'campaign_charge' | 'listing_fee' | 'creator_payment_funding';

/** Where in the Backer's lifecycle the scenario happens. */
export type TestStage = 'card_save' | 'capture' | 'post_capture';

export interface RequiredTestOutcome {
  key: string;
  /** §32.5's own words for the required outcome. */
  scenario: string;
  stream: TestStream;
  stage: TestStage;
  /**
   * The provider code the scenario is expected to produce, where §33.7.8's
   * classifier reads one. `null` where the outcome is a state rather than a
   * failure — a successful charge, a refund, a dispute.
   */
  expectedCode: string | null;
  /**
   * What the product must do, stated as the domain result rather than as an
   * absence of an error. A scenario asserting only "it did not throw" proves
   * the gateway ran, not that the outcome was handled.
   */
  expectedDomainResult: string;
  webhookEndpoint: 'platform' | 'connect' | null;
}

/**
 * §32.5's ten required outcomes, one entry each.
 *
 * The list is exactly the Spec's, in the Spec's order, and it is deliberately
 * not longer: an eleventh scenario nobody was asked for is a scenario that will
 * be skipped under time pressure and take a real one with it. Where §32.5
 * names two things in one bullet — "full and partial refund", "incorrect CVC /
 * setup failure" — they are two entries, because they are two behaviours and a
 * suite that ran one of each pair would report the bullet as covered.
 */
export const REQUIRED_TEST_OUTCOMES = [
  {
    key: 'successful_setup_and_later_charge',
    scenario: 'Successful setup and later charge',
    stream: 'campaign_charge',
    stage: 'capture',
    expectedCode: null,
    expectedDomainResult:
      'SetupIntent succeeds, the reservation is created, and the close batch captures it once at subtotal + tax.',
    webhookEndpoint: 'connect',
  },
  {
    key: 'generic_decline',
    scenario: 'Generic decline',
    stream: 'campaign_charge',
    stage: 'capture',
    expectedCode: 'generic_decline',
    expectedDomainResult:
      'The reservation enters capture_failed_retrying inside the one 48-hour window, and Appendix B.5 is sent with no raw code in it.',
    webhookEndpoint: 'connect',
  },
  {
    key: 'insufficient_funds',
    scenario: 'Insufficient funds',
    stream: 'campaign_charge',
    stage: 'capture',
    expectedCode: 'insufficient_funds',
    expectedDomainResult:
      'The same retry window is entered; the decline code is recorded on the attempt and stays off the customer message.',
    webhookEndpoint: 'connect',
  },
  {
    key: 'off_session_authentication_required',
    scenario: 'Off-session authentication / 3DS required',
    stream: 'campaign_charge',
    stage: 'capture',
    expectedCode: 'authentication_required',
    expectedDomainResult:
      'The intent is left requires_action rather than converted to a failure, the client secret routes to the customer-action state, and the Connect webhook completes the capture through the same applier.',
    webhookEndpoint: 'connect',
  },
  {
    key: 'expired_card',
    scenario: 'Expired card',
    stream: 'campaign_charge',
    stage: 'capture',
    expectedCode: 'expired_card',
    expectedDomainResult:
      'The retry window is entered and the B.5 recovery offers the one Update card action.',
    webhookEndpoint: 'connect',
  },
  {
    key: 'incorrect_cvc',
    scenario: 'Incorrect CVC',
    stream: 'campaign_charge',
    stage: 'card_save',
    expectedCode: 'incorrect_cvc',
    expectedDomainResult:
      'The SetupIntent fails, and §33.5.4 holds: no reservation exists and no capacity was consumed.',
    webhookEndpoint: 'connect',
  },
  {
    key: 'setup_failure',
    scenario: 'Setup failure',
    stream: 'campaign_charge',
    stage: 'card_save',
    expectedCode: 'setup_intent_setup_failed',
    expectedDomainResult:
      'The pre-order returns the failure without creating a reservation, and the consent is not recorded.',
    webhookEndpoint: 'connect',
  },
  {
    key: 'processing_error',
    scenario: 'Processing / API error',
    stream: 'campaign_charge',
    stage: 'capture',
    expectedCode: 'processing_error',
    expectedDomainResult:
      'The claimed attempt row survives the provider error, the reservation stays locked in pending_capture, and the resumed batch finishes under the same stable key.',
    webhookEndpoint: 'connect',
  },
  {
    key: 'full_refund',
    scenario: 'Full refund',
    stream: 'campaign_charge',
    stage: 'post_capture',
    expectedCode: null,
    expectedDomainResult:
      'The reservation moves captured → refunded, the §24.8 allocation exists before the refund, and Appendix B.6 is sent once.',
    webhookEndpoint: 'connect',
  },
  {
    key: 'partial_refund',
    scenario: 'Partial refund',
    stream: 'campaign_charge',
    stage: 'post_capture',
    expectedCode: null,
    expectedDomainResult:
      'The refund is recorded against its allocation and the reservation stays captured — only the whole amount moves the status.',
    webhookEndpoint: 'connect',
  },
  {
    key: 'dispute',
    scenario: 'Dispute',
    stream: 'campaign_charge',
    stage: 'post_capture',
    expectedCode: null,
    expectedDomainResult:
      'charge.dispute.created moves captured → disputed, opens the 24-hour Admin task, and touches no earnings.',
    webhookEndpoint: 'connect',
  },
] as const satisfies readonly RequiredTestOutcome[];

export type RequiredTestOutcomeKey = (typeof REQUIRED_TEST_OUTCOMES)[number]['key'];

export const REQUIRED_TEST_OUTCOME_KEYS = REQUIRED_TEST_OUTCOMES.map(
  (outcome) => outcome.key,
) as RequiredTestOutcomeKey[];

/* ── §32.6 the test evidence log ──────────────────────────────────────────── */

/**
 * The fields §32.6 requires a retained entry to carry.
 *
 * `alwaysRequired: false` marks the four that are conditional on the entry
 * having failed — a passing scenario with a `defect` recorded is a
 * contradiction, and demanding one would train whoever runs the matrix to type
 * `n/a` into four columns, which is how an evidence log becomes decoration.
 */
export interface EvidenceField {
  key: string;
  /** §32.6's own phrase for it. */
  requirement: string;
  alwaysRequired: boolean;
}

export const TEST_EVIDENCE_FIELDS = [
  { key: 'environment', requirement: 'test environment', alwaysRequired: true },
  { key: 'stripeMode', requirement: 'test environment', alwaysRequired: true },
  { key: 'connectedAccountIds', requirement: 'connected-account IDs', alwaysRequired: true },
  { key: 'campaignId', requirement: 'campaign ID', alwaysRequired: true },
  { key: 'reservationId', requirement: 'reservation ID', alwaysRequired: true },
  { key: 'paymentIntentId', requirement: 'PaymentIntent ID', alwaysRequired: true },
  { key: 'webhookEndpoint', requirement: 'webhook endpoint', alwaysRequired: true },
  { key: 'scenario', requirement: 'scenario', alwaysRequired: true },
  { key: 'result', requirement: 'pass/fail', alwaysRequired: true },
  { key: 'defect', requirement: 'defect', alwaysRequired: false },
  { key: 'fix', requirement: 'fix', alwaysRequired: false },
  { key: 'retest', requirement: 'retest', alwaysRequired: false },
  {
    key: 'unresolvedBlocker',
    requirement: 'unresolved approved blocker',
    alwaysRequired: false,
  },
  {
    key: 'providerDataDisposition',
    requirement: 'deleted provider test data is deleted internally or marked invalid artifact',
    alwaysRequired: true,
  },
] as const satisfies readonly EvidenceField[];

export type EvidenceFieldKey = (typeof TEST_EVIDENCE_FIELDS)[number]['key'];

/**
 * §32.6's last sentence, as the only three answers an entry may give.
 *
 * "Deleted provider test data must be deleted internally or marked invalid test
 * artifact." A fourth answer — silence — is what the field exists to prevent:
 * an entry pointing at a PaymentIntent the provider has since purged, with
 * nothing saying so, is a reconciliation that will fail in front of the human
 * §34 asks to perform it.
 */
export const PROVIDER_DATA_DISPOSITIONS = [
  /** The objects are still present at the provider and reconcilable. */
  'retained_at_provider',
  /** Purged at the provider, and the internal rows were deleted to match. */
  'deleted_internally',
  /** Purged at the provider, internal rows kept and marked as no longer reconcilable. */
  'marked_invalid_artifact',
] as const;

export type ProviderDataDisposition = (typeof PROVIDER_DATA_DISPOSITIONS)[number];

export interface EvidenceEntry {
  environment: string;
  stripeMode: string;
  connectedAccountIds: readonly string[];
  campaignId: string;
  reservationId: string | null;
  paymentIntentId: string | null;
  webhookEndpoint: string | null;
  scenario: string;
  result: 'pass' | 'fail';
  defect?: string | null;
  fix?: string | null;
  retest?: string | null;
  unresolvedBlocker?: string | null;
  providerDataDisposition: ProviderDataDisposition;
}

/**
 * What is missing from an entry, named.
 *
 * Returns the §32.6 requirement rather than the property name, because the
 * reader of a failing evidence log is the person reconciling it, not the person
 * who wrote the type.
 */
export function evidenceEntryViolations(entry: Partial<EvidenceEntry>): string[] {
  const violations: string[] = [];

  const blank = (value: unknown): boolean =>
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim().length === 0) ||
    (Array.isArray(value) && value.length === 0);

  for (const field of TEST_EVIDENCE_FIELDS) {
    if (!field.alwaysRequired) continue;
    // A scenario that never reaches a charge has no PaymentIntent and no
    // reservation, and demanding one would make the setup-failure entries
    // unrecordable — which is the scenario most worth recording. `null` is the
    // permitted answer there; `undefined` is not, because it is the difference
    // between "there was none" and "nobody looked".
    const value = (entry as Record<string, unknown>)[field.key];
    const nullable = field.key === 'paymentIntentId' || field.key === 'reservationId';
    if (nullable ? value === undefined : blank(value)) {
      violations.push(`missing ${field.requirement} (§32.6)`);
    }
  }

  if (
    entry.providerDataDisposition !== undefined &&
    !PROVIDER_DATA_DISPOSITIONS.includes(entry.providerDataDisposition)
  ) {
    violations.push(`provider data disposition is not one of §32.6's three answers`);
  }

  if (entry.result === 'fail') {
    // §32.6 pairs defect with fix and retest. A recorded failure with no fix
    // and no retest is an open defect, which §32.6 permits — but only as a
    // NAMED unresolved approved blocker. Silence is the thing it forbids.
    const hasRemediation = !blank(entry.fix) && !blank(entry.retest);
    if (blank(entry.defect)) violations.push('a failed scenario records no defect (§32.6)');
    if (!hasRemediation && blank(entry.unresolvedBlocker)) {
      violations.push(
        'a failed scenario records neither a fix and retest nor an unresolved approved blocker (§32.6)',
      );
    }
  }

  return violations;
}

/** A log is complete when every §32.5 outcome has an entry and every entry is whole. */
export function evidenceLogViolations(entries: readonly Partial<EvidenceEntry>[]): string[] {
  const violations: string[] = [];

  const covered = new Set(entries.map((entry) => entry.scenario));
  for (const outcome of REQUIRED_TEST_OUTCOMES) {
    if (!covered.has(outcome.scenario)) {
      violations.push(`§32.5 outcome not exercised: ${outcome.scenario}`);
    }
  }

  entries.forEach((entry, index) => {
    for (const violation of evidenceEntryViolations(entry)) {
      violations.push(`entry ${index + 1} (${entry.scenario ?? 'unnamed'}): ${violation}`);
    }
  });

  return violations;
}
