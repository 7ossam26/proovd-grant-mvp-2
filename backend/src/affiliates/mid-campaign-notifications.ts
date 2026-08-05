/**
 * §20 mid-campaign Creator messages — Spec §27.3, §27.4, §27.6 (Phase 22b).
 *
 * Ten keys across four moments, and the reason §27 names them separately from
 * the ordinary invitation/acceptance/activation messages is the terms: a
 * Creator joining a live campaign accepts a deliverable measured in the time
 * that is LEFT, frozen at the moment they were asked. Reusing 08a's general
 * invitation copy would send them the full-campaign terms nobody offered.
 *
 *   opened      founder_mid_campaign_creator_proposed
 *               affiliate_mid_campaign_invitation
 *               internal_mid_campaign_invite
 *   accepted    founder_mid_campaign_creator_accepted
 *               internal_mid_campaign_accept
 *   ready       affiliate_mid_campaign_readiness
 *               internal_mid_campaign_readiness
 *   activated   founder_mid_campaign_creator_activated
 *               affiliate_mid_campaign_activation
 *               internal_mid_campaign_activation
 *
 * ── Every one deduplicates on the `mid_campaign_additions` row ─────────────
 * That row is per association, insert-once, and trigger-immutable, so it is the
 * one identifier that means "this Creator's mid-campaign join" at all four
 * moments. It is also what makes these safe to call from the SHARED §14.2
 * acceptance path and the shared readiness evaluation: no addition row means
 * this is an ordinary Creator and nothing here sends.
 *
 * ── The frozen terms are read, never recomputed ────────────────────────────
 * §20 freezes the remaining hours, the close instant, and the deliverable
 * sentence at the moment the Creator was asked, precisely so a message sent
 * later cannot show a window that has shrunk since they agreed. These render
 * `mid_campaign_additions` as stored.
 */

import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaignAffiliateAssociations } from '../db/schema/domain.js';
import { campaignBuild } from '../db/schema/build.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import { midCampaignAdditions, type MidCampaignAddition } from '../db/schema/live-editing.js';
import type { Notifier } from '../notifications/send.js';
import {
  FOUNDER_MID_CAMPAIGN_CREATOR_PROPOSED,
  FOUNDER_MID_CAMPAIGN_CREATOR_ACCEPTED,
  FOUNDER_MID_CAMPAIGN_CREATOR_ACTIVATED,
  AFFILIATE_MID_CAMPAIGN_INVITATION,
  AFFILIATE_MID_CAMPAIGN_READINESS,
  AFFILIATE_MID_CAMPAIGN_ACTIVATION,
  INTERNAL_MID_CAMPAIGN_INVITE,
  INTERNAL_MID_CAMPAIGN_ACCEPT,
  INTERNAL_MID_CAMPAIGN_READINESS,
  INTERNAL_MID_CAMPAIGN_ACTIVATION,
  type NotificationEventKey,
} from '../notifications/events.js';
import { renderInternalNotice, renderPlainNotice } from '../notifications/templates/plain.js';
import { loadFounder, type LaunchNotificationContext } from '../launch/notifications.js';

export interface MidCampaignNotifyDeps {
  db: Database;
  notifier?: Notifier | undefined;
  context?: LaunchNotificationContext | undefined;
  internalRecipient?: string | undefined;
}

interface Context {
  addition: MidCampaignAddition;
  campaignId: string;
  campaignTitle: string;
  founderEmail: string | null;
  creatorEmail: string | null;
  creatorHandle: string;
}

/**
 * The addition and both sides, or null.
 *
 * Returning null when there is no addition row is what lets the shared §14.2
 * acceptance path and the shared readiness evaluation call these
 * unconditionally: an ordinary Creator has no addition, so nothing sends.
 */
async function loadContext(db: Database, associationId: string): Promise<Context | null> {
  const [addition] = await db
    .select()
    .from(midCampaignAdditions)
    .where(eq(midCampaignAdditions.associationId, associationId))
    .limit(1);
  if (!addition) return null;

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
    addition,
    campaignId: row.campaignId,
    campaignTitle: build?.title ?? 'your campaign',
    founderEmail: founder.email,
    creatorEmail: row.creatorEmail,
    creatorHandle: row.creatorHandle ?? 'your Creator',
  };
}

function utcMinute(at: Date): string {
  return `${at.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/** The frozen §20 terms, as facts. Read from the row, never recomputed. */
function frozenTerms(addition: MidCampaignAddition): { label: string; value: string }[] {
  return [
    { label: 'Time left when you were asked', value: `${addition.remainingHours} hours` },
    { label: 'Campaign closes', value: utcMinute(addition.campaignCloseAt) },
    ...(addition.adjustedDeliverables
      ? [{ label: 'What you agreed to do', value: addition.adjustedDeliverables }]
      : []),
  ];
}

async function sendTo(
  deps: MidCampaignNotifyDeps,
  to: string | null | undefined,
  eventKey: NotificationEventKey,
  additionId: string,
  message: { subject: string; html: string; text: string },
  internal = false,
): Promise<void> {
  if (!deps.notifier || !deps.context || !to) return;
  await deps.notifier.send({
    eventKey,
    entityType: 'mid_campaign_addition',
    // Every one of the ten keys on the addition row: one Creator, one join.
    entityId: additionId,
    to,
    from: deps.context.fromAddress,
    ...(internal ? {} : { replyTo: deps.context.supportEmail }),
    ...message,
  });
}

/* ── Opened (§20) ────────────────────────────────────────────────────────── */

export async function notifyMidCampaignOpened(
  deps: MidCampaignNotifyDeps,
  input: { associationId: string },
): Promise<void> {
  if (!deps.notifier || !deps.context) return;
  const ctx = await loadContext(deps.db, input.associationId);
  if (!ctx) return;

  await sendTo(
    deps,
    ctx.creatorEmail,
    AFFILIATE_MID_CAMPAIGN_INVITATION,
    ctx.addition.id,
    await renderPlainNotice({
      subject: `An invitation to join ${ctx.campaignTitle}, already live`,
      headline: `${ctx.campaignTitle} is running, and there is a place for you on it.`,
      facts: [
        { label: 'Campaign', value: ctx.campaignTitle },
        ...frozenTerms(ctx.addition),
        { label: 'Who owns it', value: 'You — this is yours to accept or decline' },
      ],
      paragraphs: [
        // §20: the terms are frozen at the ask precisely so this sentence can
        // be true when the message is read an hour later.
        'This campaign is already live, so the terms above are measured against the time that is left rather than a full campaign. They were fixed when you were asked and do not change while you decide.',
        'Declining costs you nothing and does not affect your standing with Proovd.',
      ],
      action: {
        label: 'Review the opportunity',
        url: `${deps.context.appBaseUrl}/creator/campaigns/${input.associationId}/opportunity`,
      },
      reference: ctx.addition.id,
      supportEmail: deps.context.supportEmail,
    }),
  );

  await sendTo(
    deps,
    ctx.founderEmail,
    FOUNDER_MID_CAMPAIGN_CREATOR_PROPOSED,
    ctx.addition.id,
    await renderPlainNotice({
      subject: `A Creator has been invited to ${ctx.campaignTitle}`,
      headline: 'We invited another Creator to your live campaign.',
      facts: [
        { label: 'Campaign', value: ctx.campaignTitle },
        { label: 'Creator', value: ctx.creatorHandle },
        { label: 'Status', value: 'Invited — they have not accepted yet' },
        { label: 'Who owns the next step', value: 'The Creator' },
      ],
      paragraphs: [
        // §20 forbids a mid-campaign addition changing anything public or any
        // existing Creator's locked terms — and the Founder should know that
        // before they go looking for what changed.
        'Nothing about your live page changed, and no existing Creator’s terms changed. If they accept, their link starts earning from the moment it is activated — never before.',
      ],
      action: {
        label: 'View your roster',
        url: `${deps.context.appBaseUrl}/campaigns/${ctx.campaignId}/roster`,
      },
      reference: ctx.addition.id,
      supportEmail: deps.context.supportEmail,
    }),
  );

  await sendTo(
    deps,
    deps.internalRecipient,
    INTERNAL_MID_CAMPAIGN_INVITE,
    ctx.addition.id,
    await renderInternalNotice({
      subject: `Mid-campaign Creator invited — ${ctx.campaignTitle}`,
      headline: `Mid-campaign invitation opened — ${ctx.campaignTitle}`,
      facts: [
        { label: 'Campaign', value: ctx.campaignTitle },
        { label: 'Association', value: input.associationId },
        { label: 'Remaining hours (frozen)', value: String(ctx.addition.remainingHours) },
        { label: 'High effort at join', value: ctx.addition.highEffortAtJoin ? 'yes' : 'no' },
        { label: 'Slot', value: 'The §2.2 cap was checked before the ask.' },
      ],
      action: {
        label: 'Open the roster',
        url: `${deps.context.appBaseUrl}/admin/creators?campaignId=${ctx.campaignId}`,
      },
      reference: ctx.addition.id,
      supportEmail: deps.context.supportEmail,
    }),
    true,
  );
}

/* ── Accepted (§20, §14.2) ───────────────────────────────────────────────── */

export async function notifyMidCampaignAccepted(
  deps: MidCampaignNotifyDeps,
  input: { associationId: string },
): Promise<void> {
  if (!deps.notifier || !deps.context) return;
  const ctx = await loadContext(deps.db, input.associationId);
  if (!ctx) return;

  await sendTo(
    deps,
    ctx.founderEmail,
    FOUNDER_MID_CAMPAIGN_CREATOR_ACCEPTED,
    ctx.addition.id,
    await renderPlainNotice({
      subject: `${ctx.creatorHandle} accepted — ${ctx.campaignTitle}`,
      headline: 'The Creator accepted your mid-campaign terms.',
      facts: [
        { label: 'Campaign', value: ctx.campaignTitle },
        { label: 'Creator', value: ctx.creatorHandle },
        { label: 'Status', value: 'Accepted — not yet earning' },
        { label: 'Who owns the next step', value: 'Proovd' },
      ],
      paragraphs: [
        'We check their readiness and then activate their link. Nothing they do before activation earns anything, so there is no backdated traffic to account for.',
      ],
      action: {
        label: 'View your roster',
        url: `${deps.context.appBaseUrl}/campaigns/${ctx.campaignId}/roster`,
      },
      reference: ctx.addition.id,
      supportEmail: deps.context.supportEmail,
    }),
  );

  await sendTo(
    deps,
    deps.internalRecipient,
    INTERNAL_MID_CAMPAIGN_ACCEPT,
    ctx.addition.id,
    await renderInternalNotice({
      subject: `Mid-campaign Creator accepted — ${ctx.campaignTitle}`,
      headline: `Mid-campaign terms accepted — ${ctx.campaignTitle}`,
      facts: [
        { label: 'Campaign', value: ctx.campaignTitle },
        { label: 'Association', value: input.associationId },
        { label: 'Frozen terms', value: 'Now binding — the §2.2 slot is committed.' },
        { label: 'Next', value: 'Readiness, then activation. Neither is automatic.' },
      ],
      action: {
        label: 'Open Creator readiness',
        url: `${deps.context.appBaseUrl}/admin/creator-readiness?campaignId=${ctx.campaignId}`,
      },
      reference: ctx.addition.id,
      supportEmail: deps.context.supportEmail,
    }),
    true,
  );
}

/* ── Ready (§16) ─────────────────────────────────────────────────────────── */

export async function notifyMidCampaignReady(
  deps: MidCampaignNotifyDeps,
  input: { associationId: string },
): Promise<void> {
  if (!deps.notifier || !deps.context) return;
  const ctx = await loadContext(deps.db, input.associationId);
  if (!ctx) return;

  await sendTo(
    deps,
    ctx.creatorEmail,
    AFFILIATE_MID_CAMPAIGN_READINESS,
    ctx.addition.id,
    await renderPlainNotice({
      subject: `You are ready on ${ctx.campaignTitle}`,
      headline: 'Everything on your checklist is met.',
      facts: [
        { label: 'Campaign', value: ctx.campaignTitle },
        { label: 'Status', value: 'Ready — your link is not active yet' },
        { label: 'Who owns the next step', value: 'Proovd' },
        { label: 'What you can do now', value: 'No action needed.' },
      ],
      paragraphs: [
        // §1.4: ready is not active, and a Creator who starts posting now would
        // send traffic their link cannot be credited for.
        'Ready is not live. We activate your link and tell you the moment it starts earning — anything posted before then earns nothing, so it is worth waiting for that message.',
      ],
      action: {
        label: 'Open your campaign',
        url: `${deps.context.appBaseUrl}/creator/campaigns/${input.associationId}/partnership`,
      },
      reference: ctx.addition.id,
      supportEmail: deps.context.supportEmail,
    }),
  );

  await sendTo(
    deps,
    deps.internalRecipient,
    INTERNAL_MID_CAMPAIGN_READINESS,
    ctx.addition.id,
    await renderInternalNotice({
      subject: `Mid-campaign Creator ready — ${ctx.campaignTitle}`,
      headline: `Mid-campaign Creator is ready to activate — ${ctx.campaignTitle}`,
      facts: [
        { label: 'Campaign', value: ctx.campaignTitle },
        { label: 'Association', value: input.associationId },
        { label: 'Readiness', value: 'All thirteen §16 items met.' },
        { label: 'Next', value: 'Activation is an Admin action; nothing happens on its own.' },
      ],
      action: {
        label: 'Open Creator readiness',
        url: `${deps.context.appBaseUrl}/admin/creator-readiness?campaignId=${ctx.campaignId}`,
      },
      reference: ctx.addition.id,
      supportEmail: deps.context.supportEmail,
    }),
    true,
  );
}

/* ── Activated (§20, §18) ────────────────────────────────────────────────── */

export async function notifyMidCampaignActivated(
  deps: MidCampaignNotifyDeps,
  input: { associationId: string; activatedAt: Date },
): Promise<void> {
  if (!deps.notifier || !deps.context) return;
  const ctx = await loadContext(deps.db, input.associationId);
  if (!ctx) return;

  await sendTo(
    deps,
    ctx.creatorEmail,
    AFFILIATE_MID_CAMPAIGN_ACTIVATION,
    ctx.addition.id,
    await renderPlainNotice({
      subject: `Your link is live on ${ctx.campaignTitle}`,
      headline: 'Your link is active and earning from now.',
      facts: [
        { label: 'Campaign', value: ctx.campaignTitle },
        { label: 'Active from', value: utcMinute(input.activatedAt) },
        { label: 'Campaign closes', value: utcMinute(ctx.addition.campaignCloseAt) },
        { label: 'What you can do now', value: 'Share your link and publish your first post.' },
      ],
      paragraphs: [
        // §18/§20: no retroactive attribution. Saying it plainly is kinder than
        // letting someone discover it from a click ledger.
        'Clicks from now count toward your commission. Clicks before this moment do not — the campaign was already running, and nothing is credited backwards.',
      ],
      action: {
        label: 'Get your link',
        url: `${deps.context.appBaseUrl}/creator/campaigns/${input.associationId}/partnership`,
      },
      reference: ctx.addition.id,
      supportEmail: deps.context.supportEmail,
    }),
  );

  await sendTo(
    deps,
    ctx.founderEmail,
    FOUNDER_MID_CAMPAIGN_CREATOR_ACTIVATED,
    ctx.addition.id,
    await renderPlainNotice({
      subject: `${ctx.creatorHandle} is now promoting ${ctx.campaignTitle}`,
      headline: 'Your new Creator’s link is live.',
      facts: [
        { label: 'Campaign', value: ctx.campaignTitle },
        { label: 'Creator', value: ctx.creatorHandle },
        { label: 'Active from', value: utcMinute(input.activatedAt) },
        { label: 'What you can do now', value: 'No action needed.' },
      ],
      paragraphs: [
        'Their commission applies to pre-orders attributed to their link from now on. Nothing that happened earlier on your campaign is attributed to them.',
      ],
      action: {
        label: 'View your roster',
        url: `${deps.context.appBaseUrl}/campaigns/${ctx.campaignId}/roster`,
      },
      reference: ctx.addition.id,
      supportEmail: deps.context.supportEmail,
    }),
  );

  await sendTo(
    deps,
    deps.internalRecipient,
    INTERNAL_MID_CAMPAIGN_ACTIVATION,
    ctx.addition.id,
    await renderInternalNotice({
      subject: `Mid-campaign Creator activated — ${ctx.campaignTitle}`,
      headline: `Mid-campaign link activated — ${ctx.campaignTitle}`,
      facts: [
        { label: 'Campaign', value: ctx.campaignTitle },
        { label: 'Association', value: input.associationId },
        { label: 'Activated at', value: utcMinute(input.activatedAt) },
        {
          label: 'Attribution',
          value: 'Every click is decided against this instant; earlier traffic earns nothing.',
        },
      ],
      action: {
        label: 'Open the roster',
        url: `${deps.context.appBaseUrl}/admin/creators?campaignId=${ctx.campaignId}`,
      },
      reference: ctx.addition.id,
      supportEmail: deps.context.supportEmail,
    }),
    true,
  );
}
