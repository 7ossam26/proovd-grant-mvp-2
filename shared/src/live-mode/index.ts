/**
 * The live-mode readiness gate — Spec §34, §2.1, §24.1, §31.7, Appendix C
 * (Phase 24).
 *
 * This is the last phase, and it builds almost nothing. §34 is eleven
 * conditions that must hold before a real person's card can be charged, and
 * the phase brief's out-of-scope section is one word: "Everything. If something
 * needs building, the gate stays closed."
 *
 * So what is built here is the GATE — and the gate is code, because the trap
 * says so in one line: "A checklist someone can proceed past is not a gate."
 * A page listing eleven ticks beside an enabled button is a checklist. What
 * follows is a register the money path reads, refuses on, and cannot be talked
 * past.
 *
 * ── Three properties, and each one is a mechanism ───────────────────────────
 *
 * 1. **Fail closed.** Every unanswered condition is unsatisfied, never unknown.
 *    An `automatic` condition with no implemented check blocks and names the
 *    omission — the same rule §6's prerequisites panel has applied since Phase
 *    06a, and the same rule `readPolicyGate` applies to a missing document. A
 *    gate that opens because something could not be determined is not a gate.
 *
 * 2. **Nothing is satisfied by inference.** The first trap: "Tax is probably
 *    fine, we configured Stripe Tax" is not §34.3. So a condition is either
 *    `automatic` — the app can decide it right now, from a record or the
 *    validated environment — or `recorded`, in which case it carries
 *    `cannotBeAutomatedBecause` and there is no code path that can satisfy it.
 *    A recorded condition is satisfied by a named person storing what they
 *    checked and the evidence, which is §34's own "recorded as complete" and
 *    §1.3's rule that manual work counts only when the app records it.
 *
 * 3. **Two layers, doing two different jobs.** Layer one is the gateway
 *    decorator: while the gate is closed, no live money operation reaches
 *    Stripe at all, and a service added in a later phase inherits that because
 *    it receives the same decorated gateway. Layer two is the pilot scope:
 *    once the gate opens, §2.2 and §6 still allow exactly ONE named pilot
 *    campaign, so a campaign-scoped money entry point refuses for every other
 *    campaign. Layer one cannot be forgotten; layer two cannot be inferred
 *    from a caller-supplied string.
 *
 * Nothing here invents a commercial rule. Every condition is one of §34's own
 * eleven bullets, in §34's order, and where this file adds a word it is naming
 * the record that already holds the fact.
 */

/* ── The eleven conditions (§34) ───────────────────────────────────────────── */

/**
 * How a condition is decided.
 *
 * `automatic`  The app answers it from a record or from the validated
 *              environment. Nothing is claimed, so nothing is recorded — the
 *              check simply re-runs on every read, and a condition that was
 *              true last week and is false now reads false now.
 *
 * `suite`      The acceptance suite answers it, and a running server cannot
 *              observe its own test results. Four of §34's eleven are "…tests
 *              pass", which is a fact about a CI run rather than about this
 *              process, so the gate reads a filed run: what was run, where the
 *              output is, and who filed it. Calling those `automatic` would be
 *              the first trap dressed as rigour — the server would be
 *              reporting a green tick it has no way to have checked.
 *
 * `recorded`   A named person verifies something the app has no way to
 *              observe at all, and stores what they checked, when, and the
 *              evidence. §34's language is "recorded as complete".
 *
 * `suite` and `recorded` both need a row, and both block while unanswered.
 * They are kept apart because the EVIDENCE differs, and the surface has to say
 * which it is: a filed test run is reproducible by anyone with the repository,
 * and a judgement about Stripe's underwriting is not. Presenting either as a
 * system check would be §1.4's failure.
 */
export type ConditionVerification = 'automatic' | 'suite' | 'recorded';

export interface LiveModeCondition {
  key: string;
  /** §34 lists these in order; the ordinal is how the phase brief cites them. */
  ordinal: number;
  /** §34's own bullet, restated as the thing that must be true. */
  requirement: string;
  specRef: string;
  verification: ConditionVerification;
  /**
   * Required on every condition that is not `automatic`, forbidden on the ones
   * that are. Writing down why the process cannot answer it is what stops the
   * next session quietly adding a heuristic that "usually" gets it right — and
   * a heuristic that usually gets it right is precisely how a condition
   * becomes satisfied by inference.
   */
  cannotBeAutomatedBecause?: string;
  /**
   * On a `suite` condition, the test files that decide it. Named so that
   * "which run satisfies this?" has one answer, and so that a filed run
   * pointing at something else is visibly not this condition's evidence.
   */
  provedBy?: readonly string[];
  /**
   * The Track A item that closes it, from `docs/master-plan.md` §2, or null
   * where the condition is closed by the code and the records alone.
   *
   * This is why the gate is honest about being shut rather than being a bug
   * list: eight of the eleven wait on work that is not a coding task.
   */
  trackAItem: 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'A6' | null;
}

/**
 * §34's eleven, in §34's order.
 *
 * Read the `verification` column down the list and the shape of the phase is
 * visible: conditions 5, 6 and 9 are things the suite and the environment
 * genuinely prove, and the other eight are judgements about the world outside
 * the process. That ratio is not a gap in the implementation. It is what §34
 * is — a gate on an operating posture, most of which a program cannot observe.
 */
export const LIVE_MODE_CONDITIONS: readonly LiveModeCondition[] = [
  {
    key: 'payment_architecture',
    ordinal: 1,
    requirement:
      'Production payment architecture, account roles, and capabilities are recorded and match the implementation — verified against what Stripe actually approved, side by side with the code.',
    specRef: '§34, §24.1, §2.1',
    verification: 'recorded',
    cannotBeAutomatedBecause:
      'The app can prove what IT does — §32.7 already proves direct charges on the Founder account, one descriptor, and the §24.3 identity. It cannot read what Stripe approved. Comparing the implementation against an approval nobody has typed in would compare it against itself.',
    trackAItem: 'A1',
  },
  {
    key: 'transfer_capability',
    ordinal: 2,
    requirement:
      'Affiliate recipient Transfer/payout and the fixed-payment path are approved and enabled — or those features remain disabled. A half-state is not permitted.',
    specRef: '§34, §22.1, §24.7, §11',
    verification: 'recorded',
    cannotBeAutomatedBecause:
      'The app can read a connected account\'s payouts capability, and §22.1 already refuses a Transfer to an account that lacks it. What it cannot read is whether the PLATFORM is approved to create Transfers at all — that is an underwriting outcome, and an account-level capability check would pass while the platform-level answer was still open.',
    trackAItem: 'A1',
  },
  {
    key: 'tax_configuration',
    ordinal: 3,
    requirement:
      'Tax registrations, product codes, seller responsibility, calculation validity and reuse, filing, refund treatment, and the exact consent are reviewed and configured — including, per §31.7, each Founder\'s head-office location, product tax code, registration, and active provider tax settings.',
    specRef: '§34, §31.7, §24.3, §11, Appendix A.3–A.5',
    verification: 'recorded',
    cannotBeAutomatedBecause:
      '§31.7 states the reason itself: "zero tax caused by missing collection configuration is not treated as proof that no tax is due". Every automatic signal here is a zero that looks the same whether it is correct or whether nobody registered. The §31.7 panel already refuses to read a zero as clean; it cannot read a registration certificate.',
    trackAItem: 'A3',
  },
  {
    key: 'policies_published',
    ordinal: 4,
    requirement:
      'All canonical policy files are complete and consistent. No document remains in `draft`.',
    specRef: '§34, §31.4, §18, §29.8',
    verification: 'automatic',
    trackAItem: 'A2',
  },
  {
    key: 'key_separation',
    ordinal: 5,
    requirement:
      'Test/live key separation and webhook signatures pass: the configured mode and every key agree, and the two endpoints carry different signing secrets.',
    specRef: '§34, §32.2, §32.3',
    verification: 'automatic',
    trackAItem: null,
  },
  {
    key: 'test_cards_and_idempotency',
    ordinal: 6,
    requirement:
      'The required test-card outcomes and the idempotency cases pass, with the §32.6 evidence log recording each one.',
    specRef: '§34, §32.5, §32.6, §33.7.7, §33.12.5',
    verification: 'suite',
    cannotBeAutomatedBecause:
      'A running server cannot observe its own test results. The suite already refuses an incomplete §32.6 evidence log and regenerates it on every run — but the artifact it writes is a file in the repository, and a process claiming a green tick it never watched is the first trap with better manners.',
    provedBy: [
      'backend/src/tests/p0-pass.test.ts',
      'backend/src/tests/system-contract.test.ts',
      'docs/evidence/stripe-test-matrix.md',
    ],
    trackAItem: null,
  },
  {
    key: 'samples_collect_nothing',
    ordinal: 7,
    requirement:
      'Sample campaigns prove no-charge-today consent and collect no cards — no form, no input, no iframe, no provider script.',
    specRef: '§34, §18, Appendix A.6',
    verification: 'recorded',
    cannotBeAutomatedBecause:
      'The suite already asserts the built sample routes mount no payment field, and that assertion stands. What it cannot see is the deployed origin — a tag manager, an injected widget, or a reverse proxy adding a script are all outside the bundle the test reads. §34 asks about the sample campaigns as served, not as built.',
    trackAItem: 'A4',
  },
  {
    key: 'admin_security',
    ordinal: 8,
    requirement:
      'Admin authentication, role authorization, reauthentication, audit, and token security pass.',
    specRef: '§34, §5.1, §25.6, §28.1, §33.12.5',
    verification: 'suite',
    cannotBeAutomatedBecause:
      'Parts of this ARE observable — the guards are mounted, the audit tables have no UPDATE grant, `user.phone_verified` is CHECK-pinned false. But §34 asks whether the tests pass, and the ones that matter drive a stale session, a wrong-role session, and a token rejection through real HTTP. A live check of the mounted routes would report the half it can see as the whole answer. NOTE (2026-08-10): §5.1 and §28.2 require Admin MFA and this deployment no longer has a second factor — it was removed by product direction. The condition was restated to name the controls that DO exist rather than to quietly keep asserting one that does not; whoever signs this off is signing off a deployment where a password plus the reauthentication window is the whole of Admin authentication.',
    provedBy: [
      'backend/src/tests/system-contract.test.ts',
      'backend/src/tests/admin-settings.test.ts',
      'backend/src/tests/tokens.test.ts',
    ],
    trackAItem: null,
  },
  {
    key: 'p0_pass',
    ordinal: 9,
    requirement:
      'P0 CX, accessibility, support, and notification-deduplication tests pass.',
    specRef: '§34, §33.11, §33.12, §27.2, §26.7',
    verification: 'suite',
    cannotBeAutomatedBecause:
      'A rendered surface and an axe pass are properties of a browser, not of the server. §33.11 also names what the sweep itself cannot decide — 320px reflow, real focus visibility, tap targets, contrast, an actual screen-reader pass — and those stay a manual gate, which is why Track A5 hangs off this condition.',
    provedBy: [
      'frontend/src/features/qa/qa.test.tsx',
      'frontend/src/features/qa/bundle.test.ts',
      'backend/src/tests/cross-surface.test.ts',
      'backend/src/tests/notification-coverage.test.ts',
    ],
    trackAItem: 'A5',
  },
  {
    key: 'human_reconciliation',
    ordinal: 10,
    requirement:
      'A human Admin has reconciled provider test results to internal ledgers, line by line, and signed off.',
    specRef: '§34, §32.6, §26.5, §26.6',
    verification: 'recorded',
    cannotBeAutomatedBecause:
      'The second trap says it outright: "A passing test suite is not reconciliation." A script comparing our ledger to our own gateway double compares a number to the thing that produced it. Reconciliation is a person opening Stripe\'s records and this product\'s ledger side by side and finding they agree — which also requires a run against a real test-mode account, which `docs/evidence/stripe-test-matrix.md` already records as open.',
    trackAItem: 'A1',
  },
  {
    key: 'pilot_owners',
    ordinal: 11,
    requirement:
      'One pilot campaign has named monitoring and rollback owners — named people, reachable, who know they hold it.',
    specRef: '§34, §6, §2.2',
    verification: 'recorded',
    cannotBeAutomatedBecause:
      'Two non-blank strings in a form are not the condition. §34 asks for people who know they hold it, and the trap forbids a team alias and "whoever is on call". The record stores who was named and by whom; whether they agreed is a conversation, and the person recording it is asserting they had it.',
    trackAItem: 'A6',
  },
] as const;

export type LiveModeConditionKey = (typeof LIVE_MODE_CONDITIONS)[number]['key'];

export const LIVE_MODE_CONDITION_KEYS: readonly string[] = LIVE_MODE_CONDITIONS.map(
  (c) => c.key,
);

export function findLiveModeCondition(key: string): LiveModeCondition | undefined {
  return LIVE_MODE_CONDITIONS.find((c) => c.key === key);
}

/**
 * The conditions the app re-decides on every read.
 *
 * Deliberately only two, and both are facts about this process right now: are
 * the eight documents published, and does the environment separate test from
 * live. Neither can be recorded, because an attestation would outlive the fact
 * — somebody signs off that the policies are published, one is later revised
 * back to `draft` for a correction, and the gate keeps reading the signature.
 */
export const AUTOMATIC_CONDITION_KEYS: readonly string[] = LIVE_MODE_CONDITIONS.filter(
  (c) => c.verification === 'automatic',
).map((c) => c.key);

/**
 * The conditions that need a filed row — the three the suite decides and the
 * six a person does. The 0038 CHECK pins the verification table to exactly
 * these, so a row for an automatic condition is unrepresentable rather than
 * refused by a service that remembers to.
 */
export const RECORDABLE_CONDITION_KEYS: readonly string[] = LIVE_MODE_CONDITIONS.filter(
  (c) => c.verification !== 'automatic',
).map((c) => c.key);

/* ── §34's two lists, as registers ─────────────────────────────────────────── */

/**
 * What §34 permits while the gate is closed, in §34's own words.
 *
 * This half matters as much as the other. A gate that stopped everything would
 * stop the pilot from ever being ready, and the sentence exists so that nobody
 * reads "live mode is off" as "the product is off". Recruitment, drafting,
 * review, onboarding and test-mode engineering all continue — which is exactly
 * what Phases 06 through 23 built and what the gate must not touch.
 */
export const PERMITTED_WHILE_GATE_CLOSED: readonly string[] = [
  'public demos',
  'interest collection',
  'Founder and Affiliate onboarding',
  'campaign drafting',
  'manual review',
  'recruitment',
  'test-mode engineering',
] as const;

/** What §34 forbids while the gate is closed, in §34's own words. */
export const BLOCKED_WHILE_GATE_CLOSED: readonly string[] = [
  'real card data',
  'live SetupIntent or PaymentIntent',
  'live application fee',
  'live fixed funding',
  'Affiliate Transfer',
  'any payout promise',
] as const;

/* ── Layer one: the gateway partition ──────────────────────────────────────── */

/**
 * Whether a gateway operation may run in live mode while the gate is closed.
 *
 * Every mutating method on the Stripe port belongs to exactly one of these,
 * and the reason is recorded against §34's own two lists rather than against a
 * judgement. This is 23b's `UNGATED_ADMIN_WRITES` arrangement reused for the
 * same reason: a method added in a later phase belongs to NEITHER set until
 * somebody decides, and the suite fails until they do. Both directions are
 * asserted, so the register cannot rot in either direction.
 */
export type GatewayDisposition = 'blocked_while_closed' | 'permitted_while_closed';

export interface GatewayOperation {
  /** The method name on the Stripe port. */
  method: string;
  disposition: GatewayDisposition;
  /**
   * Which phrase of §34's two lists decides it. A disposition with no §34
   * phrase behind it is somebody's opinion about risk, and §1 rule 6 is why
   * that is not allowed to be the thing standing between a card and a charge.
   */
  because: string;
}

export const GATEWAY_OPERATIONS: readonly GatewayOperation[] = [
  /* ── Blocked: §34's second list, item by item ───────────────────────────── */
  {
    method: 'createCustomer',
    disposition: 'blocked_while_closed',
    because:
      '"real card data" — a Customer on the Founder\'s account exists only to carry a saved card, and creating one in live mode is the opening step of saving a real person\'s card.',
  },
  {
    method: 'confirmSetupIntent',
    disposition: 'blocked_while_closed',
    because: '"live SetupIntent" — named in §34\'s second list.',
  },
  {
    method: 'createOffSessionPaymentIntent',
    disposition: 'blocked_while_closed',
    because: '"live PaymentIntent" — named in §34\'s second list.',
  },
  {
    method: 'createListingCheckoutSession',
    disposition: 'blocked_while_closed',
    because:
      '"real card data" — the listing Checkout collects a Founder\'s card on Proovd\'s own account (§24.6). §34\'s "live application fee" is the campaign-side fee; this is the separate listing stream, and it is blocked for the plainer reason that it takes a real card.',
  },
  {
    method: 'createFundingCheckoutSession',
    disposition: 'blocked_while_closed',
    because: '"live fixed funding" — named in §34\'s second list (§24.7).',
  },
  {
    method: 'createTransfer',
    disposition: 'blocked_while_closed',
    because:
      '"Affiliate Transfer" — named in §34\'s second list. §22.2\'s thank-you uses the same method and is blocked with it: it is a live payment to a person either way.',
  },

  /* ── Permitted: §34's first list, item by item ──────────────────────────── */
  /**
   * The line the partition is drawn on is §34's own second list, read
   * literally: real card data, a live SetupIntent or PaymentIntent, a live
   * application fee, live fixed funding, an Affiliate Transfer, a payout
   * promise. Every one of those CREATES exposure. None of them is a refund or
   * a detach.
   *
   * That distinction is not a technicality, and getting it backwards is the
   * failure §34's own rollback requirement exists to prevent. A gate that
   * closes — because a condition lapsed, or because the rollback owner flipped
   * it at 2am — must not simultaneously strand every Backer who already has a
   * live charge or a live saved card. §34 asks what happens to reservations
   * already saved; "we can no longer refund them or release their card" is not
   * an acceptable answer, and §1 rule 6 forbids adding a sixth blocked item
   * the Spec does not state, particularly one whose only effect is on someone
   * who is owed money back.
   */
  {
    method: 'createRefund',
    disposition: 'permitted_while_closed',
    because:
      'Not on §34\'s blocked list, and deliberately not added to it. A refund moves money BACK to a customer, and it is only ever reachable from a charge that already happened — so it exists precisely in the state a rollback creates. Blocking it would mean a closed gate stranding the people the rollback plan is written for.',
  },
  {
    method: 'detachPaymentMethod',
    disposition: 'permitted_while_closed',
    because:
      'The same reasoning. Detaching releases a card rather than saving one, and it is what §20 cancellation, the §21 threshold miss, and §26.7 kill all do for a Backer. A closed gate must not leave a live saved card attached with no path to remove it. §23.5\'s rule — the successful SetupIntent stays historical — is enforced where it always was, in the code that never rewrites it.',
  },
  {
    method: 'createConnectedAccount',
    disposition: 'permitted_while_closed',
    because:
      '"Founder and Affiliate onboarding" — named in §34\'s first list. An account that can take charges is not a charge, and §13\'s four states are what a Founder needs before the pilot exists.',
  },
  {
    method: 'createAccountLink',
    disposition: 'permitted_while_closed',
    because:
      '"Founder and Affiliate onboarding" — the link IS the onboarding (§11, §13); Proovd collects none of it itself.',
  },
  {
    method: 'retrieveAccount',
    disposition: 'permitted_while_closed',
    because:
      'A read. §34 blocks money and card data; reading back an account state moves neither, and refusing it would leave onboarding — which §34 permits — unable to report its own result.',
  },
  {
    method: 'retrieveCheckoutSession',
    disposition: 'permitted_while_closed',
    because:
      'A read, and specifically the Admin reconciliation path for a missed delivery. Blocking the reconciliation of a payment while blocking the payment protects nothing.',
  },
  {
    method: 'createTaxCalculation',
    disposition: 'permitted_while_closed',
    because:
      'A quote, not a charge: it creates no payment object and moves nothing. It is also how §34 condition 3 gets tested — blocking it would make the tax configuration unverifiable in the mode where it matters, which is condition 3 blocking itself.',
  },
  {
    method: 'verifyEvent',
    disposition: 'permitted_while_closed',
    because:
      'Signature verification, and condition 5 is precisely that it works. It reads a delivery and decides whether it is genuine; refusing to verify would be refusing to know.',
  },
  {
    method: 'hasSecretFor',
    disposition: 'permitted_while_closed',
    because: 'Reads local configuration. Touches no provider and no money.',
  },
] as const;

export const BLOCKED_GATEWAY_METHODS: readonly string[] = GATEWAY_OPERATIONS.filter(
  (o) => o.disposition === 'blocked_while_closed',
).map((o) => o.method);

export const PERMITTED_GATEWAY_METHODS: readonly string[] = GATEWAY_OPERATIONS.filter(
  (o) => o.disposition === 'permitted_while_closed',
).map((o) => o.method);

export function gatewayDispositionFor(method: string): GatewayDisposition | undefined {
  return GATEWAY_OPERATIONS.find((o) => o.method === method)?.disposition;
}

/* ── Layer two: the campaign-scoped money entry points ─────────────────────── */

/**
 * Every service that moves campaign money, or decides that it may.
 *
 * Layer one already stops all of these at the gateway. This register exists for
 * the OTHER half of §34's last condition and §2.2's first limit: once the gate
 * opens, live enablement is "limited to one named pilot campaign", so an
 * entry point that knows its campaign must refuse for every campaign that is
 * not the pilot.
 *
 * It is a register rather than a habit because "checked at every money-touching
 * entry point" is otherwise a claim nobody can test. The suite walks this list,
 * drives each entry point in live mode against a non-pilot campaign, and
 * requires a refusal — so an entry point added later and not added here fails,
 * and an entry point listed here with no guard fails too.
 *
 * `createFounderPayment` and `releaseFounderPayment` are on the list despite
 * having no gateway leg at all. Under the approved direct-charge configuration
 * the captured funds already sit on the Founder's account, so §22.3's release
 * is Proovd's recorded decision rather than a Transfer — but it is a decision
 * that a real person is owed real money, and §34's "any payout promise" is in
 * the blocked list by name.
 */
export interface MoneyEntryPoint {
  key: string;
  /** The exported service function. */
  service: string;
  module: string;
  specRef: string;
  /** What the money does here, in one line. */
  effect: string;
  /**
   * `gated`  Calls `checkLiveMoneyPermitted` before it does anything, and
   *          refuses by name for a campaign that is not the pilot.
   *
   * `unwind` Deliberately NOT gated, with the reason recorded. These are the
   *          paths that move money back or release a card — the state a
   *          rollback leaves behind — and blocking them would strand exactly
   *          the people §34's rollback plan is written for.
   *
   * Both directions are asserted by the suite, so the register cannot rot
   * either way: an entry point added here with no guard fails, and a `gated`
   * entry point whose guard is removed fails too.
   */
  scope: 'gated' | 'unwind';
  /** Required on every `unwind` entry. An absence with no reason is an omission. */
  ungatedBecause?: string;
}

export const MONEY_ENTRY_POINTS: readonly MoneyEntryPoint[] = [
  {
    key: 'preorder_create',
    service: 'createPreorder',
    module: 'reservations/preorder.ts',
    specRef: '§19, §24.2',
    effect: 'Saves a Backer\'s real card against the Founder\'s account.',
    scope: 'gated',
  },
  {
    key: 'preorder_replace_reward',
    service: 'replaceIdeaReward',
    module: 'reservations/preorder.ts',
    specRef: '§19, §20',
    effect: 'Saves a card again for a replaced Idea reward.',
    scope: 'gated',
  },
  {
    key: 'listing_checkout',
    service: 'beginListingCheckout',
    module: 'payments/listing-checkout.ts',
    specRef: '§13, §24.6',
    effect: 'Charges the Founder the listing fee, with Proovd as merchant of record.',
    scope: 'gated',
  },
  {
    key: 'listing_refund',
    service: 'refundListingFee',
    module: 'payments/listing-refund.ts',
    specRef: '§13, §31.6',
    effect: 'Returns the whole listing charge.',
    scope: 'unwind',
    ungatedBecause:
      'A refund moves money back to the Founder, and §13 promises it under three conditions that do not stop applying because the gate closed.',
  },
  {
    key: 'creator_payment_funding',
    service: 'beginAllocationFunding',
    module: 'creator-payment/allocations.ts',
    specRef: '§16, §24.7',
    effect: 'Charges the Founder for a fixed Creator payment.',
    scope: 'gated',
  },
  {
    key: 'close_batch',
    service: 'runCloseBatch',
    module: 'close/close-batch.ts',
    specRef: '§21, §24.2',
    effect: 'Charges every eligible saved card at close.',
    scope: 'gated',
  },
  {
    key: 'capture_retry',
    service: 'updateCardAndRetry',
    module: 'close/retry.ts',
    specRef: '§21, Appendix B.5',
    effect: 'Saves a replacement card and re-attempts the charge.',
    scope: 'gated',
  },
  {
    key: 'reservation_refund',
    service: 'executeRefund',
    module: 'refunds/service.ts',
    specRef: '§24.8, §24.9',
    effect: 'Refunds a captured campaign charge.',
    scope: 'unwind',
    ungatedBecause:
      'A refund moves money back to a Backer. §24.8 already requires an Admin cause, a preview, and an execution; adding a live-mode refusal on top would block the one action a rolled-back pilot most needs.',
  },
  {
    key: 'affiliate_transfer',
    service: 'createAffiliateTransfer',
    module: 'close/earnings.ts',
    specRef: '§22.1, §24.4',
    effect: 'Pays a Creator their finalized earnings.',
    scope: 'gated',
  },
  {
    key: 'fixed_allocation_return',
    service: 'returnFixedAllocation',
    module: 'close/earnings.ts',
    specRef: '§22.1, §24.7',
    effect: 'Returns an unearned fixed Creator payment to the Founder.',
    scope: 'unwind',
    ungatedBecause:
      'Returns an unearned fixed payment to the Founder. Money going back, under §22.1, for work that did not happen.',
  },
  {
    key: 'thank_you_payment',
    service: 'recordThankYou',
    module: 'close/earnings.ts',
    specRef: '§22.2',
    effect: 'Pays a discretionary thank-you out of retained listing-fee revenue.',
    scope: 'gated',
  },
  {
    key: 'founder_payment_create',
    service: 'createFounderPayment',
    module: 'close/founder-payments.ts',
    specRef: '§22.3',
    effect: 'Records that a Founder is owed their eligible share.',
    scope: 'gated',
  },
  {
    key: 'founder_payment_release',
    service: 'releaseFounderPayment',
    module: 'close/founder-payments.ts',
    specRef: '§22.3',
    effect: 'Releases a Founder payment.',
    scope: 'gated',
  },
] as const;

export type MoneyEntryPointKey = (typeof MONEY_ENTRY_POINTS)[number]['key'];

export const MONEY_ENTRY_POINT_KEYS: readonly string[] = MONEY_ENTRY_POINTS.map((e) => e.key);

/* ── The pilot enablement (§34 condition 11, §6, §2.2) ─────────────────────── */

/**
 * What a pilot enablement must carry before it exists.
 *
 * §6 limits the first live enablement to "one named pilot campaign with
 * monitoring and rollback owners"; §34's last condition says the same thing
 * from the other side. Both owners are required and both must be a person: the
 * trap forbids a team alias and "whoever is on call", and the reason is that a
 * rollback decision at 2am needs somebody whose phone rings.
 *
 * The app cannot tell a person's name from an alias — `payments@` and a real
 * surname are both non-blank strings — so this is a `recorded` condition and
 * the refusals below catch only the shapes that are unambiguously not a
 * reachable person. Anything subtler is condition 11's recorded judgement, and
 * pretending otherwise would be the first trap again.
 */
export const PILOT_OWNER_ROLES = ['monitoring', 'rollback'] as const;
export type PilotOwnerRole = (typeof PILOT_OWNER_ROLES)[number];

/**
 * Shapes that are certainly not a named person.
 *
 * Deliberately short and deliberately about form rather than content. A
 * longer list would start refusing real surnames, and a check that refuses a
 * correct answer teaches people to work around it.
 */
export const NON_PERSON_OWNER_PATTERNS: readonly RegExp[] = [
  /^(?:whoever|whomever)\b/i,
  /\bon[-\s]?call\b/i,
  /\b(?:the\s+)?(?:team|rota|roster|group|duty|desk|queue)\b/i,
  /^(?:support|ops|admin|engineering|eng|payments|finance|billing|alerts?|noreply|no-reply)\b/i,
  /^[^@\s]+@[^@\s]+$/,
] as const;

export interface PilotOwner {
  role: PilotOwnerRole;
  /** The person's name. */
  name: string;
  /** How they are reached — §34: "reachable". */
  contact: string;
  /** §34: "who know they hold it". Who confirmed that, and when. */
  acknowledgedBy: string;
}

export interface PilotEnablementInput {
  campaignId: string;
  owners: readonly PilotOwner[];
  rollbackPlan: RollbackPlan;
  enabledBy: string;
}

/**
 * Refusals, by name. Never a boolean — the person enabling a live pilot is
 * owed the specific thing that is missing.
 */
export function pilotEnablementViolations(input: PilotEnablementInput): string[] {
  const violations: string[] = [];

  for (const role of PILOT_OWNER_ROLES) {
    const owner = input.owners.find((o) => o.role === role);
    if (!owner) {
      violations.push(`No ${role} owner is named (§34: named monitoring and rollback owners).`);
      continue;
    }
    if (!owner.name.trim()) {
      violations.push(`The ${role} owner has no name.`);
    } else if (NON_PERSON_OWNER_PATTERNS.some((p) => p.test(owner.name.trim()))) {
      violations.push(
        `The ${role} owner "${owner.name.trim()}" reads as a team or a rota rather than a person. §34 asks for a named person who knows they hold it.`,
      );
    }
    if (!owner.contact.trim()) {
      violations.push(`The ${role} owner has no contact. §34 requires them to be reachable.`);
    }
    if (!owner.acknowledgedBy.trim()) {
      violations.push(
        `Nobody has recorded that the ${role} owner knows they hold it. §34 asks for owners who know, not owners who were listed.`,
      );
    }
  }

  violations.push(...rollbackPlanViolations(input.rollbackPlan));

  if (!input.enabledBy.trim()) {
    violations.push('No named person is enabling this (§25.6: every high-impact action records its actor).');
  }

  return violations;
}

/**
 * §34 asks for three things to be confirmed against the real world before the
 * first live reservation, and the phase brief names them: the descriptor as it
 * renders on a real statement, webhook delivery in live mode, and the
 * monitoring owner actually being able to see the risk inventory.
 *
 * All three are `recorded`. The first two are facts about a system outside
 * this one; the third is a fact about a person.
 */
export interface PilotPreflightCheck {
  key: string;
  requirement: string;
  specRef: string;
}

export const PILOT_PREFLIGHT_CHECKS: readonly PilotPreflightCheck[] = [
  {
    key: 'descriptor_on_statement',
    requirement:
      'The campaign statement descriptor renders correctly on a real card statement — the §24.12 kernel produces `PROOVD* <suffix>`, and what the issuer actually prints is what a Backer will recognise.',
    specRef: '§24.12, §33.9.13',
  },
  {
    key: 'live_webhook_delivery',
    requirement:
      'Both webhook endpoints receive and verify a real live-mode delivery. Signature verification passing in test proves the code; it does not prove the live endpoint is reachable and configured.',
    specRef: '§32.3, §34 condition 5',
  },
  {
    key: 'monitoring_owner_sees_risk',
    requirement:
      'The named monitoring owner has opened `/admin/risk` and can see the §31.7 inventory. An owner who cannot see what they are monitoring is a name on a form.',
    specRef: '§31.7, §34 condition 11',
  },
] as const;

export const PILOT_PREFLIGHT_KEYS: readonly string[] = PILOT_PREFLIGHT_CHECKS.map((c) => c.key);

/* ── The rollback plan (§34, phase brief scope 6) ──────────────────────────── */

/**
 * The five things a rollback plan must say.
 *
 * Written before cutover, not after a problem — which is why it is a required
 * field on the enablement record rather than a document somebody means to
 * write. The last one is the one that is usually missing: reservations saved
 * under live mode carry a real commitment, and a plan that leaves them
 * undefined is not a plan.
 */
export interface RollbackPlanField {
  key: keyof RollbackPlan;
  label: string;
  requirement: string;
}

export const ROLLBACK_PLAN_FIELDS: readonly RollbackPlanField[] = [
  {
    key: 'triggers',
    label: 'What triggers a rollback',
    requirement:
      'The observable conditions that mean stop — not "if something goes wrong". Something a monitoring owner can recognise at 2am without a judgement call.',
  },
  {
    key: 'decisionMaker',
    label: 'Who decides, and how they are reached',
    requirement:
      'A named person and the way to reach them. §34 asks for a rollback owner; this is the moment that name is used.',
  },
  {
    key: 'mechanism',
    label: 'How live mode is disabled',
    requirement:
      'The same fail-closed gate, flipped. A rollback that needs a deployment is a rollback that takes as long as a deployment.',
  },
  {
    key: 'inFlightReservations',
    label: 'What happens to reservations already saved',
    requirement:
      'Cards saved under live mode are real commitments to real people. What happens to them, who tells them, and under which of §20, §21, §26.7 the answer is given.',
  },
  {
    key: 'partyCommunication',
    label: 'What each affected party is told, and by whom',
    requirement:
      'Backers, the Founder, and every Creator on the roster — each one, with the person who sends it. §27.1: a state nobody explains is a state that generates support cases.',
  },
] as const;

export interface RollbackPlan {
  triggers: string;
  decisionMaker: string;
  mechanism: string;
  inFlightReservations: string;
  partyCommunication: string;
}

/** Every field, present and non-blank. Named refusals, never a boolean. */
export function rollbackPlanViolations(plan: RollbackPlan | null | undefined): string[] {
  if (!plan) {
    return ['No rollback plan is recorded. §34 requires it written before cutover, not after a problem.'];
  }
  const violations: string[] = [];
  for (const field of ROLLBACK_PLAN_FIELDS) {
    const value = plan[field.key];
    if (typeof value !== 'string' || !value.trim()) {
      violations.push(`The rollback plan does not say: ${field.label}. ${field.requirement}`);
    }
  }
  return violations;
}

/* ── Appendix C — the completion definition ────────────────────────────────── */

/**
 * Appendix C defines completion as the app running the entire lifecycle
 * "without undocumented operator knowledge", and the phase brief is explicit
 * about how to check it: "by walking the flow, not by reading the code".
 *
 * So this is a register of walks, not of assertions. Each statement is one of
 * Appendix C's four actors; each step is one clause of that actor's sentence,
 * with the surface a person actually opens. A walkthrough is `recorded` — a
 * named person did it, on a date, and wrote down what they found — because a
 * test that renders a surface proves the surface renders, which is §33.11's
 * job and is a different claim from "a person could get from here to there
 * without being told something that is written down nowhere".
 */
export interface AppendixCStep {
  key: string;
  /** The clause of Appendix C this step covers. */
  clause: string;
  /** Where the person doing the walk goes. */
  surface: string;
}

export interface AppendixCStatement {
  actor: 'admin' | 'founder' | 'creator' | 'backer';
  /** Appendix C's own sentence for this actor, abbreviated to its claim. */
  claim: string;
  /** The constraint Appendix C attaches to this actor's journey. */
  constraint: string;
  steps: readonly AppendixCStep[];
}

export const APPENDIX_C_STATEMENTS: readonly AppendixCStatement[] = [
  {
    actor: 'admin',
    claim:
      'Admin can run the whole lifecycle: configure, invite, recruit, support claims, open the response window through one listing payment, manage proposals and readiness, review and version, require reacceptance, record funding and readiness, coordinate the launch order, monitor attribution and risk, execute a safe idempotent close and retry, reconcile every party, and manage fulfillment, disputes, enforcement, completion, and future work.',
    constraint: 'Without undocumented operator knowledge.',
    steps: [
      { key: 'configure', clause: 'configure the system', surface: '/admin/settings, /admin/prerequisites' },
      { key: 'invite_founder', clause: 'invite a Founder', surface: '/admin/founders' },
      { key: 'recruit_creators', clause: 'recruit and invite campaign-specific Affiliates', surface: '/admin/campaigns/:id/creators' },
      { key: 'support_claims', clause: 'observe and support independent account claims', surface: '/admin/founders, /admin/creators' },
      { key: 'response_window', clause: 'activate the formal response window through one listing-fee payment', surface: '/admin/campaigns/:id' },
      { key: 'proposals_readiness', clause: 'manage proposal versions and roster readiness', surface: '/admin/creator-readiness' },
      { key: 'review_version', clause: 'review and version the campaign', surface: '/admin/campaigns/:id/review' },
      { key: 'reacceptance', clause: 'require reacceptance for material changes', surface: '/admin/campaigns/:id/review' },
      { key: 'funding_readiness', clause: 'record fixed funding and Creator readiness', surface: '/admin/creator-readiness' },
      { key: 'launch_order', clause: 'coordinate the page/link/post launch order', surface: '/admin/creator-readiness, /admin/campaign-operations' },
      { key: 'monitor', clause: 'monitor attribution, reservations, tax, support, risks, and threshold changes', surface: '/admin/ledger, /admin/risk, /admin/support' },
      { key: 'close_retry', clause: 'execute a safe idempotent close and retry', surface: '/admin/close' },
      { key: 'reconcile', clause: 'reconcile Founder, Affiliate, Proovd, tax, refund, and provider amounts', surface: '/admin/close, /admin/money' },
      { key: 'post_close_ops', clause: 'manage fulfillment, disputes, enforcement, completion, and future-work requests', surface: '/admin/fulfillment, /admin/refunds, /admin/campaign-operations' },
    ],
  },
  {
    actor: 'founder',
    claim:
      'The Founder can move from invitation to vetting, possible-Creator result, account claim, optional materials and interview, connected-account onboarding, transparent listing payment, campaign build, roster and term decisions, review, launch, calm live monitoring, results, payment, fulfillment, and future readiness.',
    constraint: 'Without a widget dashboard or a hidden rule.',
    steps: [
      { key: 'invitation', clause: 'invitation', surface: '/draft/:token' },
      { key: 'vetting', clause: 'vetting', surface: '/draft/:token/vetting' },
      { key: 'possible_creators', clause: 'possible-Creator result', surface: '/draft/:token/result' },
      { key: 'claim', clause: 'account claim', surface: '/draft/:token/claim' },
      { key: 'materials', clause: 'optional materials and interview', surface: '/campaigns/:id/workspace' },
      { key: 'onboarding', clause: 'connected-account onboarding', surface: '/payouts' },
      { key: 'listing_payment', clause: 'transparent listing payment', surface: '/campaigns/:id/workspace' },
      { key: 'build', clause: 'campaign build', surface: '/campaigns/:id/build' },
      { key: 'roster_terms', clause: 'roster and term decisions', surface: '/campaigns/:id/roster' },
      { key: 'review', clause: 'review', surface: '/campaigns/:id/preview' },
      { key: 'launch', clause: 'launch', surface: '/campaigns/:id/creator-readiness' },
      { key: 'live_monitoring', clause: 'calm live monitoring', surface: '/campaigns/:id/home' },
      { key: 'results', clause: 'results', surface: '/campaigns/:id/results' },
      { key: 'payment', clause: 'payment', surface: '/campaigns/:id/results' },
      { key: 'fulfillment', clause: 'fulfillment', surface: '/campaigns/:id/fulfillment' },
      { key: 'future_readiness', clause: 'future readiness', surface: '/campaigns/:id/results' },
    ],
  },
  {
    actor: 'creator',
    claim:
      'The Creator can move from private campaign invitation to compact account and payout setup, waiting and preparing review, the complete Campaign kit, a clear accept/decline/proposal, locked compensation, readiness, link activation, compliant promotion, proof correction, transparent earnings, post-close completion and Transfer, and an optional future collaboration.',
    constraint: 'Without receiving Backer PII or being forced into direct Founder contact.',
    steps: [
      { key: 'invitation', clause: 'private campaign invitation', surface: '/creator/signup/:token' },
      { key: 'signup_payout', clause: 'compact account and payout setup', surface: '/creator/signup/:token, /creator/payouts' },
      { key: 'waiting', clause: 'waiting and preparing review', surface: '/creator/campaigns/:id/preparing' },
      { key: 'kit', clause: 'the complete Campaign kit', surface: '/creator/campaigns/:id/opportunity' },
      { key: 'decision', clause: 'a clear accept/decline/proposal', surface: '/creator/campaigns/:id/opportunity' },
      { key: 'locked_terms', clause: 'locked compensation', surface: '/creator/campaigns/:id/partnership' },
      { key: 'readiness', clause: 'readiness', surface: '/creator/campaigns/:id/partnership' },
      { key: 'link_activation', clause: 'link activation', surface: '/creator/campaigns/:id/partnership' },
      { key: 'promotion', clause: 'compliant promotion and proof correction', surface: '/creator/campaigns/:id/partnership' },
      { key: 'earnings', clause: 'transparent earnings', surface: '/creator/campaigns/:id/close' },
      { key: 'completion_transfer', clause: 'post-close completion and Transfer', surface: '/creator/campaigns/:id/close' },
      { key: 'future_work', clause: 'an optional future collaboration', surface: '/creator/campaigns/:id/close' },
    ],
  },
  {
    actor: 'backer',
    claim:
      'The Backer can understand seller, reward, charge rule, tax-inclusive authorized total, delivery, cancellation, data sharing, refund, and support before saving a card; receive proof that no charge occurred; cancel or recover safely; recognise any later charge; receive the reward or documented support, refund, and dispute help; and retain campaign-scoped access through final resolution.',
    constraint: 'With no account, through a campaign-scoped magic link.',
    steps: [
      { key: 'understand_before', clause: 'understand seller, reward, charge rule, tax-inclusive total, delivery, cancellation, data sharing, refund, and support before saving a card', surface: '/campaign/:id' },
      { key: 'proof_no_charge', clause: 'receive proof that no charge occurred', surface: 'pre-order confirmation email, /backer/:token' },
      { key: 'cancel', clause: 'cancel safely', surface: '/backer/:token' },
      { key: 'recover', clause: 'recover safely', surface: '/backer/:token' },
      { key: 'recognise_charge', clause: 'recognise any later charge', surface: 'pre-charge reminder, charge receipt, statement descriptor' },
      { key: 'reward_or_help', clause: 'receive the reward or obtain documented support, refund, and dispute help', surface: '/backer/:token' },
      { key: 'retained_access', clause: 'retain campaign-scoped access through final resolution', surface: '/backer/:token' },
    ],
  },
] as const;

export const APPENDIX_C_ACTORS = APPENDIX_C_STATEMENTS.map((s) => s.actor);

export const APPENDIX_C_STEP_KEYS: readonly string[] = APPENDIX_C_STATEMENTS.flatMap((s) =>
  s.steps.map((step) => `${s.actor}:${step.key}`),
);

/* ── §2.1's two directions, at cutover ─────────────────────────────────────── */

/**
 * Appendix A.1's architecture sentence, and why it still reads conditionally.
 *
 * §2.1 says "No UI may claim approval before it exists". Phase 05 therefore
 * shipped a truthful conditional sentence in place of A.1's own, and recorded
 * that the replacement is deleted when Track A1 closes — not edited for
 * anything else.
 *
 * The phase brief adds the other direction: "don't leave hedged copy in place
 * once the hedge is false". Both are §2.1, and both are violations. So the
 * copy state is a fact the gate reports rather than a thing somebody remembers:
 * while condition 1 is unsatisfied the conditional sentence is CORRECT and
 * replacing it would be the first violation; once condition 1 is satisfied the
 * conditional sentence is stale and leaving it is the second.
 */
export const APPROVAL_COPY_SURFACES = [
  {
    key: 'trust_strip',
    appendix: 'A.1',
    surface: 'frontend/src/features/public/trust-strip.ts',
    requirement:
      'While the production Stripe configuration is unapproved, the architecture sentence is the truthful conditional wording. Once approved, it is Appendix A.1 verbatim and the replacement is deleted.',
  },
  {
    key: 'mor_block',
    appendix: 'A.2',
    surface: 'the expanded campaign MoR block',
    requirement:
      'The Stripe Connect description matches the configuration actually approved. §32.7 already proves the implementation is direct charges on the Founder account; this is that description matching the approval.',
  },
] as const;

/**
 * Which of the two §2.1 violations is currently possible.
 *
 * Pure, and takes the condition rather than a flag, so there is no second
 * source of truth about whether approval exists.
 */
export function approvalCopyState(
  paymentArchitectureSatisfied: boolean,
): 'conditional_copy_is_correct' | 'conditional_copy_is_now_stale' {
  return paymentArchitectureSatisfied
    ? 'conditional_copy_is_now_stale'
    : 'conditional_copy_is_correct';
}

/* ── The gate itself ───────────────────────────────────────────────────────── */

export interface ConditionState {
  key: string;
  satisfied: boolean;
  /** Why it is or is not satisfied, in enough detail to act on. */
  detail: string;
}

export interface LiveModeGateState {
  /** True only when every one of the eleven holds. */
  open: boolean;
  /** The keys of the conditions that do not hold, in §34's order. */
  blockingKeys: readonly string[];
  conditions: readonly ConditionState[];
}

/**
 * Composes the gate from the eleven condition states.
 *
 * Fail-closed in three ways, and each is a way this function has to be wrong
 * before a card can be charged that should not be:
 *
 *   * A condition the caller did not answer at all is unsatisfied. Not
 *     skipped, not assumed — the absence of an answer is a `no`.
 *   * An answer for a key that is not one of the eleven is ignored rather than
 *     counted, so a typo cannot satisfy a condition by accident.
 *   * `open` is the conjunction of all eleven and is computed here, not passed
 *     in. There is no argument to this function that opens the gate directly.
 */
export function composeLiveModeGate(
  answers: readonly ConditionState[],
): LiveModeGateState {
  const byKey = new Map(answers.map((a) => [a.key, a]));

  const conditions: ConditionState[] = LIVE_MODE_CONDITIONS.map((condition) => {
    const answer = byKey.get(condition.key);
    if (!answer) {
      return {
        key: condition.key,
        satisfied: false,
        detail:
          'No answer was produced for this condition. An unanswered condition is unsatisfied — §34 is released by satisfying it, never by failing to ask.',
      };
    }
    return { key: condition.key, satisfied: answer.satisfied, detail: answer.detail };
  });

  const blockingKeys = conditions.filter((c) => !c.satisfied).map((c) => c.key);

  return {
    open: blockingKeys.length === 0,
    blockingKeys,
    conditions,
  };
}

/**
 * The one sentence a refused live money operation carries.
 *
 * Frozen, and identical for every operation and every caller. §34 blocks a
 * category of action rather than a particular request, so a refusal that
 * varied by call site would invite somebody to find the call site that phrases
 * it most softly.
 */
export const LIVE_MODE_BLOCKED_MESSAGE =
  'Live mode is not enabled. The §34 readiness gate is closed, so no live card data, payment, transfer, or payout can be created. Test-mode engineering, onboarding, drafting, review, and recruitment continue as normal.';

/**
 * The refusal for a campaign that is not the enabled pilot.
 *
 * A different sentence from the one above, because it is a different fact: the
 * gate is open and this campaign is simply not the one. Collapsing the two
 * would tell an operator the gate was shut when it was not.
 */
export const NOT_THE_PILOT_MESSAGE =
  'Live mode is enabled for one named pilot campaign only (§6, §2.2). This campaign is not that pilot, so no live money can move for it.';

/** After a rollback. Distinct again: enablement existed and was withdrawn. */
export const PILOT_ROLLED_BACK_MESSAGE =
  'The pilot enablement was rolled back. Live money is stopped for this campaign until a new enablement is recorded.';
