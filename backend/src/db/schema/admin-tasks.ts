/**
 * The Admin Tasks panel — migration 0046, post-Phase-24 change, 2026-08-16.
 *
 * A private note an operator writes to themselves, pointed at the record it
 * belongs to. §26 does not name a task list and nothing here pretends it does;
 * what the schema is mostly made of is refusals, and the two loudest are
 * absences:
 *
 * ── There is no `assigned_to`, and there must never be one ──────────────────
 * Assignment already exists: `support_cases` carries an owner, a waiting
 * party, a due time, a four-fact handoff gate, and §27.8's published response
 * promise. A second way to hand work to a named person would be a second door
 * into rules that machinery encodes. If a task turns out to be work somebody
 * is owed, the answer is a support case, not a column here — the absence is
 * asserted against `information_schema` by test.
 *
 * ── There is no schedule-shaped column ──────────────────────────────────────
 * `due_on` is a bare DATE the author checks. §30 forbids automated engagement,
 * so there is no `remind_at`, `recurrence`, `next_send_at`, `snooze_until`,
 * `escalate_at`, `priority`, or `sla_*` — asserted absent by the same test —
 * no §27 key can carry "your task is due", and no job reads either table.
 * A `date` rather than a `timestamptz` because §27.1's timezone rule governs
 * deadlines the product promises to people; this is a day in the author's own
 * head, and an instant would imply a moment something fires.
 *
 * Deletion is soft (every list is shared; hard-deleting would destroy another
 * person's note with no record), completion records who, the reference triple
 * is all-or-nothing with the label stored at write time, and DELETE is revoked
 * from the app role on both tables. §25.8 names no retention window for
 * Admin-authored internal content — a genuine gap, recorded in the migration
 * header rather than filled (§1 rule 6).
 */

import { date, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth.js';

export const adminTaskLists = pgTable('admin_task_lists', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  /** Better Auth ids are text, not uuid. */
  createdBy: text('created_by')
    .notNull()
    .references(() => user.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  archivedBy: text('archived_by').references(() => user.id),
});

export const adminTasks = pgTable(
  'admin_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listId: uuid('list_id')
      .notNull()
      .references(() => adminTaskLists.id),
    title: text('title').notNull(),
    notes: text('notes'),
    /** A day the author checks, never an instant anything fires on (§30). */
    dueOn: date('due_on'),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    completedBy: text('completed_by').references(() => user.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: text('deleted_by').references(() => user.id),
    /** All-or-nothing with the two below, CHECK-pinned to the shared register. */
    refKind: text('ref_kind'),
    refId: text('ref_id'),
    /** Stored at write time so a later rename cannot rewrite what was written. */
    refLabel: text('ref_label'),
  },
  (t) => ({
    listIdx: index('admin_tasks_list_idx').on(t.listId, t.createdAt),
  }),
);

export type AdminTaskList = typeof adminTaskLists.$inferSelect;
export type AdminTask = typeof adminTasks.$inferSelect;
