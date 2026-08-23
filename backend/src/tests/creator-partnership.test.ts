/**
 * Phase 14c — the Creator active-partnership surface (§18 item 6).
 *
 * A live Creator's dashboard: their link and disclosure, terms, readiness,
 * first-post state, and clicks — refresh-based, with the pre-order/earnings
 * metrics labelled as pending (they need Phase 15/19). Scoped by session.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';

import { startHarness, type Harness } from './app-harness.js';
import { seedUser, signInPlain } from './admin-session.js';
import { createAuditWriter } from '../auth/audit.js';
import { campaigns, campaignAffiliateAssociations } from '../db/schema/domain.js';
import { founderProspects, campaignDrafts } from '../db/schema/invitations.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { affiliateProspects } from '../db/schema/affiliates.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import {
  proposalVersions,
  associationCompensationAgreements,
  trackingLinks,
} from '../db/schema/decisions.js';
import { campaignBuild, campaignRewardPackages } from '../db/schema/build.js';

import { launchCampaign } from '../launch/launch.js';
import { recordClick } from '../attribution/service.js';
import { buildCreatorPartnership } from '../affiliates/partnership.js';
import { LINK_TEST_MARKER } from '../affiliates/roster-labels.js';

let h: Harness;
let audit: ReturnType<typeof createAuditWriter>;

beforeAll(async () => {
  h = await startHarness({}, 'partnership');
  audit = createAuditWriter(h.db);
}, 180_000);

afterAll(async () => {
  await h.stop();
});

interface Seeded {
  campaignId: string;
  associationId: string;
  creatorId: string;
  creatorEmail: string;
  code: string;
}

async function seedLivePartnership(label: string): Promise<Seeded> {
  const founder = await seedUser(h, 'founder', `pn-founder-${label}`);
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
      status: 'creator_prep',
      type: 'pre_launch',
      typeLockedAt: new Date(),
      listingPaidAt: new Date(),
      campaignLiveAt: new Date(Date.now() - 1000),
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
    requiredWording: 'Say it truthfully.',
    prohibitedClaims: 'No medical claims.',
    brandPerception: 'Warm and honest.',
    publicStory: 'A story.',
    heroPreference: 'hero-image',
    opensAt: new Date(Date.now() + 86_400_000),
    closesAt: new Date(Date.now() + 14 * 86_400_000),
    updatedBy: 'user:test',
  });
  await h.db.insert(campaignRewardPackages).values({
    campaignId,
    sku: 'TIER-1',
    title: 'Early bird',
    priceCents: 5_000n,
    contents: 'One unit.',
    fulfillmentCommitment: 'Ship it.',
    delivery: '2026-12',
  });

  const creator = await seedUser(h, 'affiliate', `pn-creator-${label}`);
  const [cp] = await h.db
    .insert(affiliateProspects)
    .values({
      legalName: `Creator ${label}`,
      publicHandle: `@creator-${label}`,
      email: creator.email,
      subtype: 'social_creator',
      audienceNiche: 'hardware',
      audienceSize: '120k',
      adminBio: 'Reviews hardware.',
      createdBy: 'admin:test',
    })
    .returning({ id: affiliateProspects.id });
  const [assoc] = await h.db
    .insert(campaignAffiliateAssociations)
    .values({
      campaignId,
      affiliateId: randomUUID(),
      prospectId: cp!.id,
      status: 'ready',
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

  const [version] = await h.db
    .insert(proposalVersions)
    .values({
      associationId,
      campaignId,
      versionNumber: 1,
      proposedBy: 'affiliate',
      bidTotalPercent: 30,
      state: 'locked',
      affiliateDecision: 'proposed',
      affiliateDecidedAt: new Date(),
      founderDecision: 'accepted',
      founderDecidedAt: new Date(),
      lockedAt: new Date(),
    })
    .returning({ id: proposalVersions.id });
  await h.db.insert(associationCompensationAgreements).values({
    associationId,
    campaignId,
    source: 'proposal_version',
    proposalVersionId: version!.id,
    basePercent: 30,
    bidIncreasePercent: 0,
    totalPercent: 30,
    affiliateAcceptedAt: new Date(),
    founderAcceptedAt: new Date(),
  });

  const code = `pn-${label}-${randomUUID().slice(0, 8)}`;
  await h.db.insert(trackingLinks).values({ associationId, campaignId, code });

  const launched = await launchCampaign(h.db, { audit }, { campaignId, actor: 'system:test' });
  expect(launched.status).toBe('launched');

  return { campaignId, associationId, creatorId: creator.id, creatorEmail: creator.email, code };
}

describe('§18 the Creator active-partnership surface', () => {
  it('assembles the link, disclosure, terms, readiness, and deferred metrics', async () => {
    const seeded = await seedLivePartnership('assemble');
    const result = await buildCreatorPartnership(h.db, {
      associationId: seeded.associationId,
      appBaseUrl: 'http://localhost:3000',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const p = result.partnership;

    // §18: the unique tracking link + the safe test URL (the marker attribution excludes).
    expect(p.trackingLink?.url).toContain(`/c/${seeded.code}`);
    expect(p.trackingLink?.testUrl).toContain(LINK_TEST_MARKER);
    expect(p.trackingLink?.active).toBe(true);
    expect((p.trackingLink?.disclosureText ?? '').length).toBeGreaterThan(0);

    // §18: locked compensation, readiness at the status level, first-post state.
    expect(p.compensation?.totalPercent).toBe(30);
    expect(p.readiness.state).toBe('active');
    expect(p.readiness.ready).toBe(true);
    expect(p.firstPost.status).toBeNull();
    expect(p.fixedPayment.applicable).toBe(false);

    // §18/§30: refresh-based.
    expect(typeof p.updatedAt).toBe('string');

    // DELIBERATELY INVERTED (Creator Flow v2 Session F, 2026-08-20).
    //
    // Phase 14d asserted a `pending` block naming five metrics as unavailable,
    // because Phase 15 had not created a reservation and Phase 19 had not moved
    // any money. Both shipped, so a block still saying "not yet" about records
    // that exist is §1.4's failure in the other direction. What that assertion
    // was protecting survives and is the stronger half: a number nobody has
    // computed is ABSENT, never a zero — `conversionRate` over no clicks is
    // null rather than `0%` (§16a).
    expect(p.performance.attributedPreorders).toBe(0);
    expect(p.performance.conversionRate).toBeNull();
  });

  it('counts clicks from the attribution ledger and excludes link tests (§14.1)', async () => {
    const seeded = await seedLivePartnership('clicks');
    const now = new Date();
    await recordClick(h.db, { code: seeded.code, visitorId: randomUUID(), linkTest: false, now });
    await recordClick(h.db, { code: seeded.code, visitorId: randomUUID(), linkTest: false, now });
    await recordClick(h.db, { code: seeded.code, visitorId: randomUUID(), linkTest: true, now });

    const result = await buildCreatorPartnership(h.db, {
      associationId: seeded.associationId,
      appBaseUrl: 'http://localhost:3000',
    });
    if (!result.ok) throw new Error('expected a partnership');
    expect(result.partnership.clicks.total).toBe(2); // the two real clicks, not the test
    expect(result.partnership.clicks.attributed).toBe(2);
  });

  it('is served over HTTP to the owning Creator, and 404s another Creator', async () => {
    const seeded = await seedLivePartnership('http');
    const cookie = await signInPlain(h, seeded.creatorEmail);
    const res = await request(h.app)
      .get(`/api/creator/campaigns/${seeded.associationId}/partnership`)
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body.partnership.readiness.state).toBe('active');

    const other = await seedUser(h, 'affiliate', 'pn-intruder');
    const otherCookie = await signInPlain(h, other.email);
    await request(h.app)
      .get(`/api/creator/campaigns/${seeded.associationId}/partnership`)
      .set('Cookie', otherCookie)
      .expect(404);
  });

  it('answers not_active for an association that has not accepted yet', async () => {
    // A bare pre-acceptance association: no agreement, status `preparing`.
    const founder = await seedUser(h, 'founder', 'pn-pre-founder');
    const [campaign] = await h.db
      .insert(campaigns)
      .values({ status: 'creator_prep', type: 'pre_launch', typeLockedAt: new Date() })
      .returning({ id: campaigns.id });
    const creator = await seedUser(h, 'affiliate', 'pn-pre-creator');
    const [cp] = await h.db
      .insert(affiliateProspects)
      .values({
        legalName: 'Pre Creator',
        publicHandle: '@pre',
        email: creator.email,
        subtype: 'social_creator',
        audienceNiche: 'x',
        audienceSize: '1k',
        adminBio: 'x',
        createdBy: 'admin:test',
      })
      .returning({ id: affiliateProspects.id });
    const [assoc] = await h.db
      .insert(campaignAffiliateAssociations)
      .values({
        campaignId: campaign!.id,
        affiliateId: randomUUID(),
        prospectId: cp!.id,
        status: 'preparing',
        rosterMembership: 'initial_roster',
      })
      .returning({ id: campaignAffiliateAssociations.id });
    await h.db.insert(affiliateSignupProfiles).values({
      prospectId: cp!.id,
      associationId: assoc!.id,
      email: creator.email,
      publicHandle: '@pre',
      claimedUserId: creator.id,
      claimedAt: new Date(),
      updatedBy: 'test',
    });

    const result = await buildCreatorPartnership(h.db, {
      associationId: assoc!.id,
      appBaseUrl: 'http://localhost:3000',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('not_active');

    const cookie = await signInPlain(h, creator.email);
    await request(h.app)
      .get(`/api/creator/campaigns/${assoc!.id}/partnership`)
      .set('Cookie', cookie)
      .expect(409);
  });
});
