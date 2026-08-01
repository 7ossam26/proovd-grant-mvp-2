/**
 * The tax-accountability gate — Spec §11, §24.1, §34.
 *
 * §11: "Connected-account records do not alone decide who must issue US tax
 * forms. Before any live Affiliate payment, the approved tax/accounting
 * configuration must record payer, 1099 filing responsibility, required tax
 * data/form, thresholds, corrections, and reconciliation responsibilities
 * without duplicating sensitive provider-held data."
 *
 * ── Why it is built here and not in Phase 19 ──────────────────────────────
 * It blocks Transfers, which Phase 19 creates. A gate written in the phase it
 * is meant to stop is a gate written under deadline by someone who wants it
 * open. `readTransferGate` exists now, refuses now, and Phase 19 has to satisfy
 * it rather than invent it.
 *
 * ── It refuses on absence, never on doubt ─────────────────────────────────
 * A missing configuration is not "probably fine" — it is the §34 condition that
 * has not been recorded. `blocked: true` is the answer to no record, a
 * superseded record, a record approved for the other mode, and a database that
 * would not answer. The same fail-closed shape as `readPolicyGate` (Phase 05)
 * and `requireFreshSession` (Phase 04).
 */

import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { taxAccountabilityConfig } from '../db/schema/payments.js';
import { auditEvents } from '../db/schema/integrity.js';
import type { StripeModeValue } from './stripe-client.js';

export interface TaxAccountabilityRecord {
  id: string;
  payer: string;
  filingResponsibility: string;
  requiredForm: string;
  requiredData: string;
  thresholds: string;
  correctionsProcess: string;
  reconciliationResponsibility: string;
  approvedBy: string;
  approvedAt: string;
  evidenceReference: string;
  mode: StripeModeValue;
}

export interface TransferGate {
  /** True while no Affiliate payment may be made. */
  blocked: boolean;
  /** Why, in words an Admin can act on. Null when nothing blocks. */
  reason: string | null;
  configuration: TaxAccountabilityRecord | null;
}

/** §11's seven facts, named once so a caller cannot quietly omit one. */
export interface RecordTaxAccountabilityInput {
  payer: string;
  filingResponsibility: string;
  requiredForm: string;
  requiredData: string;
  thresholds: string;
  correctionsProcess: string;
  reconciliationResponsibility: string;
  approvedBy: string;
  evidenceReference: string;
  mode: StripeModeValue;
  /** §25.6 context the database cannot see. */
  actor: string;
  mfaContext?: string | null;
  reauthContext?: string | null;
}

function toRecord(row: typeof taxAccountabilityConfig.$inferSelect): TaxAccountabilityRecord {
  return {
    id: row.id,
    payer: row.payer,
    filingResponsibility: row.filingResponsibility,
    requiredForm: row.requiredForm,
    requiredData: row.requiredData,
    thresholds: row.thresholds,
    correctionsProcess: row.correctionsProcess,
    reconciliationResponsibility: row.reconciliationResponsibility,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt.toISOString(),
    evidenceReference: row.evidenceReference,
    mode: row.mode,
  };
}

/**
 * The configuration in force for one mode, or null.
 *
 * Scoped by mode because a test-mode configuration must never satisfy the gate
 * for live payments — §34 is about proving the two were never confused.
 */
export async function readTaxAccountability(
  db: Database,
  mode: StripeModeValue,
): Promise<TaxAccountabilityRecord | null> {
  const [row] = await db
    .select()
    .from(taxAccountabilityConfig)
    .where(
      and(
        eq(taxAccountabilityConfig.mode, mode),
        isNull(taxAccountabilityConfig.supersededAt),
      ),
    )
    .orderBy(desc(taxAccountabilityConfig.approvedAt))
    .limit(1);

  return row ? toRecord(row) : null;
}

/**
 * Whether an Affiliate payment may be made at all.
 *
 * Phase 19 calls this before every Transfer. It is deliberately not a boolean
 * on a settings row: §11 asks for seven recorded facts and §34 for conditions
 * "recorded as complete", and a flag would satisfy a query while answering
 * none of them.
 */
export async function readTransferGate(
  db: Database,
  mode: StripeModeValue,
): Promise<TransferGate> {
  let configuration: TaxAccountabilityRecord | null;
  try {
    configuration = await readTaxAccountability(db, mode);
  } catch {
    // An unreadable gate is not an open one. `readPolicyGate`'s decision,
    // applied to money.
    return {
      blocked: true,
      reason: 'The tax-accountability configuration could not be read, so no payment may be made.',
      configuration: null,
    };
  }

  if (!configuration) {
    return {
      blocked: true,
      reason:
        `No tax-accountability configuration is recorded for ${mode} mode. §11 requires payer, ` +
        '1099 filing responsibility, required tax data and form, thresholds, corrections, and ' +
        'reconciliation responsibilities to be recorded before any Affiliate payment.',
      configuration: null,
    };
  }

  return { blocked: false, reason: null, configuration };
}

/**
 * Records a configuration, superseding the one in force.
 *
 * Supersession rather than replacement: the earlier row explains what was in
 * force when an earlier payment went out, and the database refuses to edit it.
 * The §25.6 audit row is written in the same transaction because the database
 * cannot see the Admin's MFA context.
 */
export async function recordTaxAccountability(
  db: Database,
  input: RecordTaxAccountabilityInput,
): Promise<TaxAccountabilityRecord> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(taxAccountabilityConfig)
      .where(
        and(
          eq(taxAccountabilityConfig.mode, input.mode),
          isNull(taxAccountabilityConfig.supersededAt),
        ),
      )
      .for('update')
      .limit(1);

    // The replacement's id is minted here rather than by the database, so the
    // old row can be retired and pointed at its successor in ONE statement.
    // It has to be one: the partial unique index allows a single live
    // configuration per mode, so the old row must stop being live before the
    // insert — and the immutability trigger refuses any later write to a row
    // that is already superseded. Two statements would need an exception in
    // that trigger, and an exception is how a superseded record becomes
    // editable after all.
    const nextId = randomUUID();

    if (current) {
      await tx
        .update(taxAccountabilityConfig)
        .set({ supersededAt: new Date(), supersededBy: nextId })
        .where(eq(taxAccountabilityConfig.id, current.id));
    }

    const [created] = await tx
      .insert(taxAccountabilityConfig)
      .values({
        id: nextId,
        payer: input.payer.trim(),
        filingResponsibility: input.filingResponsibility.trim(),
        requiredForm: input.requiredForm.trim(),
        requiredData: input.requiredData.trim(),
        thresholds: input.thresholds.trim(),
        correctionsProcess: input.correctionsProcess.trim(),
        reconciliationResponsibility: input.reconciliationResponsibility.trim(),
        approvedBy: input.approvedBy.trim(),
        evidenceReference: input.evidenceReference.trim(),
        mode: input.mode,
      })
      .returning();

    await tx.insert(auditEvents).values({
      actor: input.actor,
      mfaContext: input.mfaContext ?? null,
      reauthContext: input.reauthContext ?? null,
      targetType: 'tax_accountability_config',
      targetId: created!.id,
      action: 'tax_accountability.recorded',
      internalReason: `tax accountability recorded for ${input.mode} mode by ${input.approvedBy}`,
      // §25.6 keeps the customer-facing wording separate. This configuration has
      // none — it is an internal approval, and nothing about it is shown to a
      // Creator or a Founder.
      customerExplanation: null,
      priorValue: current ? { id: current.id, approvedBy: current.approvedBy } : null,
      newValue: { id: created!.id, approvedBy: created!.approvedBy, mode: created!.mode },
    });

    return toRecord(created!);
  });
}

/** Every configuration, newest first. The §34 evidence trail. */
export async function readTaxAccountabilityHistory(db: Database) {
  const rows = await db
    .select()
    .from(taxAccountabilityConfig)
    .orderBy(desc(taxAccountabilityConfig.approvedAt));
  return rows.map(toRecord);
}
