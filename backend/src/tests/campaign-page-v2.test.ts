/**
 * The public campaign page, rebuilt — Session A, the record.
 *
 * A post-Phase-24 change, 2026-08-18. `docs/phases/campaign-page-v2.md` is the
 * brief; the supplied reference is `docs/design-refrence/Proovd-Campaign-Page-v2.html`.
 *
 * Session A writes no surface. Every deliverable is a column, a table, a
 * register, or a route — so this suite is about the record: that the new
 * content is authorable end to end, that the §20 register decides what may be
 * edited live, that §3.2's banned word reaches no identifier, and that the one
 * thing the Founder build surface could NOT do before this session (finish an
 * Idea campaign) it can do now.
 *
 * ── The gap this closes, and why it is here rather than in a surface test ───
 * Twelve of the twenty-four build columns had no input on the Founder surface,
 * four of them §14.4-REQUIRED. `READINESS_FIELD_LABELS` named them under "Still
 * needed in your build" and there was nowhere to type them, so an Idea campaign
 * could not reach `campaign_build_status = 'complete'` through the product at
 * all. A surface test would prove a box exists; this drives the ROUTES, which
 * is what proves the path exists (§1.1: a disabled button is not authorization,
 * and an enabled one is not a capability).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { startHarness, type Harness } from './app-harness.js';
import { seedUser, signInPlain } from './admin-session.js';
import { campaigns, reservations } from '../db/schema/domain.js';
import { backerIdentities } from '../db/schema/reservations.js';
import { stripeConnectedAccounts } from '../db/schema/payments.js';
import { campaignRewardPackages } from '../db/schema/build.js';
import { countActiveForRewards, createPreorder } from '../reservations/preorder.js';
import { createMemoryStripeGateway, type MemoryStripeGateway } from '../payments/stripe-client.js';
import { founderProspects, campaignDrafts } from '../db/schema/invitations.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import {
  campaignBuild,
  campaignDemoMoments,
  campaignBenefitCards,
  VISUAL_VARIANTS,
} from '../db/schema/build.js';
import {
  EDITABLE_FIELDS,
  tierFor,
  fieldsInTier,
  commitmentCheckApplies,
  COMMITMENT_CHECK_EXEMPT,
  EDIT_SURFACES,
} from '../campaign/editing-logic.js';
import {
  EDITABLE_FIELDS as SHARED_FIELDS,
  commitmentCheckApplies as sharedCommitmentCheckApplies,
  COMMITMENT_CHECK_EXEMPT as SHARED_EXEMPT,
} from '@proovd/shared';

let h: Harness;

/**
 * A memory gateway, so the sold-out refusal can be driven for real.
 *
 * The §19 refusal happens at step 2, before any SetupIntent, so nothing is
 * created at the provider either way — but `createPreorder` reads `gateway.mode`
 * for the §34 campaign-scope check on its first line, and a test that stubbed
 * that would be testing the stub.
 */
const gateway: MemoryStripeGateway = createMemoryStripeGateway({
  mode: 'test',
  platformWebhookSecret: 'whsec_platform_for_campaign_page_v2',
  connectWebhookSecret: 'whsec_connect_for_campaign_page_v2',
  taxEnabled: true,
});

beforeAll(async () => {
  h = await startHarness({ stripeGateway: gateway }, 'campaignpagev2');
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

interface Fixture {
  campaignId: string;
  cookie: string;
}

/**
 * A Founder with a campaign inside the build window and an EMPTY build.
 *
 * Empty on purpose: the point of the §14.4 completeness test is that every
 * required ingredient is reachable through a route, so seeding any of them
 * would prove the seed rather than the product.
 */
async function seedBuildableCampaign(
  label: string,
  type: 'pre_build' | 'pre_launch',
): Promise<Fixture> {
  const founder = await seedUser(h, 'founder', `cpv2-${label}`);
  const cookie = await signInPlain(h, founder.email);

  const [prospect] = await h.db
    .insert(founderProspects)
    .values({
      legalName: `Founder ${label}`,
      preferredName: `F-${label}`,
      email: founder.email,
      productName: `Product ${label}`,
      createdBy: 'admin:test',
      claimedUserId: founder.id,
      claimedAt: new Date(),
    })
    .returning({ id: founderProspects.id });

  const [campaign] = await h.db
    .insert(campaigns)
    .values({
      status: 'affiliate_response_and_build' as never,
      type,
      typeLockedAt: new Date(),
      listingPaidAt: new Date(),
    })
    .returning({ id: campaigns.id });
  const campaignId = campaign!.id;

  const [draft] = await h.db
    .insert(campaignDrafts)
    .values({ campaignId, prospectId: prospect!.id, status: 'claimed', createdBy: 'admin:test' })
    .returning({ id: campaignDrafts.id });

  await h.db.insert(founderClaimProfiles).values({
    draftId: draft!.id,
    prospectId: prospect!.id,
    campaignId,
    email: founder.email,
    preferredName: `F-${label}`,
    legalName: `Founder ${label}`,
    businessName: `${label} Labs LLC`,
    soleProprietor: false,
    claimedUserId: founder.id,
    claimedAt: new Date(),
    updatedBy: `user:${founder.id}`,
  });

  return { campaignId, cookie };
}

const api = (campaignId: string) => `/api/founder/campaigns/${campaignId}/build`;

/* ── The gap: an Idea campaign can now be finished through the product ─────── */

describe('an Idea campaign reaches `complete` entirely through the Founder build routes', () => {
  it('fills every §14.4 ingredient over the wire and the server derives complete', async () => {
    const f = await seedBuildableCampaign('idea-complete', 'pre_build');

    // Nothing seeded, so the build starts at not_started and names what it wants.
    const before = await request(h.app).get(api(f.campaignId)).set('cookie', f.cookie);
    expect(before.status).toBe(200);
    expect(before.body.buildStatus).toBe('not_started');
    expect(before.body.model).toBe('idea');
    // The four Idea-specific ingredients that had no input before this session.
    expect(before.body.missing).toEqual(
      expect.arrayContaining([
        'orderThreshold',
        'deliveryWindow',
        'earlyProductDisclaimer',
        'risksAndChallenges',
      ]),
    );

    const patched = await request(h.app)
      .patch(api(f.campaignId))
      .set('cookie', f.cookie)
      .send({
        title: 'Loopnote',
        founderDisplayName: 'Sample Labs',
        founderCountry: 'United States',
        founderProfileUrl: 'https://example.com/labs',
        opensAt: '2026-09-01T15:00:00.000Z',
        closesAt: '2026-10-01T15:00:00.000Z',
        brandPerception: 'Calm and precise.',
        brandVoice: 'Plain sentences.',
        heroPreference: 'The demo stage.',
        publicStory: 'We built the first one for ourselves.',
        // The four that were unreachable.
        orderThreshold: 250,
        deliveryWindow: 'March to April 2027',
        earlyProductDisclaimer: 'This is an early build and the finish may vary.',
        risksAndChallenges: 'Capacity is the schedule risk.',
      });
    expect(patched.status).toBe(200);

    // §14.4 also requires at least one reward package.
    const reward = await request(h.app)
      .put(`${api(f.campaignId)}/rewards`)
      .set('cookie', f.cookie)
      .send({
        sku: 'LOOP-YEAR',
        title: 'A year of Loopnote',
        priceCents: '9000',
        contents: 'One year of access.',
        fulfillmentCommitment: 'A redemption code by email.',
        delivery: 'March 2027',
      });
    expect(reward.status).toBe(200);

    const after = await request(h.app).get(api(f.campaignId)).set('cookie', f.cookie);
    expect(after.body.missing).toEqual([]);
    expect(after.body.buildStatus).toBe('complete');

    // And the server's own mirror on `campaigns` moved with it (§23.2) — the
    // status is derived, never a flag a Founder set.
    const [row] = await h.db
      .select({ status: campaigns.campaignBuildStatus })
      .from(campaigns)
      .where(eq(campaigns.id, f.campaignId));
    expect(row!.status).toBe('complete');
  });

  it('a Product campaign wants its own type-specific ingredients, not the Idea ones', async () => {
    const f = await seedBuildableCampaign('product-missing', 'pre_launch');
    const res = await request(h.app).get(api(f.campaignId)).set('cookie', f.cookie);
    expect(res.body.model).toBe('product');
    expect(res.body.missing).toEqual(expect.arrayContaining(['internalTargetCents', 'refundPolicy']));
    expect(res.body.missing).not.toContain('orderThreshold');
  });
});

/* ── The new content is authorable, and the record refuses the wrong shapes ── */

describe('the demo stage and the benefit cards', () => {
  it('appends without a client-supplied position, so a removal cannot collide', async () => {
    const f = await seedBuildableCampaign('demo-order', 'pre_build');

    for (const label of ['Morning', 'Midday', 'Evening']) {
      const res = await request(h.app)
        .put(`${api(f.campaignId)}/demo-moments`)
        .set('cookie', f.cookie)
        .send({
          timeLabel: '8:15',
          momentLabel: label,
          stateWord: 'Quiet',
          headline: 'You are on track.',
          signalText: 'No nudge needed',
        });
      expect(res.status).toBe(200);
    }

    const listed = await request(h.app).get(api(f.campaignId)).set('cookie', f.cookie);
    const moments = listed.body.demoMoments as Array<{ id: string; momentLabel: string }>;
    expect(moments.map((m) => m.momentLabel)).toEqual(['Morning', 'Midday', 'Evening']);

    // `(campaign_id, sort_order)` is UNIQUE. Removing the FIRST leaves a list of
    // length 2 whose highest position is 2 — so a client that sent `length` as
    // the next position would collide with the row still sitting at 1. The
    // server appends instead, and this is the case that proves it.
    const removed = await request(h.app)
      .delete(`${api(f.campaignId)}/demo-moments/${moments[0]!.id}`)
      .set('cookie', f.cookie);
    expect(removed.status).toBe(200);

    const added = await request(h.app)
      .put(`${api(f.campaignId)}/demo-moments`)
      .set('cookie', f.cookie)
      .send({
        timeLabel: '22:00',
        momentLabel: 'Night',
        stateWord: 'Done',
        headline: 'Nothing left to do.',
        signalText: 'Quiet until morning',
      });
    expect(added.status).toBe(200);

    const positions = await h.db
      .select({ sortOrder: campaignDemoMoments.sortOrder })
      .from(campaignDemoMoments)
      .where(eq(campaignDemoMoments.campaignId, f.campaignId));
    expect(new Set(positions.map((p) => p.sortOrder)).size).toBe(3);
  });

  it('refuses a moment that is neither a signal nor an action, by name', async () => {
    const f = await seedBuildableCampaign('demo-shape', 'pre_build');
    const res = await request(h.app)
      .put(`${api(f.campaignId)}/demo-moments`)
      .set('cookie', f.cookie)
      .send({
        timeLabel: '8:15',
        momentLabel: 'Morning',
        stateWord: 'Quiet',
        headline: 'You are on track.',
        // no signalText, and isAction is false
      });
    expect(res.status).toBe(422);
    expect(res.body.whatHappened).toMatch(/signal/i);

    // And the database refuses it too, so a hand-written INSERT gets the same
    // answer the service gives — the shape is a fact, not a service convention.
    await expect(
      h.db.insert(campaignDemoMoments).values({
        campaignId: f.campaignId,
        timeLabel: '8:15',
        momentLabel: 'Morning',
        stateWord: 'Quiet',
        headline: 'You are on track.',
        isAction: false,
        signalText: null,
      }),
    ).rejects.toThrow();
  });

  it('refuses a fourth benefit-card shape — three exist and a fourth renders nothing', async () => {
    const f = await seedBuildableCampaign('benefit-variant', 'pre_build');
    const res = await request(h.app)
      .put(`${api(f.campaignId)}/benefit-cards`)
      .set('cookie', f.cookie)
      .send({ title: 'Smart timing', footerWord: 'Right moment', visualVariant: 'sparkline' });
    expect(res.status).toBe(422);
    expect(res.body.whatHappened).toContain('bars');

    await expect(
      h.db.insert(campaignBenefitCards).values({
        campaignId: f.campaignId,
        title: 'Smart timing',
        footerWord: 'Right moment',
        visualVariant: 'sparkline',
      }),
    ).rejects.toThrow();
  });

  it('caps the demo at three moments and says so rather than failing at the database', async () => {
    const f = await seedBuildableCampaign('demo-cap', 'pre_build');
    for (let i = 0; i < 3; i += 1) {
      await request(h.app)
        .put(`${api(f.campaignId)}/demo-moments`)
        .set('cookie', f.cookie)
        .send({
          timeLabel: `${8 + i}:00`,
          momentLabel: `Moment ${i}`,
          stateWord: 'Quiet',
          headline: 'On track.',
          signalText: 'No nudge needed',
        });
    }
    const fourth = await request(h.app)
      .put(`${api(f.campaignId)}/demo-moments`)
      .set('cookie', f.cookie)
      .send({
        timeLabel: '23:00',
        momentLabel: 'One too many',
        stateWord: 'Quiet',
        headline: 'On track.',
        signalText: 'No nudge needed',
      });
    expect(fourth.status).toBe(422);
    expect(fourth.body.whatHappened).toContain('3');
  });
});

describe('the FAQ finally has a writer', () => {
  /*
   * `campaign_faqs` shipped in Phase 12b with a read, a live-edit path, and a
   * full CRUD grant — and no production INSERT anywhere: the only one in the
   * repository was in a test. The §14.4 section existed on the Founder's own
   * preview with nothing behind it.
   */
  it('creates, reads back, and removes a question through the routes', async () => {
    const f = await seedBuildableCampaign('faq', 'pre_build');

    const created = await request(h.app)
      .put(`${api(f.campaignId)}/faqs`)
      .set('cookie', f.cookie)
      .send({ question: 'When will I get it?', answer: 'We commit to March 2027.' });
    expect(created.status).toBe(200);

    const listed = await request(h.app).get(api(f.campaignId)).set('cookie', f.cookie);
    expect(listed.body.faqs).toHaveLength(1);
    expect(listed.body.faqs[0].question).toBe('When will I get it?');

    const removed = await request(h.app)
      .delete(`${api(f.campaignId)}/faqs/${listed.body.faqs[0].id}`)
      .set('cookie', f.cookie);
    expect(removed.status).toBe(200);

    const empty = await request(h.app).get(api(f.campaignId)).set('cookie', f.cookie);
    expect(empty.body.faqs).toEqual([]);
  });

  it('refuses a question with no answer', async () => {
    const f = await seedBuildableCampaign('faq-half', 'pre_build');
    const res = await request(h.app)
      .put(`${api(f.campaignId)}/faqs`)
      .set('cookie', f.cookie)
      .send({ question: 'When?', answer: '   ' });
    expect(res.status).toBe(422);
  });
});

describe('the page copy is optional, always', () => {
  it('no new column can hold a build below complete', async () => {
    const f = await seedBuildableCampaign('optional-copy', 'pre_build');
    const res = await request(h.app).get(api(f.campaignId)).set('cookie', f.cookie);
    const missing = res.body.missing as string[];
    for (const key of [
      'heroHeadline',
      'heroHeadlineAccent',
      'heroSubheadline',
      'founderPullQuote',
      'platformLine',
      'demoContextLabel',
      'benefitsHeading',
      'rewardsHeading',
      'updatesHeading',
      'faqHeading',
    ]) {
      expect(missing).not.toContain(key);
    }
  });

  it('round-trips every new column through PATCH and the read', async () => {
    const f = await seedBuildableCampaign('roundtrip', 'pre_build');
    const patch = {
      heroHeadline: 'Drink on time.',
      heroHeadlineAccent: 'Without thinking.',
      heroSubheadline: 'It nudges you only when it helps.',
      founderPullQuote: 'I built it because I kept forgetting.',
      platformLine: 'iOS and Android',
      demoContextLabel: 'A Thursday',
      benefitsHeading: 'Built to disappear.',
      rewardsHeading: 'Choose your access.',
      updatesHeading: 'The build',
      faqHeading: 'Questions',
    };
    const saved = await request(h.app)
      .patch(api(f.campaignId))
      .set('cookie', f.cookie)
      .send(patch);
    expect(saved.status).toBe(200);

    // The five-place rule: a column in Drizzle and the migration but missing an
    // `assign(...)` line is one no Founder can ever write, and missing from
    // `serializeBuild` is one they can write and never read back. Both halves.
    const read = await request(h.app).get(api(f.campaignId)).set('cookie', f.cookie);
    for (const [key, value] of Object.entries(patch)) {
      expect(read.body.build[key]).toBe(value);
    }

    const [row] = await h.db
      .select()
      .from(campaignBuild)
      .where(eq(campaignBuild.campaignId, f.campaignId));
    expect(row!.heroHeadline).toBe('Drink on time.');
    expect(row!.faqHeading).toBe('Questions');
  });
});

/* ── §3.2: `goal` reaches no identifier ────────────────────────────────────── */

describe('§3.2 bans `goal` for an Idea threshold, including in identifiers', () => {
  /*
   * §33.11.3's bundle scan reads the BUILT bundle, where a prop name survives
   * minification — the Campaigns hub hit that scan with `progress.goal` on its
   * first draft. This is stricter and earlier: the word reaches no column, no
   * register value, no payload key, and no route path in anything this session
   * added, so the bundle scan never has to be the thing that catches it.
   */
  const scan = (value: unknown, path: string, hits: string[]): void => {
    if (typeof value === 'string') {
      if (/\bgoals?\b/i.test(value)) hits.push(`${path} = ${value}`);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((v, i) => scan(v, `${path}[${i}]`, hits));
      return;
    }
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        if (/\bgoals?\b/i.test(k)) hits.push(`${path}.${k} (key)`);
        scan(v, `${path}.${k}`, hits);
      }
    }
  };

  it('appears in no column of either new table', async () => {
    const rows = await h.db.execute(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_name IN ('campaign_demo_moments', 'campaign_benefit_cards', 'campaign_build', 'campaign_updates')` as never,
    );
    const names = (rows.rows as Array<{ column_name: string }>).map((r) => r.column_name);
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((n) => /goal/i.test(n))).toEqual([]);
  });

  it('appears nowhere in the §20 register', () => {
    const hits: string[] = [];
    scan(EDITABLE_FIELDS, 'EDITABLE_FIELDS', hits);
    expect(hits).toEqual([]);
  });

  it('appears nowhere in the Founder build payload', async () => {
    const f = await seedBuildableCampaign('goalscan', 'pre_build');
    await request(h.app)
      .patch(api(f.campaignId))
      .set('cookie', f.cookie)
      .send({ orderThreshold: 250 });
    const res = await request(h.app).get(api(f.campaignId)).set('cookie', f.cookie);
    const hits: string[] = [];
    scan(res.body, 'build', hits);
    expect(hits).toEqual([]);
    // And the number itself is still there, under the name §3.2 mandates.
    expect(res.body.build.orderThreshold).toBe(250);
  });
});

/* ── The §20 register is the gate, and it is a gate in both directions ─────── */

describe('§20 live-editing register — the two new surfaces', () => {
  it('carries the same 20 new entries in both copies, including the reason', () => {
    // The existing parity guard compares tier, label, and specRef. `reason` is
    // what a Founder actually reads on a refusal and what lands in the audit
    // row, and 20 entries were hand-copied into two files with nothing
    // comparing them — so compare it.
    expect(EDITABLE_FIELDS.length).toBe(SHARED_FIELDS.length);
    for (const shared of SHARED_FIELDS) {
      const restated = tierFor(shared.surface, shared.field);
      expect(restated.reason).toBe(shared.reason);
    }
  });

  it('throws on a field nobody registered — no default in either direction', () => {
    expect(() => tierFor('demo_moment', 'notARegisteredField')).toThrow(/register/);
    expect(() => tierFor('benefit_card', 'notARegisteredField')).toThrow(/register/);
    // And the same field name on a surface that does not own it.
    expect(() => tierFor('build', 'visualVariant')).toThrow(/register/);
  });

  it('keeps `title` on two surfaces apart, because the key is surface:field', () => {
    expect(tierFor('build', 'title').label).toBe('Campaign title');
    expect(tierFor('benefit_card', 'title').label).toBe('Benefit card title');
  });

  it('admits the two new surfaces in both the register and the database CHECK', async () => {
    expect(EDIT_SURFACES).toContain('demo_moment');
    expect(EDIT_SURFACES).toContain('benefit_card');
    const rows = await h.db.execute(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conname = 'campaign_live_edits_surface_known'` as never,
    );
    const def = (rows.rows[0] as { def: string } | undefined)?.def ?? '';
    expect(def).toContain('demo_moment');
    expect(def).toContain('benefit_card');
  });

  it('every column-one build field has a write path mapped', async () => {
    /*
     * `BUILD_COLUMNS` in `live-editing.ts` is read purely as a presence check
     * before the write, so a `direct_versioned` build field added to the
     * register without a key there throws by name at write time — and no
     * existing test reaches that throw. This compares the two directly.
     */
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../campaign/live-editing.ts', import.meta.url), 'utf8'),
    );
    const block = source.slice(
      source.indexOf('const BUILD_COLUMNS'),
      source.indexOf('};', source.indexOf('const BUILD_COLUMNS')),
    );
    for (const field of fieldsInTier('direct_versioned').filter((f) => f.surface === 'build')) {
      expect(block).toContain(`${field.field}:`);
    }
  });
});

/* ── The §20 loophole is not scoped to the FAQ ─────────────────────────────── */

describe('the commitment check runs on every column-one field that can carry a promise', () => {
  it('applies to the new headings and labels, and to the FAQ answer it started on', () => {
    for (const key of [
      ['faq', 'answer'],
      ['build', 'benefitsHeading'],
      ['build', 'rewardsHeading'],
      ['build', 'demoContextLabel'],
      ['demo_moment', 'momentLabel'],
      ['benefit_card', 'footerWord'],
    ] as const) {
      expect(commitmentCheckApplies(key[0], key[1])).toBe(true);
    }
  });

  it('exempts only what structurally cannot carry a promise, and says why', () => {
    expect(Object.keys(COMMITMENT_CHECK_EXEMPT).sort()).toEqual(
      ['benefit_card:visualVariant', 'build:communityUrl', 'build:founderProfileUrl'].sort(),
    );
    for (const [key, reason] of Object.entries(COMMITMENT_CHECK_EXEMPT)) {
      expect(commitmentCheckApplies(...(key.split(':') as [never, string]))).toBe(false);
      // A register entry whose reason is a shrug is an exemption nobody reviewed.
      expect(reason.trim().length).toBeGreaterThan(40);
    }
  });

  it('never applies to a field that is already reviewed or already refused', () => {
    // Column two goes to review anyway and column three has no write path, so
    // running the check there would be a second answer to a settled question.
    expect(commitmentCheckApplies('build', 'heroHeadline')).toBe(false);
    expect(commitmentCheckApplies('build', 'orderThreshold')).toBe(false);
  });

  it('is restated identically in shared and in the backend', () => {
    expect(COMMITMENT_CHECK_EXEMPT).toEqual(SHARED_EXEMPT);
    for (const shared of SHARED_FIELDS) {
      expect(commitmentCheckApplies(shared.surface, shared.field)).toBe(
        sharedCommitmentCheckApplies(shared.surface, shared.field),
      );
    }
  });
});

/* ── The three benefit shapes are named by shape, not by one campaign's copy ─ */

describe('§30: no variant is named after a forbidden mechanic', () => {
  it('names the three treatments by shape', () => {
    expect([...VISUAL_VARIANTS]).toEqual(['bars', 'check', 'dots']);
    for (const variant of VISUAL_VARIANTS) {
      expect(variant).not.toMatch(/streak|badge|combo|trophy/i);
    }
  });
});

/* ── `remaining`, and the one predicate behind it ──────────────────────────── */

/**
 * `limitedQuantity` is a §14.4 field the public payload used to drop, so the
 * page could not render "N left" at all. Adding it is only safe if the number
 * the page shows and the number checkout refuses on are the SAME number — a page
 * saying "3 left" over a different predicate is a Backer told there is stock and
 * then told, after typing a card, that there is not.
 *
 * So this drives both ends against one seeded campaign: the public read, and the
 * real §19 refusal, which had no test of its own until now.
 */
describe('a limited reward reports what checkout would actually refuse', () => {
  it('renders null when unlimited, 0 at the limit, and refuses exactly there', async () => {
    const founder = await seedUser(h, 'founder', 'cpv2-remaining');
    const closeAt = new Date(Date.now() + 14 * 86_400_000);

    const [prospect] = await h.db
      .insert(founderProspects)
      .values({
        legalName: 'Founder remaining',
        preferredName: 'F-remaining',
        email: founder.email,
        productName: 'Product remaining',
        createdBy: 'admin:test',
        claimedUserId: founder.id,
        claimedAt: new Date(),
      })
      .returning({ id: founderProspects.id });

    const [campaign] = await h.db
      .insert(campaigns)
      .values({
        status: 'live' as never,
        type: 'pre_launch',
        typeLockedAt: new Date(),
        listingPaidAt: new Date(),
        campaignLiveAt: new Date(Date.now() - 86_400_000),
        campaignCloseAt: closeAt,
      })
      .returning({ id: campaigns.id });
    const campaignId = campaign!.id;

    const [draft] = await h.db
      .insert(campaignDrafts)
      .values({ campaignId, prospectId: prospect!.id, status: 'claimed', createdBy: 'admin:test' })
      .returning({ id: campaignDrafts.id });

    await h.db.insert(founderClaimProfiles).values({
      draftId: draft!.id,
      prospectId: prospect!.id,
      campaignId,
      email: founder.email,
      preferredName: 'F-remaining',
      legalName: 'Founder remaining',
      businessName: 'Remaining Labs LLC',
      soleProprietor: false,
      claimedUserId: founder.id,
      claimedAt: new Date(),
      updatedBy: `user:${founder.id}`,
    });

    await h.db.insert(stripeConnectedAccounts).values({
      stripeAccountId: `acct_rem${randomUUID().slice(0, 8)}`,
      mode: 'test',
      role: 'founder_seller',
      ownerUserId: founder.id,
      state: 'complete',
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });

    await h.db.insert(campaignBuild).values({
      campaignId,
      title: 'Campaign remaining',
      founderDisplayName: 'Founder remaining',
      founderEntityDisplay: 'Remaining Labs LLC',
      founderCountry: 'United States',
      publicStory: 'A story.\n\nAnd a second paragraph.',
      heroPreference: 'hero-image',
      opensAt: new Date(Date.now() - 86_400_000),
      closesAt: closeAt,
      updatedBy: 'user:test',
    });

    const [unlimited] = await h.db
      .insert(campaignRewardPackages)
      .values({
        campaignId,
        sku: 'OPEN',
        title: 'No limit',
        priceCents: 5_000n,
        contents: 'One unit.',
        fulfillmentCommitment: 'We will ship it.',
        delivery: '2026-12',
        limitedQuantity: null,
        sortOrder: 0,
      })
      .returning({ id: campaignRewardPackages.id });

    const [limited] = await h.db
      .insert(campaignRewardPackages)
      .values({
        campaignId,
        sku: 'LIMITED',
        title: 'Only two',
        priceCents: 9_000n,
        contents: 'One unit.',
        fulfillmentCommitment: 'We will ship it.',
        delivery: '2026-12',
        limitedQuantity: 2,
        sortOrder: 1,
      })
      .returning({ id: campaignRewardPackages.id });

    const agent = request(h.app);

    // Nothing taken yet: the unlimited reward reports null, the limited one 2.
    const fresh = await agent.get(`/api/campaign/${campaignId}`);
    expect(fresh.status).toBe(200);
    const freshRewards = fresh.body.campaign.rewards as Array<{
      sku: string;
      limitedQuantity: number | null;
      remaining: number | null;
    }>;
    const freshOpen = freshRewards.find((r) => r.sku === 'OPEN')!;
    const freshLimited = freshRewards.find((r) => r.sku === 'LIMITED')!;
    expect(freshOpen.limitedQuantity).toBeNull();
    // Null, not `Infinity` and not a large number: the page renders no line at
    // all for an unlimited reward rather than inventing a scarcity signal (§30).
    expect(freshOpen.remaining).toBeNull();
    expect(freshLimited.remaining).toBe(2);

    // Fill the limited reward to its limit.
    for (let i = 0; i < 2; i += 1) {
      const [identity] = await h.db
        .insert(backerIdentities)
        .values({
          campaignId,
          email: `remaining-${i}@example.com`,
          emailNormalized: `remaining-${i}@example.com`,
          phone: `+1555000000${i}`,
          phoneNormalized: `1555000000${i}`,
          // §4.1's key is an HMAC the service computes; this test is about the
          // COUNT, so any distinct value stands in for two different people.
          dedupKey: `cpv2-remaining-${i}`,
        })
        .returning({ id: backerIdentities.id });
      await h.db.insert(reservations).values({
        campaignId,
        backerIdentityId: identity!.id,
        rewardPackageId: limited!.id,
        status: 'reserved_active',
        subtotalCents: 9_000n,
        taxCents: 0n,
        totalAuthorizedCents: 9_000n,
      });
    }

    const full = await agent.get(`/api/campaign/${campaignId}`);
    const fullRewards = full.body.campaign.rewards as Array<{
      sku: string;
      remaining: number | null;
    }>;
    expect(fullRewards.find((r) => r.sku === 'LIMITED')!.remaining).toBe(0);
    // The unlimited reward is untouched by another reward filling up.
    expect(fullRewards.find((r) => r.sku === 'OPEN')!.remaining).toBeNull();

    // §19: a sold-out reward stays VISIBLE and unavailable, never hidden.
    expect(fullRewards.map((r) => r.sku).sort()).toEqual(['LIMITED', 'OPEN']);

    // The page's number and checkout's refusal read one function, so they cannot
    // disagree — asserted by value, not by reading the source.
    const counts = await countActiveForRewards(h.db, [unlimited!.id, limited!.id]);
    expect(counts.get(limited!.id)).toBe(2);
    expect(counts.get(unlimited!.id)).toBeUndefined();

    // And the refusal itself, which had no test before this. It happens at step
    // 2, before any SetupIntent, so nothing was created at the provider.
    const soldOut = await createPreorder(
      { db: h.db, gateway },
      {
        campaignId,
        rewardSku: 'LIMITED',
        email: 'someone-else@example.com',
        fullName: 'Someone Else',
        phone: '+15550009999',
        billing: { country: 'US', postalCode: '10001', line1: '1 Main St', city: 'New York', state: 'NY' },
        ageConfirmed: true,
        consentAccepted: true,
        survey: {},
      } as never,
    );
    expect(soldOut.ok).toBe(false);
    if (!soldOut.ok) {
      expect(soldOut.refusal.code).toBe('reward_sold_out');
      expect(soldOut.refusal.next).toBe('Choose another reward to continue.');
    }

    // The unlimited reward is still reachable — the refusal is about the one
    // reward that filled up, not about the campaign.
    const stillOpen = await createPreorder(
      { db: h.db, gateway },
      {
        campaignId,
        rewardSku: 'OPEN',
        email: 'someone-else@example.com',
        fullName: 'Someone Else',
        phone: '+15550009999',
        billing: { country: 'CA', postalCode: 'M5V', line1: '1 Main St', city: 'Toronto', state: 'ON' },
        ageConfirmed: true,
        consentAccepted: true,
        survey: {},
      } as never,
    );
    expect(stillOpen.ok).toBe(false);
    // Refused for the NEXT reason in order (§33.5.1's non-US billing), which is
    // what proves availability passed rather than that everything refuses.
    if (!stillOpen.ok) expect(stillOpen.refusal.code).toBe('non_us_billing');
  });
});
