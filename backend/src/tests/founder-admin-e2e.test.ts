import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { campaigns } from '../db/schema/domain.js';
import { founderProspects } from '../db/schema/invitations.js';
import { campaignAssets } from '../db/schema/workspace.js';
import { seedAdminReauthWindow } from '../settings/service.js';
import { createMemoryStorage } from '../storage/object-storage.js';
import { startHarness, type Harness } from './app-harness.js';
import { cookiesOf, createAdmin, type AdminSession } from './admin-session.js';

let h: Harness;
let admin: AdminSession;
const storage = createMemoryStorage('founder-admin-assets');

beforeAll(async () => {
  h = await startHarness({ objectStorage: storage }, 'founder-admin-e2e');
  admin = await createAdmin(h, 'founder-admin-e2e');
  await seedAdminReauthWindow(h.db, 3600);
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

const invitationBody = (requestKey: string, email: string) => ({
  requestKey,
  legalName: 'Rowan Vale',
  email,
  businessName: 'Waitlist',
  location: 'WA',
  invitationSource: 'introduced by a mutual contact',
  internalOwner: 'Ada Admin',
  whatWeUnderstood: 'A scheduling tool that fills cancelled clinic appointments.',
  whyInvited: 'Two clinics renewed without being asked.',
  expectedSetupTime: 'About two hours.',
  campaignType: 'pre_build',
});

async function createInviteAndClaim() {
  const requestKey = randomUUID();
  const email = `founder-e2e-${randomUUID()}@example.com`;
  const body = invitationBody(requestKey, email);
  const before = h.sentEmails.messages.length;

  const created = await request(h.app)
    .post('/api/admin/founders/create-and-invite')
    .set('cookie', admin.cookie)
    .send(body)
    .expect(201);

  expect(h.sentEmails.messages).toHaveLength(before + 1);

  // A browser retry resumes the same act and cannot create or email twice.
  const retried = await request(h.app)
    .post('/api/admin/founders/create-and-invite')
    .set('cookie', admin.cookie)
    .send(body)
    .expect(200);
  expect(retried.body).toMatchObject({
    prospectId: created.body.prospectId,
    campaignId: created.body.campaignId,
    draftId: created.body.draftId,
    alreadySent: true,
  });
  expect(h.sentEmails.messages).toHaveLength(before + 1);

  const raw = /http:\/\/localhost:3000\/draft\/([A-Za-z0-9_-]+)/.exec(
    h.sentEmails.messages[before]!.text,
  )![1]!;
  await request(h.app).get(`/api/draft/${raw}`).expect(200);
  await request(h.app)
    .patch(`/api/draft/${raw}/vetting`)
    .send({
      selectedType: 'pre_build',
      problem: 'Clinics lose revenue when appointments are cancelled.',
      solution: 'The product fills those slots from a patient waitlist.',
      competition: 'Receptionists and general-purpose booking tools.',
    })
    .expect(200);

  const submitted = await request(h.app)
    .post(`/api/draft/${raw}/vetting/submit`)
    .send({})
    .expect(201);
  const founderCookie = cookiesOf(submitted);
  expect(founderCookie).not.toBe('');
  expect(submitted.body).toMatchObject({
    campaignId: created.body.campaignId,
    signedIn: true,
  });

  const [campaign] = await h.db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, created.body.campaignId));
  expect(campaign).toMatchObject({
    status: 'account_claimed',
    workflowStageReached: 'onboarding',
    applicationReviewRequired: true,
  });

  return {
    email,
    raw,
    prospectId: created.body.prospectId as string,
    campaignId: created.body.campaignId as string,
    founderCookie,
  };
}

describe('Admin invitation to authenticated Founder and back to Admin', () => {
  it('enforces and completes the mandatory blocking Application Review', async () => {
    const founder = await createInviteAndClaim();

    const underageYear = new Date().getUTCFullYear() - 17;
    await request(h.app)
      .patch(`/api/founder/campaigns/${founder.campaignId}/details`)
      .set('cookie', founder.founderCookie)
      .send({ dateOfBirth: `${underageYear}-01-01` })
      .expect(400);

    await request(h.app)
      .patch(`/api/founder/campaigns/${founder.campaignId}/details`)
      .set('cookie', founder.founderCookie)
      .send({ dateOfBirth: '1990-01-31' })
      .expect(200);

    const waiting = await request(h.app)
      .post(`/api/founder/campaigns/${founder.campaignId}/application-review/submit`)
      .set('cookie', founder.founderCookie)
      .send({})
      .expect(200);
    expect(waiting.body.applicationReview).toMatchObject({
      required: true,
      mayContinue: false,
      review: { round: 1, outcome: 'waiting' },
    });

    await request(h.app)
      .post(`/api/admin/campaigns/${founder.campaignId}/application-review/decide`)
      .set('cookie', admin.cookie)
      .send({
        outcome: 'approved',
        internalReason: 'The application contains enough information to continue.',
        customerExplanation: 'Your application is approved.',
      })
      .expect(200);

    const approved = await request(h.app)
      .get(`/api/founder/campaigns/${founder.campaignId}/application-review`)
      .set('cookie', founder.founderCookie)
      .expect(200);
    expect(approved.body.applicationReview).toMatchObject({
      required: true,
      mayContinue: true,
      review: { round: 1, outcome: 'approved' },
    });

    await request(h.app)
      .post('/api/founder/settings/initial-password')
      .set('cookie', founder.founderCookie)
      .send({ campaignId: founder.campaignId, password: 'StrongFounderPassword1!' })
      .expect(200);

    const discounted = await request(h.app)
      .patch(`/api/founder/campaigns/${founder.campaignId}/workspace`)
      .set('cookie', founder.founderCookie)
      .send({
        storyText: 'We built this after watching independent teams lose hours to the same problem.',
        storyApproved: true,
      })
      .expect(200);
    expect(discounted.body.workspace).toMatchObject({
      story: { approved: true },
      fee: { completedItems: 1, discountCents: '200', subtotalCents: '3300' },
    });

    const scheduledAt = '2030-03-12T15:30:00.000Z';
    const booked = await request(h.app)
      .post(`/api/founder/campaigns/${founder.campaignId}/interview`)
      .set('cookie', founder.founderCookie)
      .send({
        meetingProvider: 'google_meet',
        scheduledAt,
        timezone: 'Africa/Cairo',
      })
      .expect(200);
    expect(booked.body.workspace).toMatchObject({
      interview: {
        booking: {
          status: 'selected',
          scheduledAt,
          timezone: 'Africa/Cairo',
          provider: 'google_meet',
        },
      },
      fee: { completedItems: 2, discountCents: '400', subtotalCents: '3100' },
    });

    const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const storageKey = `campaigns/${founder.campaignId}/logo.png`;
    storage.put(storageKey, 'image/png', image);
    const [logo] = await h.db
      .insert(campaignAssets)
      .values({
        campaignId: founder.campaignId,
        purpose: 'logo',
        storageKey,
        storageBucket: storage.bucket,
        originalFilename: 'founder-logo.png',
        contentType: 'image/png',
        byteSize: BigInt(image.byteLength),
        state: 'stored',
        verifiedAt: new Date(),
        createdBy: 'founder-e2e',
      })
      .returning();

    const workspace = await request(h.app)
      .get(`/api/admin/founders/${founder.prospectId}`)
      .set('cookie', admin.cookie)
      .expect(200);
    expect(workspace.body.header).toMatchObject({
      prospectId: founder.prospectId,
      email: founder.email,
      lifecycle: 'Account claimed',
    });

    await request(h.app)
      .post(`/api/admin/founders/${founder.prospectId}/notes`)
      .set('cookie', admin.cookie)
      .send({ body: 'Founder completed the invite journey.' })
      .expect(201);
    await request(h.app)
      .post(`/api/admin/founders/${founder.prospectId}/warnings`)
      .set('cookie', admin.cookie)
      .send({ reason: 'Test warning for the connected Admin action.' })
      .expect(201);

    const panel = await request(h.app)
      .get(`/api/admin/founder-panel/${founder.prospectId}`)
      .set('cookie', admin.cookie)
      .expect(200);
    expect(panel.body.workflow.stageReached).toBe('fee');
    expect(panel.body.notes).toHaveLength(1);
    expect(panel.body.warnings).toHaveLength(1);
    expect(panel.body.applicationReview).toMatchObject({ outcome: 'approved' });
    expect(panel.body.account).toEqual({
      dateOfBirth: '1990-01-31',
      ageCheck: '18 or older',
    });
    expect(panel.body.optionalItems).toHaveLength(5);
    expect(panel.body.optionalItems).toContainEqual(
      expect.objectContaining({
        key: 'story',
        complete: true,
        savingCents: '200',
        content: 'We built this after watching independent teams lose hours to the same problem.',
      }),
    );
    expect(panel.body.optionalItems).toContainEqual(
      expect.objectContaining({
        key: 'interview',
        complete: true,
        savingCents: '200',
        content: scheduledAt,
        interview: expect.objectContaining({ scheduledAt, timezone: 'Africa/Cairo' }),
      }),
    );
    expect(panel.body.optionalItems).toContainEqual(
      expect.objectContaining({
        key: 'branding',
        assets: [
          expect.objectContaining({
            id: logo!.id,
            filename: 'founder-logo.png',
            contentType: 'image/png',
          }),
        ],
      }),
    );
    expect(panel.body.listingFee).toMatchObject({
      status: 'Calculated',
      baseCents: '3500',
      savedCents: '400',
      subtotalCents: '3100',
    });
    expect(panel.body.listingFee.lines).toHaveLength(5);

    const downloaded = await request(h.app)
      .get(`/api/admin/founder-panel/${founder.prospectId}/assets/${logo!.id}/download`)
      .set('cookie', admin.cookie)
      .expect(200)
      .expect('content-type', 'image/png');
    expect(downloaded.headers['content-disposition']).toContain('founder-logo.png');
    expect(Buffer.from(downloaded.body)).toEqual(image);

    const resetsBefore = h.resetLinks.length;
    await request(h.app)
      .post(`/api/admin/founders/${founder.prospectId}/password-recovery`)
      .set('cookie', admin.cookie)
      .send({})
      .expect(200);
    expect(h.resetLinks).toHaveLength(resetsBefore + 1);
    expect(h.resetLinks.at(-1)?.email).toBe(founder.email);

    const revoked = await request(h.app)
      .post(`/api/admin/founders/${founder.prospectId}/sessions/revoke`)
      .set('cookie', admin.cookie)
      .send({ reason: 'Production E2E verification.' })
      .expect(200);
    expect(revoked.body.revoked).toBeGreaterThanOrEqual(1);
    await request(h.app).get('/api/founder/campaigns').set('cookie', founder.founderCookie).expect(401);
  });

  it('refuses an Admin attempt to disable Application Review', async () => {
    const founder = await createInviteAndClaim();

    const refusal = await request(h.app)
      .put(`/api/admin/campaigns/${founder.campaignId}/application-review-requirement`)
      .set('cookie', admin.cookie)
      .send({ required: false, internalReason: 'Attempt to skip the mandatory review.' })
      .expect(422);
    expect(refusal.body).toMatchObject({
      error: 'review_required',
      whatHappened: 'Application Review is required for every campaign and cannot be skipped.',
    });

    const [campaign] = await h.db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, founder.campaignId));
    expect(campaign?.applicationReviewRequired).toBe(true);

    const [prospect] = await h.db
      .select()
      .from(founderProspects)
      .where(eq(founderProspects.id, founder.prospectId));
    expect(prospect?.claimedUserId).not.toBeNull();
  });
});
