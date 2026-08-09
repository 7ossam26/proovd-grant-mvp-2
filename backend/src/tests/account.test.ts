/**
 * `/api/account/me` — §5, §3.1, §29.8, §33.12.5.
 *
 * The one read that lets a sign-in form send somebody somewhere. It is small
 * enough to look obviously correct and sits in front of every authenticated
 * surface in the product, which is exactly the combination that earns a test:
 *
 *  1. It fails closed — no session, an unreadable one, and a database error
 *     all refuse, and none of them falls through (§33.12.5's rule for guards).
 *  2. It answers for all three account roles, because a door that works for
 *     two of them is the defect this endpoint exists to fix.
 *  3. It reports the caller's OWN identity and nothing else. A route that
 *     could be argued into describing another account is an account oracle.
 *  4. It stays outside the §29.8 reacceptance gate, so somebody who owes an
 *     acceptance can still reach the surface that takes it.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startHarness, type Harness } from './app-harness.js';
import { seedAccount } from '../auth/seed.js';
import { createAuditWriter } from '../auth/audit.js';

let h: Harness;

const PASSWORD = 'a-long-enough-test-password';

const ACCOUNTS = [
  { email: 'account-admin@example.test', name: 'Ada Admin', role: 'admin' as const },
  { email: 'account-founder@example.test', name: 'Fen Founder', role: 'founder' as const },
  { email: 'account-creator@example.test', name: 'Cly Creator', role: 'affiliate' as const },
];

beforeAll(async () => {
  h = await startHarness({}, 'account');
  const audit = createAuditWriter(h.db);
  for (const account of ACCOUNTS) {
    await seedAccount(h.auth, audit, { ...account, password: PASSWORD });
  }
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

function cookiesOf(res: request.Response): string {
  const raw = res.headers['set-cookie'];
  return Array.isArray(raw) ? raw.map((c) => c.split(';')[0]).join('; ') : '';
}

/**
 * Password only. §5.1 makes a second factor mandatory for Admin, and the seed
 * enrols none — so the Admin here holds a session without one, which is
 * deliberately the harder case: `requireSession` must still answer, because
 * `/admin` is where the surface sends them and `requireAdmin` is what refuses
 * an unenrolled Admin once they arrive.
 */
async function signIn(email: string): Promise<string> {
  const res = await request(h.app)
    .post('/api/auth/sign-in/email')
    .send({ email, password: PASSWORD });
  return cookiesOf(res);
}

describe('§5 — the account identifies itself', () => {
  it.each(ACCOUNTS)('answers for a $role', async (account) => {
    const cookie = await signIn(account.email);
    const res = await request(h.app).get('/api/account/me').set('cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.account).toEqual({
      role: account.role,
      email: account.email,
      name: account.name,
    });
  });

  it('reports the caller and nobody else', async () => {
    const cookie = await signIn('account-creator@example.test');
    const res = await request(h.app).get('/api/account/me').set('cookie', cookie);

    // There is no parameter to supply, so this is asserting the shape rather
    // than a filter: the route reads the session and has no other input.
    expect(res.body.account.email).toBe('account-creator@example.test');
    expect(JSON.stringify(res.body)).not.toContain('account-founder@example.test');
    expect(JSON.stringify(res.body)).not.toContain('account-admin@example.test');
  });

  it('returns nothing beyond the three fields a sign-in needs', async () => {
    const cookie = await signIn('account-founder@example.test');
    const res = await request(h.app).get('/api/account/me').set('cookie', cookie);

    // §25.7's posture: a session read is not a profile endpoint. Anything more
    // here — phone, connected-account ids, campaign lists — would be a payload
    // nobody asked for on the one route every signed-in surface calls first.
    expect(Object.keys(res.body.account).sort()).toEqual(['email', 'name', 'role']);
    expect(Object.keys(res.body)).toEqual(['account']);
  });
});

describe('§33.12.5 — it fails closed', () => {
  it('refuses with no session at all', async () => {
    const res = await request(h.app).get('/api/account/me');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('authentication_required');
  });

  it('refuses a forged cookie rather than guessing an identity', async () => {
    const res = await request(h.app)
      .get('/api/account/me')
      .set('cookie', 'better-auth.session_token=not-a-real-session');
    expect(res.status).toBe(401);
  });

  it('refuses a session that has been signed out', async () => {
    const cookie = await signIn('account-founder@example.test');
    expect((await request(h.app).get('/api/account/me').set('cookie', cookie)).status).toBe(200);

    await request(h.app).post('/api/auth/sign-out').set('cookie', cookie).send({});

    const after = await request(h.app).get('/api/account/me').set('cookie', cookie);
    expect(after.status).toBe(401);
  });

  it('creates nothing — it is a read, and a refused read writes no session', async () => {
    const before = await request(h.app).get('/api/account/me');
    expect(before.status).toBe(401);
    expect(before.headers['set-cookie']).toBeUndefined();
  });
});

describe('§29.8 — it is reachable while an acceptance is outstanding', () => {
  it('lives outside the gated prefixes', async () => {
    // The gate is mounted on `/api/founder` and `/api/creator`. This route is
    // on neither, which is what keeps the acceptance surface reachable for
    // exactly the people who are blocked from everything else.
    const cookie = await signIn('account-founder@example.test');
    const res = await request(h.app).get('/api/account/me').set('cookie', cookie);
    expect(res.status).toBe(200);
  });

  it('offers no write verb — a session read cannot change an account', async () => {
    const cookie = await signIn('account-founder@example.test');
    for (const verb of ['post', 'put', 'patch', 'delete'] as const) {
      const res = await request(h.app)[verb]('/api/account/me').set('cookie', cookie).send({});
      expect(res.status, verb).toBe(404);
    }
  });
});
