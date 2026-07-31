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

