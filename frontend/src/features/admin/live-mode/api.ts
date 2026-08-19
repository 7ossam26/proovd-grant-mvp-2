/**
 * The §34 live-mode client — Spec §34, §2.1, §6, Appendix C.
 *
 * Five writes and one read, over the API Phase 24 shipped and tested. The
 * registers travel in `@proovd/shared`, so nothing here restates §34's eleven
 * conditions, Appendix C's forty-nine steps, or the five rollback-plan fields.
 *
 * ── There is no function here that opens the gate ───────────────────────────
 * `/admin/prerequisites`' posture since Phase 06a, and Phase 24's own: no route
 * sets `open`, `enablePilotCampaign` reads the gate itself rather than taking
 * it from the caller, and there is no request body that opens live mode. §34 is
 * released by satisfying it. A client function that looked like an override
 * would be the first place somebody went looking for one.
 */

import { call } from '../api.js';
import type {
  ConditionVerification,
  PilotOwnerRole,
  RollbackPlan,
} from '@proovd/shared';

export interface FiledAnswerView {
  status: 'satisfied' | 'not_satisfied';
  verifiedBy: string;
  verifiedAt: string;
  findings: string;
  evidenceReference: string | null;
}

export interface ConditionStateView {
  key: string;
  verification: ConditionVerification;
  satisfied: boolean;
  /** Why it holds, or why it does not. Never a generic refusal (§27.1). */
  detail: string;
  filedAnswer: FiledAnswerView | null;
}

export interface GateView {
  open: boolean;
  blockingKeys: string[];
  conditions: ConditionStateView[];
}

export interface PilotOwnerView {
  role: string;
  name: string;
  contact: string;
  acknowledgedBy: string;
}

export interface PilotView {
  enablementId: string;
  campaignId: string;
  enabledBy: string;
  enabledAt: string;
  owners: PilotOwnerView[];
  preflightConfirmed: string[];
  /** The first live reservation waits on all three (§34). */
  preflightComplete: boolean;
}

export interface AppendixCCoverageView {
  passed: string[];
  /** Includes a pass that required undocumented knowledge — that is a failure. */
  failed: string[];
  /** Never walked. Deliberately not folded into `failed` (§16a). */
  unwalked: string[];
}

export interface LiveModeView {
  gate: GateView;
  pilot: PilotView | null;
  appendixC: AppendixCCoverageView;
  stripeMode: string;
  /** §2.1, derived from condition 1 rather than stored. */
  approvalCopyState: 'conditional_copy_is_correct' | 'conditional_copy_is_now_stale';
}

const BASE = '/api/admin/live-mode';

export const fetchLiveMode = (): Promise<LiveModeView> => call(BASE);

export const fileCondition = (body: {
  conditionKey: string;
  status: 'satisfied' | 'not_satisfied';
  verifiedBy: string;
  findings: string;
  evidenceReference?: string;
}): Promise<{ ok: true }> =>
  call(`${BASE}/conditions`, { method: 'POST', body: JSON.stringify(body) });

export const enablePilot = (body: {
  campaignId: string;
  owners: { role: PilotOwnerRole; name: string; contact: string; acknowledgedBy: string }[];
  rollbackPlan: RollbackPlan;
}): Promise<{ ok: true; enablementId: string }> =>
  call(`${BASE}/pilot`, { method: 'POST', body: JSON.stringify(body) });

export const rollBack = (reason: string): Promise<{ ok: true }> =>
  call(`${BASE}/rollback`, { method: 'POST', body: JSON.stringify({ reason }) });

export const confirmPreflight = (body: {
  checkKey: string;
  findings: string;
}): Promise<{ ok: true }> =>
  call(`${BASE}/preflight`, { method: 'POST', body: JSON.stringify(body) });

export const recordWalkthrough = (body: {
  actor: string;
  stepKey: string;
  result: 'passed' | 'failed';
  findings: string;
  undocumentedKnowledgeRequired?: string;
}): Promise<{ ok: true }> =>
  call(`${BASE}/appendix-c`, { method: 'POST', body: JSON.stringify(body) });
