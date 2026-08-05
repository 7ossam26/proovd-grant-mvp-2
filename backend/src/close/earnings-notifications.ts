/**
 * The Creator money senders — Spec §22.1, §27.2, §27.4 (Phase 19a).
 *
 * Every money status in these messages is the SAME rendered Appendix B.7 block
 * the Creator close view serves (`resolveAffiliateMoneyStatus`) — one source,
 * many renderers (§33.8.13). Every sender dedups at the granularity at which
 * the message may legitimately happen once (§27.2): the decision row, the
 * earnings row, the transfer row. Every send runs AFTER the domain transaction
 * committed; a provider refusal is recorded by the notifier and never rolled
 * back onto money.
 *
 * The customer-facing outcome sentences are a fixed map. The internal decision
 * note, the provider failure message, and the §22.1 category names stay on
 * their internal rows (§25.6, §33.9.11).
 */

import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaignAffiliateAssociations } from '../db/schema/domain.js';
import { campaignBuild } from '../db/schema/build.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import type {
  CreatorCompletionDecision,
  CreatorEarnings,
  AffiliateTransfer,
} from '../db/schema/earnings.js';
import type { Notifier } from '../notifications/send.js';
import {
  AFFILIATE_COMPLETION_DECISION,
  AFFILIATE_COMMISSION_FINALIZED,
  AFFILIATE_TRANSFER_CREATED,
  AFFILIATE_TRANSFER_FAILURE,
  AFFILIATE_PAYOUT_PAID,
  AFFILIATE_PAYOUT_FAILED,
} from '../notifications/events.js';
import {
  renderCompletionDecision,
  renderCommissionFinalized,
  renderTransferCreated,
  renderTransferFailure,
  renderPayout,
} from '../notifications/templates/earnings.js';
import type { LaunchNotificationContext } from '../launch/notifications.js';
import { formatCents } from '../reservations/restated.js';
import { formatUtcInstant } from '../reservations/consent.js';
import { resolveAffiliateMoneyStatus, NO_ACTION_NEEDED } from '../campaign/editing-logic.js';
import { dayAfterClose } from './creator-close.js';
import { TRANSFER_EARLIEST_DAY, type CompletionOutcomeKey } from './earnings-logic.js';

export interface EarningsNotificationDeps {
  db: Database;
  notifier: Notifier;
  context: LaunchNotificationContext;
}

/** The customer-safe §22.1 outcome sentences — never the internal note. */
export const OUTCOME_CUSTOMER_LINES: Readonly<Record<CompletionOutcomeKey, string>> = {
  no_valid_post:
    'No valid compliant post could be verified for this campaign, so no commission applies.',
  valid_post_later_incomplete:
    'Your verified post stands, and genuine commission from your compliant attributed sales remains. The later agreed deliverables were not completed.',
  complete_verified: 'All agreed deliverables are complete and verified.',
  disqualified:
    'This partnership was found in material breach of the campaign terms, so unpaid amounts were canceled.',
};

const FIXED_ACTION_LINES: Readonly<Record<string, string | null>> = {
  none: null,
  returned_full: 'Fixed Creator payment returned to the Founder, as this outcome provides.',
  eligible_full:
    'Your full fixed Creator payment is eligible and will be included in your campaign Transfer.',
  recovery_recorded:
    'Amounts already transferred are subject to contractual recovery under your agreement.',
};

async function creatorRecipient(
  db: Database,
  associationId: string,
): Promise<{ email: string | null; campaignTitle: string; campaignId: string } | null> {
  const [association] = await db
    .select({ campaignId: campaignAffiliateAssociations.campaignId })
    .from(campaignAffiliateAssociations)
    .where(eq(campaignAffiliateAssociations.id, associationId))
    .limit(1);
  if (!association) return null;

  const [profile] = await db
    .select({ email: affiliateSignupProfiles.email })
    .from(affiliateSignupProfiles)
    .where(eq(affiliateSignupProfiles.associationId, associationId))
    .limit(1);
  const [build] = await db
    .select({ title: campaignBuild.title })
    .from(campaignBuild)
    .where(eq(campaignBuild.campaignId, association.campaignId))
    .limit(1);
  return {
    email: profile?.email ?? null,
    campaignTitle: build?.title ?? 'the campaign',
    campaignId: association.campaignId,
  };
}

function closeViewUrl(context: LaunchNotificationContext, associationId: string): string {
  return `${context.appBaseUrl}/creator/campaigns/${associationId}/close`;
}

/* ── §27.4: the completion / fixed-payment decision ─────────────────────────── */

export async function notifyCompletionDecision(
  deps: EarningsNotificationDeps,
  input: { decision: CreatorCompletionDecision; fixedAction: string },
): Promise<void> {
  const recipient = await creatorRecipient(deps.db, input.decision.associationId);
  if (!recipient?.email) return;

  const rendered = await renderCompletionDecision({
    campaignTitle: recipient.campaignTitle,
    outcomeLine: OUTCOME_CUSTOMER_LINES[input.decision.outcome as CompletionOutcomeKey],
    fixedPaymentLine: FIXED_ACTION_LINES[input.fixedAction] ?? null,
    partnershipUrl: closeViewUrl(deps.context, input.decision.associationId),
    reference: input.decision.id,
    supportEmail: deps.context.supportEmail,
  });

  await deps.notifier.send({
    eventKey: AFFILIATE_COMPLETION_DECISION,
    entityType: 'creator_completion_decision',
    // Per DECISION: a new outcome is a new message; a duplicate submit was
    // refused upstream, and a retry of this send dedups here (§27.2).
    entityId: input.decision.id,
    to: recipient.email,
    from: deps.context.fromAddress,
    replyTo: deps.context.supportEmail,
    ...rendered,
  });
}

/* ── §27.4: commission finalized ────────────────────────────────────────────── */

export async function notifyCommissionFinalized(
  deps: EarningsNotificationDeps,
  input: { earnings: CreatorEarnings; closeAt: Date | null },
): Promise<void> {
  const recipient = await creatorRecipient(deps.db, input.earnings.associationId);
  if (!recipient?.email) return;

  const total =
    input.earnings.commissionCents + input.earnings.bonusCents + input.earnings.eligibleFixedCents;
  const nextUpdate = input.closeAt
    ? `${formatUtcInstant(dayAfterClose(input.closeAt, TRANSFER_EARLIEST_DAY))} — the earliest your one campaign Transfer can be created`
    : 'when your one campaign Transfer is approved';

  const moneyStatusBlock = resolveAffiliateMoneyStatus({
    amount: formatCents(total),
    state: 'finalized',
    reason: 'Your earnings are finalized and awaiting approval for your one campaign Transfer.',
    nextUpdate,
    action: NO_ACTION_NEEDED,
  });

  const rendered = await renderCommissionFinalized({
    campaignTitle: recipient.campaignTitle,
    commissionAmount: formatCents(input.earnings.commissionCents),
    bonusAmount: formatCents(input.earnings.bonusCents),
    fixedAmount: formatCents(input.earnings.eligibleFixedCents),
    moneyStatusBlock,
    partnershipUrl: closeViewUrl(deps.context, input.earnings.associationId),
    reference: input.earnings.id,
    supportEmail: deps.context.supportEmail,
  });

  await deps.notifier.send({
    eventKey: AFFILIATE_COMMISSION_FINALIZED,
    entityType: 'creator_earnings',
    // Finalization is once per association (§33.8.2), so the row is the dedup.
    entityId: input.earnings.id,
    to: recipient.email,
    from: deps.context.fromAddress,
    replyTo: deps.context.supportEmail,
    ...rendered,
  });
}

/* ── §27.4: Transfer created ────────────────────────────────────────────────── */

export async function notifyTransferCreated(
  deps: EarningsNotificationDeps,
  input: { transfer: AffiliateTransfer },
): Promise<void> {
  const recipient = await creatorRecipient(deps.db, input.transfer.associationId);
  if (!recipient?.email) return;

  const moneyStatusBlock = resolveAffiliateMoneyStatus({
    amount: formatCents(input.transfer.totalCents),
    state: 'transferred',
    reason: 'Proovd has sent your Transfer; your bank payout follows your Stripe payout schedule.',
    nextUpdate: 'when your bank posts the payout',
    action: NO_ACTION_NEEDED,
  });

  const rendered = await renderTransferCreated({
    campaignTitle: recipient.campaignTitle,
    commissionAmount: formatCents(input.transfer.commissionCents),
    bonusAmount: formatCents(input.transfer.bonusCents),
    fixedAmount: formatCents(input.transfer.fixedCents),
    totalAmount: formatCents(input.transfer.totalCents),
    moneyStatusBlock,
    partnershipUrl: closeViewUrl(deps.context, input.transfer.associationId),
    reference: input.transfer.id,
    supportEmail: deps.context.supportEmail,
  });

  await deps.notifier.send({
    eventKey: AFFILIATE_TRANSFER_CREATED,
    entityType: 'affiliate_transfer',
    // ONE Transfer per association (§33.8.3) — the row is the dedup.
    entityId: input.transfer.id,
    to: recipient.email,
    from: deps.context.fromAddress,
    replyTo: deps.context.supportEmail,
    ...rendered,
  });
}

/* ── §27.4: Transfer failure (a retry-job case, §32.3) ──────────────────────── */

export async function notifyTransferFailure(
  deps: EarningsNotificationDeps,
  input: {
    transferId: string;
    associationId: string;
    campaignId: string;
    /** §27.2: a money message names its amount. */
    totalCents: bigint;
  },
): Promise<void> {
  const recipient = await creatorRecipient(deps.db, input.associationId);
  if (!recipient?.email) return;

  const rendered = await renderTransferFailure({
    amount: `US$${formatCents(input.totalCents)}`,
    campaignTitle: recipient.campaignTitle,
    partnershipUrl: closeViewUrl(deps.context, input.associationId),
    reference: input.transferId,
    supportEmail: deps.context.supportEmail,
  });

  await deps.notifier.send({
    eventKey: AFFILIATE_TRANSFER_FAILURE,
    entityType: 'affiliate_transfer',
    // One failure notice per Transfer, however many times the sweep retries
    // it — a nightly drumbeat of identical failures is not §27.1's answer.
    entityId: input.transferId,
    to: recipient.email,
    from: deps.context.fromAddress,
    replyTo: deps.context.supportEmail,
    ...rendered,
  });
}

/* ── §27.4: payout paid / payout failed ─────────────────────────────────────── */

export async function notifyPayout(
  deps: EarningsNotificationDeps,
  input: { kind: 'paid' | 'failed'; earnings: CreatorEarnings; payoutId: string },
): Promise<void> {
  const recipient = await creatorRecipient(deps.db, input.earnings.associationId);
  if (!recipient?.email) return;

  const total =
    input.earnings.commissionCents + input.earnings.bonusCents + input.earnings.eligibleFixedCents;
  const moneyStatusBlock = resolveAffiliateMoneyStatus({
    amount: formatCents(total),
    state: input.kind === 'paid' ? 'paid_out' : 'payout_failed',
    reason:
      input.kind === 'paid'
        ? ''
        : 'Stripe could not pay out your balance to your bank; your earnings are unchanged.',
    nextUpdate:
      input.kind === 'paid'
        ? 'none — this campaign Transfer has been paid out'
        : 'once your payout details are updated with Stripe',
    action:
      input.kind === 'paid'
        ? NO_ACTION_NEEDED
        : 'Update your payout details through your Stripe-managed payout setup',
  });

  const rendered = await renderPayout(input.kind, {
    campaignTitle: recipient.campaignTitle,
    moneyStatusBlock,
    partnershipUrl: closeViewUrl(deps.context, input.earnings.associationId),
    reference: input.payoutId,
    supportEmail: deps.context.supportEmail,
  });

  await deps.notifier.send({
    eventKey: input.kind === 'paid' ? AFFILIATE_PAYOUT_PAID : AFFILIATE_PAYOUT_FAILED,
    entityType: 'creator_earnings',
    // Per earnings row and payout event: a failed payout later paid sends the
    // paid notice under its own key; a replayed delivery sends nothing.
    entityId: `${input.earnings.id}:${input.payoutId}`,
    to: recipient.email,
    from: deps.context.fromAddress,
    replyTo: deps.context.supportEmail,
    ...rendered,
  });
}
