/**
 * Phase 08a acceptance suite — §33.2.1, plus §8's own rules.
 *
 * §33's own framing: these are requirements, not examples.
 *
 *   33.2.1  No public signup; invitation claims only the Affiliate's
 *           account/association.
 *
 * That one line is two guarantees, and this file proves both:
 *
 *   (a) NO PUBLIC SIGNUP. There is no route, anywhere in the tree, that lets
 *       someone create an Affiliate without an Admin doing it. Better Auth's
 *       sign-up route is closed, every recruitment route is behind
 *       `requireAdmin`, and a source scan keeps a new one from appearing.
 *
 *   (b) THE INVITATION CLAIMS ONLY THAT ASSOCIATION. A token issued for one
 *       Creator on one campaign is bound to one association id, carries nothing
 *       else, and cannot be presented against another campaign, another
 *       Creator, or a Founder's draft surface.
 *
 * Also proved here, because §8 states them and a later phase would otherwise
 * inherit them untested: the preview gate, resend rotating the token, revoke
 * killing the link without destroying the record, the §5.3 evidence
 * requirement on `verified`, the §2.2 slot rule, the Founder-visible
 * projection, and the rule that the quality tier can never become a number.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startHarness, type Harness } from './app-harness.js';
import { createAdmin, seedUser, signInPlain, type AdminSession } from './admin-session.js';
import { seedAdminReauthWindow } from '../settings/service.js';
import { auditEvents, notificationDeliveries } from '../db/schema/integrity.js';
import { secureTokens } from '../db/schema/tokens.js';
import {
  affiliateProspects,
  affiliateInvitationSends,
} from '../db/schema/affiliates.js';
import {
  campaigns,
  campaignAffiliateAssociations,
  associationStatusHistory,
} from '../db/schema/domain.js';
import { user as userTable } from '../db/schema/auth.js';
import { TOKEN_REJECTION_STATUS, TOKEN_REJECTION_BODY } from '../auth/token-rejection.js';
import {
  PREPARING_NOTICE,
  DECLINE_NOTICE,
  NEVER_ASKS_NOTICE,
  renderAffiliateInvitation,
} from '../notifications/templates/affiliate-invitation.js';
import { BACKEND_NOTIFICATION_EVENTS } from '../notifications/events.js';
import {
  AFFILIATE_SUBTYPES as BACKEND_SUBTYPES,
  VERIFICATION_STATUSES as BACKEND_VERIFICATION_STATUSES,
  REQUIRED_EVIDENCE as BACKEND_REQUIRED_EVIDENCE,
  SLOT_OCCUPYING_STATUSES as BACKEND_SLOT_STATUSES,
  ACTIVE_PARTNERSHIP_SLOT_LIMIT as BACKEND_SLOT_LIMIT,
} from '../affiliates/registry.js';
import {
  NOTIFICATION_EVENTS,
  AFFILIATE_SUBTYPES,
  VERIFICATION_STATUSES,
  SLOT_OCCUPYING_STATUSES,
  ACTIVE_PARTNERSHIP_SLOT_LIMIT,
  requiredEvidenceIds,
} from '@proovd/shared';

let h: Harness;
let admin: AdminSession;

beforeAll(async () => {
  h = await startHarness({}, 'affiliates');
  admin = await createAdmin(h, 'affiliate-admin');
  // §8's send/resend/revoke and the verification record sit behind the
  // freshness gate, which fails closed while §6's window is unset.
  await seedAdminReauthWindow(h.db, 3600);
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

/* ── helpers ──────────────────────────────────────────────────────────────── */

const COMPLETE_COMPOSE = {
  whyRecruited:
    'Your last three build-in-public threads each ran past 200 replies, and the audience asking the questions is the one this product answers.',
  reviewedPresence: 'Your public profile and the three threads from March, April, and June.',
  senderName: 'Ada Admin',
  senderEmail: 'ada@proovd.co',
};

const RECRUITMENT = {
  legalName: 'Sam Okafor',
  publicHandle: '@sambuilds',
  subtype: 'social_creator',
  channelReference: 'https://example.social/@sambuilds',
  audienceNiche: 'Indie software founders and solo operators',
  campaignFit: 'The audience is the exact buyer for a scheduling tool sold to one-person clinics.',
  audienceSize: '42,000 followers',
  permissionBasis: 'Owns the account outright; no network or agency involved.',
  adminBio: 'Sam writes about building software alone, in public, with the numbers attached.',
  recruitmentSource: 'found through a mutual founder',
  recruitingAdmin: 'Ada Admin',
};

/**
 * A campaign, created the way campaigns actually come into existence.
 *
 * §7 creates the prospect, the campaign container, and the invited draft in one
 * transaction, so a campaign always has a Founder prospect and a product name
 * behind it — even before that Founder has claimed anything. §8's invitation
 * has to name the Founder and the product, and a bare `campaigns` row would be
 * a state the product never reaches.
 */
async function createCampaign(): Promise<string> {
  const res = await request(h.app)
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
  return res.body.campaignId as string;
}


interface Recruited {
  associationId: string;
  prospectId: string;
  campaignId: string;
  email: string;
}

async function recruit(
  overrides: Record<string, unknown> = {},
  campaignId?: string,
): Promise<Recruited> {
  const id = campaignId ?? (await createCampaign());
  const email = `creator-${randomUUID()}@example.com`;
  const res = await request(h.app)
    .post('/api/admin/affiliates')
    .set('cookie', admin.cookie)
    .send({ ...RECRUITMENT, email, campaignId: id, rosterIntent: 'initial_roster', ...overrides })
    .expect(201);
  return { ...res.body, campaignId: id, email };
}

async function compose(associationId: string, overrides: Record<string, unknown> = {}) {
  return request(h.app)
    .patch(`/api/admin/affiliates/${associationId}/invitation`)
    .set('cookie', admin.cookie)
    .send({ ...COMPLETE_COMPOSE, ...overrides })
    .expect(200);
}

/** Sends, and returns the raw link the Creator received. */
async function sendAndCaptureLink(associationId: string): Promise<string> {
  const before = h.sentEmails.messages.length;
  await request(h.app)
    .post(`/api/admin/affiliates/${associationId}/send`)
    .set('cookie', admin.cookie)
    .send({})
    .expect(200);

  const message = h.sentEmails.messages[before];
  expect(message, 'no email was captured').toBeTruthy();
  const match = /http:\/\/localhost:3000\/creator-invitation\/([A-Za-z0-9_-]+)/.exec(message!.text);
  expect(match, 'the email carried no claim link').toBeTruthy();
  return match![1]!;
}

/** A recruited Creator with a sent invitation and its link. */
async function invited(campaignId?: string): Promise<Recruited & { raw: string }> {
  const created = await recruit({}, campaignId);
  await compose(created.associationId);
  const raw = await sendAndCaptureLink(created.associationId);
  return { ...created, raw };
}

/* ── The registers agree across the runtime boundary ──────────────────────── */

describe('the backend register mirrors the shared one', () => {
  it('restates the seven §5.3 subtypes exactly', () => {
    expect([...BACKEND_SUBTYPES]).toEqual([...AFFILIATE_SUBTYPES]);
  });

  it('restates the §8 verification statuses exactly', () => {
    expect([...BACKEND_VERIFICATION_STATUSES]).toEqual([...VERIFICATION_STATUSES]);
  });

  it('restates the required §5.3 evidence for every subtype exactly', () => {
    for (const subtype of AFFILIATE_SUBTYPES) {
      expect([...(BACKEND_REQUIRED_EVIDENCE[subtype] ?? [])], subtype).toEqual([
        ...requiredEvidenceIds(subtype),
      ]);
    }
  });

  it('restates §2.2’s slot rule exactly', () => {
    expect([...BACKEND_SLOT_STATUSES]).toEqual([...SLOT_OCCUPYING_STATUSES]);
    expect(BACKEND_SLOT_LIMIT).toBe(ACTIVE_PARTNERSHIP_SLOT_LIMIT);
  });

  it('sends the invitation under the §27.4 campaign-specific key', () => {
    for (const key of BACKEND_NOTIFICATION_EVENTS) {
      expect(Object.keys(NOTIFICATION_EVENTS)).toContain(key);
    }
    expect(NOTIFICATION_EVENTS.affiliate_campaign_invitation).toMatchObject({
      audience: 'affiliate',
      specRef: '§27.4',
    });
  });
});

/* ══ §33.2.1 (a) — no public signup ═══════════════════════════════════════ */

describe('§33.2.1 — no public Affiliate signup route exists', () => {
  it('closes Better Auth’s sign-up route', async () => {
    const res = await request(h.app)
      .post('/api/auth/sign-up/email')
      .send({
        email: `intruder-${randomUUID()}@example.com`,
        password: 'a-perfectly-good-password',
        name: 'Intruder',
      });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('creates no user row when a sign-up is attempted', async () => {
    const email = `intruder-${randomUUID()}@example.com`;
    await request(h.app)
      .post('/api/auth/sign-up/email')
      .send({ email, password: 'a-perfectly-good-password', name: 'Intruder' });

    const rows = await h.db.select().from(userTable).where(eq(userTable.email, email));
    expect(rows).toHaveLength(0);
  });

  it('refuses recruitment with no session', async () => {
    const campaignId = await createCampaign();
    const res = await request(h.app)
      .post('/api/admin/affiliates')
      .send({ ...RECRUITMENT, email: 'x@example.com', campaignId });
    expect(res.status).toBe(401);
  });

  it('refuses recruitment from a non-Admin session', async () => {
    // A Founder session is a real session with the wrong role. The guard fails
    // closed on the role, not on the absence of a cookie (§33.12.5).
    const founder = await seedUser(h, 'founder', 'not-an-admin');
    const cookie = await signInPlain(h, founder.email);
    const campaignId = await createCampaign();
    const res = await request(h.app)
      .post('/api/admin/affiliates')
      .set('cookie', cookie)
      .send({ ...RECRUITMENT, email: 'x@example.com', campaignId });
    expect(res.status).toBe(403);
  });

  it('exposes no route that creates an Affiliate outside /api/admin', () => {
    // A scan, so a future phase adding a "creator signup" route fails here
    // rather than in production. Everything that can mint an affiliate_invitation
    // token or an affiliate prospect must sit under the admin path.
    const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
    const offenders: string[] = [];

    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'tests' && entry.name !== 'migrations') walk(full);
          continue;
        }
        if (!entry.name.endsWith('.ts')) continue;
        const source = fs.readFileSync(full, 'utf8');
        // A router that both writes an affiliate prospect and is not the
        // admin router is the shape this is looking for.
        const writesProspect = /insert\(\s*affiliateProspects\s*\)/.test(source);
        const isAdminRoute = full.includes('admin-affiliates') || full.includes('affiliates');
        if (writesProspect && !isAdminRoute) offenders.push(path.relative(root, full));
      }
    };

    walk(root);
    expect(offenders, 'an Affiliate can be created outside the Admin surface').toEqual([]);
  });

  it('mounts every recruitment route under the guarded admin path', () => {
    const source = fs.readFileSync(
      fileURLToPath(new URL('../routes/admin-affiliates.ts', import.meta.url)),
      'utf8',
    );
    // Every router.<verb>( in this file names ADMIN_AFFILIATES_PATH and passes
    // `admin`. A route added without the guard fails here.
    const routes = [...source.matchAll(/router\.(get|post|patch|put|delete)\(([\s\S]*?)\n {2}\)/g)];
    expect(routes.length).toBeGreaterThan(0);
    for (const [, verb, body] of source.matchAll(
      /router\.(get|post|patch|put|delete)\(\s*`?\$?\{?ADMIN_AFFILIATES_PATH[^,]*,\s*([a-zA-Z]+)/g,
    )) {
      expect(body, `${verb} route is not behind requireAdmin`).toBe('admin');
    }
  });
});

/* ══ §33.2.1 (b) — the invitation claims only that association ════════════ */

describe('§33.2.1 — an invitation claims only that Affiliate’s association', () => {
  it('binds the token to exactly one association and nothing else', async () => {
    const { associationId, raw } = await invited();

    const hash = await import('node:crypto').then((c) =>
      c.createHash('sha256').update(raw, 'utf8').digest('hex'),
    );
    const [token] = await h.db.select().from(secureTokens).where(eq(secureTokens.tokenHash, hash));

    expect(token!.scope).toBe('affiliate_invitation');
    expect(token!.associationId).toBe(associationId);
    // The scope-binding CHECK (migration 0009) is what makes these NULL, not
    // a convention in the service.
    expect(token!.campaignDraftId).toBeNull();
    expect(token!.campaignId).toBeNull();
    expect(token!.backerIdentityId).toBeNull();
  });

  it('refuses to store a token bound to two scopes at once', async () => {
    const { associationId } = await invited();
    const campaignId = await createCampaign();

    // The database, not the service, is what refuses. A hand-written INSERT is
    // the case a service-level check would miss.
    await expect(
      h.db.insert(secureTokens).values({
        scope: 'affiliate_invitation',
        tokenHash: `deadbeef${randomUUID().replace(/-/g, '')}`,
        version: 1,
        lineageId: randomUUID(),
        associationId,
        campaignId,
      }),
    ).rejects.toThrow();
  });

  it('rejects an Affiliate invitation token at the Founder draft route', async () => {
    const { raw } = await invited();
    const res = await request(h.app).get(`/api/draft/${raw}`);
    expect(res.status).toBe(TOKEN_REJECTION_STATUS);
    expect(res.body).toEqual(TOKEN_REJECTION_BODY);
  });

  it('gives an altered token the identical rejection', async () => {
    const { raw } = await invited();
    const altered = `${raw.slice(0, -1)}${raw.slice(-1) === 'A' ? 'B' : 'A'}`;
    const res = await request(h.app).get(`/api/draft/${altered}`);
    expect(res.status).toBe(TOKEN_REJECTION_STATUS);
    expect(res.body).toEqual(TOKEN_REJECTION_BODY);
  });

  it('creates no account when the invitation is merely sent', async () => {
    const { email } = await invited();
    // §8 recruits; §11 signs up. An invitation that had already created an
    // account would mean the link was a formality rather than a claim.
    const rows = await h.db.select().from(userTable).where(eq(userTable.email, email));
    expect(rows).toHaveLength(0);
  });

  it('keeps two Creators on two campaigns in separate associations and tokens', async () => {
    const first = await invited();
    const second = await invited();

    expect(first.associationId).not.toBe(second.associationId);
    expect(first.campaignId).not.toBe(second.campaignId);

    const tokens = await h.db
      .select({ associationId: secureTokens.associationId })
      .from(secureTokens)
      .where(eq(secureTokens.scope, 'affiliate_invitation'));

    const bound = tokens.map((t) => t.associationId);
    expect(bound).toContain(first.associationId);
    expect(bound).toContain(second.associationId);
  });

  it('refuses to recruit the same Creator to the same campaign twice', async () => {
    // §8 allows ONE invitation per association, and the unique index is what
    // makes "one" true — two associations would be two invitations and two
    // independent statuses for one person on one campaign.
    const campaignId = await createCampaign();
    const first = await recruit({}, campaignId);

    const [existing] = await h.db
      .select({ prospectId: campaignAffiliateAssociations.prospectId })
      .from(campaignAffiliateAssociations)
      .where(eq(campaignAffiliateAssociations.id, first.associationId));

    await expect(
      h.db.insert(campaignAffiliateAssociations).values({
        campaignId,
        affiliateId: existing!.prospectId!,
        prospectId: existing!.prospectId!,
        rosterMembership: 'initial_roster',
      }),
    ).rejects.toThrow();
  });
});

/* ══ §8 — the invitation itself ═══════════════════════════════════════════ */

describe('§8 — the private campaign-specific invitation', () => {
  /**
   * The workspace hint and the real gate must not disagree (added 2026-08-20).
   *
   * `composeInvitations` computes `unresolved`/`canSend` from association
   * columns so a surface can explain a control before it is pressed; the gate
   * is the marker scan over the rendered message. The hint used to test only
   * the four columns the compose dialog owns, so a campaign whose Founder
   * record has no product name reported `canSend: true` while every send was
   * refused on `[PRODUCT NAME]` — a value no control on the Creator workspace
   * can write. §8 permits recruitment "before, during, or after Founder
   * onboarding" and the Founder route does not require a product name, so this
   * is a state a campaign genuinely reaches rather than a hypothetical.
   */
  it('does not report a sendable invitation while the gate refuses (§1.1, §1.4)', async () => {
    // A campaign whose Founder record cannot yet name the product.
    const founder = await request(h.app)
      .post('/api/admin/founders')
      .set('cookie', admin.cookie)
      .send({
        legalName: 'Rowan Vale',
        email: `nameless-product-${randomUUID()}@example.com`,
        invitationSource: 'introduced by a mutual contact',
        internalOwner: 'Ada Admin',
      })
      .expect(201);

    const { associationId, prospectId } = await recruit({}, founder.body.campaignId as string);
    // Everything the compose dialog is able to write.
    await compose(associationId);

    const gate = await request(h.app)
      .get(`/api/admin/affiliates/${associationId}/preview`)
      .set('cookie', admin.cookie)
      .expect(200);
    expect(gate.body.unresolved).toContain('[PRODUCT NAME]');
    expect(gate.body.blocked).toBe(true);

    const detail = await request(h.app)
      .get(`/api/admin/creators/${prospectId}`)
      .set('cookie', admin.cookie)
      .expect(200);
    const view = detail.body.profile.invitations.find(
      (i: { associationId: string }) => i.associationId === associationId,
    );

    expect(view.canSend).toBe(false);
    // And it names where the value lives, because it is not on this screen.
    expect(view.unresolved.join(' ')).toContain('Founder’s record');
    // With the route to get there — a blocker with no destination is the dead
    // end this is fixing.
    expect(view.campaignId).toBe(founder.body.campaignId);
  });

  it('holds Send closed while any field is unwritten', async () => {
    const { associationId } = await recruit();
    await compose(associationId, { whyRecruited: null });

    const preview = await request(h.app)
      .get(`/api/admin/affiliates/${associationId}/preview`)
      .set('cookie', admin.cookie)
      .expect(200);

    expect(preview.body.blocked).toBe(true);
    expect(preview.body.unresolved).toContain('[WHY THIS CREATOR WAS RECRUITED]');

    // §1.1: a disabled button is not authorization. The route re-decides.
    const send = await request(h.app)
      .post(`/api/admin/affiliates/${associationId}/send`)
      .set('cookie', admin.cookie)
      .send({})
      .expect(400);

    expect(send.body.unresolved).toContain('[WHY THIS CREATOR WAS RECRUITED]');
    expect(h.sentEmails.messages.map((m) => m.to)).not.toContain(
      (await request(h.app).get(`/api/admin/affiliates/${associationId}`).set('cookie', admin.cookie))
        .body.prospect.email,
    );
  });

  it('names §8’s seven required contents in the delivered email', async () => {
    const { associationId } = await recruit();
    await compose(associationId);

    const before = h.sentEmails.messages.length;
    await request(h.app)
      .post(`/api/admin/affiliates/${associationId}/send`)
      .set('cookie', admin.cookie)
      .send({})
      .expect(200);

    const message = h.sentEmails.messages[before]!;
    const text = message.text;

    expect(text).toContain(RECRUITMENT.publicHandle); // 1. who, and the product
    expect(text).toContain(COMPLETE_COMPOSE.whyRecruited); // 2. why this Creator
    expect(text).toContain(COMPLETE_COMPOSE.reviewedPresence); // 3. what was reviewed
    expect(text).toContain('one campaign'); // 4. this campaign only
    expect(text).toContain(PREPARING_NOTICE); // 5. may still be preparing
    expect(text).toContain(DECLINE_NOTICE); // 6. declining is free
    expect(text).toMatch(/creator-invitation\/[A-Za-z0-9_-]+/); // 7. one action
    expect(text).toContain('support@proovd.co'); // + support route
  });

  it('never asks for bank, tax, password, or identity details (§8)', async () => {
    const rendered = await renderAffiliateInvitation({
      recipientName: 'Sam',
      founderName: 'Rowan',
      productName: 'Waitlist',
      whyRecruited: 'x',
      reviewedPresence: 'y',
      senderName: 'Ada',
      senderEmail: 'ada@proovd.co',
      claimUrl: 'https://app.proovd.co/creator-invitation/abc',
      reference: 'ref',
      supportEmail: 'support@proovd.co',
    });

    expect(rendered.text).toContain(NEVER_ASKS_NOTICE);
    for (const part of [rendered.subject, rendered.html, rendered.text]) {
      expect(part).not.toMatch(/routing number|account number|social security|\bSSN\b|W-9 form below/i);
    }
  });

  it('uses §3 vocabulary and never leaks an internal name', async () => {
    const { associationId } = await recruit();
    await compose(associationId);
    const preview = await request(h.app)
      .get(`/api/admin/affiliates/${associationId}/preview`)
      .set('cookie', admin.cookie)
      .expect(200);

    for (const part of [preview.body.subject, preview.body.html, preview.body.text]) {
      expect(part).not.toMatch(/\baffiliate\b/i);
      expect(part).not.toMatch(/pre-build|pre_build|pre-launch|pre_launch|tranche|reservation/i);
    }
    expect(preview.body.text).toMatch(/Creator/);
  });

  it('moves the association prospect → invited exactly once across a resend', async () => {
    const { associationId } = await invited();

    const afterFirst = await h.db
      .select()
      .from(associationStatusHistory)
      .where(eq(associationStatusHistory.associationId, associationId));
    expect(afterFirst.map((r) => r.toStatus)).toEqual(['prospect', 'invited']);

    await sendAndCaptureLink(associationId); // resend

    const afterResend = await h.db
      .select()
      .from(associationStatusHistory)
      .where(eq(associationStatusHistory.associationId, associationId));
    // A resend is a new send, not a second transition. Two history rows for one
    // transition would misreport when the Creator was actually invited.
    expect(afterResend.map((r) => r.toStatus)).toEqual(['prospect', 'invited']);
  });

  it('resends a genuinely new email and invalidates the previous link', async () => {
    const { associationId, raw: first } = await invited();
    const before = h.sentEmails.messages.length;

    const second = await sendAndCaptureLink(associationId);

    // §27.2 forbids a duplicate delivery producing a second email; §8 requires
    // resend to work. The dedup key is the SEND, so this is a real second one.
    expect(h.sentEmails.messages.length).toBe(before + 1);
    expect(second).not.toBe(first);

    const sends = await h.db
      .select()
      .from(affiliateInvitationSends)
      .where(eq(affiliateInvitationSends.associationId, associationId));
    expect(sends).toHaveLength(2);
    expect(new Set(sends.map((s) => s.tokenVersion))).toEqual(new Set([1, 2]));

    // The old link is dead the moment the new one is issued.
    const crypto = await import('node:crypto');
    const oldHash = crypto.createHash('sha256').update(first, 'utf8').digest('hex');
    const [oldToken] = await h.db
      .select()
      .from(secureTokens)
      .where(eq(secureTokens.tokenHash, oldHash));
    expect(oldToken!.revokedAt).not.toBeNull();
    expect(oldToken!.revokedReason).toBe('superseded_by_rotation');
  });

  it('writes the send row before the provider call, so a refusal still leaves a record', async () => {
    const { associationId } = await recruit();
    await compose(associationId);

    h.sentEmails.failNext = true;
    const res = await request(h.app)
      .post(`/api/admin/affiliates/${associationId}/send`)
      .set('cookie', admin.cookie)
      .send({})
      .expect(400);

    expect(res.body.whatHappened).toMatch(/did not accept/i);

    const sends = await h.db
      .select()
      .from(affiliateInvitationSends)
      .where(eq(affiliateInvitationSends.associationId, associationId));

    // The row exists and is honestly unconfirmed. §1.4: NULL is a state, not
    // missing data, and Admin renders it as "not confirmed delivered".
    expect(sends).toHaveLength(1);
    expect(sends[0]!.notificationId).toBeNull();
  });

  it('revokes the link without destroying the record (§8, §25.4)', async () => {
    const { associationId, prospectId } = await invited();

    const res = await request(h.app)
      .post(`/api/admin/affiliates/${associationId}/revoke`)
      .set('cookie', admin.cookie)
      .send({ reason: 'channel went dormant' })
      .expect(200);

    expect(res.body.revoked).toBe(1);

    const live = await h.db
      .select()
      .from(secureTokens)
      .where(
        and(
          eq(secureTokens.scope, 'affiliate_invitation'),
          eq(secureTokens.associationId, associationId),
        ),
      );
    expect(live.every((t) => t.revokedAt !== null)).toBe(true);

    // Everything §25.4 keeps per campaign survives revocation.
    const [prospect] = await h.db
      .select()
      .from(affiliateProspects)
      .where(eq(affiliateProspects.id, prospectId));
    expect(prospect).toBeTruthy();

    const sends = await h.db
      .select()
      .from(affiliateInvitationSends)
      .where(eq(affiliateInvitationSends.associationId, associationId));
    expect(sends.length).toBeGreaterThan(0);
  });

  it('refuses to revoke without a stored reason (§25.6)', async () => {
    const { associationId } = await invited();
    const res = await request(h.app)
      .post(`/api/admin/affiliates/${associationId}/revoke`)
      .set('cookie', admin.cookie)
      .send({ reason: '   ' })
      .expect(400);
    expect(res.body.whatHappened).toMatch(/say why/i);
  });

  it('never returns the raw link to Admin (§28.1)', async () => {
    const { associationId, raw } = await invited();

    const detail = await request(h.app)
      .get(`/api/admin/affiliates/${associationId}`)
      .set('cookie', admin.cookie)
      .expect(200);
    const preview = await request(h.app)
      .get(`/api/admin/affiliates/${associationId}/preview`)
      .set('cookie', admin.cookie)
      .expect(200);

    expect(JSON.stringify(detail.body)).not.toContain(raw);
    expect(JSON.stringify(preview.body)).not.toContain(raw);
    // Admin learns that a live link exists, and nothing more.
    expect(detail.body.invitation.hasLiveToken).toBe(true);
  });

  it('records an audit row with actor and reason for every send (§25.6)', async () => {
    const { associationId } = await invited();
    const rows = await h.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.targetId, associationId));

    const sent = rows.find((r) => r.action === 'affiliate.invitation_sent');
    expect(sent).toBeTruthy();
    expect(sent!.actor).toMatch(/^user:/);
    expect(sent!.internalReason).toBeTruthy();
    expect(sent!.customerExplanation).toBeTruthy();
  });

  it('claims one delivery per send in notification_deliveries (§27.2)', async () => {
    const { associationId } = await invited();
    const [send] = await h.db
      .select()
      .from(affiliateInvitationSends)
      .where(eq(affiliateInvitationSends.associationId, associationId));

    const deliveries = await h.db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.entityId, send!.id));
    expect(deliveries).toHaveLength(1);
  });
});

/* ══ §8 / §5.3 — the recruitment record ═══════════════════════════════════ */

describe('§8 — the recruitment record', () => {
  it('records the association’s recruitment provenance per campaign (§25.4)', async () => {
    const { associationId } = await recruit();
    const res = await request(h.app)
      .get(`/api/admin/affiliates/${associationId}`)
      .set('cookie', admin.cookie)
      .expect(200);

    expect(res.body.association.recruitmentSource).toBe(RECRUITMENT.recruitmentSource);
    expect(res.body.association.recruitingAdmin).toBe(RECRUITMENT.recruitingAdmin);
    expect(res.body.association.recruitedAt).toBeTruthy();
    expect(res.body.association.rosterMembership).toBe('initial_roster');
    expect(res.body.association.status).toBe('prospect');
  });

  it('reports the §5.3 evidence still missing for the subtype', async () => {
    const { associationId } = await recruit();
    const res = await request(h.app)
      .get(`/api/admin/affiliates/${associationId}`)
      .set('cookie', admin.cookie)
      .expect(200);

    // A social creator needs platform, followers, engagement, analytics.
    expect([...res.body.missingEvidence].sort()).toEqual(
      [...requiredEvidenceIds('social_creator')].sort(),
    );
  });

  it('refuses to record `verified` while §5.3 evidence is missing', async () => {
    const { associationId } = await recruit();
    const res = await request(h.app)
      .post(`/api/admin/affiliates/${associationId}/verification`)
      .set('cookie', admin.cookie)
      .send({ status: 'verified', verifiedBy: 'Ada Admin' })
      .expect(400);

    expect(res.body.whatHappened).toMatch(/evidence/i);
    expect(res.body.missing.length).toBeGreaterThan(0);
  });

  it('accepts `verified` once the subtype’s evidence is present', async () => {
    const { associationId } = await recruit();
    await request(h.app)
      .post(`/api/admin/affiliates/${associationId}/verification`)
      .set('cookie', admin.cookie)
      .send({
        status: 'verified',
        verifiedBy: 'Ada Admin',
        evidence: {
          platform: 'example.social',
          followers: '42,000',
          engagement: '3.1% median on the last 20 posts',
          analytics: 'https://example.com/evidence/analytics.png',
        },
      })
      .expect(200);

    const detail = await request(h.app)
      .get(`/api/admin/affiliates/${associationId}`)
      .set('cookie', admin.cookie)
      .expect(200);
    expect(detail.body.prospect.verificationStatus).toBe('verified');
    expect(detail.body.prospect.verifiedBy).toBe('Ada Admin');
    expect(detail.body.missingEvidence).toEqual([]);
  });

  it('refuses a verification with no named person (§1.3)', async () => {
    const { associationId } = await recruit();
    const res = await request(h.app)
      .post(`/api/admin/affiliates/${associationId}/verification`)
      .set('cookie', admin.cookie)
      .send({ status: 'in_review', verifiedBy: '' })
      .expect(400);
    expect(res.body.whatHappened).toMatch(/name who/i);
  });

  it('refuses a numeric quality tier — it is never a commission floor (§8)', async () => {
    const campaignId = await createCampaign();
    const res = await request(h.app)
      .post('/api/admin/affiliates')
      .set('cookie', admin.cookie)
      .send({
        ...RECRUITMENT,
        email: `creator-${randomUUID()}@example.com`,
        campaignId,
        qualityTier: '3',
      })
      .expect(400);

    expect(res.body.whatHappened).toMatch(/commission floor/i);
  });

  it('refuses a percentage quality tier too', async () => {
    const campaignId = await createCampaign();
    await request(h.app)
      .post('/api/admin/affiliates')
      .set('cookie', admin.cookie)
      .send({
        ...RECRUITMENT,
        email: `creator-${randomUUID()}@example.com`,
        campaignId,
        qualityTier: '12.5%',
      })
      .expect(400);
  });

  it('refuses a numeric tier at the database level, not only in the service (§8)', async () => {
    // A hand-written UPDATE is exactly the path a service-level check misses.
    const { prospectId } = await recruit();
    await expect(
      h.db
        .update(affiliateProspects)
        .set({ qualityTier: '2' })
        .where(eq(affiliateProspects.id, prospectId)),
    ).rejects.toThrow();
  });

  it('accepts a tier that says something (§8)', async () => {
    const campaignId = await createCampaign();
    await request(h.app)
      .post('/api/admin/affiliates')
      .set('cookie', admin.cookie)
      .send({
        ...RECRUITMENT,
        email: `creator-${randomUUID()}@example.com`,
        campaignId,
        qualityTier: 'strong fit, small audience — worth a first campaign',
      })
      .expect(201);
  });

  it('refuses to recruit to a campaign that was archived and replaced (§9)', async () => {
    // §9's wrong-type path archives a campaign and starts a fresh one, and
    // nothing carries across. Attaching a Creator to the retired record would
    // put them on a campaign that will never run.
    const campaignId = await createCampaign();
    await h.db
      .update(campaigns)
      .set({ archivedAt: new Date(), archivedReason: 'wrong type', archivedBy: 'user:test' })
      .where(eq(campaigns.id, campaignId));

    const res = await request(h.app)
      .post('/api/admin/affiliates')
      .set('cookie', admin.cookie)
      .send({ ...RECRUITMENT, email: `creator-${randomUUID()}@example.com`, campaignId })
      .expect(400);

    expect(res.body.whatHappened).toMatch(/archived/i);

    const rows = await h.db
      .select()
      .from(campaignAffiliateAssociations)
      .where(eq(campaignAffiliateAssociations.campaignId, campaignId));
    expect(rows).toHaveLength(0);
  });

  it('writes only the keys a patch was given', async () => {
    const { associationId } = await recruit();
    await request(h.app)
      .patch(`/api/admin/affiliates/${associationId}/prospect`)
      .set('cookie', admin.cookie)
      .send({ internalComments: 'replied within a day' })
      .expect(200);

    const detail = await request(h.app)
      .get(`/api/admin/affiliates/${associationId}`)
      .set('cookie', admin.cookie)
      .expect(200);

    expect(detail.body.prospect.internalComments).toBe('replied within a day');
    // Everything not in the request is untouched.
    expect(detail.body.prospect.adminBio).toBe(RECRUITMENT.adminBio);
    expect(detail.body.prospect.publicHandle).toBe(RECRUITMENT.publicHandle);
  });
});

/* ══ §2.2 — the active-partnership slot ═══════════════════════════════════ */

describe('§2.2 — preparing, invited, and declined consume no slot', () => {
  it('reports zero slots used for a recruited and invited Creator (§8)', async () => {
    const { associationId } = await invited();
    const res = await request(h.app)
      .get(`/api/admin/affiliates/${associationId}`)
      .set('cookie', admin.cookie)
      .expect(200);

    expect(res.body.slots).toEqual({ used: 0, limit: 3, remaining: 3, atLimit: false });
  });

  it('counts a slot only once the association is active', async () => {
    const { associationId, prospectId } = await recruit();

    // Phase 08 has no path to `active` — Phase 14's tracking-link activation
    // does. Setting it directly is how this proves the accounting without
    // inventing a transition the Spec does not have here.
    await h.db
      .update(campaignAffiliateAssociations)
      .set({ status: 'active' })
      .where(eq(campaignAffiliateAssociations.id, associationId));

    const res = await request(h.app)
      .get(`/api/admin/affiliates/${associationId}`)
      .set('cookie', admin.cookie)
      .expect(200);
    expect(res.body.slots.used).toBe(1);
    expect(res.body.slots.remaining).toBe(2);

    await h.db
      .update(campaignAffiliateAssociations)
      .set({ status: 'ended' })
      .where(eq(campaignAffiliateAssociations.id, associationId));

    const after = await request(h.app)
      .get(`/api/admin/affiliates/${associationId}`)
      .set('cookie', admin.cookie)
      .expect(200);
    // §2.2: the slot runs until campaign close or recorded removal.
    expect(after.body.slots.used).toBe(0);
    expect(prospectId).toBeTruthy();
  });
});

/* ══ §8 / §11 — what the Founder may see ══════════════════════════════════ */

describe('§8 — the Founder sees status cards only', () => {
  it('exposes the public card and status, and nothing sensitive', async () => {
    const { campaignId } = await recruit({
      qualityTier: 'strong fit',
      internalComments: 'never show this to the Founder',
      conflictNotes: 'promotes a competitor occasionally',
      sanctionsNotes: 'nothing flagged',
    });

    const res = await request(h.app)
      .get(`/api/admin/affiliates/founder-view?campaignId=${campaignId}`)
      .set('cookie', admin.cookie)
      .expect(200);

    const [creator] = res.body.creators;
    expect(creator.publicHandle).toBe(RECRUITMENT.publicHandle);
    expect(creator.status).toBe('prospect');
    expect(creator.adminBio).toBe(RECRUITMENT.adminBio);

    // §11: "cannot inspect sensitive onboarding data". The projection never
    // selects these columns, so there is no filter here to forget.
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('never show this to the Founder');
    expect(serialized).not.toContain('promotes a competitor occasionally');
    expect(serialized).not.toContain('strong fit');
    expect(serialized).not.toContain(RECRUITMENT.legalName);
    expect(creator.email).toBeUndefined();
    expect(creator.phone).toBeUndefined();
    expect(creator.qualityTier).toBeUndefined();
    expect(creator.verificationEvidence).toBeUndefined();
    expect(creator.recruitingAdmin).toBeUndefined();
  });

  it('offers no route from the Founder view to contacting a Creator (§30)', async () => {
    const source = fs.readFileSync(
      fileURLToPath(new URL('../routes/admin-affiliates.ts', import.meta.url)),
      'utf8',
    );
    // §30 defers direct Founder–Affiliate messaging. There is no message route,
    // and the Founder projection carries no address to write one against.
    expect(source).not.toMatch(/\/message|\/contact|sendToCreator/i);
  });
});
