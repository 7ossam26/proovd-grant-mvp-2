/**
 * Phase 06b acceptance suite — §33.1.1, §33.1.2, §33.1.3.
 *
 * §33's own framing: these are requirements, not examples.
 *
 *   33.1.1  Personalized draft opens without account and grants no other access.
 *   33.1.2  Token alteration, cross-Founder access, replay, expiration, revoke,
 *           resend, and simultaneous claim fail safely.
 *   33.1.3  30-day deletion/anonymization runs from most recent send.
 *
 * Phase 04 proved the token *mechanism* against probe routes. This file proves
 * the same guarantees on the real product surface — the route a Founder
 * actually clicks, carrying content a real person actually wrote — plus §7's
 * preview gate, §27.2's duplicate rule, and §25.6's audit requirements.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { and, eq, desc, sql } from 'drizzle-orm';

import { startHarness, type Harness } from './app-harness.js';
import { createAdmin, type AdminSession } from './admin-session.js';
import { seedAdminReauthWindow } from '../settings/service.js';
import { auditEvents, notificationDeliveries } from '../db/schema/integrity.js';
import { secureTokens } from '../db/schema/tokens.js';
import {
  campaignDrafts,
  campaignInvitationSends,
  founderProspects,
} from '../db/schema/invitations.js';
import { campaigns, campaignStatusHistory } from '../db/schema/domain.js';
import { user as userTable, session as sessionTable } from '../db/schema/auth.js';
import { TOKEN_REJECTION_STATUS, TOKEN_REJECTION_BODY } from '../auth/token-rejection.js';
import {
  sweepUnclaimedDrafts,
  findDueDrafts,
  UNCLAIMED_DRAFT_RETENTION_DAYS,
} from '../invitations/retention.js';
import {
  NO_GUARANTEE_TEXT,
  PROCESS_SUMMARY,
  renderFounderInvitation,
} from '../notifications/templates/founder-invitation.js';
import { BACKEND_NOTIFICATION_EVENTS } from '../notifications/events.js';
import { NOTIFICATION_EVENTS } from '@proovd/shared';

let h: Harness;
let admin: AdminSession;

beforeAll(async () => {
  h = await startHarness({}, 'invitation');
  admin = await createAdmin(h, 'invitation-admin');
  // §7's send/resend/revoke controls sit behind the freshness gate, which fails
  // closed while §6's reauthentication window is unset.
  await seedAdminReauthWindow(h.db, 3600);
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

/* ── helpers ──────────────────────────────────────────────────────────────── */

const COMPLETE_COMPOSE = {
  whatWeUnderstood:
    'A scheduling tool for independent physiotherapists that fills cancelled slots from a waitlist.',
  whyInvited:
    'You have been running it for two clinics for eight months and both renewed without being asked.',
  senderName: 'Ada Admin',
  senderEmail: 'ada@proovd.co',
  expectedSetupTime: 'About two hours of your time, spread over a week or two.',
};

interface Created {
  draftId: string;
  campaignId: string;
  prospectId: string;
  email: string;
}

async function createProspect(label = 'founder'): Promise<Created> {
  const email = `${label}-${randomUUID()}@example.com`;
  const res = await request(h.app)
    .post('/api/admin/founders')
    .set('cookie', admin.cookie)
    .send({
      legalName: 'Rowan Vale',
      preferredName: 'Rowan',
      email,
      productName: 'Waitlist',
      productUrl: 'https://waitlist.example',
      invitationSource: 'introduced by a mutual contact',
      internalOwner: 'Ada Admin',
    })
    .expect(201);
  return { ...res.body, email };
}

async function compose(draftId: string, overrides: Record<string, string | null> = {}) {
  return request(h.app)
    .put(`/api/admin/founders/${draftId}/invitation`)
    .set('cookie', admin.cookie)
    .send({ ...COMPLETE_COMPOSE, ...overrides })
    .expect(200);
}

/** Sends, and returns the raw link the Founder received. */
async function sendAndCaptureLink(draftId: string): Promise<string> {
  const before = h.sentEmails.messages.length;
  await request(h.app)
    .post(`/api/admin/founders/${draftId}/send`)
    .set('cookie', admin.cookie)
    .send({})
    .expect(201);

  const message = h.sentEmails.messages[before];
  expect(message).toBeTruthy();
  const match = /http:\/\/localhost:3000\/draft\/([A-Za-z0-9_-]+)/.exec(message!.text);
  expect(match, 'the email carried no draft link').toBeTruthy();
  return match![1]!;
}

/** A ready-to-send draft, sent, with its link. */
async function invitedFounder(label = 'founder'): Promise<Created & { raw: string }> {
  const created = await createProspect(label);
  await compose(created.draftId);
  const raw = await sendAndCaptureLink(created.draftId);
  return { ...created, raw };
}

interface Rejection {
  status: number;
  body: unknown;
  contentLength: string | undefined;
}

async function rejectionOf(url: string): Promise<Rejection> {
  const res = await request(h.app).get(url);
  return { status: res.status, body: res.body, contentLength: res.headers['content-length'] };
}

/* ── The register agrees with what the backend sends ──────────────────────── */

describe('the backend event keys exist in the shared §27 register', () => {
  it('names only keys the register defines', () => {
    for (const key of BACKEND_NOTIFICATION_EVENTS) {
      expect(Object.keys(NOTIFICATION_EVENTS)).toContain(key);
    }
  });

  it('sends the invitation under the §27.3 key for a personalized invitation', () => {
    expect(NOTIFICATION_EVENTS.founder_invitation).toMatchObject({
      audience: 'founder',
      specRef: '§27.3',
    });
  });
});

/* ── §7: creating the prospect and the campaign container ─────────────────── */

describe('§7 Admin creates a Founder prospect and the initial campaign container', () => {
  it('lands the campaign in invited_draft with a creation row in the history', async () => {
    const created = await createProspect();

    const [campaign] = await h.db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, created.campaignId));
    expect(campaign!.status).toBe('invited_draft');
    // §33.1.7 locks the type at vetting. Guessing it from a discovery call
    // would be an invented commitment (§1 rule 6).
    expect(campaign!.type).toBeNull();

    const history = await h.db
      .select()
      .from(campaignStatusHistory)
      .where(eq(campaignStatusHistory.campaignId, created.campaignId));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ fromStatus: null, toStatus: 'invited_draft' });
  });

  it('records the creation with actor, reason, and the new value (§25.6)', async () => {
    const created = await createProspect();
    const [event] = await h.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.targetType, 'campaign_draft'),
          eq(auditEvents.targetId, created.draftId),
        ),
      );

    expect(event).toMatchObject({
      actor: `user:${admin.id}`,
      action: 'invitation.prospect_created',
    });
    expect(event!.internalReason).toContain('introduced by a mutual contact');
  });

  it('refuses a prospect with no name or no email', async () => {
    for (const missing of ['legalName', 'email']) {
      const body: Record<string, string> = {
        legalName: 'Rowan Vale',
        email: 'rowan@example.com',
      };
      delete body[missing];
      await request(h.app)
        .post('/api/admin/founders')
        .set('cookie', admin.cookie)
        .send(body)
        .expect(400);
    }
  });

  /**
   * §7 describes two acts: writing somebody down after off-platform discovery,
   * and creating the invitation. The rest of §7's list belongs to the second,
   * so a prospect may exist without it — and Send is where that costs
   * something, which the invitation suite below proves.
   */
  it('accepts a prospect with only a name and an email (§7)', async () => {
    const email = `sparse-${randomUUID()}@example.com`;
    const res = await request(h.app)
      .post('/api/admin/founders')
      .set('cookie', admin.cookie)
      .send({ legalName: 'Rowan Vale', email })
      .expect(201);

    const [row] = await h.db
      .select()
      .from(founderProspects)
      .where(eq(founderProspects.email, email));

    expect(row!.productName).toBeNull();
    expect(row!.invitationSource).toBeNull();
    expect(row!.internalOwner).toBeNull();
    // The audit row still says something true rather than "undefined".
    const [event] = await h.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'invitation.prospect_created'))
      .orderBy(desc(auditEvents.occurredAt))
      .limit(1);
    expect(event!.internalReason).toContain('not yet recorded');
  });

  it('records the last-contact date, and offers nowhere to schedule a follow-up (§30)', async () => {
    const email = `contacted-${randomUUID()}@example.com`;
    await request(h.app)
      .post('/api/admin/founders')
      .set('cookie', admin.cookie)
      .send({ legalName: 'Rowan Vale', email, lastContactAt: '2026-07-02' })
      .expect(201);

    const [row] = await h.db
      .select()
      .from(founderProspects)
      .where(eq(founderProspects.email, email));
    expect(row!.lastContactAt?.toISOString().slice(0, 10)).toBe('2026-07-02');

    // §30 forbids automated engagement sequences. The strongest form of that
    // promise is having nowhere to record a cadence: the column records a
    // conversation that happened and there is no companion that plans one.
    const columns = await h.db.execute<{ column_name: string }>(
      sql`select column_name from information_schema.columns where table_name = 'founder_prospects'`,
    );
    const names = columns.rows.map((r) => r.column_name);
    for (const forbidden of [
      'next_contact_at',
      'follow_up_at',
      'contact_cadence',
      'recurrence',
      'reminder_at',
    ]) {
      expect(names).not.toContain(forbidden);
    }
  });

  /**
   * §9: Problem and Solution are "human-prefilled by Proovd from discovery",
   * and the intake form is the discovery record. What matters is that they go
   * through `prefillVetting` with its provenance intact rather than being
   * written as if the Founder had answered.
   */
  it('writes Problem and Solution as a §9 prefill, attributed to Proovd', async () => {
    const email = `prefilled-${randomUUID()}@example.com`;
    const created = await request(h.app)
      .post('/api/admin/founders')
      .set('cookie', admin.cookie)
      .send({
        legalName: 'Rowan Vale',
        email,
        productName: 'Waitlist',
        problem: 'Clinics lose late-cancelled slots and the time just goes empty.',
        solution: 'A freed slot texts the waitlist in order; first to answer takes it.',
      })
      .expect(201);

    const detail = await request(h.app)
      .get(`/api/admin/founders/${created.body.draftId}`)
      .set('cookie', admin.cookie)
      .expect(200);
    const res = { body: detail.body.vetting };

    expect(res.body.problem).toContain('late-cancelled slots');
    expect(res.body.solution).toContain('texts the waitlist');
    // Proovd's draft, not the Founder's answer — and the Founder has not
    // touched it, so nothing is recorded as their edit yet.
    expect(res.body.provenance.problem.supplier).toBe('proovd');
    expect(res.body.provenance.solution.supplier).toBe('proovd');
    expect(res.body.provenance.problem.firstEditedAt).toBeNull();
    // §33.1.5: Competition is never prefilled, whatever the intake collected.
    // An unanswered field has no supplier at all — and can never acquire
    // 'proovd', which a 0007 CHECK enforces regardless of what any route does.
    expect(res.body.competition).toBeNull();
    expect(res.body.provenance.competition.supplier).toBeNull();
    expect(res.body.provenance.competition.prefilledText ?? null).toBeNull();
  });

  it('has no way to prefill Competition from the intake (§33.1.5)', async () => {
    const email = `nocomp-${randomUUID()}@example.com`;
    const created = await request(h.app)
      .post('/api/admin/founders')
      .set('cookie', admin.cookie)
      .send({
        legalName: 'Rowan Vale',
        email,
        problem: 'p',
        // Offered by a caller that skipped the surface entirely. The route has
        // nowhere to put it, so it is ignored rather than stored.
        competition: 'THIS MUST NOT LAND',
      })
      .expect(201);

    const detail = await request(h.app)
      .get(`/api/admin/founders/${created.body.draftId}`)
      .set('cookie', admin.cookie)
      .expect(200);

    expect(detail.body.vetting.competition).toBeNull();
    expect(JSON.stringify(detail.body)).not.toContain('THIS MUST NOT LAND');
  });

  it('refuses a last-contact date it cannot read, and stores nothing', async () => {
    const email = `baddate-${randomUUID()}@example.com`;
    await request(h.app)
      .post('/api/admin/founders')
      .set('cookie', admin.cookie)
      .send({ legalName: 'Rowan Vale', email, lastContactAt: 'last tuesday' })
      .expect(400);

    expect(
      await h.db.select().from(founderProspects).where(eq(founderProspects.email, email)),
    ).toHaveLength(0);
  });
});

/* ── §7: the preview gate ─────────────────────────────────────────────────── */

describe('§7 preview shows final variables and no unresolved placeholder', () => {
  it('names every unfilled field and blocks while any remain', async () => {
    const created = await createProspect();

    const preview = await request(h.app)
      .get(`/api/admin/founders/${created.draftId}/preview`)
      .set('cookie', admin.cookie)
      .expect(200);

    expect(preview.body.blocked).toBe(true);
    expect(preview.body.unresolved).toEqual(
      expect.arrayContaining([
        '[WHAT PROOVD UNDERSTOOD]',
        '[WHY THIS FOUNDER WAS INVITED]',
        '[SENDER NAME]',
        '[EXPECTED SETUP TIME]',
      ]),
    );
  });

  it('clears once every field is written', async () => {
    const created = await createProspect();
    await compose(created.draftId);

    const preview = await request(h.app)
      .get(`/api/admin/founders/${created.draftId}/preview`)
      .set('cookie', admin.cookie)
      .expect(200);

    expect(preview.body.unresolved).toEqual([]);
    expect(preview.body.blocked).toBe(false);
    expect(preview.body.subject).toContain('Waitlist');
    expect(preview.body.html).toContain('Rowan');
  });

  /**
   * The two §7 list items that never reach the Founder.
   *
   * The marker gate is stronger than a field check wherever a field renders
   * into the message — an empty product name comes out as `[PRODUCT NAME]`. But
   * the invitation source and the internal campaign owner appear nowhere in the
   * email, and §7 additionally requires the send row to store the source, so a
   * rendered-output gate alone would let both go out blank.
   */
  it('blocks Send while the invitation source or campaign owner is blank (§7)', async () => {
    const email = `sparse-send-${randomUUID()}@example.com`;
    const created = await request(h.app)
      .post('/api/admin/founders')
      .set('cookie', admin.cookie)
      .send({ legalName: 'Rowan Vale', email })
      .expect(201);

    // Everything that renders into the message is filled in, so the marker
    // gate has nothing left to say — and Send must still refuse.
    await request(h.app)
      .put(`/api/admin/founders/${created.body.draftId}/prospect`)
      .set('cookie', admin.cookie)
      .send({ productName: 'Waitlist', productUrl: 'https://waitlist.example' })
      .expect(200);
    await compose(created.body.draftId);

    const preview = await request(h.app)
      .get(`/api/admin/founders/${created.body.draftId}/preview`)
      .set('cookie', admin.cookie)
      .expect(200);

    expect(preview.body.unresolved).toEqual([]);
    expect(preview.body.missingFields).toEqual(
      expect.arrayContaining(['Invitation source', 'Internal campaign owner']),
    );
    expect(preview.body.blocked).toBe(true);

    // Server-side, not merely a disabled button (§1.1).
    const refused = await request(h.app)
      .post(`/api/admin/founders/${created.body.draftId}/send`)
      .set('cookie', admin.cookie)
      .send({});
    expect(refused.status).toBe(422);
    expect(await h.db.select().from(campaignInvitationSends)).toHaveLength(0);

    // Recording both opens the gate, and the send row stores the source §7
    // requires it to store.
    await request(h.app)
      .put(`/api/admin/founders/${created.body.draftId}/prospect`)
      .set('cookie', admin.cookie)
      .send({ invitationSource: 'a mutual contact', internalOwner: 'Ada Admin' })
      .expect(200);

    const opened = await request(h.app)
      .get(`/api/admin/founders/${created.body.draftId}/preview`)
      .set('cookie', admin.cookie)
      .expect(200);
    expect(opened.body.missingFields).toEqual([]);
    expect(opened.body.blocked).toBe(false);
  });

  /** §9's autosave rule: a key not in the request writes nothing. */
  it('saving one field does not blank another', async () => {
    const created = await createProspect();

    await request(h.app)
      .put(`/api/admin/founders/${created.draftId}/prospect`)
      .set('cookie', admin.cookie)
      .send({ adminNotes: 'spoke again' })
      .expect(200);

    const [row] = await h.db
      .select()
      .from(founderProspects)
      .where(eq(founderProspects.email, created.email));

    expect(row!.adminNotes).toBe('spoke again');
    expect(row!.invitationSource).toBe('introduced by a mutual contact');
    expect(row!.internalOwner).toBe('Ada Admin');
    expect(row!.productName).toBe('Waitlist');
  });

  it('refuses the send itself while a placeholder remains — the gate is server-side', async () => {
    const created = await createProspect();
    await compose(created.draftId, { whyInvited: null });

    const res = await request(h.app)
      .post(`/api/admin/founders/${created.draftId}/send`)
      .set('cookie', admin.cookie)
      .send({})
      .expect(422);

    expect(res.body.unresolved).toContain('[WHY THIS FOUNDER WAS INVITED]');
    // Nothing was issued and nothing was sent.
    expect(h.sentEmails.messages.filter((m) => m.to === created.email)).toHaveLength(0);
    const tokens = await h.db
      .select()
      .from(secureTokens)
      .where(eq(secureTokens.campaignDraftId, created.draftId));
    expect(tokens).toHaveLength(0);
  });
});

/* ── §7: what the email contains ──────────────────────────────────────────── */

describe('§7 the invitation email carries all nine items and one primary action', () => {
  it('contains every §7 item', async () => {
    const created = await createProspect();
    await compose(created.draftId);
    const before = h.sentEmails.messages.length;
    await sendAndCaptureLink(created.draftId);
    const message = h.sentEmails.messages[before]!;

    // 1 · product reference, in the subject as §27.2 requires
    expect(message.subject).toContain('Waitlist');
    // 2 · what Proovd understood   3 · why they were selected
    expect(message.text).toContain(COMPLETE_COMPOSE.whatWeUnderstood);
    expect(message.text).toContain(COMPLETE_COMPOSE.whyInvited);
    // 4 · who sent it              5 · what the process includes
    expect(message.text).toContain('Ada Admin');
    for (const step of PROCESS_SUMMARY) expect(message.text).toContain(step);
    // 6 · honest time expectation  7 · no guarantee
    expect(message.text).toContain(COMPLETE_COMPOSE.expectedSetupTime);
    expect(message.text).toContain(NO_GUARANTEE_TEXT);
    // 8 · reply/support path       9 · one secure draft action
    expect(message.text).toContain('support@proovd.co');
    expect(message.replyTo).toBe('ada@proovd.co');
    expect(message.text).toContain('http://localhost:3000/draft/');
  });

  it('offers exactly one primary action (§27.2)', async () => {
    const rendered = await renderFounderInvitation({
      recipientName: 'Rowan',
      productName: 'Waitlist',
      productUrl: 'https://waitlist.example',
      whatWeUnderstood: 'x',
      whyInvited: 'y',
      senderName: 'Ada Admin',
      senderEmail: 'ada@proovd.co',
      expectedSetupTime: 'two hours',
      draftUrl: 'https://app.proovd.co/draft/abc',
      reference: 'campaign-1',
      supportEmail: 'support@proovd.co',
    });

    // One styled call to action. Other addresses appear as plain text, which is
    // what §27.2 means by a plain-text support route.
    const actionLinks = [...rendered.html.matchAll(/background-color:\s*#41ED98/gi)];
    expect(actionLinks).toHaveLength(1);
    expect(rendered.unresolved).toEqual([]);
  });

  it('never asks for bank, tax, password, or identity details', async () => {
    const created = await createProspect();
    await compose(created.draftId);
    const before = h.sentEmails.messages.length;
    await sendAndCaptureLink(created.draftId);
    const message = h.sentEmails.messages[before]!;

    const body = `${message.subject}\n${message.text}`.toLowerCase();
    for (const forbidden of ['routing number', 'account number', 'ssn', 'social security', 'w-9 number', 'upload your id', 'enter your password']) {
      expect(body).not.toContain(forbidden);
    }
    expect(message.text).toContain('will never ask you for your bank details');
  });

  it('uses no internal vocabulary (§3)', async () => {
    const created = await createProspect();
    await compose(created.draftId);
    const before = h.sentEmails.messages.length;
    await sendAndCaptureLink(created.draftId);
    const message = h.sentEmails.messages[before]!;

    const body = `${message.subject}\n${message.text}\n${message.html}`.toLowerCase();
    for (const banned of ['pledge', 'donate', 'pre-build', 'pre-launch', 'reservation', 'tranche', 'escrow', 'affiliate', 'all-or-nothing']) {
      expect(body, `"${banned}" must never render to a Founder`).not.toContain(banned);
    }
    expect(body).toContain('creator');
  });
});

/* ── §33.1.1 ──────────────────────────────────────────────────────────────── */

describe('§33.1.1 a personalized draft opens without an account and grants no other access', () => {
  it('opens with no session, no cookie, and no account', async () => {
    const founder = await invitedFounder();

    const usersBefore = await h.db.select().from(userTable);
    const sessionsBefore = await h.db.select().from(sessionTable);

    const res = await request(h.app).get(`/api/draft/${founder.raw}`).expect(200);

    expect(res.body.recipientName).toBe('Rowan');
    expect(res.body.productName).toBe('Waitlist');
    expect(res.headers['set-cookie']).toBeUndefined();

    expect(await h.db.select().from(userTable)).toHaveLength(usersBefore.length);
    expect(await h.db.select().from(sessionTable)).toHaveLength(sessionsBefore.length);
  });

  it('names the Founder and product and explains what happens before an account or payment', async () => {
    const founder = await invitedFounder();
    const res = await request(h.app).get(`/api/draft/${founder.raw}`).expect(200);

    expect(res.body.whatWeUnderstood).toBe(COMPLETE_COMPOSE.whatWeUnderstood);
    expect(res.body.processSummary).toEqual([...PROCESS_SUMMARY]);
    expect(res.body.noGuarantee).toBe(NO_GUARANTEE_TEXT);
    expect(res.body.expectedSetupTime).toBe(COMPLETE_COMPOSE.expectedSetupTime);
  });

  it('reveals nothing operational — no Admin notes, source, owner, or evidence', async () => {
    const created = await createProspect();
    await request(h.app)
      .post('/api/admin/founders')
      .set('cookie', admin.cookie)
      .send({
        legalName: 'Rowan Vale',
        email: `notes-${randomUUID()}@example.com`,
        productName: 'Waitlist',
        invitationSource: 'SECRET-SOURCE',
        internalOwner: 'SECRET-OWNER',
        adminNotes: 'SECRET-NOTES',
      })
      .expect(201);

    await compose(created.draftId);
    const raw = await sendAndCaptureLink(created.draftId);
    const res = await request(h.app).get(`/api/draft/${raw}`).expect(200);

    const serialised = JSON.stringify(res.body);
    for (const secret of ['SECRET', 'introduced by a mutual contact', 'Ada Admin']) {
      if (secret === 'Ada Admin') continue; // §7 requires the sender to be named
      expect(serialised).not.toContain(secret);
    }
    expect(Object.keys(res.body).sort()).toEqual([
      'expectedSetupTime',
      'noGuarantee',
      'processSummary',
      'productName',
      'recipientName',
      'reference',
      'senderName',
      'whatWeUnderstood',
    ]);
  });

  it('carries no Admin, payment, or account authority', async () => {
    const founder = await invitedFounder();

    await request(h.app)
      .get('/api/admin/settings')
      .set('authorization', `Bearer ${founder.raw}`)
      .expect(401);
    await request(h.app)
      .get('/api/admin/founders')
      .set('authorization', `Bearer ${founder.raw}`)
      .expect(401);
  });

  it("grants no access to another Founder's draft", async () => {
    const a = await invitedFounder('a');
    const b = await invitedFounder('b');

    const resA = await request(h.app).get(`/api/draft/${a.raw}`).expect(200);
    const resB = await request(h.app).get(`/api/draft/${b.raw}`).expect(200);

    expect(resA.body.reference).toBe(a.campaignId);
    expect(resB.body.reference).toBe(b.campaignId);
    expect(resA.body.reference).not.toBe(resB.body.reference);
  });
});

/* ── §33.1.2 ──────────────────────────────────────────────────────────────── */

describe('§33.1.2 alteration, cross-Founder access, replay, expiry, revoke, resend, and simultaneous claim fail safely', () => {
  it('answers every failure mode with one byte-identical rejection', async () => {
    const altered = await invitedFounder('altered');
    const flipped =
      altered.raw.slice(0, -1) + (altered.raw.slice(-1) === 'A' ? 'B' : 'A');

    const replayed = await invitedFounder('replayed');
    const replayedToken = await h.db
      .select({ id: secureTokens.id })
      .from(secureTokens)
      .where(eq(secureTokens.campaignDraftId, replayed.draftId))
      .limit(1);
    await h.tokens.claimDraft(replayedToken[0]!.id);

    const expired = await invitedFounder('expired');
    await h.pool.query(
      `UPDATE secure_tokens SET expires_at = now() - interval '1 day' WHERE campaign_draft_id = $1`,
      [expired.draftId],
    );

    const revoked = await invitedFounder('revoked');
    await request(h.app)
      .post(`/api/admin/founders/${revoked.draftId}/revoke`)
      .set('cookie', admin.cookie)
      .send({ reason: 'the Founder asked us not to proceed' })
      .expect(200);

    const superseded = await invitedFounder('superseded');
    const supersededOld = superseded.raw;
    await sendAndCaptureLink(superseded.draftId); // resend rotates

    const anonymised = await invitedFounder('anonymised');
    await h.pool.query(
      `UPDATE campaign_invitation_sends SET sent_at = now() - interval '40 days'
        WHERE false`, // sent_at is immutable; travel with the sweep's clock instead
    );
    await sweepUnclaimedDrafts(
      h.db,
      h.tokens,
      new Date(Date.now() + (UNCLAIMED_DRAFT_RETENTION_DAYS + 1) * 86_400_000),
    );

    const unknown = Buffer.from(randomUUID() + randomUUID()).toString('base64url');

    const rejections = await Promise.all([
      rejectionOf(`/api/draft/${flipped}`),
      rejectionOf(`/api/draft/${replayed.raw}`),
      rejectionOf(`/api/draft/${expired.raw}`),
      rejectionOf(`/api/draft/${revoked.raw}`),
      rejectionOf(`/api/draft/${supersededOld}`),
      rejectionOf(`/api/draft/${anonymised.raw}`),
      rejectionOf(`/api/draft/${unknown}`),
      rejectionOf('/api/draft/short'),
    ]);

    for (const rejection of rejections) {
      expect(rejection.status).toBe(TOKEN_REJECTION_STATUS);
      expect(rejection.body).toEqual(TOKEN_REJECTION_BODY);
    }

    // Identical down to the byte: a body that differs in length is an oracle
    // even when the fields match.
    const shapes = new Set(
      rejections.map((r) => `${r.status}|${r.contentLength}|${JSON.stringify(r.body)}`),
    );
    expect(shapes.size).toBe(1);
  });

  it('resend rotates the token and invalidates the previous version immediately', async () => {
    const founder = await invitedFounder('rotates');
    const first = founder.raw;

    const second = await sendAndCaptureLink(founder.draftId);
    expect(second).not.toBe(first);

    await request(h.app).get(`/api/draft/${first}`).expect(TOKEN_REJECTION_STATUS);
    await request(h.app).get(`/api/draft/${second}`).expect(200);

    const sends = await h.db
      .select()
      .from(campaignInvitationSends)
      .where(eq(campaignInvitationSends.draftId, founder.draftId))
      .orderBy(desc(campaignInvitationSends.sentAt));
    expect(sends).toHaveLength(2);
    expect(sends[0]!.tokenVersion).toBe(2);
    expect(sends[1]!.tokenVersion).toBe(1);
  });

  it('produces a second real email on resend, not a suppressed duplicate (§7 vs §27.2)', async () => {
    const founder = await invitedFounder('resend-mail');
    const before = h.sentEmails.messages.filter((m) => m.to === founder.email).length;

    await sendAndCaptureLink(founder.draftId);

    const after = h.sentEmails.messages.filter((m) => m.to === founder.email).length;
    expect(after).toBe(before + 1);
  });

  it('cannot produce a second email for the same send (§27.2)', async () => {
    const founder = await invitedFounder('dedup');
    const [send] = await h.db
      .select()
      .from(campaignInvitationSends)
      .where(eq(campaignInvitationSends.draftId, founder.draftId));

    const before = h.sentEmails.messages.length;
    // A duplicate job or webhook replays the same delivery identity.
    const outcome = await h.notifier.send({
      eventKey: 'founder_invitation',
      entityType: 'campaign_invitation_send',
      entityId: send!.id,
      to: founder.email,
      from: 'hello@proovd.co',
      subject: 'replay',
      html: '<p>replay</p>',
      text: 'replay',
    });

    expect(outcome.status).toBe('duplicate');
    expect(h.sentEmails.messages).toHaveLength(before);
  });

  it('revocation ends access immediately and records who and why', async () => {
    const founder = await invitedFounder('revoke-audit');
    await request(h.app).get(`/api/draft/${founder.raw}`).expect(200);

    await request(h.app)
      .post(`/api/admin/founders/${founder.draftId}/revoke`)
      .set('cookie', admin.cookie)
      .send({ reason: 'wrong person; the product is not a fit' })
      .expect(200);

    await request(h.app).get(`/api/draft/${founder.raw}`).expect(TOKEN_REJECTION_STATUS);

    const [event] = await h.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.targetId, founder.draftId),
          eq(auditEvents.action, 'invitation.revoked'),
        ),
      );
    expect(event).toMatchObject({
      actor: `user:${admin.id}`,
      internalReason: 'wrong person; the product is not a fit',
    });
    expect(event!.priorValue).toEqual({ status: 'sent' });
  });

  it('refuses a revocation with no reason', async () => {
    const founder = await invitedFounder('revoke-noreason');
    await request(h.app)
      .post(`/api/admin/founders/${founder.draftId}/revoke`)
      .set('cookie', admin.cookie)
      .send({})
      .expect(400);
    await request(h.app).get(`/api/draft/${founder.raw}`).expect(200);
  });

  it('yields one winner on two simultaneous claims', async () => {
    const founder = await invitedFounder('concurrent');
    const [token] = await h.db
      .select({ id: secureTokens.id })
      .from(secureTokens)
      .where(eq(secureTokens.campaignDraftId, founder.draftId))
      .limit(1);

    const results = await Promise.all([
      h.tokens.claimDraft(token!.id),
      h.tokens.claimDraft(token!.id),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    await request(h.app).get(`/api/draft/${founder.raw}`).expect(TOKEN_REJECTION_STATUS);
  });

  it('never puts the raw token in an audit row or in a response body', async () => {
    const founder = await invitedFounder('no-leak');
    await request(h.app).get(`/api/draft/${founder.raw}`).expect(200);

    const events = await h.db.select().from(auditEvents);
    for (const event of events) {
      expect(JSON.stringify(event)).not.toContain(founder.raw);
    }

    // Admin sees that a live link exists, its version and expiry — never it.
    const detail = await request(h.app)
      .get(`/api/admin/founders/${founder.draftId}`)
      .set('cookie', admin.cookie)
      .expect(200);
    expect(JSON.stringify(detail.body)).not.toContain(founder.raw);
    expect(detail.body.hasLiveToken).toBe(true);
  });

  it('records an unconfirmed send when the provider refuses, and does not call it sent', async () => {
    const created = await createProspect('refused');
    await compose(created.draftId);

    h.sentEmails.failNext = true;
    const res = await request(h.app)
      .post(`/api/admin/founders/${created.draftId}/send`)
      .set('cookie', admin.cookie)
      .send({})
      .expect(422);

    expect(res.body.whatHappened).toContain('did not accept');

    // The send row exists so a retention clock exists for a message that may
    // have gone out — §25.8 sets a maximum, and erring early is the safe side.
    const sends = await h.db
      .select()
      .from(campaignInvitationSends)
      .where(eq(campaignInvitationSends.draftId, created.draftId));
    expect(sends).toHaveLength(1);

    // …but it is not a claim that anything arrived (§1.4).
    expect(sends[0]!.notificationId).toBeNull();
    const [draft] = await h.db
      .select()
      .from(campaignDrafts)
      .where(eq(campaignDrafts.id, created.draftId));
    expect(draft!.status).toBe('draft');

    // The delivery claim survives, unconfirmed — the honest "we tried" state.
    const undelivered = await h.db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.target, created.email));
    expect(undelivered).toHaveLength(1);
    expect(undelivered[0]!.deliveredAt).toBeNull();
  });

  it('confirms the send only once the provider accepts it', async () => {
    const founder = await invitedFounder('confirmed');

    const [send] = await h.db
      .select()
      .from(campaignInvitationSends)
      .where(eq(campaignInvitationSends.draftId, founder.draftId));
    expect(send!.notificationId).toBeTruthy();

    const [draft] = await h.db
      .select()
      .from(campaignDrafts)
      .where(eq(campaignDrafts.id, founder.draftId));
    expect(draft!.status).toBe('sent');
  });

  it('lets the application confirm a send but never edit its retention clock', async () => {
    const founder = await invitedFounder('immutable-clock');
    const client = await h.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET ROLE proovd_app');

      // The one writable column (migration 0006).
      await client.query(
        `UPDATE campaign_invitation_sends SET notification_id = 'reconciled' WHERE draft_id = $1`,
        [founder.draftId],
      );

      // Everything the clock rests on stays outside the grant.
      await expect(
        client.query(
          `UPDATE campaign_invitation_sends SET sent_at = now() WHERE draft_id = $1`,
          [founder.draftId],
        ),
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});

/* ── §33.1.3 ──────────────────────────────────────────────────────────────── */

describe('§33.1.3 the 30-day deletion/anonymisation runs from the most recent send', () => {
  const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000);

  it('leaves a draft alone one day before the window closes', async () => {
    const founder = await invitedFounder('inside-window');

    const due = await findDueDrafts(h.db, daysFromNow(UNCLAIMED_DRAFT_RETENTION_DAYS - 1));
    expect(due.map((d) => d.draftId)).not.toContain(founder.draftId);

    await request(h.app).get(`/api/draft/${founder.raw}`).expect(200);
  });

  it('anonymises it once the window has passed, and revokes the link in the same breath', async () => {
    const founder = await invitedFounder('past-window');

    const result = await sweepUnclaimedDrafts(
      h.db,
      h.tokens,
      daysFromNow(UNCLAIMED_DRAFT_RETENTION_DAYS + 1),
    );
    expect(result.draftIds).toContain(founder.draftId);

    // The link is dead AND the content is gone. Either alone is not compliance.
    await request(h.app).get(`/api/draft/${founder.raw}`).expect(TOKEN_REJECTION_STATUS);

    const [draft] = await h.db
      .select()
      .from(campaignDrafts)
      .where(eq(campaignDrafts.id, founder.draftId));
    expect(draft!.whatWeUnderstood).toBeNull();
    expect(draft!.whyInvited).toBeNull();
    expect(draft!.status).toBe('expired');
    expect(draft!.anonymisedAt).not.toBeNull();

    const [prospect] = await h.db
      .select()
      .from(founderProspects)
      .where(eq(founderProspects.id, founder.prospectId));
    expect(prospect!.email).toBeNull();
    expect(prospect!.legalName).toBeNull();
    expect(prospect!.productName).toBeNull();
    expect(prospect!.adminNotes).toBeNull();

    // The recipient is gone from the send row too — it carried an address.
    const sends = await h.db
      .select()
      .from(campaignInvitationSends)
      .where(eq(campaignInvitationSends.draftId, founder.draftId));
    expect(sends[0]!.recipientEmail).toBeNull();
    expect(sends[0]!.recipientName).toBeNull();
  });

  it('measures from the most recent send — a resend restarts the clock (§7)', async () => {
    const founder = await invitedFounder('resend-clock');

    // Push the first send back beyond the window, then resend today.
    await h.pool.query(
      `UPDATE campaign_invitation_sends SET sent_at = now() - interval '40 days' WHERE draft_id = $1`,
      [founder.draftId],
    );
    // The row is append-only for the application role; the test moves it as a
    // superuser precisely because the application cannot.
    const stale = await findDueDrafts(h.db, new Date());
    expect(stale.map((d) => d.draftId)).toContain(founder.draftId);

    await sendAndCaptureLink(founder.draftId);

    const afterResend = await findDueDrafts(h.db, new Date());
    expect(afterResend.map((d) => d.draftId)).not.toContain(founder.draftId);
  });

  it('keeps the minimum audit evidence §25.8 requires', async () => {
    const founder = await invitedFounder('audit-evidence');
    await sweepUnclaimedDrafts(
      h.db,
      h.tokens,
      daysFromNow(UNCLAIMED_DRAFT_RETENTION_DAYS + 1),
    );

    // The rows survive so the insert-only audit trail still resolves.
    const [draft] = await h.db
      .select()
      .from(campaignDrafts)
      .where(eq(campaignDrafts.id, founder.draftId));
    expect(draft).toBeTruthy();
    expect(draft!.campaignId).toBe(founder.campaignId);

    const sends = await h.db
      .select()
      .from(campaignInvitationSends)
      .where(eq(campaignInvitationSends.draftId, founder.draftId));
    expect(sends[0]!.sentAt).toBeTruthy();
    expect(sends[0]!.sentBy).toBe(`user:${admin.id}`);

    const [event] = await h.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.targetId, founder.draftId),
          eq(auditEvents.action, 'invitation.anonymised'),
        ),
      );
    expect(event!.actor).toBe('system:unclaimed-draft-retention');

    // …and the evidence does not quote what it deleted.
    const serialised = JSON.stringify(event);
    expect(serialised).not.toContain('Rowan');
    expect(serialised).not.toContain(founder.email);
  });

  it('is safe to run twice', async () => {
    const founder = await invitedFounder('idempotent');
    const at = daysFromNow(UNCLAIMED_DRAFT_RETENTION_DAYS + 1);

    const first = await sweepUnclaimedDrafts(h.db, h.tokens, at);
    expect(first.draftIds).toContain(founder.draftId);

    const second = await sweepUnclaimedDrafts(h.db, h.tokens, at);
    expect(second.draftIds).not.toContain(founder.draftId);

    const events = await h.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.targetId, founder.draftId),
          eq(auditEvents.action, 'invitation.anonymised'),
        ),
      );
    expect(events).toHaveLength(1);
  });

  it('never sweeps a draft that was never sent', async () => {
    const created = await createProspect('never-sent');
    const due = await findDueDrafts(h.db, daysFromNow(365));
    expect(due.map((d) => d.draftId)).not.toContain(created.draftId);
  });

  it('never sweeps a claimed prospect — that is an account now (§25.8)', async () => {
    const founder = await invitedFounder('claimed-prospect');

    await h.pool.query(
      `UPDATE founder_prospects SET claimed_user_id = $2, claimed_at = now() WHERE id = $1`,
      [founder.prospectId, 'user:some-founder'],
    );

    const due = await findDueDrafts(h.db, daysFromNow(UNCLAIMED_DRAFT_RETENTION_DAYS + 1));
    expect(due.map((d) => d.draftId)).not.toContain(founder.draftId);

    const result = await sweepUnclaimedDrafts(
      h.db,
      h.tokens,
      daysFromNow(UNCLAIMED_DRAFT_RETENTION_DAYS + 1),
    );
    expect(result.draftIds).not.toContain(founder.draftId);

    const [prospect] = await h.db
      .select()
      .from(founderProspects)
      .where(eq(founderProspects.id, founder.prospectId));
    expect(prospect!.email).not.toBeNull();
    expect(prospect!.anonymisedAt).toBeNull();
  });

  it('still exempts a claimed draft if the claim flow forgets to set claimed_user_id', async () => {
    // Defence in depth. `claimed_user_id` is the claim flow's job (Phase 07),
    // and if it were ever missed this query would otherwise anonymise a live
    // Founder's record 30 days after their invitation. Two things have to be
    // wrong before real data is destroyed, not one.
    const founder = await invitedFounder('claimed-status-only');

    await h.pool.query(`UPDATE campaign_drafts SET status = 'claimed' WHERE id = $1`, [
      founder.draftId,
    ]);

    const due = await findDueDrafts(h.db, daysFromNow(UNCLAIMED_DRAFT_RETENTION_DAYS + 1));
    expect(due.map((d) => d.draftId)).not.toContain(founder.draftId);
  });

  it('still sweeps a revoked draft — revocation kills the link, not the data', async () => {
    const founder = await invitedFounder('revoked-still-swept');
    await request(h.app)
      .post(`/api/admin/founders/${founder.draftId}/revoke`)
      .set('cookie', admin.cookie)
      .send({ reason: 'not proceeding' })
      .expect(200);

    const due = await findDueDrafts(h.db, daysFromNow(UNCLAIMED_DRAFT_RETENTION_DAYS + 1));
    expect(due.map((d) => d.draftId)).toContain(founder.draftId);
  });

  it('refuses to un-anonymise, at the database level', async () => {
    const founder = await invitedFounder('irreversible');
    await sweepUnclaimedDrafts(
      h.db,
      h.tokens,
      daysFromNow(UNCLAIMED_DRAFT_RETENTION_DAYS + 1),
    );

    await expect(
      h.pool.query(`UPDATE campaign_drafts SET anonymised_at = NULL WHERE id = $1`, [
        founder.draftId,
      ]),
    ).rejects.toThrow(/irreversible/);

    await expect(
      h.pool.query(`UPDATE campaign_drafts SET why_invited = 'restored' WHERE id = $1`, [
        founder.draftId,
      ]),
    ).rejects.toThrow(/cannot be restored/);
  });

  it('refuses to send or compose an anonymised draft', async () => {
    const founder = await invitedFounder('after-anon');
    await sweepUnclaimedDrafts(
      h.db,
      h.tokens,
      daysFromNow(UNCLAIMED_DRAFT_RETENTION_DAYS + 1),
    );

    const composed = await request(h.app)
      .put(`/api/admin/founders/${founder.draftId}/invitation`)
      .set('cookie', admin.cookie)
      .send(COMPLETE_COMPOSE)
      .expect(422);
    expect(composed.body.whatHappened).toMatch(/anonymised/i);

    const sent = await request(h.app)
      .post(`/api/admin/founders/${founder.draftId}/send`)
      .set('cookie', admin.cookie)
      .send({})
      .expect(422);
    expect(sent.body.whatHappened).toMatch(/anonymised/i);
  });
});

/* ── §26.1 / §33.12.4 — the Admin surface ─────────────────────────────────── */

describe('§26.1 the Founders surface auto-populates and records overrides', () => {
  it('is refused to anyone but an enrolled Admin', async () => {
    await request(h.app).get('/api/admin/founders').expect(401);
    await request(h.app).post('/api/admin/founders').send({}).expect(401);
  });

  it('lists every §26.1 field the phase can populate, and the retention due date', async () => {
    const founder = await invitedFounder('listing');

    const res = await request(h.app)
      .get('/api/admin/founders')
      .set('cookie', admin.cookie)
      .expect(200);

    const row = res.body.founders.find(
      (f: { draftId: string }) => f.draftId === founder.draftId,
    );
    expect(row).toMatchObject({
      email: founder.email,
      productName: 'Waitlist',
      status: 'sent',
      invitationSource: 'introduced by a mutual contact',
      internalOwner: 'Ada Admin',
    });
    expect(row.lastSentAt).toBeTruthy();
    expect(new Date(row.retentionDueAt).getTime() - new Date(row.lastSentAt).getTime()).toBe(
      UNCLAIMED_DRAFT_RETENTION_DAYS * 86_400_000,
    );
  });

  it('records prior and new values on every compose edit (§33.12.4)', async () => {
    const created = await createProspect('override');
    await compose(created.draftId);
    await compose(created.draftId, { whyInvited: 'A second, better reason.' });

    const events = await h.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.targetId, created.draftId),
          eq(auditEvents.action, 'invitation.composed'),
        ),
      )
      .orderBy(desc(auditEvents.occurredAt));

    expect(events).toHaveLength(2);
    const latest = events[0]!;
    expect((latest.priorValue as Record<string, string>)['whyInvited']).toBe(
      COMPLETE_COMPOSE.whyInvited,
    );
    expect((latest.newValue as Record<string, string>)['whyInvited']).toBe(
      'A second, better reason.',
    );
    expect(latest.actor).toBe(`user:${admin.id}`);
  });

  it('exposes the campaign record with lifecycle and the §21 anchors separate (§26.2)', async () => {
    const founder = await invitedFounder('campaign-detail');
    const res = await request(h.app)
      .get(`/api/admin/founders/${founder.draftId}`)
      .set('cookie', admin.cookie)
      .expect(200);

    expect(res.body.campaign).toMatchObject({
      status: 'invited_draft',
      affiliateRosterStatus: 'forming',
      campaignBuildStatus: 'not_started',
      listingPaidAt: null,
      campaignLiveAt: null,
      campaignCloseAt: null,
    });
    // §23: lifecycle only. No payment flag has leaked into the status.
    expect(Object.keys(res.body.campaign)).not.toContain('paymentFlags');
  });

  it('serves the fixed §7 copy read-only, with no route that edits it', async () => {
    const res = await request(h.app)
      .get('/api/admin/founders/invitation-copy')
      .set('cookie', admin.cookie)
      .expect(200);

    expect(res.body.noGuarantee).toBe(NO_GUARANTEE_TEXT);
    expect(res.body.processSummary).toEqual([...PROCESS_SUMMARY]);

    // There is no writer for it. §7 forbids Admin promising acceptance or
    // results, and an editable disclaimer is one that gets softened.
    await request(h.app)
      .put('/api/admin/founders/invitation-copy')
      .set('cookie', admin.cookie)
      .send({ noGuarantee: 'We guarantee Creators will take this on.' })
      .expect(404);
  });
});
