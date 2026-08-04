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
