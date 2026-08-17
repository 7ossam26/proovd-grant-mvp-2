/**
 * The Admin Tasks panel — reads, writes, and reference resolution.
 * Post-Phase-24 change, 2026-08-16. Spec §1.3, §25.6, §30.
 *
 * ── What this module writes, and what it never touches ──────────────────────
 * Its own two tables, and `audit_events` in the same transaction as every
 * mutation. Nothing else. §26.8's trap — a second event store that drifts from
 * the first is worse than no timeline — applies to any temptation to
 * denormalise a campaign name or a Founder's status onto a task row, so a
 * reference stores a KIND, an ID, and the label that was true when it was
 * written, and the resolver re-reads the target on every render.
 *
 * ── The author is the caller's session, never the body ──────────────────────
 * Every write takes an `actorUserId` the route derives from `req.authUser`.
 * A caller that could name its own author could attribute a note to somebody
 * else — the identity mistake `routes/vetting.ts` records.
 *
 * ── The due date is stored and never read here ──────────────────────────────
 * `due_on` passes through this module as an opaque `YYYY-MM-DD` string. No
 * function in this file compares it to a clock, sorts by proximity to now, or
 * derives a state from it — the pill is computed by the surface against the
 * viewer's own day, and §30 is why the server keeps its hands off the value.
 */

import { and, desc, eq, ilike, inArray, isNull, or } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { user } from '../db/schema/auth.js';
import { auditEvents } from '../db/schema/integrity.js';
import { adminTaskLists, adminTasks } from '../db/schema/admin-tasks.js';
import { campaigns, campaignAffiliateAssociations, reservations } from '../db/schema/domain.js';
import { campaignBuild } from '../db/schema/build.js';
import { founderProspects } from '../db/schema/invitations.js';
import { affiliateProspects } from '../db/schema/affiliates.js';
import { backerIdentities } from '../db/schema/reservations.js';
import { supportCases } from '../db/schema/support.js';
import {
  TASK_REFERENCE_KINDS,
  TASK_REFERENCE_TARGET_GONE,
  type TaskReferenceKind,
  type TaskReferenceResolution,
} from './logic.js';

/* ── Shapes ────────────────────────────────────────────────────────────────*/

export type MutationOutcome<T extends object = Record<never, never>> =
  | ({ ok: true } & T)
  | { ok: false; code: string; message: string };

interface AuditContext {
  actorUserId: string;
  mfaContext: string;
  reauthContext: string;
}

export interface TaskListView {
  id: string;
  name: string;
  createdBy: string;
  createdByName: string | null;
  openCount: number;
}

export interface TaskReferenceView extends TaskReferenceResolution {
  kind: TaskReferenceKind;
  kindLabel: string;
  id: string;
}

export interface TaskView {
  id: string;
  listId: string;
  title: string;
  notes: string | null;
  /** `YYYY-MM-DD` or null. Rendered by the surface; never interpreted here. */
  dueOn: string | null;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
  completed: boolean;
  completedByName: string | null;
  reference: TaskReferenceView | null;
}

export interface TasksPanelView {
  lists: TaskListView[];
  tasks: TaskView[];
}

export interface TaskTargetOption {
  id: string;
  label: string;
}

/* ── Helpers ───────────────────────────────────────────────────────────────*/

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function looksLikeId(value: string): boolean {
  return UUID_RE.test(value);
}

/** `YYYY-MM-DD` and a real calendar day, or nothing. */
export function normalizeDueOn(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === value ? value : null;
}

const KIND_LABELS: Record<TaskReferenceKind, string> = {
  founder: 'Founder',
  creator_relationship: 'Creator relationship',
  campaign: 'Campaign',
  backer: 'Backer',
  support_case: 'Support case',
};

async function audit(
  tx: Database,
  input: AuditContext & {
    targetType: 'admin_task' | 'admin_task_list';
    targetId: string;
    action: string;
    internalReason: string;
    priorValue?: unknown;
    newValue?: unknown;
  },
): Promise<void> {
  await tx.insert(auditEvents).values({
    actor: `user:${input.actorUserId}`,
    mfaContext: input.mfaContext,
    reauthContext: input.reauthContext,
    targetType: input.targetType,
    targetId: input.targetId,
    action: input.action,
    internalReason: input.internalReason,
    customerExplanation: null,
    priorValue: (input.priorValue ?? null) as never,
    newValue: (input.newValue ?? null) as never,
  });
}

/* ── Reference resolution (§1.4) ───────────────────────────────────────────
   One resolver for write time and read time. At write time a missing target
   REFUSES the reference — a task must not be born pointing at nothing. At read
   time a missing target keeps the stored label and renders the reason where
   the destination would be, because the note is still the author's note. */

interface ResolvedTarget {
  label: string;
  href: string;
}

async function campaignTitles(db: Database, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ campaignId: campaignBuild.campaignId, title: campaignBuild.title })
    .from(campaignBuild)
    .where(inArray(campaignBuild.campaignId, ids));
  const map = new Map<string, string>();
  for (const row of rows) map.set(row.campaignId, row.title?.trim() || 'Untitled campaign');
  return map;
}

async function resolveOne(
  db: Database,
  kind: TaskReferenceKind,
  id: string,
): Promise<ResolvedTarget | null> {
  if (!looksLikeId(id)) return null;

  if (kind === 'founder') {
    const [row] = await db
      .select({
        id: founderProspects.id,
        preferredName: founderProspects.preferredName,
        legalName: founderProspects.legalName,
        productName: founderProspects.productName,
      })
      .from(founderProspects)
      .where(eq(founderProspects.id, id))
      .limit(1);
    if (!row) return null;
    const name = row.preferredName?.trim() || row.legalName?.trim() || 'Founder';
    const product = row.productName?.trim();
    return {
      label: product ? `${name} — ${product}` : name,
      href: `/admin/founders/${row.id}`,
    };
  }

  if (kind === 'creator_relationship') {
    const [row] = await db
      .select({
        associationId: campaignAffiliateAssociations.id,
        prospectId: campaignAffiliateAssociations.affiliateId,
        campaignId: campaignAffiliateAssociations.campaignId,
        handle: affiliateProspects.publicHandle,
        legalName: affiliateProspects.legalName,
      })
      .from(campaignAffiliateAssociations)
      .innerJoin(
        affiliateProspects,
        eq(affiliateProspects.id, campaignAffiliateAssociations.affiliateId),
      )
      .where(eq(campaignAffiliateAssociations.id, id))
      .limit(1);
    if (!row) return null;
    const titles = await campaignTitles(db, [row.campaignId]);
    const who = row.handle?.trim() || row.legalName?.trim() || 'Creator';
    return {
      label: `${who} · ${titles.get(row.campaignId) ?? 'Untitled campaign'}`,
      href: `/admin/creators/${row.prospectId}?tab=campaigns&rel=${row.associationId}`,
    };
  }

  if (kind === 'campaign') {
    const [row] = await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(eq(campaigns.id, id))
      .limit(1);
    if (!row) return null;
    const titles = await campaignTitles(db, [row.id]);
    return {
      label: titles.get(row.id) ?? 'Untitled campaign',
      href: `/admin/campaigns/${row.id}`,
    };
  }

  if (kind === 'backer') {
    /* A Backer has no record page — "one row per Backer, no extra record
       page" is the Backers workspace's own promise — so the destination is
       the campaign-filtered list the row lives in. */
    const [row] = await db
      .select({
        reservationId: reservations.id,
        campaignId: reservations.campaignId,
        email: backerIdentities.email,
      })
      .from(reservations)
      .innerJoin(backerIdentities, eq(backerIdentities.id, reservations.backerIdentityId))
      .where(eq(reservations.id, id))
      .limit(1);
    if (!row) return null;
    const titles = await campaignTitles(db, [row.campaignId]);
    return {
      label: `${row.email} · ${titles.get(row.campaignId) ?? 'Untitled campaign'}`,
      href: `/admin/backers?view=backers&campaignId=${encodeURIComponent(row.campaignId)}`,
    };
  }

  const [row] = await db
    .select({
      id: supportCases.id,
      reference: supportCases.reference,
      subject: supportCases.subject,
      topic: supportCases.topic,
    })
    .from(supportCases)
    .where(eq(supportCases.id, id))
    .limit(1);
  if (!row) return null;
  return {
    label: `${row.reference} — ${row.subject?.trim() || row.topic}`,
    href: `/admin/support/${row.id}`,
  };
}

/** The write-time resolution: the label that will be stored, or a refusal. */
export async function resolveTaskReference(
  db: Database,
  kind: string,
  id: string,
): Promise<MutationOutcome<{ label: string }>> {
  if (!TASK_REFERENCE_KINDS.includes(kind as TaskReferenceKind)) {
    return {
      ok: false,
      code: 'unknown_reference_kind',
      message: 'A task can point at a Founder, a Creator relationship, a campaign, a Backer, or a support case.',
    };
  }
  const target = await resolveOne(db, kind as TaskReferenceKind, id);
  if (!target) {
    return {
      ok: false,
      code: 'reference_target_missing',
      message: 'That record could not be found, so the task was not created pointing at it.',
    };
  }
  return { ok: true, label: target.label };
}

/* ── The picker (bounded, like the `/` palette's 12) ───────────────────────*/

const TARGET_LIMIT = 12;

export async function searchTaskTargets(
  db: Database,
  kind: TaskReferenceKind,
  q: string,
): Promise<TaskTargetOption[]> {
  const needle = `%${q.trim()}%`;
  const searching = q.trim() !== '';

  if (kind === 'founder') {
    const rows = await db
      .select({
        id: founderProspects.id,
        preferredName: founderProspects.preferredName,
        legalName: founderProspects.legalName,
        productName: founderProspects.productName,
      })
      .from(founderProspects)
      .where(
        searching
          ? or(
              ilike(founderProspects.preferredName, needle),
              ilike(founderProspects.legalName, needle),
              ilike(founderProspects.productName, needle),
            )
          : undefined,
      )
      .orderBy(desc(founderProspects.createdAt))
      .limit(TARGET_LIMIT);
    return rows.map((row) => {
      const name = row.preferredName?.trim() || row.legalName?.trim() || 'Founder';
      return { id: row.id, label: row.productName ? `${name} — ${row.productName}` : name };
    });
  }

  if (kind === 'creator_relationship') {
    const rows = await db
      .select({
        associationId: campaignAffiliateAssociations.id,
        campaignId: campaignAffiliateAssociations.campaignId,
        handle: affiliateProspects.publicHandle,
        legalName: affiliateProspects.legalName,
      })
      .from(campaignAffiliateAssociations)
      .innerJoin(
        affiliateProspects,
        eq(affiliateProspects.id, campaignAffiliateAssociations.affiliateId),
      )
      .where(
        searching
          ? or(
              ilike(affiliateProspects.publicHandle, needle),
              ilike(affiliateProspects.legalName, needle),
            )
          : undefined,
      )
      .limit(TARGET_LIMIT);
    const titles = await campaignTitles(db, [...new Set(rows.map((r) => r.campaignId))]);
    return rows.map((row) => ({
      id: row.associationId,
      label: `${row.handle?.trim() || row.legalName?.trim() || 'Creator'} · ${
        titles.get(row.campaignId) ?? 'Untitled campaign'
      }`,
    }));
  }

  if (kind === 'campaign') {
    const rows = await db
      .select({ campaignId: campaignBuild.campaignId, title: campaignBuild.title })
      .from(campaignBuild)
      .where(searching ? ilike(campaignBuild.title, needle) : undefined)
      .limit(TARGET_LIMIT);
    return rows.map((row) => ({
      id: row.campaignId,
      label: row.title?.trim() || 'Untitled campaign',
    }));
  }

  if (kind === 'backer') {
    const rows = await db
      .select({
        reservationId: reservations.id,
        campaignId: reservations.campaignId,
        email: backerIdentities.email,
      })
      .from(reservations)
      .innerJoin(backerIdentities, eq(backerIdentities.id, reservations.backerIdentityId))
      .where(searching ? ilike(backerIdentities.email, needle) : undefined)
      .limit(TARGET_LIMIT);
    const titles = await campaignTitles(db, [...new Set(rows.map((r) => r.campaignId))]);
    return rows.map((row) => ({
      id: row.reservationId,
      label: `${row.email} · ${titles.get(row.campaignId) ?? 'Untitled campaign'}`,
    }));
  }

  const rows = await db
    .select({
      id: supportCases.id,
      reference: supportCases.reference,
      subject: supportCases.subject,
      topic: supportCases.topic,
    })
    .from(supportCases)
    .where(
      searching ? or(ilike(supportCases.reference, needle), ilike(supportCases.subject, needle)) : undefined,
    )
    .orderBy(desc(supportCases.createdAt))
    .limit(TARGET_LIMIT);
  return rows.map((row) => ({
    id: row.id,
    label: `${row.reference} — ${row.subject?.trim() || row.topic}`,
  }));
}

/* ── The one read ──────────────────────────────────────────────────────────*/

export async function readTasksPanel(db: Database): Promise<TasksPanelView> {
  const lists = await db
    .select({
      id: adminTaskLists.id,
      name: adminTaskLists.name,
      createdBy: adminTaskLists.createdBy,
      createdByName: user.name,
    })
    .from(adminTaskLists)
    .leftJoin(user, eq(user.id, adminTaskLists.createdBy))
    .where(isNull(adminTaskLists.archivedAt))
    .orderBy(adminTaskLists.createdAt);

  const rows =
    lists.length === 0
      ? []
      : await db
          .select({
            task: adminTasks,
            createdByName: user.name,
          })
          .from(adminTasks)
          .leftJoin(user, eq(user.id, adminTasks.createdBy))
          .where(
            and(
              isNull(adminTasks.deletedAt),
              inArray(
                adminTasks.listId,
                lists.map((l) => l.id),
              ),
            ),
          )
          .orderBy(desc(adminTasks.createdAt));

  /* Completed-by names, batched. */
  const completerIds = [
    ...new Set(rows.map((r) => r.task.completedBy).filter((v): v is string => v !== null)),
  ];
  const completers = completerIds.length
    ? await db
        .select({ id: user.id, name: user.name })
        .from(user)
        .where(inArray(user.id, completerIds))
    : [];
  const completerNames = new Map(completers.map((c) => [c.id, c.name]));

  /* Read-time resolution, batched per kind: does the target still answer? */
  const byKind = new Map<TaskReferenceKind, Set<string>>();
  for (const row of rows) {
    if (row.task.refKind && row.task.refId) {
      const kind = row.task.refKind as TaskReferenceKind;
      if (!byKind.has(kind)) byKind.set(kind, new Set());
      byKind.get(kind)!.add(row.task.refId);
    }
  }
  const resolved = new Map<string, ResolvedTarget>();
  for (const [kind, ids] of byKind) {
    for (const id of ids) {
      const target = await resolveOne(db, kind, id);
      if (target) resolved.set(`${kind}:${id}`, target);
    }
  }

  const tasks: TaskView[] = rows.map((row) => {
    const t = row.task;
    let reference: TaskReferenceView | null = null;
    if (t.refKind && t.refId && t.refLabel) {
      const kind = t.refKind as TaskReferenceKind;
      const target = resolved.get(`${kind}:${t.refId}`);
      reference = {
        kind,
        kindLabel: KIND_LABELS[kind],
        id: t.refId,
        /* The STORED label, always — what the author wrote down (§18's
           stored-author reasoning). Only the destination is re-derived. */
        label: t.refLabel,
        href: target ? target.href : null,
        unavailableBecause: target ? null : TASK_REFERENCE_TARGET_GONE,
      };
    }
    return {
      id: t.id,
      listId: t.listId,
      title: t.title,
      notes: t.notes,
      dueOn: t.dueOn,
      createdBy: t.createdBy,
      createdByName: row.createdByName,
      createdAt: t.createdAt.toISOString(),
      completed: t.completedAt !== null,
      completedByName: t.completedBy ? (completerNames.get(t.completedBy) ?? null) : null,
      reference,
    };
  });

  const openByList = new Map<string, number>();
  for (const task of tasks) {
    if (!task.completed) openByList.set(task.listId, (openByList.get(task.listId) ?? 0) + 1);
  }

  return {
    lists: lists.map((l) => ({ ...l, openCount: openByList.get(l.id) ?? 0 })),
    tasks,
  };
}

/* ── Writes (§25.6: one audit row per act, same transaction) ───────────────*/

export async function createTaskList(
  db: Database,
  input: AuditContext & { name: string },
): Promise<MutationOutcome<{ listId: string }>> {
  const name = input.name.trim();
  if (!name) {
    return { ok: false, code: 'name_required', message: 'Give the list a name before saving it.' };
  }
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(adminTaskLists)
      .values({ name, createdBy: input.actorUserId })
      .returning({ id: adminTaskLists.id });
    await audit(tx as unknown as Database, {
      ...input,
      targetType: 'admin_task_list',
      targetId: row!.id,
      action: 'tasks.list_created',
      internalReason: `List "${name}" created from the Tasks panel.`,
      newValue: { name },
    });
    return { ok: true as const, listId: row!.id };
  });
}

export async function archiveTaskList(
  db: Database,
  input: AuditContext & { listId: string },
): Promise<MutationOutcome> {
  if (!looksLikeId(input.listId)) {
    return { ok: false, code: 'not_found', message: 'No such list.' };
  }
  return db.transaction(async (tx) => {
    const [list] = await tx
      .select()
      .from(adminTaskLists)
      .where(eq(adminTaskLists.id, input.listId))
      .for('update')
      .limit(1);
    if (!list) return { ok: false as const, code: 'not_found', message: 'No such list.' };
    if (list.archivedAt) {
      return { ok: true as const };
    }
    const open = await tx
      .select({ id: adminTasks.id })
      .from(adminTasks)
      .where(
        and(
          eq(adminTasks.listId, input.listId),
          isNull(adminTasks.deletedAt),
          isNull(adminTasks.completedAt),
        ),
      )
      .limit(1);
    if (open.length > 0) {
      return {
        ok: false as const,
        code: 'list_has_open_tasks',
        message:
          'This list still has open tasks — every list is shared, so archiving it would hide work somebody else may be counting on. Complete or move them first.',
      };
    }
    const now = new Date();
    await tx
      .update(adminTaskLists)
      .set({ archivedAt: now, archivedBy: input.actorUserId })
      .where(eq(adminTaskLists.id, input.listId));
    await audit(tx as unknown as Database, {
      ...input,
      targetType: 'admin_task_list',
      targetId: input.listId,
      action: 'tasks.list_archived',
      internalReason: `List "${list.name}" archived from the Tasks panel.`,
      priorValue: { archivedAt: null },
      newValue: { archivedAt: now.toISOString() },
    });
    return { ok: true as const };
  });
}

export interface TaskReferenceInput {
  kind: string;
  id: string;
}

export async function createTask(
  db: Database,
  input: AuditContext & {
    listId: string;
    title: string;
    notes?: string | undefined;
    dueOn?: string | undefined;
    reference?: TaskReferenceInput | undefined;
  },
): Promise<MutationOutcome<{ taskId: string }>> {
  const title = input.title.trim();
  if (!title) {
    return { ok: false, code: 'title_required', message: 'Give the task a title before saving it.' };
  }
  if (!looksLikeId(input.listId)) {
    return { ok: false, code: 'list_not_found', message: 'No such list.' };
  }

  let dueOn: string | null = null;
  if (input.dueOn !== undefined && input.dueOn !== '') {
    dueOn = normalizeDueOn(input.dueOn);
    if (!dueOn) {
      return {
        ok: false,
        code: 'invalid_due_date',
        message: 'The due date must be a real calendar day, written YYYY-MM-DD.',
      };
    }
  }

  /* Resolved BEFORE the transaction: the label is stored at write time, and a
     reference pointing at nothing refuses the whole create (§1.4). */
  let ref: { kind: TaskReferenceKind; id: string; label: string } | null = null;
  if (input.reference) {
    const resolution = await resolveTaskReference(db, input.reference.kind, input.reference.id);
    if (!resolution.ok) return resolution;
    ref = {
      kind: input.reference.kind as TaskReferenceKind,
      id: input.reference.id,
      label: resolution.label,
    };
  }

  return db.transaction(async (tx) => {
    const [list] = await tx
      .select({ id: adminTaskLists.id, archivedAt: adminTaskLists.archivedAt })
      .from(adminTaskLists)
      .where(eq(adminTaskLists.id, input.listId))
      .limit(1);
    if (!list || list.archivedAt) {
      return { ok: false as const, code: 'list_not_found', message: 'No such list.' };
    }
    const [row] = await tx
      .insert(adminTasks)
      .values({
        listId: input.listId,
        title,
        notes: input.notes?.trim() || null,
        dueOn,
        createdBy: input.actorUserId,
        refKind: ref?.kind ?? null,
        refId: ref?.id ?? null,
        refLabel: ref?.label ?? null,
      })
      .returning({ id: adminTasks.id });
    await audit(tx as unknown as Database, {
      ...input,
      targetType: 'admin_task',
      targetId: row!.id,
      action: 'tasks.task_created',
      internalReason: `Task "${title}" created from the Tasks panel.`,
      newValue: { title, listId: input.listId, dueOn, reference: ref },
    });
    return { ok: true as const, taskId: row!.id };
  });
}

export async function updateTask(
  db: Database,
  input: AuditContext & {
    taskId: string;
    /** Absent key = untouched; null = cleared (§9's autosave rule). */
    title?: string | undefined;
    notes?: string | null | undefined;
    dueOn?: string | null | undefined;
    listId?: string | undefined;
    reference?: TaskReferenceInput | null | undefined;
  },
): Promise<MutationOutcome> {
  if (!looksLikeId(input.taskId)) {
    return { ok: false, code: 'not_found', message: 'No such task.' };
  }

  const patch: Partial<typeof adminTasks.$inferInsert> = {};

  if (input.title !== undefined) {
    const title = input.title.trim();
    if (!title) {
      return { ok: false, code: 'title_required', message: 'A task keeps a title — clear the task instead of its name.' };
    }
    patch.title = title;
  }
  if (input.notes !== undefined) {
    patch.notes = input.notes === null ? null : input.notes.trim() || null;
  }
  if (input.dueOn !== undefined) {
    if (input.dueOn === null || input.dueOn === '') {
      patch.dueOn = null;
    } else {
      const dueOn = normalizeDueOn(input.dueOn);
      if (!dueOn) {
        return {
          ok: false,
          code: 'invalid_due_date',
          message: 'The due date must be a real calendar day, written YYYY-MM-DD.',
        };
      }
      patch.dueOn = dueOn;
    }
  }

  let ref: { kind: TaskReferenceKind; id: string; label: string } | null | undefined;
  if (input.reference !== undefined) {
    if (input.reference === null) {
      ref = null;
    } else {
      const resolution = await resolveTaskReference(db, input.reference.kind, input.reference.id);
      if (!resolution.ok) return resolution;
      ref = {
        kind: input.reference.kind as TaskReferenceKind,
        id: input.reference.id,
        label: resolution.label,
      };
    }
  }

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(adminTasks)
      .where(eq(adminTasks.id, input.taskId))
      .for('update')
      .limit(1);
    if (!existing || existing.deletedAt) {
      return { ok: false as const, code: 'not_found', message: 'No such task.' };
    }

    if (input.listId !== undefined && input.listId !== existing.listId) {
      if (!looksLikeId(input.listId)) {
        return { ok: false as const, code: 'list_not_found', message: 'No such list.' };
      }
      const [list] = await tx
        .select({ id: adminTaskLists.id, archivedAt: adminTaskLists.archivedAt })
        .from(adminTaskLists)
        .where(eq(adminTaskLists.id, input.listId))
        .limit(1);
      if (!list || list.archivedAt) {
        return { ok: false as const, code: 'list_not_found', message: 'No such list.' };
      }
      patch.listId = input.listId;
    }

    if (ref !== undefined) {
      patch.refKind = ref?.kind ?? null;
      patch.refId = ref?.id ?? null;
      patch.refLabel = ref?.label ?? null;
    }

    if (Object.keys(patch).length === 0) {
      return { ok: true as const };
    }

    await tx.update(adminTasks).set(patch).where(eq(adminTasks.id, input.taskId));
    await audit(tx as unknown as Database, {
      ...input,
      targetType: 'admin_task',
      targetId: input.taskId,
      action: 'tasks.task_edited',
      internalReason: 'Task edited from the Tasks panel.',
      priorValue: {
        title: existing.title,
        notes: existing.notes,
        dueOn: existing.dueOn,
        listId: existing.listId,
        refKind: existing.refKind,
        refId: existing.refId,
      },
      newValue: patch,
    });
    return { ok: true as const };
  });
}

export async function setTaskCompletion(
  db: Database,
  input: AuditContext & { taskId: string; done: boolean },
): Promise<MutationOutcome> {
  if (!looksLikeId(input.taskId)) {
    return { ok: false, code: 'not_found', message: 'No such task.' };
  }
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(adminTasks)
      .where(eq(adminTasks.id, input.taskId))
      .for('update')
      .limit(1);
    if (!existing || existing.deletedAt) {
      return { ok: false as const, code: 'not_found', message: 'No such task.' };
    }
    const already = existing.completedAt !== null;
    if (already === input.done) {
      /* A double-submit of a checkbox is not an error and records nothing. */
      return { ok: true as const };
    }
    const now = new Date();
    await tx
      .update(adminTasks)
      .set(
        input.done
          ? { completedAt: now, completedBy: input.actorUserId }
          : { completedAt: null, completedBy: null },
      )
      .where(eq(adminTasks.id, input.taskId));
    await audit(tx as unknown as Database, {
      ...input,
      targetType: 'admin_task',
      targetId: input.taskId,
      action: input.done ? 'tasks.task_completed' : 'tasks.task_reopened',
      internalReason: input.done
        ? `Task "${existing.title}" marked done from the Tasks panel.`
        : `Task "${existing.title}" reopened from the Tasks panel.`,
      priorValue: { completed: already },
      newValue: { completed: input.done },
    });
    return { ok: true as const };
  });
}

export async function deleteTask(
  db: Database,
  input: AuditContext & { taskId: string },
): Promise<MutationOutcome> {
  if (!looksLikeId(input.taskId)) {
    return { ok: false, code: 'not_found', message: 'No such task.' };
  }
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(adminTasks)
      .where(eq(adminTasks.id, input.taskId))
      .for('update')
      .limit(1);
    if (!existing) return { ok: false as const, code: 'not_found', message: 'No such task.' };
    if (existing.deletedAt) {
      /* Already gone is the outcome the caller wanted. */
      return { ok: true as const };
    }
    const now = new Date();
    await tx
      .update(adminTasks)
      .set({ deletedAt: now, deletedBy: input.actorUserId })
      .where(eq(adminTasks.id, input.taskId));
    await audit(tx as unknown as Database, {
      ...input,
      targetType: 'admin_task',
      targetId: input.taskId,
      action: 'tasks.task_deleted',
      internalReason: `Task "${existing.title}" removed from the Tasks panel. The row survives — reads filter it out.`,
      priorValue: { deletedAt: null },
      newValue: { deletedAt: now.toISOString() },
    });
    return { ok: true as const };
  });
}
