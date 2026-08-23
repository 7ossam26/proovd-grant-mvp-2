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
import { Body, Container, Head, Heading, Hr, Html, Preview, Section, Text } from '@react-email/components';
import { render } from '@react-email/render';
import type { Database } from '../db/client.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { ensureClaimProfile } from './claim.js';
import type { TokenService } from '../auth/token-service.js';
import { TOKEN_INVALID, type TokenInvalid } from '../auth/token-service.js';
import type { Notifier } from '../notifications/send.js';
import { FOUNDER_EMAIL_CODE } from '../notifications/events.js';
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
  founderName?: string | null;
  companyName?: string | null;
}) {
  const founderName = input.founderName?.trim() || '';
  const companyName = input.companyName?.trim() || '';
  const greeting = founderName ? `${founderName}, here’s your code.` : 'Here’s your code.';
  const formattedCode = `${input.code.slice(0, 3)}\u00a0${input.code.slice(3)}`;
  const subject = 'Your proovd confirmation code';
  const text = [
    greeting,
    '',
    "Type it into proovd to confirm it's you. It expires in 10 minutes.",
    '',
    formattedCode.replace('\u00a0', ' '),
    '',
    "Didn't ask for a code? Ignore this email and nothing happens.",
    '',
    companyName ? `Wishing ${companyName} the best,` : 'Wishing you the best,',
    'the Proovd team.',
    '',
    `Questions: ${input.supportEmail}`,
    `Reference: ${input.reference}`,
  ].join('\n');

  return {
    subject,
    html: await render(
      <Html lang="en">
        <Head />
        <Preview>Type it in to confirm it's you it expires in 10 minutes.</Preview>
        <Body style={codeBody}>
          <Container style={codeContainer}>
            <Text style={codeWordmark}>proovd</Text>
            <Heading style={codeHeading}>{greeting}</Heading>
            <Text style={codeIntro}>
              Type it into proovd to confirm it's you. It expires in 10 minutes.
            </Text>
            <Section style={codeBox}>
              <Text style={codeDigits}>{formattedCode}</Text>
            </Section>
            <Text style={codeQuiet}>
              Didn't ask for a code? Ignore this email and nothing happens.
            </Text>
            <Hr style={codeRule} />
            <Text style={codeSignoff}>
              {companyName ? `Wishing ${companyName} the best,` : 'Wishing you the best,'}
              <br />
              the Proovd team.
            </Text>
            <Text style={codeFooter}>
              You're getting this because your email was used to confirm your address on
              proovd. Questions: {input.supportEmail}
              <br />
              Reference: {input.reference}
              <br />
              Proovd, 254 Chapman Rd, Ste 208 #27541, Newark, Delaware 19702
            </Text>
          </Container>
        </Body>
      </Html>,
    ),
    text,
  };
}

const codeBody = {
  backgroundColor: '#F1F3F2',
  fontFamily: 'Satoshi, Arial, Helvetica, sans-serif',
  margin: 0,
  padding: '24px 12px',
};
const codeContainer = { backgroundColor: '#FAFAFA', maxWidth: '600px', margin: '0 auto', padding: '44px' };
const codeWordmark = { fontSize: '20px', fontWeight: 700, letterSpacing: '-0.02em', lineHeight: '24px', color: '#012D10', margin: 0 };
const codeHeading = { fontSize: '38px', fontWeight: 700, letterSpacing: '-0.03em', lineHeight: '46px', color: '#012D10', margin: '42px 0 0' };
const codeIntro = { fontSize: '18px', fontWeight: 500, letterSpacing: '-0.012em', lineHeight: '28px', color: '#013F17', margin: '22px 0 0' };
const codeBox = { border: '2px solid #41ED98', borderRadius: '1px', backgroundColor: '#F1F9F5', padding: '26px 20px', margin: '36px 0 0', textAlign: 'center' as const };
const codeDigits = { fontSize: '40px', fontWeight: 700, letterSpacing: '0.18em', lineHeight: '48px', color: '#012D10', margin: 0 };
const codeQuiet = { fontSize: '14px', fontWeight: 500, lineHeight: '22px', color: '#A2AFA8', margin: '22px 0 0' };
const codeRule = { borderColor: '#41ED98', margin: '48px 0 30px' };
const codeSignoff = { fontSize: '17px', fontWeight: 500, lineHeight: '27px', color: '#013F17', margin: 0 };
const codeFooter = { fontSize: '12px', fontWeight: 500, lineHeight: '20px', color: '#A2AFA8', margin: '26px 0 0' };

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
        .select({
          email: founderClaimProfiles.email,
          legalName: founderClaimProfiles.legalName,
          preferredName: founderClaimProfiles.preferredName,
          businessName: founderClaimProfiles.businessName,
        })
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
        founderName: current.preferredName || current.legalName,
        companyName: current.businessName,
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
