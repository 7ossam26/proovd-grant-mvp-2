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
] as const;

export type NotificationEventKey = (typeof BACKEND_NOTIFICATION_EVENTS)[number];
