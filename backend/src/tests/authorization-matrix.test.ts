/**
 * The authentication and authorization matrix, driven directly at the server.
 *
 * ── Why this file exists beside the per-phase suites ────────────────────────
 * Every phase proves its own routes. What none of them proves is the SHAPE of
 * the boundary as a whole: that the same answer is given for every combination
 * of (who is calling) × (what they are calling), that "signed in" and
 * "authorized" stay two separate decisions, and that neither can be influenced
 * by anything the caller writes.
 *
 * Everything here bypasses the browser completely — supertest against the
 * mounted app, with cookies obtained the way a real client obtains them. That
 * is the point: the frontend is a static SPA whose route guards decide only
 * what to RENDER, so the only meaningful test of the boundary is one that never
 * loads it.
 *
 * ── What is deliberately NOT re-tested ──────────────────────────────────────
 * Individual business rules. This asks who may call, not what the call does.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';

import { startHarness, type Harness } from './app-harness.js';
import { createAuth } from '../auth/auth.js';
import {
  createAdmin,
  createSignedInUser,
  seedUser,
  signInPlain,
  cookiesOf,
  TEST_PASSWORD,
  type AdminSession,
} from './admin-session.js';
import { user as userTable, session as sessionTable } from '../db/schema/auth.js';
import { campaigns } from '../db/schema/domain.js';
import { founderProspects, campaignDrafts } from '../db/schema/invitations.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { founderAccessActions } from '../db/schema/founder-workspace.js';

let h: Harness;
let admin: AdminSession;

beforeAll(async () => {
  h = await startHarness({}, 'authzmatrix');
  admin = await createAdmin(h, 'matrix-admin');
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

/**
 * A claimed campaign with a signed-in Founder.
 *
 * Built directly rather than by driving the whole invitation and vetting
 * journey — what is under test is the authorization edge, and the one part of
 * it that must be real is the claim profile carrying `claimed_user_id`, which
 * is what `findFounderCampaign` joins on.
 */
async function makeFounderCampaign(label: string): Promise<{
  campaignId: string;
  founderId: string;
  email: string;
  cookie: string;
}> {
  const founder = await seedUser(h, 'founder', label);

  const [campaign] = await h.db
    .insert(campaigns)
    .values({ status: 'account_claimed', type: 'pre_build', typeLockedAt: new Date() })
    .returning({ id: campaigns.id });

  const [prospect] = await h.db
    .insert(founderProspects)
    .values({
      preferredName: `Founder ${label}`,
      email: founder.email,
      productName: `Product ${label}`,
      createdBy: `user:${admin.id}`,
      claimedUserId: founder.id,
      claimedAt: new Date(),
    })
    .returning({ id: founderProspects.id });

  const [draft] = await h.db
    .insert(campaignDrafts)
    .values({
      prospectId: prospect!.id,
      campaignId: campaign!.id,
      status: 'claimed',
      createdBy: `user:${admin.id}`,
      updatedBy: `user:${admin.id}`,
    })
    .returning({ id: campaignDrafts.id });

  await h.db.insert(founderClaimProfiles).values({
    draftId: draft!.id,
    prospectId: prospect!.id,
    campaignId: campaign!.id,
    claimedUserId: founder.id,
    claimedAt: new Date(),
    updatedBy: `user:${founder.id}`,
  });

  const cookie = await signInPlain(h, founder.email);
  return { campaignId: campaign!.id, founderId: founder.id, email: founder.email, cookie };
}

/* ══════════════════════════════════════ anonymous reaches nothing protected */

describe('anonymous callers', () => {
  const PROTECTED_READS = [
    '/api/admin/settings',
    '/api/admin/founders',
    '/api/admin/me',
    '/api/account/me',
    '/api/founder/campaigns',
    '/api/creator/campaigns',
  ];

  it('is refused every protected read with 401, not 403', async () => {
    for (const path of PROTECTED_READS) {
      const res = await request(h.app).get(path);
      // 401 rather than 403 is the honest answer: nothing is known about who
      // this is. Answering 403 would assert a decision about an identity that
      // was never established.
      expect(res.status, path).toBe(401);
    }
  });

  it('is refused with a garbage cookie exactly as with none at all', async () => {
    for (const path of PROTECTED_READS) {
      const res = await request(h.app)
        .get(path)
        .set('cookie', 'better-auth.session_token=not-a-real-token');
      expect(res.status, path).toBe(401);
    }
  });

  it('cannot create an account: there is no public signup route (§33.2.1)', async () => {
    for (const path of ['/api/auth/sign-up/email', '/api/auth/sign-up']) {
      const res = await request(h.app)
        .post(path)
        .send({ email: `intruder-${randomUUID()}@example.com`, password: 'x'.repeat(20), name: 'X' });
      expect(res.status, path).toBeGreaterThanOrEqual(400);
    }
    const rows = await h.db.select().from(userTable).where(eq(userTable.name, 'X'));
    expect(rows).toHaveLength(0);
  });

  /**
   * §33.2.1 again, at the door nobody looks at.
   *
   * `emailAndPassword.disableSignUp` does NOT cover social sign-up — Better
   * Auth checks the provider's own flag in the OAuth callback and the
   * email/password flag in the sign-up route, independently. Without
   * `disableSignUp` on the Google provider, `oauth2/link-account.mjs` creates a
   * user for any Google identity it has not seen before, and
   * `mapProfileToUser` stamps it `founder`: public signup, through a route no
   * Proovd surface renders a button for.
   *
   * Asserted at the CONFIG, because the exploit needs a real Google round trip
   * that cannot happen in a suite. The flag is the whole of the fix, so the
   * flag is the thing worth pinning.
   *
   * Built here rather than read off the harness: the harness leaves Google
   * unconfigured, so `socialProviders` is absent there and a loop over it would
   * pass by having nothing to check. This constructs the configured case on
   * purpose, which is the one that ships the moment the env vars are filled in.
   */
  it('closes social sign-up on every configured OAuth provider', async () => {
    const configured = createAuth({
      db: h.db,
      baseUrl: 'http://localhost:3000',
      secret: 'a-test-secret-that-is-long-enough-to-pass',
      adminReauthWindowSeconds: 900,
      useSecureCookies: false,
      sendResetPassword: async () => {},
      google: { clientId: 'test-client-id', clientSecret: 'test-client-secret' },
    });

    const options = (await configured.$context).options as {
      socialProviders?: Record<string, { disableSignUp?: boolean }>;
    };
    const providers = Object.entries(options.socialProviders ?? {});
    // If this is ever empty the assertion below proves nothing.
    expect(providers.length).toBeGreaterThan(0);

    for (const [name, provider] of providers) {
      expect(provider.disableSignUp, `${name} may create accounts`).toBe(true);
    }
  });
});

/* ═══════════════════════════ a session is not an authorization, for any role */

describe('role separation is decided by the session, never by the request', () => {
  const ADMIN_READS = ['/api/admin/settings', '/api/admin/founders', '/api/admin/me'];

  it('refuses an authenticated Founder every Admin route', async () => {
    const founder = await createSignedInUser(h, 'founder', 'matrix-founder-vs-admin');
    for (const path of ADMIN_READS) {
      const res = await request(h.app).get(path).set('cookie', founder.cookie);
      expect(res.status, path).toBe(403);
      // Refused for what the session IS. Answering 401 would tell somebody who
      // is signed in to sign in, and send them round a loop (§27.1).
      expect(res.body.error, path).toBe('forbidden');
    }
  });

  it('refuses an authenticated Creator every Admin route', async () => {
    const creator = await createSignedInUser(h, 'affiliate', 'matrix-creator-vs-admin');
    for (const path of ADMIN_READS) {
      const res = await request(h.app).get(path).set('cookie', creator.cookie);
      expect(res.status, path).toBe(403);
      expect(res.body.error, path).toBe('forbidden');
    }
  });

  it('keeps the Founder and Creator areas apart from each other', async () => {
    const founder = await createSignedInUser(h, 'founder', 'matrix-founder');
    const creator = await createSignedInUser(h, 'affiliate', 'matrix-creator');

    expect((await request(h.app).get('/api/creator/campaigns').set('cookie', founder.cookie)).status)
      .toBe(403);
    expect((await request(h.app).get('/api/founder/campaigns').set('cookie', creator.cookie)).status)
      .toBe(403);
  });

  it('admits an Admin to the Admin routes', async () => {
    for (const path of ADMIN_READS) {
      const res = await request(h.app).get(path).set('cookie', admin.cookie);
      expect(res.status, path).toBe(200);
    }
  });

  /**
   * The escalation attempt, in every shape a client can express it.
   *
   * `role` is declared `input: false` in the Better Auth config and read from
   * the session's own user row by `loadSession`, so none of these can reach a
   * decision. The test exists because "the role is not read from the request"
   * is exactly the property that a future refactor breaks silently.
   */
  it('ignores a client-supplied role in the body, the query, and a header', async () => {
    const founder = await createSignedInUser(h, 'founder', 'matrix-escalation');

    const attempts = [
      request(h.app)
        .get('/api/admin/settings?role=admin&isAdmin=true')
        .set('cookie', founder.cookie),
      request(h.app).get('/api/admin/settings').set('cookie', founder.cookie).set('x-role', 'admin'),
      request(h.app)
        .get('/api/admin/settings')
        .set('cookie', founder.cookie)
        .set('x-admin', 'true'),
      request(h.app)
        .put('/api/admin/settings/admin_reauth_window_seconds')
        .set('cookie', founder.cookie)
        .send({ value: '60', reason: 'escalation attempt', role: 'admin', isAdmin: true }),
    ];

    for (const attempt of attempts) {
      const res = await attempt;
      expect(res.status).toBe(403);
    }

    // And the account is unchanged: nothing about the attempt wrote a role.
    const [row] = await h.db.select().from(userTable).where(eq(userTable.id, founder.id));
    expect(row!.role).toBe('founder');
  });
});

/* ════════════════════════════════════════════════════ CSRF, the second layer */

describe('a state-changing request from another site is refused', () => {
  /**
   * `SameSite=Lax` is the first layer and is what actually stops a browser
   * attaching the session cookie cross-site. This is the second: the same
   * Origin check Better Auth applies to `/api/auth/*`, extended to the rest of
   * the API.
   *
   * Before it existed, a request carrying a valid Admin cookie and
   * `Origin: https://evil.example` was answered 200 on a settings WRITE — the
   * CORS allow-list decides response headers and blocks nothing.
   */
  it('refuses an Admin write carrying an untrusted Origin, and changes nothing', async () => {
    const res = await request(h.app)
      .put('/api/admin/settings/admin_reauth_window_seconds')
      .set('cookie', admin.cookie)
      .set('origin', 'https://evil.example')
      .send({ value: '60', reason: 'csrf probe' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('cross_origin_request_refused');
  });

  /*
   * The two below assert the request got PAST the origin guard, not that it
   * succeeded. The route they use then meets `requireFreshSession`, which fails
   * closed with 503 in this harness because §6's reauthentication window has no
   * value — that is correct behaviour and is asserted elsewhere. What matters
   * here is which gate answered.
   */
  it('allows the same write from the app’s own origin', async () => {
    const res = await request(h.app)
      .put('/api/admin/settings/admin_reauth_window_seconds')
      .set('cookie', admin.cookie)
      .set('origin', 'http://localhost:3000')
      .send({ value: '900', reason: 'authorization matrix' });

    expect(res.body.error).not.toBe('cross_origin_request_refused');
  });

  /**
   * The asymmetry, asserted rather than assumed.
   *
   * A missing Origin is a non-browser caller with no ambient cookie to borrow —
   * curl, a server, this suite, and both signed webhook endpoints. Refusing it
   * would break Stripe and Cal.com in exchange for no security, so it passes.
   */
  it('allows a state-changing request that carries no Origin at all', async () => {
    const res = await request(h.app)
      .put('/api/admin/settings/admin_reauth_window_seconds')
      .set('cookie', admin.cookie)
      .send({ value: '900', reason: 'authorization matrix, no origin' });

    expect(res.body.error).not.toBe('cross_origin_request_refused');
  });

  it('does not gate reads — only state-changing methods', async () => {
    const res = await request(h.app)
      .get('/api/admin/me')
      .set('cookie', admin.cookie)
      .set('origin', 'https://evil.example');

    // A cross-site GET cannot be stopped here anyway (`SameSite=Lax` permits
    // top-level GET), so gating it would cost compatibility for nothing. There
    // are no state-changing GETs under /api.
    expect(res.status).toBe(200);
  });
});

/* ═══════════════════════════ an identity is never taken from a request body */

describe('the account claim will not accept a user id as proof of identity', () => {
  /**
   * The claim route used to read `googleUserId` from the body and bind the
   * draft — and therefore the campaign — to whatever id it was given. A caller
   * holding a draft link could attach that campaign to another person's Founder
   * account by typing their id in, because the server treated a request field
   * as evidence of who was calling.
   *
   * The route now reads the id off a real Better Auth session. This drives the
   * old shape at it: a valid draft token, a real Founder's id in the body, and
   * no session. It must not bind anything.
   */
  it('ignores a googleUserId in the body when no session backs it', async () => {
    const victim = await makeFounderCampaign('matrix-claim-victim');

    const { raw } = await h.tokens.issue({
      scope: 'founder_draft',
      campaignDraftId: randomUUID(),
    });

    const res = await request(h.app)
      .post(`/api/draft/${raw}/claim`)
      .send({ googleUserId: victim.founderId, acceptedPolicySlugs: [] });

    // Refused. The precise code is not the subject — what matters is that no
    // 2xx path exists for an unproven identity.
    expect(res.status).toBeGreaterThanOrEqual(400);

    // And nothing was bound to the victim by the attempt. Their claim profile
    // still points at their own campaign and only that one.
    const profiles = await h.db
      .select({ campaignId: founderClaimProfiles.campaignId })
      .from(founderClaimProfiles)
      .where(eq(founderClaimProfiles.claimedUserId, victim.founderId));
    expect(profiles.map((p) => p.campaignId)).toEqual([victim.campaignId]);
  });
});

/* ══════════════════════════════════════════ object-level authorization (IDOR) */

describe('one Founder cannot reach another Founder record', () => {
  it("answers another Founder's real campaign exactly as a campaign that does not exist", async () => {
    const mine = await makeFounderCampaign('matrix-idor-a');
    const theirs = await makeFounderCampaign('matrix-idor-b');

    const otherCampaign = await request(h.app)
      .get(`/api/founder/campaigns/${theirs.campaignId}/workspace`)
      .set('cookie', mine.cookie);

    const noSuchCampaign = await request(h.app)
      .get(`/api/founder/campaigns/${randomUUID()}/workspace`)
      .set('cookie', mine.cookie);

    // Identical, deliberately. A different answer for "exists but is not yours"
    // is an enumeration oracle over the campaign table.
    expect(otherCampaign.status).toBe(noSuchCampaign.status);
    expect(otherCampaign.status).toBe(404);
    expect(otherCampaign.body).toEqual(noSuchCampaign.body);
  });

  it('serves a Founder their own campaign, so the refusal above is about ownership', async () => {
    const mine = await makeFounderCampaign('matrix-idor-own');
    const res = await request(h.app)
      .get(`/api/founder/campaigns/${mine.campaignId}/workspace`)
      .set('cookie', mine.cookie);
    expect(res.status).toBe(200);
  });
});

/* ══════════════════════════════════ account standing outranks a live session */

describe('§26.7 / §22.7 — enforcement reaches an existing session', () => {
  it('blocks a suspended Founder on their next request and restores them when lifted', async () => {
    const founder = await makeFounderCampaign('matrix-suspended');

    // In good standing to begin with.
    await request(h.app)
      .get('/api/founder/campaigns')
      .set('cookie', founder.cookie)
      .expect(200);

    const [prospect] = await h.db
      .select({ id: founderProspects.id })
      .from(founderProspects)
      .where(eq(founderProspects.claimedUserId, founder.founderId));

    await h.db.insert(founderAccessActions).values({
      prospectId: prospect!.id,
      userId: founder.founderId,
      action: 'suspend',
      reason: 'Authorization matrix: standing must reach a live session.',
      reviewOwner: 'Proovd',
      nextReviewAt: new Date(Date.now() + 86_400_000),
      actor: `user:${admin.id}`,
    });

    // The SAME cookie, unchanged. This is the whole point: enforcement that
    // only takes effect at the next sign-in is not enforcement.
    const blocked = await request(h.app)
      .get('/api/founder/campaigns')
      .set('cookie', founder.cookie);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe('account_suspended');

    // Signing in again does not get around it either.
    const freshCookie = await signInPlain(h, founder.email);
    expect(
      (await request(h.app).get('/api/founder/campaigns').set('cookie', freshCookie)).status,
    ).toBe(403);

    await h.db.insert(founderAccessActions).values({
      prospectId: prospect!.id,
      userId: founder.founderId,
      action: 'restore',
      reason: 'Authorization matrix: the restore path must actually restore.',
      actor: `user:${admin.id}`,
    });

    await request(h.app)
      .get('/api/founder/campaigns')
      .set('cookie', founder.cookie)
      .expect(200);
  });

  it('leaves other roles alone — the gate is Founder-scoped by design', async () => {
    const creator = await createSignedInUser(h, 'affiliate', 'matrix-standing-creator');
    const res = await request(h.app).get('/api/creator/campaigns').set('cookie', creator.cookie);
    expect(res.status).toBe(200);
  });
});

/* ═════════════════════════════════════════════════ the session lifecycle itself */

describe('session lifecycle', () => {
  it('issues a session on sign-in and refuses everything protected after sign-out', async () => {
    const { email } = await seedUser(h, 'admin', 'matrix-lifecycle');
    const cookie = await signInPlain(h, email);

    await request(h.app).get('/api/admin/me').set('cookie', cookie).expect(200);

    await request(h.app).post('/api/auth/sign-out').set('cookie', cookie).send({});

    // The same cookie is now worth nothing. Sign-out revokes the session row —
    // it is not merely a client-side forget.
    const after = await request(h.app).get('/api/admin/me').set('cookie', cookie);
    expect(after.status).toBe(401);
    const alsoAfter = await request(h.app).get('/api/account/me').set('cookie', cookie);
    expect(alsoAfter.status).toBe(401);
  });

  it('gives a new sign-in a different session token than the one before it', async () => {
    // Session fixation: whatever identifier existed before authenticating must
    // not be the one that carries the authenticated session afterwards.
    const { email, id } = await seedUser(h, 'founder', 'matrix-fixation');

    const first = await signInPlain(h, email);
    const second = await signInPlain(h, email);
    expect(second).not.toBe(first);

    const rows = await h.db
      .select({ token: sessionTable.token })
      .from(sessionTable)
      .where(eq(sessionTable.userId, id));
    const tokens = new Set(rows.map((r) => r.token));
    expect(tokens.size).toBe(rows.length);
  });

  it('does not set a session cookie when the password is wrong', async () => {
    const { email } = await seedUser(h, 'founder', 'matrix-wrong-password');
    const res = await request(h.app)
      .post('/api/auth/sign-in/email')
      .send({ email, password: 'definitely-not-it' });

    expect(res.status).toBeGreaterThanOrEqual(400);
    const cookie = cookiesOf(res);
    if (cookie) {
      expect(
        (await request(h.app).get('/api/account/me').set('cookie', cookie)).status,
      ).toBe(401);
    }
  });
});

/* ══════════════════════════════════════════ deterministic authentication errors */

describe('authentication answers are deterministic and never leak', () => {
  it('answers a malformed sign-in with a 4xx decision rather than a 500', async () => {
    // §1.4 and §30: an unexplained 500 leaves the browser unable to say whether
    // anything happened. Bad input is a decision, and the server makes it.
    const malformed = [
      {},
      { email: 'not-an-email' },
      { email: null, password: null },
      { email: ['a@b.c'], password: { nested: true } },
      { email: 'a@b.c' },
    ];

    for (const body of malformed) {
      const res = await request(h.app).post('/api/auth/sign-in/email').send(body);
      expect(res.status, JSON.stringify(body)).toBeGreaterThanOrEqual(400);
      expect(res.status, JSON.stringify(body)).toBeLessThan(500);
    }
  });

  it('never returns a password hash or a session token in any account payload', async () => {
    const bodies = [
      (await request(h.app).get('/api/account/me').set('cookie', admin.cookie)).text,
      (await request(h.app).get('/api/admin/me').set('cookie', admin.cookie)).text,
      (
        await request(h.app)
          .post('/api/auth/sign-in/email')
          .send({ email: admin.email, password: TEST_PASSWORD })
      ).text,
    ];

    for (const body of bodies) {
      expect(body).not.toMatch(/\$2[aby]\$|\bpassword\b\s*:/i);
      expect(body).not.toMatch(/sessionToken|session_token/i);
    }
  });
});
