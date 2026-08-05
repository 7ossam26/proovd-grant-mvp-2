/**
 * §15 review messages — Spec §27.3, §27.6, §27.1 (Phase 22b).
 *
 * Four events around one record. §15 makes the review a round with an owner and
 * a next date, and every one of these is that round reaching a state somebody is
 * waiting on:
 *
 *   founder_submission_receipt   the Founder handed it over — §27.3 asks for the
 *                                receipt "with owner/next date", which is the
 *                                whole point: after submitting, the campaign is
 *                                Proovd's until we say otherwise
 *   internal_campaign_submitted  §27.6's counterpart. The Admin queue was the
 *                                only thing that said a campaign was waiting
 *   founder_changes_required     §15's grouped feedback, delivered rather than
 *                                left on a surface the Founder has to think to
 *                                open
 *   founder_campaign_approved    the round that ends the review track
 *
 * ── The dedup entity is the review ROW, not the campaign ───────────────────
 * §15 makes a resubmission a NEW round, and a Founder who fixes the feedback and
 * resubmits is owed a second receipt. Keying on the campaign would satisfy
 * §27.2 and silently swallow every round after the first — §7's resend failure,
 * which this repo has now made the same mistake-shaped decision about six times.
 *
 * ── The feedback is delivered, not summarised ──────────────────────────────
 * §15 stores each item with its group, area, owner, due expectation, and a deep
 * link, and §33.4.1 is about preserving exactly that structure. The email
 * renders the items as they were recorded; it does not count them and invite the
 * Founder to go and look, which would make the message a notification about a
 * notification.
 */

import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaignBuild, reviewFeedbackItems, type CampaignReview } from '../db/schema/build.js';
import type { Notifier } from '../notifications/send.js';
import {
  FOUNDER_SUBMISSION_RECEIPT,
  FOUNDER_CHANGES_REQUIRED,
  FOUNDER_CAMPAIGN_APPROVED,
  INTERNAL_CAMPAIGN_SUBMITTED,
} from '../notifications/events.js';
import { renderInternalNotice, renderPlainNotice } from '../notifications/templates/plain.js';
import { loadFounder, type LaunchNotificationContext } from '../launch/notifications.js';

export interface ReviewNotifyDeps {
  db: Database;
  notifier?: Notifier | undefined;
  context?: LaunchNotificationContext | undefined;
  /** §27.6's staffed inbox. Unset → the queue is still where the work is. */
  internalRecipient?: string | undefined;
}

/**
 * The notify half of a router's deps, in one place.
 *
 * Three call sites across two routers build this, and `exactOptionalPropertyTypes`
 * means each one would otherwise spell out the same three conditional spreads.
 * Three copies of that is three chances for one router to forget the internal
 * recipient and for §27.6's notice to go quietly missing on one path.
 */
export function reviewNotifyDeps(deps: {
  notifier?: Notifier | undefined;
  notificationContext?: LaunchNotificationContext | undefined;
  internalRecipient?: string | undefined;
}): Omit<ReviewNotifyDeps, 'db'> {
  return {
    ...(deps.notifier ? { notifier: deps.notifier } : {}),
    ...(deps.notificationContext ? { context: deps.notificationContext } : {}),
    ...(deps.internalRecipient ? { internalRecipient: deps.internalRecipient } : {}),
  };
}

async function campaignTitle(db: Database, campaignId: string): Promise<string> {
  const [row] = await db
    .select({ title: campaignBuild.title })
    .from(campaignBuild)
    .where(eq(campaignBuild.campaignId, campaignId))
    .limit(1);
  return row?.title ?? 'your campaign';
}

/**
 * §27.3 "Submission receipt with owner/next date", and §27.6's Admin
 * counterpart. Both fire from the one moment and both dedup on the review row.
 */
export async function notifyReviewSubmitted(
  deps: ReviewNotifyDeps,
  input: { campaignId: string; review: CampaignReview },
): Promise<void> {
  if (!deps.notifier || !deps.context) return;
  const title = await campaignTitle(deps.db, input.campaignId);
  const founder = await loadFounder(deps.db, input.campaignId);

  if (founder.email) {
    const notice = await renderPlainNotice({
      subject: `We have your campaign for review — ${title}`,
      headline: 'Your campaign is with us.',
      facts: [
        { label: 'Campaign', value: title },
        { label: 'Review round', value: String(input.review.round) },
        // §27.1's six questions. "Who owns it" is the one that matters most
        // here: a Founder who does not know the ball has moved keeps editing.
        { label: 'Who owns it now', value: 'Proovd' },
        { label: 'What happens next', value: 'A reviewer reads it and replies with an approval or a list of changes.' },
        {
          label: 'When you will hear',
          value: 'Within one business day, Monday to Friday, excluding U.S. federal holidays.',
        },
        { label: 'What you can do now', value: 'Nothing — we will come back to you.' },
      ],
      paragraphs: [
        'Your build and your Creator terms are locked while it is with us, so nothing changes underneath the version we are reading.',
      ],
      action: {
        label: 'View your campaign',
        url: `${deps.context.appBaseUrl}/campaigns/${input.campaignId}/build`,
      },
      reference: input.review.id,
      supportEmail: deps.context.supportEmail,
    });
    await deps.notifier.send({
      eventKey: FOUNDER_SUBMISSION_RECEIPT,
      entityType: 'campaign_review',
      // The ROUND, not the campaign: a resubmission is owed its own receipt.
      entityId: input.review.id,
      to: founder.email,
      from: deps.context.fromAddress,
      replyTo: deps.context.supportEmail,
      ...notice,
    });
  }

  if (deps.internalRecipient) {
    const notice = await renderInternalNotice({
      subject: `Campaign submitted for review — ${title} (round ${input.review.round})`,
      headline: `A campaign is waiting on Proovd — ${title}`,
      facts: [
        { label: 'Campaign', value: title },
        { label: 'Round', value: String(input.review.round) },
        { label: 'Submitted by', value: input.review.submittedBy },
        {
          label: 'Response promised',
          value: 'One business day (§27.8) — the Founder has been told so.',
        },
      ],
      paragraphs: [
        'Both §14 tracks are finished: the build is complete and the roster is launch-ready. The decision is approve, or changes required with grouped deep-linked feedback (§15).',
      ],
      action: {
        label: 'Open the review',
        url: `${deps.context.appBaseUrl}/admin/creator-readiness?campaignId=${input.campaignId}`,
      },
      reference: input.review.id,
      supportEmail: deps.context.supportEmail,
    });
    await deps.notifier.send({
      eventKey: INTERNAL_CAMPAIGN_SUBMITTED,
      entityType: 'campaign_review',
      entityId: input.review.id,
      to: deps.internalRecipient,
      from: deps.context.fromAddress,
      ...notice,
    });
  }
}

/** §27.3 "Changes required". The feedback travels; a count would not. */
export async function notifyChangesRequired(
  deps: ReviewNotifyDeps,
  input: { campaignId: string; review: CampaignReview },
): Promise<void> {
  if (!deps.notifier || !deps.context) return;
  const founder = await loadFounder(deps.db, input.campaignId);
  if (!founder.email) return;

  const title = await campaignTitle(deps.db, input.campaignId);
  const items = await deps.db
    .select()
    .from(reviewFeedbackItems)
    .where(eq(reviewFeedbackItems.reviewId, input.review.id));

  const required = items.filter((i) => i.feedbackGroup === 'required');
  const optional = items.filter((i) => i.feedbackGroup === 'optional');

  /** §15's two groups, rendered as §15 recorded them — area, body, owner, due. */
  const group = (label: string, rows: typeof items): string[] =>
    rows.length === 0
      ? []
      : [
          `${label}:`,
          ...rows.map((row) =>
            [
              `• ${row.area} — ${row.body}`,
              `  Where: ${row.deepLink}`,
              `  Owner: ${row.owner}`,
              row.dueExpectation ? `  Expected by: ${row.dueExpectation}` : null,
            ]
              .filter(Boolean)
              .join('\n'),
          ),
        ];

  const notice = await renderPlainNotice({
    subject: `Changes needed before ${title} can go live`,
    headline: 'We read your campaign and there are changes to make.',
    facts: [
      { label: 'Campaign', value: title },
      { label: 'Review round', value: String(input.review.round) },
      { label: 'Who owns it now', value: 'You' },
      {
        label: 'Required before resubmitting',
        value: String(required.length),
      },
      { label: 'Optional improvements', value: String(optional.length) },
      {
        label: 'What happens next',
        value: input.review.nextUpdateExpectation ?? 'Resubmit when you are ready and we will review the next round.',
      },
    ],
    paragraphs: [
      // §15/§33.4.1: nothing was deleted, and the Founder needs to know that
      // before they open the page expecting to start over.
      'Everything you built is still there — your build, your Creator roster, and the terms they accepted. Nothing was reset.',
      ...group('Required before resubmission', required),
      ...group('Optional improvements', optional),
    ],
    action: {
      label: 'Open your campaign',
      url: `${deps.context.appBaseUrl}/campaigns/${input.campaignId}/build`,
    },
    reference: input.review.id,
    supportEmail: deps.context.supportEmail,
  });

  await deps.notifier.send({
    eventKey: FOUNDER_CHANGES_REQUIRED,
    entityType: 'campaign_review',
    entityId: input.review.id,
    to: founder.email,
    from: deps.context.fromAddress,
    replyTo: deps.context.supportEmail,
    ...notice,
  });
}

/** §27.3 "Approval". States what was approved and what it does not yet mean. */
export async function notifyCampaignApproved(
  deps: ReviewNotifyDeps,
  input: { campaignId: string; review: CampaignReview },
): Promise<void> {
  if (!deps.notifier || !deps.context) return;
  const founder = await loadFounder(deps.db, input.campaignId);
  if (!founder.email) return;

  const title = await campaignTitle(deps.db, input.campaignId);
  const notice = await renderPlainNotice({
    subject: `${title} is approved`,
    headline: 'Your campaign is approved.',
    facts: [
      { label: 'Campaign', value: title },
      { label: 'Review round', value: String(input.review.round) },
      { label: 'Who owns the next step', value: 'Proovd' },
      {
        label: 'What happens next',
        value: 'We confirm every Creator is ready and schedule the day your page goes live.',
      },
      { label: 'What you can do now', value: 'No action needed.' },
    ],
    paragraphs: [
      // §1.4: approved is not live, and a Founder reading "approved" will assume
      // it is unless the message says otherwise.
      'Approved is not live yet. We keep an exact copy of what was approved — your build and the terms each Creator accepted — and that copy is what goes public on launch day.',
    ],
    action: {
      label: 'View your campaign',
      url: `${deps.context.appBaseUrl}/campaigns/${input.campaignId}/build`,
    },
    reference: input.review.id,
    supportEmail: deps.context.supportEmail,
  });

  await deps.notifier.send({
    eventKey: FOUNDER_CAMPAIGN_APPROVED,
    entityType: 'campaign_review',
    entityId: input.review.id,
    to: founder.email,
    from: deps.context.fromAddress,
    replyTo: deps.context.supportEmail,
    ...notice,
  });
}
