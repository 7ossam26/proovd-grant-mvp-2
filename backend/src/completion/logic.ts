/**
 * The §22.8–§22.11 and §31.8 registers, restated — Phase 21b.
 *
 * `shared/src/completion/index.ts` is the register; the backend cannot import
 * it at runtime (rootDir), so what the services and surfaces need is restated
 * here and drift-tested by the suite — the same arrangement as
 * `notifications/events.ts`, `support/logic.ts`, and the state enums.
 */

export const COMPLETION_CRITERIA = [
  {
    key: 'readiness_cleared',
    spec: '§22.8.1: Creator cleared readiness before work.',
    record: 'association_readiness (§16) — the thirteen-item checklist, all-or-nothing',
  },
  {
    key: 'valid_post_verified',
    spec: '§22.8.2: At least one valid post was submitted and verified.',
    record: 'creator_post_submissions (§17) — outcome `passed`',
  },
  {
    key: 'deliverables_resolved',
    spec: '§22.8.3: Every deliverable was verified, or specifically waived by Founder AND Admin with a reason.',
    record: 'creator_completion_decisions (§22.1) — the recorded outcome and its waiver',
  },
  {
    key: 'no_unresolved_case',
    spec: '§22.8.4: No unresolved fraud, invalid-proof, material-breach, or compliance case exists.',
    record: 'affiliate_enforcement_actions (§29) + payment_disputes (§24.11) + day_14_reviews (§22.4)',
  },
  {
    key: 'money_resolved',
    spec: '§22.8.5: Fixed-payment return or payment, commission adjustment, and Transfer are resolved or recorded.',
    record: 'creator_earnings + affiliate_transfers + creator_payment_allocations (§22.1, §24.7)',
  },
] as const;

export type CompletionCriterionKey = (typeof COMPLETION_CRITERIA)[number]['key'];

export const COMPLETION_CRITERION_KEYS = COMPLETION_CRITERIA.map(
  (c) => c.key,
) as CompletionCriterionKey[];

export interface CriterionFinding {
  key: CompletionCriterionKey;
  met: boolean;
  detail: string;
}

export function completionEligible(findings: readonly CriterionFinding[]): boolean {
  if (findings.length !== COMPLETION_CRITERIA.length) return false;
  const seen = new Set(findings.map((f) => f.key));
  if (seen.size !== COMPLETION_CRITERIA.length) return false;
  return findings.every((f) => f.met);
}

export function unmetCriteria(findings: readonly CriterionFinding[]): CriterionFinding[] {
  const byKey = new Map(findings.map((f) => [f.key, f]));
  return COMPLETION_CRITERION_KEYS.map((key) => byKey.get(key)).filter(
    (f): f is CriterionFinding => f !== undefined && !f.met,
  );
}

export const COMPLETION_STATUSES = ['successfully_completed', 'completion_disqualified'] as const;
export type CompletionStatus = (typeof COMPLETION_STATUSES)[number];

/* ── §22.9 ────────────────────────────────────────────────────────────────── */

export const WORK_AGAIN_STATUSES = ['requested', 'accepted', 'declined', 'withdrawn'] as const;
export type WorkAgainStatus = (typeof WORK_AGAIN_STATUSES)[number];

export const WORK_AGAIN_NO_PENALTY =
  'Declining does not harm your standing with Proovd in any way, and it does not affect your completion status on this campaign.';

export const WORK_AGAIN_ACCEPTANCE_GRANTS_NOTHING = [
  'This does not create a campaign.',
  'It does not shorten your three-month cooldown.',
  'It does not count as Admin readiness approval.',
  'It does not raise your active-campaign limit.',
] as const;

/* ── §22.10 ───────────────────────────────────────────────────────────────── */

export const NEXT_CAMPAIGN_GATES = [
  {
    key: 'cooldown',
    spec: '§6, §22.10: at least three months since the previous campaign closed.',
    decidedBy: 'time',
  },
  {
    key: 'admin_readiness',
    spec: '§22.10: `ready for next campaign` only after an Admin decision.',
    decidedBy: 'admin',
  },
] as const;

export type NextCampaignGateKey = (typeof NEXT_CAMPAIGN_GATES)[number]['key'];

export function nextCampaignEarliestAt(closedAt: Date, cooldownMonths: number): Date {
  const result = new Date(closedAt.getTime());
  const targetMonth = result.getUTCMonth() + cooldownMonths;
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(targetMonth);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

export function cooldownElapsed(closedAt: Date, cooldownMonths: number, now: Date): boolean {
  return now.getTime() >= nextCampaignEarliestAt(closedAt, cooldownMonths).getTime();
}

export const PREPARE_WITHOUT_OPENING =
  'You can prepare updates and evidence now. Nothing here opens a new campaign.';

/* ── §31.8 ────────────────────────────────────────────────────────────────── */

export const BACKER_PROGRESSION = [
  { key: 'reserved', label: 'Reserved', from: ['reserved_active'] },
  { key: 'charge_due', label: 'Charge due', from: ['pending_capture'] },
  {
    key: 'no_charge',
    label: 'No charge',
    from: ['threshold_not_met_no_charge', 'killed_no_charge', 'reserved_canceled'],
  },
  { key: 'captured', label: 'Captured', from: ['captured'] },
  { key: 'failed', label: 'Failed', from: ['capture_failed_retrying', 'capture_failed_dropped'] },
  { key: 'delivery_due', label: 'Delivery due', from: ['captured'] },
  { key: 'delivered', label: 'Delivered', from: ['captured'] },
  { key: 'refunded', label: 'Refunded', from: ['refunded', 'reversed', 'disputed'] },
] as const;

export type BackerProgressionKey = (typeof BACKER_PROGRESSION)[number]['key'];

export const SATISFACTION_SCALES = ['binary', 'rating_1_5'] as const;
export type SatisfactionScale = (typeof SATISFACTION_SCALES)[number];

export const NEGATIVE_RATING_AT_OR_BELOW = 2;

export function satisfactionIsNegative(input: {
  scale: SatisfactionScale;
  satisfied?: boolean | undefined;
  rating?: number | undefined;
}): boolean {
  if (input.scale === 'binary') return input.satisfied === false;
  return typeof input.rating === 'number' && input.rating <= NEGATIVE_RATING_AT_OR_BELOW;
}

export const SATISFACTION_PROHIBITIONS = [
  {
    key: 'no_consent_coercion',
    spec: '§31.8: does not coerce newsletter consent.',
    rule: 'No consent control appears in the satisfaction flow, prechecked or otherwise.',
  },
  {
    key: 'no_required_reason',
    spec: '§31.8: "then optional reason".',
    rule: 'The reason field never blocks submission.',
  },
  {
    key: 'no_gated_answer',
    spec: '§31.8: "starts with one click".',
    rule: 'The first answer is recorded on one interaction, with nothing required before it.',
  },
  {
    key: 'no_second_ask',
    spec: '§30: no engagement sequence.',
    rule: 'One response per reservation. A person who answered is never asked again.',
  },
] as const;

export const SATISFACTION_CLICKS_TO_ANSWER = 1;

/* ── §22.11 ───────────────────────────────────────────────────────────────── */

export const RESOLUTION_AREAS = [
  {
    key: 'charge_retry',
    spec: '§22.11: charge/retry.',
    reconciliationItems: ['batch_completeness', 'tax_charge_reconciliation'],
  },
  {
    key: 'creator_transfer',
    spec: '§22.11: Creator Transfer.',
    reconciliationItems: ['creator_deliverables', 'creator_bonus_triggers', 'provisional_vs_earned'],
  },
  {
    key: 'founder_payment',
    spec: '§22.11: Founder payment.',
    reconciliationItems: ['unearned_return', 'founder_share_w9'],
  },
  {
    key: 'refund_adjustment',
    spec: '§22.11: refund/adjustment.',
    reconciliationItems: ['refund_risk_dispute'],
  },
  {
    key: 'close_records',
    spec: '§22.11: required close records.',
    reconciliationItems: ['attribution_post_verification'],
  },
] as const;

export type ResolutionAreaKey = (typeof RESOLUTION_AREAS)[number]['key'];

export const RESOLUTION_IS_NOT_FULFILLMENT =
  'Resolved means the money reconciles. It does not mean the reward has shipped — fulfillment is tracked separately.';

export function resolutionRequiredItems(): string[] {
  return [...new Set(RESOLUTION_AREAS.flatMap((a) => [...a.reconciliationItems]))];
}

export function resolutionComplete(verifiedItems: readonly string[]): boolean {
  const verified = new Set(verifiedItems);
  return resolutionRequiredItems().every((item) => verified.has(item));
}

export function unresolvedAreas(verifiedItems: readonly string[]): ResolutionAreaKey[] {
  const verified = new Set(verifiedItems);
  return RESOLUTION_AREAS.filter(
    (area) => !area.reconciliationItems.every((item) => verified.has(item)),
  ).map((area) => area.key);
}
