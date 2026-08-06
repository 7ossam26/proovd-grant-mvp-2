/**
 * The one named pilot campaign — Spec §34 condition 11, §6, §2.2, Appendix C
 * (Phase 24).
 *
 * §6 limits the first live enablement to "one named pilot campaign with
 * monitoring and rollback owners". That is three separate facts — a campaign,
 * two people, and a plan for stopping — and this module refuses to record any
 * of them without the others.
 *
 * ── Why enablement is a record and not a switch ─────────────────────────────
 * The whole of §34 is about being able to say, afterwards, why somebody
 * decided a real card could be charged. A boolean answers "was it on"; a
 * record answers "who decided, on what evidence, with whom on the hook, and
 * what the plan was if it went wrong". The gate snapshot is stored rather than
 * re-read for the same reason 21b stores its completion findings: a decision
 * pointing at a live gate would silently rewrite its own justification the
 * next time a condition moved.
 */

import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  appendixCWalkthroughs,
  pilotCampaignEnablements,
  pilotCampaignOwners,
  pilotPreflightConfirmations,
} from '../db/schema/live-mode.js';
import { campaigns } from '../db/schema/domain.js';
import type { LiveModeGateState } from './gate.js';
import { APPENDIX_C_ACTORS, PILOT_OWNER_ROLES, PILOT_PREFLIGHT_KEYS } from './logic.js';

/* ── Naming a person ───────────────────────────────────────────────────────── */

/**
 * Shapes that are certainly not a named person.
 *
 * §34's trap: "Named owners means named people, not a team alias and not
 * 'whoever's on call.'" A database cannot tell a surname from a team alias, so
 * this catches only the forms that are unambiguously not a reachable
 * individual. Anything subtler is condition 11's recorded judgement — a longer
 * list would start refusing real names, and a check that refuses a correct
 * answer teaches people to work around it.
 */
const NON_PERSON_OWNER_PATTERNS: readonly RegExp[] = [
  /^(?:whoever|whomever)\b/i,
  /\bon[-\s]?call\b/i,
  /\b(?:the\s+)?(?:team|rota|roster|group|duty|desk|queue)\b/i,
  /^(?:support|ops|admin|engineering|eng|payments|finance|billing|alerts?|noreply|no-reply)\b/i,
  /^[^@\s]+@[^@\s]+$/,
];

export interface PilotOwnerInput {
  role: (typeof PILOT_OWNER_ROLES)[number];
  name: string;
  contact: string;
  acknowledgedBy: string;
}

export interface RollbackPlanInput {
  triggers: string;
  decisionMaker: string;
  mechanism: string;
  inFlightReservations: string;
  partyCommunication: string;
}

export interface EnablePilotInput {
  campaignId: string;
  enabledBy: string;
  owners: readonly PilotOwnerInput[];
  rollbackPlan: RollbackPlanInput;
}

export type EnablePilotResult =
  | { ok: true; enablementId: string }
  | { ok: false; violations: string[] };

/**
 * Enables live mode for one campaign.
 *
 * The gate is read here and required OPEN. That is the ordering that matters:
 * §34's conditions are not advice consulted alongside a decision, they are the
 * decision, and an enablement recorded against a closed gate would be the
 * checklist somebody proceeded past.
 */
export async function enablePilotCampaign(
  db: Database,
  gate: LiveModeGateState,
  input: EnablePilotInput,
): Promise<EnablePilotResult> {
  const violations: string[] = [];

  if (!gate.open) {
    violations.push(
      `The §34 gate is closed. Unsatisfied: ${gate.blockingKeys.join(', ')}. Live mode is released by satisfying the conditions, never by enabling around them.`,
    );
  }

  if (!input.enabledBy.trim()) {
    violations.push('No named person is enabling this (§25.6).');
  }

  for (const role of PILOT_OWNER_ROLES) {
    const owner = input.owners.find((o) => o.role === role);
    if (!owner) {
      violations.push(`No ${role} owner is named (§34: named monitoring and rollback owners).`);
      continue;
    }
    const name = owner.name.trim();
    if (!name) {
      violations.push(`The ${role} owner has no name.`);
    } else if (NON_PERSON_OWNER_PATTERNS.some((p) => p.test(name))) {
      violations.push(
        `The ${role} owner "${name}" reads as a team or a rota rather than a person. §34 asks for a named person who knows they hold it.`,
      );
    }
    if (!owner.contact.trim()) {
      violations.push(`The ${role} owner has no contact. §34 requires them to be reachable.`);
    }
    if (!owner.acknowledgedBy.trim()) {
      violations.push(
        `Nobody has recorded that the ${role} owner knows they hold it. §34 asks for owners who know, not owners who were listed.`,
      );
    }
  }

  const planFields: [keyof RollbackPlanInput, string][] = [
    ['triggers', 'what triggers a rollback'],
    ['decisionMaker', 'who decides, and how they are reached'],
    ['mechanism', 'how live mode is disabled'],
    ['inFlightReservations', 'what happens to reservations already saved'],
    ['partyCommunication', 'what each affected party is told, and by whom'],
  ];
  for (const [field, label] of planFields) {
    if (!input.rollbackPlan[field]?.trim()) {
      violations.push(`The rollback plan does not say ${label}.`);
    }
  }

  const [campaign] = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(eq(campaigns.id, input.campaignId))
    .limit(1);
  if (!campaign) {
    violations.push('That campaign does not exist.');
  }

  const existing = await readLivePilot(db);
  if (existing) {
    violations.push(
      `Live mode is already enabled for campaign ${existing.campaignId}. §6 limits the first enablement to one named pilot; roll that one back before recording another.`,
    );
  }

  if (violations.length > 0) return { ok: false, violations };

  const snapshot = gate.conditions
    .map((c) => `${c.key}: ${c.satisfied ? 'satisfied' : 'UNSATISFIED'} — ${c.detail}`)
    .join('\n');

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(pilotCampaignEnablements)
      .values({
        campaignId: input.campaignId,
        enabledBy: input.enabledBy.trim(),
        gateSnapshot: snapshot,
        rollbackTriggers: input.rollbackPlan.triggers.trim(),
        rollbackDecisionMaker: input.rollbackPlan.decisionMaker.trim(),
        rollbackMechanism: input.rollbackPlan.mechanism.trim(),
        rollbackInFlightReservations: input.rollbackPlan.inFlightReservations.trim(),
        rollbackPartyCommunication: input.rollbackPlan.partyCommunication.trim(),
      })
      .returning({ id: pilotCampaignEnablements.id });

    for (const role of PILOT_OWNER_ROLES) {
      const owner = input.owners.find((o) => o.role === role)!;
      await tx.insert(pilotCampaignOwners).values({
        enablementId: row!.id,
        role,
        name: owner.name.trim(),
        contact: owner.contact.trim(),
        acknowledgedBy: owner.acknowledgedBy.trim(),
      });
    }

    return { ok: true as const, enablementId: row!.id };
  });
}

export interface LivePilot {
  enablementId: string;
  campaignId: string;
  enabledBy: string;
  enabledAt: Date;
  owners: readonly { role: string; name: string; contact: string; acknowledgedBy: string }[];
  /** The §34 checks confirmed against the real world so far. */
  preflightConfirmed: readonly string[];
  /** True only once all three are confirmed — the first live reservation waits on this. */
  preflightComplete: boolean;
}

/**
 * The one live enablement, or null.
 *
 * `null` is the answer in every ordinary state of this product: no pilot has
 * been enabled, or one was and it was rolled back. Both mean no live money.
 */
export async function readLivePilot(db: Database): Promise<LivePilot | null> {
  const [row] = await db
    .select()
    .from(pilotCampaignEnablements)
    .where(isNull(pilotCampaignEnablements.rolledBackAt))
    .orderBy(desc(pilotCampaignEnablements.enabledAt))
    .limit(1);

  if (!row) return null;

  const [owners, confirmations] = await Promise.all([
    db
      .select()
      .from(pilotCampaignOwners)
      .where(
        and(
          eq(pilotCampaignOwners.enablementId, row.id),
          isNull(pilotCampaignOwners.supersededAt),
        ),
      ),
    db
      .select({ checkKey: pilotPreflightConfirmations.checkKey })
      .from(pilotPreflightConfirmations)
      .where(eq(pilotPreflightConfirmations.enablementId, row.id)),
  ]);

  const confirmed = confirmations.map((c) => c.checkKey);

  return {
    enablementId: row.id,
    campaignId: row.campaignId,
    enabledBy: row.enabledBy,
    enabledAt: row.enabledAt,
    owners: owners.map((o) => ({
      role: o.role,
      name: o.name,
      contact: o.contact,
      acknowledgedBy: o.acknowledgedBy,
    })),
    preflightConfirmed: confirmed,
    preflightComplete: PILOT_PREFLIGHT_KEYS.every((k) => confirmed.includes(k)),
  };
}

/* ── The rollback ──────────────────────────────────────────────────────────── */

export type RollbackResult = { ok: true } | { ok: false; message: string };

/**
 * Stops live money for the pilot.
 *
 * §34's mechanism requirement is "the same fail-closed flag, flipped", and
 * this is that flip: one conditional UPDATE, and every money path reads the
 * gate on the next call because nothing caches it. No deployment, no restart.
 *
 * The reason is required. A rollback with no reason is live money stopped by
 * somebody nobody can ask about it, and the people whose reservations are now
 * in flight are owed an answer that starts here.
 */
export async function rollBackPilot(
  db: Database,
  input: { rolledBackBy: string; reason: string },
): Promise<RollbackResult> {
  if (!input.rolledBackBy.trim()) {
    return { ok: false, message: '§25.6 requires the actor. Who is rolling this back?' };
  }
  if (!input.reason.trim()) {
    return {
      ok: false,
      message:
        'Say why. The Backers whose reservations are in flight are owed an answer, and it starts with this sentence.',
    };
  }

  const updated = await db
    .update(pilotCampaignEnablements)
    .set({
      rolledBackAt: new Date(),
      rolledBackBy: input.rolledBackBy.trim(),
      rollbackReason: input.reason.trim(),
    })
    .where(isNull(pilotCampaignEnablements.rolledBackAt))
    .returning({ id: pilotCampaignEnablements.id });

  if (updated.length === 0) {
    return { ok: false, message: 'Live mode is not enabled, so there is nothing to roll back.' };
  }

  return { ok: true };
}

/* ── The three pre-first-reservation confirmations ─────────────────────────── */

export type PreflightResult = { ok: true } | { ok: false; message: string };

export async function recordPilotPreflight(
  db: Database,
  input: { checkKey: string; confirmedBy: string; findings: string },
): Promise<PreflightResult> {
  if (!PILOT_PREFLIGHT_KEYS.includes(input.checkKey)) {
    return { ok: false, message: 'That is not one of §34\'s pre-first-reservation checks.' };
  }
  if (!input.confirmedBy.trim()) {
    return { ok: false, message: '§25.6 requires the actor.' };
  }
  if (!input.findings.trim()) {
    return { ok: false, message: 'Say what you observed. A confirmation with no observation is a tick.' };
  }

  const pilot = await readLivePilot(db);
  if (!pilot) {
    return {
      ok: false,
      message:
        'No pilot is enabled. These three are confirmed against a live enablement — confirming them against nothing would record a check of a system that is not running.',
    };
  }

  await db
    .insert(pilotPreflightConfirmations)
    .values({
      enablementId: pilot.enablementId,
      checkKey: input.checkKey,
      confirmedBy: input.confirmedBy.trim(),
      findings: input.findings.trim(),
    })
    .onConflictDoNothing();

  return { ok: true };
}

/* ── Appendix C — the recorded walks ───────────────────────────────────────── */

export interface AppendixCWalkInput {
  actor: string;
  stepKey: string;
  result: 'passed' | 'failed';
  walkedBy: string;
  findings: string;
  undocumentedKnowledgeRequired?: string | undefined;
}

export type AppendixCWalkResult = { ok: true } | { ok: false; message: string };

/**
 * Records one walk of one Appendix C step.
 *
 * The condition is not "the walker got through" — it is Appendix C's own
 * "without undocumented operator knowledge". So a walk that only succeeded
 * because the walker already knew a trick is a FAILED walk, and naming the
 * knowledge while marking it passed is refused here and unrepresentable in
 * 0038. That is the one rule in this file that a checklist would get wrong,
 * because a checklist has no column for "yes, but".
 */
export async function recordAppendixCWalkthrough(
  db: Database,
  input: AppendixCWalkInput,
): Promise<AppendixCWalkResult> {
  if (!APPENDIX_C_ACTORS.includes(input.actor)) {
    return { ok: false, message: 'Appendix C names four actors: admin, founder, creator, backer.' };
  }
  if (!input.walkedBy.trim()) {
    return { ok: false, message: 'Who walked it?' };
  }
  if (!input.findings.trim()) {
    return {
      ok: false,
      message:
        'Say what you did and what you saw. The brief asks for the flow to be walked rather than the code read, and a finding is the only evidence that happened.',
    };
  }

  const undocumented = input.undocumentedKnowledgeRequired?.trim();
  if (undocumented && input.result === 'passed') {
    return {
      ok: false,
      message:
        'Appendix C\'s condition is that the lifecycle runs WITHOUT undocumented operator knowledge. If you had to know something written down nowhere, this step did not pass — record it as failed, and the note is what the next session fixes.',
    };
  }

  await db.insert(appendixCWalkthroughs).values({
    actor: input.actor,
    stepKey: input.stepKey,
    result: input.result,
    walkedBy: input.walkedBy.trim(),
    findings: input.findings.trim(),
    undocumentedKnowledgeRequired: undocumented || null,
  });

  return { ok: true };
}

export interface AppendixCCoverage {
  /** Step keys, `<actor>:<step>`, whose latest walk passed. */
  passed: readonly string[];
  /** Latest walk failed — including a pass that required undocumented knowledge. */
  failed: readonly string[];
  /** Never walked. Not a pass. */
  unwalked: readonly string[];
}

/**
 * The latest walk per step. `unwalked` is deliberately its own answer rather
 * than being folded into `failed`: "nobody has tried this" and "somebody tried
 * this and it did not work" are different facts, and §16a's rule that not yet
 * populated is not zero applies to a verification list as much as to a ledger.
 */
export async function readAppendixCCoverage(
  db: Database,
  allStepKeys: readonly string[],
): Promise<AppendixCCoverage> {
  const rows = await db
    .select({
      actor: appendixCWalkthroughs.actor,
      stepKey: appendixCWalkthroughs.stepKey,
      result: appendixCWalkthroughs.result,
    })
    .from(appendixCWalkthroughs)
    .orderBy(desc(appendixCWalkthroughs.walkedAt));

  const latest = new Map<string, string>();
  for (const row of rows) {
    const key = `${row.actor}:${row.stepKey}`;
    if (!latest.has(key)) latest.set(key, row.result);
  }

  const passed: string[] = [];
  const failed: string[] = [];
  const unwalked: string[] = [];
  for (const key of allStepKeys) {
    const result = latest.get(key);
    if (result === 'passed') passed.push(key);
    else if (result === 'failed') failed.push(key);
    else unwalked.push(key);
  }

  return { passed, failed, unwalked };
}
