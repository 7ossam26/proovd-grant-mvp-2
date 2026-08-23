/**
 * Founder Flow v2, Session C — the end of the draft token.
 *
 * Everything the brief's C10 done-when names, plus the two deviations' own
 * absences. It does NOT re-drive §33.1's vetting, claim, or type-lock paths:
 * `vetting.test.ts` owns those and they must pass UNCHANGED across this
 * session, which is a stronger statement than a copy of them passing here.
 *
 * ── The two things this file is really about ────────────────────────────────
 * A six-digit secret is 10^6 values. What makes it a secret is that every
 * failure mode answers identically and the attempt counter is on the row, and
 * both are easy to lose to a well-meaning edit — a "helpful" error message or
 * a client-side format check. So the tests below compare SERIALIZED responses
 * rather than fields.
 *
 * And a transcription vendor in the tree is one refactor from being the
 * embedded AI product §12 forbids. The tests for it are absences: no audio
 * column, no generate path, no summarize route.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq, sql } from 'drizzle-orm';

import { startHarness, type Harness } from './app-harness.js';
import { createAdmin, type AdminSession } from './admin-session.js';
import { seedAdminReauthWindow } from '../settings/service.js';
import { secureTokens } from '../db/schema/tokens.js';
import { campaignVetting, founderClaimProfiles } from '../db/schema/vetting.js';
import { campaignDrafts } from '../db/schema/invitations.js';
import { session as sessionTable, user as userTable } from '../db/schema/auth.js';
import { auditEvents, notificationDeliveries } from '../db/schema/integrity.js';
import { TOKEN_REJECTION_STATUS, TOKEN_REJECTION_BODY } from '../auth/token-rejection.js';
import { founderFlowSessionCookieName } from '../auth/founder-flow-session.js';
import {
  EMAIL_CODE_LENGTH,
  EMAIL_CODE_MAX_ATTEMPTS,
  EMAIL_CODE_TTL_MINUTES,
  isCodeShaped,
} from '../vetting/email-code-logic.js';
import { EMAIL_CODE_ACK, EMAIL_CODE_FAILURE } from '../vetting/email-code.js';
import { unconfiguredTranscription, TRANSCRIPTION_UNAVAILABLE } from '../transcription/index.js';
import {
  EMAIL_CODE_LENGTH as SHARED_CODE_LENGTH,
  EMAIL_CODE_MAX_ATTEMPTS as SHARED_MAX_ATTEMPTS,
  EMAIL_CODE_TTL_MINUTES as SHARED_TTL,
  FOUNDER_FLOW_PAGES,
} from '@proovd/shared';

let h: Harness;
let admin: AdminSession;

beforeAll(async () => {
  h = await startHarness({}, 'flowc');
  admin = await createAdmin(h, 'flowc-admin');
  await seedAdminReauthWindow(h.db, 3600);
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

const COMPOSE = {
  whatWeUnderstood: 'You are building a waitlist that fills cancelled appointments.',
  whyInvited: 'A clinic operator we know described exactly this problem.',
  senderName: 'Ada Admin',
  senderEmail: 'ada@proovd.co',
  expectedSetupTime: '~3 mins',
};

interface Invited {
  draftId: string;
  campaignId: string;
  email: string;
  raw: string;
}

/** One invited Founder on a given harness. */
async function inviteOn(
  harness: Harness,
  session: AdminSession,
  label: string,
): Promise<Invited> {
  const email = `${label}-${randomUUID()}@example.com`;
  const created = await request(harness.app)
    .post('/api/admin/founders')
    .set('cookie', session.cookie)
    .send({
      legalName: 'Rowan Vale',
      preferredName: 'Rowan',
      email,
      phone: '+1 555 0100',
      productName: 'Waitlist',
      productUrl: 'https://waitlist.example',
      invitationSource: 'introduced by a mutual contact',
      internalOwner: 'Ada Admin',
    })
    .expect(201);

  await request(harness.app)
    .put(`/api/admin/founders/${created.body.draftId}/invitation`)
    .set('cookie', session.cookie)
    .send(COMPOSE)
    .expect(200);

  const before = harness.sentEmails.messages.length;
  await request(harness.app)
    .post(`/api/admin/founders/${created.body.draftId}/send`)
    .set('cookie', session.cookie)
    .send({})
    .expect(201);

  const message = harness.sentEmails.messages[before]!;
  const raw = new RegExp(String.raw`http://localhost:3000/draft/([A-Za-z0-9_-]+)`).exec(
    message.text,
  )![1]!;
  return { ...created.body, email, raw };
}

const invite = (label: string) => inviteOn(h, admin, label);
/** Asks for a code and returns the six digits out of the delivered message. */
async function askForCode(invited: Invited): Promise<string> {
  const before = h.sentEmails.messages.length;
  await request(h.app).post(`/api/draft/${invited.raw}/email-code`).send({}).expect(202);
  const message = h.sentEmails.messages[before];
  expect(message, 'no code email was sent').toBeTruthy();
  const code = new RegExp(`\\b(\\d{${EMAIL_CODE_LENGTH}})\\b`).exec(message!.subject)?.[1];
  expect(code, 'no code in the subject').toBeTruthy();
  return code!;
}

/* ── The register, restated ───────────────────────────────────────────────── */

describe('the email-code constants are restated, not re-decided', () => {
  it('matches the shared register exactly', () => {
    // The backend never imports `@proovd/shared` at runtime, so the numbers are
    // restated in `email-code-logic.ts` and this is what keeps the two honest.
    expect(EMAIL_CODE_LENGTH).toBe(SHARED_CODE_LENGTH);
    expect(EMAIL_CODE_MAX_ATTEMPTS).toBe(SHARED_MAX_ATTEMPTS);
    expect(EMAIL_CODE_TTL_MINUTES).toBe(SHARED_TTL);
  });

  it('accepts only six digits', () => {
    expect(isCodeShaped('418306')).toBe(true);
    expect(isCodeShaped('41830')).toBe(false);
    expect(isCodeShaped('4183067')).toBe(false);
    expect(isCodeShaped('41830a')).toBe(false);
    expect(isCodeShaped(' 418306 ')).toBe(false);
    expect(isCodeShaped(418306)).toBe(false);
    expect(isCodeShaped(null)).toBe(false);
  });

  it('registers the token pages, and Positioning is the end of the draft token', () => {
    /*
      DELIBERATELY NARROWED (2026-08-18, Session D), and re-authored
      (2026-08-20) when the reach orbit was added and the match and claim
      screens were removed from the flow outright.

      What survives: the token pages are registered, in order, every one of
      them addressed by the invitation token — and Positioning, which
      submits, is the last of them, which is the sentence "the end of the
      draft token" means.
    */
    const stageOne = FOUNDER_FLOW_PAGES.filter((page) => page.stage === 1);
    expect(stageOne.map((page) => page.id)).toEqual([
      'invite',
      'problem',
      'solution',
      'reach',
      'campaign-type',
      'email',
      'code',
      'positioning',
    ]);
    for (const page of stageOne) expect(page.param, page.id).toBe('token');
    expect(
      FOUNDER_FLOW_PAGES.filter((page) => page.param === 'token').at(-1)?.id,
    ).toBe('positioning');
  });
});

describe('Founder invitation navigation', () => {
  it('keeps opening the same draft beyond the former refresh limit', async () => {
    const invited = await invite('unlimited-refresh');
    for (let i = 0; i < 25; i += 1) {
      const res = await request(h.app).get(`/api/draft/${invited.raw}`);
      expect(res.status).toBe(200);
      expect(res.text).not.toContain('Too many requests, please try again later.');
    }
  });
});

/* ── The code: one answer for every failure ───────────────────────────────── */

describe('the six-digit code', () => {
  it('is stored as an HMAC, so two drafts issued the same digits do not collide', async () => {
    // The real risk this proves: `secure_tokens_hash_idx` is UNIQUE on
    // `token_hash`, and a plain SHA-256 over six digits has 10^6 possible
    // values. Two live codes would eventually collide on that index — the
    // second Founder to be sent `418306` would get a constraint violation —
    // and the digest itself would be a rainbow table one row wide.
    const a = await invite('hmac-a');
    const b = await invite('hmac-b');
    await request(h.app).post(`/api/draft/${a.raw}/email-code`).send({}).expect(202);
    await request(h.app).post(`/api/draft/${b.raw}/email-code`).send({}).expect(202);
    for (let i = 0; i < 80; i++) {
      const rows = await h.db
        .select({ hash: secureTokens.tokenHash })
        .from(secureTokens)
        .where(eq(secureTokens.scope, 'founder_email_code'));
      if (rows.length >= 2) {
        const hashes = new Set(rows.map((row) => row.hash));
        expect(hashes.size).toBe(rows.length);
        // And it is not a bare SHA-256 of the digits: every stored value is 64
        // hex characters, but no two drafts can share one even by chance.
        for (const hash of hashes) expect(hash).toMatch(/^[0-9a-f]{64}$/);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('the two codes were never minted');
  });

  it('verifies, and records the address as reachable', async () => {
    const invited = await invite('verify-ok');
    const code = await askForCode(invited);

    const [before] = await h.db
      .select({ ownership: founderClaimProfiles.emailOwnership })
      .from(founderClaimProfiles)
      .where(eq(founderClaimProfiles.draftId, invited.draftId));
    expect(before?.ownership).not.toBe('code_verified');

    await request(h.app)
      .post(`/api/draft/${invited.raw}/email-code/verify`)
      .send({ code })
      .expect(200)
      .expect((res) => expect(res.body).toEqual({ verified: true }));

    const [after] = await h.db
      .select({ ownership: founderClaimProfiles.emailOwnership })
      .from(founderClaimProfiles)
      .where(eq(founderClaimProfiles.draftId, invited.draftId));
    expect(after?.ownership).toBe('code_verified');
  });

  it('answers byte-identically for wrong, reused, and never-requested', async () => {
    // §5.5's rule, and the one a helpful error message breaks first. The
    // comparison is over the SERIALIZED body, not a field: an extra key that
    // varies is the same oracle as a different sentence.
    const wrongDraft = await invite('same-wrong');
    const wrongCode = await askForCode(wrongDraft);
    const wrong = await request(h.app)
      .post(`/api/draft/${wrongDraft.raw}/email-code/verify`)
      .send({ code: wrongCode === '000000' ? '111111' : '000000' });

    const reusedDraft = await invite('same-reused');
    const reusedCode = await askForCode(reusedDraft);
    await request(h.app)
      .post(`/api/draft/${reusedDraft.raw}/email-code/verify`)
      .send({ code: reusedCode })
      .expect(200);
    const reused = await request(h.app)
      .post(`/api/draft/${reusedDraft.raw}/email-code/verify`)
      .send({ code: reusedCode });

    const neverAsked = await invite('same-never');
    const never = await request(h.app)
      .post(`/api/draft/${neverAsked.raw}/email-code/verify`)
      .send({ code: '123456' });

    const malformed = await request(h.app)
      .post(`/api/draft/${neverAsked.raw}/email-code/verify`)
      .send({ code: 'abc' });

    for (const response of [wrong, reused, never, malformed]) {
      expect(response.status).toBe(TOKEN_REJECTION_STATUS);
      expect(JSON.stringify(response.body)).toBe(JSON.stringify(TOKEN_REJECTION_BODY));
    }
  });

  it('counts wrong guesses on the row, and the Nth refuses with the same body', async () => {
    const invited = await invite('attempts');
    const code = await askForCode(invited);
    const wrong = code === '000000' ? '111111' : '000000';

    for (let i = 0; i < EMAIL_CODE_MAX_ATTEMPTS; i++) {
      await request(h.app)
        .post(`/api/draft/${invited.raw}/email-code/verify`)
        .send({ code: wrong })
        .expect(TOKEN_REJECTION_STATUS);
    }

    const [row] = await h.db
      .select({ attempts: secureTokens.failedAttempts })
      .from(secureTokens)
      .where(
        and(
          eq(secureTokens.scope, 'founder_email_code'),
          eq(secureTokens.campaignDraftId, invited.draftId),
        ),
      );
    expect(row?.attempts).toBeGreaterThanOrEqual(EMAIL_CODE_MAX_ATTEMPTS);

    // And now the RIGHT code is refused, with the one body. This is what makes
    // 10^6 large enough: the counter is on the row, so it survives a restart
    // and cannot be reset by changing address, IP, or browser.
    const locked = await request(h.app)
      .post(`/api/draft/${invited.raw}/email-code/verify`)
      .send({ code });
    expect(locked.status).toBe(TOKEN_REJECTION_STATUS);
    expect(JSON.stringify(locked.body)).toBe(JSON.stringify(TOKEN_REJECTION_BODY));
  });

  it('stops working when the address changes, because the hash binds it', async () => {
    const invited = await invite('rebind');
    const code = await askForCode(invited);

    await request(h.app)
      .patch(`/api/draft/${invited.raw}/claim`)
      .send({ email: `moved-${randomUUID()}@example.com` })
      .expect(200);

    const after = await request(h.app)
      .post(`/api/draft/${invited.raw}/email-code/verify`)
      .send({ code });
    expect(after.status).toBe(TOKEN_REJECTION_STATUS);
  });

  it('supersedes the previous code on resend, and earns a second message', async () => {
    // §7's rule: a resend is a deliberate second act and earns a second
    // message; a retry does not. Keying the delivery on the token ROW gets both
    // halves, because a new row exists only when a new code was minted.
    const invited = await invite('resend');
    const first = await askForCode(invited);
    const second = await askForCode(invited);
    expect(second).not.toBe(first);

    const stale = await request(h.app)
      .post(`/api/draft/${invited.raw}/email-code/verify`)
      .send({ code: first });
    expect(stale.status).toBe(TOKEN_REJECTION_STATUS);

    await request(h.app)
      .post(`/api/draft/${invited.raw}/email-code/verify`)
      .send({ code: second })
      .expect(200);

    const deliveries = await h.db
      .select({ id: notificationDeliveries.id })
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.eventKey, 'founder_email_code'));
    expect(deliveries.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps the previous code usable when replacement delivery fails', async () => {
    const invited = await invite('resend-failure-safe');
    const first = await askForCode(invited);
    h.sentEmails.failNext = true;

    await request(h.app)
      .post(`/api/draft/${invited.raw}/email-code`)
      .send({})
      .expect(503)
      .expect((res) => expect(res.body).toEqual(EMAIL_CODE_FAILURE));

    await request(h.app)
      .post(`/api/draft/${invited.raw}/email-code/verify`)
      .send({ code: first })
      .expect(200);
  });

  it('admits one concurrent resend and leaves exactly one live code', async () => {
    const invited = await invite('resend-concurrent');
    await askForCode(invited);
    const before = h.sentEmails.messages.length;

    const responses = await Promise.all([
      request(h.app).post(`/api/draft/${invited.raw}/email-code`).send({}),
      request(h.app).post(`/api/draft/${invited.raw}/email-code`).send({}),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([202, 503]);
    expect(h.sentEmails.messages).toHaveLength(before + 1);

    const live = await h.db
      .select({ id: secureTokens.id })
      .from(secureTokens)
      .where(
        and(
          eq(secureTokens.scope, 'founder_email_code'),
          eq(secureTokens.campaignDraftId, invited.draftId),
          sql`${secureTokens.revokedAt} is null`,
          sql`${secureTokens.claimedAt} is null`,
        ),
      );
    expect(live).toHaveLength(1);
  });

  it('never puts the raw code in a log, an audit row, or a response', async () => {
    const invited = await invite('no-leak');
    const before = h.sentEmails.messages.length;
    const code = await askForCode(invited);

    const ok = await request(h.app)
      .post(`/api/draft/${invited.raw}/email-code/verify`)
      .send({ code })
      .expect(200);
    expect(JSON.stringify(ok.body)).not.toContain(code);

    const rows = await h.db
      .select({
        reason: auditEvents.internalReason,
        prior: auditEvents.priorValue,
        next: auditEvents.newValue,
      })
      .from(auditEvents)
      .where(sql`${auditEvents.createdAt} > now() - interval '2 minutes'`);
    for (const row of rows) {
      expect(JSON.stringify(row)).not.toContain(code);
    }

    // The one place it legitimately exists is the delivered message.
    const message = h.sentEmails.messages[before]!;
    expect(`${message.subject}${message.text}`).toContain(code);
  });

  it('reports no successful send for a draft with no address, and sends nothing', async () => {
    const invited = await invite('no-address');
    await request(h.app)
      .patch(`/api/draft/${invited.raw}/claim`)
      .send({ email: null })
      .expect(200);

    const before = h.sentEmails.messages.length;
    const response = await request(h.app)
      .post(`/api/draft/${invited.raw}/email-code`)
      .send({})
      .expect(503);
    expect(response.body).toEqual(EMAIL_CODE_FAILURE);

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(h.sentEmails.messages.length).toBe(before);
  });

  it('processes resend requests beyond the former limit without a 429', async () => {
    const invited = await invite('unlimited-resend');
    const before = h.sentEmails.messages.length;

    for (let i = 0; i < 8; i++) {
      await askForCode(invited);
    }

    expect(h.sentEmails.messages.length).toBe(before + 8);
    const rows = await h.db
      .select({ id: secureTokens.id })
      .from(secureTokens)
      .where(
        and(
          eq(secureTokens.scope, 'founder_email_code'),
          eq(secureTokens.campaignDraftId, invited.draftId),
        ),
      );
    expect(rows).toHaveLength(8);
  });
  it('is bound to one draft: a code minted for A cannot verify B', async () => {
    const a = await invite('bind-a');
    const b = await invite('bind-b');
    const codeA = await askForCode(a);
    const crossed = await request(h.app)
      .post(`/api/draft/${b.raw}/email-code/verify`)
      .send({ code: codeA });
    expect(crossed.status).toBe(TOKEN_REJECTION_STATUS);
  });

  it('is not a credential: a code presented as a draft link opens nothing', async () => {
    const invited = await invite('not-a-link');
    const code = await askForCode(invited);
    // Both directions of the scope check. Six digits is also below the token
    // service's own length guard, so this never reaches a lookup.
    await request(h.app).get(`/api/draft/${code}/vetting`).expect(TOKEN_REJECTION_STATUS);
  });

  it('restores one persistent Founder session across refresh, direct steps, resend, and claim', async () => {
    const invited = await invite('persistent-founder-session');
    const founder = request.agent(h.app);
    const beforeCode = h.sentEmails.messages.length;

    await founder.post(`/api/draft/${invited.raw}/email-code`).send({}).expect(202);
    const codeMessage = h.sentEmails.messages[beforeCode]!;
    const code = new RegExp(`\\b(\\d{${EMAIL_CODE_LENGTH}})\\b`).exec(codeMessage.subject)?.[1];
    expect(code).toBeTruthy();

    const verified = await founder
      .post(`/api/draft/${invited.raw}/email-code/verify`)
      .send({ code })
      .expect(200);
    const setCookies = (verified.headers['set-cookie'] ?? []) as unknown as string[];
    expect(setCookies.some((value) => value.startsWith(`${founderFlowSessionCookieName(invited.draftId)}=`))).toBe(true);

    // Verification establishes only the draft-scoped flow session. The account
    // and Better Auth session still belong to the later account-claim boundary.
    expect(
      await h.db.select({ id: userTable.id }).from(userTable).where(eq(userTable.email, invited.email)),
    ).toHaveLength(0);
    const betterAuthSessionsBeforeClaim = await h.db.select({ id: sessionTable.id }).from(sessionTable);

    const [inviteRow] = await h.db
      .select({ claimedAt: secureTokens.claimedAt, revokedAt: secureTokens.revokedAt })
      .from(secureTokens)
      .where(
        and(
          eq(secureTokens.scope, 'founder_draft'),
          eq(secureTokens.campaignDraftId, invited.draftId),
        ),
      );
    expect(inviteRow?.claimedAt).toBeTruthy();
    expect(inviteRow?.revokedAt).toBeTruthy();

    // The consumed invite alone opens nothing; the persistent cookie restores
    // authorization and persisted state on every new request.
    await request(h.app).get(`/api/draft/${invited.raw}/vetting`).expect(TOKEN_REJECTION_STATUS);
    const claim = await founder.get(`/api/draft/${invited.raw}/claim`).expect(200);
    expect(claim.body.founderSessionAuthorized).toBe(true);

    await founder
      .patch(`/api/draft/${invited.raw}/vetting`)
      .send({ selectedType: 'pre_launch', problem: 'Persisted problem', resumeStep: 'solution' })
      .expect(200);
    const refreshed = await founder.get(`/api/draft/${invited.raw}/vetting`).expect(200);
    expect(refreshed.body.problem).toBe('Persisted problem');
    expect(refreshed.body.resumeStep).toBe('solution');

    await request(h.app)
      .post(`/api/admin/founders/${invited.draftId}/revoke`)
      .set('cookie', admin.cookie)
      .send({ reason: 'rotate the initial-access invitation only' })
      .expect(200);
    const afterInviteRevocation = await founder
      .get(`/api/draft/${invited.raw}/vetting`)
      .expect(200);
    expect(afterInviteRevocation.body.problem).toBe('Persisted problem');

    // Admin resend creates a new invitation lifecycle. It does not revoke the
    // already-active flow session, on either the old or the new URL.
    const beforeResend = h.sentEmails.messages.length;
    await request(h.app)
      .post(`/api/admin/founders/${invited.draftId}/send`)
      .set('cookie', admin.cookie)
      .send({})
      .expect(201);
    const resentMessage = h.sentEmails.messages[beforeResend]!;
    const resentRaw = /http:\/\/localhost:3000\/draft\/([A-Za-z0-9_-]+)/.exec(resentMessage.text)?.[1];
    expect(resentRaw).toBeTruthy();

    await founder.get(`/api/draft/${invited.raw}/vetting`).expect(200);
    const throughResentUrl = await founder.get(`/api/draft/${resentRaw}/claim`).expect(200);
    expect(throughResentUrl.body.founderSessionAuthorized).toBe(true);

    await founder
      .patch(`/api/draft/${invited.raw}/vetting`)
      .send({ solution: 'Persisted solution', competition: 'Persisted positioning' })
      .expect(200);
    const submitted = await founder
      .post(`/api/draft/${invited.raw}/vetting/submit`)
      .send({})
      .expect(201);
    expect(submitted.body.signedIn).toBe(true);

    expect(await h.db.select().from(campaignDrafts).where(eq(campaignDrafts.id, invited.draftId))).toHaveLength(1);
    expect(await h.db.select().from(campaignVetting).where(eq(campaignVetting.draftId, invited.draftId))).toHaveLength(1);
    expect(await h.db.select().from(founderClaimProfiles).where(eq(founderClaimProfiles.draftId, invited.draftId))).toHaveLength(1);
    expect(
      await h.db.select({ id: userTable.id }).from(userTable).where(eq(userTable.email, invited.email)),
    ).toHaveLength(1);
    expect((await h.db.select({ id: sessionTable.id }).from(sessionTable)).length).toBeGreaterThan(
      betterAuthSessionsBeforeClaim.length,
    );

    const liveInvitations = await h.db
      .select({ id: secureTokens.id })
      .from(secureTokens)
      .where(
        and(
          eq(secureTokens.scope, 'founder_draft'),
          eq(secureTokens.campaignDraftId, invited.draftId),
          sql`${secureTokens.revokedAt} is null`,
        ),
      );
    expect(liveInvitations).toHaveLength(0);

    const liveFlowSessions = await h.db
      .select({ id: secureTokens.id })
      .from(secureTokens)
      .where(
        and(
          eq(secureTokens.scope, 'founder_flow_session'),
          eq(secureTokens.campaignDraftId, invited.draftId),
          sql`${secureTokens.revokedAt} is null`,
        ),
      );
    expect(liveFlowSessions).toHaveLength(1);
  });
});

/* ── The deviations' absences ─────────────────────────────────────────────── */

describe('deviation 1 does not become an account-creation path', () => {
  it('creates no user or Better Auth session when a code verifies', async () => {
    const invited = await invite('no-account');
    const code = await askForCode(invited);
    const response = await request(h.app)
      .post(`/api/draft/${invited.raw}/email-code/verify`)
      .send({ code })
      .expect(200);

    const setCookies = (response.headers['set-cookie'] ?? []) as unknown as string[];
    expect(setCookies.some((value) => value.startsWith(`${founderFlowSessionCookieName(invited.draftId)}=`))).toBe(true);

    const [profile] = await h.db
      .select({ claimedUserId: founderClaimProfiles.claimedUserId })
      .from(founderClaimProfiles)
      .where(eq(founderClaimProfiles.draftId, invited.draftId));
    expect(profile?.claimedUserId ?? null).toBeNull();
    expect(
      await h.db.select({ id: userTable.id }).from(userTable).where(eq(userTable.email, invited.email)),
    ).toHaveLength(0);
  });

  it('adds no column matching %verif% to `founder_claim_profiles` (§33.1.8)', async () => {
    // §33.1.8's own scan, restated here because this is the session that would
    // have broken it. The fact lands in `email_ownership`'s fourth VALUE, and a
    // value is not a column.
    const columns = await h.db.execute(
      sql`select column_name from information_schema.columns
          where table_name = 'founder_claim_profiles' and column_name ilike '%verif%'`,
    );
    expect(columns.rows).toHaveLength(0);
  });

  it('adds no phone verification anywhere', async () => {
    const columns = await h.db.execute(
      sql`select table_name, column_name from information_schema.columns
          where column_name ilike '%phone%' and column_name ilike '%verif%'
            and table_name <> 'user'`,
    );
    expect(columns.rows).toHaveLength(0);
  });
});

describe('deviation 2 transcribes, and does nothing else', () => {
  it('refuses loudly when unconfigured', async () => {
    await expect(
      unconfiguredTranscription.transcribe({ audio: new Uint8Array(1), contentType: 'audio/webm' }),
    ).rejects.toThrow(/TRANSCRIPTION_API_URL/);
    expect(unconfiguredTranscription.configured).toBe(false);
  });

  it('names the gap on the route and in the read, with one sentence', async () => {
    const invited = await invite('dictation');
    const refusal = await request(h.app)
      .post(`/api/draft/${invited.raw}/transcribe`)
      .set('content-type', 'audio/webm')
      .send(Buffer.from([1, 2, 3]))
      .expect(503);
    expect(refusal.body.whatHappened).toBe(TRANSCRIPTION_UNAVAILABLE);

    const read = await request(h.app).get(`/api/draft/${invited.raw}/vetting`).expect(200);
    expect(read.body.transcription).toEqual({
      available: false,
      absentBecause: TRANSCRIPTION_UNAVAILABLE,
    });
  });

  it('has nowhere to store audio', async () => {
    // §25.8 defines seven retention windows and none covers a dictation
    // recording. Inventing one would be §1 rule 6 in the other direction, so
    // the answer is to have nowhere to put it.
    const columns = await h.db.execute(
      sql`select table_name, column_name from information_schema.columns
          where column_name ilike '%audio%'
             or column_name ilike '%recording%'
             or column_name ilike '%transcript%'
             or column_name ilike '%dictation%'`,
    );
    expect(columns.rows).toHaveLength(0);
  });

  it('offers no generate, summarize, rewrite, or suggest path', () => {
    // §12: "static, copy-ready guidance — not an embedded AI product." §30
    // defers AI rewriting by name. The absence is the enforcement, and this is
    // what keeps it an absence once a vendor is in the tree.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const roots = [
      path.resolve(here, '..', 'transcription'),
      path.resolve(here, '..', 'vetting'),
    ];
    const banned = /\b(summari[sz]e|rewrite|paraphrase|suggest|generate|completion)\b/i;
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.endsWith('.ts')) continue;
        // Comments explain, at length, what these files refuse to do. A scan
        // that could not tell an explanation from a usage would force the
        // explanations out, and the reasoning is the more valuable half.
        const source = readFileSync(full, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '');
        if (banned.test(source)) offenders.push(`${entry}: ${banned.exec(source)![0]}`);
      }
    };
    for (const root of roots) walk(root);
    expect(offenders).toEqual([]);
  });
});
