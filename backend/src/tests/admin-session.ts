/**
 * Signing in as a real Admin, for suites that exercise Admin routes.
 *
 * There is no shortcut here on purpose. Setting `two_factor_enabled` in the
 * database would produce a session that `requireAdmin` accepts while skipping
 * the one step an unenrolled Admin cannot perform, and every Admin test would
 * then be testing a state that cannot occur in production. So enrolment goes
 * through the real endpoints: enable, read the provisioning URI, prove
 * possession with a generated code.
 */

import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createOTP } from '@better-auth/utils/otp';
import { base32 } from '@better-auth/utils/base32';
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
  /** The TOTP secret, so a later test can mint a fresh session. */
  secret: string;
  /** A cookie header carrying a full, freshly established session. */
  cookie: string;
}

/**
 * The `secret` in a provisioning URI is base32 — what an authenticator app
 * scans. Better Auth verifies against the raw secret it encoded, so a code
 * generated from the URI parameter directly is computed over the wrong input.
 */
function secretFromTotpUri(uri: string): string {
  const encoded = new URL(uri).searchParams.get('secret');
  if (!encoded) throw new Error('provisioning URI carried no secret');
  return new TextDecoder().decode(base32.decode(encoded));
}

const totpCode = (secret: string): Promise<string> => createOTP(secret).totp();

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

/** Password-only sign-in. Valid for an account with no second factor yet. */
export async function signInPlain(h: Harness, email: string): Promise<string> {
  const res = await request(h.app)
    .post('/api/auth/sign-in/email')
    .send({ email, password: TEST_PASSWORD })
    .expect(200);
  return cookiesOf(res);
}

/** Password, then the second factor. The only way an enrolled Admin gets in. */
export async function signInWithTotp(
  h: Harness,
  email: string,
  secret: string,
): Promise<string> {
  const first = await request(h.app)
    .post('/api/auth/sign-in/email')
    .send({ email, password: TEST_PASSWORD })
    .expect(200);

  const second = await request(h.app)
    .post('/api/auth/two-factor/verify-totp')
    .set('cookie', cookiesOf(first))
    .send({ code: await totpCode(secret) })
    .expect(200);

  return cookiesOf(second);
}

/** A seeded Admin with a real TOTP factor and a fresh session. */
export async function createAdmin(h: Harness, label = 'admin'): Promise<AdminSession> {
  const { id, email } = await seedUser(h, 'admin', label);

  const initial = await signInPlain(h, email);
  const enabled = await request(h.app)
    .post('/api/auth/two-factor/enable')
    .set('cookie', initial)
    .send({ password: TEST_PASSWORD })
    .expect(200);

  const secret = secretFromTotpUri(enabled.body.totpURI);
  await request(h.app)
    .post('/api/auth/two-factor/verify-totp')
    .set('cookie', [initial, cookiesOf(enabled)].filter(Boolean).join('; '))
    .send({ code: await totpCode(secret) })
    .expect(200);

  // Enrolment leaves a session that predates the factor. Sign in again so the
  // returned cookie is one a fully enrolled Admin would actually hold.
  const cookie = await signInWithTotp(h, email, secret);
  return { id, email, secret, cookie };
}
