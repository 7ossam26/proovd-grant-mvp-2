/**
 * Mints a Founder draft link out of band, for a deployment whose email
 * provider is down.
 *
 * §28.1 keeps the raw token out of everything but the delivered URL, so a link
 * that has already been emailed can never be recovered — not from the database
 * (which stores a SHA-256 hash), not from a log (`redactTokenUrl` strips it),
 * and not from the invitation preview (which renders a deliberately fake
 * token). The only way to hold a working link is to be handed one at the moment
 * it is minted, which is what this does.
 *
 * ── What this deliberately does NOT do ──────────────────────────────────────
 * It does not call `sendInvitation`. That function writes a
 * `campaign_invitation_sends` row, starts §25.8's retention clock, and moves
 * the draft to `sent` — all of which are claims that a message went to a
 * Founder. Nothing goes to anybody here, so recording that it did would be the
 * §1.4 failure this codebase refuses everywhere else. The draft stays `draft`,
 * which is true.
 *
 * The consequence, and it is the correct one: when the provider is fixed and
 * somebody presses Send, §7 ROTATES the lineage and the link printed here stops
 * working immediately. This is a link for reaching a surface, not a substitute
 * for an invitation.
 *
 * Usage (from backend/):
 *   DATABASE_URL="postgresql://…" \
 *   DRAFT_ID="<campaign_drafts.id>" \
 *   APP_BASE_URL="https://app.proovd.co" \
 *   npx tsx scripts/issue-draft-link.ts
 */

import { eq } from 'drizzle-orm';
import { createDbPool, createDb } from '../src/db/client.js';
import { createAuditWriter } from '../src/auth/audit.js';
import { createTokenService } from '../src/auth/token-service.js';
import { campaignDrafts } from '../src/db/schema/invitations.js';
import { DRAFT_TOKEN_PATH } from '../src/auth/token-routes.js';

/** Refuses rather than falling back to a default — the seed-script posture. */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. This script refuses to guess it.`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const databaseUrl = required('DATABASE_URL');
  const draftId = required('DRAFT_ID');
  const appBaseUrl = required('APP_BASE_URL').replace(/\/+$/, '');

  const pool = createDbPool(databaseUrl);
  const db = createDb(pool);

  try {
    const [draft] = await db
      .select({
        id: campaignDrafts.id,
        status: campaignDrafts.status,
        anonymisedAt: campaignDrafts.anonymisedAt,
      })
      .from(campaignDrafts)
      .where(eq(campaignDrafts.id, draftId))
      .limit(1);

    if (!draft) {
      console.error(`No campaign_drafts row with id ${draftId}.`);
      process.exit(1);
    }
    if (draft.anonymisedAt) {
      console.error('That draft was anonymised (§25.8). There is nothing behind a link.');
      process.exit(1);
    }

    // The real token service: the real hash, the real lineage, the real 30-day
    // §7 expiry, and a real `token.issued` audit row. Nothing here reimplements
    // any of it — a second minting path is how two answers to "is this token
    // live" come to exist.
    const tokens = createTokenService({
      db,
      audit: createAuditWriter(db),
      // founder_draft tokens are stored as a plain SHA-256 of the raw value;
      // the secret is used only by the six-digit email code's HMAC. Passed
      // because the constructor requires it, read by nothing on this path.
      secret: process.env['BETTER_AUTH_SECRET'] ?? 'unused-on-this-path',
    });

    const issued = await tokens.issue(
      { scope: 'founder_draft', campaignDraftId: draft.id },
      { actorId: 'script:issue-draft-link' },
    );

    console.log('\n  Draft:      ', draft.id, `(status: ${draft.status})`);
    console.log('  Token id:   ', issued.record.id, `v${issued.record.version}`);
    console.log('  Expires:    ', issued.record.expiresAt?.toISOString() ?? 'never');
    console.log('\n  LINK:\n');
    console.log(`  ${appBaseUrl}/draft/${issued.raw}\n`);
    console.log(`  (API prefix, if you need it: ${appBaseUrl}${DRAFT_TOKEN_PATH}/${issued.raw})`);
    console.log('\n  The raw value is printed once and is not recoverable. A real');
    console.log('  Send will rotate the lineage and kill this link.\n');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
