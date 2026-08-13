/**
 * Support cases — §26.7, §26.8, §27.8, §33.9.10, §33.9.11.
 *
 * §33.9.10: "Support case has stable reference, owner, due time, context, and
 * 48-hour Founder follow-up."
 * §33.9.11: "Internal fraud/provider codes never become raw customer copy."
 *
 * ── The response deadline is a business-day deadline (§29.6) ────────────────
 * §27.8's published promise is "within one (1) business day, Monday–Friday,
 * excluding U.S. federal holidays". That is a business-day deadline in exactly
 * the sense §29.6 means, so it is computed once from the committed versioned
 * calendar, stored with the version that produced it, and a trigger refuses to
 * move it afterwards. It reads the same `business-calendar.ts` the §29.6 Creator
 * replacement window does — a second calendar would be a second answer to
 * "when is one business day from now", and the two would drift on a holiday.
 *
 * ── Context is carried, never re-asked (§26.8) ──────────────────────────────
 * "Support responses start from editable templates and preserve all context so
 * users are never asked to repeat already-known campaign/reservation/charge
 * facts." So a case stores its campaign, reservation, and association up front,
 * and `buildResponseContext` assembles those facts for the Admin composing a
 * reply. The template is a *starting point* an Admin edits — not a canned
 * response that sends itself, which would be the §1.4 failure.
 *
 * ── Raw codes stay on the internal side of one column (§33.9.11) ────────────
 * `customer_facing` is that column. A Stripe decline code or a Radar rule is
 * useful on an internal note and forbidden on a message a Backer reads, so the
 * refusal happens on the customer-facing branch only, using the single pattern
 * list `admin/logic.ts` already owns. Two copies of that list would drift, and
 * the drift is invisible until someone reads a support transcript.
 */

import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, isNotNull, lte, or, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns, reservations } from '../db/schema/domain.js';
import { campaignBuild } from '../db/schema/build.js';
import {
  supportCases,
  supportCaseMessages,
  supportCaseHandoffs,
} from '../db/schema/support.js';
import { containsRawProviderCode } from '../admin/logic.js';
import {
  businessDayDeadline,
  US_FEDERAL_HOLIDAYS,
} from '../launch/business-calendar.js';
import {
  SUPPORT_RESPONSE_BUSINESS_DAYS,
  FOUNDER_FOLLOWUP_HOURS,
  SUPPORT_TOPICS,
  SUPPORT_OWNERS,
  resolveSupportAcknowledgement,
  type SupportTopic,
  type SupportOwner,
  type SupportCaseStatus,
} from './logic.js';

/**
 * A stable, quotable reference.
 *
 * `PVD-` plus ten Crockford-ish base32 characters, with the ambiguous glyphs
 * removed: someone reading a case number back over the phone must not have to
 * distinguish O from 0 or I from 1. Random rather than sequential — a
 * sequential case number tells anyone who holds one roughly how many support
 * cases Proovd has, which is a business fact the customer has no need for.
 */
const REFERENCE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

function mintReference(): string {
  const bytes = randomBytes(10);
  let out = '';
  for (const byte of bytes) out += REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length];
  return `PVD-${out.slice(0, 5)}-${out.slice(5, 10)}`;
}

export interface OpenCaseInput {
  topic: SupportTopic;
  owner: SupportOwner;
  requesterKind: 'backer' | 'founder' | 'creator';
  requesterEmail: string;
  backerIdentityId?: string | undefined;
  requesterUserId?: string | undefined;
  campaignId?: string | undefined;
  reservationId?: string | undefined;
  associationId?: string | undefined;
  /** What the person actually wrote. Stored as the first inbound message. */
  message: string;
  createdBy: string;
  /** Overridable for tests; defaults to now. */
  now?: Date | undefined;
}

export interface OpenCaseResult {
  caseId: string;
  reference: string;
  topic: SupportTopic;
  owner: SupportOwner;
  humanResponseDueAt: Date;
  calendarVersion: string;
  founderFollowupDueAt: Date | null;
  /** Appendix B.8, rendered. Returned so the route can show and send the same text. */
  acknowledgement: string;
}

export type OpenCaseOutcome =
  | { ok: true; result: OpenCaseResult }
  | { ok: false; code: 'invalid'; message: string };

/**
 * Open a case, compute its §27.8 deadline, and render Appendix B.8.
 *
 * The acknowledgement is produced here rather than in the email template, so the
 * text the submitter sees on screen and the text that lands in their inbox are
 * literally the same string — §33.11.5 wants every surface to agree, and two
 * renderings of one appendix is how they stop agreeing.
 */
export async function openSupportCase(
  db: Database,
  input: OpenCaseInput,
): Promise<OpenCaseOutcome> {
  if (!SUPPORT_TOPICS.includes(input.topic)) {
    return { ok: false, code: 'invalid', message: 'That is not a support topic.' };
  }
  if (!SUPPORT_OWNERS.includes(input.owner)) {
    return { ok: false, code: 'invalid', message: 'That is not a support owner.' };
  }
  if (!input.message.trim()) {
    return { ok: false, code: 'invalid', message: 'A case needs the message that opened it.' };
  }
  if (input.requesterKind === 'backer' && !input.backerIdentityId) {
    return {
      ok: false,
      code: 'invalid',
      message: 'A Backer case names the campaign-scoped identity — a Backer has no account (§5.4).',
    };
  }
  if (input.requesterKind !== 'backer' && !input.requesterUserId) {
    return { ok: false, code: 'invalid', message: 'An account-holder case names the account.' };
  }

  const now = input.now ?? new Date();

  // §27.8's promise, on the committed calendar, stored with its version (§29.6).
  const deadline = businessDayDeadline(now, SUPPORT_RESPONSE_BUSINESS_DAYS, US_FEDERAL_HOLIDAYS);

  // §27.8's 48 hours applies only where the Founder owes the response. A case
  // Proovd owns has no Founder to follow up with, and setting the timestamp
  // anyway would put a promise in the record that nothing will honour.
  const founderFollowupDueAt =
    input.owner === 'founder_coordinated'
      ? new Date(now.getTime() + FOUNDER_FOLLOWUP_HOURS * 3_600_000)
      : null;

  const reference = mintReference();

  const caseId = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(supportCases)
      .values({
        reference,
        topic: input.topic,
        owner: input.owner,
        status: input.owner === 'founder_coordinated' ? 'awaiting_founder' : 'open',
        requesterKind: input.requesterKind,
        backerIdentityId: input.backerIdentityId ?? null,
        requesterUserId: input.requesterUserId ?? null,
        requesterEmail: input.requesterEmail,
        // Migration 0045 pins `waiting_on` to `status` with a CHECK, so the two
        // are written together everywhere. A case Proovd owns opens waiting on
        // Proovd; one the Founder is accountable for opens waiting on them.
        waitingOn: input.owner === 'founder_coordinated' ? 'founder' : 'proovd',
        campaignId: input.campaignId ?? null,
        reservationId: input.reservationId ?? null,
        associationId: input.associationId ?? null,
        humanResponseDueAt: deadline.dueAt,
        calendarVersion: deadline.calendarVersion,
        founderFollowupDueAt,
        createdBy: input.createdBy,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: supportCases.id });

    // The message that opened it. Inbound, and customer-facing by definition —
    // it is the customer's own words.
    await tx.insert(supportCaseMessages).values({
      caseId: row!.id,
      direction: 'inbound',
      customerFacing: true,
      body: input.message,
      author: input.createdBy,
      occurredAt: now,
    });

    return row!.id;
  });

  return {
    ok: true,
    result: {
      caseId,
      reference,
      topic: input.topic,
      owner: input.owner,
      humanResponseDueAt: deadline.dueAt,
      calendarVersion: deadline.calendarVersion,
      founderFollowupDueAt,
      acknowledgement: resolveSupportAcknowledgement({
        caseReference: reference,
        topic: input.topic,
        owner: input.owner,
        // §27.1: local primary with canonical UTC secondary. The route renders
        // the reader's local time; the stored answer is always UTC.
        humanResponseDue: `${deadline.dueAt.toISOString().replace('T', ' ').slice(0, 16)} UTC`,
      }),
    },
  };
}

/* ── §26.8: context that is carried, never re-asked ───────────────────────── */

export interface CaseContext {
  reference: string;
  topic: SupportTopic;
  owner: SupportOwner;
  status: SupportCaseStatus;
  humanResponseDueAt: string;
  nextPromisedUpdateAt: string | null;
  founderFollowupDueAt: string | null;
  requesterEmail: string;
  /** Everything the system already holds, so nobody is asked to repeat it. */
  campaign: { id: string; title: string | null; status: string } | null;
  reservation: {
    id: string;
    status: string;
    rewardTitle: string | null;
    subtotalCents: string;
    taxCents: string;
    totalAuthorizedCents: string | null;
    statementDescriptor: string | null;
    reservedAt: string | null;
  } | null;
  messages: Array<{
    id: string;
    direction: string;
    customerFacing: boolean;
    body: string;
    author: string;
    occurredAt: string;
  }>;
  handoffs: Array<{
    id: string;
    fromOwnerActor: string;
    toOwnerActor: string;
    verifiedFacts: string;
    currentOwner: string;
    nextCustomerPromise: string;
    statementsToKeepConsistent: string;
    occurredAt: string;
  }>;
}

export async function readCaseContext(
  db: Database,
  caseId: string,
): Promise<CaseContext | null> {
  const [row] = await db.select().from(supportCases).where(eq(supportCases.id, caseId)).limit(1);
  if (!row) return null;

  let campaign: CaseContext['campaign'] = null;
  if (row.campaignId) {
    const [c] = await db
      .select({
        id: campaigns.id,
        status: sql<string>`${campaigns.status}::text`,
        title: campaignBuild.title,
      })
      .from(campaigns)
      .leftJoin(campaignBuild, eq(campaignBuild.campaignId, campaigns.id))
      .where(eq(campaigns.id, row.campaignId))
      .limit(1);
    if (c) campaign = { id: c.id, title: c.title, status: c.status };
  }

  let reservation: CaseContext['reservation'] = null;
  if (row.reservationId) {
    const [r] = await db
      .select({
        id: reservations.id,
        status: sql<string>`${reservations.status}::text`,
        rewardTitle: reservations.rewardTitle,
        subtotalCents: reservations.rewardSubtotalCents,
        taxCents: reservations.salesTaxCents,
        totalAuthorizedCents: reservations.totalAuthorizedCents,
        statementDescriptor: reservations.statementDescriptor,
        reservedAt: reservations.reservedAt,
      })
      .from(reservations)
      .where(eq(reservations.id, row.reservationId))
      .limit(1);
    if (r) {
      reservation = {
        id: r.id,
        status: r.status,
        rewardTitle: r.rewardTitle,
        subtotalCents: r.subtotalCents.toString(),
        taxCents: r.taxCents.toString(),
        totalAuthorizedCents: r.totalAuthorizedCents?.toString() ?? null,
        statementDescriptor: r.statementDescriptor,
        reservedAt: r.reservedAt?.toISOString() ?? null,
      };
    }
  }

  const messages = await db
    .select()
    .from(supportCaseMessages)
    .where(eq(supportCaseMessages.caseId, caseId))
    .orderBy(asc(supportCaseMessages.occurredAt));

  const handoffs = await db
    .select()
    .from(supportCaseHandoffs)
    .where(eq(supportCaseHandoffs.caseId, caseId))
    .orderBy(asc(supportCaseHandoffs.occurredAt));

  return {
    reference: row.reference,
    topic: row.topic as SupportTopic,
    owner: row.owner as SupportOwner,
    status: row.status,
    humanResponseDueAt: row.humanResponseDueAt.toISOString(),
    nextPromisedUpdateAt: row.nextPromisedUpdateAt?.toISOString() ?? null,
    founderFollowupDueAt: row.founderFollowupDueAt?.toISOString() ?? null,
    requesterEmail: row.requesterEmail,
    campaign,
    reservation,
    messages: messages.map((m) => ({
      id: m.id,
      direction: m.direction,
      customerFacing: m.customerFacing,
      body: m.body,
      author: m.author,
      occurredAt: m.occurredAt.toISOString(),
    })),
    handoffs: handoffs.map((hf) => ({
      id: hf.id,
      fromOwnerActor: hf.fromOwnerActor,
      toOwnerActor: hf.toOwnerActor,
      verifiedFacts: hf.verifiedFacts,
      currentOwner: hf.currentOwner,
      nextCustomerPromise: hf.nextCustomerPromise,
      statementsToKeepConsistent: hf.statementsToKeepConsistent,
      occurredAt: hf.occurredAt.toISOString(),
    })),
  };
}

/* ── Responding (§26.8, §33.9.11) ─────────────────────────────────────────── */

export type AddMessageOutcome =
  | { ok: true; messageId: string }
  | { ok: false; code: 'not_found' | 'invalid' | 'raw_provider_code'; message: string };

/**
 * Append to the thread.
 *
 * The §33.9.11 refusal applies to the customer-facing branch only. §26.8 is
 * explicit that raw provider and fraud codes "may appear as secondary support
 * detail in the Admin view" — so an internal note may carry a decline code, and
 * refusing it there would push an Admin to paraphrase the one fact that actually
 * identifies the transaction.
 */
export async function addCaseMessage(
  db: Database,
  input: {
    caseId: string;
    direction: 'inbound' | 'outbound';
    customerFacing: boolean;
    body: string;
    author: string;
    templateKey?: string | undefined;
    /** Moves §27.8's promised checkpoint when a reply makes a new promise. */
    nextPromisedUpdateAt?: Date | undefined;
  },
): Promise<AddMessageOutcome> {
  if (!input.body.trim()) {
    return { ok: false, code: 'invalid', message: 'A message needs a body.' };
  }

  // §33.9.11 is about what WE send: an OUTBOUND customer-facing reply may not
  // carry a provider code. An inbound customer message quoting their own
  // bank's wording is their evidence, not our copy (Phase 20b's Backer path).
  if (input.direction === 'outbound' && input.customerFacing && containsRawProviderCode(input.body)) {
    return {
      ok: false,
      code: 'raw_provider_code',
      message:
        'That reply contains a raw provider or fraud code. Those belong in an internal note, where support can read them and the customer cannot (§26.8, §33.9.11).',
    };
  }

  const [existing] = await db
    .select({ id: supportCases.id })
    .from(supportCases)
    .where(eq(supportCases.id, input.caseId))
    .limit(1);
  if (!existing) return { ok: false, code: 'not_found', message: 'No such case.' };

  return db.transaction(async (tx) => {
    const now = new Date();
    const [message] = await tx
      .insert(supportCaseMessages)
      .values({
        caseId: input.caseId,
        direction: input.direction,
        customerFacing: input.customerFacing,
        body: input.body,
        author: input.author,
        templateKey: input.templateKey ?? null,
        occurredAt: now,
      })
      .returning({ id: supportCaseMessages.id });

    // Only a customer-facing outbound message is a *response*. An internal note
    // that stopped the SLA clock would let a case look answered while the person
    // waiting has heard nothing.
    if (input.direction === 'outbound' && input.customerFacing) {
      await tx
        .update(supportCases)
        .set({
          lastResponseAt: now,
          updatedAt: now,
          ...(input.nextPromisedUpdateAt ? { nextPromisedUpdateAt: input.nextPromisedUpdateAt } : {}),
        })
        .where(eq(supportCases.id, input.caseId));
    } else if (input.nextPromisedUpdateAt) {
      await tx
        .update(supportCases)
        .set({ nextPromisedUpdateAt: input.nextPromisedUpdateAt, updatedAt: now })
        .where(eq(supportCases.id, input.caseId));
    }

    return { ok: true as const, messageId: message!.id };
  });
}

/* ── §26.8: the handoff note gate ─────────────────────────────────────────── */

export type HandoffOutcome =
  | { ok: true; handoffId: string }
  | { ok: false; code: 'not_found' | 'incomplete_note'; message: string };

/**
 * Change owner. Refuses without all four §26.8 facts.
 *
 * The note and the owner change are **one transaction**, which is the whole
 * point: a handoff that could be recorded after the fact is a handoff the new
 * owner could skip and backfill, and §26.8 requires the note *before* the case
 * can move. Both the database (four NOT NULL, CHECKed non-blank columns) and
 * this service refuse an incomplete one — the service so the Admin reads which
 * field is missing, the database so no other write path can bypass it.
 */
export async function transferCaseOwnership(
  db: Database,
  input: {
    caseId: string;
    toOwner: SupportOwner;
    toOwnerActor: string;
    verifiedFacts: string;
    currentOwner: string;
    nextCustomerPromise: string;
    statementsToKeepConsistent: string;
    recordedBy: string;
  },
): Promise<HandoffOutcome> {
  const missing: string[] = [];
  if (!input.verifiedFacts.trim()) missing.push('verified facts');
  if (!input.currentOwner.trim()) missing.push('current owner');
  if (!input.nextCustomerPromise.trim()) missing.push('the next customer promise');
  if (!input.statementsToKeepConsistent.trim()) {
    missing.push('the statements that must stay consistent');
  }

  if (missing.length > 0) {
    return {
      ok: false,
      code: 'incomplete_note',
      message: `A handoff note needs all four facts (§26.8). Still missing: ${missing.join(', ')}. The case has not moved.`,
    };
  }

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(supportCases)
      .where(eq(supportCases.id, input.caseId))
      .for('update')
      .limit(1);

    if (!existing) {
      return { ok: false as const, code: 'not_found' as const, message: 'No such case.' };
    }

    const now = new Date();

    const [handoff] = await tx
      .insert(supportCaseHandoffs)
      .values({
        caseId: input.caseId,
        fromOwnerActor: existing.createdBy,
        toOwnerActor: input.toOwnerActor,
        verifiedFacts: input.verifiedFacts,
        currentOwner: input.currentOwner,
        nextCustomerPromise: input.nextCustomerPromise,
        statementsToKeepConsistent: input.statementsToKeepConsistent,
        recordedBy: input.recordedBy,
        occurredAt: now,
      })
      .returning({ id: supportCaseHandoffs.id });

    await tx
      .update(supportCases)
      .set({
        owner: input.toOwner,
        status: input.toOwner === 'founder_coordinated' ? 'awaiting_founder' : 'open',
        // Written with the status (migration 0045). A handoff to the Founder
        // means the Founder owes the next move; a handoff back to Proovd means
        // Proovd does — and neither leaves the two columns disagreeing.
        waitingOn: input.toOwner === 'founder_coordinated' ? 'founder' : 'proovd',
        // The 48-hour clock starts when the Founder actually acquires the case,
        // not when it opened — a Founder cannot be late for a case they were
        // handed five minutes ago.
        founderFollowupDueAt:
          input.toOwner === 'founder_coordinated'
            ? new Date(now.getTime() + FOUNDER_FOLLOWUP_HOURS * 3_600_000)
            : null,
        updatedAt: now,
      })
      .where(eq(supportCases.id, input.caseId));

    return { ok: true as const, handoffId: handoff!.id };
  });
}

/* ── §27.8: the daily queue ───────────────────────────────────────────────── */

export interface QueueEntry {
  caseId: string;
  reference: string;
  topic: string;
  owner: string;
  status: string;
  humanResponseDueAt: string;
  nextPromisedUpdateAt: string | null;
  founderFollowupDueAt: string | null;
  /** §27.8: "Admin sees due/overdue badges." Overdue is the one that matters. */
  responseOverdue: boolean;
  promiseOverdue: boolean;
  founderFollowupOverdue: boolean;
  requesterEmail: string;
  campaignId: string | null;
}

export interface SupportQueue {
  /** Everything owed today or already late, most overdue first. */
  entries: QueueEntry[];
  dueCount: number;
  overdueCount: number;
}

/**
 * §27.8's daily queue of "responses/promises due".
 *
 * The phase trap: "The daily queue must show overdue, not just due. An SLA
 * nobody can see breached is an SLA that gets breached." So the query has no
 * lower bound — a case that went past its deadline last week is still in the
 * queue, still flagged, and sorts to the top. A window that only looked forward
 * would quietly drop exactly the cases that most need attention.
 *
 * Three separate clocks, because §27.8 makes three separate promises: the
 * one-business-day human response, the next promised update, and the 48-hour
 * Founder follow-up. A case can be fine on one and late on another.
 */
export async function readSupportQueue(
  db: Database,
  options: { now?: Date; horizonHours?: number } = {},
): Promise<SupportQueue> {
  const now = options.now ?? new Date();
  const horizon = new Date(now.getTime() + (options.horizonHours ?? 24) * 3_600_000);

  const rows = await db
    .select()
    .from(supportCases)
    .where(
      and(
        sql`${supportCases.status}::text <> 'resolved'`,
        or(
          lte(supportCases.humanResponseDueAt, horizon),
          and(isNotNull(supportCases.nextPromisedUpdateAt), lte(supportCases.nextPromisedUpdateAt, horizon)),
          and(isNotNull(supportCases.founderFollowupDueAt), lte(supportCases.founderFollowupDueAt, horizon)),
        ),
      ),
    )
    .orderBy(asc(supportCases.humanResponseDueAt));

  const entries: QueueEntry[] = rows.map((row) => {
    // A response is overdue only if nothing has been sent since the deadline.
    const responded = row.lastResponseAt !== null && row.lastResponseAt >= row.humanResponseDueAt;
    return {
      caseId: row.id,
      reference: row.reference,
      topic: row.topic,
      owner: row.owner,
      status: row.status,
      humanResponseDueAt: row.humanResponseDueAt.toISOString(),
      nextPromisedUpdateAt: row.nextPromisedUpdateAt?.toISOString() ?? null,
      founderFollowupDueAt: row.founderFollowupDueAt?.toISOString() ?? null,
      responseOverdue: !responded && row.humanResponseDueAt <= now,
      promiseOverdue: row.nextPromisedUpdateAt !== null && row.nextPromisedUpdateAt <= now,
      founderFollowupOverdue:
        row.founderFollowupDueAt !== null && row.founderFollowupDueAt <= now,
      requesterEmail: row.requesterEmail,
      campaignId: row.campaignId,
    };
  });

  const overdue = entries.filter(
    (e) => e.responseOverdue || e.promiseOverdue || e.founderFollowupOverdue,
  );

  // Most overdue first. A queue sorted by creation date buries the breach.
  entries.sort((a, b) => {
    const aLate = a.responseOverdue || a.promiseOverdue || a.founderFollowupOverdue ? 0 : 1;
    const bLate = b.responseOverdue || b.promiseOverdue || b.founderFollowupOverdue ? 0 : 1;
    if (aLate !== bLate) return aLate - bLate;
    return a.humanResponseDueAt.localeCompare(b.humanResponseDueAt);
  });

  return {
    entries,
    dueCount: entries.length,
    overdueCount: overdue.length,
  };
}

/** Resolve a case. Not the same as closing the thread — §27.8 keeps it readable. */
export async function resolveCase(
  db: Database,
  caseId: string,
): Promise<{ ok: boolean }> {
  const now = new Date();
  const moved = await db
    .update(supportCases)
    // `waiting_on` is nulled with the status: a resolved case waits on nobody,
    // and migration 0045's CHECK is what makes that true rather than customary.
    .set({
      status: 'resolved',
      waitingOn: null,
      nextAction: null,
      resolvedAt: now,
      updatedAt: now,
      founderFollowupDueAt: null,
    })
    .where(and(eq(supportCases.id, caseId), sql`${supportCases.status}::text <> 'resolved'`))
    .returning({ id: supportCases.id });
  return { ok: moved.length === 1 };
}

/** Cases attached to a subject, newest first — feeds §26.8's timeline. */
export async function listCasesFor(
  db: Database,
  subject: { campaignId?: string; reservationId?: string; associationId?: string },
) {
  const where =
    subject.campaignId !== undefined
      ? eq(supportCases.campaignId, subject.campaignId)
      : subject.reservationId !== undefined
        ? eq(supportCases.reservationId, subject.reservationId)
        : eq(supportCases.associationId, subject.associationId!);

  return db.select().from(supportCases).where(where).orderBy(desc(supportCases.createdAt));
}
