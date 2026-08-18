/**
 * The optional digest — Spec §27.7, §27.2, §30, §33.6.11 (Phase 22c).
 *
 * ── The one email a person can turn off, and therefore the one that must
 *    never carry a transactional message ────────────────────────────────────
 * §27.2's first rule is that transactional email is not opt-out-able; §27.7's
 * first word is "optional". Those two are compatible only while the digest and
 * the transactional inventory stay disjoint. The moment a receipt, a deadline,
 * or a money decision can appear in a digest, someone who turned the digest off
 * has opted out of something §27.2 says they cannot, and someone who turned it
 * on receives the same fact twice.
 *
 * So this composes from *activity records* — the three kinds §27.7 names, in
 * `DIGEST_ELIGIBLE_ACTIVITY` — and never from `notification_deliveries`. The
 * obvious implementation, "everything we emailed you since last time", is
 * exactly the one that breaks the rule. The deliveries table is read here for
 * one purpose only: to EXCLUDE an item whose covering transactional key has
 * already gone out, so turning the digest on can add activity and never restate
 * a message.
 *
 * ── An empty digest is not sent ────────────────────────────────────────────
 * §33.6.11 forbids the scheduled generic check-in and this phase's own scope
 * forbids "notification without a real action or consequence behind it". A
 * summary of nothing is both. `sendDigest` returns `skipped_no_activity` and
 * records no delivery, so a quiet week produces silence rather than a subject
 * line — which is also DNA §5.5's point: the product never needs to beg.
 *
 * ── Dedup is the period, not the run ───────────────────────────────────────
 * The entity is `<preference id>:<period key>`, so a job that runs twice in a
 * period sends once (§27.2), and a job that misses a period does not
 * retroactively send two. The period key is derived from the UTC day number
 * rather than from the job's own clock, so two workers minutes apart compute
 * the same key.
 */

import { and, desc, eq, gt, inArray, isNull, lte } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns } from '../db/schema/domain.js';
import { campaignAffiliateAssociations, associationStatusHistory } from '../db/schema/domain.js';
import { campaignBuild } from '../db/schema/build.js';
import { campaignUpdates } from '../db/schema/updates.js';
import { campaignComments } from '../db/schema/live-editing.js';
import { backerIdentities } from '../db/schema/reservations.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import { notificationDeliveries } from '../db/schema/integrity.js';
import { notificationDigestPreferences } from '../db/schema/digest.js';
import { campaignFollowers } from '../db/schema/followers.js';
import type { TokenService } from '../auth/token-service.js';
import { user } from '../db/schema/auth.js';
import {
  activityKindsFor,
  digestPeriodKey,
  digestWindow,
  DIGEST_ELIGIBLE_ACTIVITY,
  isDigestFrequency,
  type DigestAudience,
  type DigestFrequency,
  type EligibleActivityKind,
} from './digest-logic.js';
import {
  AFFILIATE_ACTIVITY_DIGEST,
  BACKER_CAMPAIGN_UPDATE_DIGEST,
  FOUNDER_ACTIVITY_DIGEST,
} from './events.js';
import { renderDigest } from './templates/digest.js';
import type { Notifier } from './send.js';

export interface DigestItem {
  kind: EligibleActivityKind;
  campaignId: string;
  campaignTitle: string;
  /** One factual line. Never a call to action (§30). */
  headline: string;
  occurredAt: Date;
  /** The record this came from — also the exclusion key. */
  sourceId: string;
}

export interface DigestDeps {
  /**
   * Only the follower branch needs it: an unfollow link's raw value exists
   * once, in the delivered URL (§28.1), so every digest to a follower mints
   * its own. Optional so a deployment without it simply sends no follower
   * digests rather than sending one with no way out.
   */
  tokenService?: TokenService | undefined;
  db: Database;
  notifier: Notifier;
  fromAddress: string;
  supportEmail: string;
  appBaseUrl: string;
}

const DIGEST_EVENT_KEY = {
  founder: FOUNDER_ACTIVITY_DIGEST,
  affiliate: AFFILIATE_ACTIVITY_DIGEST,
  backer: BACKER_CAMPAIGN_UPDATE_DIGEST,
} as const;

/* ── Whose campaigns ─────────────────────────────────────────────────────── */

async function founderCampaignIds(db: Database, userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .innerJoin(founderClaimProfiles, eq(founderClaimProfiles.campaignId, campaigns.id))
    .where(eq(founderClaimProfiles.claimedUserId, userId));
  return rows.map((r) => r.id);
}

async function creatorCampaignIds(db: Database, userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: campaignAffiliateAssociations.campaignId })
    .from(campaignAffiliateAssociations)
    .innerJoin(
      affiliateSignupProfiles,
      eq(affiliateSignupProfiles.associationId, campaignAffiliateAssociations.id),
    )
    .where(eq(affiliateSignupProfiles.claimedUserId, userId));
  return [...new Set(rows.map((r) => r.id))];
}

async function titlesFor(db: Database, campaignIds: string[]): Promise<Map<string, string>> {
  if (campaignIds.length === 0) return new Map();
  const rows = await db
    .select({ campaignId: campaignBuild.campaignId, title: campaignBuild.title })
    .from(campaignBuild)
    .where(inArray(campaignBuild.campaignId, campaignIds));
  return new Map(rows.map((r) => [r.campaignId, r.title ?? 'your campaign']));
}

/* ── The three activity kinds ────────────────────────────────────────────── */

/**
 * §18's audience rule decides which updates a given reader may see, and the two
 * readers here differ: a Backer of the campaign may see `backer_only` updates,
 * a Creator promoting it may not. Getting this backwards would put a Founder's
 * Backer-only update in front of a Creator, which is a §18 disclosure failure
 * rather than a digest bug — so the audiences are named rather than defaulted.
 */
type UpdateAudience = (typeof campaignUpdates.audience)['_']['data'];

const BACKER_VISIBLE_AUDIENCES: UpdateAudience[] = [
  'general_public',
  'backer_only',
  'milestone_progress',
];
const CREATOR_VISIBLE_AUDIENCES: UpdateAudience[] = ['general_public', 'milestone_progress'];

async function updateItems(
  db: Database,
  campaignIds: string[],
  visibleAudiences: UpdateAudience[],
  window: { from: Date; to: Date },
  titles: Map<string, string>,
): Promise<DigestItem[]> {
  if (campaignIds.length === 0) return [];
  const rows = await db
    .select({
      id: campaignUpdates.id,
      campaignId: campaignUpdates.campaignId,
      title: campaignUpdates.title,
      publishedAt: campaignUpdates.publishedAt,
    })
    .from(campaignUpdates)
    .where(
      and(
        inArray(campaignUpdates.campaignId, campaignIds),
        inArray(campaignUpdates.audience, visibleAudiences),
        gt(campaignUpdates.publishedAt, window.from),
        lte(campaignUpdates.publishedAt, window.to),
      ),
    )
    .orderBy(desc(campaignUpdates.publishedAt));

  return rows.map((row) => ({
    kind: 'campaign_update' as const,
    campaignId: row.campaignId,
    campaignTitle: titles.get(row.campaignId) ?? 'your campaign',
    // §18 lets an update carry no title. "Posted an update" is the honest
    // headline for one; inventing a summary from the body would be the product
    // writing copy on the Founder's behalf.
    headline: row.title ?? 'Posted an update',
    occurredAt: row.publishedAt,
    sourceId: row.id,
  }));
}

async function commentItems(
  db: Database,
  campaignIds: string[],
  window: { from: Date; to: Date },
  titles: Map<string, string>,
): Promise<DigestItem[]> {
  if (campaignIds.length === 0) return [];
  const rows = await db
    .select({
      id: campaignComments.id,
      campaignId: campaignComments.campaignId,
      authorDisplay: campaignComments.authorDisplay,
      postedAt: campaignComments.postedAt,
    })
    .from(campaignComments)
    .where(
      and(
        inArray(campaignComments.campaignId, campaignIds),
        // A removed comment is not activity to summarise. §18 gives no
        // automatic moderation, so a removal is an Admin's recorded decision —
        // and summarising what an Admin took down would undo it by email.
        eq(campaignComments.visibility, 'visible'),
        gt(campaignComments.postedAt, window.from),
        lte(campaignComments.postedAt, window.to),
      ),
    )
    .orderBy(desc(campaignComments.postedAt));

  return rows.map((row) => ({
    kind: 'campaign_comment' as const,
    campaignId: row.campaignId,
    campaignTitle: titles.get(row.campaignId) ?? 'your campaign',
    // The stored display name, never the address behind it (§18, §11).
    headline: `${row.authorDisplay} commented`,
    occurredAt: row.postedAt,
    sourceId: row.id,
  }));
}

async function rosterItems(
  db: Database,
  campaignIds: string[],
  window: { from: Date; to: Date },
  titles: Map<string, string>,
): Promise<DigestItem[]> {
  if (campaignIds.length === 0) return [];
  const rows = await db
    .select({
      id: associationStatusHistory.id,
      campaignId: campaignAffiliateAssociations.campaignId,
      toStatus: associationStatusHistory.toStatus,
      occurredAt: associationStatusHistory.occurredAt,
    })
    .from(associationStatusHistory)
    .innerJoin(
      campaignAffiliateAssociations,
      eq(campaignAffiliateAssociations.id, associationStatusHistory.associationId),
    )
    .where(
      and(
        inArray(campaignAffiliateAssociations.campaignId, campaignIds),
        gt(associationStatusHistory.occurredAt, window.from),
        lte(associationStatusHistory.occurredAt, window.to),
      ),
    )
    .orderBy(desc(associationStatusHistory.occurredAt));

  return rows.map((row) => ({
    kind: 'roster_change' as const,
    campaignId: row.campaignId,
    campaignTitle: titles.get(row.campaignId) ?? 'your campaign',
    // Counted, not named. §11 keeps the Creator's identity out of the Founder's
    // reach beyond the public handle, and a digest is not the surface that
    // changes that — the roster is, and it is one click away.
    headline: 'A Creator’s status changed',
    occurredAt: row.occurredAt,
    sourceId: row.id,
  }));
}

/* ── Exclusion: never restate a message that already went ────────────────── */

/**
 * §27.2, §30. An activity kind whose `coveredBy` transactional key already
 * delivered to this address is dropped — the reader has the fact, and a digest
 * that repeated it would turn an optional summary into a second copy of a
 * mandatory email.
 *
 * The check is `(coveredBy, target, sourceId)`, which requires the covering
 * sender to dedup on the SAME record id the item came from. `founder_roster_
 * update` is the only key with a covering relationship today and it is 22b's;
 * its entity must be the `association_status_history` row for this exclusion to
 * bind, and `unsent.ts` records that requirement so it is not discovered later.
 */
async function withoutAlreadySentItems(
  db: Database,
  target: string,
  items: DigestItem[],
): Promise<DigestItem[]> {
  const covered = items.filter((item) => DIGEST_ELIGIBLE_ACTIVITY[item.kind].coveredBy);
  if (covered.length === 0) return items;

  const rows = await db
    .select({
      eventKey: notificationDeliveries.eventKey,
      entityId: notificationDeliveries.entityId,
    })
    .from(notificationDeliveries)
    .where(
      and(
        eq(notificationDeliveries.target, target),
        inArray(
          notificationDeliveries.entityId,
          covered.map((item) => item.sourceId),
        ),
      ),
    );

  const sent = new Set(rows.map((r) => `${r.eventKey}:${r.entityId}`));
  return items.filter((item) => {
    const coveredBy = DIGEST_ELIGIBLE_ACTIVITY[item.kind].coveredBy;
    return !coveredBy || !sent.has(`${coveredBy}:${item.sourceId}`);
  });
}

/* ── Compose ─────────────────────────────────────────────────────────────── */

export interface ComposeInput {
  audience: DigestAudience;
  frequency: DigestFrequency;
  /** The account for founder/affiliate; the identity for a Backer. */
  userId?: string | undefined;
  backerIdentityId?: string | undefined;
  /**
   * A campaign FOLLOWER (campaign-page-v2 Session C — a recorded §1 rule 6
   * deviation). Rides the `backer` audience because the prefix names the
   * delivery channel, not a claim that this person pre-ordered — but it is a
   * separate field, because what a follower may SEE differs and keying that
   * off the audience string would get it wrong silently.
   */
  followerId?: string | undefined;
  target: string;
  now: Date;
}

/**
 * The activity a subscriber is owed for this period. Ordered newest first and
 * bounded to the kinds their audience may see — `activityKindsFor` is the
 * register, so a fourth kind cannot arrive by someone adding a query here.
 */
export async function composeDigest(
  db: Database,
  input: ComposeInput,
): Promise<DigestItem[]> {
  const window = digestWindow(input.frequency, input.now);
  const kinds = new Set(activityKindsFor(input.audience));

  let campaignIds: string[] = [];
  if (input.audience === 'founder' && input.userId) {
    campaignIds = await founderCampaignIds(db, input.userId);
  } else if (input.audience === 'affiliate' && input.userId) {
    campaignIds = await creatorCampaignIds(db, input.userId);
  } else if (input.followerId) {
    const [follow] = await db
      .select({ campaignId: campaignFollowers.campaignId })
      .from(campaignFollowers)
      .where(
        and(eq(campaignFollowers.id, input.followerId), eq(campaignFollowers.state, 'confirmed')),
      )
      .limit(1);
    campaignIds = follow ? [follow.campaignId] : [];
  } else if (input.audience === 'backer' && input.backerIdentityId) {
    const [identity] = await db
      .select({ campaignId: backerIdentities.campaignId })
      .from(backerIdentities)
      .where(eq(backerIdentities.id, input.backerIdentityId))
      .limit(1);
    campaignIds = identity ? [identity.campaignId] : [];
  }
  if (campaignIds.length === 0) return [];

  const titles = await titlesFor(db, campaignIds);
  const items: DigestItem[] = [];

  if (kinds.has('campaign_update')) {
    items.push(
      ...(await updateItems(
        db,
        campaignIds,
        /*
          A FOLLOWER takes the Creator list, never the Backer list.
          `backer_only` updates are for people who actually pre-ordered, so
          putting a follower on the Backer list would be a §18 disclosure
          failure rather than a digest bug — which is why this branches on
          follower-ness and not on `input.audience`, a string a follower
          legitimately shares with a real Backer.
        */
        input.followerId
          ? CREATOR_VISIBLE_AUDIENCES
          : input.audience === 'backer'
            ? BACKER_VISIBLE_AUDIENCES
            : CREATOR_VISIBLE_AUDIENCES,
        window,
        titles,
      )),
    );
  }
  if (kinds.has('campaign_comment')) {
    items.push(...(await commentItems(db, campaignIds, window, titles)));
  }
  if (kinds.has('roster_change')) {
    items.push(...(await rosterItems(db, campaignIds, window, titles)));
  }

  const kept = await withoutAlreadySentItems(db, input.target, items);
  return kept.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
}

/* ── Send ────────────────────────────────────────────────────────────────── */

export type DigestSendResult =
  | { status: 'sent'; items: number }
  | { status: 'duplicate' }
  | { status: 'skipped_no_activity' }
  | { status: 'skipped_no_address' };

/**
 * One digest, for one subscriber, for one period. Composing first and sending
 * only on a non-empty result is what makes §33.6.11's absence structural: there
 * is no branch that produces a message from a date.
 */
export async function sendDigest(
  deps: DigestDeps,
  input: ComposeInput & { preferenceId: string; preferencesUrl?: string | undefined },
): Promise<DigestSendResult> {
  if (!input.target) return { status: 'skipped_no_address' };

  const items = await composeDigest(deps.db, input);
  if (items.length === 0) return { status: 'skipped_no_activity' };

  const message = await renderDigest({
    audience: input.audience,
    frequency: input.frequency,
    items: items.map((item) => ({
      campaignTitle: item.campaignTitle,
      headline: item.headline,
      occurredAt: item.occurredAt,
    })),
    // One primary action (§27.2). Where the reader manages the preference is
    // the honest destination for a message whose subject is "here is what
    // happened" — every item is already linked from the campaign it names.
    /*
      For a follower this IS the unfollow link, so the digest's single action
      satisfies `oneActionAtMost` and `optOutRule: 'required'` at the same
      time. It is passed in rather than derived because the raw token exists
      only in the delivered URL (§28.1) — there is nothing here to recompute.
    */
    preferencesUrl: input.preferencesUrl ?? preferencesUrlFor(deps.appBaseUrl, input),
    supportEmail: deps.supportEmail,
    reference: input.preferenceId,
  });

  const outcome = await deps.notifier.send({
    eventKey: DIGEST_EVENT_KEY[input.audience],
    entityType: 'digest_period',
    // One per subscriber per period: a job that runs twice sends once.
    entityId: `${input.preferenceId}:${digestPeriodKey(input.frequency, input.now)}`,
    to: input.target,
    from: deps.fromAddress,
    replyTo: deps.supportEmail,
    ...message,
  });

  if (outcome.status === 'duplicate') return { status: 'duplicate' };
  return { status: 'sent', items: items.length };
}

function preferencesUrlFor(baseUrl: string, input: ComposeInput): string {
  if (input.audience === 'founder') return `${baseUrl}/settings/notifications`;
  if (input.audience === 'affiliate') return `${baseUrl}/creator/settings/notifications`;
  // The Backer has no account; their control lives on the magic-link page, and
  // the fresh link rides every campaign message rather than this one.
  return `${baseUrl}/backer`;
}

/* ── The sweep ───────────────────────────────────────────────────────────── */

export interface SweepResult {
  considered: number;
  sent: number;
  skippedEmpty: number;
  duplicates: number;
}

/**
 * Every subscriber of one cadence. Each is its own attempt: one person's
 * missing address or failed provider call must not stop the rest, the same way
 * 08c reveals each association in its own transaction.
 */
export async function sweepDigests(
  deps: DigestDeps,
  input: { frequency: string; now?: Date },
): Promise<SweepResult> {
  const now = input.now ?? new Date();
  const result: SweepResult = { considered: 0, sent: 0, skippedEmpty: 0, duplicates: 0 };
  if (!isDigestFrequency(input.frequency)) return result;
  const frequency = input.frequency;

  const subscribers = await deps.db
    .select({
      id: notificationDigestPreferences.id,
      audience: notificationDigestPreferences.audience,
      userId: notificationDigestPreferences.userId,
      backerIdentityId: notificationDigestPreferences.backerIdentityId,
      accountEmail: user.email,
      backerEmail: backerIdentities.email,
    })
    .from(notificationDigestPreferences)
    .leftJoin(user, eq(user.id, notificationDigestPreferences.userId))
    .leftJoin(
      backerIdentities,
      eq(backerIdentities.id, notificationDigestPreferences.backerIdentityId),
    )
    .where(eq(notificationDigestPreferences.frequency, frequency));

  for (const subscriber of subscribers) {
    const audience = subscriber.audience as DigestAudience;
    const target = subscriber.accountEmail ?? subscriber.backerEmail ?? '';
    result.considered += 1;

    const outcome = await sendDigest(deps, {
      audience,
      frequency,
      userId: subscriber.userId ?? undefined,
      backerIdentityId: subscriber.backerIdentityId ?? undefined,
      target,
      now,
      preferenceId: subscriber.id,
    });

    if (outcome.status === 'sent') result.sent += 1;
    else if (outcome.status === 'duplicate') result.duplicates += 1;
    else if (outcome.status === 'skipped_no_activity') result.skippedEmpty += 1;
  }

  /*
    ── The campaign followers ────────────────────────────────────────────────
    A recorded §1 rule 6 deviation (campaign-page-v2 Session C). It reads
    `campaign_followers`, NOT a fourth row in `notification_digest_preferences`:
    migration 0035's `digest_preference_subject_matches_audience` CHECK admits
    exactly two subject columns and three audiences, and both registers are
    asserted deep-equal between shared and backend. The frequency lives on the
    follow row instead.

    It composes through the SAME `sendDigest`, so the empty-digest rule holds
    unchanged — §33.6.11's absence is structural for a follower too, because
    there is still no branch anywhere that produces a message from a date.
  */
  if (deps.tokenService) {
    const followers = await deps.db
      .select({
        id: campaignFollowers.id,
        email: campaignFollowers.email,
        campaignId: campaignFollowers.campaignId,
      })
      .from(campaignFollowers)
      .where(
        and(
          eq(campaignFollowers.state, 'confirmed'),
          eq(campaignFollowers.frequency, frequency),
          isNull(campaignFollowers.anonymisedAt),
        ),
      );

    for (const follower of followers) {
      result.considered += 1;
      if (!follower.email) continue;

      /*
        A fresh unfollow token per send, deliberately. Rotating one lineage
        would kill the link in every message already delivered — a person
        unsubscribing from last week's summary would find a dead link, which
        is the one failure an opt-out route must not have. Every token minted
        here is bound to this follow alone and all of them are revoked the
        moment it ends.
      */
      const stop = await deps.tokenService.issue(
        { scope: 'campaign_follow', campaignFollowerId: follower.id },
        { expiresAt: null },
      );

      const outcome = await sendDigest(deps, {
        audience: 'backer',
        frequency,
        followerId: follower.id,
        target: follower.email,
        now,
        preferenceId: follower.id,
        preferencesUrl: `${deps.appBaseUrl}/follow/stop/${stop.raw}`,
      });

      if (outcome.status === 'sent') result.sent += 1;
      else if (outcome.status === 'duplicate') result.duplicates += 1;
      else if (outcome.status === 'skipped_no_activity') result.skippedEmpty += 1;
    }
  }

  return result;
}
