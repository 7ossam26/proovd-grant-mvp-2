/**
 * Phase 04 acceptance suite — §33.1.1, §33.1.2, §33.1.8, §33.12.5, and the
 * parts of §33.2.1 and §33.5.13 this phase's mechanism can settle.
 *
 * Four actors, two mechanisms. Everything below is about proving the seam
 * between them holds: that a token grants exactly one scope and nothing else,
 * that every way of failing looks the same from outside, and that an Admin
 * cannot reach a sensitive action on a stale session or an unenrolled factor.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express, { type Express } from 'express';
import { randomUUID } from 'node:crypto';
import { eq, and, desc } from 'drizzle-orm';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOTP } from '@better-auth/utils/otp';
import { base32 } from '@better-auth/utils/base32';

import { startHarness, type Harness, TEST_REAUTH_WINDOW_SECONDS } from './app-harness.js';
import { secureTokens } from '../db/schema/tokens.js';
import { auditEvents } from '../db/schema/integrity.js';
import { user as userTable, session as sessionTable } from '../db/schema/auth.js';
import { seedAccount } from '../auth/seed.js';
import { createAuditWriter } from '../auth/audit.js';
import {
  requireDraftToken,
  requireMagicLinkToken,
  createTokenVerifyLimiter,
} from '../auth/token-middleware.js';
import { requireAdmin, requireFreshSession, requireRole } from '../auth/guards.js';
import { TOKEN_REJECTION_STATUS, TOKEN_REJECTION_BODY } from '../auth/token-rejection.js';
import { redactTokenUrl, REDACTED } from '../auth/token-routes.js';
import { DRAFT_TTL_DAYS, MAGIC_LINK_GRACE_DAYS } from '../auth/token-service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let h: Harness;
/** Token middleware and guards, mounted the way a product route will mount them. */
let probe: Express;
/** Same, but with a deliberately tiny verification limit. */
let limited: Express;

beforeAll(async () => {
  h = await startHarness({}, 'authtokens');

  probe = express();
  // §33.1.1: the route learns the draft id ONLY from the verified subject. It
  // is never given one by the caller, so there is no id to tamper with and no
  // second draft it could be argued into serving.
  probe.get('/api/draft/:token', requireDraftToken(h.tokens), (req, res) => {
    res.json({ subject: req.draftSubject, version: req.secureToken?.version });
  });
  probe.get('/api/link/:token', requireMagicLinkToken(h.tokens), (req, res) => {
    res.json({ subject: req.magicLinkSubject });
  });
  probe.get('/probe/admin', requireAdmin(h.auth), (req, res) => {
    res.json({ ok: true, role: req.authUser?.role });
  });
  probe.get('/probe/founder', requireRole(h.auth, 'founder'), (_req, res) => {
    res.json({ ok: true });
  });
  // Stands in for the §5.1 list — money movement, refunds, connected-account
  // actions, campaign kill/suspend — none of which exist yet.
  probe.post('/probe/sensitive', requireFreshSession(h.auth, TEST_REAUTH_WINDOW_SECONDS), (_req, res) => {
    res.json({ ok: true });
  });

  limited = express();
  limited.get(
    '/api/draft/:token',
    createTokenVerifyLimiter({ limit: 3, windowMs: 60_000 }),
    requireDraftToken(h.tokens),
    (_req, res) => res.json({ ok: true }),
  );
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

/* ── helpers ──────────────────────────────────────────────────────────────── */

async function issueDraft(): Promise<{ raw: string; draftId: string; lineageId: string; id: string }> {
  const draftId = randomUUID();
  const { raw, record } = await h.tokens.issue({
    scope: 'founder_draft',
    campaignDraftId: draftId,
  });
  return { raw, draftId, lineageId: record.lineageId, id: record.id };
}

async function issueMagicLink(): Promise<{
  raw: string;
  campaignId: string;
  backerIdentityId: string;
  lineageId: string;
  id: string;
}> {
  const campaignId = randomUUID();
  const backerIdentityId = randomUUID();
  const { raw, record } = await h.tokens.issue({
    scope: 'backer_magic_link',
    campaignId,
    backerIdentityId,
  });
  return { raw, campaignId, backerIdentityId, lineageId: record.lineageId, id: record.id };
}

/** A token that is well-formed but was never issued. */
function neverIssuedToken(): string {
  return Buffer.from(randomUUID() + randomUUID()).toString('base64url');
}

interface Rejection {
  status: number;
  body: unknown;
  contentLength: string | undefined;
}

async function rejectionOf(app: Express, url: string): Promise<Rejection> {
  const res = await request(app).get(url);
  return {
    status: res.status,
    body: res.body,
    contentLength: res.headers['content-length'],
  };
}

/* ── §33.1.1 — a draft link opens without an account and grants nothing else ─ */

describe('§33.1.1 personalized draft link opens without an account and grants no other access', () => {
  it('opens the invited draft with no session, no cookie, and no account', async () => {
    const { raw, draftId } = await issueDraft();

    const res = await request(probe).get(`/api/draft/${raw}`);

    expect(res.status).toBe(200);
    expect(res.body.subject).toEqual({ scope: 'founder_draft', campaignDraftId: draftId });
    // Guest access: nothing was set that could become a login.
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('creates no user, session, or account row — the draft has no account behind it', async () => {
    const before = await h.db.select().from(userTable);
    const beforeSessions = await h.db.select().from(sessionTable);

    const { raw } = await issueDraft();
    await request(probe).get(`/api/draft/${raw}`).expect(200);

    expect(await h.db.select().from(userTable)).toHaveLength(before.length);
    expect(await h.db.select().from(sessionTable)).toHaveLength(beforeSessions.length);
  });

  it('carries no Admin, payment, or account authority — the subject is one draft id and nothing more', async () => {
    const { raw } = await issueDraft();
    const res = await request(probe).get(`/api/draft/${raw}`).expect(200);

    expect(Object.keys(res.body.subject).sort()).toEqual(['campaignDraftId', 'scope']);

    // The same token cannot reach an Admin or role-guarded surface: those read
    // a Better Auth session, which a draft token never creates.
    await request(probe).get('/probe/admin').set('authorization', `Bearer ${raw}`).expect(401);
    await request(probe).get('/probe/founder').set('authorization', `Bearer ${raw}`).expect(401);
  });

  it("grants no access to another Founder's draft", async () => {
    const a = await issueDraft();
    const b = await issueDraft();

    const resA = await request(probe).get(`/api/draft/${a.raw}`).expect(200);
    const resB = await request(probe).get(`/api/draft/${b.raw}`).expect(200);

    expect(resA.body.subject.campaignDraftId).toBe(a.draftId);
    expect(resB.body.subject.campaignDraftId).toBe(b.draftId);
    expect(resA.body.subject.campaignDraftId).not.toBe(b.draftId);
  });

  it('is scoped in the database, not only in code — an unbound token cannot be stored', async () => {
    // §28.1 scope binding. A row claiming to be a draft token while carrying a
    // campaign/backer pair is what "grants no other access" would fail on.
    await expect(
      h.pool.query(
        `INSERT INTO secure_tokens (scope, token_hash, lineage_id, campaign_draft_id, campaign_id, backer_identity_id)
         VALUES ('founder_draft', $1, $2, $3, $4, $5)`,
        [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '23514' });

    await expect(
      h.pool.query(
        `INSERT INTO secure_tokens (scope, token_hash, lineage_id) VALUES ('founder_draft', $1, $2)`,
        [randomUUID(), randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

/* ── §33.1.2 — every failure mode fails safely and identically ─────────────── */

describe('§33.1.2 alteration, cross-scope, replay, expiry, revocation, resend, and simultaneous claim fail safely', () => {
  it('produces a byte-identical rejection for all seven failure modes', async () => {
    // 1. altered
    const altered = await issueDraft();
    const flipped =
      altered.raw.slice(0, -1) + (altered.raw.slice(-1) === 'A' ? 'B' : 'A');

    // 2. cross-scope: a magic link presented at the draft route
    const crossScope = await issueMagicLink();

    // 3. replayed after claim
    const replayed = await issueDraft();
    await h.tokens.claimDraft(replayed.id);

    // 4. expired
    const expired = await issueDraft();
    await h.pool.query(`UPDATE secure_tokens SET expires_at = now() - interval '1 day' WHERE id = $1`, [
      expired.id,
    ]);

    // 5. revoked
    const revoked = await issueDraft();
    await h.tokens.revoke(revoked.id, 'admin_revoked');

    // 6. superseded by resend
    const resent = await issueDraft();
    await h.tokens.rotate(resent.lineageId);

    // 7. never existed / malformed
    const unknown = neverIssuedToken();
    const malformed = 'short';

    const rejections = await Promise.all([
      rejectionOf(probe, `/api/draft/${flipped}`),
      rejectionOf(probe, `/api/draft/${crossScope.raw}`),
      rejectionOf(probe, `/api/draft/${replayed.raw}`),
      rejectionOf(probe, `/api/draft/${expired.raw}`),
      rejectionOf(probe, `/api/draft/${revoked.raw}`),
      rejectionOf(probe, `/api/draft/${resent.raw}`),
      rejectionOf(probe, `/api/draft/${unknown}`),
      rejectionOf(probe, `/api/draft/${malformed}`),
    ]);

    for (const r of rejections) {
      expect(r.status).toBe(TOKEN_REJECTION_STATUS);
      expect(r.body).toEqual(TOKEN_REJECTION_BODY);
    }

    // Identical down to the byte: a body that differs in length is an oracle
    // even when the fields match.
    const shapes = new Set(rejections.map((r) => `${r.status}|${r.contentLength}|${JSON.stringify(r.body)}`));
    expect(shapes.size).toBe(1);
  });

  it('never returns a reason the caller could branch on', async () => {
    const { raw, id } = await issueDraft();
    await h.tokens.revoke(id, 'security_reissue');

    const res = await request(probe).get(`/api/draft/${raw}`);

    // No field a caller could switch on. `error` is the single constant
    // `link_unavailable`, identical for all seven modes.
    expect(Object.keys(res.body).sort()).toEqual(
      ['detail', 'error', 'next', 'support', 'title'],
    );
    expect(res.body.error).toBe('link_unavailable');

    // And no value names a failure mode. The prose may say "reasons" — that is
    // generic customer copy; what must never appear is *which* reason.
    const values = JSON.stringify(Object.values(res.body)).toLowerCase();
    for (const mode of [
      'revoked',
      'expired',
      'claimed',
      'superseded',
      'security_reissue',
      'rate limit',
      'not found',
      'malformed',
    ]) {
      expect(values).not.toContain(mode);
    }
  });

  it('resend rotates the token and invalidates every older version immediately', async () => {
    const first = await issueDraft();
    await request(probe).get(`/api/draft/${first.raw}`).expect(200);

    const rotated = await h.tokens.rotate(first.lineageId);
    expect('raw' in rotated).toBe(true);
    const second = rotated as { raw: string };

    // Old dies the moment the new one exists — not at its own expiry (§7).
    await request(probe).get(`/api/draft/${first.raw}`).expect(TOKEN_REJECTION_STATUS);
    const res = await request(probe).get(`/api/draft/${second.raw}`).expect(200);
    expect(res.body.version).toBe(2);
    expect(res.body.subject.campaignDraftId).toBe(first.draftId);

    // And a third rotation kills the second.
    const again = (await h.tokens.rotate(first.lineageId)) as { raw: string };
    await request(probe).get(`/api/draft/${second.raw}`).expect(TOKEN_REJECTION_STATUS);
    await request(probe).get(`/api/draft/${again.raw}`).expect(200);
  });

  it('rotation restarts the 30-day unclaimed-draft retention window (§7)', async () => {
    const first = await issueDraft();
    await h.pool.query(`UPDATE secure_tokens SET expires_at = now() + interval '2 days' WHERE id = $1`, [
      first.id,
    ]);

    const rotated = (await h.tokens.rotate(first.lineageId)) as { record: { expiresAt: Date | null } };
    const expiresAt = rotated.record.expiresAt!;
    const daysOut = (expiresAt.getTime() - Date.now()) / 86_400_000;

    expect(DRAFT_TTL_DAYS).toBe(30);
    expect(daysOut).toBeGreaterThan(29.9);
    expect(daysOut).toBeLessThan(30.1);
  });

  it('two concurrent claims yield exactly one account and one safe failure', async () => {
    const { id } = await issueDraft();

    const results = await Promise.all(
      Array.from({ length: 8 }, () => h.tokens.claimDraft(id)),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(7);
  });

  it('a claim is historical — it cannot be cleared to enable a replay', async () => {
    const { id } = await issueDraft();
    await h.tokens.claimDraft(id);

    await expect(
      h.pool.query(`UPDATE secure_tokens SET claimed_at = NULL WHERE id = $1`, [id]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('a live token cannot be repointed at another draft while keeping its URL', async () => {
    const { raw, id, draftId } = await issueDraft();
    const otherDraft = randomUUID();

    await expect(
      h.pool.query(`UPDATE secure_tokens SET campaign_draft_id = $1 WHERE id = $2`, [otherDraft, id]),
    ).rejects.toMatchObject({ code: '23514' });

    const res = await request(probe).get(`/api/draft/${raw}`).expect(200);
    expect(res.body.subject.campaignDraftId).toBe(draftId);
  });

  it('only one live token per lineage can exist at a time', async () => {
    const { lineageId } = await issueDraft();
    await expect(
      h.pool.query(
        `INSERT INTO secure_tokens (scope, token_hash, lineage_id, campaign_draft_id)
         VALUES ('founder_draft', $1, $2, $3)`,
        [randomUUID(), lineageId, randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('writes an audit row for every operation, including each failed verification', async () => {
    const { raw, id } = await issueDraft();
    await h.tokens.revoke(id, 'admin_revoked');
    await request(probe).get(`/api/draft/${raw}`).expect(TOKEN_REJECTION_STATUS);

    const rows = await h.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.targetType, 'secure_token'), eq(auditEvents.targetId, id)))
      .orderBy(desc(auditEvents.occurredAt));

    const actions = rows.map((r) => r.action);
    expect(actions).toContain('token.issued');
    expect(actions).toContain('token.revoked');
    expect(actions).toContain('token.verify_failed');

    // The reason the caller was denied lives here and only here (§5.5).
    const failure = rows.find((r) => r.action === 'token.verify_failed')!;
    expect(failure.internalReason).toMatch(/revoked/);
    expect(failure.actor).toBeTruthy();
  });

  it('records a rejection even when no token row matched', async () => {
    const before = await h.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'token.verify_failed'));

    await request(probe).get(`/api/draft/${neverIssuedToken()}`).expect(TOKEN_REJECTION_STATUS);

    const after = await h.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'token.verify_failed'));
    expect(after.length).toBe(before.length + 1);
  });
});

/* ── Rate limiting (§28.1) ────────────────────────────────────────────────── */

describe('rate limits on verification are enforced and stay non-enumerating', () => {
  it('throttles repeated attempts and answers with the ordinary rejection, not a 429', async () => {
    const url = `/api/draft/${neverIssuedToken()}`;

    const statuses: number[] = [];
    let throttledBody: unknown;
    for (let i = 0; i < 6; i += 1) {
      const res = await request(limited).get(url);
      statuses.push(res.status);
      if (i === 5) throttledBody = res.body;
    }

    // Every response looks the same whether it was verified or refused.
    expect(new Set(statuses)).toEqual(new Set([TOKEN_REJECTION_STATUS]));
    expect(throttledBody).toEqual(TOKEN_REJECTION_BODY);
  });

  it('a valid token presented past the limit is refused identically — no 429 tell', async () => {
    const { raw } = await issueDraft();
    const res = await request(limited).get(`/api/draft/${raw}`);
    expect(res.status).toBe(TOKEN_REJECTION_STATUS);
    expect(res.body).toEqual(TOKEN_REJECTION_BODY);
  });
});

/* ── §33.5.13 — magic-link duration, revoke/reissue, non-enumeration ───────── */

describe('§33.5.13 magic-link duration, revoke/reissue, and non-enumeration', () => {
  it('resolves only to that Backer’s view of that campaign', async () => {
    const link = await issueMagicLink();
    const other = await issueMagicLink();

    const res = await request(probe).get(`/api/link/${link.raw}`).expect(200);
    expect(res.body.subject).toEqual({
      scope: 'backer_magic_link',
      campaignId: link.campaignId,
      backerIdentityId: link.backerIdentityId,
    });
    expect(res.body.subject.campaignId).not.toBe(other.campaignId);
    expect(res.body.subject.backerIdentityId).not.toBe(other.backerIdentityId);
  });

  it('is not a draft token and cannot be used as one', async () => {
    const link = await issueMagicLink();
    const draft = await issueDraft();

    await request(probe).get(`/api/draft/${link.raw}`).expect(TOKEN_REJECTION_STATUS);
    await request(probe).get(`/api/link/${draft.raw}`).expect(TOKEN_REJECTION_STATUS);
  });

  it('stays live with no expiry until resolution sets one, then honours it (§19)', async () => {
    const link = await issueMagicLink();

    const [row] = await h.db.select().from(secureTokens).where(eq(secureTokens.id, link.id));
    // §19 derives the lifetime from resolution + 180 days, so nothing is
    // stamped at issue time — a fixed expiry here would cut Backers off early.
    expect(row!.expiresAt).toBeNull();
    expect(MAGIC_LINK_GRACE_DAYS).toBe(180);

    await request(probe).get(`/api/link/${link.raw}`).expect(200);

    await h.pool.query(
      `UPDATE secure_tokens SET expires_at = now() + interval '180 days' WHERE id = $1`,
      [link.id],
    );
    await request(probe).get(`/api/link/${link.raw}`).expect(200);

    await h.pool.query(`UPDATE secure_tokens SET expires_at = now() - interval '1 second' WHERE id = $1`, [
      link.id,
    ]);
    await request(probe).get(`/api/link/${link.raw}`).expect(TOKEN_REJECTION_STATUS);
  });

  it('reissue keeps the Backer and campaign identity while killing the old link', async () => {
    const link = await issueMagicLink();
    const reissued = (await h.tokens.rotate(link.lineageId)) as { raw: string };

    await request(probe).get(`/api/link/${link.raw}`).expect(TOKEN_REJECTION_STATUS);
    const res = await request(probe).get(`/api/link/${reissued.raw}`).expect(200);

    // §19: Admin can reissue "without changing the reservation identity".
    expect(res.body.subject.campaignId).toBe(link.campaignId);
    expect(res.body.subject.backerIdentityId).toBe(link.backerIdentityId);
  });

  it('revocation ends access on the next request', async () => {
    const link = await issueMagicLink();
    await request(probe).get(`/api/link/${link.raw}`).expect(200);

    await h.tokens.revoke(link.id, 'security_reissue');
    await request(probe).get(`/api/link/${link.raw}`).expect(TOKEN_REJECTION_STATUS);
  });

  it('rejects every magic-link failure mode identically too', async () => {
    const revoked = await issueMagicLink();
    await h.tokens.revoke(revoked.id, 'admin_revoked');

    const rejections = await Promise.all([
      rejectionOf(probe, `/api/link/${revoked.raw}`),
      rejectionOf(probe, `/api/link/${neverIssuedToken()}`),
      rejectionOf(probe, `/api/link/${'x'.repeat(40)}`),
    ]);
    const shapes = new Set(rejections.map((r) => `${r.status}|${JSON.stringify(r.body)}`));
    expect(shapes.size).toBe(1);
  });
});

/* ── §28.1 — a raw token never reaches a log, an error, or Sentry ──────────── */

describe('§28.1 the raw token exists only in the delivered URL', () => {
  it('is not stored: only its hash is at rest', async () => {
    const { raw, id } = await issueDraft();
    const [row] = await h.db.select().from(secureTokens).where(eq(secureTokens.id, id));

    expect(row!.tokenHash).not.toBe(raw);
    expect(row!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(raw);
  });

  it('never appears in an audit row, including on rejection', async () => {
    const { raw, id } = await issueDraft();
    await h.tokens.revoke(id, 'admin_revoked');
    await request(probe).get(`/api/draft/${raw}`).expect(TOKEN_REJECTION_STATUS);

    const rows = await h.db.select().from(auditEvents);
    expect(JSON.stringify(rows)).not.toContain(raw);
  });

  it('never appears in the rejection body', async () => {
    const { raw, id } = await issueDraft();
    await h.tokens.revoke(id, 'admin_revoked');
    const res = await request(probe).get(`/api/draft/${raw}`);
    expect(JSON.stringify(res.body)).not.toContain(raw);
  });

  it('is stripped from any URL handed to Sentry or a log', () => {
    const raw = 'aVeryRealLookingTokenValue_0123456789';

    expect(redactTokenUrl(`/api/draft/${raw}`)).toBe(`/api/draft/${REDACTED}`);
    expect(redactTokenUrl(`/api/link/${raw}`)).toBe(`/api/link/${REDACTED}`);
    expect(redactTokenUrl(`/api/draft/${raw}/materials`)).toBe(`/api/draft/${REDACTED}/materials`);
    expect(redactTokenUrl(`/api/link/${raw}?from=email`)).toBe(`/api/link/${REDACTED}?from=email`);

    // Untouched where no token can be.
    expect(redactTokenUrl('/healthz')).toBe('/healthz');
    expect(redactTokenUrl('/api/auth/sign-in/email')).toBe('/api/auth/sign-in/email');
  });
});

/* ── §33.2.1 — no public signup exists for any role ────────────────────────── */

describe('§33.2.1 no public signup route exists', () => {
  it('refuses the email sign-up endpoint', async () => {
    const res = await request(h.app).post('/api/auth/sign-up/email').send({
      email: 'walk-in@example.com',
      password: 'a-perfectly-good-password',
      name: 'Walk In',
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
    const created = await h.db
      .select()
      .from(userTable)
      .where(eq(userTable.email, 'walk-in@example.com'));
    expect(created).toHaveLength(0);
  });

  it('has no Affiliate-specific signup route at all', async () => {
    for (const route of ['/api/auth/sign-up', '/api/signup', '/api/affiliates/signup']) {
      const res = await request(h.app).post(route).send({ email: 'a@example.com' });
      expect(res.status).not.toBe(200);
    }
  });
});

/* ── §33.12.5 — MFA enforced, stale reauthentication fails safely ──────────── */

describe('§33.12.5 MFA is enforced and a sensitive action without recent reauthentication fails safely', () => {
  const audit = () => createAuditWriter(h.db);
  const PASSWORD = 'a-perfectly-good-password';

  function cookiesOf(res: request.Response): string {
    const raw = res.headers['set-cookie'];
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return list.map((c) => c.split(';')[0]).join('; ');
  }

  /** Sign-in for an account with no second factor yet: yields a full session. */
  async function signInPlain(email: string): Promise<string> {
    const res = await request(h.app)
      .post('/api/auth/sign-in/email')
      .send({ email, password: PASSWORD })
      .expect(200);
    return cookiesOf(res);
  }

  /**
   * The `secret` in a provisioning URI is base32 — that is what an
   * authenticator app scans. Better Auth verifies against the raw secret it
   * base32-encoded to build the URI, so a code generated straight from the URI
   * parameter is computed over the wrong input and is always rejected.
   */
  function secretFromTotpUri(uri: string): string {
    const encoded = new URL(uri).searchParams.get('secret');
    expect(encoded).toBeTruthy();
    return new TextDecoder().decode(base32.decode(encoded!));
  }

  const totpCode = (secret: string): Promise<string> => createOTP(secret).totp();

  /**
   * Registers a real TOTP factor the way an Admin does: enable, read the
   * provisioning URI, then prove possession with a generated code. Setting
   * `two_factor_enabled` in the database instead would test nothing — it is
   * precisely the step an unenrolled Admin cannot perform.
   */
  async function enrolTotp(email: string): Promise<{ secret: string; cookie: string }> {
    const cookie = await signInPlain(email);

    const enabled = await request(h.app)
      .post('/api/auth/two-factor/enable')
      .set('cookie', cookie)
      .send({ password: PASSWORD })
      .expect(200);

    const secret = secretFromTotpUri(enabled.body.totpURI);
    const verified = await request(h.app)
      .post('/api/auth/two-factor/verify-totp')
      .set('cookie', [cookie, cookiesOf(enabled)].filter(Boolean).join('; '))
      .send({ code: await totpCode(secret) })
      .expect(200);

    return { secret, cookie: cookiesOf(verified) || cookie };
  }

  /** Full sign-in for an enrolled Admin — password, then the second factor. */
  async function signInWithTotp(email: string, secret: string): Promise<string> {
    const first = await request(h.app)
      .post('/api/auth/sign-in/email')
      .send({ email, password: PASSWORD })
      .expect(200);

    // §5.1/§28.2: the password alone does not produce a session.
    expect(first.body.twoFactorRedirect).toBe(true);

    const second = await request(h.app)
      .post('/api/auth/two-factor/verify-totp')
      .set('cookie', cookiesOf(first))
      .send({ code: await totpCode(secret) })
      .expect(200);

    return cookiesOf(second);
  }

  async function seedAdmin(label: string): Promise<{ id: string; email: string }> {
    const email = `${label}-${randomUUID()}@example.com`;
    const seeded = await seedAccount(h.auth, audit(), {
      email,
      password: PASSWORD,
      name: 'Seeded Admin',
      role: 'admin',
    });
    return { id: seeded.id, email };
  }

  it('refuses an Admin with no registered TOTP factor every operational surface', async () => {
    const { email } = await seedAdmin('admin-unenrolled');
    const cookie = await signInPlain(email);

    const res = await request(probe).get('/probe/admin').set('cookie', cookie);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('mfa_enrollment_required');
  });

  it('will not issue a session on the password alone once a factor is registered', async () => {
    const { email } = await seedAdmin('admin-password-only');
    await enrolTotp(email);

    const res = await request(h.app)
      .post('/api/auth/sign-in/email')
      .send({ email, password: PASSWORD })
      .expect(200);

    expect(res.body.twoFactorRedirect).toBe(true);
    expect(res.body.token).toBeFalsy();

    // Whatever cookie that response did set is not a session: it cannot reach
    // an operational surface.
    const res2 = await request(probe).get('/probe/admin').set('cookie', cookiesOf(res));
    expect(res2.status).toBe(401);
  });

  it('admits an Admin once the factor is registered and verified', async () => {
    const { id, email } = await seedAdmin('admin-enrolled');
    const { secret } = await enrolTotp(email);

    const [row] = await h.db.select().from(userTable).where(eq(userTable.id, id));
    expect(row!.twoFactorEnabled).toBe(true);

    const cookie = await signInWithTotp(email, secret);
    const res = await request(probe).get('/probe/admin').set('cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('admin');
  });

  it('blocks a sensitive action on a stale session and does not proceed', async () => {
    const { id, email } = await seedAdmin('admin-stale');
    const { secret } = await enrolTotp(email);
    const cookie = await signInWithTotp(email, secret);

    // Fresh: allowed.
    await request(probe).post('/probe/sensitive').set('cookie', cookie).expect(200);

    // Age the session past the §6 window. Freshness is measured from when the
    // session was established, so merely using it does not renew it.
    await h.pool.query(
      `UPDATE "session" SET created_at = now() - ($1 || ' seconds')::interval WHERE user_id = $2`,
      [TEST_REAUTH_WINDOW_SECONDS + 60, id],
    );

    const res = await request(probe).post('/probe/sensitive').set('cookie', cookie);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('reauthentication_required');
    // §27.1: it says what happened, what to do next, and how to get help.
    expect(res.body.next).toBeTruthy();
    expect(res.body.support).toBeTruthy();
  });

  it('lets a reauthenticated Admin through again — the gate prompts, it does not lock out', async () => {
    const { id, email } = await seedAdmin('admin-reauth');
    const { secret } = await enrolTotp(email);
    const stale = await signInWithTotp(email, secret);

    await h.pool.query(
      `UPDATE "session" SET created_at = now() - ($1 || ' seconds')::interval WHERE user_id = $2`,
      [TEST_REAUTH_WINDOW_SECONDS + 60, id],
    );
    await request(probe).post('/probe/sensitive').set('cookie', stale).expect(403);

    // A fresh sign-in — password *and* second factor — restores the action.
    const fresh = await signInWithTotp(email, secret);
    await request(probe).post('/probe/sensitive').set('cookie', fresh).expect(200);
  });

  it('fails closed with no session at all rather than logging a warning and continuing', async () => {
    await request(probe).post('/probe/sensitive').expect(401);
    await request(probe).get('/probe/admin').expect(401);
    await request(probe).post('/probe/sensitive').set('cookie', 'better-auth.session_token=garbage').expect(401);
  });

  it('keeps roles apart — a Founder cannot reach an Admin surface', async () => {
    const email = `founder-${randomUUID()}@example.com`;
    await seedAccount(h.auth, audit(), {
      email,
      password: PASSWORD,
      name: 'A Founder',
      role: 'founder',
    });
    const cookie = await signInPlain(email);

    await request(probe).get('/probe/founder').set('cookie', cookie).expect(200);
    const res = await request(probe).get('/probe/admin').set('cookie', cookie);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

/* ── §33.1.8 — no SMS OTP exists ──────────────────────────────────────────── */

describe('§33.1.8 no SMS OTP path exists', () => {
  it('stores phone as explicitly unverified and refuses to mark it verified', async () => {
    const email = `phone-${randomUUID()}@example.com`;
    const seeded = await seedAccount(h.auth, createAuditWriter(h.db), {
      email,
      password: 'a-perfectly-good-password',
      name: 'Phoned Founder',
      role: 'founder',
      phone: '+15555550123',
    });

    const [row] = await h.db.select().from(userTable).where(eq(userTable.id, seeded.id));
    expect(row!.phone).toBe('+15555550123');
    expect(row!.phoneVerified).toBe(false);

    // There is no verification mechanism, so there must be no way to claim one
    // happened — enforced by the database, for every role including superusers.
    await expect(
      h.pool.query(`UPDATE "user" SET phone_verified = true WHERE id = $1`, [seeded.id]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('has no SMS or phone-OTP provider anywhere in the source tree', () => {
    const roots = ['backend/src', 'frontend/src', 'shared/src'].map((r) =>
      path.resolve(__dirname, '../../..', r),
    );

    const banned: Array<[string, RegExp]> = [
      ['Twilio', /\btwilio\b/i],
      ['MessageBird', /\bmessagebird\b/i],
      ['Vonage/Nexmo', /\b(vonage|nexmo)\b/i],
      ['sendSms', /\bsend[_-]?sms\b/i],
      ['SMS OTP', /\bsms[_ -]?(otp|code|verification)\b/i],
      ['phone OTP', /\bphone[_ -]?(otp|verification[_ -]?code)\b/i],
      ['Better Auth phoneNumber plugin', /phoneNumber\s*\(/],
      ['Better Auth otpOptions', /\botpOptions\b/],
      ['sendOTP', /\bsendOTP\b/],
    ];

    /**
     * Comments are stripped first. The rule being enforced is that no SMS or
     * phone-OTP *path* exists — and the files that most need to say "there is
     * deliberately no SMS OTP here" would otherwise be the ones this fails on,
     * which would push the codebase towards documenting the ban less.
     */
    const stripComments = (source: string): string =>
      source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

    const offenders: string[] = [];

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx|js|jsx|json)$/.test(entry)) continue;
        if (entry.endsWith('.test.ts') || entry.endsWith('.test.tsx')) continue;
        const source = stripComments(readFileSync(full, 'utf8'));
        for (const [label, pattern] of banned) {
          if (pattern.test(source)) offenders.push(`${label} in ${full}`);
        }
      }
    };

    for (const root of roots) walk(root);
    expect(offenders).toEqual([]);
  });

  it('does not register a second factor that could deliver a code by phone', async () => {
    // The two-factor plugin is configured with TOTP only; the OTP sender that
    // would be needed for an SMS or email code is deliberately absent.
    const res = await request(h.app).post('/api/auth/two-factor/send-otp').send({});
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

/* ── §5.5 — password reset exists for the three account roles, not for Backers */

describe('§5.5 password and link recovery', () => {
  it('sends an email-link reset for an account role', async () => {
    const email = `reset-${randomUUID()}@example.com`;
    await seedAccount(h.auth, createAuditWriter(h.db), {
      email,
      password: 'a-perfectly-good-password',
      name: 'Resetter',
      role: 'affiliate',
    });

    const before = h.resetLinks.length;
    await request(h.app)
      .post('/api/auth/request-password-reset')
      .send({ email, redirectTo: 'http://localhost:3000/reset' });

    expect(h.resetLinks.length).toBe(before + 1);
    expect(h.resetLinks.at(-1)!.email).toBe(email);
  });

  it('answers identically for an address that has no account — no enumeration', async () => {
    const known = `known-${randomUUID()}@example.com`;
    await seedAccount(h.auth, createAuditWriter(h.db), {
      email: known,
      password: 'a-perfectly-good-password',
      name: 'Known',
      role: 'founder',
    });

    const hit = await request(h.app)
      .post('/api/auth/request-password-reset')
      .send({ email: known, redirectTo: 'http://localhost:3000/reset' });
    const miss = await request(h.app)
      .post('/api/auth/request-password-reset')
      .send({ email: `nobody-${randomUUID()}@example.com`, redirectTo: 'http://localhost:3000/reset' });

    expect(miss.status).toBe(hit.status);
    expect(miss.body).toEqual(hit.body);
  });
});
