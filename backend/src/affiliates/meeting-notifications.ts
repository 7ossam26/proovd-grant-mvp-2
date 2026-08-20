/**
 * The one §27 message deviation 1 sends — Founder Dashboard Session C.
 *
 * ── One key, and the absence of the second one is a decision ────────────────
 * §22.9's work-again ask sends three (the Creator's request, the Founder's
 * answer, the internal queue notice). This sends ONE, and the brief scopes it
 * that way for a reason worth stating: the Founder is looking at the roster
 * card when they ask and when they come back, so the answer is already on a
 * screen they open — a `founder_meeting_response` key would be a message §27
 * does not name, for a fact the surface already carries. §22.9's own three
 * exist because that ask fires after a campaign has ENDED, when there is no
 * roster anybody is watching.
 *
 * ── Deduped on the request ROW ──────────────────────────────────────────────
 * One open ask per (campaign, Creator) is a partial unique index, so a second
 * row is a second deliberate ask and deserves its own message; a replayed call
 * finds the same row and sends nothing (§7's resend rule, §27.2's dedup).
 *
 * ── What the message may not contain ────────────────────────────────────────
 * No time, no date, no slot, no calendar link — there is nothing to render,
 * because the record holds none of it (§30, tech-stack §12). And nothing that
 * reads as a decision: §14.2's three responses move terms and this does not,
 * so the body says so in the words the surface uses.
 */

import { eq } from 'drizzle-orm';
import {
  MEETING_REQUEST_CHANGES_NOTHING,
  MEETING_REQUEST_IS_NOT_A_SCHEDULER,
  MEETING_REQUEST_NO_PENALTY,
} from './meeting-logic.js';
import type { Database } from '../db/client.js';
import { campaignAffiliateAssociations } from '../db/schema/domain.js';
import { campaignBuild } from '../db/schema/build.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import { founderMeetingRequests } from '../db/schema/meetings.js';
import type { Notifier } from '../notifications/send.js';
import { AFFILIATE_MEETING_REQUEST } from '../notifications/events.js';
import { renderPlainNotice } from '../notifications/templates/plain.js';
import { loadFounder, type LaunchNotificationContext } from '../launch/notifications.js';

export interface MeetingNotifyDeps {
  db: Database;
  notifier?: Notifier | undefined;
  context?: LaunchNotificationContext | undefined;
}

/**
 * Loads its own facts from the record it names, so a caller cannot describe the
 * request differently from what was stored — the §27.6 queue-notice rule (Phase
 * 22b), applied to a customer message.
 */
export async function notifyMeetingRequested(
  deps: MeetingNotifyDeps,
  input: { requestId: string },
): Promise<void> {
  if (!deps.notifier || !deps.context) return;

  const [row] = await deps.db
    .select({
      id: founderMeetingRequests.id,
      campaignId: founderMeetingRequests.campaignId,
      associationId: founderMeetingRequests.associationId,
      message: founderMeetingRequests.message,
      creatorEmail: affiliateSignupProfiles.email,
    })
    .from(founderMeetingRequests)
    .innerJoin(
      campaignAffiliateAssociations,
      eq(campaignAffiliateAssociations.id, founderMeetingRequests.associationId),
    )
    .innerJoin(
      affiliateSignupProfiles,
      eq(affiliateSignupProfiles.associationId, campaignAffiliateAssociations.id),
    )
    .where(eq(founderMeetingRequests.id, input.requestId))
    .limit(1);
  if (!row?.creatorEmail) return;

  const [build] = await deps.db
    .select({ title: campaignBuild.title })
    .from(campaignBuild)
    .where(eq(campaignBuild.campaignId, row.campaignId))
    .limit(1);
  const title = build?.title ?? 'the campaign';
  const founder = await loadFounder(deps.db, row.campaignId);

  const notice = await renderPlainNotice({
    subject: `A Founder would like to talk before you decide — ${title}`,
    headline: 'The Founder has asked to talk.',
    facts: [
      { label: 'Campaign', value: title },
      { label: 'From', value: founder.name ?? 'The Founder' },
      { label: 'What they said', value: row.message },
      { label: 'Who owns it', value: 'You — there is no deadline on your answer' },
      { label: 'If you say no', value: MEETING_REQUEST_NO_PENALTY },
    ],
    paragraphs: [
      MEETING_REQUEST_IS_NOT_A_SCHEDULER,
      MEETING_REQUEST_CHANGES_NOTHING,
    ],
    action: {
      label: 'Open the opportunity',
      url: `${deps.context.appBaseUrl}/creator/campaigns/${row.associationId}/opportunity`,
    },
    reference: row.id,
    supportEmail: deps.context.supportEmail,
  });

  await deps.notifier.send({
    eventKey: AFFILIATE_MEETING_REQUEST,
    entityType: 'founder_meeting_request',
    entityId: row.id,
    to: row.creatorEmail,
    from: deps.context.fromAddress,
    replyTo: deps.context.supportEmail,
    ...notice,
  });
}
