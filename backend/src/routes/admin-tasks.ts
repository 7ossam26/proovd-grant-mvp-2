/**
 * Admin — the Tasks panel. Post-Phase-24 change, 2026-08-16. Spec §1.3, §25.6,
 * §26, §30, §33.12.5.
 *
 * ── What this is, honestly ──────────────────────────────────────────────────
 * §26 does not name a task list. This is a private note an operator writes to
 * themselves, pointed at the record it belongs to — none of the seven things
 * §1 rule 6 forbids inventing, and composed under §1 rule 2's licence. What
 * keeps it that way is what these routes refuse: no assignee (that is
 * `support_cases`, with its owner, due time, handoff gate, and §27.8 promise),
 * no notification, no job, and a due date that drives nothing here — the
 * server stores it as an opaque string and the surface renders the pill
 * against the viewer's own day.
 *
 * ── Which guard, and why not the freshness one ──────────────────────────────
 * `requireAdmin` on everything. `requireFreshSession` is deliberately absent:
 * writing down a note moves no money, changes no configuration, enforces
 * against nobody, and decides no customer outcome, and `admin.ts` has recorded
 * since Phase 06a that gating routine daily work is how the gate stops meaning
 * anything. Every write below is registered in §33.12.5's
 * `UNGATED_ADMIN_WRITES` with the sensitive property it lacks, and the
 * partition test walks this router with a two-day-old session in both
 * directions.
 *
 * ── The author is the session, never the body ───────────────────────────────
 * `actorUserId` comes from `req.authUser.id` — the `assignToSelf` precedent in
 * `admin-support.ts`. A body naming another user is ignored, asserted by test.
 */

import express, { Router, type RequestHandler } from 'express';
import type { Database } from '../db/client.js';
import type { Auth } from '../auth/auth.js';
import { requireAdmin } from '../auth/guards.js';
import {
  archiveTaskList,
  createTask,
  createTaskList,
  deleteTask,
  readTasksPanel,
  resolveTaskReference,
  searchTaskTargets,
  setTaskCompletion,
  updateTask,
  type MutationOutcome,
  type TaskReferenceInput,
} from '../tasks/service.js';
import { TASK_REFERENCE_KINDS, type TaskReferenceKind } from '../tasks/logic.js';

export const ADMIN_TASKS_PATH = '/api/admin/tasks';

export interface AdminTasksDeps {
  db: Database;
  auth: Auth;
}

function sendMutation(
  res: express.Response,
  result: MutationOutcome<Record<string, unknown>>,
  title: string,
): void {
  if (result.ok) {
    const { ok: _ok, ...rest } = result;
    res.status(200).json({ ok: true, ...rest });
    return;
  }
  res.status(result.code === 'not_found' ? 404 : 422).json({
    error: result.code,
    title,
    whatHappened: result.message,
    next: 'Nothing has changed. Correct it and try again.',
  });
}

export function createAdminTasksRouter({ db, auth }: AdminTasksDeps): Router {
  const router = Router();
  const admin = requireAdmin(auth);
  const json: RequestHandler = express.json({ limit: '64kb' });

  const actorOf = (req: express.Request) => ({
    actorUserId: req.authUser!.id,
    mfaContext: 'password_session_admin_role_verified',
    reauthContext: req.authSession
      ? `session_established_at=${req.authSession.createdAt.toISOString()}`
      : 'session_unavailable',
  });

  /* The whole panel in one read: every unarchived list, every undeleted task,
     references resolved. One request so the launcher's count and the rows it
     opens onto can never disagree. */
  router.get(ADMIN_TASKS_PATH, admin, async (_req, res) => {
    res.json(await readTasksPanel(db));
  });

  /* The reference picker: bounded, server-composed labels. `kind` must be one
     of the five registered kinds; anything else is a 400 rather than an empty
     list, because an unknown kind is a caller bug, not a search with no hits. */
  router.get(`${ADMIN_TASKS_PATH}/targets`, admin, async (req, res) => {
    const kind = typeof req.query['kind'] === 'string' ? req.query['kind'] : '';
    if (!TASK_REFERENCE_KINDS.includes(kind as TaskReferenceKind)) {
      res.status(400).json({
        error: 'unknown_reference_kind',
        title: 'That is not something a task can point at',
        whatHappened:
          'A task can point at a Founder, a Creator relationship, a campaign, a Backer, or a support case.',
        next: 'Choose one of the five kinds and search again.',
      });
      return;
    }
    /* With `id`, resolve exactly that record — the compose's "you are looking
       at X" strip and its preview line both need the label the server would
       store, and composing it in the browser would be a second label. */
    const id = typeof req.query['id'] === 'string' ? req.query['id'] : '';
    if (id) {
      const resolution = await resolveTaskReference(db, kind, id);
      res.json({ targets: resolution.ok ? [{ id, label: resolution.label }] : [] });
      return;
    }
    const q = typeof req.query['q'] === 'string' ? req.query['q'] : '';
    res.json({ targets: await searchTaskTargets(db, kind as TaskReferenceKind, q) });
  });

  router.post(`${ADMIN_TASKS_PATH}/lists`, admin, json, async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const result = await createTaskList(db, {
      ...actorOf(req),
      name: typeof body['name'] === 'string' ? body['name'] : '',
    });
    sendMutation(res, result, 'That list could not be created');
  });

  router.post(`${ADMIN_TASKS_PATH}/lists/:listId/archive`, admin, json, async (req, res) => {
    const result = await archiveTaskList(db, {
      ...actorOf(req),
      listId: String(req.params['listId']),
    });
    sendMutation(res, result, 'That list could not be archived');
  });

  router.post(ADMIN_TASKS_PATH, admin, json, async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const rawRef = body['reference'];
    let reference: TaskReferenceInput | undefined;
    if (rawRef && typeof rawRef === 'object') {
      const ref = rawRef as Record<string, unknown>;
      reference = {
        kind: typeof ref['kind'] === 'string' ? ref['kind'] : '',
        id: typeof ref['id'] === 'string' ? ref['id'] : '',
      };
    }
    const result = await createTask(db, {
      ...actorOf(req),
      listId: typeof body['listId'] === 'string' ? body['listId'] : '',
      title: typeof body['title'] === 'string' ? body['title'] : '',
      notes: typeof body['notes'] === 'string' ? body['notes'] : undefined,
      dueOn: typeof body['dueOn'] === 'string' ? body['dueOn'] : undefined,
      reference,
    });
    sendMutation(res, result, 'That task could not be created');
  });

  router.put(`${ADMIN_TASKS_PATH}/:taskId`, admin, json, async (req, res) => {
    const body = req.body as Record<string, unknown>;

    let reference: TaskReferenceInput | null | undefined;
    if ('reference' in body) {
      const rawRef = body['reference'];
      if (rawRef === null) {
        reference = null;
      } else if (rawRef && typeof rawRef === 'object') {
        const ref = rawRef as Record<string, unknown>;
        reference = {
          kind: typeof ref['kind'] === 'string' ? ref['kind'] : '',
          id: typeof ref['id'] === 'string' ? ref['id'] : '',
        };
      }
    }

    const result = await updateTask(db, {
      ...actorOf(req),
      taskId: String(req.params['taskId']),
      title: typeof body['title'] === 'string' ? body['title'] : undefined,
      notes:
        'notes' in body
          ? typeof body['notes'] === 'string'
            ? body['notes']
            : null
          : undefined,
      dueOn:
        'dueOn' in body
          ? typeof body['dueOn'] === 'string'
            ? body['dueOn']
            : null
          : undefined,
      listId: typeof body['listId'] === 'string' ? body['listId'] : undefined,
      reference,
    });
    sendMutation(res, result, 'That task could not be saved');
  });

  router.post(`${ADMIN_TASKS_PATH}/:taskId/complete`, admin, json, async (req, res) => {
    const result = await setTaskCompletion(db, {
      ...actorOf(req),
      taskId: String(req.params['taskId']),
      done: true,
    });
    sendMutation(res, result, 'That task could not be marked done');
  });

  router.post(`${ADMIN_TASKS_PATH}/:taskId/reopen`, admin, json, async (req, res) => {
    const result = await setTaskCompletion(db, {
      ...actorOf(req),
      taskId: String(req.params['taskId']),
      done: false,
    });
    sendMutation(res, result, 'That task could not be reopened');
  });

  /* Soft. The row survives with who removed it and when — on a shared list a
     hard delete would destroy another person's note with no record, which is
     why DELETE is also revoked from the app role at the database. */
  router.delete(`${ADMIN_TASKS_PATH}/:taskId`, admin, json, async (req, res) => {
    const result = await deleteTask(db, {
      ...actorOf(req),
      taskId: String(req.params['taskId']),
    });
    sendMutation(res, result, 'That task could not be removed');
  });

  return router;
}
