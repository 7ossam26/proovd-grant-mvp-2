/**
 * Phase 06a suite — global configuration and the production prerequisites
 * panel, against a real Postgres and the real `createApp` wiring.
 *
 *  - Drift guard: `app_settings` mirrors `shared/src/settings/registry.ts` row
 *    for row, the same way `policy_versions` mirrors the policy register. The
 *    Admin surface renders the register and the guards read the table; if they
 *    can disagree, one of them is lying.
 *  - §6: every constant is persisted, versioned, and audited; a `derived` value
 *    cannot be edited; a setting §6 fixes no number for ships unset.
 *  - §6: incomplete prerequisites BLOCK. Not warn.
 *  - §25.6: every change records actor, prior and new value, reason, and time.
 *  - §33.12.5: the Admin routes are the first real mount of the Phase 04
 *    guards — no session, wrong role, unenrolled factor, and stale session all
 *    fail closed on a real product surface rather than on a probe route.
 *
 * Mutating cases run inside a transaction that is rolled back, so the seeded
 * configuration — the state the repository actually ships in — survives the
 * file. The route-level cases commit, and restore what they changed.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { eq, and, desc } from 'drizzle-orm';
import type { PoolClient } from 'pg';

import { startHarness, type Harness, TEST_PREREQUISITE_ENVIRONMENT } from './app-harness.js';
import { createAdmin, seedUser, signInPlain, type AdminSession } from './admin-session.js';
import { appSettings, appSettingVersions } from '../db/schema/settings.js';
import { auditEvents } from '../db/schema/integrity.js';
import {
  readSettings,
  readSettingValue,
  readSettingHistory,
  readAdminReauthWindowSeconds,
  readMissingRequiredSettings,
  updateSetting,
  seedAdminReauthWindow,
  SettingNotConfigured,
} from '../settings/service.js';
import {
  readPrerequisites,
  recordPrerequisite,
  PREREQUISITE_DEFINITIONS,
} from '../admin/prerequisites.js';
import { parseValue } from '../settings/values.js';
import {
  SETTING_DEFINITIONS,
  findSetting,
  parseSettingValue as sharedParse,
} from '@proovd/shared';

let h: Harness;
let admin: AdminSession;

beforeAll(async () => {
  h = await startHarness({}, 'settings');
  admin = await createAdmin(h, 'settings-admin');
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

/** Runs `body` inside a transaction that is always rolled back. */
async function inRollback(body: (client: PoolClient) => Promise<void>): Promise<void> {
  const client = await h.pool.connect();
  try {
    await client.query('BEGIN');
    await body(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

/** Restores one setting to its seeded value after a committing test. */
async function restore(key: string): Promise<void> {
  const definition = findSetting(key);
  await h.pool.query(
    `UPDATE app_settings
        SET value = $2, updated_by = 'system:test', update_reason = 'restored seeded value after test'
      WHERE key = $1`,
    [key, definition?.defaultValue ?? null],
  );
}

/* ── The register and the table agree ──────────────────────────────────────── */

describe('app_settings mirrors the §6 register', () => {
  it('has exactly one row per registered setting, with identical fields', async () => {
    const { rows } = await h.pool.query(
      `SELECT key, value, kind, provenance, minimum, maximum, spec_ref
         FROM app_settings ORDER BY key`,
    );

    const expected = [...SETTING_DEFINITIONS]
      .map((d) => ({
        key: d.key,
        value: d.defaultValue,
        kind: d.kind,
        provenance: d.provenance,
        minimum: d.minimum ?? null,
        maximum: d.maximum ?? null,
        spec_ref: d.specRef,
      }))
      .sort((a, b) => a.key.localeCompare(b.key));

    expect(rows).toEqual(expected);
  });

  it('agrees with the shared parser on every seeded value', () => {
    // Two implementations of one contract — the shared one for immediate
    // feedback in the Admin surface, the backend one for the decision (§1.1).
    // They are allowed to word a refusal differently; they are not allowed to
    // disagree about what is valid.
    for (const definition of SETTING_DEFINITIONS) {
      if (definition.defaultValue === null) continue;
      const shared = sharedParse(definition, definition.defaultValue);
      const backend = parseValue(
        {
          kind: definition.kind,
          minimum: definition.minimum ?? null,
          maximum: definition.maximum ?? null,
          specRef: definition.specRef,
        },
        definition.defaultValue,
      );
      expect(backend.ok, definition.key).toBe(shared.ok);
      if (shared.ok && backend.ok) {
        expect(backend.value, definition.key).toEqual(shared.value);
      }
    }
  });

  it('starts every setting at version 1 with a stated actor and reason', async () => {
    const { rows } = await h.pool.query<{
      version: number;
      updated_by: string;
      update_reason: string;
    }>('SELECT version, updated_by, update_reason FROM app_settings');

    for (const row of rows) {
      expect(row.updated_by).toBeTruthy();
      expect(row.update_reason).toBeTruthy();
    }
    // The bootstrap seed may have advanced admin_reauth_window_seconds.
    expect(rows.filter((r) => r.version !== 1).length).toBeLessThanOrEqual(1);
  });

  it('wrote a history row for every seeded setting', async () => {
    const { rows } = await h.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM app_setting_versions WHERE version = 1`,
    );
    expect(Number(rows[0]!.count)).toBe(SETTING_DEFINITIONS.length);
  });

  it('reads back through the service, parsed', async () => {
    const rows = await readSettings(h.db);
    expect([...rows.map((r) => r.key)].sort()).toEqual(
      [...SETTING_DEFINITIONS.map((d) => d.key)].sort(),
    );

    const platformFee = rows.find((r) => r.key === 'platform_fee_percent');
    expect(platformFee?.parsed).toBe(5);

    const listingBase = rows.find((r) => r.key === 'listing_fee_base_cents');
    expect(listingBase?.parsed).toBe(3500n);

    const highEffort = rows.find((r) => r.key === 'high_effort_inputs');
    expect(highEffort?.parsed).toEqual([
      'visuals_absent',
      'branding_absent',
      'founder_interview_absent',
    ]);
  });
});

/* ── §6: a setting the Spec fixes no number for ships unset ────────────────── */

describe('§6 settings with no stated value block rather than default (§1 rule 6)', () => {
  it('leaves every operator setting unset except the bootstrapped one', async () => {
    const missing = await readMissingRequiredSettings(h.db);
    const operatorKeys = SETTING_DEFINITIONS.filter((d) => d.provenance === 'operator').map(
      (d) => d.key,
    );
    // Every operator setting is unset. `admin_reauth_window_seconds` is too,
    // until the first-boot seed runs — which the harness does not do, because
    // it constructs the app directly rather than going through index.ts.
    expect([...missing].sort()).toEqual([...operatorKeys].sort());
  });

  it('refuses to hand a caller an unconfigured value instead of a fallback', async () => {
    await expect(readSettingValue(h.db, 'product_min_duration_days')).rejects.toBeInstanceOf(
      SettingNotConfigured,
    );
  });

  it('reports the Admin reauthentication window as null while unset, so the guard blocks', async () => {
    expect(await readAdminReauthWindowSeconds(h.db)).toBeNull();
  });

  it('rejects a NULL value on a setting §6 does fix a number for', async () => {
    await inRollback(async (client) => {
      await expect(
        client.query(`UPDATE app_settings SET value = NULL WHERE key = 'platform_fee_percent'`),
      ).rejects.toThrow(/app_settings_value_matches_provenance/);
    });
  });
});

/* ── Versioning, history, and audit (§25.6) ────────────────────────────────── */

describe('a settings change is versioned, historied, and audited', () => {
  it('increments the version, writes a history row, and writes an audit row', async () => {
    const before = await h.db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, 'founder_cooldown_months'));
    const priorVersion = before[0]!.version;

    const result = await updateSetting(h.db, {
      key: 'founder_cooldown_months',
      value: '6',
      actor: 'user:test-admin',
      reason: 'pilot cohort spacing agreed with the founding team',
      mfaContext: 'totp_factor_registered',
      reauthContext: 'session_established_at=2026-07-31T00:00:00.000Z',
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.row.version).toBe(priorVersion + 1);
    expect(result.ok && result.row.value).toBe('6');

    const history = await readSettingHistory(h.db, 'founder_cooldown_months');
    expect(history[0]).toMatchObject({
      version: priorVersion + 1,
      priorValue: '3',
      newValue: '6',
      changedBy: 'user:test-admin',
      reason: 'pilot cohort spacing agreed with the founding team',
    });

    const [audit] = await h.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.targetType, 'app_setting'),
          eq(auditEvents.targetId, 'founder_cooldown_months'),
        ),
      )
      .orderBy(desc(auditEvents.occurredAt))
      .limit(1);

    expect(audit).toMatchObject({
      actor: 'user:test-admin',
      action: 'setting.updated',
      mfaContext: 'totp_factor_registered',
      internalReason: 'pilot cohort spacing agreed with the founding team',
    });
    expect(audit!.priorValue).toEqual({ value: '3', version: priorVersion });
    expect(audit!.newValue).toEqual({ value: '6', version: priorVersion + 1 });

    await restore('founder_cooldown_months');
  });

  it('writes no history row when the value is unchanged', async () => {
    const before = await readSettingHistory(h.db, 'platform_fee_percent');

    const result = await updateSetting(h.db, {
      key: 'platform_fee_percent',
      value: '  5  ',
      actor: 'user:test-admin',
      reason: 'no-op check',
    });

    expect(result.ok).toBe(true);
    const after = await readSettingHistory(h.db, 'platform_fee_percent');
    expect(after).toHaveLength(before.length);
  });

  it('refuses a change with no reason', async () => {
    const result = await updateSetting(h.db, {
      key: 'platform_fee_percent',
      value: '7',
      actor: 'user:test-admin',
      reason: '   ',
    });
    expect(result).toEqual({
      ok: false,
      message: 'Say why this is changing. The reason is stored with the change.',
    });
  });

  it('refuses an invalid value and changes nothing', async () => {
    const result = await updateSetting(h.db, {
      key: 'platform_fee_percent',
      value: '5%',
      actor: 'user:test-admin',
      reason: 'typo',
    });
    expect(result.ok).toBe(false);
    expect(await readSettingValue(h.db, 'platform_fee_percent')).toBe(5);
  });

  it('enforces the "at least three months" floor §6 states in words', async () => {
    const result = await updateSetting(h.db, {
      key: 'founder_cooldown_months',
      value: '1',
      actor: 'user:test-admin',
      reason: 'attempt to shorten below the §6 floor',
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/floor of 3/);
  });
});

/* ── The database's own guarantees ─────────────────────────────────────────── */

describe('the settings table defends itself (§25.6, §29.6)', () => {
  it('refuses to repoint a setting key at a different rule', async () => {
    await inRollback(async (client) => {
      await expect(
        client.query(
          `UPDATE app_settings
              SET key = 'platform_fee_percent', updated_by = 'x', update_reason = 'y'
            WHERE key = 'affiliate_percentage_ceiling'`,
        ),
      ).rejects.toThrow(/identity is immutable/);
    });
  });

  it.each([
    ['kind', `UPDATE app_settings SET kind = 'text' WHERE key = 'platform_fee_percent'`],
    [
      'provenance',
      `UPDATE app_settings SET provenance = 'operator' WHERE key = 'platform_fee_percent'`,
    ],
    // One statement per transaction: the first failure aborts the block, so a
    // second assertion in the same one would only observe that abort.
  ])('refuses to change a setting’s %s', async (_field, statement) => {
    await inRollback(async (client) => {
      await expect(client.query(statement)).rejects.toThrow(/identity is immutable/);
    });
  });

  it('refuses to edit a derived value — the calendar is not a text box (§29.6)', async () => {
    await inRollback(async (client) => {
      await expect(
        client.query(
          `UPDATE app_settings
              SET value = 'us-federal.v2', updated_by = 'x', update_reason = 'y'
            WHERE key = 'business_day_calendar_version'`,
        ),
      ).rejects.toThrow(/derived setting is not editable/);
    });
  });

  it('refuses a derived edit through the service too, with an explanation', async () => {
    const result = await updateSetting(h.db, {
      key: 'business_day_time_zone',
      value: 'America/Chicago',
      actor: 'user:test-admin',
      reason: 'trying to move the calendar',
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/committed business-day calendar/);
  });

  it('ignores a caller-supplied version — the trigger owns it', async () => {
    await inRollback(async (client) => {
      await client.query(
        `UPDATE app_settings
            SET value = '4', version = 99, updated_by = 'x', update_reason = 'y'
          WHERE key = 'required_promotional_posts'`,
      );
      const { rows } = await client.query<{ version: number }>(
        `SELECT version FROM app_settings WHERE key = 'required_promotional_posts'`,
      );
      expect(rows[0]!.version).toBe(2);
    });
  });

  it('keeps the history append-only for the application role', async () => {
    await inRollback(async (client) => {
      await client.query('SET ROLE proovd_app');
      await expect(
        client.query(`UPDATE app_setting_versions SET reason = 'rewritten'`),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('lets the application role read and update settings but never insert or delete one', async () => {
    await inRollback(async (client) => {
      await client.query('SET ROLE proovd_app');
      await expect(
        client.query(`DELETE FROM app_settings WHERE key = 'platform_fee_percent'`),
      ).rejects.toMatchObject({ code: '42501' });
    });
    await inRollback(async (client) => {
      await client.query('SET ROLE proovd_app');
      await expect(
        client.query(
          `INSERT INTO app_settings (key, value, kind, provenance, updated_by, update_reason)
           VALUES ('invented_rule', '1', 'count', 'specified', 'x', 'y')`,
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });
});

/* ── First-boot seeding ────────────────────────────────────────────────────── */

describe('the Admin reauthentication window is seeded once, then owned by the setting', () => {
  it('seeds from the environment while unset, and never again', async () => {
    expect(await readAdminReauthWindowSeconds(h.db)).toBeNull();

    expect(await seedAdminReauthWindow(h.db, 900)).toBe('seeded');
    expect(await readAdminReauthWindowSeconds(h.db)).toBe(900);

    // A restart with a different environment value must not silently reset a
    // window an Admin has since chosen.
    expect(await seedAdminReauthWindow(h.db, 60)).toBe('already_set');
    expect(await readAdminReauthWindowSeconds(h.db)).toBe(900);

    const history = await readSettingHistory(h.db, 'admin_reauth_window_seconds');
    expect(history[0]).toMatchObject({
      priorValue: null,
      newValue: '900',
      changedBy: 'system:bootstrap',
    });

    await restore('admin_reauth_window_seconds');
  });
});

/* ── §6 prerequisites fail closed ──────────────────────────────────────────── */

describe('§6 production prerequisites block rather than warn', () => {
  it('covers every item §6 names', () => {
    expect(PREREQUISITE_DEFINITIONS.map((d) => d.key)).toEqual([
      'public_routes',
      'policies',
      'support_details',
      'sample_campaigns',
      'transactional_email',
      'stripe_key_separation',
      'webhook_endpoints',
      'tax_configuration',
      'pilot_feature_flags',
      'operating_constants',
    ]);
  });

  it('blocks on the shipped state, and every unsatisfied item says what would satisfy it', async () => {
    const panel = await readPrerequisites(h.db, TEST_PREREQUISITE_ENVIRONMENT);

    expect(panel.blocking).toBe(true);
    expect(panel.unsatisfiedKeys.length).toBeGreaterThan(0);

    for (const item of panel.items) {
      expect(item.definition.requirement).toBeTruthy();
      expect(item.detail).toBeTruthy();
    }
  });

  it('treats an unverified recorded item as unsatisfied, not as unknown', async () => {
    const panel = await readPrerequisites(h.db, TEST_PREREQUISITE_ENVIRONMENT);
    const routes = panel.items.find((i) => i.definition.key === 'public_routes')!;
    expect(routes.satisfied).toBe(false);
    expect(routes.attestation).toBeNull();
    expect(routes.detail).toMatch(/Not verified yet/);
  });

  it('blocks on the policy gate while any document is a draft', async () => {
    const panel = await readPrerequisites(h.db, TEST_PREREQUISITE_ENVIRONMENT);
    const policies = panel.items.find((i) => i.definition.key === 'policies')!;
    expect(policies.satisfied).toBe(false);
    expect(policies.detail).toMatch(/still in draft/);
  });

  it('blocks on unset operating constants and names them', async () => {
    const panel = await readPrerequisites(h.db, TEST_PREREQUISITE_ENVIRONMENT);
    const constants = panel.items.find((i) => i.definition.key === 'operating_constants')!;
    expect(constants.satisfied).toBe(false);
    expect(constants.detail).toMatch(/have no value yet/);
    // Keys, not labels — the Admin surface renders the label from the register
    // it imports, so no §6 prose is duplicated server-side.
    expect(constants.subjectKeys).toContain('interview_providers');
  });

  it('blocks on a missing webhook secret and names which stream is unprotected', async () => {
    const panel = await readPrerequisites(h.db, {
      ...TEST_PREREQUISITE_ENVIRONMENT,
      platformWebhookSecretPresent: true,
      connectWebhookSecretPresent: false,
    });
    const webhooks = panel.items.find((i) => i.definition.key === 'webhook_endpoints')!;
    expect(webhooks.satisfied).toBe(false);
    expect(webhooks.subjectKeys).toEqual(['connect']);
  });

  it('records an attestation with a named person, a note, and evidence', async () => {
    const recorded = await recordPrerequisite(h.db, {
      prerequisiteKey: 'sample_campaigns',
      status: 'satisfied',
      recordedBy: 'user:test-admin',
      note: 'Both sample pages inspected: no form, input, iframe, or provider script in the DOM.',
      evidenceLinks: ['https://example.test/run/1'],
    });
    expect(recorded).toEqual({ ok: true });

    const panel = await readPrerequisites(h.db, TEST_PREREQUISITE_ENVIRONMENT);
    const samples = panel.items.find((i) => i.definition.key === 'sample_campaigns')!;
    expect(samples.satisfied).toBe(true);
    expect(samples.attestation?.recordedBy).toBe('user:test-admin');
    // The panel still blocks — one satisfied item is not a satisfied gate.
    expect(panel.blocking).toBe(true);
  });

  it('lets a later row withdraw an earlier attestation without erasing it', async () => {
    await recordPrerequisite(h.db, {
      prerequisiteKey: 'sample_campaigns',
      status: 'not_satisfied',
      recordedBy: 'user:second-admin',
      note: 'A payment iframe appeared on the Product sample after the last deploy.',
    });

    const panel = await readPrerequisites(h.db, TEST_PREREQUISITE_ENVIRONMENT);
    const samples = panel.items.find((i) => i.definition.key === 'sample_campaigns')!;
    expect(samples.satisfied).toBe(false);
    expect(samples.attestation?.recordedBy).toBe('user:second-admin');

    const { rows } = await h.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM production_prerequisites WHERE prerequisite_key = 'sample_campaigns'`,
    );
    expect(Number(rows[0]!.count)).toBe(2);
  });

  it('refuses a human attestation over an automatic check', async () => {
    const result = await recordPrerequisite(h.db, {
      prerequisiteKey: 'policies',
      status: 'satisfied',
      recordedBy: 'user:test-admin',
      note: 'Counsel says the documents are fine.',
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/checked by the system/);
  });

  it('refuses an attestation with no note', async () => {
    const result = await recordPrerequisite(h.db, {
      prerequisiteKey: 'tax_configuration',
      status: 'satisfied',
      recordedBy: 'user:test-admin',
      note: '  ',
    });
    expect(result.ok).toBe(false);
  });
});

/* ── The guards, on a real product surface (§33.12.5) ──────────────────────── */

describe('the Admin routes are guarded (§5.1, §28.2, §33.12.5)', () => {
  it('refuses an unauthenticated request', async () => {
    await request(h.app).get('/api/admin/settings').expect(401);
  });

  it('refuses a Founder', async () => {
    const founder = await seedUser(h, 'founder', 'founder');
    const cookie = await signInPlain(h, founder.email);
    await request(h.app).get('/api/admin/settings').set('cookie', cookie).expect(403);
  });

  it('refuses an Admin who has not enrolled a second factor', async () => {
    const unenrolled = await seedUser(h, 'admin', 'unenrolled');
    const cookie = await signInPlain(h, unenrolled.email);
    const res = await request(h.app).get('/api/admin/settings').set('cookie', cookie);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('mfa_enrollment_required');
  });

  it('serves the settings surface to an enrolled Admin', async () => {
    const res = await request(h.app)
      .get('/api/admin/settings')
      .set('cookie', admin.cookie)
      .expect(200);

    expect(res.body.settings).toHaveLength(SETTING_DEFINITIONS.length);

    const derived = res.body.settings.find(
      (s: { key: string }) => s.key === 'business_day_calendar_version',
    );
    expect(derived.editable).toBe(false);
  });

  it('blocks a settings write while the reauthentication window is unset', async () => {
    // §6 names the window and fixes no number. Until one is stated, the guard
    // cannot tell whether a sign-in is recent enough — and refuses.
    expect(await readAdminReauthWindowSeconds(h.db)).toBeNull();

    const res = await request(h.app)
      .put('/api/admin/settings/required_promotional_posts')
      .set('cookie', admin.cookie)
      .send({ value: '4', reason: 'should not land' });

    expect(res.status).toBe(503);
    expect(res.body.error).toBe('reauthentication_window_unconfigured');
    expect(await readSettingValue(h.db, 'required_promotional_posts')).toBe(3);
  });

  it('allows the write once the window is configured, and records the actor', async () => {
    await seedAdminReauthWindow(h.db, 3600);
    try {
      await request(h.app)
        .put('/api/admin/settings/required_promotional_posts')
        .set('cookie', admin.cookie)
        .send({ value: '4', reason: 'agreed with the first Creator cohort' })
        .expect(200);

      expect(await readSettingValue(h.db, 'required_promotional_posts')).toBe(4);

      const history = await readSettingHistory(h.db, 'required_promotional_posts');
      expect(history[0]).toMatchObject({
        newValue: '4',
        changedBy: `user:${admin.id}`,
        reason: 'agreed with the first Creator cohort',
      });

      const [audit] = await h.db
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.targetType, 'app_setting'),
            eq(auditEvents.targetId, 'required_promotional_posts'),
          ),
        )
        .orderBy(desc(auditEvents.occurredAt))
        .limit(1);
      expect(audit!.mfaContext).toBe('totp_factor_registered');
      expect(audit!.reauthContext).toMatch(/^session_established_at=/);
    } finally {
      await restore('required_promotional_posts');
      await restore('admin_reauth_window_seconds');
    }
  });

  it('refuses a write on a stale session once the window is configured', async () => {
    await seedAdminReauthWindow(h.db, 3600);
    try {
      await h.pool.query(
        `UPDATE session SET created_at = now() - interval '2 days' WHERE user_id = $1`,
        [admin.id],
      );

      const res = await request(h.app)
        .put('/api/admin/settings/required_promotional_posts')
        .set('cookie', admin.cookie)
        .send({ value: '5', reason: 'should not land on a stale session' });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('reauthentication_required');
      expect(await readSettingValue(h.db, 'required_promotional_posts')).toBe(3);
    } finally {
      await restore('admin_reauth_window_seconds');
      // A fresh sign-in for the tests that follow.
      admin = await createAdmin(h, 'settings-admin-refreshed');
    }
  });

  it('reports the prerequisites panel as blocking to an Admin', async () => {
    const res = await request(h.app)
      .get('/api/admin/prerequisites')
      .set('cookie', admin.cookie)
      .expect(200);

    expect(res.body.blocking).toBe(true);
    expect(res.body.items).toHaveLength(PREREQUISITE_DEFINITIONS.length);
    for (const item of res.body.items) {
      expect(typeof item.satisfied).toBe('boolean');
      expect(item.requirement).toBeTruthy();
    }
  });

  it('rejects a settings write with no value or no reason', async () => {
    await seedAdminReauthWindow(h.db, 3600);
    try {
      await request(h.app)
        .put('/api/admin/settings/required_promotional_posts')
        .set('cookie', admin.cookie)
        .send({ value: '4' })
        .expect(400);

      await request(h.app)
        .put('/api/admin/settings/platform_fee_percent')
        .set('cookie', admin.cookie)
        .send({ value: 'five percent', reason: 'typo' })
        .expect(422);
    } finally {
      await restore('admin_reauth_window_seconds');
    }
  });
});
