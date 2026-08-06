/**
 * The P0 pass, second half — Spec §33.12, §21, §23, §26.6, §29.6 (Phase 23b).
 *
 * 23a's register answers "what does a person see"; this one answers "what does
 * the system do under replay, under a clock, and under a stale session". Both
 * are §32.1 step 17: nothing new is built, and everything already built is
 * verified end to end.
 *
 * Same arrangement, same reason. §33.12 is seven sentences of prose about
 * everything the product has stored across twenty-two phases — "independently
 * anchor every deadline", "remain separate and independently auditable", "every
 * override preserves before/after". Read as prose those are a review. Read as
 * registers they are a count: a deadline column added without an anchor entry
 * fails the suite, and a sensitive route added without a freshness entry fails
 * it too.
 *
 * Nothing here is a new product rule. Every entry cites the section it restates
 * and the column or table that already holds the fact.
 */

/* ── §33.12.1 the three anchors ────────────────────────────────────────────── */

/**
 * §21 gives the campaign three dedicated instants, and the invariant that has
 * ridden CLAUDE.md since Phase 01 is that they are never inferred:
 *
 *   "The three anchors — `listing_paid_at`, `campaign_live_at`,
 *    `campaign_close_at` — are dedicated columns. Never infer them from
 *    `created_at`/`updated_at`."
 *
 * §33.12.1 asks for the other half — that each one drives its own deadlines and
 * only its own. A product where two anchors happen to hold the same value on
 * the seed data passes every assertion by accident; the suite moves one anchor
 * and asserts the other two anchors' deadlines did not move.
 */
export const CAMPAIGN_ANCHORS = {
  listing_paid_at: {
    specRef: '§13, §21',
    column: 'campaigns.listing_paid_at',
    meaning: 'The listing fee was successfully paid, and the two §14 tracks opened.',
  },
  campaign_live_at: {
    specRef: '§17, §21',
    column: 'campaigns.campaign_live_at',
    meaning: 'The public page went live and tracking links activated, in that order.',
  },
  campaign_close_at: {
    specRef: '§21',
    column: 'campaigns.campaign_close_at',
    meaning: 'Pre-orders stopped and the close batch became due.',
  },
} as const;

export type CampaignAnchor = keyof typeof CAMPAIGN_ANCHORS;

export const CAMPAIGN_ANCHOR_KEYS = Object.keys(CAMPAIGN_ANCHORS) as CampaignAnchor[];

/**
 * The columns a campaign deadline may never be computed from.
 *
 * Qualified with the table on purpose. `created_at` and `updated_at` are on
 * nearly every table and are close enough to the real anchor on seed data to
 * look correct, which is exactly why the invariant names them — but the
 * invariant names the CAMPAIGN's three, not a coding style. A support case's
 * `created_at` IS its opening instant, and §29.10's escalation window measures
 * from it correctly; a rule that flagged that would have to be silenced, and a
 * silenced check is worse than none.
 *
 * `campaigns.updated_at` is the dangerous one: it moves on an edit that has
 * nothing to do with the promise, so a deadline derived from it silently
 * resets, which is §29.6's prohibition arriving through a different door.
 */
export const FORBIDDEN_ANCHOR_COLUMNS = ['campaigns.created_at', 'campaigns.updated_at'] as const;

/** Where the offset that produces a deadline comes from. */
export type OffsetSource =
  /** A §6 setting an operator may change; the value in force is stored on the row. */
  | 'setting'
  /** A number the Spec itself states, pinned as a constant (§1 rule 6 forbids inventing one). */
  | 'pinned'
  /** Business days on the committed versioned calendar, stored with its version (§29.6). */
  | 'calendar'
  /** An Admin's recorded choice, stored with who set it (§16). */
  | 'admin';

export interface AnchoredDeadline {
  key: string;
  specRef: string;
  /** The stored column that holds the computed instant. */
  storedOn: string;
  /**
   * The recorded instant the deadline is measured from.
   *
   * One of the three campaign anchors, or — for deadlines whose promise starts
   * at some *other* recorded event — the column holding that event. Naming both
   * kinds in one register is what makes "every deadline" checkable: a list of
   * only the campaign-anchored ones would look complete while the support SLA,
   * the dispute task, and the §29.6 replacement window sat outside it.
   */
  anchor: CampaignAnchor | string;
  offsetSource: OffsetSource;
  /** What supplies the offset — a setting key, a constant name, or who chose it. */
  offset: string;
  /**
   * Whether the stored instant is refused a later edit at the database level.
   *
   * §29.6's rule generalised: a retry or an edit must never silently move a
   * deadline that has already been computed and promised. Where this is `true`
   * a trigger or CHECK refuses the move, and the suite proves it with an UPDATE
   * rather than by reading the code that avoids one.
   */
  immutable: boolean;
}

/**
 * Every deadline the product computes, and what it is measured from.
 *
 * The three campaign anchors first, then the deadlines anchored on their own
 * recorded event. §33.12.1's word is "independently": each entry names one
 * instant, and no entry names two.
 */
export const ANCHORED_DEADLINES = [
  /* ── listing_paid_at ──────────────────────────────────────────────────── */
  {
    key: 'affiliate_response_deadline',
    specRef: '§14.6',
    storedOn: 'listing_fee_payments.response_deadline_at',
    anchor: 'listing_paid_at',
    offsetSource: 'setting',
    offset: 'affiliate_response_window_hours',
    immutable: true,
  },
  {
    key: 'founder_free_cancellation_deadline',
    specRef: '§31.6',
    storedOn: 'listing_fee_payments.free_cancellation_deadline_at',
    anchor: 'listing_paid_at',
    offsetSource: 'setting',
    offset: 'founder_free_cancellation_window_hours',
    immutable: true,
  },

  /* ── campaign_live_at ─────────────────────────────────────────────────── */
  {
    key: 'discovery_open',
    specRef: '§18',
    storedOn: 'campaigns.discovery_opened_at',
    anchor: 'campaign_live_at',
    offsetSource: 'pinned',
    offset: 'DISCOVERY_KNOWN_LINK_ONLY_DAYS',
    immutable: true,
  },

  /* ── campaign_close_at ────────────────────────────────────────────────── */
  {
    key: 'founder_payment_due',
    specRef: '§22.3',
    storedOn: 'founder_payments.due_at',
    anchor: 'campaign_close_at',
    offsetSource: 'setting',
    offset: 'idea_single_payment_day / product_first_payment_day / product_remaining_payment_day',
    immutable: true,
  },
  {
    key: 'day_14_decision_due',
    specRef: '§22.4',
    storedOn: 'day_14_evidence_submissions.decision_due_at',
    anchor: 'campaign_close_at',
    offsetSource: 'pinned',
    offset: 'DAY_14_REVIEW_DAYS',
    immutable: false,
  },
  {
    key: 'close_confirmation_due',
    specRef: '§22.5',
    storedOn: 'derived on read from campaigns.campaign_close_at',
    anchor: 'campaign_close_at',
    offsetSource: 'pinned',
    offset: 'CLOSE_CONFIRMATION_HOURS',
    immutable: false,
  },
  {
    key: 'affiliate_transfer_earliest',
    specRef: '§22.1',
    storedOn: 'derived on read from campaigns.campaign_close_at',
    anchor: 'campaign_close_at',
    offsetSource: 'pinned',
    offset: 'TRANSFER_EARLIEST_DAY',
    immutable: false,
  },
  {
    key: 'founder_next_campaign_cooldown',
    specRef: '§22.10',
    storedOn: 'derived on read from campaigns.campaign_close_at',
    anchor: 'campaign_close_at',
    offsetSource: 'setting',
    offset: 'founder_cooldown_months',
    immutable: false,
  },

  /* ── Anchored on their own recorded event ─────────────────────────────── */
  {
    key: 'capture_retry_window',
    specRef: '§21',
    storedOn: 'campaign_close_batches.retry_deadline_at',
    anchor: 'campaign_close_batches.first_failure_at',
    offsetSource: 'setting',
    offset: 'capture_retry_window_hours',
    immutable: true,
  },
  {
    key: 'creator_replacement_deadline',
    specRef: '§29.6',
    storedOn: 'required_creator_failures.due_at',
    anchor: 'required_creator_failures.creator_failure_recorded_at',
    offsetSource: 'calendar',
    offset: 'creator_replacement_window_business_days',
    immutable: true,
  },
  {
    key: 'support_human_response',
    specRef: '§27.8',
    storedOn: 'support_cases.human_response_due_at',
    anchor: 'support_cases.created_at',
    offsetSource: 'calendar',
    offset: 'support_sla_business_days',
    immutable: true,
  },
  {
    key: 'support_founder_followup',
    specRef: '§27.8',
    storedOn: 'support_cases.founder_followup_due_at',
    anchor: 'support_cases.created_at',
    offsetSource: 'pinned',
    offset: 'FOUNDER_FOLLOWUP_HOURS',
    immutable: false,
  },
  {
    key: 'dispute_admin_task',
    specRef: '§24.11',
    storedOn: 'payment_disputes.task_due_at',
    anchor: 'payment_disputes.opened_at',
    offsetSource: 'pinned',
    offset: 'DISPUTE_TASK_HOURS',
    immutable: true,
  },
  {
    key: 'affiliate_appeal_deadline',
    specRef: '§29.3',
    storedOn: 'affiliate_enforcement_actions.appeal_due_at',
    anchor: 'affiliate_enforcement_actions.occurred_at',
    offsetSource: 'calendar',
    offset: 'APPEAL_WINDOW_BUSINESS_DAYS',
    immutable: true,
  },
  {
    key: 'delivery_change_review_due',
    specRef: '§22.6',
    storedOn: 'delivery_change_requests.review_due_at',
    anchor: 'delivery_change_requests.requested_at',
    offsetSource: 'calendar',
    offset: 'DELIVERY_CHANGE_REVIEW_BUSINESS_DAYS',
    immutable: false,
  },
  {
    key: 'first_post_correction_due',
    specRef: '§17',
    storedOn: 'creator_post_submissions.correction_due_at',
    anchor: 'creator_post_submissions.submitted_at',
    offsetSource: 'calendar',
    offset: 'POST_CORRECTION_BUSINESS_DAYS',
    immutable: false,
  },
  {
    key: 'creator_payment_funding_deadline',
    specRef: '§16',
    storedOn: 'creator_payment_allocations.funding_deadline_at',
    anchor: 'creator_payment_allocations.funding_deadline_set_at',
    offsetSource: 'admin',
    offset: 'creator_payment_allocations.funding_deadline_set_by',
    immutable: false,
  },
  {
    key: 'precharge_reminder',
    specRef: '§19',
    storedOn: 'derived on read from campaigns.campaign_close_at',
    anchor: 'campaign_close_at',
    offsetSource: 'setting',
    offset: 'precharge_reminder_lead_hours',
    immutable: false,
  },
] as const satisfies readonly AnchoredDeadline[];

export type AnchoredDeadlineKey = (typeof ANCHORED_DEADLINES)[number]['key'];

/** The deadlines a given campaign anchor drives — §33.12.1's "independently". */
export function deadlinesAnchoredOn(anchor: CampaignAnchor): readonly AnchoredDeadline[] {
  return ANCHORED_DEADLINES.filter((deadline) => deadline.anchor === anchor);
}

/**
 * §33.12.2 restated where the suite can walk it.
 *
 * "Replacement deadline is exact, calendar-versioned, and cannot silently
 * reset." Three separate claims, and the third is the one a service can quietly
 * lose — so it is a database guarantee and the suite proves it with an UPDATE.
 */
export const REPLACEMENT_DEADLINE_CONTRACT = {
  specRef: '§29.6, §33.12.2',
  storedOn: 'required_creator_failures.due_at',
  versionStoredOn: 'required_creator_failures.due_calendar_version',
  anchor: 'required_creator_failures.creator_failure_recorded_at',
  /** Not "three days" — business days, on the committed calendar (§29.6). */
  offsetSetting: 'creator_replacement_window_business_days',
  /** One row per campaign, so recording the failure twice cannot recompute it. */
  onePerCampaign: true,
  /** A trigger refuses the move; the service never attempts one. */
  immutableByTrigger: true,
} as const;

/* ── §33.12.3 lifecycle and payment flags ─────────────────────────────────── */

/**
 * The invariant §33.12.3 actually states, and the one this register got wrong
 * on its first pass.
 *
 * The tempting rule is "no payment word in a lifecycle value", and it is false:
 * §23.1's own committed states include `captured_pending_w9`,
 * `single_payment_released`, `first_payment_released`,
 * `remaining_payment_released`, and `refunded_no_creator`. Those are positions
 * in a campaign's life — a campaign that has released its first payment is
 * somewhere different from one that has not — and inventing a prohibition the
 * Spec does not state would have meant renaming five of the Spec's own states
 * to satisfy a register (§1 rule 6).
 *
 * What §23.1 and §23.3 actually separate is the *fact* from the *position*: a
 * payment FLAG carries a timestamp, an amount, an actor, evidence, and provider
 * IDs, and none of those may live on `campaigns`. So the checkable rule is
 * membership — no `campaign_payment_flags.flag` value is also a
 * `campaign_status` value — plus the five columns' absence from `campaigns`.
 */
export const PAYMENT_FLAG_FACTS = [
  'set_at',
  'amount_cents',
  'actor',
  'evidence',
  'provider_object_ids',
] as const;

/**
 * Columns that would mean a payment fact had migrated onto the lifecycle row.
 * Their absence from `campaigns` is what makes the two independently auditable
 * rather than one table and a convention.
 */
export const PAYMENT_COLUMNS_FORBIDDEN_ON_CAMPAIGNS = [
  'flag',
  'payment_flag',
  'payment_status',
  'amount_cents',
  'evidence',
  'provider_object_ids',
] as const;

/**
 * §33.12.3's membership rule: a value may be a lifecycle position OR a payment
 * flag, never both. An overlap would mean two tables answering the same
 * question, which is the one thing "independently auditable" cannot survive.
 */
export function lifecycleFlagOverlap(
  lifecycleValues: readonly string[],
  flagValues: readonly string[],
): string[] {
  const flags = new Set(flagValues);
  return lifecycleValues
    .filter((value) => flags.has(value))
    .map((value) => `"${value}" is both a campaign lifecycle state and a payment flag (§23.1, §23.3)`);
}

/**
 * Both sides of §33.12.3's "independently auditable".
 *
 * A lifecycle move writes a `campaign_status_history` row; a payment fact
 * writes a `campaign_payment_flags` row. Neither is derived from the other, and
 * neither can be reconstructed from the other — which is what makes them two
 * records rather than one record and a view of it.
 */
export const STATE_AUDIT_TRAILS = {
  lifecycle: {
    specRef: '§23.1',
    valueColumn: 'campaigns.status',
    historyTable: 'campaign_status_history',
    appendOnly: true,
  },
  paymentFlags: {
    specRef: '§23.3',
    valueColumn: 'campaign_payment_flags.flag',
    historyTable: 'campaign_payment_flags',
    appendOnly: true,
  },
} as const;

/* ── §33.12.5 MFA and the freshness gate ──────────────────────────────────── */

/**
 * What "sensitive" means, as a property rather than a list of routes.
 *
 * §26.6 requires reauthentication for high-impact money actions and §33.12.5
 * requires a sensitive action without recent reauthentication to fail *safely*
 * — which means refusing, not warning and proceeding. A route list would go
 * stale the first time one was added; these are the properties that make a
 * route sensitive, and the suite derives the list from the mounted router.
 */
export const SENSITIVE_ACTION_PROPERTIES = [
  {
    key: 'moves_money',
    specRef: '§26.6',
    definition: 'Creates, releases, refunds, transfers, or returns money.',
  },
  {
    key: 'overrides_a_record',
    specRef: '§26.2, §33.12.4',
    definition: 'Replaces an auto-populated value with an Admin-supplied one.',
  },
  {
    key: 'changes_operating_configuration',
    specRef: '§6',
    definition: 'Writes a §6 setting or a production prerequisite.',
  },
  {
    key: 'enforces_against_a_person',
    specRef: '§26.7, §29',
    definition: 'Suspends, kills, bans, disqualifies, or terminates.',
  },
  {
    key: 'decides_a_customer_outcome',
    specRef: '§15, §22, §24',
    definition: 'Approves, rejects, classifies, or closes a customer-facing case.',
  },
] as const;

/**
 * The four ways a guard fails *un*safely.
 *
 * Every one of them is a real thing guards do: log and continue, treat an
 * unreadable session as absent-but-harmless, treat a database error as "no
 * reason to block", or answer differently depending on which failure occurred.
 * §33.12.5 is satisfied by refusing all four, so they are named rather than
 * left as a general intention.
 */
/**
 * The Admin write routes that deliberately do NOT take the freshness gate.
 *
 * This is `unsent.ts`'s arrangement applied to authorization: the mounted
 * router is walked, and every write under `/api/admin` is either gated or
 * recorded here with a reason. The two partition the set exactly, so a new
 * route fails the suite until somebody decides which side it belongs on — which
 * is the whole value, because the failure mode is a sensitive route shipping
 * ungated and nobody noticing.
 *
 * The alternative arrangement — "every admin write requires reauthentication" —
 * was tried first and is wrong. `admin.ts` has recorded the reason since Phase
 * 06a: making an Admin reauthenticate for ordinary work teaches them to
 * reauthenticate reflexively, and a gate people clear without thinking is not a
 * gate. Composing an invitation, opening a support case, and re-running a
 * derivation are ordinary work.
 *
 * Each entry names the property from `SENSITIVE_ACTION_PROPERTIES` it does NOT
 * have, because "it felt routine" is how a money route ends up on this list.
 */
export const UNGATED_ADMIN_WRITES = [
  {
    route: 'POST /api/admin/founders',
    specRef: '§7',
    reason:
      'Creates a prospect record. Moves no money, changes no configuration, and enforces against nobody — the invitation it leads to is composed and sent under its own gates.',
  },
  {
    route: 'PUT /api/admin/founders/:draftId/vetting-prefill',
    specRef: '§9',
    reason:
      'Supplies Proovd’s half of two vetting fields, all of it provenance-tracked and Founder-editable. Competition cannot be prefilled by any route.',
  },
  {
    route: 'PUT /api/admin/founders/:draftId/invitation',
    specRef: '§7',
    reason:
      'Composes a draft invitation. The send is a separate act, and the §7 preview gate re-decides server-side whatever this wrote.',
  },
  {
    route: 'POST /api/admin/affiliates',
    specRef: '§8',
    reason: 'Creates a Creator prospect and its association. No money, no standing, no configuration.',
  },
  {
    route: 'PATCH /api/admin/affiliates/:associationId/prospect',
    specRef: '§8, §5.3',
    reason:
      'Records verification evidence and recruitment facts. §8 makes the quality tier assessment data explicitly, not a commission floor.',
  },
  {
    route: 'PATCH /api/admin/affiliates/:associationId/invitation',
    specRef: '§8',
    reason: 'Composes, sends, or revokes a private invitation. Revocation kills a link, not a person’s standing.',
  },
  {
    route: 'POST /api/admin/campaigns/:campaignId/workspace/recheck',
    specRef: '§12',
    reason:
      'Re-runs the §12 derivation over content that already exists. It cannot grant a completion — an Admin override is a different route, and that one is gated.',
  },
  {
    route: 'POST /api/admin/support/cases',
    specRef: '§26.7',
    reason: 'Opens a case. §27.8’s clock starting is the point; nothing is decided.',
  },
  {
    route: 'POST /api/admin/support/cases/:caseId/messages',
    specRef: '§26.8',
    reason:
      'Records a note or a reply. §26.8 makes every template a draft a person edits, and there is no one-click send anywhere.',
  },
  {
    route: 'POST /api/admin/support/cases/:caseId/transfer',
    specRef: '§26.8',
    reason:
      'Hands a case to another owner behind the four-field handoff gate. It changes who answers, not what was decided.',
  },
  {
    route: 'POST /api/admin/support/cases/:caseId/resolve',
    specRef: '§26.7',
    reason:
      'Closes a case. Reversible by opening another, and it moves no money and ends no partnership.',
  },
  {
    route: 'POST /api/admin/associations/:associationId/conflict-disclosures',
    specRef: '§29.1',
    reason:
      'Records a disclosure the Creator made, with both certifications. Phase 20b’s own decision: the §29.4 enforcement action and the appeal decision change standing and take the gate; recording what someone told us does not.',
  },
  {
    route: 'POST /api/admin/associations/:associationId/self-preorder-disclosures',
    specRef: '§29.2',
    reason:
      'Same. The consequence — an own-link reservation’s attribution moving to blocked — follows from the recorded fact rather than from an Admin’s discretion.',
  },
] as const;

export type UngatedAdminWrite = (typeof UNGATED_ADMIN_WRITES)[number];

export const UNSAFE_GUARD_FAILURES = [
  'warns_and_proceeds',
  'treats_unreadable_session_as_anonymous_but_allowed',
  'treats_database_error_as_permitted',
  'reveals_which_check_failed',
] as const;

/* ── Scope 4: the idempotency sweep ───────────────────────────────────────── */

/**
 * The three mechanisms, restated from the invariant they have had since Phase
 * 01. A path is idempotent because it uses one or more of these — never because
 * its author was careful.
 */
export type IdempotencyMechanism =
  /** `provider_events`, unique on the provider event id. Insert-or-skip first. */
  | 'provider_events'
  /** `idempotency_keys`, a stable domain key claimed before the work. */
  | 'idempotency_keys'
  /** `notification_deliveries`, unique on (event, target, entity). */
  | 'notification_deliveries'
  /** A unique index or partial unique index that makes a second row impossible. */
  | 'unique_row'
  /** An UPDATE conditional on the current state, so a stale caller matches nothing. */
  | 'conditional_update'
  /** A provider-side idempotency key, so a retry is the same object at Stripe. */
  | 'provider_idempotency_key';

export interface IdempotentPath {
  key: string;
  specRef: string;
  /** The service the sweep calls. */
  entryPoint: string;
  mechanisms: readonly IdempotencyMechanism[];
  /**
   * The stable key's shape, where one exists. `null` where the path is made
   * singular by a unique row or a conditional update instead.
   */
  stableKey: string | null;
  /** Whether the path reaches the provider, and therefore whether a replay could double-charge. */
  movesMoney: boolean;
}

/**
 * Every state-changing path the phase brief names, plus the ones it implies.
 *
 * The brief's list is "close batch, capture retry, listing Checkout completion,
 * fixed-payment funding, Transfer creation, refund submission, webhook delivery
 * for every handled event, notification send, draft claim, and campaign
 * activation". Each is one entry here with the mechanism that makes it
 * singular, so the sweep can assert the mechanism rather than the outcome —
 * the outcome can be right by luck, and a mechanism cannot.
 */
export const IDEMPOTENT_PATHS = [
  {
    key: 'close_batch',
    specRef: '§21, §33.7.7',
    entryPoint: 'close/close-batch.ts runCloseBatch',
    mechanisms: ['unique_row', 'conditional_update', 'idempotency_keys'],
    stableKey: 'reservation-capture:<reservationId>:1',
    movesMoney: true,
  },
  {
    key: 'capture_retry',
    specRef: '§21, §33.7.9',
    entryPoint: 'close/retry.ts updateCardAndRetry',
    mechanisms: ['unique_row', 'conditional_update', 'provider_idempotency_key'],
    stableKey: 'reservation-capture:<reservationId>:2',
    movesMoney: true,
  },
  {
    key: 'listing_checkout_completion',
    specRef: '§13, §33.3.6',
    entryPoint: 'payments/listing-checkout.ts applyListingPayment',
    mechanisms: ['provider_events', 'idempotency_keys', 'unique_row'],
    stableKey: 'listing_fee_paid:<campaignId>',
    movesMoney: true,
  },
  {
    key: 'listing_refund',
    specRef: '§13, §31.6',
    entryPoint: 'payments/listing-refund.ts refundListingFee',
    mechanisms: ['unique_row', 'provider_idempotency_key'],
    stableKey: 'listing-refund:<paymentId>',
    movesMoney: true,
  },
  {
    key: 'fixed_payment_funding',
    specRef: '§16, §33.4.3',
    entryPoint: 'creator-payment/allocations.ts applyAllocationFunding',
    mechanisms: ['provider_events', 'idempotency_keys', 'unique_row'],
    stableKey: 'creator_payment_funded:<allocationId>',
    movesMoney: true,
  },
  {
    key: 'affiliate_transfer',
    specRef: '§22.1, §33.8.3',
    entryPoint: 'close/earnings.ts createAffiliateTransfer',
    mechanisms: ['unique_row', 'conditional_update', 'provider_idempotency_key'],
    stableKey: 'affiliate-transfer:<associationId>',
    movesMoney: true,
  },
  {
    key: 'reservation_refund',
    specRef: '§24.8, §33.9.2',
    entryPoint: 'refunds/service.ts executeRefund',
    mechanisms: ['unique_row', 'conditional_update', 'provider_idempotency_key'],
    stableKey: 'reservation-refund:<allocationId>',
    movesMoney: true,
  },
  {
    key: 'webhook_delivery',
    specRef: '§32.3, §33.12',
    entryPoint: 'routes/stripe-webhooks.ts',
    mechanisms: ['provider_events'],
    stableKey: null,
    movesMoney: true,
  },
  {
    key: 'notification_send',
    specRef: '§27.2',
    entryPoint: 'notifications/send.ts createNotifier',
    mechanisms: ['notification_deliveries'],
    stableKey: '<event>:<target>:<entity>',
    movesMoney: false,
  },
  {
    key: 'draft_claim',
    specRef: '§10, §33.1.2',
    entryPoint: 'vetting/service.ts completeClaim',
    mechanisms: ['idempotency_keys', 'conditional_update'],
    stableKey: 'founder_signup_complete:<campaignId>',
    movesMoney: false,
  },
  {
    key: 'campaign_launch',
    specRef: '§17, §33.4.6',
    entryPoint: 'launch/launch.ts launchCampaign',
    mechanisms: ['idempotency_keys', 'unique_row', 'conditional_update'],
    stableKey: 'campaign_launched:<campaignId>',
    movesMoney: false,
  },
  {
    key: 'preparing_reveal',
    specRef: '§10, §31.5',
    entryPoint: 'affiliates/preparing.ts revealPreparingCampaign',
    mechanisms: ['idempotency_keys', 'conditional_update', 'notification_deliveries'],
    stableKey: 'affiliate_preparing_revealed:<associationId>',
    movesMoney: false,
  },
] as const satisfies readonly IdempotentPath[];

export type IdempotentPathKey = (typeof IDEMPOTENT_PATHS)[number]['key'];

/**
 * The three adversarial cases, because replaying a webhook is not the whole of
 * it — the phase trap says so in as many words.
 *
 * `run_twice` catches a path that forgot its key. `deliver_twice` catches one
 * that keyed on the wrong entity. `crash_midway` catches the ordering mistake
 * neither of the others can see: a path that calls the provider and *then*
 * records the claim is idempotent on every happy path and doubles a charge the
 * one time the process dies in between.
 */
export const ADVERSARIAL_CASES = ['run_twice', 'deliver_twice', 'crash_midway'] as const;

export type AdversarialCase = (typeof ADVERSARIAL_CASES)[number];

/**
 * What must be true after any adversarial case, in §33.12's own terms: "one
 * domain change, one money movement, one message, every time."
 */
export const IDEMPOTENCY_INVARIANT = [
  'one domain change',
  'one money movement',
  'one message',
] as const;

/* ── Scope 6: §32.7's direct-model claims ─────────────────────────────────── */

/**
 * The five things the direct test proves, as a register the suite walks.
 *
 * §32.7 writes them as five bullets, and the fifth — "post-close verified
 * Affiliate Transfer occurs once" — is the one that would otherwise be assumed
 * from §33.8.3 having passed in another file. Proving them together, over one
 * campaign, is what makes it an architecture test rather than five unit tests.
 */
export const DIRECT_ARCHITECTURE_CLAIMS = [
  {
    key: 'account_context',
    specRef: '§32.7, §24.1',
    claim: 'SetupIntent and PaymentIntent are created in the Founder account context.',
  },
  {
    key: 'founder_is_mor',
    specRef: '§32.7, §24.2',
    claim: 'The Founder remains merchant of record in domain records and disclosures.',
  },
  {
    key: 'amounts_reconcile',
    specRef: '§32.7, §24.3, §24.4',
    claim:
      'The charge is exactly subtotal + tax, and the separate 5% and provisional Creator amounts reconcile against the pre-tax subtotal.',
  },
  {
    key: 'failure_enters_retry',
    specRef: '§32.7, §21',
    claim: 'A capture failure enters the retry window and success updates every role surface.',
  },
  {
    key: 'one_transfer',
    specRef: '§32.7, §22.1',
    claim: 'The post-close verified Affiliate Transfer occurs exactly once.',
  },
] as const;

/**
 * §24.1's other half: the backup separate-charge path is not built, and
 * §32.7 asks for confirmation that nothing can run both models for one
 * transaction.
 *
 * The confirmation is an absence, so it is stated as the symbols that must not
 * exist rather than as a behaviour to exercise. `on_behalf_of` and
 * `transfer_group` are the two Stripe parameters the separate-charge model
 * needs and the direct model never sends; `application_fee_amount` is the third
 * — permitted by §24.1 "where supported" and not enabled in the approved
 * configuration, so its absence is a fact about today's build rather than a
 * prohibition, and the register says which is which.
 */
export const BACKUP_MODE_ABSENCE = {
  specRef: '§24.1, §32.7',
  flag: 'STRIPE_TEST_BACKUP_MODE_ENABLED',
  /** Symbols whose presence would mean the second model exists. */
  forbiddenSymbols: ['on_behalf_of', 'transfer_group', 'onBehalfOf', 'transferGroup'] as const,
  /**
   * Not forbidden — not built. §24.1 permits the platform fee "where
   * supported"; the approved configuration does not collect it, which is why
   * 19a's unearned return has no provider leg. Recorded so a later phase
   * enabling it reads this rather than the absence above.
   */
  notBuiltButPermitted: ['application_fee_amount'] as const,
} as const;
