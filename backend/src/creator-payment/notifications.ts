/**
 * §16 fixed-payment messages — Spec §27.3, §27.4, §27.6, §24.7 (Phase 22b).
 *
 * The fourth money stream finally speaks. Six messages around one allocation:
 *
 *   founder_..._funding_request        Admin set the deadline; the Founder owes
 *                                      an exact amount by a date, and until now
 *                                      the only way to learn that was to open
 *                                      the readiness page
 *   founder_..._funding_confirmation   the exact amount landed
 *   founder_..._funding_failure        it did not, and the deadline is still
 *                                      running — §16 cancels the association
 *                                      when it lapses, so silence here is the
 *                                      expensive kind
 *   affiliate_fixed_funding_complete   §16: funding complete, "readiness remains
 *                                      explicit" — the Creator is owed BOTH
 *                                      facts, and a message carrying only the
 *                                      first would read as "you are good to go"
 *   internal_fixed_funding_received    §27.6's pair. Funded is not paid: the
 *                                      allocation now waits on a §22.1
 *                                      completion decision only an Admin records
 *   internal_fixed_funding_failed      §27.6's pair for the failure
 *
 * ── The dedup entities differ, and the difference is the point ─────────────
 * Funding succeeds once, so the success messages key on the ALLOCATION. Funding
 * can fail in two distinct ways — the amount was wrong, or the Checkout expired
 * — and those are two different things the Founder must do something about, so
 * the failure messages key on (allocation, failure KIND). Keying on the
 * allocation alone would announce the first problem and swallow the second
 * while the §16 deadline kept running; keying on an attempt ROW is not
 * available, because both insert paths are `onConflictDoNothing` on the session
 * key and a repeat of the same kind deliberately writes no new row.
 *
 * ── No percentage appears in any of these ─────────────────────────────────
 * §24.7 makes this its own stream: no reservation, no Backer ledger, no
 * commission, and no sales tax. The templates name the exact accepted amount
 * and nothing else, because there is nothing else — and a message that
 * mentioned a percentage would be describing a different stream.
 */

import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaignAffiliateAssociations } from '../db/schema/domain.js';
import { campaignBuild } from '../db/schema/build.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import type { Notifier } from '../notifications/send.js';
import {
  FOUNDER_FIXED_PAYMENT_FUNDING_REQUEST,
  FOUNDER_FIXED_PAYMENT_FUNDING_CONFIRMATION,
  FOUNDER_FIXED_PAYMENT_FUNDING_FAILURE,
  AFFILIATE_FIXED_FUNDING_COMPLETE,
  INTERNAL_FIXED_FUNDING_RECEIVED,
  INTERNAL_FIXED_FUNDING_FAILED,
} from '../notifications/events.js';
import { renderInternalNotice, renderPlainNotice } from '../notifications/templates/plain.js';
import { loadFounder, type LaunchNotificationContext } from '../launch/notifications.js';
import { formatCents } from '../reservations/restated.js';

export interface CreatorPaymentNotifyDeps {
  db: Database;
  notifier?: Notifier | undefined;
  context?: LaunchNotificationContext | undefined;
  internalRecipient?: string | undefined;
}

interface Parties {
  campaignId: string;
  campaignTitle: string;
  founderEmail: string | null;
  creatorEmail: string | null;
  creatorHandle: string | null;
}

/** One read for both sides. §11's boundary holds: the Founder never sees the
    Creator's address here, only their public handle. */
async function loadParties(db: Database, associationId: string): Promise<Parties | null> {
  const [row] = await db
    .select({
      campaignId: campaignAffiliateAssociations.campaignId,
      creatorEmail: affiliateSignupProfiles.email,
      creatorHandle: affiliateSignupProfiles.publicHandle,
    })
    .from(campaignAffiliateAssociations)
    .leftJoin(
      affiliateSignupProfiles,
      eq(affiliateSignupProfiles.associationId, campaignAffiliateAssociations.id),
    )
    .where(eq(campaignAffiliateAssociations.id, associationId))
    .limit(1);
  if (!row) return null;

  const [build] = await db
    .select({ title: campaignBuild.title })
    .from(campaignBuild)
    .where(eq(campaignBuild.campaignId, row.campaignId))
    .limit(1);
  const founder = await loadFounder(db, row.campaignId);

  return {
    campaignId: row.campaignId,
    campaignTitle: build?.title ?? 'your campaign',
    founderEmail: founder.email,
    creatorEmail: row.creatorEmail,
    creatorHandle: row.creatorHandle,
  };
}

/** §27.1: a deadline names its zone, and `Z` spells nothing out. */
function utcMinute(at: Date): string {
  return `${at.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/**
 * §27.3 "Fixed-payment funding request". Sent when the Admin-configured
 * deadline is set — that is the moment the ask becomes a date rather than an
 * intention.
 */
export async function notifyFundingRequested(
  deps: CreatorPaymentNotifyDeps,
  input: { associationId: string; allocationId: string; amountCents: bigint; deadlineAt: Date },
): Promise<void> {
  if (!deps.notifier || !deps.context) return;
  const parties = await loadParties(deps.db, input.associationId);
  if (!parties?.founderEmail) return;

  const notice = await renderPlainNotice({
    subject: `Fund the Creator payment for ${parties.campaignTitle}`,
    headline: 'One Creator payment is waiting to be funded.',
    facts: [
      { label: 'Campaign', value: parties.campaignTitle },
      { label: 'Creator', value: parties.creatorHandle ?? 'your Creator' },
      { label: 'Amount', value: `US$${formatCents(input.amountCents)}` },
      { label: 'Fund by', value: utcMinute(input.deadlineAt) },
      { label: 'Who owns it', value: 'You' },
      {
        label: 'If the date passes',
        value: 'This Creator is removed from the campaign and the arrangement ends.',
      },
    ],
    paragraphs: [
      // §24.7: its own stream. A Founder who thinks this is the 5% or a
      // commission will not understand why they are being asked twice.
      'This is the fixed payment you and this Creator agreed. It is separate from the campaign charges and from any commission — no percentage applies to it, and no sales tax is added.',
      'You will pay it to Proovd now; it reaches the Creator after their work is verified.',
    ],
    action: {
      label: 'Fund the Creator payment',
      url: `${deps.context.appBaseUrl}/campaigns/${parties.campaignId}/creator-readiness`,
    },
    reference: input.allocationId,
    supportEmail: deps.context.supportEmail,
  });

  await deps.notifier.send({
    eventKey: FOUNDER_FIXED_PAYMENT_FUNDING_REQUEST,
    entityType: 'creator_payment_allocation',
    // Per allocation: an amount is agreed once. A re-set deadline is the same
    // ask, and telling the Founder twice would read as a second payment.
    entityId: input.allocationId,
    to: parties.founderEmail,
    from: deps.context.fromAddress,
    replyTo: deps.context.supportEmail,
    ...notice,
  });
}

/**
 * §27.3, §27.4, §27.6 — funding landed. Three audiences from one moment, all
 * keyed on the allocation because funding succeeds exactly once.
 */
export async function notifyFundingSucceeded(
  deps: CreatorPaymentNotifyDeps,
  input: { associationId: string; allocationId: string; amountCents: bigint },
): Promise<void> {
  if (!deps.notifier || !deps.context) return;
  const parties = await loadParties(deps.db, input.associationId);
  if (!parties) return;
  const amount = `US$${formatCents(input.amountCents)}`;

  if (parties.founderEmail) {
    const notice = await renderPlainNotice({
      subject: `Creator payment funded — ${parties.campaignTitle}`,
      headline: 'Your Creator payment is funded.',
      facts: [
        { label: 'Campaign', value: parties.campaignTitle },
        { label: 'Creator', value: parties.creatorHandle ?? 'your Creator' },
        { label: 'Amount', value: amount },
        { label: 'Seller', value: 'Proovd LLC' },
        { label: 'Your statement shows', value: 'PROOVD CREATOR PAY' },
        { label: 'Status', value: 'Completed — received in full' },
        { label: 'What you can do now', value: 'No action needed.' },
      ],
      paragraphs: [
        'It reaches the Creator after their work is verified and the campaign closes. Nothing further is owed on this arrangement.',
      ],
      action: {
        label: 'View your Creators',
        url: `${deps.context.appBaseUrl}/campaigns/${parties.campaignId}/creator-readiness`,
      },
      reference: input.allocationId,
      supportEmail: deps.context.supportEmail,
    });
    await deps.notifier.send({
      eventKey: FOUNDER_FIXED_PAYMENT_FUNDING_CONFIRMATION,
      entityType: 'creator_payment_allocation',
      entityId: input.allocationId,
      to: parties.founderEmail,
      from: deps.context.fromAddress,
      replyTo: deps.context.supportEmail,
      ...notice,
    });
  }

  if (parties.creatorEmail) {
    const notice = await renderPlainNotice({
      subject: `Your fixed payment is funded — ${parties.campaignTitle}`,
      headline: 'The Founder has funded your fixed payment.',
      facts: [
        { label: 'Campaign', value: parties.campaignTitle },
        { label: 'Amount', value: amount },
        { label: 'Status', value: 'Funded — not yet paid to you' },
        {
          // §16's own sentence: funding complete, "readiness remains explicit".
          // Both facts, in one message, because either alone is misleading.
          label: 'Your readiness',
          value: 'Still checked separately — funding does not make you ready.',
        },
        { label: 'When you are paid', value: 'After the campaign closes and your work is verified.' },
      ],
      paragraphs: [
        'Funded is not paid. The money is with Proovd, and it reaches you once an Admin records that your side of the arrangement is complete.',
        'Your readiness checklist is unchanged by this — open your campaign to see anything still outstanding.',
      ],
      action: {
        label: 'Open your campaign',
        url: `${deps.context.appBaseUrl}/creator/campaigns/${input.associationId}/partnership`,
      },
      reference: input.allocationId,
      supportEmail: deps.context.supportEmail,
    });
    await deps.notifier.send({
      eventKey: AFFILIATE_FIXED_FUNDING_COMPLETE,
      entityType: 'creator_payment_allocation',
      entityId: input.allocationId,
      to: parties.creatorEmail,
      from: deps.context.fromAddress,
      replyTo: deps.context.supportEmail,
      ...notice,
    });
  }

  if (deps.internalRecipient) {
    const notice = await renderInternalNotice({
      subject: `Fixed Creator payment funded — ${parties.campaignTitle} (${amount})`,
      headline: `Fixed Creator payment received — ${parties.campaignTitle}`,
      facts: [
        { label: 'Campaign', value: parties.campaignTitle },
        { label: 'Association', value: input.associationId },
        { label: 'Amount', value: amount },
        { label: 'Allocation state', value: 'funded — NOT paid (§16)' },
        {
          label: 'What it waits on',
          value: 'A §22.1 completion decision. Nothing releases it automatically.',
        },
      ],
      action: {
        label: 'Open Creator readiness',
        url: `${deps.context.appBaseUrl}/admin/creator-readiness?campaignId=${parties.campaignId}`,
      },
      reference: input.allocationId,
      supportEmail: deps.context.supportEmail,
    });
    await deps.notifier.send({
      eventKey: INTERNAL_FIXED_FUNDING_RECEIVED,
      entityType: 'creator_payment_allocation',
      entityId: input.allocationId,
      to: deps.internalRecipient,
      from: deps.context.fromAddress,
      ...notice,
    });
  }
}

/**
 * §27.3, §27.6 — funding did not land. Keyed on the ATTEMPT, because a second
 * failure is a second thing to act on and the deadline keeps running through
 * both.
 */
export async function notifyFundingFailed(
  deps: CreatorPaymentNotifyDeps,
  input: {
    associationId: string;
    allocationId: string;
    amountCents: bigint;
    /** Internal only. §33.9.11 keeps a raw provider code out of customer copy. */
    failureCode: string;
    deadlineAt?: Date | null;
  },
): Promise<void> {
  if (!deps.notifier || !deps.context) return;
  const parties = await loadParties(deps.db, input.associationId);
  if (!parties) return;
  const amount = `US$${formatCents(input.amountCents)}`;

  if (parties.founderEmail) {
    const notice = await renderPlainNotice({
      subject: `Creator payment not funded — ${parties.campaignTitle}`,
      headline: 'That Creator payment did not go through.',
      facts: [
        { label: 'Campaign', value: parties.campaignTitle },
        { label: 'Creator', value: parties.creatorHandle ?? 'your Creator' },
        { label: 'Amount still owed', value: amount },
        { label: 'Status', value: 'Not funded — nothing was taken' },
        { label: 'Who owns it', value: 'You' },
        ...(input.deadlineAt
          ? [{ label: 'Fund by', value: utcMinute(input.deadlineAt) }]
          : []),
      ],
      paragraphs: [
        // §3.3: the money fact first, because the Founder's first question is
        // whether they have been charged something they now have to chase.
        'Nothing was taken from your card. The payment has to be made in full and the exact amount — a partial payment is returned rather than counted.',
        input.deadlineAt
          ? 'If the date above passes without funding, this Creator is removed from the campaign and the arrangement ends.'
          : 'Start the payment again when you are ready.',
      ],
      action: {
        label: 'Try funding again',
        url: `${deps.context.appBaseUrl}/campaigns/${parties.campaignId}/creator-readiness`,
      },
      reference: input.allocationId,
      supportEmail: deps.context.supportEmail,
    });
    await deps.notifier.send({
      eventKey: FOUNDER_FIXED_PAYMENT_FUNDING_FAILURE,
      entityType: 'creator_payment_funding_attempt',
      // Per (allocation, failure KIND). A wrong amount and an expired Checkout
      // are two different things to act on; a repeat of the same kind is the
      // same fact, and both insert paths are `onConflictDoNothing` on the
      // session key, so no attempt row id is reliably available anyway.
      entityId: `${input.allocationId}:${input.failureCode}`,
      to: parties.founderEmail,
      from: deps.context.fromAddress,
      replyTo: deps.context.supportEmail,
      ...notice,
    });
  }

  if (deps.internalRecipient) {
    const notice = await renderInternalNotice({
      subject: `Fixed Creator payment failed — ${parties.campaignTitle} (${amount})`,
      headline: `Fixed Creator payment failed — ${parties.campaignTitle}`,
      facts: [
        { label: 'Campaign', value: parties.campaignTitle },
        { label: 'Association', value: input.associationId },
        { label: 'Amount', value: amount },
        // §26.8 permits the raw code as internal detail; §33.9.11 keeps it here.
        { label: 'Recorded reason', value: input.failureCode },
        ...(input.deadlineAt
          ? [{ label: 'Deadline still running', value: utcMinute(input.deadlineAt) }]
          : []),
        {
          label: 'If it lapses',
          value: 'The association is removed and the allocation closes (§16).',
        },
      ],
      action: {
        label: 'Open Creator readiness',
        url: `${deps.context.appBaseUrl}/admin/creator-readiness?campaignId=${parties.campaignId}`,
      },
      reference: input.allocationId,
      supportEmail: deps.context.supportEmail,
    });
    await deps.notifier.send({
      eventKey: INTERNAL_FIXED_FUNDING_FAILED,
      entityType: 'creator_payment_funding_attempt',
      entityId: `${input.allocationId}:${input.failureCode}`,
      to: deps.internalRecipient,
      from: deps.context.fromAddress,
      ...notice,
    });
  }
}
