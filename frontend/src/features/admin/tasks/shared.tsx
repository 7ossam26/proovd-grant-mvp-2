/**
 * Small pieces the Tasks panel and its compose form share.
 *
 * The due pill is THE one consumer of the stored date in the whole product:
 * `taskDueStateFor` / `taskDueLabel` are computed here against the viewer's
 * own calendar day, and nothing server-side reads the value at all. That is
 * the strongest available form of "the date drives exactly two things" (§30) —
 * the second thing being the panel's optional by-due-date sort, which orders
 * the same strings without interpreting them.
 */

import { Link as RouterLink } from 'react-router';
import {
  TASK_REFERENCE_KINDS,
  taskDueLabel,
  taskDueStateFor,
  type TaskReferenceKind,
} from '@proovd/shared';
import type { TaskReferenceView } from './api.js';

/* ── The viewer's own day ───────────────────────────────────────────────────*/

function isoDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Local, deliberately: the pill answers "is this late for ME, today". */
export function viewerToday(): { today: string; tomorrow: string } {
  const now = new Date();
  const next = new Date(now);
  next.setDate(now.getDate() + 1);
  return { today: isoDay(now), tomorrow: isoDay(next) };
}

/* ── The due pill ───────────────────────────────────────────────────────────*/

export function DuePill({ dueOn }: { dueOn: string }) {
  const { today, tomorrow } = viewerToday();
  const state = taskDueStateFor(dueOn, today);
  return (
    <span className={`tsk-due tsk-due--${state}`}>{taskDueLabel(dueOn, today, tomorrow)}</span>
  );
}

/* ── The reference chip ─────────────────────────────────────────────────────
   The reference bundle's own rule, kept: a reference with nothing to navigate
   to is a label, not a dead button. The label is always the STORED one; only
   the destination is the server's fresh answer. */

export function ReferenceChip({
  reference,
  onNavigate,
}: {
  reference: TaskReferenceView;
  onNavigate?: (() => void) | undefined;
}) {
  if (!reference.href) {
    return (
      <span className="tsk-ref tsk-ref--label" title={reference.unavailableBecause ?? undefined}>
        <span className="tsk-ref__text">{reference.label}</span>
        {reference.unavailableBecause ? (
          <span className="helper tsk-ref__why">{reference.unavailableBecause}</span>
        ) : null}
      </span>
    );
  }
  return (
    <RouterLink
      className="tsk-ref"
      to={reference.href}
      onClick={onNavigate}
      title={`Open ${reference.label}`}
    >
      <span aria-hidden="true">↗</span>
      <span className="tsk-ref__text">{reference.label}</span>
    </RouterLink>
  );
}

/* ── What the Admin is looking at right now ─────────────────────────────────
   Derived from the ADDRESS, because the address is the one thing every
   workspace already maintains. Only record pages produce a context — a
   directory is not "looking at" anything in particular. */

export interface PanelContext {
  kind: TaskReferenceKind;
  id: string;
}

export function contextFromPathname(pathname: string): PanelContext | null {
  const founder = /^\/admin\/founders\/([^/]+)$/.exec(pathname);
  if (founder) return { kind: 'founder', id: founder[1]! };

  const relationship = /^\/admin\/creators\/[^/]+\/relationships\/([^/]+)$/.exec(pathname);
  if (relationship) return { kind: 'creator_relationship', id: relationship[1]! };

  const campaign = /^\/admin\/campaigns\/([^/]+)$/.exec(pathname);
  if (campaign) return { kind: 'campaign', id: campaign[1]! };

  const supportCase = /^\/admin\/support\/([^/]+)$/.exec(pathname);
  if (supportCase) return { kind: 'support_case', id: supportCase[1]! };

  return null;
}

/* Re-exported so the panel and compose import from one place. */
export { TASK_REFERENCE_KINDS };
