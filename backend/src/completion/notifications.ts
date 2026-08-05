/**
 * Phase 21b's five §27 messages — Spec §27.3, §27.4, §27.5, §27.6, §22.9,
 * §22.10, §31.8.
 *
 * These are the five keys `unsent.ts` has carried as `capability` since Phase
 * 22a: the behaviour did not exist, so neither did the message. Phase 22's own
 * brief assigns them here — "if this phase finds a missing capability rather
 * than a missing message, that belongs to the phase that owns it" — and this is
 * that phase.
 *
 * ── Every entity is the record, and the work-again ones are the request row ─
 * A Founder may ask a Creator to work again on a later campaign, and a Creator
 * may answer more than one Founder. Keying on the association or the campaign
 * would announce the first and swallow the rest (§7's resend failure), so all
 * three work-again keys dedup on the `work_again_requests` row.
 *
 * `backer_satisfaction_survey` keys on the RESERVATION, because §31.8 permits
 * exactly one response per reservation and therefore exactly one ask. §30's
 * "no second ask" is the unique index; this is the messaging half of it.
 */

import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaignAffiliateAssociations, reservations } from '../db/schema/domain.js';
import { campaignBuild } from '../db/schema/build.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import { backerIdentities } from '../db/schema/reservations.js';
import { workAgainRequests } from '../db/schema/completion.js';
import type { Notifier } from '../notifications/send.js';
import {
  AFFILIATE_WORK_AGAIN_REQUEST,
  BACKER_SATISFACTION_SURVEY,
  FOUNDER_READY_NEXT_CAMPAIGN,
  FOUNDER_WORK_AGAIN_RESPONSE,
  INTERNAL_WORK_AGAIN_REQUEST,
} from '../notifications/events.js';
import { renderInternalNotice, renderPlainNotice } from '../notifications/templates/plain.js';
import { loadFounder, type LaunchNotificationContext } from '../launch/notifications.js';
import { mintOrReissueMagicLink } from '../reservations/magic-link.js';
import type { TokenService } from '../auth/token-service.js';
import {
  WORK_AGAIN_NO_PENALTY,
  WORK_AGAIN_ACCEPTANCE_GRANTS_NOTHING,
  PREPARE_WITHOUT_OPENING,
} from './logic.js';

export interface CompletionNotifyDeps {
  db: Database;
  notifier?: Notifier | undefined;
  context?: LaunchNotificationContext | undefined;
  internalRecipient?: string | undefined;
}

async function campaignTitle(db: Database, campaignId: string): Promise<string> {
  const [row] = await db
    .select({ title: campaignBuild.title })
    .from(campaignBuild)
    .where(eq(campaignBuild.campaignId, campaignId))
    .limit(1);
  return row?.title ?? 'your campaign';
}

/** The request, its Creator's address, and its campaign. One read, one shape. */
async function loadRequest(db: Database, requestId: string) {
  const [row] = await db
    .select({
      id: workAgainRequests.id,
      campaignId: workAgainRequests.originalCampaignId,
      associationId: workAgainRequests.associationId,
      founderUserId: workAgainRequests.founderUserId,
      message: workAgainRequests.message,
      status: workAgainRequests.status,
      responseNote: workAgainRequests.responseNote,
      creatorEmail: affiliateSignupProfiles.email,
      creatorHandle: affiliateSignupProfiles.publicHandle,
    })
    .from(workAgainRequests)
    .innerJoin(
      campaignAffiliateAssociations,
      eq(campaignAffiliateAssociations.id, workAgainRequests.associationId),
    )
    .leftJoin(
      affiliateSignupProfiles,
      eq(affiliateSignupProfiles.associationId, workAgainRequests.associationId),
    )
    .where(eq(workAgainRequests.id, requestId))
    .limit(1);
  return row ?? null;
}

/* ── §27.4: the Creator is asked ──────────────────────────────────────────── */

export async function notifyWorkAgainRequested(
  deps: CompletionNotifyDeps,
  input: { requestId: string },
): Promise<void> {
  if (!deps.notifier || !deps.context) return;
  const request = await loadRequest(deps.db, input.requestId);
  if (!request?.creatorEmail) return;

  const title = await campaignTitle(deps.db, request.campaignId);
  const founder = await loadFounder(deps.db, request.campaignId);

  const notice = await renderPlainNotice({
    subject: `A Founder would like to work with you again — ${title}`,
    headline: 'You have a request to work together again.',
    facts: [
      { label: 'Campaign you completed', value: title },
      { label: 'From', value: founder.name ?? 'The Founder' },
      { label: 'What they said', value: request.message },
      { label: 'Who owns it', value: 'You — there is no deadline on your answer' },
      // §22.9's promise, verbatim. The person most likely to fear that saying
      // no costs them something is the one reading this.
      { label: 'If you decline', value: WORK_AGAIN_NO_PENALTY },
    ],
    paragraphs: [
      'This is a request to talk about working together on something new. Accepting it does not commit you to terms — nothing has been agreed and no campaign exists yet.',
    ],
    action: {
      label: 'Open the request',
      url: `${deps.context.appBaseUrl}/creator/campaigns/${request.associationId}/close`,
    },
    reference: request.id,
    supportEmail: deps.context.supportEmail,
  });

  await deps.notifier.send({
    eventKey: AFFILIATE_WORK_AGAIN_REQUEST,
    entityType: 'work_again_request',
    entityId: request.id,
    to: request.creatorEmail,
    from: deps.context.fromAddress,
    replyTo: deps.context.supportEmail,
    ...notice,
  });
}

/* ── §27.3: the Founder hears the answer ──────────────────────────────────── */

export async function notifyWorkAgainResponse(
  deps: CompletionNotifyDeps,
  input: { requestId: string },
): Promise<void> {
  if (!deps.notifier || !deps.context) return;
  const request = await loadRequest(deps.db, input.requestId);
  if (!request) return;
  if (request.status !== 'accepted' && request.status !== 'declined') return;

  const founder = await loadFounder(deps.db, request.campaignId);
  if (!founder.email) return;

  const title = await campaignTitle(deps.db, request.campaignId);
  const accepted = request.status === 'accepted';

  const notice = await renderPlainNotice({
    subject: accepted
      ? `${request.creatorHandle ?? 'Your Creator'} is open to working again`
      : `${request.creatorHandle ?? 'Your Creator'} declined for now`,
    headline: accepted
      ? 'They are open to talking about something new.'
      : 'They have declined this one.',
    facts: [
      { label: 'Campaign', value: title },
      { label: 'Creator', value: request.creatorHandle ?? 'Your Creator' },
      { label: 'Answer', value: accepted ? 'Open to working again' : 'Declined' },
      ...(request.responseNote ? [{ label: 'What they said', value: request.responseNote }] : []),
      {
        label: 'What this changes',
        // §33.10.8, told to the person most motivated to read it as permission.
        value: accepted
          ? WORK_AGAIN_ACCEPTANCE_GRANTS_NOTHING.join(' ')
          : 'Nothing about your campaign or your standing.',
      },
    ],
    paragraphs: accepted
      ? [
          'Your next campaign still goes through the same route as this one: the cooldown, and then an Admin readiness decision. This answer does not move either.',
        ]
      : [
          'Declining costs a Creator nothing and says nothing about your campaign. You can ask a different Creator you completed with.',
        ],
    action: {
      label: 'Open your campaign',
      url: `${deps.context.appBaseUrl}/campaigns/${request.campaignId}/results`,
    },
    reference: request.id,
    supportEmail: deps.context.supportEmail,
  });

  await deps.notifier.send({
    eventKey: FOUNDER_WORK_AGAIN_RESPONSE,
    entityType: 'work_again_request',
    entityId: request.id,
    to: founder.email,
    from: deps.context.fromAddress,
    replyTo: deps.context.supportEmail,
    ...notice,
  });
}

/* ── §27.6: Admin sees it, because it routes through Proovd ───────────────── */

export async function notifyWorkAgainInternal(
  deps: CompletionNotifyDeps,
  input: { requestId: string },
): Promise<void> {
  if (!deps.notifier || !deps.context || !deps.internalRecipient) return;
  const request = await loadRequest(deps.db, input.requestId);
  if (!request) return;

  const title = await campaignTitle(deps.db, request.campaignId);

  const notice = await renderInternalNotice({
    subject: `Work-again request — ${title}`,
    headline: 'A Founder asked a completed Creator to work again.',
    facts: [
      { label: 'Campaign', value: title },
      { label: 'Creator', value: request.creatorHandle ?? request.associationId },
      { label: 'Status', value: request.status },
      { label: 'Message', value: request.message },
      // §22.9: it routes through Proovd, so Admin sees it. There is no channel
      // for the two of them to talk directly, and that is the design (§30).
      {
        label: 'What it can do',
        value: 'Nothing on its own — no campaign, no cooldown change, no readiness approval.',
      },
    ],
    paragraphs: [
      '§22.9 routes this through Proovd rather than giving the two parties a channel. Nothing is owed here unless the request needs mediation.',
    ],
    action: {
      label: 'Open campaign operations',
      url: `${deps.context.appBaseUrl}/admin/campaign-operations`,
    },
    reference: request.id,
    supportEmail: deps.context.supportEmail,
  });

  await deps.notifier.send({
    eventKey: INTERNAL_WORK_AGAIN_REQUEST,
    entityType: 'work_again_request',
    entityId: request.id,
    to: deps.internalRecipient,
    from: deps.context.fromAddress,
    replyTo: deps.context.supportEmail,
    ...notice,
  });
}

/* ── §27.3: the §22.10 readiness decision ─────────────────────────────────── */

export async function notifyNextCampaignReadiness(
  deps: CompletionNotifyDeps,
  input: { campaignId: string; decisionId: string; decision: 'ready' | 'not_ready'; explanation: string },
): Promise<void> {
  if (!deps.notifier || !deps.context) return;
  const founder = await loadFounder(deps.db, input.campaignId);
  if (!founder.email) return;

  const title = await campaignTitle(deps.db, input.campaignId);
  const ready = input.decision === 'ready';

  const notice = await renderPlainNotice({
    subject: ready
      ? 'You are ready for your next campaign'
      : 'Your next-campaign readiness — what we need first',
    headline: ready
      ? 'Proovd has approved you for a next campaign.'
      : 'We are not ready to approve a next campaign yet.',
    facts: [
      { label: 'Previous campaign', value: title },
      { label: 'Readiness decision', value: ready ? 'Ready' : 'Not ready yet' },
      // §29.4: the actual position, never "policy violation".
      { label: 'Why', value: input.explanation },
      {
        label: 'The other gate',
        // §33.10.9: the two are separate and the Founder is told so, because a
        // readiness approval that read as "you may start now" would collapse
        // them at exactly the moment it matters.
        value: 'The three-month cooldown is separate. Your campaign page shows the exact date.',
      },
    ],
    paragraphs: [ready ? PREPARE_WITHOUT_OPENING : 'Nothing you have already done is affected.'],
    action: {
      label: 'Open your campaign',
      url: `${deps.context.appBaseUrl}/campaigns/${input.campaignId}/results`,
    },
    reference: input.campaignId,
    supportEmail: deps.context.supportEmail,
  });

  await deps.notifier.send({
    eventKey: FOUNDER_READY_NEXT_CAMPAIGN,
    entityType: 'next_campaign_readiness',
    // The DECISION, not the campaign: a `not_ready` that later becomes `ready`
    // is a second thing the Founder needs to hear.
    entityId: input.decisionId,
    to: founder.email,
    from: deps.context.fromAddress,
    replyTo: deps.context.supportEmail,
    ...notice,
  });
}

/* ── §27.5: the satisfaction ask ──────────────────────────────────────────── */

export interface SatisfactionNotifyDeps extends CompletionNotifyDeps {
  tokenService: TokenService;
}

/**
 * §31.8's ask, sent once per reservation after delivery.
 *
 * 21a deliberately kept this out of `backer_delivery`: §27.5 names "Delivery
 * and satisfaction survey" as two events, and linking to a control that did
 * not exist would have been the §1.4 failure. It exists now.
 *
 * The link is the Backer's own magic link — §5.4 gives them no account, so the
 * one-click answer lives on the page they already use. There is no tokenised
 * one-click-from-the-email path, because a link that records an answer on being
 * FETCHED records answers that email scanners give (§30's honesty rule applied
 * to a prefetch).
 */
export async function notifySatisfactionSurvey(
  deps: SatisfactionNotifyDeps,
  input: { reservationId: string },
): Promise<void> {
  if (!deps.notifier || !deps.context) return;

  const [row] = await deps.db
    .select({
      id: reservations.id,
      campaignId: reservations.campaignId,
      backerIdentityId: reservations.backerIdentityId,
      email: backerIdentities.email,
    })
    .from(reservations)
    .innerJoin(backerIdentities, eq(backerIdentities.id, reservations.backerIdentityId))
    .where(eq(reservations.id, input.reservationId))
    .limit(1);
  if (!row?.email) return;

  const title = await campaignTitle(deps.db, row.campaignId);
  const link = await mintOrReissueMagicLink(
    {
      db: deps.db,
      tokenService: deps.tokenService,
      appBaseUrl: deps.context.appBaseUrl,
    },
    { campaignId: row.campaignId, backerIdentityId: row.backerIdentityId },
  );

  const notice = await renderPlainNotice({
    subject: `How did ${title} go?`,
    headline: 'One question, one click.',
    facts: [
      { label: 'Campaign', value: title },
      { label: 'What we are asking', value: 'Whether what you received was what you expected' },
      { label: 'How long it takes', value: 'One click. A reason is optional and you can skip it.' },
      {
        label: 'What it changes',
        // §31.8: this is not a marketing moment and must not read as one.
        value:
          'If something went wrong, a person at Proovd picks it up. Nothing about your order changes because you answered.',
      },
    ],
    paragraphs: [
      'You pre-ordered this and it has been delivered. We would like to know how it went — one click is a complete answer, and you can add a reason if you want to.',
    ],
    // §27.2: at most one primary action.
    action: { label: 'Answer in one click', url: link.url },
    reference: row.campaignId,
    supportEmail: deps.context.supportEmail,
  });

  await deps.notifier.send({
    eventKey: BACKER_SATISFACTION_SURVEY,
    entityType: 'reservation',
    // Per RESERVATION. §31.8 permits one response, so there is one ask.
    entityId: row.id,
    to: row.email,
    from: deps.context.fromAddress,
    replyTo: deps.context.supportEmail,
    ...notice,
  });
}
