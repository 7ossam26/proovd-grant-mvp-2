/**
 * Founder Flow v2, Session F — openness, the build, and live.
 *
 * The brief's F4 done-when, minus the parts that are properties of a rendered
 * surface (`founder-flow.test.tsx` owns those). Session A's
 * `founder-flow-v2.test.ts` already drives migration 0052's guarantees at the
 * DATABASE — the Idea refusal, the shape trigger, the one-live index, the
 * immutability — and this file does not re-drive them. What it adds is the
 * service and the route over that record, and the two claims that are about
 * the whole flow rather than one screen.
 *
 * ── The absences are the design ─────────────────────────────────────────────
 * §16 makes the optional fixed Creator payment the CREATOR's request, so what a
 * Founder answers is an openness with no amount, no percentage and no proposal
 * reference. The tests below are mostly about what no route accepts and no
 * column holds — because that is what stops this becoming the §1 rule 6
 * violation it is one column away from.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inArray, sql } from 'drizzle-orm';

import { startHarness, type Harness } from './app-harness.js';
import { createAdmin, type AdminSession } from './admin-session.js';
import { seedAdminReauthWindow } from '../settings/service.js';
import { policyVersions } from '../db/schema/policies.js';
import { FOUNDER_CLAIM_POLICY_SLUGS } from '../vetting/claim.js';
import { OPENNESS_STANCES } from '../campaign/openness.js';
import {
  BUILD_FLOW_STEPS,
  FIXED_PAYMENT_STANCES,
  FOUNDER_FLOW_PAGES,
  buildFlowStepsFor,
} from '@proovd/shared';

let h: Harness;
let admin: AdminSession;

beforeAll(async () => {
  h = await startHarness({}, 'flowf');
  admin = await createAdmin(h, 'flowf-admin');
  await seedAdminReauthWindow(h.db, 3600);
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_SRC = path.join(HERE, '..');
const FRONTEND_SRC = path.join(HERE, '..', '..', '..', 'frontend', 'src');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(full)) out.push(full);
  }
  return out;
}

/** Comments explain at length what these files refuse to do; strip them. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/* ── The openness record, over the route ──────────────────────────────────── */

describe('the fixed-payment openness (§16, §14.3)', () => {
  it('records one of three answers, supersedes rather than edits, and keeps both', async () => {
    const founder = await claimedFounder('open', 'pre_launch');

    const first = await request(h.app)
      .get(`/api/founder/campaigns/${founder.campaignId}/fixed-payment-openness`)
      .set('cookie', founder.cookie)
      .expect(200);
    expect(first.body.openness.applicable).toBe(true);
    expect(first.body.openness.stance).toBeNull();
    // §14.3's two percentages, from the §6 settings in force — never typed here.
    expect(first.body.openness.standardBasePercent).toBe(30);
    expect(first.body.openness.withFixedBasePercent).toBe(20);

    await request(h.app)
      .put(`/api/founder/campaigns/${founder.campaignId}/fixed-payment-openness`)
      .set('cookie', founder.cookie)
      .send({ stance: 'open' })
      .expect(200);

    const changed = await request(h.app)
      .put(`/api/founder/campaigns/${founder.campaignId}/fixed-payment-openness`)
      .set('cookie', founder.cookie)
      .send({ stance: 'not_open' })
      .expect(200);
    expect(changed.body.openness.stance).toBe('not_open');

    // Two rows, one live. An answer somebody changed their mind about is two
    // facts, and which one was live when a Creator was approached is a question
    // that may have to be answered later.
    const rows = await h.db.execute(
      sql`SELECT stance, superseded_at FROM founder_fixed_payment_openness
          WHERE campaign_id = ${founder.campaignId} ORDER BY recorded_at`,
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]!['stance']).toBe('open');
    expect(rows.rows[0]!['superseded_at']).not.toBeNull();
    expect(rows.rows[1]!['stance']).toBe('not_open');
    expect(rows.rows[1]!['superseded_at']).toBeNull();
  });

  it('refuses an Idea campaign by name, and records nothing', async () => {
    const founder = await claimedFounder('idea', 'pre_build');

    const view = await request(h.app)
      .get(`/api/founder/campaigns/${founder.campaignId}/fixed-payment-openness`)
      .set('cookie', founder.cookie)
      .expect(200);
    // §14.3: there is nothing to be open to, so the screen renders the
    // explanation and no control — `applicable` is what says so.
    expect(view.body.openness.applicable).toBe(false);

    const refused = await request(h.app)
      .put(`/api/founder/campaigns/${founder.campaignId}/fixed-payment-openness`)
      .set('cookie', founder.cookie)
      .send({ stance: 'open' })
      .expect(422);
    expect(refused.body.error).toBe('idea_campaign');
    expect(String(refused.body.whatHappened)).toMatch(/Idea Campaign/i);

    const rows = await h.db.execute(
      sql`SELECT 1 FROM founder_fixed_payment_openness WHERE campaign_id = ${founder.campaignId}`,
    );
    expect(rows.rows).toHaveLength(0);
  });

  it('accepts no amount, no percentage, and no proposal reference', async () => {
    const founder = await claimedFounder('narrow', 'pre_launch');

    // Everything §16 keeps out of a Founder's hands, posted at the route.
    await request(h.app)
      .put(`/api/founder/campaigns/${founder.campaignId}/fixed-payment-openness`)
      .set('cookie', founder.cookie)
      .send({
        stance: 'open',
        fixedPaymentCents: '250000',
        amountCents: '250000',
        basePercent: 5,
        proposalVersionId: randomUUID(),
        campaignType: 'pre_build',
      })
      .expect(200);

    // The table has no column any of those could land in, which is the point:
    // the absence is the enforcement, not a filter somebody could widen.
    const columns = await h.db.execute(
      sql`SELECT column_name FROM information_schema.columns
          WHERE table_name = 'founder_fixed_payment_openness'`,
    );
    const names = columns.rows.map((row) => String(row['column_name'])).sort();
    expect(names).toEqual([
      'campaign_id',
      'campaign_type',
      'id',
      'recorded_at',
      'recorded_by',
      'stance',
      'superseded_at',
    ]);

    // And the type it recorded is the campaign's own, not the one that was sent.
    const row = await h.db.execute(
      sql`SELECT campaign_type FROM founder_fixed_payment_openness
          WHERE campaign_id = ${founder.campaignId} AND superseded_at IS NULL`,
    );
    expect(row.rows[0]!['campaign_type']).toBe('pre_launch');
  });

  it('refuses an answer that is not one of the three', async () => {
    const founder = await claimedFounder('unknown', 'pre_launch');
    const refused = await request(h.app)
      .put(`/api/founder/campaigns/${founder.campaignId}/fixed-payment-openness`)
      .set('cookie', founder.cookie)
      .send({ stance: 'maybe_for_the_right_person' })
      .expect(422);
    expect(refused.body.error).toBe('unknown_stance');
  });

  it("answers another Founder's campaign with the identical 404", async () => {
    const mine = await claimedFounder('mine', 'pre_launch');
    const theirs = await claimedFounder('theirs', 'pre_launch');

    await request(h.app)
      .get(`/api/founder/campaigns/${theirs.campaignId}/fixed-payment-openness`)
      .set('cookie', mine.cookie)
      .expect(404);
    await request(h.app)
      .put(`/api/founder/campaigns/${theirs.campaignId}/fixed-payment-openness`)
      .set('cookie', mine.cookie)
      .send({ stance: 'open' })
      .expect(404);
  });

  it('restates the three answers, and the restatement does not drift', () => {
    // The backend cannot import `@proovd/shared` at runtime, so the vocabulary
    // is restated in `campaign/openness.ts` — the arrangement the state enums,
    // the §6 settings and the §27 keys all use.
    expect([...OPENNESS_STANCES]).toEqual(FIXED_PAYMENT_STANCES.map((s) => s.value));
  });
});

/* ── The build steps ──────────────────────────────────────────────────────── */

describe('the four build steps (§14.4)', () => {
  it('keeps Stage 5 in the launch-preparation order', () => {
    expect(
      FOUNDER_FLOW_PAGES.filter((page) => page.stage === 5).map((page) => page.id),
    ).toEqual([
      'voice',
      'threshold',
      'faqs',
      'rewards',
      'payouts',
      'in-review',
      'live',
      'password',
    ]);
  });

  it('walks the threshold on an Idea campaign and never on a Product one', () => {
    // §14.4 gives a Product campaign no public threshold. A hand-written walk
    // would send every Product Founder to a page with nothing on it.
    expect(buildFlowStepsFor('idea').map((s) => s.id)).toEqual([
      'voice',
      'threshold',
      'faqs',
      'rewards',
    ]);
    expect(buildFlowStepsFor('product').map((s) => s.id)).toEqual(['voice', 'faqs', 'rewards']);
  });

  it('registers a page for every step, and writes through §14.4’s own records', () => {
    const ids = FOUNDER_FLOW_PAGES.map((page) => page.id);
    for (const step of BUILD_FLOW_STEPS) {
      expect(ids, step.id).toContain(step.id);
      expect(FOUNDER_FLOW_PAGES.find((p) => p.id === step.id)!.stage, step.id).toBe(5);
    }
    expect(BUILD_FLOW_STEPS.map((s) => s.writes)).toEqual([
      'campaign_build.brand_voice',
      'campaign_build.order_threshold',
      'campaign_faqs',
      'campaign_reward_packages',
    ]);
  });

  it('leaves the build incomplete after the four steps, and says which fields remain', async () => {
    const founder = await claimedFounder('build', 'pre_build');

    // §15 refuses a build save outside `affiliate_response_and_build` — a
    // direct edit to a submitted campaign could be a material change to terms
    // Creators accepted. Paying the listing fee is what moves it there in
    // production (Phase 11's seven effects, which `listing-checkout.test.ts`
    // owns end to end); driving a whole Checkout here would prove that phase’s
    // work rather than this one’s.
    await h.db.execute(
      sql`UPDATE campaigns SET status = 'affiliate_response_and_build' WHERE id = ${founder.campaignId}`,
    );

    // Everything the four steps write, written.
    await request(h.app)
      .patch(`/api/founder/campaigns/${founder.campaignId}/build`)
      .set('cookie', founder.cookie)
      .send({ brandVoice: 'Unhurried, exact, a little dry.', orderThreshold: 120 })
      .expect(200);
    await request(h.app)
      .put(`/api/founder/campaigns/${founder.campaignId}/build/faqs`)
      .set('cookie', founder.cookie)
      .send({ question: 'When will I get it?', answer: 'March 2027, and we email if that moves.' })
      .expect(200);
    await request(h.app)
      .put(`/api/founder/campaigns/${founder.campaignId}/build/rewards`)
      .set('cookie', founder.cookie)
      .send({
        sku: 'founding-edition',
        title: 'Founding Edition',
        priceCents: '12000',
        contents: 'One lamp, the magnetic arm, and the clamp.',
        fulfillmentCommitment: 'If the date moves we email every Backer within a week.',
        delivery: 'March 2027',
      })
      .expect(200);

    const build = await request(h.app)
      .get(`/api/founder/campaigns/${founder.campaignId}/build`)
      .set('cookie', founder.cookie)
      .expect(200);

    // §14.4 requires ten shared fields plus four for Idea; these four steps
    // covered three of them. Telling somebody their campaign is built here is
    // §1.4's failure with a celebration on it.
    expect(build.body.buildStatus).not.toBe('complete');
    expect(build.body.missing.length).toBeGreaterThan(0);
    // And what is left is NAMED, which is what the last step's forward control
    // sends the Founder to read.
    expect(build.body.missing).toContain('title');
  });
});

/* ── The two claims that are about the whole flow ─────────────────────────── */

describe('nothing in the flow advances on a clock', () => {
  it('has no timer that navigates, and none at all on the two waiting screens', () => {
    // The reference auto-advances both waiting screens after five seconds. What
    // stands between a submitted campaign and a live one is §15's review,
    // §14.2's bilateral decisions, §16's readiness checklist and §17's launch —
    // none of them a wait. A timer would announce an outcome none has reached.
    //
    // The check is deliberately the PROPERTY rather than the word: the first
    // draft banned `setTimeout` outright and caught `CodeStep.tsx`, whose timer
    // counts a resend cooldown down by one and moves nobody anywhere. A check
    // that has to be silenced is worse than no check, so this asks what F4
    // actually asks — does a clock move somebody — and the two screens the
    // reference gets wrong are held to the stricter line.
    const files = walk(path.join(FRONTEND_SRC, 'surfaces', 'founder-flow')).filter(
      (file) => !/\.test\.tsx?$/.test(file),
    );
    const navigating: string[] = [];
    for (const file of files) {
      const source = withoutComments(readFileSync(file, 'utf8'));
      // The CALLBACK, not the file. `CodeStep.tsx` has both a cooldown timer
      // and an advance-on-the-sixth-digit, and they are unrelated — a
      // file-level check cannot tell them apart and would have to be silenced.
      for (const match of source.matchAll(/\b(?:setTimeout|setInterval)\s*\(/g)) {
        const body = source.slice(match.index, match.index + 240);
        if (/\bleaveToPage\(|\bleave\(|\bnavigate\(/.test(body)) {
          navigating.push(path.basename(file));
        }
      }
    }
    expect(navigating).toEqual([]);

    // And the two waiting screens carry no timer of any kind.
    for (const name of ['InReviewStep.tsx', 'LiveStep.tsx']) {
      const source = withoutComments(
        readFileSync(path.join(FRONTEND_SRC, 'surfaces', 'founder-flow', name), 'utf8'),
      );
      expect(/\bsetTimeout\b|\bsetInterval\b/.test(source), name).toBe(false);
    }
  });

  it('never renders the word the Spec bans for an Idea threshold', () => {
    // §3.2, and its last paragraph binds identifiers. The reference carries it
    // 65 times. §33.11.3's bundle scan is the backstop; this is earlier and
    // narrower, so a failure points at the file rather than at a build artifact.
    const files = [
      ...walk(path.join(FRONTEND_SRC, 'surfaces', 'founder-flow')),
      path.join(BACKEND_SRC, 'campaign', 'openness.ts'),
    ].filter((file) => !/\.test\.tsx?$/.test(file));
    const offenders: string[] = [];
    for (const file of files) {
      const source = withoutComments(readFileSync(file, 'utf8'));
      if (/\bgoals?\b/i.test(source)) offenders.push(path.basename(file));
      // §3.2 bans this one in every audience including identifiers, and the
      // reference mandates it eleven times on the Creator-pay screen.
      if (/\bupfront\b/i.test(source)) offenders.push(`${path.basename(file)} (upfront)`);
    }
    expect(offenders).toEqual([]);
  });
});

/* ── Helpers ──────────────────────────────────────────────────────────────── */

let policiesPublished = false;
async function publishClaimPolicies(): Promise<void> {
  if (policiesPublished) return;
  await h.db
    .update(policyVersions)
    .set({ status: 'published', effectiveDate: '2026-01-01', publishedAt: new Date() })
    .where(inArray(policyVersions.slug, [...FOUNDER_CLAIM_POLICY_SLUGS]));
  policiesPublished = true;
}

/** An invited Founder taken through §10's claim, on a campaign of one type. */
async function claimedFounder(
  label: string,
  type: 'pre_build' | 'pre_launch',
): Promise<{ cookie: string; campaignId: string }> {
  const email = `${label}-${randomUUID()}@example.com`;
  const created = await request(h.app)
    .post('/api/admin/founders')
    .set('cookie', admin.cookie)
    .send({
      legalName: 'Rowan Vale',
      preferredName: 'Rowan',
      email,
      phone: '+1 555 0100',
      productName: 'Waitlist',
      productUrl: 'https://waitlist.example',
      invitationSource: 'introduced by a mutual contact',
      internalOwner: 'Ada Admin',
    })
    .expect(201);

  await request(h.app)
    .put(`/api/admin/founders/${created.body.draftId}/invitation`)
    .set('cookie', admin.cookie)
    .send({
      whatWeUnderstood: 'You are building a waitlist that fills cancelled appointments.',
      whyInvited: 'A clinic operator we know described exactly this problem.',
      senderName: 'Ada Admin',
      senderEmail: 'ada@proovd.co',
      expectedSetupTime: '~3 mins',
    })
    .expect(200);

  const before = h.sentEmails.messages.length;
  await request(h.app)
    .post(`/api/admin/founders/${created.body.draftId}/send`)
    .set('cookie', admin.cookie)
    .send({})
    .expect(201);
  const token = new RegExp(String.raw`http://localhost:3000/draft/([A-Za-z0-9_-]+)`).exec(
    h.sentEmails.messages[before]!.text,
  )![1]!;

  await request(h.app)
    .patch(`/api/draft/${token}/vetting`)
    .send({
      problem: 'Cancelled appointments go unfilled because nobody has time to call the list.',
      solution: 'A waitlist that texts the next person the moment a slot opens.',
      competition: 'A paper list by the front desk, and doing nothing.',
      selectedType: type,
    })
    .expect(200);
  await request(h.app).post(`/api/draft/${token}/vetting/submit`).send({}).expect(201);

  await request(h.app)
    .patch(`/api/draft/${token}/claim`)
    .send({
      legalName: 'Rowan Vale',
      email,
      dateOfBirth: '1990-01-31',
      country: 'United States',
      stateRegion: 'Oregon',
      soleProprietor: true,
      representationUsPerson: true,
      representationAge18Plus: true,
      representationSanctions: true,
    })
    .expect(200);

  await publishClaimPolicies();
  const view = await request(h.app).get(`/api/draft/${token}/claim`).expect(200);
  const slugs = (view.body.policies as Array<{ slug: string; status?: string }>)
    .filter((p) => p.status === 'published')
    .map((p) => p.slug);

  const password = `flow-f-${randomUUID()}`;
  await request(h.app)
    .post(`/api/draft/${token}/claim`)
    .send({ password, acceptedPolicySlugs: slugs })
    .expect(201);

  const signIn = await request(h.app)
    .post('/api/auth/sign-in/email')
    .send({ email, password })
    .expect(200);

  return {
    cookie: (signIn.headers['set-cookie'] as unknown as string[]).join('; '),
    campaignId: created.body.campaignId,
  };
}
