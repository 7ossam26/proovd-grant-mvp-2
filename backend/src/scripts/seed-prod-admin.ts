/**
 * Production bootstrap — seeds the initial Admin accounts.
 *
 * This is a one-shot operator script that creates the three founding Admin
 * accounts on a fresh deployment. It is safe to re-run: existing accounts
 * are skipped without modification.
 *
 * It lives inside `src/` so that `tsc` compiles it to `dist/scripts/` and
 * the Dockerfile can include it in the production image.
 *
 * Usage (from the container or a node with access to the production DB):
 *   node backend/dist/scripts/seed-prod-admin.js
 *
 * Override the shared password with PROD_ADMIN_PASSWORD if needed.
 */

import { eq } from 'drizzle-orm';
import { validateEnv } from '../env.js';
import { createDbPool, createDb } from '../db/client.js';
import { createAuth } from '../auth/auth.js';
import { createAuditWriter } from '../auth/audit.js';
import { seedAccount } from '../auth/seed.js';
import { user } from '../db/schema/auth.js';

const ADMIN_PASSWORD = process.env['PROD_ADMIN_PASSWORD'] ?? 'Admin2026';

const INITIAL_ADMINS = [
  { email: 'me5a@proovd.co', name: 'Me5a' },
  { email: 'hoss@proovd.co', name: 'Hoss' },
  { email: 'seif@proovd.co', name: 'Seif' },
];

async function main() {
  const env = validateEnv();

  const pool = createDbPool(env.DATABASE_URL);
  const db = createDb(pool);

  const auth = createAuth({
    db,
    baseUrl: env.APP_BASE_URL,
    secret: env.BETTER_AUTH_SECRET,
    adminReauthWindowSeconds: env.ADMIN_REAUTH_WINDOW_SECONDS,
    useSecureCookies: env.APP_BASE_URL.startsWith('https://'),
    sendResetPassword: async () => {
      /* Nothing to send */
    },
  });

  try {
    for (const admin of INITIAL_ADMINS) {
      const email = admin.email.toLowerCase();

      const [existing] = await db
        .select({ id: user.id, role: user.role })
        .from(user)
        .where(eq(user.email, email))
        .limit(1);

      if (existing) {
        console.log(`Already exists: ${email} (role: ${existing.role}). Skipping.`);
        continue;
      }

      const seeded = await seedAccount(auth, createAuditWriter(db), {
        email,
        password: ADMIN_PASSWORD,
        name: admin.name,
        role: 'admin',
        actor: 'script:seed-prod-admin',
      });

      console.log(`Seeded: ${email}  (id: ${seeded.id})`);
    }

    console.log('\nDone. Sign in at /admin/signin.\n');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
