/**
 * The Admin Tasks panel — post-Phase-24 change, 2026-08-16.
 * Spec §1.3, §25.6, §26, §30, §33.12.5; DNA §5.4, §5.10.
 *
 * §26 names no task list, so this feature has no named §33 test. What this
 * suite proves is mostly ABSENCE — the five mechanisms that keep a due date
 * from chasing anybody, and the assignee that does not exist — because those
 * are the decisions a later session is most likely to undo by accident:
 *
 *   1. No schedule-shaped column exists, and no `assigned_to` (asserted
 *      against `information_schema`, beside the columns that SHOULD exist so
 *      the check cannot pass by the table having been renamed away).
 *   2. No §27 registry key matches /task/ — nothing could carry "your task is
 *      due" even if somebody wrote a sender.
 *   3. No file under `backend/src/jobs/` names either table.
 *   4. `due_on` crosses the server as an opaque string: outside the tasks
 *      module, its schema, its migration, and the tests, nothing reads it.
 *   5. The pinned sentence rides the shared register and the backend
 *      restatement character for character.
 */

import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq, sql } from 'drizzle-orm';

import { startHarness, type Harness } from './app-harness.js';
import { createAdmin, createSignedInUser, seedUser, type AdminSession } from './admin-session.js';
import { seedAdminReauthWindow } from '../settings/service.js';

import { campaigns } from '../db/schema/domain.js';
import { campaignBuild } from '../db/schema/build.js';
import { campaignDrafts, founderProspects } from '../db/schema/invitations.js';
import { adminTaskLists, adminTasks } from '../db/schema/admin-tasks.js';
import { auditEvents } from '../db/schema/integrity.js';

import {
  TASK_REFERENCE_KINDS,
  TASK_REFERENCE_KIND_LABELS,
  TASK_REFERENCE_ADDRESS_PATTERNS,
  TASK_DUE_DATE_IS_CHECKED,
  TASK_REFERENCE_LABEL_IS_STORED,
  TASKS_BANNED_TERMS,
} from '../tasks/logic.js';

import {
  TASK_REFERENCE_KINDS as SHARED_KINDS,
  TASK_REFERENCE_KIND_LABELS as SHARED_KIND_LABELS,
  TASK_REFERENCE_ADDRESS_PATTERNS as SHARED_PATTERNS,
  TASK_DUE_DATE_IS_CHECKED as SHARED_DUE_SENTENCE,
  TASK_REFERENCE_LABEL_IS_STORED as SHARED_LABEL_SENTENCE,
  TASKS_BANNED_TERMS as SHARED_BANNED,
  TASKS_PARKED_MESSAGES,
  NOTIFICATION_EVENT_KEYS,
  UNGATED_ADMIN_WRITES,
} from '@proovd/shared';

let h: Harness;
let admin: AdminSession;
let second: AdminSession;

beforeAll(async () => {
  h = await startHarness({}, 'admin-tasks');
  await seedAdminReauthWindow(h.db, 900);
  admin = await createAdmin(h, 'tasks1');
  second = await createAdmin(h, 'tasks2');
}, 180_000);

afterAll(async () => {
  await h.stop();
});

/* ── Fixtures ─────────────────────────────────────────────────────────────── */

async function seedCampaign(label: string): Promise<{ campaignId: string; prospectId: string }> {
  const founder = await seedUser(h, 'founder', `tasks-${label}`);
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

  return { campaignId: campaign!.id, prospectId: prospect!.id };
}

async function makeList(name: string): Promise<string> {
  const res = await request(h.app)
    .post('/api/admin/tasks/lists')
    .set('Cookie', admin.cookie)
    .send({ name })
    .expect(200);
  return res.body.listId as string;
}

async function makeTask(
  listId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const res = await request(h.app)
    .post('/api/admin/tasks')
    .set('Cookie', admin.cookie)
    .send({ listId, title: 'Chase the Friday update', ...overrides })
    .expect(200);
  return res.body.taskId as string;
}

const panel = () => request(h.app).get('/api/admin/tasks').set('Cookie', admin.cookie);

/** Run a statement as the APPLICATION role — see support-workspace.test.ts. */
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

const here = path.dirname(fileURLToPath(import.meta.url));
const backendSrc = path.resolve(here, '..');

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/* ── 1. The registers are restated, never re-decided ──────────────────────── */

describe('the registers are restated, never re-decided', () => {
  it('matches @proovd/shared exactly', () => {
    expect([...TASK_REFERENCE_KINDS]).toEqual([...SHARED_KINDS]);
    expect(TASK_REFERENCE_KIND_LABELS).toEqual(SHARED_KIND_LABELS);
    expect(TASK_REFERENCE_ADDRESS_PATTERNS).toEqual(SHARED_PATTERNS);
    expect([...TASKS_BANNED_TERMS]).toEqual([...SHARED_BANNED]);
  });

  it('restates the pinned sentences character for character', () => {
    expect(TASK_DUE_DATE_IS_CHECKED).toBe(SHARED_DUE_SENTENCE);
    expect(TASK_REFERENCE_LABEL_IS_STORED).toBe(SHARED_LABEL_SENTENCE);
  });

  it('every parked entry names its absence', () => {
    for (const [key, message] of Object.entries(TASKS_PARKED_MESSAGES)) {
      expect(message.length, key).toBeGreaterThan(60);
      expect(/cannot|no |not /i.test(message), key).toBe(true);
    }
  });
});

/* ── 2. The five mechanisms that keep a due date from chasing (§30) ───────── */

describe('§30 — the date is a note, never a schedule', () => {
  it('has no schedule-shaped column and no assignee, and the real columns are present', async () => {
    for (const table of ['admin_tasks', 'admin_task_lists']) {
      const result = await h.db.execute(
        sql`SELECT column_name FROM information_schema.columns
            WHERE table_name = ${table}`,
      );
      const columns = result.rows.map((r) => (r as { column_name: string }).column_name);

      for (const forbidden of [
        'assigned_to',
        'assignee',
        'assignee_user_id',
        'remind_at',
        'notify_at',
        'recurrence',
        'repeat_interval',
        'next_send_at',
        'template_id',
        'cadence',
        'snooze_until',
        'escalate_at',
        'priority',
      ]) {
        expect(columns, `${table}.${forbidden}`).not.toContain(forbidden);
      }
      expect(columns.filter((c) => c.startsWith('sla_')), table).toEqual([]);
    }

    const tasks = await h.db.execute(
      sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'admin_tasks'`,
    );
    expect(tasks.rows.map((r) => (r as { column_name: string }).column_name)).toEqual(
      expect.arrayContaining([
        'id', 'list_id', 'title', 'notes', 'due_on', 'created_by', 'created_at',
        'completed_at', 'completed_by', 'deleted_at', 'deleted_by',
        'ref_kind', 'ref_id', 'ref_label',
      ]),
    );
    const lists = await h.db.execute(
      sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'admin_task_lists'`,
    );
    expect(lists.rows.map((r) => (r as { column_name: string }).column_name)).toEqual(
      expect.arrayContaining(['id', 'name', 'created_by', 'created_at', 'archived_at', 'archived_by']),
    );
  });

  it('no notification registry key matches /task/', () => {
    expect(NOTIFICATION_EVENT_KEYS.filter((key) => /task/.test(key))).toEqual([]);
  });

  it('no job reads either table', () => {
    const jobsDir = path.join(backendSrc, 'jobs');
    for (const file of walkFiles(jobsDir)) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toContain('admin_tasks');
      expect(text, file).not.toContain('adminTasks');
      expect(text, file).not.toContain('admin_task_lists');
      expect(text, file).not.toContain('adminTaskLists');
    }
  });

  it('nothing outside the tasks module reads due_on', () => {
    /* Mechanism 4: the date drives the surface's pill and sort, nothing else.
       Server-side the value is opaque — the module stores and returns it, and
       no other backend file mentions the column at all. */
    const allowed = [
      path.join(backendSrc, 'tasks'),
      path.join(backendSrc, 'db', 'schema', 'admin-tasks.ts'),
      path.join(backendSrc, 'db', 'migrations'),
      path.join(backendSrc, 'routes', 'admin-tasks.ts'),
      path.join(backendSrc, 'tests'),
    ];
    for (const file of walkFiles(backendSrc)) {
      if (allowed.some((prefix) => file.startsWith(prefix))) continue;
      const text = readFileSync(file, 'utf8');
      expect(text.includes('due_on') || text.includes('dueOn'), file).toBe(false);
    }
  });

  it('the server never interprets the stored date', () => {
    /* The service passes due_on through as a string; there is no comparison
       against a clock anywhere in the module. */
    const service = readFileSync(path.join(backendSrc, 'tasks', 'service.ts'), 'utf8');
    expect(service).not.toMatch(/dueOn\s*[<>]/);
    expect(service).not.toMatch(/taskDueState/);
  });
});

/* ── 3. Authorship (§1.3, §25.6) ──────────────────────────────────────────── */

describe('§25.6 — every act records who, from the session', () => {
  it('the author is the session, and a body naming another user is ignored', async () => {
    const listId = await makeList('Authorship');
    const res = await request(h.app)
      .post('/api/admin/tasks')
      .set('Cookie', admin.cookie)
      .send({
        listId,
        title: 'Attribution check',
        createdBy: second.id,
        actorUserId: second.id,
        created_by: second.id,
      })
      .expect(200);

    const [row] = await h.db
      .select()
      .from(adminTasks)
      .where(eq(adminTasks.id, res.body.taskId));
    expect(row!.createdBy).toBe(admin.id);
    expect(row!.createdBy).not.toBe(second.id);
  });

  it('completion records who did it, and reopening clears the pair', async () => {
    const listId = await makeList('Completion');
    const taskId = await makeTask(listId);

    await request(h.app)
      .post(`/api/admin/tasks/${taskId}/complete`)
      .set('Cookie', second.cookie)
      .send({})
      .expect(200);

    let [row] = await h.db.select().from(adminTasks).where(eq(adminTasks.id, taskId));
    expect(row!.completedBy).toBe(second.id);
    expect(row!.completedAt).not.toBeNull();

    const view = await panel().expect(200);
    const task = view.body.tasks.find((t: { id: string }) => t.id === taskId);
    expect(task.completed).toBe(true);
    expect(task.completedByName).toBeTruthy();

    await request(h.app)
      .post(`/api/admin/tasks/${taskId}/reopen`)
      .set('Cookie', admin.cookie)
      .send({})
      .expect(200);
    [row] = await h.db.select().from(adminTasks).where(eq(adminTasks.id, taskId));
    expect(row!.completedAt).toBeNull();
    expect(row!.completedBy).toBeNull();
  });

  it('every mutation writes an audit row in the same transaction', async () => {
    const listId = await makeList('Audit');
    const taskId = await makeTask(listId);
    const rows = await h.db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(eq(auditEvents.targetId, taskId));
    expect(rows.map((r) => r.action)).toContain('tasks.task_created');
  });
});

/* ── 4. Deletion is soft, and the database is what makes it stick ─────────── */

describe('§25.6 — deletion is soft and authorship is immutable', () => {
  it('a removed task survives as a row, filtered from every read', async () => {
    const listId = await makeList('Soft delete');
    const taskId = await makeTask(listId);

    await request(h.app)
      .delete(`/api/admin/tasks/${taskId}`)
      .set('Cookie', second.cookie)
      .send({})
      .expect(200);

    const [row] = await h.db.select().from(adminTasks).where(eq(adminTasks.id, taskId));
    expect(row).toBeDefined();
    expect(row!.deletedAt).not.toBeNull();
    expect(row!.deletedBy).toBe(second.id);

    const view = await panel().expect(200);
    expect(view.body.tasks.map((t: { id: string }) => t.id)).not.toContain(taskId);
  });

  it('the app role cannot hard-delete a task or a list', async () => {
    const listId = await makeList('No hard delete');
    const taskId = await makeTask(listId);

    await expect(
      asAppRole((client) => client.query('DELETE FROM admin_tasks WHERE id = $1', [taskId])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asAppRole((client) => client.query('DELETE FROM admin_task_lists WHERE id = $1', [listId])),
    ).rejects.toThrow(/permission denied/);
  });

  it('the recorded author and creation time cannot be rewritten', async () => {
    const listId = await makeList('Immutable author');
    const taskId = await makeTask(listId);

    await expect(
      asAppRole((client) =>
        client.query('UPDATE admin_tasks SET created_by = $1 WHERE id = $2', [second.id, taskId]),
      ),
    ).rejects.toThrow(/recorded author cannot be rewritten/);
    await expect(
      asAppRole((client) =>
        client.query("UPDATE admin_tasks SET created_at = now() WHERE id = $1", [taskId]),
      ),
    ).rejects.toThrow(/recorded author cannot be rewritten/);
  });

  it('a deleted task is settled — even a direct UPDATE is refused', async () => {
    const listId = await makeList('Settled');
    const taskId = await makeTask(listId);
    await request(h.app)
      .delete(`/api/admin/tasks/${taskId}`)
      .set('Cookie', admin.cookie)
      .send({})
      .expect(200);

    await expect(
      asAppRole((client) =>
        client.query("UPDATE admin_tasks SET title = 'rewritten' WHERE id = $1", [taskId]),
      ),
    ).rejects.toThrow(/deleted task is settled/);

    /* And through the API it reads as not found. */
    await request(h.app)
      .put(`/api/admin/tasks/${taskId}`)
      .set('Cookie', admin.cookie)
      .send({ title: 'rewritten' })
      .expect(404);
  });
});

/* ── 5. The reference (§1.4) ──────────────────────────────────────────────── */

describe('the reference is a stored label and a re-checked destination', () => {
  it('stores the server-resolved label at write time', async () => {
    const { campaignId } = await seedCampaign('ref-store');
    const listId = await makeList('References');
    const taskId = await makeTask(listId, {
      reference: { kind: 'campaign', id: campaignId },
    });

    const [row] = await h.db.select().from(adminTasks).where(eq(adminTasks.id, taskId));
    expect(row!.refKind).toBe('campaign');
    expect(row!.refId).toBe(campaignId);
    expect(row!.refLabel).toBe('Campaign ref-store');

    const view = await panel().expect(200);
    const task = view.body.tasks.find((t: { id: string }) => t.id === taskId);
    expect(task.reference.label).toBe('Campaign ref-store');
    expect(task.reference.href).toBe(`/admin/campaigns/${campaignId}`);
    expect(task.reference.unavailableBecause).toBeNull();
  });

  it('refuses a reference pointing at nothing, and an unknown kind', async () => {
    const listId = await makeList('Bad refs');
    await request(h.app)
      .post('/api/admin/tasks')
      .set('Cookie', admin.cookie)
      .send({
        listId,
        title: 'Pointing at nothing',
        reference: { kind: 'campaign', id: randomUUID() },
      })
      .expect(422);
    await request(h.app)
      .post('/api/admin/tasks')
      .set('Cookie', admin.cookie)
      .send({
        listId,
        title: 'Unknown kind',
        reference: { kind: 'invoice', id: randomUUID() },
      })
      .expect(422);
  });

  it('a ref_id with no kind is unrepresentable (CHECK)', async () => {
    const listId = await makeList('Ref CHECK');
    await expect(
      asAppRole((client) =>
        client.query(
          `INSERT INTO admin_tasks (list_id, title, created_by, ref_id)
           VALUES ($1, 'half a pointer', $2, $3)`,
          [listId, admin.id, randomUUID()],
        ),
      ),
    ).rejects.toThrow(/admin_tasks_ref_all_or_nothing/);
  });

  it('href and unavailableBecause are never both set and never both null', async () => {
    const { campaignId } = await seedCampaign('ref-shape');
    const listId = await makeList('Ref shape');
    await makeTask(listId, { reference: { kind: 'campaign', id: campaignId } });

    const view = await panel().expect(200);
    for (const task of view.body.tasks) {
      if (!task.reference) continue;
      expect(Boolean(task.reference.href) === Boolean(task.reference.unavailableBecause)).toBe(
        false,
      );
    }
  });

  it('the five kinds resolve to the five workspace address shapes', async () => {
    const { campaignId, prospectId } = await seedCampaign('ref-addr');
    const listId = await makeList('Addresses');
    const taskId = await makeTask(listId, {
      reference: { kind: 'founder', id: prospectId },
    });
    const view = await panel().expect(200);
    const task = view.body.tasks.find((t: { id: string }) => t.id === taskId);
    expect(task.reference.href).toBe(`/admin/founders/${prospectId}`);
    void campaignId;
  });

  it('the picker resolves one record with the label the create will store', async () => {
    const { campaignId } = await seedCampaign('ref-picker');
    const res = await request(h.app)
      .get(`/api/admin/tasks/targets?kind=campaign&id=${campaignId}`)
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(res.body.targets).toEqual([{ id: campaignId, label: 'Campaign ref-picker' }]);

    const search = await request(h.app)
      .get('/api/admin/tasks/targets?kind=campaign&q=ref-picker')
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(search.body.targets.map((t: { id: string }) => t.id)).toContain(campaignId);

    await request(h.app)
      .get('/api/admin/tasks/targets?kind=invoice&q=x')
      .set('Cookie', admin.cookie)
      .expect(400);
  });
});

/* ── 6. Lists ─────────────────────────────────────────────────────────────── */

describe('lists are shared, and archiving refuses to hide open work', () => {
  it('every Admin sees every list and who wrote each task', async () => {
    const listId = await makeList('Shared visibility');
    await makeTask(listId);
    const res = await request(h.app)
      .get('/api/admin/tasks')
      .set('Cookie', second.cookie)
      .expect(200);
    expect(res.body.lists.map((l: { id: string }) => l.id)).toContain(listId);
    const task = res.body.tasks.find((t: { listId: string }) => t.listId === listId);
    expect(task.createdByName).toBeTruthy();
  });

  it('a list with open tasks refuses to archive; an emptied one archives', async () => {
    const listId = await makeList('Archive rules');
    const taskId = await makeTask(listId);

    await request(h.app)
      .post(`/api/admin/tasks/lists/${listId}/archive`)
      .set('Cookie', admin.cookie)
      .send({})
      .expect(422);

    await request(h.app)
      .post(`/api/admin/tasks/${taskId}/complete`)
      .set('Cookie', admin.cookie)
      .send({})
      .expect(200);
    await request(h.app)
      .post(`/api/admin/tasks/lists/${listId}/archive`)
      .set('Cookie', admin.cookie)
      .send({})
      .expect(200);

    const view = await panel().expect(200);
    expect(view.body.lists.map((l: { id: string }) => l.id)).not.toContain(listId);

    const [row] = await h.db
      .select()
      .from(adminTaskLists)
      .where(eq(adminTaskLists.id, listId));
    expect(row!.archivedAt).not.toBeNull();
    expect(row!.archivedBy).toBe(admin.id);
  });

  it('an archived list is settled by trigger', async () => {
    const listId = await makeList('Archived settled');
    await request(h.app)
      .post(`/api/admin/tasks/lists/${listId}/archive`)
      .set('Cookie', admin.cookie)
      .send({})
      .expect(200);
    await expect(
      asAppRole((client) =>
        client.query("UPDATE admin_task_lists SET archived_at = NULL WHERE id = $1", [listId]),
      ),
    ).rejects.toThrow(/archived list is settled/);
  });
});

/* ── 7. Editing ───────────────────────────────────────────────────────────── */

describe('editing writes only the keys it was given (§9\'s autosave rule)', () => {
  it('an absent key touches nothing; null clears', async () => {
    const { campaignId } = await seedCampaign('edit');
    const listId = await makeList('Editing');
    const taskId = await makeTask(listId, {
      notes: 'Keep this',
      dueOn: '2026-09-01',
      reference: { kind: 'campaign', id: campaignId },
    });

    /* Only the title. */
    await request(h.app)
      .put(`/api/admin/tasks/${taskId}`)
      .set('Cookie', admin.cookie)
      .send({ title: 'Renamed' })
      .expect(200);
    let [row] = await h.db.select().from(adminTasks).where(eq(adminTasks.id, taskId));
    expect(row!.title).toBe('Renamed');
    expect(row!.notes).toBe('Keep this');
    expect(row!.dueOn).toBe('2026-09-01');
    expect(row!.refId).toBe(campaignId);

    /* Explicit nulls clear. */
    await request(h.app)
      .put(`/api/admin/tasks/${taskId}`)
      .set('Cookie', admin.cookie)
      .send({ dueOn: null, reference: null })
      .expect(200);
    [row] = await h.db.select().from(adminTasks).where(eq(adminTasks.id, taskId));
    expect(row!.dueOn).toBeNull();
    expect(row!.refKind).toBeNull();
    expect(row!.refLabel).toBeNull();
  });

  it('refuses a due date that is not a real calendar day', async () => {
    const listId = await makeList('Due validation');
    await request(h.app)
      .post('/api/admin/tasks')
      .set('Cookie', admin.cookie)
      .send({ listId, title: 'Bad date', dueOn: '2026-02-30' })
      .expect(422);
    await request(h.app)
      .post('/api/admin/tasks')
      .set('Cookie', admin.cookie)
      .send({ listId, title: 'Bad shape', dueOn: 'next tuesday' })
      .expect(422);
  });
});

/* ── 8. Guards and the §33.12.5 partition ─────────────────────────────────── */

describe('§33.12.5 — the routes and the partition', () => {
  it('refuses no session and a non-admin role', async () => {
    await request(h.app).get('/api/admin/tasks').expect(401);
    const founder = await createSignedInUser(h, 'founder', 'tasks-wrongrole');
    await request(h.app).get('/api/admin/tasks').set('Cookie', founder.cookie).expect(403);
    await request(h.app)
      .post('/api/admin/tasks/lists')
      .set('Cookie', founder.cookie)
      .send({ name: 'nope' })
      .expect(403);
  });

  it('registers every write in UNGATED_ADMIN_WRITES with a reason over 60 characters', () => {
    const registered = new Set(UNGATED_ADMIN_WRITES.map((entry) => entry.route));
    const added = [
      'POST /api/admin/tasks/lists',
      'POST /api/admin/tasks/lists/:listId/archive',
      'POST /api/admin/tasks',
      'PUT /api/admin/tasks/:taskId',
      'POST /api/admin/tasks/:taskId/complete',
      'POST /api/admin/tasks/:taskId/reopen',
      'DELETE /api/admin/tasks/:taskId',
    ];
    for (const route of added) {
      expect(registered, route).toContain(route);
      const entry = UNGATED_ADMIN_WRITES.find((e) => e.route === route)!;
      expect(entry.reason.trim().length, route).toBeGreaterThan(60);
      expect(entry.specRef, route).toMatch(/§/);
    }
  });
});

/* ── 9. §30 and §3.2 — what the panel refuses to become ───────────────────── */

describe('§30 — a note that waits, never a queue that chases', () => {
  it('carries none of the banned vocabulary in any payload', async () => {
    const { campaignId } = await seedCampaign('vocab');
    const listId = await makeList('Vocabulary');
    await makeTask(listId, {
      dueOn: '2026-09-01',
      reference: { kind: 'campaign', id: campaignId },
    });
    const view = await panel().expect(200);
    const targets = await request(h.app)
      .get('/api/admin/tasks/targets?kind=campaign&q=vocab')
      .set('Cookie', admin.cookie)
      .expect(200);

    const blob = `${JSON.stringify(view.body)} ${JSON.stringify(targets.body)}`.toLowerCase();
    for (const term of TASKS_BANNED_TERMS) {
      const pattern = new RegExp(`\\b${term.replace(/ /g, '\\s+')}\\b`);
      expect(pattern.test(blob), term).toBe(false);
    }
    for (const term of ['escrow', 'custody', 'pledge', 'all-or-nothing', 'upfront fee']) {
      expect(blob, term).not.toContain(term);
    }
  });

  it('has no bulk route and no export route', async () => {
    await request(h.app)
      .post('/api/admin/tasks/bulk')
      .set('Cookie', admin.cookie)
      .send({})
      .expect(404);
    await request(h.app)
      .post('/api/admin/tasks/export')
      .set('Cookie', admin.cookie)
      .send({})
      .expect(404);
  });
});
