/**
 * Phase 08b acceptance suite — §33.2.2 and §33.2.3, server side.
 *
 * §33's own framing: these are requirements, not examples.
 *
 *   33.2.2  Compact flow has Proovd account action and Stripe payout action,
 *           no custom bank form/tour.
 *   33.2.3  Waiting state is named and no-action-needed.
 *
 * The surface half of both lives in
 * `frontend/src/surfaces/creator/creator-signup.test.tsx`. What is proved here
 * is what the server does and — for §33.2.2's negative half — what routes do
 * not exist at all.
 *
 * Also proved, because §11 states them and a later phase would otherwise
 * inherit them untested: the five confirmations are five separate facts, the
 * claim is exactly-once under retry and concurrency, a draft policy blocks it
 * in the open, corrections to prefilled fields are recorded, and the invitation
 * token cannot be crossed with a Founder draft.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID, createHash } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startHarness, type Harness } from './app-harness.js';
import { createAdmin, type AdminSession } from './admin-session.js';
import { seedAdminReauthWindow } from '../settings/service.js';
import { auditEvents, idempotencyKeys, notificationDeliveries } from '../db/schema/integrity.js';
import { secureTokens } from '../db/schema/tokens.js';
import { policyVersions } from '../db/schema/policies.js';
import { policyConsents } from '../db/schema/vetting.js';
import { affiliateProspects } from '../db/schema/affiliates.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import { campaignAffiliateAssociations, associationStatusHistory } from '../db/schema/domain.js';
import { campaignDrafts } from '../db/schema/invitations.js';
import { user as userTable } from '../db/schema/auth.js';
import { TOKEN_REJECTION_STATUS, TOKEN_REJECTION_BODY } from '../auth/token-rejection.js';
import {
  AFFILIATE_CLAIM_POLICY_SLUGS,
  affiliateSignupCompleteKey,
} from '../affiliates/signup.js';
import { NO_ACTION_NEEDED } from '../notifications/templates/affiliate-signup-confirmed.js';
import { BACKEND_NOTIFICATION_EVENTS } from '../notifications/events.js';
import { NOTIFICATION_EVENTS } from '@proovd/shared';

let h: Harness;
let admin: AdminSession;

beforeAll(async () => {
  h = await startHarness({}, 'affiliatesignup');
  admin = await createAdmin(h, 'signup-admin');
  await seedAdminReauthWindow(h.db, 3600);
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

/* ── helpers ──────────────────────────────────────────────────────────────── */

const RECRUITMENT = {
  legalName: 'Sam Okafor',
  publicHandle: '@sambuilds',
  subtype: 'social_creator',
  channelReference: 'https://example.social/@sambuilds',
  audienceNiche: 'Indie software founders',
  campaignFit: 'The audience is the exact buyer.',
  audienceSize: '42,000 followers',
  permissionBasis: 'Owns the account outright.',
  adminBio: 'Sam writes about building software alone, in public.',
  recruitmentSource: 'found through a mutual founder',
  recruitingAdmin: 'Priya Recruiter',
};

const COMPOSE = {
  whyRecruited: 'Your last three threads each ran past 200 replies.',
  reviewedPresence: 'Your public profile and the March, April, and June threads.',
  senderName: 'Ada Admin',
  senderEmail: 'ada@proovd.co',
};

/**
 * §11 requires published Terms + Affiliate AUP, and both ship as drafts.
 *
 * There is no matching `unpublish`: §29.8 makes publication one-way and a
 * trigger enforces it (`enforce_policy_version_immutability`). So the
 * draft-refusal case has to be proved *before* anything here publishes, which
 * is why it lives in its own describe above the ones that call this. Restoring
 * the draft afterwards is not an option, and a helper that pretended otherwise
 * would be fighting the invariant rather than testing it.
 *
 * Idempotent: it only touches rows that are still drafts, so a second call from
 * a second describe cannot trip the append-only `published_at`.
 */
async function publishClaimPolicies(): Promise<void> {
  await h.db
    .update(policyVersions)
    .set({ status: 'published', effectiveDate: '2026-01-01', publishedAt: new Date() })
    .where(
      and(
        inArray(policyVersions.slug, [...AFFILIATE_CLAIM_POLICY_SLUGS]),
        eq(policyVersions.status, 'draft'),
      ),
    );
}

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

interface Invited {
  associationId: string;
  prospectId: string;
  campaignId: string;
  email: string;
  raw: string;
}

/** A recruited Creator with a sent invitation and its raw link. */
async function invited(): Promise<Invited> {
  const campaignId = await createCampaign();
  const email = `creator-${randomUUID()}@example.com`;

  const created = await request(h.app)
    .post('/api/admin/affiliates')
    .set('cookie', admin.cookie)
    .send({ ...RECRUITMENT, email, campaignId, rosterIntent: 'initial_roster' })
    .expect(201);

  await request(h.app)
    .patch(`/api/admin/affiliates/${created.body.associationId}/invitation`)
    .set('cookie', admin.cookie)
    .send(COMPOSE)
    .expect(200);

  const before = h.sentEmails.messages.length;
  await request(h.app)
    .post(`/api/admin/affiliates/${created.body.associationId}/send`)
    .set('cookie', admin.cookie)
    .send({})
    .expect(200);

  const message = h.sentEmails.messages[before]!;
  const match = /http:\/\/localhost:3000\/creator-invitation\/([A-Za-z0-9_-]+)/.exec(message.text);
  expect(match, 'the invitation carried no claim link').toBeTruthy();

  return { ...created.body, campaignId, email, raw: match![1]! };
}

const COMPLETE_PROFILE = {
  dateOfBirth: '1994-03-11',
  country: 'US',
  stateRegion: 'CA',
  confirmAge18Plus: true,
  confirmUsBased: true,
  confirmActualOperator: true,
  confirmNoDuplicateAccounts: true,
  confirmSanctionsEligible: true,
};

async function fillProfile(raw: string, overrides: Record<string, unknown> = {}) {
  return request(h.app)
    .patch(`/api/affiliate-invitation/${raw}`)
    .send({ ...COMPLETE_PROFILE, ...overrides })
    .expect(200);
}

/** Returns the supertest chain, so callers can `.expect(...)` on it. */
function claim(raw: string, body: Record<string, unknown> = {}) {
  return request(h.app)
    .post(`/api/affiliate-invitation/${raw}/claim`)
    .send({
      password: 'a-perfectly-good-password',
      acceptedPolicySlugs: [...AFFILIATE_CLAIM_POLICY_SLUGS],
      ...body,
    });
}

/* ── The register agrees with what the backend sends ──────────────────────── */

describe('the signup confirmation uses the §27.4 key', () => {
  it('names only keys the shared register defines', () => {
    for (const key of BACKEND_NOTIFICATION_EVENTS) {
      expect(Object.keys(NOTIFICATION_EVENTS)).toContain(key);
    }
    expect(NOTIFICATION_EVENTS.affiliate_signup_confirmed).toMatchObject({
      audience: 'affiliate',
      specRef: '§27.4',
    });
  });

  it('claims no key that nothing actually sends (§1.4)', () => {
    // The rule is "a key appears here when something starts sending it, never
    // before" — a key with no sender claims a message the product does not
    // send. This asserts the rule rather than a snapshot of which keys exist:
    // the earlier version named the Phase 08c key as absent, which stopped
    // being true the moment 08c built its sender, and a test that has to be
    // edited every phase stops being read.
    const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
    const sources: string[] = [];

    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'tests' && entry.name !== 'migrations') walk(full);
          continue;
        }
        if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
          if (!full.endsWith(path.join('notifications', 'events.ts'))) {
            sources.push(fs.readFileSync(full, 'utf8'));
          }
        }
      }
    };
    walk(root);

    const tree = sources.join('\n');
    for (const key of BACKEND_NOTIFICATION_EVENTS) {
      const constantName = key.toUpperCase();
      expect(
        tree.includes(constantName),
        `${key} is registered but nothing sends it`,
      ).toBe(true);
    }
  });
});

/* ══ §33.2.2 — two primary actions, no bank form, no tour ════════════════ */

describe('§33.2.2 — the compact flow has exactly two primary actions', () => {
  it('serves the whole flow from one address', async () => {
    const { raw } = await invited();
    const res = await request(h.app).get(`/api/affiliate-invitation/${raw}`).expect(200);

    // Everything the one compact flow needs, in one response. §11 forbids a
    // multi-page sequence, and a surface that had to walk several endpoints to
    // assemble itself would be that sequence wearing a different hat.
    expect(res.body.landing).toBeTruthy();
    expect(res.body.profile).toBeTruthy();
    expect(res.body.conditional).toBeTruthy();
    expect(res.body.policies).toHaveLength(AFFILIATE_CLAIM_POLICY_SLUGS.length);
  });

  it('prefills the profile from the §8 recruitment record, with source labels', async () => {
    const { raw } = await invited();
    const res = await request(h.app).get(`/api/affiliate-invitation/${raw}`).expect(200);

    const f = res.body.profile.fields;
    expect(f.legalName.value).toBe(RECRUITMENT.legalName);
    expect(f.legalName.supplier).toBe('proovd');
    expect(f.legalName.prefilled).toBe(RECRUITMENT.legalName);
    expect(f.bio.value).toBe(RECRUITMENT.adminBio);
    expect(f.bio.supplier).toBe('proovd');
    // Never prefilled — Proovd does not learn these at recruitment.
    expect(f.dateOfBirth.value).toBeNull();
    expect(f.dateOfBirth.prefilled).toBeNull();
  });

  it('records a correction and flips the source label (§11)', async () => {
    const { raw } = await invited();
    await fillProfile(raw, { bio: 'I write about shipping alone, badly, on purpose.' });

    const res = await request(h.app).get(`/api/affiliate-invitation/${raw}`).expect(200);
    expect(res.body.profile.fields.bio.supplier).toBe('affiliate');
    // What Proovd wrote survives beside what they replaced it with.
    expect(res.body.profile.fields.bio.prefilled).toBe(RECRUITMENT.adminBio);
    expect(res.body.profile.fields.bio.editedAt).toBeTruthy();
  });

  it('flips the label back when a correction restores what Proovd wrote', async () => {
    // The label describes the value, not the last actor to touch it.
    const { raw } = await invited();
    await fillProfile(raw, { bio: 'something else' });
    await fillProfile(raw, { bio: RECRUITMENT.adminBio });

    const res = await request(h.app).get(`/api/affiliate-invitation/${raw}`).expect(200);
    expect(res.body.profile.fields.bio.supplier).toBe('proovd');
  });

  it('writes only the keys a save was given', async () => {
    const { raw } = await invited();
    await fillProfile(raw, { country: 'US' });

    const res = await request(h.app).get(`/api/affiliate-invitation/${raw}`).expect(200);
    expect(res.body.profile.fields.country.value).toBe('US');
    // Everything not in the request is untouched.
    expect(res.body.profile.fields.publicHandle.value).toBe(RECRUITMENT.publicHandle);
    expect(res.body.profile.fields.bio.value).toBe(RECRUITMENT.adminBio);
  });

  it('reports the payout step as a status, not a form', async () => {
    const { raw } = await invited();
    const res = await request(h.app).get(`/api/affiliate-invitation/${raw}/payout`).expect(200);

    expect(res.body.status).toBe('not_started');
    // §1.4: Stripe is Phase 10, and the surface says so rather than rendering a
    // control that would do nothing.
    expect(res.body.onboardingAvailable).toBe(false);
    expect(res.body.connectedAccountId).toBeNull();
  });

  it('exposes NO route that collects a bank, tax, or identity field (§11)', () => {
    // §11: "Proovd must not reproduce provider-controlled banking or identity
    // fields in a custom form." The absence of the route is what makes that
    // true; a scan is what keeps it true.
    const source = fs.readFileSync(
      fileURLToPath(new URL('../routes/affiliate-invitation.ts', import.meta.url)),
      'utf8',
    );
    expect(source).not.toMatch(
      /routingNumber|accountNumber|bankAccount|taxId|ssn|socialSecurity|dateOfIncorporation|idDocument/i,
    );
  });

  it('stores no bank or identity column anywhere in the signup record', async () => {
    const columns = await h.db.execute(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'affiliate_signup_profiles'`,
    );
    const names = (columns.rows as Array<{ column_name: string }>).map((r) => r.column_name);
    for (const forbidden of ['routing_number', 'account_number', 'bank_account', 'tax_id', 'ssn']) {
      expect(names, forbidden).not.toContain(forbidden);
    }
    // §5.3: Proovd stores connected-account/capability/requirement/payout
    // statuses and IDs, and never full bank details.
    expect(names).toContain('connected_account_id');
    expect(names).toContain('payout_status');
  });

  it('refuses a connected-account id that is not a Stripe account reference', async () => {
    // The column exists to hold an id. A constraint stops it becoming a place
    // where a card or an account number gets stashed instead.
    const { raw, associationId } = await invited();
    await request(h.app).get(`/api/affiliate-invitation/${raw}`).expect(200);

    await expect(
      h.db
        .update(affiliateSignupProfiles)
        .set({ connectedAccountId: '4111 1111 1111 1111' })
        .where(eq(affiliateSignupProfiles.associationId, associationId)),
    ).rejects.toThrow();

    // A real Stripe account reference is accepted.
    await h.db
      .update(affiliateSignupProfiles)
      .set({ connectedAccountId: 'acct_1234567890' })
      .where(eq(affiliateSignupProfiles.associationId, associationId));
  });

  it('exposes no tour or step-sequence route (§11)', () => {
    const source = fs.readFileSync(
      fileURLToPath(new URL('../routes/affiliate-invitation.ts', import.meta.url)),
      'utf8',
    );
    expect(source).not.toMatch(/\/tour|\/onboarding\/step|\/welcome|\/step\/|stepIndex/i);
  });
});

/* ══ The draft-policy refusal — must run before anything publishes ══════ */

/**
 * §29.8 makes publication one-way and a trigger enforces it, so this case
 * cannot be restored once a later test publishes. It therefore runs first, in
 * its own describe, against the drafts the repo actually ships.
 */
describe('§11 — a draft agreement blocks the claim, in the open', () => {
  it('refuses, says why, and loses nothing', async () => {
    const { raw } = await invited();
    await fillProfile(raw);

    const res = await claim(raw).expect(400);
    expect(res.body.error).toBe('policies_unpublished');
    expect(res.body.whatHappened).toMatch(/still with our lawyers/i);
    expect(res.body.next).toMatch(/nothing was created/i);

    // Nothing was created, and nothing entered was lost.
    const state = await request(h.app).get(`/api/affiliate-invitation/${raw}`).expect(200);
    expect(state.body.profile.fields.country.value).toBe('US');
    expect(state.body.profile.claimedAt).toBeNull();
  });

  it('reports both required agreements as drafts', async () => {
    const { raw } = await invited();
    const res = await request(h.app).get(`/api/affiliate-invitation/${raw}`).expect(200);
    expect(res.body.policies.map((p: { status: string }) => p.status)).toEqual([
      'draft',
      'draft',
    ]);
  });
});

/* ══ The claim ═══════════════════════════════════════════════════════════ */

describe('§11 — Confirm and create account', () => {
  beforeAll(publishClaimPolicies);

  it('creates the account, burns the token, and moves the association', async () => {
    const { raw, associationId, email } = await invited();
    await fillProfile(raw);

    const res = await claim(raw).expect(201);
    expect(res.body.userId).toBeTruthy();

    const [account] = await h.db.select().from(userTable).where(eq(userTable.email, email));
    expect(account).toBeTruthy();
    // §5.1: role has no database default; every creation path states it.
    expect(account!.role).toBe('affiliate');
    // §5.3, §33.1.8: collected, never verified.
    expect(account!.phoneVerified).toBe(false);

    const hash = createHash('sha256').update(raw, 'utf8').digest('hex');
    const [token] = await h.db.select().from(secureTokens).where(eq(secureTokens.tokenHash, hash));
    expect(token!.claimedAt).not.toBeNull();

    const [association] = await h.db
      .select()
      .from(campaignAffiliateAssociations)
      .where(eq(campaignAffiliateAssociations.id, associationId));
    expect(association!.status).toBe('signed_up_waiting_for_founder');
    expect(association!.invitationStatus).toBe('claimed');
  });

  it('records both §23.4 hops, even when the Creator never saved first', async () => {
    const { raw, associationId } = await invited();
    // Straight to the claim: everything but DOB/country/state is prefilled.
    await fillProfile(raw);
    await claim(raw).expect(201);

    const history = await h.db
      .select()
      .from(associationStatusHistory)
      .where(eq(associationStatusHistory.associationId, associationId));

    expect(history.map((r) => r.toStatus)).toEqual([
      'prospect',
      'invited',
      'signup_started',
      'signed_up_waiting_for_founder',
    ]);
  });

  it('emits affiliate_signup_complete exactly once; a retry adds nothing', async () => {
    const { raw, associationId } = await invited();
    await fillProfile(raw);

    await claim(raw).expect(201);
    const retry = await claim(raw);
    expect(retry.status).toBe(TOKEN_REJECTION_STATUS);

    const keys = await h.db
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, affiliateSignupCompleteKey(associationId)));
    expect(keys).toHaveLength(1);
  });

  it('two concurrent claims produce one account and one safe failure', async () => {
    const { raw, email } = await invited();
    await fillProfile(raw);

    const [a, b] = await Promise.all([claim(raw), claim(raw)]);
    const statuses = [a.status, b.status].sort();
    expect(statuses[0]).toBe(201);
    expect(statuses[1]).toBeGreaterThanOrEqual(400);

    const accounts = await h.db.select().from(userTable).where(eq(userTable.email, email));
    expect(accounts).toHaveLength(1);
  });

  it('writes a consent citing the published version of each required document', async () => {
    const { raw } = await invited();
    await fillProfile(raw);
    const res = await claim(raw).expect(201);

    const consents = await h.db
      .select()
      .from(policyConsents)
      .where(eq(policyConsents.subjectId, res.body.userId));

    expect(consents.map((c) => c.slug).sort()).toEqual([...AFFILIATE_CLAIM_POLICY_SLUGS].sort());
    for (const consent of consents) {
      expect(consent.acceptedVia).toBe('affiliate_account_claim');
    }
  });

  it('collects exactly the two acceptances §11 names — not privacy', async () => {
    // §10's Founder claim takes privacy because §10's own list names it. §11's
    // does not, and collecting an acceptance the Spec does not ask for is as
    // wrong as skipping one it does.
    expect([...AFFILIATE_CLAIM_POLICY_SLUGS]).toEqual(['terms', 'affiliate-aup']);
  });

  it('requires all five confirmations, and names the missing ones', async () => {
    const { raw } = await invited();
    await fillProfile(raw, { confirmSanctionsEligible: false, confirmUsBased: false });

    const res = await claim(raw).expect(400);
    expect(res.body.error).toBe('confirmations_missing');
    expect(res.body.missing.sort()).toEqual(['sanctionsEligible', 'usBased']);
  });

  it('keeps the five confirmations as five independent facts (§28.4)', async () => {
    const { raw } = await invited();
    // Setting one must not set another — no bundling, no "accept all".
    await fillProfile(raw, {
      confirmAge18Plus: true,
      confirmUsBased: false,
      confirmActualOperator: false,
      confirmNoDuplicateAccounts: false,
      confirmSanctionsEligible: false,
    });

    const res = await request(h.app).get(`/api/affiliate-invitation/${raw}`).expect(200);
    expect(res.body.profile.confirmations).toEqual({
      age18Plus: true,
      usBased: false,
      actualOperator: false,
      noDuplicateAccounts: false,
      sanctionsEligible: false,
    });
  });

  it('requires each agreement to be accepted', async () => {
    const { raw } = await invited();
    await fillProfile(raw);

    const res = await claim(raw, { acceptedPolicySlugs: ['terms'] }).expect(400);
    expect(res.body.error).toBe('consent_missing');
    expect(res.body.missing).toContain('affiliate-aup');
  });

  it('refuses a short password without creating anything', async () => {
    const { raw, email } = await invited();
    await fillProfile(raw);

    const res = await claim(raw, { password: 'short' }).expect(400);
    expect(res.body.error).toBe('credentials_missing');

    const accounts = await h.db.select().from(userTable).where(eq(userTable.email, email));
    expect(accounts).toHaveLength(0);
  });

  it('names the details still missing rather than failing vaguely', async () => {
    const { raw } = await invited();
    await fillProfile(raw, { dateOfBirth: null, stateRegion: null });

    const res = await claim(raw).expect(400);
    expect(res.body.error).toBe('profile_incomplete');
    expect(res.body.missing.sort()).toEqual(['dateOfBirth', 'stateRegion']);
    expect(res.body.next).toMatch(/everything else you have entered is saved/i);
  });

  it('records the corrections in the audit row (§11)', async () => {
    const { raw, associationId } = await invited();
    await fillProfile(raw, { bio: 'My own words.', audienceSize: '43,100 followers' });
    await claim(raw).expect(201);

    const [event] = await h.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.targetId, associationId),
          eq(auditEvents.action, 'affiliate_signup_complete'),
        ),
      );

    expect(event).toBeTruthy();
    const corrections = (event!.newValue as { corrections: string[] }).corrections;
    expect(corrections).toContain('bio');
    expect(corrections).toContain('audienceSize');
    expect(corrections).not.toContain('legalName');
  });

  it('refuses to clear a claim at the database level', async () => {
    const { raw, associationId } = await invited();
    await fillProfile(raw);
    await claim(raw).expect(201);

    await expect(
      h.db
        .update(affiliateSignupProfiles)
        .set({ claimedAt: null })
        .where(eq(affiliateSignupProfiles.associationId, associationId)),
    ).rejects.toThrow();
  });

  it('binds the prospect to the account it created', async () => {
    const { raw, prospectId } = await invited();
    await fillProfile(raw);
    const res = await claim(raw).expect(201);

    const [prospect] = await h.db
      .select()
      .from(affiliateProspects)
      .where(eq(affiliateProspects.id, prospectId));
    expect(prospect!.claimedUserId).toBe(res.body.userId);
    expect(prospect!.claimedAt).not.toBeNull();
  });
});

/* ══ §33.2.3 — the named waiting state ═══════════════════════════════════ */

describe('§33.2.3 — the waiting state is named and no-action-needed', () => {
  beforeAll(publishClaimPolicies);

  it('reports awaiting_founder while the Founder has not claimed', async () => {
    const { raw } = await invited();
    await fillProfile(raw);
    await claim(raw).expect(201);

    const res = await request(h.app).get(`/api/affiliate-invitation/${raw}`);
    // The link is burned by the claim, so the Creator's own view of the wait is
    // the email; the conditional state is what the surface renders before then.
    expect(res.status).toBe(TOKEN_REJECTION_STATUS);
  });

  it('names the campaign and says No action needed, verbatim, in the email', async () => {
    const before = h.sentEmails.messages.length;
    const { raw } = await invited();
    await fillProfile(raw);
    await claim(raw).expect(201);

    const confirmation = h.sentEmails.messages
      .slice(before)
      .find((m) => m.subject.includes('Your Proovd account is set up'));

    expect(confirmation, 'no signup confirmation was sent').toBeTruthy();
    const text = confirmation!.text;

    // §11's six requirements for this state, and §27.1's six questions.
    expect(text).toMatch(/your Proovd account is set up/i); // confirms signup
    expect(text).toContain('Waitlist'); // names the campaign
    expect(text).toMatch(/Founder is still finishing their setup/i); // why waiting
    expect(text).toMatch(/Proovd owns this step/i); // identifies the owner
    expect(text).toMatch(/We will email you as soon as/i); // next update
    expect(text).toContain(NO_ACTION_NEEDED); // the exact words
  });

  it('sends the confirmation exactly once per association (§27.2)', async () => {
    const { raw, associationId } = await invited();
    await fillProfile(raw);
    await claim(raw).expect(201);

    const deliveries = await h.db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.entityId, associationId));
    expect(deliveries).toHaveLength(1);
  });

  it('offers no action in the confirmation at all', async () => {
    const before = h.sentEmails.messages.length;
    const { raw } = await invited();
    await fillProfile(raw);
    await claim(raw).expect(201);

    const confirmation = h.sentEmails.messages
      .slice(before)
      .find((m) => m.subject.includes('Your Proovd account is set up'))!;

    // §27.2 allows at most one primary action, and there is nothing to do — an
    // action leading to a page saying "no action needed" is §1.4 with a link.
    expect(confirmation.html).not.toMatch(/creator-invitation\//);
    expect(confirmation.text).not.toMatch(/creator-invitation\//);
  });
});

/* ══ §33.2.1 carried forward — the token still claims only this one ══════ */

describe('§33.2.1 — the signup route grants nothing wider', () => {
  it('refuses a Founder draft token at every Creator signup route', async () => {
    // Issued directly rather than driven through the Founder invitation flow:
    // what is being tested is the scope predicate inside `verify`, and routing
    // around another suite's setup would make this test fail for its reasons.
    const campaignId = await createCampaign();
    const [draft] = await h.db
      .select({ id: campaignDrafts.id })
      .from(campaignDrafts)
      .where(eq(campaignDrafts.campaignId, campaignId));

    const issued = await h.tokens.issue(
      { scope: 'founder_draft', campaignDraftId: draft!.id },
      { actorId: 'test' },
    );

    for (const path of [
      `/api/affiliate-invitation/${issued.raw}`,
      `/api/affiliate-invitation/${issued.raw}/payout`,
    ]) {
      const res = await request(h.app).get(path);
      expect(res.status, path).toBe(TOKEN_REJECTION_STATUS);
      expect(res.body, path).toEqual(TOKEN_REJECTION_BODY);
    }

    const claimAttempt = await request(h.app)
      .post(`/api/affiliate-invitation/${issued.raw}/claim`)
      .send({ password: 'a-perfectly-good-password', acceptedPolicySlugs: [] });
    expect(claimAttempt.status).toBe(TOKEN_REJECTION_STATUS);

    // And the draft token is untouched — a wrong-scope presentation must not
    // burn a link that is valid somewhere else.
    const [row] = await h.db
      .select()
      .from(secureTokens)
      .where(eq(secureTokens.id, issued.record.id));
    expect(row!.claimedAt).toBeNull();
    expect(row!.revokedAt).toBeNull();
  });

  it('gives a revoked invitation the identical rejection', async () => {
    const { raw, associationId } = await invited();
    await request(h.app)
      .post(`/api/admin/affiliates/${associationId}/revoke`)
      .set('cookie', admin.cookie)
      .send({ reason: 'channel went dormant' })
      .expect(200);

    const res = await request(h.app).get(`/api/affiliate-invitation/${raw}`);
    expect(res.status).toBe(TOKEN_REJECTION_STATUS);
    expect(res.body).toEqual(TOKEN_REJECTION_BODY);
  });

  it('reveals nothing sensitive about the recruitment (§33.2.1)', async () => {
    const { raw } = await invited();
    const res = await request(h.app).get(`/api/affiliate-invitation/${raw}`).expect(200);

    const serialized = JSON.stringify(res.body);
    // The Creator sees their own record, never Proovd's assessment of them.
    expect(serialized).not.toContain(RECRUITMENT.recruitingAdmin);
    expect(serialized).not.toContain(RECRUITMENT.recruitmentSource);
    expect(serialized).not.toContain(RECRUITMENT.campaignFit);
    expect(serialized).not.toMatch(/qualityTier|internalComments|conflictNotes|sanctionsNotes/);
  });
});
