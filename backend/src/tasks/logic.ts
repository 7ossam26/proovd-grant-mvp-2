/**
 * The Admin Tasks registers, restated — post-Phase-24 change, 2026-08-16.
 *
 * `shared/src/admin/tasks.ts` is the authority. The backend compiles under
 * `rootDir: src` and never imports `@proovd/shared` at runtime, so the facts
 * it needs are restated here and `tests/admin-tasks.test.ts` drift-tests every
 * one of them against shared — the pinned sentences character for character.
 *
 * What is deliberately NOT restated: the due-date kernels (`taskDueStateFor`,
 * `taskDueLabel`). The server never computes a due state — the pill is
 * rendered by the one surface that shows it, against the viewer's own day —
 * so the stored date drives nothing server-side at all, which is the
 * strongest available form of the "the date drives exactly two things" rule.
 * A restatement here would be an invitation to call it.
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

export const TASK_REFERENCE_ADDRESS_PATTERNS: Readonly<Record<TaskReferenceKind, string>> = {
  founder: '/admin/founders/:prospectId',
  creator_relationship: '/admin/creators/:prospectId/relationships/:associationId',
  campaign: '/admin/campaigns/:campaignId',
  backer: '/admin/backers?view=backers&campaignId=:campaignId',
  support_case: '/admin/support/:caseId',
};

/** Pinned; rides the due-date control on the surface. Drift-tested. */
export const TASK_DUE_DATE_IS_CHECKED =
  'A due date here is a date you check, not one that chases anybody. Proovd sends nothing when it arrives or passes, and nothing reads it on a schedule.';

/** Pinned; why `ref_label` is written once and the href is not stored. */
export const TASK_REFERENCE_LABEL_IS_STORED =
  'The reference label is stored when the task is written, so a later rename cannot rewrite what was written down. The destination is checked again on every read.';

/** Word-bounded scan targets — see the shared register for each term's reason. */
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

/**
 * The resolved shape every reference renders through. `href` and
 * `unavailableBecause` are never both set and never both null — the Support
 * workspace's shown-but-unavailable contract, asserted in the suite.
 */
export interface TaskReferenceResolution {
  label: string;
  href: string | null;
  unavailableBecause: string | null;
}

/** What a reference renders when its target no longer answers (§1.4). */
export const TASK_REFERENCE_TARGET_GONE =
  'That record no longer exists — the label is what was written down when the task was created.';
