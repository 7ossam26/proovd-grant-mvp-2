/**
 * The §26.8 chronological customer timeline.
 *
 * "One read-only timeline per campaign/reservation/association **composes
 * existing events**."
 *
 * The phase trap is the whole design: "Timeline composes, it doesn't duplicate.
 * A second event store that drifts from the first is worse than no timeline."
 * So there is no `timeline_events` table, no writer, no job, and no call anywhere
 * in the codebase that appends to a timeline. Every entry is read, at request
 * time, out of the table that already owns that fact. If the source is wrong the
 * timeline is wrong in the same way — which is the point, because a timeline that
 * can disagree with the ledger is worse than useless during a dispute.
 *
 * ── Read-only means read-only ───────────────────────────────────────────────
 * This module exports no mutation. `relationship_touches` is the one thing 16b
 * adds that a timeline shows and nothing else writes, and its recorder lives
 * here — but it is a one-off human log, not a timeline event: it is recorded
 * because §1.3 makes manual work valid only when the app records it, and the
 * timeline picks it up the same way it picks up everything else.
 *
 * ── Least privilege applies to Admin too (§25.7) ────────────────────────────
 * The timeline is an operational view, so it names what happened and when —
 * never a Backer's survey answer, never a card fingerprint. Where an entry needs
 * a subject it uses the reference the ledger uses.
 */

import { and, eq, sql, desc } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  campaignStatusHistory,
  associationStatusHistory,
  reservationStatusHistory,
  campaignPaymentFlags,
  reservations,
} from '../db/schema/domain.js';
import { auditEvents, notificationDeliveries } from '../db/schema/integrity.js';
import { adminOverrides } from '../db/schema/admin-operations.js';
import {
  supportCases,
  supportCaseMessages,
  campaignEnforcementActions,
  relationshipTouches,
} from '../db/schema/support.js';
import { campaignUpdates } from '../db/schema/updates.js';
import {
  refundCauseAllocations,
  reservationRefunds,
  reservationRefundEvents,
} from '../db/schema/refunds.js';
import { RELATIONSHIP_TOUCH_KINDS, type TimelineKind } from './logic.js';

export type TimelineSubject = 'campaign' | 'reservation' | 'association';

export interface TimelineEntry {
  kind: TimelineKind;
  occurredAt: string;
  /** One line, plainly. No internal §23.4 vocabulary reaches a customer surface. */
  summary: string;
  actor: string | null;
  /** The table this was read out of. Named so the timeline is auditable itself. */
  composedFrom: string;
  detail?: Record<string, unknown> | undefined;
}

export interface Timeline {
  subject: TimelineSubject;
  subjectId: string;
  entries: TimelineEntry[];
  /** Which sources actually contributed. An empty source is not an error. */
  sourcesRead: string[];
}

/**
 * Compose a timeline for one subject.
 *
 * The three subjects read overlapping but different sets: a reservation's
 * timeline includes its own status history and its campaign's enforcement, but
 * not every other reservation's; an association's includes its own status and
 * first-post events, but no Backer facts at all (§25.7 — an Affiliate view and
 * an Affiliate's timeline are different things, but neither is a place for
 * Backer PII to appear by accident).
 */
export async function readTimeline(
  db: Database,
  subject: TimelineSubject,
  subjectId: string,
): Promise<Timeline> {
  const entries: TimelineEntry[] = [];
  const sourcesRead: string[] = [];

  // Resolve the campaign the subject belongs to, so campaign-level events appear
  // on a reservation's timeline too — a Backer asking "what happened to my
  // pre-order" needs the campaign's kill to be on it.
  let campaignId: string | null = null;
  if (subject === 'campaign') {
    campaignId = subjectId;
  } else if (subject === 'reservation') {
    const [row] = await db
      .select({ campaignId: reservations.campaignId })
      .from(reservations)
      .where(eq(reservations.id, subjectId))
      .limit(1);
    campaignId = row?.campaignId ?? null;
  }

  /* ── Lifecycle histories (§23.1, §23.4, §23.5) ───────────────────────────── */

  if (campaignId) {
    const rows = await db
      .select()
      .from(campaignStatusHistory)
      .where(eq(campaignStatusHistory.campaignId, campaignId));
    sourcesRead.push('campaign_status_history');
    for (const row of rows) {
      entries.push({
        kind: 'campaign_status',
        occurredAt: row.occurredAt.toISOString(),
        summary: row.fromStatus
          ? `Campaign moved ${row.fromStatus} → ${row.toStatus}`
          : `Campaign created as ${row.toStatus}`,
        actor: row.actor,
        composedFrom: 'campaign_status_history',
      });
    }
  }

  if (subject === 'association') {
    const rows = await db
      .select()
      .from(associationStatusHistory)
      .where(eq(associationStatusHistory.associationId, subjectId));
    sourcesRead.push('association_status_history');
    for (const row of rows) {
      entries.push({
        kind: 'association_status',
        occurredAt: row.occurredAt.toISOString(),
        summary: row.fromStatus
          ? `Creator relationship moved ${row.fromStatus} → ${row.toStatus}`
          : `Creator relationship created as ${row.toStatus}`,
        actor: row.actor,
        composedFrom: 'association_status_history',
      });
    }
  }

  if (subject === 'reservation') {
    const rows = await db
      .select()
      .from(reservationStatusHistory)
      .where(eq(reservationStatusHistory.reservationId, subjectId));
    sourcesRead.push('reservation_status_history');
    for (const row of rows) {
      entries.push({
        kind: 'reservation_status',
        occurredAt: row.occurredAt.toISOString(),
        summary: row.fromStatus
          ? `Pre-order moved ${row.fromStatus} → ${row.toStatus}`
          : `Pre-order created as ${row.toStatus}`,
        actor: row.actor,
        composedFrom: 'reservation_status_history',
      });
    }
  }

  /* ── §23.3 payment flags, kept separate from the lifecycle ───────────────── */

  if (campaignId) {
    const rows = await db
      .select()
      .from(campaignPaymentFlags)
      .where(eq(campaignPaymentFlags.campaignId, campaignId));
    sourcesRead.push('campaign_payment_flags');
    for (const row of rows) {
      entries.push({
        kind: 'payment_flag',
        occurredAt: row.setAt.toISOString(),
        summary: `Payment flag ${row.flag} set`,
        actor: row.actor,
        composedFrom: 'campaign_payment_flags',
        detail: row.amountCents !== null ? { amountCents: row.amountCents.toString() } : undefined,
      });
    }
  }

  /* ── §18 updates ─────────────────────────────────────────────────────────── */

  if (campaignId) {
    const rows = await db
      .select()
      .from(campaignUpdates)
      .where(eq(campaignUpdates.campaignId, campaignId));
    sourcesRead.push('campaign_updates');
    for (const row of rows) {
      entries.push({
        kind: 'campaign_update',
        occurredAt: row.publishedAt.toISOString(),
        summary: `Founder posted an update${row.title ? `: ${row.title}` : ''}`,
        actor: row.author,
        composedFrom: 'campaign_updates',
        detail: { audience: row.audience },
      });
    }
  }

  /* ── §26.7 enforcement ───────────────────────────────────────────────────── */

  if (campaignId) {
    const rows = await db
      .select()
      .from(campaignEnforcementActions)
      .where(eq(campaignEnforcementActions.campaignId, campaignId));
    sourcesRead.push('campaign_enforcement_actions');
    for (const row of rows) {
      entries.push({
        kind: 'enforcement',
        occurredAt: row.occurredAt.toISOString(),
        summary: `Campaign ${row.action === 'kill' ? 'killed' : 'suspended'} — ${row.reasonCategory}`,
        actor: row.actor,
        composedFrom: 'campaign_enforcement_actions',
        detail: {
          phase: row.phase,
          reservationsClosed: row.reservationsClosed,
          // The customer-facing half only. The internal free text stays in the
          // record and out of a view someone might paste from (§33.9.11).
          customerExplanation: row.customerExplanation,
        },
      });
    }
  }

  /* ── §26.7/§27.8 support ─────────────────────────────────────────────────── */

  const caseWhere =
    subject === 'campaign'
      ? eq(supportCases.campaignId, subjectId)
      : subject === 'reservation'
        ? eq(supportCases.reservationId, subjectId)
        : eq(supportCases.associationId, subjectId);

  const cases = await db.select().from(supportCases).where(caseWhere);
  sourcesRead.push('support_cases');
  for (const row of cases) {
    entries.push({
      kind: 'support_case',
      occurredAt: row.createdAt.toISOString(),
      summary: `Support case ${row.reference} opened — ${row.topic}`,
      actor: row.createdBy,
      composedFrom: 'support_cases',
      detail: {
        owner: row.owner,
        status: row.status,
        humanResponseDueAt: row.humanResponseDueAt.toISOString(),
        nextPromisedUpdateAt: row.nextPromisedUpdateAt?.toISOString() ?? null,
      },
    });

    const messages = await db
      .select()
      .from(supportCaseMessages)
      .where(eq(supportCaseMessages.caseId, row.id));
    for (const message of messages) {
      entries.push({
        kind: 'support_case',
        occurredAt: message.occurredAt.toISOString(),
        summary:
          message.direction === 'inbound'
            ? `Message received on case ${row.reference}`
            : message.customerFacing
              ? `Response sent on case ${row.reference}`
              : `Internal note added to case ${row.reference}`,
        actor: message.author,
        composedFrom: 'support_case_messages',
        // The body is deliberately not summarised into the timeline: an internal
        // note may legitimately carry a provider code (§26.8), and a timeline is
        // exactly the kind of view that gets pasted into a customer message.
        detail: { customerFacing: message.customerFacing },
      });
    }
  }

  /* ── §27.2 notifications, with delivery state and dedup ──────────────────── */

  if (campaignId) {
    const rows = await db
      .select()
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.entityType, 'campaign'),
          eq(notificationDeliveries.entityId, campaignId),
        ),
      );
    sourcesRead.push('notification_deliveries');
    for (const row of rows) {
      entries.push({
        kind: 'notification',
        occurredAt: (row.deliveredAt ?? row.createdAt).toISOString(),
        summary: row.deliveredAt
          ? `Email sent: ${row.eventKey}`
          : `Email recorded but not confirmed delivered: ${row.eventKey}`,
        actor: null,
        composedFrom: 'notification_deliveries',
        detail: { target: row.target, confirmed: row.deliveredAt !== null },
      });
    }
  }

  /* ── §25.6 Admin actions and §33.12.4 overrides ──────────────────────────── */

  const auditRows = await db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.targetType, subject), eq(auditEvents.targetId, subjectId)));
  sourcesRead.push('audit_events');
  for (const row of auditRows) {
    entries.push({
      kind: 'admin_action',
      occurredAt: row.occurredAt.toISOString(),
      summary: `Admin action: ${row.action}`,
      actor: row.actor,
      composedFrom: 'audit_events',
    });
  }

  const overrideRows = await db
    .select()
    .from(adminOverrides)
    .where(and(eq(adminOverrides.targetType, subject), eq(adminOverrides.targetId, subjectId)));
  sourcesRead.push('admin_overrides');
  for (const row of overrideRows) {
    entries.push({
      kind: 'admin_action',
      occurredAt: row.occurredAt.toISOString(),
      summary: `Override: ${row.fieldKey} changed from ${JSON.stringify(row.priorValue)} to ${JSON.stringify(row.newValue)}`,
      actor: row.actor,
      composedFrom: 'admin_overrides',
      detail: { customerExplanation: row.customerExplanation },
    });
  }

  /* ── §26.8 relationship touches ──────────────────────────────────────────── */

  if (campaignId) {
    const rows = await db
      .select()
      .from(relationshipTouches)
      .where(eq(relationshipTouches.campaignId, campaignId));
    sourcesRead.push('relationship_touches');
    for (const row of rows) {
      entries.push({
        kind: 'relationship_touch',
        occurredAt: row.occurredAt.toISOString(),
        summary: `Human relationship touch: ${row.kind}`,
        actor: row.recordedBy,
        composedFrom: 'relationship_touches',
        detail: { note: row.note },
      });
    }
  }

  /* ── §24.8 refunds and cause allocation (Phase 20a) ──────────────────────── */

  if (campaignId || subject === 'reservation') {
    const rows = await db
      .select({
        refund: reservationRefunds,
        allocation: refundCauseAllocations,
      })
      .from(reservationRefunds)
      .innerJoin(
        refundCauseAllocations,
        eq(refundCauseAllocations.id, reservationRefunds.allocationId),
      )
      .where(
        subject === 'reservation'
          ? eq(reservationRefunds.reservationId, subjectId)
          : eq(reservationRefunds.campaignId, campaignId!),
      );
    sourcesRead.push('reservation_refunds');
    sourcesRead.push('refund_cause_allocations');
    for (const { refund, allocation } of rows) {
      const events = await db
        .select()
        .from(reservationRefundEvents)
        .where(eq(reservationRefundEvents.refundId, refund.id));
      for (const event of events) {
        entries.push({
          kind: 'refund',
          occurredAt: event.occurredAt.toISOString(),
          summary:
            event.toStatus === 'requested'
              ? `Refund ${refund.reference} recorded (${allocation.cause}, US$${(Number(refund.amountCents) / 100).toFixed(2)})`
              : `Refund ${refund.reference} ${event.toStatus}`,
          actor: event.actor,
          composedFrom: 'reservation_refunds, refund_cause_allocations',
          detail: {
            cause: allocation.cause,
            affiliateTreatment: allocation.affiliateTreatment,
            proovdFeeTreatment: allocation.proovdFeeTreatment,
          },
        });
      }
    }
  }

  // Chronological, oldest first — a timeline read backwards is a list.
  entries.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  return { subject, subjectId, entries, sourcesRead };
}

/* ── §26.8's one-time human touches ───────────────────────────────────────── */

export type TouchOutcome =
  | { ok: true; touchId: string }
  | { ok: false; code: 'invalid' | 'already_logged'; message: string };

/**
 * Log a one-time relationship touch.
 *
 * §26.8: "these are personal service events, not automated engagement spam", and
 * the phase brief adds "must never become a scheduled sequence". So this takes
 * no schedule, no recurrence, and no template; the unique index makes it
 * one-per-campaign-per-kind; and there is no job anywhere that calls it. The
 * second attempt is refused rather than silently updated, because an Admin who
 * logs a second mid-campaign welcome has either made a mistake or started a
 * sequence, and both deserve to be told.
 */
export async function recordRelationshipTouch(
  db: Database,
  input: { campaignId: string; kind: string; note: string; recordedBy: string },
): Promise<TouchOutcome> {
  if (!RELATIONSHIP_TOUCH_KINDS.includes(input.kind as never)) {
    return { ok: false, code: 'invalid', message: 'That is not a §26.8 relationship touch.' };
  }
  if (!input.note.trim()) {
    return {
      ok: false,
      code: 'invalid',
      message: 'Record what was actually said or done — manual work counts when the app records it (§1.3).',
    };
  }

  try {
    const [row] = await db
      .insert(relationshipTouches)
      .values({
        campaignId: input.campaignId,
        kind: input.kind,
        note: input.note,
        recordedBy: input.recordedBy,
      })
      .returning({ id: relationshipTouches.id });
    return { ok: true, touchId: row!.id };
  } catch (error) {
    // Drizzle wraps the driver error, so the 23505 check walks `cause` — the
    // Phase 09a duplicate-asset shape.
    const code = (error as { code?: string; cause?: { code?: string } })?.code
      ?? (error as { cause?: { code?: string } })?.cause?.code;
    if (code === '23505') {
      return {
        ok: false,
        code: 'already_logged',
        message:
          'That touch is already logged for this campaign. §26.8 makes these one-time personal events, never a sequence.',
      };
    }
    throw error;
  }
}

/** Every touch logged for a campaign, newest first. */
export async function listRelationshipTouches(db: Database, campaignId: string) {
  return db
    .select()
    .from(relationshipTouches)
    .where(eq(relationshipTouches.campaignId, campaignId))
    .orderBy(desc(relationshipTouches.occurredAt));
}
