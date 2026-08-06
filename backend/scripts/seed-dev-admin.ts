/**
 * Local-dev convenience only — NOT part of the production build.
 *
 * §5.1: there is no public signup for any role, and internal accounts are
 * seeded directly. This script does exactly that for one Admin, then enrols a
 * real TOTP factor through the actual running server's `/api/auth/*` routes —
 * the same path `backend/src/tests/admin-session.ts`'s `createAdmin` drives in
 * tests — so the seeded account can really sign in through `requireAdmin`
 * rather than through a shortcut that skips MFA enrolment.
 *
 * Requires the backend dev server already running on :3000 (`npm run
 * dev:backend`), because the TOTP enrolment goes over real HTTP.
 *
 * Usage (from backend/):
 *   npx tsx --env-file=../.env scripts/seed-dev-admin.ts
 *
 * Override the identity with SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD env vars;
 * otherwise a fixed local-only default is used so re-running is predictable.
 */

import { createOTP } from '@better-auth/utils/otp';
import { base32 } from '@better-auth/utils/base32';
import { validateEnv } from '../src/env.js';
import { createDbPool, createDb } from '../src/db/client.js';
import { createAuth } from '../src/auth/auth.js';
import { createAuditWriter } from '../src/auth/audit.js';
import { seedAccount } from '../src/auth/seed.js';

const BASE = 'http://localhost:3000';
const EMAIL = process.env['SEED_ADMIN_EMAIL'] ?? 'admin@proovd.local';
const PASSWORD = process.env['SEED_ADMIN_PASSWORD'] ?? 'DevAdmin!Local1234';

/**
 * The URI's `secret` param is base32 — what an authenticator app scans or is
 * given for manual entry. Better Auth's own `verifyTOTP`/`createOTP` operate on
 * the DECODED raw secret, so both forms are needed: the base32 one to show a
 * human, the decoded one to compute a code the way the server will check it.
 */
function secretsFromTotpUri(uri: string): { base32Secret: string; rawSecret: string } {
  const base32Secret = new URL(uri).searchParams.get('secret');
  if (!base32Secret) throw new Error('provisioning URI carried no secret');
  return { base32Secret, rawSecret: new TextDecoder().decode(base32.decode(base32Secret)) };
}

function cookiesOf(res: Response): string {
  const raw = res.headers.getSetCookie?.() ?? [];
  return raw.map((c) => c.split(';')[0]!).join('; ');
}

async function main() {
  const env = validateEnv();
  const pool = createDbPool(env.DATABASE_URL);
  const db = createDb(pool);

  const auth = createAuth({
    db,
    baseUrl: env.APP_BASE_URL,
    secret: env.BETTER_AUTH_SECRET,
    adminReauthWindowSeconds: env.ADMIN_REAUTH_WINDOW_SECONDS,
    sendResetPassword: async () => {
      /* not exercised by this script */
    },
  });
  const audit = createAuditWriter(db);

  try {
    await seedAccount(auth, audit, {
      email: EMAIL,
      password: PASSWORD,
      name: 'Dev Admin',
      role: 'admin',
      actor: 'seed-dev-admin-script',
    });
    console.log(`Seeded new admin account: ${EMAIL}`);
  } catch (err) {
    const cause = err instanceof Error && 'cause' in err ? (err.cause as { code?: string; message?: string } | undefined) : undefined;
    const msg = `${err instanceof Error ? err.message : String(err)} ${cause?.message ?? ''}`;
    if (cause?.code === '23505' || /duplicate|unique|already exists/i.test(msg)) {
      console.log(`Admin account already exists: ${EMAIL} (continuing)`);
    } else {
      throw err;
    }
  }

  // ── Enrol a real TOTP factor, over HTTP, against the running dev server ────
  // Better Auth's own CSRF check refuses a request with no Origin header; the
  // frontend origin app.ts already trusts in non-production (see its CORS
  // block) is what a real browser sends, so this mirrors that rather than
  // adding a bypass.
  const DEV_ORIGIN = 'http://localhost:5173';
  const signIn = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: DEV_ORIGIN },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!signIn.ok) {
    throw new Error(
      `sign-in failed (${signIn.status}): ${await signIn.text()} — is the backend dev server running on :3000?`,
    );
  }
  const initialCookie = cookiesOf(signIn);
  const signedInBody = (await signIn.json()) as { user?: { twoFactorEnabled?: boolean } };

  if (signedInBody.user?.twoFactorEnabled) {
    console.log('TOTP already enrolled for this account. Nothing more to do.');
    console.log(`\nLogin at http://localhost:5173/admin with ${EMAIL} / the password you set.`);
    await pool.end();
    return;
  }

  const enable = await fetch(`${BASE}/api/auth/two-factor/enable`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: DEV_ORIGIN, cookie: initialCookie },
    body: JSON.stringify({ password: PASSWORD }),
  });
  if (!enable.ok) {
    throw new Error(`2FA enable failed (${enable.status}): ${await enable.text()}`);
  }
  const enableBody = (await enable.json()) as { totpURI: string };
  const { base32Secret, rawSecret } = secretsFromTotpUri(enableBody.totpURI);
  const enableCookie = cookiesOf(enable);

  const code = await createOTP(rawSecret).totp();
  const verify = await fetch(`${BASE}/api/auth/two-factor/verify-totp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: DEV_ORIGIN,
      cookie: [initialCookie, enableCookie].filter(Boolean).join('; '),
    },
    body: JSON.stringify({ code }),
  });
  if (!verify.ok) {
    throw new Error(`2FA verify failed (${verify.status}): ${await verify.text()}`);
  }

  console.log('\n=== Dev Admin ready ===');
  console.log('Email:            ', EMAIL);
  console.log('Password:         ', PASSWORD);
  console.log('TOTP secret:      ', base32Secret, '(paste into Google Authenticator / Authy / 1Password as a manual entry)');
  console.log('TOTP URI (or QR): ', enableBody.totpURI);
  console.log('Login at:          http://localhost:5173/admin');
  console.log('========================\n');

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
