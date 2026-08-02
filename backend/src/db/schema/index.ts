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

