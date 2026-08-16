/**
 * The Admin Tasks panel — the registers. Post-Phase-24 change, 2026-08-16.
 *
 * §26 does not name a task list, and that is stated rather than papered over:
 * this surface is a private note an operator writes to themselves, pointed at
 * the record it belongs to. §1 rule 6 forbids inventing "a new commercial rule,
 * deadline, fee, eligibility condition, payout rule, campaign state, or
 * consent" — a note is none of the seven — and §1 rule 2 permits composing
 * surfaces the Spec does not enumerate so long as nothing specified is lost.
 *
 * It becomes a rule-6 violation the moment the due date binds anything. So the
 * date drives exactly two things, both computed at read time in the one module
 * that renders it: the `late` / `today` / `future` pill and the optional sort.
 * No schedule-shaped column exists, no notification key can carry it, no job
 * reads the table, and the pinned sentence below rides the control that sets
 * it. Each of those is asserted by test, not remembered.
 *
 * There is no assignee, and the absence is the design: `support_cases` already
 * carries an owner, a waiting party, a due time, a handoff gate, and §27.8's
 * published response promise. A second way to hand work to a named person would
 * be a second door into rules that machinery encodes. If a task turns out to be
 * work somebody is owed, the answer is a support case, not a column here.
 */

/* ── What a task can point at (§11, §1.4) ──────────────────────────────────*/

/**
 * The five built workspaces a task reference may name, each with the address
 * pattern that workspace answers at.
 *
 * `backer` is deliberately a LIST position rather than a record page: the
 * Backers workspace's own promise is "one row per Backer, no extra record
 * page", so the honest destination is the campaign-filtered list the row lives
 * in. The reference still stores the reservation id — that is what identifies
 * the row — and the resolver derives the list address from it.
 */
export const TASK_REFERENCE_KINDS = [
  'founder',
  'creator_relationship',
  'campaign',
  'backer',
  'support_case',
] as const;

export type TaskReferenceKind = (typeof TASK_REFERENCE_KINDS)[number];

export const TASK_REFERENCE_KIND_LABELS: Readonly<Record<TaskReferenceKind, string>> = {
  founder: 'Founder',
  creator_relationship: 'Creator relationship',
  campaign: 'Campaign',
  backer: 'Backer',
  support_case: 'Support case',
};

/**
 * The address each kind resolves to. Documentation of the contract the
 * backend resolver implements — the resolver composes real ids into these
 * shapes, and the drift test compares the two registers.
 */
export const TASK_REFERENCE_ADDRESS_PATTERNS: Readonly<Record<TaskReferenceKind, string>> = {
  founder: '/admin/founders/:prospectId',
  creator_relationship: '/admin/creators/:prospectId/relationships/:associationId',
  campaign: '/admin/campaigns/:campaignId',
  backer: '/admin/backers?view=backers&campaignId=:campaignId',
  support_case: '/admin/support/:caseId',
};

/**
 * The resolved shape every reference renders through — the same one the
 * Support workspace introduced on 2026-08-13 and the Campaigns hub reuses.
 * `href` and `unavailableBecause` are never both set and never both null;
 * both directions are asserted by test.
 *
 * The reference bundle's own rule, kept because it is correct and already
 * matches this repo's treatment: a reference with nothing to navigate to is a
 * label, not a dead button.
 */
export interface TaskReferenceResolution {
  readonly label: string;
  readonly href: string | null;
  readonly unavailableBecause: string | null;
}

/**
 * `ref_label` is resolved and stored at WRITE time, never on read. A label
 * resolved on read silently rewrites what somebody wrote down when a campaign
 * is renamed — the same reasoning the §18 comment thread records for its
 * stored author display. The href is the half that IS re-resolved on read,
 * because whether the destination still exists is a fact about now.
 */
export const TASK_REFERENCE_LABEL_IS_STORED =
  'The reference label is stored when the task is written, so a later rename cannot rewrite what was written down. The destination is checked again on every read.';

/* ── The due date that must not chase (§30, DNA §5.10) ─────────────────────*/

/**
 * Pinned, and it rides the due-date control rather than sitting under it.
 *
 * The phrase is the one this codebase already articulated for the support
 * workspace's outstanding-contact date: a date you check rather than one that
 * chases anybody. §30 forbids automated engagement sequences, and the five
 * mechanisms behind this sentence — no schedule column, no notification key,
 * no job, exactly two readers of the value, and this sentence itself — are
 * each asserted by test.
 */
export const TASK_DUE_DATE_IS_CHECKED =
  'A due date here is a date you check, not one that chases anybody. Proovd sends nothing when it arrives or passes, and nothing reads it on a schedule.';

/** The three states the pill renders, and the only thing the date decides. */
export type TaskDueState = 'late' | 'today' | 'future';

/**
 * Pure over two ISO dates (`YYYY-MM-DD`), which compare lexicographically.
 *
 * `today` is the VIEWER'S day, passed in by the one surface that renders the
 * pill — the server never computes this, so the stored date drives nothing
 * server-side at all, which is the strongest form of mechanism four.
 */
export function taskDueStateFor(dueOn: string, today: string): TaskDueState {
  if (dueOn < today) return 'late';
  if (dueOn === today) return 'today';
  return 'future';
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/**
 * The pill's words, from the reference: `Due today`, `Due tomorrow`,
 * `Due Mar 4`, `Overdue · Mar 4`. `Overdue` is established Admin vocabulary —
 * §27.8 uses it for the support queue — which is why it is not on the banned
 * list below.
 */
export function taskDueLabel(dueOn: string, today: string, tomorrow: string): string {
  if (dueOn === today) return 'Due today';
  if (dueOn === tomorrow) return 'Due tomorrow';
  const parts = dueOn.split('-');
  const month = MONTH_NAMES[Number(parts[1]) - 1] ?? parts[1];
  const day = Number(parts[2]);
  const text = `${month} ${day}`;
  return taskDueStateFor(dueOn, today) === 'late' ? `Overdue · ${text}` : `Due ${text}`;
}

/* ── What the panel refuses to become (§30, §3.2, §33.11.3) ────────────────*/

/**
 * Words the Tasks surfaces must not carry, checked by test against every
 * payload and every rendered surface. Matching is word-bounded (`\b`), with a
 * space matching any whitespace run — a random account id can contain any
 * three letters, and a substring scan over one would fail on noise.
 *
 * `goal` is §3.2's ban for an Idea threshold, extended to identifiers by its
 * last paragraph — §33.11.3's bundle scan already caught `progress.goal` once.
 * `reminder` is the non-obvious one: it is real, live product vocabulary
 * (§20's pre-charge reminder, Appendix B.3, §27.4/§27.5), so reusing it for a
 * task implies a message the product does not send. The rest are §30's
 * engagement machinery and the assignment/SLA vocabulary that belongs to
 * `support_cases`. `Overdue` is deliberately absent — §27.8 uses it.
 */
export const TASKS_BANNED_TERMS = [
  'goal',
  'reminder',
  'nudge',
  'streak',
  'snooze',
  'escalate',
  'sla',
  'assigned to',
  'auto',
] as const;

/* ── The gap register (§1.4) ───────────────────────────────────────────────*/

/**
 * What is deliberately not built, each entry naming what is missing and why —
 * the shape of `SUPPORT_PARKED_MESSAGES`. A register test refuses an entry
 * that does not name its absence.
 */
export const TASKS_PARKED_MESSAGES = {
  bulk_actions:
    'There is no bulk action. Every task records its own author and its own completion, and a bulk control is one act applied to rows nobody read.',
  merge_lists:
    'Lists cannot be merged. On a shared table a merge is a delete wearing a different name, and it would destroy how another person arranged their own work. Move tasks one at a time instead.',
  export:
    'There is no export. A task can name a Founder, a Creator, a Backer, or a case, and §25.7 draws the line between what Admin may see on screen and what Admin may hand out in a file.',
  attachments:
    'Files cannot be attached — the storage bucket is not configured (Track A4). Point the task at the record that holds the evidence instead.',
  command_palette:
    'There is no shell-wide palette. The `/` search is per-surface today, and a task panel is not the place to introduce a new global one.',
} as const;

export type TasksParkedKey = keyof typeof TASKS_PARKED_MESSAGES;
