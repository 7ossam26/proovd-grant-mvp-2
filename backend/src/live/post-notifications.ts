/**
 * The one §27 message deviation 2 sends — Founder Dashboard Session D.
 *
 * ── One key, and the absence of the second is a decision ────────────────────
 * There is deliberately no `founder_post_acknowledged` beside it. The Founder is
 * looking at the post when they send it and the surface says so immediately, so
 * a receipt for their own click is a message §27 does not name for a fact
 * already on screen — Session C's reasoning about the meeting response, again.
 *
 * ── Deduped on the SUBMISSION ───────────────────────────────────────────────
 * Not on the acknowledgement row. The record is one-way and insert-only, so
 * there is no second deliberate act for a second message to belong to — unlike
 * §22.9's work-again ask, where a Founder may legitimately ask again on a later
 * campaign. Keying on the post is the honest entity here.
 *
 * ── What the message may not contain ────────────────────────────────────────
 * No note, because the record has no column for one. No metric, no ranking, and
 * no comparison with another Creator — §30 defers public leaderboards and a
 * message saying "you're doing well" against an unstated baseline is a private
 * one. It carries the campaign, the post it names, and the fact.
 */

import { eq } from 'drizzle-orm';
import {
  ACKNOWLEDGEMENT_HAS_NO_MESSAGE,
  ACKNOWLEDGEMENT_IS_ONE_WAY,
} from './post-logic.js';
import type { Database } from '../db/client.js';
import { campaignAffiliateAssociations } from '../db/schema/domain.js';
import { campaignBuild } from '../db/schema/build.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import { creatorPostSubmissions } from '../db/schema/launch.js';
import type { Notifier } from '../notifications/send.js';
import { AFFILIATE_POST_ACKNOWLEDGED } from '../notifications/events.js';
import { renderPlainNotice } from '../notifications/templates/plain.js';
import { loadFounder, type LaunchNotificationContext } from '../launch/notifications.js';

export interface PostAckNotifyDeps {
  db: Database;
  notifier?: Notifier | undefined;
  context?: LaunchNotificationContext | undefined;
}

/**
 * Loads its own facts from the record it names, so a caller cannot describe the
 * acknowledgement differently from what was stored — the §27.6 queue-notice rule
 * (Phase 22b), applied to a customer message.
 */
export async function notifyPostAcknowledged(
  deps: PostAckNotifyDeps,
  input: { submissionId: string },
): Promise<void> {
  if (!deps.notifier || !deps.context) return;

  const [row] = await deps.db
    .select({
      submissionId: creatorPostSubmissions.id,
      campaignId: creatorPostSubmissions.campaignId,
      associationId: creatorPostSubmissions.associationId,
      postUrl: creatorPostSubmissions.postUrl,
      creatorEmail: affiliateSignupProfiles.email,
    })
    .from(creatorPostSubmissions)
    .innerJoin(
      campaignAffiliateAssociations,
      eq(campaignAffiliateAssociations.id, creatorPostSubmissions.associationId),
    )
    .innerJoin(
      affiliateSignupProfiles,
      eq(affiliateSignupProfiles.associationId, campaignAffiliateAssociations.id),
    )
    .where(eq(creatorPostSubmissions.id, input.submissionId))
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
    subject: `The Founder saw your post — ${title}`,
    headline: 'The Founder acknowledged your post.',
    facts: [
      { label: 'Campaign', value: title },
      { label: 'From', value: founder.name ?? 'The Founder' },
      { label: 'The post', value: row.postUrl },
      { label: 'What it changes', value: 'Nothing — this is them saying they saw it' },
    ],
    paragraphs: [ACKNOWLEDGEMENT_HAS_NO_MESSAGE, ACKNOWLEDGEMENT_IS_ONE_WAY],
    action: {
      label: 'Open your campaign',
      url: `${deps.context.appBaseUrl}/creator/campaigns/${row.associationId}/partnership`,
    },
    reference: row.submissionId,
    supportEmail: deps.context.supportEmail,
  });

  await deps.notifier.send({
    eventKey: AFFILIATE_POST_ACKNOWLEDGED,
    entityType: 'creator_post_submission',
    entityId: row.submissionId,
    to: row.creatorEmail,
    from: deps.context.fromAddress,
    replyTo: deps.context.supportEmail,
    ...notice,
  });
}
