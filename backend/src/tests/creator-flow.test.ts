/**
 * Creator Flow v2, Session A — the record and the registers.
 * Spec §1 rule 6, §5.3, §8, §11, §14.1, §24, §25.6, §25.8, §29.4, §30, §33.12.4.
 *
 * Session A builds no screen, so there is no surface to render and nothing for
 * a person to walk. What it can prove is the part that has to be true before
 * any of the five later sessions writes a line: **that the guarantees are
 * mechanisms and not intentions.**
 *
 * The three deviation records are each narrowed by WHAT THEIR TABLE CANNOT
 * HOLD, so the strongest tests here are absences read out of
 * `information_schema` rather than assertions about behaviour that does not
 * exist yet:
 *
 *   * a standing tier that cannot become an eligibility flag, because there is
 *     no column any compensation or proposal path could read;
 *   * a referral that cannot pay, because there is no amount column;
 *   * a resource list that cannot become the §31.5 Campaign kit, because there
 *     is no column that could hold campaign material;
 *   * and, across all of them, nothing that could hold a bank account, a tax
 *     id, or a schedule.
 *
 * The other half is drift. Migration 0055 CHECK-pins four closed vocabularies,
 * and a vocabulary that exists in three places — shared, the backend
 * restatement, and a constraint — is three chances to disagree. The
 * disagreement is not theoretical: it surfaces as a Creator picking a tile the
 * register added last week and meeting a constraint violation naming nothing
 * they can act on.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  AFFILIATE_SUBTYPE_DEFINITIONS,
  CREATOR_CHANNEL_METRIC_IDS,
  CREATOR_CHANNEL_TILES,
  CREATOR_CHANNEL_TILE_IDS,
  CREATOR_FLOW_ABSENCES,
  CREATOR_FLOW_OMISSIONS,
  CREATOR_FLOW_PAGES,
  CREATOR_REFERRAL_STATES,
  CREATOR_RESOURCE_IDS,
  CREATOR_SETTINGS_FIELD_IDS,
  CREATOR_SETTINGS_GUARDED_IDS,
  CREATOR_STANDING_INPUTS,
  CREATOR_STANDING_TIER_IDS,
  CREATOR_VOICE_TONE_IDS,
  REFERRAL_PAYS_NOTHING,
  RESOURCES_ARE_NOT_THE_CAMPAIGN_KIT,
  STANDING_BINDS_NOTHING,
  VOICE_IS_NEVER_USED_TO_REWRITE,
  allCreatorChannelMetricIds,
  creatorChannelDisagreesWithSubtype,
  creatorChannelMetricsFor,
  creatorFlowPath,
  creatorStandingTier,
  creatorVoiceViolations,
} from '@proovd/shared';
import { startHarness, type Harness } from './app-harness.js';
import * as backendLogic from '../creator-flow/logic.js';

let h: Harness;

beforeAll(async () => {
  h = await startHarness({}, 'creatorflow');
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

/** Every column of one table, as the database actually has it. */
async function columnsOf(table: string): Promise<string[]> {
  const result = await h.db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}
    ORDER BY column_name
  `);
  return result.rows.map((r) => (r as { column_name: string }).column_name);
}

/** Whether a column may be NULL, keyed by name. */
async function nullabilityOf(table: string): Promise<Record<string, string>> {
  const result = await h.db.execute(sql`
    SELECT column_name, is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}
  `);
  return Object.fromEntries(
    result.rows.map((r) => {
      const row = r as { column_name: string; is_nullable: string };
      return [row.column_name, row.is_nullable];
    }),
  );
}

/** A constraint as Postgres renders it back, not as it was written. */
async function constraintDef(name: string): Promise<string> {
  const result = await h.db.execute(sql`
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ${name}
  `);
  const first = result.rows[0] as { def: string } | undefined;
  return first?.def ?? '';
}

async function tableExists(table: string): Promise<boolean> {
  const result = await h.db.execute(sql`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = ${table}
  `);
  return result.rows.length > 0;
}

/** Every literal inside a CHECK, so a vocabulary can be compared to it. */
function literalsIn(def: string): string[] {
  return [...def.matchAll(/'([a-z0-9_]+)'::text/g)].map((m) => m[1]).sort();
}

const BACKEND_SRC = path.resolve(import.meta.dirname, '..');

function walkTs(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      walkTs(full, out);
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

/** Source with comments stripped — these files explain what they refuse to do. */
function sourceWithoutComments(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/* ══ The vocabularies, three places, one truth ═══════════════════════════════ */

describe('the CHECK-pinned vocabularies do not drift', () => {
  it('restates the four the migration hardcodes, and no more', () => {
    // Shared → backend. A vocabulary is restated only when a CHECK carries it;
    // everything else is presentation and is imported through Vite.
    expect([...backendLogic.CHANNEL_TILE_IDS].sort()).toEqual([...CREATOR_CHANNEL_TILE_IDS].sort());
    expect([...backendLogic.CHANNEL_METRIC_IDS].sort()).toEqual(
      [...CREATOR_CHANNEL_METRIC_IDS].sort(),
    );
    expect([...backendLogic.STANDING_TIER_IDS].sort()).toEqual(
      [...CREATOR_STANDING_TIER_IDS].sort(),
    );
    expect([...backendLogic.RESOURCE_IDS].sort()).toEqual([...CREATOR_RESOURCE_IDS].sort());
    expect([...backendLogic.REFERRAL_STATES].sort()).toEqual([...CREATOR_REFERRAL_STATES].sort());
  });

  it('restates the correction field ids as the settings register plus the two guarded ones', () => {
    const expected = [...CREATOR_SETTINGS_FIELD_IDS, ...CREATOR_SETTINGS_GUARDED_IDS].sort();
    expect([...backendLogic.CORRECTION_FIELD_IDS].sort()).toEqual(expected);
  });

  it('agrees with the database, which is what a Creator actually meets', async () => {
    // Backend → constraint. A drift here is not a failing test somebody reads;
    // it is a save that is refused by a constraint naming nothing actionable.
    expect(literalsIn(await constraintDef('affiliate_signup_channel_type_known'))).toEqual(
      [...backendLogic.CHANNEL_TILE_IDS].sort(),
    );
    expect(literalsIn(await constraintDef('affiliate_channel_metric_id_known'))).toEqual(
      [...backendLogic.CHANNEL_METRIC_IDS].sort(),
    );
    expect(literalsIn(await constraintDef('affiliate_standing_tier_known'))).toEqual(
      [...backendLogic.STANDING_TIER_IDS].sort(),
    );
    expect(literalsIn(await constraintDef('creator_resource_id_known'))).toEqual(
      [...backendLogic.RESOURCE_IDS].sort(),
    );
    expect(literalsIn(await constraintDef('affiliate_correction_field_known'))).toEqual(
      [...backendLogic.CORRECTION_FIELD_IDS].sort(),
    );
    expect(literalsIn(await constraintDef('affiliate_referral_state_known'))).toEqual(
      [...backendLogic.REFERRAL_STATES].sort(),
    );
  });
});

/* ══ One subtype register, not two ══════════════════════════════════════════ */

describe('the channel tiles are presentation over §5.3, not a second register', () => {
  it('maps all nine tiles onto the seven subtypes that already exist', () => {
    const known = new Set(AFFILIATE_SUBTYPE_DEFINITIONS.map((d) => d.id));
    for (const tile of CREATOR_CHANNEL_TILES) {
      expect(known.has(tile.subtype)).toBe(true);
    }
    // The three social tiles are the only ones that carry a platform, and they
    // are what makes nine tiles out of seven subtypes.
    const platformed = CREATOR_CHANNEL_TILES.filter((t) => t.platform !== null);
    expect(platformed.map((t) => t.id).sort()).toEqual(['instagram', 'tiktok', 'youtube']);
    expect(new Set(platformed.map((t) => t.subtype))).toEqual(new Set(['social_creator']));
  });

  it('every metric id is an evidence input §5.3 already names, both directions', () => {
    // Forward: nothing invented. A metric the subtype register does not name is
    // a question a Creator answers and an Admin has nothing to verify against.
    const evidenceIds = new Set(
      AFFILIATE_SUBTYPE_DEFINITIONS.flatMap((d) => d.evidence.map((e) => e.id)),
    );
    for (const id of CREATOR_CHANNEL_METRIC_IDS) {
      expect(evidenceIds.has(id)).toBe(true);
    }
    // Backward: nothing orphaned. A renamed evidence input fails here rather
    // than leaving a CHECK pinning an id nothing produces.
    expect(allCreatorChannelMetricIds()).toEqual([...CREATOR_CHANNEL_METRIC_IDS].sort());
  });

  it('asks a subtype only for the metrics its own §5.3 evidence names', () => {
    expect(creatorChannelMetricsFor('podcast_host').map((m) => m.id).sort()).toEqual([
      'downloads',
      'subscribers',
    ]);
    expect(creatorChannelMetricsFor('community_owner').map((m) => m.id).sort()).toEqual([
      'active_users',
      'members',
    ]);
    // §16a, in its strongest form: a student Creator has no audience metric to
    // enter because §5.3 does not ask them for one. Not zero — not asked.
    expect(creatorChannelMetricsFor('student_affiliate')).toEqual([]);
    expect(creatorChannelMetricsFor('niche_marketer')).toEqual([]);
  });

  it('reports a Creator/Admin channel disagreement rather than resolving it', () => {
    // The Creator says podcast; the Admin classified them a social creator and
    // recorded evidence against that. Overwriting the classification would
    // silently invalidate a verification, so the product surfaces the fact.
    expect(creatorChannelDisagreesWithSubtype('podcast', 'social_creator')).toBe(true);
    expect(creatorChannelDisagreesWithSubtype('youtube', 'social_creator')).toBe(false);
  });
});

/* ══ Deviation 2 — the tier binds nothing ═══════════════════════════════════ */

describe('the standing record cannot become an eligibility input', () => {
  it('has no rate, floor, percentage, multiplier, or eligibility column', async () => {
    const columns = await columnsOf('affiliate_standing_snapshots');
    expect(columns).toEqual([
      'computed_at',
      'id',
      'inputs',
      'percentile',
      'prospect_id',
      'score',
      'tier',
    ]);
    // Named individually as well as by the exact set, so the failure message
    // says WHICH forbidden thing appeared rather than dumping two lists.
    //
    // `percentile` is excluded from the substring scan by name rather than by
    // narrowing the pattern: it contains `percent` and is a RANK POSITION, not
    // a rate — and a scan tuned until it stopped flagging a correct column is a
    // scan that would also stop flagging a wrong one. The exact-set assertion
    // above is what actually holds the line; this loop names the failure.
    const money = columns.filter((c) => c !== 'percentile');
    for (const forbidden of [
      'rate',
      'floor',
      'percent',
      'multiplier',
      'commission',
      'base',
      'proposal_access',
      'eligible',
      'amount',
      'cents',
    ]) {
      expect({ forbidden, has: money.some((c) => c.includes(forbidden)) }).toEqual({
        forbidden,
        has: false,
      });
    }
  });

  it('has no proposal_access column anywhere in the database', async () => {
    // §29.4 makes `restrict bidding` an enforcement action and the Affiliate
    // workspace DERIVES proposal access from §29 records. A stored flag would
    // be a second, contradictory answer — and it is the single most likely
    // thing a later phase would read the standing tier as.
    const result = await h.db.execute(sql`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name LIKE '%proposal_access%'
    `);
    expect(result.rows).toEqual([]);
  });

  it('every score input names the record it is counted from', () => {
    for (const input of CREATOR_STANDING_INPUTS) {
      expect(input.derivedFrom.trim().length).toBeGreaterThan(0);
      expect(input.specRef.trim().length).toBeGreaterThan(0);
    }
    // Deliberately absent, each for its own reason: sales (§22.8 keeps revenue
    // out of completion entirely, §33.10.6), response speed (§14.2 says
    // declining carries no penalty), and the §8 quality tier (assessment data).
    const blob = JSON.stringify(CREATOR_STANDING_INPUTS).toLowerCase();
    for (const forbidden of ['revenue', 'sales', 'quality_tier', 'response_time', 'decline']) {
      expect(blob).not.toContain(forbidden);
    }
  });

  it('resolves a tier from a score and refuses to invent a fifth', () => {
    expect(creatorStandingTier(0)).toBe('starting');
    expect(creatorStandingTier(399)).toBe('starting');
    expect(creatorStandingTier(400)).toBe('established');
    expect(creatorStandingTier(650)).toBe('gold');
    expect(creatorStandingTier(1000)).toBe('platinum');
    expect(CREATOR_STANDING_TIER_IDS).toHaveLength(4);
  });

  it('pins the sentence that keeps the tier honest', () => {
    expect(STANDING_BINDS_NOTHING).toMatch(/does not change your rate/i);
    expect(STANDING_BINDS_NOTHING).toMatch(/campaign/i);
  });
});

/* ══ Deviation 3 — the referral pays nothing ════════════════════════════════ */

describe('the referral record cannot pay anybody', () => {
  it('has the exact column set, and none of it is money', async () => {
    const columns = await columnsOf('affiliate_referrals');
    expect(columns).toEqual([
      'id',
      'note',
      'recorded_at',
      'referred_contact',
      'referred_name',
      'referrer_prospect_id',
      'relationship',
      'reviewed_at',
      'reviewed_by',
      'state',
      'why',
    ]);
    for (const forbidden of [
      'amount',
      'cents',
      'percent',
      'percentage',
      'commission',
      'rate',
      'currency',
      'payout',
    ]) {
      expect(columns.some((c) => c.includes(forbidden))).toBe(false);
    }
  });

  it('has no state meaning the referred person joined', () => {
    // Whether somebody was eventually recruited is §8's record. Reporting it
    // back would tell a Creator about another person's admission decision — and
    // would give the referral an outcome, which is the shape a commission needs.
    expect([...CREATOR_REFERRAL_STATES].sort()).toEqual(['closed', 'recorded', 'reviewed']);
    for (const state of CREATOR_REFERRAL_STATES) {
      expect(['accepted', 'joined', 'converted', 'paid']).not.toContain(state);
    }
  });

  it('pins the refusal beside the control', () => {
    expect(REFERRAL_PAYS_NOTHING).toMatch(/no referral payment/i);
  });
});

/* ══ Deviation 4 — resources hold no campaign material ══════════════════════ */

describe('the resource record cannot become the Campaign kit', () => {
  it('has a key, a subject, and a timestamp — and nothing that holds material', async () => {
    const columns = await columnsOf('creator_resource_interest');
    expect(columns).toEqual(['id', 'prospect_id', 'recorded_at', 'resource_id']);
    // §14.1: "All material lives in one Campaign kit." The moment a column here
    // could hold a file, this and the §31.5 kit are the same thing.
    for (const forbidden of ['asset', 'url', 'file', 'campaign', 'storage_key', 'body', 'content']) {
      expect(columns.some((c) => c.includes(forbidden))).toBe(false);
    }
  });

  it('pins the sentence that keeps §14.1 true', () => {
    expect(RESOURCES_ARE_NOT_THE_CAMPAIGN_KIT).toMatch(/campaign/i);
    expect(RESOURCES_ARE_NOT_THE_CAMPAIGN_KIT).toMatch(/kit/i);
  });
});

/* ══ Nothing chases anybody, and nothing holds a bank account ═══════════════ */

const NEW_TABLES = [
  'affiliate_voice_tones',
  'affiliate_channel_metrics',
  'affiliate_standing_snapshots',
  'affiliate_referrals',
  'creator_resource_interest',
  'affiliate_profile_corrections',
];

describe('the deliberate absences across every new table', () => {
  it('has no schedule-shaped column anywhere (§30)', async () => {
    for (const table of NEW_TABLES) {
      const columns = await columnsOf(table);
      for (const forbidden of [
        'remind_at',
        'notify_at',
        'recurrence',
        'repeat_interval',
        'next_send_at',
        'cadence',
        'escalate_at',
        'snooze_until',
        'template_id',
      ]) {
        expect({ table, has: columns.includes(forbidden) }).toEqual({ table, has: false });
      }
    }
  });

  it('has no job that reads any of them (§30)', () => {
    const jobFiles = walkTs(path.join(BACKEND_SRC, 'jobs'));
    expect(jobFiles.length).toBeGreaterThan(0);
    for (const file of jobFiles) {
      const source = sourceWithoutComments(file);
      for (const table of NEW_TABLES) {
        expect({ file: path.basename(file), table, found: source.includes(table) }).toEqual({
          file: path.basename(file),
          table,
          found: false,
        });
      }
    }
  });

  it('has nothing that could hold a bank account, tax id, or identity document', async () => {
    for (const table of NEW_TABLES) {
      const columns = await columnsOf(table);
      for (const forbidden of [
        'bank',
        'routing',
        'iban',
        'account_number',
        'tax_id',
        'ssn',
        'ein',
        'document',
        'passport',
      ]) {
        expect({ table, forbidden, has: columns.some((c) => c.includes(forbidden)) }).toEqual({
          table,
          forbidden,
          has: false,
        });
      }
    }
  });
});

/* ══ The §5.3 gap-closing record ════════════════════════════════════════════ */

describe('the post-claim correction record (§5.3, §33.12.4)', () => {
  it('requires a prior value, a new value, and a reason', async () => {
    const nullable = await nullabilityOf('affiliate_profile_corrections');
    // §33.12.4: the value the constraint protects is worthless if it can be
    // absent. A genuinely absent prior is JSON `null`, never SQL NULL — the two
    // are different facts, and SQL NULL would mean "no before was recorded".
    expect(nullable.prior_value).toBe('NO');
    expect(nullable.new_value).toBe('NO');
    expect(nullable.reason).toBe('NO');
    expect(nullable.corrected_by_user_id).toBe('NO');
  });

  it('did not build a second delete-account request table', async () => {
    // Session A drafted one and then found 0044's. The gap there is a ROUTE.
    expect(await tableExists('affiliate_deletion_requests')).toBe(true);
    const columns = await columnsOf('affiliate_deletion_requests');
    // 0044's shape, unchanged: the record is of the ASK. No erasure column.
    expect(columns).toContain('received_via');
    for (const forbidden of ['deleted_at', 'purge_at', 'approved']) {
      expect(columns.some((c) => c.includes(forbidden))).toBe(false);
    }
  });

  it('the correction fields are the §5.3 list, and the guarded two are separate', () => {
    // The channel subtype is deliberately not editable: it is the Admin's §5.3
    // classification, and the recorded evidence was gathered against it.
    expect(CREATOR_SETTINGS_FIELD_IDS).not.toContain('channel_type');
    expect(CREATOR_SETTINGS_FIELD_IDS).not.toContain('subtype');
    // Nor are the five §11 representations, which were made at the claim.
    for (const id of CREATOR_SETTINGS_FIELD_IDS) {
      expect(id.startsWith('confirm_')).toBe(false);
    }
    expect([...CREATOR_SETTINGS_GUARDED_IDS].sort()).toEqual(['email', 'legal_name']);
  });
});

/* ══ The refusal register ═══════════════════════════════════════════════════ */

describe('every refused element is written down with the rule that refuses it', () => {
  it('names an element, a reason, a spec reference, and the session that owns it', () => {
    expect(CREATOR_FLOW_ABSENCES.length).toBeGreaterThan(20);
    for (const absence of CREATOR_FLOW_ABSENCES) {
      expect(absence.element.trim().length).toBeGreaterThan(0);
      // Long enough to be a reason rather than a label. A one-word
      // `absentBecause` is how a register stops being an argument.
      expect(absence.absentBecause.length).toBeGreaterThan(60);
      expect(absence.specRef).toMatch(/§/);
      expect(['B', 'C', 'D', 'E', 'F']).toContain(absence.session);
    }
  });

  it('carries the four the reference draws that would cost the most', () => {
    const blob = CREATOR_FLOW_ABSENCES.map((a) => a.element).join(' | ');
    // §22.1's own sentence: the Creator never requests a withdrawal.
    expect(blob).toMatch(/Withdraw/);
    // The most dangerous string in the reference (§22.1, §29.5, §24.8).
    expect(blob).toMatch(/No clawbacks/);
    // §30's percentile pruning with a friendlier face.
    expect(blob).toMatch(/matchPct/);
    // §28.4: no bundling, and the 18+ confirmation unchecked.
    expect(blob).toMatch(/Agree and enter/);
  });

  it('records the four things the Spec requires that the prototype never drew', () => {
    const ids = CREATOR_FLOW_OMISSIONS.map((o) => o.element).join(' | ');
    expect(ids).toMatch(/link test/i);
    expect(ids).toMatch(/obligations/i);
    expect(ids).toMatch(/self-pre-order/i);
    expect(ids).toMatch(/conflict/i);
    for (const omission of CREATOR_FLOW_OMISSIONS) {
      expect(omission.requiredBecause.length).toBeGreaterThan(60);
      expect(omission.specRef).toMatch(/§/);
    }
  });

  it('uses no term §3.1 or §3.2 bans, in copy or in an identifier', () => {
    // §33.11.3 scans the built bundle, where a prop name survives minification.
    // This is the same check, earlier and narrower, so a failure points at the
    // file rather than at a build artifact. `upfront` is the third reference in
    // a row to ship it; `reservation` and `goal` are the other two repeats.
    const files = walkTs(path.join(path.resolve(BACKEND_SRC, '../../shared/src'), 'creator-flow'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      // Read WITHOUT stripping comments for the identifier check: a prop name
      // is what ships. But the banned-word scan has to allow a comment that
      // explains the ban, so it runs on code only.
      const code = sourceWithoutComments(file);
      for (const banned of [
        /\bupfront\b/i,
        /\bpledge\b/i,
        /\bescrow\b/i,
        /\ball-or-nothing\b/i,
      ]) {
        expect({ file: path.basename(file), banned: banned.source, hit: banned.test(code) }).toEqual(
          { file: path.basename(file), banned: banned.source, hit: false },
        );
      }
      // `goal` binds identifiers too (§3.2's last paragraph).
      expect(/\bgoal[A-Z_]?/.test(source.replace(/\/\*[\s\S]*?\*\//g, ''))).toBe(false);
    }
  });
});

/* ══ The page register is empty until a session renders one ═════════════════ */

describe('the page register holds only what exists', () => {
  it('holds exactly the screens a session has rendered', () => {
    // DELIBERATELY INVERTED (Creator Flow v2 Session B, 2026-08-19). Session A
    // asserted this was EMPTY, because it built no screen; Session B built four
    // and appended them, so the empty assertion would now be asserting that
    // Session B did not happen.
    //
    // The rule it was protecting is unchanged and is what is checked here:
    // `events.ts`' rule applied to a surface — a page appears when something
    // renders it, never before. A register pre-populated with the fourteen
    // screens the reference draws would make every "is this reachable" check
    // answer yes about surfaces that do not exist, and the help drawer's
    // "everything before it" would be an aspiration rather than a fact.
    expect(CREATOR_FLOW_PAGES.map((page) => page.id)).toEqual([
      'welcome',
      'password',
      'profile',
      'channel',
    ]);

    // Every one is on the invitation token and in stage 1. The claim is the
    // boundary, and no page may sit one stage earlier than the mechanism that
    // authorises it.
    for (const page of CREATOR_FLOW_PAGES) {
      expect(page.param).toBe('token');
      expect(page.stage).toBe(1);
      expect(page.path.startsWith('/creator-invitation/:token')).toBe(true);
      expect(page.help.length).toBeGreaterThan(20);
    }

    // Sessions C–F have not run: none of the screens they own is registered.
    for (const id of ['voice', 'presence', 'verify', 'agree', 'allset', 'home']) {
      expect(CREATOR_FLOW_PAGES.some((page) => page.id === id)).toBe(false);
    }
  });

  it('refuses to build a path for a page nobody registered', () => {
    expect(() => creatorFlowPath('splash', 'tok_123')).toThrow(/unknown creator flow page/);
  });
});

/* ══ The voice register ═════════════════════════════════════════════════════ */

describe('the recorded tone', () => {
  it('names every problem with a selection rather than answering true or false', () => {
    const violations = creatorVoiceViolations({
      tones: ['straight_talking', 'not_a_tone', 'straight_talking'],
      customTones: ['a tone far longer than the cap allows for a chip'],
      flexible: false,
    });
    const kinds = violations.map((v) => v.kind);
    expect(kinds).toContain('unknown_tone');
    expect(kinds).toContain('duplicate_tone');
    expect(kinds).toContain('custom_too_long');
  });

  it('accepts a valid selection', () => {
    expect(
      creatorVoiceViolations({ tones: ['warm', 'funny'], customTones: [], flexible: true }),
    ).toEqual([]);
    expect(CREATOR_VOICE_TONE_IDS).toHaveLength(6);
  });

  it('pins the sentence that makes the question honest (§30, §12)', () => {
    expect(VOICE_IS_NEVER_USED_TO_REWRITE).toMatch(/rewrites/i);
  });

  it('is an answer if the Creator only said they are flexible', async () => {
    // `flexible` alone IS an answer, and the CHECK has to admit it or the
    // switch would be a control nobody can use on its own.
    const def = await constraintDef('affiliate_voice_says_something');
    expect(def).toMatch(/flexible/);
  });
});
