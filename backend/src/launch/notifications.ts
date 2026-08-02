/**
 * Launch and first-post verification messages — Spec §17, §27.2, §27.3, §27.4.
 *
 * Same posture as Phase 11/12's senders: the domain event already committed, so
 * a provider refusal is recorded and returned, never thrown. Dedup keys name the
 * thing that happens once:
 *
 *   founder campaign-live   → the campaign (a campaign launches once);
 *   creator campaign-live   → the association (each Creator activates once);
 *   first-post outcome      → the submission (each submission is verified once).
 *
 * The §29.6 refund message is Phase 11's `notifyListingRefund` — one refund
 * message, one key — so nothing here re-invents it.
 */

import { eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns, campaignAffiliateAssociations } from '../db/schema/domain.js';
import { campaignDrafts, founderProspects } from '../db/schema/invitations.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import { creatorPostSubmissions } from '../db/schema/launch.js';
import type { Notifier } from '../notifications/send.js';
import {
  FOUNDER_CAMPAIGN_LIVE,
  AFFILIATE_CAMPAIGN_LIVE,
  AFFILIATE_FIRST_POST_PASS,
  AFFILIATE_FIRST_POST_CORRECTION,
  AFFILIATE_FIRST_POST_REJECT,
  type NotificationEventKey,
} from '../notifications/events.js';
import {
  renderCampaignLiveFounder,
  renderCampaignLiveAffiliate,
  renderFirstPostPass,
  renderFirstPostCorrection,
  renderFirstPostReject,
} from '../notifications/templates/launch.js';

export interface LaunchNotificationContext {
  appBaseUrl: string;
  supportEmail: string;
  fromAddress: string;
}

function utcMinute(instant: Date): string {
  return instant.toISOString().replace('T', ' ').slice(0, 16);
}

/* ── Identity reads ───────────────────────────────────────────────────────── */

async function loadFounder(
  db: Database,
  campaignId: string,
): Promise<{ email: string | null; name: string | null; productName: string | null }> {
  const [row] = await db
    .select({
      claimEmail: founderClaimProfiles.email,
      claimName: founderClaimProfiles.preferredName,
      prospectEmail: founderProspects.email,
      prospectName: founderProspects.preferredName,
      productName: founderProspects.productName,
    })
    .from(campaigns)
    .leftJoin(founderClaimProfiles, eq(founderClaimProfiles.campaignId, campaigns.id))
    .leftJoin(campaignDrafts, eq(campaignDrafts.campaignId, campaigns.id))
    .leftJoin(founderProspects, eq(campaignDrafts.prospectId, founderProspects.id))
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  return {
    email: (row?.claimEmail ?? row?.prospectEmail ?? null)?.trim() || null,
    name: row?.claimName ?? row?.prospectName ?? null,
    productName: row?.productName ?? null,
  };
}

/* ── Campaign live (§17, §27.3, §27.4) ─────────────────────────────────────── */

export async function notifyCampaignLive(
  db: Database,
  notifier: Notifier,
  context: LaunchNotificationContext,
  input: { campaignId: string; activatedAssociationIds: string[]; campaignCloseAt: Date },
): Promise<{ founder: string; creators: Array<{ associationId: string; outcome: string }> }> {
  const founder = await loadFounder(db, input.campaignId);
  const closeUtc = utcMinute(input.campaignCloseAt);

  let founderOutcome = 'skipped: no Founder address';
  if (founder.email) {
    const rendered = await renderCampaignLiveFounder({
      founderName: founder.name,
      productName: founder.productName,
      campaignUrl: `${context.appBaseUrl}/campaigns/${input.campaignId}/workspace`,
      closeUtc,
      reference: input.campaignId,
      supportEmail: context.supportEmail,
    });
    founderOutcome = (
      await notifier.send({
        eventKey: FOUNDER_CAMPAIGN_LIVE,
        entityType: 'campaign',
        entityId: input.campaignId,
        to: founder.email,
        from: context.fromAddress,
        replyTo: context.supportEmail,
        ...rendered,
      })
    ).status;
  }

  const creators: Array<{ associationId: string; outcome: string }> = [];
  if (input.activatedAssociationIds.length > 0) {
    const rows = await db
      .select({
        associationId: campaignAffiliateAssociations.id,
        email: affiliateSignupProfiles.email,
        handle: affiliateSignupProfiles.publicHandle,
      })
      .from(campaignAffiliateAssociations)
      .leftJoin(
        affiliateSignupProfiles,
        eq(affiliateSignupProfiles.associationId, campaignAffiliateAssociations.id),
      )
      .where(inArray(campaignAffiliateAssociations.id, input.activatedAssociationIds));

    for (const row of rows) {
      const to = row.email?.trim();
      if (!to) {
        creators.push({ associationId: row.associationId, outcome: 'skipped: no address' });
        continue;
      }
      const rendered = await renderCampaignLiveAffiliate({
        creatorName: row.handle,
        productName: founder.productName,
        kitUrl: `${context.appBaseUrl}/creator/campaigns/${row.associationId}`,
        closeUtc,
        reference: row.associationId,
        supportEmail: context.supportEmail,
      });
      const outcome = await notifier.send({
        eventKey: AFFILIATE_CAMPAIGN_LIVE,
        entityType: 'campaign_affiliate_association',
        entityId: row.associationId,
        to,
        from: context.fromAddress,
        replyTo: context.supportEmail,
        ...rendered,
      });
      creators.push({ associationId: row.associationId, outcome: outcome.status });
    }
  }

  return { founder: founderOutcome, creators };
}

/* ── First-post verification outcome (§17, §27.4) ──────────────────────────── */

export async function notifyPostVerification(
  db: Database,
  notifier: Notifier,
  context: LaunchNotificationContext,
  input: { submissionId: string },
): Promise<string> {
  const [submission] = await db
    .select({
      id: creatorPostSubmissions.id,
      associationId: creatorPostSubmissions.associationId,
      campaignId: creatorPostSubmissions.campaignId,
      status: creatorPostSubmissions.status,
      correctionDetail: creatorPostSubmissions.correctionDetail,
      correctionDueAt: creatorPostSubmissions.correctionDueAt,
      enforcementReason: creatorPostSubmissions.enforcementReason,
      email: affiliateSignupProfiles.email,
      handle: affiliateSignupProfiles.publicHandle,
    })
    .from(creatorPostSubmissions)
    .leftJoin(
      affiliateSignupProfiles,
      eq(affiliateSignupProfiles.associationId, creatorPostSubmissions.associationId),
    )
    .where(eq(creatorPostSubmissions.id, input.submissionId))
    .limit(1);
  if (!submission) return 'skipped: not found';
  const to = submission.email?.trim();
  if (!to) return 'skipped: no address';

  const founder = await loadFounder(db, submission.campaignId);
  const kitUrl = `${context.appBaseUrl}/creator/campaigns/${submission.associationId}`;

  let eventKey: NotificationEventKey;
  let rendered: { subject: string; html: string; text: string };

  if (submission.status === 'passed') {
    eventKey = AFFILIATE_FIRST_POST_PASS;
    rendered = await renderFirstPostPass({
      creatorName: submission.handle,
      productName: founder.productName,
      campaignUrl: kitUrl,
      reference: submission.id,
      supportEmail: context.supportEmail,
    });
  } else if (submission.status === 'correction_needed') {
    eventKey = AFFILIATE_FIRST_POST_CORRECTION;
    rendered = await renderFirstPostCorrection({
      creatorName: submission.handle,
      productName: founder.productName,
      correctionDetail:
        submission.correctionDetail?.trim() || 'Please review the campaign requirements and update your post.',
      correctionDueUtc: submission.correctionDueAt ? utcMinute(submission.correctionDueAt) : null,
      campaignUrl: kitUrl,
      reference: submission.id,
      supportEmail: context.supportEmail,
    });
  } else if (submission.status === 'rejected') {
    eventKey = AFFILIATE_FIRST_POST_REJECT;
    rendered = await renderFirstPostReject({
      creatorName: submission.handle,
      productName: founder.productName,
      reason: submission.enforcementReason?.trim() || 'Your post did not meet the campaign requirements.',
      campaignUrl: kitUrl,
      reference: submission.id,
      supportEmail: context.supportEmail,
    });
  } else {
    return 'skipped: not verified';
  }

  const outcome = await notifier.send({
    eventKey,
    entityType: 'creator_post_submission',
    entityId: submission.id,
    to,
    from: context.fromAddress,
    replyTo: context.supportEmail,
    ...rendered,
  });
  return outcome.status;
}
