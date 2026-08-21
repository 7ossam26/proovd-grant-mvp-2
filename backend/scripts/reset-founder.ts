/**
 * Local-dev convenience only — NOT part of the production build.
 *
 * Wipes one Founder's test record and sends them a fresh §7 invitation, so the
 * onboarding flow can be walked from screen 1 again. Written because walking it
 * repeatedly otherwise means hand-tracing four UUIDs through seventeen tables
 * between every attempt.
 *
 * ── What it deliberately is not ─────────────────────────────────────────────
 * It is not a bypass and it invents no state. The purge is plain DELETEs
 * against local test rows; everything after it drives the SAME Admin HTTP
 * routes a person uses — `POST /api/admin/founders`, `PUT …/invitation`,
 * `POST …/send` — so the invitation that arrives went through §7's preview
 * gate, its send record, and its notification dedup exactly as a real one does.
 * Nothing here writes a campaign, a consent, or a token by hand.
 *
 * It cannot run by accident in production: it refuses on NODE_ENV=production,
 * it needs shell access and the database URL, it is never invoked by the
 * Dockerfile, the server, or any job, and it is not compiled into
 * `backend/dist` — `tsconfig.json`'s `rootDir` is `src`, and this lives outside
 * it.
 *
 * ── Why it deletes rather than anonymises ───────────────────────────────────
 * §25.8's retention sweep anonymises, because a real prospect's audit evidence
 * has to outlive their content. That is the right behaviour for the product and
 * the wrong one here: an anonymised prospect still holds the email address
 * against a Better Auth account, so the next claim would collide. These are
 * rows nobody has ever been, on a local database.
 *
 * Usage (from backend/):
 *   npx tsx --env-file=../.env scripts/reset-founder.ts founder@example.com
 *
 * The Admin it signs in as defaults to `seed-dev-admin.ts`'s identity; override
 * with SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD.
 */

import { validateEnv } from '../src/env.js';
import { createDbPool, createDb } from '../src/db/client.js';
import { sql } from 'drizzle-orm';

const email = process.argv[2];
if (!email) {
  console.error('Usage: reset-founder.ts <email>');
  process.exit(1);
}

const ADMIN_EMAIL = (process.env['SEED_ADMIN_EMAIL'] ?? 'admin@proovd.local').toLowerCase();
const ADMIN_PASSWORD = process.env['SEED_ADMIN_PASSWORD'] ?? 'DevAdmin!Local1234';

/**
 * The tables that actually hold rows for one Founder's campaign, children
 * first. Everything here is keyed on the campaign, the draft, the prospect, or
 * the Better Auth user, all four resolved from the email alone.
 *
 * `campaigns` has ~100 tables pointing at it and all but these are empty for a
 * campaign that never went live, so this is the reachable set rather than the
 * declared one. A DELETE against an empty table is free; if a later phase makes
 * one of the others reachable pre-launch, the transaction fails loudly on its
 * foreign key rather than half-purging.
 */
const PURGE = `
  CREATE TEMP TABLE _t ON COMMIT DROP AS
  SELECT fp.id AS prospect_id, cd.id AS draft_id, c.id AS campaign_id, u.id AS user_id
  FROM founder_prospects fp
  LEFT JOIN campaign_drafts cd ON cd.prospect_id = fp.id
  LEFT JOIN campaigns c        ON c.id = cd.campaign_id
  LEFT JOIN "user" u           ON lower(u.email) = lower(fp.email) AND u.role = 'founder'
  WHERE lower(fp.email) = lower($1);

  DELETE FROM optional_item_events           WHERE campaign_id IN (SELECT campaign_id FROM _t);
  DELETE FROM campaign_optional_items        WHERE campaign_id IN (SELECT campaign_id FROM _t);
  DELETE FROM high_effort_classifications    WHERE campaign_id IN (SELECT campaign_id FROM _t);
  DELETE FROM listing_fee_calculations       WHERE campaign_id IN (SELECT campaign_id FROM _t);
  DELETE FROM campaign_workspace             WHERE campaign_id IN (SELECT campaign_id FROM _t);
  DELETE FROM campaign_social_profiles       WHERE campaign_id IN (SELECT campaign_id FROM _t);
  DELETE FROM campaign_assets                WHERE campaign_id IN (SELECT campaign_id FROM _t);
  DELETE FROM interview_booking_events       WHERE campaign_id IN (SELECT campaign_id FROM _t);
  DELETE FROM founder_interview_bookings     WHERE campaign_id IN (SELECT campaign_id FROM _t);
  DELETE FROM possible_creator_results       WHERE campaign_id IN (SELECT campaign_id FROM _t);
  DELETE FROM founder_fixed_payment_openness WHERE campaign_id IN (SELECT campaign_id FROM _t);
  DELETE FROM campaign_build                 WHERE campaign_id IN (SELECT campaign_id FROM _t);

  DELETE FROM draft_field_edits              WHERE draft_id IN (SELECT draft_id FROM _t);
  DELETE FROM campaign_invitation_sends      WHERE draft_id IN (SELECT draft_id FROM _t);
  DELETE FROM secure_tokens                  WHERE campaign_draft_id IN (SELECT draft_id FROM _t);

  DELETE FROM policy_consents   WHERE subject_id IN (SELECT user_id FROM _t WHERE user_id IS NOT NULL);
  DELETE FROM campaign_vetting        WHERE campaign_id IN (SELECT campaign_id FROM _t);
  DELETE FROM founder_claim_profiles  WHERE campaign_id IN (SELECT campaign_id FROM _t);
  DELETE FROM campaign_status_history WHERE campaign_id IN (SELECT campaign_id FROM _t);
  DELETE FROM campaign_drafts   WHERE id IN (SELECT draft_id FROM _t);
  DELETE FROM campaigns         WHERE id IN (SELECT campaign_id FROM _t);
  DELETE FROM founder_prospects WHERE id IN (SELECT prospect_id FROM _t);

  DELETE FROM session WHERE user_id IN (SELECT user_id FROM _t WHERE user_id IS NOT NULL);
  DELETE FROM account WHERE user_id IN (SELECT user_id FROM _t WHERE user_id IS NOT NULL);
  DELETE FROM "user"  WHERE id IN (SELECT user_id FROM _t WHERE user_id IS NOT NULL);
`;

async function main() {
  const env = validateEnv();

  if (env.NODE_ENV === 'production') {
    console.error(
      'Refusing to run: NODE_ENV is production.\n' +
        'This script deletes a Founder, their campaign, and their account.',
    );
    process.exitCode = 1;
    return;
  }

  const base = env.APP_BASE_URL.replace(/\/$/, '');
  const api = process.env['RESET_API_BASE'] ?? 'http://localhost:3000';

  const pool = createDbPool(env.DATABASE_URL);
  const db = createDb(pool);

  try {
    // One transaction: a refusal anywhere rolls the whole purge back rather
    // than leaving a half-deleted campaign nothing can clean up.
    await db.transaction(async (tx) => {
      for (const statement of PURGE.split(';').map((s) => s.trim()).filter(Boolean)) {
        await tx.execute(sql.raw(statement.replace('$1', `'${email.replace(/'/g, "''")}'`)));
      }
    });
    console.log(`Purged every local record for ${email}.`);
  } finally {
    await pool.end();
  }

  /* ── Everything below drives the real Admin routes ─────────────────────── */

  // Better Auth and `crossOriginWriteGuard` both refuse a state-changing
  // request whose Origin is present and untrusted, and Node's fetch sends one
  // where curl sends none — so it has to be the app's own base URL rather than
  // left to the runtime.
  const origin = base;

  const signIn = await fetch(`${api}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (!signIn.ok) {
    console.error(
      `Could not sign in as ${ADMIN_EMAIL} (${signIn.status}).\n` +
        'Is the backend running, and has scripts/seed-dev-admin.ts been run?',
    );
    process.exitCode = 1;
    return;
  }
  // Admin writes that reach a person take `requireFreshSession`, so this cookie
  // has to be minted immediately before the send rather than reused.
  const cookie = (signIn.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');

  const post = async (path: string, body: unknown, method = 'POST') => {
    const res = await fetch(`${api}${path}`, {
      method,
      headers: { 'content-type': 'application/json', cookie, origin },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status}\n${text}`);
    return text ? JSON.parse(text) : {};
  };

  const created = await post('/api/admin/founders', {
    legalName: 'Ahmed Founder',
    email,
    productName: 'Test Founder Product',
    productUrl: 'https://example.com',
    invitationSource: 'local testing',
    internalOwner: 'Dev Admin',
  });

  // §7 refuses to send while any bracketed marker survives in the rendered
  // message, so every field the template names has to be filled in first.
  await post(
    `/api/admin/founders/${created.draftId}/invitation`,
    {
      whatWeUnderstood:
        'You are building a product that helps founders test their offer with real backers before committing further.',
      whyInvited: 'Your product looked like a strong fit for a founder-led crowdfunding pilot.',
      senderName: 'Dev Admin',
      senderEmail: ADMIN_EMAIL,
      expectedSetupTime: 'About 20 minutes',
    },
    'PUT',
  );

  const sent = await post(`/api/admin/founders/${created.draftId}/send`, {});

  console.log(`\nInvitation sent to ${email}.`);
  console.log('  campaign:  ', created.campaignId);
  console.log('  draft:     ', created.draftId);
  console.log('  token:     ', `v${sent.tokenVersion}${sent.resent ? ' (resent)' : ' (new)'}`);
  console.log(`\nThe link lands on ${base}/draft/<token>.\n`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
