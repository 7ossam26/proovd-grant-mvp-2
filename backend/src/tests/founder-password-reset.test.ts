import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { startHarness, type Harness, type CapturedEmail } from './app-harness.js';
import { cookiesOf, createAdmin, seedUser, TEST_PASSWORD } from './admin-session.js';
import { founderProspects } from '../db/schema/invitations.js';
import { seedAdminReauthWindow } from '../settings/service.js';
import {
  requestPasswordReset,
  resetPassword,
  AccountRequestError,
} from '../../../frontend/src/surfaces/auth/api.js';

let h: Harness;
const calls: Array<{ path: string; method: string; status: number }> = [];
const NEW_PASSWORD = 'a-new-password-for-this-test';

beforeAll(async () => {
  // Exercise the production notification callback, with only its final delivery captured.
  h = await startHarness({
    sendResetPassword: undefined,
    invitationContext: {
      appBaseUrl: 'http://localhost:3000',
      supportEmail: 'support@proovd.co',
      fromAddress: 'hello@mail.proovd.co',
    },
  }, 'founderreset');
  await seedAdminReauthWindow(h.db, 300);
}, 180_000);

afterAll(async () => { await h?.stop(); });

beforeEach(() => {
  h.sentEmails.messages.length = 0;
  h.sentEmails.failNext = false;
  calls.length = 0;
  // Run the actual browser client against the actual mounted auth routes. A stub
  // of the old endpoint would miss the endpoint drift that caused this regression.
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const test = method === 'POST' ? request(h.app).post(input) : request(h.app).get(input);
    if (init?.body) test.set('content-type', 'application/json').send(JSON.parse(String(init.body)));
    const response = await test;
    calls.push({ path: input, method, status: response.status });
    return new Response(response.status === 204 ? null : JSON.stringify(response.body), {
      status: response.status,
      headers: { 'content-type': 'application/json' },
    });
  });
});

afterEach(() => { vi.unstubAllGlobals(); });

function resetLink(message: CapturedEmail): URL {
  const value = message.text.match(/https?:\/\/[^\s]+\/api\/auth\/reset-password\/[^\s]+/)?.[0];
  expect(Boolean(value)).toBe(true);
  return new URL(value!);
}

async function requestAndFollow(email: string): Promise<string> {
  await requestPasswordReset(email);
  return followCapturedReset(email);
}

async function followCapturedReset(email: string): Promise<string> {
  expect(h.sentEmails.messages).toHaveLength(1);
  const message = h.sentEmails.messages[0]!;
  expect(message.to).toBe(email);
  expect(message.from).toBe('hello@mail.proovd.co');
  expect(message.replyTo).toBe('support@proovd.co');
  expect(message.subject).toBe('Reset your Proovd password');
  const link = resetLink(message);
  const response = await request(h.app).get(link.pathname + link.search).redirects(0).expect(302);
  const landing = new URL(response.headers['location'] as string, 'http://localhost:3000');
  expect(landing.origin).toBe('http://localhost:3000');
  expect(landing.pathname).toBe('/reset-password');
  expect(landing.searchParams.has('error')).toBe(false);
  const token = landing.searchParams.get('token');
  expect(Boolean(token)).toBe(true);
  return token!;
}

describe('Founder password recovery through the real browser client and auth server', () => {
  it('sends the reset email, follows its callback, changes the password and rejects reuse', async () => {
    const founder = await seedUser(h, 'founder', 'reset-complete');
    const token = await requestAndFollow(founder.email);
    expect(calls).toContainEqual({ path: '/api/auth/request-password-reset', method: 'POST', status: 200 });
    await resetPassword(token, NEW_PASSWORD);

    await request(h.app).post('/api/auth/sign-in/email')
      .send({ email: founder.email, password: TEST_PASSWORD }).expect(401);
    const signedIn = await request(h.app).post('/api/auth/sign-in/email')
      .send({ email: founder.email, password: NEW_PASSWORD }).expect(200);
    const identity = await request(h.app).get('/api/account/me').set('cookie', cookiesOf(signedIn)).expect(200);
    expect(identity.body.account.role).toBe('founder');
    expect(identity.body.account.email).toBe(founder.email);
    await expect(resetPassword(token, 'another-valid-password')).rejects.toBeInstanceOf(AccountRequestError);
    expect(calls.at(-1)?.status).toBe(400);
    expect(h.sentEmails.messages).toHaveLength(1);
  });

  it('keeps the same public acknowledgement for known and unknown accounts', async () => {
    const founder = await seedUser(h, 'founder', 'reset-private');
    const known = await request(h.app).post('/api/auth/request-password-reset')
      .send({ email: founder.email, redirectTo: '/reset-password' }).expect(200);
    const unknown = await request(h.app).post('/api/auth/request-password-reset')
      .send({ email: `unknown-${randomUUID()}@example.com`, redirectTo: '/reset-password' }).expect(200);
    expect(unknown.body).toEqual(known.body);
    expect(h.sentEmails.messages).toHaveLength(1);
    await expect(requestPasswordReset(`unknown-client-${randomUUID()}@example.com`)).resolves.toBeUndefined();
    expect(h.sentEmails.messages).toHaveLength(1);
  });

  it('delivers a working recovery link from the Founder admin action', async () => {
    const founder = await seedUser(h, 'founder', 'reset-admin');
    const admin = await createAdmin(h, 'reset-admin-operator');
    const [prospect] = await h.db.insert(founderProspects).values({
      email: founder.email,
      legalName: 'Password recovery test Founder',
      claimedUserId: founder.id,
      claimedAt: new Date(),
      createdBy: admin.id,
    }).returning({ id: founderProspects.id });
    await request(h.app).post(`/api/admin/founders/${prospect!.id}/password-recovery`)
      .set('cookie', admin.cookie).send({}).expect(200, { sent: true });
    const token = await followCapturedReset(founder.email);
    await resetPassword(token, NEW_PASSWORD);
    const signedIn = await request(h.app).post('/api/auth/sign-in/email')
      .send({ email: founder.email, password: NEW_PASSWORD }).expect(200);
    expect(signedIn.body.user.role).toBe('founder');
  });

  it('allows a valid password retry after rejecting a password that is too short', async () => {
    const founder = await seedUser(h, 'founder', 'reset-length');
    const token = await requestAndFollow(founder.email);
    const invalid = await request(h.app).post('/api/auth/reset-password')
      .send({ token, newPassword: 'short' }).expect(400);
    expect(invalid.body.code).toBe('PASSWORD_TOO_SHORT');
    await expect(resetPassword(token, NEW_PASSWORD)).resolves.toEqual({ status: true });
  });

  it('rejects expired and unknown reset links without changing the password', async () => {
    const founder = await seedUser(h, 'founder', 'reset-expired');
    const token = await requestAndFollow(founder.email);
    await h.pool.query(`UPDATE verification SET expires_at = now() - interval '1 minute' WHERE identifier = $1`, [`reset-password:${token}`]);
    const expired = await request(h.app).post('/api/auth/reset-password')
      .send({ token, newPassword: NEW_PASSWORD }).expect(400);
    const unknown = await request(h.app).post('/api/auth/reset-password')
      .send({ token: randomUUID(), newPassword: NEW_PASSWORD }).expect(400);
    expect(expired.body).toEqual(unknown.body);
    await request(h.app).post('/api/auth/sign-in/email')
      .send({ email: founder.email, password: TEST_PASSWORD }).expect(200);
    const callback = await request(h.app).get(`/api/auth/reset-password/${randomUUID()}?callbackURL=%2Freset-password`).redirects(0).expect(302);
    const landing = new URL(callback.headers['location'] as string);
    expect(landing.pathname).toBe('/reset-password');
    expect(landing.searchParams.get('error')).toBe('INVALID_TOKEN');
    expect(landing.searchParams.has('token')).toBe(false);
  });

  it('lets a claimed Founder without a credential password establish one through recovery', async () => {
    const founder = await seedUser(h, 'founder', 'reset-first-password');
    await h.pool.query(`DELETE FROM account WHERE user_id = $1 AND provider_id = 'credential'`, [founder.id]);
    const token = await requestAndFollow(founder.email);
    await resetPassword(token, NEW_PASSWORD);
    const signedIn = await request(h.app).post('/api/auth/sign-in/email')
      .send({ email: founder.email, password: NEW_PASSWORD }).expect(200);
    expect(signedIn.body.user.role).toBe('founder');
  });

  it('can send a fresh reset request after an email-provider failure', async () => {
    const founder = await seedUser(h, 'founder', 'reset-delivery-retry');
    h.sentEmails.failNext = true;
    await expect(requestPasswordReset(founder.email)).resolves.toBeUndefined();
    expect(h.sentEmails.messages).toHaveLength(0);
    const token = await requestAndFollow(founder.email);
    await expect(resetPassword(token, NEW_PASSWORD)).resolves.toEqual({ status: true });
  });
});
