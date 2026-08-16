/**
 * The create/edit form. It COVERS the panel's own contents rather than opening
 * a second floating layer — one panel on screen at a time, never a popup
 * stacked on a popup (the reference's own arrangement, kept).
 *
 * ── The reference picker ────────────────────────────────────────────────────
 * Kind first, then the record, and changing the kind clears the narrower
 * choice beneath it — a target chosen under the old kind is a pointer at the
 * wrong table. The candidate list and every label come from the server: the
 * label the preview shows is the label the create will store, and composing a
 * second one in the browser is how the two would drift.
 *
 * ── The context strip is the fastest path, so it sits first ─────────────────
 * When the Admin is looking at a record page, the strip offers to point the
 * task at it in one press. The label is resolved server-side before it is
 * shown, because "You are looking at" followed by a guess is worse than
 * nothing.
 *
 * ── The due date field carries the pinned sentence ──────────────────────────
 * `TASK_DUE_DATE_IS_CHECKED` rides the control that sets the value (§30, DNA
 * §5.10) — the one place someone deciding whether to type a date is actually
 * looking.
 */

import { useEffect, useId, useRef, useState } from 'react';
import {
  TASK_DUE_DATE_IS_CHECKED,
  TASK_REFERENCE_KIND_LABELS,
  type TaskReferenceKind,
} from '@proovd/shared';
import { Button, Field, Input, Textarea, useButtonProgress } from '../../../components/index.js';
import {
  AdminRequestError,
  createTask,
  resolveTaskTarget,
  searchTaskTargets,
  updateTask,
  type TaskListView,
  type TaskTargetOption,
  type TaskView,
} from './api.js';
import { TASK_REFERENCE_KINDS, type PanelContext } from './shared.js';

interface TaskComposeProps {
  lists: TaskListView[];
  defaultListId: string;
  /** Null → creating. */
  editing: TaskView | null;
  /** What the Admin is looking at, from the address. */
  context: PanelContext | null;
  onSaved: () => void;
  onCancel: () => void;
}

export function TaskCompose({
  lists,
  defaultListId,
  editing,
  context,
  onSaved,
  onCancel,
}: TaskComposeProps) {
  const uid = useId();
  const [title, setTitle] = useState(editing?.title ?? '');
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [dueOn, setDueOn] = useState(editing?.dueOn ?? '');
  const [listId, setListId] = useState(editing?.listId ?? defaultListId);
  const [refKind, setRefKind] = useState<TaskReferenceKind | ''>(editing?.reference?.kind ?? '');
  const [refTarget, setRefTarget] = useState<TaskTargetOption | null>(
    editing?.reference ? { id: editing.reference.id, label: editing.reference.label } : null,
  );
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<TaskTargetOption[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [contextLabel, setContextLabel] = useState<string | null>(null);

  const primaryRef = useRef<HTMLButtonElement>(null);
  const withProgress = useButtonProgress();

  const titleId = `${uid}-title`;
  const focusTitle = () => document.getElementById(titleId)?.focus();

  useEffect(() => {
    focusTitle();
    // Mounted once per compose, so the initial focus runs once by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Resolve what the Admin is looking at, so the strip can say its name. A
     context that does not resolve renders no strip — a guess is not a strip. */
  useEffect(() => {
    if (!context) return;
    let cancelled = false;
    resolveTaskTarget(context.kind, context.id)
      .then((target) => {
        if (!cancelled && target) setContextLabel(target.label);
      })
      .catch(() => {
        /* No strip. The picker below still works. */
      });
    return () => {
      cancelled = true;
    };
  }, [context]);

  /* The candidate list for the chosen kind, re-read as the search narrows.
     Bounded server-side (12), like the `/` palette. */
  useEffect(() => {
    if (!refKind) {
      setOptions(null);
      return;
    }
    let cancelled = false;
    searchTaskTargets(refKind, query)
      .then((targets) => {
        if (!cancelled) setOptions(targets);
      })
      .catch(() => {
        if (!cancelled) setOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [refKind, query]);

  function chooseKind(next: string) {
    setRefKind(next as TaskReferenceKind | '');
    /* A new kind invalidates whatever record was chosen under the old one. */
    setRefTarget(null);
    setQuery('');
    setOptions(null);
  }

  function useCurrent() {
    if (!context || !contextLabel) return;
    setRefKind(context.kind);
    setRefTarget({ id: context.id, label: contextLabel });
    setQuery('');
  }

  async function save() {
    setFailure(null);
    if (!title.trim()) {
      setFailure('Give the task a title before saving it.');
      focusTitle();
      return;
    }

    const reference =
      refKind && refTarget ? { kind: refKind, id: refTarget.id } : null;

    const outcome: { refusal: string | null } = { refusal: null };
    await withProgress(primaryRef, async () => {
      try {
        if (editing) {
          await updateTask(editing.id, {
            title: title.trim(),
            notes: notes.trim() === '' ? null : notes.trim(),
            dueOn: dueOn === '' ? null : dueOn,
            listId,
            reference,
          });
        } else {
          await createTask({
            listId,
            title: title.trim(),
            ...(notes.trim() ? { notes: notes.trim() } : {}),
            ...(dueOn ? { dueOn } : {}),
            ...(reference ? { reference } : {}),
          });
        }
      } catch (error) {
        outcome.refusal =
          error instanceof AdminRequestError
            ? [error.detail.title, error.detail.whatHappened, error.detail.next]
                .filter(Boolean)
                .join(' ')
            : 'Nothing was saved, and it is not certain why. Close this and reopen the panel to see what is stored before trying again.';
      }
    });

    if (outcome.refusal !== null) {
      setFailure(outcome.refusal);
      return;
    }
    onSaved();
  }

  const showStrip = context !== null && contextLabel !== null;

  return (
    <div className="tsk-compose">
      <div className="tsk-head">
        <h3 className="tsk-head__title">{editing ? 'Edit task' : 'Create task'}</h3>
        <button
          type="button"
          className="tsk-x"
          onClick={onCancel}
          aria-label="Back to tasks"
        >
          ×
        </button>
      </div>

      <div className="tsk-body tsk-body--form">
        {failure ? (
          <p className="tsk-err" role="alert">
            {failure}
          </p>
        ) : null}

        {showStrip ? (
          <div className="tsk-now">
            <p className="tsk-now__text">
              You are looking at <b>{contextLabel}</b>
            </p>
            <Button tier="secondary" small onClick={useCurrent}>
              Use this
            </Button>
          </div>
        ) : null}

        <Field id={titleId} label="Task">
          <Input
            value={title}
            placeholder="What needs doing"
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>

        <Field id={`${uid}-notes`} label="Notes (optional)">
          <Textarea
            rows={3}
            value={notes}
            placeholder="Any detail worth keeping with the task"
            onChange={(event) => setNotes(event.target.value)}
          />
        </Field>

        <Field id={`${uid}-due`} label="Due date (optional)" hint={TASK_DUE_DATE_IS_CHECKED}>
          <Input
            type="date"
            value={dueOn}
            onChange={(event) => setDueOn(event.target.value)}
          />
        </Field>

        <Field id={`${uid}-list`} label="List">
          <select
            className="input"
            value={listId}
            onChange={(event) => setListId(event.target.value)}
          >
            {lists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.name}
              </option>
            ))}
          </select>
        </Field>

        <fieldset className="tsk-refbox">
          <legend className="tsk-refbox__legend">Points at (optional)</legend>

          <Field id={`${uid}-kind`} label="Kind">
            <select
              className="input"
              value={refKind}
              onChange={(event) => chooseKind(event.target.value)}
            >
              <option value="">Nothing specific</option>
              {TASK_REFERENCE_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {TASK_REFERENCE_KIND_LABELS[kind]}
                </option>
              ))}
            </select>
          </Field>

          {refKind ? (
            <>
              <Field id={`${uid}-target-search`} label={`Find the ${TASK_REFERENCE_KIND_LABELS[refKind].toLowerCase()}`}>
                <Input
                  value={query}
                  placeholder="Type to narrow the list"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </Field>
              {options === null ? (
                <p className="helper">Loading the list…</p>
              ) : options.length === 0 ? (
                <p className="helper">Nothing matches. The list shows at most twelve — keep typing to narrow it.</p>
              ) : (
                <ul className="tsk-targets" aria-label="Matching records">
                  {options.map((option) => (
                    <li key={option.id}>
                      <button
                        type="button"
                        className={
                          refTarget?.id === option.id
                            ? 'tsk-target is-chosen'
                            : 'tsk-target'
                        }
                        aria-pressed={refTarget?.id === option.id}
                        onClick={() => setRefTarget(option)}
                      >
                        {option.label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : null}

          {refKind && refTarget ? (
            <p className="tsk-refpreview">
              This task will point at <b>{refTarget.label}</b>
            </p>
          ) : null}
        </fieldset>
      </div>

      <div className="tsk-foot">
        <button
          ref={primaryRef}
          type="button"
          className="btn btn--primary tsk-primary"
          onClick={() => void save()}
        >
          <span className="btn__label">{editing ? 'Save task' : 'Create task'}</span>
        </button>
        <Button tier="tertiary" onClick={onCancel}>
          Back
        </Button>
      </div>
    </div>
  );
}
