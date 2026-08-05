/**
 * The Founder money senders — Spec §22.3, §27.2, §27.3, §27.6 (Phase 19b).
 *
 * Every amount, status, and reason in these messages comes from the ONE §22.3
 * resolver (`readFounderPaymentStatus`) or the stored payment row it serves —
 * one source, many renderers (§33.8.13). Every sender dedups at the
 * granularity at which the message may legitimately happen once (§27.2): the
 * W-9 EVENT row (a genuinely new request after a resubmission is a new
 * message; a retry of the same request is not), the campaign (the block), the
 * payment row (each release happens once), the request row (one ack, one
 * result). Every send runs AFTER the domain transaction committed.
 *
 * §27.6's two internal notices finally have their senders: the Day 3/Day 14
 * schedule objects give `internal_money_decisions_due` and
 * `internal_deliverable_verification_due` a §6-derived due time, which is
 * exactly what 19a said it was waiting for before sending them.
 */

import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaignBuild } from '../db/schema/build.js';
import type { EarlyReleaseRequest, FounderPayment } from '../db/schema/founder-payments.js';
import type { Notifier } from '../notifications/send.js';
import {
  FOUNDER_W9_PROMPT,
  FOUNDER_W9_BLOCK,
  FOUNDER_SINGLE_PAYMENT_RELEASED,
  FOUNDER_FIRST_PAYMENT_RELEASED,
  FOUNDER_REMAINING_PAYMENT_RELEASED,
  FOUNDER_EARLY_REMAINING_REQUEST,
  FOUNDER_EARLY_REMAINING_RESULT,
  INTERNAL_MONEY_DECISIONS_DUE,
  INTERNAL_DELIVERABLE_VERIFICATION_DUE,
  INTERNAL_MISSING_W9,
} from '../notifications/events.js';
import {
  renderW9Prompt,
  renderW9Block,
  renderPaymentReleased,
  renderEarlyRequestAck,
  renderEarlyResult,
} from '../notifications/templates/founder-payments.js';
import { renderInternalNotice } from '../notifications/templates/plain.js';
import { loadFounder, type LaunchNotificationContext } from '../launch/notifications.js';
import { formatCents } from '../reservations/restated.js';
import { founderW9Records } from '../db/schema/founder-payments.js';
import {
  FOUNDER_PAYMENT_KIND_LABELS,
  FOUNDER_SHARE_TAX_NOTE,
  EARLY_RELEASE_NEVER_SKIPS_DAY_14,
  type FounderPaymentKind,
} from './founder-payments-logic.js';
import { readFounderPaymentStatus, type FounderPaymentStatusView } from './founder-payments.js';

export interface FounderPaymentNotificationDeps {
  db: Database;
  notifier: Notifier;
  context: LaunchNotificationContext;
}

async function campaignTitle(db: Database, campaignId: string): Promise<string> {
  const [build] = await db
    .select({ title: campaignBuild.title })
    .from(campaignBuild)
    .where(eq(campaignBuild.campaignId, campaignId))
    .limit(1);
  return build?.title ?? 'your campaign';
}

function paymentsUrl(context: LaunchNotificationContext, campaignId: string): string {
  // The Founder's payment status lives on the results surface (§22.3).
  return `${context.appBaseUrl}/campaigns/${campaignId}/results`;
}

/* ── §27.3: the W-9 prompt (request and resubmission) ───────────────────────── */

export async function notifyW9Prompt(
  deps: FounderPaymentNotificationDeps,
  input: { campaignId: string; w9EventId: string; resubmission?: boolean },
): Promise<void> {
  const founder = await loadFounder(deps.db, input.campaignId);
  if (!founder.email) return;

  const [record] = await deps.db
    .select({ returnReason: founderW9Records.returnReason })
    .from(founderW9Records)
    .where(eq(founderW9Records.campaignId, input.campaignId))
    .limit(1);

  const rendered = await renderW9Prompt({
    campaignTitle: await campaignTitle(deps.db, input.campaignId),
    resubmission: Boolean(input.resubmission),
    resubmissionReason: input.resubmission ? (record?.returnReason ?? null) : null,
    paymentsUrl: paymentsUrl(deps.context, input.campaignId),
    reference: input.campaignId,
    supportEmail: deps.context.supportEmail,
  });

  await deps.notifier.send({
    eventKey: FOUNDER_W9_PROMPT,
    entityType: 'founder_w9_event',
    // Per EVENT row: the first request and each recorded resubmission request
    // are genuinely different messages; a retry of either is not (§27.2).
    entityId: input.w9EventId,
    to: founder.email,
    from: deps.context.fromAddress,
    replyTo: deps.context.supportEmail,
    ...rendered,
  });
}

/* ── §27.3: the W-9 block on payment (§33.8.9's message) ────────────────────── */

export async function notifyW9Block(
  deps: FounderPaymentNotificationDeps,
  input: { campaignId: string; view: FounderPaymentStatusView },
): Promise<boolean> {
  const founder = await loadFounder(deps.db, input.campaignId);
  if (!founder.email) return false;

  // §22.3: the exact amount affected — every unreleased payment on the
  // schedule, from the one resolver.
  const affected = input.view.payments
    .filter((p) => p.status !== 'released')
    .reduce((sum, p) => sum + BigInt(p.amountCents), 0n);

  const rendered = await renderW9Block({
    campaignTitle: await campaignTitle(deps.db, input.campaignId),
    amountAffected: `US$${formatCents(affected)}`,
    amountExact: input.view.eligibleShare.exact,
    nextReviewDate: input.view.nextReviewDate?.slice(0, 10) ?? null,
    paymentsUrl: paymentsUrl(deps.context, input.campaignId),
    reference: input.campaignId,
    supportEmail: deps.context.supportEmail,
  });

  const outcome = await deps.notifier.send({
    eventKey: FOUNDER_W9_BLOCK,
    entityType: 'campaign',
    // Once per campaign: the block is one fact, however many sweep ticks see
    // it. The prompt (deduped per event) carries any later resubmission ask.
    entityId: input.campaignId,
    to: founder.email,
    from: deps.context.fromAddress,
    replyTo: deps.context.supportEmail,
    ...rendered,
  });
  return outcome.status === 'sent';
}

/* ── §27.3: a payment released — three keys, one template ───────────────────── */

const RELEASE_EVENT_KEYS = {
  single_payment: FOUNDER_SINGLE_PAYMENT_RELEASED,
  first_payment: FOUNDER_FIRST_PAYMENT_RELEASED,
  remaining_payment: FOUNDER_REMAINING_PAYMENT_RELEASED,
} as const satisfies Record<FounderPaymentKind, string>;

export async function notifyFounderPaymentReleased(
  deps: FounderPaymentNotificationDeps,
  input: { payment: FounderPayment },
): Promise<void> {
  const founder = await loadFounder(deps.db, input.payment.campaignId);
  if (!founder.email) return;

  const kind = input.payment.kind as FounderPaymentKind;
  const scheduleLine =
    kind === 'single_payment'
      ? `This is the one payment for an Idea campaign — ${input.payment.percent}% of your eligible Founder share, scheduled Day ${input.payment.scheduledDay} after close.`
      : kind === 'first_payment'
        ? `This is your first payment — ${input.payment.percent}% of your eligible Founder share, scheduled Day ${input.payment.scheduledDay} after close. The remaining payment follows the Day 14 schedule.`
        : input.payment.releasedEarly
          ? 'This is your remaining payment — the exact rest of your eligible Founder share, released early on recorded delivery, communication, tax, and no-risk evidence.'
          : `This is your remaining payment — the exact rest of your eligible Founder share, scheduled Day ${input.payment.scheduledDay} after close.`;

  const rendered = await renderPaymentReleased({
    kindLabel: FOUNDER_PAYMENT_KIND_LABELS[kind],
    campaignTitle: await campaignTitle(deps.db, input.payment.campaignId),
    amount: `US$${formatCents(input.payment.amountCents)}`,
    shareAmount: `US$${formatCents(input.payment.eligibleShareCents)}`,
    scheduleLine,
    earlyLine: input.payment.releasedEarly ? EARLY_RELEASE_NEVER_SKIPS_DAY_14 : null,
    taxNote: FOUNDER_SHARE_TAX_NOTE,
    paymentsUrl: paymentsUrl(deps.context, input.payment.campaignId),
    reference: input.payment.id,
    supportEmail: deps.context.supportEmail,
  });

  await deps.notifier.send({
    eventKey: RELEASE_EVENT_KEYS[kind],
    entityType: 'founder_payment',
    // Per payment row: each release happens once (§33.8.10 makes the row
    // singular, so the dedup rides on it).
    entityId: input.payment.id,
    to: founder.email,
    from: deps.context.fromAddress,
    replyTo: deps.context.supportEmail,
    ...rendered,
  });
}

/* ── §27.3: the early-release request and its result ────────────────────────── */

export async function notifyEarlyRequestReceived(
  deps: FounderPaymentNotificationDeps,
  input: { request: EarlyReleaseRequest },
): Promise<void> {
  const founder = await loadFounder(deps.db, input.request.campaignId);
  if (!founder.email) return;

  const rendered = await renderEarlyRequestAck({
    campaignTitle: await campaignTitle(deps.db, input.request.campaignId),
    paymentsUrl: paymentsUrl(deps.context, input.request.campaignId),
    reference: input.request.id,
    supportEmail: deps.context.supportEmail,
  });

  await deps.notifier.send({
    eventKey: FOUNDER_EARLY_REMAINING_REQUEST,
    entityType: 'early_release_request',
    entityId: input.request.id,
    to: founder.email,
    from: deps.context.fromAddress,
    replyTo: deps.context.supportEmail,
    ...rendered,
  });
}

export async function notifyEarlyRequestResult(
  deps: FounderPaymentNotificationDeps,
  input: { request: EarlyReleaseRequest },
): Promise<void> {
  const founder = await loadFounder(deps.db, input.request.campaignId);
  if (!founder.email) return;

  const approved = input.request.status === 'approved';

  // §27.2: a money email names its amount, and §33.8.13 says it comes from the
  // ONE §22.3 resolver rather than being recomputed for this message. The
  // request is about the remaining payment specifically, so that is the row
  // read — never the eligible share, which is what it is a percentage of.
  const view = await readFounderPaymentStatus(deps.db, {
    campaignId: input.request.campaignId,
    now: new Date(),
  });
  const remaining = view?.payments.find((p) => p.kind === 'remaining_payment');

  const rendered = await renderEarlyResult({
    campaignTitle: await campaignTitle(deps.db, input.request.campaignId),
    approved,
    amount: remaining ? `US$${formatCents(BigInt(remaining.amountCents))}` : 'not yet determined',
    reason: input.request.decisionReason ?? '',
    neverSkipsLine: approved ? EARLY_RELEASE_NEVER_SKIPS_DAY_14 : null,
    paymentsUrl: paymentsUrl(deps.context, input.request.campaignId),
    reference: input.request.id,
    supportEmail: deps.context.supportEmail,
  });

  await deps.notifier.send({
    eventKey: FOUNDER_EARLY_REMAINING_RESULT,
    entityType: 'early_release_request',
    // One result per request — a request is decided once (trigger-enforced).
    entityId: input.request.id,
    to: founder.email,
    from: deps.context.fromAddress,
    replyTo: deps.context.supportEmail,
    ...rendered,
  });
}

/**
 * §27.6's "Missing W-9" (Phase 22b).
 *
 * `founder_w9_block` tells the Founder their payment is blocked; §27.6 names
 * the Admin notice separately, and the schedule sweep already computes the
 * state that sends both. It rides the same detection rather than a second one,
 * so the two can never disagree about whether a campaign is blocked.
 *
 * Once per campaign: the campaign enters `captured_pending_w9` once, and a
 * nightly repeat of the same fact is the drumbeat §27.1 is not asking for.
 */
export async function notifyMissingW9Internal(
  deps: FounderPaymentNotificationDeps,
  input: { campaignId: string; view: FounderPaymentStatusView },
): Promise<boolean> {
  const affected = input.view.payments
    .filter((p) => p.status !== 'released')
    .reduce((sum, p) => sum + BigInt(p.amountCents), 0n);

  const notice = await renderInternalNotice({
    subject: `W-9 missing — campaign ${input.campaignId}`,
    headline: `A verified W-9 is missing — campaign ${input.campaignId}`,
    facts: [
      { label: 'Campaign', value: await campaignTitle(deps.db, input.campaignId) },
      { label: 'Amount blocked', value: `US$${formatCents(affected)}` },
      {
        label: 'Why',
        value:
          'Charges settled and the payment schedule has started; no Founder payment can exist without a verified W-9 (§22.3).',
      },
      {
        label: 'Next',
        value: 'Record receipt and the verification decision from the close queue.',
      },
    ],
    action: { label: 'Open the close queue', url: `${deps.context.appBaseUrl}/admin/close` },
    reference: input.campaignId,
    supportEmail: deps.context.supportEmail,
  });

  const outcome = await deps.notifier.send({
    eventKey: INTERNAL_MISSING_W9,
    entityType: 'campaign',
    entityId: input.campaignId,
    to: deps.context.supportEmail,
    from: deps.context.fromAddress,
    ...notice,
  });
  return outcome.status === 'sent';
}

/* ── §27.6: the two internal notices, to the staffed inbox ──────────────────── */

export async function notifyMoneyDecisionsDue(
  deps: FounderPaymentNotificationDeps,
  input: { campaignId: string; day: number; dueAt: Date },
): Promise<boolean> {
  const notice = await renderInternalNotice({
    subject: `Money decisions due — campaign ${input.campaignId}`,
    headline: `Day ${input.day} money decisions are due — campaign ${input.campaignId}`,
    facts: [
      // §27.1: a deadline names its zone.
      { label: 'Due', value: `${input.dueAt.toISOString().replace('Z', '')} UTC` },
      { label: 'Schedule day', value: `Day ${input.day} from campaign close` },
    ],
    paragraphs: [
      'Founder payment eligibility under the §22.3 schedule, and any remaining Creator earnings approvals and Transfers (§22.1).',
    ],
    action: { label: 'Open the close queue', url: `${deps.context.appBaseUrl}/admin/close` },
    reference: input.campaignId,
    supportEmail: deps.context.supportEmail,
  });

  const outcome = await deps.notifier.send({
    eventKey: INTERNAL_MONEY_DECISIONS_DUE,
    entityType: 'campaign',
    // Once per campaign: the schedule day arrives once.
    entityId: input.campaignId,
    to: deps.context.supportEmail,
    from: deps.context.fromAddress,
    ...notice,
  });
  return outcome.status === 'sent';
}

export async function notifyDeliverableVerificationDue(
  deps: FounderPaymentNotificationDeps,
  input: { campaignId: string; missingCount: number },
): Promise<boolean> {
  const notice = await renderInternalNotice({
    subject: `Deliverable verification due — campaign ${input.campaignId}`,
    headline: `Deliverable verification is due — campaign ${input.campaignId}`,
    facts: [
      {
        label: 'Awaiting a §22.1 completion decision',
        value: `${input.missingCount} Creator association${input.missingCount === 1 ? '' : 's'}`,
      },
      { label: 'Why now', value: 'The money schedule has reached its first payment day' },
    ],
    action: { label: 'Open the close queue', url: `${deps.context.appBaseUrl}/admin/close` },
    reference: input.campaignId,
    supportEmail: deps.context.supportEmail,
  });

  const outcome = await deps.notifier.send({
    eventKey: INTERNAL_DELIVERABLE_VERIFICATION_DUE,
    entityType: 'campaign',
    entityId: input.campaignId,
    to: deps.context.supportEmail,
    from: deps.context.fromAddress,
    ...notice,
  });
  return outcome.status === 'sent';
}
