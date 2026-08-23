import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { founderClaimProfiles } from '../db/schema/vetting.js';
import { seedAdminReauthWindow } from '../settings/service.js';
import { startHarness, type Harness } from './app-harness.js';
import { createAdmin, seedUser, type AdminSession } from './admin-session.js';

let h: Harness;
let admin: AdminSession;

beforeAll(async () => {
  h = await startHarness({}, 'founder-hard-delete');
  admin = await createAdmin(h, 'founder-hard-delete-admin');
  await seedAdminReauthWindow(h.db, 3600);
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

describe('permanent Founder deletion', () => {
  it('requires exact confirmation and atomically removes the complete Founder graph', async () => {
    const email = `delete-${randomUUID()}@example.com`;
    const created = await request(h.app)
      .post('/api/admin/founders')
      .set('cookie', admin.cookie)
      .send({
        legalName: 'Disposable Founder',
        preferredName: 'Disposable',
        email,
        productName: 'Delete Me',
        invitationSource: 'local acceptance test',
        internalOwner: 'Test Admin',
      })
      .expect(201);

    const { prospectId, campaignId, draftId } = created.body as {
      prospectId: string;
      campaignId: string;
      draftId: string;
    };
    const founderAccount = await seedUser(h, 'founder', `hard-delete-${randomUUID()}`);
    await h.db.insert(founderClaimProfiles).values({
      draftId,
      prospectId,
      campaignId,
      legalName: 'Disposable Founder',
      preferredName: 'Disposable',
      email,
      claimedUserId: founderAccount.id,
      claimedAt: new Date(),
      updatedBy: `user:${founderAccount.id}`,
    });
    await h.pool.query(
      'UPDATE founder_prospects SET claimed_user_id = $1, claimed_at = now() WHERE id = $2',
      [founderAccount.id, prospectId],
    );

    await request(h.app)
      .post(`/api/admin/founders/${prospectId}/deletion-request`)
      .set('cookie', admin.cookie)
      .send({
        detail: 'Please delete this disposable acceptance-test Founder.',
        receivedVia: 'automated acceptance test',
        requestedAt: new Date().toISOString(),
      })
      .expect(200);

    await request(h.app)
      .delete(`/api/admin/founders/${prospectId}`)
      .set('cookie', admin.cookie)
      .send({ confirmationEmail: 'wrong@example.com', reason: 'Acceptance test cleanup.' })
      .expect(400);
    await request(h.app)
      .get(`/api/admin/founders/${prospectId}`)
      .set('cookie', admin.cookie)
      .expect(200);

    const deleted = await request(h.app)
      .delete(`/api/admin/founders/${prospectId}`)
      .set('cookie', admin.cookie)
      .send({ confirmationEmail: email, reason: 'test' })
      .expect(200);
    expect(deleted.body).toMatchObject({
      deleted: true,
      email,
      campaignCount: 1,
      deletedAccount: true,
    });
    expect(deleted.body.deletedRows).toBeGreaterThan(5);

    await request(h.app)
      .get(`/api/admin/founders/${prospectId}`)
      .set('cookie', admin.cookie)
      .expect(404);

    const counts = await h.pool.query<{
      founders: number;
      drafts: number;
      campaigns: number;
      requests: number;
      users: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM founder_prospects WHERE id = $1) AS founders,
         (SELECT count(*)::int FROM campaign_drafts WHERE id = $2) AS drafts,
         (SELECT count(*)::int FROM campaigns WHERE id = $3) AS campaigns,
         (SELECT count(*)::int FROM founder_deletion_requests WHERE prospect_id = $1) AS requests,
         (SELECT count(*)::int FROM "user" WHERE id = $4) AS users`,
      [prospectId, draftId, campaignId, founderAccount.id],
    );
    expect(counts.rows[0]).toEqual({ founders: 0, drafts: 0, campaigns: 0, requests: 0, users: 0 });
  }, 60_000);
});
