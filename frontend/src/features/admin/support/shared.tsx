/**
 * The pieces the Support surfaces share.
 *
 * `Group`, `Row`, `Note`, `Missing`, `Timeline`, `TimelineRow`, and `Actions`
 * come from the Founders workspace unchanged — a definition list is a
 * definition list, and a third copy would be a third place for a `dt` to escape
 * its `dl` (§33.11.2 found exactly that defect three times in Phase 23a).
 *
 * What is new here is the vocabulary the Support reference introduces: a status
 * chip whose tone is derived server-side, a deadline that says how late it is,
 * and the consequence block every decision panel carries.
 *
 * ── Nothing here decides anything ───────────────────────────────────────────
 * Every value arrives resolved from `backend/src/support/workspace/types.ts`.
 * A pane composes rows and never derives a fact — the same rule the Creator
 * workspace's `shared.tsx` records, and for the same §26.2 reason.
 */

import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router';
import { cn } from '../../../components/cn.js';
import type { SupportChipView, SupportDeadline, SupportRecordLink } from './api.js';

export {
  Group,
  Row,
  Note,
  Missing,
  Expandable,
  Timeline,
  TimelineRow,
  Actions,
  SecTitle,
  NOT_PROVIDED,
  ABSENT,
} from '../founders/shared.js';

/* ── Status ─────────────────────────────────────────────────────────────────*/

/**
 * The case's state, as one word.
 *
 * The tone is a second signal and never the only one: the label says what the
 * state is, so the chip reads correctly in monochrome and to a screen reader
 * (§33.11, and DNA's rule that state is never colour alone).
 */
export function CaseChip({ chip, small }: { chip: SupportChipView; small?: boolean }) {
  return (
    <span className={cn('sup-chip', `sup-chip--${chip.tone}`, small && 'sup-chip--sm')}>
      {chip.label}
    </span>
  );
}

/**
 * The triage level.
 *
 * Rendered with its own dot so `Urgent` and `Low` are distinguishable at a
 * glance, and with the word beside it so the dot is never carrying the meaning.
 * It says nothing about the deadline, because it changes nothing about it.
 */
export function TriageFlag({ level, label }: { level: string; label: string }) {
  return (
    <span className={cn('sup-triage', `sup-triage--${level}`)}>
      <i aria-hidden="true" />
      {label}
    </span>
  );
}

/* ── Deadlines ──────────────────────────────────────────────────────────────*/

/**
 * A promised time, and whether it has passed.
 *
 * The relative label leads because it is what an operator scanning a queue
 * actually needs; the absolute instant follows in the reader's own zone with
 * UTC secondary, which is §27.1's rule. `overdue` is decided by the server
 * against its own clock — a browser deciding lateness would report a breach or
 * miss one whenever a machine's clock drifted.
 */
export function Deadline({
  deadline,
  absolute,
}: {
  deadline: SupportDeadline | null;
  absolute?: boolean;
}) {
  if (!deadline) return <span className="grey">Not promised yet</span>;
  return (
    <span className={cn('sup-due', deadline.overdue && 'sup-due--late')}>
      {deadline.label}
      {absolute ? <span className="sup-due__at">{formatInstant(deadline.at)}</span> : null}
    </span>
  );
}

/**
 * §27.1: a deadline spells out its timezone.
 *
 * Local primary with UTC secondary, so a person reading it at 22:00 in Denver
 * and a person reading the stored value get the same instant. A bare ISO string
 * is canonical UTC that spells nothing out, which is the defect Phase 22a's
 * sweep found across four senders.
 */
export function formatInstant(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const local = date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const utc = date.toISOString().replace('T', ' ').slice(0, 16);
  return `${local} (${utc} UTC)`;
}

/** The short form, for a timeline column where the full sentence would wrap. */
export function formatShort(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/* ── Sections ───────────────────────────────────────────────────────────────*/

/**
 * A section of the case, with its heading and its own actions.
 *
 * The heading is an `h2`: the case subject is the page `h1`, so a section under
 * it is the second level (§33.11.2). `flag` is the reference's own emphasis for
 * a section that needs attention, and it is applied from a server-resolved fact
 * rather than from a guess this component makes.
 */
export function CaseSection({
  title,
  lede,
  flag,
  actions,
  children,
}: {
  title: string;
  lede?: ReactNode;
  flag?: boolean;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className={cn('sup-section', flag && 'sup-section--flag')}>
      <header className="sup-section__head">
        <h2 className="sup-section__title">{title}</h2>
        {lede ? <p className="helper">{lede}</p> : null}
      </header>
      {children}
      {actions ? <div className="case-actions">{actions}</div> : null}
    </section>
  );
}

/**
 * The consequence line every decision panel carries.
 *
 * The reference gives each modal a lede explaining what it does and a
 * consequence stating what happens on confirm, and that pairing is deliberate
 * rather than decorative — §1.1 requires a person to know what a control will
 * do before they press it, and §26.6's preview requirement is the same idea
 * applied to money. Kept as a component so no panel can quietly ship without
 * one.
 */
export function Consequence({ children }: { children: ReactNode }) {
  return <div className="sup-consequence">{children}</div>;
}

/* ── Record links ───────────────────────────────────────────────────────────*/

/**
 * A pointer into a record that lives in its own workspace.
 *
 * When the destination does not exist yet the control is still SHOWN and says
 * why — §1.4's two honest options are to hide it or to name what it is, and
 * hiding would make Support describe a smaller product than the one being
 * built. `aria-disabled` rather than `disabled`, so a keyboard user meets the
 * explanation a sighted user can see (§28.5).
 */
export function RecordLink({ link }: { link: SupportRecordLink }) {
  if (link.href) {
    /* A router link, not an anchor. Every destination this panel points at is
       an in-app Admin address, and a full reload would drop the shell and the
       Admin's position in it (DNA §5.12). It was an `<a>` while every
       destination was `href: null` and nothing exercised the branch; the
       Campaigns hub (2026-08-15) is the first real one. */
    return (
      <RouterLink className="sup-link" to={link.href}>
        {link.label}
        <span aria-hidden="true">→</span>
      </RouterLink>
    );
  }
  return (
    <span className="sup-link sup-link--off" aria-disabled="true" title={link.unavailableBecause ?? undefined}>
      {link.label}
      <span className="helper">{link.unavailableBecause}</span>
    </span>
  );
}
