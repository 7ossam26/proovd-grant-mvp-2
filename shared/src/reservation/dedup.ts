/**
 * Practical deduplication inputs — Spec §4.1, §25.3.
 *
 * `Unique Backer` is "a fraud-control decision, not verified civil identity."
 * The private deduplication key derives from *normalized* email and phone, so
 * the normalization has to be one definition used everywhere — two spellings of
 * "normalize" would put the same person under two keys and defeat the one-active
 * Idea rule. It lives here, is pure, and is tested.
 *
 * The hashing itself (an HMAC under `BETTER_AUTH_SECRET`) is the backend's, so
 * a raw email never leaves the server as a reversible token; this module only
 * produces the normalized strings the backend hashes and the record §25.3 keeps.
 */

/**
 * Lowercase and trim. Deliberately conservative: no plus-address stripping and
 * no Gmail dot-folding, because collapsing distinct addresses is a false merge
 * (§4.1: "Shared IP alone never merges two Backers" is the same caution — do not
 * over-merge). Two genuinely different people with `a+1@x` and `a+2@x` are not
 * the same Backer, and the Admin queue exists for the suspected cases anyway.
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Reduce a US phone to its ten significant digits.
 *
 * Strips every non-digit and drops a leading country-code `1` when eleven
 * digits remain, so `+1 (415) 555-0100`, `415-555-0100`, and `14155550100` all
 * normalize to `4155550100`. A number that is not ten (or eleven-with-1) digits
 * is returned digits-only rather than guessed at — the caller validates length.
 */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D+/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits;
}

/** The material a private dedup key is derived from (§4.1). */
export interface DedupNormalized {
  email: string;
  phone: string;
}

export function normalizeDedupInputs(input: { email: string; phone: string }): DedupNormalized {
  return { email: normalizeEmail(input.email), phone: normalizePhone(input.phone) };
}

/**
 * §4.1's hard rule, stated as data so a service cannot forget it: shared IP
 * alone never merges two Backers. The merge signals are email, phone, and the
 * Stripe payment-method fingerprint; IP and device are *risk* signals that may
 * open an Admin case but never auto-merge.
 */
export const MERGE_SIGNALS = ['email', 'phone', 'payment_fingerprint'] as const;
export type MergeSignal = (typeof MERGE_SIGNALS)[number];

export const RISK_ONLY_SIGNALS = ['ip', 'device'] as const;
export type RiskOnlySignal = (typeof RISK_ONLY_SIGNALS)[number];

/** True only for a signal that may, on its own, identify the same Backer. */
export function isMergeSignal(signal: string): signal is MergeSignal {
  return (MERGE_SIGNALS as readonly string[]).includes(signal);
}
