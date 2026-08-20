/**
 * Direct invocation for a production deployment.
 *
 * This script is intended to be run exactly once by a human operator against a
 * live database to create the first Admin account. Once the first Admin exists,
 * no other accounts should be created this way.
 *
 * It deliberately requires PROD_ADMIN_EMAIL and PROD_ADMIN_PASSWORD environment
 * variables. It refuses to run if they are not set, rather than falling back to
 * a default.
 *
 * Usage (from backend/):
 *   PROD_ADMIN_EMAIL="operator@yourdomain.com" \
 *   PROD_ADMIN_PASSWORD="YourStrongPassword" \
 *   npx tsx scripts/seed-prod-admin.ts
 */

import { eq } from 'drizzle-orm';
import { validateEnv } from '../src/env.js';
import { createDbPool, createDb } from '../src/db/client.js';
import { createAuth } from '../src/auth/auth.js';
import { createAuditWriter } from '../src/auth/audit.js';
import { seedAccount } from '../src/auth/seed.js';
import { user } from '../src/db/schema/auth.js';

const ADMIN_PASSWORD = process.env['PROD_ADMIN_PASSWORD'] ?? 'Admin2026';

const INITIAL_ADMINS = [
  { email: 'me5a@proovd.co', name: 'Me5a' },
  { email: 'hoss@proovd.co', name: 'Hoss' },
  { email: 'seif@proovd.co', name: 'Seif' },
];

async function main() {
  // Still validate the rest of the environment (e.g. database URL)
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
        console.log(`An account already exists for ${email} (role: ${existing.role}). Skipping.`);
        continue;
      }

      const seeded = await seedAccount(auth, createAuditWriter(db), {
        email: email,
        password: ADMIN_PASSWORD,
        name: admin.name, 
        role: 'admin',
        actor: 'script:seed-prod-admin',
      });

      console.log(`\nSeeded Admin account: ${email}`);
      console.log('  id:       ', seeded.id);
      console.log('  password: ', ADMIN_PASSWORD);
    }

    console.log('\nAll admins seeded successfully! Sign in at /admin/signin.\n');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
