/**
 * The pieces the Money & Fulfillment surfaces share.
 *
 * ── Nothing here decides anything about money ───────────────────────────────
 * Every amount arrives as integer cents in a decimal string and is FORMATTED
 * here, never computed. There is no addition, no subtraction, and no percentage
 * in this feature — §24.3's identity, §22.3's eligible share, and §22.1's
 * earned percentage are all resolved by the services that own them, and a
 * browser-side sum would be the second answer §33.8.13 exists to forbid.
 *
 * ── An absent amount says what it is waiting for ────────────────────────────
 * §16a's rule is at its sharpest on a money screen: a campaign whose close
 * batch has not run has no captured total, and rendering `US$0.00` for it is
 * indistinguishable from one that genuinely captured nothing. `Amount` takes a
 * `waitingOn` and renders it in the grey voice instead.
 */

import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router';
import { formatCents } from '@proovd/shared';
import { cn } from '../../../components/cn.js';

/* ── Money ──────────────────────────────────────────────────────────────────*/

/**
 * Integer cents as a string → `US$1,234.56`.
 *
 * `formatCents` is the one formatter in `shared/money`, and it throws on a
 * negative. A value this surface cannot parse renders as the honest absence
 * rather than as zero — a malformed amount silently becoming US$0.00 on a
 * refund screen is the worst rounding this product could do.
 */
export function usd(cents: string | null | undefined): string | null {
  if (cents === null || cents === undefined || !/^\d+$/.test(cents)) return null;
  return `US$${formatCents(BigInt(cents))}`;
}

export function Amount({
  cents,
  waitingOn,
  approximate,
}: {
  cents: string | null | undefined;
  /** What has not happened yet. Rendered instead of a fabricated zero. */
  waitingOn: string;
  /** §22.3's floor: the share before every Creator cent has resolved. */
  approximate?: boolean;
}) {
  const value = usd(cents);
  if (value === null) return <span className="grey">{waitingOn}</span>;
  return (
    <span className="mny-amount">
      {approximate ? <span className="mny-amount__qualifier">at minimum </span> : null}
      {value}
    </span>
  );
}

/* ── Time ───────────────────────────────────────────────────────────────────*/

/**
 * §27.1: an instant renders local first with UTC beside it.
 *
 * Every deadline on this surface is one somebody acts against — the 48-hour
 * window, Day 3, Day 14, the 24-hour dispute task — so a bare ISO instant is
 * not good enough and neither is a local time with no zone.
 */
export function instant(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const local = date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const utc = date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  });
  return `${local} (${utc} UTC)`;
}

/** A date with no time — a delivery month, a commitment. */
export function day(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { dateStyle: 'long' });
}

/* ── Reading a register aloud ───────────────────────────────────────────────*/

/**
 * The §21 item's own sentence, without its leading citation.
 *
 * `RECONCILIATION_ITEMS[n].spec` is written as documentation — `§21: Batch
 * completeness and all reservation terminal/retry states.` — and rendering it
 * whole puts a Spec citation on screen nine times. That is the leak the
 * Campaigns hub recorded when an earlier draft rendered "§26.5 reservation
 * ledger" into its routing list: an internal reference reaching a surface.
 *
 * The tab already says these are §21's nine items, so the citation there adds
 * nothing an operator does not have. `waitsOn` deliberately KEEPS its
 * reference, because it names which later rule owns the item and there is no
 * other name for that.
 */
export function withoutCitation(sentence: string): string {
  return sentence.replace(/^§[\d.]+:\s*/, '');
}

/**
 * A derived key as a person reads it: `exactAmount` → `Exact amount`.
 *
 * The derived block is a `Record<string, unknown>` composed by the service, so
 * its keys are camelCase identifiers. Passed straight into a `dt` — which is
 * uppercased — `exactAmount` renders as `EXACTAMOUNT`, which is a word in no
 * language.
 */
export function humanKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/* ── State ──────────────────────────────────────────────────────────────────*/

export type PillTone = 'ok' | 'wait' | 'risk' | 'off';

/**
 * A state, as one label.
 *
 * The tone is a second signal and never the only one — the label says what the
 * state is, so it reads correctly in monochrome and to a screen reader (§33.11,
 * and DNA's rule that state is never colour alone).
 */
export function Pill({ label, tone, small }: { label: string; tone: PillTone; small?: boolean }) {
  return (
    <span className={cn('mny-pill', `mny-pill--${tone}`, small && 'mny-pill--sm')}>{label}</span>
  );
}

/* ── Layout ─────────────────────────────────────────────────────────────────*/

export function MoneySection({
  eyebrow,
  title,
  lede,
  aside,
  children,
}: {
  eyebrow?: string;
  title: string;
  lede?: ReactNode;
  aside?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="mny-section">
      <header className="mny-section__head">
        <div>
          {eyebrow ? <p className="kicker">{eyebrow}</p> : null}
          {/* An `h2`: the campaign is the page `h1` (§33.11.2). */}
          <h2 className="mny-section__title">{title}</h2>
          {lede ? <p className="helper">{lede}</p> : null}
        </div>
        {aside ?? null}
      </header>
      {children}
    </section>
  );
}

/** One `dt`/`dd` pair. Always inside `Facts` — an orphaned pair is `dlitem`. */
export function Fact({
  label,
  children,
  note,
}: {
  label: string;
  children: ReactNode;
  note?: string;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {children}
        {note ? <span className="mny-fact__note">{note}</span> : null}
      </dd>
    </div>
  );
}

export function Facts({
  children,
  wide,
  codes,
}: {
  children: ReactNode;
  wide?: boolean;
  /** The labels are identifiers rather than written words, so they are not
      shouted in caps — a reservation status is a key an Admin reads, not a
      heading. */
  codes?: boolean;
}) {
  return (
    <dl className={cn('mny-facts', wide && 'mny-facts--wide', codes && 'mny-facts--codes')}>
      {children}
    </dl>
  );
}

/* ── The pinned refusals ────────────────────────────────────────────────────*/

/**
 * A control this console deliberately does not have, rendered where it would be.
 *
 * `MONEY_OPERATIONS_ABSENCES` carries the sentence; this renders it. The point
 * is that re-adding the control means deleting the sentence that refuses it —
 * a blank space where a control might go says nothing at all (§1.4).
 */
export function Absence({ control, sentence }: { control: string; sentence: string }) {
  return (
    <p className="mny-absence">
      <strong>{control}</strong>
      <span>{sentence}</span>
    </p>
  );
}

/** A rule the surface pins beside the control it governs. */
export function Pinned({ children }: { children: ReactNode }) {
  return <p className="mny-pinned">{children}</p>;
}

/* ── Routing ────────────────────────────────────────────────────────────────*/

/**
 * A pointer into the workspace that owns a record this page only reports.
 *
 * The Campaigns hub's treatment, one prefix along: shown even when the
 * destination does not exist, with the reason where the destination would be
 * (`aria-disabled`, so a keyboard user meets the explanation too — §28.5).
 */
export function RecordLink({
  label,
  detail,
  href,
  unavailableBecause,
}: {
  label: string;
  detail?: string;
  href: string | null;
  unavailableBecause?: string;
}) {
  const body = (
    <span className="mny-link__what">
      <strong>{label}</strong>
      {(href ? detail : unavailableBecause) ? <small>{href ? detail : unavailableBecause}</small> : null}
    </span>
  );
  if (!href) {
    return (
      <span className="mny-link mny-link--off" aria-disabled="true">
        {body}
      </span>
    );
  }
  return (
    <RouterLink className="mny-link" to={href}>
      {body}
      <span className="mny-link__go" aria-hidden="true">
        →
      </span>
    </RouterLink>
  );
}

/* ── Empty ──────────────────────────────────────────────────────────────────*/

/** Nothing here yet, and why — never a blank panel. */
export function Nothing({ children }: { children: ReactNode }) {
  return <p className="mny-nothing">{children}</p>;
}
