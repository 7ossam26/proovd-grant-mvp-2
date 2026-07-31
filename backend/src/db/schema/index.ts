// Phase 3: domain kernel — skeleton domain tables + integrity tables.
// Phase 4: Better Auth account tables and the secure_tokens table that serves
// the two account-less surfaces (Founder drafts, Backer magic links).
export * from './domain.js';
export * from './integrity.js';
export * from './auth.js';
export * from './tokens.js';
