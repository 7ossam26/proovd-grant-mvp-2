import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { startHarness, type Harness } from './app-harness.js';
import { createAdmin, type AdminSession } from './admin-session.js';
import { seedAdminReauthWindow } from '../settings/service.js';
import { FOUNDER_EMAIL_DEFINITIONS } from '../notifications/founder-email-editor/definitions.js';
import { saveFounderEmailCopy } from '../notifications/founder-email-editor/store.js';
import { requestFounderEmailCode } from '../vetting/email-code.js';
import { notifyApplicationReviewSubmitted, notifyApplicationReviewOutcome } from '../campaign/application-review-notifications.js';
import type { FounderApplicationEmailKey } from '../notifications/founder-email-editor/application.js';

let h: Harness;
let admin: AdminSession;
const base = '/api/admin/founder-emails';
beforeAll(async () => {
  h = await startHarness({}, 'founder_email_editor');
  admin = await createAdmin(h, 'email-editor-admin');
  await seedAdminReauthWindow(h.db, 3600);
}, 180000);
afterAll(async () => { await h?.stop(); });

async function founder() {
  const response = await request(h.app).post('/api/admin/founders').set('cookie', admin.cookie).send({
    legalName: 'Alex Sample', preferredName: 'Alex', email: `email-editor-${randomUUID()}@example.com`,
    productName: 'Fieldnotes', productUrl: 'https://fieldnotes.example', invitationSource: 'A real recorded call', internalOwner: 'Sam',
  }).expect(201);
  await request(h.app).put(`/api/admin/founders/${response.body.draftId}/invitation`).set('cookie', admin.cookie).send({
    whatWeUnderstood: 'A digital research workspace.', whyInvited: 'We discussed Fieldnotes on our call.', senderName: 'Sam', senderEmail: 'sam@example.com', expectedSetupTime: '25 minutes',
  }).expect(200);
  return response.body as { draftId: string; campaignId: string };
}

describe('persisted Founder email editor', () => {
  it('persists global copy, audits its author/version, and uses it for real invitation preview and sending', async () => {
    const copy = { ...FOUNDER_EMAIL_DEFINITIONS.founder_invitation.defaultCopy, subject: 'From our call: {{productName}}', actionLabel: 'Open your prepared invitation' };
    const before = h.sentEmails.messages.length;
    await request(h.app).put(`${base}/founder_invitation`).set('cookie', admin.cookie).send({ copy, version: 0, changeNote: 'Keep our warm post-call voice.' }).expect(200);
    expect(h.sentEmails.messages).toHaveLength(before);
    const catalog = await request(h.app).get(base).set('cookie', admin.cookie).expect(200);
    const saved = catalog.body.templates.find((item: { key: string }) => item.key === 'founder_invitation');
    expect(saved.version).toBe(1);
    expect(saved.copy).toEqual(copy);
    expect(saved.current.subject).toBe('From our call: Fieldnotes');
    expect(saved.previous.subject).toContain('first campaign is set up');
    const record = await founder();
    const preview = await request(h.app).get(`/api/admin/founders/${record.draftId}/preview`).set('cookie', admin.cookie).expect(200);
    expect(JSON.stringify(preview.body)).toContain('From our call: Fieldnotes');
    await request(h.app).post(`/api/admin/founders/${record.draftId}/send`).set('cookie', admin.cookie).send({}).expect(201);
    const delivered = h.sentEmails.messages.at(-1)!;
    expect(delivered.subject).toBe('From our call: Fieldnotes');
    expect(delivered.text).toContain('Open your prepared invitation');
    expect(delivered.text).toContain('nothing is charged');
    expect(delivered.text).not.toContain('preview.invalid');
    const audit = await h.pool.query("SELECT actor, prior_value, new_value FROM audit_events WHERE action = 'founder_email_template.updated' AND target_id = 'founder_invitation'");
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].actor).toBe(`user:${admin.id}`);
    expect(audit.rows[0].prior_value.version).toBe(0);
    expect(audit.rows[0].new_value.version).toBe(1);
  });

  it('does not overwrite a newer version when two Admin saves race', async () => {
    const copy = FOUNDER_EMAIL_DEFINITIONS.founder_invitation.defaultCopy;
    const responses = await Promise.all([
      request(h.app).put(`${base}/founder_invitation`).set('cookie', admin.cookie).send({ copy: { ...copy, intro: 'First update.' }, version: 1 }),
      request(h.app).put(`${base}/founder_invitation`).set('cookie', admin.cookie).send({ copy: { ...copy, intro: 'Second update.' }, version: 1 }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const stored = await h.pool.query("SELECT version, copy FROM founder_email_templates WHERE key = 'founder_invitation'");
    expect(stored.rows[0].version).toBe(2);
    expect(['First update.', 'Second update.']).toContain(stored.rows[0].copy.intro);
  });

  it('rolls the copy back if its audit cannot be recorded', async () => {
    const key = 'founder_application_review_received';
    await expect(saveFounderEmailCopy(h.db, async () => { throw new Error('audit unavailable'); }, {
      key, copy: FOUNDER_EMAIL_DEFINITIONS[key].defaultCopy, version: 0, changeNote: 'Test rollback.', actorId: admin.id,
    })).rejects.toThrow('audit unavailable');
    const result = await h.pool.query('SELECT key FROM founder_email_templates WHERE key = $1', [key]);
    expect(result.rows).toEqual([]);
  });

  it('uses the saved verification instructions with the actual code and actual validity', async () => {
    const copy = { ...FOUNDER_EMAIL_DEFINITIONS.founder_email_code.defaultCopy, subject: 'Your Fieldnotes verification code', instruction: 'Enter this code to continue. It works for {{expiryMinutes}} minutes.' };
    await request(h.app).put(`${base}/founder_email_code`).set('cookie', admin.cookie).send({ copy, version: 0 }).expect(200);
    const record = await founder();
    const result = await requestFounderEmailCode({ db: h.db, tokens: h.tokens, notifier: h.notifier, fromAddress: 'hello@example.com', supportEmail: 'support@proovd.co' }, record);
    expect(result.ok).toBe(true);
    const message = h.sentEmails.messages.at(-1)!;
    expect(message.subject).toBe('Your Fieldnotes verification code');
    expect(message.text).toContain('It works for 15 minutes.');
    expect(message.text).toMatch(/\b\d{3} \d{3}\b/);
    expect(message.text).toContain("Didn't ask for a code?");
  });

  it('uses saved copy for every application outcome without changing decision facts or its next-step URL', async () => {
    const record = await founder();
    const cases: Array<[FounderApplicationEmailKey, string]> = [
      ['founder_application_review_received', 'submitted'],
      ['founder_application_information_needed', 'needs_information'],
      ['founder_application_changes_requested', 'changes_requested'],
      ['founder_application_approved', 'approved'],
      ['founder_application_rejected', 'rejected'],
    ];
    for (const [key, outcome] of cases) {
      const copy = { ...FOUNDER_EMAIL_DEFINITIONS[key].defaultCopy, subject: `Updated {{productName}}: ${outcome}`, body: 'A short human follow-up.', actionLabel: 'Review the next step' };
      await request(h.app).put(`${base}/${key}`).set('cookie', admin.cookie).send({ copy, version: 0 }).expect(200);
      const input = { campaignId: record.campaignId, review: { id: randomUUID(), round: 1, outcome, customerExplanation: 'The exact recorded explanation.', changeRequests: [{ fieldKey: 'problem', fieldLabel: 'Problem', reason: 'The exact recorded correction.' }] } };
      const deps = { db: h.db, notifier: h.notifier, context: { appBaseUrl: 'http://localhost:3000', fromAddress: 'hello@example.com', supportEmail: 'support@proovd.co' } };
      if (outcome === 'submitted') await notifyApplicationReviewSubmitted(deps, input);
      else await notifyApplicationReviewOutcome(deps, input);
      const message = h.sentEmails.messages.at(-1)!;
      expect(message.subject).toBe(`Updated Fieldnotes: ${outcome}`);
      expect(message.text).toContain('A short human follow-up.');
      expect(message.text).toContain('REVIEW THE NEXT STEP');
      expect(message.text).toContain(input.review.id);
      expect(message.text).toContain(`http://localhost:3000/campaigns/${record.campaignId}/setup/`);
      if (outcome === 'changes_requested') expect(message.text).toContain('The exact recorded correction.');
      if (outcome === 'needs_information' || outcome === 'rejected') expect(message.text).toContain('The exact recorded explanation.');
    }
  });
});
