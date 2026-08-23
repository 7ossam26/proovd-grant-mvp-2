/**
 * Phase 14b — the attribution contract and discovery timing.
 *
 * Acceptance: §33.6.1–5.
 *   §33.6.1  the last valid same-browser Creator link wins; a direct return
 *            preserves it.
 *   §33.6.2  a later valid click replaces the earlier; the cookie ends at close.
 *   §33.6.3  pre-activation, paused, post-close, and a mid-campaign Creator's
 *            prior traffic all earn nothing.
 *   §33.6.4  post-activation results stay provisional until verification.
 *   §33.6.5  Days 1–7 are known-link-only; the Day 8 discovery switch does not
 *            rewrite attribution.
 * Plus §14.1: the safe link-test action contaminates neither attribution nor
 * the ledger's conversion signal.
 *
 * Each scenario seeds its own live campaign directly — the readiness/launch
 * journey is Phase 12/13/14a's suite, already green; what is under test here is
 * what a click, a cookie, and the discovery sweep do.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';

import { startHarness, type Harness } from './app-harness.js';
import { seedUser } from './admin-session.js';
import { createAuditWriter } from '../auth/audit.js';
import {
  campaigns,
  campaignAffiliateAssociations,
} from '../db/schema/domain.js';
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
import { trackingLinkClicks } from '../db/schema/attribution.js';

import { launchCampaign } from '../launch/launch.js';
import { submitPost, verifyPost } from '../launch/post-verification.js';
import { FIRST_POST_CHECK_KEYS } from '../launch/logic.js';
import { recordClick, resolveAttribution } from '../attribution/service.js';
import { sweepDiscovery } from '../campaign/discovery.js';
import { attributionCookieName } from '../attribution/cookies.js';
import { LINK_TEST_MARKER } from '../affiliates/roster-labels.js';
import type { LaunchNotificationContext } from '../launch/notifications.js';

let h: Harness;
let audit: ReturnType<typeof createAuditWriter>;

const NOTICE_CONTEXT: LaunchNotificationContext = {
  appBaseUrl: 'http://localhost:3000',
  supportEmail: 'support@proovd.co',
  fromAddress: 'hello@proovd.co',
};

beforeAll(async () => {
  h = await startHarness({}, 'attribution');
  audit = createAuditWriter(h.db);
}, 180_000);

afterAll(async () => {
  await h.stop();
});

const CHECKLIST_ALL_TRUE: Record<string, boolean> = Object.fromEntries(
  FIRST_POST_CHECK_KEYS.map((k) => [k, true]),
);

interface SeededCreator {
  associationId: string;
  trackingLinkId: string;
  code: string;
  handle: string;
  status: string;
}

interface SeededCampaign {
  campaignId: string;
  closeAt: Date;
  liveAt: Date;
  creators: SeededCreator[];
}

/**
 * A live campaign with one or more Creators, each with a tracking link. Every
 * `ready` Creator's link is activated by the launch; an `accepted` one's link
 * stays inactive (its association was not launched), which is exactly the
 * before-activation case §33.6.3 needs.
 */
async function seedLiveCampaign(
  label: string,
  specs: Array<{ status?: 'ready' | 'accepted' }> = [{}],
  options: { liveAt?: Date } = {},
): Promise<SeededCampaign> {
  const liveAt = options.liveAt ?? new Date(Date.now() - 1000);
  const closeAt = new Date(Date.now() + 14 * 86_400_000);
  const founder = await seedUser(h, 'founder', `attr-founder-${label}`);

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
      highEffort: false,
      highEffortCalculatedAt: new Date(),
      listingPaidAt: new Date(),
      campaignLiveAt: liveAt,
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
    publicStory: 'A launch story.\n\nA second paragraph.',
    heroPreference: 'hero-image',
    requiredWording: 'Say it truthfully.',
    prohibitedClaims: 'No medical claims.',
    opensAt: new Date(Date.now() + 86_400_000),
    closesAt: closeAt,
    updatedBy: 'user:test',
  });

  await h.db.insert(campaignRewardPackages).values({
    campaignId,
    sku: 'TIER-1',
    title: 'Early bird',
    priceCents: 5_000n,
    contents: 'One unit.',
    fulfillmentCommitment: 'We will ship it.',
    delivery: '2026-12',
  });

  const creators: SeededCreator[] = [];
  let i = 0;
  for (const spec of specs) {
    i += 1;
    const status = spec.status ?? 'ready';
    const handle = `@creator-${label}-${i}`;
    const creatorUser = await seedUser(h, 'affiliate', `attr-creator-${label}-${i}`);
    const [cp] = await h.db
      .insert(affiliateProspects)
      .values({
        legalName: `Creator ${label} ${i}`,
        publicHandle: handle,
        email: creatorUser.email,
        subtype: 'social_creator',
        audienceNiche: 'hardware',
        audienceSize: '120k',
        adminBio: 'Reviews early hardware.',
        createdBy: 'admin:test',
      })
      .returning({ id: affiliateProspects.id });

    const [assoc] = await h.db
      .insert(campaignAffiliateAssociations)
      .values({
        campaignId,
        affiliateId: randomUUID(),
        prospectId: cp!.id,
        status,
        rosterMembership: 'initial_roster',
      })
      .returning({ id: campaignAffiliateAssociations.id });
    const associationId = assoc!.id;

    await h.db.insert(affiliateSignupProfiles).values({
      prospectId: cp!.id,
      associationId,
      email: creatorUser.email,
      publicHandle: handle,
      claimedUserId: creatorUser.id,
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

    const code = `code-${label}-${i}-${randomUUID().slice(0, 8)}`;
    const [link] = await h.db
      .insert(trackingLinks)
      .values({ associationId, campaignId, code })
      .returning({ id: trackingLinks.id });

    creators.push({ associationId, trackingLinkId: link!.id, code, handle, status });
  }

  // Launch: page → links. Only `ready` associations activate.
  const result = await launchCampaign(h.db, { audit }, { campaignId, actor: 'system:test' });
  expect(result.status).toBe('launched');

  // Reflect the activation status back onto the returned creators.
  for (const c of creators) {
    const [row] = await h.db
      .select({ status: campaignAffiliateAssociations.status })
      .from(campaignAffiliateAssociations)
      .where(eq(campaignAffiliateAssociations.id, c.associationId));
    c.status = row!.status;
  }

  return { campaignId, closeAt, liveAt, creators };
}

/** The pv_attr_<campaignId> cookie's raw Set-Cookie string from a response, or null. */
function attrSetCookie(res: request.Response, campaignId: string): string | null {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  if (!raw) return null;
  const name = attributionCookieName(campaignId);
  return raw.find((c) => c.startsWith(`${name}=`)) ?? null;
}

async function ledgerFor(trackingLinkId: string) {
  return h.db
    .select()
    .from(trackingLinkClicks)
    .where(eq(trackingLinkClicks.trackingLinkId, trackingLinkId));
}

/* ── §33.6.1 — last valid same-browser wins; direct return preserves ────────── */

describe('§33.6.1 the last valid same-browser Creator link wins, and a direct return preserves it', () => {
  it('a valid click attributes; a direct return keeps it; a later valid click replaces it', async () => {
    const seeded = await seedLiveCampaign('win', [{}, {}]);
    const [a, b] = seeded.creators;
    const agent = request.agent(h.app);

    // Click A → redirect to the live page, winner cookie set to A.
    const clickA = await agent.get(`/c/${a!.code}`);
    expect(clickA.status).toBe(302);
    expect(clickA.headers.location).toBe(`/campaign/${seeded.campaignId}`);

    // A direct return (no new link) preserves A.
    const afterA = await agent.get(`/api/campaign/${seeded.campaignId}`);
    expect(afterA.status).toBe(200);
    expect(afterA.body.attribution?.handle).toBe(a!.handle);
    // The read never writes a winner cookie — that is only /c/:code's job.
    expect(attrSetCookie(afterA, seeded.campaignId)).toBeNull();

    // Click B → the later valid click replaces A on the same browser.
    await agent.get(`/c/${b!.code}`);
    const afterB = await agent.get(`/api/campaign/${seeded.campaignId}`);
    expect(afterB.body.attribution?.handle).toBe(b!.handle);
  });
});

/* ── §33.6.2 — later replaces; cookie ends at close ─────────────────────────── */

describe('§33.6.2 a later valid click replaces the earlier, and the cookie ends at close', () => {
  it('the winner cookie carries Expires = campaign_close_at', async () => {
    const seeded = await seedLiveCampaign('close', [{}]);
    const [a] = seeded.creators;

    const click = await request(h.app).get(`/c/${a!.code}`);
    const cookie = attrSetCookie(click, seeded.campaignId);
    expect(cookie).not.toBeNull();

    const expiresMatch = /expires=([^;]+)/i.exec(cookie!);
    expect(expiresMatch).not.toBeNull();
    const cookieExpiry = new Date(expiresMatch![1]!);
    // The cookie dies at close (§18), to the second — not after a fixed window.
    // HTTP cookie dates are second-precision, so compare against close truncated
    // to the second (the same truncation the Set-Cookie header applied).
    expect(cookieExpiry.getTime()).toBe(Math.floor(seeded.closeAt.getTime() / 1000) * 1000);
  });

  it('replacement is last-write-wins in the ledger and the resolution', async () => {
    const seeded = await seedLiveCampaign('replace', [{}, {}]);
    const [a, b] = seeded.creators;
    const agent = request.agent(h.app);
    await agent.get(`/c/${a!.code}`);
    await agent.get(`/c/${b!.code}`);
    const resolved = await agent.get(`/api/campaign/${seeded.campaignId}`);
    expect(resolved.body.attribution?.handle).toBe(b!.handle);
    // Both clicks are recorded as attributed — the replacement is which one the
    // cookie points at, not a rewrite of the ledger.
    expect((await ledgerFor(a!.trackingLinkId))[0]?.outcome).toBe('attributed');
    expect((await ledgerFor(b!.trackingLinkId))[0]?.outcome).toBe('attributed');
  });
});

/* ── §33.6.3 — pre-activation / paused / post-close / mid-campaign prior ─────── */

describe('§33.6.3 pre-activation, paused, post-close, and mid-campaign prior traffic earn nothing', () => {
  it('a click on a never-activated link is ignored (before_activation) and sets no cookie', async () => {
    const seeded = await seedLiveCampaign('preact', [{ status: 'ready' }, { status: 'accepted' }]);
    const inactive = seeded.creators.find((c) => c.status === 'accepted')!;

    // Service-level: the outcome and reason are recorded.
    const rec = await recordClick(h.db, {
      code: inactive.code,
      visitorId: randomUUID(),
      linkTest: false,
      now: new Date(),
    });
    expect(rec.outcome).toBe('ignored');
    expect(rec.reason).toBe('before_activation');

    // HTTP-level: no winner cookie is set.
    const click = await request(h.app).get(`/c/${inactive.code}`);
    expect(attrSetCookie(click, seeded.campaignId)).toBeNull();
  });

  it("a mid-campaign Creator's traffic before their own activation is before_activation", async () => {
    const seeded = await seedLiveCampaign('mid', [{}]);
    const [c] = seeded.creators;
    // The link activated at campaign_live_at; a click timestamped before that —
    // exactly a mid-campaign Creator's prior traffic — cannot attribute.
    const rec = await recordClick(h.db, {
      code: c!.code,
      visitorId: randomUUID(),
      linkTest: false,
      now: new Date(seeded.liveAt.getTime() - 60_000),
    });
    expect(rec.outcome).toBe('ignored');
    expect(rec.reason).toBe('before_activation');
  });

  it('a click while the link is paused is ignored (paused)', async () => {
    const seeded = await seedLiveCampaign('paused', [{}]);
    const [c] = seeded.creators;
    await h.db
      .update(trackingLinks)
      .set({ pausedAt: new Date(), pausedReason: 'test', pausedBy: 'admin:test' })
      .where(eq(trackingLinks.id, c!.trackingLinkId));

    const rec = await recordClick(h.db, {
      code: c!.code,
      visitorId: randomUUID(),
      linkTest: false,
      now: new Date(),
    });
    expect(rec.outcome).toBe('ignored');
    expect(rec.reason).toBe('paused');
  });

  it('a click at or after close is ignored (after_close)', async () => {
    const seeded = await seedLiveCampaign('postclose', [{}]);
    const [c] = seeded.creators;
    const rec = await recordClick(h.db, {
      code: c!.code,
      visitorId: randomUUID(),
      linkTest: false,
      now: new Date(seeded.closeAt.getTime() + 60_000),
    });
    expect(rec.outcome).toBe('ignored');
    expect(rec.reason).toBe('after_close');
  });
});

/* ── §33.6.4 — post-activation provisional until verification ────────────────── */

describe('§33.6.4 post-activation results stay provisional until verification', () => {
  it('provisional on a valid click, verified after the first post passes', async () => {
    const seeded = await seedLiveCampaign('prov', [{}]);
    const [c] = seeded.creators;

    // A valid click on an active link, first post not yet verified → provisional.
    const rec = await recordClick(h.db, {
      code: c!.code,
      visitorId: randomUUID(),
      linkTest: false,
      now: new Date(),
    });
    expect(rec.outcome).toBe('attributed');
    let resolved = await resolveAttribution(h.db, {
      campaignId: seeded.campaignId,
      trackingLinkId: c!.trackingLinkId,
    });
    expect(resolved?.status).toBe('provisional');

    // The Creator submits and Admin passes it → verified.
    const submit = await submitPost(h.db, { audit }, {
      associationId: c!.associationId,
      postUrl: 'https://example.com/post/1',
      submittedBy: 'user:test',
    });
    expect(submit.status).toBe('submitted');
    const verify = await verifyPost(h.db, { audit }, {
      submissionId: (submit as { submission: { id: string } }).submission.id,
      actor: 'admin:test',
      outcome: 'passed',
      checklist: CHECKLIST_ALL_TRUE,
    });
    expect(verify.status).toBe('verified');

    resolved = await resolveAttribution(h.db, {
      campaignId: seeded.campaignId,
      trackingLinkId: c!.trackingLinkId,
    });
    expect(resolved?.status).toBe('verified');
  });

  it('blocked once the post is rejected and the link is paused; the same click then earns nothing', async () => {
    const seeded = await seedLiveCampaign('reject', [{}]);
    const [c] = seeded.creators;

    const submit = await submitPost(h.db, { audit }, {
      associationId: c!.associationId,
      postUrl: 'https://example.com/post/reject',
      submittedBy: 'user:test',
    });
    await verifyPost(h.db, { audit }, {
      submissionId: (submit as { submission: { id: string } }).submission.id,
      actor: 'admin:test',
      outcome: 'rejected',
      checklist: { ...CHECKLIST_ALL_TRUE, no_prohibited_claim: false },
      enforcementReason: 'prohibited claim',
    });

    const resolved = await resolveAttribution(h.db, {
      campaignId: seeded.campaignId,
      trackingLinkId: c!.trackingLinkId,
    });
    expect(resolved?.status).toBe('blocked');

    // A new click after the pause is ignored (§33.6.3's pause case, via the link
    // §17 just paused) — nothing new can attribute to a rejected Creator.
    const rec = await recordClick(h.db, {
      code: c!.code,
      visitorId: randomUUID(),
      linkTest: false,
      now: new Date(),
    });
    expect(rec.outcome).toBe('ignored');
    expect(rec.reason).toBe('paused');
  });

  it('the campaign endpoint reports the provisional status over HTTP', async () => {
    const seeded = await seedLiveCampaign('provhttp', [{}]);
    const [c] = seeded.creators;
    const agent = request.agent(h.app);
    await agent.get(`/c/${c!.code}`);
    const res = await agent.get(`/api/campaign/${seeded.campaignId}`);
    expect(res.body.attribution?.status).toBe('provisional');
  });
});

/* ── §33.6.5 — Days 1–7 known-link-only; Day 8 switch does not rewrite ──────── */

describe('§33.6.5 Days 1–7 are known-link-only; the Day 8 switch does not rewrite attribution', () => {
  it('opens discovery at Day 8, sends one notice, and leaves every click row untouched', async () => {
    // Live two days ago: reachable by known link, not yet discoverable.
    const liveAt = new Date(Date.now() - 2 * 86_400_000);
    const seeded = await seedLiveCampaign('disc', [{}], { liveAt });
    const [c] = seeded.creators;

    // A valid click builds an attribution + ledger row.
    const agent = request.agent(h.app);
    await agent.get(`/c/${c!.code}`);
    const before = (await ledgerFor(c!.trackingLinkId))[0]!;

    // The page is reachable through the known link, and not indexable yet (§18).
    const day3 = await agent.get(`/api/campaign/${seeded.campaignId}`);
    expect(day3.status).toBe(200);
    expect(day3.body.indexable).toBe(false);

    // A sweep before Day 8 opens nothing.
    const early = await sweepDiscovery(
      h.db,
      { audit, notifier: h.notifier, context: NOTICE_CONTEXT },
      new Date(),
    );
    expect(early.opened).not.toContain(seeded.campaignId);

    const emailsBefore = h.sentEmails.messages.length;

    // A sweep on/after Day 8 opens discovery and sends exactly one notice.
    const day8 = new Date(liveAt.getTime() + 8 * 86_400_000);
    const opened = await sweepDiscovery(
      h.db,
      { audit, notifier: h.notifier, context: NOTICE_CONTEXT },
      day8,
    );
    expect(opened.opened).toContain(seeded.campaignId);

    const notices = h.sentEmails.messages
      .slice(emailsBefore)
      .filter((m) => /can now be discovered/i.test(m.subject));
    expect(notices).toHaveLength(1);

    // Now indexable.
    const afterOpen = await agent.get(`/api/campaign/${seeded.campaignId}`);
    expect(afterOpen.body.indexable).toBe(true);

    // The switch rewrote no attribution: the click row is byte-for-byte the same.
    const after = (await ledgerFor(c!.trackingLinkId))[0]!;
    expect(after.id).toBe(before.id);
    expect(after.trackingLinkId).toBe(before.trackingLinkId);
    expect(after.outcome).toBe(before.outcome);
    expect(after.clickedAt.getTime()).toBe(before.clickedAt.getTime());
    // The attribution still resolves to the same Creator, unchanged.
    expect(afterOpen.body.attribution?.handle).toBe(c!.handle);

    // A second sweep is idempotent: no re-open, no second notice.
    const again = await sweepDiscovery(
      h.db,
      { audit, notifier: h.notifier, context: NOTICE_CONTEXT },
      day8,
    );
    expect(again.opened).not.toContain(seeded.campaignId);
    const noticesAfter = h.sentEmails.messages.filter((m) =>
      /can now be discovered/i.test(m.subject),
    );
    expect(noticesAfter).toHaveLength(1);
  });
});

/* ── §14.1 — the safe link-test action contaminates nothing ─────────────────── */

describe('§14.1 the safe link-test action does not contaminate attribution or metrics', () => {
  it('a marked click is recorded ignored/link_test, sets no cookie, and preserves an earlier winner', async () => {
    const seeded = await seedLiveCampaign('linktest', [{}]);
    const [c] = seeded.creators;
    const agent = request.agent(h.app);

    // A real valid click first — this is the winner.
    await agent.get(`/c/${c!.code}`);
    const afterValid = await agent.get(`/api/campaign/${seeded.campaignId}`);
    expect(afterValid.body.attribution?.handle).toBe(c!.handle);

    // A link-test click on the same link, by its exact marker name.
    const test = await agent.get(`/c/${c!.code}?${LINK_TEST_MARKER}=1`);
    expect(test.status).toBe(302);
    // It sets no winner cookie, so it cannot replace or clear the real one.
    expect(attrSetCookie(test, seeded.campaignId)).toBeNull();

    // The earlier winner is preserved (§33.6.1's rule, applied to a test click).
    const afterTest = await agent.get(`/api/campaign/${seeded.campaignId}`);
    expect(afterTest.body.attribution?.handle).toBe(c!.handle);

    // The ledger records the test click as ignored/link_test, flagged as a test.
    const rows = await ledgerFor(c!.trackingLinkId);
    const testRow = rows.find((r) => r.linkTest);
    expect(testRow?.outcome).toBe('ignored');
    expect(testRow?.ignoredReason).toBe('link_test');
    // The attributed (non-test) row is separate and untouched.
    expect(rows.some((r) => r.outcome === 'attributed' && !r.linkTest)).toBe(true);
  });
});
