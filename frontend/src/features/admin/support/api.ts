/**
 * The Support workspace API client.
 *
 * One rule, the same one `features/admin/api.ts` states: the server decides,
 * and its refusal is what the Admin reads. Nothing here composes a friendlier
 * message over a server one — the server already answers §27.1's six questions
 * in `whatHappened` / `next`, and paraphrasing it in the browser is how the two
 * start disagreeing.
 *
 * ── Two addresses, and the split is deliberate ──────────────────────────────
 * `/api/admin/support/workspace` is this surface's directory and case read.
 * `/api/admin/support/queue` is Phase 16b's §27.8 due/overdue queue, which the
 * `support-promises` sweep also drives — it is not called from here, and
 * collapsing the two would mean the daily SLA queue started returning resolved
 * cases from six weeks ago.
 *
 * ── The types are restated, not imported ────────────────────────────────────
 * `backend/src/support/workspace/types.ts` is the contract; the two packages
 * have separate build roots, so this mirrors it name-for-name. The vocabulary
 * types DO come from `@proovd/shared`, which both sides import.
 */

import type {
  SupportTopic,
  SupportOwner,
  SupportTriageLevel,
  SupportWaitingParty,
  SupportEvidenceKind,
  SupportLinkedRecordKind,
  SupportContactParty,
  SupportHistorySource,
  SupportHistorySection,
  SupportChipTone,
} from '@proovd/shared';
import { AdminRequestError, call } from '../api.js';

export { AdminRequestError };
export type { AdminError } from '../api.js';

/* ── The contract ───────────────────────────────────────────────────────────*/

export interface SupportChipView {
  label: string;
  tone: SupportChipTone;
}

export interface SupportDeadline {
  at: string;
  overdue: boolean;
  label: string;
}

export interface SupportRecordLink {
  label: string;
  href: string | null;
  unavailableBecause: string | null;
}

export interface SupportQueueRow {
  caseId: string;
  reference: string;
  subject: string;
  chip: SupportChipView;
  triage: SupportTriageLevel;
  topic: SupportTopic;
  topicLabel: string;
  requesterName: string;
  requesterKind: string;
  requesterKindLabel: string;
  campaignName: string | null;
  nextAction: string | null;
  assigneeName: string | null;
  responseDue: SupportDeadline | null;
  blockedOnProovd: boolean;
  open: boolean;
  searchText: string;
  createdAt: string;
}

export interface SupportQueueCounts {
  all: number;
  waiting_on_proovd: number;
  waiting_on_someone_else: number;
  unassigned: number;
  resolved_closed: number;
}

export interface SupportQueueView {
  rows: SupportQueueRow[];
  counts: SupportQueueCounts;
  hero: { title: string; detail: string };
  overdueCount: number;
}

export interface SupportThreadMessage {
  id: string;
  kind: 'in' | 'out' | 'note';
  author: string;
  counterparty: string | null;
  body: string;
  templateKey: string | null;
  delivery: string | null;
  occurredAt: string;
}

export interface SupportContextPanel {
  heading: string;
  fields: { label: string; value: string }[];
  links: SupportRecordLink[];
}

export interface SupportEvidenceRow {
  id: string;
  kind: SupportEvidenceKind;
  kindLabel: string;
  description: string;
  linkedKind: SupportLinkedRecordKind;
  linkedLabel: string;
  linkedReference: string | null;
  addedBy: string;
  occurredAt: string;
}

export interface SupportContactRow {
  id: string;
  partyKind: SupportContactParty;
  partyLabel: string;
  message: string;
  expectedResponseAt: string | null;
  outcome: string | null;
  outcomeRecordedAt: string | null;
  recordedBy: string;
  occurredAt: string;
}

export interface SupportHandoffRow {
  id: string;
  fromOwnerActor: string;
  toOwnerActor: string;
  verifiedFacts: string;
  currentOwner: string;
  nextCustomerPromise: string;
  statementsToKeepConsistent: string;
  occurredAt: string;
}

export interface SupportAssignmentRow {
  id: string;
  fromName: string | null;
  toName: string;
  reason: string | null;
  actor: string;
  occurredAt: string;
}

export interface SupportReopenRow {
  id: string;
  reason: string;
  priorResolution: string | null;
  priorResolvedAt: string | null;
  priorClosedAt: string | null;
  actor: string;
  occurredAt: string;
}

export interface SupportHistoryEntry {
  source: SupportHistorySource;
  section: SupportHistorySection;
  title: string;
  detail: string | null;
  actor: string | null;
  occurredAt: string;
}

export interface SupportCaseHeader {
  caseId: string;
  reference: string;
  subject: string;
  chip: SupportChipView;
  triage: SupportTriageLevel;
  triageLabel: string;
  topic: SupportTopic;
  topicLabel: string;
  subcategory: string | null;
  requesterName: string;
  requesterKind: string;
  requesterKindLabel: string;
  requesterEmail: string;
  campaignName: string | null;
  createdAt: string;
  open: boolean;
  nextAction: string | null;
  nextUpdateDue: SupportDeadline | null;
  blockedOnProovd: boolean;
}

export interface SupportOwnershipPane {
  owner: SupportOwner;
  ownerLabel: string;
  assigneeUserId: string | null;
  assigneeName: string | null;
  /** The server's answer, against the session — never a browser-side compare. */
  assignedToYou: boolean;
  assignedAt: string | null;
  previousAssigneeName: string | null;
  lastAssignmentReason: string | null;
  assignments: SupportAssignmentRow[];
  handoffs: SupportHandoffRow[];
}

export interface SupportNextResponsePane {
  status: string;
  waitingOn: SupportWaitingParty | null;
  waitingLabel: string | null;
  nextAction: string | null;
  nextUpdateDue: SupportDeadline | null;
  responseDue: SupportDeadline | null;
  calendarVersion: string;
  founderFollowupDue: SupportDeadline | null;
  lastResponseAt: string | null;
  resolution: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  reopens: SupportReopenRow[];
}

export interface SupportTemplateOption {
  key: string;
  label: string;
  specRef: string;
  useWhen: string;
}

export interface SupportCaseDetail {
  header: SupportCaseHeader;
  internalReason: string | null;
  thread: SupportThreadMessage[];
  context: SupportContextPanel;
  ownership: SupportOwnershipPane;
  nextResponse: SupportNextResponsePane;
  evidence: SupportEvidenceRow[];
  contacts: SupportContactRow[];
  history: SupportHistoryEntry[];
  templates: SupportTemplateOption[];
  contactableParties: { kind: SupportContactParty; label: string }[];
  assignableAdmins: { userId: string; name: string }[];
}

/* ── Reads ──────────────────────────────────────────────────────────────────*/

export function fetchSupportQueue(): Promise<SupportQueueView> {
  return call('/api/admin/support/workspace');
}

export function fetchSupportCase(caseId: string): Promise<SupportCaseDetail> {
  return call(`/api/admin/support/workspace/${encodeURIComponent(caseId)}`);
}

/**
 * A template rendered against this case's own facts.
 *
 * §26.8: the draft comes back WITH the facts that filled it, so the Admin sees
 * what came from the record. There is deliberately no route that sends one —
 * a template that sent itself would answer a person with a machine (§1.4).
 */
export interface RenderedTemplate {
  key: string;
  label: string;
  draft: string;
  preservedFacts: Record<string, string>;
  note: string;
}

export function fetchTemplate(caseId: string, templateKey: string): Promise<RenderedTemplate> {
  return call(
    `/api/admin/support/cases/${encodeURIComponent(caseId)}/templates/${encodeURIComponent(templateKey)}`,
  );
}

/* ── Writes ─────────────────────────────────────────────────────────────────*/

const post = <T = unknown>(path: string, body: unknown): Promise<T> =>
  call(path, { method: 'POST', body: JSON.stringify(body) });

const casePath = (caseId: string, suffix: string) =>
  `/api/admin/support/cases/${encodeURIComponent(caseId)}/${suffix}`;

/**
 * Reply to the customer, or add an internal note.
 *
 * One function because it is one route and one record — the difference is
 * `customerFacing`, which is the column §33.9.11 is really about. The server
 * refuses a provider or fraud code on the customer-facing branch only; a note
 * may carry one, because that is where it is useful.
 */
export function addMessage(
  caseId: string,
  body: {
    customerFacing: boolean;
    body: string;
    templateKey?: string | null;
    nextPromisedUpdateAt?: string | null;
  },
): Promise<{ messageId: string }> {
  return post(casePath(caseId, 'messages'), { direction: 'outbound', ...body });
}

/** `assignToSelf` resolves to the SESSION's user, never to anything in the body. */
export function assignCase(
  caseId: string,
  body: { toUserId?: string; assignToSelf?: boolean; reason?: string | null },
): Promise<unknown> {
  return post(casePath(caseId, 'assign'), body);
}

export function classifyCase(
  caseId: string,
  body: { topic: SupportTopic; subcategory?: string | null; internalReason?: string | null },
): Promise<unknown> {
  return post(casePath(caseId, 'classify'), body);
}

export function setTriage(caseId: string, triage: SupportTriageLevel): Promise<unknown> {
  return post(casePath(caseId, 'triage'), { triage });
}

export function setWaiting(
  caseId: string,
  body: {
    waitingOn: SupportWaitingParty;
    nextAction: string;
    nextPromisedUpdateAt?: string | null;
  },
): Promise<unknown> {
  return post(casePath(caseId, 'waiting'), body);
}

export function setNextUpdate(caseId: string, at: string): Promise<unknown> {
  return post(casePath(caseId, 'next-update'), { at });
}

export function resolveCase(
  caseId: string,
  body: { resolution: string; operationalNote?: string | null },
): Promise<unknown> {
  return post(casePath(caseId, 'resolve'), body);
}

export function closeCase(caseId: string): Promise<unknown> {
  return post(casePath(caseId, 'close'), {});
}

export function reopenCase(caseId: string, reason: string): Promise<unknown> {
  return post(casePath(caseId, 'reopen'), { reason });
}

export function addEvidence(
  caseId: string,
  body: {
    kind: SupportEvidenceKind;
    description: string;
    linkedKind?: SupportLinkedRecordKind;
    linkedReference?: string | null;
  },
): Promise<unknown> {
  return post(casePath(caseId, 'evidence'), body);
}

/** Records the coordination. It sends nothing — see `CONTACT_IS_RECORDED_NOT_SENT`. */
export function recordContact(
  caseId: string,
  body: {
    partyKind: SupportContactParty;
    partyLabel: string;
    message: string;
    expectedResponseAt?: string | null;
  },
): Promise<unknown> {
  return post(casePath(caseId, 'contacts'), body);
}

export function recordContactOutcome(
  caseId: string,
  contactId: string,
  outcome: string,
): Promise<unknown> {
  return post(casePath(caseId, `contacts/${encodeURIComponent(contactId)}/outcome`), { outcome });
}

/** Opening a case by hand — §26.7's own route, which this surface reuses. */
export function createCase(body: {
  topic: SupportTopic;
  owner: SupportOwner;
  requesterKind: 'backer' | 'founder' | 'creator';
  requesterEmail: string;
  requesterUserId?: string;
  backerIdentityId?: string;
  campaignId?: string;
  message: string;
}): Promise<{ caseId: string; reference: string; acknowledgement: string }> {
  return post('/api/admin/support/cases', body);
}

export function setSubject(caseId: string, subject: string): Promise<unknown> {
  return call(`/api/admin/support/cases/${encodeURIComponent(caseId)}/subject`, {
    method: 'PUT',
    body: JSON.stringify({ subject }),
  });
}
