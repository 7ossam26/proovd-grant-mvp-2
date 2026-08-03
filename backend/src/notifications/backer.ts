/**
 * Backer transactional email — Spec §27.5.
 *
 * The integration layer between the pre-order/cancellation services and the
 * §27.5 templates. Every send dedups on `notification_deliveries` (§27.2), and
 * the entity is chosen at the granularity at which the message may legitimately
 * happen twice: a pre-order confirmation is keyed on the *reservation*, because
 * it happens once per reservation, and a duplicate delivery of the same event
 * (a webhook or a retry) must never send a second one.
 */

import type { Notifier } from './send.js';
import {
  BACKER_PREORDER_CONFIRMATION,
  BACKER_CANCELLATION_CONFIRMATION,
  BACKER_PRECHARGE_REMINDER,
} from './events.js';
import {
  renderPreorderConfirmation,
  type PreorderConfirmationVariables,
} from './templates/backer-preorder.js';
import { renderCancellation } from './templates/backer-cancellation.js';
import { renderPrechargeReminder } from './templates/backer-precharge-reminder.js';

const SUPPORT_EMAIL = 'support@proovd.co';

export interface SendPreorderConfirmationInput {
  to: string;
  reservationId: string;
  lead: string;
  success: {
    campaignTitle: string;
    founderLegalName: string;
    rewardTitle: string;
    rewardSubtotal: string;
    salesTax: string;
    totalAuthorized: string;
    chargeRule: string;
    chargeTimeUtc: string;
    delivery: string;
    statementDescriptor: string;
    magicLinkUrl: string;
  };
}

export async function sendPreorderConfirmation(
  deps: { notifier: Notifier; from: string },
  input: SendPreorderConfirmationInput,
): Promise<void> {
  const variables: PreorderConfirmationVariables = {
    campaignTitle: input.success.campaignTitle,
    founderLegalName: input.success.founderLegalName,
    rewardTitle: input.success.rewardTitle,
    rewardSubtotal: input.success.rewardSubtotal,
    salesTax: input.success.salesTax,
    totalAuthorized: input.success.totalAuthorized,
    chargeRule: input.success.chargeRule,
    chargeTimeUtc: input.success.chargeTimeUtc,
    delivery: input.success.delivery,
    statementDescriptor: input.success.statementDescriptor,
    magicLinkUrl: input.success.magicLinkUrl,
    reference: input.reservationId,
    supportEmail: SUPPORT_EMAIL,
  };

  const rendered = await renderPreorderConfirmation(variables);

  await deps.notifier.send({
    eventKey: BACKER_PREORDER_CONFIRMATION,
    entityType: 'reservation',
    // One confirmation per reservation, ever (§27.2).
    entityId: input.reservationId,
    to: input.to,
    from: deps.from,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });
}

export interface SendCancellationInput {
  to: string;
  reservationId: string;
  campaignTitle: string;
  rewardTitle: string;
  canceledAtUtc: string;
}

export async function sendCancellationConfirmation(
  deps: { notifier: Notifier; from: string },
  input: SendCancellationInput,
): Promise<void> {
  const rendered = await renderCancellation({
    campaignTitle: input.campaignTitle,
    rewardTitle: input.rewardTitle,
    canceledAtUtc: input.canceledAtUtc,
    reference: input.reservationId,
    supportEmail: SUPPORT_EMAIL,
  });
  await deps.notifier.send({
    eventKey: BACKER_CANCELLATION_CONFIRMATION,
    entityType: 'reservation',
    // One cancellation confirmation per reservation — a duplicate cancel sends none.
    entityId: input.reservationId,
    to: input.to,
    from: deps.from,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });
}

export interface SendPrechargeReminderInput {
  to: string;
  reservationId: string;
  campaignTitle: string;
  founderLegalName: string;
  rewardSubtotal: string;
  salesTax: string;
  totalAuthorized: string;
  whenUtc: string;
  condition: string;
  statementDescriptor: string;
  magicLinkUrl: string;
}

export async function sendPrechargeReminder(
  deps: { notifier: Notifier; from: string },
  input: SendPrechargeReminderInput,
): Promise<void> {
  const rendered = await renderPrechargeReminder({
    campaignTitle: input.campaignTitle,
    founderLegalName: input.founderLegalName,
    rewardSubtotal: input.rewardSubtotal,
    salesTax: input.salesTax,
    totalAuthorized: input.totalAuthorized,
    whenUtc: input.whenUtc,
    condition: input.condition,
    statementDescriptor: input.statementDescriptor,
    magicLinkUrl: input.magicLinkUrl,
    reference: input.reservationId,
    supportEmail: SUPPORT_EMAIL,
  });
  await deps.notifier.send({
    eventKey: BACKER_PRECHARGE_REMINDER,
    entityType: 'reservation',
    // One reminder per reservation, ever — a re-run of the sweep sends none.
    entityId: input.reservationId,
    to: input.to,
    from: deps.from,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });
}
