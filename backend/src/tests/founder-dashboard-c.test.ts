/**
 * Founder Dashboard Session C — Chapter 1, Choose.
 *
 * The C5 done-when, minus the parts that are properties of a rendered surface
 * (`founder-dashboard.test.tsx` owns those). What this file drives is the
 * record and the routes: deviation 1's guarantees at the DATABASE, the roster
 * payload's new §14.3 terms, and the things a Founder must not be able to do
 * however they call the API.
 *
 * ── Most of it is about what CANNOT happen ──────────────────────────────────
 * Deviation 1 sits beside three things §30 defers by name, so what keeps it
 * narrow is not anybody's intention — it is a table with no scheduling column,
 * a trigger that refuses a second message, and a route whose body carries one
 * field. Those are the assertions.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq, sql } from 'drizzle-orm';

import { startHarness, type Harness } from './app-harness.js';
import { seedUser, signInPlain } from './admin-session.js';
import { createMemoryStripeGateway } from '../payments/stripe-client.js';
import { campaigns, campaignAffiliateAssociations } from '../db/schema/domain.js';
import { founderProspects, campaignDrafts } from '../db/schema/invitations.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { affiliateProspects } from '../db/schema/affiliates.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import { listingFeePayments } from '../db/schema/listing.js';
import { listingFeeCalculations } from '../db/schema/workspace.js';
import { campaignBuild } from '../db/schema/build.js';
import { founderMeetingRequests } from '../db/schema/meetings.js';
import { notificationDeliveries } from '../db/schema/integrity.js';
import {
  MEETING_REQUEST_CHANGES_NOTHING,
  MEETING_REQUEST_IS_NOT_A_SCHEDULER,
  MEETING_REQUEST_NO_PENALTY,
} from '../affiliates/meeting-logic.js';
import * as shared from '@proovd/shared';

let h: Harness;

/* The §14 routers mount behind `config.stripeGateway` — the listing fee is what
   opens the 72-hour window, so a deployment with no gateway has no Chapter 1. */
const gateway = createMemoryStripeGateway({
  mode: 'test',
  platformWebhookSecret: 'whsec_platform_for_fdc_suite',
  connectWebhookSecret: 'whsec_connect_for_fdc_suite',
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
      authRouteLimit: 1_000_000,
      globalRateLimit: 1_000_000,
    },
    'fdc',
  );
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_SRC = path.join(HERE, '..', '..', '..', 'frontend', 'src');
const SHARED_SRC = path.join(HERE, '..', '..', '..', 'shared', 'src');

/** Comments explain what these files refuse to do; a scan must not read one as a usage. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

/**
 * Drizzle wraps the driver error, so the constraint's own words are on `cause`
 * rather than on the message a bare `rejects.toThrow` reads (Phase 19's helper).
 */
async function expectDbRefusal(work: Promise<unknown>, pattern: RegExp): Promise<void> {
  let caught: unknown = null;
  try {
    await work;
  } catch (error) {
    caught = error;
  }
  expect(caught).not.toBeNull();
  const messages: string[] = [];
  let current: unknown = caught;
  while (current instanceof Error) {
    messages.push(current.message);
    current = current.cause;
  }
  expect(messages.join(' | ')).toMatch(pattern);
}

interface Seeded {
  campaignId: string;
  associationId: string;
  founderId: string;
  founderEmail: string;
  creatorId: string;
  creatorEmail: string;
}

/** One campaign in the 72-hour window, with one recruited Creator on it. */
async function seedChapterOne(label: string, opts: { highEffort?: boolean } = {}): Promise<Seeded> {
  const founder = await seedUser(h, 'founder', `fdc-founder-${label}`);
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
      status: 'affiliate_response_and_build',
      type: 'pre_launch',
      typeLockedAt: new Date(),
      listingPaidAt: new Date(),
      highEffort: opts.highEffort ?? true,
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
    updatedBy: 'user:test',
  });

  // §14.5's exact deadline is stored on the payment, which cannot exist without
  // the §12 calculation it charged for.
  const paidAt = new Date();
  const [calc] = await h.db
    .insert(listingFeeCalculations)
    .values({
      campaignId,
      baseCents: 3_500n,
      itemDiscountCents: 200n,
      maxDiscountCents: 1_000n,
      minSubtotalCents: 2_500n,
      completedItems: 0,
      discountCents: 0n,
      subtotalCents: 3_500n,
      discountLines: [],
      itemsSnapshot: {},
      actor: 'admin:test',
      trigger: 'seed',
      lockedAt: paidAt,
    })
    .returning({ id: listingFeeCalculations.id });
  await h.db.insert(listingFeePayments).values({
    campaignId,
    calculationId: calc!.id,
    mode: 'test',
    checkoutSessionId: `cs_${label}_${randomUUID().slice(0, 10)}`,
    baseCents: 3_500n,
    discountCents: 0n,
    promotionCents: 0n,
    subtotalCents: 3_500n,
    taxCents: 0n,
    totalCents: 3_500n,
    paidAt,
    responseWindowHours: 72,
    responseDeadlineAt: new Date(paidAt.getTime() + 72 * 3_600_000),
    freeCancellationWindowHours: 48,
    freeCancellationDeadlineAt: new Date(paidAt.getTime() + 48 * 3_600_000),
  });

  const creator = await seedUser(h, 'affiliate', `fdc-creator-${label}`);
  const [cp] = await h.db
    .insert(affiliateProspects)
    .values({
      legalName: `Creator ${label}`,
      publicHandle: `@creator-${label}`,
      email: creator.email,
      subtype: 'social_creator',
      audienceNiche: 'workbench',
      audienceSize: '48k',
      adminBio: 'Weekly bench builds.',
      createdBy: 'admin:test',
    })
    .returning({ id: affiliateProspects.id });
  const [assoc] = await h.db
    .insert(campaignAffiliateAssociations)
    .values({
      campaignId,
      affiliateId: randomUUID(),
      prospectId: cp!.id,
      status: 'formal_decision_open',
      rosterMembership: 'initial_roster',
    })
    .returning({ id: campaignAffiliateAssociations.id });
  const associationId = assoc!.id;
  await h.db.insert(affiliateSignupProfiles).values({
    prospectId: cp!.id,
    associationId,
    email: creator.email,
    publicHandle: `@creator-${label}`,
    claimedUserId: creator.id,
    claimedAt: new Date(),
    updatedBy: 'test',
  });

  return {
    campaignId,
    associationId,
    founderId: founder.id,
    founderEmail: founder.email,
    creatorId: creator.id,
    creatorEmail: creator.email,
  };
}

/** `signInPlain` returns the cookie header; every call sets it explicitly. */
const signIn = (email: string) => signInPlain(h, email);

/* ── C1: the roster payload carries §14.3's cell ──────────────────────────── */

describe('C1 — the roster payload, and what bounds a revision', () => {
  it('sends the base, the ceiling, and whether a bid is permitted at all', async () => {
    const s = await seedChapterOne('terms');
    const cookie = await signIn(s.founderEmail);
    const res = await request(h.app)
      .get(`/api/founder/campaigns/${s.campaignId}/roster`)
      .set('Cookie', cookie)
      .expect(200);

    // §14.3's own numbers, read from the §6 settings by `resolveCell`. The
    // surface renders them and decides nothing — a second copy of the matrix in
    // the browser would be a second answer to what the base is.
    expect(res.body.roster.terms).toMatchObject({
      basePercent: 30,
      ceilingPercent: 50,
      bidAllowed: true,
      fixedPaymentAllowed: true,
      highEffort: true,
    });
  });

  it('reports no bid on a standard campaign, so no revision control can render', async () => {
    const s = await seedChapterOne('standard', { highEffort: false });
    const cookie = await signIn(s.founderEmail);
    const res = await request(h.app)
      .get(`/api/founder/campaigns/${s.campaignId}/roster`)
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body.roster.terms.bidAllowed).toBe(false);
  });

  it('the revision range starts ABOVE base and ends at the ceiling', () => {
    // `validateProposalAgainstCell` refuses `bid <= applicableBase` by name and
    // refuses anything past the ceiling. A free slider produces refusals a
    // Founder cannot act on — they lower the number to be reasonable and are
    // told the standard terms already give more. The reference's stepper is
    // bounded 1–90, which offers both refusals.
    expect(shared.revisionRange(30, 50, true)).toEqual({ min: 31, max: 50, available: true });
    expect(shared.revisionRange(30, 50, false).available).toBe(false);
  });

  it('opens one below what the Creator asked for, clamped into the range', () => {
    const range = shared.revisionRange(30, 50, true);
    expect(shared.revisionOpeningValue(range, 44)).toBe(43);
    // Their ask is already at the floor: the opening cannot drop below it.
    expect(shared.revisionOpeningValue(range, 31)).toBe(31);
    // Their ask is past the ceiling: the opening cannot follow it there.
    expect(shared.revisionOpeningValue(range, 90)).toBe(50);
  });

  it('the server refuses a revision at or below base, and one past the ceiling', async () => {
    const s = await seedChapterOne('below');
    const creatorCookie = await signIn(s.creatorEmail);
    const proposed = await request(h.app)
      .post(`/api/creator/campaigns/${s.associationId}/proposals`)
      .set('Cookie', creatorCookie)
      .send({ bidTotalPercent: 44 })
      .expect(200);
    const versionId = proposed.body.proposal.versionId as string;

    const founderCookie = await signIn(s.founderEmail);
    // 30 is the base. §14.2's only downward exit is decline.
    const atBase = await request(h.app)
      .post(`/api/founder/proposals/${versionId}/respond`)
      .set('Cookie', founderCookie)
      .send({ action: 'revise', bidTotalPercent: 30 })
      .expect(422);
    expect(atBase.body.error).toBe('invalid_terms');
    expect(String(atBase.body.whatHappened)).toMatch(/already give/i);

    const overCeiling = await request(h.app)
      .post(`/api/founder/proposals/${versionId}/respond`)
      .set('Cookie', founderCookie)
      .send({ action: 'revise', bidTotalPercent: 90 })
      .expect(422);
    expect(String(overCeiling.body.whatHappened)).toMatch(/never exceeds 50%/i);
  });
});

/* ── C5: no control selects, orders, or sends the roster ──────────────────── */

describe('C5 — the roster is answered, never assembled', () => {
  it('has no Founder route that adds, removes, orders, or sends a roster', async () => {
    const s = await seedChapterOne('noselect');
    const cookie = await signIn(s.founderEmail);
    const base = `/api/founder/campaigns/${s.campaignId}`;

    // §14.5: "Proovd owns recruitment follow-up. The Founder cannot browse or
    // contact a general pool." §30 defers Founder outreach to unmatched
    // Affiliates. `rosterMembership` has two writers and both are Admin — and
    // the reference draws a "Send to affiliates" control.
    const attempts = [
      ['post', `${base}/roster/send`],
      ['post', `${base}/roster/order`],
      ['post', `${base}/roster/${s.associationId}/remove`],
      ['delete', `${base}/roster/${s.associationId}`],
      ['post', `${base}/roster/invite`],
      ['get', '/api/founder/creators'],
      ['get', '/api/founder/creators/search'],
    ] as const;

    for (const [method, url] of attempts) {
      const res = await request(h.app)[method](url).set('Cookie', cookie).send({});
      expect(res.status, `${method.toUpperCase()} ${url}`).toBe(404);
    }
  });

  it('declining a version leaves the Creator on the roster', async () => {
    const s = await seedChapterOne('declineonly');
    const creatorCookie = await signIn(s.creatorEmail);
    const proposed = await request(h.app)
      .post(`/api/creator/campaigns/${s.associationId}/proposals`)
      .set('Cookie', creatorCookie)
      .send({ bidTotalPercent: 44 })
      .expect(200);

    const founderCookie = await signIn(s.founderEmail);
    await request(h.app)
      .post(`/api/founder/proposals/${proposed.body.proposal.versionId}/respond`)
      .set('Cookie', founderCookie)
      .send({ action: 'decline' })
      .expect(200);

    // §14.2 keeps all three outcomes open: the association stays where it is
    // and the Creator can still accept standard terms or counter. The
    // reference's "Reject match" says the Founder removed somebody, which they
    // cannot — `rosterMembership` has two writers and both are Admin.
    const [row] = await h.db
      .select({
        status: campaignAffiliateAssociations.status,
        membership: campaignAffiliateAssociations.rosterMembership,
      })
      .from(campaignAffiliateAssociations)
      .where(eq(campaignAffiliateAssociations.id, s.associationId));
    expect(row!.status).toBe('proposal_pending');
    expect(row!.membership).toBe('initial_roster');

    const roster = await request(h.app)
      .get(`/api/founder/campaigns/${s.campaignId}/roster`)
      .set('Cookie', founderCookie)
      .expect(200);
    expect(roster.body.roster.creators).toHaveLength(1);
  });

  it('the roster card carries none of §11’s withheld facts', async () => {
    const s = await seedChapterOne('boundary');
    const cookie = await signIn(s.founderEmail);
    const res = await request(h.app)
      .get(`/api/founder/campaigns/${s.campaignId}/roster`)
      .set('Cookie', cookie)
      .expect(200);
    const body = JSON.stringify(res.body);

    // The projection is frozen at seven columns. No email, no legal name, no
    // quality tier, no verification evidence, no channel URL — the reference
    // links out to the Creator's own channel and shows three audience metrics
    // where the record holds one, and there is nothing here to build either
    // from. `meetingRequest` is deviation 1's, and holds no contact detail.
    expect(body).not.toContain(s.creatorEmail);
    expect(body).not.toContain('Creator boundary');
    expect(Object.keys(res.body.roster.creators[0]).sort()).toEqual(
      [
        'associationId',
        'audienceMetric',
        'bio',
        'channelType',
        'handle',
        'lockedTerms',
        'meetingRequest',
        'niche',
        'openProposal',
        'statusLabel',
      ].sort(),
    );
  });
});

/* ── C4: deviation 1 ──────────────────────────────────────────────────────── */

describe('C4 — the meeting request is a record, not a scheduler', () => {
  it('holds no scheduling column of any kind', async () => {
    const rows = await h.db.execute(sql`
      SELECT column_name FROM information_schema.columns
       WHERE table_name = 'founder_meeting_requests'
    `);
    const columns = (rows.rows as { column_name: string }[]).map((r) => r.column_name).sort();

    // §30 defers a Founder–Creator meeting scheduler and requires §12's human
    // one; tech-stack §12 makes Cal.com's booking record the source of truth.
    // The absence is what keeps this from becoming a second scheduler — the
    // reference draws three time slots and a "Send meeting invite" button.
    for (const forbidden of [
      'scheduled_for',
      'scheduled_at',
      'starts_at',
      'ends_at',
      'duration',
      'duration_minutes',
      'timezone',
      'platform',
      'meeting_url',
      'join_url',
      'calendar_id',
      'slot',
      'remind_at',
      'recurrence',
    ]) {
      expect(columns, `${forbidden} must not exist`).not.toContain(forbidden);
    }
    expect(columns).toEqual(
      [
        'association_id',
        'campaign_id',
        'created_at',
        'founder_user_id',
        'id',
        'message',
        'requested_at',
        'responded_at',
        'response_note',
        'status',
      ].sort(),
    );
  });

  it('accepts one field and stores one message', async () => {
    const s = await seedChapterOne('ask');
    const cookie = await signIn(s.founderEmail);

    const res = await request(h.app)
      .post(`/api/founder/campaigns/${s.campaignId}/roster/${s.associationId}/meeting`)
      .set('Cookie', cookie)
      // Everything a scheduler would need, offered and ignored: the service
      // reads `message` and nothing else, and no column could hold the rest.
      .send({
        message: 'Ten minutes on how you would introduce this?',
        when: '2026-09-01T10:00:00.000Z',
        slot: 'Tue 10:00',
        durationMinutes: 30,
        platform: 'google_meet',
      })
      .expect(200);

    expect(res.body.meetingRequest.status).toBe('requested');
    const [row] = await h.db
      .select()
      .from(founderMeetingRequests)
      .where(eq(founderMeetingRequests.id, res.body.meetingRequest.id));
    expect(row!.message).toBe('Ten minutes on how you would introduce this?');
    expect(JSON.stringify(row)).not.toContain('Tue 10:00');
    expect(JSON.stringify(row)).not.toContain('google_meet');
  });

  it('cannot hold a second message — asserted at the database, not intended', async () => {
    const s = await seedChapterOne('onemsg');
    const cookie = await signIn(s.founderEmail);
    const created = await request(h.app)
      .post(`/api/founder/campaigns/${s.campaignId}/roster/${s.associationId}/meeting`)
      .set('Cookie', cookie)
      .send({ message: 'The first and only message.' })
      .expect(200);
    const requestId = created.body.meetingRequest.id as string;

    // A second ask while the first is unanswered is refused by the service and
    // by the partial unique index behind it.
    const second = await request(h.app)
      .post(`/api/founder/campaigns/${s.campaignId}/roster/${s.associationId}/meeting`)
      .set('Cookie', cookie)
      .send({ message: 'Actually, one more thing.' })
      .expect(409);
    expect(second.body.error).toBe('already_open');

    // And the message cannot be edited into a thread: the 0056 trigger refuses
    // it even from a hand-written UPDATE.
    await expectDbRefusal(
      h.db.execute(sql`
        UPDATE "founder_meeting_requests" SET "message" = 'rewritten' WHERE "id" = ${requestId}
      `),
      /immutable apart from its response/i,
    );

    // And no messages table beside it. `founder_meeting_notes` is the Admin
    // Founders rebuild's own record (0047) — an Admin's note of a call they had
    // with a Founder, nothing to do with this ask — so it is named rather than
    // matched away, which is what keeps the assertion honest if a third one
    // appears.
    const tables = await h.db.execute(sql`
      SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name LIKE '%meeting%'
       ORDER BY table_name
    `);
    expect((tables.rows as { table_name: string }[]).map((r) => r.table_name)).toEqual([
      'founder_meeting_notes',
      'founder_meeting_requests',
    ]);
  });

  it('refuses a Creator who is not on this campaign, in the service and the trigger', async () => {
    const mine = await seedChapterOne('mine');
    const theirs = await seedChapterOne('theirs');
    const cookie = await signIn(mine.founderEmail);

    const refused = await request(h.app)
      .post(`/api/founder/campaigns/${mine.campaignId}/roster/${theirs.associationId}/meeting`)
      .set('Cookie', cookie)
      .send({ message: 'Hello.' })
      .expect(404);
    expect(refused.body.error).toBe('not_found');

    // The database refuses it regardless of what a service remembered.
    await expectDbRefusal(
      h.db.insert(founderMeetingRequests).values({
        campaignId: mine.campaignId,
        associationId: theirs.associationId,
        founderUserId: mine.founderId,
        message: 'Hand-written.',
      }),
      /not on this campaign/i,
    );
  });

  it('sends exactly one §27 message, deduped on the request row', async () => {
    const s = await seedChapterOne('notify');
    const cookie = await signIn(s.founderEmail);
    const created = await request(h.app)
      .post(`/api/founder/campaigns/${s.campaignId}/roster/${s.associationId}/meeting`)
      .set('Cookie', cookie)
      .send({ message: 'Can we talk?' })
      .expect(200);

    const sent = await h.db
      .select({
        eventKey: notificationDeliveries.eventKey,
        entityType: notificationDeliveries.entityType,
        target: notificationDeliveries.target,
      })
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.entityId, created.body.meetingRequest.id));

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      eventKey: 'affiliate_meeting_request',
      entityType: 'founder_meeting_request',
      target: s.creatorEmail,
    });

    // There is deliberately no response key: the Founder reads the answer on
    // the roster card they are already looking at, and §22.9's three exist
    // because that ask fires after a campaign ended, when nobody is watching.
    const others = await h.db.execute(sql`
      SELECT count(*)::int AS n FROM "notification_deliveries"
       WHERE "event_key" LIKE '%meeting%' AND "event_key" <> 'affiliate_meeting_request'
    `);
    expect((others.rows as { n: number }[])[0]!.n).toBe(0);
  });

  it('the Creator answers once, and the answer moves no terms', async () => {
    const s = await seedChapterOne('answer');
    const founderCookie = await signIn(s.founderEmail);
    const created = await request(h.app)
      .post(`/api/founder/campaigns/${s.campaignId}/roster/${s.associationId}/meeting`)
      .set('Cookie', founderCookie)
      .send({ message: 'Can we talk?' })
      .expect(200);
    const requestId = created.body.meetingRequest.id as string;

    const [before] = await h.db
      .select()
      .from(campaignAffiliateAssociations)
      .where(eq(campaignAffiliateAssociations.id, s.associationId));

    const creatorCookie = await signIn(s.creatorEmail);
    const waiting = await request(h.app)
      .get('/api/creator/meeting-requests')
      .set('Cookie', creatorCookie)
      .expect(200);
    expect(waiting.body.meetingRequests).toHaveLength(1);

    const answered = await request(h.app)
      .post(`/api/creator/meeting-requests/${requestId}/respond`)
      .set('Cookie', creatorCookie)
      .send({ answer: 'accepted', note: 'Happy to.' })
      .expect(200);
    expect(answered.body.meetingRequest.status).toBe('accepted');

    // A second answer is refused: §22.9's finality, and the trigger behind it.
    const again = await request(h.app)
      .post(`/api/creator/meeting-requests/${requestId}/respond`)
      .set('Cookie', creatorCookie)
      .send({ answer: 'declined' })
      .expect(409);
    expect(again.body.error).toBe('already_answered');

    // Nothing about the relationship moved. Agreeing to talk is agreeing to
    // talk — §14.2's three responses are the only things that change a number.
    const [after] = await h.db
      .select()
      .from(campaignAffiliateAssociations)
      .where(eq(campaignAffiliateAssociations.id, s.associationId));
    expect(after).toEqual(before);
  });

  it('another Creator’s request answers not_found, exactly as a missing one does', async () => {
    const mine = await seedChapterOne('theirsreq');
    const other = await seedChapterOne('otherreq');
    const founderCookie = await signIn(mine.founderEmail);
    const created = await request(h.app)
      .post(`/api/founder/campaigns/${mine.campaignId}/roster/${mine.associationId}/meeting`)
      .set('Cookie', founderCookie)
      .send({ message: 'Can we talk?' })
      .expect(200);

    const intruder = await signIn(other.creatorEmail);
    const refused = await request(h.app)
      .post(`/api/creator/meeting-requests/${created.body.meetingRequest.id}/respond`)
      .set('Cookie', intruder)
      .send({ answer: 'accepted' })
      .expect(404);
    const missing = await request(h.app)
      .post(`/api/creator/meeting-requests/${randomUUID()}/respond`)
      .set('Cookie', intruder)
      .send({ answer: 'accepted' })
      .expect(404);
    expect(refused.body).toEqual(missing.body);
  });

  it('has no scheduling word in its own source', () => {
    const source = ['meeting-requests.ts', 'meeting-notifications.ts']
      .map((f) => readFileSync(path.join(HERE, '..', 'affiliates', f), 'utf8'))
      .map(stripComments)
      .join('\n');
    for (const forbidden of ['scheduledFor', 'startsAt', 'durationMinutes', 'calendarId', 'slot']) {
      expect(source, `${forbidden} must not appear`).not.toContain(forbidden);
    }
  });
});

/* ── The backend's restated sentences ─────────────────────────────────────── */

describe('the restated copy does not drift', () => {
  it('matches shared, word for word', () => {
    expect(MEETING_REQUEST_IS_NOT_A_SCHEDULER).toBe(shared.MEETING_REQUEST_IS_NOT_A_SCHEDULER);
    expect(MEETING_REQUEST_NO_PENALTY).toBe(shared.MEETING_REQUEST_NO_PENALTY);
    expect(MEETING_REQUEST_CHANGES_NOTHING).toBe(shared.MEETING_REQUEST_CHANGES_NOTHING);
  });

  it('restates only what a MESSAGE renders', () => {
    const logic = readFileSync(path.join(HERE, '..', 'affiliates', 'meeting-logic.ts'), 'utf8');
    // The absence register, the revision kernel and the bonus copy are
    // surface-side and reach the browser through Vite. A second copy of an
    // argument is how the two versions come to disagree.
    expect(logic).not.toContain('CHOOSE_ABSENCES');
    expect(logic).not.toContain('revisionRange');
    expect(logic).not.toContain('BONUS_');
  });
});

/* ── §14.3's own register, and §3's vocabulary ────────────────────────────── */

describe('the Choose register', () => {
  it('names exactly §14.3’s two trigger units, and no time window', () => {
    // §14.3: "Each uses only that Creator's successfully captured, validly
    // attributed, pre-tax reward subtotal or unique captured attributed-Backer
    // count." The reference adds "When should it count? — 3 days / 1 week / By
    // campaign end", which is a third rule with no column behind it.
    expect(shared.BONUS_TRIGGER_UNITS.map((u) => u.id).sort()).toEqual([
      'attributed_subtotal_cents',
      'unique_attributed_backers',
    ]);
  });

  it('has no period column on the bonus record', async () => {
    const rows = await h.db.execute(sql`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'creator_bonuses'
    `);
    const columns = (rows.rows as { column_name: string }[]).map((r) => r.column_name);
    for (const forbidden of ['period', 'window_days', 'counts_until', 'expires_at']) {
      expect(columns, `${forbidden} must not exist`).not.toContain(forbidden);
    }
  });

  it('every absence names what it refuses and why', () => {
    expect(shared.CHOOSE_ABSENCES.length).toBeGreaterThan(0);
    for (const absence of shared.CHOOSE_ABSENCES) {
      expect(absence.reference.length, absence.id).toBeGreaterThan(20);
      // A one-word reason is how a register stops being an argument.
      expect(absence.sentence.length, absence.id).toBeGreaterThan(60);
      expect(absence.specRef, absence.id).toMatch(/§/);
    }
    // Every id is unique, so a test can walk the register against the surface.
    const ids = shared.CHOOSE_ABSENCES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('§3.1 and §3.2 in Chapter 1’s own copy', () => {
  it('the shared register and the chapter carry no banned term', () => {
    const files = [
      path.join(SHARED_SRC, 'founder-dashboard', 'choose.ts'),
      path.join(FRONTEND_SRC, 'surfaces', 'founder', 'chapters', 'ChooseChapter.tsx'),
    ];
    for (const file of files) {
      // Comments quote the reference's wording in order to refuse it, and the
      // refusals are the more valuable half. What must not appear is the word
      // in copy a person reads.
      const rendered = stripComments(readFileSync(file, 'utf8'));
      for (const banned of [
        // §3.1: `affiliate` is customer-facing-banned and a Founder is a
        // customer. The reference uses it 42 times.
        /\baffiliate\b/i,
        // §3.2, identifiers included — §33.11.3 reads the built bundle, where a
        // prop name survives minification. Fourth reference in a row for both.
        /\bupfront\b/i,
        /\bgoal\b/i,
        /\bpledge\b/i,
        /\breservation\b/i,
        /\bpre-?build\b/i,
        /\bpre-?launch\b/i,
        // §30 defers public leaderboards; the reference puts "is leading" in an h1.
        /\bleaderboard\b/i,
      ]) {
        expect(rendered, `${banned} in ${path.basename(file)}`).not.toMatch(banned);
      }
    }
  });

  it('offers no ranking anywhere in the roster payload', async () => {
    const s = await seedChapterOne('nostanding');
    const cookie = await signIn(s.founderEmail);
    const res = await request(h.app)
      .get(`/api/founder/campaigns/${s.campaignId}/roster`)
      .set('Cookie', cookie)
      .expect(200);
    const body = JSON.stringify(res.body);
    // §30 defers public leaderboards; the Creator close view already ships with
    // no rank on that basis, and the reference puts "${name} is leading." in an
    // h1. Word-bounded, because a random id or a seeded handle can contain any
    // four letters — the Tasks panel's own rule for the same class of scan.
    for (const term of ['leading', 'leaderboard', 'rank', 'ranked', 'position', 'top performer']) {
      expect(body, `${term} in the roster payload`).not.toMatch(
        new RegExp(`\\b${term.replace(/ /g, '\\s+')}\\b`, 'i'),
      );
    }
  });
});
