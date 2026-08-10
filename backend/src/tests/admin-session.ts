/**
 * Signing in as a real account, for suites that exercise guarded routes.
 *
 * There is no shortcut here on purpose. Every session these helpers return was
 * established by POSTing a real password to the real `/api/auth/sign-in/email`
 * and keeping the cookie the server set. Writing a session row directly — or
 * stubbing `getSession` — would produce a session the guards accept while
 * skipping the one step a real caller cannot skip, and every guarded test would
 * then be exercising a state that cannot occur in production.
 *
 * Before 2026-08-10 `createAdmin` additionally enrolled a TOTP factor through
 * `/api/auth/two-factor/*` and signed in twice. The second factor was removed
 * by product direction (see `src/auth/auth.ts`), so those endpoints no longer
 * exist and an Admin session is now exactly what a Founder's or a Creator's is:
 * one password, one cookie. `AdminSession.secret` went with it — nothing needs
 * a shared secret to mint a second session any more, because `signInAs` does it
 * with the password every caller already has.
 */

import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { seedAccount } from '../auth/seed.js';
import { createAuditWriter } from '../auth/audit.js';
import type { Harness } from './app-harness.js';
import type { ProovdRole } from '../db/schema/auth.js';

export const TEST_PASSWORD = 'a-perfectly-good-password';

export function cookiesOf(res: request.Response): string {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((c) => c.split(';')[0]).join('; ');
}

export interface AdminSession {
  id: string;
  email: string;
  /** A cookie header carrying a full, freshly established session. */
  cookie: string;
}

export async function seedUser(
  h: Harness,
  role: ProovdRole,
  label: string,
): Promise<{ id: string; email: string }> {
  const email = `${label}-${randomUUID()}@example.com`;
  const seeded = await seedAccount(h.auth, createAuditWriter(h.db), {
    email,
    password: TEST_PASSWORD,
    name: `Seeded ${role}`,
    role,
  });
  return { id: seeded.id, email };
}

/**
 * Password sign-in. The only way any of the three account roles gets a session.
 *
 * Kept under its historical name so the suites that already call it do not
 * change. `signInAs` is the same function under a name that no longer implies
 * there is a richer variant somewhere.
 */
export async function signInPlain(h: Harness, email: string): Promise<string> {
  const res = await request(h.app)
    .post('/api/auth/sign-in/email')
    .send({ email, password: TEST_PASSWORD })
    .expect(200);
  return cookiesOf(res);
}

export const signInAs = signInPlain;

/** A seeded Admin with a fresh session. */
export async function createAdmin(h: Harness, label = 'admin'): Promise<AdminSession> {
  const { id, email } = await seedUser(h, 'admin', label);
  const cookie = await signInPlain(h, email);
  return { id, email, cookie };
}

/**
 * A seeded account of any role, with a fresh session.
 *
 * Exists so the authorization matrix can drive a Founder and a Creator at Admin
 * routes without each suite rebuilding the two-step seed-then-sign-in dance.
 */
export async function createSignedInUser(
  h: Harness,
  role: ProovdRole,
  label = role,
): Promise<AdminSession> {
  const { id, email } = await seedUser(h, role, label);
  const cookie = await signInPlain(h, email);
  return { id, email, cookie };
}
