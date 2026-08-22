/**
 * The live-mode gate's facts, restated for the runtime — Spec §34 (Phase 24).
 *
 * `@proovd/shared` exports TypeScript source, the backend compiles under
 * `rootDir: src`, and the production image ships only `backend/dist`. So the
 * eleven condition keys, their verification kinds, the gateway partition, and
 * the frozen refusal sentences live here as well as there, and
 * `src/tests/live-mode.test.ts` fails the suite if the two ever disagree.
 *
 * This is the same arrangement as the state enums in `db/schema/domain.ts`,
 * the required policy slugs in `policies/policy-gate.ts`, and the §33.12
 * registers in `qa/`. It is not a second source of truth — it is the same
 * truth, twice, with a test in between.
 *
 * What is deliberately NOT restated is the prose: the requirement sentences,
 * the `cannotBeAutomatedBecause` reasons, and the Appendix C claims. Those are
 * presentation, the Admin surface imports the register directly through Vite,
 * and copying paragraphs into a second file is how two versions of one
 * sentence begin disagreeing.
 */

export type ConditionVerification = 'automatic' | 'suite' | 'recorded';

/** §34's eleven, in §34's order, with how each is decided. */
export const CONDITION_VERIFICATION: Readonly<Record<string, ConditionVerification>> = {
  payment_architecture: 'recorded',
  transfer_capability: 'recorded',
  tax_configuration: 'recorded',
  policies_published: 'automatic',
  key_separation: 'automatic',
  test_cards_and_idempotency: 'suite',
  samples_collect_nothing: 'suite',
  admin_security: 'suite',
  p0_pass: 'suite',
  human_reconciliation: 'recorded',
  pilot_owners: 'recorded',
} as const;

export const CONDITION_KEYS: readonly string[] = Object.keys(CONDITION_VERIFICATION);

export const AUTOMATIC_CONDITION_KEYS: readonly string[] = CONDITION_KEYS.filter(
  (k) => CONDITION_VERIFICATION[k] === 'automatic',
);

/** The nine the 0038 CHECK admits into `live_mode_condition_verifications`. */
export const RECORDABLE_CONDITION_KEYS: readonly string[] = CONDITION_KEYS.filter(
  (k) => CONDITION_VERIFICATION[k] !== 'automatic',
);

/* ── The gateway partition (§34's two lists) ───────────────────────────────── */

export type GatewayDisposition = 'blocked_while_closed' | 'permitted_while_closed';

/**
 * Every method on the Stripe port, and whether it may run in live mode while
 * the gate is closed.
 *
 * The decorator is built by walking this map rather than by listing method
 * names in code, and it REFUSES TO CONSTRUCT if the gateway carries a callable
 * member this map does not mention. That is the property that makes it
 * un-forgettable: a phase adding a gateway method and not deciding its
 * disposition cannot boot the application, rather than silently shipping an
 * ungated money path.
 */
export const GATEWAY_DISPOSITION: Readonly<Record<string, GatewayDisposition>> = {
  createCustomer: 'blocked_while_closed',
  confirmSetupIntent: 'blocked_while_closed',
  createOffSessionPaymentIntent: 'blocked_while_closed',
  createListingCheckoutSession: 'blocked_while_closed',
  createFundingCheckoutSession: 'blocked_while_closed',
  createTransfer: 'blocked_while_closed',

  // Not blocked, and deliberately not added to §34's list. A refund and a
  // detach UNWIND exposure rather than create it, and both are only reachable
  // from a live charge or a live saved card that already exists — exactly the
  // state a rollback leaves behind. A closed gate must not strand the people
  // §34's rollback plan is written for.
  createRefund: 'permitted_while_closed',
  detachPaymentMethod: 'permitted_while_closed',

  createConnectedAccount: 'permitted_while_closed',
  createAccountLink: 'permitted_while_closed',
  retrieveAccount: 'permitted_while_closed',
  retrieveCheckoutSession: 'permitted_while_closed',
  createTaxCalculation: 'permitted_while_closed',
  verifyEvent: 'permitted_while_closed',
  hasSecretFor: 'permitted_while_closed',
} as const;

export const GATEWAY_METHODS: readonly string[] = Object.keys(GATEWAY_DISPOSITION);

export const BLOCKED_GATEWAY_METHODS: readonly string[] = GATEWAY_METHODS.filter(
  (m) => GATEWAY_DISPOSITION[m] === 'blocked_while_closed',
);

/* ── The pilot ─────────────────────────────────────────────────────────────── */

export const PILOT_OWNER_ROLES = ['monitoring', 'rollback'] as const;
export type PilotOwnerRole = (typeof PILOT_OWNER_ROLES)[number];

export const PILOT_PREFLIGHT_KEYS: readonly string[] = [
  'descriptor_on_statement',
  'live_webhook_delivery',
  'monitoring_owner_sees_risk',
];

export const APPENDIX_C_ACTORS: readonly string[] = ['admin', 'founder', 'creator', 'backer'];

/**
 * Appendix C's forty-nine steps as `<actor>:<step>` keys.
 *
 * The KEYS only. Appendix C's claims, constraints, and surface addresses are
 * prose the Admin surface imports from the shared register directly through
 * Vite; copying paragraphs here would be a second version of one sentence.
 * The keys are identifiers the coverage read needs at runtime, and the suite
 * compares this list against the shared register.
 */
export const APPENDIX_C_STEP_KEYS: readonly string[] = [
  'admin:configure',
  'admin:invite_founder',
  'admin:recruit_creators',
  'admin:support_claims',
  'admin:response_window',
  'admin:proposals_readiness',
  'admin:review_version',
  'admin:reacceptance',
  'admin:funding_readiness',
  'admin:launch_order',
  'admin:monitor',
  'admin:close_retry',
  'admin:reconcile',
  'admin:post_close_ops',
  'founder:invitation',
  'founder:vetting',
  'founder:possible_creators',
  'founder:claim',
  'founder:materials',
  'founder:onboarding',
  'founder:listing_payment',
  'founder:build',
  'founder:roster_terms',
  'founder:review',
  'founder:launch',
  'founder:live_monitoring',
  'founder:results',
  'founder:payment',
  'founder:fulfillment',
  'founder:future_readiness',
  'creator:invitation',
  'creator:signup_payout',
  'creator:waiting',
  'creator:kit',
  'creator:decision',
  'creator:locked_terms',
  'creator:readiness',
  'creator:link_activation',
  'creator:promotion',
  'creator:earnings',
  'creator:completion_transfer',
  'creator:future_work',
  'backer:understand_before',
  'backer:proof_no_charge',
  'backer:cancel',
  'backer:recover',
  'backer:recognise_charge',
  'backer:reward_or_help',
  'backer:retained_access',
];


/* ── The frozen refusals ───────────────────────────────────────────────────── */

export const LIVE_MODE_BLOCKED_MESSAGE =
  'Live mode is not enabled. The §34 readiness gate is closed, so no live card data, payment, transfer, or payout can be created. Test-mode engineering, onboarding, drafting, review, and recruitment continue as normal.';

export const NOT_THE_PILOT_MESSAGE =
  'Live mode is enabled for one named pilot campaign only (§6, §2.2). This campaign is not that pilot, so no live money can move for it.';

export const PILOT_ROLLED_BACK_MESSAGE =
  'The pilot enablement was rolled back. Live money is stopped for this campaign until a new enablement is recorded.';
