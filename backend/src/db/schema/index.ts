// Phase 3: domain kernel — skeleton domain tables + integrity tables.
// tokens.ts is staged Phase 4 code and is deliberately NOT exported yet;
// exporting it would pull secure_tokens into the migration set early.
export * from './domain.js';
export * from './integrity.js';
