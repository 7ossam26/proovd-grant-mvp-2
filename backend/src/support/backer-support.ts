/**
 * The Backer support path — Spec §29.9, §29.10, §27.5, §27.8 (Phase 20b).
 *
 * The live copy has promised "get help without losing context" since Phase 15;
 * this is the machinery behind the promise. A Backer opens a case FROM their
 * magic link, so the case is born carrying the campaign, reservation, and
 * charge facts §26.8 says a person must never be asked to repeat — 16b's
 * `openSupportCase` unchanged, reached through the one authenticated surface a
 * Backer has (§5.4).
 *
 * ── §29.10's order is the owner routing ─────────────────────────────────────
 * "Backer contacts Founder first through magic-link support." A
 * not-as-described / delivery / campaign question opens `founder_coordinated`;
 * an unknown charge, refund, or payment question is Proovd's own (§29.9,
 * §24.6). "If no response within 14 days or no resolution, Backer may
 * escalate to Proovd" — the escalation is a recorded act (one per case), moves
 * the case to Proovd, and the ISSUER-RIGHTS sentence rides every surface:
 * contacting the Founder or Proovd first waives nothing (§24.8).
 */

import { and, desc, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { backerIdentities } from '../db/schema/reservations.js';
import { reservations } from '../db/schema/domain.js';
import {
  supportCases,
  supportCaseMessages,
  type SupportCase,
} from '../db/schema/support.js';
import { supportCaseEscalations } from '../db/schema/enforcement.js';
import type { AuditWriter } from '../auth/audit.js';
import type { Notifier } from '../notifications/send.js';
import type { LaunchNotificationContext } from '../launch/notifications.js';
import { BACKER_SUPPORT_RECEIVED } from '../notifications/events.js';
import { ESCALATION_WAIT_DAYS, ISSUER_RIGHTS_SENTENCE } from '../enforcement/logic.js';
import { renderPlainNotice } from '../notifications/templates/plain.js';
import { openSupportCase, type OpenCaseResult } from './cases.js';
import { SUPPORT_TOPICS, SUPPORT_TOPIC_LABELS, type SupportTopic } from './logic.js';

export interface BackerSupportDeps {
  db: Database;
  audit: AuditWriter;
  notifier?: Notifier | undefined;
  context?: LaunchNotificationContext | undefined;
}

/**
 * §29.10: the Founder is contacted first for the topics that are the
 * Founder's to answer; §29.9/§24.6 route money questions to Proovd directly.
 */
export function ownerForBackerTopic(topic: SupportTopic): 'proovd_support' | 'founder_coordinated' {
  switch (topic) {
    case 'reward_not_as_described':
    case 'delivery':
    case 'campaign_question':
      return 'founder_coordinated';
    default:
      return 'proovd_support';
  }
}

export type OpenBackerCaseOutcome =
  | { ok: true; result: OpenCaseResult; issuerRights: string }
  | { ok: false; code: 'invalid' | 'not_found'; message: string };

export async function openBackerSupportCase(
  deps: BackerSupportDeps,
  input: {
    campaignId: string;
    backerIdentityId: string;
    topic: SupportTopic;
    message: string;
    reservationId?: string | null;
    now?: Date;
  },
): Promise<OpenBackerCaseOutcome> {
  if (!SUPPORT_TOPICS.includes(input.topic)) {
    return { ok: false, code: 'invalid', message: 'That is not a support topic.' };
  }
  if (!input.message.trim()) {
    return { ok: false, code: 'invalid', message: 'Say what happened — a person reads this.' };
  }
  const [identity] = await deps.db
    .select({ id: backerIdentities.id, email: backerIdentities.email })
    .from(backerIdentities)
    .where(
      and(
        eq(backerIdentities.id, input.backerIdentityId),
        eq(backerIdentities.campaignId, input.campaignId),
      ),
    )
    .limit(1);
  if (!identity) return { ok: false, code: 'not_found', message: 'No such Backer.' };

  // The optional reservation must be this Backer's own, on this campaign.
  if (input.reservationId) {
    const [reservation] = await deps.db
      .select({ id: reservations.id })
      .from(reservations)
      .where(
        and(
          eq(reservations.id, input.reservationId),
          eq(reservations.backerIdentityId, input.backerIdentityId),
          eq(reservations.campaignId, input.campaignId),
        ),
      )
      .limit(1);
    if (!reservation) return { ok: false, code: 'not_found', message: 'No such pre-order.' };
  }

  const opened = await openSupportCase(deps.db, {
    topic: input.topic,
    owner: ownerForBackerTopic(input.topic),
    requesterKind: 'backer',
    requesterEmail: identity.email,
    backerIdentityId: identity.id,
    campaignId: input.campaignId,
    ...(input.reservationId ? { reservationId: input.reservationId } : {}),
    message: input.message,
    createdBy: `backer:${identity.id}`,
    ...(input.now ? { now: input.now } : {}),
  });
  if (!opened.ok) return { ok: false, code: 'invalid', message: opened.message };

  await deps.audit({
    action: 'support.backer_case_opened',
    actorId: `backer:${identity.id}`,
    targetType: 'support_case',
    targetId: opened.result.caseId,
    internalReason: `§29.9/§29.10 Backer case (${input.topic}) opened from the magic link`,
  });

  // §27.5 "Support received": the SAME B.8 acknowledgement the screen shows —
  // one string, two renderers (§33.11.5). Deduped per case: opening is once.
  if (deps.notifier && deps.context) {
    // The acknowledgement is Appendix B.8's exact text and travels as ONE
    // paragraph — restructuring it into labelled facts would make the inbox
    // copy a different string from the one on screen (§33.11.5).
    const ack = opened.result.acknowledgement;
    const notice = await renderPlainNotice({
      subject: `We received your request — ${opened.result.reference}`,
      headline: 'We received your request.',
      facts: [],
      paragraphs: [ack, ISSUER_RIGHTS_SENTENCE],
      reference: opened.result.reference,
      supportEmail: deps.context.supportEmail,
    });
    await deps.notifier.send({
      eventKey: BACKER_SUPPORT_RECEIVED,
      entityType: 'support_case',
      entityId: opened.result.caseId,
      to: identity.email,
      from: deps.context.fromAddress,
      replyTo: deps.context.supportEmail,
      ...notice,
    });
  }

  return { ok: true, result: opened.result, issuerRights: ISSUER_RIGHTS_SENTENCE };
}

/* ── The Backer's own case list, with the §29.10 escalation facts ─────────── */

export interface BackerCaseView {
  caseId: string;
  reference: string;
  topic: string;
  status: string;
  owner: string;
  openedAt: string;
  humanResponseDueAt: string;
  /** An outbound customer-facing reply exists — "the Founder/Proovd answered". */
  responded: boolean;
  escalatedAt: string | null;
  /** §29.10: eligible now, or the date the 14-day arm opens. */
  canEscalate: boolean;
  escalationOpensAt: string | null;
}

export interface BackerSupportView {
  topics: Array<{ key: string; label: string }>;
  cases: BackerCaseView[];
  issuerRights: string;
}

function escalationFacts(
  row: SupportCase,
  responded: boolean,
  escalatedAt: Date | null,
  now: Date,
): { canEscalate: boolean; opensAt: string | null } {
  if (escalatedAt || row.status === 'resolved' || row.owner === 'proovd_support') {
    return { canEscalate: false, opensAt: null };
  }
  if (responded) return { canEscalate: true, opensAt: null };
  const opensAt = new Date(row.createdAt.getTime() + ESCALATION_WAIT_DAYS * 86_400_000);
  return { canEscalate: now.getTime() >= opensAt.getTime(), opensAt: opensAt.toISOString() };
}

export async function readBackerSupport(
  db: Database,
  input: { campaignId: string; backerIdentityId: string; now?: Date },
): Promise<BackerSupportView> {
  const now = input.now ?? new Date();
  const rows = await db
    .select()
    .from(supportCases)
    .where(
      and(
        eq(supportCases.backerIdentityId, input.backerIdentityId),
        eq(supportCases.campaignId, input.campaignId),
      ),
    )
    .orderBy(desc(supportCases.createdAt));

  const views: BackerCaseView[] = [];
  for (const row of rows) {
    const [reply] = await db
      .select({ id: supportCaseMessages.id })
      .from(supportCaseMessages)
      .where(
        and(
          eq(supportCaseMessages.caseId, row.id),
          eq(supportCaseMessages.direction, 'outbound'),
          eq(supportCaseMessages.customerFacing, true),
        ),
      )
      .limit(1);
    const [escalation] = await db
      .select({ occurredAt: supportCaseEscalations.occurredAt })
      .from(supportCaseEscalations)
      .where(eq(supportCaseEscalations.caseId, row.id))
      .limit(1);
    const facts = escalationFacts(row, Boolean(reply), escalation?.occurredAt ?? null, now);
    views.push({
      caseId: row.id,
      reference: row.reference,
      topic: row.topic,
      status: row.status,
      owner: row.owner,
      openedAt: row.createdAt.toISOString(),
      humanResponseDueAt: row.humanResponseDueAt.toISOString(),
      responded: Boolean(reply),
      escalatedAt: escalation?.occurredAt?.toISOString() ?? null,
      canEscalate: facts.canEscalate,
      escalationOpensAt: facts.opensAt,
    });
  }

  return {
    topics: SUPPORT_TOPICS.map((key) => ({ key, label: SUPPORT_TOPIC_LABELS[key] })),
    cases: views,
    issuerRights: ISSUER_RIGHTS_SENTENCE,
  };
}

/* ── §29.10 the escalation ────────────────────────────────────────────────── */

export type EscalateOutcome =
  | { ok: true; kind: 'no_response_14_days' | 'not_resolved' }
  | {
      ok: false;
      code:
        | 'not_found'
        | 'invalid'
        | 'already_escalated'
        | 'already_with_proovd'
        | 'case_resolved'
        | 'not_eligible_yet';
      message: string;
      opensAt?: string;
    };

export async function escalateBackerCase(
  deps: BackerSupportDeps,
  input: {
    campaignId: string;
    backerIdentityId: string;
    caseId: string;
    reason: string;
    now?: Date;
  },
): Promise<EscalateOutcome> {
  const now = input.now ?? new Date();
  if (!input.reason.trim()) {
    return { ok: false, code: 'invalid', message: 'Say why this needs Proovd — a person reads it.' };
  }
  const [row] = await deps.db
    .select()
    .from(supportCases)
    .where(
      and(
        eq(supportCases.id, input.caseId),
        eq(supportCases.backerIdentityId, input.backerIdentityId),
        eq(supportCases.campaignId, input.campaignId),
      ),
    )
    .limit(1);
  if (!row) return { ok: false, code: 'not_found', message: 'No such case.' };
  if (row.status === 'resolved') {
    return {
      ok: false,
      code: 'case_resolved',
      message: 'This case is resolved. If something is still wrong, open a new case — nothing is lost.',
    };
  }
  if (row.owner === 'proovd_support') {
    return { ok: false, code: 'already_with_proovd', message: 'Proovd already owns this case.' };
  }

  const [reply] = await deps.db
    .select({ id: supportCaseMessages.id })
    .from(supportCaseMessages)
    .where(
      and(
        eq(supportCaseMessages.caseId, row.id),
        eq(supportCaseMessages.direction, 'outbound'),
        eq(supportCaseMessages.customerFacing, true),
      ),
    )
    .limit(1);
  const responded = Boolean(reply);
  if (!responded) {
    const opensAt = new Date(row.createdAt.getTime() + ESCALATION_WAIT_DAYS * 86_400_000);
    if (now.getTime() < opensAt.getTime()) {
      return {
        ok: false,
        code: 'not_eligible_yet',
        message: `§29.10: escalation opens ${ESCALATION_WAIT_DAYS} days after your request if the Founder has not responded.`,
        opensAt: opensAt.toISOString(),
      };
    }
  }
  const kind = responded ? ('not_resolved' as const) : ('no_response_14_days' as const);

  const escalated = await deps.db.transaction(async (tx) => {
    const inserted = await tx
      .insert(supportCaseEscalations)
      .values({ caseId: row.id, kind, reason: input.reason, occurredAt: now })
      .onConflictDoNothing()
      .returning({ id: supportCaseEscalations.id });
    if (inserted.length === 0) return false;

    // The case moves to Proovd and reopens for its response clock. This is the
    // Backer's own §29.10 right, not an Admin handoff — the handoff note gate
    // (§26.8) governs Admin-to-Admin moves, and the escalation record is this
    // move's evidence.
    await tx
      .update(supportCases)
      .set({ owner: 'proovd_support', status: 'open', updatedAt: now })
      .where(eq(supportCases.id, row.id));

    await tx.insert(supportCaseMessages).values({
      caseId: row.id,
      direction: 'inbound',
      customerFacing: true,
      body: `Escalated to Proovd (§29.10, ${kind === 'not_resolved' ? 'not resolved' : 'no response in 14 days'}): ${input.reason}`,
      author: `backer:${input.backerIdentityId}`,
      occurredAt: now,
    });
    return true;
  });

  if (!escalated) {
    return { ok: false, code: 'already_escalated', message: 'This case is already with Proovd.' };
  }

  await deps.audit({
    action: 'support.backer_escalated',
    actorId: `backer:${input.backerIdentityId}`,
    targetType: 'support_case',
    targetId: row.id,
    internalReason: `§29.10 escalation (${kind}): ${input.reason}`,
  });
  return { ok: true, kind };
}
