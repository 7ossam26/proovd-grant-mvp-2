/**
 * The notification event keys the backend uses at runtime.
 *
 * `shared/src/notifications/registry.ts` is the register — all ~120 keys of
 * §27.3–§27.6, with the audience and the §27 bullet each came from. The backend
 * cannot import it at runtime: `@proovd/shared` exports TypeScript source, the
 * backend compiles under `rootDir: src`, and the production image ships only
 * `backend/dist`. This is the same constraint `db/schema/domain.ts` documents
 * for the state enums and `policies/policy-gate.ts` for the required policy
 * slugs, and the answer is the same one — restate what is needed here, and let
 * a drift test fail the suite if the two ever disagree.
 *
 * What is restated is only the keys phases up to this one actually send. A
 * template arrives with the phase that owns it, so a key appears here when
 * something starts sending it, not before: a key with no sender is a claim that
 * a message exists when it does not (§1.4).
 *
 * `src/tests/founder-invitation.test.ts` asserts every key below exists in the
 * shared register.
 */

/** §27.3 — "Personalized invitation". Sent by `invitations/service.ts`. */
export const FOUNDER_INVITATION = 'founder_invitation' as const;

/**
 * §27.4 — "Campaign-specific invitation". Sent by `affiliates/invitation.ts`.
 *
 * The only Affiliate key Phase 08a sends. `affiliate_signup_confirmed` and
 * `affiliate_founder_signup_completed` are Phase 08b's and 08c's; adding them
 * here before a sender exists would claim a message the product does not send.
 */
export const AFFILIATE_CAMPAIGN_INVITATION = 'affiliate_campaign_invitation' as const;

/**
 * §27.4 — "Signup confirmed / waiting state". Sent by
 * `affiliates/signup-notification.ts` once the claim transaction commits.
 *
 * `affiliate_founder_signup_completed` is still absent: that is the §10 handoff
 * Phase 08c builds, and a key with no sender claims a message the product does
 * not send (§1.4).
 */
export const AFFILIATE_SIGNUP_CONFIRMED = 'affiliate_signup_confirmed' as const;

/**
 * §27.4 — "Founder signup completed / preparing campaign available". Sent by
 * `affiliates/handoff.ts` when §10's reveal moves an association to
 * `preparing`.
 *
 * §10 fixes its shape: "A transactional notification has one action: `Review
 * campaign`." One action, and the template has exactly one link.
 */
export const AFFILIATE_FOUNDER_SIGNUP_COMPLETED = 'affiliate_founder_signup_completed' as const;

/**
 * §27.3's four interview events, sent by `interviews/notifications.ts`.
 *
 * §12: "Send confirmation, reminder, reschedule, and cancellation
 * notifications." They arrive together in Phase 09b because that is the phase
 * that gained a sender for them — Phase 09a built the booking record and
 * deliberately left these keys out, since a key with no sender claims a message
 * the product does not send (§1.4).
 */
export const FOUNDER_INTERVIEW_CONFIRMED = 'founder_interview_confirmed' as const;
export const FOUNDER_INTERVIEW_REMINDER = 'founder_interview_reminder' as const;
export const FOUNDER_INTERVIEW_RESCHEDULED = 'founder_interview_rescheduled' as const;
export const FOUNDER_INTERVIEW_CANCELED = 'founder_interview_canceled' as const;

/**
 * Phase 11's four, sent by `payments/listing-notifications.ts`.
 *
 * §27.3 — "Listing-fee receipt" and "Listing-fee refund"; §27.4 — "Formal
 * opportunity available"; §27.6 — "Listing paid / deadline started". They
 * arrive together because §13's effect 7 is the sender for the first three and
 * the internal one rides the same commit.
 */
export const FOUNDER_LISTING_FEE_RECEIPT = 'founder_listing_fee_receipt' as const;
export const FOUNDER_LISTING_FEE_REFUND = 'founder_listing_fee_refund' as const;
export const AFFILIATE_FORMAL_OPPORTUNITY_AVAILABLE =
  'affiliate_formal_opportunity_available' as const;
export const INTERNAL_LISTING_PAID_DEADLINE_STARTED =
  'internal_listing_paid_deadline_started' as const;

/**
 * Phase 12a's eight, sent by `affiliates/decision-notifications.ts`.
 *
 * §27.3 — "Creator proposal received", "Creator proposal revision activity",
 * "Creator decision on a proposal version"; §27.4 — "Proposal version
 * submitted", "Founder revision received", "Founder decision on a proposal
 * version", "Proposal deadline expiry", "Acceptance confirmation", "Decline
 * confirmation". They arrive together because §14.2's three decisions and the
 * §14.6 expiry are this phase's senders.
 */
export const AFFILIATE_ACCEPT_CONFIRMATION = 'affiliate_accept_confirmation' as const;
export const AFFILIATE_DECLINE_CONFIRMATION = 'affiliate_decline_confirmation' as const;
export const AFFILIATE_PROPOSAL_SUBMITTED = 'affiliate_proposal_submitted' as const;
export const AFFILIATE_FOUNDER_REVISION = 'affiliate_founder_revision' as const;
export const AFFILIATE_FOUNDER_DECISION = 'affiliate_founder_decision' as const;
export const AFFILIATE_PROPOSAL_EXPIRED = 'affiliate_proposal_expired' as const;
export const FOUNDER_CREATOR_PROPOSAL_RECEIVED = 'founder_creator_proposal_received' as const;
export const FOUNDER_CREATOR_PROPOSAL_REVISION = 'founder_creator_proposal_revision' as const;
export const FOUNDER_CREATOR_PROPOSAL_DECISION = 'founder_creator_proposal_decision' as const;

/**
 * Phase 14a's five, sent by `launch/notifications.ts`.
 *
 * §27.3 — "Campaign live" (Founder); §27.4 — "Campaign live" (Creator),
 * "First-post verification pass", "First-post correction required",
 * "First-post rejected". They arrive together because §17's launch and its
 * first-post verification are this phase's senders. The §29.6 refund reuses
 * Phase 11's `founder_listing_fee_refund` — one refund message, one key.
 */
export const FOUNDER_CAMPAIGN_LIVE = 'founder_campaign_live' as const;
export const AFFILIATE_CAMPAIGN_LIVE = 'affiliate_campaign_live' as const;
export const AFFILIATE_FIRST_POST_PASS = 'affiliate_first_post_pass' as const;
export const AFFILIATE_FIRST_POST_CORRECTION = 'affiliate_first_post_correction' as const;
export const AFFILIATE_FIRST_POST_REJECT = 'affiliate_first_post_reject' as const;

/**
 * Phase 14b's one, sent by `campaign/discovery.ts`.
 *
 * §18 — the single factual notice a Founder receives when the Day 8 browse/index
 * switch opens, explaining what changed and how organic, house, and Creator
 * attribution differ. Deduped on the campaign: the switch happens once.
 */
export const FOUNDER_CAMPAIGN_DISCOVERY_OPENED = 'founder_campaign_discovery_opened' as const;

/**
 * Phase 15's first Backer event (§27.5), sent by `notifications/backer.ts`.
 *
 * §27.5 — "Pre-order confirmation", carrying the magic link. It is the first
 * message a Backer ever receives and leads with `Pre-order saved — you were not
 * charged`, never anything implying a completed charge (§19, §30).
 * `backer_cancellation_confirmation` and `backer_precharge_reminder` are 15b's;
 * they appear here when their senders exist, since a key with no sender claims a
 * message the product does not send (§1.4).
 */
export const BACKER_PREORDER_CONFIRMATION = 'backer_preorder_confirmation' as const;

/**
 * Phase 15b's two Backer events (§27.5), sent by `notifications/backer.ts`.
 *
 * §27.5 — "Cancellation confirmation" (Appendix B.4, sent by
 * `reservations/cancellation.ts`) and "Pre-charge reminder" (Appendix B.3, sent
 * by the `precharge-reminder` sweep). Both lead with a not-charged statement and
 * dedup on the reservation.
 */
export const BACKER_CANCELLATION_CONFIRMATION = 'backer_cancellation_confirmation' as const;
export const BACKER_PRECHARGE_REMINDER = 'backer_precharge_reminder' as const;

/**
 * Phase 17a's four, sent by `live/notifications.ts`.
 *
 * §27.3 — "Idea threshold reached" and "Idea threshold lost" (Founder); §27.6 —
 * the two internal counterparts. They arrive together because §20's crossing
 * evaluation is the sender for all four, and each one dedups on the *crossing
 * row* rather than on the campaign: §20 says a campaign "may cross repeatedly,
 * and each crossing notifies once". Keying on the campaign would satisfy §27.2
 * and silently swallow the second crossing — §7's exact failure in another phase.
 *
 * There is no `founder_campaign_check_in` key here and there must not be:
 * §33.6.11 forbids a scheduled generic check-in, and a key with no consequence
 * behind it is how one gets written (§1.4).
 */
export const FOUNDER_IDEA_THRESHOLD_REACHED = 'founder_idea_threshold_reached' as const;
export const FOUNDER_IDEA_THRESHOLD_LOST = 'founder_idea_threshold_lost' as const;
export const INTERNAL_THRESHOLD_REACHED = 'internal_threshold_reached' as const;
export const INTERNAL_THRESHOLD_LOST = 'internal_threshold_lost' as const;

/**
 * Phase 18a's six, sent by `close/notifications.ts`.
 *
 * §27.3 — "Campaign ended" (separately from "Results ready", which arrived in
 * Phase 18b with its sender — the two stayed separate keys throughout, and
 * §33.7.11 is exactly about that). §27.5 — the threshold-miss/no-charge closure, the
 * charge receipt, the failed-charge/update-card recovery (Appendix B.5), and
 * the dropped notice (§21's tax-unusable drop; the retry-window-end drop is
 * 18b's second sender for the same key). §27.6 — the charge batch result.
 */
export const FOUNDER_CAMPAIGN_ENDED = 'founder_campaign_ended' as const;
export const BACKER_THRESHOLD_MISS_NO_CHARGE = 'backer_threshold_miss_no_charge' as const;
export const BACKER_CHARGE_RECEIPT = 'backer_charge_receipt' as const;
export const BACKER_CHARGE_FAILED_UPDATE_CARD = 'backer_charge_failed_update_card' as const;
export const BACKER_RETRY_DROPPED = 'backer_retry_dropped' as const;
export const INTERNAL_CHARGE_BATCH_RESULT = 'internal_charge_batch_result' as const;

/**
 * Phase 18b's four, sent by `close/notifications.ts`.
 *
 * §27.5 — "Retry success": the campaign-aware confirmation for a charge
 * recovered through the B.5 update-card path; the Backer whose close-batch
 * charge succeeded first time gets `backer_charge_receipt`, and a recovered
 * one gets THIS — §27.5 names "Charge receipt" and "Retry success" as separate
 * events, so a recovery is never two emails.
 *
 * §27.3 — "Results ready", deliberately a different key from
 * `founder_campaign_ended` (§33.7.11): it fires only after charge, retry, and
 * reconciliation results are prepared, and `prepareResults` is its one sender.
 *
 * §27.4 — "Campaign closed": the Creator's factual close notice, deduped on
 * the association, sent when the campaign's charge outcomes are final.
 *
 * §27.6 — "Retry/reconciliation complete": the internal notice that the one
 * 48-hour window has ended and reconciliation can begin.
 *
 * `internal_failed_payment_spike` remains deliberately unsent: "spike" needs a
 * threshold and §6 names none — inventing one is §1 rule 6, and a key with no
 * sender claims a message the product does not send (§1.4).
 */
export const BACKER_RETRY_SUCCESS = 'backer_retry_success' as const;
export const FOUNDER_RESULTS_READY = 'founder_results_ready' as const;
export const AFFILIATE_CAMPAIGN_CLOSED = 'affiliate_campaign_closed' as const;
export const INTERNAL_RETRY_RECONCILIATION_COMPLETE =
  'internal_retry_reconciliation_complete' as const;

/*
 * Phase 19a — the Creator money messages (§22.1, §27.4).
 *
 * §27.4 — "Completion / fixed-payment decision", deduped per DECISION row
 * (append-only decisions; a genuinely new outcome is a new message, a
 * double-submit is refused upstream); "Commission finalized" and "Transfer
 * created", each deduped on the association-singular row that caused them;
 * "Transfer failure", deduped on the transfer row — one notice per Transfer
 * however many times the sweep retries it (§32.3, §33.8.4); "Payout paid" /
 * "Payout failed", deduped per earnings row and payout event.
 *
 * There is deliberately NO thank-you key: §27 names no §22.2 message, and
 * §22.2's "never promised" makes an automated congratulations exactly the
 * promise the product must not manufacture (§1.4, §1 rule 6).
 */
export const AFFILIATE_COMPLETION_DECISION = 'affiliate_completion_decision' as const;
export const AFFILIATE_COMMISSION_FINALIZED = 'affiliate_commission_finalized' as const;
export const AFFILIATE_TRANSFER_CREATED = 'affiliate_transfer_created' as const;
export const AFFILIATE_TRANSFER_FAILURE = 'affiliate_transfer_failure' as const;
export const AFFILIATE_PAYOUT_PAID = 'affiliate_payout_paid' as const;
export const AFFILIATE_PAYOUT_FAILED = 'affiliate_payout_failed' as const;

/*
 * Phase 19b — the Founder money messages (§22.3, §27.3, §27.6), sent by
 * `close/founder-payment-notifications.ts`.
 *
 * §27.3 — the W-9 prompt, deduped per W-9 EVENT row (a recorded resubmission
 * request is a genuinely new message; a retry of the same request is not);
 * the W-9 block, once per campaign (§33.8.9's message, with the exact amount
 * affected); the three release notices, each deduped on the singular payment
 * row (§33.8.10); the early-release request acknowledgement and its result,
 * each deduped on the request row.
 *
 * §27.6 — `internal_money_decisions_due` and
 * `internal_deliverable_verification_due`, deliberately UNSENT in 19a because
 * no §6 setting fixed a due time. The §22.3 schedule objects fix it — the
 * model's first payment day — so the schedule sweep sends both now, once per
 * campaign.
 *
 * `founder_payment_blocked` was deliberately unsent in 19b: every §22.3 block
 * it could detect was the W-9 (its own key above) or a judgement whose records
 * were Phase 20's. Phase 20b's post-capture enforcement hold is the first
 * detectable non-W-9 block, and it is the sender (registered below).
 * `founder_day_14_review_result` is Phase 21's — the review itself is out of
 * scope here (§22.4).
 */
export const FOUNDER_W9_PROMPT = 'founder_w9_prompt' as const;
export const FOUNDER_W9_BLOCK = 'founder_w9_block' as const;
export const FOUNDER_SINGLE_PAYMENT_RELEASED = 'founder_single_payment_released' as const;
export const FOUNDER_FIRST_PAYMENT_RELEASED = 'founder_first_payment_released' as const;
export const FOUNDER_REMAINING_PAYMENT_RELEASED = 'founder_remaining_payment_released' as const;
export const FOUNDER_EARLY_REMAINING_REQUEST = 'founder_early_remaining_request' as const;
export const FOUNDER_EARLY_REMAINING_RESULT = 'founder_early_remaining_result' as const;
export const INTERNAL_MONEY_DECISIONS_DUE = 'internal_money_decisions_due' as const;
export const INTERNAL_DELIVERABLE_VERIFICATION_DUE =
  'internal_deliverable_verification_due' as const;

/**
 * Phase 20a — §24.8/§27.5's three refund messages, each carrying the same
 * resolved Appendix B.6 block the magic-link page renders. Deduped per REFUND
 * row: a duplicate `charge.refunded` delivery sends nothing (§33.9.12), while
 * a second, separately-recorded refund of the same reservation sends its own.
 * `backer_refund_failed` sends only from `submitted` — a synchronous creation
 * failure the Admin retries was never announced, so its failure is not either.
 */
export const BACKER_REFUND_STARTED = 'backer_refund_started' as const;
export const BACKER_REFUND_COMPLETED = 'backer_refund_completed' as const;
export const BACKER_REFUND_FAILED = 'backer_refund_failed' as const;

/**
 * Phase 20b — disputes, enforcement, and the Backer support path.
 *
 * §27.6 — `internal_dispute_opened` finally has its sender: the §24.11 ingest,
 * deduped per DISPUTE row (a redelivery under a fresh event id changes the
 * status at most; the internal notice announces the 24-hour task once).
 *
 * §27.4 — `affiliate_transfer_reversal` from the `transfer.reversed` handler,
 * deduped per transfer row. `affiliate_warning`/`affiliate_suspension` carry
 * the §29.4 customer statement (five fields + computed appeal deadline), each
 * deduped on the enforcement-action row; `affiliate_policy_reacceptance`
 * announces a §29.8 requirement, deduped per (requirement, association).
 *
 * §27.3/§27.5 — the campaign suspension/kill notices, per role, deduped on the
 * campaign-enforcement action so a replayed enforcement sends nothing and a
 * later distinct action (suspend, then kill) sends its own. §26.7's "notify
 * roles" is these three keys plus the affiliate one above.
 * `founder_payment_blocked` gains its first detectable trigger: a post-capture
 * enforcement hold on an existing unreleased payment (§26.7 "restrict
 * unreleased funds"), deduped per (enforcement action, payment row).
 *
 * §27.5 — the Backer support path (§29.9/§29.10): the B.8 acknowledgement on
 * case open (per case), and the Founder-response relay on an outbound
 * customer-facing message of a Backer's case (per message row).
 */
export const INTERNAL_DISPUTE_OPENED = 'internal_dispute_opened' as const;
export const AFFILIATE_TRANSFER_REVERSAL = 'affiliate_transfer_reversal' as const;
export const AFFILIATE_WARNING = 'affiliate_warning' as const;
export const AFFILIATE_SUSPENSION = 'affiliate_suspension' as const;
export const AFFILIATE_POLICY_REACCEPTANCE = 'affiliate_policy_reacceptance' as const;
export const FOUNDER_CAMPAIGN_SUSPENDED = 'founder_campaign_suspended' as const;
export const FOUNDER_CAMPAIGN_KILLED = 'founder_campaign_killed' as const;
export const BACKER_CAMPAIGN_SUSPENDED = 'backer_campaign_suspended' as const;
export const BACKER_CAMPAIGN_KILLED = 'backer_campaign_killed' as const;
export const FOUNDER_PAYMENT_BLOCKED = 'founder_payment_blocked' as const;
export const BACKER_SUPPORT_RECEIVED = 'backer_support_received' as const;
export const BACKER_SUPPORT_FOUNDER_RESPONSE = 'backer_support_founder_response' as const;

/*
 * Phase 21a — fulfillment and the Day 14 Progress Check (§22.4, §22.5, §27.5,
 * §27.6), sent by `fulfillment/notifications.ts`.
 *
 * `backer_delivery` carries §22.5's five repeated items (§33.10.1) and dedups
 * per RESERVATION: a Backer with two pre-orders on one campaign is told about
 * each, and a re-run of `recordDelivery` tells nobody twice.
 * `founder_day_14_review_result` is the review outcome, deduped per review row
 * — 19b left this key deliberately unsent because the review itself was out of
 * scope there, and this is its sender. `internal_day_14_due` fires once per
 * campaign when the Day 14 anchor arrives and the review is still open.
 *
 * §22.5's sixth item — the satisfaction response — is deliberately NOT folded
 * into `backer_delivery`. §27.5 names "Delivery and satisfaction survey" as two
 * events, `backer_satisfaction_survey` is its own registry key, and §31.8's
 * one-click control is Phase 21b's; linking to a control that does not exist
 * yet would be the §1.4 failure.
 *
 * There is deliberately NO ghost-ban key. §27 names none, §22.7's "notice" is a
 * recorded field on the ban rather than a new message class, and the campaign's
 * §27.3 suspension/kill notices are what a Founder receives when enforcement
 * also stops their campaign. Inventing a key would be §1 rule 6.
 */
export const BACKER_DELIVERY = 'backer_delivery' as const;
export const FOUNDER_DAY_14_REVIEW_RESULT = 'founder_day_14_review_result' as const;
export const INTERNAL_DAY_14_DUE = 'internal_day_14_due' as const;

export const BACKEND_NOTIFICATION_EVENTS = [
  FOUNDER_INVITATION,
  AFFILIATE_CAMPAIGN_INVITATION,
  AFFILIATE_SIGNUP_CONFIRMED,
  AFFILIATE_FOUNDER_SIGNUP_COMPLETED,
  FOUNDER_INTERVIEW_CONFIRMED,
  FOUNDER_INTERVIEW_REMINDER,
  FOUNDER_INTERVIEW_RESCHEDULED,
  FOUNDER_INTERVIEW_CANCELED,
  FOUNDER_LISTING_FEE_RECEIPT,
  FOUNDER_LISTING_FEE_REFUND,
  AFFILIATE_FORMAL_OPPORTUNITY_AVAILABLE,
  INTERNAL_LISTING_PAID_DEADLINE_STARTED,
  AFFILIATE_ACCEPT_CONFIRMATION,
  AFFILIATE_DECLINE_CONFIRMATION,
  AFFILIATE_PROPOSAL_SUBMITTED,
  AFFILIATE_FOUNDER_REVISION,
  AFFILIATE_FOUNDER_DECISION,
  AFFILIATE_PROPOSAL_EXPIRED,
  FOUNDER_CREATOR_PROPOSAL_RECEIVED,
  FOUNDER_CREATOR_PROPOSAL_REVISION,
  FOUNDER_CREATOR_PROPOSAL_DECISION,
  FOUNDER_CAMPAIGN_LIVE,
  AFFILIATE_CAMPAIGN_LIVE,
  AFFILIATE_FIRST_POST_PASS,
  AFFILIATE_FIRST_POST_CORRECTION,
  AFFILIATE_FIRST_POST_REJECT,
  FOUNDER_CAMPAIGN_DISCOVERY_OPENED,
  BACKER_PREORDER_CONFIRMATION,
  BACKER_CANCELLATION_CONFIRMATION,
  BACKER_PRECHARGE_REMINDER,
  FOUNDER_IDEA_THRESHOLD_REACHED,
  FOUNDER_IDEA_THRESHOLD_LOST,
  INTERNAL_THRESHOLD_REACHED,
  INTERNAL_THRESHOLD_LOST,
  FOUNDER_CAMPAIGN_ENDED,
  BACKER_THRESHOLD_MISS_NO_CHARGE,
  BACKER_CHARGE_RECEIPT,
  BACKER_CHARGE_FAILED_UPDATE_CARD,
  BACKER_RETRY_DROPPED,
  BACKER_REFUND_STARTED,
  BACKER_REFUND_COMPLETED,
  BACKER_REFUND_FAILED,
  INTERNAL_CHARGE_BATCH_RESULT,
  BACKER_RETRY_SUCCESS,
  FOUNDER_RESULTS_READY,
  AFFILIATE_CAMPAIGN_CLOSED,
  INTERNAL_RETRY_RECONCILIATION_COMPLETE,
  AFFILIATE_COMPLETION_DECISION,
  AFFILIATE_COMMISSION_FINALIZED,
  AFFILIATE_TRANSFER_CREATED,
  AFFILIATE_TRANSFER_FAILURE,
  AFFILIATE_PAYOUT_PAID,
  AFFILIATE_PAYOUT_FAILED,
  FOUNDER_W9_PROMPT,
  FOUNDER_W9_BLOCK,
  FOUNDER_SINGLE_PAYMENT_RELEASED,
  FOUNDER_FIRST_PAYMENT_RELEASED,
  FOUNDER_REMAINING_PAYMENT_RELEASED,
  FOUNDER_EARLY_REMAINING_REQUEST,
  FOUNDER_EARLY_REMAINING_RESULT,
  INTERNAL_MONEY_DECISIONS_DUE,
  INTERNAL_DELIVERABLE_VERIFICATION_DUE,
  INTERNAL_DISPUTE_OPENED,
  AFFILIATE_TRANSFER_REVERSAL,
  AFFILIATE_WARNING,
  AFFILIATE_SUSPENSION,
  AFFILIATE_POLICY_REACCEPTANCE,
  FOUNDER_CAMPAIGN_SUSPENDED,
  FOUNDER_CAMPAIGN_KILLED,
  BACKER_CAMPAIGN_SUSPENDED,
  BACKER_CAMPAIGN_KILLED,
  FOUNDER_PAYMENT_BLOCKED,
  BACKER_SUPPORT_RECEIVED,
  BACKER_SUPPORT_FOUNDER_RESPONSE,
  BACKER_DELIVERY,
  FOUNDER_DAY_14_REVIEW_RESULT,
  INTERNAL_DAY_14_DUE,
] as const;

export type NotificationEventKey = (typeof BACKEND_NOTIFICATION_EVENTS)[number];
