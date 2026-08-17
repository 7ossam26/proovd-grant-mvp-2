/**
 * Campaign updates — Spec §18, §25.1 (Phase 14c).
 *
 * The Founder posts updates on a campaign that is live or has naturally closed;
 * the public campaign page renders the public ones. This owns the three rules
 * §18 states: the audience is allowed for the campaign type, an update is posted
 * only after live (and may continue after close), and a material delivery change
 * carries both the prior and revised commitment.
 *
 * ── The vocabulary is restated and drift-tested ─────────────────────────────
 * The backend cannot import `@proovd/shared` at runtime, so the audience set,
 * the per-model rule, and the public-audience filter are restated here and
 * drift-tested against `shared/src/updates` in `campaign-updates.test.ts`.
 */

import { and, desc, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns } from '../db/schema/domain.js';
import { campaignUpdates, type CampaignUpdate } from '../db/schema/updates.js';
import type { AuditWriter } from '../auth/audit.js';
import { classifyLifecycle } from './public-page.js';

/* ── Vocabulary (restated from shared, drift-tested) ────────────────────────── */

export const UPDATE_AUDIENCES = ['general_public', 'backer_only', 'milestone_progress'] as const;
export type UpdateAudience = (typeof UPDATE_AUDIENCES)[number];

export const UPDATE_AUDIENCES_BY_MODEL: Record<'idea' | 'product', readonly UpdateAudience[]> = {
  idea: ['general_public', 'backer_only', 'milestone_progress'],
  product: ['general_public', 'backer_only'],
};

export const PUBLIC_UPDATE_AUDIENCES: readonly UpdateAudience[] = [
  'general_public',
  'milestone_progress',
];

/* ── Posting (§18) ──────────────────────────────────────────────────────────── */

export interface PostUpdateInput {
  campaignId: string;
  author: string;
  audience: UpdateAudience;
  title?: string | undefined;
  body: string;
  imageUrl?: string | undefined;
  videoUrl?: string | undefined;
  /** §18: when the update announces a delivery change, both commitments together. */
  deliveryChange?: { prior: string; revised: string } | undefined;
  /**
   * The headline metric the rebuilt page renders above the body (0049). Both
   * halves or neither — a 0049 CHECK, because a bare `86%` reads as nothing to
   * a screen reader (the label IS its accessible name) and a label with no
   * value is an empty promise.
   */
  metric?: { label: string; value: string } | undefined;
  now?: Date;
}

export type PostUpdateResult =
  | { status: 'posted'; update: CampaignUpdate }
  | { status: 'not_found' }
  | { status: 'not_live'; message: string }
  | { status: 'audience_not_allowed'; message: string }
  | { status: 'invalid'; message: string };

/** A campaign accepts updates once live, and continues to after a natural close. */
function acceptsUpdates(status: string): boolean {
  if (status === 'live') return true;
  const ended = classifyLifecycle(status).ended;
  // §18: "may continue after close." A natural close or a threshold miss — never
  // a suspension or kill, which are Admin enforcement states.
  return ended === 'closed' || ended === 'no_charge';
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function postUpdate(
  db: Database,
  deps: { audit: AuditWriter },
  input: PostUpdateInput,
): Promise<PostUpdateResult> {
  const now = input.now ?? new Date();

  const [campaign] = await db
    .select({ id: campaigns.id, type: campaigns.type, status: campaigns.status })
    .from(campaigns)
    .where(eq(campaigns.id, input.campaignId))
    .limit(1);
  if (!campaign || !campaign.type) return { status: 'not_found' };

  if (!acceptsUpdates(campaign.status)) {
    return {
      status: 'not_live',
      message: 'Updates can be posted once the campaign is live, and after it closes — not before.',
    };
  }

  const model = campaign.type === 'pre_build' ? 'idea' : 'product';
  if (!UPDATE_AUDIENCES_BY_MODEL[model].includes(input.audience)) {
    return {
      status: 'audience_not_allowed',
      message:
        input.audience === 'milestone_progress'
          ? 'A milestone/progress update is only available on an Idea Campaign.'
          : 'That audience is not available for this campaign.',
    };
  }

  const body = input.body.trim();
  if (body.length === 0) return { status: 'invalid', message: 'An update needs some text.' };

  for (const url of [input.imageUrl, input.videoUrl]) {
    if (url !== undefined && url !== '' && !isHttpUrl(url)) {
      return { status: 'invalid', message: 'An image or video link must be a valid http(s) URL.' };
    }
  }

  const material = input.deliveryChange;
  if (material && (!material.prior.trim() || !material.revised.trim())) {
    return {
      status: 'invalid',
      message: 'A delivery change must state both the previous and the revised commitment.',
    };
  }

  // The 0049 CHECK refuses a half-filled metric regardless; refusing here first
  // is what puts a sentence in front of the Founder rather than a constraint
  // name. A blank half is an absent half — both empty is simply no metric.
  const metricLabel = input.metric?.label.trim() ?? '';
  const metricValue = input.metric?.value.trim() ?? '';
  if (Boolean(metricLabel) !== Boolean(metricValue)) {
    return {
      status: 'invalid',
      message:
        'A headline number needs both the number and what it counts. On its own, a number reads as nothing.',
    };
  }

  const [update] = await db
    .insert(campaignUpdates)
    .values({
      campaignId: input.campaignId,
      author: input.author,
      audience: input.audience,
      title: input.title?.trim() || null,
      body,
      imageUrl: input.imageUrl?.trim() || null,
      videoUrl: input.videoUrl?.trim() || null,
      publishedAt: now,
      isMaterialDeliveryChange: Boolean(material),
      priorCommitment: material ? material.prior.trim() : null,
      revisedCommitment: material ? material.revised.trim() : null,
      metricLabel: metricLabel || null,
      metricValue: metricValue || null,
    })
    .returning();

  await deps.audit({
    action: 'campaign.update_posted',
    targetType: 'campaign',
    targetId: input.campaignId,
    internalReason: `§18 update posted (${input.audience}${material ? ', material delivery change' : ''}).`,
    newValue: { updateId: update!.id, audience: input.audience, material: Boolean(material) },
    actorId: input.author.replace(/^founder:|^admin:|^user:/, '') || null,
  });

  return { status: 'posted', update: update! };
}

/* ── Reads ─────────────────────────────────────────────────────────────────── */

/** The updates the public campaign page renders — never a Backer-only one. */
export async function listPublicUpdates(
  db: Pick<Database, 'select'>,
  campaignId: string,
): Promise<CampaignUpdate[]> {
  const rows = await db
    .select()
    .from(campaignUpdates)
    .where(eq(campaignUpdates.campaignId, campaignId))
    .orderBy(desc(campaignUpdates.publishedAt));
  return rows.filter((r) => PUBLIC_UPDATE_AUDIENCES.includes(r.audience as UpdateAudience));
}

/** Every update on the campaign, for the Founder's own authoring surface. */
export async function listFounderUpdates(
  db: Pick<Database, 'select'>,
  campaignId: string,
): Promise<CampaignUpdate[]> {
  return db
    .select()
    .from(campaignUpdates)
    .where(eq(campaignUpdates.campaignId, campaignId))
    .orderBy(desc(campaignUpdates.publishedAt));
}

/** §18 update → the wire shape the campaign page and the Founder surface render. */
export function serializeUpdate(update: CampaignUpdate) {
  return {
    id: update.id,
    audience: update.audience,
    title: update.title,
    body: update.body,
    imageUrl: update.imageUrl,
    videoUrl: update.videoUrl,
    publishedAt: update.publishedAt.toISOString(),
    isMaterialDeliveryChange: update.isMaterialDeliveryChange,
    priorCommitment: update.priorCommitment,
    revisedCommitment: update.revisedCommitment,
    metricLabel: update.metricLabel,
    metricValue: update.metricValue,
  };
}
