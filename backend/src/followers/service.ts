/**
 * The campaign follow — a RECORDED DEVIATION from §1 rule 6.
 *
 * Capturing an email from somebody who has NOT pre-ordered, and sending them
 * recurring mail, is a new commercial capability the Spec does not define.
 * §1 rule 6 would forbid it. It is built by explicit product direction, at the
 * narrowest shape that honours the promise the `Follow build` button makes,
 * and recorded in CLAUDE.md the way the 2026-08-10 Admin-MFA removal and the
 * account-level Creator suspend/restore are — so a later session does not
 * "fix" it by deleting it, and does not read it as licence for more.
 *
 * Migration 0050's header carries the full statement of what "narrowest"
 * means. What this file adds to it:
 *
 *   * ONE message, and it is a RECEIPT. `backer_follow_confirmation` confirms
 *     a consent; the thing consented to is §27.7's existing digest, which
 *     needs no key of its own. There is no welcome, no re-engagement, no
 *     second ask, and nothing that fires on a date.
 *   * DOUBLE OPT-IN, always. A row is `pending` until the person opens the
 *     link. An address typed by somebody else never becomes a subscription.
 *   * The frequency is ASKED. §27.7's rule is that the preference exists only
 *     because a person chose it, so there is no default in the column, none
 *     here, and none on the form.
 *
 * ── This route is an enumeration oracle by default ──────────────────────────
 * It is the second public route in the product that accepts an email address,
 * and `reservations/magic-link-reissue.ts` already worked out the answer: a
 * route that responds differently for a hit and a miss tells anyone who asks
 * which addresses are interested in which campaign. So `FOLLOW_ACK` is frozen
 * and identical for:
 *   - an address already following this campaign
 *   - an address not following it
 *   - a malformed address
 *   - a campaign id that has never existed
 *   - a campaign that is not live
 *   - a caller over the rate limit
 *
 * The rate-limit case is the one that looks wrong and is not — Phase 04's
 * `token-rejection.ts`: "a limiter that announces itself is the same
 * enumeration oracle wearing a different hat."
 */

import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns } from '../db/schema/domain.js';
import { campaignBuild } from '../db/schema/build.js';
import { campaignFollowers, type FollowSource } from '../db/schema/followers.js';
import { secureTokens } from '../db/schema/tokens.js';
import type { TokenService } from '../auth/token-service.js';
import { followTokenPurpose } from '../auth/token-service.js';
import type { Notifier } from '../notifications/send.js';
import { BACKER_FOLLOW_CONFIRMATION } from '../notifications/events.js';
import { renderPlainNotice } from '../notifications/templates/plain.js';
import { normalizeEmail } from '../reservations/restated.js';
import { DIGEST_FREQUENCIES } from './logic.js';

/**
 * The one answer. Frozen, and deliberately carrying nothing per-request — no
 * timestamp, no request id, no retry hint. Anything that varies is a channel.
 */
export const FOLLOW_ACK = Object.freeze({
  status: 'requested' as const,
  title: 'Check your email',
  whatHappened:
    'If that address can follow this campaign, we have sent it a link to confirm.',
  next: 'Nothing starts until you open that link. Every summary after it carries a way to change how often you get it, or to stop.',
});

/**
 * The consent, preserved with the row as it was shown (§24.10's posture
 * applied to a marketing consent: the text somebody agreed to is a fact, not a
 * template lookup that a later edit silently rewrites).
 *
 * It says what arrives, how often, that nothing is charged, and how to stop.
 * It carries no urgency, no scarcity, and no count — §30, and there is no
 * follower count anywhere in this product to put in it.
 */
export const FOLLOW_CONSENT_VERSION = 'follow-consent.v1';

export function followConsentText(campaignTitle: string, frequency: string): string {
  return [
    `You are asking Proovd to email you a summary of what happens on ${campaignTitle}, ${frequency}.`,
    'A summary is sent only when something actually happened — never on a schedule with nothing in it.',
    'This is not a pre-order and nothing is charged. No card is saved and no payment information is collected.',
    'Every summary carries a link to change how often you get it, or to stop entirely.',
  ].join('\n\n');
}

export interface FollowDeps {
  db: Database;
  tokenService: TokenService;
  notifier?: Notifier | undefined;
  appBaseUrl: string;
  fromAddress: string;
  supportEmail: string;
}

/** Campaign states a person can meaningfully follow the build of. */
const FOLLOWABLE_STATUSES = ['live', 'closed_pending_capture', 'closed_reconciling'] as const;

/**
 * Records the ask and sends the confirmation, or does nothing.
 *
 * Returns nothing a caller could branch on, because there is no caller that
 * should: the route has already answered. Kept exported so the suite can drive
 * it directly and assert what it did — the alternative is a test that asserts
 * on the email, which is what a real caller cannot see either.
 */
export async function requestFollow(
  deps: FollowDeps,
  input: {
    campaignId: string;
    email: string;
    frequency: string;
    source: FollowSource;
  },
): Promise<void> {
  if (!deps.notifier) return;

  // §27.7: the preference exists only because a person chose it. An absent or
  // unrecognised frequency is not defaulted — it is simply not a follow.
  if (!(DIGEST_FREQUENCIES as readonly string[]).includes(input.frequency)) return;

  // §4.1's own normalisation, so one address is one follow however it is typed.
  const normalised = normalizeEmail(input.email);
  if (!normalised || !normalised.includes('@')) return;

  // ONE query, not two. A two-step "find the campaign, then find the follow"
  // answers faster for a campaign that does not exist, which is the timing
  // oracle the frozen body exists to close.
  const [campaign] = await deps.db
    .select({ id: campaigns.id, status: campaigns.status, title: campaignBuild.title })
    .from(campaigns)
    .leftJoin(campaignBuild, eq(campaignBuild.campaignId, campaigns.id))
    .where(eq(campaigns.id, input.campaignId))
    .limit(1);

  if (!campaign) return;
  if (!(FOLLOWABLE_STATUSES as readonly string[]).includes(campaign.status)) return;

  const title = campaign.title ?? 'this campaign';
  const consentText = followConsentText(title, input.frequency);

  /*
   * One follow per address per campaign, over LIVE rows only — so the partial
   * unique index needs `targetWhere`, or Postgres raises 42P10 at runtime
   * (`notifications/preferences.ts` records the same trap).
   *
   * An address that already follows re-enters `pending` and gets a fresh
   * confirmation: somebody asking twice is somebody whose first link did not
   * arrive, which is §7's resend reasoning. What it does NOT do is silently
   * re-confirm — the link is still what confirms.
   */
  const [row] = await deps.db
    .insert(campaignFollowers)
    .values({
      campaignId: campaign.id,
      email: input.email.trim(),
      emailNormalized: normalised,
      state: 'pending',
      frequency: input.frequency,
      consentText,
      consentVersion: FOLLOW_CONSENT_VERSION,
      source: input.source,
    })
    .onConflictDoUpdate({
      target: [campaignFollowers.campaignId, campaignFollowers.emailNormalized],
      targetWhere: sql`"email_normalized" IS NOT NULL`,
      set: {
        state: 'pending',
        frequency: input.frequency,
        email: input.email.trim(),
        consentText,
        unfollowedAt: null,
      },
    })
    .returning();

  if (!row) return;

  // Two lineages of one scope. The confirm link expires; the unfollow link
  // never does, and that difference IS what tells them apart at the routes
  // (see `followTokenPurpose`). Both are minted now, so the confirmation email
  // can carry the way out of a consent it is still asking for.
  const confirm = await deps.tokenService.issue({
    scope: 'campaign_follow',
    campaignFollowerId: row.id,
  });
  const stop = await deps.tokenService.issue(
    { scope: 'campaign_follow', campaignFollowerId: row.id },
    { expiresAt: null },
  );

  const notice = await renderPlainNotice({
    subject: `Confirm the summary for ${title}`,
    headline: 'One click and the summary starts.',
    facts: [
      { label: 'Campaign', value: title },
      { label: 'How often', value: input.frequency === 'daily' ? 'Daily' : 'Weekly' },
      {
        label: 'What this is not',
        value: 'Not a pre-order. Nothing is charged and no card is saved.',
      },
      {
        label: 'If you did not ask for this',
        value:
          'Nothing has started and nothing will. Ignore this email and no summary is ever sent.',
      },
    ],
    paragraphs: [
      consentText,
      `If you would rather not receive it after all: ${deps.appBaseUrl}/follow/stop/${stop.raw}`,
    ],
    // §27.2: at most one primary action.
    action: {
      label: 'Confirm the summary',
      url: `${deps.appBaseUrl}/follow/confirm/${confirm.raw}`,
    },
    reference: campaign.id,
    supportEmail: deps.supportEmail,
  });

  await deps.notifier.send({
    eventKey: BACKER_FOLLOW_CONFIRMATION,
    entityType: 'campaign_follow',
    /*
     * Per FOLLOW ROW, not per request. A second ask re-enters `pending` on the
     * same row and mints a fresh token, and the person needs that message —
     * but the row is what a replayed request would collide on, so a duplicate
     * delivery of the same ask sends once. The row id is meaningless outside
     * this table and reaches nobody.
     */
    entityId: `${row.id}:${confirm.record.id}`,
    to: input.email.trim(),
    from: deps.fromAddress,
    replyTo: deps.supportEmail,
    ...notice,
  });
}

export type FollowActionResult =
  | { ok: true; campaignId: string; campaignTitle: string; frequency: string }
  | { ok: false };

/**
 * Confirms a follow. The confirm lineage is single-use, so it is claimed.
 *
 * A token from the UNFOLLOW lineage is refused here by `followTokenPurpose` —
 * without that check, opening the unfollow link at this address would claim it
 * and leave the person with a dead unsubscribe link in their inbox.
 */
export async function confirmFollow(
  deps: FollowDeps,
  rawToken: string,
): Promise<FollowActionResult> {
  const verified = await deps.tokenService.verify(rawToken, 'campaign_follow');
  if (!verified.ok) return { ok: false };
  if (followTokenPurpose(verified.token) !== 'confirm') return { ok: false };

  const followerId = verified.token.campaignFollowerId;
  if (!followerId) return { ok: false };

  const now = new Date();
  // Conditional UPDATE, never select-then-update: two clicks on the same link
  // settle to one confirmation and one history row.
  const [row] = await deps.db
    .update(campaignFollowers)
    .set({ state: 'confirmed', confirmedAt: now, unfollowedAt: null })
    .where(
      and(
        eq(campaignFollowers.id, followerId),
        eq(campaignFollowers.state, 'pending'),
        isNull(campaignFollowers.anonymisedAt),
      ),
    )
    .returning();

  // Claim the confirm lineage whether or not the row moved: a link that has
  // been opened is spent, and re-opening it must not be a second consent.
  await deps.tokenService.revoke(verified.token.id, 'claimed');

  const target = row ?? (await loadFollower(deps.db, followerId));
  if (!target || target.state !== 'confirmed') return { ok: false };
  return {
    ok: true,
    campaignId: target.campaignId,
    campaignTitle: await titleFor(deps.db, target.campaignId),
    frequency: target.frequency,
  };
}

/**
 * Ends a follow. The unfollow lineage is never claimed — `verify` rejects a
 * claimed token, and an opt-out link that stops working is not an opt-out.
 * It is revoked here, once, because the follow it belonged to has ended.
 */
export async function unfollowCampaign(
  deps: FollowDeps,
  rawToken: string,
): Promise<FollowActionResult> {
  const verified = await deps.tokenService.verify(rawToken, 'campaign_follow');
  if (!verified.ok) return { ok: false };
  if (followTokenPurpose(verified.token) !== 'unfollow') return { ok: false };

  const followerId = verified.token.campaignFollowerId;
  if (!followerId) return { ok: false };

  const now = new Date();
  await deps.db
    .update(campaignFollowers)
    .set({ state: 'unfollowed', unfollowedAt: now })
    .where(
      and(
        eq(campaignFollowers.id, followerId),
        isNull(campaignFollowers.anonymisedAt),
        sql`${campaignFollowers.state} <> 'unfollowed'`,
      ),
    );

  // Every live token bound to this follow stops here — the confirm lineage
  // too, so a stale confirmation email cannot restart what somebody just
  // ended. §25.8's retention clock starts from `unfollowed_at`.
  await deps.db
    .update(secureTokens)
    .set({ revokedAt: now, revokedReason: 'claimed' })
    .where(
      and(
        eq(secureTokens.campaignFollowerId, followerId),
        isNull(secureTokens.revokedAt),
        isNull(secureTokens.claimedAt),
      ),
    );

  const target = await loadFollower(deps.db, followerId);
  if (!target) return { ok: false };
  return {
    ok: true,
    campaignId: target.campaignId,
    campaignTitle: await titleFor(deps.db, target.campaignId),
    frequency: target.frequency,
  };
}

async function loadFollower(db: Database, id: string) {
  const [row] = await db
    .select()
    .from(campaignFollowers)
    .where(eq(campaignFollowers.id, id))
    .limit(1);
  return row;
}

async function titleFor(db: Database, campaignId: string): Promise<string> {
  const [row] = await db
    .select({ title: campaignBuild.title })
    .from(campaignBuild)
    .where(eq(campaignBuild.campaignId, campaignId))
    .limit(1);
  return row?.title ?? 'this campaign';
}

/**
 * A read-only count, for the Admin campaign record only.
 *
 * §30 defers public like/follow signals, so this reaches no public payload —
 * a test asserts the public campaign response carries no follower field. It is
 * computed rather than stored: a `follower_count` column on `campaigns` would
 * be a second answer to a question this one query answers.
 */
export async function countConfirmedFollowers(
  db: Database,
  campaignId: string,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(campaignFollowers)
    .where(
      and(
        eq(campaignFollowers.campaignId, campaignId),
        eq(campaignFollowers.state, 'confirmed'),
      ),
    );
  return Number(row?.n ?? 0);
}
