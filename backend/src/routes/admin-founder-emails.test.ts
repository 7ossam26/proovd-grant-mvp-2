import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Auth } from '../auth/auth.js';
import type { Database } from '../db/client.js';
import { createFounderEmailsRouter } from './admin-founder-emails.js';
import { FOUNDER_EMAIL_DEFINITIONS } from '../notifications/founder-email-editor/definitions.js';
import { FounderEmailVersionConflict, saveFounderEmailCopy } from '../notifications/founder-email-editor/store.js';
import { listFounderEmailTemplates, readFounderEmailTemplate, renderFounderEmailVersions } from '../notifications/founder-email-editor/service.js';

vi.mock('../settings/service.js', () => ({ readAdminReauthWindowSeconds: vi.fn(async () => 86400) }));
vi.mock('../notifications/founder-email-editor/service.js', () => ({
  listFounderEmailTemplates: vi.fn(async () => []),
  readFounderEmailTemplate: vi.fn(async () => ({ key: 'founder_invitation', version: 1 })),
  renderFounderEmailVersions: vi.fn(async () => ({ current: { subject: 'Preview', html: '<p>Preview</p>', text: 'Preview' }, previous: { subject: 'Before', html: '<p>Before</p>', text: 'Before' } })),
}));
vi.mock('../notifications/founder-email-editor/store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../notifications/founder-email-editor/store.js')>();
  return { ...actual, saveFounderEmailCopy: vi.fn(async () => ({})) };
});

/** The real role/freshness middleware runs; only its session provider is isolated. */
const auth = { api: { getSession: async ({ headers }: { headers: Headers }) => {
  const role = headers.get('x-test-role');
  if (!role) return null;
  const now = Date.now();
  return { user: { id: 'test-admin', email: 'admin@example.com', name: 'Admin', role }, session: { id: 'session', createdAt: new Date(now - (headers.has('x-test-stale') ? 172800000 : 0)), expiresAt: new Date(now + 86400000) } };
} } } as unknown as Auth;
const db = {} as Database;
const audit = vi.fn(async () => undefined);
const app = express();
app.use(createFounderEmailsRouter({ db, auth, audit }));
const base = '/api/admin/founder-emails';
const copy = FOUNDER_EMAIL_DEFINITIONS.founder_invitation.defaultCopy;

describe('Founder email editor routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses anonymous and other-role reads, previews, and saves on the server', async () => {
    for (const role of [null, 'founder', 'affiliate']) {
      const expected = role ? 403 : 401;
      for (const [method, path] of [['get', base], ['post', `${base}/founder_invitation/preview`], ['put', `${base}/founder_invitation`]] as const) {
        const req = request(app)[method](path);
        if (role) req.set('x-test-role', role);
        await req.send({ copy, version: 0 }).expect(expected);
      }
    }
    expect(listFounderEmailTemplates).not.toHaveBeenCalled();
    expect(saveFounderEmailCopy).not.toHaveBeenCalled();
  });

  it('allows an Admin sample preview with no database mutation', async () => {
    const response = await request(app).post(`${base}/founder_invitation/preview`).set('x-test-role', 'admin').send({ copy }).expect(200);
    expect(response.body.current.subject).toBe('Preview');
    expect(renderFounderEmailVersions).toHaveBeenCalledWith('founder_invitation', copy, undefined);
    expect(saveFounderEmailCopy).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it('requires a fresh Admin session to change global copy while preserving read/preview access', async () => {
    await request(app).get(base).set('x-test-role', 'admin').set('x-test-stale', '1').expect(200);
    await request(app).put(`${base}/founder_invitation`).set('x-test-role', 'admin').set('x-test-stale', '1').send({ copy, version: 0 }).expect(403);
    expect(saveFounderEmailCopy).not.toHaveBeenCalled();
    await request(app).put(`${base}/founder_invitation`).set('x-test-role', 'admin').send({ copy, version: 0, changeNote: 'Kept the post-call context.' }).expect(200);
    expect(saveFounderEmailCopy).toHaveBeenCalledWith(db, audit, { key: 'founder_invitation', copy, version: 0, changeNote: 'Kept the post-call context.', actorId: 'test-admin' });
    expect(readFounderEmailTemplate).toHaveBeenCalledWith(db, 'founder_invitation', undefined);
  });

  it('reports stale copy and invalid edits without saving them', async () => {
    const invalid = await request(app).put(`${base}/founder_invitation`).set('x-test-role', 'admin').send({ copy: { ...copy, subject: 'Injected\nBcc:someone@example.com' }, version: 0 }).expect(400);
    expect(invalid.body.fields.subject).toBeTruthy();
    expect(saveFounderEmailCopy).not.toHaveBeenCalled();
    vi.mocked(saveFounderEmailCopy).mockRejectedValueOnce(new FounderEmailVersionConflict());
    const stale = await request(app).put(`${base}/founder_invitation`).set('x-test-role', 'admin').send({ copy, version: 0 }).expect(409);
    expect(stale.body.error).toBe('email_copy_conflict');
  });

  it('refuses unsupported template keys and invalid versions', async () => {
    await request(app).post(`${base}/founder_listing_fee_receipt/preview`).set('x-test-role', 'admin').send({ copy }).expect(404);
    await request(app).put(`${base}/founder_invitation`).set('x-test-role', 'admin').send({ copy, version: -1 }).expect(400);
    expect(saveFounderEmailCopy).not.toHaveBeenCalled();
  });
});
