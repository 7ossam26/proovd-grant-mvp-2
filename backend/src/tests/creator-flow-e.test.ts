/**
 * Creator Flow v2 — Session E: Pitches, the Active list, and the pitch.
 *
 * `docs/phases/creator-flow-v2.md` is the brief. What this suite holds is the
 * part of E1–E3 a comment cannot:
 *
 *   * **no decision service was added, and none was touched** — the module has
 *     no write of any kind, `decisions.ts`'s five exports are what they were,
 *     and §33.2.6–§33.2.13 drive them directly and pass unchanged;
 *   * the two lists, scoped by session inside the query;
 *   * **the list does not record §14.5's `reviewing`** and opening a pitch
 *     does, which is the difference between observing a fact and inventing one;
 *   * one derivation for the count, so Home's hero and the Pitches tab agree;
 *   * every payload-sourced §14.1 recap section resolves against a real read;
 *   * every sort names a column that exists.
 *
 * Session A's suite holds the column sets and the CHECK-pinned vocabularies;
 * Sessions D and F hold the standing, the referral, and the money. Nothing here
 * re-drives them.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import {
  DEFAULT_PITCH_SORT,
  PITCH_BANNED_TERMS,
  PITCH_RECAP_SECTIONS,
  PITCH_REVEAL_STEPS,
  PITCH_SORTS,
  PITCH_SORT_IDS,
  PITCH_TABS,
  namingViolations,
} from '@proovd/shared';

import { startHarness, type Harness } from './app-harness.js';
import { seedUser, signInPlain } from './admin-session.js';
import { campaigns, campaignAffiliateAssociations } from '../db/schema/domain.js';
import { campaignBuild } from '../db/schema/build.js';
import { campaignVetting } from '../db/schema/vetting.js';
import { campaignDrafts, founderProspects } from '../db/schema/invitations.js';
import { listingFeePayments } from '../db/schema/listing.js';
import { listingFeeCalculations } from '../db/schema/workspace.js';
import { affiliateProspects } from '../db/schema/affiliates.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import {
  readCreatorPitches,
  readPitch,
  readPitchContent,
  pitchKindFor,
  PITCH_DECISION_OPEN_STATES,
} from '../affiliates/creator-pitches.js';
import { readCreatorHome } from '../affiliates/home.js';
import * as decisions from '../affiliates/decisions.js';
import * as backendLogic from '../creator-flow/logic.js';

let h: Harness;

beforeAll(async () => {
  h = await startHarness({ authRouteLimit: 1_000_000, globalRateLimit: 1_000_000 }, 'creatorpitch');
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
 * One Creator with one campaign, in whatever association state the case wants.
 *
 * `affiliate_id` and `prospect_id` are both the PROSPECT id, which is what the
 * two production writers do — anything keying an account lookup off
 * `affiliate_id` routes at a UUID nobody owns.
 */
async function seedPitch(
  label: string,
  options: {
    status?: string;
    campaignType?: 'pre_build' | 'pre_launch';
    /** Hours from `paid_at`. The 0016 CHECK pins the deadline to that sum, so a
     *  case that wants a different deadline moves the window rather than the
     *  instant — which is also the only thing production can do. `null` seeds no
     *  payment at all, and therefore no recorded deadline. */
    responseHours?: number | null;
    user?: { id: string; email: string };
    highEffort?: boolean;
  } = {},
): Promise<Seeded> {
  const user = options.user ?? (await seedUser(h, 'affiliate', `pitch-${label}`));
  const [prospect] = await h.db
    .insert(affiliateProspects)
    .values({
      legalName: `Creator ${label}`,
      publicHandle: `@pitch-${label}`,
      email: `${label}@example.com`,
      subtype: 'social_creator',
      createdBy: 'admin:test',
    })
    .returning({ id: affiliateProspects.id });

  const [campaign] = await h.db
    .insert(campaigns)
    .values({
      status: 'affiliate_response_and_build',
      type: options.campaignType ?? 'pre_launch',
      typeLockedAt: new Date(),
      highEffort: options.highEffort ?? false,
      listingPaidAt: new Date(),
    })
    .returning({ id: campaigns.id });

  const [founder] = await h.db
    .insert(founderProspects)
    .values({
      legalName: `Founder ${label}`,
      email: `founder-${label}@example.com`,
      productName: `Product ${label}`,
      createdBy: 'admin:test',
    })
    .returning({ id: founderProspects.id });

  const [draft] = await h.db
    .insert(campaignDrafts)
    .values({ campaignId: campaign!.id, prospectId: founder!.id, createdBy: 'admin:test' })
    .returning({ id: campaignDrafts.id });

  await h.db.insert(campaignVetting).values({
    draftId: draft!.id,
    campaignId: campaign!.id,
    problemText: `The problem for ${label}.`,
    solutionText: `The solution for ${label}.`,
    updatedBy: 'test',
  });

  await h.db.insert(campaignBuild).values({
    campaignId: campaign!.id,
    title: `Campaign ${label}`,
    founderDisplayName: 'Harlow Instruments',
    heroSubheadline: 'A promise line.',
    brandVoice: 'Plain sentences.',
    requiredWording: 'Say it is machined aluminium.',
    prohibitedClaims: 'No delivery claim earlier than March 2027.',
    deliveryWindow: 'March 2027',
    internalTargetCents: 400_000n,
    orderThreshold: 120,
    updatedBy: 'test',
  });

  const responseHours = options.responseHours === undefined ? 72 : options.responseHours;
  if (responseHours !== null) {
    const paidAt = new Date();
    // The payment row is what carries §14.6's stored response deadline, and it
    // cannot exist without the §24.6 calculation it was charged from.
    const [calculation] = await h.db
      .insert(listingFeeCalculations)
      .values({
        campaignId: campaign!.id,
        baseCents: 3500n,
        itemDiscountCents: 200n,
        maxDiscountCents: 1000n,
        minSubtotalCents: 2500n,
        completedItems: 0,
        discountCents: 0n,
        subtotalCents: 3500n,
        discountLines: [],
        itemsSnapshot: [],
        actor: 'test',
        trigger: 'checkout',
      })
      .returning({ id: listingFeeCalculations.id });

    await h.db.insert(listingFeePayments).values({
      calculationId: calculation!.id,
      campaignId: campaign!.id,
      checkoutSessionId: `cs_${label}`.slice(0, 40),
      mode: 'test',
      currency: 'usd',
      baseCents: 3500n,
      discountCents: 0n,
      discountLines: [],
      promotionCents: 0n,
      subtotalCents: 3500n,
      taxCents: 0n,
      totalCents: 3500n,
      descriptor: 'PROOVD LISTING',
      newsletterOptIn: false,
      paidAt,
      responseWindowHours: responseHours,
      responseDeadlineAt: new Date(paidAt.getTime() + responseHours * 3600_000),
      freeCancellationWindowHours: 48,
      freeCancellationDeadlineAt: new Date(paidAt.getTime() + 48 * 3600_000),
    });
  }

  const [assoc] = await h.db
    .insert(campaignAffiliateAssociations)
    .values({
      campaignId: campaign!.id,
      affiliateId: prospect!.id,
      prospectId: prospect!.id,
      status: (options.status ?? 'formal_decision_open') as 'formal_decision_open',
      rosterMembership: 'initial_roster',
      whyRecruited: 'Two Admin-written sentences about the fit.',
    })
    .returning({ id: campaignAffiliateAssociations.id });

  await h.db.insert(affiliateSignupProfiles).values({
    prospectId: prospect!.id,
    associationId: assoc!.id,
    email: user.email,
    legalName: `Creator ${label}`,
    publicHandle: `@pitch-${label}`,
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

async function rows<T>(query: Parameters<typeof h.db.execute>[0]): Promise<T[]> {
  const result = await h.db.execute(query);
  return result.rows as T[];
}

function at(value: unknown, dotted: string): unknown {
  return dotted.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined) return acc;
    return (acc as Record<string, unknown>)[key];
  }, value);
}

/** Comments explain at length what these modules refuse to do (§27's rule). */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/* ══ E3: no decision service was added, and none was touched ════════════════ */

describe('E3 — this session adds no decision service', () => {
  it('has no write of any kind in the pitches module', () => {
    const source = withoutComments(
      readFileSync(path.join(SRC, 'affiliates/creator-pitches.ts'), 'utf8'),
    );
    for (const verb of ['.insert(', '.update(', '.delete(']) {
      expect(source.includes(verb), `${verb} in creator-pitches.ts`).toBe(false);
    }
  });

  it('exports no accept, decline, propose, or respond of its own', async () => {
    const module = await import('../affiliates/creator-pitches.js');
    for (const name of Object.keys(module)) {
      expect(name.toLowerCase(), name).not.toMatch(/accept|decline|propose|respond|submit/);
    }
  });

  it('leaves `decisions.ts` exporting the five services §33.2 drives', () => {
    for (const name of [
      'readFormalOpportunity',
      'acceptStandardTerms',
      'declineOpportunity',
      'submitProposal',
      'respondToProposal',
    ]) {
      expect(typeof (decisions as Record<string, unknown>)[name], name).toBe('function');
    }
  });
});

/* ══ E1: the two lists ══════════════════════════════════════════════════════ */

describe('E1 — the Active and Pitches lists', () => {
  it('puts an open invitation in Pitches and an accepted campaign in Active', async () => {
    const open = await seedPitch('open');
    const live = await seedPitch('live', { status: 'active', user: { id: open.userId, email: open.email } });

    const view = await readCreatorPitches(h.db, open.userId);
    expect(view.pitches.map((p) => p.associationId)).toEqual([open.associationId]);
    expect(view.active.map((a) => a.associationId)).toEqual([live.associationId]);
    expect(view.pitches[0]?.kind).toBe('opportunity');
  });

  it('scopes both lists to the session inside the query', async () => {
    const mine = await seedPitch('mine');
    const theirs = await seedPitch('theirs');

    const view = await readCreatorPitches(h.db, mine.userId);
    const ids = [...view.pitches, ...view.active].map((row) => row.associationId);
    expect(ids).toContain(mine.associationId);
    expect(ids).not.toContain(theirs.associationId);
  });

  it('renders the real §14.3 cell rather than a predicted amount', async () => {
    const seeded = await seedPitch('cell', { highEffort: true });
    const view = await readCreatorPitches(h.db, seeded.userId);
    const row = view.pitches[0]!;

    expect(row.basePercent).toBeGreaterThan(0);
    expect(row.bidAllowed).toBe(true);
    expect(row.fixedPaymentAvailable).toBe(true);
    expect(row.ceilingPercent).toBe(50);
    // No predicted, estimated, or range field anywhere on the row (§22.2).
    for (const key of Object.keys(row)) {
      expect(key.toLowerCase(), key).not.toMatch(/predict|estimate|range|forecast/);
    }
  });

  it('an Idea campaign offers no fixed Creator payment (§14.3)', async () => {
    const seeded = await seedPitch('idea', { campaignType: 'pre_build' });
    const view = await readCreatorPitches(h.db, seeded.userId);
    expect(view.pitches[0]?.fixedPaymentAvailable).toBe(false);
  });

  it('sorts by the stored deadline by default, and puts an unrecorded one last', async () => {
    const user = await seedUser(h, 'affiliate', 'pitch-sort');
    const soon = await seedPitch('soon', { user, responseHours: 1 });
    const later = await seedPitch('later', { user, responseHours: 90 });
    const none = await seedPitch('nodl', { user, responseHours: null });

    const view = await readCreatorPitches(h.db, user.id, { sort: DEFAULT_PITCH_SORT });
    expect(view.pitches.map((p) => p.associationId)).toEqual([
      soon.associationId,
      later.associationId,
      none.associationId,
    ]);
  });

  it('every sort names a column that exists', async () => {
    for (const sort of PITCH_SORTS) {
      const [table, column] = sort.column.split('.');
      const found = await rows<{ column_name: string }>(sql`
        select column_name from information_schema.columns
        where table_name = ${table} and column_name = ${column}
      `);
      expect(found.length, sort.column).toBe(1);
    }
  });

  it('the route validates the sort rather than trusting it', async () => {
    const seeded = await seedPitch('route');
    const cookie = await signInPlain(h, seeded.email);
    const answered = await request(h.app)
      .get('/api/creator/pitches?sort=DROP%20TABLE')
      .set('Cookie', cookie)
      .expect(200);
    expect(answered.body.sort).toBe(DEFAULT_PITCH_SORT);
  });

  it('carries no Backer identity and no §3 banned term in the payload', async () => {
    const seeded = await seedPitch('vocab', { status: 'active' });
    const view = await readCreatorPitches(h.db, seeded.userId);
    const serialized = JSON.stringify(view).toLowerCase();
    for (const term of PITCH_BANNED_TERMS) {
      expect(new RegExp(`\\b${term}\\b`).test(serialized), term).toBe(false);
    }
  });
});

/* ══ The §14.5 side effect belongs to opening a pitch, not to listing them ══ */

describe('§14.5 — `reviewing` is recorded when a pitch is opened, and not before', () => {
  it('listing pitches does not move a single association', async () => {
    const seeded = await seedPitch('noside');
    await readCreatorPitches(h.db, seeded.userId);

    const [after] = await h.db
      .select({ status: campaignAffiliateAssociations.status })
      .from(campaignAffiliateAssociations)
      .where(eq(campaignAffiliateAssociations.id, seeded.associationId));
    expect(after?.status).toBe('formal_decision_open');
  });

  it('opening one records it, through the untouched service', async () => {
    const seeded = await seedPitch('side');
    const result = await readPitch(
      h.db,
      { appBaseUrl: 'http://localhost:3000' },
      {
        associationId: seeded.associationId,
        affiliateUserId: seeded.userId,
        actor: `affiliate:${seeded.userId}`,
      },
    );
    expect('opportunity' in result).toBe(true);

    const [after] = await h.db
      .select({ status: campaignAffiliateAssociations.status })
      .from(campaignAffiliateAssociations)
      .where(eq(campaignAffiliateAssociations.id, seeded.associationId));
    expect(after?.status).toBe('reviewing');
  });
});

/* ══ One derivation for the count ═══════════════════════════════════════════ */

describe('Home’s hero count and the Pitches tab are the same answer', () => {
  it('agrees on what is waiting', async () => {
    const user = await seedUser(h, 'affiliate', 'pitch-count');
    const a = await seedPitch('counta', { user });
    await seedPitch('countb', { user, status: 'active' });

    const view = await readCreatorPitches(h.db, user.id);
    const home = await readCreatorHome(h.db, user.id);

    expect(view.pitches.map((p) => p.associationId).sort()).toEqual(
      home.pitches.map((p) => p.associationId).sort(),
    );
    expect(view.pitches.map((p) => p.associationId)).toEqual([a.associationId]);
  });

  it('derives the kind from one function', () => {
    expect(pitchKindFor(true)).toBe('proposal');
    expect(pitchKindFor(false)).toBe('opportunity');
    expect([...PITCH_DECISION_OPEN_STATES]).toEqual(['formal_decision_open', 'reviewing']);
  });
});

/* ══ E2/§14.1: the recap's content ══════════════════════════════════════════ */

describe('§14.1 — the recap register resolves against a real read', () => {
  it('answers every payload-sourced section', async () => {
    const seeded = await seedPitch('recap');
    const result = await readPitch(
      h.db,
      { appBaseUrl: 'http://localhost:3000' },
      {
        associationId: seeded.associationId,
        affiliateUserId: seeded.userId,
        actor: `affiliate:${seeded.userId}`,
      },
    );
    if (!('opportunity' in result)) throw new Error('expected a pitch');

    const payload = { opportunity: result.opportunity, content: result.content };
    const missing: string[] = [];
    for (const section of PITCH_RECAP_SECTIONS) {
      if (section.source !== 'payload') continue;
      // `undefined` is a field the payload does not carry. `null` is a field it
      // carries with nothing in it — a live-invite block on an initial-roster
      // Creator is exactly that, and it is an answer.
      if (at(payload, section.field!) === undefined) missing.push(section.field!);
    }
    expect(missing).toEqual([]);
  });

  it('answers every reveal step', async () => {
    const seeded = await seedPitch('steps');
    const result = await readPitch(
      h.db,
      { appBaseUrl: 'http://localhost:3000' },
      {
        associationId: seeded.associationId,
        affiliateUserId: seeded.userId,
        actor: `affiliate:${seeded.userId}`,
      },
    );
    if (!('opportunity' in result)) throw new Error('expected a pitch');

    const payload = { opportunity: result.opportunity, content: result.content };
    for (const step of PITCH_REVEAL_STEPS) {
      expect(at(payload, step.field), step.id).not.toBeUndefined();
    }
  });

  it('labels the Product internal target as internal, never as a goal (§3.2)', async () => {
    const seeded = await seedPitch('target');
    const content = await readPitchContent(h.db, {
      associationId: seeded.associationId,
      affiliateUserId: seeded.userId,
    });
    if (!content.ok) throw new Error('expected content');

    expect(content.content.threshold.label).toContain('internal target');
    expect(JSON.stringify(content.content).toLowerCase()).not.toMatch(/\bgoal\b/);
  });

  it('labels an Idea threshold as a count of pre-orders (§4.1)', async () => {
    const seeded = await seedPitch('thresh', { campaignType: 'pre_build' });
    const content = await readPitchContent(h.db, {
      associationId: seeded.associationId,
      affiliateUserId: seeded.userId,
    });
    if (!content.ok) throw new Error('expected content');

    expect(content.content.threshold.label).toBe('Order threshold');
    expect(content.content.threshold.value).toBe('120');
    expect(content.content.threshold.note).toContain('not an amount of money');
    expect(content.content.refundPolicy.applicable).toBe(false);
  });

  it('refuses somebody else’s pitch with the same answer as one that does not exist', async () => {
    const mine = await seedPitch('mine2');
    const theirs = await seedPitch('theirs2');
    const content = await readPitchContent(h.db, {
      associationId: theirs.associationId,
      affiliateUserId: mine.userId,
    });
    expect(content).toEqual({ ok: false, code: 'not_found' });
  });

  it('names the four sections nothing holds, rather than rendering them empty', () => {
    const absent = PITCH_RECAP_SECTIONS.filter((s) => s.source === 'absent');
    for (const section of absent) {
      expect((section.absentBecause ?? '').length, section.id).toBeGreaterThan(60);
    }
    // Every entry is exactly one of the three, and carries what that kind needs.
    for (const section of PITCH_RECAP_SECTIONS) {
      if (section.source === 'payload') expect(section.field, section.id).toBeTruthy();
      if (section.source === 'register') expect(section.register, section.id).toBeTruthy();
      if (section.source === 'absent') expect(section.absentBecause, section.id).toBeTruthy();
    }
  });
});

/* ══ The restatement ════════════════════════════════════════════════════════ */

describe('the backend restatement does not drift', () => {
  it('restates the sorts the route validates against', () => {
    expect([...backendLogic.PITCH_SORT_IDS]).toEqual([...PITCH_SORT_IDS]);
    expect(backendLogic.DEFAULT_PITCH_SORT).toBe(DEFAULT_PITCH_SORT);
  });

  it('keeps the two tab ids the surface renders', () => {
    expect(PITCH_TABS.map((t) => t.id)).toEqual(['active', 'pitches']);
  });
});
