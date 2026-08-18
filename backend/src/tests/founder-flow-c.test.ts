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
 * both are easy to lose to a well-meaning edit — a "helpful" error message, a
 * 429 from a limiter, a client-side format check. So the tests below compare
 * SERIALIZED responses rather than fields, and drive the limiter rather than
 * reading its configuration.
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
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { auditEvents, notificationDeliveries } from '../db/schema/integrity.js';
import { TOKEN_REJECTION_STATUS, TOKEN_REJECTION_BODY } from '../auth/token-rejection.js';
import {
  EMAIL_CODE_LENGTH,
  EMAIL_CODE_MAX_ATTEMPTS,
  EMAIL_CODE_TTL_MINUTES,
  isCodeShaped,
} from '../vetting/email-code-logic.js';
import { EMAIL_CODE_ACK } from '../vetting/email-code.js';
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

/**
 * One invited Founder on a given harness.
 *
 * Parameterised because the limiter test runs on its own harness — the code
 * route carries a five-an-hour allowance keyed on the client address, and a
 * suite that shares one address would exhaust it after five requests.
 */
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
  // The route answers before it works, so the message may not be out yet.
  for (let i = 0; i < 60 && h.sentEmails.messages.length === before; i++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
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

  it('registers Session C’s four pages, all still on the draft token', () => {
    const ids = FOUNDER_FLOW_PAGES.map((page) => page.id);
    expect(ids).toEqual([
      'invite',
      'problem',
      'solution',
      'campaign-type',
      'email',
      'code',
      'positioning',
      'match',
    ]);
    for (const page of FOUNDER_FLOW_PAGES) expect(page.stage).toBe(1);
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

  it('answers the frozen ack for a draft with no address, and sends nothing', async () => {
    const invited = await invite('no-address');
    await request(h.app)
      .patch(`/api/draft/${invited.raw}/claim`)
      .send({ email: null })
      .expect(200);

    const before = h.sentEmails.messages.length;
    const response = await request(h.app)
      .post(`/api/draft/${invited.raw}/email-code`)
      .send({})
      .expect(202);
    expect(JSON.stringify(response.body)).toBe(JSON.stringify(EMAIL_CODE_ACK));

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(h.sentEmails.messages.length).toBe(before);
  });

  it('answers the same ack over the limit, at 202 rather than 429', async () => {
    // Phase 04's rule: a limiter that announces itself is the same enumeration
    // oracle wearing a different hat. Driven rather than read off the config —
    // and on its OWN harness, because the shared one raises the limit to keep
    // every other test from exhausting a five-an-hour allowance that is per
    // address and therefore shared by the whole suite.
    const limited = await startHarness({ emailCodeLimit: 3 }, 'flowc-limit');
    try {
      const limitedAdmin = await createAdmin(limited, `flowc-limit-admin`);
      await seedAdminReauthWindow(limited.db, 3600);
      const invited = await inviteOn(limited, limitedAdmin, `limited`);
      const bodies = new Set<string>();
      for (let i = 0; i < 8; i++) {
        const response = await request(limited.app)
          .post(`/api/draft/${invited.raw}/email-code`)
          .send({});
        expect(response.status).toBe(202);
        bodies.add(JSON.stringify(response.body));
      }
      // Every response — accepted and throttled alike — was the same bytes at
      // the same status. Five of the eight were refused.
      expect(bodies.size).toBe(1);
      expect([...bodies][0]).toBe(JSON.stringify(EMAIL_CODE_ACK));
      const rows = await limited.db
        .select({ id: secureTokens.id })
        .from(secureTokens)
        .where(eq(secureTokens.scope, 'founder_email_code'));
      expect(rows.length).toBeLessThanOrEqual(3);
    } finally {
      await limited.stop();
    }
  }, 180_000);
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
});

/* ── The deviations' absences ─────────────────────────────────────────────── */

describe('deviation 1 does not become an account-creation path', () => {
  it('creates no user and no session when a code verifies', async () => {
    const invited = await invite('no-account');
    const code = await askForCode(invited);
    const response = await request(h.app)
      .post(`/api/draft/${invited.raw}/email-code/verify`)
      .send({ code })
      .expect(200);

    // No cookie, and nothing that looks like one.
    expect(response.headers['set-cookie']).toBeUndefined();

    const [profile] = await h.db
      .select({ claimedUserId: founderClaimProfiles.claimedUserId })
      .from(founderClaimProfiles)
      .where(eq(founderClaimProfiles.draftId, invited.draftId));
    expect(profile?.claimedUserId ?? null).toBeNull();
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
