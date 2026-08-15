/**
 * The pieces the Campaigns surfaces share.
 *
 * ── Nothing here decides anything ───────────────────────────────────────────
 * Every value arrives resolved from `backend/src/campaigns/workspace/types.ts`.
 * A pane composes rows and never derives a fact — the same rule the Creator and
 * Support workspaces' `shared.tsx` files record, and for the same §26.2 reason:
 * a value the browser computed has no `prior_value` to compare against, and two
 * derivations of "is this blocked" are two answers waiting to disagree.
 *
 * ── A fact says what it is waiting for, or it says nothing ──────────────────
 * `Fact` renders `waitingOn` in the grey voice when there is no value, because
 * this page summarises five domains that mostly have not run yet and a blank
 * cell reads as a defect. §16a's rule — not yet populated is not zero — is the
 * single most important thing on a hub.
 */

import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router';
import { cn } from '../../../components/cn.js';
import type {
  CampaignBlocker,
  CampaignFact,
  CampaignRecordLink,
} from './api.js';

/* ── The state pill ─────────────────────────────────────────────────────────*/

/**
 * The campaign's §23.1 lifecycle, as one label.
 *
 * The tone is a second signal and never the only one: the label says what the
 * state is, so the pill reads correctly in monochrome and to a screen reader
 * (§33.11, and DNA's rule that state is never colour alone).
 */
export function StatePill({
  label,
  kind,
  small,
}: {
  label: string;
  kind: string;
  small?: boolean;
}) {
  return (
    <span className={cn('cmp-pill', `cmp-pill--${kind}`, small && 'cmp-pill--sm')}>{label}</span>
  );
}

/** The two-letter mark on a directory row. Server-derived from the name. */
export function Monogram({ initials }: { initials: string }) {
  return (
    <span className="cmp-mark" aria-hidden="true">
      {initials}
    </span>
  );
}

/* ── Facts ──────────────────────────────────────────────────────────────────*/

/**
 * One definition-list row.
 *
 * The `dt`/`dd` pair is always inside a `dl` supplied by `FactList` — Phase
 * 23a's sweep found three orphaned pairs across the product and `dlitem` is
 * what axe fires on, so the two are never separable here.
 */
export function FactRow({ fact }: { fact: CampaignFact }) {
  return (
    <div>
      <dt>{fact.label}</dt>
      <dd>
        {fact.value ?? <span className="grey">{fact.waitingOn ?? 'Not recorded'}</span>}
        {fact.value && fact.waitingOn ? (
          <span className="cmp-fact__note">{fact.waitingOn}</span>
        ) : null}
      </dd>
    </div>
  );
}

export function FactList({ facts }: { facts: CampaignFact[] }) {
  return (
    <dl className="cmp-facts">
      {facts.map((fact) => (
        <FactRow key={fact.label} fact={fact} />
      ))}
    </dl>
  );
}

/* ── Sections ───────────────────────────────────────────────────────────────*/

/**
 * A section of the record.
 *
 * The heading is an `h2`: the campaign name is the page `h1`, so a section
 * under it is the second level (§33.11.2).
 */
export function CampaignSection({
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
    <section className="cmp-section">
      <header className="cmp-section__head">
        <div>
          {eyebrow ? <p className="kicker">{eyebrow}</p> : null}
          <h2 className="cmp-section__title">{title}</h2>
          {lede ? <p className="helper">{lede}</p> : null}
        </div>
        {aside ?? null}
      </header>
      {children}
    </section>
  );
}

/* ── Routing ────────────────────────────────────────────────────────────────*/

/**
 * A pointer into a workspace that owns the work.
 *
 * When the destination does not exist the control is still SHOWN and says why —
 * §1.4's two honest options are to hide it or to name what it is, and hiding
 * three of six destinations would make Campaigns describe a smaller product
 * than the one being built. `aria-disabled` rather than `disabled`, so a
 * keyboard user meets the explanation a sighted user can see (§28.5).
 *
 * The Support workspace introduced this treatment on 2026-08-13 and this is the
 * same shape, one class prefix along.
 */
export function AdminLink({ link }: { link: CampaignRecordLink }) {
  const body = (
    <>
      <span className="cmp-link__mark" aria-hidden="true">
        {link.mark}
      </span>
      <span className="cmp-link__what">
        <strong>{link.label}</strong>
        <small>{link.href ? link.detail : link.unavailableBecause}</small>
      </span>
    </>
  );

  if (!link.href) {
    return (
      <span className="cmp-link cmp-link--off" aria-disabled="true">
        {body}
      </span>
    );
  }

  /* An in-app address is a router link so the Admin shell is not remounted;
     anything else would be an external address, and there are none today. */
  return (
    <RouterLink className="cmp-link" to={link.href}>
      {body}
      <span className="cmp-link__go" aria-hidden="true">
        →
      </span>
    </RouterLink>
  );
}

export function AdminLinkList({ links }: { links: CampaignRecordLink[] }) {
  return (
    <div className="cmp-links">
      {links.map((link) => (
        <AdminLink key={link.key} link={link} />
      ))}
    </div>
  );
}

/* ── The blocker band ───────────────────────────────────────────────────────*/

/**
 * The one thing standing in the campaign's way, or the done-moment.
 *
 * Three things are read from the server and none is decided here: `clear`
 * chooses the pill's word, `blocked` chooses whether there is a routing control
 * at all, and `route` is the destination. They are not opposites — §21's retry
 * window is a real blocker sentence that nobody at Proovd owes, so it renders
 * "Current blocker" with owner System and no button, which is exactly what the
 * reference's own `ownerAction` does.
 */
export function BlockerBand({
  blocker,
  kind,
  detail,
}: {
  blocker: CampaignBlocker;
  kind: string;
  detail: string;
}) {
  return (
    <div className="cmp-band">
      <StatePill label={blocker.clear ? 'On track' : 'Current blocker'} kind={kind} />
      <h2 className="cmp-band__title">{blocker.text}</h2>
      {/*
        The reference renders the due date as this paragraph on a clear campaign
        AND again under the meta, which reads as the same sentence twice — the
        screenshot pass is what made it obvious. So the paragraph carries the
        routing sentence when something is blocked and nothing when nothing is:
        the meta below already says Owner and Next, and repeating one of them in
        a larger font adds no fact.
      */}
      {blocker.clear ? null : <p className="cmp-band__body">{detail}</p>}
      <div className="cmp-band__meta">
        <div>
          <span>Owner</span>
          <strong>{blocker.ownerLabel}</strong>
        </div>
        <div>
          <span>Next</span>
          <strong>{blocker.due}</strong>
        </div>
      </div>
      {blocker.route ? (
        blocker.route.href ? (
          <RouterLink className="btn btn--primary btn--sm" to={blocker.route.href}>
            <span className="btn__label">Open {blocker.route.label}</span>
          </RouterLink>
        ) : (
          <p className="helper cmp-band__parked">{blocker.route.unavailableBecause}</p>
        )
      ) : null}
    </div>
  );
}

/* ── Time ───────────────────────────────────────────────────────────────────*/

/**
 * §27.1: an instant renders local with UTC secondary.
 *
 * The server formats in UTC and says UTC — it has never been told the viewer's
 * zone — so the local half is added here, where the zone is actually known.
 * Used only for the freshness stamp, which is the one instant on this page a
 * person reads as "how current is this".
 */
export function localStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' });
}
