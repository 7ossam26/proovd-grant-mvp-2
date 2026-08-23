import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaignDrafts } from '../db/schema/invitations.js';
import type { Notifier } from '../notifications/send.js';
import {
  FOUNDER_APPLICATION_APPROVED,
  FOUNDER_APPLICATION_CHANGES_REQUESTED,
  FOUNDER_APPLICATION_INFORMATION_NEEDED,
  FOUNDER_APPLICATION_REJECTED,
  FOUNDER_APPLICATION_REVIEW_RECEIVED,
  INTERNAL_FOUNDER_APPLICATION_SUBMITTED,
} from '../notifications/events.js';
import { renderInternalNotice, renderPlainNotice } from '../notifications/templates/plain.js';
import { loadFounder, type LaunchNotificationContext } from '../launch/notifications.js';

export interface ApplicationReviewNotifyDeps {
  db: Database;
  notifier?: Notifier | undefined;
  context?: LaunchNotificationContext | undefined;
  internalRecipient?: string | undefined;
}

export interface ApplicationReviewNotice {
  id: string;
  round: number;
  outcome: string;
  customerExplanation: string | null;
  changeRequests: Array<{
    fieldLabel?: string | null;
    fieldKey: string;
    reason: string;
  }>;
}

async function founderRecordUrl(
  db: Database,
  appBaseUrl: string,
  campaignId: string,
): Promise<string> {
  const [draft] = await db
    .select({ prospectId: campaignDrafts.prospectId })
    .from(campaignDrafts)
    .where(eq(campaignDrafts.campaignId, campaignId))
    .limit(1);
  return draft?.prospectId
    ? `${appBaseUrl}/admin/founders/${draft.prospectId}`
    : `${appBaseUrl}/admin/founders`;
}

function founderReviewUrl(appBaseUrl: string, campaignId: string): string {
  return `${appBaseUrl}/campaigns/${campaignId}/setup/application-review`;
}

/** One Founder receipt and one staffed-queue notice, deduped on the review round. */
export async function notifyApplicationReviewSubmitted(
  deps: ApplicationReviewNotifyDeps,
  input: { campaignId: string; review: ApplicationReviewNotice },
): Promise<void> {
  if (!deps.notifier || !deps.context) return;

  const founder = await loadFounder(deps.db, input.campaignId);
  const campaign = founder.productName ?? 'your campaign';

  if (founder.email) {
    const notice = await renderPlainNotice({
      subject: `We received your application — ${campaign}`,
      headline: 'Your application is with Proovd.',
      facts: [
        { label: 'Campaign', value: campaign },
        { label: 'Application round', value: String(input.review.round) },
        { label: 'Who owns the next step', value: 'Proovd' },
        {
          label: 'What happens next',
          value: 'An Admin reviews the application and records a decision or an exact request.',
        },
      ],
      action: {
        label: 'View Application Review',
        url: founderReviewUrl(deps.context.appBaseUrl, input.campaignId),
      },
      reference: input.review.id,
      supportEmail: deps.context.supportEmail,
    });
    await deps.notifier.send({
      eventKey: FOUNDER_APPLICATION_REVIEW_RECEIVED,
      entityType: 'campaign_application_review',
      entityId: input.review.id,
      to: founder.email,
      from: deps.context.fromAddress,
      replyTo: deps.context.supportEmail,
      ...notice,
    });
  }

  if (deps.internalRecipient) {
    const notice = await renderInternalNotice({
      subject: `Founder application submitted — ${campaign} (round ${input.review.round})`,
      headline: `A Founder application is waiting — ${campaign}`,
      facts: [
        { label: 'Campaign', value: campaign },
        { label: 'Application round', value: String(input.review.round) },
        { label: 'Current state', value: input.review.outcome },
      ],
      action: {
        label: 'Open the Founder record',
        url: await founderRecordUrl(deps.db, deps.context.appBaseUrl, input.campaignId),
      },
      reference: input.review.id,
      supportEmail: deps.context.supportEmail,
    });
    await deps.notifier.send({
      eventKey: INTERNAL_FOUNDER_APPLICATION_SUBMITTED,
      entityType: 'campaign_application_review',
      entityId: input.review.id,
      to: deps.internalRecipient,
      from: deps.context.fromAddress,
      ...notice,
    });
  }
}

/** Delivers only Founder-actionable or terminal outcomes. */
export async function notifyApplicationReviewOutcome(
  deps: ApplicationReviewNotifyDeps,
  input: { campaignId: string; review: ApplicationReviewNotice },
): Promise<void> {
  if (!deps.notifier || !deps.context) return;
  const founder = await loadFounder(deps.db, input.campaignId);
  if (!founder.email) return;

  const campaign = founder.productName ?? 'your campaign';
  const explanation =
    input.review.customerExplanation?.trim() ||
    'Open Application Review to see the recorded decision and next step.';
  const base = {
    reference: input.review.id,
    supportEmail: deps.context.supportEmail,
  };

  let eventKey:
    | typeof FOUNDER_APPLICATION_INFORMATION_NEEDED
    | typeof FOUNDER_APPLICATION_CHANGES_REQUESTED
    | typeof FOUNDER_APPLICATION_APPROVED
    | typeof FOUNDER_APPLICATION_REJECTED;
  let notice;

  switch (input.review.outcome) {
    case 'needs_information':
      eventKey = FOUNDER_APPLICATION_INFORMATION_NEEDED;
      notice = await renderPlainNotice({
        subject: `We need more information about ${campaign}`,
        headline: 'We need more information before we can finish the review.',
        facts: [
          { label: 'Campaign', value: campaign },
          { label: 'What we need', value: explanation },
          { label: 'Who owns the next step', value: 'You' },
        ],
        action: {
          label: 'Open Application Review',
          url: founderReviewUrl(deps.context.appBaseUrl, input.campaignId),
        },
        ...base,
      });
      break;
    case 'changes_requested': {
      eventKey = FOUNDER_APPLICATION_CHANGES_REQUESTED;
      const request = input.review.changeRequests[0];
      notice = await renderPlainNotice({
        subject: `Changes requested for ${campaign}`,
        headline: 'Please update your application and resubmit it.',
        facts: [
          { label: 'Campaign', value: campaign },
          ...(request
            ? [
                { label: 'Field', value: request.fieldLabel ?? request.fieldKey },
                { label: 'Requested change', value: request.reason },
              ]
            : [{ label: 'Requested change', value: explanation }]),
          { label: 'Who owns the next step', value: 'You' },
        ],
        action: {
          label: 'Update your application',
          url: founderReviewUrl(deps.context.appBaseUrl, input.campaignId),
        },
        ...base,
      });
      break;
    }
    case 'approved':
      eventKey = FOUNDER_APPLICATION_APPROVED;
      notice = await renderPlainNotice({
        subject: `Your application is approved — ${campaign}`,
        headline: 'Your application is approved.',
        facts: [
          { label: 'Campaign', value: campaign },
          { label: 'What happens next', value: 'Continue to the listing-fee step.' },
        ],
        action: {
          label: 'Continue setup',
          url: `${deps.context.appBaseUrl}/campaigns/${input.campaignId}/setup/creator-payment`,
        },
        ...base,
      });
      break;
    case 'rejected':
      eventKey = FOUNDER_APPLICATION_REJECTED;
      notice = await renderPlainNotice({
        subject: `Application Review decision — ${campaign}`,
        headline: 'We cannot approve this application.',
        facts: [
          { label: 'Campaign', value: campaign },
          { label: 'Decision explanation', value: explanation },
        ],
        action: {
          label: 'View the decision',
          url: founderReviewUrl(deps.context.appBaseUrl, input.campaignId),
        },
        ...base,
      });
      break;
    default:
      return;
  }

  await deps.notifier.send({
    eventKey,
    entityType: 'campaign_application_review',
    entityId: input.review.id,
    to: founder.email,
    from: deps.context.fromAddress,
    replyTo: deps.context.supportEmail,
    ...notice,
  });
}
