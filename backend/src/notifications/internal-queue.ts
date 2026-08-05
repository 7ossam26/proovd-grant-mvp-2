/**
 * The three §27.6 notices whose services carried no notifier — Spec §27.6,
 * §12, §14.2, §17 (Phase 22b).
 *
 *   internal_interview_changed             §12's reschedule and cancel move a
 *                                          US$2 discount and one third of the
 *                                          high-effort classification
 *   internal_proposal_awaiting_response    §14.2's open version is a 72-hour
 *                                          clock somebody has to watch
 *   internal_post_verification_due         §17 step 5 is Admin's, and nothing
 *                                          told Admin the work had arrived
 *
 * These three sat unsent for the same reason: each service already did the
 * right thing and simply had nowhere to send from. `workspace/interview.ts`
 * emitted its four Founder messages a frame up in the routes,
 * `decisions.ts` took only an audit writer, and `createCreatorRouter` took
 * four positional arguments. None of that was wrong when it was written — a
 * service acquires a notifier when it has something to say — and this is the
 * phase where they do.
 *
 * ── Every entity is the RECORD, never the subject ──────────────────────────
 * A booking is rescheduled repeatedly; a proposal is countered repeatedly; a
 * corrected post is resubmitted. Keying any of these on the booking, the
 * association, or the campaign would announce the first and swallow the rest,
 * which is §7's resend failure and the single most common way one of these
 * queues goes quiet without anyone noticing. So: the
 * `interview_booking_events` row, the `proposal_versions` row, the
 * `creator_post_submissions` row.
 *
 * `internal_interview_changed`'s entity is deliberately NOT `<booking>:<time>`,
 * which was the obvious choice and is wrong: a Founder who cancels and rebooks
 * the same slot produces two real events that collide under it.
 *
 * ── No recipient configured is not an error ─────────────────────────────────
 * Every sender here no-ops without `INTERNAL_NOTIFICATION_EMAIL`. The work
 * stays visible in the Admin queues that already show it — which is where §1.4
 * says it has to be visible anyway, since a message is a convenience and a
 * queue is the record.
 */

import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns } from '../db/schema/domain.js';
import { interviewBookingEvents } from '../db/schema/workspace.js';
import { proposalVersions } from '../db/schema/decisions.js';
import { listingFeePayments } from '../db/schema/listing.js';
import { campaignBuild } from '../db/schema/build.js';
import { formatUsdCents } from '../payments/listing-notifications.js';
import type { Notifier } from './send.js';
import {
  INTERNAL_INTERVIEW_CHANGED,
  INTERNAL_POST_VERIFICATION_DUE,
  INTERNAL_PROPOSAL_AWAITING_RESPONSE,
} from './events.js';
import { renderInternalNotice } from './templates/plain.js';
import type { LaunchNotificationContext } from '../launch/notifications.js';

export interface InternalNotifyDeps {
  db: Database;
  notifier?: Notifier | undefined;
  context?: LaunchNotificationContext | undefined;
  /** §27.6's inbox. Absent → nothing sends and the queues still show the work. */
  internalRecipient?: string | undefined;
}

function ready(
  deps: InternalNotifyDeps,
): deps is InternalNotifyDeps & {
  notifier: Notifier;
  context: LaunchNotificationContext;
  internalRecipient: string;
} {
  return Boolean(deps.notifier && deps.context && deps.internalRecipient);
}

/** The campaign's own name, or an honest stand-in. Never a UUID in a subject. */
async function campaignName(db: Database, campaignId: string): Promise<string> {
  const [build] = await db
    .select({ title: campaignBuild.title })
    .from(campaignBuild)
    .where(eq(campaignBuild.campaignId, campaignId))
    .limit(1);
  return build?.title ?? 'an unnamed campaign';
}

/**
 * §27.1: a deadline spells out its timezone. `toISOString()` renders `Z`,
 * which 22a's coverage suite refuses for exactly the reason it is tempting —
 * it is canonical and it is unreadable.
 */
function utcMinute(instant: Date): string {
  return `${instant.toISOString().replace('T', ' ').slice(0, 16)} UTC`;
}

/* ── §12: interview changed ───────────────────────────────────────────────── */

/**
 * Loads its own facts from the event row, so every call site is one line and
 * none of them can describe the change differently from the record. The caller
 * supplies only the id — which it has, because the service returns it.
 *
 * Silently returns for a `created` or `confirmed` event: §27.6 says "interview
 * changes", and those two already have their own §27.3 Founder messages and no
 * internal decision behind them.
 */
export async function notifyInterviewChanged(
  deps: InternalNotifyDeps,
  input: { eventId: string },
): Promise<void> {
  if (!ready(deps)) return;

  const [row] = await deps.db
    .select({
      event: interviewBookingEvents.event,
      campaignId: interviewBookingEvents.campaignId,
      priorScheduledAt: interviewBookingEvents.priorScheduledAt,
      newScheduledAt: interviewBookingEvents.newScheduledAt,
      reason: interviewBookingEvents.reason,
      listingPaidAt: campaigns.listingPaidAt,
    })
    .from(interviewBookingEvents)
    .innerJoin(campaigns, eq(campaigns.id, interviewBookingEvents.campaignId))
    .where(eq(interviewBookingEvents.id, input.eventId))
    .limit(1);
  if (!row) return;
  if (row.event !== 'rescheduled' && row.event !== 'canceled') return;

  const title = await campaignName(deps.db, row.campaignId);
  const moved = row.event === 'rescheduled';
  // §12: cancelling before listing payment recalculates the fee and the
  // high-effort classification; after payment §12's lock means it moves
  // nothing. Read from the campaign rather than passed in, so the notice can
  // never disagree with what the re-evaluation actually did (§33.3.3).
  const feeAffected = row.listingPaidAt === null;

  const notice = await renderInternalNotice({
    subject: `Interview ${row.event} — ${title}`,
    headline: moved ? 'A Founder moved their interview.' : 'A Founder canceled their interview.',
    facts: [
      { label: 'Campaign', value: title },
      { label: 'Change', value: moved ? 'Rescheduled' : 'Canceled' },
      {
        label: 'Was',
        value: row.priorScheduledAt ? utcMinute(row.priorScheduledAt) : 'No time recorded',
      },
      {
        label: 'Now',
        value: row.newScheduledAt ? utcMinute(row.newScheduledAt) : 'No interview booked',
      },
      { label: 'Reason given', value: row.reason?.trim() || 'None given' },
      {
        label: 'Listing fee',
        value: feeAffected
          ? 'Recalculated — the interview credit and the high-effort classification both moved'
          : 'Unchanged — the calculation locked at payment (§12)',
      },
    ],
    paragraphs: [
      'The booking record is ours and has already been updated; this is the notice, not the change.',
    ],
    action: {
      label: 'Open the campaign',
      url: `${deps.context.appBaseUrl}/admin/campaigns/${row.campaignId}`,
    },
    reference: row.campaignId,
    supportEmail: deps.context.supportEmail,
  });

  await deps.notifier.send({
    eventKey: INTERNAL_INTERVIEW_CHANGED,
    entityType: 'interview_booking_event',
    // The EVENT row. `<booking>:<time>` collides on cancel-then-rebook.
    entityId: input.eventId,
    to: deps.internalRecipient,
    from: deps.context.fromAddress,
    replyTo: deps.context.supportEmail,
    ...notice,
  });
}

/* ── §14.2: a proposal is waiting on somebody ─────────────────────────────── */

/**
 * Loads its own facts from the version row, so a caller cannot describe terms
 * differently from what was stored — the §14.2 immutability guarantee is worth
 * nothing if the notice about it is composed from parameters.
 *
 * Silently returns for a version that is no longer open: by the time this runs
 * the transaction has committed, and a version answered in between is not
 * awaiting anybody.
 */
export async function notifyProposalAwaitingResponse(
  deps: InternalNotifyDeps,
  input: { versionId: string },
): Promise<void> {
  if (!ready(deps)) return;

  const [row] = await deps.db
    .select({
      versionNumber: proposalVersions.versionNumber,
      campaignId: proposalVersions.campaignId,
      associationId: proposalVersions.associationId,
      proposedBy: proposalVersions.proposedBy,
      state: proposalVersions.state,
      bidTotalPercent: proposalVersions.bidTotalPercent,
      fixedPaymentRequestCents: proposalVersions.fixedPaymentRequestCents,
      respondBy: listingFeePayments.responseDeadlineAt,
    })
    .from(proposalVersions)
    .leftJoin(listingFeePayments, eq(listingFeePayments.campaignId, proposalVersions.campaignId))
    .where(eq(proposalVersions.id, input.versionId))
    .limit(1);
  if (!row) return;
  // §14.2's two open states. Anything else was answered between the commit and
  // this call, and a version that is `locked`, `declined`, `superseded`,
  // `rejected_by_admin`, or expired is awaiting nobody.
  if (row.state !== 'awaiting_founder' && row.state !== 'awaiting_creator') return;

  const title = await campaignName(deps.db, row.campaignId);
  // Read from the STATE, not from who proposed. They agree today, and the
  // state is the one §14.2 makes a database guarantee about.
  const awaiting = row.state === 'awaiting_founder' ? 'the Founder' : 'the Creator';
  const terms = [
    row.bidTotalPercent === null ? null : `${row.bidTotalPercent}% total commission`,
    row.fixedPaymentRequestCents === null
      ? null
      : `fixed payment of ${formatUsdCents(row.fixedPaymentRequestCents)}`,
  ]
    .filter((part): part is string => part !== null)
    .join(' + ');

  const notice = await renderInternalNotice({
    subject: `Proposal v${row.versionNumber} awaiting ${awaiting} — ${title}`,
    headline: `A proposal version is open and waiting on ${awaiting}.`,
    facts: [
      { label: 'Campaign', value: title },
      { label: 'Version', value: `v${row.versionNumber}` },
      { label: 'Proposed by', value: row.proposedBy === 'affiliate' ? 'Creator' : 'Founder' },
      { label: 'Terms', value: terms || 'Standard terms, unchanged' },
      { label: 'Waiting on', value: awaiting },
      {
        label: 'Response deadline',
        value: row.respondBy ? utcMinute(row.respondBy) : 'No deadline recorded',
      },
    ],
    paragraphs: [
      // §14.6: the deadline is real money — no mutual acceptance refunds the
      // whole listing charge — so an open version nobody is watching is the
      // one worth a notice.
      'If no Creator and Founder mutually accept before the deadline, §14.6 refunds the listing payment in full and the campaign ends with no Creator.',
    ],
    action: {
      label: 'Open the roster',
      url: `${deps.context.appBaseUrl}/admin/campaigns/${row.campaignId}`,
    },
    reference: row.associationId,
    supportEmail: deps.context.supportEmail,
  });

  await deps.notifier.send({
    eventKey: INTERNAL_PROPOSAL_AWAITING_RESPONSE,
    entityType: 'proposal_version',
    // The VERSION. A counter is a genuinely new answer owed; keying on the
    // association would announce the first and swallow every negotiation round.
    entityId: input.versionId,
    to: deps.internalRecipient,
    from: deps.context.fromAddress,
    replyTo: deps.context.supportEmail,
    ...notice,
  });
}

/* ── §17 step 5: a first post is waiting for Admin ────────────────────────── */

export async function notifyPostVerificationDue(
  deps: InternalNotifyDeps,
  input: {
    submissionId: string;
    associationId: string;
    campaignId: string;
    postUrl: string;
    channel: string | null;
    resubmission: boolean;
  },
): Promise<void> {
  if (!ready(deps)) return;
  const title = await campaignName(deps.db, input.campaignId);

  const notice = await renderInternalNotice({
    subject: `First post awaiting verification — ${title}`,
    headline: input.resubmission
      ? 'A corrected first post is waiting for verification.'
      : 'A first post is waiting for verification.',
    facts: [
      { label: 'Campaign', value: title },
      { label: 'Post', value: input.postUrl },
      { label: 'Channel', value: input.channel?.trim() || 'Not stated' },
      { label: 'Kind', value: input.resubmission ? 'Resubmission after a correction' : 'First submission' },
      { label: 'Who owns it', value: 'Proovd Admin' },
      // §17: no deadline is stated for the verification itself, and inventing
      // one would be §1 rule 6. The work is due now; the queue is the record.
      { label: 'What is due', value: 'The seven §17 checks, against the submitted post' },
    ],
    paragraphs: [
      'Verification releases no money — §17 is explicit that a pass changes only whether later traffic may finalize.',
    ],
    action: {
      label: 'Open the campaign operations queue',
      url: `${deps.context.appBaseUrl}/admin/campaign-operations`,
    },
    reference: input.associationId,
    supportEmail: deps.context.supportEmail,
  });

  await deps.notifier.send({
    eventKey: INTERNAL_POST_VERIFICATION_DUE,
    entityType: 'creator_post_submission',
    // The SUBMISSION. A corrected resubmission is a new decision to make.
    entityId: input.submissionId,
    to: deps.internalRecipient,
    from: deps.context.fromAddress,
    replyTo: deps.context.supportEmail,
    ...notice,
  });
}
