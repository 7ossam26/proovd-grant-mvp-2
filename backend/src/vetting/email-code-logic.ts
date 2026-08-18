/**
 * The backend's runtime copy of the email-code constants.
 *
 * The backend never imports `@proovd/shared` at runtime — it exports
 * TypeScript source, this package compiles under `rootDir: src`, and the
 * production image ships only `backend/dist`. So the numbers are restated here
 * and drift-tested against the register, which is the arrangement the state
 * enums, the §6 settings and the notification keys all use.
 *
 * Only the values the SERVICE needs are restated. The copy — what the screen
 * says the code does and does not do — is not, because nothing on this side
 * renders it and a fourth copy of a sentence is a fourth place for it to
 * disagree with itself.
 */

/** Six digits. `shared/src/vetting/email-code.ts` is the register. */
export const EMAIL_CODE_LENGTH = 6;

/** Minutes a code stays usable. */
export const EMAIL_CODE_TTL_MINUTES = 15;

/** Wrong codes tolerated against one code before it stops working. */
export const EMAIL_CODE_MAX_ATTEMPTS = 6;

/*
 * `EMAIL_CODE_RESEND_SECONDS` is deliberately NOT restated here. It governs a
 * countdown on one screen and no service reads it, so a copy on this side
 * would be a fourth place for it to disagree with itself — which is what this
 * file's own header says it exists to avoid.
 */

/**
 * Whether a submitted value is even shaped like a code.
 *
 * Checked before anything else so a flood of junk cannot turn verification
 * into a query amplifier — `verify`'s own length guard, restated for a value
 * six characters long. The route pads every rejection to the same floor
 * (`REJECTION_FLOOR_MS`), so returning early here is not a timing channel.
 */
export function isCodeShaped(value: unknown): value is string {
  return typeof value === 'string' && new RegExp(`^[0-9]{${EMAIL_CODE_LENGTH}}$`).test(value);
}
