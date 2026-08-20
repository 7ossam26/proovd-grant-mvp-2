// Phase 3: domain kernel — skeleton domain tables + integrity tables.
// Phase 4: Better Auth account tables and the secure_tokens table that serves
// the two account-less surfaces (Founder drafts, Backer magic links).
export * from './domain.js';
export * from './integrity.js';
export * from './auth.js';
export * from './tokens.js';
// Phase 5: the versioned policy records the §18 public routes render and the
// §34 live-mode gate reads.
export * from './policies.js';
// Phase 6: the §6 global configuration every later phase reads its operating
// constants from, its append-only change history, and the recorded production
// prerequisites that fail closed.
export * from './settings.js';
// Phase 6b: the Founder prospect, the invited draft whose content the 30-day
// retention sweep anonymises, and the append-only record of every send.
export * from './invitations.js';
// Phase 7: the §9 vetting answers and their provenance, the §10 possible-creator
// recording, the account-claim profile, and the policy consents a claim writes.
export * from './vetting.js';
// Phase 8: the §8 campaign-specific Affiliate prospect, the §25.4 per-campaign
// recruitment facts on the association, and the append-only record of every
// private invitation send.
export * from './affiliates.js';
// Phase 8b: the §11 compact signup profile — what Proovd prefilled, what the
// Creator corrected, the five confirmations, and the payout-onboarding status.
export * from './affiliate-signup.js';
// Phase 9: the §12 Founder campaign workspace — the five optional items and the
// evidence that completes them, uploaded assets by reference, the interview
// booking record, and the append-only high-effort and listing-fee calculations.
export * from './workspace.js';
// Phase 10: the §32.4 provider-object store, the §13/§11 connected accounts and
// their four human-readable onboarding states, and the append-only record of
// every return, refresh, and provider-driven status change.
export * from './payments.js';
// Phase 11: the §24.6 listing-fee stream — the successful payment with its two
// §6 clocks, the single full refund the three §13 triggers share, and the
// §31.6 cancellation decision record.
export * from './listing.js';
// Phase 12a: the §14.2 formal decisions — immutable proposal versions, the
// locked compensation agreement, the acceptance confirmations, the inactive
// tracking link, the §14.3 Creator-specific bonus, and the §14.6 deadline
// evaluation record.
export * from './decisions.js';
// Phase 12b: the §14.4 Founder-built campaign page, the §15 six-rule launch
// readiness records, the Admin review rounds and grouped feedback, and the
// general §15 materiality/reacceptance machine (reused in Phase 17).
export * from './build.js';
// Phase 13: the optional fixed Creator payment as a fourth money stream (§24.7)
// — the exact-amount allocation, its §16 funding state machine, and the
// append-only funding attempts. No percentage, no tax base, no cap.
export * from './creator-payment.js';
// Phase 14a: the coordinated launch record, §17's first-post verification, and
// §29.6's required-Creator-failure with its non-resettable three-business-day
// replacement deadline.
export * from './launch.js';
// Phase 14b: the §18 attribution click ledger — every arrival through a
// Creator's tracking link, valid or ignored, with the reason it earned nothing.
export * from './attribution.js';
// Phase 14c: the §18 campaign updates — Founder-authored, append-only, with the
// Idea-only milestone audience and the material-delivery-change pairing.
export * from './updates.js';
// Phase 15: the Backer pre-order surround — the pseudonymous per-campaign backer
// identity (§28.1), §25.3's least-privilege deduplication record and §4.1's
// Admin case queue, §19's immediate immutable Founder operational share, and the
// §2.2 US$50,000 pre-tax cap enforced by a CHECK and a conditional UPDATE.
export * from './reservations.js';
// Phase 16a: Admin operations — §31.7's four-fact seller tax readiness gate,
// §26.6's enforceable customer-consequence preview, and §33.12.4's insert-only
// override record with its five required facts.
export * from './admin-operations.js';
// Phase 16b: §26.7/§27.8 support cases with their business-day response promise,
// the append-only thread and its customer-facing flag, §26.8's four-field handoff
// note, §26.7's suspend/kill decision with reason category AND free text, and
// §26.8's one-time relationship touches. No timeline table — §26.8's timeline
// composes existing events and has no writer.
export * from './support.js';
// Phase 17a: §20's live campaign operations — the acknowledge-once delivery
// receipt that makes "successfully delivered" a fact, the per-viewer last-seen
// position it advances, the alternating threshold crossing, the four one-time
// milestones, and §31.9's insert-only Act rank corrections. No counters table:
// new/canceled/net compose from `reservation_status_history`.
export * from './live.js';
// Phase 17b: §20's live-editing tiers — the insert-only direct-edit history and
// the change request a Founder cannot apply themselves — §18's comment thread
// with its per-campaign Backer number and its route-to-a-person flag, and the
// frozen remaining-time terms a mid-campaign Creator accepted.
export * from './live-editing.js';
// Phase 18a: the §21 close batch — one batch record per campaign carrying the
// Idea threshold decision fixed at close (§33.7.5) and the one 48-hour retry
// window anchored at the first failure, plus the capture attempt claimed under
// its stable idempotency key BEFORE the provider call (§33.7.7).
export * from './close.js';
// Phase 19a: §22.1 completion decisions and earnings finalization with the
// §24.4 identity CHECK-pinned, the ONE per-association Affiliate Transfer
// claimed before the provider call (§33.8.3/4), the §22.1 contractual recovery
// record, and §22.2's recognition-or-payment thank-you with no path to a
// campaign balance.
export * from './earnings.js';
// Phase 19b: §22.3 — the one-per-campaign Founder W-9 record with its
// append-only events and no column that can take a TIN, the §22.3 payment
// objects (one per campaign/kind, refusing to exist without a verified W-9),
// the four-proof early-release evidence, and the Founder's early-release
// request an Admin decides.
export * from './founder-payments.js';
// Phase 20a: §24.8 — the insert-only cause allocation (the cause/treatment
// matrix is a CHECK; 19b's adjustments term sums founder_liability_cents), the
// reservation refund with its requested/submitted/succeeded/failed lifecycle
// claimed before the provider call, and its append-only events.
export * from './refunds.js';
// Phase 20b: §24.11 — the provider dispute with its CHECK-pinned 24-hour Admin
// task and write-once §24.8 classification (case_kind = 'dispute'), the
// append-only lifecycle events, and the recorded evidence-packet assembly.
export * from './disputes.js';
// Phase 20b: §29 — the affiliate enforcement action with its five REQUIRED
// customer-statement fields and computed appeal deadline, the write-once
// appeal decision, the §29.1/§29.2 disclosures, §29.8's published-version
// reacceptance requirement, and §29.10's one-per-case Backer escalation.
export * from './enforcement.js';
// Phase 21a: §22.4–§22.7 — the campaign fulfillment record with its three
// obligation timestamps, the insert-only delivery-commitment sequence whose
// first row is the original promise, the §22.6 Admin-approval request with its
// five-business-day deadline, the write-once Day 14 review with its durable
// insert-only receipt, and the one-per-Founder permanent ghost ban.
export * from './fulfillment.js';
// Phase 22c: §27.7 — the optional digest preference, one per person, existing
// only because someone chose it, with its trigger-written insert-only history.
// No digest-content table and no unread counter: the digest composes from
// records that already exist, and a badge is the pressure DNA §5.5 replaces.
export * from './digest.js';

// Phase 21b: §22.8's Creator completion status with its five stored findings,
// §22.9's work-again request (which carries nothing a campaign could be built
// from), §22.10's Admin readiness decision (the cooldown is derived, never
// stored), §31.8's one-per-reservation satisfaction answer (with no consent
// column to coerce), and §22.11's resolution record — which stores whether
// fulfillment was still active, so the two states cannot be collapsed.
export * from './completion.js';

// Phase 24: §34's live-mode gate — the insert-only verification of each of the
// eleven conditions, the one live pilot enablement (a partial unique index over
// a constant, so §6's "one named pilot campaign" is the database's answer) with
// its five NOT NULL rollback-plan columns and its two named owners as rows, the
// three pre-first-reservation confirmations, and the recorded Appendix C walks.
export * from './live-mode.js';

// The Founder Admin workspace: per-invitation profile overrides live on
// `campaign_drafts` (see invitations.ts), and these two records give the
// workspace what no table held — person-level access decisions (§26.7, distinct
// from the campaign-scoped enforcement action) and the §25.8 account-deletion
// ask, which records a request and deletes nothing.
export * from './founder-workspace.js';

// The Creator Admin workspace: the same two person-level records for an
// Affiliate — account standing (§26.7, distinct from the association-scoped
// §29 enforcement action) and the §25.8 deletion ask. Added 2026-08-11 as a
// recorded deviation; see the file header for what it deliberately excludes.
export * from './creator-workspace.js';

// The Admin Tasks panel (migration 0046, 2026-08-16): a shared, soft-deleting
// note table pointed at existing records, with NO assignee and NO
// schedule-shaped column — both absences asserted by test, because §30 is why
// this is a note an Admin checks and never a queue that chases anybody.
export * from './admin-tasks.js';

// The campaign follow record (campaign-page-v2 Session C — a recorded §1 rule 6
// deviation; see the file header and migration 0050).
export * from './followers.js';
// Creator Flow v2 (2026-08-19): the recorded tone and per-channel metrics, the
// three deviation records — a standing that binds nothing, a referral that pays
// nothing, and a resource list holding no campaign material — and the two that
// close §5.3's never-implemented settings right.
export * from './creator-flow.js';

// The Founder→Creator meeting request (migration 0056, Founder Dashboard
// Session C — a recorded §1 rule 6 deviation on §22.9's shape; see the file
// header for the four absences that keep it from being a scheduler or a thread).
export * from './meetings.js';

// The Founder's acknowledgement of a Creator's post (migration 0057, Founder
// Dashboard Session D — a recorded §1 rule 6 deviation; see the file header for
// the four absences, the strongest being that it carries no free text at all).
export * from './posts.js';

// The Founder's Backer data request (migration 0058, Founder Dashboard Session
// F). NOT a deviation — §25.7 already permits Backer email and purchase details
// for fulfillment and support, and refuses marketing and community. Both
// refusals are in the CHECK; an approved request grants no access, because
// `exportBackerRows` takes no argument one could arrive as.
export * from './backer-data.js';
