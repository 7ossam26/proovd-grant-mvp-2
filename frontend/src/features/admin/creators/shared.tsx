/**
 * The pieces the Creator-workspace surfaces share.
 *
 * ── What is reused, and what is new ─────────────────────────────────────────
 * `Group`/`Row`/`Note`/`Missing`/`Expandable`/`Timeline`/`TimelineRow`/`Actions`
 * come from the Founders workspace unchanged, because a definition list is a
 * definition list and a second copy would be a second place for `dt` to escape
 * its `dl` (§33.11.2 found exactly that defect three times in Phase 23a).
 *
 * What is new here is the vocabulary the reference introduces and the Founder
 * workspace does not have: a monogram, an owner pill, a provenance badge, a
 * facts strip, and the attention object that carries an owner-specific action.
 *
 * ── Nothing here decides anything ───────────────────────────────────────────
 * Every value arrives resolved from the server (`backend/src/affiliates/
 * workspace/types.ts`). A pane composes rows and never derives a fact — which
 * is what keeps §26.2's `prior_value` meaningful, because a value the browser
 * worked out has no before.
 */

import type { ReactNode } from 'react';
import { provenanceBadge, type AttentionOwner, type ProvenanceKey } from '@proovd/shared';
import { cn } from '../../../components/cn.js';
import type { ProfileField } from './api.js';

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

/* ── Identity ───────────────────────────────────────────────────────────────*/

/**
 * The square of initials.
 *
 * `aria-hidden` because it carries no information the name beside it does not —
 * a screen reader announcing "M J, Maya Johnson" reads a decoration twice.
 */
export function Monogram({ children, large }: { children: string; large?: boolean }) {
  return (
    <span className={cn('cr-mono', large && 'cr-mono--lg')} aria-hidden="true">
      {children}
    </span>
  );
}

/**
 * Who owns the next step.
 *
 * The colour is a second signal, never the only one: the owner's name is in the
 * pill, so a reader who cannot tell green from yellow still learns who is
 * waiting (§33.11, and DNA's rule that state is never colour alone).
 */
export function OwnerPill({ owner, prefix }: { owner: AttentionOwner; prefix?: boolean }) {
  return (
    <span className={`cr-owner cr-owner--${owner.toLowerCase()}`}>
      {prefix ? `Owner · ${owner}` : owner}
    </span>
  );
}

/**
 * Who supplied the values in this block.
 *
 * Not decoration — it decides what may be edited. A `provider` block carries no
 * edit control anywhere (§13: Proovd stores the status, not the document), and
 * an `affiliate` block is corrected through a route that records a reason.
 */
export function ProvenanceBadge({ provenance }: { provenance: ProvenanceKey }) {
  const badge = provenanceBadge(provenance);
  return (
    <span className={`cr-badge cr-badge--${provenance}`} title={badge.helper}>
      {badge.label}
    </span>
  );
}

/* ── The facts strip ────────────────────────────────────────────────────────*/

/**
 * The four facts under the identity band.
 *
 * A real `dl`, so each label is announced with its value rather than as four
 * headings followed by four numbers.
 */
export function FactsStrip({ children }: { children: ReactNode }) {
  return <dl className="cr-facts">{children}</dl>;
}

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/* ── Fields ─────────────────────────────────────────────────────────────────*/

/**
 * One server-resolved field, rendered with its own word for absence.
 *
 * Two words for absence and the difference is load-bearing: `Not provided yet`
 * is a profile field nobody has typed and an Admin can go and fill; `Not
 * researched` is a research field Proovd has not done; `Not claimed` is a fact
 * that cannot exist until somebody claims an account. Collapsing them would
 * tell an Admin to go and enter a value no form accepts (§1.4, §16a).
 */
export function FieldRow({ field }: { field: ProfileField }) {
  return (
    <div className={cn('frow', field.wide && 'frow--wide')}>
      <dt>{field.label}</dt>
      <dd>
        {field.value ? (
          <span className="fval">{field.value}</span>
        ) : (
          <span className="grey">{field.emptyLabel}</span>
        )}
        {field.helper ? <p className="helper">{field.helper}</p> : null}
      </dd>
    </div>
  );
}

/* ── Sections ───────────────────────────────────────────────────────────────*/

/**
 * A section of the record, with its heading and optional actions.
 *
 * The heading is an `h2`: the Affiliate's name is the page `h1`, so a section
 * under it is the second level. `tabIndex={-1}` on an anchored one is what
 * makes a jump work for a keyboard user — scrolling moves the viewport and
 * leaves focus where it was (§28.5).
 */
export function Section({
  eyebrow,
  title,
  id,
  actions,
  badge,
  aside,
  children,
}: {
  eyebrow?: string;
  title: string;
  id?: string;
  actions?: ReactNode;
  badge?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="cr-section">
      <header className="cr-section__head">
        <div>
          {badge}
          {eyebrow ? <p className="kicker">{eyebrow}</p> : null}
          <h2 className="cr-section__title" id={id} tabIndex={id ? -1 : undefined}>
            {title}
          </h2>
        </div>
        {aside}
        {actions ? <div className="case-actions">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

/* ── Attention ──────────────────────────────────────────────────────────────*/

/**
 * The one thing that needs doing, with the owner who owns it.
 *
 * The owner decides which control appears: an Admin-owned item gets the primary
 * action, and a Stripe- or Affiliate-owned one gets none, because offering
 * Proovd a button for somebody else's work is §1.4's failure. The caller passes
 * the action; this component never invents one.
 */
export function AttentionObject({
  owner,
  label,
  detail,
  action,
}: {
  owner: AttentionOwner;
  label: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <section className={`cr-attention cr-attention--${owner.toLowerCase()}`}>
      <div>
        <OwnerPill owner={owner} prefix />
        <h2>{label}</h2>
        <p>{detail}</p>
      </div>
      {action}
    </section>
  );
}

/* ── Quiet state chips ──────────────────────────────────────────────────────*/

/**
 * A short state word with its own background.
 *
 * `tone` is a hint, never the message: the word itself says what the state is,
 * so the chip reads correctly in monochrome and to a screen reader.
 */
export function StateChip({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'warn' | 'info' | 'good';
}) {
  return <span className={`cr-chip cr-chip--${tone}`}>{children}</span>;
}

/** The tone a verification state reads in. Words first, colour second. */
export function verificationTone(state: string): 'neutral' | 'warn' | 'info' | 'good' {
  if (state === 'verified') return 'good';
  if (state === 'in_review') return 'info';
  if (state === 'rejected') return 'warn';
  return 'warn';
}

/** The tone a payout state reads in. `null` is absence, not a problem. */
export function payoutTone(state: string | null): 'neutral' | 'warn' | 'info' | 'good' {
  if (state === null) return 'neutral';
  if (state === 'complete') return 'good';
  if (state === 'requirements_due' || state === 'restricted') return 'warn';
  return 'info';
}
