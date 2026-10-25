import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { startHarness, type Harness } from './app-harness.js';
import { createAdmin, seedUser, signInPlain, type AdminSession } from './admin-session.js';
import { seedAdminReauthWindow } from '../settings/service.js';
import { campaigns } from '../db/schema/domain.js';
import { founderProspects, campaignDrafts } from '../db/schema/invitations.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { campaignBuild, campaignFaqs } from '../db/schema/build.js';

let h: Harness;
let admin: AdminSession;
beforeAll(async () => {
  h = await startHarness({ invitationContext: {
    appBaseUrl: 'http://localhost:3000',
    fromAddress: 'hello@mail.proovd.co',
    supportEmail: 'support@proovd.co',
  } }, 'setup-change-requests');
  admin = await createAdmin(h, 'setup-change-operator');
  await seedAdminReauthWindow(h.db, 3600);
}, 180_000);
afterAll(async () => { await h?.stop(); });
beforeEach(() => {
  h.sentEmails.messages.length = 0;
  h.sentEmails.failNext = false;
});

async function seedCampaign() {
  const founder = await seedUser(h, 'founder', 'setup-change-founder');
  const cookie = await signInPlain(h, founder.email);
  const [prospect] = await h.db.insert(founderProspects).values({
    email: founder.email, preferredName: 'Test Founder', productName: 'Request test product',
    claimedUserId: founder.id, claimedAt: new Date(), createdBy: admin.id,
  }).returning();
  const [campaign] = await h.db.insert(campaigns).values({
    status: 'affiliate_response_and_build', type: 'pre_build', typeLockedAt: new Date(),
  }).returning();
  const campaignId = campaign!.id;
  const [draft] = await h.db.insert(campaignDrafts).values({
    campaignId, prospectId: prospect!.id, status: 'claimed', createdBy: admin.id,
    prefillBrandVoice1: 'Warm', prefillBrandVoice2: 'Clear',
  }).returning();
  await h.db.insert(founderClaimProfiles).values({
    campaignId, draftId: draft!.id, prospectId: prospect!.id, email: founder.email,
    claimedUserId: founder.id, claimedAt: new Date(), updatedBy: admin.id,
  });
  await h.db.insert(campaignBuild).values({ campaignId, brandVoice: 'Warm, Clear', updatedBy: admin.id });
  return { campaignId, founder, cookie, draftId: draft!.id };
}

function submit(campaignId: string, body: Record<string, unknown>, cookie = admin.cookie) {
  return request(h.app).post(`/api/admin/campaigns/${campaignId}/setup-change-requests`)
    .set('cookie', cookie).send(body);
}

describe('Campaign Setup field requests and their email', () => {
  it('records the request, sends the exact reason and provides an owned actionable link', async () => {
    const c = await seedCampaign();
    const reason = 'Please choose a more direct voice and describe what it should sound like.';
    const response = await submit(c.campaignId, { fieldKey: 'brandVoice', reason, requestKey: randomUUID() }).expect(201);
    expect(response.body.notification.status).toBe('sent');
    expect(response.body.request.reason).toBe(reason);
    expect(response.body.request.fieldLabel).toBe('Final voice');
    expect(h.sentEmails.messages).toHaveLength(1);
    const email = h.sentEmails.messages[0]!;
    expect(email.to).toBe(c.founder.email);
    expect(email.from).toBe('hello@mail.proovd.co');
    expect(email.replyTo).toBe('support@proovd.co');
    expect(email.text).toContain(reason);
    expect(email.html).toContain(reason);
    expect(email.text).toContain(response.body.request.deepLink);
    expect(response.body.request.deepLink).toContain(`/campaigns/${c.campaignId}/setup/voice`);
    expect(response.body.request.deepLink).toContain(response.body.requestId);
    const notes = await request(h.app).get(`/api/founder/campaigns/${c.campaignId}/setup-change-requests`)
      .set('cookie', c.cookie).expect(200);
    expect(notes.body.requests).toEqual([response.body.request]);
    const [unchanged] = await h.db.select().from(campaigns).where(eq(campaigns.id, c.campaignId));
    expect(unchanged!.status).toBe('affiliate_response_and_build');
    const [build] = await h.db.select().from(campaignBuild).where(eq(campaignBuild.campaignId, c.campaignId));
    expect(build!.brandVoice).toBe('Warm, Clear');
    const audit = await h.pool.query("SELECT action FROM audit_events WHERE target_id=$1", [c.campaignId]);
    expect(audit.rows.some((r: { action: string }) => r.action.includes('setup_change'))).toBe(true);
  });

  it('suppresses sequential and concurrent retries of one request', async () => {
    const c = await seedCampaign();
    const body = { fieldKey: 'brandVoice', reason: 'Use a clearer voice.', requestKey: randomUUID() };
    const attempts = await Promise.all([submit(c.campaignId, body), submit(c.campaignId, body)]);
    expect(attempts.every((r) => r.status === 200 || r.status === 201)).toBe(true);
    expect(new Set(attempts.map((r) => r.body.requestId)).size).toBe(1);
    await submit(c.campaignId, body).expect(200);
    expect(h.sentEmails.messages).toHaveLength(1);
    const stored = await h.pool.query('SELECT id FROM campaign_setup_change_requests WHERE campaign_id=$1', [c.campaignId]);
    expect(stored.rowCount).toBe(1);
  });

  it('keeps a failed delivery honest and retries it without duplicating the request', async () => {
    const c = await seedCampaign();
    const body = { fieldKey: 'brandVoiceContext', reason: 'Explain the voice in one sentence.', requestKey: randomUUID() };
    h.sentEmails.failNext = true;
    const failed = await submit(c.campaignId, body).expect(201);
    expect(failed.body.notification.status).toBe('failed');
    expect(h.sentEmails.messages).toHaveLength(0);
    const retried = await submit(c.campaignId, body).expect(200);
    expect(retried.body.requestId).toBe(failed.body.requestId);
    expect(retried.body.notification.status).toBe('sent');
    await submit(c.campaignId, body).expect(200);
    expect(h.sentEmails.messages).toHaveLength(1);
  });

  it('uses owned FAQ identifiers and refuses another campaign\'s row', async () => {
    const c = await seedCampaign();
    const other = await seedCampaign();
    const [faq] = await h.db.insert(campaignFaqs).values({ campaignId: c.campaignId, question: 'Who is it for?', answer: 'Founders.' }).returning();
    const body = { fieldKey: `faq.${faq!.id}.answer`, reason: 'Be more specific about the audience.', requestKey: randomUUID() };
    const accepted = await submit(c.campaignId, body).expect(201);
    expect(accepted.body.request.deepLink).toContain('/setup/faqs');
    const refused = await submit(other.campaignId, { ...body, requestKey: randomUUID() });
    expect([404, 422]).toContain(refused.status);
    expect(h.sentEmails.messages).toHaveLength(1);
  });

  it('does not expose requests to another Founder or accept Founder-authored Admin decisions', async () => {
    const c = await seedCampaign();
    const other = await seedCampaign();
    const body = { fieldKey: 'brandVoice', reason: 'Make the voice more direct.', requestKey: randomUUID() };
    await submit(c.campaignId, body, c.cookie).expect(403);
    await submit(c.campaignId, body).expect(201);
    await request(h.app).get(`/api/founder/campaigns/${c.campaignId}/setup-change-requests`)
      .set('cookie', other.cookie).expect(404);
    await request(h.app).get(`/api/founder/campaigns/${c.campaignId}/setup-change-requests`).expect(401);
  });

  it('refuses unknown fields, missing reasons, changed retry payloads and locked editing states', async () => {
    const c = await seedCampaign();
    const body = { fieldKey: 'brandVoice', reason: 'Make this clearer.', requestKey: randomUUID() };
    await submit(c.campaignId, { ...body, fieldKey: 'invented-field' }).expect(400);
    await submit(c.campaignId, { ...body, reason: ' ' }).expect(400);
    await submit(c.campaignId, body).expect(201);
    await submit(c.campaignId, { ...body, reason: 'A different decision.' }).expect(409);
    await h.db.update(campaigns).set({ status: 'pending_review' }).where(eq(campaigns.id, c.campaignId));
    await submit(c.campaignId, { ...body, requestKey: randomUUID() }).expect(409);
    expect(h.sentEmails.messages).toHaveLength(1);
  });

  it('sends separate setup field requests for the same campaign', async () => {
    const c = await seedCampaign();
    for (const [fieldKey, reason] of [['brandVoice', 'Use a clearer voice.'], ['brandVoiceContext', 'Describe the voice.']]) {
      await submit(c.campaignId, { fieldKey, reason, requestKey: randomUUID() }).expect(201);
    }
    expect(h.sentEmails.messages).toHaveLength(2);
    expect(h.sentEmails.messages[0]!.text).toContain('Use a clearer voice.');
    expect(h.sentEmails.messages[1]!.text).toContain('Describe the voice.');
  });
});
