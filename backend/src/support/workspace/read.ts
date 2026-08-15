/**
 * The Support workspace reads — §26.7, §26.8, §27.8.
 *
 * Two reads and no third: the queue, and one case with everything four tabs
 * need. The case read is one call rather than one per tab because an Admin
 * opening "Case & ownership" has already acted on what "Conversation" told
 * them, and a round trip per tab is a second chance for the two to disagree
 * about what state the case is in — the reasoning the Creator relationship read
 * records.
 *
 * ── Nothing here writes ─────────────────────────────────────────────────────
 * Not the queue, not the case, not the history. A read that stamps something is
 * a read you cannot run twice while investigating, and §26.8's timeline is
 * explicitly a composition over records that already exist.
 *
 * ── The requester's name is resolved from the record that owns it ──────────
 * A Backer has no account (§5.4), so their identity is the campaign-scoped
 * `backer_identities` row. A Creator is an `affiliate_prospects` row reached
 * through the association. A Founder is a `founder_prospects` row reached
 * through the campaign's draft. The case stores an email and a kind; it does
 * not store a display name, because a name copied onto the case is one that
 * stops matching the record it came from.
 */

import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { campaigns, campaignAffiliateAssociations } from '../../db/schema/domain.js';
import { campaignBuild } from '../../db/schema/build.js';
import { campaignDrafts, founderProspects } from '../../db/schema/invitations.js';
import { affiliateProspects } from '../../db/schema/affiliates.js';
import { backerIdentities } from '../../db/schema/reservations.js';
import { user } from '../../db/schema/auth.js';
import {
  supportCases,
  supportCaseMessages,
  supportCaseHandoffs,
  supportCaseAssignments,
  supportCaseEvidence,
  supportCaseContacts,
  supportCaseReopens,
} from '../../db/schema/support.js';
import { auditEvents, notificationDeliveries } from '../../db/schema/integrity.js';
import {
  SUPPORT_TOPIC_LABELS,
  SUPPORT_OWNER_LABELS,
  type SupportTopic,
  type SupportOwner,
  type SupportCaseStatus,
} from '../logic.js';
import { RESPONSE_TEMPLATES } from '../templates.js';
import {
  SUPPORT_WAITING_LABELS,
  SUPPORT_PARTY_NOUNS,
  supportChip,
  supportCaseIsOpen,
  nextActionSentence,
  blockedOnProovd,
  triageRank,
  type SupportWaitingParty,
  type SupportTriageLevel,
  type SupportEvidenceKind,
  type SupportLinkedRecordKind,
  type SupportContactParty,
} from './logic.js';
import type {
  SupportQueueView,
  SupportQueueRow,
  SupportQueueCounts,
  SupportCaseDetail,
  SupportDeadline,
  SupportContextPanel,
  SupportRecordLink,
  SupportThreadMessage,
  SupportHistoryEntry,
} from './types.js';

/* ── Labels ────────────────────────────────────────────────────────────────*/

const REQUESTER_KIND_LABELS: Readonly<Record<string, string>> = {
  backer: 'Backer',
  founder: 'Founder',
  creator: 'Creator',
};

const TRIAGE_LABELS: Readonly<Record<string, string>> = {
  urgent: 'Urgent',
  high: 'High',
  normal: 'Normal',
  low: 'Low',
};

const EVIDENCE_LABELS: Readonly<Record<string, string>> = {
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

const LINKED_LABELS: Readonly<Record<string, string>> = {
  campaign: 'Campaign',
  reservation: 'Pre-order',
  association: 'Creator relationship',
  post_submission: 'Creator post',
  refund: 'Refund',
  dispute: 'Dispute',
  payment: 'Payment',
  none: 'No linked record',
};

/* ── Deadlines ─────────────────────────────────────────────────────────────*/

/**
 * A deadline with a relative label.
 *
 * Relative on purpose: §27.1 requires a spelled-out timezone wherever an
 * absolute instant is shown to a person, and `due in 2h` carries no instant to
 * misread. The absolute value rides alongside as an ISO string, and the browser
 * renders it in the reader's own zone with UTC secondary.
 */
function deadline(at: Date | null, now: Date): SupportDeadline | null {
  if (!at) return null;
  const ms = at.getTime() - now.getTime();
  const overdue = ms <= 0;
  const mins = Math.round(Math.abs(ms) / 60_000);
  const hours = Math.round(Math.abs(ms) / 3_600_000);
  const days = Math.round(Math.abs(ms) / 86_400_000);

  let span: string;
  if (mins < 60) span = `${Math.max(mins, 1)}m`;
  else if (hours < 48) span = `${hours}h`;
  else span = `${days} days`;

  return {
    at: at.toISOString(),
    overdue,
    label: overdue ? `${span} late` : `due in ${span}`,
  };
}

/* ── Identity resolution ───────────────────────────────────────────────────*/

interface CaseIdentity {
  requesterName: string;
  campaignName: string | null;
  founderName: string | null;
  businessName: string | null;
  creatorName: string | null;
  creatorHandle: string | null;
}

/**
 * Resolve the display facts for a set of cases in one pass.
 *
 * Batched by subject rather than queried per row: the queue renders every open
 * case, and a per-row lookup is the shape that makes an operations list slow
 * enough that people stop opening it.
 */
async function resolveIdentities(
  db: Database,
  rows: { id: string; requesterKind: string; requesterEmail: string; campaignId: string | null; associationId: string | null; backerIdentityId: string | null }[],
): Promise<Map<string, CaseIdentity>> {
  const out = new Map<string, CaseIdentity>();
  if (rows.length === 0) return out;

  const campaignIds = [...new Set(rows.map((r) => r.campaignId).filter((x): x is string => !!x))];
  const associationIds = [
    ...new Set(rows.map((r) => r.associationId).filter((x): x is string => !!x)),
  ];
  const backerIds = [
    ...new Set(rows.map((r) => r.backerIdentityId).filter((x): x is string => !!x)),
  ];

  // Campaign → title + the Founder behind it. The join runs
  // campaigns → campaign_drafts → founder_prospects, which is how every other
  // module in this codebase reaches a campaign's Founder.
  const campaignRows = campaignIds.length
    ? await db
        .select({
          campaignId: campaigns.id,
          title: campaignBuild.title,
          product: founderProspects.productName,
          founderName: founderProspects.legalName,
          preferredName: founderProspects.preferredName,
          company: founderProspects.businessName,
        })
        .from(campaigns)
        .leftJoin(campaignBuild, eq(campaignBuild.campaignId, campaigns.id))
        .leftJoin(campaignDrafts, eq(campaignDrafts.campaignId, campaigns.id))
        .leftJoin(founderProspects, eq(founderProspects.id, campaignDrafts.prospectId))
        .where(inArray(campaigns.id, campaignIds))
    : [];
  const byCampaign = new Map(campaignRows.map((r) => [r.campaignId, r]));

  // Association → the Creator. `affiliate_id` holds the PROSPECT id, not an
  // account id — `affiliates/workspace/types.ts` states it, and anything that
  // keyed a lookup off it as a user id would resolve a UUID nobody owns.
  const associationRows = associationIds.length
    ? await db
        .select({
          associationId: campaignAffiliateAssociations.id,
          legalName: affiliateProspects.legalName,
          handle: affiliateProspects.publicHandle,
        })
        .from(campaignAffiliateAssociations)
        .leftJoin(
          affiliateProspects,
          eq(affiliateProspects.id, campaignAffiliateAssociations.affiliateId),
        )
        .where(inArray(campaignAffiliateAssociations.id, associationIds))
    : [];
  const byAssociation = new Map(associationRows.map((r) => [r.associationId, r]));

  const backerRows = backerIds.length
    ? await db
        .select({ id: backerIdentities.id, email: backerIdentities.email })
        .from(backerIdentities)
        .where(inArray(backerIdentities.id, backerIds))
    : [];
  const byBacker = new Map(backerRows.map((r) => [r.id, r]));

  for (const row of rows) {
    const campaign = row.campaignId ? byCampaign.get(row.campaignId) : undefined;
    const association = row.associationId ? byAssociation.get(row.associationId) : undefined;
    const backer = row.backerIdentityId ? byBacker.get(row.backerIdentityId) : undefined;

    const founderName = campaign?.preferredName ?? campaign?.founderName ?? null;
    const creatorName = association?.legalName ?? null;
    const creatorHandle = association?.handle ?? null;

    // A Backer has no name anywhere in the product — §19 collects an email and
    // a phone, never a name — so their address IS their identity here. Showing
    // it is correct in the Admin view and is what support actually works from.
    const requesterName =
      row.requesterKind === 'founder'
        ? (founderName ?? row.requesterEmail)
        : row.requesterKind === 'creator'
          ? (creatorHandle ?? creatorName ?? row.requesterEmail)
          : (backer?.email ?? row.requesterEmail);

    out.set(row.id, {
      requesterName,
      campaignName: campaign?.title ?? campaign?.product ?? null,
      founderName,
      businessName: campaign?.company ?? null,
      creatorName,
      creatorHandle,
    });
  }

  return out;
}

/** Admin display names, batched. The reference's flat `ADMINS` list, made real. */
async function resolveAdminNames(
  db: Database,
  userIds: string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(inArray(user.id, ids));
  return new Map(rows.map((r) => [r.id, r.name || r.email]));
}

/* ── The queue ─────────────────────────────────────────────────────────────*/

/**
 * Every case, with the counts each filter reports.
 *
 * Deliberately NOT `readSupportQueue`, which stays exactly as Phase 16b built
 * it: that one answers §27.8's "what is due or overdue today" and is what the
 * `support-promises` sweep drives. This one is the workspace directory — it
 * shows finished cases too, because the reference's fifth filter is
 * "Resolved & closed" and a queue that hid them could not answer "what did we
 * tell this person last month".
 *
 * The filters are counted on the SERVER. §26.2 needs a `prior_value` to record
 * an override against and a browser-derived count has no before — and more
 * practically, two derivations of "waiting on someone else" are two answers
 * waiting to disagree.
 */
export async function readSupportWorkspaceQueue(
  db: Database,
  options: { now?: Date } = {},
): Promise<SupportQueueView> {
  const now = options.now ?? new Date();

  const rows = await db
    .select()
    .from(supportCases)
    .orderBy(desc(supportCases.createdAt))
    .limit(500);

  const identities = await resolveIdentities(db, rows);
  const adminNames = await resolveAdminNames(
    db,
    rows.map((r) => r.assigneeUserId).filter((x): x is string => !!x),
  );

  const queueRows: SupportQueueRow[] = rows.map((row) => {
    const identity = identities.get(row.id);
    const open = supportCaseIsOpen(row);
    const topic = row.topic as SupportTopic;
    const topicLabel = SUPPORT_TOPIC_LABELS[topic] ?? row.topic;
    const requesterName = identity?.requesterName ?? row.requesterEmail;
    const campaignName = identity?.campaignName ?? null;
    const assigneeName = row.assigneeUserId
      ? (adminNames.get(row.assigneeUserId) ?? row.assigneeUserId)
      : null;

    // A subject is optional on a case opened through the Backer support path —
    // §29.9's ask has a message, not a title. Falling back to the topic label
    // is honest: it is what the person actually chose.
    const subject = row.subject ?? topicLabel;

    return {
      caseId: row.id,
      reference: row.reference,
      subject,
      chip: supportChip(row),
      triage: row.triagePriority as SupportTriageLevel,
      topic,
      topicLabel,
      requesterName,
      requesterKind: row.requesterKind,
      requesterKindLabel: REQUESTER_KIND_LABELS[row.requesterKind] ?? row.requesterKind,
      campaignName,
      nextAction: nextActionSentence(row),
      assigneeName,
      responseDue: open ? deadline(row.humanResponseDueAt, now) : null,
      blockedOnProovd: blockedOnProovd(row),
      open,
      // One string, composed once, so the search box and the counts can never
      // disagree about what matches. The campaign name is in it deliberately:
      // typing a campaign should find the cases on it.
      searchText: [
        row.reference,
        subject,
        requesterName,
        row.requesterEmail,
        REQUESTER_KIND_LABELS[row.requesterKind] ?? row.requesterKind,
        campaignName,
        topicLabel,
        row.subcategory,
        assigneeName,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase(),
      createdAt: row.createdAt.toISOString(),
    };
  });

  // Overdue first, then triage, then the nearest deadline. A queue sorted by
  // creation date buries the breach — §27.8's trap, restated as an ordering.
  queueRows.sort((a, b) => {
    if (a.open !== b.open) return a.open ? -1 : 1;
    const aLate = a.responseDue?.overdue ? 0 : 1;
    const bLate = b.responseDue?.overdue ? 0 : 1;
    if (aLate !== bLate) return aLate - bLate;
    const byTriage = triageRank(a.triage) - triageRank(b.triage);
    if (byTriage !== 0) return byTriage;
    const aDue = a.responseDue?.at ?? '';
    const bDue = b.responseDue?.at ?? '';
    if (aDue !== bDue) return aDue.localeCompare(bDue);
    return b.createdAt.localeCompare(a.createdAt);
  });

  const counts: SupportQueueCounts = {
    all: queueRows.length,
    waiting_on_proovd: queueRows.filter((r) => r.blockedOnProovd).length,
    waiting_on_someone_else: queueRows.filter((r) => r.open && !r.blockedOnProovd).length,
    unassigned: queueRows.filter((r) => r.open && !r.assigneeName).length,
    resolved_closed: queueRows.filter((r) => !r.open).length,
  };

  const overdueCount = queueRows.filter((r) => r.responseDue?.overdue).length;

  return {
    rows: queueRows,
    counts,
    hero: composeHero(queueRows, counts, overdueCount),
    overdueCount,
  };
}

/**
 * The hero sentence.
 *
 * Ranked by what actually needs doing, and it names the cases rather than
 * counting them where the number is small — §20's Act rule applied to a support
 * queue. The caught-up ending is a real ending: it offers no manufactured next
 * step, because there is none.
 */
function composeHero(
  rows: SupportQueueRow[],
  counts: SupportQueueCounts,
  overdueCount: number,
): { title: string; detail: string } {
  if (overdueCount > 0) {
    const late = rows.filter((r) => r.responseDue?.overdue);
    return {
      title: `${overdueCount} case${overdueCount > 1 ? 's are' : ' is'} past the response we promised`,
      detail: `${late
        .slice(0, 3)
        .map((r) => `${r.reference} (${r.responseDue?.label})`)
        .join(', ')}${late.length > 3 ? `, and ${late.length - 3} more` : ''}. The promise is one business day on every case.`,
    };
  }

  if (counts.unassigned > 0) {
    const unowned = rows.filter((r) => r.open && !r.assigneeName);
    return {
      title: `${counts.unassigned} case${counts.unassigned > 1 ? 's need' : ' needs'} an owner`,
      detail: `Assign an owner before promising anyone a response — ${unowned
        .slice(0, 3)
        .map((r) => `${r.reference} (${r.requesterName})`)
        .join(', ')}${unowned.length > 3 ? `, and ${unowned.length - 3} more` : ''}.`,
    };
  }

  if (counts.waiting_on_proovd > 0) {
    return {
      title: `${counts.waiting_on_proovd} case${counts.waiting_on_proovd > 1 ? 's are' : ' is'} waiting on Proovd`,
      detail: 'Everything else is waiting on a named outside party.',
    };
  }

  const open = counts.all - counts.resolved_closed;
  if (open === 0) {
    return {
      title: 'No open cases',
      detail: 'Every case on the record has been resolved. Nothing is outstanding.',
    };
  }

  return {
    title: `${open} open case${open > 1 ? 's' : ''}`,
    detail: 'Every one is waiting on a named outside party. Nothing is waiting on Proovd.',
  };
}

/* ── One case ──────────────────────────────────────────────────────────────*/

export async function readSupportCase(
  db: Database,
  caseId: string,
  /** `viewerUserId` is the session's own id — see `assignedToYou` in `types.ts`. */
  options: { now?: Date; viewerUserId?: string | undefined } = {},
): Promise<SupportCaseDetail | null> {
  const now = options.now ?? new Date();

  const [row] = await db.select().from(supportCases).where(eq(supportCases.id, caseId)).limit(1);
  if (!row) return null;

  const identities = await resolveIdentities(db, [row]);
  const identity = identities.get(row.id);

  const [messages, handoffs, assignments, evidence, contacts, reopens] = await Promise.all([
    db
      .select()
      .from(supportCaseMessages)
      .where(eq(supportCaseMessages.caseId, caseId))
      .orderBy(asc(supportCaseMessages.occurredAt)),
    db
      .select()
      .from(supportCaseHandoffs)
      .where(eq(supportCaseHandoffs.caseId, caseId))
      .orderBy(asc(supportCaseHandoffs.occurredAt)),
    db
      .select()
      .from(supportCaseAssignments)
      .where(eq(supportCaseAssignments.caseId, caseId))
      .orderBy(asc(supportCaseAssignments.occurredAt)),
    db
      .select()
      .from(supportCaseEvidence)
      .where(eq(supportCaseEvidence.caseId, caseId))
      .orderBy(asc(supportCaseEvidence.occurredAt)),
    db
      .select()
      .from(supportCaseContacts)
      .where(eq(supportCaseContacts.caseId, caseId))
      .orderBy(asc(supportCaseContacts.occurredAt)),
    db
      .select()
      .from(supportCaseReopens)
      .where(eq(supportCaseReopens.caseId, caseId))
      .orderBy(asc(supportCaseReopens.occurredAt)),
  ]);

  const adminNames = await resolveAdminNames(db, [
    ...(row.assigneeUserId ? [row.assigneeUserId] : []),
    ...assignments.flatMap((a) => [a.toUserId, ...(a.fromUserId ? [a.fromUserId] : [])]),
  ]);

  // Real Admin accounts for the assign control. `role = 'admin'` is the same
  // boundary `requireAdmin` decides on for every request — the list cannot
  // offer somebody the server would then refuse.
  const admins = await db
    .select({ userId: user.id, name: user.name, email: user.email })
    .from(user)
    .where(eq(user.role, 'admin'))
    .orderBy(asc(user.name));

  const open = supportCaseIsOpen(row);
  const topic = row.topic as SupportTopic;
  const topicLabel = SUPPORT_TOPIC_LABELS[topic] ?? row.topic;
  const requesterName = identity?.requesterName ?? row.requesterEmail;
  const waitingOn = row.waitingOn as SupportWaitingParty | null;

  const thread: SupportThreadMessage[] = messages.map((m) => ({
    id: m.id,
    kind: !m.customerFacing ? 'note' : m.direction === 'inbound' ? 'in' : 'out',
    author: m.author,
    counterparty:
      m.direction === 'inbound' ? 'Proovd Support' : m.customerFacing ? requesterName : null,
    body: m.body,
    templateKey: m.templateKey,
    // What the provider told us, and nothing more. §27 ships no tracking pixel,
    // so there is no "opened at" here and never will be — the reference shows
    // one and it is the one thing from it that is not reproducible honestly.
    delivery:
      m.direction === 'outbound' && m.customerFacing
        ? m.notificationId
          ? 'Sent — the provider accepted it'
          : 'Recorded on the case. No delivery confirmation.'
        : null,
    occurredAt: m.occurredAt.toISOString(),
  }));

  const assignmentRows = assignments.map((a) => ({
    id: a.id,
    fromName: a.fromUserId ? (adminNames.get(a.fromUserId) ?? a.fromUserId) : null,
    toName: adminNames.get(a.toUserId) ?? a.toUserId,
    reason: a.reason,
    actor: a.actor,
    occurredAt: a.occurredAt.toISOString(),
  }));
  const latestAssignment = assignmentRows.at(-1) ?? null;

  return {
    header: {
      caseId: row.id,
      reference: row.reference,
      subject: row.subject ?? topicLabel,
      chip: supportChip(row),
      triage: row.triagePriority as SupportTriageLevel,
      triageLabel: TRIAGE_LABELS[row.triagePriority] ?? row.triagePriority,
      topic,
      topicLabel,
      subcategory: row.subcategory,
      requesterName,
      requesterKind: row.requesterKind,
      requesterKindLabel: REQUESTER_KIND_LABELS[row.requesterKind] ?? row.requesterKind,
      requesterEmail: row.requesterEmail,
      campaignName: identity?.campaignName ?? null,
      createdAt: row.createdAt.toISOString(),
      open,
      nextAction: nextActionSentence(row),
      nextUpdateDue: open ? deadline(row.nextPromisedUpdateAt, now) : null,
      blockedOnProovd: blockedOnProovd(row),
    },
    internalReason: row.internalReason,
    thread,
    context: composeContext(row, identity ?? null),
    ownership: {
      owner: row.owner as SupportOwner,
      ownerLabel: SUPPORT_OWNER_LABELS[row.owner as SupportOwner] ?? row.owner,
      assigneeUserId: row.assigneeUserId,
      assigneeName: row.assigneeUserId
        ? (adminNames.get(row.assigneeUserId) ?? row.assigneeUserId)
        : null,
      assignedToYou:
        row.assigneeUserId !== null && row.assigneeUserId === (options.viewerUserId ?? null),
      assignedAt: row.assignedAt?.toISOString() ?? null,
      previousAssigneeName: latestAssignment?.fromName ?? null,
      lastAssignmentReason: latestAssignment?.reason ?? null,
      assignments: assignmentRows,
      handoffs: handoffs.map((h) => ({
        id: h.id,
        fromOwnerActor: h.fromOwnerActor,
        toOwnerActor: h.toOwnerActor,
        verifiedFacts: h.verifiedFacts,
        currentOwner: h.currentOwner,
        nextCustomerPromise: h.nextCustomerPromise,
        statementsToKeepConsistent: h.statementsToKeepConsistent,
        occurredAt: h.occurredAt.toISOString(),
      })),
    },
    nextResponse: {
      status: row.status as SupportCaseStatus,
      waitingOn,
      waitingLabel: waitingOn ? SUPPORT_WAITING_LABELS[waitingOn] : null,
      nextAction: row.nextAction,
      nextUpdateDue: deadline(row.nextPromisedUpdateAt, now),
      responseDue: deadline(row.humanResponseDueAt, now),
      calendarVersion: row.calendarVersion,
      founderFollowupDue: deadline(row.founderFollowupDueAt, now),
      lastResponseAt: row.lastResponseAt?.toISOString() ?? null,
      resolution: row.resolution,
      resolvedBy: row.resolvedBy,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      closedAt: row.closedAt?.toISOString() ?? null,
      reopens: reopens.map((r) => ({
        id: r.id,
        reason: r.reason,
        priorResolution: r.priorResolution,
        priorResolvedAt: r.priorResolvedAt?.toISOString() ?? null,
        priorClosedAt: r.priorClosedAt?.toISOString() ?? null,
        actor: r.actor,
        occurredAt: r.occurredAt.toISOString(),
      })),
    },
    evidence: evidence.map((e) => ({
      id: e.id,
      kind: e.kind as SupportEvidenceKind,
      kindLabel: EVIDENCE_LABELS[e.kind] ?? e.kind,
      description: e.description,
      linkedKind: e.linkedKind as SupportLinkedRecordKind,
      linkedLabel: LINKED_LABELS[e.linkedKind] ?? e.linkedKind,
      linkedReference: e.linkedReference,
      addedBy: e.addedBy,
      occurredAt: e.occurredAt.toISOString(),
    })),
    contacts: contacts.map((c) => ({
      id: c.id,
      partyKind: c.partyKind as SupportContactParty,
      partyLabel: c.partyLabel,
      message: c.message,
      expectedResponseAt: c.expectedResponseAt?.toISOString() ?? null,
      outcome: c.outcome,
      outcomeRecordedAt: c.outcomeRecordedAt?.toISOString() ?? null,
      recordedBy: c.recordedBy,
      occurredAt: c.occurredAt.toISOString(),
    })),
    history: await composeCaseHistory(db, row.id, {
      messages,
      handoffs,
      assignments: assignmentRows,
      evidence,
      contacts,
      reopens,
      createdAt: row.createdAt,
      createdBy: row.createdBy,
      requesterName,
      requesterKindLabel: REQUESTER_KIND_LABELS[row.requesterKind] ?? row.requesterKind,
      resolvedAt: row.resolvedAt,
      resolvedBy: row.resolvedBy,
      closedAt: row.closedAt,
    }),
    templates: RESPONSE_TEMPLATES.map((t) => ({
      key: t.key,
      label: t.label,
      specRef: t.specRef,
      useWhen: t.useWhen,
    })),
    contactableParties: contactableFor(row.requesterKind, identity ?? null, row),
    assignableAdmins: admins.map((a) => ({ userId: a.userId, name: a.name || a.email })),
  };
}

/**
 * The right-hand context panel, shaped by who asked.
 *
 * §26.8: "users are never asked to repeat already-known campaign / reservation /
 * charge facts." The panel is that promise made visible — everything on it is
 * read from a record the case already points at.
 *
 * The links are pointers, never embedded controls. A campaign is operated from
 * the campaign workspace and a Creator relationship from the Creator one;
 * reproducing either here would be a second place to change the same record.
 */
function composeContext(
  row: typeof supportCases.$inferSelect,
  identity: CaseIdentity | null,
): SupportContextPanel {
  const fields: SupportContextPanel['fields'] = [];
  const links: SupportRecordLink[] = [];

  const push = (label: string, value: string | null | undefined) => {
    if (value) fields.push({ label, value });
  };

  if (row.requesterKind === 'founder') {
    push('Founder', identity?.founderName ?? row.requesterEmail);
    push('Business', identity?.businessName);
    push('Campaign', identity?.campaignName);
  } else if (row.requesterKind === 'creator') {
    push('Creator', identity?.creatorHandle ?? identity?.creatorName ?? row.requesterEmail);
    push('Legal name', identity?.creatorName);
    push('Campaign', identity?.campaignName);
    push('Founder', identity?.founderName);
  } else {
    push('Backer', row.requesterEmail);
    push('Campaign', identity?.campaignName);
    push('Founder', identity?.founderName);
  }

  push('Contact', row.requesterEmail);

  if (row.campaignId) {
    links.push({
      label: identity?.campaignName ? `Campaign · ${identity.campaignName}` : 'Campaign',
      // This was shown-but-unavailable from 2026-08-13 until the Campaigns hub
      // landed on 2026-08-15 — §1.4's honest option, naming what was missing
      // rather than hiding the control so the surface described a smaller
      // product. The shape was built so closing the gap would be a value
      // change rather than a surface rewrite, and this is that change.
      href: `/admin/campaigns/${row.campaignId}`,
      unavailableBecause: null,
    });
  }
  if (row.associationId) {
    links.push({
      label: identity?.creatorName
        ? `Creator relationship · ${identity.creatorName}`
        : 'Creator relationship',
      href: null,
      unavailableBecause:
        'Open this relationship from the Creators workspace — it is addressed by the Creator, not by the case.',
    });
  }
  if (row.reservationId) {
    links.push({
      label: 'Pre-order',
      href: null,
      unavailableBecause:
        'A pre-order has no Admin workspace of its own. Its facts are on this case and in the §26.5 ledger.',
    });
  }

  return {
    heading: 'Requester context',
    fields,
    links,
  };
}

/**
 * Which parties this case can coordinate with.
 *
 * Never the requester themselves: talking to them is the thread, and offering
 * "contact the Backer" on a Backer's own case would produce a second channel to
 * the same person that their case does not record as a reply.
 */
function contactableFor(
  requesterKind: string,
  identity: CaseIdentity | null,
  row: typeof supportCases.$inferSelect,
): { kind: SupportContactParty; label: string }[] {
  const out: { kind: SupportContactParty; label: string }[] = [];
  if (requesterKind !== 'founder' && identity?.founderName) {
    out.push({ kind: 'founder', label: identity.founderName });
  }
  if (requesterKind !== 'creator' && (identity?.creatorName || row.associationId)) {
    out.push({ kind: 'creator', label: identity?.creatorName ?? 'the Creator on this campaign' });
  }
  if (requesterKind !== 'backer' && row.backerIdentityId) {
    out.push({ kind: 'backer', label: 'the Backer on this pre-order' });
  }
  // Always available: a provider question is the one coordination that does not
  // depend on who else is attached to the case.
  out.push({ kind: 'provider', label: 'Stripe' });
  return out;
}

/* ── The composed history (§26.8) ──────────────────────────────────────────*/

/**
 * Every recorded event on the case, oldest first.
 *
 * Composed, never stored. There is no `support_case_events` table and there
 * must not be one — §26.8's trap is that a second event store which drifts from
 * the first is worse than no timeline. Every entry names the table it was read
 * out of, so the claim is checkable from the response itself.
 *
 * An internal note's BODY never reaches this list. The history is exactly the
 * kind of view that gets pasted into a customer message, and §33.9.11's whole
 * point is that a provider code useful to support is forbidden in customer
 * copy. That the note exists is recorded; what it says stays on the thread.
 */
async function composeCaseHistory(
  db: Database,
  caseId: string,
  parts: {
    messages: (typeof supportCaseMessages.$inferSelect)[];
    handoffs: (typeof supportCaseHandoffs.$inferSelect)[];
    assignments: { toName: string; fromName: string | null; reason: string | null; actor: string; occurredAt: string }[];
    evidence: (typeof supportCaseEvidence.$inferSelect)[];
    contacts: (typeof supportCaseContacts.$inferSelect)[];
    reopens: (typeof supportCaseReopens.$inferSelect)[];
    createdAt: Date;
    createdBy: string;
    requesterName: string;
    requesterKindLabel: string;
    resolvedAt: Date | null;
    resolvedBy: string | null;
    closedAt: Date | null;
  },
): Promise<SupportHistoryEntry[]> {
  const entries: SupportHistoryEntry[] = [];

  entries.push({
    source: 'support_cases',
    section: 'status',
    title: 'Case opened',
    detail: `${parts.requesterName} (${parts.requesterKindLabel})`,
    actor: parts.createdBy,
    occurredAt: parts.createdAt.toISOString(),
  });

  for (const m of parts.messages) {
    const isNote = !m.customerFacing;
    entries.push({
      source: 'support_case_messages',
      section: 'conversation',
      title: isNote
        ? 'Internal note added'
        : m.direction === 'inbound'
          ? 'Message received'
          : 'Reply sent',
      // The note's body is deliberately absent — see the header.
      detail: isNote ? 'Admin-only. Not shown to the customer.' : null,
      actor: m.author,
      occurredAt: m.occurredAt.toISOString(),
    });
  }

  for (const a of parts.assignments) {
    entries.push({
      source: 'support_case_assignments',
      section: 'ownership',
      title: a.fromName ? `Reassigned to ${a.toName}` : `Owner set to ${a.toName}`,
      detail: a.reason,
      actor: a.actor,
      occurredAt: a.occurredAt,
    });
  }

  for (const h of parts.handoffs) {
    entries.push({
      source: 'support_case_handoffs',
      section: 'ownership',
      title: `Accountability moved to ${h.currentOwner}`,
      detail: `Next promise to the customer: ${h.nextCustomerPromise}`,
      actor: h.recordedBy,
      occurredAt: h.occurredAt.toISOString(),
    });
  }

  for (const e of parts.evidence) {
    entries.push({
      source: 'support_case_evidence',
      section: 'evidence',
      title: 'Evidence added',
      detail: e.description,
      actor: e.addedBy,
      occurredAt: e.occurredAt.toISOString(),
    });
  }

  for (const c of parts.contacts) {
    entries.push({
      source: 'support_case_contacts',
      section: 'contact',
      title: `${c.partyLabel} contacted`,
      detail: c.message,
      actor: c.recordedBy,
      occurredAt: c.occurredAt.toISOString(),
    });
    if (c.outcome && c.outcomeRecordedAt) {
      entries.push({
        source: 'support_case_contacts',
        section: 'contact',
        title: `Outcome recorded — ${c.partyLabel}`,
        detail: c.outcome,
        actor: c.recordedBy,
        occurredAt: c.outcomeRecordedAt.toISOString(),
      });
    }
  }

  for (const r of parts.reopens) {
    entries.push({
      source: 'support_case_reopens',
      section: 'status',
      title: 'Case reopened',
      detail: r.reason,
      actor: r.actor,
      occurredAt: r.occurredAt.toISOString(),
    });
  }

  if (parts.resolvedAt) {
    entries.push({
      source: 'support_cases',
      section: 'status',
      title: 'Marked resolved',
      detail: null,
      actor: parts.resolvedBy,
      occurredAt: parts.resolvedAt.toISOString(),
    });
  }
  if (parts.closedAt) {
    entries.push({
      source: 'support_cases',
      section: 'status',
      title: 'Case closed',
      detail: 'Nothing was deleted. The case stays readable and can be reopened.',
      actor: null,
      occurredAt: parts.closedAt.toISOString(),
    });
  }

  // §27's own record of what actually left the building. Read, never written —
  // and the audience prefix keeps an internal key off nothing here, because
  // this list is Admin-only by construction.
  const deliveries = await db
    .select({
      eventKey: notificationDeliveries.eventKey,
      target: notificationDeliveries.target,
      createdAt: notificationDeliveries.createdAt,
      // NULL is "recorded, not confirmed delivered" — a state, not a failure.
      // §7's ordering: the row lands before the provider call.
      deliveredAt: notificationDeliveries.deliveredAt,
    })
    .from(notificationDeliveries)
    .where(eq(notificationDeliveries.entityId, caseId))
    .orderBy(asc(notificationDeliveries.createdAt));

  for (const d of deliveries) {
    entries.push({
      source: 'notification_deliveries',
      section: 'conversation',
      title: 'Notification sent',
      detail: `${d.eventKey} → ${d.target}${d.deliveredAt ? '' : ' (recorded, not confirmed)'}`,
      actor: null,
      occurredAt: d.createdAt.toISOString(),
    });
  }

  // §25.6's own trail for this case, through the same allowlist arrangement the
  // Creator history uses: an action nobody mapped is skipped rather than
  // rendered raw, because an audit action name is an internal identifier.
  const audits = await db
    .select({
      action: auditEvents.action,
      actor: auditEvents.actor,
      occurredAt: auditEvents.occurredAt,
      customerExplanation: auditEvents.customerExplanation,
    })
    .from(auditEvents)
    .where(and(eq(auditEvents.targetType, 'support_case'), eq(auditEvents.targetId, caseId)))
    .orderBy(asc(auditEvents.occurredAt));

  for (const a of audits) {
    const title = SUPPORT_AUDIT_TITLES[a.action];
    if (!title) continue;
    entries.push({
      source: 'audit_events',
      section: SUPPORT_AUDIT_SECTIONS[a.action] ?? 'status',
      title,
      detail: a.customerExplanation,
      actor: a.actor,
      occurredAt: a.occurredAt.toISOString(),
    });
  }

  entries.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  return entries;
}

/** The audit actions this history renders, and the sentence each renders as. */
export const SUPPORT_AUDIT_TITLES: Record<string, string> = {
  'support.case_classified': 'Classification changed',
  'support.case_triaged': 'Triage level changed',
  'support.case_status_changed': 'Waiting party changed',
  'support.case_update_promised': 'Next customer update set',
  'support.case_resolved': 'Marked resolved',
  'support.case_closed': 'Case closed',
  'support.case_reopened': 'Case reopened',
  'support.case_assigned': 'Owner changed',
};

const SUPPORT_AUDIT_SECTIONS: Record<string, SupportHistoryEntry['section']> = {
  'support.case_classified': 'classification',
  'support.case_triaged': 'classification',
  'support.case_status_changed': 'status',
  'support.case_update_promised': 'status',
  'support.case_resolved': 'status',
  'support.case_closed': 'status',
  'support.case_reopened': 'status',
  'support.case_assigned': 'ownership',
};

/** §26.7's topics with their labels, for the classify control. */
export function supportTopicOptions(): { key: string; label: string }[] {
  return Object.entries(SUPPORT_TOPIC_LABELS).map(([key, label]) => ({ key, label }));
}
