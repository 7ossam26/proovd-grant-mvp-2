/**
 * Affiliate enforcement, appeals, and the §29 disclosures — Spec §29.1, §29.2,
 * §29.4, §29.5 (Phase 20b).
 *
 * §29.4's rule shapes everything: "Customer-facing enforcement states exact
 * evidence/behavior, rule, immediate effect, correction, appeal deadline, and
 * human route. Internal reason remains separate." The five typed fields are
 * required non-blank (service AND CHECK), each is refused if it carries a raw
 * provider or fraud code (§33.9.11), and the appeal deadline is computed on
 * the committed business calendar and stored with its version (§29.6's rule
 * for promised deadlines). A vague "policy violation" has no representable
 * record.
 *
 * ── What each action does to the association ────────────────────────────────
 * `warn`, `demote`, `restrict_bidding`, and `refer_case` are records only —
 * the internal tier is free text by design (§8) and there is no bidding
 * machinery to restrict, so the record IS the act. `pause` moves an active
 * partnership `active → paused` and pauses the tracking link (the §17
 * correction mechanics, same columns). `terminate`/`remove` end it —
 * `→ removed`, §23.4's terminal — and require the §29.5 validity answer.
 * An `invalid` termination is recordable (the record is what §31.9 counts)
 * and can claw nothing back: finalized amounts are trigger-immutable and the
 * only paths that touch them are §24.8 causes with Affiliate causation.
 *
 * ── §29.1's consequence is executed where attribution lives ─────────────────
 * A disclosed self-pre-order "earns no commission, bonus, or thank-you". When
 * the disclosure links a reservation attributed to that Creator's own link,
 * its stored attribution moves to `blocked` — the §18 vocabulary for "cannot
 * earn" — so 19a's finalization (which counts only `verified`) excludes it
 * without a second rule.
 */

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  campaignAffiliateAssociations,
  associationStatusHistory,
  reservations,
} from '../db/schema/domain.js';
import { trackingLinks } from '../db/schema/decisions.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import {
  affiliateEnforcementActions,
  affiliateEnforcementAppeals,
  affiliateConflictDisclosures,
  affiliateSelfPreorderDisclosures,
  type AffiliateEnforcementAction,
} from '../db/schema/enforcement.js';
import { campaignBuild } from '../db/schema/build.js';
import type { AuditWriter } from '../auth/audit.js';
import type { Notifier } from '../notifications/send.js';
import type { LaunchNotificationContext } from '../launch/notifications.js';
import { businessDayDeadline } from '../launch/business-calendar.js';
import { containsRawProviderCode } from '../admin/logic.js';
import {
  AFFILIATE_ENFORCEMENT_ACTIONS,
  AFFILIATE_ENFORCEMENT_REASONS,
  APPEAL_WINDOW_BUSINESS_DAYS,
  CONFLICT_RELATIONSHIP_KINDS,
  TERMINATION_VALIDITY,
  type AffiliateEnforcementActionKind,
  type AffiliateEnforcementReasonKind,
  type ConflictRelationshipKindValue,
  type TerminationValidityKind,
} from './logic.js';
import { AFFILIATE_SUSPENSION, AFFILIATE_WARNING } from '../notifications/events.js';

export interface AffiliateEnforcementDeps {
  db: Database;
  audit: AuditWriter;
  notifier?: Notifier | undefined;
  context?: LaunchNotificationContext | undefined;
}

/* ── §29.4 the enforcement action ─────────────────────────────────────────── */

export interface RecordAffiliateEnforcementInput {
  associationId: string;
  actionKind: AffiliateEnforcementActionKind;
  reasonCategory: AffiliateEnforcementReasonKind;
  internalReason: string;
  evidenceAndBehavior: string;
  ruleViolated: string;
  immediateEffect: string;
  correctionPath: string;
  humanRoute: string;
  terminationValidity?: TerminationValidityKind | null;
  evidenceLinks?: Record<string, unknown> | undefined;
  actor: string;
  mfaContext: string;
  reauthContext: string;
  now?: Date;
}

export type RecordAffiliateEnforcementOutcome =
  | { ok: true; action: AffiliateEnforcementAction }
  | { ok: false; code: 'not_found' | 'invalid' | 'raw_provider_code'; message: string };

const ENDS_PARTNERSHIP: readonly AffiliateEnforcementActionKind[] = ['terminate', 'remove'];

export async function recordAffiliateEnforcement(
  deps: AffiliateEnforcementDeps,
  input: RecordAffiliateEnforcementInput,
): Promise<RecordAffiliateEnforcementOutcome> {
  const { db } = deps;
  const now = input.now ?? new Date();

  if (!AFFILIATE_ENFORCEMENT_ACTIONS.includes(input.actionKind)) {
    return { ok: false, code: 'invalid', message: 'That is not a §29.4 action.' };
  }
  if (!AFFILIATE_ENFORCEMENT_REASONS.includes(input.reasonCategory)) {
    return { ok: false, code: 'invalid', message: 'That is not a §29.4 ground.' };
  }
  const statement: Array<[string, string]> = [
    ['evidenceAndBehavior', input.evidenceAndBehavior],
    ['ruleViolated', input.ruleViolated],
    ['immediateEffect', input.immediateEffect],
    ['correctionPath', input.correctionPath],
    ['humanRoute', input.humanRoute],
  ];
  for (const [field, value] of statement) {
    if (!value || !value.trim()) {
      return {
        ok: false,
        code: 'invalid',
        message: `§29.4's customer statement requires ${field} — a vague "policy violation" is not an enforcement record.`,
      };
    }
    if (containsRawProviderCode(value)) {
      return {
        ok: false,
        code: 'raw_provider_code',
        message: `${field} contains a raw provider or fraud code. Those stay in the internal reason (§33.9.11).`,
      };
    }
  }
  if (!input.internalReason.trim()) {
    return { ok: false, code: 'invalid', message: 'The internal reason is required (§29.4).' };
  }
  const endsPartnership = ENDS_PARTNERSHIP.includes(input.actionKind);
  if (endsPartnership) {
    if (!input.terminationValidity || !TERMINATION_VALIDITY.includes(input.terminationValidity)) {
      return {
        ok: false,
        code: 'invalid',
        message:
          'Ending an active partnership records its §29.5 validity — one of the four valid grounds, or invalid.',
      };
    }
  } else if (input.terminationValidity) {
    return {
      ok: false,
      code: 'invalid',
      message: 'Termination validity belongs only to terminate/remove (§29.5).',
    };
  }

  const [association] = await db
    .select({
      id: campaignAffiliateAssociations.id,
      campaignId: campaignAffiliateAssociations.campaignId,
      status: sql<string>`${campaignAffiliateAssociations.status}::text`,
    })
    .from(campaignAffiliateAssociations)
    .where(eq(campaignAffiliateAssociations.id, input.associationId))
    .limit(1);
  if (!association) return { ok: false, code: 'not_found', message: 'No such association.' };

  const deadline = businessDayDeadline(now, APPEAL_WINDOW_BUSINESS_DAYS);

  const record = await db.transaction(async (tx) => {
    let newStatus = association.status;

    if (input.actionKind === 'pause' && association.status === 'active') {
      const moved = await tx
        .update(campaignAffiliateAssociations)
        .set({ status: 'paused', updatedAt: now })
        .where(
          and(
            eq(campaignAffiliateAssociations.id, association.id),
            sql`${campaignAffiliateAssociations.status}::text = 'active'`,
          ),
        )
        .returning({ id: campaignAffiliateAssociations.id });
      if (moved.length > 0) {
        newStatus = 'paused';
        await tx.insert(associationStatusHistory).values({
          associationId: association.id,
          fromStatus: 'active',
          toStatus: 'paused',
          actor: input.actor,
        });
        await tx
          .update(trackingLinks)
          .set({ pausedAt: now, pausedReason: 'enforcement_pause', pausedBy: input.actor })
          .where(
            and(eq(trackingLinks.associationId, association.id), sql`${trackingLinks.pausedAt} IS NULL`),
          );
      }
    }

    if (endsPartnership) {
      const from = association.status;
      const terminal = ['declined', 'expired_no_acceptance', 'removed', 'successfully_completed', 'completion_disqualified'];
      if (!terminal.includes(from)) {
        const moved = await tx
          .update(campaignAffiliateAssociations)
          .set({ status: 'removed', updatedAt: now })
          .where(
            and(
              eq(campaignAffiliateAssociations.id, association.id),
              sql`${campaignAffiliateAssociations.status}::text = ${from}`,
            ),
          )
          .returning({ id: campaignAffiliateAssociations.id });
        if (moved.length > 0) {
          newStatus = 'removed';
          await tx.insert(associationStatusHistory).values({
            associationId: association.id,
            fromStatus: from as never,
            toStatus: 'removed',
            actor: input.actor,
          });
          await tx
            .update(trackingLinks)
            .set({ pausedAt: now, pausedReason: 'enforcement_removal', pausedBy: input.actor })
            .where(
              and(eq(trackingLinks.associationId, association.id), sql`${trackingLinks.pausedAt} IS NULL`),
            );
        }
      }
    }

    const [row] = await tx
      .insert(affiliateEnforcementActions)
      .values({
        associationId: association.id,
        campaignId: association.campaignId,
        actionKind: input.actionKind,
        reasonCategory: input.reasonCategory,
        internalReason: input.internalReason,
        evidenceAndBehavior: input.evidenceAndBehavior,
        ruleViolated: input.ruleViolated,
        immediateEffect: input.immediateEffect,
        correctionPath: input.correctionPath,
        humanRoute: input.humanRoute,
        appealDueAt: deadline.dueAt,
        calendarVersion: deadline.calendarVersion,
        terminationValidity: endsPartnership ? input.terminationValidity! : null,
        priorAssociationStatus: association.status,
        newAssociationStatus: newStatus,
        actor: input.actor,
        mfaContext: input.mfaContext,
        reauthContext: input.reauthContext,
        evidenceLinks: input.evidenceLinks ?? null,
        occurredAt: now,
      })
      .returning();
    return row!;
  });

  await deps.audit({
    action: `affiliate.${input.actionKind}`,
    actorId: input.actor,
    mfaContext: input.mfaContext,
    reauthContext: input.reauthContext,
    targetType: 'campaign_affiliate_association',
    targetId: association.id,
    internalReason: `${input.reasonCategory}: ${input.internalReason}`,
    customerExplanation: input.evidenceAndBehavior,
    priorValue: { status: association.status },
    newValue: {
      status: record.newAssociationStatus,
      enforcementId: record.id,
      appealDueAt: deadline.dueAt.toISOString(),
      ...(record.terminationValidity ? { terminationValidity: record.terminationValidity } : {}),
    },
    evidenceLinks: input.evidenceLinks ?? null,
  });

  await notifyAffiliateEnforcement(deps, record);

  return { ok: true, action: record };
}

/** The §29.4 statement, composed once for the inbox — no raw codes by construction. */
async function notifyAffiliateEnforcement(
  deps: AffiliateEnforcementDeps,
  action: AffiliateEnforcementAction,
): Promise<void> {
  if (!deps.notifier || !deps.context) return;
  const [profile] = await deps.db
    .select({ email: affiliateSignupProfiles.email })
    .from(affiliateSignupProfiles)
    .where(eq(affiliateSignupProfiles.associationId, action.associationId))
    .limit(1);
  if (!profile?.email) return;
  const [build] = await deps.db
    .select({ title: campaignBuild.title })
    .from(campaignBuild)
    .where(eq(campaignBuild.campaignId, action.campaignId))
    .limit(1);
  const title = build?.title ?? 'your campaign partnership';

  const lines = [
    `What happened, and the evidence: ${action.evidenceAndBehavior}`,
    `The rule involved: ${action.ruleViolated}`,
    `Immediate effect: ${action.immediateEffect}`,
    `How to correct it: ${action.correctionPath}`,
    `Appeal deadline: ${action.appealDueAt.toISOString().slice(0, 10)} (five business days, U.S. federal calendar). The appeal decision is final.`,
    `A person you can reach: ${action.humanRoute}`,
  ];
  const text = lines.join('\n\n');

  await deps.notifier.send({
    eventKey: action.actionKind === 'warn' ? AFFILIATE_WARNING : AFFILIATE_SUSPENSION,
    entityType: 'affiliate_enforcement',
    entityId: action.id,
    to: profile.email,
    from: deps.context.fromAddress,
    replyTo: deps.context.supportEmail,
    subject: `About your Creator partnership — ${title}`,
    html: lines.map((l) => `<p>${l}</p>`).join(''),
    text,
  });
}

/* ── §29.4 appeals ────────────────────────────────────────────────────────── */

export type SubmitAppealOutcome =
  | { ok: true; appealId: string }
  | { ok: false; code: 'not_found' | 'appeal_window_closed' | 'already_appealed' | 'invalid'; message: string };

export async function submitAffiliateAppeal(
  deps: AffiliateEnforcementDeps,
  input: { actionId: string; grounds: string; actor: string; now?: Date },
): Promise<SubmitAppealOutcome> {
  const now = input.now ?? new Date();
  if (!input.grounds.trim()) {
    return { ok: false, code: 'invalid', message: 'An appeal states its grounds.' };
  }
  const [action] = await deps.db
    .select()
    .from(affiliateEnforcementActions)
    .where(eq(affiliateEnforcementActions.id, input.actionId))
    .limit(1);
  if (!action) return { ok: false, code: 'not_found', message: 'No such enforcement action.' };
  if (now.getTime() > action.appealDueAt.getTime()) {
    return {
      ok: false,
      code: 'appeal_window_closed',
      message: `The appeal window closed ${action.appealDueAt.toISOString().slice(0, 10)} (§29.4).`,
    };
  }

  const inserted = await deps.db
    .insert(affiliateEnforcementAppeals)
    .values({ actionId: input.actionId, grounds: input.grounds, submittedAt: now })
    .onConflictDoNothing()
    .returning({ id: affiliateEnforcementAppeals.id });
  if (inserted.length === 0) {
    return { ok: false, code: 'already_appealed', message: 'This action has already been appealed.' };
  }

  await deps.audit({
    action: 'affiliate.appeal_submitted',
    actorId: input.actor,
    targetType: 'affiliate_enforcement',
    targetId: input.actionId,
    internalReason: 'appeal submitted within the §29.4 window',
  });
  return { ok: true, appealId: inserted[0]!.id };
}

export type DecideAppealOutcome =
  | { ok: true; decision: 'upheld' | 'overturned' }
  | { ok: false; code: 'not_found' | 'already_decided' | 'invalid'; message: string };

export async function decideAffiliateAppeal(
  deps: AffiliateEnforcementDeps,
  input: {
    appealId: string;
    decision: 'upheld' | 'overturned';
    note?: string | undefined;
    actor: string;
    now?: Date;
  },
): Promise<DecideAppealOutcome> {
  const now = input.now ?? new Date();
  if (input.decision !== 'upheld' && input.decision !== 'overturned') {
    return { ok: false, code: 'invalid', message: 'The decision is upheld or overturned.' };
  }
  const [appeal] = await deps.db
    .select()
    .from(affiliateEnforcementAppeals)
    .where(eq(affiliateEnforcementAppeals.id, input.appealId))
    .limit(1);
  if (!appeal) return { ok: false, code: 'not_found', message: 'No such appeal.' };
  if (appeal.decision) {
    return { ok: false, code: 'already_decided', message: 'The appeal decision is final (§29.4).' };
  }

  const decided = await deps.db
    .update(affiliateEnforcementAppeals)
    .set({
      decision: input.decision,
      decisionNote: input.note ?? null,
      decidedBy: input.actor,
      decidedAt: now,
    })
    .where(and(eq(affiliateEnforcementAppeals.id, input.appealId), sql`${affiliateEnforcementAppeals.decision} IS NULL`))
    .returning({ id: affiliateEnforcementAppeals.id });
  if (decided.length === 0) {
    return { ok: false, code: 'already_decided', message: 'The appeal decision is final (§29.4).' };
  }

  // An overturned PAUSE restores the partnership; an overturned removal cannot
  // silently revive a terminal state (§23.4) — re-engagement is a new
  // association, and the audit says so.
  const [action] = await deps.db
    .select()
    .from(affiliateEnforcementActions)
    .where(eq(affiliateEnforcementActions.id, appeal.actionId))
    .limit(1);
  let restored = false;
  if (input.decision === 'overturned' && action?.actionKind === 'pause') {
    const moved = await deps.db
      .update(campaignAffiliateAssociations)
      .set({ status: 'active', updatedAt: now })
      .where(
        and(
          eq(campaignAffiliateAssociations.id, action.associationId),
          sql`${campaignAffiliateAssociations.status}::text = 'paused'`,
        ),
      )
      .returning({ id: campaignAffiliateAssociations.id });
    if (moved.length > 0) {
      restored = true;
      await deps.db.insert(associationStatusHistory).values({
        associationId: action.associationId,
        fromStatus: 'paused',
        toStatus: 'active',
        actor: input.actor,
      });
      await deps.db
        .update(trackingLinks)
        .set({ pausedAt: null, pausedReason: null, pausedBy: null })
        .where(
          and(
            eq(trackingLinks.associationId, action.associationId),
            eq(trackingLinks.pausedReason, 'enforcement_pause'),
          ),
        );
    }
  }

  await deps.audit({
    action: 'affiliate.appeal_decided',
    actorId: input.actor,
    targetType: 'affiliate_enforcement',
    targetId: appeal.actionId,
    internalReason: `appeal ${input.decision}${input.note ? `: ${input.note}` : ''}`,
    newValue: {
      decision: input.decision,
      restored,
      ...(input.decision === 'overturned' && action?.actionKind !== 'pause'
        ? { note: 'a terminal removal is not revived; re-engagement is a new association (§23.4)' }
        : {}),
    },
  });
  return { ok: true, decision: input.decision };
}

/* ── §29.2 conflict disclosures ───────────────────────────────────────────── */

export type DisclosureOutcome =
  | { ok: true; id: string }
  | { ok: false; code: 'not_found' | 'invalid' | 'already_recorded'; message: string };

export async function recordConflictDisclosure(
  deps: AffiliateEnforcementDeps,
  input: {
    associationId: string;
    relationshipKind: ConflictRelationshipKindValue;
    detail: string;
    disclosedBy: string;
    actor: string;
    now?: Date;
  },
): Promise<DisclosureOutcome> {
  if (!CONFLICT_RELATIONSHIP_KINDS.includes(input.relationshipKind)) {
    return { ok: false, code: 'invalid', message: 'That is not a §29.2 relationship kind.' };
  }
  if (!input.detail.trim()) {
    return { ok: false, code: 'invalid', message: 'A disclosure states the relationship (§29.2).' };
  }
  const [association] = await deps.db
    .select({ id: campaignAffiliateAssociations.id })
    .from(campaignAffiliateAssociations)
    .where(eq(campaignAffiliateAssociations.id, input.associationId))
    .limit(1);
  if (!association) return { ok: false, code: 'not_found', message: 'No such association.' };

  const [row] = await deps.db
    .insert(affiliateConflictDisclosures)
    .values({
      associationId: input.associationId,
      relationshipKind: input.relationshipKind,
      detail: input.detail,
      disclosedBy: input.disclosedBy,
      recordedBy: input.actor,
      occurredAt: input.now ?? new Date(),
    })
    .returning({ id: affiliateConflictDisclosures.id });

  await deps.audit({
    action: 'affiliate.conflict_disclosed',
    actorId: input.actor,
    targetType: 'campaign_affiliate_association',
    targetId: input.associationId,
    internalReason: `§29.2 ${input.relationshipKind} relationship disclosed by ${input.disclosedBy}`,
  });
  return { ok: true, id: row!.id };
}

/* ── §29.1 self-pre-order disclosures ─────────────────────────────────────── */

export async function recordSelfPreorderDisclosure(
  deps: AffiliateEnforcementDeps,
  input: {
    associationId: string;
    reservationId?: string | null;
    intentNote: string;
    selfFundedCertified: boolean;
    identityDisclosed: boolean;
    actor: string;
    now?: Date;
  },
): Promise<DisclosureOutcome> {
  const now = input.now ?? new Date();
  if (!input.intentNote.trim()) {
    return { ok: false, code: 'invalid', message: 'The disclosure states the intent (§29.1).' };
  }
  if (!input.selfFundedCertified || !input.identityDisclosed) {
    return {
      ok: false,
      code: 'invalid',
      message:
        '§29.1 permits a self-pre-order only with a certified genuine self-funded purchase and identity-disclosed information — an uncertified disclosure has no record.',
    };
  }
  const [association] = await deps.db
    .select({
      id: campaignAffiliateAssociations.id,
      campaignId: campaignAffiliateAssociations.campaignId,
    })
    .from(campaignAffiliateAssociations)
    .where(eq(campaignAffiliateAssociations.id, input.associationId))
    .limit(1);
  if (!association) return { ok: false, code: 'not_found', message: 'No such association.' };

  let reservationRow: { id: string; attributionAssociationId: string | null } | null = null;
  if (input.reservationId) {
    const [row] = await deps.db
      .select({
        id: reservations.id,
        campaignId: reservations.campaignId,
        attributionAssociationId: reservations.attributionAssociationId,
      })
      .from(reservations)
      .where(eq(reservations.id, input.reservationId))
      .limit(1);
    if (!row || row.campaignId !== association.campaignId) {
      return { ok: false, code: 'not_found', message: 'No such reservation on this campaign.' };
    }
    reservationRow = row;
  }

  const inserted = await deps.db
    .insert(affiliateSelfPreorderDisclosures)
    .values({
      associationId: input.associationId,
      reservationId: input.reservationId ?? null,
      intentNote: input.intentNote,
      selfFundedCertified: true,
      identityDisclosed: true,
      recordedBy: input.actor,
      occurredAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: affiliateSelfPreorderDisclosures.id });
  if (inserted.length === 0) {
    return {
      ok: false,
      code: 'already_recorded',
      message: 'This purchase is already disclosed — a second disclosure is the same disclosure.',
    };
  }

  // §29.1: "earns no commission, bonus, or thank-you" — executed only when the
  // purchase is attributed to the discloser's OWN link. `blocked` is §18's
  // cannot-earn vocabulary; finalization counts only `verified` (§22.1).
  if (reservationRow && reservationRow.attributionAssociationId === input.associationId) {
    await deps.db
      .update(reservations)
      .set({ attributionStatus: 'blocked', updatedAt: now })
      .where(eq(reservations.id, reservationRow.id));
    await deps.audit({
      action: 'affiliate.self_preorder_attribution_blocked',
      actorId: input.actor,
      targetType: 'reservation',
      targetId: reservationRow.id,
      internalReason:
        '§29.1: a disclosed self-pre-order earns no commission, bonus, or thank-you — attribution excluded before finalization can count it',
      priorValue: { attributionStatus: 'attributed_to_own_link' },
      newValue: { attributionStatus: 'blocked' },
    });
  }

  await deps.audit({
    action: 'affiliate.self_preorder_disclosed',
    actorId: input.actor,
    targetType: 'campaign_affiliate_association',
    targetId: input.associationId,
    internalReason: `§29.1 self-pre-order disclosed${input.reservationId ? ` (reservation ${input.reservationId})` : ''}`,
  });
  return { ok: true, id: inserted[0]!.id };
}

/* ── Reads ────────────────────────────────────────────────────────────────── */

export async function listAffiliateEnforcement(db: Database, campaignId: string) {
  const actions = await db
    .select()
    .from(affiliateEnforcementActions)
    .where(eq(affiliateEnforcementActions.campaignId, campaignId))
    .orderBy(desc(affiliateEnforcementActions.occurredAt));
  const appeals =
    actions.length > 0
      ? await db
          .select()
          .from(affiliateEnforcementAppeals)
          .where(
            inArray(
              affiliateEnforcementAppeals.actionId,
              actions.map((a) => a.id),
            ),
          )
      : [];
  return actions.map((a) => ({
    ...a,
    appeal: appeals.find((p) => p.actionId === a.id) ?? null,
  }));
}
