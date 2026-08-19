/**
 * Admin → Today — Spec §26, §1.4, §30, DNA §5.2, §5.4.
 *
 * The last parked section of the Admin shell, built 2026-08-19.
 *
 * ── It was parked for a real reason, and that reason is why it is this ──────
 * §26 names eight sub-sections and none of them is an overview, so there was
 * nothing to build FROM until the workspaces existed. All six now do, each with
 * its own queue and its own stored deadlines — so Today is the Glance layer
 * over them (DNA §5.14: complexity is staged, never amputated), and it invents
 * nothing.
 *
 * ── Six counts, every one of them a lapsed or open record ───────────────────
 * The §27.8 response promise, §24.11's CHECK-pinned 24-hour task, §21's stored
 * retry deadline and its interrupted batches, §22.4's Day 14 anchor, and the
 * campaigns whose results are not prepared. There is no line here whose source
 * is a duration, a date, or an absence — §33.6.11's rule, on an Admin surface.
 *
 * ── Overdue and waiting are rendered apart ──────────────────────────────────
 * A lapsed promise to a person outside the company and outstanding work nobody
 * is late for are two facts, and summing them would report urgency the records
 * do not carry (§30). The hero counts only the first.
 *
 * ── The clear state offers nothing, and there is nowhere to put a control ───
 * §20's caught-up ending on the screen most tempted to fill itself. `TODAY_CLEAR`
 * renders with no `href`, no suggestion, and no branch that could produce one.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router';
import {
  TODAY_ABSENCES,
  TODAY_CLEAR,
  TODAY_IS_A_POINTER,
  TODAY_OVERDUE_LABEL,
  TODAY_SOURCES,
  TODAY_WAITING_LABEL,
} from '@proovd/shared';
import { Button, StatePanel } from '../../../components/index.js';
import { cn } from '../../../components/cn.js';
import { useProovdMotion } from '../../../motion/MotionProvider.js';
import { supportMailto } from '../../public/states.js';
import { AdminRequestError, call } from '../api.js';

interface TodayView {
  counts: { key: string; count: number; kind: 'overdue' | 'waiting' }[];
  clear: boolean;
  overdueTotal: number;
  sourceKeys: readonly string[];
}

export function TodayPage() {
  const [view, setView] = useState<TodayView | null>(null);
  const [failure, setFailure] = useState<AdminRequestError | null>(null);
  const surface = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    setFailure(null);
    call<TodayView>('/api/admin/today')
      .then(setView)
      .catch((error: unknown) =>
        setFailure(
          error instanceof AdminRequestError
            ? error
            : new AdminRequestError({
                error: 'unreachable',
                status: 0,
                title: 'Proovd could not be reached',
                whatHappened:
                  'The overview reads four queues and one of them did not come back. Nothing is wrong with the work itself — it is this page that could not be assembled.',
                next: 'Try again, or open a workspace directly from the sections above.',
              }),
        ),
      );
  }, []);

  useEffect(load, [load]);
  useProovdMotion(surface, [view]);

  if (failure) {
    return (
      <StatePanel
        state={failure.detail.title}
        whatHappened={
          failure.detail.whatHappened ??
          'The overview could not be read, so no count on this page is current.'
        }
        next={
          failure.detail.next ??
          'Try again, or open a workspace directly — each one reads its own queue.'
        }
        owner="Proovd"
        nextUpdate="When you try again"
        action={
          <Button tier="primary" onClick={load}>
            Try the read again
          </Button>
        }
        reference="Admin · Today"
        getHelp={{ href: supportMailto('The Admin overview will not load') }}
        ring
      />
    );
  }

  if (!view) {
    return (
      <StatePanel
        state="Reading the queues"
        whatHappened="Proovd is reading support promises, dispute tasks, close batches, and Day 14 decisions."
        next="The overview appears as soon as all four come back."
        owner="Proovd"
        nextUpdate="Within a few seconds"
        action="No action needed"
        reference="Admin · Today"
      />
    );
  }

  /*
    The register decides the order and the copy; the payload decides the number.
    Walking `TODAY_SOURCES` rather than `view.counts` means a count the server
    sent for a source nobody defined renders nowhere, and a source with no count
    renders as zero rather than vanishing — the absence being visible is the
    point on a page whose whole job is "is anything outstanding".
  */
  const rows = TODAY_SOURCES.map((source) => ({
    source,
    entry: view.counts.find((c) => c.key === source.key) ?? { count: 0, kind: 'waiting' as const },
  }));

  return (
    <div ref={surface} className="tdy">
      <header className="tdy-hero">
        <p className="kicker">Admin · Today</p>
        <h1 className="page-title">
          {view.clear ? 'Nothing is past due' : `${view.overdueTotal} past due`}
        </h1>
        <p className="tdy-hero__note">{TODAY_IS_A_POINTER}</p>
      </header>

      {view.clear ? (
        /*
          The done-moment. No control, and nowhere to add one — §20's rule that
          a caught-up state shows no manufactured CTA, applied here.
        */
        <p className="tdy-clear">{TODAY_CLEAR}</p>
      ) : (
        <ul className="tdy-rows">
          {rows
            .filter(({ entry }) => entry.count > 0)
            .map(({ source, entry }) => (
              <li key={source.key}>
                <RouterLink className="tdy-row" to={source.href}>
                  <span className="tdy-row__count">{entry.count}</span>
                  <span className="tdy-row__what">
                    <strong>{source.label}</strong>
                    <small>{source.detail}</small>
                  </span>
                  <span
                    className={cn(
                      'tdy-row__kind',
                      entry.kind === 'overdue' && 'tdy-row__kind--overdue',
                    )}
                  >
                    {entry.kind === 'overdue' ? TODAY_OVERDUE_LABEL : TODAY_WAITING_LABEL}
                  </span>
                </RouterLink>
              </li>
            ))}
        </ul>
      )}

      {/* The zero rows, stated rather than hidden — "checked and clear" and
          "not checked" are different, and only the first is true here. */}
      {!view.clear && rows.some(({ entry }) => entry.count === 0) ? (
        <p className="tdy-none">
          Checked and clear:{' '}
          {rows
            .filter(({ entry }) => entry.count === 0)
            .map(({ source }) => source.subject)
            .join(', ')}
          .
        </p>
      ) : null}

      <section className="tdy-absences">
        <h2 className="tdy-absences__title">What this page is not</h2>
        {TODAY_ABSENCES.map((absence) => (
          <p key={absence.key} className="tdy-absence">
            <strong>{absence.element}</strong>
            <span>{absence.sentence}</span>
          </p>
        ))}
      </section>
    </div>
  );
}
