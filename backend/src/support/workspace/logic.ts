/**
 * The Support-workspace registers, restated for the backend.
 *
 * The backend never imports `@proovd/shared` at runtime (it compiles under
 * `rootDir: src` and the image ships only `backend/dist`), so the data is
 * restated here and `support-workspace.test.ts` drift-tests every list against
 * `@proovd/shared` — the arrangement `support/logic.ts`, `admin/logic.ts`, and
 * `db/schema/domain.ts` all already use.
 *
 * The two pinned sentences are restated too, character for character, because
 * they are the ones an Admin reads at the moment they would otherwise get the
 * rule wrong: that triage does not move §27.8's promise, and that recording a
 * contact is not sending one.
 */

import { SUPPORT_TOPICS, type SupportCaseStatus, type SupportOwner } from '../logic.js';

/* ── Waiting parties ───────────────────────────────────────────────────────*/

export const SUPPORT_WAITING_PARTIES = [
  'proovd',
  'founder',
  'creator',
  'backer',
  'provider',
] as const;
export type SupportWaitingParty = (typeof SUPPORT_WAITING_PARTIES)[number];

export const SUPPORT_WAITING_LABELS: Readonly<Record<SupportWaitingParty, string>> = {
  proovd: 'Waiting on Proovd',
  founder: 'Waiting on Founder',
  creator: 'Waiting on Creator',
  backer: 'Waiting on Backer',
  provider: 'Waiting on Stripe',
};

export const SUPPORT_PARTY_NOUNS: Readonly<Record<SupportWaitingParty, string>> = {
  proovd: 'Proovd',
  founder: 'Founder',
  creator: 'Creator',
  backer: 'Backer',
  provider: 'Stripe',
};

/* ── Triage ────────────────────────────────────────────────────────────────*/

export const SUPPORT_TRIAGE_LEVELS = ['urgent', 'high', 'normal', 'low'] as const;
export type SupportTriageLevel = (typeof SUPPORT_TRIAGE_LEVELS)[number];

export const TRIAGE_NEVER_CHANGES_THE_PROMISE =
  'Triage orders this queue and nothing else. The response promise is one business day on every case, whatever the triage level.';

/** Queue order. Nothing here reads a deadline, and nothing that reads a deadline reads this. */
const TRIAGE_RANK: Readonly<Record<SupportTriageLevel, number>> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export function triageRank(level: string): number {
  return TRIAGE_RANK[level as SupportTriageLevel] ?? TRIAGE_RANK.normal;
}

/* ── Evidence and contacts ─────────────────────────────────────────────────*/

export const SUPPORT_EVIDENCE_KINDS = [
  'screenshot',
  'campaign_version',
  'post_url',
  'tracking_information',
  'payment_record',
  'refund_record',
  'delivery_evidence',
  'message_record',
  'other',
] as const;
export type SupportEvidenceKind = (typeof SUPPORT_EVIDENCE_KINDS)[number];

export const SUPPORT_LINKED_RECORD_KINDS = [
  'campaign',
  'reservation',
  'association',
  'post_submission',
  'refund',
  'dispute',
  'payment',
  'none',
] as const;
export type SupportLinkedRecordKind = (typeof SUPPORT_LINKED_RECORD_KINDS)[number];

export const SUPPORT_CONTACT_PARTIES = ['founder', 'creator', 'backer', 'provider'] as const;
export type SupportContactParty = (typeof SUPPORT_CONTACT_PARTIES)[number];

export const CONTACT_IS_RECORDED_NOT_SENT =
  'This records who you contacted, what you asked for, and when you expect an answer. It does not send the message — send it yourself, then record it here so the case carries the whole story.';

export const EVIDENCE_IS_A_REFERENCE =
  'Evidence is recorded as a reference to the record it came from. File storage is not configured yet, so there is no upload here and nothing is silently dropped.';

/* ── The queue ─────────────────────────────────────────────────────────────*/

export const SUPPORT_QUEUE_FILTERS = [
  'all',
  'waiting_on_proovd',
  'waiting_on_someone_else',
  'unassigned',
  'resolved_closed',
] as const;
export type SupportQueueFilter = (typeof SUPPORT_QUEUE_FILTERS)[number];

/* ── History ───────────────────────────────────────────────────────────────*/

export const SUPPORT_HISTORY_SOURCES = [
  'support_cases',
  'support_case_messages',
  'support_case_assignments',
  'support_case_handoffs',
  'support_case_evidence',
  'support_case_contacts',
  'support_case_reopens',
  'notification_deliveries',
  'audit_events',
] as const;
export type SupportHistorySource = (typeof SUPPORT_HISTORY_SOURCES)[number];

export const SUPPORT_HISTORY_SECTIONS = [
  'ownership',
  'classification',
  'status',
  'evidence',
  'contact',
  'conversation',
] as const;
export type SupportHistorySection = (typeof SUPPORT_HISTORY_SECTIONS)[number];

/* ── The status/waiting-party mapping ──────────────────────────────────────*/

/**
 * The ONE place a waiting party becomes a `support_case_status`.
 *
 * Two columns describing overlapping facts is how they drift, so nothing else
 * writes `status` on a live case — every path goes through here and the 0045
 * CHECK refuses the combinations this function cannot produce.
 *
 * The three cases, and why the third is not the second:
 *
 *   - The party who ASKED owes the next move → `awaiting_customer`.
 *   - The Founder is the accountable owner (§26.7's `founder_coordinated`) and
 *     owes it → `awaiting_founder`, which is what §27.8's 48-hour follow-up
 *     clock keys on.
 *   - Anything else → `open`, because PROOVD still owes the customer the
 *     response. A Backer's tracking question that is blocked on a Creator is
 *     open with `waiting_on = 'creator'`: internally we are chasing somebody,
 *     and to the Backer we are still the ones who owe them an answer.
 */
export function statusForWaitingParty(input: {
  waitingOn: SupportWaitingParty;
  requesterKind: string;
  owner: SupportOwner;
}): SupportCaseStatus {
  if (input.waitingOn === input.requesterKind) return 'awaiting_customer';
  if (input.waitingOn === 'founder' && input.owner === 'founder_coordinated') {
    return 'awaiting_founder';
  }
  return 'open';
}

/* ── Derivations the surface reads ─────────────────────────────────────────*/

export type SupportChipTone = 'new' | 'wait' | 'done' | 'closed';

export function supportChip(input: {
  status: string;
  waitingOn: string | null;
  closedAt: Date | string | null;
  assigneeUserId: string | null;
}): { label: string; tone: SupportChipTone } {
  if (input.closedAt) return { label: 'Closed', tone: 'closed' };
  if (input.status === 'resolved') return { label: 'Resolved', tone: 'done' };
  if (!input.assigneeUserId) return { label: 'New', tone: 'new' };
  const party = input.waitingOn as SupportWaitingParty | null;
  if (party && SUPPORT_WAITING_PARTIES.includes(party)) {
    return { label: SUPPORT_WAITING_LABELS[party], tone: 'wait' };
  }
  return { label: 'Open', tone: 'wait' };
}

export function supportCaseIsOpen(input: {
  status: string;
  closedAt: Date | string | null;
}): boolean {
  return input.status !== 'resolved' && !input.closedAt;
}

/**
 * The sentence the queue and the case header show as "what happens next".
 *
 * Three answers, and the first two are DERIVED from an absence rather than
 * stored — a stored "this has no owner" sentence is one that survives the case
 * acquiring an owner. The third is what an Admin actually wrote.
 *
 * A resolved case returns null rather than a reassuring phrase: §1.4, there is
 * genuinely nothing outstanding, and inventing a sentence for it would put
 * words on a record nobody said.
 */
export function nextActionSentence(input: {
  status: string;
  closedAt: Date | string | null;
  assigneeUserId: string | null;
  nextAction: string | null;
}): string | null {
  if (!supportCaseIsOpen(input)) return null;
  if (!input.assigneeUserId) {
    return 'No Admin owns this case yet. Assign an owner before promising the customer a response.';
  }
  return input.nextAction ?? 'No next action has been recorded on this case yet.';
}

/**
 * Whether the case is blocked on Proovd doing something.
 *
 * Used for the queue's hero and its `waiting_on_proovd` filter. An unassigned
 * case counts, always: nobody outside Proovd can be waiting on a case that
 * nobody inside Proovd has picked up.
 */
export function blockedOnProovd(input: {
  status: string;
  closedAt: Date | string | null;
  waitingOn: string | null;
  assigneeUserId: string | null;
}): boolean {
  if (!supportCaseIsOpen(input)) return false;
  return !input.assigneeUserId || input.waitingOn === 'proovd';
}

/** §26.7's ten topics, re-exported so callers validate against one list. */
export { SUPPORT_TOPICS };
