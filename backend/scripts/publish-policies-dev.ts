/**
 * Publishes the three §10 policy documents — LOCAL DEVELOPMENT ONLY.
 *
 * ── Read this before running it ─────────────────────────────────────────────
 * This does NOT make the documents real. The approved text is Track A2 and is
 * with counsel; §1 rule 6 forbids inventing it and §31.4 forbids shipping a
 * summary in its place. All this does is flip the STATUS of three rows so that
 * `policy_consents` — whose trigger accepts only a published version — can
 * record a consent on a local machine, which is what the public Founder signup
 * needs in order to be exercisable at all.
 *
 * So on a dev database this is a convenience. Anywhere else it is a lie: it
 * would record real people as having accepted documents that do not exist.
 * The script refuses to run against anything but a local database for that
 * reason, and refuses in production outright.
 *
 * ── Why it cannot be undone ─────────────────────────────────────────────────
 * `enforce_policy_version_immutability` (migration 0003) refuses `published →
 * draft`, because §29.8 compares consents against published versions and a
 * document that could be unpublished would strand every consent citing it. To
 * get back to a clean slate, drop and recreate the dev database and re-run the
 * migrations — which is why the dev database is its own, disposable one.
 *
 * `version` is immutable too, so the rows keep their `1.0.0-draft` identifier.
 * That is deliberate and useful: a consent recorded locally is visibly a
 * consent to a draft-versioned document and can never be mistaken for a real
 * one.
 *
 * Usage (from backend/):
 *   npx tsx --env-file=../.env scripts/publish-policies-dev.ts
 */

import { validateEnv } from '../src/env.js';
import { createDbPool } from '../src/db/client.js';
import { FOUNDER_SIGNUP_POLICY_SLUGS } from '../src/auth/public-signup.js';

function isLocal(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

async function main() {
  const env = validateEnv();

  if (env.NODE_ENV === 'production') {
    console.error('Refusing to run in production. Publishing a policy is one-way.');
    process.exit(1);
  }
  if (!isLocal(env.DATABASE_URL)) {
    console.error(
      'Refusing to run: DATABASE_URL does not point at localhost.\n' +
        'This script publishes policy documents irreversibly and is for a disposable dev database only.',
    );
    process.exit(1);
  }

  const pool = createDbPool(env.DATABASE_URL);
  try {
    const slugs = [...FOUNDER_SIGNUP_POLICY_SLUGS];

    // The CHECK constraint requires effective_date and published_at together
    // with the status, so all three move in one statement. Only rows that are
    // still drafts are touched, which makes re-running a no-op rather than an
    // error.
    const { rows } = await pool.query<{ slug: string; version: string; status: string }>(
      `UPDATE policy_versions
          SET status = 'published',
              effective_date = COALESCE(effective_date, CURRENT_DATE),
              published_at   = COALESCE(published_at, now()),
              updated_at     = now()
        WHERE slug = ANY($1::text[])
          AND status = 'draft'
        RETURNING slug, version, status`,
      [slugs],
    );

    if (rows.length === 0) {
      console.log('Nothing to do — those documents are already published locally.');
    } else {
      console.log(`Published ${rows.length} document(s) locally:`);
      for (const r of rows) console.log(`  ${r.slug}@${r.version} -> ${r.status}`);
    }

    const { rows: state } = await pool.query<{ slug: string; status: string }>(
      `SELECT slug, status FROM policy_versions ORDER BY slug`,
    );
    console.log('\nLocal policy state:');
    for (const r of state) console.log(`  ${r.status.padEnd(9)} ${r.slug}`);
    console.log(
      '\nThe other five stay drafts on purpose: §34 condition 4 needs all eight,' +
        '\nso the live-mode gate remains shut even on this machine.\n',
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
