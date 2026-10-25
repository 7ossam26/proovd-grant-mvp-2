/** Field-specific Founder feedback. This never changes content or review/lifecycle state. */
import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns } from '../db/schema/domain.js';
import { campaignBuild, campaignFaqs, campaignRewardPackages } from '../db/schema/build.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { auditEvents } from '../db/schema/integrity.js';
import {
  campaignSetupChangeRequests,
  type CampaignSetupChangeRequest,
} from '../db/schema/setup-change-requests.js';
import type { PanelActor } from '../founders/panel/service.js';
import type { LaunchNotificationContext } from '../launch/notifications.js';
import { loadFounder } from '../launch/notifications.js';
import type { Notifier } from '../notifications/send.js';
import { FOUNDER_SETUP_CHANGE_REQUESTED } from '../notifications/events.js';
import { renderPlainNotice } from '../notifications/templates/plain.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EDITABLE = ['affiliate_response_and_build', 'changes_required'];
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface SetupChangeRequestView {
  id: string;
  campaignId: string;
  fieldKey: string;
  fieldLabel: string;
  reason: string;
  deepLink: string;
  requestedAt: string;
}

export type SetupChangeDelivery = {
  status: 'sent' | 'duplicate' | 'failed' | 'pending' | 'unavailable';
  reason?: string;
};

export type SetupChangeRefusal = {
  ok: false;
  code: 'not_found' | 'invalid_value' | 'not_editable' | 'idempotency_conflict';
  message: string;
  next: string;
};

function refuse(code: SetupChangeRefusal['code'], message: string, next: string): SetupChangeRefusal {
  return { ok: false, code, message, next };
}

export function setupChangeRequestView(row: CampaignSetupChangeRequest): SetupChangeRequestView {
  return {
    id: row.id,
    campaignId: row.campaignId,
    fieldKey: row.fieldKey,
    fieldLabel: row.fieldLabel,
    reason: row.reason,
    deepLink: row.deepLink,
    requestedAt: row.requestedAt.toISOString(),
  };
}

/** Explicit targets: system/provider fields cannot become Founder assignments. */
function targetFor(key: string, campaignType: string | null): {
  key: string;
  label: string;
  page: 'voice' | 'threshold' | 'faqs' | 'rewards';
  rowId?: string;
} | null {
  switch (key) {
    case 'brandVoicePrefill':
    case 'draft.brand_voice_prefills':
    case 'brandVoice':
    case 'build.brand_voice':
      // Invitation prefills remain an Admin record. A Founder can choose the
      // final voice; no request purports to let them rewrite those prefills.
      return { key: 'build.brand_voice', label: 'Final voice', page: 'voice' };
    case 'brandVoiceContext':
    case 'build.brand_perception':
      return { key: 'build.brand_perception', label: 'More context', page: 'voice' };
    case 'founderOrderGoal':
      return {
        key: campaignType === 'pre_launch' ? 'build.internal_target_cents' : 'build.order_threshold',
        label: 'Founder order goal', page: 'threshold',
      };
    case 'build.order_threshold':
      return campaignType === 'pre_build'
        ? { key, label: 'Founder order goal', page: 'threshold' } : null;
    case 'build.internal_target_cents':
      return campaignType === 'pre_launch'
        ? { key, label: 'Founder order goal', page: 'threshold' } : null;
  }
  const row = /^(faq|reward)\.([0-9a-f-]+)\.(question|answer|title|price|price_cents|delivery|description|contents)$/i.exec(key);
  if (!row || !UUID.test(row[2]!)) return null;
  const kind = row[1]!.toLowerCase();
  const rowId = row[2]!.toLowerCase();
  const suffix = row[3]!.toLowerCase();
  if (kind === 'faq' && (suffix === 'question' || suffix === 'answer')) {
    return { key: `faq.${rowId}.${suffix}`, label: `FAQ ${suffix}`, page: 'faqs', rowId };
  }
  if (kind !== 'reward') return null;
  const mapped: Record<string, { suffix: string; label: string }> = {
    title: { suffix: 'title', label: 'Reward title' },
    price: { suffix: 'price_cents', label: 'Reward price' },
    price_cents: { suffix: 'price_cents', label: 'Reward price' },
    delivery: { suffix: 'delivery', label: 'Reward delivery' },
    description: { suffix: 'contents', label: 'Reward description' },
    contents: { suffix: 'contents', label: 'Reward description' },
  };
  const field = mapped[suffix];
  return field ? { key: `reward.${rowId}.${field.suffix}`, label: field.label, page: 'rewards', rowId } : null;
}

async function targetLabel(tx: Tx, campaignId: string, target: NonNullable<ReturnType<typeof targetFor>>): Promise<string | null> {
  if (!target.rowId) return target.label;
  if (target.page === 'faqs') {
    const [row] = await tx.select({ question: campaignFaqs.question }).from(campaignFaqs)
      .where(and(eq(campaignFaqs.id, target.rowId), eq(campaignFaqs.campaignId, campaignId))).limit(1);
    return row ? `FAQ “${row.question.slice(0, 300)}” · ${target.key.endsWith('.question') ? 'Question' : 'Answer'}` : null;
  }
  const [row] = await tx.select({ title: campaignRewardPackages.title }).from(campaignRewardPackages)
    .where(and(eq(campaignRewardPackages.id, target.rowId), eq(campaignRewardPackages.campaignId, campaignId))).limit(1);
  return row ? `Reward “${row.title.slice(0, 300)}” · ${target.label.replace(/^Reward /, '')}` : null;
}

export async function requestSetupChange(
  db: Database,
  who: PanelActor,
  input: { campaignId: string; fieldKey: string; reason: string; requestKey: string },
): Promise<{ ok: true; created: boolean; request: CampaignSetupChangeRequest } | SetupChangeRefusal> {
  if (!UUID.test(input.campaignId)) return refuse('not_found', 'That campaign could not be found.', 'Open the Founder record again.');
  const reason = input.reason.trim();
  if (!reason || reason.length > 20000 || !UUID.test(input.requestKey)) {
    return refuse('invalid_value', 'Enter a reason of 1 to 20,000 characters and a valid request reference.', 'Keep your reason and try the request again.');
  }

  return db.transaction(async (tx) => {
    // Serialize create/retry with the same campaign; the unique key is the
    // database backstop, and a retry cannot create another feedback record.
    const [campaign] = await tx.select().from(campaigns)
      .where(and(eq(campaigns.id, input.campaignId), isNull(campaigns.archivedAt))).limit(1).for('update');
    if (!campaign) return refuse('not_found', 'That campaign could not be found.', 'Open the Founder record again.');
    const target = targetFor(input.fieldKey, campaign.type);
    if (!target) return refuse('invalid_value', 'That row is not an editable Founder setup field.', 'Choose Final voice, More context, the Founder order goal, an FAQ, or a reward. Nothing was changed.');
    const [existing] = await tx.select().from(campaignSetupChangeRequests)
      .where(and(eq(campaignSetupChangeRequests.campaignId, input.campaignId), eq(campaignSetupChangeRequests.requestKey, input.requestKey))).limit(1);
    if (existing) {
      if (existing.fieldKey !== target.key || existing.reason !== reason) {
        return refuse('idempotency_conflict', 'That request reference already belongs to different feedback.', 'Close this dialog and start a new request. The original request is unchanged.');
      }
      return { ok: true as const, created: false, request: existing };
    }
    if (!EDITABLE.includes(campaign.status)) {
      return refuse('not_editable', 'The Founder cannot edit campaign setup at its current stage.', 'If the campaign is under review, use the review decision to request changes first. Then request the exact setup correction. Nothing was changed or emailed.');
    }
    const [claim] = await tx.select({ userId: founderClaimProfiles.claimedUserId }).from(founderClaimProfiles)
      .where(eq(founderClaimProfiles.campaignId, input.campaignId)).limit(1);
    if (!claim?.userId) return refuse('not_editable', 'Nobody has claimed this Founder account yet.', 'Use the invitation to let the Founder claim the account before requesting a setup correction.');
    const fieldLabel = await targetLabel(tx, input.campaignId, target);
    if (fieldLabel === null) {
      return refuse('not_found', 'That FAQ or reward is not on this campaign.', 'Reload the Founder record and choose an existing row. Nothing was changed.');
    }
    const id = randomUUID();
    const [inserted] = await tx.insert(campaignSetupChangeRequests).values({
      id, campaignId: input.campaignId, requestKey: input.requestKey,
      fieldKey: target.key, fieldLabel, reason,
      deepLink: `/campaigns/${input.campaignId}/setup/${target.page}?changeRequest=${id}`,
      requestedBy: who.actor,
    }).returning();
    await tx.insert(auditEvents).values({
      actor: who.actor, mfaContext: who.mfaContext, reauthContext: who.reauthContext,
      targetType: 'campaign', targetId: input.campaignId,
      action: 'campaign.setup_change_requested',
      internalReason: `Requested a Founder correction to ${fieldLabel}; campaign values and review state were preserved.`,
      customerExplanation: reason,
      newValue: { requestId: id, fieldKey: target.key, deepLink: inserted!.deepLink },
    });
    return { ok: true as const, created: true, request: inserted! };
  });
}

export async function listSetupChangeRequests(db: Database, campaignId: string): Promise<SetupChangeRequestView[]> {
  const rows = await db.select().from(campaignSetupChangeRequests)
    .where(eq(campaignSetupChangeRequests.campaignId, campaignId))
    .orderBy(desc(campaignSetupChangeRequests.requestedAt));
  return rows.map(setupChangeRequestView);
}

export async function renderSetupChangeNotice(input: {
  campaignName: string; fieldLabel: string; reason: string; url: string; reference: string; supportEmail: string;
}) {
  return renderPlainNotice({
    subject: `A change requested for ${input.campaignName}`,
    headline: 'Please update this part of your campaign setup.',
    facts: [
      { label: 'Campaign', value: input.campaignName },
      { label: 'Field', value: input.fieldLabel },
      { label: 'Requested change', value: input.reason },
      { label: 'Who owns the next step', value: 'You' },
    ],
    action: { label: 'Review the requested change', url: input.url },
    reference: input.reference,
    supportEmail: input.supportEmail,
  });
}

/**
 * Persist the attempt claim before contacting the provider. Concurrent clicks
 * see pending; only a confirmed refusal advances to another attempt identity.
 * A process crash after acceptance can never cause an automatic duplicate send.
 */
export async function notifySetupChangeRequest(
  deps: { db: Database; notifier?: Notifier | undefined; context?: LaunchNotificationContext | undefined },
  requestId: string,
): Promise<SetupChangeDelivery> {
  const claim = await deps.db.transaction(async (tx) => {
    const [row] = await tx.select().from(campaignSetupChangeRequests)
      .where(eq(campaignSetupChangeRequests.id, requestId)).limit(1).for('update');
    if (!row) return { status: 'unavailable' as const };
    if (row.deliveryStatus === 'sent') return { status: 'duplicate' as const };
    if (row.deliveryStatus === 'pending') return { status: 'pending' as const };
    const [campaign] = await tx.select({ status: campaigns.status, archivedAt: campaigns.archivedAt }).from(campaigns)
      .where(eq(campaigns.id, row.campaignId)).limit(1);
    const [founder] = await tx.select({ email: founderClaimProfiles.email }).from(founderClaimProfiles)
      .where(eq(founderClaimProfiles.campaignId, row.campaignId)).limit(1);
    if (!deps.notifier || !deps.context || !founder?.email || !campaign || campaign.archivedAt || !EDITABLE.includes(campaign.status)) {
      await tx.update(campaignSetupChangeRequests).set({ deliveryStatus: 'unavailable' })
        .where(eq(campaignSetupChangeRequests.id, requestId));
      return { status: 'unavailable' as const };
    }
    const attemptId = randomUUID();
    await tx.update(campaignSetupChangeRequests).set({ deliveryStatus: 'pending', deliveryAttemptId: attemptId })
      .where(eq(campaignSetupChangeRequests.id, requestId));
    return { status: 'claimed' as const, row, attemptId, email: founder.email };
  });
  if (claim.status !== 'claimed') return claim;
  const context = deps.context!;
  try {
    const [build] = await deps.db.select({ title: campaignBuild.title }).from(campaignBuild)
      .where(eq(campaignBuild.campaignId, claim.row.campaignId)).limit(1);
    const founder = await loadFounder(deps.db, claim.row.campaignId);
    const notice = await renderSetupChangeNotice({
      campaignName: build?.title?.trim() || founder.productName || 'your campaign', fieldLabel: claim.row.fieldLabel,
      reason: claim.row.reason, url: `${context.appBaseUrl.replace(/\/$/, '')}${claim.row.deepLink}`,
      reference: claim.row.id, supportEmail: context.supportEmail,
    });
    const outcome = await deps.notifier!.send({
      eventKey: FOUNDER_SETUP_CHANGE_REQUESTED,
      entityType: 'campaign_setup_change_request_attempt', entityId: claim.attemptId,
      to: claim.email, from: context.fromAddress, replyTo: context.supportEmail,
      ...notice,
    });
    if (outcome.status === 'duplicate') return { status: 'pending' };
    const sent = outcome.status === 'sent';
    await deps.db.update(campaignSetupChangeRequests).set({
      deliveryStatus: sent ? 'sent' : 'failed', deliveredAt: sent ? new Date() : null,
    }).where(and(eq(campaignSetupChangeRequests.id, requestId), eq(campaignSetupChangeRequests.deliveryAttemptId, claim.attemptId)));
    return { status: sent ? 'sent' : 'failed' };
  } catch {
    // The provider or delivery-record write may have succeeded before an
    // exception. Retain the pending claim; claiming a retry would risk a second
    // message when there is no evidence that the first failed.
    return { status: 'pending' };
  }
}
