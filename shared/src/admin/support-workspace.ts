/**
 * The Support Admin workspace registers — §26.7, §26.8, §27.8, §29.9, §29.10.
 *
 * Built from the supplied Support reference (`docs/design-refrence/
 * Proovd-Support-Admin.html`) on top of the case domain Phase 16b already
 * shipped. The reference is a behaviour and data-shape guide; it is not the
 * schema, and where the two disagree the Spec wins (§1.8). Three places they
 * disagree, and each is resolved here rather than in a component:
 *
 *   1. **Categories.** The reference carries thirteen of its own. §26.7 already
 *      fixes ten support topics and they are the ones the Backer-facing ask,
 *      the Appendix B.8 acknowledgement, and `RESPONSE_TEMPLATES` all speak.
 *      A second taxonomy would mean a case opened by a Backer and a case opened
 *      by an Admin were classified on different lists. So the ten stand, and
 *      the reference's extra distinctions live in the free-text subcategory.
 *
 *   2. **Priority.** The reference says priority "drives queue order and
 *      response expectations". The second half would be a new commercial rule:
 *      §27.8 publishes ONE response promise — one business day, every case,
 *      every topic — and a priority that shortened or lengthened it is a
 *      promise nobody agreed to (§1 rule 6). So triage exists, it orders the
 *      Admin's own queue, and `TRIAGE_NEVER_CHANGES_THE_PROMISE` rides the
 *      control that sets it.
 *
 *   3. **`ME` and the ADMINS list.** The reference hardcodes a current user and
 *      a flat list of names. Both become real Better Auth Admin accounts, and
 *      the assignee is read from the session server-side — never from a request
 *      body, which is the identity mistake `routes/vetting.ts` records.
 *
 * ── Nothing here is a second copy of a §26.7 register ────────────────────────
 * `SUPPORT_TOPICS`, `SUPPORT_OWNERS`, and `SUPPORT_CASE_STATUSES` stay where
 * Phase 16b put them. This file adds only what the workspace introduces.
 */

/* ── Who a case is waiting on (§27.1's "who owns it") ───────────────────────*/

/**
 * The party that owes the next action.
 *
 * §26.7's `owner` answers a different question — whether PROOVD or the FOUNDER
 * is accountable for the response — and it is what Appendix B.8 tells the
 * customer. This answers "who is the case blocked on right now", which moves
 * many times inside one owner. Keeping them apart is why a case owned by
 * Proovd can truthfully read "Waiting on Stripe".
 */
export const SUPPORT_WAITING_PARTIES = [
  'proovd',
  'founder',
  'creator',
  'backer',
  'provider',
] as const;
export type SupportWaitingParty = (typeof SUPPORT_WAITING_PARTIES)[number];

/**
 * What each party reads as in the Admin view.
 *
 * `provider` renders as Stripe by name because §26.8 permits provider detail in
 * the Admin view and an operator needs to know which dashboard to open. It is
 * never rendered to a customer — no customer surface reads this register.
 */
export const SUPPORT_WAITING_LABELS: Readonly<Record<SupportWaitingParty, string>> = {
  proovd: 'Waiting on Proovd',
  founder: 'Waiting on Founder',
  creator: 'Waiting on Creator',
  backer: 'Waiting on Backer',
  provider: 'Waiting on Stripe',
};

/** The short word for the party alone, used where "Waiting on" is already said. */
export const SUPPORT_PARTY_NOUNS: Readonly<Record<SupportWaitingParty, string>> = {
  proovd: 'Proovd',
  founder: 'Founder',
  creator: 'Creator',
  backer: 'Backer',
  provider: 'Stripe',
};

/* ── Triage (§27.8) ────────────────────────────────────────────────────────*/

export const SUPPORT_TRIAGE_LEVELS = ['urgent', 'high', 'normal', 'low'] as const;
export type SupportTriageLevel = (typeof SUPPORT_TRIAGE_LEVELS)[number];

export const SUPPORT_TRIAGE_LABELS: Readonly<Record<SupportTriageLevel, string>> = {
  urgent: 'Urgent',
  high: 'High',
  normal: 'Normal',
  low: 'Low',
};

/**
 * Pinned, and it sits WITH the triage control rather than under it.
 *
 * The sentence exists because the reference's own modal says the opposite. An
 * Admin who believes triage moves the deadline will tell a customer it did, and
 * §27.8's promise is published — it is the same for every case.
 */
export const TRIAGE_NEVER_CHANGES_THE_PROMISE =
  'Triage orders this queue and nothing else. The response promise is one business day on every case, whatever the triage level.';

/* ── The queue (§27.8) ─────────────────────────────────────────────────────*/

export const SUPPORT_QUEUE_FILTERS = [
  'all',
  'waiting_on_proovd',
  'waiting_on_someone_else',
  'unassigned',
  'resolved_closed',
] as const;
export type SupportQueueFilter = (typeof SUPPORT_QUEUE_FILTERS)[number];

/**
 * Each filter with the label an Admin reads and the definition of what it
 * counts.
 *
 * The definition ships beside the count for §20's reason: two people reading
 * "waiting on someone else" differently is the ordinary failure of an
 * operations queue, and a count with no definition is the number they argue
 * about.
 */
export interface SupportFilterDefinition {
  readonly key: SupportQueueFilter;
  readonly label: string;
  readonly counts: string;
}

export const SUPPORT_FILTER_DEFINITIONS: readonly SupportFilterDefinition[] = [
  { key: 'all', label: 'All', counts: 'Every case on the record, open or finished.' },
  {
    key: 'waiting_on_proovd',
    label: 'Waiting on Proovd',
    counts: 'Open cases where Proovd owes the next action — including every case with no assignee.',
  },
  {
    key: 'waiting_on_someone_else',
    label: 'Waiting on someone else',
    counts: 'Open cases blocked on a named outside party: a Founder, a Creator, a Backer, or Stripe.',
  },
  {
    key: 'unassigned',
    label: 'Unassigned',
    counts: 'Open cases with no named Admin. Nobody owes the customer a response until one is assigned.',
  },
  {
    key: 'resolved_closed',
    label: 'Resolved & closed',
    counts: 'Finished cases. Nothing here is deleted and any of it can be reopened.',
  },
];

/* ── Evidence (§24.11's posture, applied to a case) ────────────────────────*/

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

export const SUPPORT_EVIDENCE_LABELS: Readonly<Record<SupportEvidenceKind, string>> = {
  screenshot: 'Screenshot',
  campaign_version: 'Campaign version',
  post_url: 'Post URL',
  tracking_information: 'Tracking information',
  payment_record: 'Payment record',
  refund_record: 'Refund record',
  delivery_evidence: 'Delivery evidence',
  message_record: 'Email or message record',
  other: 'Other supporting reference',
};

/**
 * Which existing record a piece of evidence points back at.
 *
 * A register rather than free text for §26.2's reason: a link an Admin typed is
 * a link that can point at nothing, and evidence pointing at nothing looks
 * complete in a dispute packet while proving none of it.
 */
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

export const SUPPORT_LINKED_RECORD_LABELS: Readonly<
  Record<SupportLinkedRecordKind, string>
> = {
  campaign: 'Campaign',
  reservation: 'Pre-order',
  association: 'Creator relationship',
  post_submission: 'Creator post',
  refund: 'Refund',
  dispute: 'Dispute',
  payment: 'Payment',
  none: 'No linked record',
};

/**
 * Evidence is a recorded REFERENCE, never an upload — and this says why.
 *
 * §12's R2 bucket is Track A4 and unconfigured, so `unconfiguredStorage` throws
 * exactly as the transport does. A file control that could not store a file
 * would be the §1.4 failure, so there is none, and the absence is explained
 * where an Admin would otherwise go looking for it.
 */
export const EVIDENCE_IS_A_REFERENCE =
  'Evidence is recorded as a reference to the record it came from. File storage is not configured yet, so there is no upload here and nothing is silently dropped.';

/* ── Contacting a party outside the thread (§26.8, §30) ────────────────────*/

export const SUPPORT_CONTACT_PARTIES = ['founder', 'creator', 'backer', 'provider'] as const;
export type SupportContactParty = (typeof SUPPORT_CONTACT_PARTIES)[number];

export const SUPPORT_CONTACT_LABELS: Readonly<Record<SupportContactParty, string>> = {
  founder: 'the Founder',
  creator: 'the Creator',
  backer: 'the Backer',
  provider: 'Stripe',
};

/**
 * Pinned, and it is the consequence line on the contact control.
 *
 * The reference's modal says "A separate message goes to <who>". §27 defines no
 * key for an Admin contacting a party about a case — the four support keys are
 * the Backer acknowledgement, the Founder-response relay, the SLA breach, and
 * the promised follow-up — and inventing a fifth would be §1 rule 6 applied to
 * a message. So this records the coordination and does not claim to send it.
 * §1.4: presenting a manual step truthfully is the whole rule.
 */
export const CONTACT_IS_RECORDED_NOT_SENT =
  'This records who you contacted, what you asked for, and when you expect an answer. It does not send the message — send it yourself, then record it here so the case carries the whole story.';

/* ── The four tabs (§26.8) ─────────────────────────────────────────────────*/

export const SUPPORT_CASE_TABS = ['conversation', 'case', 'evidence', 'history'] as const;
export type SupportCaseTab = (typeof SUPPORT_CASE_TABS)[number];

export const SUPPORT_CASE_TAB_LABELS: Readonly<Record<SupportCaseTab, string>> = {
  conversation: 'Conversation',
  case: 'Case & ownership',
  evidence: 'Evidence & contact',
  history: 'History',
};

/* ── The composed case history (§26.8) ─────────────────────────────────────*/

/**
 * Where a history entry was READ FROM.
 *
 * There is no `support_case_events` table and there must never be one: §26.8's
 * trap is that a second event store which drifts from the first is worse than
 * no timeline. Every entry names its source table, so the claim that the
 * history composes rather than duplicates is checkable from the response.
 */
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

/** Which section of the case a history entry belongs to, for the per-section reads. */
export const SUPPORT_HISTORY_SECTIONS = [
  'ownership',
  'classification',
  'status',
  'evidence',
  'contact',
  'conversation',
] as const;
export type SupportHistorySection = (typeof SUPPORT_HISTORY_SECTIONS)[number];

export const SUPPORT_HISTORY_SECTION_LABELS: Readonly<
  Record<SupportHistorySection, string>
> = {
  ownership: 'Ownership',
  classification: 'Classification',
  status: 'Status',
  evidence: 'Evidence',
  contact: 'Contact',
  conversation: 'Conversation',
};

/* ── The chip a case reads as ──────────────────────────────────────────────*/

export type SupportChipTone = 'new' | 'wait' | 'done' | 'closed';

export interface SupportChip {
  readonly label: string;
  readonly tone: SupportChipTone;
}

/**
 * The one derivation of what a case's chip says.
 *
 * Derived rather than stored, because a stored chip is a fifth state that can
 * disagree with the four the machine actually has. `closed` is deliberately NOT
 * a `support_case_status` value: five modules read `status <> 'resolved'` to
 * mean "still open", and a fifth enum member would silently put every closed
 * case back in the SLA queue. Closing is a stamp on a resolved case.
 */
export function supportChip(input: {
  status: string;
  waitingOn: string | null;
  closedAt: string | null;
  assigneeUserId: string | null;
}): SupportChip {
  if (input.closedAt) return { label: 'Closed', tone: 'closed' };
  if (input.status === 'resolved') return { label: 'Resolved', tone: 'done' };
  // "New" is not a status either — it is the absence of an assignee on a case
  // nobody has answered. Deriving it means it can never be left behind on a
  // case somebody has since picked up.
  if (!input.assigneeUserId) return { label: 'New', tone: 'new' };
  const party = input.waitingOn as SupportWaitingParty | null;
  if (party && SUPPORT_WAITING_PARTIES.includes(party)) {
    return { label: SUPPORT_WAITING_LABELS[party], tone: 'wait' };
  }
  return { label: 'Open', tone: 'wait' };
}

/** Whether a case is still live work. One definition, read by every surface. */
export function supportCaseIsOpen(input: { status: string; closedAt: string | null }): boolean {
  return input.status !== 'resolved' && !input.closedAt;
}

/* ── The gap register (§1.4) ───────────────────────────────────────────────*/

export const SUPPORT_PARKED_MESSAGES = {
  attachment_upload:
    'Evidence files cannot be uploaded yet — the storage bucket is not configured (Track A4). Record the evidence as a reference to the record it came from instead.',
  delivery_receipt:
    'Read receipts are not recorded. §27 ships no tracking pixel, and adding one would put a silent read receipt inside a transactional message. The delivery record shows whether the provider accepted the message.',
  contact_outcome_chase:
    'There is no reminder for an outstanding contact. §30 forbids automated engagement sequences, so this is a date you check rather than one that chases anybody.',
  merge_cases:
    'Cases cannot be merged. §26.8 keeps every case its own record with its own reference, and merging would destroy the reference a customer was already given.',
  bulk_actions:
    'There is no bulk action. Every §26.7 decision is recorded with its own actor and reason, and a bulk control is one reason applied to cases nobody read.',
} as const;

export type SupportParkedKey = keyof typeof SUPPORT_PARKED_MESSAGES;

/* ── What the workspace refuses to become (§30) ────────────────────────────*/

/**
 * Words the Support surfaces must not carry, checked by test.
 *
 * The first four are §30's engagement machinery arriving through an operations
 * screen; `satisfaction score` and `csat` are the metric that turns a support
 * queue into a scoreboard, which §30's leaderboard ban and §31.9's measurement
 * boundary both refuse.
 */
export const SUPPORT_BANNED_TERMS = [
  'auto-reply',
  'auto reply',
  'autoresponder',
  'canned response',
  'csat',
  'satisfaction score',
  'agent leaderboard',
] as const;
