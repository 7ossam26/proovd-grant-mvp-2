/**
 * The §34 live-mode readiness gate — Phase 24.
 *
 * Phase 05 built condition 4 and said the rest would be assembled here. This
 * is that assembly, and it is the one read in the product that stands between
 * a real person's card and a charge.
 *
 * ── Fail closed, four ways ──────────────────────────────────────────────────
 *
 *   1. A condition nobody answered is unsatisfied. `composeLiveModeGate` walks
 *      the ELEVEN and fills a missing answer with a refusal, so this function
 *      forgetting a condition closes the gate rather than opening it.
 *   2. A database error closes the gate. Not "assume the last known state",
 *      not "log and continue" — a gate that cannot read its own conditions
 *      does not know whether they hold, and not knowing is a `no`.
 *   3. The two automatic conditions are re-decided on every read. There is no
 *      row to sign them off with (0038's CHECK admits only the other nine), so
 *      a policy revised back to `draft` closes the gate the moment it happens.
 *   4. Nothing is cached. A cached gate is a rollback that does not take
 *      effect, and the whole reason §34 asks for a rollback owner is that
 *      somebody may need it to take effect in seconds. One extra read on a
 *      money path is the cheapest thing in this file.
 */

import { desc } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { readPolicyGate } from '../policies/policy-gate.js';
import { liveModeConditionVerifications } from '../db/schema/live-mode.js';
import {
  CONDITION_KEYS,
  CONDITION_VERIFICATION,
  RECORDABLE_CONDITION_KEYS,
  type ConditionVerification,
} from './logic.js';

export interface ConditionState {
  key: string;
  verification: ConditionVerification;
  satisfied: boolean;
  detail: string;
  /** Present on a filed condition that has ever been answered. */
  filedAnswer: FiledAnswer | null;
}

export interface FiledAnswer {
  status: 'satisfied' | 'not_satisfied';
  verifiedBy: string;
  verifiedAt: Date;
  findings: string;
  evidenceReference: string | null;
}

export interface LiveModeGateState {
  /** True only when every one of the eleven holds. */
  open: boolean;
  /** The keys that do not hold, in §34's order. */
  blockingKeys: readonly string[];
  conditions: readonly ConditionState[];
}

/**
 * The facts the app can observe about its own environment.
 *
 * Passed in rather than read from `process.env`, so the gate is testable and
 * so `env.ts` stays the one place that decides what a valid environment looks
 * like — the arrangement `admin/prerequisites.ts` has used since Phase 06a.
 */
export interface LiveModeEnvironment {
  stripeMode: 'test' | 'live';
  /** Every key carries the prefix matching `stripeMode`. */
  stripeKeysMatchMode: boolean;
  platformWebhookSecretPresent: boolean;
  connectWebhookSecretPresent: boolean;
  /**
   * The two endpoints carry different signing secrets. `env.ts` refuses to
   * boot when they match, so in a running process this is true — recording it
   * here is what makes condition 5 a fact the gate READ rather than a fact the
   * gate assumed.
   */
  webhookSecretsDiffer: boolean;
}

export async function readLiveModeGate(
  db: Database,
  environment: LiveModeEnvironment,
): Promise<LiveModeGateState> {
  let answers: ConditionState[];
  try {
    answers = await gatherConditions(db, environment);
  } catch (error) {
    // §34 is released by satisfying it. A read that failed has satisfied
    // nothing, so every condition blocks and the reason names the failure
    // rather than hiding it behind a generic refusal (§27.1).
    const detail = `The gate could not be read: ${
      error instanceof Error ? error.message : 'unknown error'
    }. A gate that cannot read its own conditions does not know whether they hold.`;
    answers = CONDITION_KEYS.map((key) => ({
      key,
      verification: CONDITION_VERIFICATION[key]!,
      satisfied: false,
      detail,
      filedAnswer: null,
    }));
  }

  return composeGate(answers);
}

/**
 * Composes the eleven from whatever was gathered.
 *
 * `open` is the conjunction and is computed here, never passed in: there is no
 * argument to this function that opens the gate directly. An answer for a key
 * that is not one of the eleven is ignored rather than counted, so a typo
 * cannot satisfy a condition by accident.
 */
function composeGate(answers: readonly ConditionState[]): LiveModeGateState {
  const byKey = new Map(answers.map((a) => [a.key, a]));

  const conditions: ConditionState[] = CONDITION_KEYS.map((key) => {
    const answer = byKey.get(key);
    if (!answer) {
      return {
        key,
        verification: CONDITION_VERIFICATION[key]!,
        satisfied: false,
        detail:
          'No answer was produced for this condition. An unanswered condition is unsatisfied — §34 is released by satisfying it, never by failing to ask.',
        filedAnswer: null,
      };
    }
    return answer;
  });

  const blockingKeys = conditions.filter((c) => !c.satisfied).map((c) => c.key);

  return { open: blockingKeys.length === 0, blockingKeys, conditions };
}

async function gatherConditions(
  db: Database,
  environment: LiveModeEnvironment,
): Promise<ConditionState[]> {
  const [policyGate, filed] = await Promise.all([
    readPolicyGate(db),
    readLatestFiledAnswers(db),
  ]);

  const states: ConditionState[] = [];

  /* ── Condition 4: the eight canonical documents (automatic) ────────────── */
  states.push({
    key: 'policies_published',
    verification: 'automatic',
    satisfied: !policyGate.blocking && policyGate.drafts.length === 0,
    detail: policyGate.reasons.length
      ? policyGate.reasons.join('; ')
      : 'All eight §31.4 documents are published.',
    filedAnswer: null,
  });

  /* ── Condition 5: test/live separation and webhook signatures (automatic) ─ */
  const separationFailures: string[] = [];
  // `stripeKeysMatchMode` folds the shared-secret check in, so the prefix line
  // is reported only when the secrets are genuinely distinct. Naming one
  // problem twice reads as two problems, and the person fixing it goes looking
  // for a key that is already correct.
  if (!environment.stripeKeysMatchMode && environment.webhookSecretsDiffer) {
    separationFailures.push(
      `mode is ${environment.stripeMode} but at least one key does not carry the matching prefix`,
    );
  }
  if (!environment.platformWebhookSecretPresent) {
    separationFailures.push('the platform endpoint has no signing secret');
  }
  if (!environment.connectWebhookSecretPresent) {
    separationFailures.push('the Connect endpoint has no signing secret');
  }
  if (!environment.webhookSecretsDiffer) {
    separationFailures.push(
      'both endpoints carry the same signing secret, so either would accept the other stream',
    );
  }
  states.push({
    key: 'key_separation',
    verification: 'automatic',
    satisfied: separationFailures.length === 0,
    detail:
      separationFailures.length === 0
        ? `Mode is ${environment.stripeMode}, every key carries the matching prefix, and the two endpoints carry different signing secrets.`
        : `Separation is incomplete: ${separationFailures.join('; ')}.`,
    filedAnswer: null,
  });

  /* ── The nine filed conditions ─────────────────────────────────────────── */
  for (const key of RECORDABLE_CONDITION_KEYS) {
    const answer = filed.get(key) ?? null;
    const verification = CONDITION_VERIFICATION[key]!;
    states.push({
      key,
      verification,
      satisfied: answer?.status === 'satisfied',
      detail: answer
        ? answer.status === 'satisfied'
          ? `Verified by ${answer.verifiedBy}. Evidence: ${answer.evidenceReference ?? 'none recorded'}.`
          : `Recorded as not satisfied by ${answer.verifiedBy}.`
        : verification === 'suite'
          ? 'No acceptance-suite run has been filed for this condition. §34 asks whether the tests pass; a server cannot watch its own test run, so somebody files the run and where its output is.'
          : 'Not verified yet. A named person has to check this and record what they found, with the evidence.',
      filedAnswer: answer,
    });
  }

  return states;
}

/** The most recent row per condition. Nothing is ever edited in place. */
async function readLatestFiledAnswers(db: Database): Promise<Map<string, FiledAnswer>> {
  const rows = await db
    .select({
      conditionKey: liveModeConditionVerifications.conditionKey,
      status: liveModeConditionVerifications.status,
      verifiedBy: liveModeConditionVerifications.verifiedBy,
      verifiedAt: liveModeConditionVerifications.verifiedAt,
      findings: liveModeConditionVerifications.findings,
      evidenceReference: liveModeConditionVerifications.evidenceReference,
    })
    .from(liveModeConditionVerifications)
    .orderBy(desc(liveModeConditionVerifications.verifiedAt));

  const latest = new Map<string, FiledAnswer>();
  for (const row of rows) {
    if (latest.has(row.conditionKey)) continue;
    latest.set(row.conditionKey, {
      status: row.status as 'satisfied' | 'not_satisfied',
      verifiedBy: row.verifiedBy,
      verifiedAt: row.verifiedAt,
      findings: row.findings,
      evidenceReference: row.evidenceReference,
    });
  }
  return latest;
}

/* ── Filing an answer ──────────────────────────────────────────────────────── */

export interface FileConditionInput {
  conditionKey: string;
  status: 'satisfied' | 'not_satisfied';
  verifiedBy: string;
  findings: string;
  evidenceReference?: string | undefined;
}

export type FileConditionResult = { ok: true } | { ok: false; message: string };

/**
 * Records one answer. Insert-only — a re-check is a new row, and withdrawing
 * one is a new row saying so.
 *
 * Every refusal is by name, because the person filing an answer about live
 * money is owed the specific thing that is wrong rather than a constraint
 * name from Postgres.
 */
export async function fileLiveModeCondition(
  db: Database,
  input: FileConditionInput,
): Promise<FileConditionResult> {
  const verification = CONDITION_VERIFICATION[input.conditionKey];
  if (!verification) {
    return { ok: false, message: 'That is not one of §34\'s eleven conditions.' };
  }
  if (verification === 'automatic') {
    return {
      ok: false,
      message:
        'This condition is re-decided on every read. Recording a human answer over it would let an attestation outlive the fact it describes — a policy revised back to draft would leave the signature standing.',
    };
  }
  if (!input.verifiedBy.trim()) {
    return { ok: false, message: '§34 asks for a named verifier.' };
  }
  if (!input.findings.trim()) {
    return {
      ok: false,
      message:
        'Say what you checked, in enough detail that somebody else can check the same thing. "Checked" is not a finding, and in a filled row it reads exactly like a condition satisfied by inference.',
    };
  }
  if (input.status === 'satisfied' && !input.evidenceReference?.trim()) {
    return {
      ok: false,
      message:
        '§34 asks for conditions verified with recorded evidence. A satisfied condition pointing at nothing is the checklist a gate is not.',
    };
  }

  await db.insert(liveModeConditionVerifications).values({
    conditionKey: input.conditionKey,
    status: input.status,
    verifiedBy: input.verifiedBy.trim(),
    findings: input.findings.trim(),
    evidenceReference: input.evidenceReference?.trim() ?? null,
  });

  return { ok: true };
}
