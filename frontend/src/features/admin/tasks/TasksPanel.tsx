/**
 * The Admin Tasks panel — a floating popup, in the spirit of the Google Tasks
 * panel. Post-Phase-24 change, 2026-08-16. Spec §1.1, §27.1, §28.5, §30; DNA
 * §5.2, §5.4, §5.6, §5.10.
 *
 * ── What this is, and what it refuses to be ─────────────────────────────────
 * A place an Admin writes down what they need to do, points it at the record
 * it belongs to, and comes back to it from anywhere in the Admin panel —
 * without the product ever chasing them about it. Nobody is assigned, nothing
 * is scheduled, and no message is sent. The due date drives the pill and the
 * optional sort, both computed HERE against the viewer's own day; the server
 * never interprets the value at all.
 *
 * ── The launcher's open-count badge is DNA §5.4, not its opposite ───────────
 * §5.4 asks for finite, countable units "with the count visibly going down.
 * Zero means the session is over." A count of tasks the Admin wrote
 * themselves, going to zero, is that pattern. What §5.4 forbids is
 * MANUFACTURING items to extend a session, and nothing here can manufacture
 * one — every row has a `created_by` who is a person.
 *
 * ── Focus, deliberately not a trap ──────────────────────────────────────────
 * Focus moves into the panel on open and returns to the launcher on close,
 * and Escape closes — compose first, then the panel. It is NOT a focus trap:
 * the panel is non-modal and does not block the page, and trapping focus in a
 * thing that is not blocking anything strands keyboard users (§28.5).
 *
 * ── The shortcut ────────────────────────────────────────────────────────────
 * Ctrl/Cmd+Shift+U. The reference bound Cmd/Ctrl+Shift+T, which is "reopen
 * closed tab" in every major browser; U is unbound in Chrome, Firefox, Edge,
 * and Safari (view-source is plain Ctrl+U). Suppressed while typing — the
 * `CreatorSearch` guard — because a shortcut typed into the notes field that
 * opens a panel and eats the keystroke is a trap, not a shortcut.
 *
 * ── The deep link ───────────────────────────────────────────────────────────
 * Tasks is a panel, not an address, so the Campaigns record links here as
 * `?tasks=new` on its own address: the panel reads the parameter, opens
 * compose, and offers the campaign as the reference. The parameter is a real
 * position (DNA §5.12) — reloading it reopens the same compose.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Button, StatePanel } from '../../../components/index.js';
import { supportMailto } from '../../public/states.js';
import { ConfirmDialog } from '../founders/dialogs/ConfirmDialog.js';
import {
  AdminRequestError,
  archiveTaskList,
  createTaskList,
  fetchTasksPanel,
  removeTask,
  setTaskCompletion,
  type TasksPanelView,
  type TaskView,
} from './api.js';
import { contextFromPathname, DuePill, ReferenceChip, viewerToday } from './shared.js';
import { TaskCompose } from './TaskCompose.js';

type PanelData =
  | { status: 'loading' }
  | { status: 'ready'; view: TasksPanelView }
  | { status: 'failed'; title: string; whatHappened: string; next: string };

type ComposeState = { editing: TaskView | null } | null;

type Dialog =
  | { kind: 'new_list'; trigger: HTMLElement | null }
  | { kind: 'archive_list'; listId: string; name: string; trigger: HTMLElement | null }
  | { kind: 'delete_task'; task: TaskView; trigger: HTMLElement | null }
  | null;

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  const tag = el?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || Boolean(el?.isContentEditable);
}

export function TasksPanel() {
  const location = useLocation();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [data, setData] = useState<PanelData>({ status: 'loading' });
  const [compose, setCompose] = useState<ComposeState>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [sort, setSort] = useState<'new' | 'due'>('new');

  const launcherRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  /* Set while a close is caused by following a reference link — focus should
     land where the Admin is going, not back on the launcher. */
  const suppressRestore = useRef(false);
  /* The launcher is `hidden` while the panel is open, and a hidden element
     cannot take focus — so the restore waits for the commit that reveals it. */
  const restorePending = useRef(false);

  const load = useCallback(async () => {
    try {
      const view = await fetchTasksPanel();
      setData({ status: 'ready', view });
      setActiveListId((current) => {
        if (current && view.lists.some((l) => l.id === current)) return current;
        return view.lists[0]?.id ?? null;
      });
    } catch (error) {
      const detail = error instanceof AdminRequestError ? error.detail : null;
      setData({
        status: 'failed',
        title: detail?.title ?? 'Your tasks could not be loaded',
        whatHappened:
          detail?.whatHappened ??
          'The request that loads the Tasks panel did not come back. Nothing you wrote has been changed.',
        next: detail?.next ?? 'Try again. If it keeps happening, contact support.',
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openPanel = useCallback((withCompose: boolean) => {
    setOpen(true);
    if (withCompose) setCompose({ editing: null });
  }, []);

  const closePanel = useCallback(() => {
    setOpen(false);
    setCompose(null);
    setDialog(null);
    if (suppressRestore.current) {
      suppressRestore.current = false;
    } else {
      restorePending.current = true;
    }
  }, []);

  /* Focus returns to the launcher on close (§28.5), after the commit that
     un-hides it. */
  useEffect(() => {
    if (!open && restorePending.current) {
      restorePending.current = false;
      launcherRef.current?.focus();
    }
  }, [open]);

  /* The `?tasks=new` deep link. `location.key` changes on every navigation, so
     following the link a second time reopens the compose a second time. */
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('tasks') === 'new') {
      openPanel(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  /* Focus enters the panel on open (§28.5). */
  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  /* Escape — compose first, then the panel — and the toggle shortcut. */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && open && !dialog) {
        if (compose) {
          setCompose(null);
          closeRef.current?.focus();
        } else {
          closePanel();
        }
        return;
      }
      if (
        event.key.toLowerCase() === 'u' &&
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey
      ) {
        if (isTypingTarget(event.target)) return;
        event.preventDefault();
        if (open) closePanel();
        else openPanel(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, compose, dialog, closePanel, openPanel]);

  const view = data.status === 'ready' ? data.view : null;
  const openCount = view ? view.tasks.filter((t) => !t.completed).length : 0;
  const { today } = viewerToday();
  const overdueCount = view
    ? view.tasks.filter((t) => !t.completed && t.dueOn !== null && t.dueOn < today).length
    : 0;

  const activeList = view?.lists.find((l) => l.id === activeListId) ?? null;

  const visible = useMemo(() => {
    if (!view || !activeListId) return [];
    let tasks = view.tasks.filter((t) => t.listId === activeListId);
    if (!showDone) tasks = tasks.filter((t) => !t.completed);
    const openFirst = (a: TaskView, b: TaskView) =>
      a.completed === b.completed ? 0 : a.completed ? 1 : -1;
    if (sort === 'due') {
      tasks = [...tasks].sort((a, b) => {
        const split = openFirst(a, b);
        if (split !== 0) return split;
        if (!a.dueOn && !b.dueOn) return b.createdAt.localeCompare(a.createdAt);
        if (!a.dueOn) return 1;
        if (!b.dueOn) return -1;
        return a.dueOn.localeCompare(b.dueOn);
      });
    } else {
      tasks = [...tasks].sort((a, b) => {
        const split = openFirst(a, b);
        return split !== 0 ? split : b.createdAt.localeCompare(a.createdAt);
      });
    }
    return tasks;
  }, [view, activeListId, showDone, sort]);

  const doneCountInList = view
    ? view.tasks.filter((t) => t.listId === activeListId && t.completed).length
    : 0;

  const context = contextFromPathname(location.pathname);

  async function toggleTask(task: TaskView, done: boolean) {
    try {
      await setTaskCompletion(task.id, done);
    } catch {
      /* The re-read below renders the stored truth either way. */
    }
    await load();
  }

  function composeClosed() {
    setCompose(null);
    closeRef.current?.focus();
    /* Leaving `?tasks=new` behind would reopen compose on the next render of
       the same location; the address without it is the honest position now. */
    const params = new URLSearchParams(location.search);
    if (params.get('tasks') === 'new') {
      params.delete('tasks');
      const qs = params.toString();
      navigate(`${location.pathname}${qs ? `?${qs}` : ''}`, { replace: true });
    }
  }

  /* ── The launcher ────────────────────────────────────────────────────────*/

  const launcher = (
    <button
      ref={launcherRef}
      type="button"
      className="tsk-launch"
      hidden={open}
      onClick={() => openPanel(false)}
      title={
        overdueCount > 0
          ? `${overdueCount} task${overdueCount === 1 ? ' is' : 's are'} overdue`
          : `${openCount} open task${openCount === 1 ? '' : 's'}`
      }
    >
      Tasks
      {openCount > 0 ? (
        <span className={overdueCount > 0 ? 'tsk-badge tsk-badge--over' : 'tsk-badge'}>
          {openCount}
        </span>
      ) : null}
    </button>
  );

  if (!open) return launcher;

  /* ── The panel ───────────────────────────────────────────────────────────*/

  return (
    <>
      {launcher}
      <aside className="tsk-panel" aria-label="Tasks">
        <div className="tsk-head">
          <h2 className="tsk-head__title">Tasks</h2>
          <button
            ref={closeRef}
            type="button"
            className="tsk-x"
            onClick={closePanel}
            aria-label="Close tasks"
          >
            ×
          </button>
        </div>

        {data.status === 'loading' ? (
          <div className="tsk-state">
            <StatePanel
              state="Opening your tasks"
              whatHappened="Proovd is reading the team's lists and tasks."
              next="They appear as soon as that comes back."
              owner="Proovd"
              nextUpdate="Within a few seconds"
              action="No action needed"
              reference="Tasks panel"
            />
          </div>
        ) : data.status === 'failed' ? (
          <div className="tsk-state">
            <StatePanel
              state={data.title}
              whatHappened={data.whatHappened}
              next={data.next}
              owner="Proovd"
              nextUpdate="When you try again"
              action={
                <Button tier="primary" onClick={() => void load()}>
                  Try again
                </Button>
              }
              reference="Tasks panel"
              getHelp={{ href: supportMailto('The Tasks panel will not load') }}
              ring
            />
          </div>
        ) : view!.lists.length === 0 ? (
          <div className="tsk-state">
            <StatePanel
              state="No lists yet"
              whatHappened="Nobody on the team has created a task list. Every list here is shared — every Admin sees every list."
              next="Create the first list, then write tasks into it."
              owner="You"
              nextUpdate="When you create one"
              action={
                <Button
                  tier="primary"
                  onClick={(event) =>
                    setDialog({ kind: 'new_list', trigger: event.currentTarget })
                  }
                >
                  New list
                </Button>
              }
              reference="Tasks panel"
            />
          </div>
        ) : compose ? (
          <TaskCompose
            lists={view!.lists}
            defaultListId={activeListId ?? view!.lists[0]!.id}
            editing={compose.editing}
            context={context}
            onSaved={() => {
              composeClosed();
              void load();
            }}
            onCancel={composeClosed}
          />
        ) : (
          <>
            <nav className="tsk-lists" aria-label="Task lists">
              {view!.lists.map((list) => (
                <button
                  key={list.id}
                  type="button"
                  className={list.id === activeListId ? 'tsk-listbtn is-on' : 'tsk-listbtn'}
                  aria-pressed={list.id === activeListId}
                  onClick={() => setActiveListId(list.id)}
                >
                  {list.name}
                  {list.openCount > 0 ? ` · ${list.openCount}` : ''}
                </button>
              ))}
              <button
                type="button"
                className="tsk-listbtn tsk-listbtn--add"
                onClick={(event) => setDialog({ kind: 'new_list', trigger: event.currentTarget })}
              >
                + New list
              </button>
            </nav>

            <div className="tsk-bar">
              <label className="tsk-bar__sort">
                <span className="sr-only">Order</span>
                <select
                  className="input"
                  value={sort}
                  onChange={(event) => setSort(event.target.value as 'new' | 'due')}
                >
                  <option value="new">Newest first</option>
                  <option value="due">By due date</option>
                </select>
              </label>
              <label className="tsk-bar__done">
                <input
                  type="checkbox"
                  checked={showDone}
                  onChange={(event) => setShowDone(event.target.checked)}
                />
                Show completed
              </label>
              {activeList ? (
                <button
                  type="button"
                  className="tsk-mini"
                  onClick={(event) =>
                    setDialog({
                      kind: 'archive_list',
                      listId: activeList.id,
                      name: activeList.name,
                      trigger: event.currentTarget,
                    })
                  }
                >
                  Archive list
                </button>
              ) : null}
            </div>

            <div className="tsk-body">
              {visible.length === 0 ? (
                <p className="tsk-empty">
                  {doneCountInList > 0 && !showDone ? (
                    <>
                      Nothing open in this list. {doneCountInList} completed{' '}
                      {doneCountInList === 1 ? 'task is' : 'tasks are'} hidden — turn on{' '}
                      <b>Show completed</b> to see them.
                    </>
                  ) : (
                    <>
                      No tasks in this list yet. Use <b>Create task</b> to add one and point
                      it at a Founder, a Creator, a campaign, a Backer, or a case.
                    </>
                  )}
                </p>
              ) : (
                <ul className="tsk-items">
                  {visible.map((task, index) => {
                    const firstDone =
                      task.completed && (index === 0 || !visible[index - 1]!.completed);
                    return (
                      <li key={task.id}>
                        {firstDone ? <p className="tsk-sechead">Completed</p> : null}
                        <div className={task.completed ? 'tsk-item is-done' : 'tsk-item'}>
                          <input
                            type="checkbox"
                            className="tsk-check"
                            checked={task.completed}
                            aria-label={`Mark ${task.title}`}
                            onChange={(event) => void toggleTask(task, event.target.checked)}
                          />
                          <div className="tsk-item__body">
                            <p className="tsk-item__title">{task.title}</p>
                            {task.notes ? <p className="tsk-item__notes">{task.notes}</p> : null}
                            <p className="tsk-item__who helper">
                              Written by {task.createdByName ?? 'an Admin'}
                              {task.completed && task.completedByName
                                ? ` · done by ${task.completedByName}`
                                : ''}
                            </p>
                            <div className="tsk-item__meta">
                              {task.reference ? (
                                <ReferenceChip
                                  reference={task.reference}
                                  onNavigate={() => {
                                    suppressRestore.current = true;
                                    closePanel();
                                  }}
                                />
                              ) : null}
                              {task.dueOn ? <DuePill dueOn={task.dueOn} /> : null}
                              <span className="tsk-item__acts">
                                <button
                                  type="button"
                                  className="tsk-mini"
                                  onClick={() => setCompose({ editing: task })}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  className="tsk-mini"
                                  onClick={(event) =>
                                    setDialog({
                                      kind: 'delete_task',
                                      task,
                                      trigger: event.currentTarget,
                                    })
                                  }
                                >
                                  Remove
                                </button>
                              </span>
                            </div>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="tsk-foot">
              <button
                type="button"
                className="btn btn--primary tsk-primary"
                onClick={() => setCompose({ editing: null })}
              >
                <span className="btn__label">+ Create task</span>
              </button>
            </div>
          </>
        )}
      </aside>

      {dialog?.kind === 'new_list' ? (
        <ConfirmDialog
          spec={{
            kicker: 'Tasks',
            title: 'New list',
            body: 'Every list is shared — every Admin sees every list, with who wrote each task.',
            fields: [{ id: 'name', label: 'List name', required: true }],
            primary: 'Create list',
          }}
          trigger={dialog.trigger}
          onSubmit={async (values) => {
            await createTaskList(values['name'] ?? '');
            await load();
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog?.kind === 'archive_list' ? (
        <ConfirmDialog
          spec={{
            kicker: 'Tasks',
            title: `Archive "${dialog.name}"`,
            body: 'Archiving hides the list from the panel. Its rows survive, the archive records who and when, and a list that still has open tasks refuses — complete or move them first.',
            fields: [],
            primary: 'Archive list',
          }}
          trigger={dialog.trigger}
          onSubmit={async () => {
            await archiveTaskList(dialog.listId);
            await load();
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog?.kind === 'delete_task' ? (
        <ConfirmDialog
          spec={{
            kicker: 'Tasks',
            title: `Remove "${dialog.task.title}"`,
            body: 'It disappears from every Admin’s panel. The record survives with who removed it and when — on a shared list, nothing is destroyed outright.',
            fields: [],
            primary: 'Remove task',
          }}
          trigger={dialog.trigger}
          onSubmit={async () => {
            await removeTask(dialog.task.id);
            await load();
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </>
  );
}
