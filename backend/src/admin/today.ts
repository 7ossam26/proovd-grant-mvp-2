/**
 * Today — the composed read. Spec §26, §1.4, §30.
 *
 * ── It owns nothing, stores nothing, and derives nothing new ────────────────
 * Six counts, each from a read that already exists and is already tested:
 * §27.8's support queue, §24.11's dispute queue, §21's close operations, and
 * §22.4's Day 14 queue. This module calls them and counts. There is no `today`
 * table, no cached rollup, and no query of its own against a domain table —
 * §26.8's trap ("a second event store that drifts from the first") applied to
 * counts rather than to events, which is the form it would take here.
 *
 * That is also why the register lives in `@proovd/shared` and this file
 * restates only the keys: the definitions travel with the payload, so the
 * surface renders what each count IS rather than keeping a second copy.
 *
 * ── `overdue` and `waiting` are two facts ───────────────────────────────────
 * A lapsed promise and outstanding work are not the same thing, and a screen
 * that summed them would report urgency the records do not carry (§30). Each
 * source declares which it is, and the surface renders them apart.
 */

import type { Database } from '../db/client.js';
import { readSupportQueue } from '../support/cases.js';
import { readDisputeQueue } from '../disputes/service.js';
import { readCloseOperations } from '../close/reconciliation.js';
import { readDay14Queue } from '../fulfillment/day14.js';

/**
 * The six keys, restated.
 *
 * The backend cannot import `@proovd/shared` at runtime (the `rootDir`
 * constraint this codebase has recorded since Phase 06a), so the KEYS are here
 * and the labels, details, and hrefs stay in the register the browser imports.
 * Drift-tested, like every other restatement.
 */
export const TODAY_SOURCE_KEYS = [
  'support_overdue',
  'dispute_tasks',
  'close_incomplete',
  'retry_window',
  'day_14_overdue',
  'reconciling',
] as const;

export type TodaySourceKey = (typeof TODAY_SOURCE_KEYS)[number];

export interface TodayCount {
  key: TodaySourceKey;
  count: number;
  /** `overdue` = a stored deadline has lapsed. `waiting` = nobody is late. */
  kind: 'overdue' | 'waiting';
}

export interface TodayView {
  counts: TodayCount[];
  /** True when every count is zero — the done-moment, decided here not there. */
  clear: boolean;
  /** How many of the counts are lapsed deadlines rather than open work. */
  overdueTotal: number;
}

export async function readToday(db: Database, options: { now?: Date } = {}): Promise<TodayView> {
  const now = options.now ?? new Date();

  /*
    One round of the four reads, in parallel. Each is the SAME function its own
    workspace calls, so a count here and the list there cannot disagree about
    what is overdue — which is the only property this page has to get right.
  */
  const [support, disputes, close, day14] = await Promise.all([
    readSupportQueue(db, { now }),
    readDisputeQueue(db, { now }),
    readCloseOperations(db),
    // `readDay14Queue` takes the instant positionally, not in an options bag.
    readDay14Queue(db, now),
  ]);

  const counts: TodayCount[] = [
    { key: 'support_overdue', count: support.overdueCount, kind: 'overdue' },
    {
      key: 'dispute_tasks',
      // The 24-hour task, not the provider's evidence deadline — those are two
      // clocks and only the first is ours to be late for (§24.11).
      count: disputes.disputes.filter((d) => d.taskOverdue && !d.closedAt).length,
      kind: 'overdue',
    },
    { key: 'close_incomplete', count: close.incomplete.length, kind: 'overdue' },
    { key: 'retry_window', count: close.retryWindow.length, kind: 'waiting' },
    { key: 'day_14_overdue', count: day14.filter((row) => row.overdue).length, kind: 'overdue' },
    {
      key: 'reconciling',
      count: close.reconciling.filter((row) => !row.resultsPrepared).length,
      kind: 'waiting',
    },
  ];

  return {
    counts,
    clear: counts.every((entry) => entry.count === 0),
    overdueTotal: counts
      .filter((entry) => entry.kind === 'overdue')
      .reduce((total, entry) => total + entry.count, 0),
  };
}
