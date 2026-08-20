/**
 * Local-dev convenience only — NOT part of the production build.
 *
 * Rotates the live invitation token for a given association (issued via the
 * real admin API), prints the raw claim URL, fills the required profile
 * fields, and completes the claim with a fixed password — so a local tester
 * gets working sign-in credentials without depending on inbox access.
 *
 * Usage (from backend/):
 *   npx tsx --env-file=../.env scripts/dev-claim-affiliate.ts <associationId>
 */
import { eq, and, isNull } from 'drizzle-orm';
import { validateEnv } from '../src/env.js';
import { createDbPool, createDb } from '../src/db/client.js';
import { createTokenService } from '../src/auth/token-service.js';
import { secureTokens } from '../src/db/schema/tokens.js';
import { createAuditWriter } from '../src/auth/audit.js';

const associationId = process.argv[2];
if (!associationId) {
  console.error('Usage: dev-claim-affiliate.ts <associationId>');
  process.exit(1);
}

async function main() {
  const env = validateEnv();
  const pool = createDbPool(env.DATABASE_URL);
  const db = createDb(pool);
  const tokens = createTokenService({
    db,
    audit: createAuditWriter(db),
    secret: env.BETTER_AUTH_SECRET,
  });

  const [live] = await db
    .select({ lineageId: secureTokens.lineageId })
    .from(secureTokens)
    .where(
      and(
        eq(secureTokens.scope, 'affiliate_invitation'),
        eq(secureTokens.associationId, associationId),
        isNull(secureTokens.revokedAt),
        isNull(secureTokens.claimedAt),
      ),
    )
    .limit(1);

  if (!live) {
    console.error('No live invitation token for that association.');
    process.exit(1);
  }

  const rotated = await tokens.rotate(live.lineageId, { actorId: 'script:dev-claim-affiliate' });
  if ('ok' in rotated) {
    console.error('Could not rotate token:', rotated);
    process.exit(1);
  }

  console.log('Raw claim token:', rotated.raw);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
