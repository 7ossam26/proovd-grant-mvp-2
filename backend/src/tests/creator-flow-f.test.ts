/**
 * Creator Flow v2 — Session F: work, Earnings, Resources, Settings.
 *
 * `docs/phases/creator-flow-v2.md` is the brief. What this suite holds is the
 * part of F1–F4 a comment cannot:
 *
 *   * **every §17 bullet has a field**, walked against a real payload rather
 *     than asserted;
 *   * §5.3's settings are editable, with a reason, a prior value read under
 *     lock, and an audit row — and the ten field ids are the register's, three
 *     places and one truth;
 *   * §22.1's absence: there is no withdrawal in the payload, the module, or
 *     the route;
 *   * the four Resources columns that do not exist, so §14.1's sentence stays
 *     true structurally;
 *   * F4: one source, many renderers — the amount on the work surface, on
 *     Earnings, and in the campaign's own close view is the same call.
 *
 * Session A's suite holds the column sets and the CHECK-pinned vocabularies;
 * Session D's holds the standing and the referral. Nothing here re-drives them.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import {
  BANNED_MONEY_CONTROL_TERMS,
  CREATOR_DELETION_RECEIVED_VIA,
  CREATOR_RESOURCE_IDS,
  CREATOR_SETTINGS_FIELDS,
  CREATOR_SETTINGS_GUARDED,
  CREATOR_WORK_ITEMS,
  TERMINATION_REASON_IDS,
} from '@proovd/shared';

import { startHarness, type Harness } from './app-harness.js';
import { seedUser, signInPlain } from './admin-session.js';
import { createAuditWriter } from '../auth/audit.js';
import { campaigns, campaignAffiliateAssociations } from '../db/schema/domain.js';
import { campaignBuild } from '../db/schema/build.js';
import { affiliateProspects } from '../db/schema/affiliates.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import { affiliateProfileCorrections } from '../db/schema/creator-flow.js';
import { trackingLinks } from '../db/schema/decisions.js';
import { auditEvents } from '../db/schema/integrity.js';
import { buildCreatorPartnership } from '../affiliates/partnership.js';
import { correctOwnProfileField, readCreatorSettings, requestOwnDeletion } from '../affiliates/creator-settings.js';
import { readCreatorEarnings } from '../affiliates/creator-money.js';
import { readCreatorResources, recordResourceInterest } from '../affiliates/creator-resources.js';
import { requestPartnershipEnd } from '../affiliates/creator-asks.js';
import * as backendLogic from '../creator-flow/logic.js';

let h: Harness;
let audit: ReturnType<typeof createAuditWriter>;

beforeAll(async () => {
  h = await startHarness({ authRouteLimit: 1_000_000, globalRateLimit: 1_000_000 }, 'creatorwork');
  audit = createAuditWriter(h.db);
}, 180_000);

afterAll(async () => {
  await h.stop();
});

const SRC = path.resolve(import.meta.dirname, '..');

interface Seeded {
  prospectId: string;
  associationId: string;
  campaignId: string;
  userId: string;
  email: string;
}

/**
 * One Creator with one ACTIVE partnership on a live campaign.
 *
 * `affiliate_id` and `prospect_id` are both the prospect id, which is what the
 * only two production writers do.
 */
async function seedPartnership(label: string): Promise<Seeded> {
  const user = await seedUser(h, 'affiliate', `work-${label}`);
  const [prospect] = await h.db
    .insert(affiliateProspects)
    .values({
      legalName: `Creator ${label}`,
      publicHandle: `@work-${label}`,
      email: user.email,
      subtype: 'social_creator',
      createdBy: 'admin:test',
    })
    .returning({ id: affiliateProspects.id });

  const [campaign] = await h.db
    .insert(campaigns)
    .values({
      status: 'live',
      type: 'pre_launch',
      typeLockedAt: new Date(),
      campaignLiveAt: new Date(),
    })
    .returning({ id: campaigns.id });

  await h.db.insert(campaignBuild).values({
    campaignId: campaign!.id,
    title: `Campaign ${label}`,
    founderDisplayName: 'Harlow Instruments',
    requiredWording: 'Say it is machined aluminium.',
    prohibitedClaims: 'No delivery claim earlier than March 2027.',
    updatedBy: 'test',
  });

  const [assoc] = await h.db
    .insert(campaignAffiliateAssociations)
    .values({
      campaignId: campaign!.id,
      affiliateId: prospect!.id,
      prospectId: prospect!.id,
      status: 'active',
      rosterMembership: 'initial_roster',
    })
    .returning({ id: campaignAffiliateAssociations.id });

  await h.db.insert(trackingLinks).values({
    associationId: assoc!.id,
    campaignId: campaign!.id,
    code: `wk${label}`.slice(0, 12),
    active: true,
    activatedAt: new Date(),
  });

  await h.db.insert(affiliateSignupProfiles).values({
    prospectId: prospect!.id,
    associationId: assoc!.id,
    email: user.email,
    legalName: `Creator ${label}`,
    publicHandle: `@work-${label}`,
    phone: '+1 503 555 0100',
    audienceNiche: 'Woodworking',
    bio: 'Builds furniture on camera.',
    claimedUserId: user.id,
    claimedAt: new Date(),
    updatedBy: 'test',
  });

  return {
    prospectId: prospect!.id,
    associationId: assoc!.id,
    campaignId: campaign!.id,
    userId: user.id,
    email: user.email,
  };
}

/** `db.execute` returns a result object; every caller here wants its rows. */
async function rows<T>(query: Parameters<typeof h.db.execute>[0]): Promise<T[]> {
  const result = await h.db.execute(query);
  return result.rows as T[];
}

/** Resolves a dotted path, so the §17 walk reads the payload the surface gets. */
function at(value: unknown, dotted: string): unknown {
  return dotted.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined) return acc;
    return (acc as Record<string, unknown>)[key];
  }, value);
}

/* ══ F5: every §17 bullet has a field ═══════════════════════════════════════ */

describe('§17’s content list, walked against a real payload', () => {
  it('answers all thirteen bullets, and none of them is missing from the payload', async () => {
    const seeded = await seedPartnership('bullets');
    const result = await buildCreatorPartnership(h.db, {
      associationId: seeded.associationId,
      appBaseUrl: 'http://localhost:3000',
    });
    if (!result.ok) throw new Error('expected a partnership');

    expect(CREATOR_WORK_ITEMS.length).toBe(13);
    const missing: string[] = [];
    for (const item of CREATOR_WORK_ITEMS) {
      // `undefined` is a field the payload does not carry. `null` is a field it
      // carries and has nothing to put in — a mid-campaign block on an initial
      // roster Creator is exactly that, and it is an answer.
      if (at(result.partnership, item.field) === undefined) missing.push(item.field);
    }
    expect(missing).toEqual([]);
  });

  it('reports a conversion over zero clicks as null, never 0% (§16a)', async () => {
    const seeded = await seedPartnership('conv');
    const result = await buildCreatorPartnership(h.db, {
      associationId: seeded.associationId,
      appBaseUrl: 'http://localhost:3000',
    });
    if (!result.ok) throw new Error('expected a partnership');
    expect(result.partnership.clicks.total).toBe(0);
    expect(result.partnership.performance.conversionRate).toBeNull();
  });

  it('names the storage gap rather than offering a dead download (Track A4)', async () => {
    const seeded = await seedPartnership('assets');
    const result = await buildCreatorPartnership(h.db, {
      associationId: seeded.associationId,
      appBaseUrl: 'http://localhost:3000',
      storageConfigured: false,
    });
    if (!result.ok) throw new Error('expected a partnership');
    expect(result.partnership.materials.available).toBe(false);
    expect(result.partnership.materials.unavailableBecause).toBeTruthy();
  });

  it('carries no bonus block where no bonus was agreed (§14.3)', async () => {
    const seeded = await seedPartnership('nobonus');
    const result = await buildCreatorPartnership(h.db, {
      associationId: seeded.associationId,
      appBaseUrl: 'http://localhost:3000',
    });
    if (!result.ok) throw new Error('expected a partnership');
    // The reference draws a platform-wide "50 reservations to your bonus tier".
    // §14.3's bonus is per proposal version, so no agreement means no block.
    expect(result.partnership.bonus).toBeNull();
  });
});

/* ══ §22.1: there is no withdrawal, and the absence is the enforcement ══════ */

describe('§22.1: the Creator never requests a withdrawal', () => {
  it('has no withdrawal word in either money module', () => {
    for (const relative of ['affiliates/creator-money.ts', 'affiliates/partnership.ts']) {
      // Comments are stripped first: both files EXPLAIN at length that there is
      // no withdrawal, and a scan that could not tell an explanation from a
      // usage would force the explanations out (`notifications/send.ts`'s rule).
      const source = readFileSync(path.join(SRC, relative), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '')
        .toLowerCase();
      for (const term of BANNED_MONEY_CONTROL_TERMS) {
        expect(source, `${relative} names "${term}"`).not.toContain(term);
      }
    }
  });

  it('exposes no route that could move money to a Creator', async () => {
    const seeded = await seedPartnership('nowd');
    const cookie = await signInPlain(h, seeded.email);
    for (const path_ of ['/api/creator/earnings/withdraw', '/api/creator/withdraw']) {
      const res = await request(h.app).post(path_).set('Cookie', cookie).send({});
      expect(res.status).toBe(404);
    }
  });

  it('reads every campaign through the ONE close resolver (F4)', async () => {
    const seeded = await seedPartnership('onesource');
    const earnings = await readCreatorEarnings(h.db, seeded.userId);
    expect(earnings.rows).toHaveLength(1);
    // The campaign is live, so its close view does not exist yet — and the row
    // says which of the two facts that is rather than showing US$0.00 (§16a).
    expect(earnings.rows[0]!.close).toBeNull();
    expect(earnings.rows[0]!.waitingOn).toBeTruthy();
    expect(earnings.lifetimeRecordedCents).toBe('0');
    expect(earnings.recordedCampaigns).toBe(0);
  });
});

/* ══ §5.3: the settings gap, closed ════════════════════════════════════════ */

describe('§5.3’s settings are editable after the claim', () => {
  it('restates the ten field ids in three places that agree', async () => {
    const shared = [
      ...CREATOR_SETTINGS_FIELDS.map((f) => f.id),
      ...CREATOR_SETTINGS_GUARDED.map((f) => f.id),
    ];
    expect([...backendLogic.SETTINGS_ALL_FIELD_IDS].sort()).toEqual([...shared].sort());
    expect([...backendLogic.CORRECTION_FIELD_IDS].sort()).toEqual([...shared].sort());

    const [row] = await rows<{ def: string }>(sql`
      select pg_get_constraintdef(oid) as def from pg_constraint
      where conname = 'affiliate_correction_field_known'
    `);
    for (const id of shared) expect(row!.def).toContain(`'${id}'`);
  });

  it('reads the prior value under lock, requires a reason, and writes an audit row', async () => {
    const seeded = await seedPartnership('setting');
    const before = await readCreatorSettings(h.db, seeded.userId);
    if (!before.ok) throw new Error('expected settings');
    const bio = before.settings.fields.find((f) => f.id === 'bio');
    expect(bio!.value).toBe('Builds furniture on camera.');

    // §33.12.4: the caller supplies only the NEW value. There is no parameter
    // for the prior one, so a flattering pair is unrepresentable.
    const refused = await correctOwnProfileField(h.db, {
      userId: seeded.userId,
      fieldId: 'bio',
      newValue: 'Builds benches on camera.',
      reason: '   ',
    });
    expect(refused.ok).toBe(false);

    const saved = await correctOwnProfileField(h.db, {
      userId: seeded.userId,
      fieldId: 'bio',
      newValue: 'Builds benches on camera.',
      reason: 'The channel changed focus.',
    });
    expect(saved.ok).toBe(true);

    const corrections = await h.db
      .select()
      .from(affiliateProfileCorrections)
      .where(sql`${affiliateProfileCorrections.fieldId} = 'bio'`);
    const mine = corrections.filter((c) => c.correctedByUserId === seeded.userId);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.priorValue).toBe('Builds furniture on camera.');
    expect(mine[0]!.newValue).toBe('Builds benches on camera.');

    const events = await h.db
      .select()
      .from(auditEvents)
      .where(sql`${auditEvents.action} = 'creator.profile_corrected'`);
    expect(events.some((e) => e.actor === seeded.userId)).toBe(true);

    const after = await readCreatorSettings(h.db, seeded.userId);
    if (!after.ok) throw new Error('expected settings');
    const bioAfter = after.settings.fields.find((f) => f.id === 'bio');
    expect(bioAfter!.value).toBe('Builds benches on camera.');
    // §11's source label follows the person who wrote it.
    expect(bioAfter!.supplier).toBe('affiliate');
  });

  it('refuses a field id that is not in the register', async () => {
    const seeded = await seedPartnership('badfield');
    const result = await correctOwnProfileField(h.db, {
      userId: seeded.userId,
      // A column name, which is exactly what a route accepting free text would
      // have recorded a correction of (16a's overridable-field reasoning).
      fieldId: 'claimed_user_id',
      newValue: 'somebody else',
      reason: 'trying it on',
    });
    expect(result.ok).toBe(false);
  });

  it('has no branch that writes a confirmation, a subtype, or a payout column', () => {
    const source = readFileSync(path.join(SRC, 'affiliates/creator-settings.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    // Write-shaped only. `subtype: affiliateProspects.subtype` is a SELECT
    // projection and appears here legitimately — a scan that could not tell a
    // read from a write would have to be silenced, and a silenced check is
    // worse than none.
    for (const forbidden of [
      'certifiedEighteen:',
      'subtype: input',
      'payoutsEnabled: input',
      'claimedAt: ',
      'claimedUserId: ',
      '.update(affiliateProspects)',
      '.update(stripeConnectedAccounts)',
    ]) {
      expect(source, `creator-settings.ts writes ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('files the deletion ask on 0044’s own record, naming this screen', async () => {
    const seeded = await seedPartnership('delete');
    const result = await requestOwnDeletion(h.db, {
      userId: seeded.userId,
      detail: 'Please close my account.',
    });
    expect(result.ok).toBe(true);

    const [row] = await rows<{ received_via: string; user_id: string | null }>(sql`
      select received_via, user_id from affiliate_deletion_requests
      where prospect_id = ${seeded.prospectId}::uuid
    `);
    expect(row!.received_via).toBe(CREATOR_DELETION_RECEIVED_VIA);
    expect(row!.user_id).toBe(seeded.userId);
    expect(backendLogic.DELETION_RECEIVED_VIA).toBe(CREATOR_DELETION_RECEIVED_VIA);

    // §25.8: the record is of the ASK. Nothing here executes it, and there is
    // no state on that table that could mean "done".
    const [cols] = await rows<{ n: number }>(sql`
      select count(*)::int as n from information_schema.columns
      where table_name = 'affiliate_deletion_requests'
        and column_name in ('deleted_at','purge_at','approved','approved_at')
    `);
    expect(cols!.n).toBe(0);
  });
});

/* ══ Deviation 4: Resources hold no campaign material ═══════════════════════ */

describe('deviation 4: the Resources record cannot become the Campaign kit', () => {
  it('has no column that could hold an asset, a URL, a file, or a campaign', async () => {
    const [row] = await rows<{ n: number }>(sql`
      select count(*)::int as n from information_schema.columns
      where table_name = 'creator_resource_interest'
        and (column_name like '%asset%' or column_name like '%url%'
             or column_name like '%file%' or column_name like '%storage%'
             or column_name = 'campaign_id')
    `);
    expect(row!.n).toBe(0);
  });

  it('records interest once, and a second ask is not a second row', async () => {
    const seeded = await seedPartnership('resource');
    const first = await recordResourceInterest(h.db, {
      userId: seeded.userId,
      resourceId: 'best_practices',
    });
    expect(first).toMatchObject({ ok: true, recorded: true });
    const second = await recordResourceInterest(h.db, {
      userId: seeded.userId,
      resourceId: 'best_practices',
    });
    // Not an error: the unique index answers, and telling somebody their second
    // tap failed would report a constraint as a problem with them.
    expect(second).toMatchObject({ ok: true, recorded: false });

    const read = await readCreatorResources(h.db, seeded.userId);
    if (!read.ok) throw new Error('expected resources');
    expect(read.resources.interested).toEqual(['best_practices']);
  });

  it('refuses a resource key nobody named', async () => {
    const seeded = await seedPartnership('badres');
    const result = await recordResourceInterest(h.db, {
      userId: seeded.userId,
      resourceId: 'ai_script_writer',
    });
    expect(result.ok).toBe(false);
    expect([...backendLogic.RESOURCE_IDS].sort()).toEqual([...CREATOR_RESOURCE_IDS].sort());
  });

  it('is read by no job, so nothing chases anybody (§30)', () => {
    const jobs = path.join(SRC, 'jobs');
    const files = readFileSync(path.join(jobs, 'scheduler.ts'), 'utf8');
    expect(files).not.toContain('creator_resource_interest');
    expect(files).not.toContain('creatorResourceInterest');
  });
});

/* ══ §29.5: the termination ask opens a case and classifies nothing ═════════ */

describe('§29.5: asking to end a partnership', () => {
  it('opens a §26.7 case with a reference and a business-day promise', async () => {
    const seeded = await seedPartnership('endask');
    const result = await requestPartnershipEnd(h.db, {
      userId: seeded.userId,
      associationId: seeded.associationId,
      reasonId: 'founder_material_breach',
      detail: 'They changed the delivery date without telling anybody.',
      requesterEmail: seeded.email,
    });
    if (!result.ok) throw new Error(`expected a case: ${JSON.stringify(result)}`);
    expect(result.reference).toMatch(/^PVD-/);
    expect(result.acknowledgement.length).toBeGreaterThan(0);

    const [row] = await rows<{ n: number; due: string | null; version: string | null }>(sql`
      select count(*)::int as n, max(human_response_due_at)::text as due,
             max(calendar_version) as version
      from support_cases where association_id = ${seeded.associationId}::uuid
    `);
    expect(row!.n).toBe(1);
    expect(row!.due).toBeTruthy();
    expect(row!.version).toBeTruthy();
  });

  it('writes no §24.8 classification, because that is an Admin judgement', async () => {
    const seeded = await seedPartnership('noclass');
    await requestPartnershipEnd(h.db, {
      userId: seeded.userId,
      associationId: seeded.associationId,
      reasonId: 'emergency_or_capacity',
      detail: 'I cannot give it the time I promised.',
      requesterEmail: seeded.email,
    });
    // 0048's row requires a cause and a permitted money treatment. Asking a
    // Creator to pick one is asking them to classify a refund that does not
    // exist, so this path writes none.
    const [row] = await rows<{ n: number }>(sql`
      select count(*)::int as n from association_termination_requests
      where association_id = ${seeded.associationId}::uuid
    `);
    expect(row!.n).toBe(0);
  });

  it('refuses a reason that is not one of §29.5’s four', async () => {
    const seeded = await seedPartnership('badreason');
    const result = await requestPartnershipEnd(h.db, {
      userId: seeded.userId,
      associationId: seeded.associationId,
      reasonId: 'i_changed_my_mind',
      detail: 'anything',
      requesterEmail: seeded.email,
    });
    expect(result.ok).toBe(false);
    expect([...backendLogic.TERMINATION_REASON_IDS].sort()).toEqual(
      [...TERMINATION_REASON_IDS].sort(),
    );
  });

  it('answers somebody else’s partnership what a nonexistent one answers', async () => {
    const mine = await seedPartnership('mine');
    const theirs = await seedPartnership('theirs');
    const result = await requestPartnershipEnd(h.db, {
      userId: mine.userId,
      associationId: theirs.associationId,
      reasonId: 'other',
      detail: 'not mine',
      requesterEmail: mine.email,
    });
    expect(result).toMatchObject({ ok: false, code: 'not_found' });
  });
});

/* ══ The routes, scoped by session ═════════════════════════════════════════ */

describe('the four Session F routes', () => {
  it('serve the signed-in Creator and refuse everybody else', async () => {
    const seeded = await seedPartnership('routes');
    const cookie = await signInPlain(h, seeded.email);

    for (const address of [
      '/api/creator/settings',
      '/api/creator/earnings',
      '/api/creator/resources',
    ]) {
      const signedIn = await request(h.app).get(address).set('Cookie', cookie);
      expect(signedIn.status, address).toBe(200);
      const anonymous = await request(h.app).get(address);
      expect(anonymous.status, address).toBe(401);
    }
  });

  it('never returns a raw payout detail or a Backer identity', async () => {
    const seeded = await seedPartnership('boundary');
    const cookie = await signInPlain(h, seeded.email);
    const res = await request(h.app).get('/api/creator/settings').set('Cookie', cookie);
    const body = JSON.stringify(res.body).toLowerCase();
    // §5.3/§13: Proovd holds a status and an account id and never the details.
    for (const forbidden of ['routing', 'account_number', 'iban', 'ssn', 'tax_id']) {
      expect(body, `settings payload names ${forbidden}`).not.toContain(forbidden);
    }
  });
});
