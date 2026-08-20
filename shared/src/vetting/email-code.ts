/**
 * The six-digit email code — Founder Flow v2 deviation 1, Session C, 2026-08-18.
 *
 * ── A RECORDED DEVIATION from §1 rule 6, built by product direction ─────────
 * There is no OTP anywhere else in this product: no `token_scope` value for
 * one, no Better Auth plugin (`plugins: []`, and `auth.ts` records that the
 * magic-link plugin is *deliberately* unused), and no `email_ownership` value
 * meaning verified. This adds all three. It is recorded here the way the
 * 2026-08-10 Admin-MFA removal and the account-level Creator suspend/restore
 * are — **so a later session does not "fix" it by deleting it, and does not
 * read it as licence for more.**
 *
 * ── The deviation is narrower than it looks, and the scoping IS the design ──
 * §5.2's own second sentence reads: "A private invitation or Google sign-in may
 * establish invited-email ownership. A future public onboarding route requires
 * email verification." So email verification is a mechanism §5.2 anticipates.
 * What is new is applying it on the *invited* route, where the invitation has
 * already established ownership of the address it was sent to — and the case
 * that actually matters is the Founder who types a DIFFERENT address, which
 * §5.2 records today as `self_supplied_unverified` precisely because nothing
 * could verify it.
 *
 * **It verifies an email. It does not create an account.** Account creation
 * stays exactly where §10 puts it — the claim surface — and `completeClaim`
 * stays one transaction with its `founder_signup_complete` exactly-once
 * guarantee untouched. Building the code as a second account-creation path
 * would be a far larger deviation and would put a second writer on the most
 * carefully-guarded transaction in the product.
 *
 * ── What a later phase must not read this as licence for ────────────────────
 * This verifies an email; it is not the beginning of a passwordless product.
 * §33.1.8 forbids an SMS OTP and is the guardrail that stops this drifting onto
 * a phone number: the code goes to an email address, `user.phone_verified`
 * stays CHECK-pinned false, and `founder_claim_profiles` still holds no column
 * matching `%verif%`. That test must pass unchanged — and if it ever needs
 * editing, that is the signal this deviation has grown past what was
 * authorised.
 */

/** Six digits. The reference's own, and the length the screen draws boxes for. */
export const EMAIL_CODE_LENGTH = 6;

/** How long one code stays usable. Short, because it arrives instantly. */
export const EMAIL_CODE_TTL_MINUTES = 15;

/**
 * Wrong codes tolerated against one code before it stops working.
 *
 * A six-digit secret is 10⁶ values, so the counter is what makes it a secret at
 * all: without it, an attacker holding a draft link needs a few hours of
 * requests. `secure_tokens.failed_attempts` is the counter and it already
 * exists; this is the ceiling the flow uses, deliberately far below the token
 * service's own generic 10 — a person mistyping six digits gets several tries,
 * and a script gets nowhere.
 */
export const EMAIL_CODE_MAX_ATTEMPTS = 6;

/**
 * Seconds before "send it again" is offered AGAIN, once it has been used.
 *
 * A countdown rather than a disabled control with no explanation: §27.1's
 * "when is the next update" answered on the one screen where a person is
 * waiting for an email that may already be in their spam folder.
 *
 * CHANGED 2026-08-20, with the screen-6 rebuild, in two ways. The number is
 * the reference's own 49 — nothing on the server reads this (see
 * `backend/src/vetting/email-code-logic.ts`, which records deliberately not
 * restating it), so the reference is the only authority there is for it. And
 * the clock now starts when a person ASKS for another code rather than when
 * the screen opens, which is the reference's own `resendLeft: 0` initial
 * state: counting down from mount put a timer in front of a Founder whose code
 * had not arrived, before they could do anything about it.
 */
export const EMAIL_CODE_RESEND_SECONDS = 49;

/**
 * The one sentence that keeps this screen from reading as a sign-in.
 *
 * It is on the screen rather than in this file's comments because the person
 * who most needs it is the Founder looking at six empty boxes and wondering
 * what they have just been signed up for. §10 creates the account, later, with
 * three separate representations and three policy acceptances (§28.4).
 */
export const EMAIL_CODE_CREATES_NO_ACCOUNT =
  'This only confirms we can reach you at that address. It creates no account and signs you into nothing — your details and the agreements come later, and you choose them one at a time.';

/**
 * What the flow says when a code cannot be checked.
 *
 * There is exactly one, and it is deliberately vague about which of the five
 * things went wrong. `backend/src/auth/token-rejection.ts` owns the rule and
 * the reasoning; this is its wording for a screen that shows six boxes rather
 * than a dead link.
 */
export const EMAIL_CODE_REJECTION =
  "That code did not work. It may have been mistyped, or it may have expired or already been used — we can't tell which from here. Ask for a new one and we will send it straight away.";
