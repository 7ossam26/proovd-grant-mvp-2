/**
 * Phase 17b — live editing, comments, and mid-campaign Creators.
 *
 * Acceptance:
 *  **§33.6.12** — "Non-material live edit versions; material edit cannot publish
 *  directly."
 *  **§33.6.13** — "Mid-campaign addition gets remaining-time terms/readiness and
 *  no retroactive credit."
 *
 * Also covered, because the phase's done-when list names them:
 *  - an FAQ edit cannot alter a promise locked elsewhere (the §20 loophole);
 *  - the active-partnership cap blocks a fourth concurrent slot;
 *  - cancellation stays one action with no retention obstacle;
 *  - §18's comment thread: magic-link only, `Backer ###` or a chosen name and
 *    never the email local part, flagging routes to a person, and new comments
 *    are disabled after close.
 *
 * Drift guards run first: `campaign/editing-logic.ts` and
 * `affiliates/obligations.ts` restate the §20 registers because the backend
 * cannot import `@proovd/shared` at runtime, and a tier that changed in one place
 * and not the other would let a Founder publish a promise nobody accepted.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';

import { startHarness, type Harness } from './app-harness.js';
import { createAdmin, seedUser, signInPlain, type AdminSession } from './admin-session.js';
import { createMemoryStripeGateway, type MemoryStripeGateway } from '../payments/stripe-client.js';
import { seedAdminReauthWindow } from '../settings/service.js';
import { createAuditWriter } from '../auth/audit.js';
import {
  campaigns,
  campaignAffiliateAssociations,
  reservations,
  reservationStatusHistory,
} from '../db/schema/domain.js';
import { founderProspects, campaignDrafts } from '../db/schema/invitations.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import {
  campaignBuild,
  campaignRewardPackages,
  campaignFaqs,
  materialChanges,
  materialChangeReacceptances,
} from '../db/schema/build.js';
import { affiliateProspects } from '../db/schema/affiliates.js';
import { trackingLinks } from '../db/schema/decisions.js';
import { trackingLinkClicks } from '../db/schema/attribution.js';
import { backerIdentities, campaignReservationCapacity } from '../db/schema/reservations.js';
import { campaignUpdates } from '../db/schema/updates.js';
import {
  campaignLiveEdits,
  campaignChangeRequests,
  campaignComments,
  campaignCommentFlags,
  midCampaignAdditions,
} from '../db/schema/live-editing.js';

import {
  EDITABLE_FIELDS,
  EDIT_TIERS,
  EARNINGS_STATES,
  EARNINGS_STATE_LABELS,
  commitmentsIn,
  commitmentCheckApplies,
  COMMITMENT_CHECK_EXEMPT,
  commentsOpenFor,
  defaultCommentAuthorName,
  displayNameRefusal,
  fieldsInTier,
  tierFor,
} from '../campaign/editing-logic.js';
import { CREATOR_OBLIGATIONS, NO_ACTION_NEEDED } from '../affiliates/obligations.js';
import { applyLiveEdit, decideChangeRequest, listLiveEdits } from '../campaign/live-editing.js';
import { postComment, readCommentThread, flagComment, decideFlag } from '../campaign/comments.js';
import {
  readMidCampaignTerms,
  openMidCampaignAddition,
  activateMidCampaignCreator,
} from '../affiliates/mid-campaign.js';

import {
  EDITABLE_FIELDS as SHARED_FIELDS,
  EDIT_TIERS as SHARED_TIERS,
  EARNINGS_STATES as SHARED_EARNINGS,
  EARNINGS_STATE_LABELS as SHARED_EARNINGS_LABELS,
  CREATOR_OBLIGATIONS as SHARED_OBLIGATIONS,
  NO_ACTION_NEEDED as SHARED_NO_ACTION,
  commitmentsIn as sharedCommitmentsIn,
  commentsOpenFor as sharedCommentsOpenFor,
  defaultCommentAuthorName as sharedDefaultName,
  displayNameRefusal as sharedDisplayRefusal,
} from '@proovd/shared';

const gateway: MemoryStripeGateway = createMemoryStripeGateway({
  mode: 'test',
  platformWebhookSecret: 'whsec_platform_for_editing_suite',
  connectWebhookSecret: 'whsec_connect_for_editing_suite',
  taxEnabled: true,
});

let h: Harness;
let admin: AdminSession;
let audit: ReturnType<typeof createAuditWriter>;

beforeAll(async () => {
  h = await startHarness(
    { stripeGateway: gateway },
    'live-editing',
  );
  await seedAdminReauthWindow(h.db, 900);
  admin = await createAdmin(h, 'liveediting');
  audit = createAuditWriter(h.db);
}, 180_000);

afterAll(async () => {
  await h.stop();
});

/* ── Fixtures ─────────────────────────────────────────────────────────────── */

interface Fixture {
  campaignId: string;
  founderUserId: string;
  founderEmail: string;
  rewardId: string;
  faqId: string;
  closeAt: Date;
}

async function seedLiveCampaign(
  label: string,
  opts: { status?: string; closeInDays?: number } = {},
): Promise<Fixture> {
  const founder = await seedUser(h, 'founder', `liveedit-founder-${label}`);
  const closeAt = new Date(Date.now() + (opts.closeInDays ?? 14) * 86_400_000);

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
      status: (opts.status ?? 'live') as never,
      type: 'pre_launch',
      typeLockedAt: new Date(),
      listingPaidAt: new Date(),
      campaignLiveAt: new Date(Date.now() - 5 * 86_400_000),
      campaignCloseAt: closeAt,
      highEffort: true,
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
    preferredName: `F-${label}`,
    legalName: `Founder ${label}`,
    businessName: `${label} Labs LLC`,
    soleProprietor: false,
    claimedUserId: founder.id,
    claimedAt: new Date(),
    updatedBy: `user:${founder.id}`,
  });

  await h.db.insert(campaignBuild).values({
    campaignId,
    title: `Campaign ${label}`,
    founderDisplayName: `Founder ${label}`,
    founderEntityDisplay: `${label} Labs LLC`,
    founderCountry: 'United States',
    publicStory: 'The original approved story.',
    communityUrl: 'https://example.com/community',
    brandVoice: 'Warm and direct.',
    deliveryWindow: 'March 2027',
    closesAt: closeAt,
    refundPolicyTitle: `${label} Refund Policy`,
    refundPolicyVersion: 'v1',
    refundPolicySourceUrl: 'https://app.proovd.co/policies/refund/v1',
    updatedBy: 'user:test',
  });

  const [reward] = await h.db
    .insert(campaignRewardPackages)
    .values({
      campaignId,
      sku: `${label}-sku`,
      title: `Reward ${label}`,
      priceCents: 5_000n,
      contents: 'One unit.',
      fulfillmentCommitment: 'Ships when ready.',
      delivery: 'March 2027',
    })
    .returning({ id: campaignRewardPackages.id });

  const [faq] = await h.db
    .insert(campaignFaqs)
    .values({
      campaignId,
      question: 'When will I get it?',
      answer: 'We will let you know as soon as we can.',
    })
    .returning({ id: campaignFaqs.id });

  await h.db.insert(campaignReservationCapacity).values({
    campaignId,
    capCents: 5_000_000_00n,
    reservedSubtotalCents: 0n,
  });

  return {
    campaignId,
    founderUserId: founder.id,
    founderEmail: founder.email,
    rewardId: reward!.id,
    faqId: faq!.id,
    closeAt,
  };
}

async function seedBacker(campaignId: string, label: string): Promise<string> {
  const [identity] = await h.db
    .insert(backerIdentities)
    .values({
      campaignId,
      email: `${label}@example.com`,
      phone: `+1555${Math.floor(Math.random() * 10_000_000)}`,
      emailNormalized: `${label}@example.com`,
      phoneNormalized: `1555${label}`,
      dedupKey: randomUUID(),
    })
    .returning({ id: backerIdentities.id });
  return identity!.id;
}

/** An association with a minted, inactive tracking link — Phase 12a's shape. */
async function seedAssociation(
  campaignId: string,
  label: string,
  opts: { status?: string; membership?: 'initial_roster' | 'mid_campaign' } = {},
): Promise<{ associationId: string; prospectId: string; linkId: string }> {
  const [prospect] = await h.db
    .insert(affiliateProspects)
    .values({
      legalName: `Creator ${label}`,
      publicHandle: `@${label}`,
      email: `creator-${label}-${randomUUID().slice(0, 6)}@example.com`,
      subtype: 'social_creator',
      channelReference: `https://example.com/${label}`,
      audienceNiche: 'Productivity tools',
      campaignFit: 'Their audience buys tools like this one.',
      adminBio: 'Recruited for this campaign.',
      createdBy: 'admin:test',
    })
    .returning({ id: affiliateProspects.id });
  const prospectId = prospect!.id;

  const [association] = await h.db
    .insert(campaignAffiliateAssociations)
    .values({
      campaignId,
      affiliateId: randomUUID(),
      prospectId,
      status: (opts.status ?? 'ready') as never,
      rosterMembership: opts.membership ?? 'mid_campaign',
    })
    .returning({ id: campaignAffiliateAssociations.id });

  const [link] = await h.db
    .insert(trackingLinks)
    .values({
      associationId: association!.id,
      campaignId,
      code: `code-${label}-${randomUUID().slice(0, 8)}`,
      active: false,
    })
    .returning({ id: trackingLinks.id });

  return { associationId: association!.id, prospectId, linkId: link!.id };
}

/* ── Drift ─────────────────────────────────────────────────────────────────── */

describe('§20 registers do not drift from @proovd/shared', () => {
  it('restates every editable field with the same tier, label, and surface', () => {
    expect(EDITABLE_FIELDS.length).toBe(SHARED_FIELDS.length);
    for (const shared of SHARED_FIELDS) {
      const restated = tierFor(shared.surface, shared.field);
      expect(restated.tier).toBe(shared.tier);
      expect(restated.label).toBe(shared.label);
      expect(restated.specRef).toBe(shared.specRef);
    }
    expect([...EDIT_TIERS]).toEqual([...SHARED_TIERS]);
  });

  it('restates the FAQ commitment check, and the two agree on every case', () => {
    for (const text of [
      'It works on macOS.',
      'You will get it in March 2027.',
      'It costs US$49.',
      'Full refund any time.',
      'We ship within 30 days.',
      'Delivery is in December 2026 and it is $30, fully refundable.',
    ]) {
      expect(commitmentsIn(text).sort()).toEqual(sharedCommitmentsIn(text).sort());
    }
  });

  it('restates the comment rules and the earnings vocabulary', () => {
    for (const status of ['live', 'suspended', 'killed', 'closed_pending_capture']) {
      expect(commentsOpenFor(status)).toBe(sharedCommentsOpenFor(status));
    }
    expect(defaultCommentAuthorName(3)).toBe(sharedDefaultName(3));
    expect(displayNameRefusal('jordan', 'jordan@x.com')).toBe(
      sharedDisplayRefusal('jordan', 'jordan@x.com'),
    );
    expect([...EARNINGS_STATES]).toEqual([...SHARED_EARNINGS]);
    expect(EARNINGS_STATE_LABELS).toEqual(SHARED_EARNINGS_LABELS);
  });

  it('restates §20’s Creator obligations verbatim', () => {
    expect(CREATOR_OBLIGATIONS.length).toBe(SHARED_OBLIGATIONS.length);
    for (const shared of SHARED_OBLIGATIONS) {
      const restated = CREATOR_OBLIGATIONS.find((o) => o.key === shared.key);
      expect(restated?.statement).toBe(shared.statement);
      expect(restated?.enforcement).toBe(shared.enforcement);
    }
    expect(NO_ACTION_NEEDED).toBe(SHARED_NO_ACTION);
  });
});

/* ── §33.6.12 ─────────────────────────────────────────────────────────────── */

describe('§33.6.12 — a non-material live edit versions; a material one cannot publish directly', () => {
  it('writes a column-one edit now, with prior and new value in the history', async () => {
    const fixture = await seedLiveCampaign('direct');

    const outcome = await applyLiveEdit(h.db, { audit }, {
      campaignId: fixture.campaignId,
      campaignStatus: 'live',
      surface: 'build',
      field: 'communityUrl',
      value: 'https://example.com/new-community',
      actor: 'user:founder',
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok || outcome.tier !== 'direct_versioned') throw new Error('expected a direct edit');

    // The value actually moved.
    const [build] = await h.db
      .select({ communityUrl: campaignBuild.communityUrl })
      .from(campaignBuild)
      .where(eq(campaignBuild.campaignId, fixture.campaignId));
    expect(build!.communityUrl).toBe('https://example.com/new-community');

    // §20: "with version history" — both halves.
    const edits = await listLiveEdits(h.db, fixture.campaignId);
    expect(edits).toHaveLength(1);
    expect(edits[0]!.priorValue).toBe('https://example.com/community');
    expect(edits[0]!.newValue).toBe('https://example.com/new-community');
    expect(edits[0]!.actor).toBe('user:founder');
  });

  it('reads the prior value from the row, never from the caller', async () => {
    const fixture = await seedLiveCampaign('priorvalue');
    await applyLiveEdit(h.db, { audit }, {
      campaignId: fixture.campaignId,
      campaignStatus: 'live',
      surface: 'build',
      field: 'brandVoice',
      value: 'Playful.',
      actor: 'user:founder',
    });
    const edits = await listLiveEdits(h.db, fixture.campaignId);
    // The seeded value, not anything a request could have claimed.
    expect(edits[0]!.priorValue).toBe('Warm and direct.');
  });

  it('refuses to publish a column-two edit and opens a change request instead', async () => {
    const fixture = await seedLiveCampaign('review');

    const outcome = await applyLiveEdit(h.db, { audit }, {
      campaignId: fixture.campaignId,
      campaignStatus: 'live',
      surface: 'build',
      field: 'deliveryWindow',
      value: 'June 2027',
      reason: 'Our manufacturer moved.',
      actor: 'user:founder',
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok || outcome.tier !== 'requires_review') throw new Error('expected a request');

    // The stored value did NOT move. This is the half of §33.6.12 that matters.
    const [build] = await h.db
      .select({ deliveryWindow: campaignBuild.deliveryWindow })
      .from(campaignBuild)
      .where(eq(campaignBuild.campaignId, fixture.campaignId));
    expect(build!.deliveryWindow).toBe('March 2027');

    // And nothing was written to the direct-edit history either.
    expect(await listLiveEdits(h.db, fixture.campaignId)).toHaveLength(0);

    expect(outcome.request.status).toBe('open');
    expect(outcome.request.currentValue).toBe('March 2027');
    expect(outcome.request.requestedValue).toBe('June 2027');
  });

  it('requires a reason before it will even open a request', async () => {
    const fixture = await seedLiveCampaign('noreason');
    const outcome = await applyLiveEdit(h.db, { audit }, {
      campaignId: fixture.campaignId,
      campaignStatus: 'live',
      surface: 'build',
      field: 'publicStory',
      value: 'A different story.',
      actor: 'user:founder',
    });
    expect(outcome).toMatchObject({ ok: false, code: 'invalid_value' });
  });

  it('refuses a column-three field outright, with no request path', async () => {
    const fixture = await seedLiveCampaign('never');

    for (const [surface, field, value] of [
      ['build', 'orderThreshold', 99],
      ['build', 'internalTargetCents', '9999'],
      ['campaign', 'type', 'pre_build'],
      ['reservation', 'rewardSku', 'other'],
      ['agreement', 'basePercent', 40],
    ] as const) {
      const outcome = await applyLiveEdit(h.db, { audit }, {
        campaignId: fixture.campaignId,
        campaignStatus: 'live',
        surface,
        field,
        value,
        reason: 'I would like to.',
        actor: 'user:founder',
      });
      expect(outcome).toMatchObject({ ok: false, code: 'never_direct' });
    }

    // No request was opened for any of them — column three is a different
    // answer, not a slower column two.
    const requests = await h.db
      .select()
      .from(campaignChangeRequests)
      .where(eq(campaignChangeRequests.campaignId, fixture.campaignId));
    expect(requests).toHaveLength(0);

    // And the campaign type is untouched.
    const [campaign] = await h.db
      .select({ type: campaigns.type })
      .from(campaigns)
      .where(eq(campaigns.id, fixture.campaignId));
    expect(campaign!.type).toBe('pre_launch');
  });

  it('applies an approved request through §15’s machine, versioning and creating reacceptance', async () => {
    const fixture = await seedLiveCampaign('applied');
    const creator = await seedAssociation(fixture.campaignId, 'applied', { status: 'active' });

    const opened = await applyLiveEdit(h.db, { audit }, {
      campaignId: fixture.campaignId,
      campaignStatus: 'live',
      surface: 'build',
      field: 'deliveryWindow',
      value: 'June 2027',
      reason: 'Our manufacturer moved.',
      actor: 'user:founder',
    });
    if (!opened.ok || opened.tier !== 'requires_review') throw new Error('expected a request');

    const decided = await decideChangeRequest(h.db, { audit }, {
      requestId: opened.request.id,
      decision: 'applied',
      classification: 'material',
      affectedCreators: [creator.associationId],
      decisionReason: 'A delivery date change is material to the Creators who promoted it.',
      actor: 'admin:1',
    });
    expect(decided.ok).toBe(true);
    if (!decided.ok) return;

    // The value moved only now.
    const [build] = await h.db
      .select({ deliveryWindow: campaignBuild.deliveryWindow })
      .from(campaignBuild)
      .where(eq(campaignBuild.campaignId, fixture.campaignId));
    expect(build!.deliveryWindow).toBe('June 2027');

    // §15's machine ran: a version and one reacceptance task per affected Creator.
    const changes = await h.db
      .select()
      .from(materialChanges)
      .where(eq(materialChanges.campaignId, fixture.campaignId));
    expect(changes).toHaveLength(1);
    expect(changes[0]!.classification).toBe('material');
    expect(changes[0]!.newVersion).toBe(1);

    const tasks = await h.db
      .select()
      .from(materialChangeReacceptances)
      .where(eq(materialChangeReacceptances.campaignId, fixture.campaignId));
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.associationId).toBe(creator.associationId);
    expect(tasks[0]!.decision).toBe('pending');

    // The request points at the change that applied it.
    expect(decided.request.materialChangeId).toBe(changes[0]!.id);
  });

  it('refuses to apply a request without Admin’s recorded classification (§15)', async () => {
    const fixture = await seedLiveCampaign('noclass');
    const opened = await applyLiveEdit(h.db, { audit }, {
      campaignId: fixture.campaignId,
      campaignStatus: 'live',
      surface: 'build',
      field: 'publicStory',
      value: 'A revised story.',
      reason: 'Clearer wording.',
      actor: 'user:founder',
    });
    if (!opened.ok || opened.tier !== 'requires_review') throw new Error('expected a request');

    const decided = await decideChangeRequest(h.db, { audit }, {
      requestId: opened.request.id,
      decision: 'applied',
      decisionReason: 'Looks fine.',
      actor: 'admin:1',
    });
    expect(decided).toMatchObject({ ok: false, code: 'invalid_value' });

    // Nothing moved.
    const [build] = await h.db
      .select({ publicStory: campaignBuild.publicStory })
      .from(campaignBuild)
      .where(eq(campaignBuild.campaignId, fixture.campaignId));
    expect(build!.publicStory).toBe('The original approved story.');
  });

  it('a declined request changes nothing and cannot be decided twice', async () => {
    const fixture = await seedLiveCampaign('declined');
    const opened = await applyLiveEdit(h.db, { audit }, {
      campaignId: fixture.campaignId,
      campaignStatus: 'live',
      surface: 'build',
      field: 'closesAt',
      value: new Date(Date.now() + 40 * 86_400_000).toISOString(),
      reason: 'We want longer.',
      actor: 'user:founder',
    });
    if (!opened.ok || opened.tier !== 'requires_review') throw new Error('expected a request');

    const first = await decideChangeRequest(h.db, { audit }, {
      requestId: opened.request.id,
      decision: 'declined',
      decisionReason: 'Backers agreed to a charge rule naming the current close date.',
      actor: 'admin:1',
    });
    expect(first.ok).toBe(true);

    const [build] = await h.db
      .select({ closesAt: campaignBuild.closesAt })
      .from(campaignBuild)
      .where(eq(campaignBuild.campaignId, fixture.campaignId));
    expect(build!.closesAt?.toISOString()).toBe(fixture.closeAt.toISOString());

    const second = await decideChangeRequest(h.db, { audit }, {
      requestId: opened.request.id,
      decision: 'applied',
      classification: 'material',
      decisionReason: 'Changed my mind.',
      actor: 'admin:1',
    });
    expect(second).toMatchObject({ ok: false, code: 'already_decided' });
  });

  it('refuses a second open request for the same field', async () => {
    const fixture = await seedLiveCampaign('doublerequest');
    const args = {
      campaignId: fixture.campaignId,
      campaignStatus: 'live' as const,
      surface: 'build' as const,
      field: 'publicStory',
      value: 'v2',
      reason: 'Clearer.',
      actor: 'user:founder',
    };
    expect((await applyLiveEdit(h.db, { audit }, args)).ok).toBe(true);
    expect(await applyLiveEdit(h.db, { audit }, { ...args, value: 'v3' })).toMatchObject({
      ok: false,
      code: 'request_open',
    });
  });

  it('the direct-edit history is insert-only', async () => {
    const fixture = await seedLiveCampaign('insertonly');
    await applyLiveEdit(h.db, { audit }, {
      campaignId: fixture.campaignId,
      campaignStatus: 'live',
      surface: 'build',
      field: 'heroPreference',
      value: 'Video first.',
      actor: 'user:founder',
    });

    await expect(
      h.db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE proovd_app`);
        await tx.execute(
          sql`UPDATE campaign_live_edits SET new_value = '"rewritten"'::jsonb
              WHERE campaign_id = ${fixture.campaignId}`,
        );
      }),
    ).rejects.toThrow();
  });

  it('refuses every edit on a campaign that is not live', async () => {
    const fixture = await seedLiveCampaign('notlive', { status: 'approved' });
    const outcome = await applyLiveEdit(h.db, { audit }, {
      campaignId: fixture.campaignId,
      campaignStatus: 'approved',
      surface: 'build',
      field: 'communityUrl',
      value: 'https://example.com/x',
      actor: 'user:founder',
    });
    expect(outcome).toMatchObject({ ok: false, code: 'not_live' });
  });

  it('serves the one edit route over HTTP, scoped to the session', async () => {
    const fixture = await seedLiveCampaign('http');
    const cookie = await signInPlain(h, fixture.founderEmail);

    const direct = await request(h.app)
      .post(`/api/founder/campaigns/${fixture.campaignId}/live-edit`)
      .set('cookie', cookie)
      .send({ surface: 'build', field: 'brandPerception', value: 'Calm and credible.' });
    expect(direct.status).toBe(200);
    expect(direct.body.tier).toBe('direct_versioned');

    const routed = await request(h.app)
      .post(`/api/founder/campaigns/${fixture.campaignId}/live-edit`)
      .set('cookie', cookie)
      .send({
        surface: 'build',
        field: 'refundPolicyText',
        value: 'No refunds.',
        reason: 'Our policy changed.',
      });
    expect(routed.status).toBe(202);
    expect(routed.body.tier).toBe('requires_review');

    const refused = await request(h.app)
      .post(`/api/founder/campaigns/${fixture.campaignId}/live-edit`)
      .set('cookie', cookie)
      .send({ surface: 'build', field: 'orderThreshold', value: 5 });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe('never_direct');

    // Another Founder's campaign is the same 404 a missing one gets.
    const stranger = await seedLiveCampaign('httpstranger');
    const denied = await request(h.app)
      .post(`/api/founder/campaigns/${stranger.campaignId}/live-edit`)
      .set('cookie', cookie)
      .send({ surface: 'build', field: 'brandVoice', value: 'x' });
    expect(denied.status).toBe(404);
  });
});

/* ── The §20 FAQ loophole ─────────────────────────────────────────────────── */

describe('§20 — an FAQ cannot silently change a promise locked elsewhere', () => {
  it('lets a genuine clarification publish directly', async () => {
    const fixture = await seedLiveCampaign('faqclear');
    const outcome = await applyLiveEdit(h.db, { audit }, {
      campaignId: fixture.campaignId,
      campaignStatus: 'live',
      surface: 'faq',
      field: 'answer',
      targetId: fixture.faqId,
      value: 'It works on macOS and Windows. We will email you a download link.',
      actor: 'user:founder',
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.tier).toBe('direct_versioned');

    const [faq] = await h.db
      .select({ answer: campaignFaqs.answer })
      .from(campaignFaqs)
      .where(eq(campaignFaqs.id, fixture.faqId));
    expect(faq!.answer).toContain('macOS and Windows');
  });

  it('routes §20’s own example — "when will I get it?" — to review', async () => {
    const fixture = await seedLiveCampaign('faqdate');

    // No reason supplied: the refusal explains what it found.
    const refused = await applyLiveEdit(h.db, { audit }, {
      campaignId: fixture.campaignId,
      campaignStatus: 'live',
      surface: 'faq',
      field: 'answer',
      targetId: fixture.faqId,
      value: 'You will get it in June 2027.',
      actor: 'user:founder',
    });
    expect(refused).toMatchObject({ ok: false, code: 'invalid_value' });
    if (!refused.ok) expect(refused.message).toContain('date');

    // The FAQ did not move.
    const [before] = await h.db
      .select({ answer: campaignFaqs.answer })
      .from(campaignFaqs)
      .where(eq(campaignFaqs.id, fixture.faqId));
    expect(before!.answer).toBe('We will let you know as soon as we can.');

    // With a reason it becomes a request — §20's own destination.
    const routed = await applyLiveEdit(h.db, { audit }, {
      campaignId: fixture.campaignId,
      campaignStatus: 'live',
      surface: 'faq',
      field: 'answer',
      targetId: fixture.faqId,
      value: 'You will get it in June 2027.',
      reason: 'Backers keep asking.',
      actor: 'user:founder',
    });
    expect(routed.ok).toBe(true);
    if (!routed.ok || routed.tier !== 'requires_review') throw new Error('expected a request');
    expect(routed.redirectedBy).toBe('faq_commitment');
    expect(routed.commitments).toContain('date');

    // And still nothing published.
    const [after] = await h.db
      .select({ answer: campaignFaqs.answer })
      .from(campaignFaqs)
      .where(eq(campaignFaqs.id, fixture.faqId));
    expect(after!.answer).toBe('We will let you know as soon as we can.');
  });

  it('catches a price and a refund term in an FAQ answer too', async () => {
    const fixture = await seedLiveCampaign('faqprice');
    for (const answer of ['It is US$19 for backers.', 'You can get a full refund any time.']) {
      const outcome = await applyLiveEdit(h.db, { audit }, {
        campaignId: fixture.campaignId,
        campaignStatus: 'live',
        surface: 'faq',
        field: 'answer',
        targetId: fixture.faqId,
        value: answer,
        reason: 'Clarifying.',
        actor: 'user:founder',
      });
      expect(outcome.ok).toBe(true);
      if (outcome.ok) expect(outcome.tier).toBe('requires_review');

      // Clear the open request so the next iteration is not a duplicate.
      await h.db
        .update(campaignChangeRequests)
        .set({
          status: 'declined',
          decidedBy: 'admin:test',
          decidedAt: new Date(),
          decisionReason: 'test cleanup',
        })
        .where(
          and(
            eq(campaignChangeRequests.campaignId, fixture.campaignId),
            eq(campaignChangeRequests.status, 'open'),
          ),
        );
    }
  });

  /*
   * Phase 17b scanned only the FAQ answer, on the reading that "only the answer
   * states promises". That is an assertion about English, and it does not hold:
   * a question rendered on the page can carry a date as easily as an answer can,
   * and a Founder rewriting "When will I get it?" as "Will it arrive by March
   * 2027?" has put a delivery claim on the public page without a reviewer seeing
   * it — which is the loophole §20 names, reached through the other half of the
   * same record. The check now runs on every column-one field that is not
   * exempt by name, and `COMMITMENT_CHECK_EXEMPT` carries a written reason for
   * each one that is (a URL, a closed shape vocabulary). Broad is the correct
   * direction: a false positive costs a review, a false negative moves a date
   * nobody accepted.
   */
  it('a question that states no promise still publishes directly', async () => {
    const fixture = await seedLiveCampaign('faqquestion');
    const outcome = await applyLiveEdit(h.db, { audit }, {
      campaignId: fixture.campaignId,
      campaignStatus: 'live',
      surface: 'faq',
      field: 'question',
      targetId: fixture.faqId,
      value: 'How do I change which reward I chose?',
      actor: 'user:founder',
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.tier).toBe('direct_versioned');
  });

  it('a question that states a delivery date goes to review, like the answer', async () => {
    const fixture = await seedLiveCampaign('faqquestiondate');

    // With no reason, the refusal is what tells the Founder a promise was
    // detected — and it names the field rather than saying "that answer", which
    // would be wrong on the question half of the same record.
    const refused = await applyLiveEdit(h.db, { audit }, {
      campaignId: fixture.campaignId,
      campaignStatus: 'live',
      surface: 'faq',
      field: 'question',
      targetId: fixture.faqId,
      value: 'Will it arrive by March 2027?',
      actor: 'user:founder',
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.message).toContain('FAQ question');
      expect(refused.message).toContain('delivery');
      expect(refused.message).not.toContain('That answer states');
    }

    const outcome = await applyLiveEdit(h.db, { audit }, {
      campaignId: fixture.campaignId,
      campaignStatus: 'live',
      surface: 'faq',
      field: 'question',
      targetId: fixture.faqId,
      value: 'Will it arrive by March 2027?',
      reason: 'Backers keep asking whether the window slipped.',
      actor: 'user:founder',
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.tier).toBe('requires_review');
      // `field_commitment`, not `faq_commitment`: the two produce different
      // messages, and collapsing them would lose which loophole was closed.
      expect(outcome.redirectedBy).toBe('field_commitment');
      expect(outcome.commitments).toContain('delivery');
    }

    // The value did not publish. §20's whole point is that the page is unchanged
    // until a reviewer decides.
    const [faq] = await h.db
      .select()
      .from(campaignFaqs)
      .where(eq(campaignFaqs.id, fixture.faqId));
    expect(faq?.question).not.toBe('Will it arrive by March 2027?');
  });

  it('a section heading is inside the same check, and a URL is exempt with a reason', async () => {
    const fixture = await seedLiveCampaign('headingcommit');

    const heading = await applyLiveEdit(h.db, { audit }, {
      campaignId: fixture.campaignId,
      campaignStatus: 'live',
      surface: 'build',
      field: 'rewardsHeading',
      value: 'Choose your package — ships by March 2027',
      reason: 'Making the shipping month easier to find.',
      actor: 'user:founder',
    });
    expect(heading.ok).toBe(true);
    if (heading.ok) {
      expect(heading.tier).toBe('requires_review');
      expect(heading.redirectedBy).toBe('field_commitment');
    }

    // A heading with no promise in it still publishes straight away — the check
    // is about what the words say, not about which box they were typed into.
    const plain = await applyLiveEdit(h.db, { audit }, {
      campaignId: fixture.campaignId,
      campaignStatus: 'live',
      surface: 'build',
      field: 'benefitsHeading',
      value: 'Why this lamp',
      actor: 'user:founder',
    });
    expect(plain.ok).toBe(true);
    if (plain.ok) expect(plain.tier).toBe('direct_versioned');

    // The two exempt build fields are URLs, and the reason is written down
    // rather than being a silent hole in the check.
    expect(COMMITMENT_CHECK_EXEMPT['build:communityUrl']).toBeTruthy();
    expect(commitmentCheckApplies('build', 'communityUrl')).toBe(false);
    expect(commitmentCheckApplies('faq', 'question')).toBe(true);
  });
});

/* ── §33.6.13 ─────────────────────────────────────────────────────────────── */

describe('§33.6.13 — a mid-campaign Creator gets remaining-time terms and no retroactive credit', () => {
  it('computes exact remaining time and the campaign’s locked high-effort result', async () => {
    const fixture = await seedLiveCampaign('midterms', { closeInDays: 9 });
    const terms = await readMidCampaignTerms(h.db, fixture.campaignId);
    if ('code' in terms) throw new Error(`expected terms, got ${terms.code}`);

    expect(terms.remainingHours).toBeGreaterThan(9 * 24 - 2);
    expect(terms.remainingHours).toBeLessThanOrEqual(9 * 24);
    // §20: the campaign's locked result, copied.
    expect(terms.highEffort).toBe(true);
    expect(terms.adjustedDeliverables).toContain('8 days');
    expect(terms.adjustedDeliverables).toContain('remaining window');
  });

  it('records the terms as they were shown, and freezes them', async () => {
    const fixture = await seedLiveCampaign('midrecord', { closeInDays: 9 });
    const creator = await seedAssociation(fixture.campaignId, 'midrecord');

    const opened = await openMidCampaignAddition(h.db, { audit }, {
      associationId: creator.associationId,
      actor: 'admin:1',
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.addition.highEffortAtJoin).toBe(true);
    expect(opened.addition.remainingHours).toBe(opened.terms.remainingHours);

    // A Creator who joined with nine days left accepted a nine-day deliverable.
    await expect(
      h.db.execute(sql`
        UPDATE mid_campaign_additions SET remaining_hours = 1
        WHERE association_id = ${creator.associationId}
      `),
    ).rejects.toThrow();
  });

  it('sets a NEW activated_at, so prior clicks earn nothing', async () => {
    const fixture = await seedLiveCampaign('midattr');
    const creator = await seedAssociation(fixture.campaignId, 'midattr', { status: 'ready' });
    await openMidCampaignAddition(h.db, { audit }, {
      associationId: creator.associationId,
      actor: 'admin:1',
    });

    // Traffic that happened before this Creator existed on the campaign.
    const earlier = new Date(Date.now() - 3 * 86_400_000);
    await h.db.insert(trackingLinkClicks).values({
      campaignId: fixture.campaignId,
      trackingLinkId: creator.linkId,
      associationId: creator.associationId,
      visitorId: randomUUID(),
      clickedAt: earlier,
      outcome: 'ignored',
      ignoredReason: 'before_activation',
    });

    const activated = await activateMidCampaignCreator(h.db, { audit }, {
      associationId: creator.associationId,
      actor: 'admin:1',
    });
    expect(activated.ok).toBe(true);
    if (!activated.ok) return;

    const [link] = await h.db
      .select({ activatedAt: trackingLinks.activatedAt, active: trackingLinks.active })
      .from(trackingLinks)
      .where(eq(trackingLinks.id, creator.linkId));

    expect(link!.active).toBe(true);
    // The activation instant is now, NOT the campaign's launch — which is the
    // whole of "no retroactive attribution".
    const [campaign] = await h.db
      .select({ liveAt: campaigns.campaignLiveAt })
      .from(campaigns)
      .where(eq(campaigns.id, fixture.campaignId));
    expect(link!.activatedAt!.getTime()).toBeGreaterThan(campaign!.liveAt!.getTime());
    expect(link!.activatedAt!.getTime()).toBeGreaterThan(earlier.getTime());

    // The earlier click is still recorded as earning nothing, with its reason.
    const clicks = await h.db
      .select()
      .from(trackingLinkClicks)
      .where(eq(trackingLinkClicks.associationId, creator.associationId));
    expect(clicks).toHaveLength(1);
    expect(clicks[0]!.outcome).toBe('ignored');
    expect(clicks[0]!.ignoredReason).toBe('before_activation');
  });

  it('requires readiness — joining late relaxes nothing', async () => {
    const fixture = await seedLiveCampaign('midready');
    const creator = await seedAssociation(fixture.campaignId, 'midready', {
      status: 'readiness_blocked',
    });
    const outcome = await activateMidCampaignCreator(h.db, { audit }, {
      associationId: creator.associationId,
      actor: 'admin:1',
    });
    expect(outcome).toMatchObject({ ok: false, code: 'not_ready' });

    const [link] = await h.db
      .select({ active: trackingLinks.active })
      .from(trackingLinks)
      .where(eq(trackingLinks.id, creator.linkId));
    expect(link!.active).toBe(false);
  });

  it('the active-partnership cap blocks a fourth concurrent slot (§2.2)', async () => {
    const fixture = await seedLiveCampaign('midcap');
    const [prospect] = await h.db
      .insert(affiliateProspects)
      .values({
        legalName: 'Busy Creator',
        publicHandle: '@busy',
        email: `busy-${randomUUID().slice(0, 6)}@example.com`,
        subtype: 'social_creator',
        channelReference: 'https://example.com/busy',
        audienceNiche: 'Tools',
        campaignFit: 'Fits.',
        adminBio: 'Already busy.',
        createdBy: 'admin:test',
      })
      .returning({ id: affiliateProspects.id });
    const prospectId = prospect!.id;

    // Three campaigns where this person is already active.
    for (let i = 0; i < 3; i += 1) {
      const other = await seedLiveCampaign(`midcap-other-${i}`);
      await h.db.insert(campaignAffiliateAssociations).values({
        campaignId: other.campaignId,
        affiliateId: randomUUID(),
        prospectId,
        status: 'active',
        rosterMembership: 'initial_roster',
      });
    }

    const [fourth] = await h.db
      .insert(campaignAffiliateAssociations)
      .values({
        campaignId: fixture.campaignId,
        affiliateId: randomUUID(),
        prospectId,
        status: 'ready',
        rosterMembership: 'mid_campaign',
      })
      .returning({ id: campaignAffiliateAssociations.id });

    const outcome = await openMidCampaignAddition(h.db, { audit }, {
      associationId: fourth!.id,
      actor: 'admin:1',
    });
    expect(outcome).toMatchObject({ ok: false, code: 'slot_limit' });
  });

  it('an ended campaign rejects addition', async () => {
    for (const status of ['closed_pending_capture', 'ended_no_charge', 'killed', 'suspended']) {
      const fixture = await seedLiveCampaign(`midended-${status}`, { status });
      const terms = await readMidCampaignTerms(h.db, fixture.campaignId);
      expect(terms).toMatchObject({ code: 'not_live' });
    }
  });

  it('a failed, refunded no-acceptance campaign cannot be revived by a late Creator', async () => {
    const fixture = await seedLiveCampaign('midrevive', { status: 'refunded_no_creator' });
    const terms = await readMidCampaignTerms(h.db, fixture.campaignId);
    expect(terms).toMatchObject({ code: 'cannot_be_revived' });

    const creator = await seedAssociation(fixture.campaignId, 'midrevive');
    const outcome = await openMidCampaignAddition(h.db, { audit }, {
      associationId: creator.associationId,
      actor: 'admin:1',
    });
    expect(outcome).toMatchObject({ ok: false, code: 'cannot_be_revived' });
  });

  it('a campaign already past its close rejects addition', async () => {
    const fixture = await seedLiveCampaign('midpast');
    await h.db
      .update(campaigns)
      .set({ campaignCloseAt: new Date(Date.now() - 3_600_000) })
      .where(eq(campaigns.id, fixture.campaignId));
    const terms = await readMidCampaignTerms(h.db, fixture.campaignId);
    expect(terms).toMatchObject({ code: 'already_closed' });
  });

  it('changes no public term, no other Creator’s terms, and does not reopen review', async () => {
    const fixture = await seedLiveCampaign('midnochange');
    const existing = await seedAssociation(fixture.campaignId, 'midexisting', {
      status: 'active',
      membership: 'initial_roster',
    });
    const joiner = await seedAssociation(fixture.campaignId, 'midjoiner', { status: 'ready' });

    const [beforeBuild] = await h.db
      .select()
      .from(campaignBuild)
      .where(eq(campaignBuild.campaignId, fixture.campaignId));
    const [beforeExisting] = await h.db
      .select()
      .from(campaignAffiliateAssociations)
      .where(eq(campaignAffiliateAssociations.id, existing.associationId));

    await openMidCampaignAddition(h.db, { audit }, {
      associationId: joiner.associationId,
      actor: 'admin:1',
    });
    await activateMidCampaignCreator(h.db, { audit }, {
      associationId: joiner.associationId,
      actor: 'admin:1',
    });

    const [afterBuild] = await h.db
      .select()
      .from(campaignBuild)
      .where(eq(campaignBuild.campaignId, fixture.campaignId));
    const [afterExisting] = await h.db
      .select()
      .from(campaignAffiliateAssociations)
      .where(eq(campaignAffiliateAssociations.id, existing.associationId));
    const [campaign] = await h.db
      .select({ status: campaigns.status })
      .from(campaigns)
      .where(eq(campaigns.id, fixture.campaignId));

    expect(afterBuild).toEqual(beforeBuild);
    expect(afterExisting!.status).toBe(beforeExisting!.status);
    // §20: "Do not reopen campaign review."
    expect(campaign!.status).toBe('live');
  });

  it('records one addition per association', async () => {
    const fixture = await seedLiveCampaign('midonce');
    const creator = await seedAssociation(fixture.campaignId, 'midonce');
    expect((await openMidCampaignAddition(h.db, { audit }, {
      associationId: creator.associationId,
      actor: 'admin:1',
    })).ok).toBe(true);
    expect(
      await openMidCampaignAddition(h.db, { audit }, {
        associationId: creator.associationId,
        actor: 'admin:1',
      }),
    ).toMatchObject({ ok: false, code: 'already_added' });
  });
});

/* ── §18's comment thread ─────────────────────────────────────────────────── */

describe('§18 — the comment thread', () => {
  it('posts to the general thread and names the Backer by number', async () => {
    const fixture = await seedLiveCampaign('comments');
    const backer = await seedBacker(fixture.campaignId, 'commenter1');

    const outcome = await postComment(h.db, { audit }, {
      campaignId: fixture.campaignId,
      backerIdentityId: backer,
      body: 'Looking forward to this.',
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.comment.authorDisplay).toBe('Backer 1');
    expect(outcome.comment.updateId).toBeNull();

    const second = await seedBacker(fixture.campaignId, 'commenter2');
    const next = await postComment(h.db, { audit }, {
      campaignId: fixture.campaignId,
      backerIdentityId: second,
      body: 'Same here.',
    });
    if (!next.ok) throw new Error('expected a comment');
    expect(next.comment.authorDisplay).toBe('Backer 2');

    // The same Backer keeps their number.
    const again = await postComment(h.db, { audit }, {
      campaignId: fixture.campaignId,
      backerIdentityId: backer,
      body: 'One more thing.',
    });
    if (!again.ok) throw new Error('expected a comment');
    expect(again.comment.authorDisplay).toBe('Backer 1');
  });

  it('numbers restart per campaign, so the number leaks no platform volume', async () => {
    const a = await seedLiveCampaign('numbersa');
    const b = await seedLiveCampaign('numbersb');
    const backerA = await seedBacker(a.campaignId, 'na');
    const backerB = await seedBacker(b.campaignId, 'nb');

    const first = await postComment(h.db, { audit }, {
      campaignId: a.campaignId,
      backerIdentityId: backerA,
      body: 'Hello.',
    });
    const other = await postComment(h.db, { audit }, {
      campaignId: b.campaignId,
      backerIdentityId: backerB,
      body: 'Hello.',
    });
    if (!first.ok || !other.ok) throw new Error('expected comments');
    expect(first.comment.authorDisplay).toBe('Backer 1');
    expect(other.comment.authorDisplay).toBe('Backer 1');
  });

  it('accepts a chosen display name but never the Backer’s own email local part', async () => {
    const fixture = await seedLiveCampaign('displayname');
    const backer = await seedBacker(fixture.campaignId, 'jordan');

    const refused = await postComment(h.db, { audit }, {
      campaignId: fixture.campaignId,
      backerIdentityId: backer,
      body: 'Hello.',
      displayName: 'jordan',
    });
    expect(refused).toMatchObject({ ok: false, code: 'display_name_refused' });

    const ok = await postComment(h.db, { audit }, {
      campaignId: fixture.campaignId,
      backerIdentityId: backer,
      body: 'Hello.',
      displayName: 'Jordan R.',
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.comment.authorDisplay).toBe('Jordan R.');
  });

  it('refuses an address as a display name at the database level too', async () => {
    const fixture = await seedLiveCampaign('addressname');
    const backer = await seedBacker(fixture.campaignId, 'addr');
    await expect(
      h.db.insert(campaignComments).values({
        campaignId: fixture.campaignId,
        backerIdentityId: backer,
        authorDisplay: 'someone@example.com',
        body: 'Hello.',
      }),
    ).rejects.toThrow();
  });

  it('holds one thread per update as well as the general one', async () => {
    const fixture = await seedLiveCampaign('threads');
    const backer = await seedBacker(fixture.campaignId, 'threader');
    const [update] = await h.db
      .insert(campaignUpdates)
      .values({
        campaignId: fixture.campaignId,
        author: 'user:founder',
        audience: 'general_public',
        body: 'Progress so far.',
        publishedAt: new Date(),
      })
      .returning({ id: campaignUpdates.id });

    await postComment(h.db, { audit }, {
      campaignId: fixture.campaignId,
      backerIdentityId: backer,
      body: 'On the general thread.',
    });
    await postComment(h.db, { audit }, {
      campaignId: fixture.campaignId,
      backerIdentityId: backer,
      updateId: update!.id,
      body: 'On the update thread.',
    });

    const general = await readCommentThread(h.db, { campaignId: fixture.campaignId });
    expect(general!.comments.map((c) => c.body)).toEqual(['On the general thread.']);

    const onUpdate = await readCommentThread(h.db, {
      campaignId: fixture.campaignId,
      updateId: update!.id,
    });
    expect(onUpdate!.comments.map((c) => c.body)).toEqual(['On the update thread.']);
  });

  it('disables new comments after close, suspension, or kill — and keeps reading open', async () => {
    const fixture = await seedLiveCampaign('closedcomments');
    const backer = await seedBacker(fixture.campaignId, 'closer');
    await postComment(h.db, { audit }, {
      campaignId: fixture.campaignId,
      backerIdentityId: backer,
      body: 'Posted while live.',
    });

    await h.db
      .update(campaigns)
      .set({ status: 'closed_pending_capture' })
      .where(eq(campaigns.id, fixture.campaignId));

    const refused = await postComment(h.db, { audit }, {
      campaignId: fixture.campaignId,
      backerIdentityId: backer,
      body: 'Posted after close.',
    });
    expect(refused).toMatchObject({ ok: false, code: 'comments_closed' });

    // §18's ended-state contract: reading stays open.
    const thread = await readCommentThread(h.db, { campaignId: fixture.campaignId });
    expect(thread!.open).toBe(false);
    expect(thread!.closedReason).toBeTruthy();
    expect(thread!.comments).toHaveLength(1);
  });

  it('a posted comment cannot be rewritten', async () => {
    const fixture = await seedLiveCampaign('immutablecomment');
    const backer = await seedBacker(fixture.campaignId, 'immutable');
    const posted = await postComment(h.db, { audit }, {
      campaignId: fixture.campaignId,
      backerIdentityId: backer,
      body: 'Original.',
    });
    if (!posted.ok) throw new Error('expected a comment');

    await expect(
      h.db.execute(sql`
        UPDATE campaign_comments SET body = 'rewritten' WHERE id = ${posted.comment.id}
      `),
    ).rejects.toThrow(/cannot be rewritten|Failed query/i);
  });

  it('flagging routes to a person and hides nothing', async () => {
    const fixture = await seedLiveCampaign('flagging');
    const backer = await seedBacker(fixture.campaignId, 'flagged');
    const reporter = await seedBacker(fixture.campaignId, 'reporter');
    const posted = await postComment(h.db, { audit }, {
      campaignId: fixture.campaignId,
      backerIdentityId: backer,
      body: 'Something objectionable.',
    });
    if (!posted.ok) throw new Error('expected a comment');

    const flagged = await flagComment(h.db, { audit }, {
      commentId: posted.comment.id,
      reportedBy: `backer:${reporter}`,
      reason: 'This looks like spam.',
    });
    expect(flagged.ok).toBe(true);

    // Still visible — auto-hiding would hand every reader a removal button.
    const thread = await readCommentThread(h.db, { campaignId: fixture.campaignId });
    expect(thread!.comments).toHaveLength(1);

    // One open flag per reporter.
    expect(
      await flagComment(h.db, { audit }, {
        commentId: posted.comment.id,
        reportedBy: `backer:${reporter}`,
        reason: 'Again.',
      }),
    ).toMatchObject({ ok: false, code: 'already_flagged' });

    // Admin decides; upholding removes it with a reason recorded.
    if (!flagged.ok) return;
    const decided = await decideFlag(h.db, { audit }, {
      flagId: flagged.flag.id,
      decision: 'upheld',
      decisionReason: 'Unsolicited promotion of an unrelated product.',
      actor: 'admin:1',
    });
    expect(decided).toMatchObject({ ok: true, removed: true });

    const after = await readCommentThread(h.db, { campaignId: fixture.campaignId });
    expect(after!.comments).toHaveLength(0);

    // The row survives with who removed it and why (§25.6).
    const [row] = await h.db
      .select()
      .from(campaignComments)
      .where(eq(campaignComments.id, posted.comment.id));
    expect(row!.visibility).toBe('removed');
    expect(row!.removedBy).toBe('admin:1');
    expect(row!.removedReason).toContain('Unsolicited');
  });

  it('dismissing a flag leaves the comment exactly as it was', async () => {
    const fixture = await seedLiveCampaign('dismissflag');
    const backer = await seedBacker(fixture.campaignId, 'dismissed');
    const posted = await postComment(h.db, { audit }, {
      campaignId: fixture.campaignId,
      backerIdentityId: backer,
      body: 'A fine comment.',
    });
    if (!posted.ok) throw new Error('expected a comment');
    const flagged = await flagComment(h.db, { audit }, {
      commentId: posted.comment.id,
      reportedBy: 'founder:someone',
      reason: 'I do not like it.',
    });
    if (!flagged.ok) throw new Error('expected a flag');

    await decideFlag(h.db, { audit }, {
      flagId: flagged.flag.id,
      decision: 'dismissed',
      decisionReason: 'Nothing wrong with it.',
      actor: 'admin:1',
    });

    const thread = await readCommentThread(h.db, { campaignId: fixture.campaignId });
    expect(thread!.comments).toHaveLength(1);
  });

  it('refuses an empty comment and one that is too long', async () => {
    const fixture = await seedLiveCampaign('commentlength');
    const backer = await seedBacker(fixture.campaignId, 'length');
    expect(
      await postComment(h.db, { audit }, {
        campaignId: fixture.campaignId,
        backerIdentityId: backer,
        body: '   ',
      }),
    ).toMatchObject({ ok: false, code: 'empty' });
    expect(
      await postComment(h.db, { audit }, {
        campaignId: fixture.campaignId,
        backerIdentityId: backer,
        body: 'x'.repeat(2_001),
      }),
    ).toMatchObject({ ok: false, code: 'too_long' });
  });

  it('there is no anonymous or Founder comment path', async () => {
    // §18 names only a magic-link-authenticated Backer. The column is NOT NULL,
    // so there is no row shape for anything else.
    const result = await h.db.execute(sql`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_name = 'campaign_comments' AND column_name = 'backer_identity_id'
    `);
    expect((result.rows[0] as { is_nullable: string }).is_nullable).toBe('NO');
  });
});

/* ── The Backer's cancellation stays one action (§20) ──────────────────────── */

describe('§20 — cancellation stays one action with no retention obstacle', () => {
  it('offers no competing action, no offer, and no confirmation step in the route surface', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(new URL('../routes/backer.ts', import.meta.url), 'utf8');

    // §30 forbids a retention obstacle. There is no discount, no "are you sure"
    // gate with an alternative, and no counter-offer anywhere on the path.
    for (const pattern of [/discount/i, /instead of cancelling/i, /special offer/i, /stay with/i]) {
      expect(source).not.toMatch(pattern);
    }
    // One cancel route, and it is a POST that cancels.
    const cancelRoutes = [...source.matchAll(/reservations\/:reservationId\/cancel/g)];
    expect(cancelRoutes).toHaveLength(1);
  });
});

/* ── §3.2 / §3.1 vocabulary ───────────────────────────────────────────────── */

describe('Phase 17b speaks the customer-facing vocabulary', () => {
  it('never uses a §3.2 holding-account word or an internal §3.1 name in its copy', async () => {
    const { readFile } = await import('node:fs/promises');
    const files = [
      '../campaign/live-editing.ts',
      '../campaign/editing-logic.ts',
      '../campaign/comments.ts',
      '../affiliates/mid-campaign.ts',
      '../affiliates/obligations.ts',
      '../routes/live-editing.ts',
    ];
    const banned = ['escrow', 'custody', 'held in a proovd account', 'all-or-nothing', 'pledge', 'donate'];
    for (const file of files) {
      const source = (await readFile(new URL(file, import.meta.url), 'utf8')).toLowerCase();
      for (const word of banned) {
        expect(source, `${file} contains "${word}"`).not.toContain(word);
      }
    }
  });
});
