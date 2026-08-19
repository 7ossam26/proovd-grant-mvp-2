/**
 * Today — Spec §26, §1.4, §30, DNA §5.2, §5.4.
 *
 * ── This is composed under §1 rule 2, and it is not §26 content ─────────────
 * §26 has eight sub-sections and none of them is an overview. It names Users,
 * Campaign detail, Affiliate recruitment, Creator proof, the reservation
 * ledger, money controls, support/dispute/kill, and the timeline — every one of
 * which is a workspace that now exists. There is no Today in the Spec.
 *
 * So Today invents no commercial rule, no deadline, no eligibility condition
 * and no state (§1 rule 6 lists all seven and this touches none). It is the
 * Glance layer over queues that already exist, the way the five workspace
 * shells and the Tasks panel were composed. Every line it shows is a COUNT of
 * records some other surface already owns, and every line links there.
 *
 * ── The rule that keeps it from becoming a dashboard of nudges ──────────────
 * §30 forbids automated engagement and manufactured urgency, and an overview
 * screen is where those arrive. Three mechanisms:
 *
 *  1. Every line is derived from a RECORD with a stored deadline — the §27.8
 *     response promise, §24.11's CHECK-pinned 24-hour task, §21's stored retry
 *     deadline, §22.4's Day 14 anchor. There is no line whose source is a
 *     duration, a date, or an absence, which is §33.6.11's rule applied to an
 *     Admin surface.
 *  2. `TODAY_SOURCES` is the whole list. A line cannot be added without an
 *     entry naming the record behind it and the surface that owns it.
 *  3. When nothing is due it says so and offers nothing. `TODAY_CLEAR` is a
 *     done-moment (DNA §5.4), not an empty state with a suggestion in it — the
 *     §20 caught-up ending, on the one screen most tempted to fill itself.
 *
 * ── And what it deliberately does not have ──────────────────────────────────
 * No count of anything nobody is waiting on, no "activity", no streak, no
 * trend, no per-Admin assignment, and no ordering an operator did not ask for
 * beyond overdue-before-due. `TODAY_ABSENCES` names each with its reason.
 */

/* ── Where every line comes from ────────────────────────────────────────────*/

export interface TodaySource {
  readonly key: string;
  /** What the count is called on screen. */
  readonly label: string;
  /**
   * The same thing named without its state word.
   *
   * The label has to say "past due" because that is what the row means. The
   * clear line lists what was CHECKED and found empty, and reusing the label
   * there produces "Clear: day 14 decisions past due" — a sentence that says
   * the opposite of what it means. The browser pass is what caught it.
   */
  readonly subject: string;
  /** One line under it. Never a call to action. */
  readonly detail: string;
  /** The record the count is derived from — never a duration or a guess. */
  readonly record: string;
  /** The surface that owns the work. Today only points. */
  readonly href: string;
  /** The Spec section whose rule creates the deadline. Not rendered. */
  readonly specRef: string;
}

/**
 * The six things a person at Proovd could genuinely be late for.
 *
 * In severity order for the OPERATOR, which is not the same as the lifecycle
 * order: a support promise and a dispute window are owed to somebody outside
 * the company and cannot be recovered by working faster later, so they lead.
 * An interrupted close batch is third because reservations are locked and safe
 * while it waits — the honest state, not an emergency.
 */
export const TODAY_SOURCES = [
  {
    key: 'support_overdue',
    label: 'Support promises past due',
    subject: 'Support promises',
    detail: 'A person is waiting past the response time we published.',
    record: 'support_cases, with the business-day deadline stored beside the calendar version that produced it',
    href: '/admin/support',
    specRef: '§27.8',
  },
  {
    key: 'dispute_tasks',
    label: 'Dispute tasks past due',
    subject: 'Dispute tasks',
    detail: 'The 24-hour task on a dispute has lapsed. The provider deadline is separate and later.',
    record: 'payment_disputes.task_due_at, CHECK-pinned to opened_at + 24 hours',
    href: '/admin/money',
    specRef: '§24.11',
  },
  {
    key: 'close_incomplete',
    label: 'Close batches interrupted',
    subject: 'Close batches',
    detail: 'The batch stopped part-way. Pre-orders are locked and no money has been double-moved.',
    record: 'campaign_close_batches with no completed_at',
    href: '/admin/money',
    specRef: '§21, §33.7.12',
  },
  {
    key: 'retry_window',
    label: 'Retry windows open',
    subject: 'Retry windows',
    detail: 'A card failed and the window has not shut. Nothing here needs an Admin unless it stalls.',
    record: 'campaign_close_batches.retry_deadline_at',
    href: '/admin/money',
    specRef: '§21',
  },
  {
    key: 'day_14_overdue',
    label: 'Day 14 decisions past due',
    subject: 'Day 14 decisions',
    detail: 'The Founder submitted evidence and the decision date has passed.',
    record: 'day_14_reviews, against the campaign’s own Day 14 anchor',
    href: '/admin/money',
    specRef: '§22.4',
  },
  {
    key: 'reconciling',
    label: 'Campaigns awaiting reconciliation',
    subject: 'Reconciliation',
    detail: 'Charges are final. Four verified items gate the results the Founder sees.',
    record: 'campaign_reconciliations against §21’s nine items',
    href: '/admin/money',
    specRef: '§21',
  },
] as const satisfies readonly TodaySource[];

export type TodaySourceKey = (typeof TODAY_SOURCES)[number]['key'];

export function todaySource(key: TodaySourceKey): TodaySource {
  const found = TODAY_SOURCES.find((s) => s.key === key);
  if (!found) throw new Error(`unknown Today source: ${key}`);
  return found;
}

/* ── Copy ───────────────────────────────────────────────────────────────────*/

/**
 * The done-moment. No control, and nowhere to put one.
 *
 * §20's caught-up ending, applied to the screen most likely to fill itself with
 * something to do. What is absent is the point: there is no "review recent
 * activity", no suggestion, and no branch that produces one.
 */
export const TODAY_CLEAR = 'Nothing is past due and nothing is waiting on Proovd.' as const;

/** Said once, at the top, so nobody reads a count as a target. */
export const TODAY_IS_A_POINTER =
  'Every count here is read from a record with a deadline somebody agreed to, and opens the workspace that owns it. Nothing is decided on this page.' as const;

/**
 * The distinction the whole screen turns on.
 *
 * `overdue` means a promise or a stored deadline has lapsed. `waiting` means
 * work is outstanding and nobody is late. Collapsing them would make the second
 * look like the first, which is manufactured urgency wearing a count (§30).
 */
export const TODAY_OVERDUE_LABEL = 'Past due' as const;
export const TODAY_WAITING_LABEL = 'Waiting' as const;

/* ── What Today deliberately is not ─────────────────────────────────────────*/

export interface TodayAbsence {
  readonly key: string;
  readonly element: string;
  readonly sentence: string;
  /** For the next reader of this file. Never rendered. */
  readonly rule: string;
}

export const TODAY_ABSENCES = [
  {
    key: 'assignment',
    element: 'Work assigned to you',
    sentence:
      'Nothing here is assigned to anyone. A support case has an owner and a due time; everything else is work the team can see, and this page does not hand it out.',
    rule: '§26.7 already gives a support case an owner, a waiting party, and a handoff gate. A second way to hand work to a named person would be a second door into that machinery — the reasoning the Tasks panel records for having no `assigned_to`.',
  },
  {
    key: 'activity',
    element: 'Recent activity',
    sentence:
      'There is no activity feed. What happened to a campaign, a Creator, or a case is on that record’s own timeline, composed from the tables it happened in.',
    rule: '§26.8: a second event store that drifts from the first is worse than no timeline. An activity feed here would be exactly that, one level up.',
  },
  {
    key: 'trend',
    element: 'Trends and totals',
    sentence:
      'No chart and no total. The measurement scoreboard is its own surface, and it reports “not measured” until ten Founders have been invited rather than drawing a line through two points.',
    rule: '§33.12.6 forbids an invented baseline. A sparkline on an overview is the shortest path to one.',
  },
  {
    key: 'nudge',
    element: 'Reminders and streaks',
    sentence:
      'Nothing on this page chases anybody, and nothing changes because you did or did not open it.',
    rule: '§30 forbids automated engagement sequences and manufactured urgency. There is no record of a visit and no job that reads one.',
  },
] as const satisfies readonly TodayAbsence[];
