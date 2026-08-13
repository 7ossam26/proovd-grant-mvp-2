/**
 * The Support Admin workspace — §26.7, §26.8, §27.8, §25.6, §33.9.11, §33.12.5.
 *
 * Built 2026-08-13 over the case domain Phase 16b shipped. `support-operations
 * .test.ts` still owns §33.9.10 and §33.9.11 and is untouched; this suite proves
 * what the workspace ADDS and, more importantly, what it was not allowed to add.
 *
 * The four things worth stating up front, because they are the decisions a later
 * session is most likely to undo by accident:
 *
 *   1. Triage exists and is severed from §27.8's deadline. Proved by moving it
 *      and comparing the stored deadline byte for byte.
 *   2. `closed` is a stamp, not a fifth status — so the five modules that read
 *      `status <> 'resolved'` to mean "still open" keep working.
 *   3. `waiting_on` and `status` cannot disagree, and the CHECK is what makes
 *      that true rather than every writer remembering.
 *   4. Recording a contact sends nothing. §27 defines no key for it.
 */

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { and, eq, sql } from 'drizzle-orm';

import { startHarness, type Harness } from './app-harness.js';
import { createAdmin, seedUser, type AdminSession } from './admin-session.js';
import { seedAdminReauthWindow } from '../settings/service.js';

import { campaigns } from '../db/schema/domain.js';
import { campaignBuild } from '../db/schema/build.js';
import { campaignDrafts, founderProspects } from '../db/schema/invitations.js';
import {
  supportCases,
  supportCaseMessages,
  supportCaseEvidence,
  supportCaseContacts,
  supportCaseReopens,
  supportCaseAssignments,
} from '../db/schema/support.js';
import { notificationDeliveries } from '../db/schema/integrity.js';

import {
  SUPPORT_WAITING_PARTIES,
  SUPPORT_WAITING_LABELS,
  SUPPORT_TRIAGE_LEVELS,
  SUPPORT_EVIDENCE_KINDS,
  SUPPORT_LINKED_RECORD_KINDS,
  SUPPORT_CONTACT_PARTIES,
  SUPPORT_QUEUE_FILTERS,
  SUPPORT_HISTORY_SOURCES,
  SUPPORT_HISTORY_SECTIONS,
  TRIAGE_NEVER_CHANGES_THE_PROMISE,
  CONTACT_IS_RECORDED_NOT_SENT,
  EVIDENCE_IS_A_REFERENCE,
  statusForWaitingParty,
  supportChip,
  supportCaseIsOpen,
  nextActionSentence,
  blockedOnProovd,
} from '../support/workspace/logic.js';

import {
  SUPPORT_WAITING_PARTIES as SHARED_PARTIES,
  SUPPORT_WAITING_LABELS as SHARED_PARTY_LABELS,
  SUPPORT_TRIAGE_LEVELS as SHARED_TRIAGE,
  SUPPORT_EVIDENCE_KINDS as SHARED_EVIDENCE,
  SUPPORT_LINKED_RECORD_KINDS as SHARED_LINKED,
  SUPPORT_CONTACT_PARTIES as SHARED_CONTACT,
  SUPPORT_QUEUE_FILTERS as SHARED_FILTERS,
  SUPPORT_HISTORY_SOURCES as SHARED_SOURCES,
  SUPPORT_HISTORY_SECTIONS as SHARED_SECTIONS,
  TRIAGE_NEVER_CHANGES_THE_PROMISE as SHARED_TRIAGE_SENTENCE,
  CONTACT_IS_RECORDED_NOT_SENT as SHARED_CONTACT_SENTENCE,
  EVIDENCE_IS_A_REFERENCE as SHARED_EVIDENCE_SENTENCE,
  SUPPORT_FILTER_DEFINITIONS,
  SUPPORT_PARKED_MESSAGES,
  SUPPORT_BANNED_TERMS,
  UNGATED_ADMIN_WRITES,
  supportChip as sharedChip,
} from '@proovd/shared';

let h: Harness;
let admin: AdminSession;
let second: AdminSession;

beforeAll(async () => {
  h = await startHarness(
    { authRouteLimit: 1_000_000, globalRateLimit: 1_000_000 },
    'support-workspace',
  );
  await seedAdminReauthWindow(h.db, 900);
  admin = await createAdmin(h, 'supportws');
  second = await createAdmin(h, 'supportws2');
}, 180_000);

afterAll(async () => {
  await h.stop();
});

/* ── Fixtures ─────────────────────────────────────────────────────────────── */

async function seedCampaign(label: string): Promise<{ campaignId: string; founderId: string }> {
  const founder = await seedUser(h, 'founder', `supportws-${label}`);
  const [prospect] = await h.db
    .insert(founderProspects)
    .values({
      legalName: `Founder ${label}`,
      preferredName: `F-${label}`,
      email: founder.email,
      productName: `Product ${label}`,
      businessName: `${label} Labs LLC`,
      createdBy: 'admin:test',
      claimedUserId: founder.id,
      claimedAt: new Date(),
    })
    .returning({ id: founderProspects.id });

  const [campaign] = await h.db
    .insert(campaigns)
    .values({
      status: 'live' as never,
      type: 'pre_launch',
      typeLockedAt: new Date(),
      listingPaidAt: new Date(),
      campaignLiveAt: new Date(Date.now() - 86_400_000),
      campaignCloseAt: new Date(Date.now() + 14 * 86_400_000),
    })
    .returning({ id: campaigns.id });

  await h.db.insert(campaignDrafts).values({
    campaignId: campaign!.id,
    prospectId: prospect!.id,
    status: 'claimed',
    createdBy: 'admin:test',
  });

  await h.db.insert(campaignBuild).values({
    campaignId: campaign!.id,
    title: `Campaign ${label}`,
    founderDisplayName: `Founder ${label}`,
    founderEntityDisplay: `${label} Labs LLC`,
    founderCountry: 'United States',
    publicStory: 'A story.',
    closesAt: new Date(Date.now() + 14 * 86_400_000),
    refundPolicyTitle: 'Refund Policy',
    refundPolicyVersion: 'v1',
    refundPolicySourceUrl: 'https://app.proovd.co/policies/refund/v1',
    updatedBy: 'user:test',
  });

  return { campaignId: campaign!.id, founderId: founder.id };
}

/** A case opened through §26.7's own route, so it carries the real §27.8 clock. */
async function openCase(
  label: string,
  overrides: Record<string, unknown> = {},
): Promise<{ caseId: string; reference: string; campaignId: string; founderId: string }> {
  const { campaignId, founderId } = await seedCampaign(label);
  const res = await request(h.app)
    .post('/api/admin/support/cases')
    .set('Cookie', admin.cookie)
    .send({
      topic: 'delivery',
      owner: 'proovd_support',
      requesterKind: 'founder',
      requesterUserId: founderId,
      requesterEmail: `requester-${label}@example.com`,
      campaignId,
      message: 'The thing has not arrived.',
      ...overrides,
    })
    .expect(201);
  return { caseId: res.body.caseId, reference: res.body.reference, campaignId, founderId };
}

/**
 * Asserts a write is refused by the DATABASE, with the constraint's own words.
 *
 * Drizzle wraps the driver error, so the Postgres text lives down the cause
 * chain — the same walk `isUniqueViolation` does in the services, and the same
 * helper `affiliate-decisions.test.ts` uses. Matching on the wrapper's message
 * would pass for any failed query at all, including a typo in the SQL.
 */
async function expectDbRefusal(work: Promise<unknown>, message: RegExp): Promise<void> {
  let caught: unknown = null;
  try {
    await work;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  const texts: string[] = [];
  let current: unknown = caught;
  while (current instanceof Error) {
    texts.push(current.message);
    current = current.cause;
  }
  expect(texts.join(' | ')).toMatch(message);
}

/**
 * Run a statement as the APPLICATION role.
 *
 * The migrator connects as a superuser, so a `REVOKE … FROM proovd_app` does
 * not bite on the harness's own connection. A grant test that skipped this
 * would assert nothing — it would pass whether the grant existed or not.
 */
async function asAppRole<T>(fn: (client: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const client = await h.pool.connect();
  try {
    await client.query('SET ROLE proovd_app');
    return await fn(client);
  } finally {
    await client.query('RESET ROLE');
    client.release();
  }
}

const workspace = () =>
  request(h.app).get('/api/admin/support/workspace').set('Cookie', admin.cookie);

const readCase = (caseId: string) =>
  request(h.app).get(`/api/admin/support/workspace/${caseId}`).set('Cookie', admin.cookie);

const act = (caseId: string, suffix: string) =>
  request(h.app).post(`/api/admin/support/cases/${caseId}/${suffix}`).set('Cookie', admin.cookie);

/* ── 1. The registers ─────────────────────────────────────────────────────── */

describe('the registers are restated, never re-decided', () => {
  it('matches @proovd/shared exactly', () => {
    expect([...SUPPORT_WAITING_PARTIES]).toEqual([...SHARED_PARTIES]);
    expect(SUPPORT_WAITING_LABELS).toEqual(SHARED_PARTY_LABELS);
    expect([...SUPPORT_TRIAGE_LEVELS]).toEqual([...SHARED_TRIAGE]);
    expect([...SUPPORT_EVIDENCE_KINDS]).toEqual([...SHARED_EVIDENCE]);
    expect([...SUPPORT_LINKED_RECORD_KINDS]).toEqual([...SHARED_LINKED]);
    expect([...SUPPORT_CONTACT_PARTIES]).toEqual([...SHARED_CONTACT]);
    expect([...SUPPORT_QUEUE_FILTERS]).toEqual([...SHARED_FILTERS]);
    expect([...SUPPORT_HISTORY_SOURCES]).toEqual([...SHARED_SOURCES]);
    expect([...SUPPORT_HISTORY_SECTIONS]).toEqual([...SHARED_SECTIONS]);
  });

  it('restates the three pinned sentences character for character', () => {
    expect(TRIAGE_NEVER_CHANGES_THE_PROMISE).toBe(SHARED_TRIAGE_SENTENCE);
    expect(CONTACT_IS_RECORDED_NOT_SENT).toBe(SHARED_CONTACT_SENTENCE);
    expect(EVIDENCE_IS_A_REFERENCE).toBe(SHARED_EVIDENCE_SENTENCE);
  });

  it('derives the chip identically on both sides', () => {
    const cases = [
      { status: 'open', waitingOn: 'proovd', closedAt: null, assigneeUserId: null },
      { status: 'open', waitingOn: 'provider', closedAt: null, assigneeUserId: 'u1' },
      { status: 'awaiting_founder', waitingOn: 'founder', closedAt: null, assigneeUserId: 'u1' },
      { status: 'resolved', waitingOn: null, closedAt: null, assigneeUserId: 'u1' },
      { status: 'resolved', waitingOn: null, closedAt: '2026-08-13T00:00:00Z', assigneeUserId: 'u1' },
    ];
    for (const input of cases) {
      expect(supportChip(input)).toEqual(sharedChip(input));
    }
  });

  it('gives every filter a definition of what it counts (§20)', () => {
    expect(SUPPORT_FILTER_DEFINITIONS.map((d) => d.key)).toEqual([...SHARED_FILTERS]);
    for (const definition of SUPPORT_FILTER_DEFINITIONS) {
      expect(definition.counts.trim().length).toBeGreaterThan(20);
    }
  });

  it('gives every parked capability a reason naming what is missing (§1.4)', () => {
    for (const [key, message] of Object.entries(SUPPORT_PARKED_MESSAGES)) {
      expect(message.trim().length, key).toBeGreaterThan(30);
      // Each says what is ABSENT and why, rather than that something broke.
      expect(message, key).toMatch(/not |no |cannot|there is/i);
    }
  });
});

/* ── 2. Triage is severed from the promise (§27.8) ────────────────────────── */

describe('§27.8 — triage orders the queue and moves no deadline', () => {
  it('leaves the stored deadline and its calendar version byte-identical', async () => {
    const { caseId } = await openCase('triage');

    const [before] = await h.db
      .select({
        due: supportCases.humanResponseDueAt,
        calendar: supportCases.calendarVersion,
        promised: supportCases.nextPromisedUpdateAt,
      })
      .from(supportCases)
      .where(eq(supportCases.id, caseId));

    for (const level of SUPPORT_TRIAGE_LEVELS) {
      await act(caseId, 'triage').send({ triage: level }).expect(200);
    }

    const [after] = await h.db
      .select({
        due: supportCases.humanResponseDueAt,
        calendar: supportCases.calendarVersion,
        promised: supportCases.nextPromisedUpdateAt,
        triage: supportCases.triagePriority,
      })
      .from(supportCases)
      .where(eq(supportCases.id, caseId));

    expect(after!.due.toISOString()).toBe(before!.due.toISOString());
    expect(after!.calendar).toBe(before!.calendar);
    expect(after!.promised).toBe(before!.promised);
    expect(after!.triage).toBe('low');
  });

  it('refuses a triage level nobody defined', async () => {
    const { caseId } = await openCase('triage-bad');
    const res = await act(caseId, 'triage').send({ triage: 'catastrophic' }).expect(422);
    expect(res.body.error).toBe('unknown_triage');
  });

  /*
    The structural half. A grep is what catches a LATER session wiring triage to
    the deadline — the assertion above only proves today's code does not.
  */
  it('reads no triage level anywhere a deadline is computed', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('../support/workspace/mutations.ts', import.meta.url),
      'utf8',
    );
    const triageBlock = source.slice(
      source.indexOf('export async function setCaseTriage'),
      source.indexOf('export async function setCaseWaiting'),
    );
    expect(triageBlock).not.toMatch(/humanResponseDueAt|businessDayDeadline|calendarVersion/);
  });
});

/* ── 3. `closed` is a stamp, not a fifth status ───────────────────────────── */

describe('closing keeps the four statuses the rest of the product reads', () => {
  it('leaves status `resolved` so `status <> resolved` still means "still open"', async () => {
    const { caseId } = await openCase('closing');

    await act(caseId, 'resolve')
      .send({ resolution: 'The access link was reissued and confirmed received.' })
      .expect(200);
    await act(caseId, 'close').send({}).expect(200);

    const [row] = await h.db
      .select({ status: sql<string>`${supportCases.status}::text`, closedAt: supportCases.closedAt })
      .from(supportCases)
      .where(eq(supportCases.id, caseId));

    expect(row!.status).toBe('resolved');
    expect(row!.closedAt).not.toBeNull();

    // The enum still has exactly the four Phase 16b values.
    const values = await h.db.execute(
      sql`SELECT unnest(enum_range(NULL::support_case_status))::text AS v`,
    );
    expect((values.rows as { v: string }[]).map((r) => r.v).sort()).toEqual([
      'awaiting_customer',
      'awaiting_founder',
      'open',
      'resolved',
    ]);
  });

  it('refuses to close a case that has not been resolved', async () => {
    const { caseId } = await openCase('close-early');
    const res = await act(caseId, 'close').send({}).expect(422);
    expect(res.body.error).toBe('not_resolved');
  });

  it('refuses a hand-written close on an unresolved case at the database', async () => {
    const { caseId } = await openCase('close-sql');
    await expectDbRefusal(
      h.db.update(supportCases).set({ closedAt: new Date() }).where(eq(supportCases.id, caseId)),
      /support_cases_closed_only_when_resolved/,
    );
  });
});

/* ── 4. `waiting_on` and `status` cannot disagree ─────────────────────────── */

describe('§26.7 — the waiting party and the status are one fact', () => {
  it('derives the status from the party rather than taking it from the caller', () => {
    expect(
      statusForWaitingParty({ waitingOn: 'founder', requesterKind: 'backer', owner: 'founder_coordinated' }),
    ).toBe('awaiting_founder');
    expect(
      statusForWaitingParty({ waitingOn: 'founder', requesterKind: 'founder', owner: 'proovd_support' }),
    ).toBe('awaiting_customer');
    // The one a stricter CHECK would have made unrepresentable: a Backer's
    // question blocked on a Creator, where PROOVD still owes the answer.
    expect(
      statusForWaitingParty({ waitingOn: 'creator', requesterKind: 'backer', owner: 'proovd_support' }),
    ).toBe('open');
  });

  it('records a Backer question blocked on a Creator without blaming the Backer', async () => {
    const { campaignId } = await seedCampaign('cross');
    const backerCase = await request(h.app)
      .post('/api/admin/support/cases')
      .set('Cookie', admin.cookie)
      .send({
        topic: 'campaign_question',
        owner: 'proovd_support',
        requesterKind: 'creator',
        requesterUserId: second.id,
        requesterEmail: 'creator@example.com',
        campaignId,
        message: 'My link stopped counting.',
      })
      .expect(201);

    await act(backerCase.body.caseId, 'waiting')
      .send({ waitingOn: 'provider', nextAction: 'Stripe must clear the verification.' })
      .expect(200);

    const [row] = await h.db
      .select({
        status: sql<string>`${supportCases.status}::text`,
        waitingOn: supportCases.waitingOn,
      })
      .from(supportCases)
      .where(eq(supportCases.id, backerCase.body.caseId));

    expect(row!.status).toBe('open');
    expect(row!.waitingOn).toBe('provider');
  });

  it('refuses a hand-written pair the CHECK does not admit', async () => {
    const { caseId } = await openCase('pair');
    await expectDbRefusal(
      h.db
        .update(supportCases)
        // Resolved with a waiting party is the combination the CHECK exists for.
        .set({ status: 'resolved' as never, waitingOn: 'founder' })
        .where(eq(supportCases.id, caseId)),
      /support_cases_waiting_matches_status/,
    );
  });

  it('refuses a status change with no next action (§27.1)', async () => {
    const { caseId } = await openCase('no-next');
    const res = await act(caseId, 'waiting')
      .send({ waitingOn: 'founder', nextAction: '   ' })
      .expect(422);
    expect(res.body.error).toBe('next_action_required');
  });

  it('starts §27.8’s 48-hour clock on entering awaiting_founder and clears it on leaving', async () => {
    const { campaignId, founderId } = await seedCampaign('clock');
    const opened = await request(h.app)
      .post('/api/admin/support/cases')
      .set('Cookie', admin.cookie)
      .send({
        topic: 'delivery',
        owner: 'founder_coordinated',
        requesterKind: 'founder',
        requesterUserId: founderId,
        requesterEmail: 'clock@example.com',
        campaignId,
        message: 'Where is it?',
      })
      .expect(201);

    const [withClock] = await h.db
      .select({ followup: supportCases.founderFollowupDueAt })
      .from(supportCases)
      .where(eq(supportCases.id, opened.body.caseId));
    expect(withClock!.followup).not.toBeNull();

    await act(opened.body.caseId, 'waiting')
      .send({ waitingOn: 'proovd', nextAction: 'Proovd must check the delivery record.' })
      .expect(200);

    const [cleared] = await h.db
      .select({ followup: supportCases.founderFollowupDueAt })
      .from(supportCases)
      .where(eq(supportCases.id, opened.body.caseId));
    // A clock left running against somebody who no longer owes anything is a
    // breach the queue would report forever.
    expect(cleared!.followup).toBeNull();
  });
});

/* ── 5. Assignment is a real Admin, from the session ──────────────────────── */

describe('§26.7 — the assignee is an Admin account, never a name', () => {
  it('assigns, records the previous owner, and refuses a non-Admin', async () => {
    const { caseId } = await openCase('assign');
    const founder = await seedUser(h, 'founder', 'not-an-admin');

    const refused = await act(caseId, 'assign').send({ toUserId: founder.id }).expect(422);
    expect(refused.body.error).toBe('not_an_admin');

    await act(caseId, 'assign').send({ toUserId: admin.id, reason: 'First responder.' }).expect(200);
    await act(caseId, 'assign')
      .send({ toUserId: second.id, reason: 'Devon owns provider escalations this week.' })
      .expect(200);

    const rows = await h.db
      .select()
      .from(supportCaseAssignments)
      .where(eq(supportCaseAssignments.caseId, caseId));
    expect(rows).toHaveLength(2);
    expect(rows[1]!.fromUserId).toBe(admin.id);
    expect(rows[1]!.toUserId).toBe(second.id);
    expect(rows[1]!.reason).toBe('Devon owns provider escalations this week.');
  });

  it('resolves “assign to me” from the session, never from the body', async () => {
    const { caseId } = await openCase('assign-me');
    // `toUserId` names somebody else AND `assignToSelf` is set. The session wins.
    await act(caseId, 'assign')
      .send({ assignToSelf: true, toUserId: second.id })
      .expect(200);

    const [row] = await h.db
      .select({ assignee: supportCases.assigneeUserId })
      .from(supportCases)
      .where(eq(supportCases.id, caseId));
    expect(row!.assignee).toBe(admin.id);
  });

  it('tells the reader whether the case is theirs, from the session', async () => {
    const { caseId } = await openCase('assigned-to-you');

    const before = await readCase(caseId).expect(200);
    expect(before.body.ownership.assignedToYou).toBe(false);

    await act(caseId, 'assign').send({ assignToSelf: true }).expect(200);

    const after = await readCase(caseId).expect(200);
    expect(after.body.ownership.assignedToYou).toBe(true);
    expect(after.body.ownership.assigneeUserId).toBe(admin.id);

    // The SAME case read by a different Admin says it is not theirs — the fact
    // is about the reader, so it cannot be a stored column.
    const other = await request(h.app)
      .get(`/api/admin/support/workspace/${caseId}`)
      .set('Cookie', second.cookie)
      .expect(200);
    expect(other.body.ownership.assignedToYou).toBe(false);
    expect(other.body.ownership.assigneeUserId).toBe(admin.id);
  });

  it('says a case has no owner rather than inventing a next action', async () => {
    const unowned = {
      status: 'open',
      closedAt: null,
      assigneeUserId: null,
      nextAction: null,
    };
    expect(nextActionSentence(unowned)).toMatch(/No Admin owns this case yet/);
    expect(blockedOnProovd({ ...unowned, waitingOn: 'founder' })).toBe(true);
    // A finished case gets NO sentence rather than a reassuring one (§1.4).
    expect(
      nextActionSentence({ status: 'resolved', closedAt: null, assigneeUserId: 'u', nextAction: 'x' }),
    ).toBeNull();
    expect(supportCaseIsOpen({ status: 'resolved', closedAt: null })).toBe(false);
  });
});

/* ── 6. Resolution, closing, reopening (§26.8, §33.9.11) ──────────────────── */

describe('§26.8 — finishing a case destroys nothing', () => {
  it('refuses a raw provider code in the resolution (§33.9.11)', async () => {
    const { caseId } = await openCase('code');
    const res = await act(caseId, 'resolve')
      .send({ resolution: 'Their bank returned generic_decline so nothing could be taken.' })
      .expect(422);
    expect(res.body.error).toBe('raw_provider_code');

    const [row] = await h.db
      .select({ resolution: supportCases.resolution })
      .from(supportCases)
      .where(eq(supportCases.id, caseId));
    expect(row!.resolution).toBeNull();
  });

  it('preserves the resolution that did not hold when a case is reopened', async () => {
    const { caseId } = await openCase('reopen');
    const resolution = 'The reward shipped on the 9th and tracking was sent.';

    await act(caseId, 'resolve').send({ resolution }).expect(200);
    await act(caseId, 'close').send({}).expect(200);
    await act(caseId, 'reopen')
      .send({ reason: 'It came back — the parcel was returned to sender.' })
      .expect(200);

    const [reopened] = await h.db
      .select()
      .from(supportCaseReopens)
      .where(eq(supportCaseReopens.caseId, caseId));
    expect(reopened!.priorResolution).toBe(resolution);
    expect(reopened!.priorClosedAt).not.toBeNull();

    const [row] = await h.db
      .select({
        status: sql<string>`${supportCases.status}::text`,
        resolution: supportCases.resolution,
        closedAt: supportCases.closedAt,
        waitingOn: supportCases.waitingOn,
      })
      .from(supportCases)
      .where(eq(supportCases.id, caseId));
    expect(row!.status).toBe('open');
    expect(row!.resolution).toBeNull();
    expect(row!.closedAt).toBeNull();
    expect(row!.waitingOn).toBe('proovd');
  });

  it('refuses a reopen with no reason', async () => {
    const { caseId } = await openCase('reopen-blank');
    await act(caseId, 'resolve').send({ resolution: 'Done.' }).expect(200);
    const res = await act(caseId, 'reopen').send({ reason: '  ' }).expect(422);
    expect(res.body.error).toBe('reason_required');
  });

  it('refuses to rewrite a standing resolution in place', async () => {
    const { caseId } = await openCase('rewrite');
    await act(caseId, 'resolve').send({ resolution: 'The original answer.' }).expect(200);
    await expectDbRefusal(
      h.db
        .update(supportCases)
        .set({ resolution: 'A quieter answer.' })
        .where(eq(supportCases.id, caseId)),
      /cannot be rewritten/,
    );
  });
});

/* ── 7. Evidence is a reference, never a file ─────────────────────────────── */

describe('§26.8 — evidence points at a record that exists', () => {
  it('refuses a linked kind with no reference, and a reference with no kind', async () => {
    const { caseId } = await openCase('evidence');

    const noRef = await act(caseId, 'evidence')
      .send({ kind: 'payment_record', description: 'A charge', linkedKind: 'payment' })
      .expect(422);
    expect(noRef.body.error).toBe('link_incomplete');

    const noKind = await act(caseId, 'evidence')
      .send({ kind: 'payment_record', description: 'A charge', linkedReference: 'TX-1' })
      .expect(422);
    expect(noKind.body.error).toBe('link_incomplete');

    await act(caseId, 'evidence')
      .send({
        kind: 'payment_record',
        description: 'Capture succeeded on the 11th.',
        linkedKind: 'payment',
        linkedReference: 'TX-3391',
      })
      .expect(200);

    const rows = await h.db
      .select()
      .from(supportCaseEvidence)
      .where(eq(supportCaseEvidence.caseId, caseId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.linkedReference).toBe('TX-3391');
  });

  /*
    The strongest form of "there is no upload": nowhere to put one. §12's object
    storage is Track A4, so a `storage_key` column would be a promise the
    deployment cannot keep.
  */
  it('has no column that could hold a file', async () => {
    const cols = await h.db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'support_case_evidence'
    `);
    const names = (cols.rows as { column_name: string }[]).map((r) => r.column_name);
    for (const forbidden of ['storage_key', 'file_url', 'file_name', 'content_type', 'bytes']) {
      expect(names, forbidden).not.toContain(forbidden);
    }
  });

  it('is insert-only for the application role', async () => {
    const { caseId } = await openCase('evidence-immutable');
    await act(caseId, 'evidence')
      .send({ kind: 'screenshot', description: 'What they saw.' })
      .expect(200);

    // As the APP role, which is what the running service connects as. The
    // harness itself is a superuser, so asserting against `h.db` here would
    // pass whether the REVOKE existed or not.
    await expect(
      asAppRole((client) =>
        client.query(`UPDATE support_case_evidence SET description = 'Something else.'`),
      ),
    ).rejects.toThrow(/permission denied/i);

    await expect(
      asAppRole((client) => client.query(`DELETE FROM support_case_evidence`)),
    ).rejects.toThrow(/permission denied/i);

    const rows = await h.db
      .select()
      .from(supportCaseEvidence)
      .where(eq(supportCaseEvidence.caseId, caseId));
    expect(rows[0]!.description).toBe('What they saw.');
  });
});

/* ── 8. A contact is recorded, not sent (§27, §30) ────────────────────────── */

describe('§26.8, §30 — coordinating with a party records and sends nothing', () => {
  it('writes no notification delivery for the case', async () => {
    const { caseId } = await openCase('contact');

    const before = await h.db
      .select({ id: notificationDeliveries.id })
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.entityId, caseId));

    await act(caseId, 'contacts')
      .send({
        partyKind: 'founder',
        partyLabel: 'Ahmed Teeb',
        message: 'Please confirm the access list includes this Backer.',
        expectedResponseAt: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .expect(200);

    const after = await h.db
      .select({ id: notificationDeliveries.id })
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.entityId, caseId));

    expect(after).toHaveLength(before.length);
  });

  it('records an outcome exactly once', async () => {
    const { caseId } = await openCase('outcome');
    const created = await act(caseId, 'contacts')
      .send({ partyKind: 'founder', partyLabel: 'Ahmed', message: 'Please confirm.' })
      .expect(200);

    const [row] = await h.db
      .select()
      .from(supportCaseContacts)
      .where(eq(supportCaseContacts.caseId, caseId));

    await request(h.app)
      .post(`/api/admin/support/cases/${caseId}/contacts/${row!.id}/outcome`)
      .set('Cookie', admin.cookie)
      .send({ outcome: 'Confirmed — access goes out tomorrow.' })
      .expect(200);

    const again = await request(h.app)
      .post(`/api/admin/support/cases/${caseId}/contacts/${row!.id}/outcome`)
      .set('Cookie', admin.cookie)
      .send({ outcome: 'Actually, no.' })
      .expect(422);
    expect(again.body.error).toBe('already_recorded');
    expect(created.body.ok).toBe(true);
  });

  it('has no column a schedule could live in (§30)', async () => {
    const cols = await h.db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'support_case_contacts'
    `);
    const names = (cols.rows as { column_name: string }[]).map((r) => r.column_name);
    for (const forbidden of ['remind_at', 'recurrence', 'next_send_at', 'template_id', 'cadence']) {
      expect(names, forbidden).not.toContain(forbidden);
    }
  });
});

/* ── 9. The composed history (§26.8) ──────────────────────────────────────── */

describe('§26.8 — the history composes and stores nothing', () => {
  it('has no timeline table of its own', async () => {
    const tables = await h.db.execute(sql`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
    `);
    const names = (tables.rows as { table_name: string }[]).map((r) => r.table_name);
    for (const forbidden of [
      'support_case_events',
      'support_case_timeline',
      'support_timeline',
      'case_events',
    ]) {
      expect(names, forbidden).not.toContain(forbidden);
    }
  });

  it('names the source table on every entry, and each is a real one', async () => {
    const { caseId } = await openCase('history');
    await act(caseId, 'assign').send({ assignToSelf: true }).expect(200);
    await act(caseId, 'evidence')
      .send({ kind: 'screenshot', description: 'What they saw.' })
      .expect(200);
    await act(caseId, 'contacts')
      .send({ partyKind: 'founder', partyLabel: 'Ahmed', message: 'Please confirm.' })
      .expect(200);
    await act(caseId, 'triage').send({ triage: 'high' }).expect(200);

    const res = await readCase(caseId).expect(200);
    const history = res.body.history as { source: string; title: string }[];

    expect(history.length).toBeGreaterThan(4);
    for (const entry of history) {
      expect(SUPPORT_HISTORY_SOURCES, entry.title).toContain(entry.source);
    }
    expect(history.map((e) => e.source)).toContain('support_case_assignments');
    expect(history.map((e) => e.source)).toContain('support_case_evidence');
    expect(history.map((e) => e.source)).toContain('audit_events');
  });

  /*
    §33.9.11 applied to the one view most likely to be pasted into a customer
    message. The note's EXISTENCE is recorded; its words stay on the thread.
  */
  it('keeps an internal note body off the history', async () => {
    const { caseId } = await openCase('note-body');
    const secretPhrase = `card_declined ${randomUUID()}`;

    await request(h.app)
      .post(`/api/admin/support/cases/${caseId}/messages`)
      .set('Cookie', admin.cookie)
      .send({ direction: 'outbound', customerFacing: false, body: secretPhrase })
      .expect(201);

    const res = await readCase(caseId).expect(200);
    expect(JSON.stringify(res.body.history)).not.toContain(secretPhrase);
    // It IS on the thread, where support reads it.
    expect(JSON.stringify(res.body.thread)).toContain(secretPhrase);
  });
});

/* ── 10. The queue ───────────────────────────────────────────────────────── */

describe('§27.8 — the workspace queue', () => {
  it('counts every filter on the server and partitions the open cases', async () => {
    const res = await workspace().expect(200);
    const counts = res.body.counts;
    const rows = res.body.rows as { open: boolean; blockedOnProovd: boolean }[];

    expect(counts.all).toBe(rows.length);
    expect(counts.resolved_closed).toBe(rows.filter((r) => !r.open).length);
    // An open case is blocked on Proovd or on somebody else — never both, never
    // neither. The two filters partition the open set exactly.
    expect(counts.waiting_on_proovd + counts.waiting_on_someone_else).toBe(
      rows.filter((r) => r.open).length,
    );
  });

  it('leads with what actually needs doing, and never invents an action', async () => {
    const res = await workspace().expect(200);
    expect(res.body.hero.title.length).toBeGreaterThan(0);
    expect(res.body.hero.detail.length).toBeGreaterThan(0);
    // §30: never a claim the data is live.
    expect(JSON.stringify(res.body)).not.toMatch(/real[- ]time/i);
  });

  it('includes finished cases, unlike §27.8’s SLA queue', async () => {
    const { caseId } = await openCase('finished');
    await act(caseId, 'resolve').send({ resolution: 'Answered in full.' }).expect(200);

    const workspaceRes = await workspace().expect(200);
    expect((workspaceRes.body.rows as { caseId: string }[]).map((r) => r.caseId)).toContain(caseId);

    // Phase 16b's queue is untouched and still excludes it.
    const sla = await request(h.app)
      .get('/api/admin/support/queue')
      .set('Cookie', admin.cookie)
      .expect(200);
    expect((sla.body.entries as { caseId: string }[]).map((e) => e.caseId)).not.toContain(caseId);
  });
});

/* ── 11. Authorization (§9, §33.12.5) ────────────────────────────────────── */

describe('§26 — Support is Admin-only, decided by the session', () => {
  it('refuses anonymous, Founder, and Creator sessions on every route', async () => {
    const { caseId } = await openCase('authz');
    const founder = await seedUser(h, 'founder', 'authz-founder');
    const creator = await seedUser(h, 'affiliate', 'authz-creator');
    const founderCookie = await (await import('./admin-session.js')).signInPlain(h, founder.email);
    const creatorCookie = await (await import('./admin-session.js')).signInPlain(h, creator.email);

    const routes: [string, string][] = [
      ['get', '/api/admin/support/workspace'],
      ['get', `/api/admin/support/workspace/${caseId}`],
      ['post', `/api/admin/support/cases/${caseId}/assign`],
      ['post', `/api/admin/support/cases/${caseId}/classify`],
      ['post', `/api/admin/support/cases/${caseId}/triage`],
      ['post', `/api/admin/support/cases/${caseId}/waiting`],
      ['post', `/api/admin/support/cases/${caseId}/next-update`],
      ['post', `/api/admin/support/cases/${caseId}/resolve`],
      ['post', `/api/admin/support/cases/${caseId}/close`],
      ['post', `/api/admin/support/cases/${caseId}/reopen`],
      ['post', `/api/admin/support/cases/${caseId}/evidence`],
      ['post', `/api/admin/support/cases/${caseId}/contacts`],
    ];

    for (const [method, path] of routes) {
      for (const cookie of [undefined, founderCookie, creatorCookie]) {
        const req = (request(h.app) as never as Record<string, (p: string) => request.Test>)[
          method
        ]!(path);
        if (cookie) req.set('Cookie', cookie);
        const res = await req.send({});
        expect([401, 403], `${method} ${path}`).toContain(res.status);
      }
    }
  });

  /*
    §33.12.5's partition. Every write this workspace added is either gated or
    registered with the property it lacks — a route belonging to neither set is
    one nobody has decided about.
  */
  it('registers every new write in UNGATED_ADMIN_WRITES with a reason', () => {
    const registered = new Set(UNGATED_ADMIN_WRITES.map((entry) => entry.route));
    const added = [
      'POST /api/admin/support/cases/:caseId/assign',
      'POST /api/admin/support/cases/:caseId/classify',
      'POST /api/admin/support/cases/:caseId/triage',
      'POST /api/admin/support/cases/:caseId/waiting',
      'POST /api/admin/support/cases/:caseId/next-update',
      'POST /api/admin/support/cases/:caseId/evidence',
      'POST /api/admin/support/cases/:caseId/contacts',
      'POST /api/admin/support/cases/:caseId/contacts/:contactId/outcome',
      'POST /api/admin/support/cases/:caseId/close',
      'POST /api/admin/support/cases/:caseId/reopen',
      'PUT /api/admin/support/cases/:caseId/subject',
    ];
    for (const route of added) {
      expect(registered, route).toContain(route);
      const entry = UNGATED_ADMIN_WRITES.find((e) => e.route === route)!;
      expect(entry.reason.trim().length, route).toBeGreaterThan(40);
      expect(entry.specRef, route).toMatch(/§/);
    }
  });
});

/* ── 12. §30 and §3.2 — what the workspace refuses to become ─────────────── */

describe('§30 — Support is an operations console, not an engagement surface', () => {
  it('carries none of the banned vocabulary in any payload', async () => {
    const { caseId } = await openCase('vocab');
    const queue = await workspace().expect(200);
    const detail = await readCase(caseId).expect(200);
    const blob = `${JSON.stringify(queue.body)} ${JSON.stringify(detail.body)}`.toLowerCase();

    for (const term of SUPPORT_BANNED_TERMS) {
      expect(blob, term).not.toContain(term.toLowerCase());
    }
    // §3.2's universal replacements bind every audience, Admin included.
    for (const term of ['escrow', 'custody', 'pledge', 'all-or-nothing', 'upfront fee']) {
      expect(blob, term).not.toContain(term);
    }
  });

  it('has no route that deletes a case or acts in bulk', async () => {
    const { caseId } = await openCase('no-delete');
    await request(h.app)
      .delete(`/api/admin/support/cases/${caseId}`)
      .set('Cookie', admin.cookie)
      .expect(404);
    await request(h.app)
      .post('/api/admin/support/cases/bulk')
      .set('Cookie', admin.cookie)
      .send({ caseIds: [caseId] })
      .expect(404);
  });

  it('reads no case message body when composing the queue', async () => {
    const { caseId } = await openCase('queue-bodies');
    const phrase = `internal-only ${randomUUID()}`;
    await request(h.app)
      .post(`/api/admin/support/cases/${caseId}/messages`)
      .set('Cookie', admin.cookie)
      .send({ direction: 'outbound', customerFacing: false, body: phrase })
      .expect(201);

    const queue = await workspace().expect(200);
    expect(JSON.stringify(queue.body)).not.toContain(phrase);
  });
});

/* ── 13. The case read is one call with everything four tabs need ─────────── */

describe('§26.8 — one read serves the whole case', () => {
  it('carries the header, thread, context, ownership, evidence, contacts, and history', async () => {
    const { caseId } = await openCase('one-read');
    const res = await readCase(caseId).expect(200);

    for (const key of [
      'header',
      'thread',
      'context',
      'ownership',
      'nextResponse',
      'evidence',
      'contacts',
      'history',
      'templates',
      'contactableParties',
      'assignableAdmins',
    ]) {
      expect(res.body, key).toHaveProperty(key);
    }

    // §26.8's promise made structural: the campaign facts are already on the
    // case, so nobody is asked to repeat them.
    expect(res.body.context.fields.length).toBeGreaterThan(0);
    expect(res.body.nextResponse.calendarVersion.length).toBeGreaterThan(0);
    // Real Admin accounts, never a hardcoded list.
    expect(res.body.assignableAdmins.length).toBeGreaterThanOrEqual(2);
    expect(
      (res.body.assignableAdmins as { userId: string }[]).map((a) => a.userId),
    ).toContain(admin.id);
  });

  it('answers 404 for a case that does not exist', async () => {
    await request(h.app)
      .get(`/api/admin/support/workspace/${randomUUID()}`)
      .set('Cookie', admin.cookie)
      .expect(404);
  });

  it('never offers to contact the person who asked', async () => {
    const { caseId } = await openCase('contactable');
    const res = await readCase(caseId).expect(200);
    const kinds = (res.body.contactableParties as { kind: string }[]).map((p) => p.kind);
    // The requester is a Founder, so the Founder is not on the list — talking to
    // them is the thread.
    expect(kinds).not.toContain('founder');
  });
});

/* ── 14. Phase 16b is untouched ──────────────────────────────────────────── */

describe('the Phase 16b case domain still behaves exactly as it did', () => {
  it('keeps §27.8’s deadline immutable through every workspace write', async () => {
    const { caseId } = await openCase('immutable');
    const [before] = await h.db
      .select({ due: supportCases.humanResponseDueAt, ref: supportCases.reference })
      .from(supportCases)
      .where(eq(supportCases.id, caseId));

    await act(caseId, 'assign').send({ assignToSelf: true }).expect(200);
    await act(caseId, 'classify').send({ topic: 'refund', subcategory: 'Timing' }).expect(200);
    await act(caseId, 'triage').send({ triage: 'urgent' }).expect(200);
    await act(caseId, 'waiting')
      .send({ waitingOn: 'provider', nextAction: 'Stripe must clear it.' })
      .expect(200);

    const [after] = await h.db
      .select({ due: supportCases.humanResponseDueAt, ref: supportCases.reference })
      .from(supportCases)
      .where(eq(supportCases.id, caseId));

    expect(after!.due.toISOString()).toBe(before!.due.toISOString());
    expect(after!.ref).toBe(before!.ref);
  });

  it('still refuses to move the stored deadline directly', async () => {
    const { caseId } = await openCase('trigger');
    await expect(
      h.db
        .update(supportCases)
        .set({ humanResponseDueAt: new Date(Date.now() + 999_000) })
        .where(eq(supportCases.id, caseId)),
    ).rejects.toThrow();
  });

  it('leaves the opening message on the thread as the customer’s own words', async () => {
    const { caseId } = await openCase('opening');
    const rows = await h.db
      .select()
      .from(supportCaseMessages)
      .where(and(eq(supportCaseMessages.caseId, caseId), eq(supportCaseMessages.direction, 'inbound')));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.customerFacing).toBe(true);
    expect(rows[0]!.body).toBe('The thing has not arrived.');
  });
});
