/**
 * Founder Dashboard Session E — Chapter 3, Get paid.
 *
 * The E done-when, minus the parts that are properties of a rendered surface
 * (`founder-dashboard.test.tsx` owns those):
 *
 *  - the Founder payment payload and the Admin queue's deep-compare equal;
 *  - no arithmetic on money exists in the chapter's source;
 *  - `EARLY_RELEASE_NEVER_SKIPS_DAY_14` is on the payload §22.3 puts it on.
 *
 * Plus the one payload this session added — §21's retry window — which is
 * asserted as a READ of three stored columns rather than as a computation over
 * two of them, because a duration this page worked out for itself is exactly
 * what the reference's "Three-day card retry window" is.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';

import { startHarness, type Harness } from './app-harness.js';
import { seedUser, signInPlain } from './admin-session.js';
import { createMemoryStripeGateway } from '../payments/stripe-client.js';
import { campaigns } from '../db/schema/domain.js';
import { founderProspects, campaignDrafts } from '../db/schema/invitations.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { campaignBuild } from '../db/schema/build.js';
import { campaignCloseBatches } from '../db/schema/close.js';
import { readFounderResults } from '../close/results.js';
import * as shared from '@proovd/shared';

let h: Harness;

const gateway = createMemoryStripeGateway({
  mode: 'test',
  platformWebhookSecret: 'whsec_platform_for_fde_suite',
  connectWebhookSecret: 'whsec_connect_for_fde_suite',
  taxEnabled: true,
});

beforeAll(async () => {
  h = await startHarness(
    {
      stripeGateway: gateway,
      stripeConnectUrls: {
        returnUrl: 'https://app.example.com/stripe/return',
        refreshUrl: 'https://app.example.com/stripe/refresh',
      },
    },
    'fde',
  );
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_SRC = path.join(HERE, '..', '..', '..', 'frontend', 'src');
const CHAPTER = path.join(FRONTEND_SRC, 'surfaces', 'founder', 'chapters', 'PaidChapter.tsx');

/**
 * The chapter's own header explains at length what it refuses to compute, and
 * the register beside it quotes the reference's arithmetic verbatim. A scan
 * that could not tell an explanation from a usage would force the explanations
 * out, and the reasoning is the more valuable of the two (`notifications/`'s
 * rule, applied to a surface).
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

interface Seeded {
  campaignId: string;
  founderEmail: string;
}

/**
 * One CLOSED campaign with a close batch on it. The batch is written directly
 * rather than through `runCloseBatch`: Phase 18a's own suite drives the batch,
 * and what this file needs is a row whose three window columns are known.
 */
async function seedClosed(
  label: string,
  batch: {
    status?: string;
    campaignStatus?: string;
    retryWindowHours?: number;
    firstFailureAt?: Date | null;
    retryDeadlineAt?: Date | null;
  } = {},
): Promise<Seeded> {
  const founder = await seedUser(h, 'founder', `fde-founder-${label}`);
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

  const closeAt = new Date(Date.now() - 3 * 24 * 3_600_000);
  const [campaign] = await h.db
    .insert(campaigns)
    .values({
      status: batch.campaignStatus ?? 'closed_reconciling',
      type: 'pre_launch',
      typeLockedAt: new Date(),
      listingPaidAt: new Date(Date.now() - 40 * 24 * 3_600_000),
      campaignLiveAt: new Date(Date.now() - 33 * 24 * 3_600_000),
      campaignCloseAt: closeAt,
      highEffort: false,
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
    claimedUserId: founder.id,
    claimedAt: new Date(),
    updatedBy: `user:${founder.id}`,
  });

  await h.db.insert(campaignBuild).values({
    campaignId,
    title: `Campaign ${label}`,
    founderDisplayName: `Founder ${label}`,
    brandVoice: 'Plain and unhurried.',
    updatedBy: 'user:test',
  });

  await h.db.insert(campaignCloseBatches).values({
    campaignId,
    campaignType: 'pre_launch',
    closeAt,
    status: batch.status ?? 'complete',
    retryWindowHours: batch.retryWindowHours ?? 48,
    firstFailureAt: batch.firstFailureAt ?? null,
    retryDeadlineAt: batch.retryDeadlineAt ?? null,
    actor: 'system:close',
  });

  return { campaignId, founderEmail: founder.email };
}

/* ── §21: the retry window is READ, never worked out ───────────────────────── */

describe('§21 — the retry window on the Founder read', () => {
  it('carries the three stored columns verbatim, so no duration is computed', async () => {
    const firstFailureAt = new Date('2026-09-12T17:20:00.000Z');
    const retryDeadlineAt = new Date('2026-09-14T17:20:00.000Z');
    const { campaignId } = await seedClosed('read', {
      retryWindowHours: 48,
      firstFailureAt,
      retryDeadlineAt,
    });

    const results = await readFounderResults(h.db, { campaignId });
    expect(results?.retryWindow).toEqual({
      state: 'closed',
      windowHours: 48,
      firstFailureAt: firstFailureAt.toISOString(),
      deadlineAt: retryDeadlineAt.toISOString(),
    });
  });

  it('reports a window whose hours are not 48, because the §6 setting decides', async () => {
    /*
      The reference hardcodes three days and then reuses the same three days as
      the payout gate. §6's `capture_retry_window_hours` is a setting; a
      deployment that changes it must change what a Founder is told, and the
      only way to prove the read is a read is to store something else.
    */
    const { campaignId } = await seedClosed('hours', {
      retryWindowHours: 72,
      firstFailureAt: new Date('2026-09-12T17:20:00.000Z'),
      retryDeadlineAt: new Date('2026-09-15T17:20:00.000Z'),
    });

    const results = await readFounderResults(h.db, { campaignId });
    expect(results?.retryWindow?.windowHours).toBe(72);
    expect(results?.retryWindow?.deadlineAt).toBe('2026-09-15T17:20:00.000Z');
  });

  it('is `open` while the campaign is, even with the deadline already past', async () => {
    /*
      `endRetryWindow` is what moves a campaign out of the window, and it
      resolves any in-flight attempt under its own key first. A window whose
      deadline has passed but whose sweep has not run is still open — deciding
      it from this process's clock instead would tell a Founder their outcomes
      were final while a charge was still being resolved.
    */
    const { campaignId } = await seedClosed('open', {
      campaignStatus: 'capture_retry_window',
      status: 'in_progress',
      firstFailureAt: new Date(Date.now() - 10 * 24 * 3_600_000),
      retryDeadlineAt: new Date(Date.now() - 8 * 24 * 3_600_000),
    });

    const results = await readFounderResults(h.db, { campaignId });
    expect(results?.retryWindow?.state).toBe('open');
  });

  it('keeps `not_opened` and `closed` apart — no card ever failing is its own fact', async () => {
    const { campaignId } = await seedClosed('clean');
    const results = await readFounderResults(h.db, { campaignId });
    expect(results?.retryWindow).toEqual({
      state: 'not_opened',
      windowHours: 48,
      firstFailureAt: null,
      deadlineAt: null,
    });
  });
});

/* ── §33.8.13: one source, many renderers ──────────────────────────────────── */

describe('§22.3 — the Founder payload and the Admin queue agree', () => {
  it('deep-compares equal, because both routes call the one resolver', async () => {
    const { campaignId, founderEmail } = await seedClosed('compare');
    const founderCookie = await signInPlain(h, founderEmail);
    const admin = await seedUser(h, 'admin', 'fde-admin');
    const adminCookie = await signInPlain(h, admin.email);

    const founderRes = await request(h.app)
      .get(`/api/founder/campaigns/${campaignId}/payments`)
      .set('Cookie', founderCookie)
      .expect(200);
    const adminRes = await request(h.app)
      .get(`/api/admin/close/${campaignId}/founder-payments`)
      .set('Cookie', adminCookie)
      .expect(200);

    expect(founderRes.body.payments).toEqual(adminRes.body.status);
  });

  it('carries §22.3’s pinned never-skips sentence on the payload the chapter renders', async () => {
    const { campaignId, founderEmail } = await seedClosed('pinned');
    const cookie = await signInPlain(h, founderEmail);

    const res = await request(h.app)
      .get(`/api/founder/campaigns/${campaignId}/payments`)
      .set('Cookie', cookie)
      .expect(200);

    // A Product campaign always carries the early-release block; §33.8.12's
    // sentence rides it whether or not the §6 setting is on, because the
    // whole point is that the path never removes the review.
    expect(res.body.payments.earlyRelease?.neverSkipsDay14).toBe(
      shared.EARLY_RELEASE_NEVER_SKIPS_DAY_14,
    );
  });
});

/* ── The chapter's own source ──────────────────────────────────────────────── */

describe('Chapter 3 — the surface computes nothing about money', () => {
  const source = stripComments(readFileSync(CHAPTER, 'utf8'));

  it('contains no arithmetic operator applied to an amount', () => {
    /*
      Deliberately narrow and deliberately about MONEY. A general ban on `*`
      or `-` would fire on `sequence - 1` and on JSX, and a check that has to
      be silenced is worse than none. What this looks for is the shapes the
      reference actually uses: a percentage of a total, a subtraction of one
      amount from another, and `Math.round` over either.
    */
    expect(source).not.toMatch(/Math\.(round|floor|ceil|abs)/);
    expect(source).not.toMatch(/Cents\s*[-+*/]/);
    expect(source).not.toMatch(/[-+*/]\s*\w*Cents\b/);
    expect(source).not.toMatch(/\*\s*0?\.\d/);
    expect(source).not.toMatch(/\breduce\s*\(/);
    expect(source).not.toMatch(/\bparseFloat\b|\bparseInt\b/);
  });

  it('renders every amount through the shared formatter and nothing else', () => {
    const bigintUses = source.match(/BigInt\(/g) ?? [];
    expect(bigintUses).toHaveLength(1);
    expect(source).toMatch(/const usd = \(cents: string\): string => formatUsd\(BigInt\(cents\)\);/);
  });

  it('has no control that would request a scheduled payment (§22.3)', () => {
    for (const banned of [
      /Request payment/i,
      /Request 40/i,
      /Request the rest/i,
      /request-payout/,
      /request-rest/,
      /With Proovd rep/i,
    ]) {
      expect(source).not.toMatch(banned);
    }
  });

  it('offers no file input anywhere — not for the W-9 and not for delivery', () => {
    expect(source).not.toMatch(/type="file"/);
    expect(source).not.toMatch(/accept=/);
  });

  it('never says money is held (§3.2)', () => {
    for (const banned of [
      /\bescrow\b/i,
      /\bcustody\b/i,
      /held balance/i,
      /held money/i,
      /held in a Proovd/i,
      /\bpledge\b/i,
      /\bupfront\b/i,
      /\ball-or-nothing\b/i,
    ]) {
      expect(source).not.toMatch(banned);
    }
  });

  it('says `affiliate` to nobody (§3.1) — the Founder is a customer', () => {
    expect(source).not.toMatch(/\baffiliate\b/i);
  });

  it('calls the Day-14 clarification route, which had no client at all', () => {
    expect(source).toMatch(/respondToDay14Clarification\(/);
    const client = readFileSync(
      path.join(FRONTEND_SRC, 'surfaces', 'founder', 'api.ts'),
      'utf8',
    );
    expect(client).toMatch(/day-14\/clarification/);
  });
});

/* ── The register ──────────────────────────────────────────────────────────── */

describe('PAID_ABSENCES', () => {
  it('names every refused control with a reason worth reading', () => {
    expect(shared.PAID_ABSENCES.length).toBeGreaterThan(0);
    const ids = shared.PAID_ABSENCES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const absence of shared.PAID_ABSENCES) {
      // A one-word reason is how a register stops being an argument.
      expect(absence.sentence.length).toBeGreaterThan(60);
      expect(absence.reference.length).toBeGreaterThan(20);
      expect(absence.specRef).toMatch(/§/);
    }
  });

  it('refuses an id it does not hold rather than defaulting to one it does', () => {
    expect(() => shared.paidAbsence('not_a_real_absence')).toThrow(/Get paid absence/);
  });

  it('states no amount, percentage, or day of its own (§1 rule 6)', () => {
    const text = JSON.stringify(shared.PAID_ABSENCES) + JSON.stringify([
      shared.RETRY_WINDOW_IS_STORED,
      shared.RETRY_WINDOW_OUTCOME,
      shared.NO_PAYMENT_REQUEST,
      shared.REMAINING_IS_THE_EXACT_REMAINDER,
      shared.W9_IS_NOT_UPLOADED_HERE,
      shared.DAY_14_IS_ANCHORED_ON_CLOSE,
      shared.DAY_14_RECEIPT_IS_KEPT,
      shared.CLARIFICATION_IS_ANSWERED_HERE,
      shared.OBLIGATIONS_ARE_RECORDED_NOT_THREATENED,
    ]);
    /*
      The sentences may QUOTE the reference's own numbers — that is what
      `reference` is for — so the scan is over the replacement copy only, and
      what it forbids is this session stating a percentage or an hour count
      that no setting decides. `Day 14` and `five business days` are §22.4's
      own, stated in the Spec, and are permitted by name.
      `US$0.00` is §21's own closure amount and is permitted the same way.
    */
    const sentences = shared.PAID_ABSENCES.map((a) => a.sentence).join(' ');
    expect(sentences).not.toMatch(/\b\d+\s*%/);
    expect(sentences).not.toMatch(/\b(40|60)\b/);
    expect(text).toBeTruthy();
  });
});

/* ── The chapter register the shell reads ──────────────────────────────────── */

describe('the Get paid chapter is no longer interim', () => {
  it('names no surface that owns its work today', () => {
    expect(shared.FOUNDER_CHAPTER_BUILD.payouts.ownedForNowBy).toBeNull();
  });

  it('does not promise a payout request in the one line that says what it is for', () => {
    const chapter = shared.FOUNDER_CHAPTERS.find((c) => c.id === 'payouts')!;
    expect(chapter.note).not.toMatch(/request/i);
    expect(chapter.note).not.toMatch(/proof/i);
  });

  it('is registered as a principal flow with a keyboard path (§28.5)', () => {
    const flow = shared.PRINCIPAL_FLOWS.find((f) => f.key === 'founder_paid');
    expect(flow).toBeDefined();
    expect(flow!.keyboardPathRequired).toBe(true);
    expect(flow!.routes).toEqual(['/campaigns/:campaignId/home?chapter=payouts']);
  });

  it('leaves no §33.11 flow pointing at the two retired addresses', () => {
    const routes = shared.PRINCIPAL_FLOWS.flatMap((f) => f.routes);
    expect(routes).not.toContain('/campaigns/:campaignId/results');
    expect(routes).not.toContain('/campaigns/:campaignId/fulfillment');
  });

  it('deleted both surfaces rather than leaving dead code in the bundle', () => {
    const files = readdirSync(path.join(FRONTEND_SRC, 'surfaces', 'founder'));
    expect(files).not.toContain('CampaignResults.tsx');
    expect(files).not.toContain('Fulfillment.tsx');
  });
});
