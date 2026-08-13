/**
 * The Support workspace contract — what `/api/admin/support/*` answers with.
 *
 * The frontend mirrors these names rather than importing them: the two packages
 * have separate build roots, which is the same arrangement the Founder and
 * Creator workspaces use. The vocabulary types come from `@proovd/shared`,
 * which both sides do import.
 *
 * ── Three ids, and confusing them is the mistake that matters ───────────────
 *   `caseId`         — the case's UUID. What every route is addressed by.
 *   `reference`      — the quotable `PVD-XXXXX-XXXXX` a customer was given. It
 *                      is NOT the UUID and is never used as an address; §27.8
 *                      makes it the thing a person reads back over the phone.
 *   `assigneeUserId` — a real Better Auth Admin account. The reference
 *                      prototype's flat name list and hardcoded `ME` both
 *                      become this, and it is read from the session on the
 *                      server, never from a request body.
 *
 * ── Everything is resolved server-side ─────────────────────────────────────
 * A pane composes rows and derives nothing. §26.2 needs a `prior_value` to
 * record an override against, and a value the browser worked out has no before
 * — the same rule the Creator workspace's `shared.tsx` states.
 */

import type { SupportTopic, SupportOwner, SupportCaseStatus } from '../logic.js';
import type {
  SupportWaitingParty,
  SupportTriageLevel,
  SupportEvidenceKind,
  SupportLinkedRecordKind,
  SupportContactParty,
  SupportHistorySource,
  SupportHistorySection,
  SupportChipTone,
} from './logic.js';

/* ── Shared shapes ─────────────────────────────────────────────────────────*/

export interface SupportChipView {
  label: string;
  tone: SupportChipTone;
}

/**
 * A deadline and whether it has passed.
 *
 * `overdue` is computed against the read's own `now`, never stored: a stored
 * overdue flag is one that stays true after somebody answers, and §27.8's whole
 * point is that a breach is visible while it is still a breach.
 */
export interface SupportDeadline {
  at: string;
  overdue: boolean;
  /** e.g. `due in 2h`, `2 days late`. Relative, so it needs no timezone. */
  label: string;
}

/**
 * A pointer into a record that lives in its own workspace.
 *
 * The Support case LINKS to a Founder, a Creator, a campaign, or a pre-order;
 * it never reproduces their controls. A second place to operate a campaign is
 * how two surfaces come to disagree about its state — the same reasoning the
 * Campaigns-tab note in CLAUDE.md records.
 */
export interface SupportRecordLink {
  label: string;
  /** In-app path, or null when the record exists but has no workspace yet. */
  href: string | null;
  /** Why it has no address, when it has none. §1.4: say it rather than imply it. */
  unavailableBecause: string | null;
}

/* ── The queue ─────────────────────────────────────────────────────────────*/

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
  /** §27.1's "what next", already resolved — including the no-owner sentence. */
  nextAction: string | null;
  assigneeName: string | null;
  responseDue: SupportDeadline | null;
  /** True when Proovd owes the next move, including every unassigned case. */
  blockedOnProovd: boolean;
  open: boolean;
  /** One server-composed string the search box matches against. */
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
  /** The hero sentence, composed from what is actually true right now. */
  hero: { title: string; detail: string };
  /** §27.8's own numbers, kept beside the workspace's. */
  overdueCount: number;
}

/* ── The case ──────────────────────────────────────────────────────────────*/

export interface SupportThreadMessage {
  id: string;
  /** `in` from the customer, `out` to them, `note` internal-only (§33.9.11). */
  kind: 'in' | 'out' | 'note';
  author: string;
  counterparty: string | null;
  body: string;
  templateKey: string | null;
  /** Whether the provider accepted it. Never a read receipt (§27, no pixel). */
  delivery: string | null;
  occurredAt: string;
}

export interface SupportContextField {
  label: string;
  value: string;
}

/**
 * The right-hand panel, already shaped for the requester it belongs to.
 *
 * The reference branches on requester type in the view; here the server decides,
 * because which facts are legitimate to show differs by role (§11 keeps a
 * Founder from seeing a Creator's contact details) and that is an authorization
 * question, not a rendering one.
 */
export interface SupportContextPanel {
  heading: string;
  fields: SupportContextField[];
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
  /** Which existing table this was READ FROM. There is no event store (§26.8). */
  source: SupportHistorySource;
  section: SupportHistorySection;
  title: string;
  detail: string | null;
  actor: string | null;
  occurredAt: string;
}

export interface SupportTemplateOption {
  key: string;
  label: string;
  specRef: string;
  useWhen: string;
}

/** The one place the header's state is decided, so no tab can contradict it. */
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
  /** Renders the header's blocked band. Null on a finished case. */
  nextAction: string | null;
  nextUpdateDue: SupportDeadline | null;
  blockedOnProovd: boolean;
}

export interface SupportOwnershipPane {
  /** §26.7's accountable ORGANISATION — what Appendix B.8 told the customer. */
  owner: SupportOwner;
  ownerLabel: string;
  /** The named human. Null is a real state and the queue leads with it. */
  assigneeUserId: string | null;
  assigneeName: string | null;
  /**
   * Whether the case already belongs to the Admin reading it.
   *
   * Decided by the SERVER against the session, not by the browser comparing
   * ids: the surface hides "Assign to me" on a case that is already yours, and
   * a control whose only effect is already true is one §1.4 says not to offer.
   * Deriving it in the browser would need the session id shipped to the client
   * purely so it could be compared with one the server already holds.
   */
  assignedToYou: boolean;
  assignedAt: string | null;
  previousAssigneeName: string | null;
  lastAssignmentReason: string | null;
  assignments: SupportAssignmentRow[];
  handoffs: SupportHandoffRow[];
}

export interface SupportNextResponsePane {
  status: SupportCaseStatus;
  waitingOn: SupportWaitingParty | null;
  waitingLabel: string | null;
  nextAction: string | null;
  nextUpdateDue: SupportDeadline | null;
  /** §27.8's one-business-day promise, with the calendar version that made it. */
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

export interface SupportCaseDetail {
  header: SupportCaseHeader;
  /** Internal-only classification detail. Never leaves the Admin view (§26.8). */
  internalReason: string | null;
  thread: SupportThreadMessage[];
  context: SupportContextPanel;
  ownership: SupportOwnershipPane;
  nextResponse: SupportNextResponsePane;
  evidence: SupportEvidenceRow[];
  contacts: SupportContactRow[];
  history: SupportHistoryEntry[];
  templates: SupportTemplateOption[];
  /** Which parties this case can coordinate with, given who asked. */
  contactableParties: { kind: SupportContactParty; label: string }[];
  /** Real Admin accounts, for the assign control. Never a hardcoded list. */
  assignableAdmins: { userId: string; name: string }[];
}
