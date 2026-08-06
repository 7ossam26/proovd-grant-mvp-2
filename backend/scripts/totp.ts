/**
 * Prints the current TOTP code for a seeded account — local dev only.
 *
 * Reads the enrolled secret from `two_factor` and decrypts it exactly the way
 * Better Auth's own TOTP endpoints do (`symmetricDecrypt` keyed on the auth
 * secret), so this stays correct if the account is ever re-seeded and cannot
 * drift from a value pasted into a note somewhere.
 *
 * This is a convenience for driving a local Admin sign-in, not a bypass: it
 * proves possession of the same secret an authenticator app would hold, and it
 * needs database access plus BETTER_AUTH_SECRET to do it. §5.1's mandatory
 * second factor is unaffected — `requireAdmin` still demands a verified factor.
 *
 * Usage (from backend/):
 *   npx tsx --env-file=../.env scripts/totp.ts
 *   npx tsx --env-file=../.env scripts/totp.ts someone-else@proovd.local
 *
 * Does NOT need the dev server running — this is pure computation over the
 * stored secret.
 */

import { createOTP } from '@better-auth/utils/otp';
import { symmetricDecrypt } from 'better-auth/crypto';
import { validateEnv } from '../src/env.js';
import { createDbPool } from '../src/db/client.js';

const EMAIL = process.argv[2] ?? process.env['SEED_ADMIN_EMAIL'] ?? 'admin@proovd.local';

async function main() {
  const env = validateEnv();
  const pool = createDbPool(env.DATABASE_URL);

  try {
    const { rows } = await pool.query<{ secret: string; verified: boolean }>(
      `SELECT tf.secret, tf.verified
         FROM two_factor tf
         JOIN "user" u ON u.id = tf.user_id
        WHERE lower(u.email) = lower($1)
        LIMIT 1`,
      [EMAIL],
    );

    if (rows.length === 0) {
      console.error(
        `No TOTP factor enrolled for ${EMAIL}.\n` +
          'Seed one with: npx tsx --env-file=../.env scripts/seed-dev-admin.ts',
      );
      process.exitCode = 1;
      return;
    }

    const secret = await symmetricDecrypt({
      key: env.BETTER_AUTH_SECRET,
      data: rows[0]!.secret,
    });

    const code = await createOTP(secret).totp();

    // TOTP steps are 30s wide and aligned to the epoch, so this is how long the
    // printed code stays valid — worth showing, because a code copied at the
    // tail of a window fails for a reason that looks like a wrong secret.
    const secondsLeft = 30 - (Math.floor(Date.now() / 1000) % 30);

    console.log(`\n  ${code}\n`);
    console.log(`  account:  ${EMAIL}`);
    console.log(`  valid:    ${secondsLeft}s`);
    if (!rows[0]!.verified) console.log('  note:     factor is not marked verified yet');
    console.log();
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
