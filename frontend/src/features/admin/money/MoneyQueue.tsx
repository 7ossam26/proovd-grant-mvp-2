/**
 * Admin → Money & Fulfillment — the queue. Spec §21, §33.7.12, §22.4.
 *
 * ── The order is the acceptance test, not a preference ──────────────────────
 * §33.7.12's whole claim is that "an incomplete batch is visibly recoverable",
 * so interrupted batches lead — not the newest campaign, not the largest. The
 * retry windows are second because they hold a deadline nobody can extend, and
 * reconciliation last because it waits on the window anyway. The server returns
 * the three groups already partitioned; this renders them in the register's
 * order and adds no sort of its own.
 *
 * ── The Day 14 queue is on this page and not its own address ────────────────
 * §22.4's review is the last money gate on a campaign — a failure blocks the
 * unreleased remaining payment — so it belongs beside the close work rather
 * than in a section an Admin has to remember exists. It is the one group here
 * whose rows are overdue-FIRST rather than oldest-first, because 16b's rule is
 * that an SLA nobody can see breached is one that gets breached.
 *
 * ── Every row is a link, and no row acts ────────────────────────────────────
 * Resume, reconcile, finalize, transfer, release, refund, and decide all live
 * on the campaign's own record, where the state that permits or refuses them is
 * on screen. A Resume button on a list row is a money act taken against a
 * summary — and the summary is exactly where the reason it would be refused is
 * not shown.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router';
import {
  MONEY_QUEUE_EMPTY,
  MONEY_QUEUE_GROUPS,
  MONEY_QUEUE_GROUP_BLURBS,
  MONEY_QUEUE_GROUP_LABELS,
} from '@proovd/shared';
import { Button, StatePanel } from '../../../components/index.js';
import { useProovdMotion } from '../../../motion/MotionProvider.js';
import { supportMailto } from '../../public/states.js';
import {
  AdminRequestError,
  fetchCloseQueue,
  fetchDay14Queue,
  type CloseQueueView,
  type Day14QueueView,
} from './api.js';
import { Facts, Fact, MoneySection, Nothing, Pill, instant } from './shared.js';

interface QueueState {
  close: CloseQueueView;
  day14: Day14QueueView;
}

export function MoneyQueue() {
  const [state, setState] = useState<QueueState | null>(null);
  const [failure, setFailure] = useState<AdminRequestError | null>(null);
  const surface = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    setFailure(null);
    Promise.all([fetchCloseQueue(), fetchDay14Queue()])
      .then(([close, day14]) => setState({ close, day14 }))
      .catch((error: unknown) =>
        setFailure(
          error instanceof AdminRequestError
            ? error
            : new AdminRequestError({
                error: 'unreachable',
                status: 0,
                title: 'Proovd could not be reached',
                whatHappened:
                  'The close and Day 14 queues could not be read, and the failure carried no explanation.',
                next: 'Try the read again. Nothing was changed by the attempt.',
              }),
        ),
      );
  }, []);

  useEffect(load, [load]);
  useProovdMotion(surface, [state]);

  if (failure) {
    return (
      <StatePanel
        state={failure.detail.title}
        whatHappened={
          failure.detail.whatHappened ??
          'The queue could not be read, so nothing on this page is current.'
        }
        next={failure.detail.next ?? 'Try the read again. Nothing was changed by the attempt.'}
        owner="Proovd"
        nextUpdate="When you try again"
        action={
          <Button tier="primary" onClick={load}>
            Try the read again
          </Button>
        }
        reference="Admin · Money"
        getHelp={{ href: supportMailto('The Money queue will not load') }}
        ring
      />
    );
  }

  if (!state) {
    return (
      <StatePanel
        state="Reading close operations"
        whatHappened="Proovd is reading every campaign with a close batch, a retry window, or a Day 14 review outstanding."
        next="The queue appears as soon as that comes back."
        owner="Proovd"
        nextUpdate="Within a few seconds"
        action="No action needed"
        reference="Admin · Money"
      />
    );
  }

  const { operations } = state.close;
  const closeEmpty =
    operations.incomplete.length === 0 &&
    operations.retryWindow.length === 0 &&
    operations.reconciling.length === 0;

  return (
    <div ref={surface} className="mny">
      <header className="mny-hero">
        <p className="kicker">Admin · Money &amp; Fulfillment</p>
        <h1 className="page-title">Close operations</h1>
        <p className="helper">
          Every campaign whose money is still moving, in the order the work has to be done.
          Opening one shows the batch, the reconciliation, what each Creator is owed, what the
          Founder is owed, and what shipped.
        </p>
      </header>

      {closeEmpty && state.day14.queue.length === 0 ? (
        <Nothing>{MONEY_QUEUE_EMPTY}</Nothing>
      ) : null}

      {MONEY_QUEUE_GROUPS.map((group) => {
        if (group === 'incomplete' && operations.incomplete.length > 0) {
          return (
            <MoneySection
              key={group}
              title={MONEY_QUEUE_GROUP_LABELS[group]}
              lede={MONEY_QUEUE_GROUP_BLURBS[group]}
            >
              <ul className="mny-rows">
                {operations.incomplete.map((row) => (
                  <li key={row.campaignId}>
                    <RouterLink className="mny-row" to={`/admin/money/${row.campaignId}`}>
                      <span className="mny-row__lead">
                        <Pill label="Interrupted" tone="risk" small />
                        <strong>{row.campaignId}</strong>
                      </span>
                      <Facts>
                        <Fact label="Batch">{row.batchStatus}</Fact>
                        <Fact label="Campaign">{row.campaignStatus}</Fact>
                        <Fact label="Locked pre-orders">{row.lockedReservations}</Fact>
                        <Fact label="Unresolved attempts">{row.unresolvedAttempts}</Fact>
                        {row.openDedupCases > 0 ? (
                          <Fact label="Open duplicate cases">{row.openDedupCases}</Fact>
                        ) : null}
                        <Fact label="Started">{instant(row.startedAt)}</Fact>
                      </Facts>
                      {/* The server's own sentence about what resuming does. */}
                      <span className="mny-row__recovery">{row.recovery}</span>
                    </RouterLink>
                  </li>
                ))}
              </ul>
            </MoneySection>
          );
        }

        if (group === 'retryWindow' && operations.retryWindow.length > 0) {
          return (
            <MoneySection
              key={group}
              title={MONEY_QUEUE_GROUP_LABELS[group]}
              lede={MONEY_QUEUE_GROUP_BLURBS[group]}
            >
              <ul className="mny-rows">
                {operations.retryWindow.map((row) => (
                  <li key={row.campaignId}>
                    <RouterLink className="mny-row" to={`/admin/money/${row.campaignId}`}>
                      <span className="mny-row__lead">
                        <Pill label="Retry window open" tone="wait" small />
                        <strong>{row.campaignId}</strong>
                      </span>
                      <Facts>
                        <Fact label="Cards still retrying">{row.retrying}</Fact>
                        <Fact label="First failure">{instant(row.firstFailureAt)}</Fact>
                        <Fact label="Window closes">{instant(row.retryDeadlineAt)}</Fact>
                      </Facts>
                    </RouterLink>
                  </li>
                ))}
              </ul>
            </MoneySection>
          );
        }

        if (group === 'reconciling' && operations.reconciling.length > 0) {
          return (
            <MoneySection
              key={group}
              title={MONEY_QUEUE_GROUP_LABELS[group]}
              lede={MONEY_QUEUE_GROUP_BLURBS[group]}
            >
              <ul className="mny-rows">
                {operations.reconciling.map((row) => (
                  <li key={row.campaignId}>
                    <RouterLink className="mny-row" to={`/admin/money/${row.campaignId}`}>
                      <span className="mny-row__lead">
                        <Pill
                          label={row.resultsPrepared ? 'Results sent' : 'Reconciling'}
                          tone={row.resultsPrepared ? 'ok' : 'wait'}
                          small
                        />
                        <strong>{row.campaignId}</strong>
                      </span>
                      <Facts>
                        <Fact label="Campaign">{row.campaignStatus}</Fact>
                        <Fact label="Items required for results">
                          {row.requiredItemsVerified} of {row.requiredItemsTotal} verified
                        </Fact>
                        <Fact label="Results">
                          {row.resultsPrepared ? 'Prepared and sent' : 'Not prepared'}
                        </Fact>
                      </Facts>
                    </RouterLink>
                  </li>
                ))}
              </ul>
            </MoneySection>
          );
        }

        return null;
      })}

      {state.day14.queue.length > 0 ? (
        <MoneySection
          title="Day 14 progress checks"
          lede="Overdue first. A Product failure blocks the unreleased remaining payment; an Idea review is enforcement-only, because there is no remaining payment to block."
        >
          <ul className="mny-rows">
            {state.day14.queue.map((row) => (
              <li key={row.reviewId}>
                <RouterLink
                  className="mny-row"
                  to={`/admin/money/${row.campaignId}?tab=fulfillment`}
                >
                  <span className="mny-row__lead">
                    <Pill
                      label={row.overdue ? 'Decision overdue' : 'Due'}
                      tone={row.overdue ? 'risk' : 'wait'}
                      small
                    />
                    <strong>{row.campaignTitle ?? row.campaignId}</strong>
                  </span>
                  <Facts>
                    <Fact label="Decision due">{instant(row.dueAt)}</Fact>
                    <Fact label="Evidence submitted">
                      {row.submissionCount > 0
                        ? `${row.submissionCount} · latest ${instant(row.latestSubmissionAt)}`
                        : 'Nothing submitted yet'}
                    </Fact>
                    {row.openClarifications > 0 ? (
                      <Fact label="Clarifications open">
                        {row.openClarifications}
                        {row.overdueClarifications > 0
                          ? ` (${row.overdueClarifications} overdue)`
                          : ''}
                      </Fact>
                    ) : null}
                    <Fact label="Blocks a payment">{row.blocksAPayment ? 'Yes' : 'No'}</Fact>
                  </Facts>
                </RouterLink>
              </li>
            ))}
          </ul>
        </MoneySection>
      ) : null}
    </div>
  );
}
