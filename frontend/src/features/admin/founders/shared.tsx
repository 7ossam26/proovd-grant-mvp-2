/**
 * The pieces the five Founder-workspace panes share.
 *
 * ── Why these are components rather than four `kv()` string builders ────────
 * The reference builds its rows by concatenating HTML, which is how a `<dt>`
 * ends up outside a `<dl>` and nobody notices until a screen reader reads an
 * orphaned term (§33.11.2 found exactly that defect three times in Phase 23a).
 * A `Group`/`Row` pair makes the `dl` mandatory by construction: a row cannot
 * be rendered without something to put it in.
 *
 * ── Two words for absence, and the difference is load-bearing ───────────────
 * `NOT_PROVIDED` is what a *profile* field says when nobody has typed it in —
 * the reference's own phrase, and the one an Admin is about to go and fill.
 * `ABSENT` is what a *derived* fact says when the product has not reached the
 * point of knowing it: a close date before the campaign is scheduled, a
 * provider timestamp before the account exists. Collapsing them would tell an
 * Admin to go and enter a value that no form accepts (§1.4, and §16a's rule
 * that not-yet-populated is never zero).
 *
 * Nothing here decides anything. Every value on this surface arrives resolved
 * from the server (`backend/src/founders/types.ts`), so a pane composes rows
 * and never derives a fact — which is what keeps §26.2's `prior_value`
 * meaningful, because a number the browser worked out has no before.
 */

import { useCallback, type ReactNode } from 'react';
import { PARKED_MESSAGES, type ParkedKey } from '@proovd/shared';
import { Accordion, Button, useToast } from '../../../components/index.js';
import { cn } from '../../../components/cn.js';
import type { ConfirmKey } from './dialogs/confirms.js';

/* ── What a pane may ask the workspace to do ────────────────────────────────*/

/** The field an Edit control names, resolved for the dialog. */
export interface FieldEditRequest {
  /** A `FOUNDER_EDITABLE_FIELDS` key. */
  key: string;
  label: string;
  value: string | null;
  helper?: string | null;
}

/**
 * The four things a pane can start.
 *
 * Every one of them ends at the server and then at a re-read — a pane never
 * writes into the payload it was handed, because a locally-edited copy is a
 * claim about an outcome nobody confirmed.
 *
 * `trigger` is the element that was pressed. It travels because a dialog grows
 * from what opened it (DNA §6.5), and a panel that appeared from nowhere is the
 * one motion this design system refuses.
 */
/** A §9 setup answer an Admin may still prefill (Problem or Solution). */
export interface AnswerEditRequest {
  draftId: string;
  key: 'problem' | 'solution';
  label: string;
  text: string | null;
}

export interface WorkspaceActions {
  confirm: (key: ConfirmKey, trigger: HTMLElement | null) => void;
  editField: (target: FieldEditRequest, trigger: HTMLElement | null) => void;
  /** §9's prefill: only offered while the server said the answer is editable. */
  editAnswer: (target: AnswerEditRequest, trigger: HTMLElement | null) => void;
  previewInvitation: (trigger: HTMLElement | null) => void;
  setOverride: (key: string, value: string) => Promise<void>;
  clearOverride: (key: string) => Promise<void>;
  /** The simplified flow: Admin sets Idea/Product on the unsubmitted draft. */
  setCampaignPath: (draftId: string, path: 'pre_build' | 'pre_launch') => Promise<void>;
}

/** A profile value nobody has supplied yet. The reference's own phrase. */
export const NOT_PROVIDED = 'Not provided yet';

/** A derived fact the product cannot know yet. Never rendered as a zero. */
export const ABSENT = 'Not recorded yet';

/* ── Section scaffolding ────────────────────────────────────────────────────*/

/**
 * A pane's section heading.
 *
 * `h2` rather than the reference's `h3`: here the Founder's legal name is the
 * page `h1`, so a section under it is the second level. `tabIndex={-1}` on the
 * anchored ones is what makes the header's attention jump work for a keyboard
 * user — scrolling moves the viewport and leaves focus where it was, which
 * lands somebody on a section they cannot read from (§28.5).
 */
export function SecTitle({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 className="fsec__title" id={id} tabIndex={id ? -1 : undefined}>
      {children}
    </h2>
  );
}

/** The definition list every `Row` must sit inside. */
export function Group({ children }: { children: ReactNode }) {
  return <dl className="fgroup">{children}</dl>;
}

/** One label/value row, with the optional quiet line beneath the value. */
export function Row({
  label,
  children,
  helper,
  valueClass,
}: {
  label: ReactNode;
  children: ReactNode;
  helper?: ReactNode;
  valueClass?: string;
}) {
  return (
    <div className="frow">
      <dt>{label}</dt>
      <dd className={valueClass}>
        {children}
        {helper ? <p className="helper">{helper}</p> : null}
      </dd>
    </div>
  );
}

/** A quiet line. */
export function Note({ children }: { children: ReactNode }) {
  return <p className="helper">{children}</p>;
}

/** An absent value, rendered as its own state rather than as a blank. */
export function Missing({ children = ABSENT }: { children?: ReactNode }) {
  return <span className="grey">{children}</span>;
}

/**
 * One disclosure, behind one gesture (DNA §5.14).
 *
 * The shared `Accordion` carries Radix's `aria-expanded`, its region
 * labelling, and the GSAP height morph, so nothing here re-implements a
 * disclosure — and its head is already an `h3`, which is the right level under
 * a section's `h2`.
 */
export function Expandable({
  label,
  small,
  children,
}: {
  label: string;
  small?: boolean;
  children: ReactNode;
}) {
  return (
    <Accordion
      items={[
        {
          value: 'body',
          head: <span className={small ? 'xp--sm' : undefined}>{label}</span>,
          body: children,
        },
      ]}
    />
  );
}

/* ── Editing ────────────────────────────────────────────────────────────────*/

/**
 * A value with the one control that changes it.
 *
 * The visible label stays the reference's compact `Edit`; the accessible name
 * says which field, because a screen-reader user meeting fourteen buttons all
 * called "Edit" has been told nothing (§33.11.4).
 */
export function EditRow({
  label,
  value,
  helper,
  emptyLabel = NOT_PROVIDED,
  onEdit,
}: {
  label: string;
  value: string | null;
  helper?: ReactNode;
  emptyLabel?: string;
  /** Receives the pressed control, so the dialog grows from it (DNA §6.5). */
  onEdit: (trigger: HTMLElement | null) => void;
}) {
  return (
    <div className="frow">
      <dt>{label}</dt>
      <dd>
        {value && value !== NOT_PROVIDED ? (
          <span className="fval">{value}</span>
        ) : (
          <Missing>{emptyLabel}</Missing>
        )}
        <Button
          tier="secondary"
          small
          className="btn--edit"
          aria-label={`Edit ${label}`}
          onClick={(event) => onEdit(event.currentTarget)}
        >
          Edit
        </Button>
        {helper ? <p className="helper">{helper}</p> : null}
      </dd>
    </div>
  );
}

/* ── Attention ──────────────────────────────────────────────────────────────*/

/** The accent-yellow box. Reserved for a real issue — never for information. */
export function AttentionBox({
  chip,
  children,
}: {
  chip: string;
  children: ReactNode;
}) {
  return (
    <div className="att-box">
      <span className="att-chip">{chip}</span>
      {children}
    </div>
  );
}

/* ── Timeline ───────────────────────────────────────────────────────────────*/

export function Timeline({ children }: { children: ReactNode }) {
  return <div className="tl">{children}</div>;
}

export function TimelineRow({
  at,
  title,
  body,
  children,
}: {
  at: string;
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <div className="tl-row">
      <time>{at}</time>
      <div>
        <p>
          <b>{title}</b>
          <br />
          <span className="grey">{body}</span>
        </p>
        {children}
      </div>
    </div>
  );
}

/* ── Parked destinations (§1.4) ─────────────────────────────────────────────*/

/**
 * The toast a control raises when its destination has not been built.
 *
 * The message comes from the shared register, never from the call site: §1.4
 * asks a parked control to say what the destination IS, and a sentence written
 * at each button is a sentence that will disagree with the next one. There is
 * deliberately no way to pass free text here.
 */
export function useParkedToast(): (key: ParkedKey) => void {
  const toast = useToast();
  return useCallback(
    (key: ParkedKey) => {
      toast(PARKED_MESSAGES[key]);
    },
    [toast],
  );
}

export function ParkedButton({
  parkedKey,
  tier = 'secondary',
  small,
  children,
}: {
  parkedKey: ParkedKey;
  tier?: 'primary' | 'secondary' | 'tertiary';
  small?: boolean;
  children: ReactNode;
}) {
  const parked = useParkedToast();
  return (
    <Button tier={tier} small={small} onClick={() => parked(parkedKey)}>
      {children}
    </Button>
  );
}

/* ── Small shapes the panes repeat ──────────────────────────────────────────*/

/** The row of actions under a section. */
export function Actions({ children }: { children: ReactNode }) {
  return <div className="case-actions">{children}</div>;
}

/** One campaign, payment, or listing block. */
export function Block({ children }: { children: ReactNode }) {
  return <div className="camp-block">{children}</div>;
}

/** The heavy line a section leads with — a status word, not a sentence. */
export function Headline({ children }: { children: ReactNode }) {
  return (
    <p className="inv-status__v">
      <b>{children}</b>
    </p>
  );
}

/** The setup checklist. A real list, so its length is announced. */
export function Checklist({ children }: { children: ReactNode }) {
  return (
    <div className="checklist" role="list">
      {children}
    </div>
  );
}

/**
 * One checklist line, done or still ahead.
 *
 * Done-ness is a tick that is present or absent — a shape, never the mark's
 * colour alone — and the row carries its own accessible name so a screen
 * reader hears the state rather than inferring it from a decorative square
 * (§33.11.2; the same reason the mark is `aria-hidden`).
 */
export function CheckLine({ label, done }: { label: string; done: boolean }) {
  return (
    <div
      className="check-line"
      role="listitem"
      aria-label={`${label} — ${done ? 'done' : 'not done yet'}`}
    >
      <span
        className={cn('phase__mark', done ? 'phase__mark--done' : 'phase__mark--next')}
        aria-hidden="true"
      >
        {done ? (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <polyline points="4 13 10 19 20 6" />
          </svg>
        ) : null}
      </span>
      <span className={done ? undefined : 'grey'}>{label}</span>
    </div>
  );
}
