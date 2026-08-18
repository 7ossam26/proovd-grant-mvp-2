/**
 * The Founder's email confirmation code — Founder Flow v2, Session C.
 *
 * ── A RECORDED §1 rule 6 DEVIATION, built by product direction ──────────────
 * `shared/src/vetting/email-code.ts` carries the full record and the scoping.
 * The short version: it **verifies an email**. It creates no account, mints no
 * session, and does not touch `completeClaim` — §10 still owns account creation
 * and its `founder_signup_complete` exactly-once transaction is unchanged.
 *
 * ── The three rules this file inherits, and where each comes from ───────────
 *  1. **One rejection, one status, one body.** Wrong, expired, already-used,
 *     locked-out, never-requested and "requested for a different address" are
 *     indistinguishable to the caller. `auth/token-rejection.ts` owns the
 *     reasoning; the route renders its frozen body and this module returns a
 *     value carrying no reason to render.
 *  2. **The rate limiter returns that same body, never a 429.** Phase 04's
 *     rule: a limiter that announces itself is the same enumeration oracle in a
 *     hat. `routes/vetting.ts` wires it.
 *  3. **The raw code exists only in the delivered email.** Never at rest — the
 *     stored value is an HMAC — never in a log, never in an audit row, never in
 *     a response. `token-service.ts` writes the audit row and it names the
 *     draft and the version and stops there.
 *
 * ── Requesting answers before it works, and that is deliberate ──────────────
 * A draft whose profile has an address mints and sends; one without returns
 * immediately. That difference is measurable even when the bodies match, so the
 * route answers FIRST and calls this afterwards — `magic-link-reissue.ts`'s
 * shape, for its reason: the result of the request arrives by email, so
 * answering before the work is honest rather than a claim of completion.
 *
 * ── A resend is a second message; a retry is not ────────────────────────────
 * §7's rule. The delivery is deduped on the token ROW, and a resend supersedes
 * the previous code and inserts the next version — so asking again earns a new
 * message and a double-submitted request does not.
 */

import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { ensureClaimProfile } from './claim.js';
import type { TokenService } from '../auth/token-service.js';
import { TOKEN_INVALID, type TokenInvalid } from '../auth/token-service.js';
import type { Notifier } from '../notifications/send.js';
import { FOUNDER_EMAIL_CODE } from '../notifications/events.js';
import { renderPlainNotice } from '../notifications/templates/plain.js';
import { EMAIL_CODE_TTL_MINUTES } from './email-code-logic.js';

export interface EmailCodeDeps {
  db: Database;
  tokens: TokenService;
  notifier?: Notifier | undefined;
  fromAddress: string;
  supportEmail: string;
}

/**
 * The one answer to "send me a code", frozen.
 *
 * It is the reissue route's constant with a different subject: the address is
 * on the draft rather than in the request body, so this is a weaker oracle than
 * that one — but a route that answered differently for "we sent it" and "there
 * is no address on this draft" would still tell a holder of a draft link
 * something about a record they cannot otherwise read. One answer is cheaper
 * than reasoning about which differences are safe.
 */
export const EMAIL_CODE_ACK = Object.freeze({
  status: 'sent' as const,
  title: 'Check your email',
  whatHappened: 'If we have an address for this campaign, a six-digit code is on its way to it.',
  next: 'It works for a short while. If nothing arrives, check your spam folder and ask for another.',
});

/** Renders the code message. Exported so the §27 catalog renders the same one. */
export async function renderEmailCodeNotice(input: {
  code: string;
  reference: string;
  supportEmail: string;
}) {
  return renderPlainNotice({
    subject: `${input.code} is your Proovd confirmation code`,
    headline: 'Confirm your email address',
    facts: [
      { label: 'Your code', value: input.code },
      { label: 'How long it lasts', value: `${EMAIL_CODE_TTL_MINUTES} minutes` },
      {
        label: 'What it does',
        // §1.4, and the sentence that keeps this message from reading as a
        // sign-in. The account, the agreements and the representations are
        // §10's, later, and each is its own control (§28.4).
        value:
          'Confirms we can reach you at this address. It creates no account and signs you into nothing.',
      },
      {
        label: 'If you did not ask for this',
        value:
          'Nothing has changed and nothing has been charged. Ignore this email and the code stops working on its own.',
      },
    ],
    paragraphs: [
      'Type it into the page you already have open. We will not ask you for this code anywhere else, and nobody at Proovd will ever ask you to read it out.',
    ],
    /*
     * No action, deliberately. §27.2 permits one and this message needs none:
     * the person is looking at the six boxes already. A link here would be a
     * second way in — one that works from a forwarded email, which is exactly
     * what a code sent to prove reachability must not be.
     */
    reference: input.reference,
    supportEmail: input.supportEmail,
  });
}

/**
 * Mints a code for this draft's current address and sends it.
 *
 * Returns nothing a caller could branch on, because there is no caller that
 * should — the route has already answered. Exported so the suite can drive it
 * and assert what it did, which is the same thing a real caller cannot see.
 */
export async function requestFounderEmailCode(
  deps: EmailCodeDeps,
  input: { draftId: string; campaignId: string },
): Promise<void> {
  if (!deps.notifier) return;

  /*
   * The address lives on the claim profile, and the profile is created on
   * first read with the invitation address prefilled. In the flow the email
   * screen has already read it — but a caller that reached this route without
   * one would otherwise silently send nothing to a Founder whose invited
   * address we have had all along, which is a §1.4 failure that looks exactly
   * like a provider outage. Ensuring here is idempotent and runs after the
   * route has answered, so it costs no timing.
   */
  const profile = await ensureClaimProfile(deps.db, input.draftId, `draft:${input.draftId}`);

  const email = profile?.fields.email.value?.trim();
  if (!email) return;

  const { code, record } = await deps.tokens.issueFounderEmailCode(input.draftId, email);

  const notice = await renderEmailCodeNotice({
    code,
    reference: input.campaignId,
    supportEmail: deps.supportEmail,
  });

  await deps.notifier.send({
    eventKey: FOUNDER_EMAIL_CODE,
    entityType: 'secure_token',
    /*
     * The token ROW, not the draft. §7's resend rule: asking again is a
     * deliberate second act and earns a second message, while a
     * double-submitted request must not. A new row exists only when a new code
     * was minted, so keying on it gets both halves for free.
     */
    entityId: record.id,
    from: deps.fromAddress,
    to: email,
    subject: notice.subject,
    html: notice.html,
    text: notice.text,
  });
}

export type VerifyEmailCodeResult =
  | { ok: true; email: string }
  | { ok: false; error: TokenInvalid };

/**
 * Checks a submitted code and records the address as reachable.
 *
 * The address compared is the one on the profile RIGHT NOW, and the code's
 * hash binds the address it was sent to — so a Founder who changes their
 * address after requesting a code finds the old code no longer works. That is
 * the correct answer rather than an edge case: the thing being verified is an
 * address, and the address changed.
 *
 * `email_ownership` is the whole of what a success writes. No account, no
 * session, no consent, no status move — `completeClaim` still owns every one
 * of those and is not called from here.
 */
export async function verifyFounderEmailCode(
  deps: Pick<EmailCodeDeps, 'db' | 'tokens'>,
  input: { draftId: string; code: string },
): Promise<VerifyEmailCodeResult> {
  const [profile] = await deps.db
    .select({ id: founderClaimProfiles.id, email: founderClaimProfiles.email })
    .from(founderClaimProfiles)
    .where(eq(founderClaimProfiles.draftId, input.draftId))
    .limit(1);

  const email = profile?.email?.trim();
  // No address means no code was ever minted for one, so there is nothing this
  // could match. Same answer as a wrong code, for the same reason.
  if (!profile || !email) return { ok: false, error: TOKEN_INVALID };

  const result = await deps.tokens.verifyFounderEmailCode({
    campaignDraftId: input.draftId,
    email,
    code: input.code,
  });

  if (!result.ok) return { ok: false, error: TOKEN_INVALID };

  await deps.db
    .update(founderClaimProfiles)
    .set({ emailOwnership: 'code_verified' })
    .where(eq(founderClaimProfiles.id, profile.id));

  return { ok: true, email };
}
