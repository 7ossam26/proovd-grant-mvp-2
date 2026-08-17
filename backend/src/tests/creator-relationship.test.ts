/**
 * One campaign relationship, driven over real HTTP — Spec §14, §16, §17, §18,
 * §22.1, §24.3, §24.4, §24.7, §26.1, §33.12.5.
 *
 * The composer reads eleven tables and writes none of them, so what is asserted
 * here is that the READ is honest:
 *
 *   · an unpopulated pane says what it is waiting for rather than showing zero;
 *   · a conversion over zero clicks is null, never 0%;
 *   · an Idea campaign's fixed-Creator-payment block states the rule instead of an empty
 *     slot, and there is no path to an allocation on one;
 *   · a link pause writes the three pause columns and never the activation
 *     instant, so clicks already in the ledger are not re-decided;
 *   · the read is addressed by BOTH ids, and a mismatched pair answers the same
 *     404 an unknown one does.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';

import { startHarness, type Harness } from './app-harness.js';
import { createAdmin, type AdminSession } from './admin-session.js';
import { seedAdminReauthWindow } from '../settings/service.js';

import { auditEvents } from '../db/schema/integrity.js';
import { trackingLinks, associationCompensationAgreements } from '../db/schema/decisions.js';
import { campaignAffiliateAssociations, campaigns } from '../db/schema/domain.js';
import { associationTerminationRequests } from '../db/schema/creator-workspace.js';
import { midCampaignAdditions } from '../db/schema/live-editing.js';
import { CREATOR_LINK_PAUSED } from '../affiliates/workspace/audit-actions.js';
import type { CreatorRelationshipDetail } from '../affiliates/workspace/relationship.js';

let h: Harness;
let admin: AdminSession;
let staleAdmin: AdminSession;

beforeAll(async () => {
  h = await startHarness({}, 'creator-relationship');
  admin = await createAdmin(h, 'rel-admin');
  await seedAdminReauthWindow(h.db, 3600);
  staleAdmin = await createAdmin(h, 'rel-stale-admin');
  await h.pool.query(`UPDATE session SET created_at = now() - interval '2 days' WHERE user_id = $1`, [
    staleAdmin.id,
  ]);
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

/* ── helpers ──────────────────────────────────────────────────────────────── */

async function createCampaign(label: string): Promise<string> {
  const res = await request(h.app)
    .post('/api/admin/founders')
    .set('cookie', admin.cookie)
    .send({
      legalName: `Founder ${label}`,
      preferredName: label,
      email: `${label}-${randomUUID()}@example.com`,
      productName: `Product ${label}`,
    })
    .expect(201);
  return (res.body as { campaignId: string }).campaignId;
}

async function recruit(
  campaignId: string,
  label: string,
): Promise<{ prospectId: string; associationId: string }> {
  const res = await request(h.app)
    .post('/api/admin/affiliates')
    .set('cookie', admin.cookie)
    .send({
      legalName: `Rowan ${label}`,
      publicHandle: '@rowan.builds',
      email: `${label}-${randomUUID()}@example.com`,
      channelReference: 'https://instagram.com/rowan.builds',
      audienceNiche: 'Clinic operations',
      permissionBasis: 'Sole operator of the account.',
      adminBio: 'Posts weekly.',
      recruitmentSource: 'Newsletter.',
      recruitingAdmin: 'Ada Admin',
      subtype: 'social_creator',
      campaignId,
    })
    .expect(201);
  return res.body as { prospectId: string; associationId: string };
}

async function readRelationship(
  prospectId: string,
  associationId: string,
): Promise<CreatorRelationshipDetail> {
  const res = await request(h.app)
    .get(`/api/admin/creators/${prospectId}/relationships/${associationId}`)
    .set('cookie', admin.cookie)
    .expect(200);
  return res.body as CreatorRelationshipDetail;
}

/** §14.2 mints the link at acceptance, INACTIVE. Phase 17 activates it. */
async function mintLink(associationId: string, campaignId: string, active: boolean) {
  const [link] = await h.db
    .insert(trackingLinks)
    .values({
      associationId,
      campaignId,
      code: randomUUID().slice(0, 12),
      active,
      ...(active ? { activatedAt: new Date() } : {}),
    })
    .returning();
  return link!;
}

/* ── The read ─────────────────────────────────────────────────────────────── */

describe('§26.1 — the relationship read composes four panes from records', () => {
  it('names the campaign type first, and the campaign by its composed name', async () => {
    const campaignId = await createCampaign('band');
    const { prospectId, associationId } = await recruit(campaignId, 'band');

    const detail = await readRelationship(prospectId, associationId);
    expect(detail.band.campaignName).toBe('Product band');
    expect(detail.band.designation).toBe('Initial launch roster');
    // §23.4's state in Admin's one-to-one vocabulary, never the raw enum.
    expect(detail.band.status).toBe('Prospect · not invited');
    expect(detail.band.statusRaw).toBe('prospect');
  });

  it('says what each unpopulated pane is waiting for, and never shows a zero', async () => {
    const campaignId = await createCampaign('waiting');
    const { prospectId, associationId } = await recruit(campaignId, 'waiting');

    const detail = await readRelationship(prospectId, associationId);

    // §16a's rule, three times over.
    expect(detail.money.earnings.populated).toBe(false);
    expect(detail.money.earnings.waitingOn).toContain('nothing has been earned');
    expect(detail.money.transfer.populated).toBe(false);
    expect(detail.money.transfer.waitingOn).toContain('Day 3');
    expect(detail.content.performance.populated).toBe(false);
    expect(detail.content.performance.waitingOn).toContain('not been activated');

    // And the hero says which, rather than reading as "earned nothing".
    expect(detail.money.headline.label).toBe('Estimated');
    expect(detail.money.headline.owner).toContain('after campaign close');
  });

  it('offers no attribution numbers at all before the link is activated', async () => {
    const campaignId = await createCampaign('inactive-link');
    const { prospectId, associationId } = await recruit(campaignId, 'inactive-link');
    await mintLink(associationId, campaignId, false);

    const detail = await readRelationship(prospectId, associationId);
    expect(detail.overview.link?.state).toBe('inactive');
    // §18: a click before activation earns nothing, so there is nothing to show
    // — and a `0` here would read as "nobody clicked".
    expect(detail.content.performance.value).toBeNull();
  });

  it('reports a conversion of null rather than 0% over zero clicks', async () => {
    const campaignId = await createCampaign('conversion');
    const { prospectId, associationId } = await recruit(campaignId, 'conversion');
    await mintLink(associationId, campaignId, true);

    const detail = await readRelationship(prospectId, associationId);
    expect(detail.content.performance.populated).toBe(true);
    expect(detail.content.performance.value?.clicks).toBe(0);
    // §16a applied to a rate: a rate over an empty denominator is not 0%.
    expect(detail.content.performance.value?.conversion).toBeNull();
  });

  it('carries the §14.1 safe-test link, and it is a different URL', async () => {
    const campaignId = await createCampaign('safe-test');
    const { prospectId, associationId } = await recruit(campaignId, 'safe-test');
    const link = await mintLink(associationId, campaignId, true);

    const detail = await readRelationship(prospectId, associationId);
    expect(detail.overview.link?.url).toContain(`/c/${link.code}`);
    expect(detail.overview.link?.testUrl).toContain('proovd_link_test=1');
    expect(detail.overview.link?.testUrl).not.toBe(detail.overview.link?.url);
  });

  it('derives §16 readiness rather than reading a stored checklist', async () => {
    const campaignId = await createCampaign('readiness');
    const { prospectId, associationId } = await recruit(campaignId, 'readiness');

    const detail = await readRelationship(prospectId, associationId);
    expect(detail.overview.readiness).not.toBeNull();
    // Thirteen items, and all-or-nothing: a fresh relationship clears none.
    expect(detail.overview.readiness!.items).toHaveLength(13);
    expect(detail.overview.readiness!.canBeginWork).toBe(false);
    // Every item names its owner, so "who is blocking this" is answerable.
    for (const item of detail.overview.readiness!.items) {
      expect(['admin', 'founder', 'proovd', 'creator']).toContain(item.owner);
      expect(item.label).not.toContain('_');
    }
  });
});

/* ── §14.3's Product-only fixed Creator payment ─────────────────────────────────────── */

describe('§14.3, §24.7 — the fixed Creator payment states its rule rather than an empty slot', () => {
  it('reports it unavailable on an Idea campaign, with the reason', async () => {
    const campaignId = await createCampaign('idea');
    // §9 locks the type at vetting submission, and the `campaigns_type_lock_pair`
    // CHECK refuses a type with no lock instant. Setting both is what the
    // submission does, so it is what the fixture does.
    await h.db
      .update(campaigns)
      .set({ type: 'pre_build', typeLockedAt: new Date() })
      .where(eq(campaigns.id, campaignId));
    const { prospectId, associationId } = await recruit(campaignId, 'idea');

    const detail = await readRelationship(prospectId, associationId);
    expect(detail.agreement.fixedPayment.available).toBe(false);
    expect(detail.agreement.fixedPayment.rule).toContain('unavailable on Idea Campaigns');
    expect(detail.agreement.fixedPayment.status).toBe('Not available');
    // §3.1: the raw type never reaches the surface.
    expect(detail.band.campaignType).toBe('Idea Campaign');
  });

  it('reports it available on a Product campaign, awaiting an agreement', async () => {
    const campaignId = await createCampaign('product');
    await h.db
      .update(campaigns)
      .set({ type: 'pre_launch', typeLockedAt: new Date() })
      .where(eq(campaigns.id, campaignId));
    const { prospectId, associationId } = await recruit(campaignId, 'product');

    const detail = await readRelationship(prospectId, associationId);
    expect(detail.agreement.fixedPayment.available).toBe(true);
    expect(detail.agreement.fixedPayment.rule).toContain('Product Campaigns only');
    expect(detail.band.campaignType).toBe('Product Campaign');
  });

  it('says no version has been accepted when none has', async () => {
    const campaignId = await createCampaign('no-terms');
    const { prospectId, associationId } = await recruit(campaignId, 'no-terms');

    const detail = await readRelationship(prospectId, associationId);
    expect(detail.agreement.lockState).toBe('No accepted version');
    expect(detail.agreement.headlinePercent).toBeNull();
    expect(detail.agreement.agreement).toBeNull();
    expect(detail.agreement.versions).toHaveLength(0);
  });
});

/* ── The link control ─────────────────────────────────────────────────────── */

describe('§17, §18 — pausing a link stops attribution and re-decides nothing', () => {
  it('writes the three pause columns and never the activation instant', async () => {
    const campaignId = await createCampaign('pause');
    const { prospectId, associationId } = await recruit(campaignId, 'pause');
    const link = await mintLink(associationId, campaignId, true);
    const activatedAt = link.activatedAt;

    await request(h.app)
      .post(`/api/admin/creators/${prospectId}/relationships/${associationId}/link`)
      .set('cookie', admin.cookie)
      .send({ action: 'pause', reason: 'Reviewing a disclosed conflict.' })
      .expect(200);

    const [after] = await h.db
      .select()
      .from(trackingLinks)
      .where(eq(trackingLinks.id, link.id));

    expect(after!.pausedAt).not.toBeNull();
    expect(after!.pausedReason).toBe('Reviewing a disclosed conflict.');
    // §18 decides every click against `activated_at`. Moving it would silently
    // re-decide clicks that are already in the ledger.
    expect(after!.activatedAt?.toISOString()).toBe(activatedAt?.toISOString());
    expect(after!.active).toBe(link.active);
    expect(after!.code).toBe(link.code);
  });

  it('refuses a pause with no reason, and a second pause', async () => {
    const campaignId = await createCampaign('pause-twice');
    const { prospectId, associationId } = await recruit(campaignId, 'pause-twice');
    await mintLink(associationId, campaignId, true);

    const noReason = await request(h.app)
      .post(`/api/admin/creators/${prospectId}/relationships/${associationId}/link`)
      .set('cookie', admin.cookie)
      .send({ action: 'pause' })
      .expect(422);
    expect((noReason.body as { whatHappened: string }).whatHappened).toContain('Say why');

    await request(h.app)
      .post(`/api/admin/creators/${prospectId}/relationships/${associationId}/link`)
      .set('cookie', admin.cookie)
      .send({ action: 'pause', reason: 'First.' })
      .expect(200);

    const again = await request(h.app)
      .post(`/api/admin/creators/${prospectId}/relationships/${associationId}/link`)
      .set('cookie', admin.cookie)
      .send({ action: 'pause', reason: 'Second.' })
      .expect(422);
    expect((again.body as { whatHappened: string }).whatHappened).toContain('already paused');
  });

  it('records the §25.6 row with the prior state read from the row', async () => {
    const campaignId = await createCampaign('pause-audit');
    const { prospectId, associationId } = await recruit(campaignId, 'pause-audit');
    await mintLink(associationId, campaignId, true);

    await request(h.app)
      .post(`/api/admin/creators/${prospectId}/relationships/${associationId}/link`)
      .set('cookie', admin.cookie)
      .send({ action: 'pause', reason: 'Reviewing the post.' })
      .expect(200);

    const [row] = await h.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, CREATOR_LINK_PAUSED),
          eq(auditEvents.targetId, associationId),
        ),
      );

    expect(row).toBeTruthy();
    expect(row!.priorValue).toEqual({ paused: false, reason: null });
    expect(row!.newValue).toEqual({ paused: true, reason: 'Reviewing the post.' });
  });

  it('does not move the association — a paused link is not a sanction', async () => {
    const campaignId = await createCampaign('not-a-sanction');
    const { prospectId, associationId } = await recruit(campaignId, 'not-a-sanction');
    await mintLink(associationId, campaignId, true);

    const [before] = await h.db
      .select()
      .from(campaignAffiliateAssociations)
      .where(eq(campaignAffiliateAssociations.id, associationId));

    await request(h.app)
      .post(`/api/admin/creators/${prospectId}/relationships/${associationId}/link`)
      .set('cookie', admin.cookie)
      .send({ action: 'pause', reason: 'Reviewing.' })
      .expect(200);

    const [after] = await h.db
      .select()
      .from(campaignAffiliateAssociations)
      .where(eq(campaignAffiliateAssociations.id, associationId));

    // §29's enforcement action is a separate record with five customer-facing
    // statement fields and an appeal window. Collapsing the two would let a
    // link pause quietly become a sanction with no statement.
    expect(after!.status).toBe(before!.status);
    expect(after!.updatedAt.toISOString()).toBe(before!.updatedAt.toISOString());
  });

  it('reactivates, clearing all three pause columns', async () => {
    const campaignId = await createCampaign('reactivate');
    const { prospectId, associationId } = await recruit(campaignId, 'reactivate');
    const link = await mintLink(associationId, campaignId, true);

    await request(h.app)
      .post(`/api/admin/creators/${prospectId}/relationships/${associationId}/link`)
      .set('cookie', admin.cookie)
      .send({ action: 'pause', reason: 'Reviewing.' })
      .expect(200);
    await request(h.app)
      .post(`/api/admin/creators/${prospectId}/relationships/${associationId}/link`)
      .set('cookie', admin.cookie)
      .send({ action: 'reactivate' })
      .expect(200);

    const [after] = await h.db
      .select()
      .from(trackingLinks)
      .where(eq(trackingLinks.id, link.id));
    expect(after!.pausedAt).toBeNull();
    expect(after!.pausedReason).toBeNull();
    expect(after!.pausedBy).toBeNull();
  });
});

/* ── Authorization ────────────────────────────────────────────────────────── */

describe('§33.12.5 — the relationship routes hold the boundary', () => {
  it('answers the same 404 for a mismatched prospect/association pair', async () => {
    const first = await createCampaign('pair-a');
    const second = await createCampaign('pair-b');
    const a = await recruit(first, 'pair-a');
    const b = await recruit(second, 'pair-b');

    // The address carries both ids, so it can carry a pair that does not belong
    // together. Answering differently would make the URL a way to confirm which
    // Affiliate an association belongs to.
    const mismatched = await request(h.app)
      .get(`/api/admin/creators/${a.prospectId}/relationships/${b.associationId}`)
      .set('cookie', admin.cookie)
      .expect(404);
    const unknown = await request(h.app)
      .get(`/api/admin/creators/${a.prospectId}/relationships/${randomUUID()}`)
      .set('cookie', admin.cookie)
      .expect(404);
    expect(mismatched.body).toEqual(unknown.body);
  });

  it('refuses an anonymous caller on the read and the link control', async () => {
    const campaignId = await createCampaign('anon-rel');
    const { prospectId, associationId } = await recruit(campaignId, 'anon-rel');

    await request(h.app)
      .get(`/api/admin/creators/${prospectId}/relationships/${associationId}`)
      .expect(401);
    await request(h.app)
      .post(`/api/admin/creators/${prospectId}/relationships/${associationId}/link`)
      .send({ action: 'pause', reason: 'x' })
      .expect(401);
  });

  it('refuses a two-day-old Admin session on the link control, and not on the read', async () => {
    const campaignId = await createCampaign('stale-rel');
    const { prospectId, associationId } = await recruit(campaignId, 'stale-rel');
    await mintLink(associationId, campaignId, true);

    // Reading is ordinary work. Making an Admin reauthenticate to look at a
    // record teaches them to reauthenticate reflexively (`admin.ts`, Phase 06a).
    await request(h.app)
      .get(`/api/admin/creators/${prospectId}/relationships/${associationId}`)
      .set('cookie', staleAdmin.cookie)
      .expect(200);

    // Pausing decides whether traffic can become money.
    await request(h.app)
      .post(`/api/admin/creators/${prospectId}/relationships/${associationId}/link`)
      .set('cookie', staleAdmin.cookie)
      .send({ action: 'pause', reason: 'Reviewing.' })
      .expect(403);
  });
});

/* ── The Session C records (migration 0048), driven over real HTTP ────────── */

describe('§22.4 idiom, §14.2, §24.8, §29 — the Session C relationship records', () => {
  /** An accepted standard-terms agreement, so a deliverable has something to restate. */
  async function acceptStandardTerms(associationId: string, campaignId: string) {
    await h.db.insert(associationCompensationAgreements).values({
      associationId,
      campaignId,
      source: 'standard_terms',
      basePercent: 30,
      bidIncreasePercent: 0,
      totalPercent: 30,
      affiliateAcceptedAt: new Date(),
      founderAcceptedAt: new Date(),
    });
  }

  it('refuses a deliverable with no accepted agreement to restate (§1 rule 6)', async () => {
    const campaignId = await createCampaign('dlv-none');
    const { prospectId, associationId } = await recruit(campaignId, 'dlv-none');

    const before = await readRelationship(prospectId, associationId);
    expect(before.deliverables.canRecord).toBe(false);
    expect(before.deliverables.sourceLabel).toBeNull();

    const res = await request(h.app)
      .post(`/api/admin/creators/${prospectId}/relationships/${associationId}/deliverables`)
      .set('cookie', admin.cookie)
      .send({ title: 'Launch post' })
      .expect(422);
    expect((res.body as { whatHappened: string }).whatHappened).toContain('nothing for a');
  });

  it('records, receipts, and decides a deliverable — the receipts ungated, the decision gated', async () => {
    const campaignId = await createCampaign('dlv');
    const { prospectId, associationId } = await recruit(campaignId, 'dlv');
    await acceptStandardTerms(associationId, campaignId);

    // Recording restates the agreement — UNGATED, so a stale session works,
    // and the source is computed from the record, never the body.
    const recorded = await request(h.app)
      .post(`/api/admin/creators/${prospectId}/relationships/${associationId}/deliverables`)
      .set('cookie', staleAdmin.cookie)
      .send({ title: 'Launch post on the approved channel', source: 'A FORGED SOURCE' })
      .expect(200);
    const afterRecord = recorded.body as CreatorRelationshipDetail;
    expect(afterRecord.deliverables.items).toHaveLength(1);
    const deliverable = afterRecord.deliverables.items[0]!;
    expect(deliverable.source).toBe('Standard terms acceptance');
    expect(deliverable.state).toBe('pending');
    expect(deliverable.stateLabel).toBe('Waiting on Affiliate');

    // The evidence receipt — a new insert-only row, still ungated.
    const receipted = await request(h.app)
      .post(
        `/api/admin/creators/${prospectId}/relationships/${associationId}/deliverables/${deliverable.id}/evidence`,
      )
      .set('cookie', staleAdmin.cookie)
      .send({ reference: 'https://instagram.com/p/launch-post' })
      .expect(200);
    const afterReceipt = receipted.body as CreatorRelationshipDetail;
    expect(afterReceipt.deliverables.items[0]!.state).toBe('evidence_submitted');

    // The DECISION is the trail §22.8's completion criterion reads — gated.
    await request(h.app)
      .post(
        `/api/admin/creators/${prospectId}/relationships/${associationId}/deliverables/${deliverable.id}/decision`,
      )
      .set('cookie', staleAdmin.cookie)
      .send({ outcome: 'verified', findings: 'The post is live and matches the agreed work.' })
      .expect(403);

    const decided = await request(h.app)
      .post(
        `/api/admin/creators/${prospectId}/relationships/${associationId}/deliverables/${deliverable.id}/decision`,
      )
      .set('cookie', admin.cookie)
      .send({ outcome: 'verified', findings: 'The post is live and matches the agreed work.' })
      .expect(200);
    const afterDecision = decided.body as CreatorRelationshipDetail;
    expect(afterDecision.deliverables.items[0]!.state).toBe('verified');
    expect(afterDecision.deliverables.resolved).toBe(1);
  });

  it('ties the waiver to its named recorder and reason, in both directions', async () => {
    const campaignId = await createCampaign('dlv-waiver');
    const { prospectId, associationId } = await recruit(campaignId, 'dlv-waiver');
    await acceptStandardTerms(associationId, campaignId);

    const recorded = await request(h.app)
      .post(`/api/admin/creators/${prospectId}/relationships/${associationId}/deliverables`)
      .set('cookie', admin.cookie)
      .send({ title: 'Story-format follow-up' })
      .expect(200);
    const deliverableId = (recorded.body as CreatorRelationshipDetail).deliverables.items[0]!.id;
    const decideUrl = `/api/admin/creators/${prospectId}/relationships/${associationId}/deliverables/${deliverableId}/decision`;

    // A waiver with no named recorder is a decision nobody made.
    const noName = await request(h.app)
      .post(decideUrl)
      .set('cookie', admin.cookie)
      .send({ outcome: 'waived', findings: 'The Founder released this item.' })
      .expect(422);
    expect((noName.body as { whatHappened: string }).whatHappened).toContain('named person');

    // A verified decision cannot smuggle one.
    await request(h.app)
      .post(decideUrl)
      .set('cookie', admin.cookie)
      .send({
        outcome: 'verified',
        findings: 'Fine.',
        waiverRecordedBy: 'Ada Admin',
        waiverReason: 'n/a',
      })
      .expect(422);

    const waived = await request(h.app)
      .post(decideUrl)
      .set('cookie', admin.cookie)
      .send({
        outcome: 'waived',
        findings: 'The Founder released this item after the format change.',
        waiverRecordedBy: 'Founder — recorded by Ada Admin',
        waiverReason: 'The story format replaced it, by agreement.',
      })
      .expect(200);
    const item = (waived.body as CreatorRelationshipDetail).deliverables.items[0]!;
    expect(item.state).toBe('waived');
    expect(item.stateLabel).toBe('Founder/Admin waiver');
    expect(item.latestDecision?.waiverRecordedBy).toContain('Ada Admin');
  });

  it('composes the availability term from records and stores it verbatim (gap 2)', async () => {
    const campaignId = await createCampaign('avail');
    const { prospectId, associationId } = await recruit(campaignId, 'avail');

    const before = await readRelationship(prospectId, associationId);
    // §20's own obligation sentence — the register's, never typed on a surface.
    expect(before.availability.term).toContain(
      'available for the agreed campaign and availability period',
    );
    expect(before.availability.latest).toBeNull();

    // The check is a recorded judgement §22.8 reads — gated.
    await request(h.app)
      .post(`/api/admin/creators/${prospectId}/relationships/${associationId}/availability`)
      .set('cookie', staleAdmin.cookie)
      .send({ available: true, detail: 'Checked the live post URL.' })
      .expect(403);

    const checked = await request(h.app)
      .post(`/api/admin/creators/${prospectId}/relationships/${associationId}/availability`)
      .set('cookie', admin.cookie)
      .send({ available: true, detail: 'Checked the live post URL against the campaign period.' })
      .expect(200);
    const availability = (checked.body as CreatorRelationshipDetail).availability;
    expect(availability.latest?.available).toBe(true);
    expect(availability.latest?.termChecked).toBe(before.availability.term);
    expect(availability.checks).toBe(1);
  });

  it('uses the frozen mid-campaign sentence as the term for a mid-campaign Creator', async () => {
    const campaignId = await createCampaign('avail-mid');
    const { prospectId, associationId } = await recruit(campaignId, 'avail-mid');
    await h.db.insert(midCampaignAdditions).values({
      associationId,
      campaignId,
      campaignCloseAt: new Date(Date.now() + 9 * 86_400_000),
      remainingHours: 216,
      adjustedDeliverables: 'One launch post within the remaining nine days.',
      openedBy: 'user:test',
    });

    const detail = await readRelationship(prospectId, associationId);
    expect(detail.availability.term).toBe('One launch post within the remaining nine days.');
    expect(detail.availability.termSource).toContain('Mid-campaign');
  });

  it('records a mediation note, and the table has no acceptance column to write', async () => {
    const campaignId = await createCampaign('mediate');
    const { prospectId, associationId } = await recruit(campaignId, 'mediate');

    // UNGATED — what Admin told the parties decides nothing.
    const res = await request(h.app)
      .post(`/api/admin/creators/${prospectId}/relationships/${associationId}/mediation-note`)
      .set('cookie', staleAdmin.cookie)
      .send({ note: 'Clarified that the base percentage excludes sales tax.' })
      .expect(200);
    expect((res.body as CreatorRelationshipDetail).mediationNotes).toHaveLength(1);

    // Admin mediates and never agrees — structurally: no column could hold an answer.
    const { rows } = await h.pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'proposal_mediation_notes'`,
    );
    const columns = rows.map((row: { column_name: string }) => row.column_name);
    for (const forbidden of ['acceptance', 'accepted', 'outcome', 'decision', 'decided_by']) {
      expect(columns).not.toContain(forbidden);
    }
  });

  it('refuses a money treatment the §24.8 cause does not permit — by name, and by CHECK', async () => {
    const campaignId = await createCampaign('term-matrix');
    const { prospectId, associationId } = await recruit(campaignId, 'term-matrix');

    // §33.9.3's most tempting wrong simplification, unrepresentable here too.
    const res = await request(h.app)
      .post(`/api/admin/creators/${prospectId}/relationships/${associationId}/termination-request`)
      .set('cookie', admin.cookie)
      .send({
        reason: 'The Founder wants out.',
        effectiveAt: new Date().toISOString(),
        cause: 'founder_or_product',
        moneyTreatment: 'cancel_unpaid_invalid',
        receivedVia: 'Email from the Founder.',
      })
      .expect(422);
    expect((res.body as { whatHappened: string }).whatHappened).toContain('§24.8');

    // The database refuses regardless of the service.
    await expect(
      h.db.insert(associationTerminationRequests).values({
        associationId,
        reason: 'Hand-written.',
        effectiveAt: new Date(),
        cause: 'founder_or_product',
        moneyTreatment: 'cancel_unpaid_invalid',
        receivedVia: 'A script.',
        requestedAt: new Date(),
        recordedBy: 'user:test',
      }),
    ).rejects.toThrow();
  });

  it('holds one open ask per relationship, and the decision is write-once', async () => {
    const campaignId = await createCampaign('term');
    const { prospectId, associationId } = await recruit(campaignId, 'term');
    const url = `/api/admin/creators/${prospectId}/relationships/${associationId}/termination-request`;

    // Recording the ask is UNGATED — the §29.1-disclosure posture.
    const recorded = await request(h.app)
      .post(url)
      .set('cookie', staleAdmin.cookie)
      .send({
        reason: 'The Creator asked to step away for health reasons.',
        effectiveAt: new Date().toISOString(),
        cause: 'founder_or_product',
        moneyTreatment: 'earnings_remain',
        receivedVia: 'Email, forwarded to support.',
      })
      .expect(200);
    const open = (recorded.body as CreatorRelationshipDetail).terminationRequests.open;
    expect(open).not.toBeNull();
    expect(open!.causeLabel).toBe('Founder or product caused');
    expect(open!.treatmentLabel).toContain('earnings remain');

    // A second ask while one waits is a duplicate, not a new decision.
    const second = await request(h.app)
      .post(url)
      .set('cookie', admin.cookie)
      .send({
        reason: 'Asked again.',
        effectiveAt: new Date().toISOString(),
        cause: 'founder_or_product',
        moneyTreatment: 'earnings_remain',
        receivedVia: 'Email.',
      })
      .expect(422);
    expect((second.body as { whatHappened: string }).whatHappened).toContain('already exists');

    // The decision is gated, whole, and write-once.
    const decisionUrl = `${url}/${open!.id}/decision`;
    await request(h.app)
      .post(decisionUrl)
      .set('cookie', staleAdmin.cookie)
      .send({ decision: 'declined', note: 'x' })
      .expect(403);
    const decided = await request(h.app)
      .post(decisionUrl)
      .set('cookie', admin.cookie)
      .send({ decision: 'declined', note: 'The campaign closes in two days; nothing to end early.' })
      .expect(200);
    const after = (decided.body as CreatorRelationshipDetail).terminationRequests;
    expect(after.open).toBeNull();
    expect(after.history).toHaveLength(1);
    expect(after.history[0]!.decision).toBe('declined');

    const again = await request(h.app)
      .post(decisionUrl)
      .set('cookie', admin.cookie)
      .send({ decision: 'applied', note: 'Changed my mind.' })
      .expect(422);
    expect((again.body as { whatHappened: string }).whatHappened).toContain('already decided');
  });

  it('answers the link control with the relationship re-read it always declared', async () => {
    const campaignId = await createCampaign('link-shape');
    const { prospectId, associationId } = await recruit(campaignId, 'link-shape');
    await mintLink(associationId, campaignId, true);

    // Until Session C this route answered with the WORKSPACE read while the
    // client type said relationship — a type lie the old page's stubbed test
    // never saw. The campaign tabs render this response, so the shape matters.
    const res = await request(h.app)
      .post(`/api/admin/creators/${prospectId}/relationships/${associationId}/link`)
      .set('cookie', admin.cookie)
      .send({ action: 'pause', reason: 'Reviewing a report.' })
      .expect(200);
    const body = res.body as CreatorRelationshipDetail;
    expect(body.associationId).toBe(associationId);
    expect(body.overview.link?.state).toBe('paused');
    expect(body.band.campaignName).toContain('link-shape');
  });
});
