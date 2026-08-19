/**
 * The Money & Fulfillment client — Spec §21, §22.1–§22.7, §24.8, §24.11.
 *
 * Six reads and sixteen writes, over routers Phases 18b, 19a, 19b, 20a, 20b,
 * and 21a shipped and §33 drives. Nothing here computes: every amount, every
 * eligibility answer, and every blocker arrives resolved from the service that
 * owns it, because a browser-derived money fact has no record behind it and two
 * derivations of "what is this Founder owed" are two answers waiting to
 * disagree (§33.8.13's whole claim).
 *
 * ── The writes are grouped by the service, not by the screen ────────────────
 * `resumeBatch` is `runCloseBatch` + `endRetryWindow`, the same pair the sweep
 * runs. `finalize`/`approve`/`transfer` are §22.1's own order and each refuses
 * by name. This module adds no ordering rule of its own — a client that checked
 * "is this approvable" before posting would be a second copy of a rule the
 * service already enforces, and the copy is what goes stale.
 */

import { call } from '../api.js';

/* ── The queue ──────────────────────────────────────────────────────────────*/

export interface IncompleteBatchRow {
  campaignId: string;
  batchStatus: string;
  campaignStatus: string;
  startedAt: string;
  lockedReservations: number;
  unresolvedAttempts: number;
  openDedupCases: number;
  recovery: string;
}

export interface RetryWindowRow {
  campaignId: string;
  firstFailureAt: string | null;
  retryDeadlineAt: string | null;
  retrying: number;
}

export interface ReconcilingRow {
  campaignId: string;
  campaignStatus: string;
  requiredItemsVerified: number;
  requiredItemsTotal: number;
  resultsPrepared: boolean;
}

export interface CloseQueueView {
  operations: {
    incomplete: IncompleteBatchRow[];
    retryWindow: RetryWindowRow[];
    reconciling: ReconcilingRow[];
  };
  /* The two registers travel with the payload so the surface renders the §21
     items and the five narrative fields by definition, never by a second
     hardcoded list. Neither carries a short label for an item — the `spec`
     sentence IS the label, which is what keeps the screen and the Spec from
     saying two different things about one item. */
  reconciliationItems: readonly {
    key: string;
    spec: string;
    evaluation: string;
    requiredForResults: boolean;
    waitsOn: string | null;
  }[];
  narrativeFields: readonly { key: string; label: string }[];
}

export const fetchCloseQueue = (): Promise<CloseQueueView> => call('/api/admin/close');

/* ── The batch ──────────────────────────────────────────────────────────────*/

export interface CloseBatchDetailView {
  campaignId: string;
  campaignStatus: string;
  batch: {
    status: string;
    startedAt: string;
    completedAt: string | null;
    thresholdDecision: { met: boolean; unique: number; required: number } | null;
    retryWindowHours: number;
    firstFailureAt: string | null;
    retryDeadlineAt: string | null;
  } | null;
  reservationsByStatus: Record<string, number>;
  attempts: {
    reservationId: string;
    attemptNumber: number;
    idempotencyKey: string;
    amountCents: string;
    outcome: string | null;
    paymentIntentId: string | null;
    requestedAt: string;
    resolvedAt: string | null;
  }[];
}

export interface ReconciliationItemView {
  key: string;
  spec: string;
  evaluation: 'app' | 'admin';
  requiredForResults: boolean;
  derived: Record<string, unknown> | null;
  waitsOn: string | null;
  latest: { result: string; note: string; actor: string; recordedAt: string } | null;
  history: { result: string; note: string; actor: string; recordedAt: string }[];
}

export interface ReconciliationView {
  campaignId: string;
  campaignStatus: string;
  open: boolean;
  openReason: string | null;
  items: ReconciliationItemView[];
  resultsPrepared: boolean;
}

export interface CloseRecordView {
  detail: CloseBatchDetailView;
  reconciliation: ReconciliationView | null;
}

export const fetchCloseRecord = (campaignId: string): Promise<CloseRecordView> =>
  call(`/api/admin/close/${encodeURIComponent(campaignId)}`);

export const resumeBatch = (campaignId: string): Promise<unknown> =>
  call(`/api/admin/close/${encodeURIComponent(campaignId)}/resume`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

export const recordReconciliation = (
  campaignId: string,
  body: { itemKey: string; result: string; note: string },
): Promise<unknown> =>
  call(`/api/admin/close/${encodeURIComponent(campaignId)}/reconciliation`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const prepareResults = (
  campaignId: string,
  narrative: Record<string, string>,
): Promise<unknown> =>
  call(`/api/admin/close/${encodeURIComponent(campaignId)}/results`, {
    method: 'POST',
    body: JSON.stringify(narrative),
  });

/* ── §22.1 Creator earnings ─────────────────────────────────────────────────*/

/**
 * The §22.1 row. `earnings` and `transfer` are the stored records themselves —
 * `readCampaignEarnings` returns Drizzle rows, and every money column on them
 * crosses the wire as a decimal string (`routes/json-safe.ts`).
 *
 * `earnings: null` is the honest pre-finalization state, not zero. §16a's rule
 * runs through this whole surface: nothing has been finalized into an earnings
 * record yet, so there is no amount to render, and US$0.00 would read as "this
 * Creator earned nothing".
 */
export interface CreatorEarningsRowView {
  associationId: string;
  associationStatus: string;
  publicHandle: string | null;
  email: string | null;
  attributedCaptured: number;
  validSubtotalCents: string;
  latestDecision: {
    id: string;
    outcome: string;
    deliverablesNote: string;
    decidedBy: string;
    decidedAt: string;
  } | null;
  earnings: {
    id: string;
    state: string;
    earnedPercent: number;
    commissionCents: string;
    bonusCents: string;
    eligibleFixedCents: string;
    provisionalTotalCents: string;
    earnedTotalCents: string;
    unearnedReturnedCents: string;
    approvedBy: string | null;
  } | null;
  transfer: {
    id: string;
    status: string;
    totalCents: string;
    providerTransferId: string | null;
  } | null;
  allocation: { status: string; amountCents: string } | null;
  thankYou: { kind: string; amountCents: string | null; createdAt: string }[];
  transferEarliestAt: string | null;
}

export interface CreatorEarningsView {
  creators: CreatorEarningsRowView[];
  /* The §22.1 outcomes and the §22.2 eligibility facts, from the shared
     registers. `spec` is the Spec's own sentence and there is no shorter
     label, because the wording an Admin decides against should be the
     wording the rule is written in. */
  completionOutcomes: readonly {
    key: string;
    spec: string;
    fixedDisposition: string;
    commissionDisposition: string;
  }[];
  thankYouEligibilityFacts: readonly { key: string; label: string }[];
}

export const fetchCreatorEarnings = (campaignId: string): Promise<CreatorEarningsView> =>
  call(`/api/admin/close/${encodeURIComponent(campaignId)}/earnings`);

const creatorAct = (associationId: string, act: string, body?: unknown): Promise<unknown> =>
  call(`/api/admin/close/creators/${encodeURIComponent(associationId)}/${act}`, {
    method: 'POST',
    body: JSON.stringify(body ?? {}),
  });

export const recordCompletion = (
  associationId: string,
  body: { outcome: string; deliverablesNote: string },
): Promise<unknown> => creatorAct(associationId, 'completion', body);

export const finalizeEarnings = (associationId: string): Promise<unknown> =>
  creatorAct(associationId, 'finalize');

export const approveEarnings = (associationId: string): Promise<unknown> =>
  creatorAct(associationId, 'approve');

export const createTransfer = (associationId: string): Promise<unknown> =>
  creatorAct(associationId, 'transfer');

export const recordThankYou = (
  associationId: string,
  body: Record<string, unknown>,
): Promise<unknown> => creatorAct(associationId, 'thank-you', body);

/* ── §22.3 Founder payment ──────────────────────────────────────────────────*/

/**
 * One §22.3 payment line, resolved.
 *
 * `blockers` is non-empty exactly when `status` is `blocked` — a blocked line
 * with no named reason is the word §22.3 forbids, respelled.
 */
export interface FounderPaymentLineView {
  kind: string;
  label: string;
  percent: number;
  amountCents: string;
  amountExact: boolean;
  status: 'blocked' | 'eligible' | 'released';
  blockers: string[];
  secureAction: string | null;
  noActionNeeded: boolean;
  dueAt: string;
  releasedAt: string | null;
  releasedEarly: boolean;
}

/**
 * The output of the ONE resolver, `readFounderPaymentStatus`.
 *
 * §33.8.13 is that the Founder's own surface and this one render the same
 * object, so this type is deliberately the whole view rather than a subset:
 * anything this page recomputed would be the second answer that test forbids.
 */
export interface FounderPaymentStatusView {
  campaignId: string;
  model: 'idea' | 'product';
  campaignStatus: string;
  closedAt: string | null;
  currency: 'USD';
  applicable: boolean;
  notApplicableReason: string | null;
  w9: {
    state: string;
    line: string;
    action: string;
    requestedAt: string | null;
    submittedAt: string | null;
    verifiedAt: string | null;
    returnReason: string | null;
    blocksPayments: boolean;
  };
  eligibleShare: {
    exact: boolean;
    amountCents: string;
    note: string;
    basis: {
      rewardSubtotalCapturedCents: string;
      proovdFeeCents: string;
      finalizedCreatorCompensationCents: string;
      causeBasedAdjustmentsCents: string;
      stripeFeesAllocatedToFounderCents: string;
    };
  };
  payments: FounderPaymentLineView[];
  nextReviewDate: string | null;
  day14: { dueAt: string; line: string } | null;
  earlyRelease: {
    settingEnabled: boolean;
    evidence: { id: string; recordedAt: string; missingFacts: string[] } | null;
    pendingRequest: { id: string; createdAt: string } | null;
    neverSkipsDay14: string;
  } | null;
}

export interface FounderPaymentView {
  status: FounderPaymentStatusView;
  requests: { id: string; status: string; createdAt: string; requestedBy: string }[];
  evidenceFacts: readonly { key: string; label: string; note: string | null }[];
  statusFacts: readonly { key: string; spec: string }[];
}

export const fetchFounderPayments = (campaignId: string): Promise<FounderPaymentView> =>
  call(`/api/admin/close/${encodeURIComponent(campaignId)}/founder-payments`);

const founderAct = (campaignId: string, path: string, body?: unknown): Promise<unknown> =>
  call(`/api/admin/close/${encodeURIComponent(campaignId)}/founder-payments${path}`, {
    method: 'POST',
    body: JSON.stringify(body ?? {}),
  });

export const requestW9 = (campaignId: string): Promise<unknown> =>
  founderAct(campaignId, '/w9/request');

export const recordW9Submitted = (campaignId: string, reference: string): Promise<unknown> =>
  founderAct(campaignId, '/w9/submitted', { reference });

export const decideW9 = (
  campaignId: string,
  body: { decision: 'verified' | 'resubmission_required'; note: string },
): Promise<unknown> => founderAct(campaignId, '/w9/decide', body);

export const recordEarlyReleaseEvidence = (
  campaignId: string,
  facts: Record<string, { recorded: boolean; detail: string }>,
): Promise<unknown> => founderAct(campaignId, '/evidence', { facts });

export const decideEarlyRelease = (
  campaignId: string,
  body: { decision: 'approved' | 'declined'; reason: string },
): Promise<unknown> => founderAct(campaignId, '/early-release/decide', body);

export const createFounderPayment = (
  campaignId: string,
  body: { kind: string; checksNote?: string; approvedBy?: string },
): Promise<unknown> => founderAct(campaignId, '', body);

export const releaseFounderPayment = (campaignId: string, kind: string): Promise<unknown> =>
  founderAct(campaignId, `/${encodeURIComponent(kind)}/release`);

/* ── §24.8 refunds and §24.11 disputes ──────────────────────────────────────*/

export interface RefundCaseView {
  refundId: string;
  reference: string;
  reservationId: string;
  campaignId: string;
  status: string;
  amountCents: string;
  ideaExceptionReason: string | null;
  cause: string;
  affiliateTreatment: string;
  proovdFeeTreatment: string;
  affiliateInvalidCents: string | null;
  founderLiabilityCents: string;
  evidence: string;
  mandate: string | null;
  recoveryNote: string | null;
  decidedBy: string;
  failureMessage: string | null;
  providerRefundId: string | null;
  createdAt: string;
}

export interface RefundQueueView {
  cases: RefundCaseView[];
  /* §24.10 lets the Founder as merchant of record issue a refund from their
     own dashboard. One that arrives with no §24.8 case sits here until an
     Admin classifies it — recorded and routed, never guessed into place. */
  unreconciled: {
    providerRefundId: string;
    reservationId: string | null;
    campaignId: string | null;
    amountCents: string | null;
    status: string | null;
    recordedAt: string;
  }[];
  bestEffortRecovery: string;
  /* The cause register carries `permittedAffiliateTreatments`, and that is what
     constrains the form: choosing a cause narrows the rest, and the database
     refuses a combination the cause does not permit. */
  causes: readonly {
    key: string;
    label: string;
    specRef: string;
    allocation: string;
    permittedAffiliateTreatments: readonly string[];
    requiresMandate: boolean;
  }[];
  ideaExceptions: readonly { key: string; label: string }[];
  /* A plain list of keys, not objects — §24.8's four fee treatments have no
     separate label, and the key IS the word an Admin records. */
  proovdFeeTreatments: readonly string[];
}

export const fetchRefunds = (campaignId?: string): Promise<RefundQueueView> =>
  call(`/api/admin/refunds${campaignId ? `?campaignId=${encodeURIComponent(campaignId)}` : ''}`);

export const recordRefundCase = (body: Record<string, unknown>): Promise<unknown> =>
  call('/api/admin/refunds/case', { method: 'POST', body: JSON.stringify(body) });

export interface RefundPreviewView {
  ok: true;
  previewId: string;
  consequences: string[];
  amountCents: string;
}

export const previewRefund = (refundId: string): Promise<RefundPreviewView> =>
  call(`/api/admin/refunds/${encodeURIComponent(refundId)}/preview`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

export const executeRefund = (refundId: string, previewId: string): Promise<unknown> =>
  call(`/api/admin/refunds/${encodeURIComponent(refundId)}/execute`, {
    method: 'POST',
    body: JSON.stringify({ previewId }),
  });

export interface DisputeRowView {
  disputeId: string;
  providerDisputeId: string;
  campaignId: string;
  reservationId: string;
  status: string;
  amountCents: string;
  /** Internal only. §26.8 permits the raw code as secondary Admin detail and
      §33.9.11 keeps it out of anything a customer reads. */
  reasonCode: string | null;
  openedAt: string;
  /** CHECK-pinned to opened_at + 24 hours, and immutable. */
  taskDueAt: string;
  taskOverdue: boolean;
  providerEvidenceDueBy: string | null;
  classified: boolean;
  allocationId: string | null;
  evidenceAssembledAt: string | null;
  closedAt: string | null;
}

export interface DisputeQueueView {
  disputes: DisputeRowView[];
  evidenceItems: readonly { key: string; label: string; required: boolean }[];
  causes: RefundQueueView['causes'];
  proovdFeeTreatments: RefundQueueView['proovdFeeTreatments'];
  bestEffortRecovery: string;
}

export const fetchDisputes = (campaignId?: string): Promise<DisputeQueueView> =>
  call(`/api/admin/disputes${campaignId ? `?campaignId=${encodeURIComponent(campaignId)}` : ''}`);

export interface DisputePacketView {
  disputeId: string;
  providerDisputeId: string;
  /** Each of the ten §24.11 items is present with its stored value, or absent
      with the reason. Assembled from records, never re-derived. */
  items: {
    key: string;
    label: string;
    present: boolean;
    detail: string | null;
    absentBecause: string | null;
  }[];
  complete: boolean;
  missing: string[];
}

export const fetchDisputePacket = (disputeId: string): Promise<DisputePacketView> =>
  call(`/api/admin/disputes/${encodeURIComponent(disputeId)}/evidence`);

export const assembleDisputeEvidence = (disputeId: string, note: string): Promise<unknown> =>
  call(`/api/admin/disputes/${encodeURIComponent(disputeId)}/evidence`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  });

export const classifyDispute = (
  disputeId: string,
  body: Record<string, unknown>,
): Promise<unknown> =>
  call(`/api/admin/disputes/${encodeURIComponent(disputeId)}/classify`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

/* ── §22.4–§22.7 fulfillment ────────────────────────────────────────────────*/

export interface FulfillmentView {
  fulfillment: {
    campaignId: string;
    campaignType: string;
    mechanism: string | null;
    mechanismLabel: string | null;
    accessInstructions: string | null;
    deliveredAt: string | null;
    deliveryNotifiedAt: string | null;
    fulfilledAt: string | null;
    closeAt: string | null;
    chargedAt: string | null;
    obligations: {
      key: string;
      label: string;
      evidence: string;
      state: string;
      dueAt: string | null;
      detail: string;
    }[];
    cadence: {
      state: string;
      nextDueAt: string | null;
      daysSinceLastCommunication: number | null;
      silentDays: number;
    };
    /** Insert-only. Row 1 IS the original promise, and it is what the delivery
        notice, the §24.11 packet, and §22.7's third trigger all read. */
    commitments: {
      sequence: number;
      deliveryMonth: string;
      deliveryDate: string | null;
      commitmentText: string;
      reason: string | null;
      path: string | null;
      notifiedBackersAt: string | null;
      isOriginal: boolean;
    }[];
    /** Derived from the campaign type and whether the remaining payment has
        released — never chosen by a caller. */
    changePath: string;
    pendingChangeRequest: {
      id: string;
      reviewDueAt: string;
      proposedDeliveryMonth: string;
    } | null;
  };
  day14: {
    campaignId: string;
    campaignType: string;
    items: readonly { key: string; label: string; example: string; required: boolean }[];
    reviewOpen: boolean;
    outcome: string;
    decisionDueAt: string | null;
    blocksAPayment: boolean;
    enforcementOnly: boolean;
    submissions: {
      id: string;
      reference: string;
      submittedAt: string;
      submittedBy: string;
      decisionDueAt: string;
      items: { itemKey: string; label: string; detail: string; url: string | null }[];
    }[];
    clarifications: {
      id: string;
      question: string;
      requestedAt: string;
      dueAt: string;
      respondedAt: string | null;
      responseNote: string | null;
      overdue: boolean;
    }[];
  };
  ghostBan: {
    triggersMet: string[];
    labels: Record<string, string>;
    alreadyBanned: boolean;
    requiredFields: readonly string[];
    permanentSentence: string;
    triggers: readonly { key: string; label: string; met: boolean }[];
  } | null;
}

export const fetchFulfillment = (campaignId: string): Promise<FulfillmentView> =>
  call(`/api/admin/fulfillment/campaigns/${encodeURIComponent(campaignId)}`);

export interface Day14QueueView {
  queue: {
    campaignId: string;
    campaignTitle: string | null;
    campaignType: string;
    reviewId: string;
    dueAt: string;
    overdue: boolean;
    outcome: string;
    submissionCount: number;
    latestSubmissionAt: string | null;
    openClarifications: number;
    overdueClarifications: number;
    daysSinceLastUpdate: number | null;
    noSubstantiveUpdateInSevenDays: boolean;
    blocksAPayment: boolean;
  }[];
  failureReasons: readonly { key: string; label: string }[];
}

export const fetchDay14Queue = (): Promise<Day14QueueView> =>
  call('/api/admin/fulfillment/day-14');

export const openDay14 = (campaignId: string): Promise<unknown> =>
  call(`/api/admin/fulfillment/campaigns/${encodeURIComponent(campaignId)}/day-14/open`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

export const requestDay14Clarification = (campaignId: string, note: string): Promise<unknown> =>
  call(`/api/admin/fulfillment/campaigns/${encodeURIComponent(campaignId)}/day-14/clarification`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  });

export const decideDay14 = (
  campaignId: string,
  body: { outcome: string; findings: string[]; failureReasons?: string[]; customerExplanation: string },
): Promise<unknown> =>
  call(`/api/admin/fulfillment/campaigns/${encodeURIComponent(campaignId)}/day-14/decide`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const decideDeliveryChange = (
  requestId: string,
  body: { decision: string; reason: string },
): Promise<unknown> =>
  call(`/api/admin/fulfillment/delivery-changes/${encodeURIComponent(requestId)}/decide`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export { AdminRequestError } from '../api.js';
