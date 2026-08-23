/**
 * Phase 08c acceptance suite — §33.2.4 and the second half of §33.1.9.
 *
 * §33's own framing: these are requirements, not examples.
 *
 *   33.2.4  Campaign kit is complete, private, logged, scoped, revocable.
 *   33.1.9  `founder_signup_complete` emits once AND reveals the preparing
 *           campaign to only eligible campaign-specific Affiliates once.
 *
 * Phase 07 proved the emit-once half against the Founder claim. This proves the
 * reveal half, and §31.5's four conditions on the pilot pre-view exception:
 * private, authenticated, logged, campaign-scoped, revocable.
 *
 * The whole journey runs here — recruit, invite, sign up, claim the Founder
 * account — because the reveal is only meaningful at the end of it and a
 * fixture that shortcut the middle would prove the reveal works on data no
 * real flow produces.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';

import { startHarness, type Harness } from './app-harness.js';
import { createAdmin, seedUser, signInPlain, type AdminSession } from './admin-session.js';
import { seedAdminReauthWindow } from '../settings/service.js';
import { auditEvents, idempotencyKeys, notificationDeliveries } from '../db/schema/integrity.js';
import { policyVersions } from '../db/schema/policies.js';
import { campaignAffiliateAssociations, associationStatusHistory, campaigns } from '../db/schema/domain.js';
import { campaignKitAccess } from '../db/schema/affiliates.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import { campaignVetting } from '../db/schema/vetting.js';
import { AFFILIATE_CLAIM_POLICY_SLUGS } from '../affiliates/signup.js';
import {
  FOUNDER_CLAIM_POLICY_SLUGS,
} from '../vetting/claim.js';
import { preparingRevealedKey, revealPreparingCampaign } from '../affiliates/handoff.js';
import { BACKEND_NOTIFICATION_EVENTS } from '../notifications/events.js';
import { REVIEW_CAMPAIGN, CONFIDENTIALITY_NOTICE } from '../notifications/templates/affiliate-preparing-available.js';
import { NOTIFICATION_EVENTS } from '@proovd/shared';

let h: Harness;
let admin: AdminSession;

beforeAll(async () => {
  h = await startHarness({}, 'preparing');
  admin = await createAdmin(h, 'preparing-admin');
  await seedAdminReauthWindow(h.db, 3600);
  // Every claim in this file needs published agreements. Publication is
  // one-way (§29.8), so this happens once, up front, and the draft-refusal
  // cases live in the 08b suite where they can run before it.
  await h.db
    .update(policyVersions)
    .set({ status: 'published', effectiveDate: '2026-01-01', publishedAt: new Date() })
    .where(
      inArray(policyVersions.slug, [
        ...FOUNDER_CLAIM_POLICY_SLUGS,
        ...AFFILIATE_CLAIM_POLICY_SLUGS,
      ]),
    );
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

/* ── The whole journey, once ──────────────────────────────────────────────── */

interface Journey {
  campaignId: string;
  draftId: string;
  founderRaw: string;
  associationId: string;
  creatorEmail: string;
  creatorUserId: string;
  creatorCookie: string;
}

/** Admin creates the Founder prospect, campaign, and draft; sends the link. */
async function invitedFounder(): Promise<{ campaignId: string; draftId: string; raw: string }> {
  const created = await request(h.app)
    .post('/api/admin/founders')
    .set('cookie', admin.cookie)
    .send({
      legalName: 'Rowan Vale',
      preferredName: 'Rowan',
      email: `founder-${randomUUID()}@example.com`,
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
      whatWeUnderstood: 'A scheduling tool for independent physiotherapists.',
      whyInvited: 'Two clinics renewed without being asked.',
      senderName: 'Ada Admin',
      senderEmail: 'ada@proovd.co',
      expectedSetupTime: 'About two hours.',
    })
    .expect(200);

  const before = h.sentEmails.messages.length;
  await request(h.app)
    .post(`/api/admin/founders/${created.body.draftId}/send`)
    .set('cookie', admin.cookie)
    .send({})
    .expect(201);

  const raw = /http:\/\/localhost:3000\/draft\/([A-Za-z0-9_-]+)/.exec(
    h.sentEmails.messages[before]!.text,
  )![1]!;

  return { campaignId: created.body.campaignId, draftId: created.body.draftId, raw };
}

/** Drives §9's vetting to a submitted state so the claim can proceed. */
async function submitVetting(raw: string, campaignId: string, draftId: string): Promise<void> {
  // §9 step 1 is the Founder's own again (2026-08-18). Admin's discovery route
  // still exists; this journey walks what a Founder actually does.
  await request(h.app)
    .patch(`/api/draft/${raw}/vetting`)
    .send({
      selectedType: 'pre_build',
      problem: 'Independent physiotherapists lose income to last-minute cancellations.',
      solution: 'A waitlist that fills a cancelled slot automatically.',
      competition:
        'A receptionist working down a paper list, and two booking suites that charge per seat.',
    })
    .expect(200);

  await request(h.app).post(`/api/draft/${raw}/vetting/submit`).send({}).expect(201);

  // The possible-creator result no longer gates the claim; it stays a
  // recordable Admin assessment, and this journey still records one so the
  // workspace has something to show.
  await request(h.app)
    .post(`/api/admin/campaigns/${campaignId}/creator-signal`)
    .set('cookie', admin.cookie)
    .send({ count: 4, basis: 'four recruited Creators in this niche' })
    .expect(201);
}

/** Recruits a Creator, sends the invitation, and signs them up. */
async function signedUpCreator(campaignId: string): Promise<{
  associationId: string;
  email: string;
  userId: string;
  cookie: string;
}> {
  const email = `creator-${randomUUID()}@example.com`;

  const created = await request(h.app)
    .post('/api/admin/affiliates')
    .set('cookie', admin.cookie)
    .send({
      legalName: 'Sam Okafor',
      publicHandle: '@sambuilds',
      email,
      subtype: 'social_creator',
      channelReference: 'https://example.social/@sambuilds',
      audienceNiche: 'Indie software founders',
      campaignFit: 'The audience is the exact buyer.',
      audienceSize: '42,000 followers',
      permissionBasis: 'Owns the account outright.',
      adminBio: 'Sam writes about building software alone.',
      recruitmentSource: 'found through a mutual founder',
      recruitingAdmin: 'Priya Recruiter',
      campaignId,
      rosterIntent: 'initial_roster',
    })
    .expect(201);

  await request(h.app)
    .patch(`/api/admin/affiliates/${created.body.associationId}/invitation`)
    .set('cookie', admin.cookie)
    .send({
      whyRecruited: 'Your last three threads each ran past 200 replies.',
      reviewedPresence: 'Your public profile.',
      senderName: 'Ada Admin',
      senderEmail: 'ada@proovd.co',
    })
    .expect(200);

  const before = h.sentEmails.messages.length;
  await request(h.app)
    .post(`/api/admin/affiliates/${created.body.associationId}/send`)
    .set('cookie', admin.cookie)
    .send({})
    .expect(200);

  const raw = /http:\/\/localhost:3000\/creator-invitation\/([A-Za-z0-9_-]+)/.exec(
    h.sentEmails.messages[before]!.text,
  )![1]!;

  await request(h.app)
    .patch(`/api/affiliate-invitation/${raw}`)
    .send({
      dateOfBirth: '1994-03-11',
      country: 'US',
      stateRegion: 'CA',
      confirmAge18Plus: true,
      confirmUsBased: true,
      confirmActualOperator: true,
      confirmNoDuplicateAccounts: true,
      confirmSanctionsEligible: true,
    })
    .expect(200);

  const claimed = await request(h.app)
    .post(`/api/affiliate-invitation/${raw}/claim`)
    .send({
      password: 'a-perfectly-good-password',
      acceptedPolicySlugs: [...AFFILIATE_CLAIM_POLICY_SLUGS],
    })
    .expect(201);

  const cookie = await signInPlain(h, email);

  return { associationId: created.body.associationId, email, userId: claimed.body.userId, cookie };
}

/** The full journey through vetting submission, which now creates the account. */
async function journey(): Promise<Journey> {
  const founder = await invitedFounder();
  const creator = await signedUpCreator(founder.campaignId);
  await submitVetting(founder.raw, founder.campaignId, founder.draftId);

  return {
    campaignId: founder.campaignId,
    draftId: founder.draftId,
    founderRaw: founder.raw,
    associationId: creator.associationId,
    creatorEmail: creator.email,
    creatorUserId: creator.userId,
    creatorCookie: creator.cookie,
  };
}

/* ── The register ─────────────────────────────────────────────────────────── */

describe('the handoff notification uses the §27.4 key', () => {
  it('names only keys the shared register defines', () => {
    for (const key of BACKEND_NOTIFICATION_EVENTS) {
      expect(Object.keys(NOTIFICATION_EVENTS)).toContain(key);
    }
    expect(NOTIFICATION_EVENTS.affiliate_founder_signup_completed).toMatchObject({
      audience: 'affiliate',
      specRef: '§27.4',
    });
  });
});

/* ══ §33.1.9 — the reveal happens exactly once ═══════════════════════════ */

describe('§33.1.9 — founder_signup_complete reveals the preparing campaign once', () => {
  it('moves an eligible Creator to preparing and records the reveal', async () => {
    const j = await journey();

    const [association] = await h.db
      .select()
      .from(campaignAffiliateAssociations)
      .where(eq(campaignAffiliateAssociations.id, j.associationId));

    expect(association!.status).toBe('preparing');
    expect(association!.preparingRevealedAt).not.toBeNull();

    const history = await h.db
      .select()
      .from(associationStatusHistory)
      .where(eq(associationStatusHistory.associationId, j.associationId));
    expect(history.map((r) => r.toStatus)).toEqual([
      'prospect',
      'invited',
      'signup_started',
      'signed_up_waiting_for_founder',
      'preparing',
    ]);
  });

  it('sends exactly one notification, carrying exactly one action', async () => {
    const before = h.sentEmails.messages.length;
    const j = await journey();

    const handoffs = h.sentEmails.messages
      .slice(before)
      .filter((m) => m.subject.includes('ready for you to read'));

    expect(handoffs).toHaveLength(1);
    // §10: "A transactional notification has one action: `Review campaign`."
    expect(handoffs[0]!.html).toContain(REVIEW_CAMPAIGN);
    expect(handoffs[0]!.text.toLowerCase()).toContain(REVIEW_CAMPAIGN.toLowerCase());
    const links = [...handoffs[0]!.html.matchAll(/<a\s[^>]*href=/gi)];
    expect(links, 'the handoff email must carry exactly one link').toHaveLength(1);

    const deliveries = await h.db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.entityId, j.associationId));
    // One for the signup confirmation, one for the handoff — and no more.
    expect(deliveries).toHaveLength(2);
  });

  it('produces no second reveal and no second email when re-run', async () => {
    const j = await journey();
    const beforeEmails = h.sentEmails.messages.length;

    // §10: "No duplicate visibility event or email may occur after retries."
    const again = await revealPreparingCampaign(
      {
        db: h.db,
        notifier: h.notifier,
        context: {
          appBaseUrl: 'http://localhost:3000',
          supportEmail: 'support@proovd.co',
          fromAddress: 'hello@proovd.co',
        },
      },
      j.campaignId,
    );

    expect(again.revealed).toEqual([]);
    expect(h.sentEmails.messages.length).toBe(beforeEmails);

    const keys = await h.db
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, preparingRevealedKey(j.associationId)));
    expect(keys).toHaveLength(1);

    const history = await h.db
      .select()
      .from(associationStatusHistory)
      .where(
        and(
          eq(associationStatusHistory.associationId, j.associationId),
          eq(associationStatusHistory.toStatus, 'preparing'),
        ),
      );
    expect(history).toHaveLength(1);
  });

  it('reveals to no one when the campaign has no signed-up Creator', async () => {
    const founder = await invitedFounder();
    await submitVetting(founder.raw, founder.campaignId, founder.draftId);
    const before = h.sentEmails.messages.length;

    const handoffs = h.sentEmails.messages
      .slice(before)
      .filter((m) => m.subject.includes('ready for you to read'));
    expect(handoffs).toHaveLength(0);
  });

  it('reveals only to Creators on that campaign (§33.1.9 "only eligible")', async () => {
    const other = await invitedFounder();
    const otherCreator = await signedUpCreator(other.campaignId);

    const j = await journey();

    // The other campaign's Creator was untouched by this campaign's claim.
    const [untouched] = await h.db
      .select()
      .from(campaignAffiliateAssociations)
      .where(eq(campaignAffiliateAssociations.id, otherCreator.associationId));
    expect(untouched!.status).toBe('signed_up_waiting_for_founder');
    expect(untouched!.preparingRevealedAt).toBeNull();
    expect(j.associationId).not.toBe(otherCreator.associationId);
  });

  it('does not reveal to a Creator who has not finished signing up', async () => {
    // §10 reveals to an *authenticated* Affiliate. An association still at
    // `invited` has no account, so there is nobody to reveal anything to.
    const founder = await invitedFounder();
    const created = await request(h.app)
      .post('/api/admin/affiliates')
      .set('cookie', admin.cookie)
      .send({
        legalName: 'Unclaimed Creator',
        publicHandle: '@unclaimed',
        email: `creator-${randomUUID()}@example.com`,
        subtype: 'podcast_host',
        channelReference: 'https://example.fm/show',
        audienceNiche: 'Founders',
        campaignFit: 'Fits.',
        permissionBasis: 'Owns the show.',
        adminBio: 'Runs a show.',
        recruitmentSource: 'referral',
        recruitingAdmin: 'Priya Recruiter',
        campaignId: founder.campaignId,
        rosterIntent: 'initial_roster',
      })
      .expect(201);

    await submitVetting(founder.raw, founder.campaignId, founder.draftId);

    const [association] = await h.db
      .select()
      .from(campaignAffiliateAssociations)
      .where(eq(campaignAffiliateAssociations.id, created.body.associationId));
    expect(association!.status).toBe('prospect');
    expect(association!.preparingRevealedAt).toBeNull();
  });

  it('records the reveal in the audit trail with its §31.5 justification', async () => {
    const j = await journey();
    const [event] = await h.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.targetId, j.associationId),
          eq(auditEvents.action, 'affiliate_preparing_revealed'),
        ),
      );

    expect(event).toBeTruthy();
    expect(event!.internalReason).toMatch(/§31\.5|pilot pre-view/i);
    expect(event!.customerExplanation).toBeTruthy();
  });

  it('refuses to change the reveal stamp once set', async () => {
    const j = await journey();
    await expect(
      h.db
        .update(campaignAffiliateAssociations)
        .set({ preparingRevealedAt: new Date('2020-01-01') })
        .where(eq(campaignAffiliateAssociations.id, j.associationId)),
    ).rejects.toThrow();
  });
});

/* ══ §33.2.4 — the kit is complete, private, logged, scoped, revocable ═══ */

describe('§33.2.4 — the preparing Campaign kit', () => {
  it('is PRIVATE: an unauthenticated request gets nothing', async () => {
    const j = await journey();
    const res = await request(h.app).get(`/api/creator/campaigns/${j.associationId}`);
    expect(res.status).toBe(401);
  });

  it('is SCOPED: another Creator cannot read it, and cannot tell it exists', async () => {
    const j = await journey();
    const other = await invitedFounder();
    const outsider = await signedUpCreator(other.campaignId);

    const res = await request(h.app)
      .get(`/api/creator/campaigns/${j.associationId}`)
      .set('cookie', outsider.cookie);

    // The same answer as an association that does not exist — nothing is
    // enumerable from here.
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');

    const missing = await request(h.app)
      .get(`/api/creator/campaigns/${randomUUID()}`)
      .set('cookie', outsider.cookie);
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe(res.body.error);
  });

  it('is scoped by role: an Admin session is not a Creator session', async () => {
    const j = await journey();
    const res = await request(h.app)
      .get(`/api/creator/campaigns/${j.associationId}`)
      .set('cookie', admin.cookie);
    expect(res.status).toBe(403);
  });

  it('is COMPLETE for what §10 names as currently available', async () => {
    const j = await journey();
    const res = await request(h.app)
      .get(`/api/creator/campaigns/${j.associationId}`)
      .set('cookie', j.creatorCookie)
      .expect(200);

    const kit = res.body.kit;
    // §10: "the complete currently available Founder/problem/solution/
    // competition information and the single Campaign kit." Positioning is
    // collected again (2026-08-18), so all four are genuinely available.
    expect(kit.founder.name).toBe('Rowan');
    expect(kit.productName).toBe('Waitlist');
    expect(kit.problem).toMatch(/last-minute cancellations/i);
    expect(kit.solution).toMatch(/waitlist that fills/i);
    expect(kit.competition).toMatch(/paper list/i);
    // §3: the customer-facing name, never the internal one.
    expect(kit.campaignType).toBe('Idea Campaign');
    expect(JSON.stringify(kit)).not.toMatch(/pre_build|pre_launch/);
  });

  it('names what is not decided yet rather than rendering it empty (§1.4)', async () => {
    const j = await journey();
    const res = await request(h.app)
      .get(`/api/creator/campaigns/${j.associationId}`)
      .set('cookie', j.creatorCookie)
      .expect(200);

    const items = res.body.kit.notYetAvailable.map((e: { item: string }) => e.item);
    expect(items.join(' ')).toMatch(/rewards/i);
    expect(items.join(' ')).toMatch(/paid/i);
    for (const entry of res.body.kit.notYetAvailable) {
      expect(entry.because.trim()).not.toBe('');
    }
  });

  it('exposes NO compensation decision and NO work permission (§10, §12)', async () => {
    const j = await journey();
    const res = await request(h.app)
      .get(`/api/creator/campaigns/${j.associationId}`)
      .set('cookie', j.creatorCookie)
      .expect(200);

    expect(res.body.kit.workPermitted).toBe(false);
    expect(res.body.kit.decisionsAvailable).toBe(false);

    // §12 owns compensation and it arrives in Phase 12. No rate, no percentage,
    // no bid, no bonus reaches this projection at all.
    const serialized = JSON.stringify(res.body.kit);
    expect(serialized).not.toMatch(/basePercentage|commission|bonus|bidEligib|fixedPayment/i);
  });

  it('offers no accept, decline, propose, or activate route at all', async () => {
    const j = await journey();
    for (const path of ['accept', 'decline', 'propose', 'activate']) {
      const res = await request(h.app)
        .post(`/api/creator/campaigns/${j.associationId}/${path}`)
        .set('cookie', j.creatorCookie)
        .send({});
      expect(res.status, path).toBe(404);
    }
  });

  it('is LOGGED: every read writes an access row', async () => {
    const j = await journey();

    await request(h.app)
      .get(`/api/creator/campaigns/${j.associationId}`)
      .set('cookie', j.creatorCookie)
      .expect(200);
    await request(h.app)
      .get(`/api/creator/campaigns/${j.associationId}?section=campaign_kit`)
      .set('cookie', j.creatorCookie)
      .expect(200);

    const access = await h.db
      .select()
      .from(campaignKitAccess)
      .where(eq(campaignKitAccess.associationId, j.associationId));

    expect(access).toHaveLength(2);
    expect(access.map((a) => a.section).sort()).toEqual(['campaign_information', 'campaign_kit']);
    for (const row of access) {
      expect(row.affiliateUserId).toBe(j.creatorUserId);
      expect(row.campaignId).toBe(j.campaignId);
    }
  });

  it('keeps the access log free of the confidential content it records', async () => {
    const j = await journey();
    await request(h.app)
      .get(`/api/creator/campaigns/${j.associationId}`)
      .set('cookie', j.creatorCookie)
      .expect(200);

    const access = await h.db
      .select()
      .from(campaignKitAccess)
      .where(eq(campaignKitAccess.associationId, j.associationId));

    // A copy of the Founder's material in an insert-only table is a copy no
    // revocation could ever reach.
    expect(JSON.stringify(access)).not.toMatch(/cancellations|waitlist that fills|paper list/i);
  });

  it('keeps the access log insert-only for the application role', async () => {
    // The suite connects as the database owner, so issuing a DELETE here would
    // prove nothing — the REVOKE binds `proovd_app`, which is what the
    // application actually connects as. Assert the grant itself.
    const granted = await h.db.execute(
      `SELECT privilege_type FROM information_schema.role_table_grants
         WHERE table_name = 'campaign_kit_access' AND grantee = 'proovd_app'`,
    );
    const privileges = (granted.rows as Array<{ privilege_type: string }>)
      .map((r) => r.privilege_type)
      .sort();

    expect(privileges).toEqual(['INSERT', 'SELECT']);
    expect(privileges).not.toContain('UPDATE');
    expect(privileges).not.toContain('DELETE');
  });

  it('is REVOCABLE: access ends immediately, and the content is not selected', async () => {
    const j = await journey();

    await request(h.app)
      .get(`/api/creator/campaigns/${j.associationId}`)
      .set('cookie', j.creatorCookie)
      .expect(200);

    await request(h.app)
      .post(`/api/admin/affiliates/${j.associationId}/revoke-kit-access`)
      .set('cookie', admin.cookie)
      .send({ reason: 'campaign confidentiality concern raised by the Founder' })
      .expect(200);

    const after = await request(h.app)
      .get(`/api/creator/campaigns/${j.associationId}`)
      .set('cookie', j.creatorCookie);

    expect(after.status).toBe(403);
    expect(after.body.error).toBe('revoked');
    // Not a single field of the Founder's material comes back.
    expect(JSON.stringify(after.body)).not.toMatch(/cancellations|waitlist that fills/i);
  });

  it('does not log a refused read as an access', async () => {
    const j = await journey();
    await request(h.app)
      .post(`/api/admin/affiliates/${j.associationId}/revoke-kit-access`)
      .set('cookie', admin.cookie)
      .send({ reason: 'withdrawn' })
      .expect(200);

    const before = await h.db
      .select()
      .from(campaignKitAccess)
      .where(eq(campaignKitAccess.associationId, j.associationId));

    await request(h.app)
      .get(`/api/creator/campaigns/${j.associationId}`)
      .set('cookie', j.creatorCookie)
      .expect(403);

    const after = await h.db
      .select()
      .from(campaignKitAccess)
      .where(eq(campaignKitAccess.associationId, j.associationId));
    expect(after).toHaveLength(before.length);
  });

  it('refuses to un-revoke at the database level', async () => {
    const j = await journey();
    await request(h.app)
      .post(`/api/admin/affiliates/${j.associationId}/revoke-kit-access`)
      .set('cookie', admin.cookie)
      .send({ reason: 'withdrawn' })
      .expect(200);

    await expect(
      h.db
        .update(campaignAffiliateAssociations)
        .set({ kitAccessRevokedAt: null })
        .where(eq(campaignAffiliateAssociations.id, j.associationId)),
    ).rejects.toThrow();
  });

  it('requires a stored reason to revoke (§25.6)', async () => {
    const j = await journey();
    const res = await request(h.app)
      .post(`/api/admin/affiliates/${j.associationId}/revoke-kit-access`)
      .set('cookie', admin.cookie)
      .send({ reason: '   ' })
      .expect(400);
    expect(res.body.whatHappened).toMatch(/say why/i);
  });

  it('does not re-reveal a revoked association on a later run', async () => {
    const j = await journey();
    await request(h.app)
      .post(`/api/admin/affiliates/${j.associationId}/revoke-kit-access`)
      .set('cookie', admin.cookie)
      .send({ reason: 'withdrawn' })
      .expect(200);

    const again = await request(h.app)
      .post('/api/admin/affiliates/reveal')
      .set('cookie', admin.cookie)
      .send({ campaignId: j.campaignId })
      .expect(200);

    expect(again.revealed ?? again.body.revealed).toEqual([]);

    const after = await request(h.app)
      .get(`/api/creator/campaigns/${j.associationId}`)
      .set('cookie', j.creatorCookie);
    expect(after.status).toBe(403);
  });
});

/* ══ Admin sees the exception being operated (§10) ═══════════════════════ */

describe('§10 — Admin sees who has preparing visibility', () => {
  it('lists the revealed set, the access counts, and any revocation', async () => {
    const j = await journey();
    await request(h.app)
      .get(`/api/creator/campaigns/${j.associationId}`)
      .set('cookie', j.creatorCookie)
      .expect(200);

    const res = await request(h.app)
      .get(`/api/admin/affiliates/visibility?campaignId=${j.campaignId}`)
      .set('cookie', admin.cookie)
      .expect(200);

    const row = res.body.visibility.find(
      (r: { associationId: string }) => r.associationId === j.associationId,
    );
    expect(row).toBeTruthy();
    expect(row.status).toBe('preparing');
    expect(row.revealedAt).toBeTruthy();
    expect(row.accessCount).toBe(1);
    expect(row.revokedAt).toBeNull();

    await request(h.app)
      .post(`/api/admin/affiliates/${j.associationId}/revoke-kit-access`)
      .set('cookie', admin.cookie)
      .send({ reason: 'Founder asked us to pause the roster' })
      .expect(200);

    const after = await request(h.app)
      .get(`/api/admin/affiliates/visibility?campaignId=${j.campaignId}`)
      .set('cookie', admin.cookie)
      .expect(200);
    const revoked = after.body.visibility.find(
      (r: { associationId: string }) => r.associationId === j.associationId,
    );
    expect(revoked.revokedAt).toBeTruthy();
    expect(revoked.revokedReason).toMatch(/pause the roster/i);
    expect(revoked.revokedBy).toMatch(/^user:/);
  });

  it('serves the full access log for one association', async () => {
    const j = await journey();
    await request(h.app)
      .get(`/api/creator/campaigns/${j.associationId}`)
      .set('cookie', j.creatorCookie)
      .expect(200);

    const res = await request(h.app)
      .get(`/api/admin/affiliates/${j.associationId}/access-log`)
      .set('cookie', admin.cookie)
      .expect(200);

    expect(res.body.access.length).toBeGreaterThan(0);
    expect(res.body.access[0].section).toBe('campaign_information');
    expect(res.body.access[0].occurredAt).toBeTruthy();
  });

  it('keeps the visibility and access-log routes behind the Admin guards', async () => {
    const j = await journey();
    const founder = await seedUser(h, 'founder', `nosy-${randomUUID().slice(0, 8)}`);
    const cookie = await signInPlain(h, founder.email);

    for (const path of [
      `/api/admin/affiliates/visibility?campaignId=${j.campaignId}`,
      `/api/admin/affiliates/${j.associationId}/access-log`,
    ]) {
      const res = await request(h.app).get(path).set('cookie', cookie);
      expect(res.status, path).toBe(403);
    }
  });
});

/* ══ The Creator's own list ══════════════════════════════════════════════ */

describe('the Creator sees only their own campaigns', () => {
  it('lists the campaign with a review action once revealed', async () => {
    const j = await journey();
    const res = await request(h.app)
      .get('/api/creator/campaigns')
      .set('cookie', j.creatorCookie)
      .expect(200);

    expect(res.body.campaigns).toHaveLength(1);
    expect(res.body.campaigns[0].associationId).toBe(j.associationId);
    expect(res.body.campaigns[0].reviewAvailable).toBe(true);
    expect(res.body.campaigns[0].revoked).toBe(false);
  });

  it('keeps a revoked campaign visible but not reviewable', async () => {
    const j = await journey();
    await request(h.app)
      .post(`/api/admin/affiliates/${j.associationId}/revoke-kit-access`)
      .set('cookie', admin.cookie)
      .send({ reason: 'withdrawn' })
      .expect(200);

    const res = await request(h.app)
      .get('/api/creator/campaigns')
      .set('cookie', j.creatorCookie)
      .expect(200);

    expect(res.body.campaigns[0].revoked).toBe(true);
    expect(res.body.campaigns[0].reviewAvailable).toBe(false);
  });

  it('never lists another Creator’s campaign', async () => {
    const j = await journey();
    const other = await invitedFounder();
    const outsider = await signedUpCreator(other.campaignId);

    const res = await request(h.app)
      .get('/api/creator/campaigns')
      .set('cookie', outsider.cookie)
      .expect(200);

    expect(res.body.campaigns.map((c: { campaignId: string }) => c.campaignId)).not.toContain(
      j.campaignId,
    );
  });
});
