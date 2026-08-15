/**
 * The pieces the Backers surface shares.
 *
 * ── Nothing here decides anything ───────────────────────────────────────────
 * Every value arrives resolved from `backend/src/backers/workspace/types.ts`.
 * A cell renders and never derives — the same rule the other three workspaces'
 * `shared.tsx` files record. It matters more here than anywhere else, because
 * the fact most likely to be re-derived in a component is the consent state,
 * and a browser-side `consent || 'yes'` is precisely the reference's bug.
 */

import type { ReactNode } from 'react';
import { cn } from '../../../components/cn.js';
import type { BackerAnswer, BackerConsentState } from './api.js';

/* ── The value + label numeric cell ─────────────────────────────────────────*/

/**
 * The reference pairs every number with a small caption — `18` over `Backers`,
 * `$2,290` over `preorderValue`. The caption is not decoration: two adjacent numbers
 * with no captions are two numbers a reader has to count columns to identify.
 *
 * `null` renders the waiting line instead, never a zero (§16a, §1.4).
 */
export function StatCell({
  value,
  label,
  waitingOn,
}: {
  value: string | null;
  label: string;
  waitingOn?: string | null;
}) {
  if (value === null) {
    return (
      <span className="bkr-num bkr-num--waiting">
        <strong>—</strong>
        <span>{waitingOn ?? label}</span>
      </span>
    );
  }
  return (
    <span className="bkr-num">
      <strong>{value}</strong>
      <span>{label}</span>
    </span>
  );
}

/* ── Attribution (§18) ──────────────────────────────────────────────────────*/

/**
 * A Creator badge, or the Organic marker.
 *
 * They are visually distinct because they are different KINDS of fact: one
 * names a party, the other records that there is no party. The reference put
 * the string `'Organic'` in the same field that holds real names; here the
 * server sends `null` and this is the only place that absence becomes a word,
 * so no Creator handle can ever collide with it.
 */
export function AttributionCell({
  name,
  handle,
  status,
}: {
  name: string | null;
  handle: string | null;
  status: string;
}) {
  if (!name) {
    return (
      <span className="bkr-organic">
        Organic
        <small>No Creator link</small>
      </span>
    );
  }
  return (
    <span className="bkr-attr">
      <span className="bkr-badge">{name}</span>
      {handle && handle !== name ? <small>{handle}</small> : null}
      <small className="bkr-attr__status">{status}</small>
    </span>
  );
}

/* ── Consent (§28.4) ────────────────────────────────────────────────────────*/

/**
 * The §28.4 optional consent, as a badge whose words say what it governs.
 *
 * Never "Yes"/"No": a badge is read out of its column, and a bare "No" beside a
 * survey answer invites the reading "this Backer said no to the survey". The
 * label names the consequence — whether the Founder may be given this — which
 * is the question an Admin is actually holding.
 *
 * The tone is a second signal and never the only one, so it reads correctly in
 * monochrome and to a screen reader (§33.11). `title` carries the full
 * permission sentence for a pointer; the same sentence is rendered in full on
 * the row so it is not pointer-only.
 */
export function ConsentBadge({
  state,
  label,
  permits,
}: {
  state: BackerConsentState;
  label: string;
  permits: string;
}) {
  return (
    <span className={cn('bkr-consent', `bkr-consent--${state}`)} title={permits}>
      {label}
    </span>
  );
}

/* ── The stacked question/answer cell ───────────────────────────────────────*/

/**
 * §19's survey answers, question above answer, as the reference stacks them.
 *
 * An unanswered question renders in the grey voice with the word "Not
 * answered", never a substituted default — the reference filled both of its
 * optional answers with a plausible value, which is how a fabricated answer
 * ends up quoted back to a Founder as something the Backer said.
 *
 * The free text is a user's own words about their own problem. It is rendered
 * as text — React escapes it — and it is never truncated to a fixed character
 * count, because these answers are the point of the view. At narrow widths the
 * cell stacks rather than clipping.
 */
export function AnswersCell({ answers }: { answers: BackerAnswer[] }) {
  return (
    <span className="bkr-qa">
      {answers.map((answer) => (
        <span className="bkr-qa__item" key={answer.question}>
          <b>{answer.question}</b>
          <span className={cn(!answer.answered && 'bkr-qa__none')}>{answer.answer}</span>
        </span>
      ))}
    </span>
  );
}

/* ── The person cell ────────────────────────────────────────────────────────*/

/**
 * The Backer's identity line.
 *
 * There is no Backer NAME in this product — §5.4 and §28.1 give a Backer no
 * account, §19's pre-order collects email, phone, and billing address and never
 * a name, and §28.3 keeps the cardholder name at the provider. So the email is
 * the identity, and nothing here derives a display name from it: §18 already
 * refuses the email's local part as a handle by name, and inventing one from
 * billing would be manufacturing an identity the Backer never gave.
 *
 * §18's per-campaign `Backer ###` renders above it where one exists. It is
 * sparse — a number is minted when a Backer comments — so its absence is normal
 * and the cell reads correctly without it.
 */
export function BackerCell({
  email,
  backerNumber,
  status,
}: {
  email: string;
  backerNumber: number | null;
  status: string;
}) {
  return (
    <span className="bkr-person">
      <strong>{email}</strong>
      <small>
        {backerNumber !== null ? `Backer ${backerNumber} · ` : ''}
        {status}
      </small>
    </span>
  );
}

/* ── A labelled filter control ──────────────────────────────────────────────*/

/**
 * A labelled filter control, with its hint as a DESCRIPTION rather than part of
 * the name.
 *
 * The obvious markup — one `<label>` wrapping the caption, the control, and the
 * hint — computes the control's accessible name from ALL the label's text, so
 * the Time filter announces as "Time Choose one campaign first — two campaigns
 * launched months apart share no first 7 days". That is a name nobody can
 * usefully hear and it is not what the label says on screen. So the `<label>`
 * carries only the caption, and the hint is a sibling wired through
 * `aria-describedby`: announced after the name, as a description (§28.5).
 */
export function FilterField({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string | null;
  children: ReactNode;
}) {
  const hintId = `${id}-hint`;
  return (
    <div className="bkr-filter">
      <label className="bkr-filter__label" htmlFor={id}>
        {label}
      </label>
      {hint ? (
        <>
          {children}
          <small className="bkr-filter__hint" id={hintId}>
            {hint}
          </small>
        </>
      ) : (
        children
      )}
    </div>
  );
}
