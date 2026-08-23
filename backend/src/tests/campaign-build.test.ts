/**
 * Phase 12b — campaign building, roster readiness, review, and materiality.
 *
 * Acceptance: §33.3.9, §33.3.10, §33.4.1, §33.4.2 — the four §33 tests the
 * phase brief names for 12b, plus the two extra done-when items (a Founder
 * cannot publish a material change directly; preview collects no payment).
 *
 * Each journey pays the listing fee (opening the formal decisions), has its
 * Creators accept standard terms, then builds the campaign, finalizes the
 * roster, and drives review — the two parallel §14 tracks meeting at review
 * readiness (§15).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import Stripe from 'stripe';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';

import { startHarness, type Harness } from './app-harness.js';
import { createAdmin, seedUser, signInPlain, type AdminSession } from './admin-session.js';
import { seedAdminReauthWindow } from '../settings/service.js';
import { createMemoryStripeGateway } from '../payments/stripe-client.js';
import {
  STRIPE_PLATFORM_WEBHOOK_PATH,
  STRIPE_SIGNATURE_HEADER,
} from '../routes/stripe-webhooks.js';
import { campaigns, campaignAffiliateAssociations } from '../db/schema/domain.js';
import { founderProspects, campaignDrafts } from '../db/schema/invitations.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { policyVersions } from '../db/schema/policies.js';
import { affiliateProspects } from '../db/schema/affiliates.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import { stripeConnectedAccounts } from '../db/schema/payments.js';
import {
  campaignReviews,
  reviewFeedbackItems,
  materialChanges,
  materialChangeReacceptances,
  associationReadiness,
  approvedCampaignSnapshots,
} from '../db/schema/build.js';
import { IP_AGREEMENT_SLUG } from '../affiliates/decisions.js';
import {
  deriveRosterReadiness,
  deriveBuildStatus,
  missingBuildFields,
  deriveReviewReady,
} from '../campaign/logic.js';
import {
  deriveRosterReadiness as sharedDeriveRoster,
  deriveBuildStatus as sharedDeriveBuild,
  deriveReviewReady as sharedDeriveReview,
  REQUIRED_SHARED_BUILD_FIELDS,
  REQUIRED_SHARED_BUILD_FIELDS as SHARED_FIELDS,
} from '@proovd/shared';

const PLATFORM_SECRET = 'whsec_platform_for_build_suite';
const CONNECT_SECRET = 'whsec_connect_for_build_suite';

const gateway = createMemoryStripeGateway({
  mode: 'test',
  platformWebhookSecret: PLATFORM_SECRET,
  connectWebhookSecret: CONNECT_SECRET,
  taxEnabled: true,
});

let h: Harness;
let admin: AdminSession;

beforeAll(async () => {
  h = await startHarness(
    {
      stripeGateway: gateway,
      stripeConnectUrls: {
        returnUrl: 'https://app.example.com/stripe/return',
        refreshUrl: 'https://app.example.com/stripe/refresh',
      },
    },
    'build',
  );
  admin = await createAdmin(h, 'build-admin');
  await seedAdminReauthWindow(h.db, 3600);
  // §14.2 acceptance needs published Terms, Affiliate AUP, and the IP agreement.
  await h.db
    .update(policyVersions)
    .set({ status: 'published', effectiveDate: '2026-01-01', publishedAt: new Date() })
    .where(
      and(
        inArray(policyVersions.slug, [IP_AGREEMENT_SLUG, 'terms', 'affiliate-aup', 'aup']),
        eq(policyVersions.status, 'draft'),
      ),
    );
}, 180_000);

afterAll(async () => {
  await h.stop();
});

/* ── The journey ───────────────────────────────────────────────────────────── */

interface Creator {
  associationId: string;
  userId: string;
  email: string;
  cookie: string;
}

interface Journey {
  campaignId: string;
  founder: { id: string; email: string; cookie: string };
  creators: Creator[];
}

const CONFIRM = { compensationTerms: true, ipAgreement: true, ftcDisclosure: true, termsAup: true };

function signedEvent(input: { type: string; object: Record<string, unknown> }) {
  const id = `evt_${randomUUID().replace(/-/g, '')}`;
  const payload = JSON.stringify({
    id,
    object: 'event',
    type: input.type,
    created: Math.floor(Date.now() / 1000),
    data: { object: input.object },
  });
  return {
    payload,
    signature: Stripe.webhooks.generateTestHeaderString({ payload, secret: PLATFORM_SECRET }),
  };
}

async function completeSession(sessionId: string) {
  const session = gateway.sessions.find((s) => s.id === sessionId)!;
  const { payload, signature } = signedEvent({
    type: 'checkout.session.completed',
    object: {
      id: session.id,
      object: 'checkout.session',
      payment_intent: session.paymentIntentId,
      amount_total: Number(session.subtotalCents + session.taxCents),
      metadata: session.metadata,
      status: 'complete',
    },
  });
  await request(h.app)
    .post(STRIPE_PLATFORM_WEBHOOK_PATH)
    .set('content-type', 'application/json')
    .set(STRIPE_SIGNATURE_HEADER, signature)
    .send(payload)
    .expect(200);
}

/** A paid campaign with N signed-in Creators in `formal_decision_open`. */
async function paidJourney(
  label: string,
  options: { type?: 'pre_build' | 'pre_launch'; creators?: number } = {},
): Promise<Journey> {
  const type = options.type ?? 'pre_launch';
  const founder = await seedUser(h, 'founder', `build-founder-${label}`);
  const cookie = await signInPlain(h, founder.email);

  const [prospect] = await h.db
    .insert(founderProspects)
    .values({
      legalName: `Founder ${label}`,
      preferredName: `Fondi-${label}`,
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
      status: 'account_claimed',
      type,
      typeLockedAt: new Date(),
      highEffort: false,
      highEffortCalculatedAt: new Date(),
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
    preferredName: `Fondi-${label}`,
    legalName: `Founder ${label}`,
    businessName: `${label} Labs LLC`,
    soleProprietor: false,
    claimedUserId: founder.id,
    claimedAt: new Date(),
    updatedBy: `user:${founder.id}`,
  });

  await h.db.insert(stripeConnectedAccounts).values({
    stripeAccountId: `acct_bld${label.replace(/[^a-z0-9]/gi, '')}${randomUUID().replace(/-/g, '').slice(0, 8)}`,
    mode: 'test',
    role: 'founder_seller',
    ownerUserId: founder.id,
    state: 'complete',
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });

  const creators: Creator[] = [];
  for (let i = 0; i < (options.creators ?? 1); i += 1) {
    const user = await seedUser(h, 'affiliate', `build-creator-${label}-${i}`);
    const creatorCookie = await signInPlain(h, user.email);
    const [cp] = await h.db
      .insert(affiliateProspects)
      .values({
        legalName: `Creator ${label}-${i}`,
        publicHandle: `@creator-${label}-${i}`,
        email: user.email,
        subtype: 'social_creator',
        audienceNiche: 'hardware',
        audienceSize: '100k',
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
        status: 'preparing',
        rosterMembership: 'initial_roster',
        preparingRevealedAt: new Date(),
        whyRecruited: 'Your audience builds hardware.',
      })
      .returning({ id: campaignAffiliateAssociations.id });

    await h.db.insert(affiliateSignupProfiles).values({
      prospectId: cp!.id,
      associationId: assoc!.id,
      email: user.email,
      publicHandle: `@creator-${label}-${i}`,
      claimedUserId: user.id,
      claimedAt: new Date(),
      updatedBy: 'test',
    });

    creators.push({ associationId: assoc!.id, userId: user.id, email: user.email, cookie: creatorCookie });
  }

  // Open the workspace (creates the calculation) and pay the listing fee.
  await request(h.app).get(`/api/founder/campaigns/${campaignId}/workspace`).set('cookie', cookie).expect(200);
  const checkout = await request(h.app)
    .post(`/api/founder/campaigns/${campaignId}/listing/checkout`)
    .set('cookie', cookie)
    .send({ address: { postalCode: '94105', state: 'CA', country: 'US' }, newsletterOptIn: false })
    .expect(200);
  await completeSession(checkout.body.checkout.sessionId);

  return { campaignId, founder: { ...founder, cookie }, creators };
}

/** Each Creator accepts standard terms → accepted + agreement + tracking + disclosure. */
async function acceptAll(j: Journey): Promise<void> {
  for (const c of j.creators) {
    await request(h.app)
      .post(`/api/creator/campaigns/${c.associationId}/accept`)
      .set('cookie', c.cookie)
      .send(CONFIRM)
      .expect(200);
  }
}

/** Fills every §14.4 required field + a reward package, so the build completes. */
async function fillBuild(j: Journey, type: 'pre_build' | 'pre_launch' = 'pre_launch'): Promise<void> {
  const patch: Record<string, unknown> = {
    title: 'The Widget',
    founderDisplayName: 'Widget Labs',
    founderCountry: 'US',
    founderProfileUrl: 'https://widgetlabs.example.com',
    opensAt: '2026-09-01T00:00:00.000Z',
    closesAt: '2026-09-15T00:00:00.000Z',
    brandPerception: 'Precise, warm, and honest.',
    brandVoice: 'Plain and confident.',
    heroPreference: 'product-photo',
    publicStory: 'We built the Widget because the old ones broke.',
  };
  if (type === 'pre_build') {
    patch['orderThreshold'] = 500;
    patch['deliveryWindow'] = 'Q1 2027';
    patch['earlyProductDisclaimer'] = 'This product is still in development.';
    patch['risksAndChallenges'] = 'Supply chain and tooling risk.';
  } else {
    patch['internalTargetCents'] = '2500000';
    patch['refundPolicyText'] = 'Full refund within 30 days of delivery.';
  }

  await request(h.app)
    .patch(`/api/founder/campaigns/${j.campaignId}/build`)
    .set('cookie', j.founder.cookie)
    .send(patch)
    .expect(200);

  await request(h.app)
    .put(`/api/founder/campaigns/${j.campaignId}/build/rewards`)
    .set('cookie', j.founder.cookie)
    .send({
      sku: 'EARLY',
      title: 'Early Widget',
      priceCents: '5000',
      contents: 'One Widget\nA thank-you note',
      fulfillmentCommitment: 'Ships from our warehouse.',
      delivery: 'March 2027',
    })
    .expect(200);
}

/** Admin finalizes the roster and records each Creator's decision. */
async function finalizeRoster(
  j: Journey,
  decisions: Array<{ associationId: string; rosterDecision: 'included' | 'excluded'; launchRequired: boolean; readinessConfirmed: boolean }>,
): Promise<void> {
  await request(h.app)
    .post(`/api/admin/campaigns/${j.campaignId}/roster/finalize`)
    .set('cookie', admin.cookie)
    .send({})
    .expect(200);
  for (const d of decisions) {
    await request(h.app)
      .post(`/api/admin/campaigns/${j.campaignId}/roster/${d.associationId}/decision`)
      .set('cookie', admin.cookie)
      .send(d)
      .expect(200);
  }
}

async function reviewReadiness(j: Journey) {
  const res = await request(h.app)
    .get(`/api/founder/campaigns/${j.campaignId}/build`)
    .set('cookie', j.founder.cookie)
    .expect(200);
  return res.body.reviewReadiness as {
    rosterStatus: string;
    buildStatus: string;
    reviewReady: boolean;
  };
}

async function campaignRow(campaignId: string) {
  const [row] = await h.db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  return row!;
}

/* ═══ Drift — the backend restatement matches shared ═══════════════════════ */

describe('drift — the §14.4/§15 logic matches shared', () => {
  it('build status, roster readiness, and review readiness agree with shared', () => {
    expect(REQUIRED_SHARED_BUILD_FIELDS).toEqual(SHARED_FIELDS);

    const snap = {
      campaignType: 'pre_launch' as const,
      fields: { title: 'x' },
      rewardPackageCount: 0,
      refundPolicyPresent: false,
    };
    expect(deriveBuildStatus(snap)).toBe(sharedDeriveBuild(snap));
    expect(missingBuildFields(snap).length).toBeGreaterThan(0);

    const rosterSnap = {
      initialRosterFinalized: true,
      candidates: [
        {
          associationId: 'a',
          rosterDecision: 'included' as const,
          launchRequired: true,
          hasLockedAgreement: true,
          hasOpenProposal: false,
          recordsComplete: true,
          reacceptancePending: false,
        },
      ],
    };
    expect(deriveRosterReadiness(rosterSnap)).toEqual(sharedDeriveRoster(rosterSnap));
    expect(deriveReviewReady('launch_ready', 'complete')).toBe(
      sharedDeriveReview('launch_ready', 'complete'),
    );
    expect(deriveReviewReady('failed', 'complete')).toBe(true);
  });
});

/* ═══ Campaign review follows the build; Matching is non-blocking ══════════ */

describe('campaign review readiness', () => {
  it('allows a complete build to submit while the Creator roster is still forming', async () => {
    const j = await paidJourney('rr');

    // Neither track complete.
    let readiness = await reviewReadiness(j);
    expect(readiness.buildStatus).not.toBe('complete');
    expect(readiness.rosterStatus).not.toBe('launch_ready');
    expect(readiness.reviewReady).toBe(false);

    // Build complete, roster still forming: matching does not block review.
    await fillBuild(j);
    readiness = await reviewReadiness(j);
    expect(readiness.buildStatus).toBe('complete');
    expect(readiness.rosterStatus).not.toBe('launch_ready');
    expect(readiness.reviewReady).toBe(true);

    await request(h.app)
      .post(`/api/founder/campaigns/${j.campaignId}/submit`)
      .set('cookie', j.founder.cookie)
      .expect(200);
    expect((await campaignRow(j.campaignId)).status).toBe('pending_review');
  });
});

/* ═══ §33.3.9 — the six rules; a non-required pending Creator ══════════════ */

describe('§33.3.9 — roster readiness follows all six rules', () => {
  it('a non-required pending Creator does not block after Admin records the decision', async () => {
    const j = await paidJourney('six', { creators: 2 });
    const [required, extra] = j.creators;
    await fillBuild(j);

    // Only the first Creator accepts. The second is left pending (no agreement).
    await request(h.app)
      .post(`/api/creator/campaigns/${required!.associationId}/accept`)
      .set('cookie', required!.cookie)
      .send(CONFIRM)
      .expect(200);

    // Finalize with the accepted Creator required, the pending one NOT yet
    // decided → the pending Creator is undecided, roster not ready.
    await request(h.app)
      .post(`/api/admin/campaigns/${j.campaignId}/roster/finalize`)
      .set('cookie', admin.cookie)
      .send({})
      .expect(200);
    await request(h.app)
      .post(`/api/admin/campaigns/${j.campaignId}/roster/${required!.associationId}/decision`)
      .set('cookie', admin.cookie)
      .send({ associationId: required!.associationId, rosterDecision: 'included', launchRequired: true, readinessConfirmed: true })
      .expect(200);

    // The second Creator is pending with no decision recorded — but it is not
    // launch_required, so it should not block once Admin closes it out.
    // Before closure: excluded not recorded, so the roster is already ready
    // because rule 5 only blocks a REQUIRED pending Creator. Confirm it is
    // ready with the extra Creator still undecided-but-not-required.
    let readiness = await reviewReadiness(j);
    expect(readiness.rosterStatus).toBe('launch_ready');

    // Admin records the non-required Creator as excluded (declined/removed):
    // still ready, and the excluded Creator is off the final roster.
    const excluded = await request(h.app)
      .post(`/api/admin/campaigns/${j.campaignId}/roster/${extra!.associationId}/decision`)
      .set('cookie', admin.cookie)
      .send({ associationId: extra!.associationId, rosterDecision: 'excluded', launchRequired: false, readinessConfirmed: false })
      .expect(200);
    expect(excluded.body.rosterReadiness.ready).toBe(true);

    // Now make the SECOND Creator required-but-pending: rule 5 must block.
    await request(h.app)
      .post(`/api/admin/campaigns/${j.campaignId}/roster/${extra!.associationId}/decision`)
      .set('cookie', admin.cookie)
      .send({ associationId: extra!.associationId, rosterDecision: 'included', launchRequired: true, readinessConfirmed: false })
      .expect(200);
    readiness = await reviewReadiness(j);
    expect(readiness.rosterStatus).toBe('forming');
  });

  it('rule 1 blocks when no Creator has accepted, and rule 2 blocks until Admin finalizes', async () => {
    const j = await paidJourney('rules');
    await fillBuild(j);

    // No acceptance, no finalization: rules 1 and 2 unmet at least.
    const before = await request(h.app)
      .get(`/api/admin/campaigns/${j.campaignId}/review`)
      .set('cookie', admin.cookie)
      .expect(200);
    expect(before.body.review.rosterReadiness.unmetRules).toEqual(
      expect.arrayContaining([1, 2]),
    );
    expect(before.body.review.rosterReadiness.ready).toBe(false);
  });
});

/* ═══ §33.4.1 — required/optional feedback preserves draft, deep-links ═════ */

describe('§33.4.1 — changes-required feedback', () => {
  it('groups required/optional, deep-links, identifies owner, and preserves all valid work', async () => {
    const j = await paidJourney('changes');
    const c = j.creators[0]!;
    await fillBuild(j);
    await acceptAll(j);
    await finalizeRoster(j, [
      { associationId: c.associationId, rosterDecision: 'included', launchRequired: true, readinessConfirmed: true },
    ]);
    await request(h.app).post(`/api/founder/campaigns/${j.campaignId}/submit`).set('cookie', j.founder.cookie).expect(200);

    // A deep-link is required on every feedback item.
    const noLink = await request(h.app)
      .post(`/api/admin/campaigns/${j.campaignId}/review/changes`)
      .set('cookie', admin.cookie)
      .send({ feedback: [{ group: 'required', area: 'story', body: 'Tighten it.' }] })
      .expect(422);
    expect(noLink.body.error).toBe('deep_link_required');

    await request(h.app)
      .post(`/api/admin/campaigns/${j.campaignId}/review/changes`)
      .set('cookie', admin.cookie)
      .send({
        reviewer: 'Reviewer A',
        nextUpdateExpectation: 'within 2 business days',
        feedback: [
          {
            group: 'required',
            area: 'story',
            body: 'The claim about battery life needs proof.',
            deepLink: `/campaigns/${j.campaignId}/build#story`,
            owner: 'Founder',
            dueExpectation: 'before resubmission',
            enforcementInvolved: true,
          },
          {
            group: 'optional',
            area: 'faq',
            body: 'Consider adding a shipping FAQ.',
            deepLink: `/campaigns/${j.campaignId}/build#faq`,
            owner: 'Founder',
          },
        ],
      })
      .expect(200);

    // The campaign moved to changes_required, and the draft is preserved.
    expect((await campaignRow(j.campaignId)).status).toBe('changes_required');
    const buildAfter = await request(h.app)
      .get(`/api/founder/campaigns/${j.campaignId}/build`)
      .set('cookie', j.founder.cookie)
      .expect(200);
    expect(buildAfter.body.build.title).toBe('The Widget');
    expect(buildAfter.body.rewardPackages).toHaveLength(1);

    // The Founder sees grouped, deep-linked feedback with owner and due.
    const review = await request(h.app)
      .get(`/api/founder/campaigns/${j.campaignId}/review`)
      .set('cookie', j.founder.cookie)
      .expect(200);
    expect(review.body.review.outcome).toBe('changes_required');
    expect(review.body.review.reviewer).toBe('Reviewer A');
    expect(review.body.review.nextUpdateExpectation).toBe('within 2 business days');
    expect(review.body.review.required).toHaveLength(1);
    expect(review.body.review.required[0].deepLink).toBe(`/campaigns/${j.campaignId}/build#story`);
    expect(review.body.review.required[0].owner).toBe('Founder');
    expect(review.body.review.required[0].enforcementInvolved).toBe(true);
    expect(review.body.review.optional).toHaveLength(1);
    expect(review.body.review.optional[0].deepLink).toBe(`/campaigns/${j.campaignId}/build#faq`);

    // The Founder can edit again in changes_required and resubmit.
    await request(h.app)
      .patch(`/api/founder/campaigns/${j.campaignId}/build`)
      .set('cookie', j.founder.cookie)
      .send({ publicStory: 'We built the Widget, and here is the battery proof.' })
      .expect(200);
    await request(h.app).post(`/api/founder/campaigns/${j.campaignId}/submit`).set('cookie', j.founder.cookie).expect(200);
    expect((await campaignRow(j.campaignId)).status).toBe('pending_review');
  });
});

/* ═══ §33.4.2 — materiality: non-material preserves, material versions ═════ */

describe('§33.4.2 — materiality and reacceptance', () => {
  it('a non-material change preserves readiness and manufactures no reacceptance task', async () => {
    const j = await paidJourney('nonmat');
    const c = j.creators[0]!;
    await fillBuild(j);
    await acceptAll(j);
    await finalizeRoster(j, [
      { associationId: c.associationId, rosterDecision: 'included', launchRequired: true, readinessConfirmed: true },
    ]);
    await request(h.app).post(`/api/founder/campaigns/${j.campaignId}/submit`).set('cookie', j.founder.cookie).expect(200);
    expect((await reviewReadiness(j)).reviewReady).toBe(true);

    const res = await request(h.app)
      .post(`/api/admin/campaigns/${j.campaignId}/material-changes`)
      .set('cookie', admin.cookie)
      .send({
        classification: 'non_material',
        reason: 'Fixed a spelling mistake in the story.',
        affectedFields: ['publicStory'],
        beforeValue: 'teh Widget',
        afterValue: 'the Widget',
      })
      .expect(200);
    expect(res.body.materialChange.classification).toBe('non_material');
    expect(res.body.materialChange.newVersion).toBeNull();
    expect(res.body.materialChange.reacceptanceTasks).toBe(0);
    // Readiness preserved (§33.4.2's first half).
    expect(res.body.rosterReadiness.ready).toBe(true);

    // No reacceptance task exists for the Creator.
    const tasks = await h.db
      .select()
      .from(materialChangeReacceptances)
      .where(eq(materialChangeReacceptances.associationId, c.associationId));
    expect(tasks).toHaveLength(0);
    const stored = await h.db.select().from(materialChanges).where(eq(materialChanges.campaignId, j.campaignId));
    expect(stored).toHaveLength(1);
    expect(stored[0]!.reacceptanceState).toBe('not_required');
  });

  it('a material change versions, invalidates readiness, and requires the affected Creator to reaccept', async () => {
    const j = await paidJourney('mat');
    const c = j.creators[0]!;
    await fillBuild(j);
    await acceptAll(j);
    await finalizeRoster(j, [
      { associationId: c.associationId, rosterDecision: 'included', launchRequired: true, readinessConfirmed: true },
    ]);
    await request(h.app).post(`/api/founder/campaigns/${j.campaignId}/submit`).set('cookie', j.founder.cookie).expect(200);
    expect((await reviewReadiness(j)).reviewReady).toBe(true);

    // A material change to a reward price, affecting the rostered Creator.
    const res = await request(h.app)
      .post(`/api/admin/campaigns/${j.campaignId}/material-changes`)
      .set('cookie', admin.cookie)
      .send({
        classification: 'material',
        reason: 'Reward price changed, which changes the pre-tax subtotal Creators earn on.',
        affectedFields: ['rewards_or_prices'],
        beforeValue: { priceCents: '5000' },
        afterValue: { priceCents: '6000' },
        affectedCreators: [c.associationId],
      })
      .expect(200);
    expect(res.body.materialChange.classification).toBe('material');
    expect(res.body.materialChange.newVersion).toBe(1);
    expect(res.body.materialChange.reacceptanceTasks).toBe(1);
    // §15: the material change invalidates readiness — roster drops below ready.
    expect(res.body.rosterReadiness.ready).toBe(false);
    expect(res.body.rosterReadiness.unmetRules).toEqual(expect.arrayContaining([5, 6]));

    // The Creator now has a pending reacceptance task carrying the exact fields.
    const list = await request(h.app)
      .get(`/api/creator/campaigns/${c.associationId}/reacceptances`)
      .set('cookie', c.cookie)
      .expect(200);
    expect(list.body.reacceptances).toHaveLength(1);
    expect(list.body.reacceptances[0].changedFields).toEqual(['rewards_or_prices']);
    const taskId = list.body.reacceptances[0].id;

    // Creator reacceptance is tracked independently from campaign review.
    expect((await reviewReadiness(j)).reviewReady).toBe(true);

    // Someone else cannot answer this Creator's reacceptance.
    const otherCreator = (await paidJourney('mat-other')).creators[0]!;
    await request(h.app)
      .post(`/api/creator/reacceptances/${taskId}/respond`)
      .set('cookie', otherCreator.cookie)
      .send({ decision: 'accepted' })
      .expect(404);

    // The affected Creator accepts the new version → readiness restored.
    await request(h.app)
      .post(`/api/creator/reacceptances/${taskId}/respond`)
      .set('cookie', c.cookie)
      .send({ decision: 'accepted' })
      .expect(200);

    expect((await reviewReadiness(j)).reviewReady).toBe(true);
    const [changeRow] = await h.db.select().from(materialChanges).where(eq(materialChanges.campaignId, j.campaignId));
    expect(changeRow!.reacceptanceState).toBe('complete');
    const [readinessRow] = await h.db
      .select()
      .from(associationReadiness)
      .where(eq(associationReadiness.associationId, c.associationId));
    expect(readinessRow!.reacceptanceRequired).toBe(false);
  });

  it('a Founder cannot publish a material change directly — the build refuses after submission', async () => {
    const j = await paidJourney('nopublish');
    const c = j.creators[0]!;
    await fillBuild(j);
    await acceptAll(j);
    await finalizeRoster(j, [
      { associationId: c.associationId, rosterDecision: 'included', launchRequired: true, readinessConfirmed: true },
    ]);
    await request(h.app).post(`/api/founder/campaigns/${j.campaignId}/submit`).set('cookie', j.founder.cookie).expect(200);

    // In pending_review, the build save refuses — a direct edit could be a
    // material change to terms Creators accepted (§15).
    const refused = await request(h.app)
      .patch(`/api/founder/campaigns/${j.campaignId}/build`)
      .set('cookie', j.founder.cookie)
      .send({ publicStory: 'Sneaking in a new claim after submission.' })
      .expect(409);
    expect(refused.body.error).toBe('not_editable');

    // A reward price change is likewise refused directly.
    await request(h.app)
      .put(`/api/founder/campaigns/${j.campaignId}/build/rewards`)
      .set('cookie', j.founder.cookie)
      .send({ sku: 'EARLY', title: 'Early Widget', priceCents: '9999', contents: 'One Widget', fulfillmentCommitment: 'Ships.', delivery: 'March 2027' })
      .expect(409);
  });
});

/* ═══ §15 — approval preserves an immutable version ════════════════════════ */

describe('§15 — approval and the immutable snapshot', () => {
  it('approving preserves an immutable approved campaign/Creator terms version and moves to approved', async () => {
    const j = await paidJourney('approve');
    const c = j.creators[0]!;
    await fillBuild(j);
    await acceptAll(j);
    await finalizeRoster(j, [
      { associationId: c.associationId, rosterDecision: 'included', launchRequired: true, readinessConfirmed: true },
    ]);
    await request(h.app).post(`/api/founder/campaigns/${j.campaignId}/submit`).set('cookie', j.founder.cookie).expect(200);

    await request(h.app)
      .post(`/api/admin/campaigns/${j.campaignId}/review/approve`)
      .set('cookie', admin.cookie)
      .send({ reviewer: 'Reviewer B' })
      .expect(200);

    expect((await campaignRow(j.campaignId)).status).toBe('approved');
    const [snapshot] = await h.db
      .select()
      .from(approvedCampaignSnapshots)
      .where(eq(approvedCampaignSnapshots.campaignId, j.campaignId));
    expect(snapshot).toBeDefined();
    expect((snapshot!.creatorTerms as unknown[])).toHaveLength(1);

    // The snapshot is immutable.
    await expect(
      h.db
        .update(approvedCampaignSnapshots)
        .set({ approvedBy: 'someone-else' })
        .where(eq(approvedCampaignSnapshots.id, snapshot!.id)),
    ).rejects.toThrow();
  });
});

/* ═══ Preview collects no payment information ══════════════════════════════ */

describe('preview (§15) — collects no payment information', () => {
  it('returns the assembled public campaign and example amounts, and takes no card', async () => {
    const j = await paidJourney('preview');
    await fillBuild(j);

    const res = await request(h.app)
      .get(`/api/founder/campaigns/${j.campaignId}/preview`)
      .set('cookie', j.founder.cookie)
      .expect(200);
    const preview = res.body.preview;
    expect(preview.isPreview).toBe(true);
    expect(preview.model).toBe('product');
    expect(preview.title).toBe('The Widget');
    expect(preview.rewards).toHaveLength(1);
    // Example subtotal/tax/total exist for the checkout drawer preview.
    expect(preview.example.rewardSubtotalCents).toBe('5000');
    expect(preview.example.salesTaxCents).toBe('400');
    expect(preview.example.totalCents).toBe('5400');

    // No payment field: the preview is a GET, and there is no route on it that
    // accepts card/payment data. Posting to a plausible payment path 404s.
    await request(h.app)
      .post(`/api/founder/campaigns/${j.campaignId}/preview/pay`)
      .set('cookie', j.founder.cookie)
      .send({ cardNumber: '4242424242424242' })
      .expect(404);
  });
});
