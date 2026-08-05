/**
 * The §27 events with no sender, and why — Spec §1.4, §1 rule 6, §27.3–27.6.
 *
 * `events.ts` has always carried one rule: a key appears there when something
 * starts sending it, never before, because a key with no sender claims a
 * message the product does not send (§1.4). That rule kept the sent list
 * honest and left the unsent ones invisible — 44 of them by Phase 22, spread
 * across eleven phases' worth of comments explaining individual absences.
 *
 * This is the other half. Every registry key is either sent or recorded here
 * with the reason and the owner, and `notification-coverage.test.ts` asserts
 * the two lists partition the register exactly: no key in both, no key in
 * neither. That is what makes "nothing sends that shouldn't" a fact rather
 * than a claim, and it is why adding a key to the shared register without
 * either building its sender or recording its absence fails the suite.
 *
 * ── The three kinds of absence, and why they are not one ────────────────────
 *  - `never`      the Spec itself rules the message out, or naming its trigger
 *                 would be inventing one (§1 rule 6). These do not become
 *                 someone's backlog; they are decisions.
 *  - `capability` the message has no *behaviour* behind it yet. The phase that
 *                 builds the behaviour owns the message — Phase 22's own brief
 *                 says so: "If this phase finds a missing capability rather
 *                 than a missing message, that belongs to the phase that owns
 *                 it."
 *  - `message`    the behaviour exists and is recorded; only the message is
 *                 missing. `record` names the table that already holds the
 *                 fact, so the claim is checkable rather than aspirational.
 */

export type AbsenceKind = 'never' | 'capability' | 'message';

export interface UnsentEvent {
  kind: AbsenceKind;
  /** The phase that owns it, or `none` where the answer is that it never sends. */
  owner: 'none' | 'phase-21b' | 'phase-22b' | 'phase-22c';
  reason: string;
  /** For `message`: the record that already holds the fact the message would carry. */
  record?: string;
}

export const UNSENT_NOTIFICATION_EVENTS = {
  /* ── Decisions, not backlog (§1 rule 6, §1.4) ──────────────────────────── */

  founder_email_verification: {
    kind: 'never',
    owner: 'none',
    reason:
      '§27.3 names it "if later enabled". §5 admits Founders by invitation only and `disableSignUp: true` closes the HTTP route, so there is no public-route signup whose address would need verifying. Enabling one is a §5 change, and the message follows it rather than preceding it.',
  },
  internal_failed_payment_spike: {
    kind: 'never',
    owner: 'none',
    reason:
      '"Spike" needs a threshold and §6 fixes none. Inventing one is §1 rule 6, and the §33.7.12 close-operations queue already shows every failed capture with no threshold in front of it.',
  },

  /* ── Capability not built — Phase 21b (§22.8–§22.11, §31.8) ────────────── */

  founder_ready_next_campaign: {
    kind: 'capability',
    owner: 'phase-21b',
    reason:
      '§22.10 Founder next-campaign readiness. 21a wrote no readiness record and §33.10.5–10 are 21b\'s.',
  },
  founder_work_again_response: {
    kind: 'capability',
    owner: 'phase-21b',
    reason: '§22.9 the work-again request. No work-again record exists to respond to.',
  },
  affiliate_work_again_request: {
    kind: 'capability',
    owner: 'phase-21b',
    reason: '§22.9. The Creator side of the same absent record.',
  },
  internal_work_again_request: {
    kind: 'capability',
    owner: 'phase-21b',
    reason: '§22.9. The Admin side of the same absent record.',
  },
  backer_satisfaction_survey: {
    kind: 'capability',
    owner: 'phase-21b',
    reason:
      '§31.8\'s satisfaction step and its one-click control are 21b\'s. 21a deliberately kept it out of `backer_delivery`: §27.5 names "Delivery and satisfaction survey" as two events, and linking to a control that does not exist would be the §1.4 failure.',
  },

  /* ── Capability not built — Phase 22c (§27.7) ──────────────────────────── */

  backer_campaign_update_digest: {
    kind: 'capability',
    owner: 'phase-22c',
    reason:
      '§27.7\'s digest is opt-in and there is no preference to opt into yet. Sending a digest nobody chose would breach §27.7\'s "optional" and §30\'s ban on engagement sequences in one message.',
  },

  /* ── Message missing, behaviour recorded — Phase 22b ───────────────────── */

  founder_password_reset: {
    kind: 'message',
    owner: 'phase-22b',
    reason:
      '§5.5 reset exists in Better Auth and `sendResetPassword` is wired — to a function that throws, deliberately, because Phase 04 had no transport. Phase 06b built one. The message is the only thing missing.',
    record: 'better-auth verification tokens',
  },
  founder_connected_account_status: {
    kind: 'message',
    owner: 'phase-22b',
    reason: '§13\'s four derived states already move on `account.updated`; nothing tells the Founder.',
    record: 'stripe_connected_accounts + stripe_account_events',
  },
  affiliate_connected_account_info_required: {
    kind: 'message',
    owner: 'phase-22b',
    reason: '§13\'s requirement names are already stored per account; the Creator is never told.',
    record: 'stripe_connected_accounts.requirements',
  },
  affiliate_transfer_update: {
    kind: 'message',
    owner: 'phase-22b',
    reason:
      '§32.3 lists `transfer.updated` on the Connect endpoint and the handler map does not register it. The Transfer record exists; the event is unhandled and the message unsent.',
    record: 'affiliate_transfers',
  },
  founder_response_window_started: {
    kind: 'message',
    owner: 'phase-22b',
    reason:
      '§13\'s effect 5 stores the 72-hour deadline at listing payment and the receipt carries it as one line. §27.3 names the window start as its own bullet, and a Founder who owes Creators an answer deserves a message about the answer rather than a sentence inside a receipt.',
    record: 'listing_fee_payments.response_deadline_at',
  },
  founder_roster_update: {
    kind: 'message',
    owner: 'phase-22b',
    reason:
      '§14.5\'s roster status is derived and its transitions are recorded; the Founder learns of them only by opening the roster.',
    record: 'association_status_history + campaign_readiness',
  },
  founder_submission_receipt: {
    kind: 'message',
    owner: 'phase-22b',
    reason: '§15 review submission is recorded with its owner and next date; no receipt is sent.',
    record: 'campaign_reviews',
  },
  founder_changes_required: {
    kind: 'message',
    owner: 'phase-22b',
    reason:
      '§15\'s grouped `Required before resubmission` / `Optional improvements` feedback is stored per round with deep link, owner, and due expectation. Nothing delivers it.',
    record: 'review_feedback_items',
  },
  founder_campaign_approved: {
    kind: 'message',
    owner: 'phase-22b',
    reason: '§15 approval writes the immutable snapshot and moves the campaign; no message follows.',
    record: 'approved_campaign_snapshots',
  },
  internal_campaign_submitted: {
    kind: 'message',
    owner: 'phase-22b',
    reason:
      '§27.6\'s Admin notice for the same submission. The review round is recorded with its owner and due expectation, and the queue is currently the only thing that says a campaign is waiting on Proovd.',
    record: 'campaign_reviews',
  },
  founder_fixed_payment_funding_request: {
    kind: 'message',
    owner: 'phase-22b',
    reason:
      '§16\'s allocation and its Admin-configured funding deadline exist; the Founder is asked for the money only by the surface.',
    record: 'creator_payment_allocations',
  },
  founder_fixed_payment_funding_confirmation: {
    kind: 'message',
    owner: 'phase-22b',
    reason: '§16 funding marks the allocation `funded` on the exact amount and sends nothing.',
    record: 'creator_payment_funding_attempts',
  },
  founder_fixed_payment_funding_failure: {
    kind: 'message',
    owner: 'phase-22b',
    reason:
      '§16 records a `failed` attempt and leaves the allocation `payment_failed`; the Founder learns nothing, and the funding deadline keeps running.',
    record: 'creator_payment_funding_attempts',
  },
  affiliate_fixed_funding_complete: {
    kind: 'message',
    owner: 'phase-22b',
    reason:
      '§16: funding complete, "readiness remains explicit" — the Creator is owed both facts and receives neither.',
    record: 'creator_payment_allocations',
  },
  internal_fixed_funding_received: {
    kind: 'message',
    owner: 'phase-22b',
    reason:
      '§27.6\'s Admin counterpart to the funding confirmation. Funded is not paid (§16): the allocation now waits on a §22.1 completion decision that only an Admin records.',
    record: 'creator_payment_funding_attempts',
  },
  internal_fixed_funding_failed: {
    kind: 'message',
    owner: 'phase-22b',
    reason:
      '§27.6\'s Admin counterpart to the funding failure. The Admin-configured funding deadline keeps running against a failed allocation, and missing it cancels the association.',
    record: 'creator_payment_funding_attempts',
  },
  affiliate_disclosure_tracking_available: {
    kind: 'message',
    owner: 'phase-22b',
    reason:
      '§14.2 mints the tracking link at acceptance with `active=false` and 14d publishes the disclosure requirements; §27.4 makes their availability its own message and there is none.',
    record: 'tracking_links',
  },
  founder_mid_campaign_creator_proposed: {
    kind: 'message',
    owner: 'phase-22b',
    reason: '§20\'s mid-campaign addition is recorded with its frozen remaining-time terms.',
    record: 'mid_campaign_additions',
  },
  founder_mid_campaign_creator_accepted: {
    kind: 'message',
    owner: 'phase-22b',
    reason: '§20. The acceptance is a recorded association transition.',
    record: 'mid_campaign_additions + association_status_history',
  },
  founder_mid_campaign_creator_activated: {
    kind: 'message',
    owner: 'phase-22b',
    reason: '§20. Activation stamps the new link\'s `activated_at`.',
    record: 'tracking_links.activated_at',
  },
  affiliate_mid_campaign_invitation: {
    kind: 'message',
    owner: 'phase-22b',
    reason:
      '§20. The Creator receives Phase 08a\'s general campaign invitation; §27.4 names the mid-campaign one separately because the terms it carries are the frozen remaining-time ones.',
    record: 'mid_campaign_additions',
  },
  affiliate_mid_campaign_readiness: {
    kind: 'message',
    owner: 'phase-22b',
    reason: '§16 readiness for a mid-campaign Creator, recorded and unannounced.',
    record: 'association_readiness',
  },
  affiliate_mid_campaign_activation: {
    kind: 'message',
    owner: 'phase-22b',
    reason: '§20. The Creator is not told the moment their link starts earning.',
    record: 'tracking_links.activated_at',
  },
  internal_mid_campaign_invite: {
    kind: 'message',
    owner: 'phase-22b',
    reason:
      '§27.6\'s Admin counterpart to the mid-campaign invitation. A Creator recruited after launch joins on frozen remaining-time terms, and nothing announces that one has gone out.',
    record: 'mid_campaign_additions',
  },
  internal_mid_campaign_accept: {
    kind: 'message',
    owner: 'phase-22b',
    reason:
      '§27.6\'s Admin counterpart to the mid-campaign acceptance — the moment the §2.2 slot is committed and the frozen terms become binding.',
    record: 'mid_campaign_additions',
  },
  internal_mid_campaign_readiness: {
    kind: 'message',
    owner: 'phase-22b',
    reason:
      '§27.6\'s Admin counterpart to mid-campaign readiness. Admin schedules the activation, so Admin is who needs to know the thirteen §16 items are finally all met.',
    record: 'association_readiness',
  },
  internal_mid_campaign_activation: {
    kind: 'message',
    owner: 'phase-22b',
    reason:
      '§27.6\'s Admin counterpart to mid-campaign activation — the instant the new link starts earning, which is also when no-retroactive-attribution starts to matter.',
    record: 'tracking_links.activated_at',
  },
  internal_invitation_claimed: {
    kind: 'message',
    owner: 'phase-22b',
    reason:
      '§27.6. Both claim transactions are idempotent and recorded — §10\'s Founder claim and §11\'s Creator signup — and neither tells Admin a new account exists.',
    record: 'campaign_drafts.claimed_at + affiliate_signup_profiles.claimed_user_id',
  },
  internal_interview_changed: {
    kind: 'message',
    owner: 'phase-22b',
    reason:
      '§27.6. The booking record and its reschedule history are the source of truth (tech-stack §12); the four Founder-facing interview messages exist and the Admin one does not.',
    record: 'founder_interview_bookings + its events',
  },
  internal_proposal_awaiting_response: {
    kind: 'message',
    owner: 'phase-22b',
    reason:
      '§27.6. §14.6\'s deadline evaluation runs on the sweep and Admin sees an open proposal only by opening the roster.',
    record: 'proposal_versions (open) + response_deadline_evaluations',
  },
  internal_post_verification_due: {
    kind: 'message',
    owner: 'phase-22b',
    reason:
      '§27.6. A submitted first post waits for an Admin decision whose three outcomes pause a Creator; nothing announces that it is waiting.',
    record: 'creator_post_submissions',
  },
  internal_missing_w9: {
    kind: 'message',
    owner: 'phase-22b',
    reason:
      '§27.6. `founder_w9_block` tells the Founder; §27.6 names the Admin notice separately and the schedule sweep already computes the state that would send it.',
    record: 'founder_w9_records',
  },
  internal_risk_flag: {
    kind: 'message',
    owner: 'phase-22b',
    reason:
      '§27.6. §31.7\'s ten signals are computed live and three of them are blocking; a blocking signal is a real observed consequence, so the message has a trigger without inventing a score or a threshold (§31.7 forbids both).',
    record: 'the §31.7 risk panel over reservations, disputes, and tax readiness',
  },
  internal_support_sla_breach: {
    kind: 'message',
    owner: 'phase-22b',
    reason:
      '§27.8. The breach is already derived and badged in the daily queue; §27.6 names the message and §27.8\'s own promise is what makes a silent breach the failure that matters.',
    record: 'support_cases.response_due_at',
  },
  backer_support_followup: {
    kind: 'message',
    owner: 'phase-22b',
    reason:
      '§27.8: "Even without resolution, send an update at the promised checkpoint." The promised checkpoint is stored; nothing reads it.',
    record: 'support_cases.next_update_promised_at',
  },
  backer_magic_link_reissue: {
    kind: 'message',
    owner: 'phase-22b',
    reason:
      '§27.5. `mintOrReissueMagicLink` already rotates the token and every campaign message carries the fresh link, so a Backer whose link expired can only wait for the next event to reach them.',
    record: 'secure_tokens (backer_magic_link scope)',
  },
} as const satisfies Record<string, UnsentEvent>;

export type UnsentNotificationKey = keyof typeof UNSENT_NOTIFICATION_EVENTS;

export const UNSENT_NOTIFICATION_KEYS = Object.keys(
  UNSENT_NOTIFICATION_EVENTS,
) as UnsentNotificationKey[];

/** The keys a named phase owes a message. Empty for `owner: 'none'`. */
export function unsentOwnedBy(owner: UnsentEvent['owner']): UnsentNotificationKey[] {
  return UNSENT_NOTIFICATION_KEYS.filter((key) => UNSENT_NOTIFICATION_EVENTS[key].owner === owner);
}
