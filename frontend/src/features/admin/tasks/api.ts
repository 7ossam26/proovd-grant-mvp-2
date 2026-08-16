/**
 * The Tasks panel API client. Post-Phase-24 change, 2026-08-16.
 *
 * One rule, the same one `features/admin/api.ts` states: the server decides,
 * and its refusal is what the Admin reads. The author of every write is the
 * SESSION on the server — nothing here sends a user id, because a client that
 * could name the author could attribute a note to somebody else.
 *
 * The due date crosses this boundary as an opaque `YYYY-MM-DD` string in both
 * directions. The server never interprets it; the pill is computed by the one
 * surface that renders it, against the viewer's own day (§30 — a date you
 * check, not one that chases anybody).
 */

import type { TaskReferenceKind } from '@proovd/shared';
import { AdminRequestError, call } from '../api.js';

export { AdminRequestError };
export type { AdminError } from '../api.js';

/* ── The contract ───────────────────────────────────────────────────────────
   `backend/src/tasks/service.ts` is the authority; the two packages have
   separate build roots, so this mirrors it name for name. */

export interface TaskListView {
  id: string;
  name: string;
  createdBy: string;
  createdByName: string | null;
  openCount: number;
}

export interface TaskReferenceView {
  kind: TaskReferenceKind;
  kindLabel: string;
  id: string;
  /** The STORED label — what the author wrote down. */
  label: string;
  href: string | null;
  unavailableBecause: string | null;
}

export interface TaskView {
  id: string;
  listId: string;
  title: string;
  notes: string | null;
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

export interface TaskReferenceInput {
  kind: TaskReferenceKind;
  id: string;
}

export interface CreateTaskInput {
  listId: string;
  title: string;
  notes?: string;
  dueOn?: string;
  reference?: TaskReferenceInput;
}

export interface UpdateTaskInput {
  title?: string;
  notes?: string | null;
  dueOn?: string | null;
  listId?: string;
  reference?: TaskReferenceInput | null;
}

/* ── Reads ──────────────────────────────────────────────────────────────────*/

export async function fetchTasksPanel(): Promise<TasksPanelView> {
  return call<TasksPanelView>('/api/admin/tasks');
}

export async function searchTaskTargets(
  kind: TaskReferenceKind,
  q: string,
): Promise<TaskTargetOption[]> {
  const params = new URLSearchParams({ kind, q });
  const { targets } = await call<{ targets: TaskTargetOption[] }>(
    `/api/admin/tasks/targets?${params.toString()}`,
  );
  return targets;
}

/** The label the server would store for one specific record, or null. */
export async function resolveTaskTarget(
  kind: TaskReferenceKind,
  id: string,
): Promise<TaskTargetOption | null> {
  const params = new URLSearchParams({ kind, id });
  const { targets } = await call<{ targets: TaskTargetOption[] }>(
    `/api/admin/tasks/targets?${params.toString()}`,
  );
  return targets[0] ?? null;
}

/* ── Writes ─────────────────────────────────────────────────────────────────*/

export async function createTaskList(name: string): Promise<{ listId: string }> {
  return call<{ listId: string }>('/api/admin/tasks/lists', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export async function archiveTaskList(listId: string): Promise<void> {
  await call(`/api/admin/tasks/lists/${encodeURIComponent(listId)}/archive`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
}

export async function createTask(input: CreateTaskInput): Promise<{ taskId: string }> {
  return call<{ taskId: string }>('/api/admin/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function updateTask(taskId: string, input: UpdateTaskInput): Promise<void> {
  await call(`/api/admin/tasks/${encodeURIComponent(taskId)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function setTaskCompletion(taskId: string, done: boolean): Promise<void> {
  await call(`/api/admin/tasks/${encodeURIComponent(taskId)}/${done ? 'complete' : 'reopen'}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
}

export async function removeTask(taskId: string): Promise<void> {
  await call(`/api/admin/tasks/${encodeURIComponent(taskId)}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
}
