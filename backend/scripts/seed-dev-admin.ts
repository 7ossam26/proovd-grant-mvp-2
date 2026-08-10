/**
 * Local-dev convenience only — NOT part of the production build.
 *
 * §5.1: there is no public signup for any role, and internal accounts are
 * seeded directly. This script does exactly that for one Admin.
 *
 * ── What it deliberately is not ─────────────────────────────────────────────
 * It is not a sign-in and it is not a bypass. It creates an account with a
 * password and stops; the seeded person still authenticates through
 * `/api/auth/sign-in/email` like anybody else, and `requireAdmin` still decides
 * every `/api/admin` request on the server. Nothing here writes a session,
 * nothing marks an email verified, and nothing grants standing that a real
 * sign-in would not.
 *
 * It also cannot run by accident in production: it needs shell access, the
 * database URL, and `BETTER_AUTH_SECRET`, and it is never invoked by the
 * Dockerfile, the server, or any job. It is also not compiled into
 * `backend/dist` — `tsconfig.json`'s `rootDir` is `src`, and this lives outside
 * it.
 *
 * Before 2026-08-10 this additionally enrolled a TOTP factor over real HTTP,
 * which is why it used to require the dev server running. The second factor was
 * removed by product direction (see `src/auth/auth.ts`), so this no longer
 * talks to the server at all — it is pure database work and runs whether or not
 * anything is listening.
 *
 * Usage (from backend/):
 *   npx tsx --env-file=../.env scripts/seed-dev-admin.ts
 *
 * Override the identity with SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD env vars.
 * There is a fixed local-only default so re-running is predictable; it is a
 * `.local` address and an obviously-development password, and neither is a
 * secret worth protecting — but for the same reason neither belongs on a
 * reachable deployment.
 */

import { eq } from 'drizzle-orm';
import { validateEnv } from '../src/env.js';
import { createDbPool, createDb } from '../src/db/client.js';
import { createAuth } from '../src/auth/auth.js';
import { createAuditWriter } from '../src/auth/audit.js';
import { seedAccount } from '../src/auth/seed.js';
import { user } from '../src/db/schema/auth.js';

const EMAIL = (process.env['SEED_ADMIN_EMAIL'] ?? 'admin@proovd.local').toLowerCase();
const PASSWORD = process.env['SEED_ADMIN_PASSWORD'] ?? 'DevAdmin!Local1234';

async function main() {
  const env = validateEnv();

  if (env.NODE_ENV === 'production') {
    console.error(
      'Refusing to run: NODE_ENV is production.\n' +
        'This script exists to make a local Admin, and a production Admin is\n' +
        'created deliberately by an operator, not by a convenience script.',
    );
    process.exitCode = 1;
    return;
  }

  const pool = createDbPool(env.DATABASE_URL);
  const db = createDb(pool);

  const auth = createAuth({
    db,
    baseUrl: env.APP_BASE_URL,
    secret: env.BETTER_AUTH_SECRET,
    adminReauthWindowSeconds: env.ADMIN_REAUTH_WINDOW_SECONDS,
    useSecureCookies: env.APP_BASE_URL.startsWith('https://'),
    sendResetPassword: async () => {
      /* Nothing to send: this script never triggers a reset. */
    },
  });

  try {
    const [existing] = await db
      .select({ id: user.id, role: user.role })
      .from(user)
      .where(eq(user.email, EMAIL))
      .limit(1);

    if (existing) {
      // Deliberately does NOT rewrite the password or the role. A bootstrap
      // script that silently resets an existing account's credentials on every
      // run is a credential-overwrite primitive for anyone who can run it.
      console.log(`An account already exists for ${EMAIL} (role: ${existing.role}).`);
      console.log('Nothing was changed. Use the password reset flow to change its password.');
      return;
    }

    const seeded = await seedAccount(auth, createAuditWriter(db), {
      email: EMAIL,
      password: PASSWORD,
      name: 'Local Admin',
      role: 'admin',
      actor: 'script:seed-dev-admin',
    });

    console.log('\nSeeded a local Admin account.\n');
    console.log('  id:       ', seeded.id);
    console.log('  email:    ', seeded.email);
    console.log('  password: ', PASSWORD);
    console.log('\nSign in at /admin/signin. There is no second factor.\n');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
