/**
 * The Founder's email confirmation code — Founder Flow v2, Session C.
 *
 * ── A RECORDED §1 rule 6 DEVIATION, built by product direction ──────────────
 * `shared/src/vetting/email-code.ts` carries the full record and the scoping.
 * The short version: it **verifies an email**. The route then establishes a
 * draft-scoped flow authorization, not an account sign-in. It does not touch
 * `completeClaim` — §10 still owns account creation and its
 * `founder_signup_complete` exactly-once transaction is unchanged.
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
 * ── Success means the provider accepted the message ─────────────────────────
 * Minting, superseding, and delivery run as one transaction. Provider refusal
 * rolls the replacement back, so an existing code remains usable. Missing
 * configuration, missing address, limiter refusal, and provider failure share
 * one generic failure response; the frozen success acknowledgement is emitted
 * only after provider acceptance.
 *
 * ── A resend is a second message; a retry is not ────────────────────────────
 * §7's rule. The delivery is deduped on the token ROW, and a resend supersedes
 * the previous code and inserts the next version only when delivery commits. A
 * per-draft advisory lock rejects overlapping requests before either can mint.
 */

import { eq, sql } from 'drizzle-orm';
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

/** The one public failure for every request-time send failure. */
export const EMAIL_CODE_FAILURE = Object.freeze({
  error: 'email_code_unavailable' as const,
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
 * Returns only whether a provider-confirmed send committed. Internal failure
 * reasons are for audit evidence; the route maps every one to its single
 * generic public failure.
 */
export async function requestFounderEmailCode(
  deps: EmailCodeDeps,
  input: { draftId: string; campaignId: string },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!deps.notifier) return { ok: false, reason: 'email notifier is not configured' };

  /*
   * The address lives on the claim profile, and the profile is created on
   * first read with the invitation address prefilled. In the flow the email
   * screen has already read it — but a caller that reached this route without
   * one would otherwise fail despite an invited address we already hold.
   * Ensuring here is idempotent.
   */
  const profile = await ensureClaimProfile(deps.db, input.draftId, `draft:${input.draftId}`);

  if (!profile) return { ok: false, reason: 'claim profile is unavailable' };

  try {
    return await deps.db.transaction(async (tx) => {
      /*
       * A transaction-scoped, non-blocking lock makes a concurrent resend a
       * refusal instead of a second email. It is held through provider
       * acceptance: the old code remains visible to every other transaction
       * until this one commits, and a failed delivery rolls the replacement
       * back with the old code still usable.
       */
      const lock = await tx.execute(
        sql`select pg_try_advisory_xact_lock(hashtextextended(${`founder-email-code:${input.draftId}`}, 0)) as acquired`,
      );
      const acquired = (lock.rows[0] as { acquired?: boolean } | undefined)?.acquired === true;
      if (!acquired) return { ok: false as const, reason: 'another code request is in flight' };

      const [current] = await tx
        .select({ email: founderClaimProfiles.email })
        .from(founderClaimProfiles)
        .where(eq(founderClaimProfiles.draftId, input.draftId))
        .for('update')
        .limit(1);
      const email = current?.email?.trim();
      if (!email) return { ok: false as const, reason: 'claim profile has no email address' };

      const { code, record } = await deps.tokens.issueFounderEmailCode(
        input.draftId,
        email,
        tx,
      );
      const notice = await renderEmailCodeNotice({
        code,
        reference: input.campaignId,
        supportEmail: deps.supportEmail,
      });

      const outcome = await deps.notifier!.send({
        eventKey: FOUNDER_EMAIL_CODE,
        entityType: 'secure_token',
        entityId: record.id,
        from: deps.fromAddress,
        to: email,
        subject: notice.subject,
        html: notice.html,
        text: notice.text,
      });

      if (outcome.status !== 'sent') {
        throw new EmailCodeSendFailure(
          outcome.status === 'failed' ? outcome.reason : 'duplicate delivery was suppressed',
        );
      }

      return { ok: true as const };
    });
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'unknown email code send failure',
    };
  }
}

class EmailCodeSendFailure extends Error {}

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
 * `email_ownership` and `email_code_verified_at` are the two views of the same
 * accepted code: one is the current state, the other is the durable instant
 * the Admin panel renders. They are written together so the customer flow and
 * Admin record cannot disagree. The route mints the separate flow
 * authorization only after this succeeds. No account, consent, or campaign
 * status move occurs here.
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

  const verifiedAt = new Date();
  await deps.db
    .update(founderClaimProfiles)
    .set({
      emailOwnership: 'code_verified',
      emailCodeVerifiedAt: verifiedAt,
      updatedAt: verifiedAt,
    })
    .where(eq(founderClaimProfiles.id, profile.id));

  return { ok: true, email };
}
